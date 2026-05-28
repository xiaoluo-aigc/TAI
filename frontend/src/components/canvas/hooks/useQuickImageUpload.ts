/**
 * 快速图片上传Hook
 * 直接选择图片并自动放置到画布中心
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import { historyService } from '@/services/historyService';
import { paperSaveService } from '@/services/paperSaveService';
import { imageUploadService } from '@/services/imageUploadService';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import { useUIStore } from '@/stores/uiStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { isRaster } from '@/utils/paperCoords';
import { createImageGroupBlock } from '@/utils/paperImageGroupBlock';
import {
    isAssetKeyRef,
    isAssetProxyRef,
    isPersistableImageRef,
    isRemoteUrl,
    normalizePersistableImageRef,
    requiresManagedImageUpload,
    toRenderableImageSrc,
} from '@/utils/imageSource';
import type { DrawingContext, StoredImageAsset } from '@/types/canvas';

interface UseQuickImageUploadProps {
    context: DrawingContext;
    canvasRef?: React.RefObject<HTMLCanvasElement | null>;
    projectId?: string | null;
}

const isInlineDataUrl = (value?: string | null): value is string => {
    if (typeof value !== 'string') return false;
    return value.startsWith('data:image');
};

const toPreferredRemoteSource = (value: string): string => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || !isRemoteUrl(trimmed)) return value;
    try {
        // 远程展示优先直连（尤其 OSS），失败时由 onError 再回退 proxy。
        return toRenderableImageSrc(trimmed) || trimmed;
    } catch {
        return trimmed;
    }
};

const pickRasterSource = (asset: StoredImageAsset): { source: string; remoteUrl?: string; key?: string } => {
    const normalizedRemote = normalizePersistableImageRef(asset.remoteUrl);
    const normalizedUrl = normalizePersistableImageRef(asset.url);
    const normalizedSrc = normalizePersistableImageRef(asset.src);
    const normalizedKey = normalizePersistableImageRef(asset.key);

    // remoteUrl 仅用于“回退到直连”/一些需要 http(s) 的能力
    const remoteUrl = isRemoteUrl(normalizedRemote)
        ? normalizedRemote
        : isRemoteUrl(normalizedSrc)
        ? normalizedSrc
        : isRemoteUrl(normalizedUrl)
            ? normalizedUrl
            : undefined;

    const key = (normalizedKey && isAssetKeyRef(normalizedKey))
        ? normalizedKey
        : (normalizedUrl && isAssetKeyRef(normalizedUrl))
            ? normalizedUrl
            : undefined;

    // 显示优先：localDataUrl（预览/占位）-> key -> src/url
    const localPreview = isInlineDataUrl(asset.localDataUrl) ? asset.localDataUrl : undefined;
    const stableRemoteCandidate =
        normalizedRemote ||
        (isRemoteUrl(normalizedSrc) ? normalizedSrc : undefined) ||
        (isRemoteUrl(normalizedUrl) ? normalizedUrl : undefined);
    const pendingPreview = asset.pendingUpload ? localPreview : undefined;
    const displayCandidate =
        pendingPreview ||
        stableRemoteCandidate ||
        key ||
        normalizedSrc ||
        normalizedUrl ||
        localPreview ||
        asset.url;

    const renderable = toRenderableImageSrc(displayCandidate);
    const preferredSource = renderable ? toPreferredRemoteSource(renderable) : '';
    return { source: preferredSource, remoteUrl, key };
};

const shouldUseAnonymousCrossOrigin = (source: string): boolean => {
    const value = typeof source === 'string' ? source.trim() : '';
    if (!value) return false;
    if (value.startsWith('data:image/') || value.startsWith('blob:')) return false;
    if (value.startsWith('/')) return false; // same-origin paths
    if (!isRemoteUrl(value) || typeof window === 'undefined') return false;
    try {
        const url = new URL(value);
        if (url.hostname === window.location.hostname) return true;
        // OSS / CDN 图片通常支持 CORS，开启 anonymous 以避免污染 canvas
        if (url.hostname.endsWith('.aliyuncs.com')) return true;
    } catch {}
    // 其他外部来源不强制 crossOrigin=anonymous，避免因缺少 CORS 头导致图片加载失败
    return false;
};

const getRasterSourceString = (raster: any): string => {
    try {
        const source = raster?.source;
        if (typeof source === 'string') return source;
        const src = (source as any)?.src;
        if (typeof src === 'string') return src;
    } catch {}
    return '';
};

// 图片加载超时时间，防止占位框长时间悬挂
const IMAGE_LOAD_TIMEOUT = 120000; // 120s
const IMAGE_LOAD_MAX_RETRIES = 3;
const IMAGE_LOAD_RETRY_BASE_DELAY = 800; // ms，指数退避
const MATRIX_CELL_PADDING = 16;
const MAX_LINEAR_SHIFT_STEPS = 50;
const GENERATE_VERTICAL_GAP_MIN = 48;
const GENERATE_VERTICAL_GAP_MAX = 104;
const GENERATE_COLLISION_PADDING = 32;
const GENERATE_GROUP_TITLE_SAFE_SPACE = 56;
const GROUP_HORIZONTAL_GAP_MIN = 16;
const GROUP_HORIZONTAL_GAP_MAX = 48;
const FLOW_NODE_SEND_TOP_GAP = 24;
const resolveMatrixGroupColumns = (groupTotal: number): number => {
    const total = Math.max(1, Math.floor(groupTotal));
    if (total <= 1) return 1;
    return Math.min(4, total);
};
const TOOLBAR_DERIVED_OPERATION_TYPES = new Set([
    'expand-image',
    'background-removal',
    'background-removal-fast',
    'layer-split',
    'text-edit',
    'palette',
]);

type MatrixLayoutContext = {
    groupId?: string;
    groupIndex?: number;
    groupTotal?: number;
    anchorCenter?: { x: number; y: number } | null;
    sourceImageId?: string;
    sourceImages?: string[];
    preferHorizontal?: boolean;
};

type MatrixLayoutState = {
    anchor: { x: number; y: number };
    cellW: number;
    cellH: number;
    cols: number;
    nextIndex: number;
    groupRowShift?: number;
    occupied: Set<number>;
    slotById: Map<string, number>;
};

export const useQuickImageUpload = ({ context, canvasRef, projectId }: UseQuickImageUploadProps) => {
    const { ensureDrawingLayer, zoom } = context;
    const [triggerQuickUpload, setTriggerQuickUpload] = useState(false);

    // 🔥 追踪正在加载中的图片（防止连续生成时位置重叠）
    type PendingImageEntry = {
        id: string;
        operationType?: string;
        expectedWidth: number;
        expectedHeight: number;
        x: number;
        y: number;
        placeholderId?: string;
        videoInfo?: {
            videoUrl: string;
            sourceUrl?: string;
            thumbnailUrl?: string;
            prompt?: string;
            durationSeconds?: number;
            sid?: string;
        };
    };

    const pendingImagesRef = useRef<Array<PendingImageEntry>>([]);
    const predictedPlaceholdersRef = useRef<Map<string, paper.Item>>(new Map());
    const matrixLayoutsRef = useRef<Map<string, MatrixLayoutState>>(new Map());
    const matrixSlotRegistryRef = useRef<Map<string, { contextKey: string; index: number }>>(new Map());
    const lockedMatrixPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());

    // 🔥 收集并行生成的图片 ID，用于 X4/X8 自动打组
    // key: parallelGroupId, value: { total: 期望数量, imageIds: 已加载的图片 ID 列表 }
    const parallelGroupCollectorRef = useRef<Map<string, { total: number; imageIds: string[] }>>(new Map());

    const upsertPendingImage = useCallback((entry: PendingImageEntry) => {
        if (!entry?.id) return;
        const list = pendingImagesRef.current;
        const index = list.findIndex((item) => item.id === entry.id);
        if (index >= 0) {
            list[index] = { ...list[index], ...entry };
        } else {
            list.push(entry);
        }
    }, []);

    const removePendingImage = useCallback((id?: string) => {
        if (!id) return;
        pendingImagesRef.current = pendingImagesRef.current.filter((item) => item.id !== id);
    }, []);

    const removePredictedPlaceholder = useCallback((placeholderId: string | undefined | null) => {
        if (!placeholderId) return;
        const existing = predictedPlaceholdersRef.current.get(placeholderId);
        if (existing) {
            // 清理旋转动画
            const animationId = (existing as any)._spinnerAnimationId;
            if (animationId) {
                cancelAnimationFrame(animationId);
            }
            if (existing.parent) {
                existing.remove();
            }
        }
        predictedPlaceholdersRef.current.delete(placeholderId);
        removePendingImage(placeholderId);
    }, [removePendingImage]);

    // 更新占位符进度
    const updatePlaceholderProgress = useCallback((placeholderId: string, progress: number) => {
        if (!placeholderId) return;
        const existing = predictedPlaceholdersRef.current.get(placeholderId);
        if (!existing || !existing.parent) return;

        const normalizedProgress = Math.max(0, Math.min(100, progress));

        // 查找进度标签并更新 - 使用索引而不是直接引用
        const progressLabelIndex = existing.data?.progressLabelIndex as number | undefined;
        const progressLabel = (progressLabelIndex !== undefined && existing.children)
            ? existing.children[progressLabelIndex] as paper.PointText | undefined
            : undefined;
        if (progressLabel && progressLabel.parent) {
            progressLabel.content = `${normalizedProgress.toFixed(1)}%`;
        }

        paper.view?.update();
    }, []);

    // ========== 智能排版工具函数 ==========
    
    // 获取画布上所有图像的位置信息（包括正在加载中的）
    const getAllCanvasImages = useCallback(() => {
        const images: Array<{
            id: string;
            x: number;
            y: number;
            width: number;
            height: number;
            operationType?: string;
        }> = [];

        try {
            if (!paper.project) return images;

            // 遍历所有图层查找图像
            for (const layer of paper.project.layers) {
                for (const item of layer.children) {
                    // 查找图像组或直接的图像项
                    if (item.data?.type === 'image' ||
                        (item instanceof paper.Group && item.data?.type === 'image')) {

                        let raster: paper.Raster | null = null;
                        let bounds: paper.Rectangle | null = null;

                        if (item instanceof paper.Group) {
                            // 从组中找到Raster对象
                            raster = item.children.find(child => isRaster(child)) as paper.Raster;
                            bounds = raster?.bounds || item.bounds;
                        } else if (isRaster(item)) {
                            raster = item;
                            bounds = item.bounds;
                        }

                        if (bounds && item.data?.imageId) {
                            images.push({
                                id: item.data.imageId,
                                x: bounds.center.x,
                                y: bounds.center.y,
                                width: bounds.width,
                                height: bounds.height,
                                operationType: item.data.operationType
                            });
                        }
                    }
                }
            }

            // 🔥 加入待加载图片的预估信息（防止重叠）
            for (const pending of pendingImagesRef.current) {
                images.push({
                    id: pending.id,
                    x: pending.x,
                    y: pending.y,
                    width: pending.expectedWidth,
                    height: pending.expectedHeight,
                    operationType: pending.operationType
                });
            }
        } catch (error) {
            logger.error('获取画布图像时出错:', error);
        }

        return images;
    }, []);

    // 根据ID查找特定图像
    const findImageById = useCallback((imageId: string) => {
        const images = getAllCanvasImages();
        return images.find(img => img.id === imageId);
    }, [getAllCanvasImages]);

    const buildMatrixContextKey = useCallback((
        operationType: string,
        anchor: paper.Point,
        cellW: number,
        cellH: number,
        layoutContext?: MatrixLayoutContext
    ) => {
        if (layoutContext?.groupId) return `${operationType}:group:${layoutContext.groupId}`;
        if (operationType === 'edit' && layoutContext?.sourceImageId) {
            return `${operationType}:source:${layoutContext.sourceImageId}`;
        }
        if (operationType === 'blend' && Array.isArray(layoutContext?.sourceImages) && layoutContext.sourceImages.length > 0) {
            return `${operationType}:sources:${layoutContext.sourceImages.slice(0, 4).join('|')}`;
        }
        const bucketX = Math.round(anchor.x / Math.max(1, cellW));
        const bucketY = Math.round(anchor.y / Math.max(1, cellH));
        return `${operationType}:anchor:${bucketX}:${bucketY}`;
    }, []);

    const getMatrixPointByIndex = useCallback((layout: MatrixLayoutState, index: number) => {
        const row = Math.floor(index / layout.cols);
        const col = index % layout.cols;
        return new paper.Point(
            layout.anchor.x + (col - (layout.cols - 1) / 2) * layout.cellW,
            layout.anchor.y + row * layout.cellH
        );
    }, []);

    const resolveMatrixPosition = useCallback((params: {
        operationType: string;
        anchor: paper.Point;
        expectedWidth: number;
        expectedHeight: number;
        currentImageId?: string;
        layoutContext?: MatrixLayoutContext;
    }): paper.Point => {
        const spacingH = useUIStore.getState().smartPlacementOffsetHorizontal || 522;
        const spacingV = useUIStore.getState().smartPlacementOffsetVertical || 552;
        const groupTotal = Math.max(1, params.layoutContext?.groupTotal ?? 1);
        const getGenerateStepY = (expectedHeight: number, referenceHeight?: number) => {
            const baseHeight = Math.max(expectedHeight, referenceHeight || 0);
            const dynamicGap = Math.round(baseHeight * 0.14);
            const extraGap = Math.max(
                GENERATE_VERTICAL_GAP_MIN,
                Math.min(GENERATE_VERTICAL_GAP_MAX, dynamicGap)
            );
            return baseHeight + extraGap;
        };
        const getGroupStepX = (expectedWidth: number) => {
            const dynamicGap = Math.round(expectedWidth * 0.08);
            const extraGap = Math.max(
                GROUP_HORIZONTAL_GAP_MIN,
                Math.min(GROUP_HORIZONTAL_GAP_MAX, dynamicGap)
            );
            return expectedWidth + extraGap;
        };
        const useFixedHorizontalStep =
            (params.operationType === 'edit' || params.operationType === 'blend') && groupTotal <= 1;
        const cellW = useFixedHorizontalStep
            ? spacingH
            : (groupTotal > 1
                ? getGroupStepX(params.expectedWidth)
                : Math.max(spacingH, params.expectedWidth + MATRIX_CELL_PADDING));
        const isGenerateGroup = params.operationType === 'generate' && groupTotal > 1;
        const cellH = params.operationType === 'generate'
            ? (getGenerateStepY(params.expectedHeight) + (isGenerateGroup ? GENERATE_GROUP_TITLE_SAFE_SPACE : 0))
            : Math.max(spacingV, params.expectedHeight + MATRIX_CELL_PADDING);
        const cols = groupTotal > 1
            ? resolveMatrixGroupColumns(groupTotal)
            : 1;
        const rawAnchor = params.layoutContext?.anchorCenter
            && Number.isFinite(params.layoutContext.anchorCenter.x)
            && Number.isFinite(params.layoutContext.anchorCenter.y)
            ? new paper.Point(params.layoutContext.anchorCenter.x, params.layoutContext.anchorCenter.y)
            : params.anchor;
        let desiredAnchor = rawAnchor;
        if (isGenerateGroup) {
            const generatedImages = getAllCanvasImages().filter((img) => img.operationType === 'generate');
            if (generatedImages.length > 0) {
                let bottomLeft = generatedImages[0];
                for (const img of generatedImages) {
                    if (img.y > bottomLeft.y || (img.y === bottomLeft.y && img.x < bottomLeft.x)) {
                        bottomLeft = img;
                    }
                }
                const stepY = getGenerateStepY(params.expectedHeight, bottomLeft.height) + GENERATE_GROUP_TITLE_SAFE_SPACE;
                const nextGroupLeftX = bottomLeft.x;
                const nextGroupY = bottomLeft.y + stepY;
                desiredAnchor = new paper.Point(
                    nextGroupLeftX + ((cols - 1) / 2) * cellW,
                    nextGroupY
                );
            } else {
                // 首个并行组以锚点为中心，避免整行只向右展开导致看起来“只出现一张”
                desiredAnchor = new paper.Point(rawAnchor.x, rawAnchor.y);
            }
        }
        const currentId = params.currentImageId;
        const lockPoint = (point: paper.Point) => {
            if (currentId) {
                lockedMatrixPositionRef.current.set(currentId, { x: point.x, y: point.y });
            }
            return point;
        };

        if (currentId) {
            const locked = lockedMatrixPositionRef.current.get(currentId);
            if (locked && Number.isFinite(locked.x) && Number.isFinite(locked.y)) {
                return new paper.Point(locked.x, locked.y);
            }
        }

        if (getAllCanvasImages().length === 0 && pendingImagesRef.current.length === 0) {
            matrixLayoutsRef.current.clear();
            matrixSlotRegistryRef.current.clear();
            lockedMatrixPositionRef.current.clear();
        }

        const doesOverlap = (point: paper.Point, width: number, height: number) => {
            const halfWidth = width / 2;
            const halfHeight = height / 2;
            const left = point.x - halfWidth;
            const right = point.x + halfWidth;
            const top = point.y - halfHeight;
            const bottom = point.y + halfHeight;
            const images = getAllCanvasImages();
            const overlap = images.find((img) => {
                if (currentId && img.id === currentId) return false;
                const imgHalfWidth = img.width / 2;
                const imgHalfHeight = img.height / 2;
                const imgLeft = img.x - imgHalfWidth;
                const imgRight = img.x + imgHalfWidth;
                const imgTop = img.y - imgHalfHeight;
                const imgBottom = img.y + imgHalfHeight;
                return !(right <= imgLeft || left >= imgRight || bottom <= imgTop || top >= imgBottom);
            });
            return !!overlap;
        };

        const generateCollisionHeight = params.operationType === 'generate'
            ? params.expectedHeight + GENERATE_COLLISION_PADDING
            : params.expectedHeight;

        // 单图生成：只向下排版（取当前 generate 中“最下面，若同层取最左”再向下偏移）
        if (params.operationType === 'generate' && groupTotal <= 1) {
            const images = getAllCanvasImages().filter((img) => img.operationType === 'generate');
            let point = desiredAnchor.clone();
            let stepY = getGenerateStepY(params.expectedHeight);
            if (images.length > 0) {
                let bottomLeft = images[0];
                for (const img of images) {
                    if (img.y > bottomLeft.y || (img.y === bottomLeft.y && img.x < bottomLeft.x)) {
                        bottomLeft = img;
                    }
                }
                stepY = getGenerateStepY(params.expectedHeight, bottomLeft.height);
                point = new paper.Point(bottomLeft.x, bottomLeft.y + stepY);
            }
            let steps = 0;
            while (doesOverlap(point, params.expectedWidth, generateCollisionHeight) && steps < MAX_LINEAR_SHIFT_STEPS) {
                point = point.add(new paper.Point(0, stepY));
                steps += 1;
            }
            return lockPoint(point);
        }

        // 单图编辑：只向右排版（从 source 右侧开始，冲突继续向右顺延）
        if (params.operationType === 'edit' && groupTotal <= 1) {
            const source = params.layoutContext?.sourceImageId ? findImageById(params.layoutContext.sourceImageId) : null;
            let point = source ? new paper.Point(source.x + cellW, source.y) : desiredAnchor.clone();
            let steps = 0;
            while (doesOverlap(point, params.expectedWidth, params.expectedHeight) && steps < MAX_LINEAR_SHIFT_STEPS) {
                point = point.add(new paper.Point(cellW, 0));
                steps += 1;
            }
            return lockPoint(point);
        }

        // 单图融合：沿 source 列表第一张图向右排版
        if (params.operationType === 'blend' && groupTotal <= 1) {
            const sourceId = params.layoutContext?.sourceImages?.[0];
            const source = sourceId ? findImageById(sourceId) : null;
            let point = source ? new paper.Point(source.x + cellW, source.y) : desiredAnchor.clone();
            let steps = 0;
            while (doesOverlap(point, params.expectedWidth, params.expectedHeight) && steps < MAX_LINEAR_SHIFT_STEPS) {
                point = point.add(new paper.Point(cellW, 0));
                steps += 1;
            }
            return lockPoint(point);
        }

        const contextKey = buildMatrixContextKey(
            params.operationType || 'manual',
            desiredAnchor,
            cellW,
            cellH,
            params.layoutContext
        );

        let layout = matrixLayoutsRef.current.get(contextKey);
        if (!layout) {
            layout = {
                anchor: { x: desiredAnchor.x, y: desiredAnchor.y },
                cellW,
                cellH,
                cols,
                nextIndex: 0,
                groupRowShift: undefined,
                occupied: new Set<number>(),
                slotById: new Map<string, number>(),
            };
            matrixLayoutsRef.current.set(contextKey, layout);
        } else {
            layout.cellW = Math.max(layout.cellW, cellW);
            layout.cellH = Math.max(layout.cellH, cellH);
            layout.cols = cols;
        }

        if (currentId) {
            const globalSlot = matrixSlotRegistryRef.current.get(currentId);
            if (globalSlot) {
                const lockedLayout = matrixLayoutsRef.current.get(globalSlot.contextKey);
                if (lockedLayout) {
                    lockedLayout.occupied.add(globalSlot.index);
                    lockedLayout.slotById.set(currentId, globalSlot.index);
                    return lockPoint(getMatrixPointByIndex(lockedLayout, globalSlot.index));
                }
            }
        }

        let index: number;
        if (currentId && layout.slotById.has(currentId)) {
            index = layout.slotById.get(currentId)!;
        } else if (groupTotal > 1 && Number.isFinite(params.layoutContext?.groupIndex)) {
            // 并行组按“整组”与现有图片避让：先求可用行偏移，再给各成员统一套用
            if (typeof layout.groupRowShift !== 'number') {
                let shift = 0;
                while (shift < MAX_LINEAR_SHIFT_STEPS) {
                    let hasCollision = false;
                    for (let i = 0; i < groupTotal; i += 1) {
                        const idx = i + shift * layout.cols;
                        const point = getMatrixPointByIndex(layout, idx);
                        if (doesOverlap(point, params.expectedWidth, generateCollisionHeight)) {
                            hasCollision = true;
                            break;
                        }
                    }
                    if (!hasCollision) break;
                    shift += 1;
                }
                layout.groupRowShift = shift;
            }
            const baseIndex = Math.max(0, params.layoutContext?.groupIndex ?? 0);
            index = baseIndex + (layout.groupRowShift || 0) * layout.cols;
        } else {
            index = layout.nextIndex;
        }

        while (layout.occupied.has(index)) {
            index += 1;
        }

        layout.occupied.add(index);
        layout.nextIndex = Math.max(layout.nextIndex, index + 1);
        if (currentId) {
            layout.slotById.set(currentId, index);
            matrixSlotRegistryRef.current.set(currentId, { contextKey, index });
        }

        return lockPoint(getMatrixPointByIndex(layout, index));
    }, [buildMatrixContextKey, findImageById, getAllCanvasImages, getMatrixPointByIndex]);

    // 计算智能排版位置
    const calculateSmartPosition = useCallback((
        operationType: string,
        sourceImageId?: string,
        sourceImages?: string[],
        currentImageId?: string,
        layoutContext?: {
            groupId?: string;
            groupIndex?: number;
            groupTotal?: number;
            anchorCenter?: { x: number; y: number } | null;
            preferHorizontal?: boolean;
        }
    ) => {
        const getSpacingHorizontal = () => useUIStore.getState().smartPlacementOffsetHorizontal || 522;
        const getSpacingVertical = () => useUIStore.getState().smartPlacementOffsetVertical || 552;
        switch (operationType) {
            case 'generate': {
                const spacingH = getSpacingHorizontal();
                const spacingV = getSpacingVertical();
                const viewCenter = paper.view?.center ?? new paper.Point(0, 0);

                // 🔍 [DEBUG-calculateSmartPosition] 打印基础参数
                console.log(`📐 [DEBUG-calculateSmartPosition-generate] 开始计算位置`, {
                    currentImageId: currentImageId?.substring(0, 30),
                    spacingH,
                    spacingV,
                    viewCenter: { x: viewCenter.x.toFixed(1), y: viewCenter.y.toFixed(1) },
                    layoutContext: layoutContext ? {
                        groupId: layoutContext.groupId?.substring(0, 20),
                        groupIndex: layoutContext.groupIndex,
                        groupTotal: layoutContext.groupTotal,
                        anchorCenter: layoutContext.anchorCenter
                    } : null
                });

                // 如果已有同名占位符，直接复用其位置，避免重复计算导致跳动
                if (currentImageId && currentImageId.startsWith('ai-placeholder-')) {
                    const placeholder = predictedPlaceholdersRef.current.get(currentImageId);
                    if (placeholder && placeholder.data?.bounds) {
                        const bounds = placeholder.data.bounds;
                        const result = {
                            x: bounds.x + bounds.width / 2,
                            y: bounds.y + bounds.height / 2
                        };
                        console.log(`📐 [DEBUG-calculateSmartPosition] 复用已有占位符位置`, {
                            placeholderId: currentImageId.substring(0, 30),
                            result
                        });
                        return result;
                    }
                }

                const groupId = layoutContext?.groupId;
                const groupIndex = Math.max(0, layoutContext?.groupIndex ?? 0);
                const groupTotal = Math.max(1, layoutContext?.groupTotal ?? 1);
                const anchor = layoutContext?.anchorCenter
                    && Number.isFinite(layoutContext.anchorCenter.x)
                    && Number.isFinite(layoutContext.anchorCenter.y)
                    ? { x: layoutContext.anchorCenter.x, y: layoutContext.anchorCenter.y }
                    : { x: viewCenter.x, y: viewCenter.y };

                // 单图生成：直接使用上游给定锚点（通常是缓存图右侧/视口中心），避免全局行号累积导致越排越远。
                if (groupTotal <= 1) {
                    return anchor;
                }

                // 并行生成：不在这里做横向/网格预排版，统一交给 resolveMatrixPosition
                console.log(`📐 [DEBUG-calculateSmartPosition-generate-group] 使用组锚点，矩阵阶段再做纵向排版`, {
                    groupId: groupId?.substring(0, 20),
                    groupIndex,
                    groupTotal,
                    anchor: { x: anchor.x.toFixed(1), y: anchor.y.toFixed(1) }
                });
                return anchor;
            }

            case 'edit': {
                const spacingH = getSpacingHorizontal();
                const spacingV = getSpacingVertical();
                const groupTotal = Math.max(1, layoutContext?.groupTotal ?? 1);
                const groupIndex = Math.max(0, layoutContext?.groupIndex ?? 0);
                const columns = groupTotal > 1 ? resolveMatrixGroupColumns(groupTotal) : 1;

                // 并行编辑：按行列排布，锚点优先用传入 anchor，其次源图中心，最后视口中心
                if (groupTotal > 1) {
                    const sourceImage = sourceImageId ? findImageById(sourceImageId) : null;
                    const anchor = layoutContext?.anchorCenter
                        || (sourceImage ? { x: sourceImage.x, y: sourceImage.y } : null)
                        || (paper.view?.center ? { x: paper.view.center.x, y: paper.view.center.y } : { x: 0, y: 0 });

                    const rowIndex = Math.floor(groupIndex / columns);
                    const colIndex = groupIndex % columns;

                    return {
                        x: anchor.x + (colIndex - (columns - 1) / 2) * spacingH,
                        y: anchor.y + rowIndex * spacingV
                    };
                }

                // 单张编辑：沿用原逻辑向右偏移源图
                if (sourceImageId) {
                    const sourceImage = findImageById(sourceImageId);
                    if (sourceImage) {
                        const position = { x: sourceImage.x + spacingH, y: sourceImage.y };
                        return position;
                    }
                }
                // 没有找到源图，默认向右偏移
                const editPosition = { x: spacingH, y: 0 };
                return editPosition;
            }

            case 'blend': {
                // 融合图：基于第一张源图向右偏移
                const spacingH = getSpacingHorizontal();
                if (sourceImages && sourceImages.length > 0) {
                    const firstSourceImage = findImageById(sourceImages[0]);
                    if (firstSourceImage) {
                        const position = { x: firstSourceImage.x + spacingH, y: firstSourceImage.y };
                        return position;
                    }
                }
                // 没有找到源图，默认向右偏移
                const blendPosition = { x: spacingH, y: 0 };
                return blendPosition;
            }

            default:
                // 默认位置
                const defaultPosition = { x: 0, y: 0 };
                return defaultPosition;
        }
    }, [findImageById]);

    const showPredictedPlaceholder = useCallback((params: {
        placeholderId: string;
        center?: { x: number; y: number } | null;
        width: number;
        height: number;
        operationType?: string;
        retries?: number;
        preferSmartLayout?: boolean;
        smartPosition?: { x: number; y: number };
        sourceImageId?: string;
        sourceImages?: string[];
        groupId?: string;
        groupIndex?: number;
        groupTotal?: number;
        preferHorizontal?: boolean;
        groupAnchor?: { x: number; y: number } | null;
    }) => {
        if (!params?.placeholderId) return;

        if (!paper.project || !paper.view) {
            const retries = typeof params.retries === 'number' ? params.retries : 4;
            if (retries > 0) {
                setTimeout(() => showPredictedPlaceholder({ ...params, retries: retries - 1 }), 180);
            }
            return;
        }

        ensureDrawingLayer();

        const minSize = 48;
        const width = Math.max(params.width || 0, minSize);
        const height = Math.max(params.height || 0, minSize);
        const preferHorizontal = params.preferHorizontal || (params.groupTotal ?? 1) > 1;
        const layoutContext = {
            groupId: params.groupId,
            groupIndex: params.groupIndex,
            groupTotal: params.groupTotal,
            anchorCenter: params.groupAnchor ?? params.center ?? params.smartPosition ?? null,
            sourceImageId: params.sourceImageId,
            sourceImages: params.sourceImages,
            preferHorizontal
        };

        const resolveCenter = (): { x: number; y: number } | null => {
            let base = params.center ?? params.smartPosition ?? null;

            if (
                (!base || !Number.isFinite(base.x) || !Number.isFinite(base.y)) &&
                typeof calculateSmartPosition === 'function'
            ) {
                const smart = calculateSmartPosition(
                    params.operationType || 'generate',
                    params.sourceImageId,
                    params.sourceImages,
                    params.placeholderId,
                    layoutContext
                );
                if (smart && Number.isFinite(smart.x) && Number.isFinite(smart.y)) {
                    base = { x: smart.x, y: smart.y };
                }
            }

            if (!base && paper.view?.center) {
                base = { x: paper.view.center.x, y: paper.view.center.y };
            }

            return base;
        };

        const baseCenter = resolveCenter();
        if (!baseCenter) {
            logger.upload('[QuickUpload] 占位符缺少中心点');
            return;
        }

        // 清理旧的同ID占位符
        removePredictedPlaceholder(params.placeholderId);

        const desiredPoint = new paper.Point(baseCenter.x, baseCenter.y);
        let centerPoint = desiredPoint;

        try {
            centerPoint = resolveMatrixPosition({
                operationType: params.operationType || 'generate',
                anchor: desiredPoint,
                expectedWidth: width,
                expectedHeight: height,
                currentImageId: params.placeholderId,
                layoutContext,
            });
        } catch (e) {
            logger.upload('[QuickUpload] 占位符矩阵定位失败，使用原始位置', e);
        }

        const halfW = width / 2;
        const halfH = height / 2;
        const cornerRadius = Math.min(width, height) * 0.02;

        const bg = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.subtract([halfW, halfH]),
                new paper.Size(width, height)
            ),
            radius: cornerRadius,
            fillColor: new paper.Color(0.58, 0.64, 0.72, 0.25)
        });

        const border = new paper.Path.Rectangle({
            rectangle: new paper.Rectangle(
                centerPoint.subtract([halfW, halfH]),
                new paper.Size(width, height)
            ),
            radius: cornerRadius,
            strokeColor: new paper.Color(0.39, 0.45, 0.55, 0.4),
            strokeWidth: 1,
            dashArray: [6, 4],
            fillColor: null as any
        });

        const progressLabel = new paper.PointText({
            point: centerPoint,
            content: '0%',
            justification: 'center',
            fillColor: new paper.Color('#6b7280'),
            fontSize: Math.max(18, Math.min(28, width * 0.1)),
            fontWeight: '600',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        });

        const group = new paper.Group([bg, border, progressLabel]);
        group.position = centerPoint;
        group.locked = true; // 占位框仅作为指示元素，不允许用户直接选择/拖拽
        group.data = {
            type: 'image-placeholder',
            placeholderId: params.placeholderId,
            bounds: {
                x: centerPoint.x - halfW,
                y: centerPoint.y - halfH,
                width,
                height
            },
            isHelper: true,
            placeholderSource: 'ai-predict',
            operationType: params.operationType,
            progressLabelIndex: 2
        };

        // 标记所有占位元素为辅助，防止被选择/拖拽
        const attachPlaceholderMeta = (item: paper.Item | null | undefined) => {
            if (!item) return;
            item.data = {
                ...(item.data || {}),
                // 🔥 不再存储对 group 的引用，避免循环引用
                // placeholderGroup: group,
                placeholderGroupId: params.placeholderId, // 使用 ID 而不是引用
                placeholderType: 'image',
                placeholderId: params.placeholderId,
                isHelper: true
            };
            item.locked = true;
        };
        group.children?.forEach((child: paper.Item) => attachPlaceholderMeta(child));
        attachPlaceholderMeta(group);

        predictedPlaceholdersRef.current.set(params.placeholderId, group);
        upsertPendingImage({
            id: params.placeholderId,
            expectedWidth: width,
            expectedHeight: height,
            x: centerPoint.x,
            y: centerPoint.y,
            operationType: params.operationType,
            placeholderId: params.placeholderId
        });

        paper.view.update();

        // 🎯 自动将视角平移到占位框位置，确保用户能看到正在生成的图片
        try {
            const viewBounds = paper.view.bounds;
            const placeholderBounds = new paper.Rectangle(
                centerPoint.x - halfW,
                centerPoint.y - halfH,
                width,
                height
            );

            // 检查占位框是否在当前视口内
            const isInView = viewBounds && viewBounds.intersects(placeholderBounds);

            // AI 自动排版不自动抢焦点，避免体感“图片突然飞很远”。
            const shouldAutoFocus = !params.operationType || params.operationType === 'manual';
            if (!isInView && shouldAutoFocus) {
                // 占位框不在视口内，自动平移视角到占位框中心
                const { zoom: currentZoom, setPan } = useCanvasStore.getState();
                const viewSize = paper.view.viewSize;
                const screenCenterX = viewSize.width / 2;
                const screenCenterY = viewSize.height / 2;

                // 计算需要的平移量，使占位框中心位于屏幕中心
                const desiredPanX = (screenCenterX / currentZoom) - centerPoint.x;
                const desiredPanY = (screenCenterY / currentZoom) - centerPoint.y;

                setPan(desiredPanX, desiredPanY);
                logger.debug(`🎯 自动聚焦视角到占位框: (${centerPoint.x.toFixed(1)}, ${centerPoint.y.toFixed(1)})`);
            }
        } catch (e) {
            // 忽略自动聚焦错误，不影响主流程
            logger.debug('自动聚焦视角失败:', e);
        }
    }, [calculateSmartPosition, ensureDrawingLayer, removePredictedPlaceholder, resolveMatrixPosition, upsertPendingImage]);

    // ========== 查找画布中的图片占位框 ==========
    const findImagePlaceholder = useCallback((placeholderId?: string) => {
        try {
            if (placeholderId) {
                const existing = predictedPlaceholdersRef.current.get(placeholderId);
                if (existing) {
                    logger.upload(`✅ [findImagePlaceholder] 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`);
                    return existing;
                }
            }

            if (!paper.project) {
                logger.upload(`⚠️ [findImagePlaceholder] Paper.js 项目未初始化，placeholderId: ${placeholderId}`);
                return null;
            }

            // 遍历所有图层查找占位框
            for (const layer of paper.project.layers) {
                for (const item of layer.children) {
                    if (item.data?.type === 'image-placeholder' && item.data?.bounds) {
                        if (!placeholderId || item.data?.placeholderId === placeholderId) {
                            logger.upload(`✅ [findImagePlaceholder] 从图层中找到占位符: ${placeholderId || 'any'}`);
                            return item;
                        }
                    }
                }
            }
            
            if (placeholderId) {
                logger.upload(`⚠️ [findImagePlaceholder] 未找到占位符: ${placeholderId}，当前占位符数量: ${predictedPlaceholdersRef.current.size}`);
            }
            return null;
        } catch (error) {
            logger.error('查找占位框时出错:', error);
            return null;
        }
    }, []);

    // 处理快速图片上传 - 支持智能位置排版
    const handleQuickImageUploaded = useCallback(async (
        imagePayload: string | StoredImageAsset,
        fileName?: string,
        selectedImageBounds?: any,
        smartPosition?: { x: number; y: number },
        operationType?: string,
        sourceImageId?: string,
        sourceImages?: string[],
        extraOptions?: {
            videoInfo?: PendingImageEntry['videoInfo'];
            placeholderId?: string;
            forceAnchorPosition?: boolean;
            preferHorizontal?: boolean;  // 🔥 新增：是否优先横向排列
            // 🔥 并行生成分组信息，用于 X4/X8 自动打组
            parallelGroupId?: string;
            parallelGroupIndex?: number;
            parallelGroupTotal?: number;
        }
    ) => {
        if (!imagePayload) {
            logger.error('快速上传未收到图片数据');
            if (extraOptions?.placeholderId) {
                removePredictedPlaceholder(extraOptions.placeholderId);
            }
            return;
        }

        let asset: StoredImageAsset | null = null;
        const uploadDir = projectId ? `projects/${projectId}/images/` : 'uploads/images/';
        const ensureManagedAsset = async (
            uploadInput: string,
            preferredFileName: string,
            preferredIdPrefix: string,
        ): Promise<StoredImageAsset | null> => {
            const inlinePreview = isInlineDataUrl(uploadInput) ? uploadInput : undefined;
            const uploadResult = await imageUploadService.uploadImageSource(uploadInput, {
                projectId: projectId ?? undefined,
                dir: uploadDir,
                fileName: preferredFileName || `quick-image-${Date.now()}.png`,
            });
            if (!uploadResult.success || !uploadResult.asset) {
                if (inlinePreview) {
                    return {
                        id: `${preferredIdPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        url: inlinePreview,
                        src: inlinePreview,
                        remoteUrl: undefined,
                        key: undefined,
                        fileName: preferredFileName,
                        pendingUpload: true,
                        localDataUrl: inlinePreview,
                    };
                }
                return null;
            }
            const uploadedUrl = normalizePersistableImageRef(uploadResult.asset.url);
            const uploadedKey = normalizePersistableImageRef(uploadResult.asset.key);
            const persistedRef = uploadedUrl || uploadedKey;
            if (!persistedRef || !isPersistableImageRef(persistedRef)) {
                if (inlinePreview) {
                    return {
                        id: `${preferredIdPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        url: inlinePreview,
                        src: inlinePreview,
                        remoteUrl: undefined,
                        key: undefined,
                        fileName: preferredFileName,
                        pendingUpload: true,
                        localDataUrl: inlinePreview,
                    };
                }
                return null;
            }
            const displayRef = uploadedUrl || persistedRef;
            const remoteUrl = isRemoteUrl(displayRef) ? displayRef : undefined;
            return {
                id: `${preferredIdPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                url: displayRef,
                src: toRenderableImageSrc(displayRef) || displayRef,
                remoteUrl,
                key: uploadedKey || uploadResult.asset.key,
                fileName: uploadResult.asset.fileName || preferredFileName,
                width: uploadResult.asset.width,
                height: uploadResult.asset.height,
                contentType: uploadResult.asset.contentType,
                pendingUpload: false,
                localDataUrl: undefined,
            };
        };
        if (typeof imagePayload === 'string') {
            const trimmedPayload = imagePayload.trim();
            const resolvedName = fileName || 'uploaded-image.png';
            const normalizedPersisted = normalizePersistableImageRef(trimmedPayload);
            const isPersisted = !!normalizedPersisted && isPersistableImageRef(normalizedPersisted);
            const shouldUploadManaged =
                !isPersisted || requiresManagedImageUpload(normalizedPersisted);
            if (shouldUploadManaged) {
                asset = await ensureManagedAsset(trimmedPayload, resolvedName, 'oss_img');
            } else {
                asset = {
                    id: `remote_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    url: normalizedPersisted,
                    key: isAssetKeyRef(normalizedPersisted) ? normalizedPersisted : undefined,
                    src: toRenderableImageSrc(normalizedPersisted) || normalizedPersisted,
                    remoteUrl: isRemoteUrl(normalizedPersisted) ? normalizedPersisted : undefined,
                    fileName: resolvedName,
                    pendingUpload: false,
                    localDataUrl: undefined,
                };
            }
            fileName = resolvedName;
        } else {
            const inlineSource =
                isInlineDataUrl(imagePayload.localDataUrl)
                    ? imagePayload.localDataUrl
                    : isInlineDataUrl(imagePayload.src)
                        ? imagePayload.src
                        : undefined;
            const normalizedRemote = normalizePersistableImageRef(imagePayload.remoteUrl);
            const normalizedKey = normalizePersistableImageRef(imagePayload.key);
            const normalizedUrl = normalizePersistableImageRef(imagePayload.url);
            const normalizedSrc = normalizePersistableImageRef(imagePayload.src);
            const persistableCandidate =
                normalizedRemote ||
                (isAssetKeyRef(normalizedKey) ? normalizedKey : '') ||
                normalizedUrl ||
                normalizedSrc;
            const shouldUploadManaged =
                !persistableCandidate || requiresManagedImageUpload(persistableCandidate);
            if (shouldUploadManaged) {
                const uploadInput =
                    inlineSource ||
                    imagePayload.localDataUrl ||
                    imagePayload.src ||
                    imagePayload.url ||
                    imagePayload.remoteUrl ||
                    '';
                if (uploadInput) {
                    asset = await ensureManagedAsset(
                        uploadInput,
                        imagePayload.fileName || fileName || 'uploaded-image.png',
                        imagePayload.id || 'oss_img',
                    );
                    if (asset) {
                        asset.id = imagePayload.id || asset.id;
                    }
                }
            } else {
                const stableRef = persistableCandidate;
                const pendingUpload = !!imagePayload.pendingUpload;
                const localPreview = isInlineDataUrl(imagePayload.localDataUrl)
                    ? imagePayload.localDataUrl
                    : undefined;
                asset = {
                    ...imagePayload,
                    url: stableRef,
                    src: (pendingUpload && localPreview)
                        ? localPreview
                        : (toRenderableImageSrc(stableRef) || stableRef),
                    remoteUrl: isRemoteUrl(stableRef) ? stableRef : imagePayload.remoteUrl,
                    pendingUpload,
                    localDataUrl: localPreview,
                };
            }
            fileName = asset?.fileName || fileName;
        }

        if (!asset || !asset.url) {
            logger.error('快速上传未获取到有效图片资源');
            if (extraOptions?.placeholderId) {
                removePredictedPlaceholder(extraOptions.placeholderId);
            }
            return;
        }

        const pickedSource = pickRasterSource(asset);
        let rasterSource = pickedSource.source;
        if (!rasterSource) {
            logger.error('快速上传缺少可渲染图片来源（blob 已禁用）');
            if (extraOptions?.placeholderId) {
                removePredictedPlaceholder(extraOptions.placeholderId);
            }
            return;
        }
        const resolvedRemoteUrl = pickedSource.remoteUrl;
        const resolvedKey = pickedSource.key;
        let resolveRasterReady: (() => void) | undefined;
        let rejectRasterReady: ((reason?: unknown) => void) | undefined;
        let rasterSettled = false;
        const rasterReady = new Promise<void>((resolve, reject) => {
            resolveRasterReady = () => {
                if (rasterSettled) return;
                rasterSettled = true;
                resolve();
            };
            rejectRasterReady = (reason?: unknown) => {
                if (rasterSettled) return;
                rasterSettled = true;
                if (reason !== undefined) reject(reason);
                else reject(new Error('quick-image-raster-failed'));
            };
        });

        try {
            ensureDrawingLayer();

            const placeholderId = extraOptions?.placeholderId;
            let placeholder = findImagePlaceholder(placeholderId);
            // 🔥 如果第一次查找失败，尝试从 predictedPlaceholdersRef 直接获取
            if (!placeholder && placeholderId) {
                const placeholderFromRef = predictedPlaceholdersRef.current.get(placeholderId);
                if (placeholderFromRef) {
                    placeholder = placeholderFromRef;
                    logger.upload(`🎯 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`);
                }
            }
            const placeholderBounds = placeholder?.data?.bounds;
            const imageId = placeholderId || asset.id || `quick_image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const defaultExpectedSize = 512;
            const expectedWidth = placeholderBounds?.width ?? defaultExpectedSize;
            const expectedHeight = placeholderBounds?.height ?? defaultExpectedSize;
            const pendingOperationType = operationType || 'manual';
            const preferHorizontal = extraOptions?.preferHorizontal ?? false;  // 🔥 获取横向排列偏好
            // 🔥 获取并行生成分组信息
            const parallelGroupId = extraOptions?.parallelGroupId;
            const parallelGroupIndex = extraOptions?.parallelGroupIndex;
            const parallelGroupTotal = extraOptions?.parallelGroupTotal;
            let targetPosition: paper.Point;
            let pendingEntry: PendingImageEntry | null = null;
            let forcedTopAnchorPoint: paper.Point | null = null;

            const registerPending = (initialPoint: paper.Point | null) => {
                const entry: PendingImageEntry = {
                    id: imageId,
                    operationType: pendingOperationType,
                    expectedWidth,
                    expectedHeight,
                    x: initialPoint?.x ?? 0,
                    y: initialPoint?.y ?? 0,
                    videoInfo: extraOptions?.videoInfo,
                    placeholderId
                };
                
                // 🔍 [DEBUG-问题4] 注册前打印 pendingImagesRef 状态
                console.log(`📝 [DEBUG-问题4-registerPending] 注册待加载图片: ${imageId.substring(0, 30)}`, {
                    注册前pendingImages数量: pendingImagesRef.current.length,
                    当前pending列表: pendingImagesRef.current.map(p => ({
                        id: p.id.substring(0, 25),
                        x: p.x.toFixed(1),
                        y: p.y.toFixed(1)
                    })),
                    新增entry: {
                        x: entry.x.toFixed(1),
                        y: entry.y.toFixed(1),
                        w: entry.expectedWidth,
                        h: entry.expectedHeight
                    }
                });
                
                upsertPendingImage(entry);
                return entry;
            };

            const placeholderCenter = placeholderBounds
                ? new paper.Point(
                    placeholderBounds.x + placeholderBounds.width / 2,
                    placeholderBounds.y + placeholderBounds.height / 2
                  )
                : null;

            const baseWidth = expectedWidth;
            const baseHeight = expectedHeight;
            const resolveTargetPosition = (anchor: paper.Point, op: string) => resolveMatrixPosition({
                operationType: op || 'manual',
                anchor,
                expectedWidth: baseWidth,
                expectedHeight: baseHeight,
                currentImageId: imageId,
                layoutContext: {
                    groupId: parallelGroupId,
                    groupIndex: parallelGroupIndex,
                    groupTotal: parallelGroupTotal,
                    anchorCenter: { x: anchor.x, y: anchor.y },
                    sourceImageId,
                    sourceImages,
                    preferHorizontal,
                },
            });

            // 🔍 [DEBUG-问题3] 打印位置计算分支
            console.log(`🎯 [DEBUG-问题3-位置分支] imageId: ${imageId.substring(0, 30)}`, {
                hasSmartPosition: !!smartPosition,
                hasPlaceholderCenter: !!placeholderCenter,
                hasOperationType: !!operationType,
                placeholderId,
                smartPosition: smartPosition ? { x: smartPosition.x.toFixed(1), y: smartPosition.y.toFixed(1) } : null,
                placeholderCenter: placeholderCenter ? { x: placeholderCenter.x.toFixed(1), y: placeholderCenter.y.toFixed(1) } : null,
                placeholderBounds: placeholderBounds ? {
                    x: placeholderBounds.x.toFixed(1),
                    y: placeholderBounds.y.toFixed(1),
                    w: placeholderBounds.width.toFixed(0),
                    h: placeholderBounds.height.toFixed(0)
                } : null
            });

            if (smartPosition) {
                const desiredPoint = new paper.Point(smartPosition.x, smartPosition.y);
                const shouldForceAnchorPosition =
                    Boolean(extraOptions?.forceAnchorPosition) && (parallelGroupTotal ?? 1) <= 1;
                let anchorCenterForPlacement = desiredPoint;
                if (shouldForceAnchorPosition) {
                    // forceAnchorPosition 语义：smartPosition 表示“顶部锚点”，不是图片中心点。
                    forcedTopAnchorPoint = desiredPoint.clone();
                    anchorCenterForPlacement = desiredPoint.add(
                        new paper.Point(0, expectedHeight / 2 + FLOW_NODE_SEND_TOP_GAP)
                    );
                }
                pendingEntry = registerPending(anchorCenterForPlacement);
                const adjustedPoint = shouldForceAnchorPosition
                    ? anchorCenterForPlacement
                    : resolveTargetPosition(desiredPoint, pendingOperationType);
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                }
                if (shouldForceAnchorPosition) {
                    logger.upload(`📍 快速上传：固定锚点位置 (${adjustedPoint.x}, ${adjustedPoint.y})`);
                } else if (!desiredPoint.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：智能位置冲突，已调整至 (${adjustedPoint.x}, ${adjustedPoint.y})`);
                } else {
                    logger.upload(`📍 快速上传：使用智能位置 (${adjustedPoint.x}, ${adjustedPoint.y})`);
                }
            } else if (placeholderCenter) {
                pendingEntry = registerPending(placeholderCenter);
                targetPosition = resolveTargetPosition(placeholderCenter, pendingOperationType);
                if (pendingEntry) {
                    pendingEntry.x = targetPosition.x;
                    pendingEntry.y = targetPosition.y;
                }
                logger.upload(`📍 快速上传：使用占位符矩阵位置 (${targetPosition.x.toFixed(1)}, ${targetPosition.y.toFixed(1)})`);
            } else if (operationType) {
                pendingEntry = registerPending(null);
                const calculated = calculateSmartPosition(operationType, sourceImageId, sourceImages, imageId);
                const desiredPoint = new paper.Point(calculated.x, calculated.y);
                if (pendingEntry) {
                    pendingEntry.x = desiredPoint.x;
                    pendingEntry.y = desiredPoint.y;
                }
                const adjustedPoint = resolveTargetPosition(desiredPoint, operationType);
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                }
                if (!desiredPoint.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：智能计算位置 (${desiredPoint.x}, ${desiredPoint.y}) → 调整为 (${adjustedPoint.x}, ${adjustedPoint.y}) 操作类型: ${operationType}`);
                } else {
                    logger.upload(`📍 快速上传：计算智能位置 (${adjustedPoint.x}, ${adjustedPoint.y}) 操作类型: ${operationType}`);
                }
            } else {
                const centerSource = paper.view && (paper.view as any).center
                    ? (paper.view as any).center
                    : new paper.Point(0, 0);
                const centerPoint = new paper.Point(centerSource.x, centerSource.y);
                pendingEntry = registerPending(centerPoint);
                const adjustedPoint = resolveTargetPosition(centerPoint, 'manual');
                targetPosition = adjustedPoint;
                if (pendingEntry) {
                    pendingEntry.x = adjustedPoint.x;
                    pendingEntry.y = adjustedPoint.y;
                    pendingEntry.operationType = 'manual';
                }
                if (!centerPoint.equals(adjustedPoint)) {
                    logger.upload(`📍 快速上传：视口中心冲突，已调整至 (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                } else {
                    logger.upload(`📍 快速上传：默认使用视口中心 (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                }
            }

            // 创建加载指示器（转圈动画）
            const loadingIndicatorSize = 48;
            const loadingGroup = new paper.Group();
            loadingGroup.position = targetPosition;
            loadingGroup.data = { type: 'loading-indicator', imageId };

            // 创建背景圆形
            const bgCircle = new paper.Path.Circle({
                center: new paper.Point(0, 0),
                radius: loadingIndicatorSize / 2,
                fillColor: new paper.Color(1, 1, 1, 0.9),
                strokeColor: new paper.Color(0.9, 0.9, 0.9),
                strokeWidth: 1
            });
            loadingGroup.addChild(bgCircle);

            // 创建旋转的弧形（loading spinner）
            const arcRadius = loadingIndicatorSize / 2 - 8;
            const loadingArc = new paper.Path.Arc({
                from: new paper.Point(0, -arcRadius),
                through: new paper.Point(arcRadius, 0),
                to: new paper.Point(0, arcRadius),
                strokeColor: new paper.Color('#3b82f6'),
                strokeWidth: 3,
                strokeCap: 'round'
            });
            loadingGroup.addChild(loadingArc);

            // 添加到画布
            paper.project.activeLayer.addChild(loadingGroup);
            paper.view.update();

            // 启动旋转动画
            let rotationAngle = 0;
            let animationFrameId: number | null = null;
            const animateLoading = () => {
                if (loadingGroup && loadingGroup.parent) {
                    rotationAngle += 6;
                    loadingArc.rotate(6, new paper.Point(0, 0));
                    paper.view.update();
                    animationFrameId = requestAnimationFrame(animateLoading);
                }
            };
            animationFrameId = requestAnimationFrame(animateLoading);

            // 移除加载指示器的函数
            const removeLoadingIndicator = () => {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                if (loadingGroup && loadingGroup.parent) {
                    loadingGroup.remove();
                    paper.view.update();
                }
            };

            // 🔥 创建图片加载函数，支持 CORS 失败后重试
	            const loadRasterWithFallback = (useCrossOrigin: boolean) => {
	                const raster = new paper.Raster();
                try {
                    if (useCrossOrigin && shouldUseAnonymousCrossOrigin(rasterSource)) {
                        (raster as any).crossOrigin = 'anonymous';
                    }
                } catch {}
                raster.position = targetPosition;
                if (resolvedRemoteUrl || resolvedKey) {
                    raster.data = {
                        ...(raster.data || {}),
                        ...(resolvedRemoteUrl ? { remoteUrl: resolvedRemoteUrl } : null),
                        ...(resolvedKey ? { key: resolvedKey } : null),
                    };
                }

	                return raster;
	            };

	            const setRasterSource = (target: paper.Raster, source: string) => {
	                const value = typeof source === 'string' ? source.trim() : '';
	                if (!value) return;
	                try { (target as any).__tanvaSourceRef = value; } catch {}
	                // Paper.js 对 string source 的内部 loader 在部分环境对 blob:/data: 偶发不稳定；
	                // 这里对 inline source 用 HTMLImageElement 显式加载，提升兼容性。
	                const renderable = toRenderableImageSrc(value);
	                if (!renderable) return;
	                if (renderable.startsWith('data:image/')) {
	                    try {
	                        const img = new Image();
	                        img.src = renderable;
	                        (target as any).setImage(img);
	                        return;
	                    } catch {}
	                }
	                target.source = renderable;
	            };

	            // 创建图片的 Raster 对象
	            let raster = loadRasterWithFallback(true);
	            let hasRetriedCrossOrigin = false;
	            let hasRetriedProxyFallback = false;
	            let loadTimeoutId: number | null = null;
	            let retryCount = 0;
	            let hasTerminalLoadFailure = false;
	            let hasRenderedSuccessfully = false;
	            let lastStableRasterSource = rasterSource;
	            let onLoadHandler: (() => void) | null = null;
	            let onErrorHandler: ((e: any) => void) | null = null;

	            const clearLoadTimeout = () => {
	                if (loadTimeoutId !== null) {
	                    clearTimeout(loadTimeoutId);
	                    loadTimeoutId = null;
	                }
	            };

	            const bindRasterHandlers = () => {
	                if (onLoadHandler) raster.onLoad = onLoadHandler;
	                if (onErrorHandler) raster.onError = onErrorHandler;
	            };

	            const restartRasterLoad = (useCrossOrigin: boolean) => {
	                if (hasTerminalLoadFailure) return;
	                try { raster.remove(); } catch {}
	                raster = loadRasterWithFallback(useCrossOrigin);
	                bindRasterHandlers();
	                scheduleLoadTimeout();
	                setRasterSource(raster, rasterSource);
	            };

	            const consumeLoadAttempt = (
	                reason: 'timeout' | 'onError' | 'proxyFallback' | 'corsFallback',
	                options?: { useCrossOrigin?: boolean; immediate?: boolean; error?: any }
	            ): boolean => {
	                if (hasTerminalLoadFailure || retryCount >= IMAGE_LOAD_MAX_RETRIES) return false;
	                retryCount += 1;
	                const useCrossOrigin = typeof options?.useCrossOrigin === 'boolean'
	                    ? options.useCrossOrigin
	                    : !hasRetriedCrossOrigin;
	                const delayMs = options?.immediate
	                    ? 0
	                    : IMAGE_LOAD_RETRY_BASE_DELAY * Math.pow(2, retryCount - 1);
	                logger.warn('图片加载失败，准备重试', {
	                    imageId,
	                    placeholderId,
	                    reason,
	                    retryCount,
	                    maxRetries: IMAGE_LOAD_MAX_RETRIES,
	                    nextDelayMs: delayMs,
	                    useCrossOrigin,
	                    rasterSource,
	                    error: options?.error
	                });
	                clearLoadTimeout();
	                window.setTimeout(() => {
	                    restartRasterLoad(useCrossOrigin);
	                }, delayMs);
	                return true;
	            };

	            const attemptLoadRetry = (
	                reason: 'timeout' | 'onError',
	                options?: { useCrossOrigin?: boolean; immediate?: boolean; error?: any }
	            ): boolean => consumeLoadAttempt(reason, options);

	            const finalizeLoadFailure = (e: any, reason: 'timeout' | 'onError') => {
	                if (hasTerminalLoadFailure) return;
	                hasTerminalLoadFailure = true;
	                clearLoadTimeout();
	                removeLoadingIndicator();
	                pendingImagesRef.current = pendingImagesRef.current.filter(p => p.id !== imageId);
	                if (placeholderId) {
	                    removePredictedPlaceholder(placeholderId);
	                }
	                try { raster.remove(); } catch {}
	                const currentRasterSource = getRasterSourceString(raster);
	                const isInlineSource = (() => {
	                    const v = (currentRasterSource || rasterSource || '').trim();
	                    return v.startsWith('blob:') || v.startsWith('data:image/');
	                })();
	                const message = isInlineSource
	                    ? '图片加载失败：可能是图片格式不受支持（如 HEIC/HEIF）或文件损坏，请转换为 PNG/JPG/WebP 后重试'
	                    : '图片加载失败，请检查网络或图片链接';
	                logger.error(reason === 'timeout' ? '图片加载超时，已取消' : '图片加载失败', {
	                    imageId,
	                    placeholderId,
	                    rasterSource,
	                    currentRasterSource,
	                    fileName: asset?.fileName,
	                    contentType: asset?.contentType,
	                    pendingUpload: asset?.pendingUpload,
	                    error: e
	                });
	                window.dispatchEvent(new CustomEvent('toast', {
	                    detail: { message, type: 'error' }
	                }));
	                try { rejectRasterReady?.(e); } catch {}
	            };

	            const scheduleLoadTimeout = () => {
	                clearLoadTimeout();
	                loadTimeoutId = window.setTimeout(() => {
	                    if (attemptLoadRetry('timeout')) return;
	                    finalizeLoadFailure(new Error('image-load-timeout'), 'timeout');
	                }, IMAGE_LOAD_TIMEOUT);
	            };

	            // 等待图片加载完成
	            onLoadHandler = () => {
	                if (hasTerminalLoadFailure) return;
	                clearLoadTimeout();
	                hasRenderedSuccessfully = true;
	                const loadedSource = getRasterSourceString(raster).trim();
	                if (loadedSource) {
	                    lastStableRasterSource = loadedSource;
	                }
	                // 移除加载指示器
	                removeLoadingIndicator();

                // 🔥 若 Raster source 在保存/上传后被切换（dataURL → OSS URL 等），Paper.js 会再次触发 onLoad。
                // 这里必须避免重复执行“创建图片组/派发事件/写历史”等初始化逻辑，否则会产生无 Raster 的孤儿 image 组，
                // 进而导致点击/拖拽命中错对象（刷新后清理孤儿组才恢复）。
                const alreadyInitialized = Boolean((raster as any)?.data?.__tanvaImageInitialized);
                if (alreadyInitialized) {
                    const stored = (raster as any)?.data?.__tanvaBounds as
                        | { x: number; y: number; width: number; height: number }
                        | undefined;
                    if (
                        stored &&
                        Number.isFinite(stored.x) &&
                        Number.isFinite(stored.y) &&
                        Number.isFinite(stored.width) &&
                        Number.isFinite(stored.height) &&
                        stored.width > 0 &&
                        stored.height > 0
                    ) {
                        const rect = new paper.Rectangle(stored.x, stored.y, stored.width, stored.height);
                        try { raster.bounds = rect.clone(); } catch {}
                        try {
                            const parent: any = raster.parent;
                            if (parent && parent.className === 'Group' && Array.isArray(parent.children)) {
                                parent.children.forEach((child: any) => {
                                    if (!child || child === raster) return;
                                    const data = child.data || {};
                                    if (data.type === 'image-selection-area' || data.isSelectionBorder || data.isImageHitRect) {
                                        try { child.bounds = rect.clone(); } catch {}
                                        return;
                                    }
                                    if (data.isResizeHandle) {
                                        const direction = data.direction;
                                        let x = rect.x;
                                        let y = rect.y;
                                        if (direction === 'ne' || direction === 'se') x = rect.x + rect.width;
                                        if (direction === 'sw' || direction === 'se') y = rect.y + rect.height;
                                        try { child.position = new paper.Point(x, y); } catch {}
                                    }
                                });
                            }
                        } catch {}
                    }
                    try { paper.view.update(); } catch {}
                    try { resolveRasterReady?.(); } catch {}
                    return;
                }

                if (!asset) {
                    logger.error('快速上传：缺少图片资源');
                    try { rejectRasterReady?.(new Error('quick-upload-missing-asset')); } catch {}
                    return;
                }

                // 🔥 从待加载列表中移除此图片
                // 🔍 [DEBUG-问题4] 打印移除前的 pending 状态
                console.log(`🗑️ [DEBUG-问题4-移除pending] 图片加载完成，从 pendingImagesRef 移除: ${imageId.substring(0, 30)}`, {
                    移除前数量: pendingImagesRef.current.length,
                    移除前列表: pendingImagesRef.current.map(p => p.id.substring(0, 25))
                });
                pendingImagesRef.current = pendingImagesRef.current.filter(p => p.id !== imageId);
                
                // 获取原始尺寸
                const originalWidth = raster.width;
                const originalHeight = raster.height;

                // 检查是否启用原始尺寸模式
                const useOriginalSize = localStorage.getItem('tanva-use-original-size') === 'true';

                let displayWidth = originalWidth;
                let displayHeight = originalHeight;
                let finalPosition = targetPosition;
                let placeholder = null;

                // 🎯 优先使用占位符，只有在没有占位符时才回退到选中图片边界
                let targetBounds = null;
                let boundsSource: 'placeholder' | 'selected' | null = null;

                // 🔍 [DEBUG-问题3] 详细打印占位符查找过程
                console.log(`🔍 [DEBUG-问题3-占位符查找开始] imageId: ${imageId.substring(0, 30)}`, {
                    placeholderId,
                    targetPosition: { x: targetPosition.x.toFixed(1), y: targetPosition.y.toFixed(1) },
                    originalSize: { w: originalWidth, h: originalHeight },
                    predictedPlaceholdersRef数量: predictedPlaceholdersRef.current.size,
                    所有占位符IDs: Array.from(predictedPlaceholdersRef.current.keys()).map(k => k.substring(0, 30))
                });

                if (placeholderId) {
                    logger.upload(`🔍 [raster.onLoad] 查找占位符: ${placeholderId}`);
                    placeholder = findImagePlaceholder(placeholderId);
                    if (placeholder && placeholder.data?.bounds) {
                        targetBounds = placeholder.data.bounds;
                        boundsSource = 'placeholder';
                        // 🔍 [DEBUG-问题3] 找到占位符
                        console.log(`✅ [DEBUG-问题3-占位符找到] 通过 findImagePlaceholder 找到`, {
                            placeholderId,
                            bounds: {
                                x: targetBounds.x.toFixed(1),
                                y: targetBounds.y.toFixed(1),
                                w: targetBounds.width.toFixed(0),
                                h: targetBounds.height.toFixed(0)
                            }
                        });
                        logger.upload('✅ [raster.onLoad] 找到占位符，bounds:', targetBounds);
                    } else {
                        const placeholderFromRef = predictedPlaceholdersRef.current.get(placeholderId);
                        if (placeholderFromRef && placeholderFromRef.data?.bounds) {
                            placeholder = placeholderFromRef;
                            targetBounds = placeholderFromRef.data.bounds;
                            boundsSource = 'placeholder';
                            // 🔍 [DEBUG-问题3] 从 ref 找到占位符
                            console.log(`✅ [DEBUG-问题3-占位符找到] 通过 predictedPlaceholdersRef 找到`, {
                                placeholderId,
                                bounds: {
                                    x: targetBounds.x.toFixed(1),
                                    y: targetBounds.y.toFixed(1),
                                    w: targetBounds.width.toFixed(0),
                                    h: targetBounds.height.toFixed(0)
                                }
                            });
                            logger.upload(`✅ [raster.onLoad] 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`, targetBounds);
                            logger.upload(`🎯 从 predictedPlaceholdersRef 找到占位符: ${placeholderId}`);
                        } else {
                            // 🔍 [DEBUG-问题3] 未找到占位符 - 这是问题3的关键点
                            console.warn(`❌ [DEBUG-问题3-占位符未找到] placeholderId: ${placeholderId}`, {
                                findImagePlaceholder结果: !!placeholder,
                                predictedPlaceholdersRef中是否存在: predictedPlaceholdersRef.current.has(placeholderId),
                                当前ref中的所有ID: Array.from(predictedPlaceholdersRef.current.keys()),
                                将使用的targetPosition: { x: targetPosition.x.toFixed(1), y: targetPosition.y.toFixed(1) }
                            });
                            logger.upload(`⚠️ [raster.onLoad] 未找到占位符 ${placeholderId}，当前占位符数量: ${predictedPlaceholdersRef.current.size}`);
                            logger.upload(`⚠️ 未找到占位符 ${placeholderId}，将使用智能位置计算`);
                        }
                    }
                }

                if (!targetBounds && selectedImageBounds) {
                    targetBounds = selectedImageBounds;
                    boundsSource = 'selected';
                }

                if (targetBounds) {
                    const sourceType = boundsSource === 'selected' ? '选中图片边界' : '占位框';
                    logger.upload(`🎯 发现${sourceType}，使用边界尺寸进行自适应`);

                    // 计算目标边界的中心点和尺寸
                    const targetCenter = new paper.Point(
                        targetBounds.x + targetBounds.width / 2,
                        targetBounds.y + targetBounds.height / 2
                    );

                    const boxAspectRatio = targetBounds.width / targetBounds.height;
                    const imageAspectRatio = originalWidth / originalHeight;

                    if (useOriginalSize) {
                        // 原始尺寸模式：以目标边界中心为基准，使用图片原始尺寸
                        if (!smartPosition) {
                            finalPosition = targetCenter;
                        } else {
                            finalPosition = targetPosition;
                        }
                        displayWidth = originalWidth;
                        displayHeight = originalHeight;
                    } else {
                        // 自适应模式：根据目标边界和图片比例计算保持比例的实际大小
                        if (imageAspectRatio > boxAspectRatio) {
                            // 图片更宽，以目标边界宽度为准
                            displayWidth = targetBounds.width;
                            displayHeight = displayWidth / imageAspectRatio;
                        } else {
                            // 图片更高，以目标边界高度为准
                            displayHeight = targetBounds.height;
                            displayWidth = displayHeight * imageAspectRatio;
                        }
                        if (!smartPosition) {
                            finalPosition = targetCenter;
                        } else {
                            finalPosition = targetPosition;
                        }
                    }

                    // 删除占位框（如果存在）
                    if (placeholderId) {
                        logger.upload(`🗑️ [handleQuickImageUploaded] 准备移除占位符: ${placeholderId}`);
                        const placeholderBeforeRemove = findImagePlaceholder(placeholderId);
                        if (placeholderBeforeRemove) {
                            logger.upload(`✅ [handleQuickImageUploaded] 找到占位符，准备移除: ${placeholderId}`);
                            removePredictedPlaceholder(placeholderId);
                            logger.upload(`✅ [handleQuickImageUploaded] 已移除占位符: ${placeholderId}`);
                        } else {
                            logger.upload(`⚠️ [handleQuickImageUploaded] 未找到占位符，无法移除: ${placeholderId}`);
                        }
                    } else if (placeholder) {
                        placeholder.remove();
                        logger.upload('🗑️ 已删除占位框（无ID）');
                    }
                } else {
                    // 没有占位框，使用原有的逻辑
                    // 🔥 如果提供了 placeholderId 但未找到占位符，尝试使用智能位置计算
                    if (placeholderId && operationType && !finalPosition) {
                        logger.upload(`⚠️ 占位符 ${placeholderId} 未找到，使用智能位置计算`);
                        try {
                            const calculated = calculateSmartPosition(operationType, sourceImageId, sourceImages, imageId);
                            const desiredPoint = new paper.Point(calculated.x, calculated.y);
                            // 使用 expectedWidth 和 expectedHeight，如果没有则使用原始尺寸
                            const widthForPosition = expectedWidth || originalWidth || 512;
                            const heightForPosition = expectedHeight || originalHeight || 512;
                            const adjustedPoint = resolveMatrixPosition({
                                operationType: operationType || 'manual',
                                anchor: desiredPoint,
                                expectedWidth: widthForPosition,
                                expectedHeight: heightForPosition,
                                currentImageId: imageId,
                                layoutContext: {
                                    groupId: parallelGroupId,
                                    groupIndex: parallelGroupIndex,
                                    groupTotal: parallelGroupTotal,
                                    anchorCenter: { x: desiredPoint.x, y: desiredPoint.y },
                                    sourceImageId,
                                    sourceImages,
                                    preferHorizontal,
                                },
                            });
                            finalPosition = adjustedPoint;
                            logger.upload(`📍 使用智能位置计算: (${adjustedPoint.x.toFixed(1)}, ${adjustedPoint.y.toFixed(1)})`);
                        } catch (error) {
                            logger.error('智能位置计算失败:', error);
                            // 如果智能位置计算失败，使用默认位置
                            if (!finalPosition) {
                                finalPosition = targetPosition;
                            }
                        }
                    }
                    
                    if (!useOriginalSize) {
                    // 标准模式：限制最大显示尺寸，但保持原始长宽比
                    const maxSize = 512;
                    if (originalWidth > maxSize || originalHeight > maxSize) {
                        // 保持原始长宽比，按最大边缩放
                        if (originalWidth > originalHeight) {
                            // 宽图：以宽度为准
                            displayWidth = maxSize;
                            displayHeight = maxSize * (originalHeight / originalWidth);
                        } else {
                            // 高图：以高度为准
                            displayHeight = maxSize;
                            displayWidth = maxSize * (originalWidth / originalHeight);
                        }
                    }
                    }
                    // 原始尺寸模式：直接使用原图分辨率，1像素=1像素显示
                }

                if (forcedTopAnchorPoint) {
                    finalPosition = new paper.Point(
                        forcedTopAnchorPoint.x,
                        forcedTopAnchorPoint.y + displayHeight / 2 + FLOW_NODE_SEND_TOP_GAP
                    );
                    if (pendingEntry) {
                        pendingEntry.x = finalPosition.x;
                        pendingEntry.y = finalPosition.y;
                    }
                }

                // 🎯 关键修复：不设置raster.size，保持原始分辨率
                // raster.size = new paper.Size(displayWidth, displayHeight); // ❌ 移除这行
                
                // 通过bounds控制显示区域，保持原始分辨率
                raster.bounds = new paper.Rectangle(
                    finalPosition.x - displayWidth / 2,
                    finalPosition.y - displayHeight / 2,
                    displayWidth,
                    displayHeight
                );
                raster.position = finalPosition;

                // 🔍 [DEBUG-最终结果] 打印图片最终渲染位置
                console.log(`🎨 [DEBUG-最终渲染位置] imageId: ${imageId.substring(0, 30)}`, {
                    finalPosition: { x: finalPosition.x.toFixed(1), y: finalPosition.y.toFixed(1) },
                    displaySize: { w: displayWidth.toFixed(0), h: displayHeight.toFixed(0) },
                    originalSize: { w: originalWidth, h: originalHeight },
                    rasterBounds: {
                        x: raster.bounds.x.toFixed(1),
                        y: raster.bounds.y.toFixed(1),
                        w: raster.bounds.width.toFixed(0),
                        h: raster.bounds.height.toFixed(0)
                    },
                    boundsSource,
                    placeholderId,
                    operationType
                });

                // 存储元数据
                raster.data = {
                    ...(raster.data || {}),
                    type: 'image',
                    imageId: imageId,
                    originalWidth: originalWidth,
                    originalHeight: originalHeight,
                    fileName: fileName || 'quick-uploaded-image',
                    uploadMethod: 'smart-layout',
                    aspectRatio: originalWidth / originalHeight,
                    operationType: operationType || 'manual',
                    sourceImageId: sourceImageId,
                    sourceImages: sourceImages,
                    videoInfo: extraOptions?.videoInfo
                };

                // 创建选择区域（透明点击热区，避免 Raster hitTest/异步加载导致“点不到图片”）
                const selectionArea = new paper.Path.Rectangle({
                    rectangle: raster.bounds,
                    fillColor: new paper.Color(0, 0, 0, 0.001),
                    strokeColor: null,
                    visible: true,
                    selected: false
                });
                selectionArea.data = {
                    type: 'image-selection-area',
                    imageId,
                    isHelper: true
                };

                // 创建选择框（默认隐藏，点击时显示）
                const selectionBorder = new paper.Path.Rectangle({
                    rectangle: raster.bounds,
                    strokeColor: new paper.Color('#3b82f6'),
                    strokeWidth: 1,
                    fillColor: null,
                    selected: false,
                    visible: false  // 默认隐藏
                });
                selectionBorder.data = {
                    isSelectionBorder: true,
                    isHelper: true
                };

                // 添加四个角的调整控制点（默认隐藏）
                const handleSize = 12;
                const handleColor = new paper.Color('#3b82f6');
                const bounds = raster.bounds;

                const handles = [
                    { direction: 'nw', position: [bounds.left, bounds.top] },
                    { direction: 'ne', position: [bounds.right, bounds.top] },
                    { direction: 'sw', position: [bounds.left, bounds.bottom] },
                    { direction: 'se', position: [bounds.right, bounds.bottom] }
                ];

                const handleElements: paper.Path[] = [];
                handles.forEach(({ direction, position }) => {
                    const handle = new paper.Path.Rectangle({
                        point: [position[0] - handleSize / 2, position[1] - handleSize / 2],
                        size: [handleSize, handleSize],
                        fillColor: 'white',  // 改为白色填充（空心效果）
                        strokeColor: handleColor,  // 蓝色边框
                        strokeWidth: 1,  // 增加边框宽度让空心效果更明显
                        selected: false,
                        visible: false  // 默认隐藏
                    });
                    handle.data = {
                        isResizeHandle: true,
                        direction,
                        imageId,
                        isHelper: true
                    };
                    handleElements.push(handle);
                });

                // 创建组合：包含 Raster + 选择区域 + 可视辅助
                const imageGroup = new paper.Group([raster, selectionArea, selectionBorder, ...handleElements]);
                imageGroup.data = {
                    type: 'image',
                    imageId: imageId,
                    isHelper: false,
                    operationType: operationType || 'manual',
                    sourceImageId: sourceImageId,
                    sourceImages: sourceImages
                };

                // 添加到全局图片实例管理
	                const newImageInstance = {
	                    id: imageId,
	                    imageData: {
	                        id: imageId,
	                        url: asset.url,
	                        src: asset.src || asset.url,
	                        localDataUrl: asset.localDataUrl,
	                        key: asset.key,
	                        fileName: fileName,
	                        // width/height 代表图片原始像素尺寸（用于信息展示/资产元数据），不要用显示 bounds
	                        width: Math.round(originalWidth),
	                        height: Math.round(originalHeight),
	                        contentType: asset.contentType,
	                        pendingUpload: !!asset.pendingUpload,
	                    },
	                    bounds: {
	                        x: raster.bounds.x,
	                        y: raster.bounds.y,
                        width: raster.bounds.width,
                        height: raster.bounds.height
                    },
                    isSelected: false,
                    visible: true,
                    layerId: paper.project.activeLayer.name
                };

                // 触发图片实例更新事件（始终触发，让 DrawingController 处理）
                window.dispatchEvent(new CustomEvent('quickImageAdded', {
                    detail: newImageInstance
                }));

                // 标记初始化完成并缓存 bounds，防止后续 source 切换重复初始化/命中异常
                try {
                    if (!raster.data) raster.data = {};
                    (raster.data as any).__tanvaImageInitialized = true;
                    (raster.data as any).__tanvaBounds = {
                        x: raster.bounds.x,
                        y: raster.bounds.y,
                        width: raster.bounds.width,
                        height: raster.bounds.height
                    };
                } catch {}

                // 🔥 X4/X8 自动打组：收集同批次图片，当所有图片都加载完成后自动打组
                if (parallelGroupId && parallelGroupTotal && parallelGroupTotal >= 2) {
                    const collector = parallelGroupCollectorRef.current;
                    let groupData = collector.get(parallelGroupId);
                    if (!groupData) {
                        groupData = { total: parallelGroupTotal, imageIds: [] };
                        collector.set(parallelGroupId, groupData);
                    }
                    // 添加当前图片 ID
                    if (!groupData.imageIds.includes(imageId)) {
                        groupData.imageIds.push(imageId);
                    }
                    logger.upload(`🔗 [自动打组] 收集图片 ${groupData.imageIds.length}/${groupData.total}, groupId: ${parallelGroupId}, imageId: ${imageId}`);

                    // 检查是否所有图片都已加载完成
                    if (groupData.imageIds.length >= groupData.total) {
                        logger.upload(`✅ [自动打组] 所有 ${groupData.total} 张图片已加载完成，触发自动打组`);
                        // 保存当前 groupData 的引用，避免闭包问题
                        const imageIdsToGroup = [...groupData.imageIds];
                        const groupIdToDelete = parallelGroupId;
                        // 延迟执行打组，确保所有图片都已渲染到画布
                        setTimeout(() => {
                            try {
                                const result = createImageGroupBlock(imageIdsToGroup);
                                if (result.block) {
                                    logger.upload(`✅ [自动打组] 成功创建图片组，包含 ${imageIdsToGroup.length} 张图片`);
                                    paper.view?.update();
                                    // 提交历史记录
                                    try { historyService.commit('auto-group-images').catch(() => {}); } catch {}
                                } else {
                                    logger.upload(`⚠️ [自动打组] 创建图片组失败: ${result.reason}`);
                                }
                            } catch (err) {
                                logger.error('自动打组执行失败:', err);
                            }
                            // 清理收集器
                            collector.delete(groupIdToDelete);
                        }, 500); // 延迟 500ms 确保画布渲染完成
                    }
                }

                // 记录历史，优先使用 OSS 链接，便于刷新后从云端恢复
                try {
                    const addHistory = useImageHistoryStore.getState().addImage;
                    addHistory({
                        id: imageId,
                        src: asset.url,
                        remoteUrl: asset.url,
                        thumbnail: asset.localDataUrl || asset.url,
                        title: fileName ? `快速上传 · ${fileName}` : '快速上传图片',
                        nodeId: 'canvas',
                        nodeType: 'image',
                        projectId: projectId ?? null
                    });
                } catch (historyError) {
                    // 忽略历史记录错误
                }
                if (TOOLBAR_DERIVED_OPERATION_TYPES.has(pendingOperationType)) {
                    const persistableRef = normalizePersistableImageRef(
                        resolvedRemoteUrl || resolvedKey || asset.url || asset.src || ''
                    );
                    if (persistableRef && isPersistableImageRef(persistableRef)) {
                        void recordImageHistoryEntry({
                            id: imageId,
                            remoteUrl: persistableRef,
                            title: fileName ? `快速上传 · ${fileName}` : '快速上传图片',
                            nodeId: 'canvas',
                            nodeType: 'image',
                            projectId: projectId ?? null,
                            skipInitialStoreUpdate: true,
                            metadata: {
                                operationType: pendingOperationType,
                                sourceImageId: sourceImageId || undefined,
                                sourceImages: Array.isArray(sourceImages) ? sourceImages : undefined,
                            },
                        });
                    }
                }

                const positionInfo = boundsSource === 'selected'
                    ? '选中图片位置'
                    : (placeholder ? '占位框位置' : '坐标原点');
                logger.upload(`✅ 快速上传成功：图片已添加到${positionInfo} - ${fileName || 'uploaded-image'}`);
                try { historyService.commit('add-image').catch(() => {}); } catch {}
                const persistableRef = normalizePersistableImageRef(
                    resolvedRemoteUrl || resolvedKey || asset.url || asset.src || ''
                );
                if (!asset.pendingUpload && persistableRef && isPersistableImageRef(persistableRef)) {
                    try { paperSaveService.triggerAutoSave('image-added'); } catch {}
                }

                // 若图片落点不在当前视口内，自动将视口平移到图片中心，避免"已成功但看不见"的困扰
                try {
                    const vb = paper.view.bounds;
                    const inView = vb && vb.intersects(raster.bounds);
                    const shouldAutoFocus = pendingOperationType === 'manual';
                    if (!inView && shouldAutoFocus) {
                        const { zoom: z, setPan } = useCanvasStore.getState();
                        const vs = paper.view.viewSize;
                        const cx = vs.width / 2; // 屏幕中心（项目坐标）
                        const cy = vs.height / 2;
                        const desiredPanX = (cx / z) - raster.position.x;
                        const desiredPanY = (cy / z) - raster.position.y;
                        setPan(desiredPanX, desiredPanY);
                    }
                } catch (e) {
                    // 忽略自动居中错误
                }
                if (placeholderId) {
                    removePredictedPlaceholder(placeholderId);
                }
	                paper.view.update();
	                try { resolveRasterReady?.(); } catch {}
	            };

	            // 🔥 定义 onError 处理器（支持 proxy/CORS 失败后重试）
	            onErrorHandler = (e: any) => {
                    if (hasTerminalLoadFailure) return;
                    if (hasRenderedSuccessfully) {
                        clearLoadTimeout();
                        removeLoadingIndicator();
                        const fallbackSource = (lastStableRasterSource || '').trim();
                        if (fallbackSource) {
                            const currentBounds = (() => {
                                try {
                                    const b = raster.bounds as paper.Rectangle | undefined;
                                    if (b && b.width > 0 && b.height > 0) return b.clone();
                                } catch {}
                                return null;
                            })();
                            try {
                                setRasterSource(raster, fallbackSource);
                                if (currentBounds) {
                                    try { raster.bounds = currentBounds; } catch {}
                                }
                                try { paper.view?.update(); } catch {}
                            } catch {}
                        }
                        logger.warn('Image source upgrade failed after first render, fallback to last stable source', {
                            imageId,
                            placeholderId,
                            fallbackSource,
                            error: e
                        });
                        return;
                    }
                    // proxy load failed -> retry direct remote URL
                    if (
                        !hasRetriedProxyFallback &&
                        resolvedRemoteUrl &&
                        isAssetProxyRef(rasterSource)
                    ) {
                        const nextSource = resolvedRemoteUrl;
                        if (consumeLoadAttempt('proxyFallback', { useCrossOrigin: true, error: e })) {
                            hasRetriedProxyFallback = true;
                            rasterSource = nextSource;
                            logger.upload('Proxy load failed, fallback to direct URL...');
                            return;
                        }
                    }

                    // CORS load failed -> retry without crossOrigin
                    if (!hasRetriedCrossOrigin && shouldUseAnonymousCrossOrigin(rasterSource)) {
                        if (consumeLoadAttempt('corsFallback', { useCrossOrigin: false, error: e })) {
                            hasRetriedCrossOrigin = true;
                            logger.upload('CORS load failed, retry without crossOrigin...');
                            return;
                        }
                    }

                    if (attemptLoadRetry('onError', { error: e })) return;
                    finalizeLoadFailure(e, 'onError');
                }; 

	            // 绑定处理器并触发首次加载
	            bindRasterHandlers();
	            scheduleLoadTimeout();
	            setRasterSource(raster, rasterSource);
	            await rasterReady;
	        } catch (error) {
	            logger.error('快速上传图片时出错:', error);
	            try { rejectRasterReady?.(error); } catch {}
	        }
    }, [ensureDrawingLayer, calculateSmartPosition, findImagePlaceholder, projectId, removePredictedPlaceholder, resolveMatrixPosition, upsertPendingImage]);

    // 处理上传错误
    const handleQuickUploadError = useCallback((error: string) => {
        logger.error('快速上传失败:', error);
    }, []);

    // 处理触发完成
    const handleQuickUploadTriggerHandled = useCallback(() => {
        setTriggerQuickUpload(false);
    }, []);

    // 触发快速上传
    const triggerQuickImageUpload = useCallback(() => {
        setTriggerQuickUpload(true);
    }, []);

    return {
        triggerQuickUpload,
        triggerQuickImageUpload,
        handleQuickImageUploaded,
        handleQuickUploadError,
        handleQuickUploadTriggerHandled,
        showPredictedPlaceholder,
        removePredictedPlaceholder,
        updatePlaceholderProgress,
        // 智能排版相关函数
        calculateSmartPosition,
        getAllCanvasImages,
        findImageById
    };
};
