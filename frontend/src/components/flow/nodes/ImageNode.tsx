// @ts-nocheck
// Flow Image 节点交互与预览逻辑。
import React from "react";
import { Handle, Position, useReactFlow, useStore, type ReactFlowState } from "reactflow";
import { NodeResizeControl } from "@reactflow/node-resizer";
import {
  Send as SendIcon,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  UserRound,
  Layers,
} from "lucide-react";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import SmartImage from "../../ui/SmartImage";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { imageUploadService } from "@/services/imageUploadService";
import { generateOssKey } from "@/services/ossUploadService";
import {
  FLOW_IMAGE_ASSET_PREFIX,
  parseFlowImageAssetRef,
} from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import {
  isPersistableImageRef,
  normalizePersistableImageRef,
  pickPersistedImageRefFromUploadAsset,
  resolveImageToBlob,
  toRenderableImageSrc,
} from "@/utils/imageSource";
import { blobToDataUrl, canvasToBlob, createImageBitmapLimited } from "@/utils/imageConcurrency";
import { shallow } from "zustand/shallow";
import { useLocaleText } from "@/utils/localeText";
import { resolveFlowNodeSendAnchorClient } from "../utils/flowNodeSendAnchor";
import { useFlowRenderMode } from "../FlowRenderModeContext";
import { flowLetterboxBackground, useFlowNodeDarkTheme } from "./flowNodeDarkTheme";
import { uploadVolcAsset, type VolcAssetStatus } from "@/services/volcAssetAPI";
import { useVolcAssetPolling } from "@/hooks/useVolcAssetPolling";
import { useBioAuthPolling } from "@/hooks/useBioAuthPolling";
import type { BioAuthStatus } from "@/services/bioAuthAPI";
import { BioAuthModal } from "./BioAuthModal";
import { useAIChatStore, getImageModelForProvider } from "@/stores/aiChatStore";
import aiImageService from "@/services/aiImageService";
import backgroundRemovalService from "@/services/backgroundRemovalService";
import { logger } from "@/utils/logger";
import { splitImageIntoLayers } from "@/utils/imageLayerSplit";

const RESIZE_EDGE_THICKNESS = 8;
const BIO_AUTH_VALID_DAYS = 30;

const lineControlConfigs = [
  {
    position: "top",
    icon: "↕",
    style: {
      top: 0,
      bottom: "auto",
      left: 0,
      right: "auto",
      width: "100%",
      height: RESIZE_EDGE_THICKNESS,
      transform: "none",
      cursor: "ns-resize",
      pointerEvents: "auto",
    },
  },
  {
    position: "bottom",
    icon: "↕",
    style: {
      top: "auto",
      bottom: 0,
      left: 0,
      right: "auto",
      width: "100%",
      height: RESIZE_EDGE_THICKNESS,
      transform: "none",
      cursor: "ns-resize",
      pointerEvents: "auto",
    },
  },
];

const handleControlConfigs = [
  {
    position: "top-left",
    icon: "⤡",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nwse-resize",
    },
  },
  {
    position: "top-right",
    icon: "⤢",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nesw-resize",
    },
  },
  {
    position: "bottom-left",
    icon: "⤢",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nesw-resize",
    },
  },
  {
    position: "bottom-right",
    icon: "⤡",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nwse-resize",
    },
  },
];

type Props = {
  id: string;
  data: {
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string;
    label?: string;
    boxW?: number;
    boxH?: number;
    imageName?: string;
    crop?: {
      x: number;
      y: number;
      width: number;
      height: number;
      sourceWidth?: number;
      sourceHeight?: number;
    };
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

const buildPublicImageUrlForVolc = (value?: string): string | undefined => {
  if (!isPersistableImageRef(value)) return undefined;
  const normalized = normalizePersistableImageRef(value);
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const renderable = toRenderableImageSrc(normalized);
  return renderable && /^https?:\/\//i.test(renderable) ? renderable : undefined;
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const MAX_IMAGE_NAME_LENGTH = 28;
const DEFAULT_NODE_LABEL = "Image";
type FlowNodeLike = { id: string; type?: string; data?: Record<string, unknown> };
type FlowEdgeLike = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
type InputConnectionSnapshot = {
  hasInputConnection: boolean;
  connectedFrameImage?: string;
};
const EMPTY_INPUT_CONNECTION_SNAPSHOT: InputConnectionSnapshot = {
  hasInputConnection: false,
  connectedFrameImage: undefined,
};

const buildNodeByIdMap = (state: ReactFlowState): Map<string, FlowNodeLike> => {
  const nodeLookup = (
    state as ReactFlowState & { nodeLookup?: Map<string, FlowNodeLike> }
  ).nodeLookup;
  if (nodeLookup && typeof nodeLookup.get === "function") {
    return nodeLookup as Map<string, FlowNodeLike>;
  }

  const stateNodes = (state as ReactFlowState & { nodes?: FlowNodeLike[] }).nodes;
  const nodes = Array.isArray(stateNodes) ? stateNodes : (state.getNodes() as FlowNodeLike[]);
  return new Map(nodes.map((node) => [node.id, node]));
};

const buildPrimaryImgInputEdgeByTargetMap = (
  edges: FlowEdgeLike[]
): Map<string, FlowEdgeLike> => {
  const map = new Map<string, FlowEdgeLike>();
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (edge.targetHandle !== "img") continue;
    if (map.has(edge.target)) continue;
    map.set(edge.target, edge);
  }
  return map;
};

const CanvasCropPreview = React.memo(({
  src,
  rect,
  sourceWidth,
  sourceHeight,
  isResizing,
}: {
  src: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
  isResizing?: boolean;
}) => {
  const { lowDetailMode } = useFlowRenderMode();
  const isFlowDark = useFlowNodeDarkTheme();
  const letterboxBg = flowLetterboxBackground(isFlowDark);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      // Prefer layout size to avoid ReactFlow zoom transform affecting measurements.
      let w = container.offsetWidth || container.clientWidth;
      let h = container.offsetHeight || container.clientHeight;
      if (!w || !h) {
        const rect = container.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
      }
      const nextW = Math.max(1, Math.round(w));
      const nextH = Math.max(1, Math.round(h));
      setSize((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
    };

    update();

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      ro.observe(container);
    } catch {}

    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      try { ro?.disconnect(); } catch {}
    };
  }, []);

  React.useEffect(() => {
    if (lowDetailMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = size.w;
    const h = size.h;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    const drawPlaceholder = () => {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = isFlowDark ? "#161616" : "#f3f4f6";
      ctx.fillRect(0, 0, w, h);
    };

    if (!src || !rect || rect.width <= 0 || rect.height <= 0 || w <= 0 || h <= 0) {
      drawPlaceholder();
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.decoding = "async";

    const onLoad = () => {
      if (cancelled) return;
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (!naturalW || !naturalH) {
        drawPlaceholder();
        return;
      }

      const srcW = typeof sourceWidth === "number" && sourceWidth > 0 ? sourceWidth : naturalW;
      const srcH = typeof sourceHeight === "number" && sourceHeight > 0 ? sourceHeight : naturalH;

      const scaleX = srcW > 0 ? naturalW / srcW : 1;
      const scaleY = srcH > 0 ? naturalH / srcH : 1;

      const sxRaw = rect.x * scaleX;
      const syRaw = rect.y * scaleY;
      const exRaw = (rect.x + rect.width) * scaleX;
      const eyRaw = (rect.y + rect.height) * scaleY;

      // 像素对齐：避免在等比缩放时取样到裁剪边缘外，产生白边/透明边
      const sx = Math.max(0, Math.min(naturalW - 1, Math.floor(sxRaw)));
      const sy = Math.max(0, Math.min(naturalH - 1, Math.floor(syRaw)));
      const ex = Math.max(sx + 1, Math.min(naturalW, Math.ceil(exRaw)));
      const ey = Math.max(sy + 1, Math.min(naturalH, Math.ceil(eyRaw)));
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);

      const fit = Math.min(w / sw, h / sh);
      const dw = Math.max(1, Math.round(sw * fit));
      const dh = Math.max(1, Math.round(sh * fit));

      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      ctx.clearRect(0, 0, sw, sh);
      ctx.fillStyle = letterboxBg;
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    };

    const onError = () => {
      if (cancelled) return;
      drawPlaceholder();
    };

    img.onload = onLoad;
    img.onerror = onError;
    img.src = src;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [
    rect?.height,
    rect?.width,
    rect?.x,
    rect?.y,
    size.h,
    size.w,
    sourceHeight,
    sourceWidth,
    lowDetailMode,
    isFlowDark,
    letterboxBg,
    src,
  ]);

  if (lowDetailMode) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: isFlowDark ? "#252525" : "#e5e7eb",
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: letterboxBg,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          background: letterboxBg,
          transform: isResizing ? "translateZ(0)" : undefined,
        }}
      />
    </div>
  );
});

