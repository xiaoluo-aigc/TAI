// Renders the image overlay UI and per-image actions on the canvas.
import React, {
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from "react";
import paper from "paper";
import { useCanvasStore } from "@/stores";
import {
  EyeOff,
  Wand2,
  Zap,
  Layers,
  ArrowRightLeft,
  Rotate3d,
  Crop,
  ImageUp,
  Type,
  Lock,
  Unlock,
  MoreHorizontal,
  Palette,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import ImagePreviewModal, { type ImageItem } from "../ui/ImagePreviewModal";
import backgroundRemovalService from "@/services/backgroundRemovalService";
import { LoadingSpinner } from "../ui/loading-spinner";
import { logger } from "@/utils/logger";
import {
  createConvert2Dto3DTask,
  waitForConvert2Dto3DTask,
} from "@/services/convert2Dto3DService";
import { generateOssKey, uploadToOSS } from "@/services/ossUploadService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import type { Model3DData } from "@/services/model3DUploadService";
// optimizeHdImage 已弃用，改用 aiImageService.editImage
import ExpandImageSelector from "./ExpandImageSelector";
import { useToolStore } from "@/stores";
import aiImageService from "@/services/aiImageService";
import { globalImageHistoryApi, type GlobalImageHistoryItem } from "@/services/globalImageHistoryApi";
import { loadImageElement } from "@/utils/imageHelper";
import { imageUrlCache } from "@/services/imageUrlCache";
import { isGroup, isRaster } from "@/utils/paperCoords";
import { editImageViaAPI } from "@/services/aiBackendAPI";
import { useAIChatStore, getImageModelForProvider } from "@/stores/aiChatStore";
import {
  isPersistableImageRef,
  isRemoteUrl,
  normalizePersistableImageRef,
  resolveImageToBlob,
  resolveImageToDataUrl,
  toRenderableImageSrc,
} from "@/utils/imageSource";
import { blobToDataUrl, canvasToBlob, canvasToDataUrl, dataUrlToBlob } from "@/utils/imageConcurrency";

const EXPAND_PRESET_PROMPT =
  "请智能填充图像中的黑色区域，使其与原始图像内容完美融合，保持原图的高宽比不变";
const TEXT_RECOGNITION_PROMPT =
  '请识别图片中所有可见文字，并仅返回 JSON 数组，例如：["文字1","文字2"]。不要返回其他解释。';

type TextReplacementItem = {
  id: string;
  originalText: string;
  nextText: string;
};

type ToolbarActionKey =
  | "removeBackground"
  | "fastRemoveBackground"
  | "layerSeparation"
  | "convertTo3D"
  | "hdUpscale"
  | "expandImage"
  | "cropImage"
  | "editText"
  | "generateNode"
  | "extractPalette";

type ToolbarAction = {
  key: ToolbarActionKey;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled: boolean;
  loading?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
};

const TOOLBAR_USAGE_STORAGE_KEY = "tanva:image-toolbar-usage:v1";
const FIXED_TOOLBAR_KEYS: readonly ToolbarActionKey[] = [
  "fastRemoveBackground",
  "hdUpscale",
  "generateNode",
];
const ROTATABLE_TOOLBAR_KEYS: readonly ToolbarActionKey[] = [
  "removeBackground",
  "layerSeparation",
  "convertTo3D",
  "expandImage",
  "cropImage",
  "editText",
  "extractPalette",
];

const DEFAULT_PALETTE_SIZE = 6;
const PALETTE_STRIP_WIDTH_PX = 34;
const PALETTE_STRIP_HEIGHT_PX = 180;
const PALETTE_IMAGE_GAP_WORLD = 18;
const PALETTE_MIN_DISPLAY_HEIGHT_PX = 72;
const PALETTE_MIN_DISPLAY_WIDTH_PX = 14;

type Bounds = { x: number; y: number; width: number; height: number };
type CropRect = { x: number; y: number; width: number; height: number };
type CropHandle = "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";
const ensureDataUrlString = (
  imageData: string,
  mime: string = "image/png"
): string => {
  if (!imageData) return "";
  return imageData.startsWith("data:image")
    ? imageData
    : `data:${mime};base64,${imageData}`;
};

const normalizeImageSrc = (value?: string | null): string => {
  return toRenderableImageSrc(value) || "";
};

/** 预览侧栏/放大：与 Paper 渲染一致，优先稳定 remoteUrl/key，并保留 flow-asset 供 SmartImage 解析 */
const resolvePreviewImageSrcForCanvas = (img: {
  remoteUrl?: string;
  url?: string;
  src?: string;
  key?: string;
  localDataUrl?: string;
}): string => {
  const candidates = [
    img.remoteUrl,
    img.url,
    img.src,
    img.key,
    img.localDataUrl,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const raw = c.trim();
    if (!raw) continue;
    const normalized = normalizeImageSrc(raw);
    if (normalized) return normalized;
  }
  return "";
};

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const buildImageSourceFingerprint = (value?: string | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("data:image/")) {
    const head = trimmed.slice(0, 64);
    const tail = trimmed.slice(-24);
    return `data:${trimmed.length}:${head}:${tail}`;
  }
  if (trimmed.startsWith("blob:")) {
    return `blob:${trimmed}`;
  }
  const normalized = normalizePersistableImageRef(trimmed);
  if (normalized) return normalized;
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return undefined;
  return `inline:${compact.length}:${compact.slice(0, 48)}:${compact.slice(-24)}`;
};

const dedupeTexts = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
};

const parseRecognizedTexts = (analysis: string): string[] => {
  const normalized = analysis.trim();
  if (!normalized) return [];

  const parseJsonTexts = (raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
      if (parsed && typeof parsed === "object") {
        const maybeTexts = (parsed as { texts?: unknown }).texts;
        if (Array.isArray(maybeTexts)) {
          return maybeTexts.filter(
            (item): item is string => typeof item === "string"
          );
        }
      }
    } catch {
      return [];
    }
    return [];
  };

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const fromJson = dedupeTexts([
    ...parseJsonTexts(fenced ?? ""),
    ...parseJsonTexts(normalized),
  ]);
  if (fromJson.length > 0) {
    return fromJson.slice(0, 20);
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[\s\-*•\d.)["'`]+/, "")
        .replace(/[\]"'`]+$/, "")
        .trim()
    )
    .filter(Boolean);

  return dedupeTexts(lines).slice(0, 20);
};

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (channel: number) =>
    clampChannel(channel).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const colorDistanceSq = (
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number }
): number => {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return dr * dr + dg * dg + db * db;
};

const extractPaletteFromImageDataUrl = async (
  imageDataUrl: string,
  paletteSize: number = DEFAULT_PALETTE_SIZE
): Promise<string[]> => {
  const image = await loadImageElement(imageDataUrl);
  const longestEdge = Math.max(image.width, image.height);
  const downsampleScale = longestEdge > 180 ? 180 / longestEdge : 1;
  const targetWidth = Math.max(1, Math.round(image.width * downsampleScale));
  const targetHeight = Math.max(1, Math.round(image.height * downsampleScale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; score: number }
  >();
  const quantStep = 24;

  for (let i = 0; i < imageData.data.length; i += 4) {
    const alpha = imageData.data[i + 3];
    if (alpha < 120) continue;

    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const qR = Math.min(255, Math.round(r / quantStep) * quantStep);
    const qG = Math.min(255, Math.round(g / quantStep) * quantStep);
    const qB = Math.min(255, Math.round(b / quantStep) * quantStep);
    const key = `${qR}-${qG}-${qB}`;
    const delta = Math.max(qR, qG, qB) - Math.min(qR, qG, qB);
    const weight = 1 + (delta / 255) * 0.3;
    const current = buckets.get(key);
    if (current) {
      current.score += weight;
      continue;
    }
    buckets.set(key, {
      r: qR,
      g: qG,
      b: qB,
      score: weight,
    });
  }

  const sorted = Array.from(buckets.values()).sort(
    (left, right) => right.score - left.score
  );
  if (sorted.length === 0) return [];

  const selected: Array<{ r: number; g: number; b: number; score: number }> = [];
  const minDistanceSq = 28 * 28;

  for (const candidate of sorted) {
    const farEnough = selected.every(
      (existing) => colorDistanceSq(existing, candidate) >= minDistanceSq
    );
    if (!farEnough) continue;
    selected.push(candidate);
    if (selected.length >= paletteSize) break;
  }

  if (selected.length < paletteSize) {
    for (const candidate of sorted) {
      const exists = selected.some(
        (existing) =>
          existing.r === candidate.r &&
          existing.g === candidate.g &&
          existing.b === candidate.b
      );
      if (exists) continue;
      selected.push(candidate);
      if (selected.length >= paletteSize) break;
    }
  }

  return selected
    .slice(0, paletteSize)
    .map((item) => rgbToHex(item.r, item.g, item.b));
};

const buildPaletteStripDataUrl = async (
  colors: string[],
  size?: { width: number; height: number }
): Promise<string> => {
  const safeColors = colors.filter((item) => typeof item === "string" && item.trim());
  if (safeColors.length === 0) {
    throw new Error("未提取到有效颜色");
  }

  const canvasWidth = Math.max(
    1,
    Math.round(size?.width ?? PALETTE_STRIP_WIDTH_PX)
  );
  const canvasHeight = Math.max(
    1,
    Math.round(size?.height ?? PALETTE_STRIP_HEIGHT_PX)
  );
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建调色板画布");
  }

  const stripeHeight = canvas.height / safeColors.length;
  safeColors.forEach((color, index) => {
    const y = Math.round(index * stripeHeight);
    const nextY = Math.round((index + 1) * stripeHeight);
    ctx.fillStyle = color;
    ctx.fillRect(0, y, canvas.width, Math.max(1, nextY - y));
  });

  return canvasToDataUrl(canvas, "image/png");
};

const buildTextEditPrompt = (
  replacements: Array<{ originalText: string; nextText: string }>,
  extraInstruction?: string
): string => {
  const lines: string[] = [
    "请仅修改图片中的文字，保持主体、背景、构图、颜色、光影和风格不变。",
    "请严格按以下规则替换文字：",
  ];

  replacements.forEach((item, index) => {
    lines.push(
      `${index + 1}. 将“${item.originalText}”替换为“${item.nextText}”。`
    );
  });

  if (extraInstruction?.trim()) {
    lines.push(`补充要求：${extraInstruction.trim()}`);
  }

  lines.push(
    "如果某条原文字在图中不存在，请忽略该条，不要新增无关文字。",
    "除文字替换外，不要改动任何图像内容。"
  );

  return lines.join("\n");
};

const HD_UPSCALE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

type HdUpscaleAspectRatio = (typeof HD_UPSCALE_ASPECT_RATIOS)[number];

const getClosestHdUpscaleAspectRatio = (
  width: number,
  height: number
): HdUpscaleAspectRatio | undefined => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  const targetRatio = width / height;
  let bestMatch: HdUpscaleAspectRatio | undefined;
  let smallestDiff = Number.POSITIVE_INFINITY;

  for (const ratio of HD_UPSCALE_ASPECT_RATIOS) {
    const [w, h] = ratio.split(":").map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      continue;
    }
    const diff = Math.abs(targetRatio - w / h);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestMatch = ratio;
    }
  }

  return bestMatch;
};

const _composeExpandedImage = async (
  sourceDataUrl: string,
  originalBounds: Bounds,
  targetBounds: Bounds
): Promise<{ dataUrl: string; width: number; height: number }> => {
  if (!targetBounds.width || !targetBounds.height) {
    throw new Error("请选择有效的扩展区域");
  }

  const image = await loadImageElement(sourceDataUrl);
  const safeOriginalWidth = Math.max(1, originalBounds.width);
  const safeOriginalHeight = Math.max(1, originalBounds.height);

  const scaleX = image.width / safeOriginalWidth;
  const scaleY = image.height / safeOriginalHeight;
  const scale =
    Number.isFinite(scaleX) && Number.isFinite(scaleY)
      ? (scaleX + scaleY) / 2
      : Number.isFinite(scaleX)
      ? scaleX
      : Number.isFinite(scaleY)
      ? scaleY
      : 1;

  const canvasWidth = Math.max(1, Math.round(targetBounds.width * scale));
  const canvasHeight = Math.max(1, Math.round(targetBounds.height * scale));
  const offsetX = Math.round((originalBounds.x - targetBounds.x) * scale);
  const offsetY = Math.round((originalBounds.y - targetBounds.y) * scale);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建扩展画布");
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(image, offsetX, offsetY, image.width, image.height);

  return {
    dataUrl: await canvasToDataUrl(canvas, "image/png"),
    width: canvasWidth,
    height: canvasHeight,
  };
};

interface ImageData {
  id: string;
  url?: string;
  key?: string;
  remoteUrl?: string;
  src?: string;
  fileName?: string;
  pendingUpload?: boolean;
  localDataUrl?: string;
  width?: number; // 图片原始宽度
  height?: number; // 图片原始高度
  locked?: boolean;
}

interface ImageContainerProps {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  visible?: boolean; // 是否可见
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  layerIndex?: number; // 图层索引，用于计算z-index
  allCanvasImages?: ImageData[]; // 画布上所有图片，用于预览时显示项目内所有图片
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void; // Paper.js坐标
  onImageUpdate?: (
    imageId: string,
    imageData: string,
    bounds: { x: number; y: number; width: number; height: number }
  ) => void | Promise<void>;
  onDelete?: (imageId: string) => void;
  onToggleVisibility?: (imageId: string) => void; // 切换图层可见性回调
  onToggleLock?: (imageId: string, nextLocked: boolean) => void;
  getImageDataForEditing?: (imageId: string) => string | null; // 获取高质量图像数据的函数
  showIndividualTools?: boolean;
}