const ImageContent = React.memo(({ displaySrc, canvasCrop, isResizing, uploading, uploadError, onDrop, onDragOver, onDoubleClick, isFlowDark, lt }: {
  displaySrc?: string;
  isResizing?: boolean;
  uploading?: boolean;
  uploadError?: string;
  canvasCrop?: {
    src: string;
    rect: { x: number; y: number; width: number; height: number };
    sourceWidth?: number;
    sourceHeight?: number;
  };
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDoubleClick: () => void;
  isFlowDark: boolean;
  lt: (zhText: string, enText: string) => string;
}) => (
  <div
    onDrop={onDrop}
    onDragOver={onDragOver}
    onDoubleClick={onDoubleClick}
    onClick={() => {}}
    style={{
      flex: 1,
      minHeight: 120,
      background: flowLetterboxBackground(isFlowDark),
      borderRadius: 6,
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      border: `1px solid ${isFlowDark ? "#2f2f2f" : "#e5e7eb"}`,
      cursor: "pointer",
    }}
    title={lt('拖拽图片到此或双击上传', 'Drag image here or double click to upload')}
  >
    {Boolean(uploading) && (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          background: isFlowDark ? "rgba(17,17,17,0.62)" : "rgba(255,255,255,0.6)",
          zIndex: 10,
          fontSize: 12,
          color: isFlowDark ? "#d1d5db" : "#374151",
        }}
      >
        {lt('正在上传…', 'Uploading...')}
      </div>
    )}
    {!uploading && uploadError ? (
      <div
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          bottom: 8,
          zIndex: 10,
          pointerEvents: "none",
          fontSize: 12,
          color: "#b91c1c",
          background: isFlowDark ? "rgba(127,29,29,0.28)" : "rgba(255,255,255,0.9)",
          border: `1px solid ${isFlowDark ? "rgba(248,113,113,0.45)" : "#fecaca"}`,
          borderRadius: 6,
          padding: "6px 8px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={uploadError}
      >
        {lt('上传失败', 'Upload failed')}: {uploadError}
      </div>
    ) : null}
    {canvasCrop ? (
      <CanvasCropPreview
        src={canvasCrop.src}
        rect={canvasCrop.rect}
        sourceWidth={canvasCrop.sourceWidth}
        sourceHeight={canvasCrop.sourceHeight}
        isResizing={isResizing}
      />
    ) : displaySrc ? (
      <SmartImage
        src={displaySrc}
        alt=''
        decoding="async"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: flowLetterboxBackground(isFlowDark),
          transform: isResizing ? "translateZ(0)" : undefined,
        }}
      />
    ) : (
      <span style={{ fontSize: 12, color: isFlowDark ? "#6b7280" : "#9ca3af" }}>
        {lt('拖拽图片到此或双击上传', 'Drag image here or double click to upload')}
      </span>
    )}
  </div>
));

function ImageNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const rf = useReactFlow();
  const normalizedNodeLabel =
    typeof data.label === "string" && data.label.trim().length
      ? data.label.trim()
      : DEFAULT_NODE_LABEL;
  const [nodeLabel, setNodeLabel] = React.useState<string>(normalizedNodeLabel);
  const [nodeLabelDraft, setNodeLabelDraft] = React.useState<string>(normalizedNodeLabel);
  const [isEditingNodeLabel, setIsEditingNodeLabel] = React.useState(false);
  const nodeLabelInputRef = React.useRef<HTMLInputElement | null>(null);
  // 从连接的节点读取图片（支持 imageGrid / videoFrameExtract / image 的链式传递）
  const inputConnectionSnapshot = useStore(
    React.useCallback(
      (state: ReactFlowState): InputConnectionSnapshot => {
        const edges = (Array.isArray(state.edges) ? state.edges : []) as FlowEdgeLike[];
        if (edges.length === 0) return EMPTY_INPUT_CONNECTION_SNAPSHOT;
        const nodeById = buildNodeByIdMap(state);
        const primaryImgInputEdgeByTarget = buildPrimaryImgInputEdgeByTargetMap(edges);

        const resolveFromNode = (
          nodeId: string,
          incomingEdge?: any,
          visited: Set<string> = new Set()
        ): string | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;

          const nodeData = node.data || {};

          // imageGrid 节点 - 读取拼合后的图片
          if (node.type === "imageGrid") {
            const outputImage = nodeData.outputImage as string | undefined;
            return outputImage || undefined;
          }

          // videoFrameExtract 节点 - 读取单帧图片
          if (node.type === "videoFrameExtract" && incomingEdge?.sourceHandle === "image") {
            const frames = nodeData.frames as
              | Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }>
              | undefined;
            if (!frames || frames.length === 0) return undefined;

            const selectedFrameIndex = (nodeData.selectedFrameIndex ?? 1) as number;
            const idx = selectedFrameIndex - 1;
            const frame = frames[idx];
            if (!frame) return undefined;

            // 链路传递优先使用可持久化原图引用，缩略图仅作为兜底。
            return frame.imageUrl || frame.thumbnailDataUrl;
          }

          if (
            node.type === "generate4" ||
            node.type === "generatePro4" ||
            node.type === "midjourneyV7" ||
            node.type === "niji7"
          ) {
            const sourceHandle =
              typeof incomingEdge?.sourceHandle === "string"
                ? incomingEdge.sourceHandle.trim()
                : "";
            const idx = sourceHandle.startsWith("img")
              ? Math.max(0, Math.min(3, Number(sourceHandle.slice(3)) - 1))
              : 0;
            const imageUrls = Array.isArray((nodeData as any).imageUrls)
              ? ((nodeData as any).imageUrls as string[])
              : [];
            const images = Array.isArray((nodeData as any).images)
              ? ((nodeData as any).images as string[])
              : [];
            const thumbnails = Array.isArray((nodeData as any).thumbnails)
              ? ((nodeData as any).thumbnails as string[])
              : [];
            const picked =
              imageUrls[idx] ||
              images[idx] ||
              thumbnails[idx] ||
              (nodeData.imageUrl as string | undefined) ||
              (nodeData.imageData as string | undefined) ||
              (nodeData.thumbnail as string | undefined);
            if (picked) return picked;
          }

          // Image 节点 - 有输入连线时优先使用上游，避免修改上游后未更新
          if (node.type === "image" || node.type === "imagePro") {
            const upstream = primaryImgInputEdgeByTarget.get(nodeId);
            if (upstream) {
              const upstreamResolved = resolveFromNode(
                upstream.source,
                upstream,
                visited
              );
              if (upstreamResolved) return upstreamResolved;
            }

            const direct =
              (nodeData.imageUrl as string | undefined) ||
              (nodeData.imageData as string | undefined) ||
              (nodeData.thumbnail as string | undefined);
            if (direct) return direct || undefined;
          }

          // 兜底：尽量兼容其他输出图片的节点
          const fallback =
            (nodeData.outputImage as string | undefined) ||
            (nodeData.imageUrl as string | undefined) ||
            (nodeData.imageData as string | undefined) ||
            (nodeData.thumbnail as string | undefined) ||
            (nodeData.img as string | undefined) ||
            (nodeData.image as string | undefined);
          return fallback || undefined;
        };

        // 查找连接到 img 输入句柄的边
        const edgeToThis = primaryImgInputEdgeByTarget.get(id);
        if (!edgeToThis) return EMPTY_INPUT_CONNECTION_SNAPSHOT;

        return {
          hasInputConnection: true,
          connectedFrameImage: resolveFromNode(edgeToThis.source, edgeToThis),
        };
      },
      [id]
    ),
    shallow
  );
  const hasInputConnection = inputConnectionSnapshot.hasInputConnection;
  const connectedFrameImage = inputConnectionSnapshot.connectedFrameImage;

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const rawFullValue = connectedFrameImage || data.imageUrl || data.imageData;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = React.useMemo(() => {
    if (fullAssetId) return fullAssetUrl || undefined;
    return buildImageSrc(rawFullValue);
  }, [fullAssetId, fullAssetUrl, rawFullValue]);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = React.useMemo(() => {
    // 节点内展示优先走缩略图，降低大图解码与绘制开销
    if (thumbAssetId) return thumbAssetUrl || fullSrc;
    return buildImageSrc(rawThumbValue) || fullSrc;
  }, [thumbAssetId, thumbAssetUrl, rawThumbValue, fullSrc]);

  const nodeCropInfo = React.useMemo(() => {
    const crop = (data as any)?.crop as
      | { x?: unknown; y?: unknown; width?: unknown; height?: unknown; sourceWidth?: unknown; sourceHeight?: unknown }
      | undefined;
    if (!crop) return null;

    const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
    const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
    const w = typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
    const h = typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null;

    const sourceWidth = typeof crop.sourceWidth === "number" ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
    const sourceHeight = typeof crop.sourceHeight === "number" ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);

    // 运行时预览优先使用本地 flow-asset/blob（上传中 key 可能尚不可用）
    const baseRef =
      (hasInputConnection &&
        typeof connectedFrameImage === "string" &&
        connectedFrameImage.trim()) ||
      (typeof (data as any)?.imageUrl === "string" && (data as any).imageUrl.trim()) ||
      (typeof (data as any)?.imageData === "string" && (data as any).imageData.trim()) ||
      (typeof connectedFrameImage === "string" && connectedFrameImage.trim()) ||
      "";
    if (!baseRef) return null;

    return {
      baseRef,
      rect: { x, y, width: w, height: h },
      sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
      sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
    };
  }, [connectedFrameImage, (data as any)?.crop?.height, (data as any)?.crop?.sourceHeight, (data as any)?.crop?.sourceWidth, (data as any)?.crop?.width, (data as any)?.crop?.x, (data as any)?.crop?.y, data.imageData, data.imageUrl]);

  // ImageSplit -> Image：运行时裁剪预览（不落库）
  const imageSplitCropInfo = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = (Array.isArray(state.edges) ? state.edges : []) as FlowEdgeLike[];
        if (edges.length === 0) return null;
        const nodeById = buildNodeByIdMap(state);
        const primaryImgInputEdgeByTarget = buildPrimaryImgInputEdgeByTargetMap(edges);
        const edgeToThis = primaryImgInputEdgeByTarget.get(id);
        if (!edgeToThis) return null;

        const srcNode = nodeById.get(edgeToThis.source);
        if (!srcNode) return null;

        const specFromImageSplit = (node: any, sourceHandle?: string) => {
          const d = (node.data || {}) as any;
          const baseRef =
            (typeof d.inputImageUrl === "string" && d.inputImageUrl.trim()) ||
            (typeof d.inputImage === "string" && d.inputImage.trim()) ||
            "";
          if (!baseRef) return null;

          const handle = typeof sourceHandle === "string" ? sourceHandle : "";
          const match = handle ? /^image(\\d+)$/.exec(handle) : null;
          if (!match) return null;
          const idx = Math.max(0, Number(match[1]) - 1);

          const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
          const rect = splitRects?.[idx];
          const x = typeof rect?.x === "number" ? rect.x : Number(rect?.x ?? 0);
          const y = typeof rect?.y === "number" ? rect.y : Number(rect?.y ?? 0);
          const w = typeof rect?.width === "number" ? rect.width : Number(rect?.width ?? 0);
          const h = typeof rect?.height === "number" ? rect.height : Number(rect?.height ?? 0);
          if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null;

          const sourceWidth = typeof d.sourceWidth === "number" ? d.sourceWidth : undefined;
          const sourceHeight = typeof d.sourceHeight === "number" ? d.sourceHeight : undefined;
          return {
            baseRef,
            rect: { x, y, width: w, height: h },
            sourceWidth,
            sourceHeight,
          };
        };

        const resolveCropFromImageChain = (node: any, visited: Set<string>): any | null => {
          if (!node?.id || visited.has(node.id)) return null;
          visited.add(node.id);
          if (node.type !== "image" && node.type !== "imagePro") return null;

          const d = (node.data || {}) as any;
          const crop = d?.crop as
            | { x?: unknown; y?: unknown; width?: unknown; height?: unknown; sourceWidth?: unknown; sourceHeight?: unknown }
            | undefined;
          const baseRef =
            (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
            (typeof d.imageData === "string" && d.imageData.trim()) ||
            "";
          if (crop && baseRef) {
            const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
            const h = typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth = typeof crop.sourceWidth === "number" ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
              const sourceHeight = typeof crop.sourceHeight === "number" ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);
              return {
                baseRef,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              };
            }
          }

          const upstream = primaryImgInputEdgeByTarget.get(node.id);
          if (!upstream) return null;
          const up = nodeById.get(upstream.source);
          const handle = (upstream as any).sourceHandle as string | undefined;
          if (up?.type === "imageSplit") {
            return specFromImageSplit(up, handle);
          }
          if (up?.type === "image" || up?.type === "imagePro") {
            return resolveCropFromImageChain(up, visited);
          }
          return null;
        };

        if (srcNode.type === "image" || srcNode.type === "imagePro") {
          return resolveCropFromImageChain(srcNode, new Set());
        }

        if (srcNode.type !== "imageSplit") return null;

        const handle = (edgeToThis as any).sourceHandle as string | undefined;
        return specFromImageSplit(srcNode, handle);
      },
      [id]
    ),
    shallow
  );

  const cropInfo = nodeCropInfo || imageSplitCropInfo;
  const cropBaseRef = cropInfo?.baseRef;
  const cropAssetId = React.useMemo(() => parseFlowImageAssetRef(cropBaseRef), [cropBaseRef]);
  const cropAssetUrl = useFlowImageAssetUrl(cropAssetId);
  const cropSrc = React.useMemo(() => {
    if (!cropInfo || !cropBaseRef) return undefined;
    if (cropAssetId) return cropAssetUrl || undefined;
    return buildImageSrc(cropBaseRef);
  }, [cropAssetId, cropAssetUrl, cropBaseRef, cropInfo]);
  const canvasCrop = cropInfo && cropSrc
    ? {
      src: cropSrc,
      rect: cropInfo.rect,
      sourceWidth: cropInfo.sourceWidth,
      sourceHeight: cropInfo.sourceHeight,
    }
    : undefined;

  const lastCropRef = React.useRef<{
    baseRef: string;
    rect: { x: number; y: number; width: number; height: number };
    sourceWidth?: number;
    sourceHeight?: number;
  } | null>(null);

  React.useEffect(() => {
    if (!cropInfo?.baseRef) return;
    lastCropRef.current = {
      baseRef: cropInfo.baseRef,
      rect: cropInfo.rect,
      sourceWidth: cropInfo.sourceWidth,
      sourceHeight: cropInfo.sourceHeight,
    };
  }, [cropInfo?.baseRef, cropInfo?.rect?.height, cropInfo?.rect?.width, cropInfo?.rect?.x, cropInfo?.rect?.y, cropInfo?.sourceHeight, cropInfo?.sourceWidth]);

  React.useEffect(() => {
    if (hasInputConnection) return;

    const crop = (data as any)?.crop as
      | { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
      | undefined;
    const hasValidCrop =
      crop &&
      Number.isFinite(Number(crop.x ?? 0)) &&
      Number.isFinite(Number(crop.y ?? 0)) &&
      Number(crop.width ?? 0) > 0 &&
      Number(crop.height ?? 0) > 0;
    if (hasValidCrop) return;

    const snapshot = lastCropRef.current;
    if (!snapshot?.baseRef) return;

    const existingBaseRef =
      (typeof data.imageData === "string" && data.imageData.trim()) ||
      (typeof data.imageUrl === "string" && data.imageUrl.trim()) ||
      "";
    if (existingBaseRef && existingBaseRef !== snapshot.baseRef) return;

    const patch: Record<string, unknown> = {
      crop: {
        x: snapshot.rect.x,
        y: snapshot.rect.y,
        width: snapshot.rect.width,
        height: snapshot.rect.height,
        sourceWidth: snapshot.sourceWidth,
        sourceHeight: snapshot.sourceHeight,
      },
    };

    if (!existingBaseRef) {
      if (isPersistableImageRef(snapshot.baseRef)) {
        patch.imageUrl = snapshot.baseRef;
        patch.imageData = undefined;
      } else {
        patch.imageData = snapshot.baseRef;
      }
    }

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch },
      })
    );
  }, [
    (data as any)?.crop?.height,
    (data as any)?.crop?.width,
    (data as any)?.crop?.x,
    (data as any)?.crop?.y,
    data.imageData,
    data.imageUrl,
    hasInputConnection,
    id,
  ]);

  const projectId = useProjectContentStore((state) => state.projectId);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");
  const [isResizing, setIsResizing] = React.useState(false);
  const [isSeparatingLayers, setIsSeparatingLayers] = React.useState(false);
  const updateNodeSize = React.useCallback(
    (width: number, height: number) => {
      const nextWidth = Math.max(1, Math.round(Math.max(width, MIN_WIDTH)));
      const nextHeight = Math.max(1, Math.round(Math.max(height, MIN_HEIGHT)));
      rf.setNodes((ns) => {
        const idx = ns.findIndex((n) => n.id === id);
        if (idx < 0) return ns;
        const node = ns[idx];
        const prevW = (node?.data as any)?.boxW;
        const prevH = (node?.data as any)?.boxH;
        if (prevW === nextWidth && prevH === nextHeight) return ns;
        const next = ns.slice();
        next[idx] = {
          ...node,
          data: { ...(node.data || {}), boxW: nextWidth, boxH: nextHeight },
        };
        return next;
      });
    },
    [rf, id]
  );

  const resizeRafRef = React.useRef<number | null>(null);
  const resizePendingRef = React.useRef<{ w: number; h: number } | null>(null);
  const flushResizeRef = React.useRef<(() => void) | null>(null);

  flushResizeRef.current = () => {
    resizeRafRef.current = null;
    const pending = resizePendingRef.current;
    resizePendingRef.current = null;
    if (!pending) return;
    updateNodeSize(pending.w, pending.h);
  };

  const scheduleResize = React.useCallback(
    (w: number, h: number) => {
      resizePendingRef.current = { w, h };
      if (resizeRafRef.current != null) return;
      resizeRafRef.current = window.requestAnimationFrame(() => {
        flushResizeRef.current?.();
      });
    },
    []
  );

  React.useEffect(() => {
    return () => {
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      resizePendingRef.current = null;
    };
  }, []);
  const handleResizeStart = React.useCallback(() => {
    setIsResizing(true);
  }, []);
  const handleResize = React.useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      if (!params) return;
      scheduleResize(params.width, params.height);
    },
    [scheduleResize]
  );
  const handleResizeEnd = React.useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      setIsResizing(false);
      if (!params) return;
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      resizePendingRef.current = null;
      updateNodeSize(params.width, params.height);
    },
    [updateNodeSize]
  );
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  // 使用全局图片历史记录
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);
  const allImages = React.useMemo(
    () =>
      projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.remoteUrl || item.src,
            title: item.title,
            timestamp: item.timestamp,
          } as ImageItem)
      ),
    [projectHistory]
  );
  const nodeHistoryEntry = React.useMemo(
    () => projectHistory.find((item) => item.nodeId === id),
    [projectHistory, id]
  );
  const resolvedImageName = React.useMemo(() => {
    const direct =
      typeof data.imageName === "string" ? data.imageName.trim() : "";
    if (direct) return direct;
    const fromCurrent = currentImageId
      ? allImages.find((item) => item.id === currentImageId)?.title?.trim()
      : "";
    if (fromCurrent) return fromCurrent;
    return nodeHistoryEntry?.title?.trim() || "";
  }, [data.imageName, currentImageId, allImages, nodeHistoryEntry]);
  const truncatedImageName = React.useMemo(() => {
    if (!resolvedImageName) return "";
    if (resolvedImageName.length > MAX_IMAGE_NAME_LENGTH) {
      const safeLength = Math.max(0, MAX_IMAGE_NAME_LENGTH - 3);
      return `${resolvedImageName.slice(0, safeLength)}...`;
    }
    return resolvedImageName;
  }, [resolvedImageName]);
  const shouldShowImageName = Boolean(data.imageData && truncatedImageName);
  const canSend = Boolean(canvasCrop?.src || displaySrc || fullSrc);
  const volcSourceUrl = React.useMemo(() => {
    const candidates = [
      data.imageUrl,
      cropInfo?.baseRef,
      connectedFrameImage,
      data.imageData,
    ];
    for (const candidate of candidates) {
      const url = buildPublicImageUrlForVolc(candidate);
      if (url) return url;
    }
    return undefined;
  }, [connectedFrameImage, cropInfo?.baseRef, data.imageData, data.imageUrl]);

  // ── Volc Asset Library audit state ──────────────────────────────────────────
  const volcAssetId: string | undefined = (data as any)?.volcAssetId;
  const volcAssetStatus: VolcAssetStatus | undefined = (data as any)?.volcAssetStatus;
  const volcAssetError: string | undefined = (data as any)?.volcAssetError;
  const volcReviewDate: string | undefined = (data as any)?.volcReviewDate;

  const REVIEW_VALID_DAYS = 3;
  const isReviewExpired = React.useMemo(() => {
    if (volcAssetStatus !== "active" || !volcReviewDate) return false;
    const expiresAt = new Date(volcReviewDate).getTime() + REVIEW_VALID_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() > expiresAt;
  }, [volcAssetStatus, volcReviewDate]);

  // Effective status: expired active → treat as unreviewed
  const effectiveVolcStatus: VolcAssetStatus | undefined = isReviewExpired ? undefined : volcAssetStatus;

  const patchNode = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch },
      })
    );
  }, [id]);

  useVolcAssetPolling({
    assetId: volcAssetId,
    status: effectiveVolcStatus,
    onUpdate: ({ status, errorMessage }) => {
      patchNode({
        volcAssetStatus: status,
        volcAssetError: errorMessage,
        ...(status === "active" ? { volcReviewDate: new Date().toISOString() } : {}),
      });
    },
  });

  // Recover stuck "processing" state with no assetId — means the upload request
  // was interrupted (refresh / crash / network drop) before the server replied.
  // Runs once on mount; in-flight uploads set state AFTER mount so won't trigger.
  React.useEffect(() => {
    if (volcAssetStatus === "processing" && !volcAssetId) {
      patchNode({
        volcAssetStatus: "failed",
        volcAssetError: "上传中断，请重试",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReviewClick = React.useCallback(async () => {
    const sourceUrl = volcSourceUrl;
    if (!sourceUrl) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "请先上传可访问的图片再送审", type: "warning" },
        })
      );
      return;
    }
    if (effectiveVolcStatus === "processing") return;
    patchNode({ volcAssetStatus: "processing", volcAssetError: undefined, volcReviewDate: undefined });
    try {
      const r = await uploadVolcAsset(sourceUrl);
      patchNode({
        volcAssetId: r.assetId,
        volcAssetStatus: r.status,
        volcAssetError: r.errorMessage,
        ...(r.status === "active" ? { volcReviewDate: new Date().toISOString() } : {}),
      });
    } catch (err: any) {
      patchNode({
        volcAssetId: undefined,
        volcAssetStatus: "failed",
        volcAssetError: err?.message || "上传失败",
      });
    }
  }, [effectiveVolcStatus, patchNode, volcSourceUrl]);

  // ── Bio Auth state ────────────────────────────────────────────────────────
  const bioAuthId: string | undefined = (data as any)?.bioAuthId;
  const bioAuthStatus: BioAuthStatus | undefined = (data as any)?.bioAuthStatus;
  const bioAuthDate: string | undefined = (data as any)?.bioAuthDate;
  const bioAuthError: string | undefined = (data as any)?.bioAuthError;

  const isBioAuthExpired = React.useMemo(() => {
    if (bioAuthStatus !== "active" || !bioAuthDate) return false;
    const expiresAt = new Date(bioAuthDate).getTime() + BIO_AUTH_VALID_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() > expiresAt;
  }, [bioAuthStatus, bioAuthDate]);

  const effectiveBioStatus: BioAuthStatus | undefined = isBioAuthExpired ? undefined : bioAuthStatus;

  const bioAuthDaysLeft = React.useMemo(() => {
    if (effectiveBioStatus !== "active" || !bioAuthDate) return 0;
    const expiresAt = new Date(bioAuthDate).getTime() + BIO_AUTH_VALID_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  }, [effectiveBioStatus, bioAuthDate]);

  const [bioAuthModalOpen, setBioAuthModalOpen] = React.useState(false);

  useBioAuthPolling({
    taskId: bioAuthId,
    status: effectiveBioStatus,
    onUpdate: ({ status, errorMessage, assetId }) => {
      patchNode({
        bioAuthStatus: status,
        bioAuthError: errorMessage,
        ...(status === "active" ? {
          bioAuthDate: new Date().toISOString(),
          ...(assetId ? {
            volcAssetId: assetId,
            volcAssetStatus: "active",
            volcReviewDate: new Date().toISOString(),
          } : {}),
        } : {}),
      });
    },
  });

  // Recover stuck "processing" state with no taskId — means the request was interrupted
  React.useEffect(() => {
    if (bioAuthStatus === "processing" && !bioAuthId) {
      patchNode({ bioAuthStatus: "failed", bioAuthError: "认证中断，请重试" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ────────────────────────────────────────────────────────────────────────────

  React.useEffect(() => {
    setNodeLabel(normalizedNodeLabel);
    if (!isEditingNodeLabel) {
      setNodeLabelDraft(normalizedNodeLabel);
    }
  }, [normalizedNodeLabel, isEditingNodeLabel]);

  React.useEffect(() => {
    if (!isEditingNodeLabel) return;
    requestAnimationFrame(() => {
      nodeLabelInputRef.current?.focus();
      nodeLabelInputRef.current?.select();
    });
  }, [isEditingNodeLabel]);

  const startNodeLabelEditing = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setNodeLabelDraft(nodeLabel);
    setIsEditingNodeLabel(true);
  }, [nodeLabel]);

  const commitNodeLabel = React.useCallback((raw: string) => {
    const trimmed = raw.trim();
    const nextLabel = trimmed.length ? trimmed : DEFAULT_NODE_LABEL;
    setNodeLabel(nextLabel);
    setNodeLabelDraft(nextLabel);
    setIsEditingNodeLabel(false);
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            label: nextLabel,
          },
        },
      })
    );
  }, [id]);

  const cancelNodeLabelEditing = React.useCallback(() => {
    setIsEditingNodeLabel(false);
    setNodeLabelDraft(nodeLabel);
  }, [nodeLabel]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview]);

  const notifyToast = React.useCallback(
    (message: string, type: "success" | "warning" | "error" | "info") => {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message, type },
        })
      );
    },
    []
  );

  const buildOutputFileName = React.useCallback(
    (suffix?: string) => {
      const base = resolvedImageName || `flow_${id}_${Date.now()}`;
      const normalizedBase = base.replace(/\.(png|jpe?g|webp)$/i, "");
      return `${normalizedBase}${suffix ? `-${suffix}` : ""}.png`;
    },
    [id, resolvedImageName]
  );

  const resolveRenderableToDataUrl = React.useCallback(
    async (value: string): Promise<string | null> => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("data:")) return trimmed;
      if (
        trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX) ||
        trimmed.startsWith("blob:")
      ) {
        const blob = await resolveImageToBlob(trimmed, { preferProxy: true });
        if (!blob) return null;
        return await blobToDataUrl(blob);
      }
      if (
        trimmed.startsWith("/api/assets/proxy") ||
        trimmed.startsWith("/assets/proxy") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("/") ||
        trimmed.startsWith("./") ||
        trimmed.startsWith("../") ||
        /^(templates|projects|uploads|videos)\//i.test(trimmed)
      ) {
        return trimmed;
      }
      const compact = trimmed.replace(/\s+/g, "");
      if (!compact) return null;
      return `data:image/png;base64,${compact}`;
    },
    []
  );

  const resolveRenderableToStrictDataUrl = React.useCallback(
    async (value: string): Promise<string | null> => {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("data:")) return trimmed;

      const compact = trimmed.replace(/\s+/g, "");
      if (compact && /^[A-Za-z0-9+/=]+$/.test(compact)) {
        return `data:image/png;base64,${compact}`;
      }

      const blob = await resolveImageToBlob(trimmed, { preferProxy: true });
      if (!blob) return null;
      return await blobToDataUrl(blob);
    },
    []
  );

  const cropImageToDataUrl = React.useCallback(
    async (params: {
      baseRef: string;
      rect: { x: number; y: number; width: number; height: number };
      sourceWidth?: number;
      sourceHeight?: number;
    }): Promise<string | null> => {
      const baseRef = params.baseRef?.trim?.() || "";
      if (!baseRef) return null;

      const w = Math.max(1, Math.round(params.rect.width));
      const h = Math.max(1, Math.round(params.rect.height));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return null;
      }

      const blob = await resolveImageToBlob(baseRef, { preferProxy: true });
      if (!blob || typeof createImageBitmap !== "function") return null;

      const bitmap = await createImageBitmapLimited(blob);
      try {
        const naturalW = bitmap.width;
        const naturalH = bitmap.height;
        if (!naturalW || !naturalH) return null;

        const srcW =
          typeof params.sourceWidth === "number" && params.sourceWidth > 0
            ? params.sourceWidth
            : naturalW;
        const srcH =
          typeof params.sourceHeight === "number" && params.sourceHeight > 0
            ? params.sourceHeight
            : naturalH;

        const scaleX = srcW > 0 ? naturalW / srcW : 1;
        const scaleY = srcH > 0 ? naturalH / srcH : 1;

        const sx = Math.max(
          0,
          Math.min(naturalW - 1, Math.round(params.rect.x * scaleX))
        );
        const sy = Math.max(
          0,
          Math.min(naturalH - 1, Math.round(params.rect.y * scaleY))
        );
        const swRaw = Math.max(1, Math.round(params.rect.width * scaleX));
        const shRaw = Math.max(1, Math.round(params.rect.height * scaleY));
        const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
        const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

        const canvas =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(w, h)
            : Object.assign(document.createElement("canvas"), {
                width: w,
                height: h,
              });
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
        const outBlob = await canvasToBlob(canvas, { type: "image/png" });
        return await blobToDataUrl(outBlob);
      } finally {
        try {
          bitmap.close();
        } catch {}
      }
    },
    []
  );

  const resolveCurrentImageSource = React.useCallback(async (): Promise<string | null> => {
    if (canvasCrop && cropInfo?.rect && cropBaseRef) {
      return await cropImageToDataUrl({
        baseRef: cropBaseRef,
        rect: cropInfo.rect,
        sourceWidth: cropInfo.sourceWidth,
        sourceHeight: cropInfo.sourceHeight,
      });
    }

    const baseRef =
      (typeof rawFullValue === "string" && rawFullValue.trim()) ||
      (typeof rawThumbValue === "string" && rawThumbValue.trim()) ||
      displaySrc ||
      fullSrc ||
      "";
    if (!baseRef) return null;
    return await resolveRenderableToDataUrl(baseRef);
  }, [
    canvasCrop,
    cropBaseRef,
    cropImageToDataUrl,
    cropInfo,
    displaySrc,
    fullSrc,
    rawFullValue,
    rawThumbValue,
    resolveRenderableToDataUrl,
  ]);

  const resolveCurrentSplitImageDataUrl = React.useCallback(async (): Promise<string | null> => {
    if (canvasCrop && cropInfo?.rect && cropBaseRef) {
      return await cropImageToDataUrl({
        baseRef: cropBaseRef,
        rect: cropInfo.rect,
        sourceWidth: cropInfo.sourceWidth,
        sourceHeight: cropInfo.sourceHeight,
      });
    }

    const baseRef =
      (typeof rawFullValue === "string" && rawFullValue.trim()) ||
      (typeof rawThumbValue === "string" && rawThumbValue.trim()) ||
      displaySrc ||
      fullSrc ||
      "";
    if (!baseRef) return null;
    return await resolveRenderableToStrictDataUrl(baseRef);
  }, [
    canvasCrop,
    cropBaseRef,
    cropImageToDataUrl,
    cropInfo,
    displaySrc,
    fullSrc,
    rawFullValue,
    rawThumbValue,
    resolveRenderableToStrictDataUrl,
  ]);

  const handleSendToCanvas = React.useCallback(async (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!canSend) return;
    const anchorClient = resolveFlowNodeSendAnchorClient({
      nodeId: id,
      triggerTarget: event?.currentTarget ?? null,
    });

    const emitSend = (imageData: string) => {
      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData,
            fileName: buildOutputFileName(),
            operationType: "generate",
            smartPosition: undefined,
            anchorClient,
            forceAnchorPosition: true,
            sourceImageId: undefined,
            sourceImages: undefined,
          },
        })
      );
      notifyToast(lt("图片已发送到画板", "Image sent to canvas"), "success");
    };

    const resolved = await resolveCurrentImageSource();
    if (!resolved) {
      notifyToast(lt("没有可发送的图片", "No image available to send"), "warning");
      return;
    }
    emitSend(resolved);
  }, [
    buildOutputFileName,
    canSend,
    id,
    lt,
    notifyToast,
    resolveCurrentImageSource,
  ]);

  const handleLayerSeparation = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (isSeparatingLayers) return;

      const anchorClient = resolveFlowNodeSendAnchorClient({
        nodeId: id,
        triggerTarget: event.currentTarget,
      });
      const baseImage = await resolveCurrentSplitImageDataUrl();
      if (!baseImage) {
        notifyToast(lt("没有可分层的图片", "No image available to split"), "warning");
        return;
      }

      setIsSeparatingLayers(true);
      notifyToast(lt("正在分层...", "Separating layers..."), "info");

      try {
        const outputs = await splitImageIntoLayers(baseImage, {
          analyzeImage: aiImageService.analyzeImage.bind(aiImageService),
          editImage: aiImageService.editImage.bind(aiImageService),
          removeBackground: backgroundRemovalService.removeBackground.bind(
            backgroundRemovalService
          ),
          getImageModelForProvider,
          textRecognitionProviderOptions: {
            banana: { imageRoute: bananaImageRoute },
            bananaImageRoute,
          },
        });

        const batchId = Date.now();
        const parallelGroupId = `flow_layer_split_${id}_${batchId}`;
        outputs.forEach((item, index) => {
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: item.imageData,
                fileName: buildOutputFileName(item.label),
                operationType: "layer-split",
                smartPosition: undefined,
                anchorClient,
                forceAnchorPosition: true,
                sourceImageId: id,
                sourceImages: undefined,
                preferHorizontal: true,
                parallelGroupId,
                parallelGroupIndex: index,
                parallelGroupTotal: outputs.length,
              },
            })
          );
        });

        notifyToast(
          outputs.length >= 4
            ? lt("分层完成，已生成 4 张结果", "Layer split complete with 4 outputs")
            : outputs.length >= 2
            ? lt("分层完成，已生成主体层和背景层", "Layer split complete with subject and background")
            : lt("分层部分完成，已生成部分结果", "Layer split partially completed"),
          outputs.length >= 2 ? "success" : "warning"
        );
      } catch (error) {
        logger.error("Flow 图片节点分层失败", error);
        notifyToast(lt("分层失败，请稍后重试", "Layer split failed. Please try again later"), "error");
      } finally {
        setIsSeparatingLayers(false);
      }
    },
    [
      bananaImageRoute,
      buildOutputFileName,
      id,
      isSeparatingLayers,
      lt,
      notifyToast,
      resolveCurrentSplitImageDataUrl,
    ]
  );

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    const normalizedFileName = (file.name || "").trim();
    const displayName = normalizedFileName || lt("未命名图片", "Untitled Image");
    const previousNodeData = (() => {
      try {
        return ((rf.getNode(id)?.data || {}) as Record<string, unknown>);
      } catch {
        return {};
      }
    })();
    const previousImageUrl =
      typeof previousNodeData.imageUrl === "string"
        ? previousNodeData.imageUrl.trim()
        : "";
    const previousImageData =
      typeof previousNodeData.imageData === "string"
        ? previousNodeData.imageData
        : undefined;
    const previousThumbnail =
      typeof previousNodeData.thumbnail === "string"
        ? previousNodeData.thumbnail
        : undefined;
    const previousImageName =
      typeof previousNodeData.imageName === "string"
        ? previousNodeData.imageName
        : undefined;

    const uploadDir = projectId
      ? `projects/${projectId}/images/`
      : "uploads/images/";
    const { key } = generateOssKey({
      projectId,
      dir: uploadDir,
      fileName: file.name,
      contentType: file.type,
    });

    const newImageId = `${id}-${Date.now()}`;
    setCurrentImageId(newImageId);
    const uploadToken = `upload-${newImageId}`;

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            imageName: displayName,
            uploading: true,
            uploadError: undefined,
            uploadToken,
          },
        },
      })
    );
    const buildUploadFailurePatch = (message: string): Record<string, unknown> => {
      const patch: Record<string, unknown> = {
        uploading: false,
        uploadError: message,
        uploadToken: undefined,
      };

      try {
        const currentNode = rf.getNode(id);
        const currentData = ((currentNode?.data || {}) as Record<string, unknown>);
        const currentUploadToken =
          typeof currentData.uploadToken === "string"
            ? currentData.uploadToken
            : "";

        if (currentUploadToken !== uploadToken) {
          return patch;
        }

        // 上传失败时不要继续持久化“预分配但未落地”的 key，
        // 否则刷新后会读到空对象并出现“幽灵图”。
        if (previousImageUrl) {
          patch.imageUrl = previousImageUrl;
          patch.imageData = previousImageData;
          patch.thumbnail = previousThumbnail;
          patch.imageName = previousImageName;
        } else {
          patch.imageUrl = undefined;
          patch.imageData = undefined;
          patch.thumbnail = undefined;
        }
      } catch {}

      return patch;
    };

    try {
      const uploadResult = await imageUploadService.uploadImageFile(file, {
        projectId: projectId ?? undefined,
        dir: uploadDir,
        fileName: file.name || `flow_image_${newImageId}.png`,
        key,
      });

      if (!uploadResult.success || !uploadResult.asset?.url) {
        const errorMessage =
          uploadResult.error || lt("上传失败", "Upload failed");
        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: {
              id,
              patch: buildUploadFailurePatch(errorMessage),
            },
          })
        );
        return;
      }

      const persistedRef = pickPersistedImageRefFromUploadAsset(
        uploadResult.asset,
        key
      ).trim();
      if (!persistedRef) return;

      // 防止并发上传回写覆盖：只处理当前 uploadToken 对应的上传结果
      try {
        const current = rf.getNode(id);
        const currentToken = (current?.data as any)?.uploadToken;
        if (currentToken && currentToken !== uploadToken) {
          return;
        }
      } catch {}

      const persistedDisplayRef =
        (typeof uploadResult.asset.url === "string" &&
          uploadResult.asset.url.trim()) ||
        persistedRef;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              imageUrl: persistedDisplayRef,
              imageData: undefined,
              thumbnail: undefined,
              uploading: false,
              uploadError: undefined,
              uploadToken: undefined,
              // Clear volc audit state when source image changes
              volcAssetId: undefined,
              volcAssetStatus: undefined,
              volcAssetError: undefined,
              volcReviewDate: undefined,
              // Clear bio auth state when source image changes
              bioAuthId: undefined,
              bioAuthStatus: undefined,
              bioAuthError: undefined,
              bioAuthDate: undefined,
            },
          },
        })
      );

      void recordImageHistoryEntry({
        id: newImageId,
        remoteUrl: uploadResult.asset.url,
        title: displayName,
        nodeId: id,
        nodeType: "image",
        fileName: uploadResult.asset.fileName || file.name || `flow_image_${newImageId}.png`,
        projectId,
        keepThumbnail: false,
      }).catch(() => {});
    } catch (err: any) {
      const errorMessage = err?.message || lt("上传失败", "Upload failed");
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: buildUploadFailurePatch(errorMessage),
          },
        })
      );
    }
  }, [id, projectId, rf]);

  const onDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDoubleClick = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onPaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      // 仅当剪贴板里有图片时才拦截，避免吃掉全局 Flow 粘贴（节点复制）
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        e.stopPropagation();
        const fileList = new DataTransfer();
        fileList.items.add(file);
        handleFiles(fileList.files);
        return;
      }
    },
    [handleFiles]
  );

  return (
    <div
      className={`flow-image-node${
        isResizing ? " flow-image-node--resizing" : ""
      }`}
      onPaste={onPaste}
      tabIndex={0}
      style={{
        width: data.boxW || 260,
        height: data.boxH || 240,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        outline: "none",
      }}
    >
      {lineControlConfigs.map((config) => (
        <NodeResizeControl
          key={`line-${config.position}`}
          position={config.position}
          variant='line'
          className='image-node-resize-line'
          style={config.style}
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      ))}
      {handleControlConfigs.map((config) => (
        <NodeResizeControl
          key={`handle-${config.position}`}
          position={config.position}
          className='image-node-resize-handle'
          style={config.style}
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        {isEditingNodeLabel ? (
          <input
            ref={nodeLabelInputRef}
            value={nodeLabelDraft}
            onChange={(event) => setNodeLabelDraft(event.target.value)}
            onBlur={() => commitNodeLabel(nodeLabelDraft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitNodeLabel(nodeLabelDraft);
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelNodeLabelEditing();
              }
            }}
            onPointerDownCapture={(event) => {
              event.stopPropagation();
            }}
            onMouseDownCapture={(event) => {
              event.stopPropagation();
            }}
            className='nodrag nopan'
            style={{
              fontWeight: 600,
              fontSize: 14,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "2px 6px",
              outline: "none",
              minWidth: 80,
              maxWidth: 160,
            }}
          />
        ) : (
          <div
            onDoubleClick={startNodeLabelEditing}
            title={lt("双击编辑标题", "Double click to edit title")}
            style={{ fontWeight: 600, cursor: "text", userSelect: "none" }}
          >
            {nodeLabel}
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {(() => {
            const reviewTitle =
              isReviewExpired ? "审核已过期，点击重新审核"
              : effectiveVolcStatus === "active" ? "已通过审核"
              : effectiveVolcStatus === "processing" ? "审核中…"
              : effectiveVolcStatus === "failed" ? (volcAssetError || "审核失败，点击重试")
              : "审核通过可用于sd2";
            return (
          <button
            type="button"
            onClick={handleReviewClick}
            title={reviewTitle}
            aria-label={reviewTitle}
            disabled={effectiveVolcStatus === "processing"}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: effectiveVolcStatus === "processing" ? "not-allowed" : "pointer",
            }}
          >
            {isReviewExpired ? <ShieldAlert size={14} className="text-orange-400" />
             : effectiveVolcStatus === "active" ? <ShieldCheck size={14} className="text-green-600" />
             : effectiveVolcStatus === "processing" ? <Loader2 size={14} className="animate-spin text-amber-500" />
             : effectiveVolcStatus === "failed" ? <ShieldAlert size={14} className="text-red-500" />
             : <Shield size={14} className="text-gray-400" />}
          </button>
            );
          })()}
          {/* Bio Auth Badge */}
          {(() => {
            const bioTitle =
              isBioAuthExpired ? "认证已过期，点击重新认证"
              : effectiveBioStatus === "active" ? `已认证（${bioAuthDaysLeft} 天后过期，点击重新认证）`
              : effectiveBioStatus === "processing" ? "认证中…"
              : effectiveBioStatus === "failed" ? (bioAuthError || "认证失败，点击重试")
              : "点击进行生物认证";
            return (
              <button
                type="button"
                onClick={() => {
                  if (!volcSourceUrl) {
                    window.dispatchEvent(new CustomEvent("toast", {
                      detail: { message: "请先上传可访问的图片再认证", type: "warning" },
                    }));
                    return;
                  }
                  setBioAuthModalOpen(true);
                }}
                title={bioTitle}
                aria-label={bioTitle}
                disabled={effectiveBioStatus === "processing"}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  cursor: effectiveBioStatus === "processing" ? "not-allowed" : "pointer",
                }}
              >
                {isBioAuthExpired ? <ShieldAlert size={14} className="text-orange-400" />
                 : effectiveBioStatus === "active" ? <UserRound size={14} className="text-green-600" />
                 : effectiveBioStatus === "processing" ? <Loader2 size={14} className="animate-spin text-blue-500" />
                 : effectiveBioStatus === "failed" ? <ShieldAlert size={14} className="text-red-500" />
                 : <UserRound size={14} className="text-gray-400" />}
              </button>
            );
          })()}
          <button
            onClick={handleSendToCanvas}
            disabled={!canSend}
            title={
              !canSend
                ? lt("无可发送的图像", "No image to send")
                : lt("发送到画布", "Send to canvas")
            }
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: !canSend ? "#e5e7eb" : "#fff",
              cursor: !canSend ? "not-allowed" : "pointer",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleLayerSeparation}
            disabled={!canSend || isSeparatingLayers}
            title={
              isSeparatingLayers
                ? lt("正在分层...", "Separating layers...")
                : lt("一键分层", "One-click layer split")
            }
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: !canSend || isSeparatingLayers ? "#e5e7eb" : "#fff",
              cursor:
                !canSend || isSeparatingLayers ? "not-allowed" : "pointer",
            }}
          >
            {isSeparatingLayers ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Layers size={14} />
            )}
          </button>
          {hasInputConnection && (
            <button
              onClick={() => {
                // 只断开输入连线，不清空图片数据
                try {
                  const edges = rf.getEdges();
                  const remain = edges.filter(
                    (e) => !(e.target === id && e.targetHandle === "img")
                  );
                  rf.setEdges(remain);
                } catch {}
              }}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {lt("内置", "Detach")}
            </button>
          )}
          {data.imageData && (
            <button
              onClick={() => {
                const ev = new CustomEvent("flow:updateNodeData", {
                  detail: {
                    id,
                    patch: {
                      imageData: undefined,
                      imageName: undefined,
                      volcAssetId: undefined,
                      volcAssetStatus: undefined,
                      volcAssetError: undefined,
                      bioAuthId: undefined,
                      bioAuthStatus: undefined,
                      bioAuthError: undefined,
                      bioAuthDate: undefined,
                    },
                  },
                });
                window.dispatchEvent(ev);
                // 同步断开输入连线
                try {
                  const edges = rf.getEdges();
                  const remain = edges.filter(
                    (e) => !(e.target === id && e.targetHandle === "img")
                  );
                  rf.setEdges(remain);
                } catch {}
              }}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {lt("清空", "Clear")}
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type='file'
        accept='image/*'
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {shouldShowImageName && (
        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={resolvedImageName}
        >
          {truncatedImageName}
        </div>
      )}

      <ImageContent
        displaySrc={displaySrc}
        canvasCrop={canvasCrop}
        isResizing={isResizing}
        uploading={Boolean((data as any)?.uploading)}
        uploadError={typeof (data as any)?.uploadError === "string" ? (data as any).uploadError : ""}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDoubleClick={handleDoubleClick}
        isFlowDark={isFlowDark}
        lt={lt}
      />

      {/* 兼容历史连线：旧项目可能使用 targetHandle=image */}
      <Handle
        type='target'
        position={Position.Left}
        id='image'
        style={{
          top: "50%",
          width: 1,
          height: 1,
          opacity: 0,
          border: "none",
          background: "transparent",
          pointerEvents: "none",
        }}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='img'
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img'
        onMouseEnter={() => setHover("img-out")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "img-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "img-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          image
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src ||
              fullSrc ||
              ""
            : fullSrc || ""
        }
        imageTitle={lt('全局图片预览', 'Global image preview')}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={(imageId: string) => {
          const selectedImage = allImages.find((item) => item.id === imageId);
          if (selectedImage) {
            setCurrentImageId(imageId);
          }
        }}
      />
      {/* Bio Auth Modal */}
      <BioAuthModal
        isOpen={bioAuthModalOpen}
        imageUrl={volcSourceUrl || ""}
        onClose={() => setBioAuthModalOpen(false)}
        onStart={(taskId) => {
          patchNode({
            bioAuthId: taskId,
            bioAuthStatus: "processing",
            bioAuthError: undefined,
            bioAuthDate: undefined,
          });
        }}
        onSuccess={(taskId, assetId, _groupId) => {
          patchNode({
            bioAuthId: taskId,
            bioAuthStatus: "active",
            bioAuthError: undefined,
            bioAuthDate: new Date().toISOString(),
            volcAssetId: assetId,
            volcAssetStatus: "active",
            volcReviewDate: new Date().toISOString(),
          });
          setBioAuthModalOpen(false);
        }}
        onFail={(errorMessage) => {
          patchNode({
            bioAuthStatus: "failed",
            bioAuthError: errorMessage,
          });
          setBioAuthModalOpen(false);
        }}
      />
    </div>
  );
}

export default React.memo(ImageNodeInner);