const ImageContainer: React.FC<ImageContainerProps> = ({
  imageData,
  bounds,
  isSelected = false,
  visible = true,
  drawMode: _drawMode = "select",
  isSelectionDragging: _isSelectionDragging = false,
  layerIndex = 0,
  allCanvasImages = [],
  onSelect: _onSelect,
  onMove: _onMove,
  onResize,
  onImageUpdate,
  onDelete: _onDelete,
  onToggleVisibility,
  onToggleLock,
  getImageDataForEditing,
  showIndividualTools = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const enableVisibilityToggle = false; // Temporarily hide layer visibility control

  // 获取AI聊天状态
  const {
    setSourceImageForEditing,
    addImageForBlending,
    showDialog,
    sourceImageForEditing,
    sourceImagesForBlending,
    bananaImageRoute,
  } = useAIChatStore();

  // 获取画布状态 - 用于监听画布移动变化
  const { zoom, panX, panY, isDragging: isCanvasDragging, setOperationInProgress } = useCanvasStore();

  // 工具栏缩放逻辑：始终保持 100% 大小，不随画布缩放
  const currentZoom = zoom || 1;
  const showButtonText = currentZoom >= 0.5; // 50%及以上显示文字，稍微放宽一点
  const toolbarScale = 1; // 固定为1，不再跟随缩放
  const showFastBackgroundRemovalButton = true;

  const sharedButtonClass = showButtonText
    ? "px-2 py-1 h-7 rounded-md bg-transparent text-gray-600 text-xs transition-all duration-200 hover:bg-gray-100 hover:text-gray-800 flex items-center gap-1 whitespace-nowrap"
    : "px-1.5 py-1 h-7 rounded-md bg-transparent text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-800 flex items-center justify-center";
  const sharedIconClass = "w-3.5 h-3.5 flex-shrink-0";

  // 实时Paper.js坐标状态
  const [realTimeBounds, setRealTimeBounds] = useState(bounds);

  // 是否正在拖拽（图片拖拽/选择拖拽会通过 body class 标记；画布中键平移通过 store 标记）
  const [isBodyDragging, setIsBodyDragging] = useState(false);
  const isPendingUpload = Boolean(imageData.pendingUpload);

  // 图片真实像素尺寸（通过加载图片获取）
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // 预览模态框状态
  const [showPreview, setShowPreview] = useState(false);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [isFastRemovingBackground, setIsFastRemovingBackground] = useState(false);
  const [isSeparatingLayers, setIsSeparatingLayers] = useState(false);
  const [isConvertingTo3D, setIsConvertingTo3D] = useState(false);
  const [isExpandingImage, setIsExpandingImage] = useState(false);
  const [isOptimizingHd, setIsOptimizingHd] = useState(false);
  const [isRecognizingText, setIsRecognizingText] = useState(false);
  const [isApplyingTextEdit, setIsApplyingTextEdit] = useState(false);
  const [showTextEditPanel, setShowTextEditPanel] = useState(false);
  const [isExtractingPalette, setIsExtractingPalette] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [isApplyingCrop, setIsApplyingCrop] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropSourceBounds, setCropSourceBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [textReplacementItems, setTextReplacementItems] = useState<
    TextReplacementItem[]
  >([]);
  const [textEditExtraInstruction, setTextEditExtraInstruction] = useState("");
  const [showExpandSelector, setShowExpandSelector] = useState(false);
  const isImageLocked = Boolean(imageData.locked);
  const [isHoveringLockedImage, setIsHoveringLockedImage] = useState(false);
  const [projectHistoryItems, setProjectHistoryItems] = useState<
    GlobalImageHistoryItem[]
  >([]);
  const [projectHistoryCursor, setProjectHistoryCursor] = useState<
    string | undefined
  >(undefined);
  const [projectHistoryHasMore, setProjectHistoryHasMore] = useState(false);
  const [projectHistoryLoading, setProjectHistoryLoading] = useState(false);
  const lastLoadedProjectIdRef = useRef<string | null>(null);
  const projectHistoryLoadedRef = useRef(false);
  const [toolbarUsageCounts, setToolbarUsageCounts] = useState<
    Partial<Record<ToolbarActionKey, number>>
  >({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TOOLBAR_USAGE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Partial<Record<ToolbarActionKey, number>> = {};
      [...FIXED_TOOLBAR_KEYS, ...ROTATABLE_TOOLBAR_KEYS].forEach((key) => {
        const value = parsed[key];
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        const safeValue = Math.max(0, Math.floor(value));
        if (safeValue > 0) {
          next[key] = safeValue;
        }
      });
      setToolbarUsageCounts(next);
    } catch {
      // ignore invalid localStorage content
    }
  }, []);

  const recordToolbarUsage = useCallback((key: ToolbarActionKey) => {
    setToolbarUsageCounts((current) => {
      const next = {
        ...current,
        [key]: (current[key] ?? 0) + 1,
      };
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            TOOLBAR_USAGE_STORAGE_KEY,
            JSON.stringify(next)
          );
        } catch {
          // ignore storage write failure
        }
      }
      return next;
    });
  }, []);

  // 获取项目ID用于上传
  const projectId = useProjectContentStore((state) => state.projectId);
  const setDrawMode = useToolStore((state) => state.setDrawMode);

  const loadProjectHistory = useCallback(
    async (options?: { reset?: boolean }) => {
      if (!projectId) {
        setProjectHistoryItems([]);
        setProjectHistoryCursor(undefined);
        setProjectHistoryHasMore(false);
        return;
      }
      if (projectHistoryLoading) return;
      const reset = options?.reset ?? false;
      setProjectHistoryLoading(true);
      try {
        const result = await globalImageHistoryApi.list({
          limit: 20,
          cursor: reset ? undefined : projectHistoryCursor,
          sourceProjectId: projectId,
        });
        setProjectHistoryItems((current) =>
          reset ? result.items : [...current, ...result.items]
        );
        setProjectHistoryCursor(result.nextCursor);
        setProjectHistoryHasMore(result.hasMore);
      } catch {
        // ignore
      } finally {
        setProjectHistoryLoading(false);
      }
    },
    [projectHistoryCursor, projectHistoryLoading, projectId]
  );

  useEffect(() => {
    if (!showPreview) {
      projectHistoryLoadedRef.current = false;
      return;
    }
    if (!projectId) {
      setProjectHistoryItems([]);
      setProjectHistoryCursor(undefined);
      setProjectHistoryHasMore(false);
      projectHistoryLoadedRef.current = false;
      return;
    }
    const shouldReset = lastLoadedProjectIdRef.current !== projectId;
    if (shouldReset) {
      projectHistoryLoadedRef.current = false;
    }
    const shouldLoad =
      shouldReset ||
      (!projectHistoryLoadedRef.current &&
        projectHistoryItems.length === 0 &&
        (projectHistoryHasMore || projectHistoryCursor === undefined));
    if (shouldReset) {
      lastLoadedProjectIdRef.current = projectId;
    }
    if (shouldLoad) {
      projectHistoryLoadedRef.current = true;
      void loadProjectHistory({ reset: true });
    }
  }, [
    loadProjectHistory,
    projectHistoryCursor,
    projectHistoryHasMore,
    projectHistoryItems.length,
    projectId,
    showPreview,
  ]);

  const relatedHistoryImages = useMemo<ImageItem[]>(() => {
    return projectHistoryItems
      .filter((item) => !!item.imageUrl?.trim())
      .map((item) => {
        const raw = item.imageUrl.trim();
        const normalized = normalizeImageSrc(raw);
        if (!normalized) return null;
        return {
          id: item.id,
          src: normalized,
          title: item.prompt || item.sourceProjectName || "图片",
          timestamp: Number.isNaN(Date.parse(item.createdAt))
            ? undefined
            : Date.parse(item.createdAt),
        };
      })
      .filter(Boolean) as ImageItem[];
  }, [projectHistoryItems]);

  // 监听 body class：图片拖拽 / 选择框拖拽时隐藏文字与工具栏，避免“跟随不紧”观感
  useEffect(() => {
    if (typeof document === "undefined" || !document.body) return;

    const compute = () => {
      const classList = document.body.classList;
      return (
        classList.contains("tanva-canvas-dragging") ||
        classList.contains("tanva-selection-dragging")
      );
    };

    const update = () => setIsBodyDragging(compute());
    update();

    const observer = new MutationObserver(update);
    try {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } catch {
      // ignore
    }

    return () => {
      try {
        observer.disconnect();
      } catch {}
    };
  }, []);

  const shouldHideUi = isCanvasDragging || isBodyDragging;

  // 将Paper.js世界坐标转换为屏幕坐标（改进版）
  const convertToScreenBounds = useCallback(
    (paperBounds: { x: number; y: number; width: number; height: number }) => {
      if (!paper.view) return paperBounds;

      try {
        const dpr = window.devicePixelRatio || 1;
        // 使用更精确的坐标转换
        const topLeft = paper.view.projectToView(
          new paper.Point(paperBounds.x, paperBounds.y)
        );
        const bottomRight = paper.view.projectToView(
          new paper.Point(
            paperBounds.x + paperBounds.width,
            paperBounds.y + paperBounds.height
          )
        );

        // 添加数值验证，防止NaN或无限值
        const result = {
          x: isFinite(topLeft.x) ? topLeft.x / dpr : paperBounds.x,
          y: isFinite(topLeft.y) ? topLeft.y / dpr : paperBounds.y,
          width: isFinite(bottomRight.x - topLeft.x)
            ? (bottomRight.x - topLeft.x) / dpr
            : paperBounds.width,
          height: isFinite(bottomRight.y - topLeft.y)
            ? (bottomRight.y - topLeft.y) / dpr
            : paperBounds.height,
        };

        return result;
      } catch (error) {
        console.warn("坐标转换失败，使用原始坐标:", error);
        return paperBounds;
      }
    },
    [zoom, panX, panY]
  ); // 添加画布状态依赖，确保画布变化时函数重新创建

  // 使用 ref 存储最新的 bounds，避免 getRealTimePaperBounds 依赖变化
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // 使用 ref 存储最新的 realTimeBounds，避免闭包过期问题
  const realTimeBoundsRef = useRef(realTimeBounds);
  realTimeBoundsRef.current = realTimeBounds;

  // 从Paper.js获取实时坐标 - 使用 ref 避免依赖变化
  const getRealTimePaperBounds = useCallback(() => {
    try {
      // 首先尝试从所有图层中查找图片对象
      const imageGroup = paper.project?.layers?.flatMap((layer) =>
        layer.children.filter(
          (child) =>
            child.data?.type === "image" && child.data?.imageId === imageData.id
        )
      )[0];

      if (isGroup(imageGroup)) {
        const raster = imageGroup.children.find((child) =>
          isRaster(child)
        ) as paper.Raster;
        if (raster && raster.bounds && isFinite(raster.bounds.x)) {
          // 获取实际的边界信息，确保数值有效
          const realBounds = {
            x: Math.round(raster.bounds.x * 100) / 100, // 四舍五入到小数点后2位
            y: Math.round(raster.bounds.y * 100) / 100,
            width: Math.round(raster.bounds.width * 100) / 100,
            height: Math.round(raster.bounds.height * 100) / 100,
          };

          // 验证bounds是否合理
          if (realBounds.width > 0 && realBounds.height > 0) {
            return realBounds;
          }
        }
      }
    } catch (error) {
      console.warn("获取Paper.js实时坐标失败:", error);
    }

    return boundsRef.current; // 使用 ref 回退到props中的bounds
  }, [imageData.id]); // 只依赖 imageData.id，函数引用更稳定

  // 监听画布状态变化，强制重新计算坐标
  useEffect(() => {
    // 当画布状态变化时，强制重新计算屏幕坐标
    const newPaperBounds = getRealTimePaperBounds();
    setRealTimeBounds(newPaperBounds);
  }, [zoom, panX, panY, getRealTimePaperBounds]); // 直接监听画布状态变化

  // 实时同步Paper.js状态 - 只在选中时启用，使用节流减少更新频率
  useEffect(() => {
    // 只在选中时才需要实时同步
    if (!isSelected) return;

    let animationFrame: number | null = null;
    let isRunning = true;
    let lastUpdateTime = 0;
    const throttleMs = 8; // 尽量贴近高刷屏的跟随体验

    const updateRealTimeBounds = () => {
      if (!isRunning) return;

      const now = performance.now();
      if (now - lastUpdateTime < throttleMs) {
        animationFrame = requestAnimationFrame(updateRealTimeBounds);
        return;
      }
      lastUpdateTime = now;

      const paperBounds = getRealTimePaperBounds();
      const currentBounds = realTimeBoundsRef.current;

      // 以“视图像素”为基准做容差：zoom 越大，同样的世界坐标差在屏幕上越明显
      // 这里 world 单位近似是 device px，因此容差要除以 zoom，避免放大后出现明显“跟不上”
      const zoomFactor = Math.max(
        0.0001,
        Number((paper.view as any)?.zoom ?? 1) || 1
      );
      const toleranceWorld = 0.25 / zoomFactor;

      // 检查坐标是否发生变化 - 使用 ref 获取最新值
      const hasChanged =
        Math.abs(paperBounds.x - currentBounds.x) > toleranceWorld ||
        Math.abs(paperBounds.y - currentBounds.y) > toleranceWorld ||
        Math.abs(paperBounds.width - currentBounds.width) > toleranceWorld ||
        Math.abs(paperBounds.height - currentBounds.height) > toleranceWorld;

      if (hasChanged) {
        setRealTimeBounds(paperBounds);
      }

      // 继续下一帧
      if (isRunning) {
        animationFrame = requestAnimationFrame(updateRealTimeBounds);
      }
    };

    // 立即更新一次，然后开始循环
    const paperBounds = getRealTimePaperBounds();
    setRealTimeBounds(paperBounds);
    animationFrame = requestAnimationFrame(updateRealTimeBounds);

    return () => {
      isRunning = false;
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isSelected, getRealTimePaperBounds]);

  // 同步Props bounds变化
  useEffect(() => {
    setRealTimeBounds(bounds);
  }, [bounds]);

  // 获取图片真实像素尺寸
  useEffect(() => {
    const metaWidth = imageData.width;
    const metaHeight = imageData.height;
    if (
      typeof metaWidth === "number" &&
      Number.isFinite(metaWidth) &&
      metaWidth > 0 &&
      typeof metaHeight === "number" &&
      Number.isFinite(metaHeight) &&
      metaHeight > 0
    ) {
      setNaturalSize({
        width: Math.round(metaWidth),
        height: Math.round(metaHeight),
      });
      return;
    }

    // 仅在需要展示分辨率（选中态）且缺少元数据时才加载图片，避免重复请求/解码
    if (!isSelected) {
      setNaturalSize(null);
      return;
    }

    const rawSource =
      imageData.remoteUrl ||
      imageData.url ||
      imageData.key ||
      imageData.src ||
      (imageData.pendingUpload ? imageData.localDataUrl : undefined);
    const src = rawSource ? toRenderableImageSrc(rawSource) || "" : "";
    if (!src) {
      setNaturalSize(null);
      return;
    }

    let canceled = false;
    const img = new Image();
    img.onload = () => {
      if (canceled) return;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > 0 && h > 0) {
        setNaturalSize({ width: w, height: h });
      }
    };
    img.onerror = () => {
      if (canceled) return;
      setNaturalSize(null);
    };
    img.src = src;

    return () => {
      canceled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [
    imageData.width,
    imageData.height,
      imageData.remoteUrl,
      imageData.url,
      imageData.key,
      imageData.src,
      imageData.localDataUrl,
      imageData.pendingUpload,
      isSelected,
  ]);

  // 使用实时坐标进行屏幕坐标转换
  const screenBounds = useMemo(() => {
    return convertToScreenBounds(realTimeBounds);
  }, [realTimeBounds, convertToScreenBounds, zoom, panX, panY]); // 添加画布状态依赖，确保完全响应画布变化

  const screenPerWorldX =
    realTimeBounds.width > 0 && screenBounds.width > 0
      ? screenBounds.width / realTimeBounds.width
      : 1;
  const screenPerWorldY =
    realTimeBounds.height > 0 && screenBounds.height > 0
      ? screenBounds.height / realTimeBounds.height
      : 1;
  const worldPerScreenX =
    screenBounds.width > 0 && realTimeBounds.width > 0
      ? realTimeBounds.width / screenBounds.width
      : 1;
  const worldPerScreenY =
    screenBounds.height > 0 && realTimeBounds.height > 0
      ? realTimeBounds.height / screenBounds.height
      : 1;

  const clampCropRectToImage = useCallback(
    (
      rect: CropRect,
      minWidthWorld: number,
      minHeightWorld: number,
      limitBounds?: { x: number; y: number; width: number; height: number }
    ): CropRect => {
      const activeBounds = limitBounds || cropSourceBounds || realTimeBounds;
      const imageLeft = activeBounds.x;
      const imageTop = activeBounds.y;
      const imageRight = activeBounds.x + activeBounds.width;
      const imageBottom = activeBounds.y + activeBounds.height;
      const imageWidth = Math.max(1, imageRight - imageLeft);
      const imageHeight = Math.max(1, imageBottom - imageTop);
      const safeMinWidth = Math.max(1, Math.min(minWidthWorld, imageWidth));
      const safeMinHeight = Math.max(1, Math.min(minHeightWorld, imageHeight));

      let x = Number.isFinite(rect.x) ? rect.x : imageLeft;
      let y = Number.isFinite(rect.y) ? rect.y : imageTop;
      let width = Number.isFinite(rect.width) ? rect.width : imageWidth;
      let height = Number.isFinite(rect.height) ? rect.height : imageHeight;

      width = Math.max(safeMinWidth, Math.min(width, imageWidth));
      height = Math.max(safeMinHeight, Math.min(height, imageHeight));
      x = Math.max(imageLeft, Math.min(x, imageRight - safeMinWidth));
      y = Math.max(imageTop, Math.min(y, imageBottom - safeMinHeight));

      if (x + width > imageRight) {
        width = imageRight - x;
      }
      if (y + height > imageBottom) {
        height = imageBottom - y;
      }

      width = Math.max(1, width);
      height = Math.max(1, height);

      return { x, y, width, height };
    },
    [
      cropSourceBounds,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
    ]
  );

  const cropRectScreen = useMemo(() => {
    if (!isCropping || !cropRect) return null;
    const activeBounds = cropSourceBounds || realTimeBounds;
    const activeWidth = Math.max(1, activeBounds.width);
    const activeHeight = Math.max(1, activeBounds.height);
    const activeScreenPerWorldX =
      activeWidth > 0 && screenBounds.width > 0 ? screenBounds.width / activeWidth : 1;
    const activeScreenPerWorldY =
      activeHeight > 0 && screenBounds.height > 0
        ? screenBounds.height / activeHeight
        : 1;
    return {
      x: (cropRect.x - activeBounds.x) * activeScreenPerWorldX,
      y: (cropRect.y - activeBounds.y) * activeScreenPerWorldY,
      width: cropRect.width * activeScreenPerWorldX,
      height: cropRect.height * activeScreenPerWorldY,
    };
  }, [
    cropSourceBounds,
    cropRect,
    isCropping,
    realTimeBounds,
    screenBounds.height,
    screenBounds.width,
  ]);

  const cancelCrop = useCallback(() => {
    setIsApplyingCrop(false);
    setIsCropping(false);
    setCropRect(null);
    setCropSourceBounds(null);
  }, []);

  useEffect(() => {
    if (isSelected && visible && !isImageLocked) return;
    if (!isCropping && !cropRect && !isApplyingCrop) return;
    cancelCrop();
  }, [
    cancelCrop,
    cropRect,
    isApplyingCrop,
    isCropping,
    isImageLocked,
    isSelected,
    visible,
  ]);

  const handleCropHandleMouseDown = useCallback(
    (handle: CropHandle) => (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!cropRect) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = { ...cropRect };
      const minWidthWorld = Math.max(1, 28 * worldPerScreenX);
      const minHeightWorld = Math.max(1, 28 * worldPerScreenY);
      const activeBounds = cropSourceBounds || realTimeBounds;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dxWorld = (moveEvent.clientX - startX) * worldPerScreenX;
        const dyWorld = (moveEvent.clientY - startY) * worldPerScreenY;

        const imageLeft = activeBounds.x;
        const imageTop = activeBounds.y;
        const imageRight = activeBounds.x + activeBounds.width;
        const imageBottom = activeBounds.y + activeBounds.height;

        const startLeft = startRect.x;
        const startTop = startRect.y;
        const startRight = startRect.x + startRect.width;
        const startBottom = startRect.y + startRect.height;

        // 拖动一条边时，对边固定不动，避免出现“整框联动”。
        let left = startLeft;
        let right = startRight;
        let top = startTop;
        let bottom = startBottom;

        if (handle.includes("w")) {
          left = clampNumber(
            startLeft + dxWorld,
            imageLeft,
            startRight - minWidthWorld
          );
        }
        if (handle.includes("e")) {
          right = clampNumber(
            startRight + dxWorld,
            startLeft + minWidthWorld,
            imageRight
          );
        }
        if (handle.includes("n")) {
          top = clampNumber(
            startTop + dyWorld,
            imageTop,
            startBottom - minHeightWorld
          );
        }
        if (handle.includes("s")) {
          bottom = clampNumber(
            startBottom + dyWorld,
            startTop + minHeightWorld,
            imageBottom
          );
        }

        setCropRect({
          x: left,
          y: top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        });
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [
      cropSourceBounds,
      cropRect,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
      worldPerScreenX,
      worldPerScreenY,
    ]
  );

  useEffect(() => {
    if (!isImageLocked || typeof window === "undefined") {
      setIsHoveringLockedImage(false);
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const canvasEl =
        (paper?.view?.element as HTMLCanvasElement | undefined) || null;
      if (!canvasEl) {
        setIsHoveringLockedImage(false);
        return;
      }

      const rect = canvasEl.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const inside =
        localX >= screenBounds.x &&
        localX <= screenBounds.x + screenBounds.width &&
        localY >= screenBounds.y &&
        localY <= screenBounds.y + screenBounds.height;

      setIsHoveringLockedImage(inside);
    };

    const handleMouseLeave = () => setIsHoveringLockedImage(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [isImageLocked, screenBounds.height, screenBounds.width, screenBounds.x, screenBounds.y]);

  const resolveImageDataUrl = useCallback(async (): Promise<string | null> => {
    const preferredSource =
      getImageDataForEditing?.(imageData.id) ||
      imageData.remoteUrl ||
      imageData.url ||
      imageData.key ||
      imageData.src ||
      (imageData.pendingUpload ? imageData.localDataUrl : undefined) ||
      null;
    const preferredFingerprint = buildImageSourceFingerprint(preferredSource);

    // 首先检查缓存的 dataUrl
    const cachedDataUrl = await imageUrlCache.getCachedDataUrl(
      imageData.id,
      projectId,
      preferredFingerprint
    );
    if (cachedDataUrl) {
      return cachedDataUrl;
    }

    const ensureDataUrl = async (
      input: string | null
    ): Promise<string | null> => {
      if (!input) return null;
      return await resolveImageToDataUrl(input, { preferProxy: true });
    };

    let result: string | null = null;

    const editingSource = getImageDataForEditing?.(imageData.id) || null;
    const editingFingerprint = buildImageSourceFingerprint(editingSource);

    if (editingSource) {
      result = await ensureDataUrl(editingSource);
      if (result) {
        // 缓存结果
        void imageUrlCache.updateDataUrl(
          imageData.id,
          result,
          projectId,
          editingFingerprint
        );
        return result;
      }
    }

    const urlSource =
      imageData.remoteUrl ||
      imageData.url ||
      imageData.key ||
      imageData.src ||
      (imageData.pendingUpload ? imageData.localDataUrl : undefined) ||
      null;
    result = await ensureDataUrl(urlSource);
    const urlFingerprint = buildImageSourceFingerprint(urlSource);
    if (result) {
      // 缓存结果
      void imageUrlCache.updateDataUrl(
        imageData.id,
        result,
        projectId,
        urlFingerprint
      );
      return result;
    }

    console.warn("⚠️ 未找到原始图像数据，尝试从Canvas抓取");
    const imageGroup = paper.project?.layers?.flatMap((layer) =>
      layer.children.filter(
        (child) =>
          child.data?.type === "image" && child.data?.imageId === imageData.id
      )
    )[0];

    if (imageGroup) {
      const raster = imageGroup.children.find((child) =>
        isRaster(child)
      ) as paper.Raster;
      if (raster && raster.canvas) {
        const canvasData = await canvasToDataUrl(raster.canvas, "image/png");
        result = await ensureDataUrl(canvasData);
        if (result) {
          // 缓存结果
          void imageUrlCache.updateDataUrl(
            imageData.id,
            result,
            projectId,
            urlFingerprint
          );
          return result;
        }
      }
    }

    return null;
  }, [
    getImageDataForEditing,
    imageData.id,
    imageData.key,
    imageData.pendingUpload,
    imageData.url,
    imageData.src,
    imageData.remoteUrl,
    imageData.localDataUrl,
    projectId,
  ]);

  const handleExtractPalette = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isExtractingPalette) return;

      const run = async () => {
        setIsExtractingPalette(true);
        try {
          // 优先取当前画布里正在渲染的图，确保调色板与所见一致。
          let sourceImage: string | null = null;
          const imageGroup = paper.project?.layers?.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "image" && child.data?.imageId === imageData.id
            )
          )[0];
          if (isGroup(imageGroup)) {
            const raster = imageGroup.children.find((child) =>
              isRaster(child)
            ) as paper.Raster | undefined;
            if (raster?.canvas) {
              sourceImage = await canvasToDataUrl(raster.canvas, "image/png");
            }
          }

          if (!sourceImage) {
            sourceImage = await resolveImageDataUrl();
          }
          if (!sourceImage) {
            throw new Error("无法获取图片数据，提取调色板失败");
          }

          const colors = await extractPaletteFromImageDataUrl(
            sourceImage,
            DEFAULT_PALETTE_SIZE
          );
          if (colors.length === 0) {
            throw new Error("未提取到有效颜色");
          }

          const paletteAspectRatio = PALETTE_STRIP_WIDTH_PX / PALETTE_STRIP_HEIGHT_PX;
          const paletteDisplayHeight = Math.max(
            PALETTE_MIN_DISPLAY_HEIGHT_PX,
            Math.round(realTimeBounds.height)
          );
          const paletteDisplayWidth = Math.max(
            PALETTE_MIN_DISPLAY_WIDTH_PX,
            Math.round(paletteDisplayHeight * paletteAspectRatio)
          );
          const paletteImageDataUrl = await buildPaletteStripDataUrl(colors, {
            width: paletteDisplayWidth,
            height: paletteDisplayHeight,
          });
          const selectedPaletteBounds = {
            x: realTimeBounds.x + realTimeBounds.width + PALETTE_IMAGE_GAP_WORLD,
            y: realTimeBounds.y,
            width: paletteDisplayWidth,
            height: paletteDisplayHeight,
          };
          const paletteCenter = {
            x:
              realTimeBounds.x +
              realTimeBounds.width +
              PALETTE_IMAGE_GAP_WORLD +
              paletteDisplayWidth / 2,
            y: realTimeBounds.y + realTimeBounds.height / 2,
          };

          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: paletteImageDataUrl,
                fileName: `palette-strip-${Date.now()}.png`,
                selectedImageBounds: selectedPaletteBounds,
                smartPosition: paletteCenter,
                operationType: "palette",
                sourceImageId: imageData.id,
              },
            })
          );

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: `🎨 已生成调色板图（${colors.length} 色）`,
                type: "success",
              },
            })
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "提取调色板失败";
          logger.error("提取调色板失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsExtractingPalette(false);
        }
      };

      run().catch((error) => {
        logger.error("提取调色板异常", error);
        setIsExtractingPalette(false);
      });
    },
    [
      imageData.id,
      isExtractingPalette,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
      resolveImageDataUrl,
    ]
  );

  // 处理AI编辑按钮点击
  const handleAIEdit = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const run = async () => {
        const remoteCandidate = (() => {
          const candidates = [imageData.remoteUrl, imageData.src, imageData.url];
          for (const candidate of candidates) {
            if (typeof candidate !== "string") continue;
            const trimmed = candidate.trim();
            if (!trimmed) continue;
            const normalized = normalizePersistableImageRef(trimmed) || trimmed;
            if (isRemoteUrl(normalized)) return normalized;
          }
          return null;
        })();

        const imageSource = remoteCandidate || (await resolveImageDataUrl());
        if (!imageSource) {
          console.error("❌ 无法获取图像数据");
          return;
        }

        // 检查是否已有图片，如果有则添加到融合模式，否则设置为编辑图片
        const hasExistingImages =
          sourceImageForEditing || sourceImagesForBlending.length > 0;

        if (hasExistingImages) {
          // 如果有编辑图片，先将其转换为融合模式
          if (sourceImageForEditing) {
            addImageForBlending(sourceImageForEditing);
            setSourceImageForEditing(null);
            logger.debug("🎨 将编辑图像转换为融合模式");
          }

          // 已有图片：添加新图片到融合模式
          addImageForBlending(imageSource);
          logger.debug("🎨 已添加图像到融合模式");
        } else {
          // 没有现有图片：设置为编辑图片
          setSourceImageForEditing(imageSource);
          logger.debug("🎨 已设置图像为编辑模式");
        }

        showDialog();
      };

      run().catch((error) => {
        console.error("获取图像数据失败:", error);
      });
    },
    [
      resolveImageDataUrl,
      setSourceImageForEditing,
      addImageForBlending,
      showDialog,
      sourceImageForEditing,
      sourceImagesForBlending,
      imageData.remoteUrl,
      imageData.src,
      imageData.url,
    ]
  );

  // 处理切换可见性按钮点击
  const handleToggleVisibility = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (onToggleVisibility) {
        onToggleVisibility(imageData.id);
        logger.debug("👁️‍🗨️ 切换图层可见性:", imageData.id);
      }
    },
    [imageData.id, onToggleVisibility]
  );

  const handleCreateFlowImageNode = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const run = async () => {
        const persistableRef = (() => {
          const candidates = [
            imageData.remoteUrl,
            imageData.key,
            imageData.url,
            imageData.src,
          ];
          for (const candidate of candidates) {
            if (typeof candidate !== "string") continue;
            const trimmed = candidate.trim();
            if (!trimmed) continue;
            const normalized = normalizePersistableImageRef(trimmed) || trimmed;
            if (isPersistableImageRef(normalized)) return normalized;
          }
          return null;
        })();

        // 优先走远程引用，避免把 base64 写入 Flow 节点/项目 JSON
        if (persistableRef) {
          const resolvedImageUrl =
            toRenderableImageSrc(persistableRef) ?? persistableRef;
          window.dispatchEvent(
            new CustomEvent("flow:createImageNode", {
              detail: {
                imageUrl: resolvedImageUrl,
                label: "Image",
                imageName: imageData.fileName || `图片 ${imageData.id}`,
              },
            })
          );
          logger.debug("🧩 已请求创建Flow Image节点（remote）");
          return;
        }

        const imageDataUrl = await resolveImageDataUrl();
        if (!imageDataUrl) {
          console.warn("⚠️ 无法获取图像数据，无法创建Flow节点");
          return;
        }
        const base64 = imageDataUrl.includes(",")
          ? imageDataUrl.split(",")[1]
          : imageDataUrl;
        window.dispatchEvent(
          new CustomEvent("flow:createImageNode", {
            detail: {
              imageData: base64,
              label: "Image",
              imageName: imageData.fileName || `图片 ${imageData.id}`,
            },
          })
        );
        logger.debug("🧩 已请求创建Flow Image节点");
      };

      run().catch((error) => {
        console.error("将图片发送到Flow失败:", error);
      });
    },
    [
      imageData.fileName,
      imageData.id,
      imageData.key,
      imageData.remoteUrl,
      imageData.src,
      imageData.url,
      resolveImageDataUrl,
    ]
  );

  const handleRecognizeImageText = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isRecognizingText || isApplyingTextEdit) {
        return;
      }

      const run = async () => {
        setShowTextEditPanel(true);
        setTextReplacementItems([]);
        setTextEditExtraInstruction("");
        setIsRecognizingText(true);

        try {
          const sourceImage = await resolveImageDataUrl();
          if (!sourceImage) {
            throw new Error("无法获取原图，无法识别文字");
          }

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "🔎 正在识别图片文字...",
                type: "info",
              },
            })
          );

          const bananaProvider = "banana";
          const bananaModel = getImageModelForProvider(bananaProvider);
          const result = await aiImageService.analyzeImage({
            prompt: TEXT_RECOGNITION_PROMPT,
            sourceImage,
            aiProvider: bananaProvider,
            model: bananaModel,
            providerOptions: {
              banana: { imageRoute: bananaImageRoute },
              bananaImageRoute,
            },
          });

          if (!result.success || !result.data?.analysis) {
            throw new Error(result.error?.message || "文字识别失败");
          }

          const recognized = parseRecognizedTexts(result.data.analysis);
          const mapped = recognized.map((text, index) => ({
            id: `${Date.now()}-${index}`,
            originalText: text,
            nextText: "",
          }));

          setTextReplacementItems(mapped);

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message:
                  mapped.length > 0
                    ? `✅ 识别到 ${mapped.length} 条文字`
                    : "⚠️ 未识别到明确文字，请补充替换说明后尝试修改",
                type: mapped.length > 0 ? "success" : "warning",
              },
            })
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "文字识别失败";
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
          setShowTextEditPanel(false);
        } finally {
          setIsRecognizingText(false);
        }
      };

      run().catch(() => {
        setIsRecognizingText(false);
      });
    },
    [isApplyingTextEdit, isRecognizingText, resolveImageDataUrl]
  );

  const handleApplyTextEdit = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isApplyingTextEdit || isRecognizingText) {
        return;
      }

      const replacements = textReplacementItems
        .map((item) => ({
          originalText: item.originalText.trim(),
          nextText: item.nextText.trim(),
        }))
        .filter(
          (item) =>
            item.originalText.length > 0 &&
            item.nextText.length > 0 &&
            item.originalText !== item.nextText
        );

      if (replacements.length === 0 && !textEditExtraInstruction.trim()) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: "请先填写需要替换的新文字或补充修改说明",
              type: "warning",
            },
          })
        );
        return;
      }

      setIsApplyingTextEdit(true);
      try {
        const sourceImage = await resolveImageDataUrl();
        if (!sourceImage) {
          throw new Error("无法获取原图");
        }

        const prompt = buildTextEditPrompt(
          replacements,
          textEditExtraInstruction
        );
        const bananaProvider = "banana";
        const bananaModel = getImageModelForProvider(bananaProvider);

        const result = await aiImageService.editImage({
          prompt,
          sourceImage,
          aiProvider: bananaProvider,
          model: bananaModel,
          outputFormat: "png",
          imageOnly: true,
        });

        if (!result.success || !result.data?.imageData) {
          throw new Error(result.error?.message || "图片文字修改失败");
        }

        const editedImageData = ensureDataUrlString(result.data.imageData);
        const centerPoint = {
          x: realTimeBounds.x + realTimeBounds.width / 2,
          y: realTimeBounds.y + realTimeBounds.height / 2,
        };

        window.dispatchEvent(
          new CustomEvent("triggerQuickImageUpload", {
            detail: {
              imageData: editedImageData,
              fileName: `text-edited-${Date.now()}.png`,
              smartPosition: centerPoint,
              operationType: "text-edit",
              sourceImageId: imageData.id,
            },
          })
        );

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "✨ 文字修改完成，已生成新图", type: "success" },
          })
        );

        setShowTextEditPanel(false);
        setTextReplacementItems([]);
        setTextEditExtraInstruction("");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "图片文字修改失败";
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message, type: "error" },
          })
        );
      } finally {
        setIsApplyingTextEdit(false);
      }
    },
    [
      imageData.id,
      isApplyingTextEdit,
      isRecognizingText,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
      resolveImageDataUrl,
      textEditExtraInstruction,
      textReplacementItems,
    ]
  );

  const runBackgroundRemoval = useCallback(
    async (
      baseImage: string,
      options?: { showToasts?: boolean }
    ): Promise<string> => {
      const showToasts = options?.showToasts ?? true;

      logger.info("🎯 开始背景移除", { imageId: imageData.id });

      // 仅用于「一键抠图 / 一键分层(主体层)」的预处理模型优先级
      // 顺序：2.5 -> 3.1 -> 3 pro
      const BG_REMOVAL_MODELS = [
        "gemini-2.5-flash-image",
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-image-preview",
      ] as const;
      const BG_REMOVAL_PROVIDER = "banana"; // 改用Pro版获得更好的质量

      logger.info("📷 Step 1: Gemini 预处理 - 背景换成纯色", {
        aiProvider: BG_REMOVAL_PROVIDER,
        modelPriority: BG_REMOVAL_MODELS,
      });

      if (showToasts) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "🔄 正在预处理图片...", type: "info" },
          })
        );
      }

      let preprocessedImage: string | null = null;
      let selectedModel: string | null = null;
      let lastError: unknown = null;

      for (const model of BG_REMOVAL_MODELS) {
        logger.info("📷 尝试预处理模型", {
          aiProvider: BG_REMOVAL_PROVIDER,
          model,
        });
        const editResult = await aiImageService.editImage({
          prompt: "只保留完整的主体，背景换成纯色",
          sourceImage: baseImage,
          model,
          aiProvider: BG_REMOVAL_PROVIDER,
          outputFormat: "png",
          imageOnly: true,
        });

        if (editResult.success && editResult.data?.imageData) {
          selectedModel = model;
          preprocessedImage = ensureDataUrlString(
            editResult.data.imageData,
            "image/png"
          );
          break;
        }

        lastError = editResult.error;
        logger.warn("⚠️ 预处理模型失败，准备切换下一个模型", {
          model,
          error: editResult.error,
        });
      }

      if (!preprocessedImage) {
        logger.warn("⚠️ Gemini 预处理全部失败，使用原图继续抠图", lastError);
      }

      const imageForRemoval = preprocessedImage ?? baseImage;

      if (showToasts && preprocessedImage) {
        logger.info("✅ Gemini 预处理完成，开始抠图算法");
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "🔄 正在精细抠图...", type: "info" },
          })
        );
      }

      if (selectedModel) {
        logger.info("✅ 预处理命中模型", {
          imageId: imageData.id,
          model: selectedModel,
        });
      }

      // Step 2: 将预处理后的图片传给抠图算法
      logger.info("📷 Step 2: 抠图算法处理");
      const result = await backgroundRemovalService.removeBackground(
        imageForRemoval,
        "image/png",
        true
      );
      if (!result.success || !result.imageData) {
        throw new Error(result.error || "背景移除失败");
      }

      return result.imageData;
    },
    [imageData.id]
  );

  const runFastBackgroundRemoval = useCallback(
    async (baseImage: string): Promise<string> => {
      logger.info("⚡ 开始极速抠图", { imageId: imageData.id });
      const result = await backgroundRemovalService.removeBackground(
        baseImage,
        "image/png",
        true
      );
      if (!result.success || !result.imageData) {
        throw new Error(result.error || "极速抠图失败");
      }
      return result.imageData;
    },
    [imageData.id]
  );

  const handleBackgroundRemoval = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isRemovingBackground || isFastRemovingBackground || isSeparatingLayers) {
        return;
      }

      const execute = async () => {
        const baseImage = await resolveImageDataUrl();
        if (!baseImage) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "无法获取原图，无法抠图", type: "error" },
            })
          );
          return;
        }

        setIsRemovingBackground(true);
        try {
          const removedData = await runBackgroundRemoval(baseImage, {
            showToasts: true,
          });

          const centerPoint = {
            x: realTimeBounds.x + realTimeBounds.width / 2,
            y: realTimeBounds.y + realTimeBounds.height / 2,
          };

          const fileName = `background-removed-${Date.now()}.png`;
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: removedData,
                fileName,
                smartPosition: centerPoint,
                operationType: "background-removal",
                sourceImageId: imageData.id,
              },
            })
          );

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "✨ 抠图完成，已生成新图", type: "success" },
            })
          );
          logger.info("✅ 背景移除完成", { imageId: imageData.id });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "背景移除失败";
          console.error("背景移除失败:", error);
          logger.error("❌ 背景移除失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsRemovingBackground(false);
        }
      };

      execute().catch((error) => {
        console.error("抠图异常:", error);
        setIsRemovingBackground(false);
      });
    },
    [
      imageData.id,
      resolveImageDataUrl,
      isRemovingBackground,
      isFastRemovingBackground,
      isSeparatingLayers,
      realTimeBounds,
      runBackgroundRemoval,
    ]
  );

  const handleFastBackgroundRemoval = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isRemovingBackground || isFastRemovingBackground || isSeparatingLayers) {
        return;
      }

      const execute = async () => {
        const baseImage = await resolveImageDataUrl();
        if (!baseImage) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "无法获取原图，无法抠图", type: "error" },
            })
          );
          return;
        }

        setIsFastRemovingBackground(true);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "⚡ 正在极速抠图...", type: "info" },
          })
        );
        try {
          const removedData = await runFastBackgroundRemoval(baseImage);

          const centerPoint = {
            x: realTimeBounds.x + realTimeBounds.width / 2,
            y: realTimeBounds.y + realTimeBounds.height / 2,
          };

          const fileName = `background-removed-fast-${Date.now()}.png`;
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: removedData,
                fileName,
                smartPosition: centerPoint,
                operationType: "background-removal-fast",
                sourceImageId: imageData.id,
              },
            })
          );

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "⚡ 极速抠图完成，已生成新图", type: "success" },
            })
          );
          logger.info("✅ 极速抠图完成", { imageId: imageData.id });
        } catch (error) {
          const message = error instanceof Error ? error.message : "极速抠图失败";
          console.error("极速抠图失败:", error);
          logger.error("❌ 极速抠图失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsFastRemovingBackground(false);
        }
      };

      execute().catch((error) => {
        console.error("极速抠图异常:", error);
        setIsFastRemovingBackground(false);
      });
    },
    [
      imageData.id,
      isFastRemovingBackground,
      isRemovingBackground,
      isSeparatingLayers,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
      resolveImageDataUrl,
      runFastBackgroundRemoval,
    ]
  );

  const extractBackgroundLayer = useCallback(
    async (baseImage: string): Promise<string> => {
      const BG_EXTRACT_MODEL = "gemini-2.5-flash-image";
      const BG_EXTRACT_PROVIDER = "banana";
      const prompt =
        "去掉画面中的主体，只保留背景。保持背景内容、颜色、光影和风格不变，并自然补全被遮挡的区域。";

      const result = await aiImageService.editImage({
        prompt,
        sourceImage: baseImage,
        model: BG_EXTRACT_MODEL,
        aiProvider: BG_EXTRACT_PROVIDER,
        outputFormat: "png",
        imageOnly: true,
      });

      if (!result.success || !result.data?.imageData) {
        throw new Error(result.error?.message || "背景提取失败");
      }

      return ensureDataUrlString(result.data.imageData, "image/png");
    },
    []
  );

  const detectImageText = useCallback(async (baseImage: string): Promise<string[]> => {
    const bananaProvider = "banana";
    const bananaModel = getImageModelForProvider(bananaProvider);
    const result = await aiImageService.analyzeImage({
      prompt: TEXT_RECOGNITION_PROMPT,
      sourceImage: baseImage,
      aiProvider: bananaProvider,
      model: bananaModel,
      providerOptions: {
        banana: { imageRoute: bananaImageRoute },
        bananaImageRoute,
      },
    });

    if (!result.success || !result.data?.analysis) {
      throw new Error(result.error?.message || "文字识别失败");
    }

    return parseRecognizedTexts(result.data.analysis);
  }, [bananaImageRoute]);

  const extractTextLayer = useCallback(async (baseImage: string): Promise<string> => {
    const TEXT_LAYER_MODEL = "gemini-2.5-flash-image";
    const TEXT_LAYER_PROVIDER = "banana";
    const prompt =
      "提取出来图中的文字，保留文字和文字本身的颜色样式，图形都不要，背景留白色。";

    const result = await aiImageService.editImage({
      prompt,
      sourceImage: baseImage,
      model: TEXT_LAYER_MODEL,
      aiProvider: TEXT_LAYER_PROVIDER,
      outputFormat: "png",
      imageOnly: true,
    });

    if (!result.success || !result.data?.imageData) {
      throw new Error(result.error?.message || "文字层提取失败");
    }

    return ensureDataUrlString(result.data.imageData, "image/png");
  }, []);

  const removeTextLayer = useCallback(async (baseImage: string): Promise<string> => {
    const TEXT_REMOVE_MODEL = "gemini-2.5-flash-image";
    const TEXT_REMOVE_PROVIDER = "banana";
    const prompt =
      "去掉画面中的所有文字与文字相关图形元素，保留主体、背景、构图、颜色和光影不变，并自然补全被遮挡的区域。";

    const result = await aiImageService.editImage({
      prompt,
      sourceImage: baseImage,
      model: TEXT_REMOVE_MODEL,
      aiProvider: TEXT_REMOVE_PROVIDER,
      outputFormat: "png",
      imageOnly: true,
    });

    if (!result.success || !result.data?.imageData) {
      throw new Error(result.error?.message || "去文字处理失败");
    }

    return ensureDataUrlString(result.data.imageData, "image/png");
  }, []);

  const handleLayerSeparation = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isSeparatingLayers || isRemovingBackground || isFastRemovingBackground) {
        return;
      }

      const execute = async () => {
        const baseImage = await resolveImageDataUrl();
        if (!baseImage) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "无法获取原图，无法分层", type: "error" },
            })
          );
          return;
        }

        setIsSeparatingLayers(true);
        const batchId = Date.now();
        const groupId = `layer-split-${imageData.id}-${batchId}`;
        const centerPoint = {
          x: realTimeBounds.x + realTimeBounds.width / 2,
          y: realTimeBounds.y + realTimeBounds.height / 2,
        };
        const placementGap = Math.max(
          32,
          Math.min(120, realTimeBounds.width * 0.1)
        );
        const anchorPoint = {
          x: centerPoint.x + realTimeBounds.width + placementGap,
          y: centerPoint.y,
        };

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "🔄 正在分离主体和背景...", type: "info" },
          })
        );

        let workingImage = baseImage;
        const outputs: Array<{ label: string; imageData: string }> = [];

        let detectedTexts: string[] = [];
        try {
          detectedTexts = await detectImageText(baseImage);
        } catch (error) {
          logger.warn("文字识别失败，跳过文字分离", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "⚠️ 文字识别失败，将直接分层",
                type: "warning",
              },
            })
          );
        }

        if (detectedTexts.length > 0) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "📝 检测到文字，正在分离文字...", type: "info" },
            })
          );

          const [textLayerResult, textlessResult] = await Promise.allSettled([
            extractTextLayer(baseImage),
            removeTextLayer(baseImage),
          ]);

          if (textLayerResult.status === "fulfilled") {
            outputs.push({ label: "text-layer", imageData: textLayerResult.value });
          } else {
            logger.error("文字层生成失败", textLayerResult.reason);
          }

          if (textlessResult.status === "fulfilled") {
            outputs.push({ label: "textless-image", imageData: textlessResult.value });
            workingImage = textlessResult.value;
          } else {
            logger.error("去文字处理失败", textlessResult.reason);
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: {
                  message: "⚠️ 去文字失败，将使用原图继续分层",
                  type: "warning",
                },
              })
            );
          }
        }

        const [subjectResult, backgroundResult] = await Promise.allSettled([
          runBackgroundRemoval(workingImage, { showToasts: false }),
          extractBackgroundLayer(workingImage),
        ]);

        if (subjectResult.status === "fulfilled") {
          outputs.push({ label: "subject-layer", imageData: subjectResult.value });
        } else {
          logger.error("主体层生成失败", subjectResult.reason);
        }

        if (backgroundResult.status === "fulfilled") {
          outputs.push({ label: "background-layer", imageData: backgroundResult.value });
        } else {
          logger.error("背景层生成失败", backgroundResult.reason);
          // 如果是基于去文字图失败，尝试回退到原图再生成一次背景层
          if (workingImage !== baseImage) {
            try {
              const fallbackBackground = await extractBackgroundLayer(baseImage);
              outputs.push({ label: "background-layer", imageData: fallbackBackground });
              window.dispatchEvent(
                new CustomEvent("toast", {
                  detail: {
                    message: "⚠️ 背景层回退使用原图生成",
                    type: "warning",
                  },
                })
              );
            } catch (fallbackError) {
              logger.error("背景层回退生成失败", fallbackError);
            }
          }
        }

        const totalCount = outputs.length;
        if (totalCount === 0) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "分层失败，请稍后重试", type: "error" },
            })
          );
          return;
        }

        outputs.forEach((item, index) => {
          const fileName = `layer-${item.label}-${batchId}.png`;
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: item.imageData,
                fileName,
                smartPosition: anchorPoint,
                operationType: "layer-split",
                sourceImageId: imageData.id,
                parallelGroupId: groupId,
                parallelGroupIndex: index,
                parallelGroupTotal: totalCount,
              },
            })
          );
        });

        if (totalCount >= 4) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "✨ 分层完成，已生成文字层、去文字图、主体层和背景层",
                type: "success",
              },
            })
          );
        } else if (totalCount >= 2) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "✨ 分层完成，已生成主体层和背景层",
                type: "success",
              },
            })
          );
        } else {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "分层部分完成，已生成部分结果",
                type: "warning",
              },
            })
          );
        }
      };

      execute()
        .catch((error) => {
          logger.error("分层异常", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "分层失败，请稍后重试", type: "error" },
            })
          );
        })
        .finally(() => {
          setIsSeparatingLayers(false);
        });
    },
    [
      detectImageText,
      extractBackgroundLayer,
      extractTextLayer,
      isFastRemovingBackground,
      imageData.id,
      isRemovingBackground,
      isSeparatingLayers,
      removeTextLayer,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
      resolveImageDataUrl,
      runBackgroundRemoval,
    ]
  );

  // 处理2D转3D按钮点击
  const handleConvertTo3D = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isConvertingTo3D) {
        return;
      }

      const execute = async () => {
        setIsConvertingTo3D(true);
        try {
          // 获取当前选中图片的URL，优先从Paper.js的raster获取
          let imageUrl: string;
          const imageGroup = paper.project?.layers?.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "image" &&
                child.data?.imageId === imageData.id
            )
          )[0];

          let rasterSource: string | null = null;
          let rasterRemoteUrl: string | null = null;
          if (imageGroup) {
            const raster = imageGroup.children.find((child) =>
              isRaster(child)
            ) as paper.Raster | undefined;
            if (raster) {
              if (raster.source) {
                rasterSource =
                  typeof raster.source === "string" ? raster.source : null;
              }
              const metaRemote =
                typeof (raster as any)?.data?.remoteUrl === "string"
                  ? normalizePersistableImageRef((raster as any).data.remoteUrl)
                  : "";
              rasterRemoteUrl = metaRemote && isRemoteUrl(metaRemote) ? metaRemote : null;
            }
          }

          const directRemote = (() => {
            const candidates = [
              rasterRemoteUrl,
              imageData.remoteUrl,
              rasterSource,
              imageData.url,
              imageData.src,
            ];
            for (const candidate of candidates) {
              if (typeof candidate !== "string") continue;
              const trimmed = candidate.trim();
              if (!trimmed) continue;
              const normalized = normalizePersistableImageRef(trimmed) || trimmed;
              if (isRemoteUrl(normalized)) return normalized;
            }
            return null;
          })();

          if (directRemote) {
            imageUrl = directRemote;
          } else {
            const imageDataUrl = await resolveImageDataUrl();
            if (!imageDataUrl) {
              throw new Error("无法获取当前图片的图像数据");
            }
            const blob = await dataUrlToBlob(imageDataUrl);

            const uploadResult = await uploadToOSS(blob, {
              dir: projectId
                ? `projects/${projectId}/images/`
                : "uploads/images/",
              fileName: `2d-to-3d-${Date.now()}.png`,
              contentType: "image/png",
              projectId,
            });

            if (!uploadResult.success || !uploadResult.url) {
              throw new Error(uploadResult.error || "当前图片上传失败");
            }

            imageUrl = uploadResult.url;
          }

          if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
            throw new Error(`无效的图片URL: ${imageUrl}`);
          }

          const createTaskResult = await createConvert2Dto3DTask({
            imageUrl,
            projectId: projectId ?? undefined,
          });

          if (!createTaskResult.success || !createTaskResult.taskId) {
            throw new Error(createTaskResult.error || "2D转3D任务创建失败");
          }

          const convertResult = await waitForConvert2Dto3DTask(
            createTaskResult.taskId
          );

          if (!convertResult.success || !convertResult.modelUrl) {
            throw new Error(convertResult.error || "2D转3D失败");
          }

          const modelUrl = convertResult.modelUrl;
          const resolveSupportedModelFormat = (
            input: string
          ): "glb" | "gltf" | null => {
            const trimmed = input.trim();
            if (!trimmed) return null;
            try {
              const pathname = new URL(trimmed).pathname.toLowerCase();
              if (pathname.endsWith(".glb")) return "glb";
              if (pathname.endsWith(".gltf")) return "gltf";
              return null;
            } catch {
              if (/\.glb(?:$|\?)/i.test(trimmed)) return "glb";
              if (/\.gltf(?:$|\?)/i.test(trimmed)) return "gltf";
              return null;
            }
          };
          const format = resolveSupportedModelFormat(modelUrl);
          if (!format) {
            throw new Error(
              "2D转3D 已返回模型，但格式不是前端可直接加载的 GLB/GLTF，当前结果无法展示"
            );
          }
          const fileName =
            modelUrl.split("/").pop() || `model-${Date.now()}.glb`;

          const model3DData: Model3DData = {
            url: modelUrl,
            path: modelUrl,
            format,
            fileName,
            fileSize: 0,
            defaultScale: { x: 1, y: 1, z: 1 },
            defaultRotation: { x: 0, y: 0, z: 0 },
            timestamp: Date.now(),
          };

          const modelWidth = realTimeBounds.width;
          const modelHeight = realTimeBounds.height;
          const spacing = 20;

          const modelStartX = realTimeBounds.x + realTimeBounds.width + spacing;
          const modelStartY = realTimeBounds.y;
          const modelEndX = modelStartX + modelWidth;
          const modelEndY = modelStartY + modelHeight;

          window.dispatchEvent(
            new CustomEvent("canvas:insert-model3d", {
              detail: {
                modelData: model3DData,
                size: {
                  width: modelWidth,
                  height: modelHeight,
                },
                position: {
                  start: { x: modelStartX, y: modelStartY },
                  end: { x: modelEndX, y: modelEndY },
                },
              },
            })
          );

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "✨ 2D转3D完成，已生成3D模型",
                type: "success",
              },
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "2D转3D失败";
          logger.error("2D转3D失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsConvertingTo3D(false);
        }
      };

      execute();
    },
    [
      imageData.id,
      imageData.url,
      imageData.src,
      imageData.remoteUrl,
      resolveImageDataUrl,
      isConvertingTo3D,
      realTimeBounds,
      projectId,
    ]
  );

  // 处理裁切按钮点击
  const handleCropImage = useCallback(
    () => {
      if (isCropping || isApplyingCrop) return;
      const snapshot = getRealTimePaperBounds();

      const minWidthWorld = Math.max(1, 28 * worldPerScreenX);
      const minHeightWorld = Math.max(1, 28 * worldPerScreenY);

      const initialRect = clampCropRectToImage(
        {
          x: snapshot.x,
          y: snapshot.y,
          width: Math.max(1, snapshot.width),
          height: Math.max(1, snapshot.height),
        },
        minWidthWorld,
        minHeightWorld,
        snapshot
      );

      setCropSourceBounds(snapshot);
      setCropRect(initialRect);
      setIsCropping(true);
    },
    [
      clampCropRectToImage,
      getRealTimePaperBounds,
      isApplyingCrop,
      isCropping,
      realTimeBounds.height,
      realTimeBounds.width,
      realTimeBounds.x,
      realTimeBounds.y,
      worldPerScreenX,
      worldPerScreenY,
    ]
  );

  const handleConfirmCrop = useCallback(async () => {
    if (!cropRect || isApplyingCrop) return;

    setIsApplyingCrop(true);
    try {
      const resolveCropSourceImage = async (): Promise<HTMLImageElement | null> => {
        const candidates: string[] = [];
        const pushCandidate = (value?: string | null) => {
          if (typeof value !== "string") return;
          const trimmed = value.trim();
          if (!trimmed) return;
          if (!candidates.includes(trimmed)) {
            candidates.push(trimmed);
          }
        };

        pushCandidate(imageData.localDataUrl);
        // Crop should follow what is currently rendered on canvas.
        // Keep runtime/local source first, and only fallback to editing/original source.
        pushCandidate(imageData.src);
        pushCandidate(imageData.url);
        pushCandidate(imageData.remoteUrl);
        pushCandidate(imageData.key);
        pushCandidate(getImageDataForEditing?.(imageData.id));

        for (const candidate of candidates) {
          try {
            const blob = await resolveImageToBlob(candidate, { preferProxy: true });
            if (!blob || blob.size <= 0) continue;
            const objectUrl = URL.createObjectURL(blob);
            try {
              return await loadImageElement(objectUrl);
            } finally {
              try {
                URL.revokeObjectURL(objectUrl);
              } catch {}
            }
          } catch {
            // 尝试下一个候选源
          }
        }

        try {
          const imageGroup = paper.project?.layers?.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "image" && child.data?.imageId === imageData.id
            )
          )[0];
          if (!imageGroup) return null;
          const raster = imageGroup.children.find((child) =>
            isRaster(child)
          ) as paper.Raster;
          if (!raster?.canvas) return null;
          const fallbackBlob = await canvasToBlob(raster.canvas, { type: "image/png" });
          if (!fallbackBlob || fallbackBlob.size <= 0) return null;
          const objectUrl = URL.createObjectURL(fallbackBlob);
          try {
            return await loadImageElement(objectUrl);
          } finally {
            try {
              URL.revokeObjectURL(objectUrl);
            } catch {}
          }
        } catch {
          return null;
        }
      };

      const image = await resolveCropSourceImage();
      if (!image) {
        throw new Error("无法获取原图，裁切失败");
      }
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        throw new Error("原图尺寸无效，裁切失败");
      }

      const activeBounds = cropSourceBounds || realTimeBounds;
      const safeCropRect = clampCropRectToImage(cropRect, 1, 1, activeBounds);
      const displayWidth = Math.max(1, activeBounds.width);
      const displayHeight = Math.max(1, activeBounds.height);
      const scaleX = naturalWidth / displayWidth;
      const scaleY = naturalHeight / displayHeight;

      const cropLeftPx = clampNumber(
        Math.round((safeCropRect.x - activeBounds.x) * scaleX),
        0,
        Math.max(0, naturalWidth - 1)
      );
      const cropTopPx = clampNumber(
        Math.round((safeCropRect.y - activeBounds.y) * scaleY),
        0,
        Math.max(0, naturalHeight - 1)
      );
      const cropRightPx = clampNumber(
        Math.round((safeCropRect.x + safeCropRect.width - activeBounds.x) * scaleX),
        cropLeftPx + 1,
        naturalWidth
      );
      const cropBottomPx = clampNumber(
        Math.round((safeCropRect.y + safeCropRect.height - activeBounds.y) * scaleY),
        cropTopPx + 1,
        naturalHeight
      );

      const cropX = cropLeftPx;
      const cropY = cropTopPx;
      const cropWidth = Math.max(1, cropRightPx - cropLeftPx);
      const cropHeight = Math.max(1, cropBottomPx - cropTopPx);
      const outputWidth = cropWidth;
      const outputHeight = cropHeight;

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("无法创建裁切画布");
      }
      ctx.drawImage(
        image,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        outputWidth,
        outputHeight
      );

      const croppedBlob = await canvasToBlob(canvas, { type: "image/png" });
      if (!croppedBlob || croppedBlob.size <= 0) {
        throw new Error("裁切结果为空，裁切失败");
      }
      const nextBounds = {
        x: safeCropRect.x,
        y: safeCropRect.y,
        width: Math.max(1, safeCropRect.width),
        height: Math.max(1, safeCropRect.height),
      };

      if (onImageUpdate) {
        const croppedDataUrl = await blobToDataUrl(croppedBlob);
        void imageUrlCache.updateDataUrl(
          imageData.id,
          croppedDataUrl,
          projectId,
          buildImageSourceFingerprint(croppedDataUrl)
        );
        await onImageUpdate(imageData.id, croppedDataUrl, nextBounds);
      } else {
        const fileName = `crop-${Date.now()}.png`;
        const uploadDir = projectId
          ? `projects/${projectId}/images/`
          : "uploads/images/";
        const { key: plannedKey } = generateOssKey({
          projectId,
          dir: uploadDir,
          fileName,
          contentType: "image/png",
        });
        onResize?.(nextBounds);
        const croppedPreviewDataUrl = await blobToDataUrl(croppedBlob);
        void imageUrlCache.updateDataUrl(
          imageData.id,
          croppedPreviewDataUrl,
          projectId,
          buildImageSourceFingerprint(croppedPreviewDataUrl)
        );

        // 先用本地 dataURL 立即替换渲染，避免先切远程源导致首帧“幽灵图”。
        window.dispatchEvent(
          new CustomEvent("canvas:replace-image-source", {
            detail: {
              imageId: imageData.id,
              source: croppedPreviewDataUrl,
              bounds: nextBounds,
              contentType: "image/png",
              fileName,
              key: plannedKey,
              clearRemoteUrl: true,
              width: outputWidth,
              height: outputHeight,
              historyLabel: "crop-image",
              pendingUpload: true,
            },
          })
        );

        // 后台上传并回写远程元数据；DrawingController 会在远程资源可用后再无缝切换。
        void (async () => {
          try {
            const uploadResult = await uploadToOSS(croppedBlob, {
              dir: uploadDir,
              fileName,
              contentType: "image/png",
              projectId,
              key: plannedKey,
            });

            if (!uploadResult.success || !uploadResult.url) {
              logger.warn("裁切图片后台上传失败，保持本地源等待自动补传", uploadResult.error);
              return;
            }

            const normalizedKey = normalizePersistableImageRef(uploadResult.key || "");
            const normalizedRemoteUrl =
              normalizePersistableImageRef(uploadResult.url) || uploadResult.url;
            if (!normalizedKey && !normalizedRemoteUrl) {
              return;
            }

            const persistedSource = normalizedRemoteUrl || normalizedKey;
            if (persistedSource) {
              window.dispatchEvent(
                new CustomEvent("canvas:replace-image-source", {
                  detail: {
                    imageId: imageData.id,
                    source: persistedSource,
                    bounds: nextBounds,
                    contentType: "image/png",
                    fileName,
                    key: normalizedKey || undefined,
                    remoteUrl: normalizedRemoteUrl || undefined,
                    width: outputWidth,
                    height: outputHeight,
                    historyLabel: "crop-image-oss",
                    pendingUpload: false,
                  },
                })
              );
            }

            window.dispatchEvent(
              new CustomEvent("tanva:upgradeImageSource", {
                detail: {
                  placeholderId: imageData.id,
                  key: normalizedKey || undefined,
                  remoteUrl: normalizedRemoteUrl || undefined,
                },
              })
            );
          } catch (uploadError) {
            logger.warn("裁切图片后台上传异常，保持本地源等待自动补传", uploadError);
          }
        })();
      }

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "✨ 裁切完成", type: "success" },
        })
      );

      setIsCropping(false);
      setCropRect(null);
      setCropSourceBounds(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "裁切失败";
      logger.error("裁切失败", error);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message, type: "error" },
        })
      );
    } finally {
      setIsApplyingCrop(false);
    }
  }, [
    clampCropRectToImage,
    cropRect,
    cropSourceBounds,
    imageData.id,
    imageData.key,
    imageData.localDataUrl,
    imageData.remoteUrl,
    imageData.src,
    imageData.url,
    getImageDataForEditing,
    isApplyingCrop,
    onImageUpdate,
    onResize,
    projectId,
    realTimeBounds,
  ]);

  // 处理扩图按钮点击
  const handleExpandImage = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isExpandingImage) return;
      setOperationInProgress(true);
      setShowExpandSelector(true);
    },
    [isExpandingImage, setOperationInProgress]
  );

  // 处理扩图选择完成（直接生成带空白画布并交给 Gemini 填充）
  const handleExpandSelect = useCallback(
    async (
      selectedBounds: { x: number; y: number; width: number; height: number },
      _expandRatios: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }
    ) => {
      setShowExpandSelector(false);
      setIsExpandingImage(true);
      let expandPlaceholderId: string | null = null;

      try {
        const selectedRight = selectedBounds.x + selectedBounds.width;
        const selectedBottom = selectedBounds.y + selectedBounds.height;
        const imageRight = realTimeBounds.x + realTimeBounds.width;
        const imageBottom = realTimeBounds.y + realTimeBounds.height;

        const hasExpandArea =
          selectedBounds.x < realTimeBounds.x - 0.5 ||
          selectedBounds.y < realTimeBounds.y - 0.5 ||
          selectedRight > imageRight + 0.5 ||
          selectedBottom > imageBottom + 0.5;

        if (!hasExpandArea) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "请拖出包含空白区的扩展范围后再尝试",
                type: "error",
              },
            })
          );
          return;
        }

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: "⏳ 正在准备扩图画布并发送给 Gemini...",
              type: "info",
            },
          })
        );

        const expandPlacementGap = Math.max(
          32,
          Math.min(120, selectedBounds.width * 0.1)
        );
        const expandedCenter = {
          x: selectedBounds.x + selectedBounds.width / 2,
          y: selectedBounds.y + selectedBounds.height / 2,
        };
        const expandResultCenter = {
          x: expandedCenter.x - selectedBounds.width - expandPlacementGap,
          y: expandedCenter.y,
        };
        expandPlaceholderId = `expand_${imageData.id}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        window.dispatchEvent(
          new CustomEvent("predictImagePlaceholder", {
            detail: {
              action: "add",
              placeholderId: expandPlaceholderId,
              center: expandResultCenter,
              width: selectedBounds.width,
              height: selectedBounds.height,
              operationType: "expand-image",
              sourceImageId: imageData.id,
            },
          })
        );

        const baseImageDataUrl = await resolveImageDataUrl();
        if (!baseImageDataUrl) {
          throw new Error("无法获取当前图片数据");
        }

        const composed = await _composeExpandedImage(
          baseImageDataUrl,
          realTimeBounds,
          selectedBounds
        );

        // 同步输出合成黑底图到画布，便于对比与调试
        // 调试：在控制台查看合成图片信息
        console.log("扩展画布合成图片:", composed);

        // 直接复用聊天框 edit 的参数逻辑（provider/model/尺寸/比例等）
        const chatState = useAIChatStore.getState();
        const modelToUse = getImageModelForProvider(chatState.aiProvider);
        logger.info("🔁 使用聊天框 edit 模式进行扩图（不外显）", {
          imageId: imageData.id,
          aiProvider: chatState.aiProvider,
          model: modelToUse,
          prompt: EXPAND_PRESET_PROMPT,
          composedSize: { width: composed.width, height: composed.height },
          imageSize: chatState.imageSize ?? "1K",
          aspectRatio: chatState.aspectRatio ?? "auto",
          imageOnly: chatState.imageOnly,
        });

        // 使用与聊天框 edit 模式完全相同的参数和调用方式
        const editResult = await editImageViaAPI({
          prompt: EXPAND_PRESET_PROMPT,
          sourceImage: composed.dataUrl,
          model: modelToUse,
          aiProvider: chatState.aiProvider,
          outputFormat: "png",
          imageOnly: chatState.imageOnly ?? true,
          imageSize: chatState.imageSize ?? "1K",
          aspectRatio: chatState.aspectRatio ?? undefined,
          thinkingLevel: chatState.thinkingLevel ?? undefined,
        });

        if (!editResult.success || !editResult.data?.imageData) {
          throw new Error(editResult.error?.message || "扩图失败");
        }

        const finalImageUrl = ensureDataUrlString(
          editResult.data.imageData,
          "image/png"
        );

        window.dispatchEvent(
          new CustomEvent("triggerQuickImageUpload", {
            detail: {
              imageData: finalImageUrl,
              fileName: `expanded-${Date.now()}.png`,
              selectedImageBounds: selectedBounds,
              smartPosition: expandResultCenter,
              operationType: "expand-image",
              sourceImageId: imageData.id,
              placeholderId: expandPlaceholderId,
            },
          })
        );

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "✨ 扩图完成，已生成新图", type: "success" },
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "扩图失败";
        logger.error("扩图失败", error);
        if (expandPlaceholderId) {
          window.dispatchEvent(
            new CustomEvent("predictImagePlaceholder", {
              detail: { action: "remove", placeholderId: expandPlaceholderId },
            })
          );
        }
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message, type: "error" },
          })
        );
      } finally {
        setIsExpandingImage(false);
        setDrawMode("select");
      }
    },
    [resolveImageDataUrl, imageData.id, realTimeBounds, setDrawMode]
  );

  const handleOptimizeHdImage = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isOptimizingHd) return;

      const execute = async () => {
        setIsOptimizingHd(true);
        try {
          // 获取图片数据
          const baseImage = await resolveImageDataUrl();
          if (!baseImage) {
            throw new Error("无法获取原图");
          }

          const baseImageElement = await loadImageElement(baseImage);
          const sourceWidth = Math.max(
            1,
            baseImageElement.naturalWidth || baseImageElement.width || 1
          );
          const sourceHeight = Math.max(
            1,
            baseImageElement.naturalHeight || baseImageElement.height || 1
          );
          const aspectRatio =
            getClosestHdUpscaleAspectRatio(sourceWidth, sourceHeight);

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "⏳ 开始高清放大（4K），请稍候...",
                type: "info",
              },
            })
          );

          // 使用 Banana provider 进行高清放大（只有 Banana 支持 imageSize 参数）
          const HD_UPSCALE_MODEL = "gemini-2.5-flash-image-preview";
          const HD_UPSCALE_PROVIDER = "banana";

          logger.info("📷 高清放大 - 使用 Banana editImage (4K)", {
            aiProvider: HD_UPSCALE_PROVIDER,
            model: HD_UPSCALE_MODEL,
            imageSize: "4K",
            aspectRatio,
            sourceWidth,
            sourceHeight,
          });

          const editResult = await aiImageService.editImage({
            prompt:
              "请将这张图片进行高清放大处理，提升分辨率到4K级别，保持原图的所有细节、颜色、构图和风格完全不变，只增强清晰度和分辨率，不要添加或修改任何内容。必须保持原始宽高比，禁止裁切、补边、拉伸、透视变化或改动构图。",
            sourceImage: baseImage,
            model: HD_UPSCALE_MODEL,
            aiProvider: HD_UPSCALE_PROVIDER,
            outputFormat: "png",
            aspectRatio,
            imageSize: "4K",
            imageOnly: true,
          });

          if (!editResult.success || !editResult.data?.imageData) {
            throw new Error(editResult.error?.message || "高清放大失败");
          }

          const resultImageData = editResult.data.imageData.startsWith(
            "data:image"
          )
            ? editResult.data.imageData
            : `data:image/png;base64,${editResult.data.imageData}`;

          // 直接下载 4K 图片，不加载到画布
          const fileName = `hd-4k-${Date.now()}.png`;
          const link = document.createElement("a");
          link.href = resultImageData;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "✨ 高清放大完成（4K），已下载",
                type: "success",
              },
            })
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "高清放大失败";
          logger.error("高清放大失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsOptimizingHd(false);
        }
      };

      execute();
    },
    [resolveImageDataUrl, imageData.id, isOptimizingHd, realTimeBounds]
  );

  // 处理扩图取消
  const handleExpandCancel = useCallback(() => {
    setShowExpandSelector(false);
    setOperationInProgress(false);
    setDrawMode("select");
  }, [setDrawMode, setOperationInProgress]);

  const basePreviewSrc = useMemo(() => {
    const fromEdit = getImageDataForEditing?.(imageData.id);
    return (
      resolvePreviewImageSrcForCanvas({
        remoteUrl: imageData.remoteUrl,
        url: imageData.url,
        src: fromEdit || imageData.src,
        key: imageData.key,
        localDataUrl: imageData.localDataUrl,
      }) || ""
    );
  }, [
    getImageDataForEditing,
    imageData.id,
    imageData.remoteUrl,
    imageData.url,
    imageData.src,
    imageData.key,
    imageData.localDataUrl,
  ]);

  const previewCollection = useMemo<ImageItem[]>(() => {
    const mapBySrc = new Map<string, ImageItem>();

    // 1. 首先添加画布上所有图片（优先级最高）
    allCanvasImages.forEach((img) => {
      const src = resolvePreviewImageSrcForCanvas(img);
      if (!src) return;
      if (mapBySrc.has(src)) return; // 去重
      mapBySrc.set(src, {
        id: img.id,
        src,
        title: img.fileName || "画布图片",
        timestamp: Date.now(), // 画布图片视为最新
      });
    });

    // 2. 然后添加历史图片（补充画布上没有的）
    relatedHistoryImages.forEach((item) => {
      const raw = item.src?.trim() || "";
      if (!raw) return;
      const normalizedSrc = normalizeImageSrc(raw);
      if (!normalizedSrc) return;
      const displaySrc = normalizedSrc;
      if (mapBySrc.has(displaySrc)) return; // 已存在则跳过
      mapBySrc.set(displaySrc, {
        ...item,
        src: displaySrc,
      });
    });

    // 获取所有图片并排序
    const allItems = Array.from(mapBySrc.values());

    // 排序：当前图片在第一位，其他按时间降序
    return allItems.sort((a, b) => {
      // 当前双击的图片始终在第一位
      if (a.id === imageData.id) return -1;
      if (b.id === imageData.id) return 1;
      // 其他按时间降序
      const timeA = a.timestamp ?? 0;
      const timeB = b.timestamp ?? 0;
      return timeB - timeA;
    });
  }, [
    allCanvasImages,
    relatedHistoryImages,
    imageData.id,
    imageData.remoteUrl,
    imageData.url,
    imageData.src,
    imageData.key,
    imageData.localDataUrl,
  ]);

  const activePreviewId = previewImageId ?? imageData.id;
  const activePreviewSrc = useMemo(() => {
    if (activePreviewId === imageData.id) {
      return basePreviewSrc || previewCollection[0]?.src || "";
    }
    if (!previewCollection.length) return "";
    const target = previewCollection.find(
      (item) => item.id === activePreviewId
    );
    return target?.src || previewCollection[0]?.src || "";
  }, [activePreviewId, basePreviewSrc, imageData.id, previewCollection]);

  useEffect(() => {
    if (!showPreview) return;
    if (!previewCollection.length) return;
    const exists = previewCollection.some(
      (item) => item.id === activePreviewId
    );
    if (!exists && activePreviewId !== imageData.id) {
      setPreviewImageId(previewCollection[0].id);
    }
  }, [activePreviewId, imageData.id, previewCollection, showPreview]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ imageId?: string }>).detail;
      if (detail?.imageId === imageData.id) {
        setShowPreview(true);
        setPreviewImageId(imageData.id);
      }
    };
    window.addEventListener(
      "canvas:image-open-preview",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "canvas:image-open-preview",
        handler as EventListener
      );
  }, [imageData.id]);

  // 已简化 - 移除了所有鼠标事件处理逻辑，让Paper.js完全处理交互

  const toolbarActions: ToolbarAction[] = [
    {
      key: "removeBackground",
      label: "智能抠图",
      title: isRemovingBackground ? "正在抠图..." : "智能抠图",
      icon: Wand2,
      disabled:
        isPendingUpload ||
        isRemovingBackground ||
        isFastRemovingBackground ||
        isSeparatingLayers,
      loading: isRemovingBackground,
      onClick: (event) => {
        recordToolbarUsage("removeBackground");
        handleBackgroundRemoval(event);
      },
    },
    {
      key: "layerSeparation",
      label: "一键分层",
      title: isSeparatingLayers ? "正在分层..." : "一键分层",
      icon: Layers,
      disabled:
        isPendingUpload ||
        isSeparatingLayers ||
        isRemovingBackground ||
        isFastRemovingBackground,
      loading: isSeparatingLayers,
      onClick: (event) => {
        recordToolbarUsage("layerSeparation");
        handleLayerSeparation(event);
      },
    },
    {
      key: "convertTo3D",
      label: "2D转3D",
      title: isConvertingTo3D ? "正在转换3D..." : "2D转3D",
      icon: Rotate3d,
      disabled: isPendingUpload || isConvertingTo3D,
      loading: isConvertingTo3D,
      onClick: (event) => {
        recordToolbarUsage("convertTo3D");
        handleConvertTo3D(event);
      },
    },
    {
      key: "hdUpscale",
      label: "高清放大",
      title: isOptimizingHd ? "正在高清放大..." : "高清放大",
      icon: ImageUp,
      disabled: isPendingUpload || isOptimizingHd,
      loading: isOptimizingHd,
      onClick: (event) => {
        recordToolbarUsage("hdUpscale");
        handleOptimizeHdImage(event);
      },
    },
    {
      key: "expandImage",
      label: "图片拓展",
      title: isExpandingImage
        ? "正在扩图..."
        : showExpandSelector
        ? "请选择扩图区域"
        : "图片拓展",
      icon: Crop,
      disabled: isPendingUpload || isExpandingImage || showExpandSelector,
      loading: isExpandingImage,
      onClick: (event) => {
        recordToolbarUsage("expandImage");
        handleExpandImage(event);
      },
    },
    {
      key: "cropImage",
      label: "裁切",
      title: isCropping || isApplyingCrop ? "裁切中..." : "裁切图片",
      icon: Crop,
      disabled: isPendingUpload || isApplyingCrop,
      loading: isApplyingCrop,
      onClick: () => {
        recordToolbarUsage("cropImage");
        handleCropImage();
      },
    },
    {
      key: "editText",
      label: "改文字",
      title: isRecognizingText
        ? "正在识别文字..."
        : isApplyingTextEdit
        ? "正在修改文字..."
        : "修改图片中的文字",
      icon: Type,
      disabled: isPendingUpload || isRecognizingText || isApplyingTextEdit,
      loading: isRecognizingText || isApplyingTextEdit,
      onClick: (event) => {
        recordToolbarUsage("editText");
        handleRecognizeImageText(event);
      },
    },
    {
      key: "extractPalette",
      label: "提取调色板",
      title: isExtractingPalette ? "正在提取调色板..." : "提取调色板",
      icon: Palette,
      disabled: isPendingUpload || isExtractingPalette,
      loading: isExtractingPalette,
      onClick: (event) => {
        recordToolbarUsage("extractPalette");
        handleExtractPalette(event);
      },
    },
    {
      key: "generateNode",
      label: "生成节点",
      title: "生成节点",
      icon: ArrowRightLeft,
      disabled: isPendingUpload,
      onClick: (event) => {
        recordToolbarUsage("generateNode");
        handleCreateFlowImageNode(event);
      },
    },
  ];

  if (showFastBackgroundRemovalButton) {
    toolbarActions.push({
      key: "fastRemoveBackground",
      label: "极速抠图",
      title: isFastRemovingBackground ? "正在极速抠图..." : "极速抠图",
      icon: Zap,
      disabled:
        isPendingUpload ||
        isRemovingBackground ||
        isFastRemovingBackground ||
        isSeparatingLayers,
      loading: isFastRemovingBackground,
      onClick: (event) => {
        recordToolbarUsage("fastRemoveBackground");
        handleFastBackgroundRemoval(event);
      },
    });
  }

  const toolbarActionMap = new Map<ToolbarActionKey, ToolbarAction>(
    toolbarActions.map((action) => [action.key, action])
  );

  const fixedToolbarActions = FIXED_TOOLBAR_KEYS.map((key) =>
    toolbarActionMap.get(key)
  ).filter((action): action is ToolbarAction => Boolean(action));

  const dynamicToolbarSlots = Math.max(0, 5 - fixedToolbarActions.length);
  const rotatableToolbarActions = ROTATABLE_TOOLBAR_KEYS.map((key) =>
    toolbarActionMap.get(key)
  )
    .filter((action): action is ToolbarAction => Boolean(action))
    .sort((left, right) => {
      const usageDelta =
        (toolbarUsageCounts[right.key] ?? 0) - (toolbarUsageCounts[left.key] ?? 0);
      if (usageDelta !== 0) {
        return usageDelta;
      }
      return (
        ROTATABLE_TOOLBAR_KEYS.indexOf(left.key) -
        ROTATABLE_TOOLBAR_KEYS.indexOf(right.key)
      );
    });

  const rotatingToolbarActions = rotatableToolbarActions.slice(
    0,
    dynamicToolbarSlots
  );
  const visibleToolbarActions = [...fixedToolbarActions, ...rotatingToolbarActions];
  const visibleToolbarActionKeys = new Set(
    visibleToolbarActions.map((action) => action.key)
  );
  const moreToolbarActions = rotatableToolbarActions.filter(
    (action) => !visibleToolbarActionKeys.has(action.key)
  );

  const renderToolbarActionButton = (action: ToolbarAction) => (
    <Button
      key={action.key}
      variant='ghost'
      size='sm'
      disabled={action.disabled}
      className={sharedButtonClass}
      onClick={action.onClick}
      title={action.title}
    >
      {action.loading ? (
        <LoadingSpinner size='sm' className='text-blue-600' />
      ) : (
        <action.icon className={sharedIconClass} />
      )}
      {showButtonText && <span>{action.label}</span>}
    </Button>
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `translate3d(${screenBounds.x}px, ${screenBounds.y}px, 0)`,
        willChange: "transform",
        zIndex: 10 + layerIndex * 2 + (isSelected ? 1 : 0), // 大幅降低z-index，确保在对话框下方
        cursor: "default",
        userSelect: "none",
        pointerEvents: "none", // 让所有鼠标事件穿透到Paper.js
        display: visible ? "block" : "none", // 根据visible属性控制显示/隐藏
      }}
    >
      {/* 透明覆盖层，让交互穿透到Paper.js */}
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "transparent",
          pointerEvents: "none",
        }}
      />

      {/* 图片信息条 - 选中时显示在图片内部顶部，左上角显示名称，右上角显示分辨率 */}
      {isSelected && !showExpandSelector && !shouldHideUi && (
        <div
          style={{
            position: "absolute",
            top: 4 * toolbarScale,
            left: 4 * toolbarScale,
            right: 4 * toolbarScale,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* 左侧：图片名称 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              minWidth: 0,
              maxWidth: "60%",
              gap: 4 * toolbarScale,
            }}
          >
            <Button
              variant='ghost'
              size='sm'
              className='h-5 w-5 p-0 rounded-md bg-transparent text-white hover:bg-transparent'
              style={{ pointerEvents: "auto" }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleLock?.(imageData.id, !isImageLocked);
              }}
              title={isImageLocked ? "解锁图片" : "锁定图片"}
            >
              {isImageLocked ? (
                <Lock className='w-3 h-3' />
              ) : (
                <Unlock className='w-3 h-3' />
              )}
            </Button>
            <span
              style={{
                fontWeight: 500,
                fontSize: 10 * toolbarScale,
                color: "#fff",
                padding: `${2 * toolbarScale}px ${4 * toolbarScale}px`,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={imageData.fileName || `图片 ${imageData.id}`}
            >
              {imageData.fileName || `图片 ${imageData.id}`}
            </span>
          </div>
          {/* 右侧：分辨率 */}
          {naturalSize && (
            <span
              style={{
                fontSize: 10 * toolbarScale,
                color: "#fff",
                padding: `${2 * toolbarScale}px ${4 * toolbarScale}px`,
                marginLeft: 4 * toolbarScale,
                flexShrink: 0,
              }}
            >
              {`${naturalSize.width} × ${naturalSize.height}`}
            </span>
          )}
        </div>
      )}

      {/* 锁定态 hover 解锁按钮（不依赖选中） */}
      {isImageLocked &&
        isHoveringLockedImage &&
        !showExpandSelector &&
        !shouldHideUi && (
          <div
            style={{
              position: "absolute",
              top: 4 * toolbarScale,
              left: 4 * toolbarScale,
              zIndex: 35,
              pointerEvents: "auto",
            }}
          >
            <Button
              variant='ghost'
              size='sm'
              className='h-6 w-6 p-0 rounded-md bg-transparent text-white hover:bg-transparent flex items-center justify-center'
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleLock?.(imageData.id, false);
              }}
              title='解锁图片'
            >
              <Lock className='w-3 h-3' />
            </Button>
          </div>
        )}

      {/* 扩图选择器 - 截图时显示，隐藏小工具栏 */}
      {showExpandSelector && (
        <ExpandImageSelector
          imageBounds={realTimeBounds}
          imageId={imageData.id}
          imageUrl={
            imageData.remoteUrl ||
            imageData.url ||
            imageData.key ||
            imageData.src ||
            (imageData.pendingUpload ? imageData.localDataUrl : undefined) ||
            ""
          }
          onSelect={handleExpandSelect}
          onCancel={handleExpandCancel}
        />
      )}

      {/* 图片操作按钮组 - 只在选中时显示，位于图片底部，截图时隐藏 */}
      {isSelected &&
        !isImageLocked &&
        showIndividualTools &&
        !showExpandSelector &&
        !shouldHideUi && (
          <div
            className='absolute'
            data-image-toolbar='true'
            style={{
              top: "100%",
              marginTop: 12 * toolbarScale,
              left: "50%",
              transform: `translateX(-50%) scale(${toolbarScale})`,
              transformOrigin: "top center",
              zIndex: 30,
              pointerEvents: "auto",
              willChange: "transform",
            }}
          >
            <div className='flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass'>
              {/* 暂时隐藏：添加到AI对话框进行编辑按钮
            <Button
              variant='outline'
              size='sm'
              className={sharedButtonClass}
              onClick={handleAIEdit}
              title='添加到AI对话框进行编辑'
              style={sharedButtonStyle}
            >
              <Sparkles className={sharedIconClass} />
            </Button>
            */}

              {visibleToolbarActions.map((action) =>
                renderToolbarActionButton(action)
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className={sharedButtonClass}
                    title='更多功能'
                  >
                    <MoreHorizontal className={sharedIconClass} />
                    {showButtonText && <span>更多</span>}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  side='bottom'
                  sideOffset={10}
                  className='w-auto min-w-[138px] rounded-lg border border-gray-200 bg-white/95 shadow-lg backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/95 dark:shadow-xl'
                >
                  {moreToolbarActions.map((action) => (
                    <DropdownMenuItem
                      key={action.key}
                      onClick={action.onClick}
                      disabled={action.disabled}
                      className='flex items-center gap-2 px-3 py-2 text-sm dark:text-gray-100'
                    >
                      {action.loading ? (
                        <LoadingSpinner size='sm' className='text-blue-600 dark:text-blue-400' />
                      ) : (
                        <action.icon className='w-4 h-4' />
                      )}
                      <span>{action.label}</span>
                    </DropdownMenuItem>
                  ))}

                  {enableVisibilityToggle && (
                    <DropdownMenuItem
                      onClick={handleToggleVisibility}
                      className='flex items-center gap-2 px-3 py-2 text-sm dark:text-gray-100'
                    >
                      <EyeOff className='w-4 h-4' />
                      <span>隐藏图层</span>
                    </DropdownMenuItem>
                  )}

                  {moreToolbarActions.length === 0 && !enableVisibilityToggle && (
                    <DropdownMenuItem disabled className='px-3 py-2 text-sm dark:text-gray-400'>
                      暂无更多功能
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {showTextEditPanel && (
              <div className='mt-2 w-[460px] max-w-[80vw] mx-auto rounded-xl border border-liquid-glass bg-white/95 p-3 shadow-liquid-glass-lg backdrop-blur-md'>
                <div className='mb-2 flex items-center justify-between'>
                  <div className='text-sm font-medium text-gray-800'>
                    修改图片中的文字
                  </div>
                  <div className='text-xs text-gray-500'>
                    {isRecognizingText
                      ? "识别中..."
                      : `共 ${textReplacementItems.length} 条`}
                  </div>
                </div>

                {isRecognizingText ? (
                  <div className='rounded-md border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-600'>
                    正在识别图片文字，请稍候...
                  </div>
                ) : (
                  <div className='space-y-2'>
                    {textReplacementItems.length > 0 ? (
                      <div className='max-h-52 space-y-2 overflow-y-auto pr-1'>
                        {textReplacementItems.map((item) => (
                          <div
                            key={item.id}
                            className='grid grid-cols-[1fr_1fr] gap-2'
                          >
                            <input
                              readOnly
                              value={item.originalText}
                              className='h-8 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs text-gray-600'
                            />
                            <input
                              value={item.nextText}
                              onChange={(event) => {
                                const value = event.target.value;
                                setTextReplacementItems((current) =>
                                  current.map((row) =>
                                    row.id === item.id
                                      ? { ...row, nextText: value }
                                      : row
                                  )
                                );
                              }}
                              placeholder='输入替换文字'
                              className='h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-800 focus:border-blue-400 focus:outline-none'
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className='rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-700'>
                        未识别到明确文字，可在下方输入补充说明后尝试修改。
                      </div>
                    )}

                    <textarea
                      value={textEditExtraInstruction}
                      onChange={(event) =>
                        setTextEditExtraInstruction(event.target.value)
                      }
                      placeholder='补充说明（可选），例如：将标题改为“春日上新”并保持字体风格一致'
                      className='min-h-[64px] w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-xs text-gray-800 focus:border-blue-400 focus:outline-none'
                    />

                    <div className='flex items-center justify-between gap-2 pt-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className={sharedButtonClass}
                        disabled={isApplyingTextEdit || isRecognizingText}
                        onClick={handleRecognizeImageText}
                        title='重新识别图片文字'
                      >
                        重新识别
                      </Button>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          size='sm'
                          className={sharedButtonClass}
                          disabled={isApplyingTextEdit || isRecognizingText}
                          onClick={() => {
                            setShowTextEditPanel(false);
                            setTextReplacementItems([]);
                            setTextEditExtraInstruction("");
                          }}
                          title='取消文字修改'
                        >
                          取消
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          className={sharedButtonClass}
                          disabled={isApplyingTextEdit || isRecognizingText}
                          onClick={(event) => {
                            void handleApplyTextEdit(event);
                          }}
                          title='确认并修改图片文字'
                        >
                          {isApplyingTextEdit ? "修改中..." : "确认修改"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      {/* 裁切框 */}
      {isCropping && cropRect && cropRectScreen && (
        <div
          style={{
            position: "absolute",
            left: cropRectScreen.x,
            top: cropRectScreen.y,
            width: cropRectScreen.width,
            height: cropRectScreen.height,
            border: "2px solid #3b82f6",
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.28)",
            pointerEvents: "auto",
            zIndex: 1000,
          }}
        >
          {/* 8个控制点：4角 + 4边 */}
          {([
            { key: "nw", cursor: "nw-resize", style: { left: -6, top: -6 } },
            {
              key: "n",
              cursor: "ns-resize",
              style: { left: "50%", top: -6, transform: "translateX(-50%)" },
            },
            { key: "ne", cursor: "ne-resize", style: { right: -6, top: -6 } },
            {
              key: "e",
              cursor: "ew-resize",
              style: { right: -6, top: "50%", transform: "translateY(-50%)" },
            },
            { key: "se", cursor: "se-resize", style: { right: -6, bottom: -6 } },
            {
              key: "s",
              cursor: "ns-resize",
              style: { left: "50%", bottom: -6, transform: "translateX(-50%)" },
            },
            { key: "sw", cursor: "sw-resize", style: { left: -6, bottom: -6 } },
            {
              key: "w",
              cursor: "ew-resize",
              style: { left: -6, top: "50%", transform: "translateY(-50%)" },
            },
          ] as Array<{
            key: CropHandle;
            cursor: React.CSSProperties["cursor"];
            style: React.CSSProperties;
          }>).map((handle) => (
            <div
              key={handle.key}
              style={{
                position: "absolute",
                width: 12,
                height: 12,
                backgroundColor: "#3b82f6",
                border: "2px solid white",
                borderRadius: "50%",
                cursor: handle.cursor,
                ...handle.style,
              }}
              onMouseDown={handleCropHandleMouseDown(handle.key)}
            />
          ))}

          {/* 操作按钮 */}
          <div
            style={{
              position: "absolute",
              bottom: -40,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: 8,
            }}
          >
            <Button
              size='sm'
              variant='outline'
              className='h-8 w-[100px] whitespace-nowrap px-0 text-sm leading-none'
              disabled={isApplyingCrop}
              onClick={() => {
                void handleConfirmCrop();
              }}
            >
              {isApplyingCrop ? "裁切中..." : "确认裁切"}
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='h-8 w-[100px] whitespace-nowrap px-0 text-sm leading-none'
              disabled={isApplyingCrop}
              onClick={cancelCrop}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={showPreview}
        imageSrc={activePreviewSrc}
        imageTitle={imageData.fileName || `图片 ${imageData.id}`}
        onClose={() => {
          setShowPreview(false);
          setPreviewImageId(null);
        }}
        imageCollection={previewCollection}
        currentImageId={activePreviewId}
        onImageChange={(imageId: string) => setPreviewImageId(imageId)}
        collectionTitle='项目内图片'
        hasMore={projectHistoryHasMore}
        isLoading={projectHistoryLoading}
        onLoadMore={() => {
          if (!projectHistoryHasMore || projectHistoryLoading) return;
          void loadProjectHistory();
        }}
      />
    </div>
  );
};

export default ImageContainer;
