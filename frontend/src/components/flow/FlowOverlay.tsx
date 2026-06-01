// @ts-nocheck
// Flow 主画布与节点调度入口。
import React from "react";
import { Trash2, Plus, Upload, Download, Group, Ungroup, Lock, Crown } from "lucide-react";
import { fetchTemplateCategories } from "@/services/publicTemplateService";
import { fetchWithAuth } from "@/services/authFetch";
import SharedTemplateCard from "@/components/template/SharedTemplateCard";
import SmartImage from "@/components/ui/SmartImage";
import paper from "paper";
import ReactFlow, {
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "reactflow";
import { ReactFlowProvider } from "reactflow";
import { useCanvasStore } from "@/stores";
import { useToolStore } from "@/stores";
import "reactflow/dist/style.css";
import "./flow.css";
import type {
  FlowTemplate,
  TemplateIndexEntry,
  TemplateNode,
  TemplateEdge,
} from "@/types/template";
import {
  loadBuiltInTemplateIndex,
  loadBuiltInTemplateById,
  listUserTemplates,
  getUserTemplate,
  saveUserTemplate,
  deleteUserTemplate,
  generateId,
} from "@/services/templateStore";

import TextPromptNode from "./nodes/TextPromptNode";
import TextPromptProNode from "./nodes/TextPromptProNode";
import TextChatNode from "./nodes/TextChatNode";
import ImageNode from "./nodes/ImageNode";
import GenerateNode from "./nodes/GenerateNode";
import Generate4Node from "./nodes/Generate4Node";
import GenerateReferenceNode from "./nodes/GenerateReferenceNode";
import ThreeNode from "./nodes/ThreeNode";
import CameraNode from "./nodes/CameraNode";
import ViewAngleNode from "./nodes/ViewAngleNode";
import PromptOptimizeNode from "./nodes/PromptOptimizeNode";
import AnalysisNode from "./nodes/AnalyzeNode";
import Sora2VideoNode from "./nodes/Sora2VideoNode";
import Sora2CharacterNode from "./nodes/Sora2CharacterNode";
import Wan26Node from "./nodes/Wan26Node";
import Wan2R2VNode from "./nodes/Wan2R2VNode";
import HappyhorseR2VNode from "./nodes/HappyhorseR2VNode";
import Wan27VideoNode from "./nodes/Wan27VideoNode";
import TextNoteNode from "./nodes/TextNoteNode";
import StoryboardSplitNode from "./nodes/StoryboardSplitNode";
import GenerateProNode from "./nodes/GenerateProNode";
import GeneratePro4Node from "./nodes/GeneratePro4Node";
import ImageProNode from "./nodes/ImageProNode";
import MidjourneyNode from "./nodes/MidjourneyNode";
import KlingVideoNode from "./nodes/KlingVideoNode";
import Kling26VideoNode from "./nodes/Kling26VideoNode";
import Kling30VideoNode from "./nodes/Kling30VideoNode";
import KlingO1VideoNode from "./nodes/KlingO3VideoNode";
import ViduVideoNode from "./nodes/ViduVideoNode";
import ViduQ3ProVideoNode from "./nodes/ViduQ3ProVideoNode";
import DoubaoVideoNode from "./nodes/DoubaoVideoNode";
import Seedance20VideoNode from "./nodes/Seedance20VideoNode";
import VideoNode from "./nodes/VideoNode";
import AudioNode from "./nodes/AudioNode";
import VideoAnalyzeNode from "./nodes/VideoAnalyzeNode";
import {
  getManagedRouteCredits,
  getManagedRouteOption,
  resolveManagedRoutePricing,
} from "./managedRoutePricing";
import VideoFrameExtractNode from "./nodes/VideoFrameExtractNode";
import VideoToGifNode from "./nodes/VideoToGifNode";
import ImageGridNode from "./nodes/ImageGridNode";
import ImageSplitNode from "./nodes/ImageSplitNode";
import ImageCompressNode from "./nodes/ImageCompressNode";
import MinimaxSpeechNode from "./nodes/MinimaxSpeechNode";
import MinimaxMusicNode from "./nodes/MinimaxMusicNode";
import TencentSpeechNode from "./nodes/TencentSpeechNode";
import Nano2Node from "./nodes/Nano2Node";
import Seedream5Node from "./nodes/Seedream5Node";
import NodeGroupNode from "./nodes/NodeGroupNode";
import { resolveFlowNodeSendAnchorClient } from "./utils/flowNodeSendAnchor";
import { FLOW_IMAGE_ASSET_PREFIX } from "@/services/flowImageAssetStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import {
  useFlowStore,
  FlowBackgroundVariant,
  FlowEdgeColorMode,
} from "@/stores/flowStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { useUIStore } from "@/stores";
import {
  useAIChatStore,
  getImageModelForProvider,
  uploadImageToOSS,
  uploadVideoToOSS,
  requestSora2VideoGeneration,
  DEFAULT_SORA2_VIDEO_QUALITY,
} from "@/stores/aiChatStore";
import type { Sora2VideoQuality } from "@/stores/aiChatStore";
import { historyService } from "@/services/historyService";
import {
  clipboardService,
  type ClipboardFlowNode,
} from "@/services/clipboardService";
import {
  proxifyRemoteAssetUrl,
  resolvePublicAssetUrlFromKey,
} from "@/utils/assetProxy";
import {
  isAssetProxyRef,
  isBlobUrl,
  isDataImageUrl,
  isLikelyBackendAllowedRemoteUrl,
  isPersistableImageRef,
  isRemoteUrl,
  normalizeRemoteUrl,
  normalizePersistableImageRef,
  requiresManagedImageUpload,
  resolveImageToBlob,
  resolveImageToDataUrl,
} from "@/utils/imageSource";
import {
  blobToDataUrl,
  canvasToBlob,
  createImageBitmapLimited,
  responseToBlob,
} from "@/utils/imageConcurrency";
import { aiImageService } from "@/services/aiImageService";
import {
  generateImageViaAPI,
  editImageViaAPI,
  blendImagesViaAPI,
  createSora2CharacterViaAPI,
  generateWan26ViaAPI,
  generateWan26R2VViaAPI,
  generateHappyhorseVideoViaAPI,
  generateWan27I2VViaAPI,
  midjourneyActionViaAPI,
  querySora2CharacterTaskViaAPI,
  queryDashscopeTask,
} from "@/services/aiBackendAPI";
import {
  generateVideoByProvider,
  markVideoTaskSuccess,
  queryVideoTask,
  refundVideoTask,
  type VideoProvider,
} from "@/services/videoProviderAPI";
import {
  buildViduRequestSemantics,
  getEffectiveViduProvider,
  isViduQ3FamilyModel,
  normalizeViduModelForApi,
  normalizeViduModelValue,
  type ViduModelValue,
} from "@/services/videoProviderParams";
import { imageUploadService } from "@/services/imageUploadService";
import { personalLibraryApi } from "@/services/personalLibraryApi";
import {
  fetchNodeConfigs,
  getStatusBadge,
  NODE_CONFIG_SYNC_DOM_EVENT,
  NODE_CONFIG_SYNC_STORAGE_KEY,
  type NodeConfig,
} from "@/services/nodeConfigService";
import {
  createPersonalAssetId,
  usePersonalLibraryStore,
  type PersonalImageAsset,
} from "@/stores/personalLibraryStore";
import { normalizeWheelDelta, computeSmoothZoom } from "@/lib/zoomUtils";
import type { AIImageGenerateRequest, AIImageResult } from "@/types/ai";
import MiniMapImageOverlay from "./MiniMapImageOverlay";
import PersonalLibraryPanel from "./PersonalLibraryPanel";
import {
  FlowRenderModeProvider,
  type FlowRenderMode,
} from "./FlowRenderModeContext";
import { resolveTextFromSourceNode } from "./utils/textSource";
import { sanitizeFlowTextForMidjourneyV7 } from "./utils/mjV7PromptSanitize";
import { useLocaleText } from "@/utils/localeText";
import { resolveFlowModelProvider } from "@/utils/flowModelProvider";
import {
  detectAlignments,
  deduplicateAlignments,
  type AlignmentLine,
  type ObjectBounds,
} from "@/utils/snapAlignment";

// 兼容历史多图输入句柄：将 targetHandle img1/img2/... 归一化到 img
const normalizeFlowTargetHandle = (
  handle?: string | null
): string | undefined => {
  if (typeof handle !== "string") return handle ?? undefined;
  if (/^img\d+$/.test(handle)) return "img";
  if (handle.toLowerCase() === "omniimage") return "omniImage";
  return handle;
};

// 兼容历史输出句柄：将 sourceHandle image/image1/image-1 归一化到 img/img1
const normalizeFlowSourceHandle = (
  handle?: string | null
): string | undefined => {
  if (typeof handle !== "string") return handle ?? undefined;
  const trimmed = handle.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "omniimage") return "omniImage";
  if (lower === "image") return "img";
  const imageIndexMatch = lower.match(/^image[-_]?(\d+)$/);
  if (imageIndexMatch?.[1]) {
    return `img${imageIndexMatch[1]}`;
  }
  return trimmed;
};

const FLOW_EDGE_STANDARD_COLOR = "#9ca3af";
const FLOW_EDGE_COLOR_BY_KIND = {
  text: "#22c55e",
  image: "#f97316",
  video: "#a855f7",
  images: "#eab308",
  audio: "#ec4899",
} as const;
const FLOW_AUTO_VISIBLE_RENDER_NODE_THRESHOLD = 31;
const FLOW_AUTO_DISABLE_SNAP_NODE_THRESHOLD = 51;
const FLOW_AUTO_DISABLE_SNAP_EDGE_THRESHOLD = 81;
const FLOW_RENDER_SNAP_GUIDES_WHILE_DRAGGING = false;
const FLOW_DISABLE_SNAP_DURING_NODE_DRAG = true;
const FLOW_AUTO_HIDE_MINIMAP_IMAGE_OVERLAY_NODE_THRESHOLD = 81;
const FLOW_LOW_DETAIL_NODE_THRESHOLD = 31;
const FLOW_LOW_DETAIL_ENTER_ZOOM = 0.4;
const FLOW_LOW_DETAIL_EXIT_ZOOM = 0.45;

const getEdgeHandleKind = (
  handle?: string | null
): keyof typeof FLOW_EDGE_COLOR_BY_KIND | null => {
  if (typeof handle !== "string") return null;
  const raw = handle.trim();
  if (!raw) return null;
  const value = raw.toLowerCase();

  if (value === "audio" || value.startsWith("audio-")) return "audio";
  if (value === "video" || value.startsWith("video-")) return "video";
  if (
    value === "images" ||
    value.startsWith("images-") ||
    value === "elementimg" ||
    value.startsWith("elementimg-")
  ) {
    return "images";
  }
  if (
    value === "img" ||
    value.startsWith("img") ||
    value === "image" ||
    value.startsWith("image") ||
    value === "refer" ||
    value === "omniimage" ||
    value === "cref"
  ) {
    return "image";
  }
  if (
    value === "text" ||
    value.startsWith("text-") ||
    value.startsWith("prompt") ||
    value === "response-text"
  ) {
    return "text";
  }
  return null;
};

const resolveEdgeStrokeColor = (
  mode: FlowEdgeColorMode,
  sourceHandle?: string | null,
  targetHandle?: string | null
): string => {
  if (mode === FlowEdgeColorMode.STANDARD) return FLOW_EDGE_STANDARD_COLOR;
  const handleKind = getEdgeHandleKind(sourceHandle) || getEdgeHandleKind(targetHandle);
  return handleKind ? FLOW_EDGE_COLOR_BY_KIND[handleKind] : FLOW_EDGE_STANDARD_COLOR;
};

/**
 * 调整图片尺寸以满足 Wan2.6 I2V 的要求（宽高必须是 16 的倍数）
 * 如果图片尺寸不满足要求，会自动缩放到最近的合法尺寸
 */
async function adjustImageSizeForWan26(
  imageUrl: string
): Promise<string | null> {
  try {
    // 获取图片
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmapLimited(blob);

    let width = bitmap.width;
    let height = bitmap.height;

    // 检查是否需要调整
    const isValid = width % 16 === 0 && height % 16 === 0;

    if (isValid) {
      // 已经是合法尺寸，直接返回原图
      return imageUrl;
    }

    // 计算调整后的尺寸（向最近的有效尺寸对齐）
    const newWidth = Math.round(width / 16) * 16;
    const newHeight = Math.round(height / 16) * 16;

    // 创建一个 OffscreenCanvas 进行缩放
    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);

    // 导出为 blob
    const resizedBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.92,
    });

    // 转换为 data URL
    const resizedDataUrl = await blobToDataUrl(resizedBlob);

    return resizedDataUrl;
  } catch (error) {
    console.error("调整图片尺寸失败:", error);
    return null;
  }
}

/**
 * 标准化稳定的远程 URL（提取代理 URL 中的原始 URL）
 */
function normalizeStableRemoteUrl(input: string): string {
  const value = input.trim();
  if (!value) return input;

  // Avoid exporting environment-dependent proxy URLs; keep the original remote URL.
  try {
    const url = new URL(
      value,
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost"
    );
    const isProxy =
      url.pathname === "/api/assets/proxy" ||
      url.pathname === "/assets/proxy" ||
      value.startsWith("/api/assets/proxy") ||
      value.startsWith("/assets/proxy");
    if (isProxy) {
      const raw = url.searchParams.get("url");
      if (raw) return raw;
      const key = url.searchParams.get("key");
      if (key) {
        const normalizedKey = key.replace(/^\/+/, "");
        const direct = resolvePublicAssetUrlFromKey(normalizedKey);
        if (direct) return direct;
        // Fallback: return key itself so caller can convert to dataURL instead of passing proxy URL downstream.
        return normalizedKey;
      }
    }
  } catch {}

  return value;
}

/**
 * 校验并调整图片尺寸，返回调整后的 URL（如果是远程 URL 则下载后调整）
 */
async function validateAndAdjustImageForWan26(
  imageUrl: string,
  projectId: string
): Promise<string> {
  // 如果是远程 URL
  if (isRemoteUrl(imageUrl)) {
    const normalizedUrl = normalizeStableRemoteUrl(imageUrl);
    const adjusted = await adjustImageSizeForWan26(normalizedUrl);
    if (adjusted && adjusted !== normalizedUrl) {
      // 尺寸被调整了，需要上传
      const uploaded = await uploadImageToOSS(adjusted, projectId);
      if (uploaded) return uploaded;
      return adjusted;
    }
    // 已经是合法尺寸，直接返回原始 URL
    return normalizedUrl;
  }

  // 本地 dataUrl/ blobUrl 需要上传到 OSS
  // 先尝试调整尺寸，然后上传
  const adjusted = await adjustImageSizeForWan26(imageUrl);
  const urlToUpload = adjusted || imageUrl;
  const uploaded = await uploadImageToOSS(urlToUpload, projectId);
  if (uploaded) return uploaded;
  // 如果上传失败，返回 dataUrl
  return urlToUpload;
}

type RFNode = Node<any>;

const isGroupNode = (node?: RFNode | null): boolean =>
  !!node && node.type === FLOW_GROUP_NODE_TYPE;

const getGroupChildIds = (node?: RFNode | null): string[] => {
  if (!isGroupNode(node)) return [];
  const ids = Array.isArray((node as any)?.data?.childNodeIds)
    ? ((node as any).data.childNodeIds as string[])
    : [];
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id)));
};

type GroupBounds = { x: number; y: number; width: number; height: number };
const GROUP_PREVIEW_IMAGE_LIMIT = 3;

const isGroupCollapsed = (node?: RFNode | null): boolean =>
  Boolean(node && (node as any)?.data?.collapsed === true);

const normalizeGroupBounds = (value: any): GroupBounds | null => {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
};

const areGroupBoundsEqual = (
  a: GroupBounds | null,
  b: GroupBounds | null,
  epsilon = 0.1
): boolean => {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
};

const collectPreviewImagesFromNode = (node?: RFNode | null): string[] => {
  if (!node || isGroupNode(node)) return [];
  const data = (node.data || {}) as Record<string, unknown>;
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  push(data.thumbnailDataUrl);
  push(data.thumbnail);
  push(data.imageUrl);
  push(data.imageData);
  push(data.outputImage);

  const multiKeys = ["thumbnails", "imageUrls", "images"];
  multiKeys.forEach((key) => {
    const values = data[key];
    if (!Array.isArray(values)) return;
    values.forEach((value) => push(value));
  });

  const frames = Array.isArray(data.frames)
    ? (data.frames as Array<Record<string, unknown>>)
    : [];
  frames.forEach((frame) => {
    push(frame?.thumbnailDataUrl);
    push(frame?.imageUrl);
  });

  const splitImages = Array.isArray(data.splitImages)
    ? (data.splitImages as Array<Record<string, unknown>>)
    : [];
  splitImages.forEach((item) => {
    push(item?.thumbnailDataUrl);
    push(item?.imageData);
  });

  return out;
};

const getNodeRenderSize = (node: RFNode): { width: number; height: number } => {
  const fallback = FLOW_NODE_DEFAULT_SIZE[node.type as FlowNodeType] || {
    w: 220,
    h: 160,
  };

  const styleW = Number((node as any)?.style?.width);
  const styleH = Number((node as any)?.style?.height);
  const width = Number(
    node.width ??
      node.data?.boxW ??
      (Number.isFinite(styleW) ? styleW : undefined) ??
      fallback.w
  );
  const height = Number(
    node.height ??
      node.data?.boxH ??
      (Number.isFinite(styleH) ? styleH : undefined) ??
      fallback.h
  );

  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.w,
    height: Number.isFinite(height) && height > 0 ? height : fallback.h,
  };
};

const FLOW_SNAP_BASE_THRESHOLD = 8;
const FLOW_SNAP_GUIDE_COLORS = {
  edge: "rgba(255, 107, 107, 0.48)",
  center: "rgba(255, 105, 180, 0.44)",
} as const;

const toFlowSnapBounds = (node: RFNode): ObjectBounds | null => {
  if (!node || (node as any)?.hidden) return null;
  const { width, height } = getNodeRenderSize(node);
  const x = Number(node.position?.x ?? 0);
  const y = Number(node.position?.y ?? 0);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { id: String(node.id), x, y, width, height };
};

const buildAlignmentSignature = (alignments: AlignmentLine[]): string => {
  if (!Array.isArray(alignments) || alignments.length === 0) return "";
  return alignments
    .map((line) =>
      [
        line.orientation,
        line.type,
        Math.round(Number(line.position || 0) * 10) / 10,
        Math.round(Number(line.start || 0) * 10) / 10,
        Math.round(Number(line.end || 0) * 10) / 10,
      ].join(":")
    )
    .sort()
    .join("|");
};

const computeGroupBounds = (
  nodes: RFNode[],
  childIds: string[]
): { x: number; y: number; width: number; height: number } | null => {
  if (!childIds.length) return null;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = 0;

  childIds.forEach((id) => {
    const child = nodeMap.get(id);
    if (!child || isGroupNode(child)) return;
    const { width, height } = getNodeRenderSize(child);
    const x = Number(child.position?.x ?? 0);
    const y = Number(child.position?.y ?? 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
    found += 1;
  });

  if (!found) return null;

  const x = minX - FLOW_GROUP_PADDING;
  const y = minY - FLOW_GROUP_PADDING;
  const width = Math.max(FLOW_GROUP_MIN_WIDTH, maxX - minX + FLOW_GROUP_PADDING * 2);
  const height = Math.max(FLOW_GROUP_MIN_HEIGHT, maxY - minY + FLOW_GROUP_PADDING * 2);
  return { x, y, width, height };
};

type EdgeLabelEditorState = {
  visible: boolean;
  edgeId: string | null;
  value: string;
  position: { x: number; y: number };
};

const createEdgeLabelEditorState = (): EdgeLabelEditorState => ({
  visible: false,
  edgeId: null,
  value: "",
  position: { x: 0, y: 0 },
});

const ensureDataUrl = (imageData: string): string =>
  imageData.startsWith("data:image")
    ? imageData
    : `data:image/png;base64,${imageData}`;

const estimateDataUrlByteLength = (value: string): number | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const commaIndex = trimmed.indexOf(",");
  if (commaIndex < 0) return undefined;
  const payload = trimmed.slice(commaIndex + 1).trim();
  if (!payload) return 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
};

const createThumbnailDataUrl = async (
  source: string,
  maxSize = 256
): Promise<string | null> => {
  try {
    const trimmed = typeof source === "string" ? source.trim() : "";
    if (!trimmed) return null;

    const toAbsoluteUrl = (value: string): string => {
      if (
        value.startsWith("data:") ||
        value.startsWith("blob:") ||
        (typeof FLOW_IMAGE_ASSET_PREFIX === "string" &&
          value.startsWith(FLOW_IMAGE_ASSET_PREFIX)) ||
        /^https?:\/\//i.test(value)
      ) {
        return value;
      }

      if (
        value.startsWith("/") ||
        value.startsWith("./") ||
        value.startsWith("../")
      ) {
        try {
          return new URL(value, window.location.origin).toString();
        } catch {
          return value;
        }
      }

      // 兜底：认为是裸 base64
      return ensureDataUrl(value);
    };

    const src = toAbsoluteUrl(trimmed);
    const blob = await resolveImageToBlob(src, { preferProxy: true });
    if (!blob) return null;

    const makeCanvas = (w: number, h: number): any => {
      if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(w, h);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      return canvas;
    };

    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmapLimited(blob);
      try {
        const w0 = bitmap.width || 1;
        const h0 = bitmap.height || 1;
        const scale = Math.min(1, maxSize / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = makeCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const outBlob = await canvasToBlob(canvas, {
          type: "image/jpeg",
          quality: 0.82,
        });
        return await blobToDataUrl(outBlob);
      } finally {
        try {
          bitmap.close();
        } catch {}
      }
    }

    // 回退：不做缩略图（极少数环境无 createImageBitmap）
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
};

const FLOW_CLIPBOARD_MIME = "application/x-tanva-flow";
const FLOW_CLIPBOARD_FALLBACK_TEXT = "Tanva flow selection";
const FLOW_CLIPBOARD_TYPE = "tanva-flow";

const rawNodeTypes = {
  nodeGroup: NodeGroupNode,
  textPrompt: TextPromptNode,
  textPromptPro: TextPromptProNode,
  textChat: TextChatNode,
  promptOptimize: PromptOptimizeNode,
  textNote: TextNoteNode,
  image: ImageNode,
  imagePro: ImageProNode,
  generate: GenerateNode,
  generate4: Generate4Node,
  generatePro: GenerateProNode,
  generatePro4: GeneratePro4Node,
  generateRef: GenerateReferenceNode,
  three: ThreeNode,
  threePathTracer: ThreeNode,
  camera: CameraNode,
  viewAngle: ViewAngleNode,
  analysis: AnalysisNode,
  sora2Video: Sora2VideoNode,
  sora2Character: Sora2CharacterNode,
  wan26: Wan26Node,
  wan2R2V: Wan2R2VNode,
  happyhorseR2V: HappyhorseR2VNode,
  wan27Video: Wan27VideoNode,
  klingVideo: KlingVideoNode,
  kling26Video: Kling26VideoNode,
  kling30Video: Kling30VideoNode,
  klingO1Video: KlingO1VideoNode,
  viduVideo: ViduVideoNode,
  viduQ3: ViduQ3ProVideoNode,
  doubaoVideo: DoubaoVideoNode,
  seedance20Video: Seedance20VideoNode,
  storyboardSplit: StoryboardSplitNode,
  midjourney: MidjourneyNode,
  midjourneyV7: MidjourneyNode,
  niji7: MidjourneyNode,
  nano2: Nano2Node,
  gptImage2: Nano2Node,
  seedream5: Seedream5Node,
  video: VideoNode,
  audioUpload: AudioNode,
  videoAnalyze: VideoAnalyzeNode,
  videoFrameExtract: VideoFrameExtractNode,
  videoToGif: VideoToGifNode,
  imageGrid: ImageGridNode,
  imageSplit: ImageSplitNode,
  imageCompress: ImageCompressNode,
  minimaxSpeech: MinimaxSpeechNode,
  minimaxMusic: MinimaxMusicNode,
  tencentSpeech: TencentSpeechNode,
};

/** 节点内通过 data.error 字段展示错误 */
const nodeTypes = rawNodeTypes;

// 自定义边组件 - 选中时在终点显示删除按钮
const EDGE_DELETE_BUTTON_STYLE: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "#ef4444",
  border: "2px solid #fff",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: "bold",
  lineHeight: 0,
  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
  position: "relative",
  zIndex: 10000,
  padding: 0,
};

const CustomEdge = React.memo(function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const { setEdges } = useReactFlow();

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      setEdges((edges) => edges.filter((e) => e.id !== id));
      try {
        historyService.commit("flow-edge-delete").catch(() => {});
      } catch {}
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("flow:edgesChange"));
      }, 0);
    },
    [id, setEdges]
  );

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {!data?.collapsedProxy && selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              left: targetX + 4,
              top: targetY,
              transform: "translate(-50%, -50%)",
              pointerEvents: "all",
              zIndex: 10000,
            }}
            className='nodrag nopan'
          >
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleDelete}
              style={EDGE_DELETE_BUTTON_STYLE}
              title='删除连线'
            >
              <span style={{ marginTop: -2 }}>−</span>
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const edgeTypes = {
  default: CustomEdge,
};

const DEFAULT_REFERENCE_PROMPT = "请参考第二张图的内容";
const FLOW_GROUP_NODE_TYPE = "nodeGroup";
const FLOW_GROUP_PADDING = 24;
const FLOW_GROUP_MIN_WIDTH = 220;
const FLOW_GROUP_MIN_HEIGHT = 160;
const FLOW_GROUP_COLLAPSED_WIDTH = 260;
const FLOW_GROUP_COLLAPSED_HEIGHT = 128;
const FLOW_GROUP_DEFAULT_COLOR = "#3b82f6";
const FLOW_GROUP_RUNNABLE_TYPES = new Set([
  "textChat",
  "promptOptimize",
  "analysis",
  "videoAnalyze",
  "videoToGif",
  "generate",
  "generate4",
  "generateRef",
  "viewAngle",
  "generatePro",
  "generatePro4",
  "midjourney",
  "midjourneyV7",
  "niji7",
  "nano2",
  "gptImage2",
  "seedream5",
  "image",
  "imagePro",
  "sora2Video",
  "sora2Character",
  "wan26",
  "wan2R2V",
  "happyhorseR2V",
  "wan27Video",
  "klingVideo",
  "kling26Video",
  "kling30Video",
  "klingO1Video",
  "viduVideo",
  "viduQ3",
  "doubaoVideo",
  "seedance20Video",
  "minimaxSpeech",
  "tencentSpeech",
  "minimaxMusic",
]);
const FLOW_GROUP_LOCAL_RUN_TYPES = new Set([
  "textChat",
  "promptOptimize",
  "analysis",
  "videoAnalyze",
  "videoToGif",
]);
const SORA2_MAX_REFERENCE_IMAGES = 1;
const VIDU_MAX_REFERENCE_IMAGES = 2; // Vidu 当前统一限制最多 2 张参考图（图1/图2）
const VIDUQ3_MAX_REFERENCE_IMAGES = 2; // Vidu Q3 支持最多 2 张参考图
const KLING_MAX_REFERENCE_IMAGES = 2; // Kling 2.1 / 2.6 统一限制最多 2 张参考图
const KLING_MAX_AUDIO_INPUTS = 2;
const SEEDANCE20_REFERENCE_IMAGE_MAX = 9;
const SEEDANCE20_REFERENCE_VIDEO_MAX = 3;
const SEEDANCE20_REFERENCE_AUDIO_MAX = 3;
const SEEDANCE15_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const SEEDANCE20_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const SEEDANCE_REFERENCE_IMAGE_MAX_BYTES = 30 * 1024 * 1024; // 30MB

type Seedance20Mode = "reference_images" | "start_end";
type Seedance15Mode = "text" | "image" | "start_end";
type SeedanceMode = Seedance20Mode | Seedance15Mode;

const SEEDANCE20_MODE_VALUES: Seedance20Mode[] = ["reference_images", "start_end"];
const SEEDANCE15_MODE_VALUES: Seedance15Mode[] = ["text", "image", "start_end"];

const VIDEO_SOURCE_NODE_TYPES = [
  "video",
  "sora2Video",
  "wan26",
  "wan2R2V",
  "happyhorseR2V",
  "wan27Video",
  "klingVideo",
  "kling26Video",
  "kling30Video",
  "klingO1Video",
  "viduVideo",
  "viduQ3",
  "doubaoVideo",
  "seedance20Video",
];

const normalizeSeedanceModelValue = (
  value?: unknown
): "seedance-1.5-pro" | "seedance-2.0" | "seedance-2.0-fast" => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "seedance-2.0-fast" || normalized === "2.0-fast") {
    return "seedance-2.0-fast";
  }
  if (normalized === "seedance-2.0" || normalized === "2.0") {
    return "seedance-2.0";
  }
  return "seedance-1.5-pro";
};

const isSeedance20ModelValue = (value?: unknown): boolean => {
  const normalized = normalizeSeedanceModelValue(value);
  return normalized === "seedance-2.0" || normalized === "seedance-2.0-fast";
};

const getEffectiveViduMaxReferenceImages = (nodeData?: Record<string, any>): number =>
  isViduQ3FamilyModel(nodeData?.viduModel)
    ? VIDUQ3_MAX_REFERENCE_IMAGES
    : VIDU_MAX_REFERENCE_IMAGES;

// 模板分类由后端维护，前端会在面板打开时请求；若后端无数据则从 tplIndex 推断或回退到 ['其他']

const ADD_PANEL_TAB_STORAGE_KEY = "tanva-add-panel-tab";

const SORA2_HISTORY_LIMIT = 5;
type Sora2GenerationType = "sora2" | "sora2-create-character";

const getSora2GenerationType = (data?: any): Sora2GenerationType => {
  const value = typeof data?.generationType === "string" ? data.generationType : "";
  if (value === "sora2-create-character") return "sora2-create-character";
  // 兼容旧值：`sora2-character` 归并为普通 Sora2 模式
  return "sora2";
};

type Sora2VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  quality: Sora2VideoQuality;
  createdAt: string;
  elapsedSeconds?: number;
};

type AddPanelTab = "nodes" | "beta" | "custom" | "templates" | "personal";
type AddPanelOpenOptions = {
  tab?: AddPanelTab;
  scope?: "public" | "mine";
  allowedTabs?: AddPanelTab[];
  world?: { x: number; y: number };
};
const ALL_ADD_TABS: AddPanelTab[] = [
  "nodes",
  "custom",
  "templates",
  "personal",
];

const getStoredAddPanelTab = (): AddPanelTab => {
  if (typeof window === "undefined") {
    return "nodes";
  }
  try {
    const saved = window.localStorage.getItem(ADD_PANEL_TAB_STORAGE_KEY);
    return saved === "templates" ||
      saved === "personal" ||
      saved === "nodes" ||
      saved === "custom"
      ? saved
      : "nodes";
  } catch {
    return "nodes";
  }
};

const sanitizeAllowedAddTabs = (tabs?: AddPanelTab[]): AddPanelTab[] => {
  if (!tabs?.length) return ALL_ADD_TABS;
  const filtered = tabs.filter((tab) => ALL_ADD_TABS.includes(tab));
  return filtered.length > 0 ? filtered : ALL_ADD_TABS;
};

type QuickConnectSourceKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "character"
  | "unknown";

type QuickConnectPreset = {
  nodeType: string;
  targetHandle?: string;
  sourceHandle?: string;
};

type QuickConnectMenuItem = QuickConnectPreset & {
  label: string;
};

const getQuickConnectMenuItemKey = (
  item: Pick<QuickConnectMenuItem, "nodeType" | "targetHandle" | "sourceHandle">
): string => `${item.nodeType}::${item.targetHandle || ""}::${item.sourceHandle || ""}`;

type QuickConnectAnchor =
  | {
      direction: "forward";
      sourceId: string;
      sourceHandle?: string;
    }
  | {
      direction: "reverse";
      targetId: string;
      targetHandle: string;
    };

const QUICK_CONNECT_HOVER_DELAY_MS = 520;
const QUICK_CONNECT_MAX_ITEMS = 6;
const QUICK_CONNECT_USAGE_STORAGE_KEY = "tanva-quick-connect-usage-v1";

type QuickConnectUsageEntry = {
  count: number;
  lastUsedAt: number;
};

const QUICK_CONNECT_PRESETS: Record<
  QuickConnectSourceKind,
  QuickConnectPreset[]
> = {
  text: [
    { nodeType: "textPrompt", targetHandle: "text" },
    { nodeType: "generate", targetHandle: "text" },
    { nodeType: "generateRef", targetHandle: "text" },
    { nodeType: "midjourney", targetHandle: "text" },
    { nodeType: "nano2", targetHandle: "text" },
    { nodeType: "gptImage2", targetHandle: "text" },
    { nodeType: "promptOptimize", targetHandle: "text" },
    { nodeType: "textChat", targetHandle: "text" },
    { nodeType: "analysis", targetHandle: "text" },
  ],
  image: [
    { nodeType: "image", targetHandle: "img" },
    { nodeType: "generate", targetHandle: "img" },
    { nodeType: "generate4", targetHandle: "img" },
    { nodeType: "generatePro", targetHandle: "img" },
    { nodeType: "generateRef", targetHandle: "image2" },
    { nodeType: "viewAngle", targetHandle: "img" },
    { nodeType: "analysis", targetHandle: "img" },
    { nodeType: "imagePro", targetHandle: "img" },
    { nodeType: "nano2", targetHandle: "img" },
    { nodeType: "gptImage2", targetHandle: "img" },
    { nodeType: "imageGrid", targetHandle: "images" },
    { nodeType: "imageSplit", targetHandle: "img" },
    { nodeType: "imageCompress", targetHandle: "img" },
    { nodeType: "happyhorseR2V", targetHandle: "image-1" },
  ],
  video: [
    { nodeType: "videoAnalyze", targetHandle: "video" },
    { nodeType: "videoFrameExtract", targetHandle: "video" },
    { nodeType: "videoToGif", targetHandle: "video" },
    { nodeType: "wan2R2V", targetHandle: "video-1" },
    { nodeType: "wan27Video", targetHandle: "video" },
    { nodeType: "klingO1Video", targetHandle: "video" },
    { nodeType: "sora2Video", targetHandle: "character" },
    { nodeType: "sora2Character", targetHandle: "video" },
  ],
  audio: [
    { nodeType: "wan26", targetHandle: "audio" },
    { nodeType: "wan27Video", targetHandle: "audio" },
  ],
  character: [{ nodeType: "sora2Video", targetHandle: "character" }],
  unknown: [
    { nodeType: "generate", targetHandle: "text" },
    { nodeType: "analysis", targetHandle: "img" },
    { nodeType: "videoAnalyze", targetHandle: "video" },
  ],
};

  const QUICK_CONNECT_REVERSE_PRESETS: Record<
  QuickConnectSourceKind,
  QuickConnectPreset[]
> = {
  text: [
    { nodeType: "textPrompt", sourceHandle: "text" },
    { nodeType: "textPromptPro", sourceHandle: "text" },
    { nodeType: "promptOptimize", sourceHandle: "text" },
    { nodeType: "textChat", sourceHandle: "text" },
    { nodeType: "textNote", sourceHandle: "text-right-out" },
    { nodeType: "generate", sourceHandle: "text" },
    { nodeType: "analysis", sourceHandle: "prompt" },
  ],
  image: [
    { nodeType: "image", sourceHandle: "img" },
    { nodeType: "generate", sourceHandle: "img" },
    { nodeType: "generateRef", sourceHandle: "img" },
    { nodeType: "viewAngle", sourceHandle: "img" },
    { nodeType: "midjourney", sourceHandle: "img" },
    { nodeType: "midjourneyV7", sourceHandle: "img" },
    { nodeType: "niji7", sourceHandle: "img" },
    { nodeType: "seedream5", sourceHandle: "img" },
    { nodeType: "nano2", sourceHandle: "img" },
    { nodeType: "gptImage2", sourceHandle: "img" },
    { nodeType: "camera", sourceHandle: "img" },
  ],
  video: [
    { nodeType: "video", sourceHandle: "video" },
    { nodeType: "sora2Video", sourceHandle: "video" },
    { nodeType: "wan26", sourceHandle: "video" },
    { nodeType: "wan2R2V", sourceHandle: "video" },
    { nodeType: "happyhorseR2V", sourceHandle: "video" },
    { nodeType: "wan27Video", sourceHandle: "video" },
    { nodeType: "klingO1Video", sourceHandle: "video-out" },
    { nodeType: "videoFrameExtract", sourceHandle: "video" },
  ],
  audio: [
    { nodeType: "audioUpload", sourceHandle: "audio" },
    { nodeType: "minimaxSpeech", sourceHandle: "audio" },
    { nodeType: "minimaxMusic", sourceHandle: "audio" },
    { nodeType: "tencentSpeech", sourceHandle: "audio" },
  ],
  character: [
    { nodeType: "video", sourceHandle: "video" },
    { nodeType: "sora2Video", sourceHandle: "character" },
    { nodeType: "sora2Video", sourceHandle: "video" },
    { nodeType: "wan26", sourceHandle: "video" },
    { nodeType: "wan2R2V", sourceHandle: "video" },
    { nodeType: "happyhorseR2V", sourceHandle: "video" },
    { nodeType: "wan27Video", sourceHandle: "video" },
    { nodeType: "klingVideo", sourceHandle: "video" },
    { nodeType: "kling26Video", sourceHandle: "video" },
    { nodeType: "klingO1Video", sourceHandle: "video-out" },
    { nodeType: "viduVideo", sourceHandle: "video" },
    { nodeType: "viduQ3", sourceHandle: "video" },
    { nodeType: "doubaoVideo", sourceHandle: "video" },
    { nodeType: "sora2Character", sourceHandle: "character" },
  ],
  unknown: [
    { nodeType: "textPrompt", sourceHandle: "text" },
    { nodeType: "image", sourceHandle: "img" },
    { nodeType: "video", sourceHandle: "video" },
  ],
};

const QUICK_CONNECT_BASE_PRESET: Record<
  QuickConnectSourceKind,
  {
    forward?: QuickConnectPreset;
    reverse?: QuickConnectPreset;
  }
> = {
  text: {
    forward: { nodeType: "textPrompt", targetHandle: "text" },
    reverse: { nodeType: "textPrompt", sourceHandle: "text" },
  },
  image: {
    forward: { nodeType: "image", targetHandle: "img" },
    reverse: { nodeType: "image", sourceHandle: "img" },
  },
  video: {},
  audio: {},
  character: {},
  unknown: {},
};

// 节点积分消耗映射
const NODE_CREDITS_MAP: Record<string, number | string> = {
  // 普通节点
  textPrompt: 0, // 提示词节点 - 不消耗积分
  textChat: 2, // 纯文本交互节点 - gemini-text
  textNote: 0, // 纯文本节点 - 不消耗积分
  promptOptimize: 5, // 提示词优化节点
  analysis: 10, // 图像分析节点 - gemini-2.5-image-analyze (Fast default)
  image: 0, // 图片节点 - 不消耗积分
  // Banana 生图节点（按模型+分辨率动态计费，Run 按当前参数实时展示）
  generate: "20-40",
  // 参考图生成节点在 Flow 展示区间，实际扣分以运行请求参数为准
  generateRef: "20-40",
  viewAngle: 30, // 视角变换节点 - 基于参考图编辑
  generate4: 80, // 四图生成节点 - 4次 × 20积分
  midjourney: 50, // Midjourney生成 - midjourney-imagine
  midjourneyV7: 50, // Midjourney V7 生成
  niji7: 50, // Niji 7 生成
  nano2: 30, // Nano Banana 2 生图
  gptImage2: 40, // Gpt-Imgae-2 生图
  seedream5: 30, // Seedream 5.0 生图
  three: 200, // 三维节点 - convert-2d-to-3d
  sora2Video: "40-400", // 视频生成节点 - sora-sd (40) 或 sora-hd (400)
  sora2Character: 0, // 角色生成节点 - 当前不单独计费
  wan26: 600, // Wan2.6生成视频 - wan26-video
  wan2R2V: 600, // 视频融合 - wan26-r2v
  happyhorseR2V: 600, // 快乐马多图参考 - fallback；实际由后端 perSecondByResolution 决定
  klingVideo: "150-1200", // 可灵视频生成（2.6/3.0 按模型与参数阶梯计费）
  kling26Video: "150-1200", // 可灵2.6视频生成 - kling-v2-6
  kling30Video: "300-1200", // 可灵3.0视频生成 - kling-v3-0
  klingO1Video: 600, // 可灵 O3 / Omni Video
  klingO3Video: 600, // 可灵O3视频生成 - Omni Video
  viduVideo: 600, // Vidu视频生成
  viduQ3: 600, // Vidu Q3 Pro视频生成
  doubaoVideo: 600, // Seedance 1.5 Pro包视频生成
  seedance20Video: 600, // Seedance 2.0 视频生成
  videoToGif: 30, // 视频转GIF
  minimaxSpeech: 10, // MiniMax 语音合成
  tencentSpeech: 10, // 腾讯语音合成
  minimaxMusic: 30, // MiniMax 音乐生成
  audioUpload: 0, // 语音上传节点 - 不消耗积分
  camera: 0, // 截图节点 - 不消耗积分
  storyboardSplit: 0, // 分镜拆分节点 - 不消耗积分

  // Beta 节点
  textPromptPro: 0, // 专业提示词节点 - 输入节点，不消耗积分
  imagePro: 0, // 专业图片节点 - 不消耗积分
  generatePro: 40, // 专业生成节点 - 1K 默认 40 积分（高分辨率实时变化）
  generatePro4: 160, // 四图专业生成节点 - 4次 × 40积分
};

// 普通节点列表（按分类整理）
const NODE_PALETTE_ITEMS = [
  // 输入节点
  { key: "textPrompt", zh: "提示词节点", en: "Prompt Node", category: "input" },
  { key: "textChat", zh: "纯文本交互节点", en: "Text Chat Node", category: "input" },
  { key: "textNote", zh: "纯文本节点", en: "Note Node", category: "input" },
  { key: "promptOptimize", zh: "提示词优化节点", en: "Prompt Optimizer", category: "input" },
  { key: "image", zh: "图片节点", en: "Image Node", category: "input" },
  { key: "video", zh: "视频节点", en: "Video Node", category: "input" },
  { key: "camera", zh: "截图节点", en: "Shot Node", category: "input" },
  // 生图节点
  { key: "generate", zh: "生成节点", en: "Generate Node", category: "image" },
  { key: "generateRef", zh: "参考图生成节点", en: "Generate Refer", category: "image" },
  { key: "generate4", zh: "生成多张图片节点", en: "Multi Generate", category: "image" },
  { key: "generatePro", zh: "自定义节点", en: "Agent", category: "image" },
  { key: "midjourney", zh: "Midjourney生成", en: "Midjourney", category: "image" },
  { key: "gptImage2", zh: "Gpt-Imgae-2", en: "Gpt-Imgae-2", category: "image" },
  { key: "analysis", zh: "图像分析节点", en: "Analysis Node", category: "image" },
  { key: "imageGrid", zh: "图片拼合节点", en: "Image Grid", category: "image" },
  { key: "imageSplit", zh: "图片分割节点", en: "Image Split", category: "image" },
  { key: "imageCompress", zh: "图片压缩节点", en: "Image Compress", category: "image" },
  { key: "three", zh: "三维节点", en: "3D Node", category: "image" },
  { key: "viewAngle", zh: "视角变换节点", en: "View Angle", category: "image" },
  // 视频生成节点
  { key: "sora2Video", zh: "Sora2 Pro", en: "Sora2 Pro", category: "video" },
  { key: "sora2Character", zh: "Sora2角色生成", en: "Sora2 Character", category: "video" },
  { key: "wan26", zh: "Wan2.6", en: "Wan2.6", category: "video" },
  { key: "wan2R2V", zh: "视频融合", en: "Wan2.6 Reference Video", category: "video" },
  { key: "happyhorseR2V", zh: "快乐马", en: "HappyHorse", category: "video" },
  { key: "wan27Video", zh: "Wan2.7 I2V", en: "Wan2.7 I2V", category: "video" },
  { key: "klingVideo", zh: "Kling", en: "Kling", category: "video" },
  // { key: "kling26Video", zh: "Kling 2.6视频生成", en: "Kling 2.6", category: "video" },
  { key: "viduVideo", zh: "Vidu", en: "Vidu", category: "video" },
  {
    key: "doubaoVideo",
    zh: "Seedance 1.5 Pro",
    en: "Seedance 1.5 Pro",
    category: "video",
  },
  // 其他节点
  { key: "videoAnalyze", zh: "视频分析节点", en: "Video Analysis", category: "other" },
  { key: "videoFrameExtract", zh: "视频抽帧节点", en: "Video Frame Extract", category: "other" },
  { key: "videoToGif", zh: "视频转GIF节点", en: "Video to GIF", category: "other" },
  { key: "storyboardSplit", zh: "分镜拆分节点", en: "Storyboard Split", category: "other" },
  { key: "audioUpload", zh: "语音节点", en: "Audio Node", category: "audio" },
  { key: "minimaxSpeech", zh: "MiniMax语音合成", en: "MiniMax Speech", category: "audio" },
  { key: "tencentSpeech", zh: "语音合成", en: "Speech Synthesis", category: "audio" },
  { key: "minimaxMusic", zh: "MiniMax音乐生成", en: "MiniMax Music", category: "audio" },
];

const BETA_NODE_KEYS = new Set([
  "textPromptPro",
  "imagePro",
  "generatePro4", // 临时隐藏：高级四图
]);

type NodePanelGroupKey = "text" | "image" | "three" | "other" | "video" | "audio";

const NODE_PANEL_GROUP_ORDER: NodePanelGroupKey[] = [
  "text",
  "image",
  "video",
  "audio",
  "other",
  "three",
];

const NODE_PANEL_GROUP_META: Record<
  NodePanelGroupKey,
  { titleZh: string; titleEn: string; subtitleZh: string; subtitleEn: string }
> = {
  text: {
    titleZh: "文字类节点",
    titleEn: "Text Nodes",
    subtitleZh: "提示词、文本处理与拆分",
    subtitleEn: "Prompts, text processing, and splitting",
  },
  image: {
    titleZh: "图像类节点",
    titleEn: "Image Nodes",
    subtitleZh: "图像输入、生成与编辑",
    subtitleEn: "Image input, generation, and editing",
  },
  three: {
    titleZh: "3D 类节点",
    titleEn: "3D Nodes",
    subtitleZh: "三维相关节点",
    subtitleEn: "3D-related nodes",
  },
  other: {
    titleZh: "其他节点",
    titleEn: "Other Nodes",
    subtitleZh: "辅助能力节点",
    subtitleEn: "Utility nodes",
  },
  video: {
    titleZh: "视频类节点",
    titleEn: "Video Nodes",
    subtitleZh: "视频输入、生成与分析",
    subtitleEn: "Video input, generation, and analysis",
  },
  audio: {
    titleZh: "语音类节点",
    titleEn: "Audio Nodes",
    subtitleZh: "音乐生成、语音合成与处理",
    subtitleEn: "Music generation, speech synthesis and processing",
  },
};

const NODE_PANEL_GROUP_BY_TYPE: Record<string, NodePanelGroupKey> = {
  textPrompt: "text",
  textPromptPro: "text",
  textChat: "text",
  textNote: "text",
  promptOptimize: "text",
  storyboardSplit: "text",

  image: "image",
  imagePro: "image",
  camera: "image",
  generate: "image",
  generateRef: "image",
  viewAngle: "image",
  generate4: "image",
  generatePro: "image",
  generatePro4: "image",
  midjourney: "image",
  midjourneyV7: "image",
  niji7: "image",
  nano2: "image",
  gptImage2: "image",
  analysis: "image",
  imageGrid: "image",
  imageSplit: "image",
  imageCompress: "image",

  three: "three",

  video: "video",
  sora2Video: "video",
  sora2Character: "video",
  wan26: "video",
  wan2R2V: "video",
  happyhorseR2V: "video",
  wan27Video: "video",
  klingVideo: "video",
  kling26Video: "video",
  kling30Video: "video",
  klingO1Video: "video",
  viduVideo: "video",
  viduQ3: "video",
  doubaoVideo: "video",
  seedance20Video: "video",
  videoAnalyze: "video",
  videoFrameExtract: "video",
  videoToGif: "video",
  audioUpload: "audio",
  minimaxSpeech: "audio",
  tencentSpeech: "audio",
  minimaxMusic: "audio",
};

// Beta 节点列表（实验性功能）
const BETA_NODE_ITEMS = [
  {
    key: "textPromptPro",
    zh: "专业提示词节点",
    en: "Prompt Pro",
    badge: "Beta",
  },
  { key: "imagePro", zh: "专业图片节点", en: "Image Pro", badge: "Beta" },
];

const FLOW_NODE_DEFAULT_SIZE = {
  nodeGroup: { w: FLOW_GROUP_MIN_WIDTH, h: FLOW_GROUP_MIN_HEIGHT },
  textPrompt: { w: 240, h: 180 },
  textPromptPro: { w: 420, h: 360 },
  textNote: { w: 220, h: 140 },
  textChat: { w: 320, h: 540 },
  promptOptimize: { w: 360, h: 300 },
  image: { w: 260, h: 240 },
  imagePro: { w: 320, h: 240 },
  generate: { w: 260, h: 200 },
  generatePro: { w: 320, h: 400 },
  generatePro4: { w: 380, h: 480 },
  generate4: { w: 300, h: 240 },
  generateRef: { w: 260, h: 240 },
  three: { w: 560, h: 320 },
  viewAngle: { w: 420, h: 560 },
  camera: { w: 260, h: 220 },
  analysis: { w: 260, h: 280 },
  sora2Video: { w: 280, h: 260 },
  sora2Character: { w: 300, h: 320 },
  wan26: { w: 300, h: 320 },
  wan2R2V: { w: 300, h: 360 },
  happyhorseR2V: { w: 300, h: 460 },
  wan27Video: { w: 300, h: 420 },
  klingVideo: { w: 280, h: 260 },
  kling26Video: { w: 280, h: 260 },
  kling30Video: { w: 280, h: 260 },
  klingO1Video: { w: 280, h: 380 },
  viduVideo: { w: 280, h: 260 },
  viduQ3: { w: 280, h: 260 },
  doubaoVideo: { w: 280, h: 260 },
  seedance20Video: { w: 280, h: 260 },
  storyboardSplit: { w: 320, h: 400 },
  midjourney: { w: 280, h: 320 },
  midjourneyV7: { w: 300, h: 760 },
  niji7: { w: 300, h: 700 },
  nano2: { w: 260, h: 200 },
  gptImage2: { w: 260, h: 200 },
  seedream5: { w: 260, h: 240 },
  video: { w: 320, h: 280 },
  audioUpload: { w: 320, h: 128 },
  videoAnalyze: { w: 280, h: 360 },
  videoFrameExtract: { w: 300, h: 420 },
  videoToGif: { w: 320, h: 420 },
  imageGrid: { w: 300, h: 380 },
  imageSplit: { w: 320, h: 400 },
  imageCompress: { w: 300, h: 360 },
  minimaxSpeech: { w: 280, h: 240 },
  tencentSpeech: { w: 300, h: 400 },
  minimaxMusic: { w: 300, h: 460 },
} as const;

type FlowNodeType = keyof typeof FLOW_NODE_DEFAULT_SIZE;

const HIDDEN_FLOW_NODE_TYPES = new Set<FlowNodeType>([
  "kling26Video",
  "nano2",
]);

const FLOW_NODE_KEY_ALIASES: Record<string, FlowNodeType> = {
  generatereference: "generateRef",
  "generate-reference": "generateRef",
  generate_reference: "generateRef",
  sora2: "sora2Video",
  "sora-2": "sora2Video",
  "sora-2-video": "sora2Video",
  sora2pro: "sora2Video",
  "sora-2-pro": "sora2Video",
  "sora-2-pro-video": "sora2Video",
  kling: "klingVideo",
  "kling-video": "klingVideo",
  kling26: "klingVideo",
  kling26video: "klingVideo",
  "kling-26": "klingVideo",
  "kling-2.6": "klingVideo",
  "kling-2.6-video": "klingVideo",
  kling30: "klingVideo",
  kling30video: "klingVideo",
  "kling-3.0": "klingVideo",
  "kling-3.0-video": "klingVideo",
  viduq3: "viduVideo",
  viduq3video: "viduVideo",
  "vidu-q3": "viduVideo",
  "vidu-q3-video": "viduVideo",
  seedance20: "doubaoVideo",
  seedance20video: "doubaoVideo",
  "seedance-2.0": "doubaoVideo",
  "seedance-2.0-video": "doubaoVideo",
  wan27: "wan27Video",
  "wan-27": "wan27Video",
  "wan2.7": "wan27Video",
  "wan-2.7": "wan27Video",
  "wan2.7-i2v": "wan27Video",
  pathtracer: "three",
  "path-tracer": "three",
  "three-pathtracer": "three",
  "3d-pathtracer": "three",
  klingo1: "klingO1Video",
  "kling-o1": "klingO1Video",
  "kling-o1-video": "klingO1Video",
  klingo3: "klingO1Video",
  "kling-o3": "klingO1Video",
  "kling-o3-video": "klingO1Video",
  audio: "audioUpload",
  audionode: "audioUpload",
  "audio-node": "audioUpload",
  minimaxmusic: "minimaxMusic",
  "minimax-music": "minimaxMusic",
  gptimage2: "gptImage2",
  "gpt-image-2": "gptImage2",
  gpt2image: "gptImage2",
};

const canonicalizeNodeTypeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const FLOW_NODE_CANONICAL_MAP: Record<string, FlowNodeType> = (() => {
  const map: Record<string, FlowNodeType> = {};

  (Object.keys(FLOW_NODE_DEFAULT_SIZE) as FlowNodeType[]).forEach((key) => {
    map[canonicalizeNodeTypeKey(key)] = key;
  });

  Object.entries(FLOW_NODE_KEY_ALIASES).forEach(([alias, type]) => {
    map[canonicalizeNodeTypeKey(alias)] = type;
  });

  return map;
})();

const FLOW_NODE_CANONICAL_ENTRIES = Object.entries(FLOW_NODE_CANONICAL_MAP).sort(
  (a, b) => b[0].length - a[0].length
);

const normalizeFlowNodeType = (rawType?: string): FlowNodeType | null => {
  if (typeof rawType !== "string") return null;
  const trimmed = rawType.trim();
  if (!trimmed) return null;

  const lowered = trimmed.toLowerCase();
  const aliasMatched = FLOW_NODE_KEY_ALIASES[lowered];
  if (aliasMatched) return aliasMatched;

  if (trimmed in FLOW_NODE_DEFAULT_SIZE) {
    return trimmed as FlowNodeType;
  }

  const caseInsensitive = (Object.keys(FLOW_NODE_DEFAULT_SIZE) as FlowNodeType[])
    .find((key) => key.toLowerCase() === lowered);
  if (caseInsensitive) return caseInsensitive;

  const canonical = canonicalizeNodeTypeKey(trimmed);
  const canonicalMatched = FLOW_NODE_CANONICAL_MAP[canonical];
  if (canonicalMatched) return canonicalMatched;

  const fuzzyMatched = FLOW_NODE_CANONICAL_ENTRIES.find(([candidate]) =>
    canonical.includes(candidate)
  );
  if (fuzzyMatched) return fuzzyMatched[1];

  return null;
};

const isHiddenFlowNodeType = (rawType?: string): boolean => {
  const normalized = normalizeFlowNodeType(rawType);
  return Boolean(normalized && HIDDEN_FLOW_NODE_TYPES.has(normalized));
};

type BananaPricingTier = "fast" | "pro" | "ultra";

const BANANA_ROUTE_PRICING: Record<
  BananaPricingTier,
  Record<"0.5K" | "1K" | "2K" | "4K", number>
> = {
  fast: {
    "0.5K": 20,
    "1K": 20,
    "2K": 20,
    "4K": 20,
  },
  pro: {
    "0.5K": 40,
    "1K": 40,
    "2K": 60,
    "4K": 80,
  },
  ultra: {
    "0.5K": 30,
    "1K": 30,
    "2K": 40,
    "4K": 50,
  },
};

const BANANA_DYNAMIC_NODE_TYPES = new Set<FlowNodeType>([
  "generate",
  "generate4",
  "generateRef",
  "viewAngle",
  "generatePro",
  "generatePro4",
  "analysis",
]);

const IMAGE_DYNAMIC_CREDIT_NODE_TYPES = new Set<FlowNodeType>([
  "generate",
  "generate4",
  "generateRef",
  "viewAngle",
  "generatePro",
  "generatePro4",
  "analysis",
  "midjourney",
  "midjourneyV7",
  "niji7",
  "nano2",
  "gptImage2",
  "seedream5",
]);

const resolveBananaPricingTierByProvider = (
  providerName?: string | null
): BananaPricingTier | null => {
  const normalized = String(providerName || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "banana-2.5") return "fast";
  if (normalized === "banana-3.1" || normalized === "nano2") return "ultra";
  if (
    normalized === "banana" ||
    normalized === "banana-3.0" ||
    normalized === "gemini-pro"
  ) {
    return "pro";
  }
  return null;
};

const resolveBananaPricingTierByModel = (
  modelName?: string | null
): BananaPricingTier | null => {
  const normalized = typeof modelName === "string" ? modelName.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized.includes("gemini-2.5")) return "fast";
  if (normalized.includes("gemini-3.1")) return "ultra";
  if (normalized.includes("gemini-3") || normalized.includes("imagen-3")) return "pro";
  return null;
};

const resolveBananaPricingTierForNode = (params: {
  nodeType?: string | null;
  providerForPricing?: string | null;
  globalImageModel?: string | null;
}): BananaPricingTier | null => {
  const { nodeType, providerForPricing } = params;
  const normalizedType = normalizeFlowNodeType(nodeType || undefined);
  const providerTier = resolveBananaPricingTierByProvider(providerForPricing);
  if (normalizedType === "generatePro" || normalizedType === "generatePro4") {
    if (providerTier === "ultra") return "ultra";
    return "pro";
  }
  return providerTier;
};

const normalizeBananaImageSize = (
  rawSize: unknown,
  tier: BananaPricingTier
): "0.5K" | "1K" | "2K" | "4K" => {
  const normalized = typeof rawSize === "string" ? rawSize.trim().toUpperCase() : "";
  if (tier === "fast") return "1K";
  if (tier === "pro") {
    if (normalized === "2K" || normalized === "4K") return normalized;
    return "1K";
  }
  if (
    normalized === "0.5K" ||
    normalized === "1K" ||
    normalized === "2K" ||
    normalized === "4K"
  ) {
    return normalized;
  }
  return "1K";
};

// Stable 通道下的 Banana 定价常量（用于 bananaImageRoute === "stable"）
// 与后端积分表保持一致
const BANANA_STABLE_ROUTE_PRICING: Record<
  BananaPricingTier,
  Record<"0.5K" | "1K" | "2K" | "4K", number>
> = {
  // Fast: Nano Banana, 尊享路线 1K=40
  fast: {
    "0.5K": 40,
    "1K": 40,
    "2K": 40,
    "4K": 40,
  },
  // Pro: Nano Banana Pro
  pro: {
    "0.5K": 90,
    "1K": 90,
    "2K": 100,
    "4K": 170,
  },
  // Ultra: Nano Banana 2
  ultra: {
    "0.5K": 30,
    "1K": 50,
    "2K": 70,
    "4K": 110,
  },
};

const BANANA_TEXT_ROUTE_PRICING: Record<
  "normal" | "stable",
  Record<BananaPricingTier, number>
> = {
  normal: {
    fast: 2,
    pro: 2,
    ultra: 2,
  },
  stable: {
    fast: 2,
    pro: 2,
    ultra: 2,
  },
};

// GPT-Image-2 在 Stable(尊享/腾讯) 路由下独立计费
const GPT_IMAGE_2_STABLE_ROUTE_PRICING: Record<"1K" | "2K" | "4K", number> = {
  "1K": 40,
  "2K": 80,
  "4K": 110,
};
const GPT_IMAGE_2_NORMAL_ROUTE_PRICING: Record<"1K" | "2K" | "4K", number> = {
  "1K": 20,
  "2K": 30,
  "4K": 40,
};

const BANANA_STABLE_DYNAMIC_NODE_TYPES = new Set<FlowNodeType>([
  "generate",
  "generate4",
  "generateRef",
  "generatePro",
  "generatePro4",
  "analysis",
]);

const resolveBananaStablePricingTier = (
  providerName?: string | null
): BananaPricingTier | null => {
  const normalized = String(providerName || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "banana-2.5") return "fast";
  if (normalized === "banana-3.1" || normalized === "nano2") return "ultra";
  if (
    normalized === "banana" ||
    normalized === "banana-3.0" ||
    normalized === "gemini-pro"
  ) {
    return "pro";
  }
  return null;
};

const normalizeBananaStableImageSize = (
  rawSize: unknown,
  tier: BananaPricingTier
): "0.5K" | "1K" | "2K" | "4K" => {
  const normalized = typeof rawSize === "string" ? rawSize.trim().toUpperCase() : "";
  if (tier === "fast") return "1K";
  if (tier === "pro") {
    if (normalized === "2K" || normalized === "4K") return normalized;
    return "1K";
  }
  if (tier === "ultra") {
    if (normalized === "0.5K") return "0.5K";
    if (normalized === "2K") return "2K";
    if (normalized === "4K") return "4K";
    return "1K";
  }
  if (
    normalized === "0.5K" ||
    normalized === "1K" ||
    normalized === "2K" ||
    normalized === "4K"
  ) {
    return normalized;
  }
  return "1K";
};

const normalizeGptImage2StableImageSize = (
  rawSize: unknown
): "1K" | "2K" | "4K" => {
  const normalized = typeof rawSize === "string" ? rawSize.trim().toUpperCase() : "";
  if (normalized === "2K") return "2K";
  if (normalized === "4K") return "4K";
  return "1K";
};

const VIDEO_DYNAMIC_CREDIT_NODE_TYPES = new Set([
  "sora2Video",
  "sora2Character",
  "wan26",
  "wan2R2V",
  "happyhorseR2V",
  "wan27Video",
  "klingVideo",
  "kling26Video",
  "kling30Video",
  "klingO1Video",
  "viduVideo",
  "viduQ3",
  "doubaoVideo",
  "seedance20Video",
]);

const KLING_DYNAMIC_CREDIT_MATRIX = {
  "kling-v2-6": {
    noSound: {
      std: { 5: 150, 10: 300 },
      pro: { 5: 300, 10: 500 },
    },
    withSound: {
      std: { 5: 500, 10: 1000 },
      pro: { 5: 600, 10: 1200 },
    },
  },
  "kling-v3-0": {
    noSound: {
      std: { 5: 300, 10: 600 },
      pro: { 5: 400, 10: 800 },
    },
    withSound: {
      std: { 5: 450, 10: 900 },
      pro: { 5: 600, 10: 1200 },
    },
  },
} as const;

const normalizeFiniteDuration = (value: unknown): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : undefined;
};

const resolveVideoDefaultDuration = (
  nodeType: string,
  nodeData?: Record<string, any>
): number | undefined => {
  const fromClip = normalizeFiniteDuration(nodeData?.clipDuration);
  if (typeof fromClip === "number") return fromClip;
  const fromDuration = normalizeFiniteDuration(nodeData?.duration);
  if (typeof fromDuration === "number") return fromDuration;

  if (
    nodeType === "wan26" ||
    nodeType === "wan2R2V" ||
    nodeType === "happyhorseR2V" ||
    nodeType === "wan27Video" ||
    nodeType === "klingVideo" ||
    nodeType === "kling26Video" ||
    nodeType === "kling30Video" ||
    nodeType === "viduVideo" ||
    nodeType === "viduQ3" ||
    nodeType === "doubaoVideo" ||
    nodeType === "seedance20Video"
  ) {
    return 5;
  }
  return undefined;
};

const resolveVideoDefaultResolution = (
  nodeType: string,
  nodeData?: Record<string, any>
): string | undefined => {
  if (typeof nodeData?.resolution === "string" && nodeData.resolution.trim()) {
    return nodeData.resolution.trim().toUpperCase();
  }
  if (nodeType === "wan27Video") return "1080P";
  if (
    nodeType === "wan26" ||
    nodeType === "wan2R2V" ||
    nodeType === "happyhorseR2V" ||
    nodeType === "viduVideo" ||
    nodeType === "viduQ3" ||
    nodeType === "doubaoVideo" ||
    nodeType === "seedance20Video"
  ) {
    return "720P";
  }
  return undefined;
};

const resolveVideoDefaultAspectRatio = (
  nodeType: string,
  nodeData?: Record<string, any>
): string | undefined => {
  if (typeof nodeData?.aspectRatio === "string" && nodeData.aspectRatio.trim()) {
    return nodeData.aspectRatio.trim();
  }
  if (nodeType === "viduVideo" || nodeType === "viduQ3") {
    return "16:9";
  }
  return undefined;
};

const resolveKlingModelForCredits = (
  nodeType: string,
  nodeData?: Record<string, any>
): "kling-v2-6" | "kling-v3-0" | null => {
  const rawModel = String(nodeData?.klingModel || "")
    .trim()
    .toLowerCase();
  if (rawModel === "kling-v3-0") return "kling-v3-0";
  if (rawModel === "kling-v2-6") return "kling-v2-6";
  if (nodeType === "kling30Video") return "kling-v3-0";
  if (nodeType === "klingVideo" || nodeType === "kling26Video") return "kling-v2-6";
  return null;
};

const resolveKlingDynamicCredits = (
  nodeType: string,
  nodeData?: Record<string, any>
): number | undefined => {
  const model = resolveKlingModelForCredits(nodeType, nodeData);
  if (!model) return undefined;

  const duration = resolveVideoDefaultDuration(nodeType, nodeData);
  if (duration !== 5 && duration !== 10) return undefined;

  const mode =
    typeof nodeData?.mode === "string" &&
    nodeData.mode.trim().toLowerCase() === "pro"
      ? "pro"
      : "std";

  const soundRaw = nodeData?.sound;
  const hasSound =
    mode === "pro"
      ? true
      : soundRaw === undefined || soundRaw === null
      ? true
      : soundRaw === true ||
        String(soundRaw).trim().toLowerCase() === "on" ||
        String(soundRaw).trim().toLowerCase() === "true";

  const soundKey = hasSound ? "withSound" : "noSound";
  const configured = KLING_DYNAMIC_CREDIT_MATRIX?.[model]?.[soundKey]?.[mode]?.[duration];
  return typeof configured === "number" ? configured : undefined;
};

const resolveSoraDynamicCredits = (
  nodeType: string,
  nodeData?: Record<string, any>
): number | undefined => {
  if (nodeType !== "sora2Video" && nodeType !== "sora2Character") {
    return undefined;
  }
  const model =
    typeof nodeData?.model === "string" && nodeData.model.trim().toLowerCase() === "sora-2"
      ? "sora-2"
      : "sora-2-pro";
  return model === "sora-2" ? 200 : 750;
};

const buildVideoPricingContext = (
  nodeType: string,
  nodeData?: Record<string, any>
): Record<string, any> => {
  const context: Record<string, any> = {};

  const duration = resolveVideoDefaultDuration(nodeType, nodeData);
  if (typeof duration === "number") {
    context.duration = duration;
  }

  const resolution = resolveVideoDefaultResolution(nodeType, nodeData);
  if (resolution) {
    context.resolution = resolution;
  }

  const aspectRatio = resolveVideoDefaultAspectRatio(nodeType, nodeData);
  if (aspectRatio) {
    context.aspectRatio = aspectRatio;
  }

  if (
    (nodeType === "sora2Video" || nodeType === "sora2Character") &&
    typeof nodeData?.model === "string" &&
    nodeData.model.trim()
  ) {
    const soraModel = nodeData.model.trim().toLowerCase();
    context.model = soraModel;
    context.soraModel = soraModel;
  }

  if (typeof nodeData?.seedanceModel === "string" && nodeData.seedanceModel.trim()) {
    context.seedanceModel = nodeData.seedanceModel.trim().toLowerCase();
  } else if (nodeType === "seedance20Video") {
    context.seedanceModel = "seedance-2.0";
  } else if (nodeType === "doubaoVideo") {
    context.seedanceModel = "seedance-1.5-pro";
  }

  if (typeof nodeData?.seedanceMode === "string" && nodeData.seedanceMode.trim()) {
    context.seedanceMode = nodeData.seedanceMode.trim().toLowerCase();
    context.videoMode = nodeData.seedanceMode.trim().toLowerCase();
  } else if (nodeType === "seedance20Video") {
    context.seedanceMode = "reference_images";
    context.videoMode = "reference_images";
  } else if (nodeType === "doubaoVideo") {
    context.seedanceMode = "text";
    context.videoMode = "text";
  }

  if (typeof nodeData?.generateAudio === "boolean") {
    context.generateAudio = nodeData.generateAudio;
  }
  if (typeof nodeData?.watermark === "boolean") {
    context.watermark = nodeData.watermark;
  }

  if (typeof nodeData?.viduModel === "string" && nodeData.viduModel.trim()) {
    context.viduModel = nodeData.viduModel.trim().toLowerCase();
  } else if (nodeType === "viduVideo") {
    context.viduModel = "q2";
  } else if (nodeType === "viduQ3") {
    context.viduModel = "q3";
  }
  if (typeof nodeData?.viduModelVariant === "string" && nodeData.viduModelVariant.trim()) {
    context.viduModelVariant = nodeData.viduModelVariant.trim().toLowerCase();
  } else if (typeof context.viduModel === "string" && context.viduModel.trim()) {
    context.viduModelVariant = context.viduModel;
  }
  if (typeof nodeData?.offPeak === "boolean") {
    context.offPeak = nodeData.offPeak;
  }
  if (typeof nodeData?.hasVideoInput === "boolean") {
    context.referenceVideo = nodeData.hasVideoInput;
    context.hasVideoInput = nodeData.hasVideoInput;
  }
  if (
    typeof nodeData?.referenceVideoType === "string" &&
    nodeData.referenceVideoType.trim()
  ) {
    context.referenceVideoType = nodeData.referenceVideoType.trim().toLowerCase();
  }
  if (nodeData?.hasVideoInput === true) {
    context.inputType = "video";
  } else if (typeof nodeData?.seedanceMode === "string" && nodeData.seedanceMode.trim()) {
    const mode = nodeData.seedanceMode.trim().toLowerCase();
    context.inputType = mode === "text" ? "text" : "image";
  } else if (typeof nodeData?.viduModel === "string" && nodeData.viduModel.trim()) {
    context.inputType = "text";
  }

  const klingModel = resolveKlingModelForCredits(nodeType, nodeData);
  if (klingModel) {
    context.klingModel = klingModel;
    context.mode =
      typeof nodeData?.mode === "string" && nodeData.mode.trim()
        ? nodeData.mode.trim().toLowerCase()
        : "std";
    const soundRaw = nodeData?.sound;
    context.sound =
      soundRaw === undefined || soundRaw === null
        ? true
        : soundRaw === true ||
          String(soundRaw).trim().toLowerCase() === "on" ||
          String(soundRaw).trim().toLowerCase() === "true";
  }

  return context;
};

const buildImagePricingContext = (
  nodeType: string,
  nodeData?: Record<string, any>
): Record<string, any> => {
  const normalizedType = normalizeFlowNodeType(nodeType) || nodeType;
  const context: Record<string, any> = {};

  const rawImageSize =
    typeof nodeData?.imageSize === "string" && nodeData.imageSize.trim().length > 0
      ? nodeData.imageSize.trim()
      : typeof nodeData?.resolution === "string" && nodeData.resolution.trim().length > 0
      ? nodeData.resolution.trim()
      : typeof nodeData?.size === "string" && nodeData.size.trim().length > 0
      ? nodeData.size.trim()
      : undefined;
  if (rawImageSize) {
    context.imageSize = rawImageSize;
    context.resolution = rawImageSize;
  }

  const rawQuality =
    typeof nodeData?.quality === "string" && nodeData.quality.trim().length > 0
      ? nodeData.quality.trim()
      : "hd";
  context.quality = rawQuality;

  const explicitOutputCount = Number(nodeData?.outputCount);
  if (Number.isFinite(explicitOutputCount) && explicitOutputCount > 0) {
    context.outputCount = explicitOutputCount;
  } else if (normalizedType === "generate4" || normalizedType === "generatePro4") {
    context.outputCount = 4;
  } else {
    context.outputCount = 1;
  }

  const explicitReferenceCount = Number(nodeData?.referenceImageCount);
  if (Number.isFinite(explicitReferenceCount) && explicitReferenceCount >= 0) {
    context.referenceImageCount = explicitReferenceCount;
  } else if (normalizedType === "generateRef") {
    context.referenceImageCount = 1;
  } else {
    context.referenceImageCount = 0;
  }

  context.mode = "generate";
  return context;
};

const resolveStableRouteCredits = (params: {
  nodeType?: string | null;
  nodeData?: Record<string, any>;
  fallbackCredits?: number;
  aiProvider?: string | null;
  bananaImageRoute?: "normal" | "stable";
  globalImageSize?: string | null;
  globalImageModel?: string | null;
}): number | undefined => {
  const {
    nodeType,
    nodeData,
    fallbackCredits,
    aiProvider,
    bananaImageRoute,
    globalImageSize,
    globalImageModel,
  } = params;
  const normalizedType = normalizeFlowNodeType(nodeType || undefined);
  let resolvedCredits = fallbackCredits;
  const providerForPricing =
    typeof nodeData?.modelProvider === "string" && nodeData.modelProvider.trim().length > 0
      ? nodeData.modelProvider.trim()
      : aiProvider;

  if (normalizedType === "textChat") {
    resolvedCredits = 2;
  }

  if (normalizedType === "promptOptimize") {
    resolvedCredits = 5;
  }

  if (bananaImageRoute === "stable" && normalizedType === "gptImage2") {
    const preferredSize =
      typeof nodeData?.resolution === "string" && nodeData.resolution.trim().length > 0
        ? nodeData.resolution
        : typeof nodeData?.imageSize === "string" && nodeData.imageSize.trim().length > 0
        ? nodeData.imageSize
        : globalImageSize;
    const normalizedSize = normalizeGptImage2StableImageSize(preferredSize);
    const unitCredits = Number(GPT_IMAGE_2_STABLE_ROUTE_PRICING[normalizedSize]);
    if (Number.isFinite(unitCredits) && unitCredits > 0) {
      resolvedCredits = unitCredits;
    }
  } else if (normalizedType === "gptImage2") {
    const preferredSize =
      typeof nodeData?.resolution === "string" && nodeData.resolution.trim().length > 0
        ? nodeData.resolution
        : typeof nodeData?.imageSize === "string" && nodeData.imageSize.trim().length > 0
        ? nodeData.imageSize
        : globalImageSize;
    const normalizedSize = normalizeGptImage2StableImageSize(preferredSize);
    const unitCredits = Number(GPT_IMAGE_2_NORMAL_ROUTE_PRICING[normalizedSize]);
    if (Number.isFinite(unitCredits) && unitCredits > 0) {
      resolvedCredits = unitCredits;
    }
  }

  // Stable 通道下的 Banana 图片节点动态积分
  if (bananaImageRoute === "stable" && normalizedType && BANANA_STABLE_DYNAMIC_NODE_TYPES.has(normalizedType)) {
    const tier = resolveBananaStablePricingTier(providerForPricing);
    if (tier) {
      const preferredSize =
        typeof nodeData?.imageSize === "string" && nodeData.imageSize.trim().length > 0
          ? nodeData.imageSize
          : globalImageSize;
      const normalizedSize = normalizeBananaStableImageSize(preferredSize, tier);
      const unitCredits = Number(BANANA_STABLE_ROUTE_PRICING[tier][normalizedSize]);
      if (Number.isFinite(unitCredits) && unitCredits > 0) {
        const outputCount =
          normalizedType === "generate4" || normalizedType === "generatePro4"
            ? (() => {
                const n = Number(nodeData?.outputCount);
                return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 4;
              })()
            : 1;
        resolvedCredits = unitCredits * outputCount;
      }
    }
  }

  // 普通通道下的 Banana 图片节点动态积分（使用新的定价逻辑）
  if (bananaImageRoute !== "stable" && normalizedType && BANANA_DYNAMIC_NODE_TYPES.has(normalizedType)) {
    const tier = resolveBananaPricingTierForNode({
      nodeType: normalizedType,
      providerForPricing,
      globalImageModel,
    });
    if (tier) {
      const preferredSize =
        typeof nodeData?.imageSize === "string" && nodeData.imageSize.trim().length > 0
          ? nodeData.imageSize
          : globalImageSize;
      const normalizedSize = normalizeBananaImageSize(preferredSize, tier);
      const unitCredits = Number(BANANA_ROUTE_PRICING[tier][normalizedSize]);
      if (Number.isFinite(unitCredits) && unitCredits > 0) {
        const outputCount =
          normalizedType === "generate4" || normalizedType === "generatePro4"
            ? (() => {
                const n = Number(nodeData?.outputCount);
                return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 4;
              })()
            : 1;
        resolvedCredits = unitCredits * outputCount;
      }
    }
  }

  // 图像节点统一模型管理定价优先级最高
  if (
    normalizedType &&
    IMAGE_DYNAMIC_CREDIT_NODE_TYPES.has(normalizedType) &&
    normalizedType !== "gptImage2"
  ) {
    const metadata =
      nodeData?.nodeConfigMetadata && typeof nodeData.nodeConfigMetadata === "object"
        ? (nodeData.nodeConfigMetadata as Record<string, any>)
        : undefined;
    const vendorKey =
      typeof nodeData?.vendorKey === "string" && nodeData.vendorKey.trim().length > 0
        ? nodeData.vendorKey.trim()
        : undefined;
    const pricingContext = buildImagePricingContext(normalizedType, nodeData);
    const managedPricing = resolveManagedRoutePricing(metadata, vendorKey, pricingContext);
    if (typeof managedPricing?.credits === "number" && Number.isFinite(managedPricing.credits)) {
      resolvedCredits = managedPricing.credits;
    }
  }

  // 视频节点动态积分
  if (normalizedType && VIDEO_DYNAMIC_CREDIT_NODE_TYPES.has(normalizedType)) {
    const metadata =
      nodeData?.nodeConfigMetadata && typeof nodeData.nodeConfigMetadata === "object"
        ? (nodeData.nodeConfigMetadata as Record<string, any>)
        : undefined;
    const vendorKey =
      typeof nodeData?.vendorKey === "string" && nodeData.vendorKey.trim().length > 0
        ? nodeData.vendorKey.trim()
        : undefined;
    const pricingContext = buildVideoPricingContext(normalizedType, nodeData);
    const managedPricing = resolveManagedRoutePricing(metadata, vendorKey, pricingContext);

    const klingCredits = resolveKlingDynamicCredits(normalizedType, nodeData);
    if (typeof klingCredits === "number" && Number.isFinite(klingCredits)) {
      resolvedCredits = klingCredits;
    }

    const soraCredits = resolveSoraDynamicCredits(normalizedType, nodeData);
    if (typeof soraCredits === "number" && Number.isFinite(soraCredits)) {
      resolvedCredits = soraCredits;
    }

    // 统一模型管理配置优先于节点原生/旧链路动态价
    if (typeof managedPricing?.credits === "number" && Number.isFinite(managedPricing.credits)) {
      resolvedCredits = managedPricing.credits;
    }
  }

  return resolvedCredits;
};

const isManagedPaletteConfig = (config?: Partial<NodeConfig>): boolean => {
  const metadata = (config?.metadata ?? {}) as Record<string, unknown>;
  return Boolean(
    metadata.managedModelKey ||
      (metadata.nodeConfig &&
        typeof metadata.nodeConfig === "object" &&
        (metadata.nodeConfig as Record<string, unknown>).flowNodeType)
  );
};

const isModelBackedPaletteConfig = (config?: Partial<NodeConfig>): boolean => {
  const metadata = (config?.metadata ?? {}) as Record<string, unknown>;
  return Array.isArray(metadata.modelKeys) && metadata.modelKeys.length > 0;
};

const resolveFlowNodeTypeFromConfig = (config: Partial<NodeConfig>): string => {
  const metadata = (config.metadata ?? {}) as Record<string, unknown>;
  const nodeConfig =
    metadata.nodeConfig && typeof metadata.nodeConfig === "object"
      ? (metadata.nodeConfig as Record<string, unknown>)
      : undefined;
  const candidates = [
    typeof nodeConfig?.flowNodeType === "string" ? nodeConfig.flowNodeType : undefined,
    typeof metadata.type === "string" ? metadata.type : undefined,
    typeof metadata.flowNodeType === "string" ? metadata.flowNodeType : undefined,
    typeof metadata.nodeKey === "string" ? metadata.nodeKey : undefined,
    typeof metadata.provider === "string" ? metadata.provider : undefined,
    config.nodeKey,
    config.serviceType,
    config.nameEn,
    config.nameZh,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeFlowNodeType(candidate);
    if (normalized) {
      return normalized;
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
};

const isBaseVideoInputPaletteConfig = (config?: Partial<NodeConfig>): boolean => {
  if (!config) return false;
  const nodeKey = String(config.nodeKey || "").trim().toLowerCase();
  if (nodeKey === "video") return true;
  const resolvedType = resolveFlowNodeTypeFromConfig(config);
  return resolvedType === "video" && config.category === "input";
};

const sanitizeBaseVideoInputPaletteConfig = (
  config: Partial<NodeConfig>
): Partial<NodeConfig> => {
  const metadata =
    config.metadata && typeof config.metadata === "object"
      ? ({ ...(config.metadata as Record<string, any>) } as Record<string, any>)
      : {};

  delete metadata.type;
  delete metadata.flowNodeType;
  delete metadata.provider;
  delete metadata.nodeKey;
  delete metadata.modelKeys;
  delete metadata.managedModelKey;
  delete metadata.managedRoutes;
  delete metadata.supportedModels;
  delete metadata.vod;
  delete metadata.vipOnly;
  delete metadata.defaultData;

  if (metadata.nodeConfig && typeof metadata.nodeConfig === "object") {
    const nextNodeConfig = {
      ...(metadata.nodeConfig as Record<string, any>),
      flowNodeType: "video",
      nodeKey: "video",
      taskType: "input",
    };
    delete nextNodeConfig.provider;
    delete nextNodeConfig.vod;
    metadata.nodeConfig = nextNodeConfig;
  }

  return {
    ...config,
    nodeKey: "video",
    category: "input",
    nameZh: config.nameZh || "视频节点",
    nameEn: config.nameEn || "Video",
    description:
      typeof config.description === "string" && config.description.trim()
        ? config.description
        : "上传视频文件",
    status: "normal",
    statusMessage: undefined,
    metadata,
  };
};

const NODE_STATUS_PRIORITY: Record<NodeConfig["status"], number> = {
  normal: 0,
  maintenance: 1,
  coming_soon: 2,
  disabled: 3,
};

const UNIFIED_VIDEO_NODE_TITLES: Partial<
  Record<FlowNodeType, { nameZh: string; nameEn: string }>
> = {
  klingVideo: { nameZh: "Kling", nameEn: "Kling" },
  viduVideo: { nameZh: "Vidu", nameEn: "Vidu" },
  doubaoVideo: { nameZh: "Seedance", nameEn: "Seedance" },
};

const mergeUniqueStrings = (...lists: Array<string[] | undefined>): string[] | undefined => {
  const merged = lists
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (merged.length === 0) return undefined;
  return Array.from(new Set(merged));
};

const mergeManagedRouteVendors = (base: unknown, incoming: unknown): any[] | undefined => {
  const all = [...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])];
  const map = new Map<string, Record<string, any>>();
  all.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, any>;
    const vendorKey =
      typeof record.vendorKey === "string" ? record.vendorKey.trim() : "";
    if (!vendorKey) return;
    const platformKey =
      typeof record.platformKey === "string" ? record.platformKey.trim() : "";
    const key = `${vendorKey}::${platformKey}`;
    map.set(key, { ...(map.get(key) || {}), ...record, vendorKey, platformKey: platformKey || undefined });
  });
  const merged = Array.from(map.values());
  return merged.length > 0 ? merged : undefined;
};

const mergeNodePaletteMetadata = (
  base?: Record<string, any>,
  incoming?: Record<string, any>
): Record<string, any> | undefined => {
  if (!base && !incoming) return undefined;
  const next: Record<string, any> = { ...(base || {}), ...(incoming || {}) };

  const mergedModelKeys = mergeUniqueStrings(base?.modelKeys, incoming?.modelKeys);
  if (mergedModelKeys) next.modelKeys = mergedModelKeys;

  const mergedSupportedModels = mergeUniqueStrings(
    base?.supportedModels,
    incoming?.supportedModels
  );
  if (mergedSupportedModels) next.supportedModels = mergedSupportedModels;

  const mergedNotes = mergeUniqueStrings(base?.notes, incoming?.notes);
  if (mergedNotes) next.notes = mergedNotes;

  const baseNodeConfig =
    base?.nodeConfig && typeof base.nodeConfig === "object" ? base.nodeConfig : undefined;
  const incomingNodeConfig =
    incoming?.nodeConfig && typeof incoming.nodeConfig === "object"
      ? incoming.nodeConfig
      : undefined;
  if (baseNodeConfig || incomingNodeConfig) {
    next.nodeConfig = { ...(baseNodeConfig || {}), ...(incomingNodeConfig || {}) };
  }

  const baseManagedRoutes =
    base?.managedRoutes && typeof base.managedRoutes === "object"
      ? (base.managedRoutes as Record<string, any>)
      : undefined;
  const incomingManagedRoutes =
    incoming?.managedRoutes && typeof incoming.managedRoutes === "object"
      ? (incoming.managedRoutes as Record<string, any>)
      : undefined;
  if (baseManagedRoutes || incomingManagedRoutes) {
    const mergedVendors = mergeManagedRouteVendors(
      baseManagedRoutes?.vendors,
      incomingManagedRoutes?.vendors
    );
    next.managedRoutes = {
      ...(baseManagedRoutes || {}),
      ...(incomingManagedRoutes || {}),
      modelKey:
        incomingManagedRoutes?.modelKey ||
        baseManagedRoutes?.modelKey ||
        next.managedRoutes?.modelKey,
      defaultVendor:
        incomingManagedRoutes?.defaultVendor ||
        baseManagedRoutes?.defaultVendor ||
        next.managedRoutes?.defaultVendor,
      vendors: mergedVendors || incomingManagedRoutes?.vendors || baseManagedRoutes?.vendors,
    };
  }

  return next;
};

const mergeNodePaletteConfig = (
  base: NodeConfig,
  incoming: NodeConfig,
  resolvedType?: string
): NodeConfig => {
  const baseIsVideoInput = isBaseVideoInputPaletteConfig(base);
  const incomingIsVideoInput = isBaseVideoInputPaletteConfig(incoming);
  if (baseIsVideoInput || incomingIsVideoInput) {
    const videoInputSource = baseIsVideoInput ? base : incoming;
    const sanitized = sanitizeBaseVideoInputPaletteConfig(videoInputSource);
    return {
      ...(sanitized as NodeConfig),
      creditsPerCall: 0,
      sortOrder: Number.isFinite(Number(videoInputSource.sortOrder))
        ? Number(videoInputSource.sortOrder)
        : 5,
      metadata:
        sanitized.metadata && typeof sanitized.metadata === "object"
          ? (sanitized.metadata as Record<string, any>)
          : {},
    };
  }

  const basePriority = NODE_STATUS_PRIORITY[base.status] ?? 99;
  const incomingPriority = NODE_STATUS_PRIORITY[incoming.status] ?? 99;
  const preferred = incomingPriority < basePriority ? incoming : base;
  const fallback = preferred === base ? incoming : base;

  const resolvedNodeType =
    normalizeFlowNodeType(resolvedType || preferred.nodeKey || fallback.nodeKey || "") ||
    undefined;
  const unifiedTitle = resolvedNodeType
    ? UNIFIED_VIDEO_NODE_TITLES[resolvedNodeType]
    : undefined;
  const mergedMetadata = mergeNodePaletteMetadata(base.metadata, incoming.metadata);

  const preferredSortOrder = Number.isFinite(Number(preferred.sortOrder))
    ? Number(preferred.sortOrder)
    : Number.MAX_SAFE_INTEGER;
  const fallbackSortOrder = Number.isFinite(Number(fallback.sortOrder))
    ? Number(fallback.sortOrder)
    : Number.MAX_SAFE_INTEGER;
  const mergedSortOrder = Math.min(preferredSortOrder, fallbackSortOrder);

  return {
    ...fallback,
    ...preferred,
    nodeKey: resolvedNodeType || preferred.nodeKey || fallback.nodeKey,
    nameZh: unifiedTitle?.nameZh || preferred.nameZh || fallback.nameZh,
    nameEn: unifiedTitle?.nameEn || preferred.nameEn || fallback.nameEn,
    status: basePriority <= incomingPriority ? base.status : incoming.status,
    statusMessage: preferred.statusMessage || fallback.statusMessage,
    description: preferred.description || fallback.description,
    creditsPerCall:
      Number.isFinite(Number(preferred.creditsPerCall)) &&
      Number(preferred.creditsPerCall) >= 0
        ? Number(preferred.creditsPerCall)
        : Number(fallback.creditsPerCall) || 0,
    sortOrder: Number.isFinite(mergedSortOrder) ? mergedSortOrder : 0,
    metadata: mergedMetadata,
  };
};

const buildNodePaletteCaption = (config: Partial<NodeConfig>): string | undefined => {
  const metadata = (config.metadata ?? {}) as Record<string, any>;
  const normalizeCaption = (raw: string): string => {
    const trimmed = raw.trim();
    if (String(config.nodeKey || "").trim().toLowerCase() === "gptimage2") {
      return trimmed.replace(/^apimart\s*/i, "").trim();
    }
    return trimmed;
  };
  if (isBaseVideoInputPaletteConfig(config)) {
    if (typeof config.description === "string" && config.description.trim()) {
      return normalizeCaption(config.description);
    }
    return "上传视频文件";
  }
  const nodeConfig =
    metadata.nodeConfig && typeof metadata.nodeConfig === "object"
      ? (metadata.nodeConfig as Record<string, any>)
      : undefined;
  const vod = metadata.vod && typeof metadata.vod === "object" ? metadata.vod : undefined;
  if (typeof nodeConfig?.description === "string" && nodeConfig.description.trim()) {
    const caption = normalizeCaption(nodeConfig.description);
    return caption || undefined;
  }
  if (vod) {
    const segments = [
      "VOD",
      vod.modelVersion ? `${vod.modelName || ""} ${vod.modelVersion}`.trim() : vod.modelName,
      Array.isArray(vod.outputConfig?.resolutions) && vod.outputConfig.resolutions.length > 0
        ? vod.outputConfig.resolutions.join("/")
        : undefined,
      Array.isArray(vod.outputConfig?.durations) && vod.outputConfig.durations.length > 0
        ? `${Math.min(...vod.outputConfig.durations)}-${Math.max(...vod.outputConfig.durations)}s`
        : undefined,
    ].filter(Boolean);
    if (segments.length > 0) return segments.join(" · ");
  }
  if (typeof config.description === "string" && config.description.trim()) {
    const caption = normalizeCaption(config.description);
    return caption || undefined;
  }
  return undefined;
};

const resolveNodeConfigCreditsPerCall = (config: Partial<NodeConfig>): number => {
  const metadata =
    config.metadata && typeof config.metadata === "object"
      ? (config.metadata as Record<string, any>)
      : undefined;
  const managedCredits = getManagedRouteCredits(metadata);
  if (typeof managedCredits === "number") {
    return managedCredits;
  }
  const directCredits = Number(config.creditsPerCall ?? 0);
  return Number.isFinite(directCredits) ? directCredits : 0;
};

const nodePaletteButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
  fontWeight: 500,
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#0f172a",
  cursor: "pointer",
  transition: "all 0.18s ease",
  width: "100%",
  textAlign: "left",
  position: "relative",
};

const nodePaletteZhStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 10px",
  borderRadius: 12,
  background: "#f1f5f9",
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.02em",
};

const nodePaletteEnCodeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "#111827",
  background: "transparent",
  border: "none",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "0.01em",
  padding: 0,
  borderRadius: 0,
  fontFamily: 'Inter, "Helvetica Neue", Arial, ui-sans-serif',
  whiteSpace: "nowrap",
};

const nodePaletteBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#18181b",
  background: "#f4f4f5",
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid #d4d4d8",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const nodePaletteCreditsStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: "#059669",
  background: "#ecfdf5",
  padding: "2px 6px",
  borderRadius: 4,
  letterSpacing: "0.01em",
  whiteSpace: "nowrap",
};

const nodePaletteSectionStyle: React.CSSProperties = {
  marginTop: 16,
};

const nodePaletteSectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const nodePaletteSectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
  lineHeight: 1.2,
};

const nodePaletteSectionSubtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 2,
};

const nodePaletteSectionCountStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#4b5563",
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  padding: "4px 10px",
  whiteSpace: "nowrap",
};

const getNodePaletteGroupKey = (
  config: Partial<NodeConfig> & { nodeKey?: string; category?: string }
): NodePanelGroupKey => {
  const metadata = (config.metadata ?? {}) as Record<string, any>;
  const nodeConfig =
    metadata.nodeConfig && typeof metadata.nodeConfig === "object"
      ? (metadata.nodeConfig as Record<string, any>)
      : undefined;
  const managedTaskType = String(
    nodeConfig?.taskType || metadata.managedTaskType || config.category || ""
  )
    .trim()
    .toLowerCase();
  if (managedTaskType === "text") return "text";
  if (managedTaskType === "image") return "image";
  if (managedTaskType === "video") return "video";
  if (managedTaskType === "audio") return "audio";

  const resolvedType = resolveFlowNodeTypeFromConfig(config).trim();
  if (resolvedType && NODE_PANEL_GROUP_BY_TYPE[resolvedType]) {
    return NODE_PANEL_GROUP_BY_TYPE[resolvedType];
  }

  const key = (config.nodeKey ?? "").trim();
  if (key && NODE_PANEL_GROUP_BY_TYPE[key]) {
    return NODE_PANEL_GROUP_BY_TYPE[key];
  }

  const mergedName = `${config.nameZh ?? ""} ${config.nameEn ?? ""}`.toLowerCase();
  if (mergedName.includes("3d") || mergedName.includes("三维")) return "three";
  if (mergedName.includes("视频") || mergedName.includes("video")) return "video";
  if (mergedName.includes("语音") || mergedName.includes("speech") || mergedName.includes("audio")) return "audio";
  if (
    mergedName.includes("文本") ||
    mergedName.includes("文字") ||
    mergedName.includes("提示词") ||
    mergedName.includes("prompt") ||
    mergedName.includes("text")
  ) {
    return "text";
  }
  if (
    mergedName.includes("图像") ||
    mergedName.includes("图片") ||
    mergedName.includes("生成") ||
    mergedName.includes("image")
  ) {
    return "image";
  }

  if (config.category === "video") return "video";
  if (config.category === "audio") return "audio";
  if (config.category === "image") return "image";
  if (config.category === "input") return "text";

  return "other";
};

const setNodePaletteHover = (
  target: HTMLElement,
  hovered: boolean,
  isDarkTheme = false
) => {
  target.style.background = isDarkTheme
    ? hovered
      ? "#262626"
      : "#1d1d1d"
    : hovered
      ? "#f8fafc"
      : "#fff";
  target.style.borderColor = isDarkTheme
    ? hovered
      ? "#4b4b4b"
      : "#333333"
    : hovered
      ? "#d5dae3"
      : "#e5e7eb";
  target.style.transform = hovered ? "translateY(-1px)" : "translateY(0)";
  target.style.boxShadow = hovered
    ? isDarkTheme
      ? "0 12px 26px rgba(0, 0, 0, 0.38)"
      : "0 12px 26px rgba(15, 23, 42, 0.12)"
    : "none";
};

const NodePaletteButton: React.FC<{
  zh: string;
  en: string;
  caption?: string;
  badge?: string;
  status?: string;
  credits?: number | string;
  disabled?: boolean;
  isDarkTheme?: boolean;
  showZh?: boolean;
  vipOnly?: boolean;
  onClick: () => void;
}> = ({
  zh,
  en,
  caption,
  badge,
  status,
  credits,
  disabled,
  isDarkTheme = false,
  showZh = true,
  vipOnly = false,
  onClick,
}) => {
  const creditsDisplay =
    credits !== undefined && credits !== 0
      ? typeof credits === "string"
        ? credits
        : credits.toString()
      : null;

  const getBadgeStyle = (statusCode?: string): React.CSSProperties => {
    if (statusCode === "maintenance") {
      return {
        ...nodePaletteBadgeStyle,
        color: isDarkTheme ? "#fca5a5" : "#dc2626",
        background: isDarkTheme ? "#3a1f1f" : "#fee2e2",
        border: isDarkTheme ? "1px solid #7f1d1d" : "1px solid #fca5a5",
      };
    }
    if (statusCode === "coming_soon") {
      return {
        ...nodePaletteBadgeStyle,
        color: isDarkTheme ? "#fcd34d" : "#d97706",
        background: isDarkTheme ? "#3a2e16" : "#fef3c7",
        border: isDarkTheme ? "1px solid #7c5a14" : "1px solid #fcd34d",
      };
    }
    return nodePaletteBadgeStyle;
  };

  // VIP-only 样式
  const isVipLocked = vipOnly && !disabled;
  const buttonStyle: React.CSSProperties = {
    ...nodePaletteButtonStyle,
    ...(isDarkTheme
      ? {
          border: "1px solid #333333",
          background: "#1d1d1d",
          color: "#ffffff",
          justifyContent: showZh ? "space-between" : "flex-start",
        }
      : {}),
    ...(disabled || isVipLocked ? {
      opacity: isDarkTheme ? 0.75 : 0.6,
      cursor: "not-allowed",
      background: isDarkTheme ? "#171717" : "#f9fafb",
      color: isDarkTheme ? "#666666" : "#0f172a",
    } : {}),
  };

  return (
    <button
      type='button'
      onClick={disabled || isVipLocked ? undefined : onClick}
      style={buttonStyle}
      onMouseEnter={(e) =>
        !(disabled || isVipLocked) && setNodePaletteHover(e.currentTarget, true, isDarkTheme)
      }
      onMouseLeave={(e) =>
        !(disabled || isVipLocked) && setNodePaletteHover(e.currentTarget, false, isDarkTheme)
      }
      disabled={Boolean(disabled || isVipLocked)}
      title={isVipLocked ? (isDarkTheme ? "VIP only" : "VIP 限定功能") : undefined}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <span
            style={{
              ...nodePaletteEnCodeStyle,
              color: isDarkTheme ? "#ffffff" : nodePaletteEnCodeStyle.color,
            }}
          >
            {en}
          </span>
          {badge ? <span style={getBadgeStyle(status)}>{badge}</span> : null}
          {/* VIP 锁定标识 */}
          {isVipLocked && (
            <span
              style={{
                ...nodePaletteBadgeStyle,
                display: "flex",
                alignItems: "center",
                gap: 3,
                color: isDarkTheme ? "#fcd34d" : "#92400e",
                background: isDarkTheme ? "#3a2e16" : "#fef3c7",
                border: isDarkTheme ? "1px solid #7c5a14" : "1px solid #fcd34d",
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              <Crown size={10} />
              <span>VIP</span>
            </span>
          )}
        </div>
        {caption ? (
          <div
            style={{
              fontSize: 11,
              color: isDarkTheme ? "#888888" : "#6b7280",
              lineHeight: 1.4,
              maxWidth: "100%",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={caption}
          >
            {caption}
          </div>
        ) : null}
        {/* VIP 锁定提示 */}
        {isVipLocked && (
          <div
            style={{
              fontSize: 10,
              color: isDarkTheme ? "#fcd34d" : "#d97706",
              fontWeight: 500,
              marginTop: 2,
            }}
          >
            {isDarkTheme ? "VIP only" : "VIP 专属"}
          </div>
        )}
        {/* {creditsDisplay && (
          <span style={nodePaletteCreditsStyle}>消耗{creditsDisplay}积分</span>
        )} */}
      </div>
      {showZh ? (
        <span
          style={{
            ...nodePaletteZhStyle,
            background: isDarkTheme ? "#262626" : nodePaletteZhStyle.background,
            color: isDarkTheme ? "#ffffff" : nodePaletteZhStyle.color,
            border: isDarkTheme ? "1px solid #404040" : "none",
          }}
        >
          {zh}
        </span>
      ) : null}
      {/* VIP 锁定图标 */}
      {isVipLocked && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px rgba(245, 158, 11, 0.4)",
            zIndex: 10,
          }}
        >
          <Lock size={12} color="#fff" />
        </div>
      )}
    </button>
  );
};

// 用户模板卡片组件
const UserTemplateCard: React.FC<{
  item: {
    id: string;
    name: string;
    category?: string;
    tags?: string[];
    thumbnail?: string;
    createdAt: string;
    updatedAt: string;
  };
  onInstantiate: () => Promise<void>;
  onDelete: () => Promise<void>;
  isDarkTheme?: boolean;
}> = ({ item, onInstantiate, onDelete, isDarkTheme = false }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 18,
        border: isDarkTheme ? "1px solid #404040" : "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "18px 20px",
        background: isDarkTheme ? "#1d1d1d" : "#fff",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
        minHeight: 130,
        height: 130,
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = isDarkTheme ? "#5a5a5a" : "#18181b";
        e.currentTarget.style.background = isDarkTheme ? "#262626" : "#f4f4f5";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = isDarkTheme
          ? "0 16px 32px rgba(0, 0, 0, 0.45)"
          : "0 16px 32px rgba(0, 0, 0, 0.12)";
        setIsHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isDarkTheme ? "#404040" : "#e5e7eb";
        e.currentTarget.style.background = isDarkTheme ? "#1d1d1d" : "#fff";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
        setIsHovered(false);
      }}
      onClick={async (e) => {
        if ((e.target as HTMLElement).closest(".delete-btn")) return;
        await onInstantiate();
      }}
    >
      <div
        style={{
          flex: "0 0 50%",
          maxWidth: "50%",
          height: "100%",
          background: item.thumbnail
            ? "transparent"
            : isDarkTheme
              ? "#171717"
              : "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {item.thumbnail ? (
          <SmartImage
            src={item.thumbnail}
            alt={item.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ fontSize: 12, color: isDarkTheme ? "#666666" : "#9ca3af" }}>
            暂无预览
          </div>
        )}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          justifyContent: "center",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: isDarkTheme ? "#ffffff" : "#111827",
              marginBottom: 6,
            }}
          >
            {item.name}
          </div>
          <div style={{ fontSize: 12, color: isDarkTheme ? "#888888" : "#6b7280" }}>
            更新于 {new Date(item.updatedAt).toLocaleString()}
          </div>
        </div>
        {item.category ? (
          <div style={{ fontSize: 12, color: isDarkTheme ? "#666666" : "#9ca3af" }}>
            分类：{item.category}
          </div>
        ) : null}
        {item.tags?.length ? (
          <div style={{ fontSize: 12, color: isDarkTheme ? "#666666" : "#9ca3af" }}>
            标签：{item.tags.join(" / ")}
          </div>
        ) : null}
      </div>
      {isHovered && (
        <button
          className='delete-btn'
          style={{
            position: "absolute",
            right: 16,
            top: 16,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: isDarkTheme ? "1px solid #5a2a2a" : "1px solid #fecaca",
            background: isDarkTheme ? "#262626" : "#fff",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDarkTheme ? "#3a1f1f" : "#fee2e2";
            e.currentTarget.style.borderColor = isDarkTheme ? "#7f1d1d" : "#fca5a5";
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isDarkTheme ? "#262626" : "#fff";
            e.currentTarget.style.borderColor = isDarkTheme ? "#5a2a2a" : "#fecaca";
            e.currentTarget.style.transform = "scale(1)";
          }}
          title='删除模板'
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

const AddTemplateCard: React.FC<{
  onAdd: () => Promise<void>;
  label?: string;
  isDarkTheme?: boolean;
}> = ({ onAdd, label, isDarkTheme = false }) => {
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <button
      type='button'
      onClick={async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
          await onAdd();
        } finally {
          setIsLoading(false);
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        border: isDarkTheme ? "1px dashed #404040" : "1px dashed #a1a1aa",
        borderRadius: 12,
        padding: "18px 20px",
        minHeight: 130,
        height: 130,
        background: isDarkTheme ? "#171717" : "#fafafa",
        color: isDarkTheme ? "#ffffff" : "#18181b",
        cursor: isLoading ? "wait" : "pointer",
        transition: "all 0.15s ease",
        gap: 10,
        fontSize: 13,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        if (isLoading) return;
        e.currentTarget.style.background = isDarkTheme ? "#262626" : "#f4f4f5";
        e.currentTarget.style.borderColor = isDarkTheme ? "#666666" : "#71717a";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = isDarkTheme
          ? "0 12px 24px rgba(0, 0, 0, 0.4)"
          : "0 12px 24px rgba(0, 0, 0, 0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isDarkTheme ? "#171717" : "#fafafa";
        e.currentTarget.style.borderColor = isDarkTheme ? "#404040" : "#a1a1aa";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
      disabled={isLoading}
    >
      <Plus size={24} strokeWidth={2.5} />
      <div>{isLoading ? "保存中…" : label || "保存为模板"}</div>
    </button>
  );
};

const TemplatePlaceholder: React.FC<{
  label: string;
  subtitle: string;
  isDarkTheme?: boolean;
}> = ({ label, subtitle, isDarkTheme = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: 18,
      border: isDarkTheme ? "1px dashed #404040" : "1px dashed #d1d5db",
      borderRadius: 12,
      padding: "15px",
      minHeight: 160,
      height: 160,
      background: isDarkTheme ? "#171717" : "#f9fafb",
      transition: "all 0.2s ease",
    }}
  >
    <div
      style={{
        flex: "0 0 50%",
        maxWidth: "50%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isDarkTheme ? "#1d1d1d" : "#f3f4f6",
        borderRadius: 8,
        color: isDarkTheme ? "#666666" : "#94a3b8",
      }}
    >
      <Plus size={28} strokeWidth={2} />
    </div>
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        justifyContent: "center",
        color: isDarkTheme ? "#888888" : "#94a3b8",
        fontSize: 13,
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: isDarkTheme ? "#ffffff" : "inherit",
        }}
      >
        {label}
      </div>
      <div>{subtitle}</div>
    </div>
  </div>
);

// Flow独立的视口管理，不再与Canvas同步
function useFlowViewport() {
  const { flowZoom, flowPanX, flowPanY, setFlowZoom, setFlowPan } =
    useFlowStore();
  const rf = useReactFlow();

  const updateViewport = React.useCallback(
    (x: number, y: number, zoom: number) => {
      try {
        rf.setViewport({ x, y, zoom }, { duration: 0 });
        setFlowPan(x, y);
        setFlowZoom(zoom);
      } catch (_) {}
    },
    [rf, setFlowPan, setFlowZoom]
  );

  return {
    zoom: flowZoom,
    panX: flowPanX,
    panY: flowPanY,
    updateViewport,
  };
}

// 默认节点配置 - 暂时注释，后面再用
// const initialNodes: RFNode[] = [
//   {
//     id: 'prompt-1',
//     type: 'textPrompt',
//     position: { x: 50, y: 200 },
//     data: {
//       text: '画一只猫'
//     },
//   },
//   {
//     id: 'generate-1',
//     type: 'generate',
//     position: { x: 350, y: 150 },
//     data: {
//       status: 'idle'
//     },
//   },
//   {
//     id: 'image-1',
//     type: 'image',
//     position: { x: 650, y: 200 },
//     data: {
//       label: 'Image'
//     },
//   },
// ];

// 默认连线配置 - 暂时注释，后面再用
// const initialEdges: Edge[] = [
//   {
//     id: 'prompt-generate',
//     source: 'prompt-1',
//     target: 'generate-1',
//     sourceHandle: 'text',
//     targetHandle: 'text',
//     type: 'default',
//   },
//   {
//     id: 'generate-image',
//     source: 'generate-1',
//     target: 'image-1',
//     sourceHandle: 'img',
//     targetHandle: 'img',
//     type: 'default',
//   },
// ];

function FlowInner() {
  const { lt, isZh } = useLocaleText();
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodesRef = React.useRef<RFNode[]>([]);
  const edgesRef = React.useRef<Edge[]>([]);
  React.useEffect(() => {
    nodesRef.current = nodes as RFNode[];
  }, [nodes]);
  React.useEffect(() => {
    edgesRef.current = edges as Edge[];
  }, [edges]);
  // Alt+拖拽复制相关状态（在 onNodesChange 中做位置重映射，让“副本在动、原节点不动”）
  const altDragStartRef = React.useRef<any>(null);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const imageSize = useAIChatStore((state) => state.imageSize);
  const globalWebSearchEnabled = useAIChatStore((state) => state.enableWebSearch);
  const chatTheme = useAIChatStore((state) => state.chatTheme);
  const isFlowBlackTheme = chatTheme === "black";
  const imageModel = React.useMemo(
    () => getImageModelForProvider(aiProvider),
    [aiProvider]
  );

  // 获取当前工具模式
  const drawMode = useToolStore((state) => state.drawMode);
  const isPointerMode = drawMode === "pointer";
  const isMarqueeMode = drawMode === "marquee";

  const addPersonalAsset = usePersonalLibraryStore((state) => state.addAsset);

  // 动态节点配置
  const [nodeConfigs, setNodeConfigs] = React.useState<NodeConfig[]>([]);
  React.useEffect(() => {
    fetchNodeConfigs().then(setNodeConfigs).catch(console.error);
  }, []);

  // VIP 会员状态
  const [membershipActive, setMembershipActive] = React.useState(false);
  const [seedance2AccessEnabled, setSeedance2AccessEnabled] = React.useState(false);
  const [seedance2AccessResolved, setSeedance2AccessResolved] = React.useState(false);
  React.useEffect(() => {
    import("@/services/adminApi").then(({ getMembershipCurrent }) => {
      getMembershipCurrent()
        .then((data) => {
          setMembershipActive(data?.entitlement?.membershipStatus === "active");
        })
        .catch(() => {
          setMembershipActive(false);
        });
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    import("@/services/adminApi")
      .then(({ getSeedance2Access }) => {
        getSeedance2Access()
          .then((data) => {
            setSeedance2AccessEnabled(data?.allowed === true);
            setSeedance2AccessResolved(true);
          })
          .catch(() => {
            setSeedance2AccessEnabled(false);
            setSeedance2AccessResolved(false);
          });
      })
      .catch(() => {
        setSeedance2AccessEnabled(false);
        setSeedance2AccessResolved(false);
      });
  }, []);

  // 管理端保存后：localStorage 仅其它标签页能收到 storage 事件；同窗口用 NODE_CONFIG_SYNC_DOM_EVENT
  React.useEffect(() => {
    const refetch = () => {
      fetchNodeConfigs({ force: true })
        .then(setNodeConfigs)
        .catch(console.error);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === NODE_CONFIG_SYNC_STORAGE_KEY && e.newValue != null) {
        refetch();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(NODE_CONFIG_SYNC_DOM_EVENT, refetch);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(NODE_CONFIG_SYNC_DOM_EVENT, refetch);
    };
  }, []);

  // 确保画布节点面板中的顺序：输入 → 图像 → 视频 → 其他
  const sortedNodeConfigs = React.useMemo(() => {
    if (!nodeConfigs || nodeConfigs.length === 0) return nodeConfigs;
    const categoryOrder: Record<string, number> = {
      input: 0,
      image: 1,
      video: 2,
      audio: 3,
      other: 4,
    };
    return [...nodeConfigs].sort((a, b) => {
      const ca = categoryOrder[a.category ?? "other"] ?? 99;
      const cb = categoryOrder[b.category ?? "other"] ?? 99;
      if (ca !== cb) return ca - cb;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
  }, [nodeConfigs]);

  const nodePaletteConfigs = React.useMemo(() => {
    const fallbackConfigs = NODE_PALETTE_ITEMS.map((item) => ({
      nodeKey: item.key,
      nameZh: item.zh,
      nameEn: item.en,
      category: item.category as "input" | "image" | "video" | "audio" | "other",
      status: (item.badge === "维护中" ? "maintenance" : "normal") as
        | "normal"
        | "maintenance"
        | "coming_soon"
        | "disabled",
      creditsPerCall: NODE_CREDITS_MAP[item.key] || 0,
      sortOrder: 0,
    }));

    const hasBackendConfigs = Boolean(sortedNodeConfigs && sortedNodeConfigs.length > 0);
    const base = hasBackendConfigs
      ? [...sortedNodeConfigs]
      : [...fallbackConfigs];
    const merged = [...base];

    if (hasBackendConfigs) {
      const existingNodeKeys = new Set(
        base
          .map((item) => item.nodeKey)
          .filter((key): key is string => Boolean(key))
      );

      for (const fallback of fallbackConfigs) {
        if (!fallback.nodeKey || existingNodeKeys.has(fallback.nodeKey)) continue;
        if (isModelBackedPaletteConfig(fallback)) continue;
        existingNodeKeys.add(fallback.nodeKey);
        merged.push(fallback);
      }
    }

    const prepared = merged
      .map((config) => {
        if (isBaseVideoInputPaletteConfig(config)) {
          return sanitizeBaseVideoInputPaletteConfig(config);
        }
        // 有后端配置时沿用后台名称，避免「节点管理」改名后面板仍被写死覆盖
        if (!hasBackendConfigs && config.nodeKey === "generatePro") {
          return {
            ...config,
            nameZh: "自定义节点",
            nameEn: "Agent",
          };
        }
        if (!hasBackendConfigs && config.nodeKey === "textNote") {
          return {
            ...config,
            nameEn: "Note Node",
          };
        }
        return config;
      })
      .filter((config) => !BETA_NODE_KEYS.has(config.nodeKey))
      .filter((config) => {
        const resolvedType = resolveFlowNodeTypeFromConfig(config);
        if (isManagedPaletteConfig(config)) {
          return true;
        }
        return !isHiddenFlowNodeType(resolvedType);
      })
      .filter((config) => config.status !== "disabled");

    const dedupedByType = new Map<string, NodeConfig>();
    prepared.forEach((config, index) => {
      const resolvedType = resolveFlowNodeTypeFromConfig(config);
      const normalizedType = normalizeFlowNodeType(resolvedType);
      const dedupeKey = normalizedType || resolvedType || config.nodeKey || `unknown-${index}`;
      const unifiedTitle = normalizedType ? UNIFIED_VIDEO_NODE_TITLES[normalizedType] : undefined;
      const normalizedConfig: NodeConfig =
        normalizedType || unifiedTitle
          ? {
              ...config,
              nodeKey: normalizedType || config.nodeKey,
              nameZh: unifiedTitle?.nameZh || config.nameZh,
              nameEn: unifiedTitle?.nameEn || config.nameEn,
            }
          : config;

      const existing = dedupedByType.get(dedupeKey);
      if (!existing) {
        dedupedByType.set(dedupeKey, normalizedConfig);
        return;
      }
      dedupedByType.set(
        dedupeKey,
        mergeNodePaletteConfig(existing, normalizedConfig, normalizedType || resolvedType)
      );
    });

    return Array.from(dedupedByType.values());
  }, [sortedNodeConfigs]);

  const nodeCreditsByType = React.useMemo(() => {
    const map = new Map<string, number>();
    nodePaletteConfigs.forEach((config) => {
      const resolvedType = resolveFlowNodeTypeFromConfig(config);
      const creditsPerCall = resolveNodeConfigCreditsPerCall(config);
      if (!resolvedType || !Number.isFinite(creditsPerCall)) return;
      map.set(resolvedType, creditsPerCall);
    });
    return map;
  }, [nodePaletteConfigs]);

  const managedRuntimeByType = React.useMemo(() => {
    const map = new Map<
      string,
      {
        nodeConfigKey?: string;
        managedModelKey?: string;
        vendorKey?: string;
        platformKey?: string;
        nodeConfigMetadata?: Record<string, any>;
      }
    >();

    nodePaletteConfigs.forEach((config) => {
      const resolvedType = resolveFlowNodeTypeFromConfig(config);
      if (!resolvedType) return;
      const metadata =
        config.metadata && typeof config.metadata === "object"
          ? (config.metadata as Record<string, any>)
          : undefined;
      if (!metadata) return;

      const preferredRoute = getManagedRouteOption(metadata);
      map.set(resolvedType, {
        nodeConfigKey: config.nodeKey,
        managedModelKey:
          typeof metadata.managedModelKey === "string" && metadata.managedModelKey.trim()
            ? metadata.managedModelKey.trim()
            : undefined,
        vendorKey: preferredRoute?.vendorKey,
        platformKey: preferredRoute?.platformKey || preferredRoute?.vendorKey,
        nodeConfigMetadata: metadata,
      });
    });

    return map;
  }, [nodePaletteConfigs]);

  const groupedNodePaletteConfigs = React.useMemo(() => {
    const grouped: Record<
      NodePanelGroupKey,
      Array<NodeConfig & { _index: number; _inactive: number }>
    > = {
      text: [],
      image: [],
      three: [],
      other: [],
      video: [],
      audio: [],
    };

    nodePaletteConfigs.forEach((config, index) => {
      const groupKey = getNodePaletteGroupKey(config);
      const inactive =
        config.status === "maintenance" || config.status === "coming_soon"
          ? 1
          : 0;
      grouped[groupKey].push({ ...config, _index: index, _inactive: inactive });
    });

    return NODE_PANEL_GROUP_ORDER
      .map((groupKey) => {
        const items = grouped[groupKey]
          .sort((a, b) => {
            if (a._inactive !== b._inactive) return a._inactive - b._inactive;
            return a._index - b._index;
          })
          .map(({ _index: _ignoredIndex, _inactive: _ignoredInactive, ...item }) => item);

        if (items.length === 0) return null;

        return {
          key: groupKey,
          title: lt(
            NODE_PANEL_GROUP_META[groupKey].titleZh,
            NODE_PANEL_GROUP_META[groupKey].titleEn
          ),
          subtitle: lt(
            NODE_PANEL_GROUP_META[groupKey].subtitleZh,
            NODE_PANEL_GROUP_META[groupKey].subtitleEn
          ),
          items,
        };
      })
      .filter(Boolean);
  }, [lt, nodePaletteConfigs]);

  const snapAlignmentEnabled = useUIStore((s) => s.snapAlignmentEnabled);
  const isLargeGraphForSnapAlignment =
    nodes.length >= FLOW_AUTO_DISABLE_SNAP_NODE_THRESHOLD ||
    edges.length >= FLOW_AUTO_DISABLE_SNAP_EDGE_THRESHOLD;
  const effectiveSnapAlignmentEnabled =
    snapAlignmentEnabled && !isLargeGraphForSnapAlignment;
  const [flowSnapAlignments, setFlowSnapAlignments] = React.useState<
    AlignmentLine[]
  >([]);
  const flowSnapTargetsRef = React.useRef<ObjectBounds[]>([]);
  const flowDragAnchorNodeIdRef = React.useRef<string | null>(null);
  const flowDragAnchorSizeRef = React.useRef<{
    width: number;
    height: number;
  } | null>(null);
  const flowSnapSignatureRef = React.useRef<string>("");

  const updateFlowSnapAlignments = React.useCallback(
    (alignments: AlignmentLine[]) => {
      const next = Array.isArray(alignments) ? alignments : [];
      if (
        !FLOW_RENDER_SNAP_GUIDES_WHILE_DRAGGING &&
        nodeDraggingRef.current &&
        next.length > 0
      ) {
        return;
      }
      const signature = buildAlignmentSignature(next);
      if (signature === flowSnapSignatureRef.current) return;
      flowSnapSignatureRef.current = signature;
      setFlowSnapAlignments(next);
    },
    []
  );

  const clearFlowSnapState = React.useCallback(() => {
    flowSnapTargetsRef.current = [];
    flowDragAnchorNodeIdRef.current = null;
    flowDragAnchorSizeRef.current = null;
    updateFlowSnapAlignments([]);
  }, [updateFlowSnapAlignments]);

  const prepareFlowSnapping = React.useCallback(
    (draggingNodes: RFNode[], anchorNodeId?: string) => {
      flowDragAnchorNodeIdRef.current =
        typeof anchorNodeId === "string" ? anchorNodeId : null;
      if (!effectiveSnapAlignmentEnabled) {
        flowSnapTargetsRef.current = [];
        flowDragAnchorSizeRef.current = null;
        updateFlowSnapAlignments([]);
        return;
      }
      const draggingIdSet = new Set(
        (draggingNodes || []).map((node) => String(node?.id || "")).filter(Boolean)
      );
      (draggingNodes || []).forEach((node) => {
        if (!isGroupNode(node)) return;
        getGroupChildIds(node).forEach((childId) => draggingIdSet.add(String(childId)));
      });
      const allNodes = (rfRef.current.getNodes?.() || []) as RFNode[];
      const anchorId = flowDragAnchorNodeIdRef.current;
      const anchorNode =
        (anchorId
          ? (draggingNodes || []).find(
              (node) => String(node?.id || "") === anchorId
            )
          : null) ||
        (draggingNodes || [])[0] ||
        (anchorId
          ? allNodes.find((node) => String(node.id) === anchorId)
          : undefined);
      if (anchorNode) {
        const { width, height } = getNodeRenderSize(anchorNode);
        flowDragAnchorSizeRef.current = { width, height };
      } else {
        flowDragAnchorSizeRef.current = null;
      }
      flowSnapTargetsRef.current = allNodes
        .filter((node) => !draggingIdSet.has(String(node.id)))
        .map((node) => toFlowSnapBounds(node))
        .filter((item): item is ObjectBounds => Boolean(item));
      updateFlowSnapAlignments([]);
    },
    [effectiveSnapAlignmentEnabled, updateFlowSnapAlignments]
  );

  const applyFlowSnappingToChanges = React.useCallback(
    (changes: any[]) => {
      if (!Array.isArray(changes) || changes.length === 0) return changes;
      if (FLOW_DISABLE_SNAP_DURING_NODE_DRAG && nodeDraggingRef.current) {
        if (flowSnapSignatureRef.current) {
          updateFlowSnapAlignments([]);
        }
        return changes;
      }
      const hasDraggingPositionChange = changes.some(
        (change) => change?.type === "position" && change?.dragging
      );
      if (!hasDraggingPositionChange) {
        const hasDragStop = changes.some(
          (change) => change?.type === "position" && change?.dragging === false
        );
        if (hasDragStop) updateFlowSnapAlignments([]);
        return changes;
      }

      if (!effectiveSnapAlignmentEnabled || flowSnapTargetsRef.current.length === 0) {
        updateFlowSnapAlignments([]);
        return changes;
      }

      const draggingChanges = changes.filter(
        (change) =>
          change?.type === "position" &&
          change?.dragging &&
          change?.position &&
          Number.isFinite(Number(change.position.x)) &&
          Number.isFinite(Number(change.position.y))
      );
      if (draggingChanges.length === 0) {
        updateFlowSnapAlignments([]);
        return changes;
      }

      const anchorId = flowDragAnchorNodeIdRef.current;
      const anchorChange =
        (anchorId
          ? draggingChanges.find((change) => String(change.id) === anchorId)
          : null) || draggingChanges[0];
      if (!anchorChange) {
        updateFlowSnapAlignments([]);
        return changes;
      }

      let anchorSize = flowDragAnchorSizeRef.current;
      if (!anchorSize) {
        const currentNodes = (rfRef.current.getNodes?.() || []) as RFNode[];
        const anchorNode = currentNodes.find(
          (node) => String(node.id) === String(anchorChange.id)
        );
        if (anchorNode) {
          const { width, height } = getNodeRenderSize(anchorNode);
          anchorSize = { width, height };
          flowDragAnchorSizeRef.current = anchorSize;
        }
      }
      if (!anchorSize) {
        updateFlowSnapAlignments([]);
        return changes;
      }
      const draggingBounds: ObjectBounds = {
        id: String(anchorChange.id),
        x: Number(anchorChange.position.x),
        y: Number(anchorChange.position.y),
        width: anchorSize.width,
        height: anchorSize.height,
      };

      const viewportZoom = Number(rfRef.current.getViewport?.()?.zoom);
      const zoom =
        Number.isFinite(viewportZoom) && viewportZoom > 0
          ? viewportZoom
          : Number(useCanvasStore.getState().zoom || 1) || 1;
      const threshold = FLOW_SNAP_BASE_THRESHOLD / Math.max(zoom, 0.1);
      const result = detectAlignments(
        draggingBounds,
        flowSnapTargetsRef.current,
        threshold
      );
      if (FLOW_RENDER_SNAP_GUIDES_WHILE_DRAGGING || !nodeDraggingRef.current) {
        const alignments = deduplicateAlignments(result.alignments || []);
        updateFlowSnapAlignments(alignments);
      } else if (flowSnapSignatureRef.current) {
        updateFlowSnapAlignments([]);
      }

      const deltaX = Number(result?.snapDelta?.x || 0);
      const deltaY = Number(result?.snapDelta?.y || 0);
      if (Math.abs(deltaX) < 1e-6 && Math.abs(deltaY) < 1e-6) {
        return changes;
      }

      return changes.map((change) => {
        if (change?.type !== "position" || !change?.dragging) return change;
        const next = { ...change };
        if (
          next.position &&
          Number.isFinite(Number(next.position.x)) &&
          Number.isFinite(Number(next.position.y))
        ) {
          next.position = {
            x: Number(next.position.x) + deltaX,
            y: Number(next.position.y) + deltaY,
          };
        }
        if (
          next.positionAbsolute &&
          Number.isFinite(Number(next.positionAbsolute.x)) &&
          Number.isFinite(Number(next.positionAbsolute.y))
        ) {
          next.positionAbsolute = {
            x: Number(next.positionAbsolute.x) + deltaX,
            y: Number(next.positionAbsolute.y) + deltaY,
          };
        }
        return next;
      });
    },
    [effectiveSnapAlignmentEnabled, updateFlowSnapAlignments]
  );

  const onNodesChangeWithHistory = React.useCallback(
    (changes: any) => {
      let processedChanges = changes;
      const altState = altDragStartRef.current;
      const isAltDragCloning =
        !!altState?.altPressed &&
        !!altState?.cloned &&
        altState?.idMap instanceof Map;

      if (isAltDragCloning && Array.isArray(processedChanges)) {
        // ReactFlow 仍会尝试拖拽原节点；这里把“原节点的位置变化”重定向到副本，
        // 并把原节点强制回到起始位置，保证原有连线不被“带走”。
        const posChange =
          processedChanges.find(
            (c: any) =>
              c?.type === "position" &&
              c?.id === altState?.nodeId &&
              altState?.startPositions?.has?.(c.id)
          ) ||
          processedChanges.find(
            (c: any) =>
              c?.type === "position" && altState?.startPositions?.has?.(c.id)
          );

        if (posChange) {
          const base = altState.startPositions.get(posChange.id);
          const baseAbs = altState.startAbsPositions?.get?.(posChange.id);
          const hasPosition =
            typeof posChange.position !== "undefined" ||
            typeof posChange.positionAbsolute !== "undefined";
          if (!base) {
            onNodesChange(processedChanges);
            return;
          }

          // ReactFlow 在 dragStop 会再派发一次 position(dragging:false)，但不带 position/positionAbsolute；
          // 这里不要把 dx/dy 误算成 0 导致副本回弹，只更新 dragging 标记即可。
          const dx =
            typeof posChange.position !== "undefined"
              ? posChange.position.x - base.x
              : typeof posChange.positionAbsolute !== "undefined" && baseAbs
              ? posChange.positionAbsolute.x - baseAbs.x
              : 0;
          const dy =
            typeof posChange.position !== "undefined"
              ? posChange.position.y - base.y
              : typeof posChange.positionAbsolute !== "undefined" && baseAbs
              ? posChange.positionAbsolute.y - baseAbs.y
              : 0;
          const dragging = !!posChange.dragging;

          const remapped: any[] = [];
          // 先保留非 position 变更（如 select/dimensions/remove/add）
          for (const c of processedChanges) {
            if (c?.type !== "position") remapped.push(c);
          }

          // 对参与复制的所有节点应用相同 delta：副本移动，原节点回位
          for (const [origId, cloneId] of altState.idMap.entries()) {
            const startPos = altState.startPositions.get(origId);
            const startAbs = altState.startAbsPositions?.get?.(origId);
            if (!startPos) continue;
            const cloneChange: any = {
              id: cloneId,
              type: "position",
              dragging,
            };
            const origChange: any = {
              id: origId,
              type: "position",
              dragging: false,
            };

            if (hasPosition) {
              cloneChange.position = { x: startPos.x + dx, y: startPos.y + dy };
              origChange.position = { x: startPos.x, y: startPos.y };

              if (startAbs) {
                cloneChange.positionAbsolute = {
                  x: startAbs.x + dx,
                  y: startAbs.y + dy,
                };
                origChange.positionAbsolute = { x: startAbs.x, y: startAbs.y };
              }
            }

            remapped.push(cloneChange);
            remapped.push(origChange);
          }
          onNodesChange(remapped);
          // Alt+拖拽复制的历史提交由 onNodeDragStop 统一处理，避免重复 commit
          return;
        }
      }

      if (
        draggingGroupNodeRef.current &&
        Array.isArray(processedChanges) &&
        processedChanges.length > 0
      ) {
        try {
          const currentNodes = (rfRef.current.getNodes?.() || []) as RFNode[];
          if (currentNodes.length) {
            const nodeMap = new Map(currentNodes.map((node) => [node.id, node]));
            const extraPositionChanges: any[] = [];
            const changedIds = new Set(
              processedChanges
                .filter((change: any) => change?.type === "position")
                .map((change: any) => String(change?.id || ""))
                .filter(Boolean)
            );

            for (const change of processedChanges) {
              if (change?.type !== "position") continue;
              const groupNode = nodeMap.get(change.id);
              if (!isGroupNode(groupNode)) continue;

              const nextX = Number(change?.position?.x);
              const nextY = Number(change?.position?.y);
              if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) continue;

              const prevX = Number(groupNode.position?.x ?? 0);
              const prevY = Number(groupNode.position?.y ?? 0);
              const dx = nextX - prevX;
              const dy = nextY - prevY;
              if (!dx && !dy) continue;

              const childIds = getGroupChildIds(groupNode);
              childIds.forEach((childId) => {
                if (changedIds.has(childId)) return;
                const childNode = nodeMap.get(childId);
                if (!childNode || isGroupNode(childNode)) return;
                const childX = Number(childNode.position?.x ?? 0);
                const childY = Number(childNode.position?.y ?? 0);
                extraPositionChanges.push({
                  id: childId,
                  type: "position",
                  position: { x: childX + dx, y: childY + dy },
                  dragging: change?.dragging,
                });
              });
            }

            if (extraPositionChanges.length > 0) {
              processedChanges = processedChanges.concat(extraPositionChanges);
            }
          }
        } catch {}
      }

      processedChanges = applyFlowSnappingToChanges(processedChanges);

      onNodesChange(processedChanges);
      try {
        const needCommit =
          Array.isArray(processedChanges) &&
          processedChanges.some(
            (c: any) =>
              (c?.type === "position" && c?.dragging === false) ||
              c?.type === "remove" ||
              c?.type === "add" ||
              c?.type === "dimensions"
          );
        if (needCommit)
          historyService.commit("flow-nodes-change").catch(() => {});
      } catch {}
    },
    [applyFlowSnappingToChanges, onNodesChange]
  );

  const rf = useReactFlow();
  const rfRef = React.useRef(rf);
  React.useEffect(() => {
    rfRef.current = rf;
  }, [rf]);
  React.useEffect(() => {
    if (!effectiveSnapAlignmentEnabled) {
      clearFlowSnapState();
    }
  }, [clearFlowSnapState, effectiveSnapAlignmentEnabled]);
  React.useEffect(() => () => clearFlowSnapState(), [clearFlowSnapState]);

  const normalizeGroupNodes = React.useCallback((inputNodes: RFNode[]) => {
    if (!Array.isArray(inputNodes) || inputNodes.length === 0) {
      return { changed: false, nodes: inputNodes };
    }

    const nodeMap = new Map(inputNodes.map((node) => [node.id, node]));
    const claimedChildIds = new Set<string>();
    let changed = false;

    const normalized = inputNodes
      .map((node) => {
        if (!isGroupNode(node)) return node;

        const originalChildIds = getGroupChildIds(node);
        const filteredChildIds: string[] = [];
        for (const childId of originalChildIds) {
          const child = nodeMap.get(childId);
          if (!child || isGroupNode(child)) continue;
          if (claimedChildIds.has(childId)) {
            changed = true;
            continue;
          }
          claimedChildIds.add(childId);
          filteredChildIds.push(childId);
        }

        if (filteredChildIds.length === 0) {
          changed = true;
          return null;
        }

        const bounds = computeGroupBounds(inputNodes, filteredChildIds);
        if (!bounds) {
          changed = true;
          return null;
        }

        const collapsed = isGroupCollapsed(node);
        const prevExpandedBounds = normalizeGroupBounds(
          (node as any)?.data?.expandedBounds
        );
        const expandedBounds = bounds;
        const resolvedExpandedBounds = expandedBounds || prevExpandedBounds;

        const currentColor =
          typeof node.data?.groupColor === "string" &&
          node.data.groupColor.trim().length > 0
            ? node.data.groupColor
            : FLOW_GROUP_DEFAULT_COLOR;

        const currentName =
          typeof node.data?.groupName === "string" &&
          node.data.groupName.trim().length > 0
            ? node.data.groupName
            : "新建分组";

        const sameChildren =
          originalChildIds.length === filteredChildIds.length &&
          originalChildIds.every((id, index) => id === filteredChildIds[index]);
        const styleW = Number((node as any)?.style?.width);
        const styleH = Number((node as any)?.style?.height);
        const targetX = collapsed
          ? Number.isFinite(Number(node.position?.x))
            ? Number(node.position?.x)
            : resolvedExpandedBounds?.x ?? 0
          : bounds.x;
        const targetY = collapsed
          ? Number.isFinite(Number(node.position?.y))
            ? Number(node.position?.y)
            : resolvedExpandedBounds?.y ?? 0
          : bounds.y;
        const targetWidth = collapsed
          ? FLOW_GROUP_COLLAPSED_WIDTH
          : bounds.width;
        const targetHeight = collapsed
          ? FLOW_GROUP_COLLAPSED_HEIGHT
          : bounds.height;
        const samePosition =
          Math.abs((node.position?.x ?? 0) - targetX) < 0.1 &&
          Math.abs((node.position?.y ?? 0) - targetY) < 0.1;
        const sameSize =
          Math.abs((Number.isFinite(styleW) ? styleW : 0) - targetWidth) < 0.1 &&
          Math.abs((Number.isFinite(styleH) ? styleH : 0) - targetHeight) < 0.1;
        const sameColor = node.data?.groupColor === currentColor;
        const sameName = node.data?.groupName === currentName;
        const sameCollapsed = Boolean(node.data?.collapsed) === collapsed;
        const sameExpandedBounds = areGroupBoundsEqual(
          prevExpandedBounds,
          resolvedExpandedBounds
        );

        if (
          sameChildren &&
          samePosition &&
          sameSize &&
          sameColor &&
          sameName &&
          sameCollapsed &&
          sameExpandedBounds
        ) {
          return node;
        }

        changed = true;
        return {
          ...node,
          position: { x: targetX, y: targetY },
          data: {
            ...(node.data || {}),
            groupName: currentName,
            groupColor: currentColor,
            childNodeIds: filteredChildIds,
            collapsed,
            expandedBounds: resolvedExpandedBounds,
          },
          style: {
            ...(node.style || {}),
            width: targetWidth,
            height: targetHeight,
            zIndex: -1,
          },
        } as RFNode;
      })
      .filter(Boolean) as RFNode[];

    return { changed, nodes: normalized };
  }, []);

  const groupNormalizeLockRef = React.useRef(false);
  React.useEffect(() => {
    if (groupNormalizeLockRef.current) {
      groupNormalizeLockRef.current = false;
      return;
    }
    const result = normalizeGroupNodes(nodes as RFNode[]);
    if (!result.changed) return;
    groupNormalizeLockRef.current = true;
    setNodes(result.nodes as any);
  }, [nodes, normalizeGroupNodes, setNodes]);

  const updateGroupNodeData = React.useCallback(
    (groupId: string, patch: Record<string, unknown>) => {
      let changed = false;
      setNodes((prev: any[]) =>
        prev.map((node) => {
          if (node.id !== groupId || !isGroupNode(node as RFNode)) return node;
          changed = true;
          return {
            ...node,
            data: { ...(node.data || {}), ...patch },
          };
        })
      );
      if (!changed) return;
      try {
        historyService.commit("flow-group-update").catch(() => {});
      } catch {}
    },
    [aiProvider, setNodes]
  );

  const toggleGroupCollapsed = React.useCallback(
    (groupId: string, nextCollapsed?: boolean) => {
      if (!groupId) return;

      const allNodes = (rf.getNodes?.() || []) as RFNode[];
      const groupNode = allNodes.find((node) => node.id === groupId);
      if (!groupNode || !isGroupNode(groupNode)) return;

      const collapsed =
        typeof nextCollapsed === "boolean"
          ? nextCollapsed
          : !isGroupCollapsed(groupNode);
      const childIds = getGroupChildIds(groupNode);
      const computedBounds = computeGroupBounds(allNodes, childIds);
      const fallbackBounds =
        normalizeGroupBounds((groupNode.data as any)?.expandedBounds) || {
          x: Number(groupNode.position?.x ?? 0),
          y: Number(groupNode.position?.y ?? 0),
          width: Math.max(
            FLOW_GROUP_MIN_WIDTH,
            Number((groupNode as any)?.style?.width || 0) || FLOW_GROUP_MIN_WIDTH
          ),
          height: Math.max(
            FLOW_GROUP_MIN_HEIGHT,
            Number((groupNode as any)?.style?.height || 0) ||
              FLOW_GROUP_MIN_HEIGHT
          ),
        };
      const expandedBounds = computedBounds || fallbackBounds;
      const childSet = new Set(childIds);

      let changed = false;
      setNodes((prev: any[]) =>
        prev.map((node) => {
          if (node.id === groupId && isGroupNode(node as RFNode)) {
            const prevCollapsed = isGroupCollapsed(node as RFNode);
            const prevExpandedBounds = normalizeGroupBounds(
              (node.data as any)?.expandedBounds
            );
            const sameCollapsed = prevCollapsed === collapsed;
            const sameExpandedBounds = areGroupBoundsEqual(
              prevExpandedBounds,
              expandedBounds
            );
            if (sameCollapsed && sameExpandedBounds) {
              return node;
            }
            changed = true;
            return {
              ...node,
              data: {
                ...(node.data || {}),
                collapsed,
                expandedBounds,
              },
            };
          }

          if (collapsed && childSet.has(node.id) && node.selected) {
            changed = true;
            return { ...node, selected: false };
          }

          return node;
        })
      );

      if (!changed) return;
      try {
        historyService
          .commit(collapsed ? "flow-group-collapse" : "flow-group-expand")
          .catch(() => {});
      } catch {}
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: collapsed ? "分组已折叠" : "分组已展开",
            type: "success",
          },
        })
      );
    },
    [rf, setNodes]
  );

  const dissolveGroups = React.useCallback(
    (groupIds: string[]) => {
      const ids = Array.from(
        new Set(groupIds.filter((id) => typeof id === "string" && id))
      );
      if (!ids.length) return false;

      const removeSet = new Set(ids);
      let changed = false;
      setNodes((prev: any[]) => {
        const releasedChildIds = new Set<string>();
        prev.forEach((node) => {
          if (!removeSet.has(node.id) || !isGroupNode(node as RFNode)) return;
          getGroupChildIds(node as RFNode).forEach((childId) =>
            releasedChildIds.add(String(childId))
          );
        });

        const next = prev
          .filter((node) => {
            if (!removeSet.has(node.id)) return true;
            changed = true;
            return false;
          })
          .map((node) => {
            const parentId =
              typeof (node as any).parentNode === "string"
                ? String((node as any).parentNode)
                : "";
            const shouldRelease =
              releasedChildIds.has(String(node.id)) ||
              (parentId && removeSet.has(parentId));
            if (!shouldRelease) return node;
            changed = true;
            const nextNode: any = {
              ...node,
              draggable: true,
              selectable: true,
            };
            delete nextNode.parentNode;
            delete nextNode.extent;
            return nextNode;
          });
        return next;
      });

      if (!changed) return false;
      try {
        historyService.commit("flow-group-dissolve").catch(() => {});
      } catch {}
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "已解组", type: "success" },
        })
      );
      return true;
    },
    [setNodes]
  );

  const getSelectedGroupIds = React.useCallback(
    (allNodes: RFNode[]) => {
      const selectedIds = new Set(
        allNodes
          .filter((node) => node.selected)
          .map((node) => String(node.id))
      );
      const directGroupIds = allNodes
        .filter((node) => node.selected && isGroupNode(node))
        .map((node) => node.id);
      if (directGroupIds.length) return directGroupIds;

      const inferred = allNodes
        .filter((node) => isGroupNode(node))
        .filter((group) =>
          getGroupChildIds(group).some((childId) => selectedIds.has(childId))
        )
        .map((group) => group.id);

      return inferred;
    },
    []
  );

  const createGroupFromSelection = React.useCallback(() => {
    const allNodes = (rf.getNodes?.() || []) as RFNode[];
    const selectedNodes = allNodes.filter(
      (node) => node.selected && !isGroupNode(node)
    );
    if (selectedNodes.length < 2) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "请先选择至少两个节点再打组", type: "warning" },
        })
      );
      return false;
    }

    const selectedIds = selectedNodes.map((node) => node.id);
    const bounds = computeGroupBounds(allNodes, selectedIds);
    if (!bounds) return false;

    const groupCount = allNodes.filter((node) => isGroupNode(node)).length;
    const groupId = generateId("group");
    const groupNode: RFNode = {
      id: groupId,
      type: FLOW_GROUP_NODE_TYPE,
      position: { x: bounds.x, y: bounds.y },
      data: {
        groupName: `分组 ${groupCount + 1}`,
        groupColor: FLOW_GROUP_DEFAULT_COLOR,
        childNodeIds: selectedIds,
        collapsed: false,
        expandedBounds: bounds,
      },
      selected: true,
      draggable: true,
      selectable: true,
      style: {
        width: bounds.width,
        height: bounds.height,
        zIndex: -1,
      },
    } as any;

    const selectedSet = new Set(selectedIds);
    let changed = false;
    setNodes((prev: any[]) => {
      const next = prev
        .map((node) => {
          if (!isGroupNode(node as RFNode)) {
            return { ...node, selected: false };
          }
          const childIds = getGroupChildIds(node as RFNode);
          const filtered = childIds.filter((id) => !selectedSet.has(id));
          if (filtered.length !== childIds.length) {
            changed = true;
            if (filtered.length === 0) {
              return null;
            }
            return {
              ...node,
              selected: false,
              data: { ...(node.data || {}), childNodeIds: filtered },
            };
          }
          return { ...node, selected: false };
        })
        .filter(Boolean) as RFNode[];

      changed = true;
      return [groupNode, ...next];
    });

    if (!changed) return false;
    try {
      historyService.commit("flow-group-create").catch(() => {});
    } catch {}
    window.dispatchEvent(
      new CustomEvent("toast", {
        detail: { message: "已创建分组", type: "success" },
      })
    );
    return true;
  }, [rf, setNodes]);

  const updateGroupName = React.useCallback(
    (groupId: string, nextName: string) => {
      const normalized = typeof nextName === "string" ? nextName.trim() : "";
      if (!normalized) return;
      const groupNode = (rf.getNode(groupId) || null) as RFNode | null;
      if (!groupNode || !isGroupNode(groupNode)) return;
      const currentName =
        (typeof groupNode.data?.groupName === "string" &&
          groupNode.data.groupName.trim()) ||
        "新建分组";
      if (normalized === currentName) return;
      updateGroupNodeData(groupId, { groupName: normalized });
    },
    [rf, updateGroupNodeData]
  );

  const promptGroupName = React.useCallback(
    (groupId: string) => {
      const groupNode = (rf.getNode(groupId) || null) as RFNode | null;
      if (!groupNode || !isGroupNode(groupNode)) return;
      const currentName =
        (typeof groupNode.data?.groupName === "string" &&
          groupNode.data.groupName.trim()) ||
        "新建分组";
      const nextName = window.prompt("请输入分组名称", currentName)?.trim();
      if (!nextName) return;
      updateGroupName(groupId, nextName);
    },
    [rf, updateGroupName]
  );

  const changeGroupColor = React.useCallback(
    (groupId: string, color: string) => {
      const normalized =
        typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color.trim())
          ? color.trim()
          : FLOW_GROUP_DEFAULT_COLOR;
      updateGroupNodeData(groupId, { groupColor: normalized });
    },
    [updateGroupNodeData]
  );

  const [runningGroupIds, setRunningGroupIds] = React.useState<string[]>([]);
  const [isGlobalRunning, setIsGlobalRunning] = React.useState(false);
  const globalRunStopRequestedRef = React.useRef(false);

  const onEdgesChangeWithHistory = React.useCallback(
    (changes: any) => {
      // 检查是否有 Kling O1 节点的视频连接被删除
      if (Array.isArray(changes)) {
        const removedEdges = changes.filter((c: any) => c?.type === "remove");
        for (const change of removedEdges) {
          const edgeId = change.id;
          const edge = edges.find((e) => e.id === edgeId);
          if (edge && edge.targetHandle === "video") {
            const targetNode = rfRef.current.getNode(edge.target);
            if (targetNode?.type === "klingO1Video") {
              // 检查是否还有其他视频连接
              const remainingVideoEdges = edges.filter(
                (e) =>
                  e.id !== edgeId &&
                  e.target === edge.target &&
                  e.targetHandle === "video"
              );
              if (remainingVideoEdges.length === 0) {
                setTimeout(() => {
                  setNodes((ns) =>
                    ns.map((n) =>
                      n.id === edge.target
                        ? { ...n, data: { ...n.data, hasVideoInput: false } }
                        : n
                    )
                  );
                }, 0);
              }
            }
          }
        }
      }
      onEdgesChange(changes);
      try {
        const needCommit =
          Array.isArray(changes) &&
          changes.some((c: any) => c?.type === "remove" || c?.type === "add");
        if (needCommit) {
          historyService.commit("flow-edges-change").catch(() => {});
          // 通知节点边已变化（用于刷新外部提示词预览等）
          // 使用 setTimeout 确保在状态更新后再触发
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("flow:edgesChange"));
          }, 0);
        }
      } catch {}
    },
    [onEdgesChange, edges, setNodes]
  );

  React.useEffect(() => {
    if (!edges.length) return;
    const sora2ModeById = new Map(
      nodes
        .filter((n) => n.type === "sora2Video")
        .map((n) => [n.id, getSora2GenerationType(n.data)])
    );
    if (!sora2ModeById.size) return;

    const shouldPrune = edges.some((e) => {
      const mode = sora2ModeById.get(e.target);
      if (!mode) return false;
      if (mode === "sora2-create-character") {
        return e.targetHandle !== "video";
      }
      return e.targetHandle === "video";
    });
    if (!shouldPrune) return;

    setEdges((prev) =>
      prev.filter((e) => {
        const mode = sora2ModeById.get(e.target);
        if (!mode) return true;
        if (mode === "sora2-create-character") {
          return e.targetHandle === "video";
        }
        return e.targetHandle !== "video";
      })
    );
  }, [edges, nodes, setEdges]);

  React.useEffect(() => {
    const sora2VideoNodeIds = nodes
      .filter((n) => n.type === "sora2Video")
      .map((n) => n.id);
    if (!sora2VideoNodeIds.length) return;
    const sora2VideoNodeIdSet = new Set(sora2VideoNodeIds);
    const connectedTargetIds = new Set(
      edges
        .filter(
          (e) =>
            e.targetHandle === "character" && sora2VideoNodeIdSet.has(e.target)
        )
        .map((e) => e.target)
    );

    setNodes((prev) => {
      let changed = false;
      const next = prev.map((node) => {
        if (node.type !== "sora2Video") return node;
        const nextConnected = connectedTargetIds.has(node.id);
        const currentConnected =
          Boolean((node.data as any)?.hasCharacterConnection);
        if (currentConnected === nextConnected) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            hasCharacterConnection: nextConnected,
          },
        };
      });
      return changed ? next : prev;
    });
  }, [edges, nodes, setNodes]);

  React.useEffect(() => {
    if (!edges.length) return;
    const sora2CharacterNodeIds = new Set(
      nodes.filter((n) => n.type === "sora2Character").map((n) => n.id)
    );
    if (!sora2CharacterNodeIds.size) return;

    const hasInvalidIncomingEdge = edges.some(
      (e) => sora2CharacterNodeIds.has(e.target) && e.targetHandle !== "video"
    );
    if (!hasInvalidIncomingEdge) return;

    setEdges((prev) =>
      prev.filter(
        (e) =>
          !(sora2CharacterNodeIds.has(e.target) && e.targetHandle !== "video")
      )
    );
  }, [edges, nodes, setEdges]);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const connectAnchorRef = React.useRef<QuickConnectAnchor | null>(null);
  const connectQuickMenuRef = React.useRef<HTMLDivElement | null>(null);
  const connectQuickMenuVisibleRef = React.useRef(false);
  const connectHoverTimerRef = React.useRef<number | null>(null);
  const quickConnectUsageRef = React.useRef<
    Record<string, QuickConnectUsageEntry>
  >({});
  const connectHoverAnchorRef = React.useRef<{ x: number; y: number } | null>(
    null
  );
  const [connectQuickMenu, setConnectQuickMenu] = React.useState<{
    visible: boolean;
    screen: { x: number; y: number };
    world: { x: number; y: number };
    alignEdge: "left" | "right";
    options: QuickConnectMenuItem[];
  }>({
    visible: false,
    screen: { x: 0, y: 0 },
    world: { x: 0, y: 0 },
    alignEdge: "left",
    options: [],
  });
  const [connectQuickHoverKey, setConnectQuickHoverKey] = React.useState<
    string | null
  >(null);
  const clearConnectHoverTimer = React.useCallback(() => {
    if (connectHoverTimerRef.current !== null) {
      window.clearTimeout(connectHoverTimerRef.current);
      connectHoverTimerRef.current = null;
    }
  }, []);
  const closeConnectQuickMenu = React.useCallback(
    (options?: { resetSource?: boolean }) => {
      clearConnectHoverTimer();
      connectHoverAnchorRef.current = null;
      setConnectQuickHoverKey(null);
      setConnectQuickMenu((prev) =>
        prev.visible ? { ...prev, visible: false, options: [] } : prev
      );
      if (options?.resetSource) {
        connectAnchorRef.current = null;
      }
    },
    [clearConnectHoverTimer]
  );
  React.useEffect(() => {
    connectQuickMenuVisibleRef.current = connectQuickMenu.visible;
  }, [connectQuickMenu.visible]);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(QUICK_CONNECT_USAGE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, QuickConnectUsageEntry>;
      if (!parsed || typeof parsed !== "object") return;
      const cleaned: Record<string, QuickConnectUsageEntry> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        const count =
          typeof value?.count === "number" && Number.isFinite(value.count)
            ? Math.max(0, Math.floor(value.count))
            : 0;
        const lastUsedAt =
          typeof value?.lastUsedAt === "number" &&
          Number.isFinite(value.lastUsedAt)
            ? Math.max(0, Math.floor(value.lastUsedAt))
            : 0;
        if (!key || count <= 0) return;
        cleaned[key] = { count, lastUsedAt };
      });
      quickConnectUsageRef.current = cleaned;
    } catch {}
  }, []);
  const rankQuickConnectOptions = React.useCallback(
    (items: QuickConnectMenuItem[]): QuickConnectMenuItem[] => {
      if (items.length <= 1) return items.slice();
      return items
        .map((item, index) => {
          const key = getQuickConnectMenuItemKey(item);
          const usage = quickConnectUsageRef.current[key];
          return {
            item,
            index,
            count: usage?.count || 0,
            lastUsedAt: usage?.lastUsedAt || 0,
          };
        })
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
          return a.index - b.index;
        })
        .map((entry) => entry.item);
    },
    []
  );
  const pinQuickConnectBaseOption = React.useCallback(
    (
      items: QuickConnectMenuItem[],
      kind: QuickConnectSourceKind,
      direction: "forward" | "reverse"
    ): QuickConnectMenuItem[] => {
      if (items.length <= 1) return items.slice(0, QUICK_CONNECT_MAX_ITEMS);

      const basePreset = QUICK_CONNECT_BASE_PRESET[kind]?.[direction];
      if (!basePreset) return items.slice(0, QUICK_CONNECT_MAX_ITEMS);

      const baseType = normalizeFlowNodeType(basePreset.nodeType) || basePreset.nodeType;
      const baseKey = getQuickConnectMenuItemKey({
        nodeType: baseType,
        targetHandle: direction === "forward" ? basePreset.targetHandle : undefined,
        sourceHandle: direction === "reverse" ? basePreset.sourceHandle : undefined,
      });
      const baseItem = items.find(
        (entry) => getQuickConnectMenuItemKey(entry) === baseKey
      );
      if (!baseItem) return items.slice(0, QUICK_CONNECT_MAX_ITEMS);

      const ordered = [
        baseItem,
        ...items.filter((entry) => getQuickConnectMenuItemKey(entry) !== baseKey),
      ];
      return ordered.slice(0, QUICK_CONNECT_MAX_ITEMS);
    },
    []
  );
  const recordQuickConnectUsage = React.useCallback((item: QuickConnectMenuItem) => {
    const key = getQuickConnectMenuItemKey(item);
    const current = quickConnectUsageRef.current[key];
    const next: QuickConnectUsageEntry = {
      count: Math.min((current?.count || 0) + 1, 9999),
      lastUsedAt: Date.now(),
    };
    quickConnectUsageRef.current = {
      ...quickConnectUsageRef.current,
      [key]: next,
    };
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        QUICK_CONNECT_USAGE_STORAGE_KEY,
        JSON.stringify(quickConnectUsageRef.current)
      );
    } catch {}
  }, []);
  const [edgeLabelEditor, setEdgeLabelEditor] =
    React.useState<EdgeLabelEditorState>(() => createEdgeLabelEditorState());
  const edgeLabelInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (edgeLabelEditor.visible) {
      const id = window.setTimeout(() => edgeLabelInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [edgeLabelEditor.visible]);

  React.useEffect(() => {
    if (!edgeLabelEditor.visible || !edgeLabelEditor.edgeId) return;
    if (!edges.some((edge) => edge.id === edgeLabelEditor.edgeId)) {
      setEdgeLabelEditor(createEdgeLabelEditorState());
    }
  }, [edges, edgeLabelEditor.visible, edgeLabelEditor.edgeId]);
  // 统一画板：节点橡皮已禁用

  // —— 项目内容（文件）中的 Flow 图谱持久化 ——
  const projectId = useProjectContentStore((s) => s.projectId);
  const hydrated = useProjectContentStore((s) => s.hydrated);
  const contentFlow = useProjectContentStore((s) => s.content?.flow);
  const prevProjectIdRef = React.useRef<string | null>(null);
  const hasHydratedFlowRef = React.useRef(false);
  const updateProjectPartial = useProjectContentStore((s) => s.updatePartial);
  const hydratingFromStoreRef = React.useRef(false);
  const lastSyncedJSONRef = React.useRef<string | null>(null);
  const nodeDraggingRef = React.useRef(false);
  const draggingGroupNodeRef = React.useRef(false);
  const [isNodeDragging, setIsNodeDragging] = React.useState(false);
  const commitTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (isNodeDragging) {
      document.body.classList.add("tanva-flow-node-dragging");
      document.body.classList.add("tanva-no-select");
    } else {
      document.body.classList.remove("tanva-flow-node-dragging");
      document.body.classList.remove("tanva-no-select");
    }
    return () => {
      document.body.classList.remove("tanva-flow-node-dragging");
      document.body.classList.remove("tanva-no-select");
    };
  }, [isNodeDragging]);

  const getFlowSnapshotSignature = React.useCallback(
    (nodesSnapshot: any, edgesSnapshot: any): string | null => {
      try {
        return JSON.stringify(
          { n: nodesSnapshot, e: edgesSnapshot },
          (_key, value) => {
            if (typeof value === "function") return undefined;
            if (typeof value === "string" && value.length > 1024) {
              const head = value.slice(0, 64);
              const tail = value.slice(-64);
              return `__trim_len=${value.length}__${head}__${tail}`;
            }
            return value;
          }
        );
      } catch {
        return null;
      }
    },
    []
  );

  const sanitizeNodeData = React.useCallback(
    (input: any, options?: { preserveImagePayload?: boolean }) => {
      const preserveImagePayload = options?.preserveImagePayload === true;
      const BASE64_IMAGE_MAGIC_PREFIXES = [
        "iVBORw0KGgo", // png
        "/9j/", // jpeg
        "R0lGOD", // gif
        "UklGR", // webp
        "PHN2Zy", // svg
      ];

      const looksLikeBase64 = (value: string): boolean => {
        const compact = value.replace(/\s+/g, "");
        if (compact.length < 4096) return false;
        if (compact.length % 4 !== 0) return false;
        return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
      };

      const shouldDropPersistedString = (value: string): boolean => {
        if (preserveImagePayload) return false;
        const trimmed = value?.trim?.() || "";
        if (!trimmed) return false;
        if (/^data:/i.test(trimmed)) return true;
        if (/^blob:/i.test(trimmed)) return true;
        if (
          typeof FLOW_IMAGE_ASSET_PREFIX === "string" &&
          trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)
        ) {
          return true;
        }
        const compact = trimmed.replace(/\s+/g, "");
        if (
          BASE64_IMAGE_MAGIC_PREFIXES.some((p) => compact.startsWith(p)) &&
          compact.length >= 32
        ) {
          return true;
        }
        return looksLikeBase64(compact);
      };

      const seen = new WeakMap<object, any>();

      const walk = (value: any): any => {
        if (typeof value === "function") return undefined;
        if (!value || typeof value !== "object") {
          if (typeof value === "string" && shouldDropPersistedString(value))
            return undefined;
          return value;
        }

        // 兼容 JSON.stringify(Date) 的行为
        if (value instanceof Date) return value.toISOString();

        if (Array.isArray(value)) {
          const arr = new Array(value.length);
          for (let i = 0; i < value.length; i += 1) {
            arr[i] = walk(value[i]);
          }
          return arr;
        }

        const cached = seen.get(value as object);
        if (cached) return cached;

        const result: Record<string, any> = {};
        seen.set(value as object, result);
        Object.entries(value).forEach(([key, child]) => {
          if (typeof child === "function") return;
          const sanitized = walk(child);
          if (sanitized === undefined) return;
          result[key] = sanitized;
        });
        return result;
      };

      return walk(input);
    },
    []
  );

  const rfNodesToTplNodes = React.useCallback(
    (
      ns: RFNode[],
      options?: { preserveImagePayload?: boolean }
    ): ClipboardFlowNode[] => {
      return ns.map((n: any) => {
        const rawData = { ...(n.data || {}) } as any;
        delete rawData.onRun;
        delete rawData.onSend;
        const data = sanitizeNodeData(rawData, options);
        if (data) {
          delete data.status;
          delete data.error;
        }
        return {
          id: n.id,
          type: n.type || "default",
          position: { x: n.position.x, y: n.position.y },
          data,
          boxW: data?.boxW,
          boxH: data?.boxH,
          width: n.width,
          height: n.height,
          style: n.style ? { ...n.style } : undefined,
          parentNode: (n as any).parentNode,
          extent: (n as any).extent,
          selectable: (n as any).selectable,
          draggable: (n as any).draggable,
        } as ClipboardFlowNode;
      });
    },
    [sanitizeNodeData]
  );

  const rfEdgesToTplEdges = React.useCallback(
    (es: Edge[]): TemplateEdge[] =>
      es.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: normalizeFlowSourceHandle(e.sourceHandle),
        targetHandle: normalizeFlowTargetHandle(e.targetHandle),
        type: e.type || "default",
        label: typeof e.label === "string" ? e.label : undefined,
      })),
    []
  );

  const tplNodesToRfNodes = React.useCallback((ns: TemplateNode[]): RFNode[] => {
    const legacyChildrenByGroupId = new Map<string, string[]>();
    ns.forEach((node: any) => {
      const parentId =
        typeof node?.parentNode === "string" ? node.parentNode.trim() : "";
      if (!parentId) return;
      const list = legacyChildrenByGroupId.get(parentId) || [];
      list.push(String(node.id));
      legacyChildrenByGroupId.set(parentId, list);
    });

    return ns.map((n: any) => {
      const rawType = typeof n?.type === "string" ? n.type : "default";
      const type = normalizeFlowNodeType(rawType) || rawType;
      const isGroup = type === FLOW_GROUP_NODE_TYPE;
      const data: Record<string, any> = { ...(n?.data || {}) };

      if (type === "klingVideo") {
        const currentKlingModel = String(data.klingModel || "").trim();
        if (!currentKlingModel) {
          data.klingModel = rawType === "kling30Video" ? "kling-v3-0" : "kling-v2-6";
        } else if (currentKlingModel === "kling-v3-0") {
          data.klingModel = "kling-v3-0";
        } else {
          data.klingModel = "kling-v2-6";
        }
        if (data.mode !== "std" && data.mode !== "pro") {
          data.mode = "std";
        }
        if (!Array.isArray(data.audioUrls)) {
          data.audioUrls = [];
        }
        data.provider = "kling";
      }

      if (type === "viduVideo") {
        const fallbackViduModel = rawType === "viduQ3" ? "q3" : "q2";
        data.viduModel = normalizeViduModelValue(data.viduModel || fallbackViduModel);
        data.provider = getEffectiveViduProvider(data);
      }

      if (type === "doubaoVideo") {
        const currentSeedanceModel = String(data.seedanceModel || "").trim();
        const normalizedSeedanceModel = normalizeSeedanceModelValue(
          currentSeedanceModel ||
            (rawType === "seedance20Video" ? "seedance-2.0" : "seedance-1.5-pro")
        );
        data.seedanceModel =
          rawType === "seedance20Video" && normalizedSeedanceModel === "seedance-1.5-pro"
            ? "seedance-2.0"
            : normalizedSeedanceModel;
        data.provider = "doubao";
      }

      if (isGroup) {
        const explicitChildIds = Array.isArray(data.childNodeIds)
          ? data.childNodeIds.map((id: any) => String(id))
          : [];
        const legacyChildIds = legacyChildrenByGroupId.get(String(n.id)) || [];
        data.childNodeIds = Array.from(
          new Set(
            [...explicitChildIds, ...legacyChildIds].filter((id) => {
              const child = ns.find((x: any) => String(x.id) === String(id));
              return child && (child.type || "default") !== FLOW_GROUP_NODE_TYPE;
            })
          )
        );
      }

      return {
        id: n.id,
        type,
        position: { x: n.position.x, y: n.position.y },
        data,
        width: n.width,
        height: n.height,
        style: n.style ? { ...n.style } : undefined,
        // Legacy grouped JSON may carry parentNode/extent and false draggable flags.
        // Grouping in current implementation uses childNodeIds, so clear parent locks.
        parentNode: undefined,
        extent: undefined,
        selectable: true,
        draggable: true,
      } as any;
    }) as any;
  }, []);

  const tplEdgesToRfEdges = React.useCallback(
    (es: TemplateEdge[]): Edge[] =>
      es.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: normalizeFlowSourceHandle(e.sourceHandle),
        targetHandle: normalizeFlowTargetHandle(e.targetHandle),
        type: e.type || "default",
        label: e.label,
      })) as any,
    []
  );

  // Flow -> Canvas：将含有图片的节点转换为可在画板粘贴的剪贴板数据
  const buildCanvasClipboardFromFlowNodes = React.useCallback(
    (selected: RFNode[]) => {
      if (!Array.isArray(selected) || selected.length === 0) return null;

      const normalizeImageSource = (value?: string): string | null => {
        const trimmed = value?.trim();
        if (!trimmed) return null;
        if (
          /^data:/i.test(trimmed) ||
          /^blob:/i.test(trimmed) ||
          /^https?:\/\//i.test(trimmed)
        )
          return trimmed;
        return `data:image/png;base64,${trimmed}`;
      };

      const safeFileStem = (value: string): string =>
        value
          .trim()
          .replace(/[\\/:*?"<>|]+/g, "_")
          .slice(0, 80) || "image";

      const getNodeImageSources = (
        node: any
      ): Array<{
        source: string;
        fileName: string;
        contentType?: string;
        w?: number;
        h?: number;
      }> => {
        const data = (node?.data || {}) as any;
        const titleCandidate =
          data.imageName || data.label || data.title || node?.type || "flow";
        const baseName =
          typeof titleCandidate === "string"
            ? titleCandidate.trim()
            : String(titleCandidate || "flow");

        const preferredWRaw =
          (typeof data.boxW === "number" ? data.boxW : undefined) ??
          (typeof data.imageWidth === "number" ? data.imageWidth : undefined) ??
          undefined;
        const preferredHRaw =
          (typeof data.boxH === "number" ? data.boxH : undefined) ??
          (typeof data.imageWidth === "number"
            ? data.imageWidth * 0.75
            : undefined) ??
          undefined;

        const clamp = (n: number, min: number, max: number) =>
          Math.max(min, Math.min(max, n));
        const preferredW =
          typeof preferredWRaw === "number" &&
          Number.isFinite(preferredWRaw) &&
          preferredWRaw > 0
            ? clamp(preferredWRaw, 220, 1200)
            : 360;
        const preferredH =
          typeof preferredHRaw === "number" &&
          Number.isFinite(preferredHRaw) &&
          preferredHRaw > 0
            ? clamp(preferredHRaw, 160, 1200)
            : 270;

        // 多图节点（generate4 / generatePro4 / midjourneyV7 / niji7）
        if (
          node?.type === "generate4" ||
          node?.type === "generatePro4" ||
          node?.type === "midjourneyV7" ||
          node?.type === "niji7"
        ) {
          const imgs = Array.isArray(data.imageUrls)
            ? (data.imageUrls as string[])
            : Array.isArray(data.images)
            ? (data.images as string[])
            : [];
          return imgs
            .map((img, idx) => {
              const source = normalizeImageSource(img);
              if (!source) return null;
              return {
                source,
                fileName: `${safeFileStem(baseName)}_${node.id}_${idx + 1}.png`,
                contentType: "image/png",
                w: preferredW,
                h: preferredH,
              };
            })
            .filter(Boolean) as any;
        }

        const single = normalizeImageSource(
          typeof data.imageUrl === "string" && data.imageUrl.trim()
            ? data.imageUrl
            : data.imageData
        );
        if (!single) return [];
        return [
          {
            source: single,
            fileName: `${safeFileStem(baseName)}_${node.id}.png`,
            contentType: "image/png",
            w: preferredW,
            h: preferredH,
          },
        ];
      };

      const images: Array<{
        source: string;
        fileName: string;
        contentType?: string;
        w: number;
        h: number;
      }> = [];
      selected.forEach((node: any) => {
        try {
          const list = getNodeImageSources(node);
          list.forEach((item: any) => {
            if (item?.source)
              images.push({
                source: item.source,
                fileName: item.fileName,
                contentType: item.contentType,
                w: item.w || 360,
                h: item.h || 270,
              });
          });
        } catch {}
      });
      if (images.length === 0) return null;

      const center = (() => {
        try {
          const c = (paper?.view as any)?.center;
          if (c && Number.isFinite(c.x) && Number.isFinite(c.y))
            return { x: c.x, y: c.y };
        } catch {}
        return { x: 0, y: 0 };
      })();

      // 画板粘贴会额外偏移 (32, 32)，这里预先抵消以便默认落在视口中心附近
      const pasteOffset = { x: 32, y: 32 };
      const gap = 24;
      const cols = images.length >= 4 ? 2 : images.length;
      const rows = Math.ceil(images.length / cols);
      const cellW = Math.max(...images.map((x) => x.w || 0), 360);
      const cellH = Math.max(...images.map((x) => x.h || 0), 270);
      const totalW = cols * cellW + (cols - 1) * gap;
      const totalH = rows * cellH + (rows - 1) * gap;
      const startX = center.x - totalW / 2;
      const startY = center.y - totalH / 2;

      const now = Date.now();
      const snapshots = images.map((item, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellX = startX + col * (cellW + gap);
        const cellY = startY + row * (cellH + gap);
        const x = cellX + (cellW - item.w) / 2 - pasteOffset.x;
        const y = cellY + (cellH - item.h) / 2 - pasteOffset.y;
        const localDataUrl = /^data:/i.test(item.source)
          ? item.source
          : undefined;

        return {
          id: `flow_clip_img_${now}_${idx}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          url: item.source,
          src: item.source,
          fileName: item.fileName,
          width: item.w,
          height: item.h,
          contentType: item.contentType,
          localDataUrl,
          pendingUpload: false,
          bounds: { x, y, width: item.w, height: item.h },
          layerId: null,
        };
      });

      return {
        images: snapshots,
        models: [],
        texts: [],
        paths: [],
      };
    },
    []
  );

  const flowPasteKeepLinksRef = React.useRef(false);

  const handleCopyFlow = React.useCallback(() => {
    const allNodes = rf.getNodes();
    const selectedNodes = allNodes.filter((node: any) => node.selected);
    if (!selectedNodes.length) return false;

    // 同步一份“可粘贴到画板”的数据（仅对含图片节点生效）
    try {
      const canvasPayload = buildCanvasClipboardFromFlowNodes(
        selectedNodes as any
      );
      if (canvasPayload) clipboardService.setCanvasData(canvasPayload);
    } catch {}

    const nodeSnapshots = rfNodesToTplNodes(selectedNodes as any, {
      preserveImagePayload: true,
    });
    const selectedIds = new Set(selectedNodes.map((node: any) => node.id));
    const allEdges = rf.getEdges();
    const relatedEdges = allEdges
      .filter(
        (edge: any) =>
          selectedIds.has(edge.source) && selectedIds.has(edge.target)
      );
    const linkedEdges = allEdges.filter((edge: any) => {
      const sourceSelected = selectedIds.has(edge.source);
      const targetSelected = selectedIds.has(edge.target);
      return sourceSelected !== targetSelected;
    });
    const edgeSnapshots = rfEdgesToTplEdges(relatedEdges);
    const linkedEdgeSnapshots = rfEdgesToTplEdges(linkedEdges);

    const minX = Math.min(
      ...selectedNodes.map((node: any) => node.position?.x ?? 0)
    );
    const minY = Math.min(
      ...selectedNodes.map((node: any) => node.position?.y ?? 0)
    );

    clipboardService.setFlowData({
      nodes: nodeSnapshots,
      edges: edgeSnapshots,
      linkedEdges: linkedEdgeSnapshots,
      origin: { x: minX, y: minY },
    });
    return true;
  }, [
    rf,
    rfNodesToTplNodes,
    rfEdgesToTplEdges,
    buildCanvasClipboardFromFlowNodes,
  ]);

  const handlePasteFlow = React.useCallback((options?: { preserveLinkedEdges?: boolean }) => {
    const payload = clipboardService.getFlowData();
    if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0)
      return false;
    const preserveLinkedEdges = options?.preserveLinkedEdges === true;

    const OFFSET = 40;
    const idMap = new Map<string, string>();
    payload.nodes.forEach((node) => {
      idMap.set(node.id, generateId(node.type || "n"));
    });
    const existingNodeIds = new Set(
      (rf.getNodes?.() || []).map((node: any) => String(node.id))
    );

    const legacyChildrenByGroupOldId = new Map<string, string[]>();
    payload.nodes.forEach((node: any) => {
      const parentId =
        typeof node?.parentNode === "string" ? node.parentNode.trim() : "";
      if (!parentId) return;
      const list = legacyChildrenByGroupOldId.get(parentId) || [];
      list.push(String(node.id));
      legacyChildrenByGroupOldId.set(parentId, list);
    });

    const newNodes = payload.nodes.map((node) => {
      const newId = idMap.get(node.id) || generateId(node.type || "n");
      const data: any = sanitizeNodeData(node.data || {}, {
        preserveImagePayload: true,
      });
      if (node.type === FLOW_GROUP_NODE_TYPE) {
        const explicitChildren = Array.isArray(data?.childNodeIds)
          ? data.childNodeIds.map((childId: string) => idMap.get(childId) || null)
          : [];
        const legacyChildren = (legacyChildrenByGroupOldId.get(String(node.id)) || [])
          .map((childOldId: string) => idMap.get(childOldId) || null);
        data.childNodeIds = Array.from(
          new Set([...explicitChildren, ...legacyChildren].filter(Boolean))
        );
      }
      return {
        id: newId,
        type: node.type || "default",
        position: {
          x: node.position.x + OFFSET,
          y: node.position.y + OFFSET,
        },
        data,
        selected: true,
        width: node.width,
        height: node.height,
        style: node.style ? { ...node.style } : undefined,
        parentNode: undefined,
        extent: undefined,
        selectable: true,
        draggable: true,
      } as any;
    });

    if (!newNodes.length) return false;

    const edgeSnapshots = Array.isArray(payload.edges) ? payload.edges : [];
    const linkedEdgeSnapshots =
      preserveLinkedEdges && Array.isArray((payload as any).linkedEdges)
        ? ((payload as any).linkedEdges as TemplateEdge[])
        : [];
    const mapEdgeSnapshot = (
      edge: TemplateEdge,
      allowExternalEndpoint: boolean
    ): Edge | null => {
      const mappedSource = idMap.get(edge.source);
      const mappedTarget = idMap.get(edge.target);
      const source = mappedSource ?? (allowExternalEndpoint ? edge.source : undefined);
      const target = mappedTarget ?? (allowExternalEndpoint ? edge.target : undefined);
      if (!source || !target) return null;
      if (!mappedSource && !existingNodeIds.has(String(source))) return null;
      if (!mappedTarget && !existingNodeIds.has(String(target))) return null;
      if (!mappedSource && !mappedTarget) return null;
      return {
        source,
        target,
        sourceHandle: normalizeFlowSourceHandle(edge.sourceHandle),
        targetHandle: normalizeFlowTargetHandle(edge.targetHandle),
        type: edge.type || "default",
        label: edge.label,
      } as Edge;
    };
    const dedupeKeys = new Set<string>();
    const newEdges = [
      ...edgeSnapshots.map((edge) => mapEdgeSnapshot(edge, false)),
      ...linkedEdgeSnapshots.map((edge) => mapEdgeSnapshot(edge, true)),
    ]
      .filter(Boolean)
      .filter((edge) => {
        const key = [
          edge.source,
          edge.target,
          edge.sourceHandle || "",
          edge.targetHandle || "",
          edge.type || "default",
          typeof edge.label === "string" ? edge.label : "",
        ].join("|");
        if (dedupeKeys.has(key)) return false;
        dedupeKeys.add(key);
        return true;
      })
      .map((edge) => {
        return {
          ...edge,
          id: generateId("e"),
        } as any;
      })
      .filter(Boolean) as Edge[];

    setNodes((prev: any[]) =>
      prev.map((node) => ({ ...node, selected: false })).concat(newNodes)
    );
    if (newEdges.length) {
      setEdges((prev: any[]) => prev.concat(newEdges));
    }

    try {
      historyService.commit("flow-paste").catch(() => {});
    } catch {}
    return true;
  }, [sanitizeNodeData, setEdges, setNodes, rf]);

  // Flow 复制：写入系统剪贴板（覆盖系统截图内容），以便粘贴时能优先恢复节点而非图片
  React.useEffect(() => {
    const handleCopyEvent = (event: ClipboardEvent) => {
      try {
        const active = document.activeElement as Element | null;
        const tagName = active?.tagName?.toLowerCase();
        const isEditable =
          !!active &&
          (tagName === "input" ||
            tagName === "textarea" ||
            (active as any).isContentEditable);
        if (isEditable) return;

        const selection = window.getSelection();
        const selectedText = selection?.toString()?.trim();
        if (selectedText) {
          const nodes = [selection?.anchorNode, selection?.focusNode].filter(
            Boolean
          ) as Node[];
          const fromFlowSelection = nodes.some((node) => {
            const el =
              node instanceof Element ? node : node.parentElement ?? null;
            return !!el?.closest?.(".tanva-flow-overlay");
          });
          if (!fromFlowSelection) return;
        }

        // 仅在 Flow 区域或当前 zone 为 Flow 时接管 copy，避免影响画布复制
        const path =
          typeof event.composedPath === "function" ? event.composedPath() : [];
        const fromFlowOverlay = path.some(
          (el) =>
            el instanceof Element &&
            el.classList?.contains("tanva-flow-overlay")
        );
        const zone = clipboardService.getZone();
        if (zone !== "flow" && !fromFlowOverlay) return;

        const handled = handleCopyFlow();
        if (!handled) return;

        const payload = clipboardService.getFlowData();
        if (!payload) return;

        const serialized = JSON.stringify({
          type: FLOW_CLIPBOARD_TYPE,
          version: 1,
          data: payload,
        });

        if (event.clipboardData) {
          event.clipboardData.setData(FLOW_CLIPBOARD_MIME, serialized);
          event.clipboardData.setData("application/json", serialized);
          event.clipboardData.setData(
            "text/plain",
            FLOW_CLIPBOARD_FALLBACK_TEXT
          );
          event.preventDefault();
        } else if (
          typeof navigator !== "undefined" &&
          navigator.clipboard?.writeText
        ) {
          void navigator.clipboard.writeText(serialized).catch(() => {});
        }
      } catch (error) {
        console.warn("复制 Flow 到系统剪贴板失败", error);
      }
    };

    window.addEventListener("copy", handleCopyEvent);
    return () => window.removeEventListener("copy", handleCopyEvent);
  }, [handleCopyFlow]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const isCopy =
        (event.key === "c" || event.key === "C") &&
        (event.metaKey || event.ctrlKey);
      const isPaste =
        (event.key === "v" || event.key === "V") &&
        (event.metaKey || event.ctrlKey);
      if (!isCopy && !isPaste) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        (tagName === "input" ||
          tagName === "textarea" ||
          (active as any).isContentEditable);
      if (isEditable) return;

      const anySelected = rf.getNodes().some((n: any) => n.selected);
      const canPasteFlow = !!clipboardService.getFlowData();
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const fromFlowOverlay = path.some(
        (el) =>
          el instanceof Element && el.classList?.contains("tanva-flow-overlay")
      );
      const currentZone = clipboardService.getZone();

      if (isCopy) {
        if (!anySelected) return;
        if (currentZone === "canvas" && !fromFlowOverlay) return;
        clipboardService.setActiveZone("flow");
        // 让浏览器触发原生 copy 事件（由上面的 copy 监听器写入系统剪贴板）
        handleCopyFlow();
        return;
      }

      if (isPaste) {
        // 仅在 Flow 区域或当前 zone 为 Flow 时切换，避免抢占画布粘贴图片
        if (
          fromFlowOverlay ||
          currentZone === "flow" ||
          (anySelected && currentZone !== "canvas") ||
          (canPasteFlow && currentZone !== "canvas")
        ) {
          clipboardService.setActiveZone("flow");
        } else {
          flowPasteKeepLinksRef.current = false;
          return;
        }
        flowPasteKeepLinksRef.current = !!event.shiftKey;
        // 某些浏览器下 Ctrl/Cmd+Shift+V 可能不会稳定触发 paste 事件。
        // 当 Flow 内部剪贴板已有数据时，直接走一次保留连线粘贴，避免“按键无响应”。
        if (event.shiftKey && canPasteFlow) {
          const handled = handlePasteFlow({ preserveLinkedEdges: true });
          if (handled) {
            flowPasteKeepLinksRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
        // 粘贴逻辑改为在 clipboard/paste 事件中处理，以便检测剪贴板里是否有图片
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCopyFlow, handlePasteFlow]);

  React.useEffect(() => {
    const handleGroupHotkey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event as any).isComposing) return;
      const key = String(event.key || "");
      const isGroupKey = key.toLowerCase() === "g" || event.code === "KeyG";
      if (!isGroupKey) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        (tagName === "input" ||
          tagName === "textarea" ||
          (active as any).isContentEditable);
      if (isEditable) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        const allNodes = (rf.getNodes?.() || []) as RFNode[];
        const groupIds = getSelectedGroupIds(allNodes);
        if (!groupIds.length) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "请先选中分组后再解组", type: "warning" },
            })
          );
          return;
        }
        dissolveGroups(groupIds);
        return;
      }

      createGroupFromSelection();
    };

    window.addEventListener("keydown", handleGroupHotkey, true);
    return () =>
      window.removeEventListener("keydown", handleGroupHotkey, true);
  }, [rf, createGroupFromSelection, dissolveGroups, getSelectedGroupIds]);

  // 只在剪贴板中没有图片/文件时才接管 Flow 的粘贴，避免阻止画布粘贴图片
  React.useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const preserveLinkedEdges = flowPasteKeepLinksRef.current || !!event.shiftKey;
      flowPasteKeepLinksRef.current = false;
      if (event.defaultPrevented) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        (tagName === "input" ||
          tagName === "textarea" ||
          (active as any).isContentEditable);
      if (isEditable) return;

      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const fromFlowOverlay = path.some(
        (el) =>
          el instanceof Element && el.classList?.contains("tanva-flow-overlay")
      );
      if (clipboardService.getZone() !== "flow" && !fromFlowOverlay) return;
      const clipboardData = event.clipboardData;

      // 先尝试解析系统剪贴板中的 Flow 数据（支持跨页面/跨实例粘贴）
      const rawFlowData =
        clipboardData?.getData(FLOW_CLIPBOARD_MIME) ||
        clipboardData?.getData("application/json");
      if (rawFlowData) {
        try {
          const parsed = JSON.parse(rawFlowData);
          const flowPayload =
            parsed?.type === FLOW_CLIPBOARD_TYPE
              ? parsed.data
              : parsed?.nodes && parsed?.edges
              ? parsed
              : null;
          if (flowPayload) {
            clipboardService.setFlowData(flowPayload);
            const handled = handlePasteFlow({ preserveLinkedEdges });
            if (handled) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        } catch {}
      }

      const payload = clipboardService.getFlowData();
      if (
        !payload ||
        !Array.isArray(payload.nodes) ||
        payload.nodes.length === 0
      )
        return;

      // 优先粘贴 Flow 内部剪贴板数据；避免被系统 image/file 项拦截
      {
        const handled = handlePasteFlow({ preserveLinkedEdges });
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      const items = clipboardData?.items;
      const hasFileOrImage = items
        ? Array.from(items).some(
            (item) =>
              item &&
              (item.kind === "file" ||
                (typeof item.type === "string" &&
                  item.type.startsWith("image/")))
          )
        : false;
      if (hasFileOrImage) return;

      const handled = handlePasteFlow({ preserveLinkedEdges });
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePasteFlow]);

  // 切换项目时先清空，避免跨项目残留
  React.useEffect(() => {
    if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
      setNodes([]);
      setEdges([]);
      hasHydratedFlowRef.current = false;
      lastSyncedJSONRef.current = null;
    }
    prevProjectIdRef.current = projectId ?? null;
  }, [projectId, setNodes, setEdges]);

  // 当项目内容的 flow 变化时，水合到 ReactFlow
  React.useEffect(() => {
    if (!projectId || !hydrated) return;
    if (nodeDraggingRef.current) return; // 拖拽过程中不从store覆盖本地状态，避免闪烁
    const ns = contentFlow?.nodes || [];
    const es = contentFlow?.edges || [];
    hydratingFromStoreRef.current = true;
    const nextNodes = tplNodesToRfNodes(ns);
    setNodes((prev) => {
      const prevMap = new Map(
        (prev as RFNode[]).map((node) => [node.id, node])
      );
      return nextNodes.map((node) => {
        const prevNode = prevMap.get(node.id);
        if (!prevNode) return node as RFNode;
        return {
          ...prevNode,
          position: node.position,
          data: { ...(prevNode.data || {}), ...(node.data || {}) },
          width: node.width ?? prevNode.width,
          height: node.height ?? prevNode.height,
          style: node.style || prevNode.style,
        } as RFNode;
      });
    });
    setEdges(tplEdgesToRfEdges(es));
    // 记录当前从 store 水合的快照，避免立刻写回造成环路
    lastSyncedJSONRef.current = getFlowSnapshotSignature(ns, es);
    hasHydratedFlowRef.current = true;
    Promise.resolve().then(() => {
      hydratingFromStoreRef.current = false;
    });
  }, [
    projectId,
    hydrated,
    contentFlow,
    setNodes,
    setEdges,
    tplNodesToRfNodes,
    tplEdgesToRfEdges,
    getFlowSnapshotSignature,
  ]);

  // 将 ReactFlow 的更改写回项目内容（触发自动保存）
  const scheduleCommit = React.useCallback(
    (nodesSnapshot: TemplateNode[], edgesSnapshot: TemplateEdge[]) => {
      if (!projectId) return;
      if (!hydrated) return;
      if (hydratingFromStoreRef.current) return;
      if (nodeDraggingRef.current) return; // 拖拽时不高频写回
      if (!hasHydratedFlowRef.current) return;
      const json = getFlowSnapshotSignature(nodesSnapshot, edgesSnapshot);
      if (json && lastSyncedJSONRef.current === json) return;
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(() => {
        lastSyncedJSONRef.current = json;
        updateProjectPartial(
          { flow: { nodes: nodesSnapshot, edges: edgesSnapshot } },
          { markDirty: true }
        );
        commitTimerRef.current = null;
      }, 120); // 轻微节流，避免频繁渲染
    },
    [projectId, hydrated, updateProjectPartial, getFlowSnapshotSignature]
  );

  React.useEffect(() => {
    if (!projectId) return;
    if (!hydrated) return;
    if (hydratingFromStoreRef.current) return;
    if (nodeDraggingRef.current) return;
    const nodesSnapshot = rfNodesToTplNodes(nodes as any);
    const edgesSnapshot = rfEdgesToTplEdges(edges);
    scheduleCommit(nodesSnapshot, edgesSnapshot);
  }, [
    nodes,
    edges,
    projectId,
    hydrated,
    rfNodesToTplNodes,
    rfEdgesToTplEdges,
    scheduleCommit,
  ]);

  React.useEffect(() => {
    if (hydrated) return;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, [hydrated]);

  // 背景设置改为驱动底层 Canvas 网格
  // 使用独立的Flow状态
  // 分别选择，避免一次性取整个 store 导致不必要的重渲染/快照警告
  const backgroundEnabled = useFlowStore((s) => s.backgroundEnabled);
  const backgroundVariant = useFlowStore((s) => s.backgroundVariant);
  const backgroundGap = useFlowStore((s) => s.backgroundGap);
  const backgroundSize = useFlowStore((s) => s.backgroundSize);
  const backgroundColor = useFlowStore((s) => s.backgroundColor);
  const backgroundOpacity = useFlowStore((s) => s.backgroundOpacity);
  const setBackgroundEnabled = useFlowStore((s) => s.setBackgroundEnabled);
  const setBackgroundVariant = useFlowStore((s) => s.setBackgroundVariant);
  const setBackgroundGap = useFlowStore((s) => s.setBackgroundGap);
  const setBackgroundSize = useFlowStore((s) => s.setBackgroundSize);
  const setBackgroundColor = useFlowStore((s) => s.setBackgroundColor);
  const setBackgroundOpacity = useFlowStore((s) => s.setBackgroundOpacity);
  const onlyRenderVisibleElements = useFlowStore(
    (s) => s.onlyRenderVisibleElements
  );
  const setOnlyRenderVisibleElements = useFlowStore(
    (s) => s.setOnlyRenderVisibleElements
  );
  const edgeColorMode = useFlowStore((s) => s.edgeColorMode);
  const setEdgeColorMode = useFlowStore((s) => s.setEdgeColorMode);
  const showFpsOverlay = useFlowStore((s) => s.showFpsOverlay);
  const setShowFpsOverlay = useFlowStore((s) => s.setShowFpsOverlay);
  const canvasZoom = useCanvasStore((s) => s.zoom);
  const isLargeGraphForVisibleRendering =
    nodes.length >= FLOW_AUTO_VISIBLE_RENDER_NODE_THRESHOLD;
  const isLargeGraphForMiniMapImageOverlay =
    nodes.length >= FLOW_AUTO_HIDE_MINIMAP_IMAGE_OVERLAY_NODE_THRESHOLD;
  const effectiveOnlyRenderVisibleElements =
    onlyRenderVisibleElements || isLargeGraphForVisibleRendering;
  const canEnableLowDetailMode = nodes.length >= FLOW_LOW_DETAIL_NODE_THRESHOLD;
  const [isFlowLowDetailMode, setIsFlowLowDetailMode] = React.useState(false);
  const hasRunningFlowNode = React.useMemo(
    () =>
      nodes.some((node) => {
        const data = (node as any)?.data;
        if (!data || typeof data !== "object") return false;
        const status =
          typeof data.status === "string" ? data.status.toLowerCase() : "";
        return status === "running" || data.groupRunning === true;
      }),
    [nodes]
  );

  React.useEffect(() => {
    const zoom =
      Number.isFinite(Number(canvasZoom)) && Number(canvasZoom) > 0
        ? Number(canvasZoom)
        : 1;
    setIsFlowLowDetailMode((prev) => {
      if (!canEnableLowDetailMode) return false;
      if (prev) return zoom <= FLOW_LOW_DETAIL_EXIT_ZOOM;
      return zoom <= FLOW_LOW_DETAIL_ENTER_ZOOM;
    });
  }, [canEnableLowDetailMode, canvasZoom]);
  const effectiveFlowLowDetailMode =
    isFlowLowDetailMode && !hasRunningFlowNode;

  const flowRenderModeValue = React.useMemo<FlowRenderMode>(
    () => ({
      lowDetailMode: effectiveFlowLowDetailMode,
    }),
    [effectiveFlowLowDetailMode]
  );

  const [dragFps, setDragFps] = React.useState<number>(0);
  const [dragLongFrames, setDragLongFrames] = React.useState<number>(0);
  const [dragMaxFrameMs, setDragMaxFrameMs] = React.useState<number>(0);
  const [fpsMode, setFpsMode] = React.useState<"Drag" | "Image" | null>(null);
  const fpsOverlayRef = React.useRef<HTMLDivElement | null>(null);

  // 方便性能排查：开发环境默认打开拖拽 FPS 监控（可在面板里随时关掉）
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    setShowFpsOverlay(true);
  }, [setShowFpsOverlay]);

  React.useEffect(() => {
    if (!showFpsOverlay) return;
    let rafId = 0;
    let last =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    let lastReport = last;
    let frames = 0;
    let acc = 0;
    let longFrames = 0;
    let maxDt = 0;
    let lastMode: "Drag" | "Image" | null = null;

    const tick = (nowArg: number) => {
      const now =
        nowArg ||
        (typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now());
      const dt = Math.max(0, now - last);
      last = now;

      const isImageDragging =
        typeof document !== "undefined" &&
        Boolean(document.body?.classList.contains("tanva-canvas-dragging"));
      const mode: "Drag" | "Image" | null = isImageDragging
        ? "Image"
        : nodeDraggingRef.current
        ? "Drag"
        : null;

      if (mode !== lastMode) {
        frames = 0;
        acc = 0;
        longFrames = 0;
        maxDt = 0;
        lastMode = mode;
      }

      if (mode) {
        frames += 1;
        acc += dt;
        if (dt >= 20) longFrames += 1; // 粗略把 >20ms 视为卡顿帧
        if (dt > maxDt) maxDt = dt;
      } else {
        frames = 0;
        acc = 0;
        longFrames = 0;
        maxDt = 0;
      }

      if (now - lastReport >= 250) {
        if (mode && acc > 0) {
          setDragFps((1000 * frames) / acc);
          setDragLongFrames(longFrames);
          setDragMaxFrameMs(maxDt);
          setFpsMode(mode);
        } else {
          setDragFps(0);
          setDragLongFrames(0);
          setDragMaxFrameMs(0);
          setFpsMode(null);
        }
        frames = 0;
        acc = 0;
        longFrames = 0;
        maxDt = 0;
        lastReport = now;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [showFpsOverlay]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const emitLayout = () => {
      const el = fpsOverlayRef.current;
      if (!showFpsOverlay || !el) {
        window.dispatchEvent(
          new CustomEvent("tanva:fps-overlay-layout", {
            detail: { visible: false },
          })
        );
        return;
      }

      const rect = el.getBoundingClientRect();
      window.dispatchEvent(
        new CustomEvent("tanva:fps-overlay-layout", {
          detail: {
            visible: true,
            top: rect.top,
            left: rect.left,
            height: rect.height,
          },
        })
      );
    };

    emitLayout();

    const el = fpsOverlayRef.current;
    if (!showFpsOverlay || !el || typeof ResizeObserver === "undefined") {
      return () => {
        window.dispatchEvent(
          new CustomEvent("tanva:fps-overlay-layout", {
            detail: { visible: false },
          })
        );
      };
    }

    const resizeObserver = new ResizeObserver(() => emitLayout());
    resizeObserver.observe(el);
    window.addEventListener("resize", emitLayout);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", emitLayout);
      window.dispatchEvent(
        new CustomEvent("tanva:fps-overlay-layout", {
          detail: { visible: false },
        })
      );
    };
  }, [showFpsOverlay]);

  // Flow独立的背景状态管理，不再同步到Canvas
  const [bgGapInput, setBgGapInput] = React.useState<string>(
    String(backgroundGap)
  );
  const [bgSizeInput, setBgSizeInput] = React.useState<string>(
    String(backgroundSize)
  );

  // 同步输入框字符串与实际数值
  React.useEffect(() => {
    setBgGapInput(String(backgroundGap));
  }, [backgroundGap]);
  React.useEffect(() => {
    setBgSizeInput(String(backgroundSize));
  }, [backgroundSize]);

  const commitGap = React.useCallback(
    (val: string) => {
      const n = Math.max(
        4,
        Math.min(100, Math.floor(Number(val)) || backgroundGap)
      );
      setBackgroundGap(n);
      setBgGapInput(String(n));
    },
    [backgroundGap, setBackgroundGap]
  );

  const commitSize = React.useCallback(
    (val: string) => {
      const n = Math.max(
        0.5,
        Math.min(10, Math.floor(Number(val)) || backgroundSize)
      );
      setBackgroundSize(n);
      setBgSizeInput(String(n));
    },
    [backgroundSize, setBackgroundSize]
  );

  const initialViewport = React.useMemo(() => {
    try {
      const state = useCanvasStore.getState();
      const z = state.zoom || 1;
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const x = ((state.panX || 0) * z) / dpr;
      const y = ((state.panY || 0) * z) / dpr;
      return { x, y, zoom: z };
    } catch {
      return { x: 0, y: 0, zoom: 1 };
    }
  }, [projectId]);

  // 使用Canvas → Flow 单向同步：保证节点随画布平移/缩放
  // 使用 subscribe 直接订阅状态变化，避免 useEffect 的渲染延迟
  const lastApplied = React.useRef<{ x: number; y: number; z: number } | null>(
    null
  );

  const applyViewportImmediate = React.useCallback((next: { x: number; y: number; z: number }) => {
    try {
      rfRef.current.setViewport(
        { x: next.x, y: next.y, zoom: next.z },
        { duration: 0 }
      );
    } catch {
      /* noop */
    }
  }, []);

  const syncViewportToCanvasStore = () => {
    try {
      const state = useCanvasStore.getState();
      const z = state.zoom || 1;
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const x = ((state.panX || 0) * z) / dpr;
      const y = ((state.panY || 0) * z) / dpr;
      lastApplied.current = { x, y, z };
      applyViewportImmediate({ x, y, z });
    } catch {
      /* noop */
    }
  };
  React.useEffect(() => {
    // 使用 Zustand subscribe 直接监听状态变化，绕过 React 渲染周期
    const unsubscribe = useCanvasStore.subscribe((state) => {
      const z = state.zoom || 1;
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const x = ((state.panX || 0) * z) / dpr;
      const y = ((state.panY || 0) * z) / dpr;
      const prev = lastApplied.current;
      const eps = 1e-6;
      if (
        prev &&
        Math.abs(prev.x - x) < eps &&
        Math.abs(prev.y - y) < eps &&
        Math.abs(prev.z - z) < eps
      )
        return;
      lastApplied.current = { x, y, z };
      // 平移与缩放均立即同步，消除交互中的短暂“脱节/漂移感”。
      applyViewportImmediate({ x, y, z });
    });

    // 初始同步
    const state = useCanvasStore.getState();
    const z = state.zoom || 1;
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const x = ((state.panX || 0) * z) / dpr;
    const y = ((state.panY || 0) * z) / dpr;
    lastApplied.current = { x, y, z };
    try {
      rfRef.current.setViewport({ x, y, zoom: z }, { duration: 0 });
    } catch {
      /* noop */
    }

    return unsubscribe;
  }, [applyViewportImmediate]);

  React.useLayoutEffect(() => {
    if (!projectId) return;
    syncViewportToCanvasStore();
  }, [projectId]);

  // 当开始/结束连线拖拽时，全局禁用/恢复文本选择，避免蓝色选区
  React.useEffect(() => {
    if (isConnecting) {
      document.body.classList.add("tanva-no-select", "tanva-flow-connecting");
    } else {
      document.body.classList.remove(
        "tanva-no-select",
        "tanva-flow-connecting"
      );
    }
    return () =>
      document.body.classList.remove(
        "tanva-no-select",
        "tanva-flow-connecting"
      );
  }, [isConnecting]);

  // 擦除模式退出时清除高亮
  React.useEffect(() => {
    // 节点橡皮已禁用，确保无高亮残留
    setNodes((ns) =>
      ns.map((n) =>
        n.className === "eraser-hover" ? { ...n, className: undefined } : n
      )
    );
  }, []);

  // 双击空白处弹出添加面板
  const [addPanel, setAddPanel] = React.useState<{
    visible: boolean;
    screen: { x: number; y: number };
    world: { x: number; y: number };
  }>({ visible: false, screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } });
  const [allowedAddTabs, setAllowedAddTabs] =
    React.useState<AddPanelTab[]>(ALL_ADD_TABS);
  const [addTab, setAddTab] = React.useState<AddPanelTab>(() =>
    getStoredAddPanelTab()
  );
  const clampAddTab = React.useCallback(
    (tab: AddPanelTab, allowed: AddPanelTab[] = allowedAddTabs) => {
      return allowed.includes(tab) ? tab : allowed[0];
    },
    [allowedAddTabs]
  );
  const setAddTabWithMemory = React.useCallback(
    (tab: AddPanelTab, allowedOverride?: AddPanelTab[]) => {
      const allowed = allowedOverride ?? allowedAddTabs;
      const next = clampAddTab(tab, allowed);
      setAddTab(next);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(ADD_PANEL_TAB_STORAGE_KEY, next);
        } catch (error) {
          console.warn("[FlowOverlay] 无法保存添加面板的页签状态", error);
        }
      }
    },
    [clampAddTab, allowedAddTabs]
  );
  React.useEffect(() => {
    setAddTab((prev) => clampAddTab(prev, allowedAddTabs));
  }, [allowedAddTabs, clampAddTab]);

  // 仅同步展示：打开「节点」页签时拉取后台节点管理中的最新配置（不在画板内编辑）
  React.useEffect(() => {
    if (!addPanel.visible || addTab !== "nodes") return;
    fetchNodeConfigs({ force: true })
      .then(setNodeConfigs)
      .catch(console.error);
  }, [addPanel.visible, addTab]);

  const addPanelRef = React.useRef<HTMLDivElement | null>(null);
  const lastPaneClickRef = React.useRef<{
    t: number;
    x: number;
    y: number;
  } | null>(null);
  const lastGlobalClickRef = React.useRef<{
    t: number;
    x: number;
    y: number;
  } | null>(null);
  // 模板相关状态
  const [tplIndex, setTplIndex] = React.useState<TemplateIndexEntry[] | null>(
    null
  );
  const [userTplList, setUserTplList] = React.useState<
    Array<{
      id: string;
      name: string;
      category?: string;
      tags?: string[];
      thumbnail?: string;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [tplLoading, setTplLoading] = React.useState(false);
  const [templateScope, setTemplateScope] = React.useState<"public" | "mine">(
    "public"
  );
  const [builtinCategories, setBuiltinCategories] = React.useState<string[]>(
    []
  );
  // 单选分类：仅允许选择一个内置分类，空字符串表示未筛选（显示全部）
  const [activeBuiltinCategory, setActiveBuiltinCategory] =
    React.useState<string>("");
  const normalizeTemplateCategory = React.useCallback((value?: string | null) => {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return "其他";
    if (raw.toLowerCase() === "other") return "其他";
    return raw;
  }, []);
  const getTemplateCategoryLabel = React.useCallback(
    (value?: string | null) => {
      const normalized = normalizeTemplateCategory(value);
      if (normalized === "其他") return lt("其他", "Other");
      return normalized;
    },
    [lt, normalizeTemplateCategory]
  );

  const filteredTplIndex = React.useMemo(() => {
    if (!tplIndex) return [];
    if (!activeBuiltinCategory) return tplIndex;
    return tplIndex.filter(
      (item) =>
        normalizeTemplateCategory(item.category) ===
        normalizeTemplateCategory(activeBuiltinCategory)
    );
  }, [tplIndex, activeBuiltinCategory, normalizeTemplateCategory]);

  const getPlaceholderCount = React.useCallback(
    (len: number, opts?: { columns?: number; minVisible?: number }) => {
      const columns = opts?.columns ?? 2;
      const minVisible = opts?.minVisible ?? 0;
      const minFill = len < minVisible ? minVisible - len : 0;
      const remainder = len % columns;
      const columnFill = remainder ? columns - remainder : 0;
      return Math.max(minFill, columnFill);
    },
    []
  );

  const resolveAddPanelAnchorScreen = React.useCallback(
    (clientX?: number, clientY?: number) => {
      const hasClientPoint =
        typeof clientX === "number" &&
        typeof clientY === "number" &&
        Number.isFinite(clientX) &&
        Number.isFinite(clientY);
      if (hasClientPoint) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          return {
            x: Math.min(rect.right, Math.max(rect.left, clientX)),
            y: Math.min(rect.bottom, Math.max(rect.top, clientY)),
          };
        }
        return { x: clientX, y: clientY };
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
      return {
        x:
          typeof window !== "undefined" ? window.innerWidth / 2 : 640,
        y:
          typeof window !== "undefined" ? window.innerHeight / 2 : 360,
      };
    },
    []
  );

  const openAddPanelAt = React.useCallback(
    (
      clientX: number,
      clientY: number,
      opts?: AddPanelOpenOptions
    ) => {
      const allowed = sanitizeAllowedAddTabs(opts?.allowedTabs);
      setAllowedAddTabs(allowed);
      const targetTab = clampAddTab(opts?.tab ?? addTab, allowed);
      setAddTabWithMemory(targetTab, allowed);
      if (opts?.scope) setTemplateScope(opts.scope);
      const panelScreen = resolveAddPanelAnchorScreen(clientX, clientY);
      const worldOverride = opts?.world;
      const hasWorldOverride =
        typeof worldOverride?.x === "number" &&
        Number.isFinite(worldOverride.x) &&
        typeof worldOverride?.y === "number" &&
        Number.isFinite(worldOverride.y);
      const world = hasWorldOverride
        ? { x: worldOverride.x, y: worldOverride.y }
        : rf.screenToFlowPosition(panelScreen);
      setAddPanel({ visible: true, screen: panelScreen, world });
    },
    [
      rf,
      addTab,
      setAddTabWithMemory,
      setTemplateScope,
      clampAddTab,
      resolveAddPanelAnchorScreen,
    ]
  );

  const openAddPanelAtContainerCenter = React.useCallback(
    (opts?: AddPanelOpenOptions) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      openAddPanelAt(centerX, centerY, opts);
    },
    [openAddPanelAt]
  );

  // 允许外部（如工具栏按钮）打开添加/模板面板
  React.useEffect(() => {
    const handleSet = (event: Event) => {
      const detail = (event as CustomEvent<any>)?.detail || {};
      const shouldOpen = detail.visible !== false;
      if (!shouldOpen) {
        setAddPanel((v) => ({ ...v, visible: false }));
        return;
      }
      const allowed: AddPanelTab[] | undefined = Array.isArray(
        detail.allowedTabs
      )
        ? (detail.allowedTabs.filter((t: any) =>
            ALL_ADD_TABS.includes(t)
          ) as AddPanelTab[])
        : undefined;
      const targetTab: AddPanelTab =
        detail.tab === "personal" || detail.tab === "nodes"
          ? detail.tab
          : "templates";
      const scope: "public" | "mine" | undefined =
        detail.scope === "public" || detail.scope === "mine"
          ? detail.scope
          : undefined;
      const x = detail.screen?.x ?? window.innerWidth / 2;
      const y = detail.screen?.y ?? window.innerHeight / 2;
      openAddPanelAt(x, y, { tab: targetTab, scope, allowedTabs: allowed });
    };
    // 兼容旧事件名称，新的 flow:set-template-panel 支持关闭
    window.addEventListener(
      "flow:open-template-panel",
      handleSet as EventListener
    );
    window.addEventListener(
      "flow:set-template-panel",
      handleSet as EventListener
    );
    return () => {
      window.removeEventListener(
        "flow:open-template-panel",
        handleSet as EventListener
      );
      window.removeEventListener(
        "flow:set-template-panel",
        handleSet as EventListener
      );
    };
  }, [openAddPanelAt, setAddTabWithMemory, setTemplateScope]);

  // 把面板可见性和当前页签通知给外部（例如工具栏按钮同步状态）
  React.useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent("flow:add-panel-visibility-change", {
          detail: {
            visible: addPanel.visible,
            tab: addTab,
            allowedTabs: allowedAddTabs,
          },
        })
      );
    } catch {}
  }, [addPanel.visible, addTab, allowedAddTabs]);

  // ---------- 导出/导入（序列化） ----------
  const compactImportedNodeData = React.useCallback((input: any) => {
    const seen = new WeakMap<object, any>();

    const walk = (value: any, key?: string): any => {
      if (typeof value === "function") return undefined;
      if (!value || typeof value !== "object") return value;
      if (value instanceof Date) return value.toISOString();

      if (Array.isArray(value)) {
        // 导入 JSON 时保留最新一条 history，避免把大历史数组全量带入运行态导致拖拽卡顿。
        const source = key === "history" ? value.slice(0, 1) : value;
        return source
          .map((item) => walk(item))
          .filter((item) => item !== undefined);
      }

      const cached = seen.get(value as object);
      if (cached) return cached;

      const next: Record<string, any> = {};
      seen.set(value as object, next);
      Object.entries(value as Record<string, any>).forEach(([childKey, child]) => {
        const sanitized = walk(child, childKey);
        if (sanitized === undefined) return;
        next[childKey] = sanitized;
      });
      return next;
    };

    return walk(input) || {};
  }, []);

  const cleanNodeData = React.useCallback((data: any, options?: { compactForImport?: boolean }) => {
    if (!data) return {};
    // 不导出回调函数/运行时状态字段
    const {
      onRun,
      onSend,
      status,
      error,
      taskId,
      buttons,
      lastHistoryId,
      ...rest
    } = data || {};
    if (options?.compactForImport) {
      return compactImportedNodeData(rest);
    }
    return rest;
  }, [compactImportedNodeData]);

  const isRemoteUrl = React.useCallback(
    (value: unknown): value is string =>
      typeof value === "string" && /^https?:\/\//i.test(value.trim()),
    []
  );

  const normalizeStableRemoteUrl = React.useCallback(
    (input: string): string => {
      const value = input.trim();
      if (!value) return input;

      // Avoid exporting environment-dependent proxy URLs; keep the original remote URL.
      try {
        const url = new URL(
          value,
          typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost"
        );
        const isProxy =
          url.pathname === "/api/assets/proxy" ||
          url.pathname === "/assets/proxy" ||
          value.startsWith("/api/assets/proxy") ||
          value.startsWith("/assets/proxy");
        if (isProxy) {
          const raw = url.searchParams.get("url");
          if (raw) return raw;
          const key = url.searchParams.get("key");
          if (key) {
            const normalizedKey = key.replace(/^\/+/, "");
            const direct = resolvePublicAssetUrlFromKey(normalizedKey);
            if (direct) return direct;
            return normalizedKey;
          }
        }
      } catch {}

      return value;
    },
    []
  );

  const isLikelyBase64Blob = React.useCallback(
    (value: unknown): value is string => {
      if (typeof value !== "string") return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("data:image/")) return true;
      if (trimmed.startsWith("blob:")) return true;

      // Heuristic: avoid false positives on regular text; only strip very large blobs.
      const compact = trimmed.replace(/\s+/g, "");
      if (compact.length < 2048) return false;
      if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return false;

      const head = compact.slice(0, 16);
      const looksLikeCommonImage =
        head.startsWith("iVBORw0KGgo") || // PNG
        head.startsWith("/9j/") || // JPEG
        head.startsWith("R0lGOD") || // GIF
        head.startsWith("UklGR") || // WEBP
        head.startsWith("Qk"); // BMP

      // Many base64 blobs end with padding; accept either common image prefix or padding.
      const hasPadding = compact.endsWith("=") || compact.endsWith("==");
      return looksLikeCommonImage || hasPadding;
    },
    []
  );

  const stripLargeInlineBlobsInPlace = React.useCallback(
    (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      for (const [key, rawValue] of Object.entries(obj)) {
        if (typeof rawValue !== "string") continue;
        const value = rawValue.trim();
        if (!value) continue;
        if (isRemoteUrl(value)) continue;
        if (!isLikelyBase64Blob(value)) continue;

        const k = String(key).toLowerCase();
        const shouldKeep =
          k.includes("prompt") ||
          k.includes("text") ||
          k.includes("title") ||
          k.includes("name") ||
          k.includes("desc");
        if (shouldKeep) continue;

        delete obj[key];
      }
    },
    [isLikelyBase64Blob, isRemoteUrl]
  );

  // 导出时的状态
  const [isExporting, setIsExporting] = React.useState(false);

  const getHistoryRemoteUrlForNode = React.useCallback(
    (nodeId: string, index?: number): string | null => {
      const history = useImageHistoryStore.getState().history || [];
      const hit = history.find((item) => {
        if (item.nodeId !== nodeId) return false;
        if (typeof index === "number") {
          // GeneratePro4: id is like `${nodeId}-${idx}-${Date.now()}`
          return String(item.id || "").startsWith(`${nodeId}-${index}-`);
        }
        return true;
      });
      const normalizedRemote = normalizePersistableImageRef(
        typeof hit?.remoteUrl === "string" ? hit.remoteUrl : ""
      );
      const normalizedSrc = normalizePersistableImageRef(
        typeof hit?.src === "string" ? hit.src : ""
      );
      const url =
        (normalizedRemote && isPersistableImageRef(normalizedRemote)
          ? normalizedRemote
          : undefined) ||
        (normalizedSrc && isPersistableImageRef(normalizedSrc)
          ? normalizedSrc
          : undefined) ||
        null;
      if (!url) return null;
      return /^https?:\/\//i.test(url) ? normalizeStableRemoteUrl(url) : url;
    },
    [normalizeStableRemoteUrl]
  );

  // 将运行时图片引用转换为可持久化引用（优先返回 OSS key；已是可持久化引用则规范化后直接返回）
  const uploadImageToStableUrl = React.useCallback(
    async (
      value: string,
      fileName: string,
      opts?: { reuploadUnstableRemote?: boolean }
    ): Promise<string> => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) throw new Error("空的图片数据");

      const normalized = normalizePersistableImageRef(trimmed);
      if (normalized && isPersistableImageRef(normalized)) {
        if (
          !opts?.reuploadUnstableRemote ||
          !requiresManagedImageUpload(normalized)
        ) {
          return normalized;
        }
      }

      const result = await imageUploadService.uploadImageSource(trimmed, {
        dir: "templates/images/",
        projectId,
        fileName,
      });

      const ref = (result.asset?.key || result.asset?.url || "").trim();
      if (!result.success || !ref) {
        throw new Error(result.error || "图片上传失败");
      }
      return ref;
    },
    [
      imageUploadService,
      isPersistableImageRef,
      normalizePersistableImageRef,
      projectId,
    ]
  );

  const exportFlow = React.useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
      const templateId = `tpl_${Date.now()}`;
      const templateName = `导出模板_${new Date().toLocaleString()}`;

      // 处理节点数据：模板导出仅保留稳定的 imageUrl / imageUrls（避免 base64 过大）
      const processedNodes = await Promise.all(
        nodes.map(async (n) => {
          const data = cleanNodeData(n.data);
          const nodeType = String(n.type || "");

          // ImageSplit：只保留可持久化的原图引用 + 裁切矩形（不保存切片图片数据）
          if (nodeType === "imageSplit") {
            const candidateInput =
              (typeof (data as any).inputImageUrl === "string" &&
              (data as any).inputImageUrl.trim()
                ? (data as any).inputImageUrl
                : undefined) ??
              (typeof (data as any).inputImage === "string" &&
              (data as any).inputImage.trim()
                ? (data as any).inputImage
                : undefined);

            if (candidateInput) {
              (data as any).inputImageUrl = await uploadImageToStableUrl(
                String(candidateInput).trim(),
                `flow_template_${templateId}_${n.id}_input.png`
              );
              delete (data as any).inputImage;
            }

            // legacy：splitImages -> splitRects（保留坐标，不保留图片）
            const existingRects = Array.isArray((data as any).splitRects)
              ? (data as any).splitRects
              : [];
            const legacyImages = Array.isArray((data as any).splitImages)
              ? (data as any).splitImages
              : [];
            if (existingRects.length === 0 && legacyImages.length > 0) {
              const rects = legacyImages
                .map((img: any, idx: number) => ({
                  index:
                    typeof img?.index === "number" && Number.isFinite(img.index)
                      ? img.index
                      : idx,
                  x: Number(img?.x ?? 0),
                  y: Number(img?.y ?? 0),
                  width: Number(img?.width ?? 0),
                  height: Number(img?.height ?? 0),
                }))
                .filter(
                  (r: any) =>
                    Number.isFinite(r.x) &&
                    Number.isFinite(r.y) &&
                    Number.isFinite(r.width) &&
                    Number.isFinite(r.height) &&
                    r.width > 0 &&
                    r.height > 0
                );
              if (rects.length > 0) {
                (data as any).splitRects = rects;
              }
            }
            if (Array.isArray((data as any).splitImages)) {
              delete (data as any).splitImages;
            }
          }

          // 多图节点
          const rawImages: unknown[] = Array.isArray((data as any).images)
            ? (data as any).images
            : [];
          const rawImageUrls: unknown[] = Array.isArray((data as any).imageUrls)
            ? (data as any).imageUrls
            : [];
          const rawThumbnails: unknown[] = Array.isArray(
            (data as any).thumbnails
          )
            ? (data as any).thumbnails
            : [];
          if (rawImages.length || rawImageUrls.length || rawThumbnails.length) {
            const len = Math.max(
              rawImages.length,
              rawImageUrls.length,
              rawThumbnails.length
            );
            const urls: string[] = [];
            for (let i = 0; i < len; i += 1) {
              const candidate =
                rawImageUrls[i] ?? rawImages[i] ?? rawThumbnails[i];
              const candidateStr =
                typeof candidate === "string" ? candidate.trim() : "";
              if (!candidateStr) {
                const historyUrl =
                  nodeType === "generatePro4"
                    ? getHistoryRemoteUrlForNode(n.id, i)
                    : null;
                urls.push(historyUrl || "");
                continue;
              }

              urls.push(
                await uploadImageToStableUrl(
                  candidateStr,
                  `flow_template_${templateId}_${n.id}_${i + 1}.png`
                )
              );
            }
            (data as any).imageUrls = urls;
            delete (data as any).images;
            delete (data as any).imageData;
            delete (data as any).thumbnails;
            delete (data as any).thumbnail;
          }

          // 单图节点
          const candidateSingle =
            (typeof (data as any).imageUrl === "string" &&
            (data as any).imageUrl.trim()
              ? (data as any).imageUrl
              : undefined) ??
            (typeof (data as any).imageData === "string" &&
            (data as any).imageData.trim()
              ? (data as any).imageData
              : undefined) ??
            (typeof (data as any).thumbnail === "string" &&
            (data as any).thumbnail.trim()
              ? (data as any).thumbnail
              : undefined);

          if (candidateSingle) {
            const candidateStr = String(candidateSingle).trim();
            (data as any).imageUrl = await uploadImageToStableUrl(
              candidateStr,
              `flow_template_${templateId}_${n.id}.png`
            );
            delete (data as any).imageData;
            delete (data as any).thumbnail;
            delete (data as any).thumbnails;
          } else if (
            typeof (data as any).imageData === "string" ||
            typeof (data as any).imageUrl === "string"
          ) {
            delete (data as any).imageData;
            delete (data as any).thumbnail;
            delete (data as any).thumbnails;
          } else {
            const historyUrl = getHistoryRemoteUrlForNode(n.id);
            if (historyUrl) (data as any).imageUrl = historyUrl;
          }

          stripLargeInlineBlobsInPlace(data);

          return {
            id: n.id,
            type: n.type,
            position: n.position,
            data,
            width: (n as any).width,
            height: (n as any).height,
            style: (n as any).style ? { ...(n as any).style } : undefined,
            parentNode: (n as any).parentNode,
            extent: (n as any).extent,
            selectable: (n as any).selectable,
            draggable: (n as any).draggable,
          };
        })
      );

      const payload = {
        schemaVersion: 1 as const,
        id: templateId,
        name: templateName,
        nodes: processedNodes,
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: normalizeFlowSourceHandle((e as any).sourceHandle),
          targetHandle: normalizeFlowTargetHandle((e as any).targetHandle),
          type: e.type || "default",
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.download = `tai-template-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      console.error("导出失败", err);
      alert("导出失败：图片上传或 JSON 生成失败，请重试");
    } finally {
      setIsExporting(false);
    }
  }, [
    nodes,
    edges,
    cleanNodeData,
    getHistoryRemoteUrlForNode,
    isExporting,
    stripLargeInlineBlobsInPlace,
    isRemoteUrl,
    normalizeStableRemoteUrl,
    uploadImageToStableUrl,
  ]);

  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const handleImportClick = React.useCallback(() => {
    // 点击导入后立即关闭面板
    setAddPanel((v) => ({ ...v, visible: false }));
    importInputRef.current?.click();
  }, []);

  const importFlowTemplateFromText = React.useCallback(
    (text: string) => {
      const obj = JSON.parse(text);
      const rawNodes = Array.isArray(obj?.nodes) ? obj.nodes : [];
      const rawEdges = Array.isArray(obj?.edges) ? obj.edges : [];

      const existing = new Set((rf.getNodes() || []).map((n) => n.id));
      const idMap = new Map<string, string>();

      const now = Date.now();
      rawNodes.forEach((n: any, idx: number) => {
        const origId = String(n.id || `n_${idx}`);
        let newId = origId;
        if (existing.has(newId) || idMap.has(newId))
          newId = `${origId}_${now}_${idx}`;
        idMap.set(origId, newId);
      });

      const legacyChildrenByGroupOldId = new Map<string, string[]>();
      rawNodes.forEach((n: any, idx: number) => {
        const origId = String(n.id || `n_${idx}`);
        const parentId =
          typeof n?.parentNode === "string" ? String(n.parentNode).trim() : "";
        if (!parentId) return;
        const list = legacyChildrenByGroupOldId.get(parentId) || [];
        list.push(origId);
        legacyChildrenByGroupOldId.set(parentId, list);
      });

      const mappedNodes = rawNodes.map((n: any, idx: number) => {
        const origId = String(n.id || `n_${idx}`);
        const newId = idMap.get(origId) || `${origId}_${now}_${idx}`;
        const data = cleanNodeData(n.data, { compactForImport: true }) || {};
        if (n.type === FLOW_GROUP_NODE_TYPE) {
          const explicitChildren = Array.isArray((data as any).childNodeIds)
            ? (data as any).childNodeIds.map(
                (childId: string) => idMap.get(String(childId)) || null
              )
            : [];
          const legacyChildren = (
            legacyChildrenByGroupOldId.get(origId) || []
          ).map((childOldId: string) => idMap.get(String(childOldId)) || null);
          (data as any).childNodeIds = Array.from(
            new Set([...explicitChildren, ...legacyChildren].filter(Boolean))
          );
        }
        return {
          id: newId,
          type: n.type,
          position: n.position || { x: 0, y: 0 },
          data,
          width: n.width,
          height: n.height,
          style: n.style ? { ...n.style } : undefined,
          parentNode: undefined,
          extent: undefined,
          selectable: true,
          draggable: true,
        } as any;
      });

      const mappedEdges = rawEdges
        .map((e: any, idx: number) => {
          const sid = idMap.get(String(e.source)) || String(e.source);
          const tid = idMap.get(String(e.target)) || String(e.target);
          return {
            id: String(e.id || `e_${now}_${idx}`),
            source: sid,
            target: tid,
            sourceHandle: normalizeFlowSourceHandle(e.sourceHandle),
            targetHandle: normalizeFlowTargetHandle(e.targetHandle),
            type: e.type || "default",
          } as any;
        })
        .filter(
          (e: any) =>
            mappedNodes.find((n) => n.id === e.source) &&
            mappedNodes.find((n) => n.id === e.target)
        );

      setNodes((ns) => ns.concat(mappedNodes));
      setEdges((es) => es.concat(mappedEdges));
      console.log(
        `✅ 导入成功：节点 ${mappedNodes.length} 条，连线 ${mappedEdges.length} 条`
      );
      try {
        historyService.commit("flow-import").catch(() => {});
      } catch {}
    },
    [rf, setNodes, setEdges, cleanNodeData]
  );

  const handleImportFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          importFlowTemplateFromText(text);
        } catch (err) {
          console.error("导入失败：JSON 解析错误", err);
        } finally {
          // 确保面板关闭；重置 input 值，允许重复导入同一文件
          setAddPanel((v) => ({ ...v, visible: false }));
          try {
            if (importInputRef.current) importInputRef.current.value = "";
          } catch {}
        }
      };
      reader.readAsText(file);
    },
    [importFlowTemplateFromText]
  );

  React.useEffect(() => {
    const handler = () => {
      void exportFlow();
    };
    window.addEventListener(
      "flow:export-template-request",
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        "flow:export-template-request",
        handler as EventListener
      );
    };
  }, [exportFlow]);

  React.useEffect(() => {
    const handler = () => {
      handleImportClick();
    };
    window.addEventListener(
      "flow:import-template-request",
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        "flow:import-template-request",
        handler as EventListener
      );
    };
  }, [handleImportClick]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ content?: unknown }>;
      const content =
        typeof customEvent.detail?.content === "string"
          ? customEvent.detail.content
          : "";
      if (!content.trim()) return;

      try {
        importFlowTemplateFromText(content);
      } catch (err) {
        console.error("导入失败：JSON 解析错误", err);
      } finally {
        setAddPanel((v) => ({ ...v, visible: false }));
      }
    };
    window.addEventListener(
      "flow:import-template-json",
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        "flow:import-template-json",
        handler as EventListener
      );
    };
  }, [importFlowTemplateFromText]
  );

  // 仅在真正空白处（底层画布）允许触发
  const isBlankArea = React.useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      return false;

    // 屏蔽 AI 对话框等区域及其外侧保护带（24px），防止误触发
    try {
      const shield = 24; // 外侧保护带
      const preventEls = Array.from(
        document.querySelectorAll("[data-prevent-add-panel]")
      ) as HTMLElement[];
      for (const el of preventEls) {
        const r = el.getBoundingClientRect();
        if (
          clientX >= r.left - shield &&
          clientX <= r.right + shield &&
          clientY >= r.top - shield &&
          clientY <= r.bottom + shield
        ) {
          return false;
        }
      }
    } catch {}

    const el = document.elementFromPoint(
      clientX,
      clientY
    ) as HTMLElement | null;
    if (!el) return false;
    // 排除：添加面板/工具栏/Flow交互元素/任意标记为不触发的UI
    if (
      el.closest(
        ".tanva-add-panel, .tanva-flow-toolbar, .react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, [data-prevent-add-panel]"
      )
    )
      return false;
    // 接受：底层画布 或 ReactFlow 背景/Pane（网格区域）
    const tag = el.tagName.toLowerCase();
    const isCanvas = tag === "canvas";
    const isPane = !!el.closest(".react-flow__pane");
    const isGridBg = !!el.closest(".react-flow__background");
    if (!isCanvas && !isPane && !isGridBg) return false;

    // 进一步：命中检测 Paper.js 物体（文本/图像/形状等）
    let projectPoint: paper.Point | null = null;
    try {
      const canvas = paper?.view?.element as HTMLCanvasElement | undefined;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const vx = (clientX - rect.left) * dpr;
        const vy = (clientY - rect.top) * dpr;
        const pt = paper.view.viewToProject(new paper.Point(vx, vy));
        projectPoint = pt;
        const hit = paper.project.hitTest(pt, {
          segments: true,
          stroke: true,
          fill: true,
          bounds: true,
          center: true,
          tolerance: 4,
        } as any);
        if (hit && hit.item) {
          const item: any = hit.item;

          // 向上查找真实内容（例如图片组），避免命中辅助框时被误判为空白
          let current: any = item;
          while (current) {
            const data = current.data || {};
            if (
              (data.type === "image" && data.imageId) ||
              (typeof data.type === "string" &&
                !data.isHelper &&
                data.type !== "grid")
            ) {
              return false; // 命中真实内容，视为非空白
            }
            current = current.parent;
          }

          // 原有的网格/辅助元素检测
          const layerName = item?.layer?.name || "";
          const isGridLayer = layerName === "grid";
          const isHelper =
            !!item?.data?.isAxis || item?.data?.isHelper === true;
          const isGridType =
            typeof item?.data?.type === "string" &&
            item.data.type.startsWith("grid");
          if (isGridLayer || isHelper || isGridType) {
            // 命中网格/坐标轴等辅助元素：视为空白
          } else {
            return false; // 命中真实内容，视为非空白
          }
        }
      }
    } catch {}

    // 兜底：若未命中元素，基于保存的3D模型包围盒再次检查，避免3D区域被误判为空白
    try {
      if (projectPoint && paper?.project) {
        const hitModel = paper.project
          .getItems({
            match: (item: any) =>
              item?.data?.type === "3d-model" && item?.data?.bounds,
          })
          .some((item: any) => {
            try {
              const b = item.data.bounds;
              return (
                projectPoint!.x >= b.x &&
                projectPoint!.x <= b.x + b.width &&
                projectPoint!.y >= b.y &&
                projectPoint!.y <= b.y + b.height
              );
            } catch {
              return false;
            }
          });
        if (hitModel) return false;
      }
    } catch {}
    return true;
  }, []);

  const allowNativeScroll = React.useCallback((target: EventTarget | null) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    const container = containerRef.current;
    if (!container) return false;
    let el: HTMLElement | null = target;
    while (el && container.contains(el)) {
      const tag = el.tagName.toLowerCase();
      if (
        tag === "textarea" ||
        tag === "input" ||
        tag === "select" ||
        el.isContentEditable
      ) {
        return true;
      }
      try {
        const style = window.getComputedStyle(el);
        const canScrollY =
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 1;
        const canScrollX =
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1;
        if (canScrollX || canScrollY) return true;
      } catch {
        // getComputedStyle 可能失败，忽略并继续向上
      }
      el = el.parentElement;
    }
    return false;
  }, []);

  const isInsideThreeViewport = React.useCallback(
    (event: WheelEvent | React.WheelEvent<HTMLDivElement>) => {
      const selector =
        '[data-model3d-container="true"], [data-flow-three-node-viewport="true"], .react-flow__node-three, .react-flow__node-threePathTracer';

      const target = event.target;
      if (target instanceof Element && target.closest(selector)) return true;

      const composedPath = (event as any)?.composedPath;
      if (typeof composedPath === "function") {
        try {
          const path = composedPath.call(event);
          if (
            Array.isArray(path) &&
            path.some(
              (node: unknown) =>
                node instanceof Element && Boolean(node.closest(selector))
            )
          ) {
            return true;
          }
        } catch {
          // ignore path errors
        }
      }

      const x = Number((event as any)?.clientX);
      const y = Number((event as any)?.clientY);
      if (Number.isFinite(x) && Number.isFinite(y) && typeof document !== "undefined") {
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest(selector)) return true;
      }

      return false;
    },
    []
  );

  // 中键拖拽以平移 Flow 视口，阻止浏览器的自动滚动
  const middleDragRef = React.useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  }>({
    dragging: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stopDrag = () => {
      if (!middleDragRef.current.dragging) return;
      middleDragRef.current.dragging = false;
      container.classList.remove("tanva-flow-middle-panning");
      container.style.cursor = "";
      try {
        useCanvasStore.getState().setDragging(false);
      } catch {}
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      if (allowNativeScroll(event.target)) return;
      const store = useCanvasStore.getState();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      middleDragRef.current.dragging = true;
      middleDragRef.current.startX = event.clientX;
      middleDragRef.current.startY = event.clientY;
      middleDragRef.current.startPanX = store.panX;
      middleDragRef.current.startPanY = store.panY;
      container.classList.add("tanva-flow-middle-panning");
      container.style.cursor = "grabbing";
      try {
        store.setDragging(true);
      } catch {}
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!middleDragRef.current.dragging) return;
      event.preventDefault();
      const store = useCanvasStore.getState();
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const zoom = store.zoom || 1;
      const dx = event.clientX - middleDragRef.current.startX;
      const dy = event.clientY - middleDragRef.current.startY;
      if (dx === 0 && dy === 0) return;
      store.setPan(
        middleDragRef.current.startPanX + (dx * dpr) / zoom,
        middleDragRef.current.startPanY + (dy * dpr) / zoom
      );
    };

    const handleMouseUp = () => stopDrag();
    const handleWindowBlur = () => stopDrag();

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      stopDrag();
    };
  }, [allowNativeScroll]);

  React.useEffect(() => {
    const clearFlowSelectionDragging = () => {
      document.body.classList.remove("tanva-flow-selection-dragging");
    };

    const handleMouseDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (!(isPointerMode || isMarqueeMode || drawMode === "select")) return;
      if (event.button !== 0) return;

      const rect = container.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .tanva-flow-toolbar, .tanva-add-panel, [data-prevent-add-panel]"
        )
      ) {
        return;
      }
      document.body.classList.add("tanva-flow-selection-dragging");
    };

    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mouseup", clearFlowSelectionDragging, true);
    window.addEventListener("blur", clearFlowSelectionDragging);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", clearFlowSelectionDragging, true);
      window.removeEventListener("blur", clearFlowSelectionDragging);
      clearFlowSelectionDragging();
    };
  }, [drawMode, isPointerMode, isMarqueeMode]);

  const handleWheelCapture = React.useCallback(
    (event: WheelEvent | React.WheelEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      if (isInsideThreeViewport(event)) return;

      const store = useCanvasStore.getState();
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

      const isModifierWheel = event.ctrlKey || event.metaKey;
      const shouldZoom =
        store.wheelZoomMode === "direct" ? !isModifierWheel : isModifierWheel;
      const prefersNativeScroll = allowNativeScroll(event.target);

      if (prefersNativeScroll && !shouldZoom) {
        // Keep native scrolling for inputs/scrollable areas, but never allow browser page zoom.
        if (isModifierWheel) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (shouldZoom) {
        event.preventDefault();
        event.stopPropagation();

        const canvasEl =
          (paper?.view?.element as HTMLCanvasElement | undefined) ||
          containerRef.current;
        const rect = canvasEl?.getBoundingClientRect();
        if (!rect) return;

        const sx = (event.clientX - rect.left) * dpr;
        const sy = (event.clientY - rect.top) * dpr;
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
        if (Math.abs(delta) < 1e-6) return;

        const z1 = store.zoom || 1;
        const z2 = computeSmoothZoom(z1, delta, {
          sensitivity: store.zoomSensitivity,
        });
        if (z1 === z2) return;

        const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
        const pan2y = store.panY + sy * (1 / z2 - 1 / z1);
        useCanvasStore.setState({
          panX: pan2x,
          panY: pan2y,
          zoom: z2,
        });
        return;
      }

      const hasDelta =
        Math.abs(event.deltaX) > 0.0001 || Math.abs(event.deltaY) > 0.0001;
      if (!hasDelta) return;

      event.preventDefault();
      event.stopPropagation();

      const zoom = store.zoom || 1;
      const worldDeltaX = (-event.deltaX * dpr) / zoom;
      const worldDeltaY = (-event.deltaY * dpr) / zoom;
      store.setPan(store.panX + worldDeltaX, store.panY + worldDeltaY);
    },
    [allowNativeScroll, isInsideThreeViewport]
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const listener = (event: WheelEvent) => handleWheelCapture(event);
    container.addEventListener("wheel", listener, {
      capture: true,
      passive: false,
    });
    return () => {
      container.removeEventListener("wheel", listener, { capture: true });
    };
  }, [handleWheelCapture]);

  const onPaneClick = React.useCallback(
    (event: React.MouseEvent) => {
      // 基于两次快速点击判定双击（ReactFlow Pane 无原生 onDoubleClick 回调）
      const now = Date.now();
      const x = event.clientX,
        y = event.clientY;
      const last = lastPaneClickRef.current;
      lastPaneClickRef.current = { t: now, x, y };
      if (
        last &&
        now - last.t < 200 &&
        Math.hypot(last.x - x, last.y - y) < 10
      ) {
        if (isBlankArea(x, y)) {
          const world = rf.screenToFlowPosition({ x, y });
          openAddPanelAtContainerCenter({
            tab: "nodes",
            allowedTabs: ["nodes", "beta", "custom"],
            world,
          });
        }
      } else if (!isPointerMode) {
        // 单击空白区域时，取消所有节点的选择（pointer 模式下不自动取消选择）
        setNodes((prev: any[]) =>
          prev.map((node) => ({ ...node, selected: false }))
        );
      }
    },
    [openAddPanelAtContainerCenter, isBlankArea, setNodes, isPointerMode, rf]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddPanel((v) => ({ ...v, visible: false }));
    };
    const onDown = (e: MouseEvent) => {
      if (!addPanel.visible) return;
      const el = addPanelRef.current;
      if (el && !el.contains(e.target as HTMLElement))
        setAddPanel((v) => ({ ...v, visible: false }));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [addPanel.visible]);

  // 监听点击事件，在空白区域点击时取消节点选择
  // 在 window 级别监听，确保能捕获到事件（即使 CSS 阻止了子元素的事件）
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      // 在选择相关的模式下（pointer, select, marquee），不通过点击画布空白区域来自动取消选择
      // 因为这些模式下的框选/点击逻辑由 InteractionController 和 SelectionTool 统一协调
      if (isPointerMode || isMarqueeMode || drawMode === "select") return;

      // 检查点击是否在容器内
      const rect = container.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return; // 点击在容器外，不处理
      }

      // 检查是否点击了节点、连线或其他 Flow 交互元素
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .tanva-add-panel, .tanva-flow-toolbar, [data-prevent-add-panel]"
        )
      ) {
        return; // 点击了 Flow 元素，不处理
      }

      // 检查是否是空白区域
      if (isBlankArea(e.clientX, e.clientY)) {
        // 取消所有节点的选择
        setNodes((prev: any[]) =>
          prev.map((node) => ({ ...node, selected: false }))
        );
      }
    };

    // 在 window 级别监听，使用捕获阶段确保能捕获到事件
    window.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("click", handleClick, true);
    };
  }, [isBlankArea, setNodes, isPointerMode]);

  // 在打开模板页签时加载内置与用户模板
  React.useEffect(() => {
    if (!addPanel.visible || addTab !== "templates") return;
    let cancelled = false;
    (async () => {
      setTplLoading(true);
      try {
        if (!tplIndex) {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map((item) => ({
            ...item,
            category: normalizeTemplateCategory(item.category),
          }));
          if (!cancelled) {
            setTplIndex(normalizedIdx);
          }
        }
        const list = await listUserTemplates();
        if (!cancelled) setUserTplList(list);
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addPanel.visible, addTab, tplIndex, normalizeTemplateCategory]);

  // 加载后端维护的分类列表（供公共模板使用）
  React.useEffect(() => {
    if (!addPanel.visible || addTab !== "templates") return;
    let cancelled = false;
    (async () => {
      try {
        const cats = await fetchTemplateCategories();
        if (!cancelled && Array.isArray(cats) && cats.length) {
          setBuiltinCategories(
            Array.from(new Set(cats.map((cat) => normalizeTemplateCategory(cat))))
          );
          return;
        }
        // 如果后端没有返回分类或为空，从 tplIndex 推断分类
        if (!cancelled) {
          const fromTpl = (tplIndex || [])
            .map((t) => normalizeTemplateCategory(t.category))
            .filter(Boolean) as string[];
          const uniq = Array.from(new Set(fromTpl));
          if (uniq.length) {
            setBuiltinCategories(uniq);
          } else {
            setBuiltinCategories(["其他"]);
          }
        }
      } catch (e) {
        // 若请求失败（例如未认证），也从 tplIndex 推断
        if (!cancelled) {
          const fromTpl = (tplIndex || [])
            .map((t) => normalizeTemplateCategory(t.category))
            .filter(Boolean) as string[];
          const uniq = Array.from(new Set(fromTpl));
          if (uniq.length) {
            setBuiltinCategories(uniq);
          } else {
            setBuiltinCategories(["其他"]);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addPanel.visible, addTab, tplIndex, normalizeTemplateCategory]);

  // 捕获原生点击，通过自定义检测实现双击（300ms 间隔），仅在真正空白 Pane 区域触发；排除 AI 对话框及其保护带
  React.useEffect(() => {
    const DOUBLE_CLICK_INTERVAL = 300; // 双击时间间隔（毫秒）
    const DOUBLE_CLICK_DISTANCE = 10; // 允许的最大移动距离（像素）

    const onNativeClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX,
        y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
        return;

      // 若事件来源路径中包含受保护元素（AI 对话框等），直接忽略
      try {
        const path = (e.composedPath && e.composedPath()) || [];
        for (const n of path) {
          if (
            n &&
            (n as any).closest &&
            (n as HTMLElement).closest?.("[data-prevent-add-panel]")
          ) {
            return;
          }
          if (
            n instanceof HTMLElement &&
            n.getAttribute &&
            n.getAttribute("data-prevent-add-panel") !== null
          ) {
            return;
          }
        }
      } catch {}

      // 若在屏蔽元素或其外侧保护带内，忽略
      try {
        const shield = 24;
        const preventEls = Array.from(
          document.querySelectorAll("[data-prevent-add-panel]")
        ) as HTMLElement[];
        for (const el of preventEls) {
          const r = el.getBoundingClientRect();
          if (
            x >= r.left - shield &&
            x <= r.right + shield &&
            y >= r.top - shield &&
            y <= r.bottom + shield
          ) {
            return;
          }
        }
      } catch {}

      // 自定义双击检测
      const now = Date.now();
      const last = lastGlobalClickRef.current;

      if (
        last &&
        now - last.t < DOUBLE_CLICK_INTERVAL &&
        Math.hypot(x - last.x, y - last.y) < DOUBLE_CLICK_DISTANCE
      ) {
        // 检测到双击
        if (isBlankArea(x, y)) {
          e.stopPropagation();
          e.preventDefault();
          const world = rf.screenToFlowPosition({ x, y });
          openAddPanelAtContainerCenter({
            tab: "nodes",
            allowedTabs: ["nodes", "beta", "custom"],
            world,
          });
        }
        // 重置记录，避免连续三次点击被识别为两次双击
        lastGlobalClickRef.current = null;
      } else {
        // 更新点击记录
        lastGlobalClickRef.current = { t: now, x, y };
      }
    };

    window.addEventListener("click", onNativeClick, true);
    return () => window.removeEventListener("click", onNativeClick, true);
  }, [openAddPanelAtContainerCenter, isBlankArea, rf]);

  // 🔥 备选方案：监听原生 dblclick 事件，解决自定义双击检测在某些模式下失效的问题
  React.useEffect(() => {
    const onNativeDblClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX,
        y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
        return;

      // 检查是否在受保护元素内（AI 对话框等）
      try {
        const path = (e.composedPath && e.composedPath()) || [];
        for (const n of path) {
          if (
            n instanceof HTMLElement &&
            n.closest?.("[data-prevent-add-panel]")
          ) {
            return;
          }
        }
      } catch {}

      // 检查是否在屏蔽元素或其外侧保护带内
      try {
        const shield = 24;
        const preventEls = Array.from(
          document.querySelectorAll("[data-prevent-add-panel]")
        ) as HTMLElement[];
        for (const el of preventEls) {
          const r = el.getBoundingClientRect();
          if (
            x >= r.left - shield &&
            x <= r.right + shield &&
            y >= r.top - shield &&
            y <= r.bottom + shield
          ) {
            return;
          }
        }
      } catch {}

      if (isBlankArea(x, y)) {
        e.stopPropagation();
        e.preventDefault();
        const world = rf.screenToFlowPosition({ x, y });
        openAddPanelAtContainerCenter({
          tab: "nodes",
          allowedTabs: ["nodes", "beta", "custom"],
          world,
        });
      }
    };

    window.addEventListener("dblclick", onNativeDblClick, true);
    return () => window.removeEventListener("dblclick", onNativeDblClick, true);
  }, [openAddPanelAtContainerCenter, isBlankArea, rf]);

  const createNodeAtWorldCenter = React.useCallback(
    (
      rawType: string,
      world: { x: number; y: number },
      paletteDefaultData?: Record<string, any>,
      paletteConfig?: Partial<NodeConfig>
    ) => {
      // 以默认尺寸中心对齐放置
      const type = normalizeFlowNodeType(rawType);
      if (!type) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: `节点类型未接入：${rawType || "unknown"}`,
              type: "error",
            },
          })
        );
        return null;
      }
      const size = FLOW_NODE_DEFAULT_SIZE[type];
      const id = `${type}_${Date.now()}`;
      const pos = { x: world.x - size.w / 2, y: world.y - size.h / 2 };
      const baseData =
        type === "textPrompt"
          ? { text: "", boxW: size.w, boxH: size.h, title: "Prompt" }
          : type === "textPromptPro"
          ? {
              prompts: [""],
              text: "",
              textMode: "raw",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "textNote"
          ? { text: "", boxW: size.w, boxH: size.h }
          : type === "textChat"
          ? {
              title: "Text Chat",
              status: "idle" as const,
              manualInput: "",
              responseText: "",
              enableWebSearch: false,
              modelProvider: resolveFlowModelProvider(undefined, aiProvider),
              boxW: size.w,
              boxH: size.h,
            }
          : type === "promptOptimize"
          ? { text: "", expandedText: "", boxW: size.w, boxH: size.h }
          : type === "image"
          ? { imageData: undefined, boxW: size.w, boxH: size.h }
          : type === "imagePro"
          ? { imageData: undefined, imageWidth: 296 }
          : type === "generate"
          ? {
              status: "idle" as const,
              boxW: size.w,
              boxH: size.h,
              presetPrompt: "",
              modelProvider: resolveFlowModelProvider(undefined, aiProvider),
            }
          : type === "generatePro"
          ? {
              status: "idle" as const,
              boxW: size.w,
              boxH: size.h,
              prompts: [""],
              title: "Agent",
              enableWebSearch: false,
              modelProvider: resolveFlowModelProvider(undefined, aiProvider),
            }
          : type === "generatePro4"
          ? {
              status: "idle" as const,
              images: [],
              boxW: size.w,
              boxH: size.h,
              prompts: [""],
              enableWebSearch: false,
              modelProvider: resolveFlowModelProvider(undefined, aiProvider),
            }
          : type === "generate4"
          ? {
              status: "idle" as const,
              images: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "generateRef"
          ? {
              status: "idle" as const,
              referencePrompt: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "viewAngle"
          ? {
              status: "idle" as const,
              generatedPrompt:
                "Redraw this image and change the perspective, <sks>, right quarter, eye-level, cowboy shot, standard lens",
              promptSuffix: "",
              azimuth: 45,
              elevation: 0,
              distance: 4,
              zoom: 1,
              sceneYaw: 0,
              directionId: "front-right-quarter",
              verticalId: "eye-level",
              shotId: "cowboy-shot",
              lensId: "standard",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "analysis"
          ? {
              status: "idle" as const,
              prompt: "",
              analysisPrompt: undefined,
              analysisProvider: "banana-2.5" as const,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "sora2Video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              videoQuality: DEFAULT_SORA2_VIDEO_QUALITY,
              generationType: "sora2",
              model: "sora-2-pro",
              style: undefined,
              watermark: false,
              thumbnailEnabled: true,
              privateMode: false,
              storyboard: false,
              timestamps: "1,3",
              fromTask: undefined,
              taskId: undefined,
              progress: undefined,
              characters: [],
              characterTaskId: undefined,
              characterUrl: undefined,
              characterTimestamps: undefined,
              videoVersion: 0,
              history: [],
              clipDuration: 10,
              aspectRatio: "16:9",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "sora2Character"
          ? {
              status: "idle" as const,
              model: "sora-2-pro",
              timestamps: "1,3",
              fromTask: undefined,
              taskId: undefined,
              progress: undefined,
              characters: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "wan26"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              size: "16:9",
              resolution: "720P",
              duration: 5,
              shotType: "single",
              audioUrl: undefined,
              videoVersion: 0,
              history: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "wan2R2V"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              size: "16:9",
              duration: 5,
              shotType: "single",
              videoVersion: 0,
              history: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "happyhorseR2V"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              model: "happyhorse-1.0-r2v" as const,
              ratio: "16:9" as const,
              resolution: "720P" as const,
              duration: 5,
              referenceCount: 1,
              videoVersion: 0,
              history: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "wan27Video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              resolution: "1080P" as const,
              duration: 5 as const,
              audioUrl: undefined,
              seed: undefined,
              videoVersion: 0,
              history: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "storyboardSplit"
          ? {
              status: "idle" as const,
              inputText: "",
              segments: [],
              outputCount: 9,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "midjourney"
          ? {
              status: "idle" as const,
              mode: "FAST",
              presetPrompt: "",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "midjourneyV7" || type === "niji7"
          ? {
              status: "idle" as const,
              aspectRatio: "1:1",
              speedMode: "fast" as const,
              raw: false,
              chaos: "40",
              stylize: "100",
              weird: "",
              seed: "",
              noPrompt: "",
              imageWeight: "1",
              styleRefs: "",
              styleVersion: "",
              styleWeight: "",
              quality: "1" as const,
              draft: false,
              tile: false,
              omniReference: "",
              omniWeight: "",
              exp: "",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "seedream5"
          ? {
              status: "idle" as const,
              images: [],
              size: "2K",
              batchMode: false,
              batchCount: 4,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              videoName: undefined,
              mimeType: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "audioUpload"
          ? {
              status: "idle" as const,
              audioUrl: undefined,
              audioName: undefined,
              mimeType: undefined,
              duration: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "videoAnalyze"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              prompt: "",
              analysisPrompt: undefined,
              text: "",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "videoFrameExtract"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              intervalSeconds: 3,
              frames: [],
              totalFrames: 0,
              outputMode: "all" as const,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "videoToGif"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              gifUrl: undefined,
              fps: 10,
              width: 480,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "imageGrid"
          ? {
              status: "idle" as const,
              images: [],
              outputImage: undefined,
              backgroundColor: "#ffffff",
              padding: 0,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "imageSplit"
          ? {
              status: "idle" as const,
              splitImages: [],
              splitMode: "smart" as const,
              gridCols: 3,
              gridRows: 3,
              outputCount: 9,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "imageCompress"
          ? {
              status: "idle" as const,
              level: "balanced" as const,
              outputImage: undefined,
              imageData: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "minimaxSpeech"
          ? {
              status: "idle" as const,
              text: "",
              history: [] as Array<{
                id: string;
                prompt: string;
                audioUrl: string;
                createdAt: number;
              }>,
              selectedHistoryId: undefined,
              voiceId: "male-qn-qingse",
              model: "speech-2.6-hd",
              outputFormat: "url" as const,
              audioMode: "json" as const,
              soundEffects: [] as Array<
                "spacious_echo" | "auditorium_echo" | "lofi_telephone" | "robotic"
              >,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "tencentSpeech"
          ? {
              status: "idle" as const,
              text: "",
              history: [] as Array<{
                id: string;
                prompt: string;
                audioUrl: string;
                videoUrl?: string;
                createdAt: number;
              }>,
              selectedHistoryId: undefined,
              voiceId: "",
              speakerGender: "male" as const,
              srcLang: "zh",
              dstLang: "en",
              srcSubtitleUrl: "",
              dstSubtitleUrl: "",
              embedSubtitle: true,
              font: "auto",
              fontSize: 50,
              marginV: 50,
              outputPattern: "",
              speakerUrlInput: "",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "minimaxMusic"
          ? {
              status: "idle" as const,
              audioUrl: undefined,
              prompt: "",
              lyrics: "",
              isInstrumental: false,
              lyricsOptimizer: false,
              model: "music-2.5+" as const,
              history: [] as Array<{
                id: string;
                prompt: string;
                lyrics?: string;
                isInstrumental: boolean;
                lyricsOptimizer: boolean;
                audioUrl: string;
                createdAt: number;
              }>,
              selectedHistoryId: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "klingVideo" ||
            type === "kling26Video" ||
            type === "kling30Video" ||
            type === "viduVideo" ||
            type === "viduQ3" ||
            type === "doubaoVideo" ||
            type === "seedance20Video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              videoVersion: 0,
              history: [],
              clipDuration:
                type === "doubaoVideo" || type === "seedance20Video"
                  ? 5
                  : type === "klingVideo" || type === "kling26Video" || type === "kling30Video"
                  ? 5
                  : undefined,
              aspectRatio: undefined,
              provider:
                type === "viduVideo"
                  ? "vidu"
                  : type === "viduQ3"
                  ? "viduq3-pro"
                  : type === "doubaoVideo"
                  ? "doubao"
                  : type === "kling30Video"
                  ? "kling-o3"
                  : "kling",
              klingModel:
                type === "kling30Video" ? ("kling-v3-0" as const) : ("kling-v2-6" as const),
              mode:
                type === "klingVideo" || type === "kling26Video" || type === "kling30Video" ? ("std" as const) : undefined,
              sound:
                type === "klingVideo" || type === "kling26Video" || type === "kling30Video" ? true : undefined,
              audioUrls:
                type === "klingVideo" || type === "kling26Video" || type === "kling30Video" ? [] : undefined,
              // Vidu 专用参数
              viduModel:
                type === "viduVideo"
                  ? ("q2" as const)
                  : type === "viduQ3"
                  ? ("q3" as const)
                  : undefined,
              seedanceModel:
                type === "doubaoVideo"
                  ? ("seedance-1.5-pro" as const)
                  : type === "seedance20Video"
                  ? ("seedance-2.0" as const)
                  : undefined,
              seedanceMode:
                type === "seedance20Video"
                  ? ("reference_images" as const)
                  : type === "doubaoVideo"
                  ? ("text" as const)
                  : undefined,
              generateAudio: type === "seedance20Video" ? true : undefined,
              resolution:
                type === "viduVideo" || type === "viduQ3"
                  ? ("720p" as const)
                  : type === "seedance20Video" || type === "doubaoVideo"
                  ? ("720P" as const)
                  : undefined,
              style: type === "viduVideo" || type === "viduQ3" ? ("general" as const) : undefined,
              offPeak: type === "viduVideo" || type === "viduQ3" ? false : undefined,
              // Seedance 1.5 Pro专用参数
              camerafixed: type === "doubaoVideo" || type === "seedance20Video" ? false : undefined,
              watermark: type === "doubaoVideo" || type === "seedance20Video" ? false : undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "klingO1Video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              videoVersion: 0,
              history: [],
              clipDuration: 5,
              aspectRatio: undefined,
              mode: "std" as const,
              klingStoryboardMode: "single" as const,
              provider: "kling-o3",
              boxW: size.w,
              boxH: size.h,
            }
          : { boxW: size.w, boxH: size.h };
      const data = {
        ...baseData,
        ...(paletteDefaultData || {}),
        ...(paletteConfig
          ? (() => {
              const metadata =
                paletteConfig.metadata && typeof paletteConfig.metadata === "object"
                  ? (paletteConfig.metadata as Record<string, any>)
                  : undefined;
              const selectedManagedRoute = getManagedRouteOption(
                metadata,
                (paletteDefaultData as Record<string, any> | undefined)?.vendorKey
              );
              if (!selectedManagedRoute) return {};
              return {
                managedModelKey: metadata?.managedModelKey,
                vendorKey: selectedManagedRoute.vendorKey,
                platformKey:
                  selectedManagedRoute.platformKey || selectedManagedRoute.vendorKey,
                creditsPerCall: resolveNodeConfigCreditsPerCall(paletteConfig),
              };
            })()
          : {}),
        ...(paletteConfig
          ? {
              nodeConfigKey: paletteConfig.nodeKey,
              nodeConfigNameZh: paletteConfig.nameZh,
              nodeConfigNameEn: paletteConfig.nameEn,
              nodeConfigMetadata:
                paletteConfig.metadata && typeof paletteConfig.metadata === "object"
                  ? paletteConfig.metadata
                  : undefined,
            }
          : {}),
        boxW: size.w,
        boxH: size.h,
      };
      setNodes((ns) => ns.concat([{ id, type, position: pos, data } as any]));
      try {
        historyService.commit("flow-add-node").catch(() => {});
      } catch {}
      setAddPanel((v) => ({ ...v, visible: false }));
      return id;
    },
    [aiProvider, setNodes]
  );

  const textSourceTypes = React.useMemo(
    () => [
      "textPrompt",
      "textPromptPro",
      "textChat",
      "promptOptimize",
      "analysis",
      "videoAnalyze",
      "textNote",
      "storyboardSplit",
      "generate",
      "generatePro",
      "generatePro4",
    ],
    []
  );
  const videoSourceTypes = React.useMemo(
    () => [
      "video",
      "sora2Video",
      "wan26",
      "wan2R2V",
      "happyhorseR2V",
      "wan27Video",
      "klingVideo",
      "kling26Video",
      "kling30Video",
      "klingO1Video",
      "viduVideo",
      "seedance20Video",
      "doubaoVideo",
      "videoFrameExtract",
    ],
    []
  );
  const quickConnectMetaByType = React.useMemo(() => {
    const map = new Map<string, { label: string; status?: string }>();

    nodePaletteConfigs.forEach((config) => {
      const type = resolveFlowNodeTypeFromConfig(config);
      if (!type) return;
      map.set(type, {
        label: lt(config.nameZh || type, config.nameEn || type),
        status: config.status,
      });
    });

    NODE_PALETTE_ITEMS.forEach((item) => {
      if (map.has(item.key)) return;
      map.set(item.key, { label: lt(item.zh, item.en), status: "normal" });
    });

    BETA_NODE_ITEMS.forEach((item) => {
      if (map.has(item.key)) return;
      map.set(item.key, { label: lt(item.zh, item.en), status: "normal" });
    });

    return map;
  }, [lt, nodePaletteConfigs]);
  const inferQuickConnectSourceKind = React.useCallback(
    (sourceType?: string, sourceHandle?: string): QuickConnectSourceKind => {
      const handle = typeof sourceHandle === "string" ? sourceHandle.trim() : "";

      if (handle === "character") return "character";
      if (handle === "audio") return "audio";
      if (handle === "video" || handle.startsWith("video")) return "video";
      if (
        handle === "img" ||
        handle === "image" ||
        handle === "images" ||
        handle === "images-range" ||
        /^img\d+$/i.test(handle) ||
        /^image\d+$/i.test(handle)
      ) {
        return "image";
      }
      if (handle.startsWith("text") || handle.startsWith("prompt")) {
        return "text";
      }
      if (sourceType && textSourceTypes.includes(sourceType)) return "text";
      if (sourceType && videoSourceTypes.includes(sourceType)) return "video";
      return "unknown";
    },
    [textSourceTypes, videoSourceTypes]
  );
  const inferQuickConnectTargetKind = React.useCallback(
    (targetType?: string, targetHandle?: string): QuickConnectSourceKind => {
      const handle = typeof targetHandle === "string" ? targetHandle.trim() : "";
      if (!handle) return "unknown";

      if (targetType === "sora2Video" && handle === "character") {
        return "character";
      }
      if (handle === "audio") {
        return "audio";
      }
      if (handle === "video" || handle.startsWith("video")) {
        return "video";
      }
      if (
        handle === "img" ||
        handle === "image" ||
        handle === "images" ||
        handle === "images-range" ||
        handle === "image1" ||
        handle === "image2" ||
        handle === "refer" ||
        /^img\d+$/i.test(handle) ||
        /^image\d+$/i.test(handle)
      ) {
        return "image";
      }
      if (handle.startsWith("text") || handle.startsWith("prompt")) {
        return "text";
      }
      return "unknown";
    },
    []
  );
  const getForwardQuickConnectOptions = React.useCallback(
    (sourceId: string, sourceHandle?: string): QuickConnectMenuItem[] => {
      const sourceNode = rf.getNode(sourceId);
      if (!sourceNode) return [];

      const kind = inferQuickConnectSourceKind(sourceNode.type || "", sourceHandle);
      const presets = QUICK_CONNECT_PRESETS[kind] || QUICK_CONNECT_PRESETS.unknown;
      const picked: QuickConnectMenuItem[] = [];
      const seen = new Set<string>();

      for (const preset of presets) {
        const normalizedType = normalizeFlowNodeType(preset.nodeType);
        const resolvedType = normalizedType || preset.nodeType;
        if (!resolvedType) continue;
        if (!normalizedType && !(resolvedType in FLOW_NODE_DEFAULT_SIZE)) continue;
        const cacheKey = `${resolvedType}::${preset.targetHandle}`;
        if (seen.has(cacheKey)) continue;
        seen.add(cacheKey);

        const meta = quickConnectMetaByType.get(resolvedType);
        const status = meta?.status;
        const sourceConfig = nodePaletteConfigs.find(
          (config) => resolveFlowNodeTypeFromConfig(config) === resolvedType
        );
        if (
          HIDDEN_FLOW_NODE_TYPES.has(resolvedType as FlowNodeType) &&
          !isManagedPaletteConfig(sourceConfig)
        ) {
          continue;
        }
        if (
          status === "maintenance" ||
          status === "coming_soon" ||
          status === "disabled"
        ) {
          continue;
        }

        picked.push({
          nodeType: resolvedType,
          targetHandle: preset.targetHandle,
          label: meta?.label || resolvedType,
        });
      }

      const ranked = rankQuickConnectOptions(picked);
      return pinQuickConnectBaseOption(ranked, kind, "forward");
    },
    [
      rf,
      inferQuickConnectSourceKind,
      quickConnectMetaByType,
      rankQuickConnectOptions,
      pinQuickConnectBaseOption,
    ]
  );
  const getReverseQuickConnectOptions = React.useCallback(
    (targetId: string, targetHandle: string): QuickConnectMenuItem[] => {
      const targetNode = rf.getNode(targetId);
      if (!targetNode) return [];

      const kind = inferQuickConnectTargetKind(targetNode.type || "", targetHandle);
      const presets =
        QUICK_CONNECT_REVERSE_PRESETS[kind] || QUICK_CONNECT_REVERSE_PRESETS.unknown;
      const picked: QuickConnectMenuItem[] = [];
      const seen = new Set<string>();

      for (const preset of presets) {
        const normalizedType = normalizeFlowNodeType(preset.nodeType);
        const resolvedType = normalizedType || preset.nodeType;
        if (!resolvedType) continue;
        if (!normalizedType && !(resolvedType in FLOW_NODE_DEFAULT_SIZE)) continue;
        if (!preset.sourceHandle) continue;
        const cacheKey = `${resolvedType}::${preset.sourceHandle}`;
        if (seen.has(cacheKey)) continue;
        seen.add(cacheKey);

        const meta = quickConnectMetaByType.get(resolvedType);
        const status = meta?.status;
        const sourceConfig = nodePaletteConfigs.find(
          (config) => resolveFlowNodeTypeFromConfig(config) === resolvedType
        );
        if (
          HIDDEN_FLOW_NODE_TYPES.has(resolvedType as FlowNodeType) &&
          !isManagedPaletteConfig(sourceConfig)
        ) {
          continue;
        }
        if (
          status === "maintenance" ||
          status === "coming_soon" ||
          status === "disabled"
        ) {
          continue;
        }

        picked.push({
          nodeType: resolvedType,
          sourceHandle: preset.sourceHandle,
          label: meta?.label || resolvedType,
        });
      }

      const ranked = rankQuickConnectOptions(picked);
      return pinQuickConnectBaseOption(ranked, kind, "reverse");
    },
    [
      rf,
      inferQuickConnectTargetKind,
      quickConnectMetaByType,
      rankQuickConnectOptions,
      pinQuickConnectBaseOption,
    ]
  );
  React.useEffect(() => {
    if (!isConnecting) return;
    const anchor = connectAnchorRef.current;
    if (!anchor) return;

    const onMouseMove = (event: MouseEvent) => {
      if (connectQuickMenuVisibleRef.current) return;
      const x = event.clientX;
      const y = event.clientY;

      if (!isBlankArea(x, y)) {
        clearConnectHoverTimer();
        connectHoverAnchorRef.current = null;
        return;
      }

      const anchor = connectHoverAnchorRef.current;
      if (anchor && Math.hypot(anchor.x - x, anchor.y - y) < 14) {
        return;
      }
      connectHoverAnchorRef.current = { x, y };
      clearConnectHoverTimer();

      connectHoverTimerRef.current = window.setTimeout(() => {
        const latest = connectAnchorRef.current;
        if (!latest) return;
        if (!isBlankArea(x, y)) return;

        const options =
          latest.direction === "forward"
            ? getForwardQuickConnectOptions(latest.sourceId, latest.sourceHandle)
            : getReverseQuickConnectOptions(latest.targetId, latest.targetHandle);
        if (!options.length) return;
        setConnectQuickHoverKey(null);

        setConnectQuickMenu({
          visible: true,
          screen: { x, y },
          world: rf.screenToFlowPosition({ x, y }),
          alignEdge: latest.direction === "reverse" ? "right" : "left",
          options,
        });
      }, QUICK_CONNECT_HOVER_DELAY_MS);
    };

    window.addEventListener("mousemove", onMouseMove, true);
    return () => {
      window.removeEventListener("mousemove", onMouseMove, true);
      clearConnectHoverTimer();
      connectHoverAnchorRef.current = null;
    };
  }, [
    isConnecting,
    isBlankArea,
    clearConnectHoverTimer,
    getForwardQuickConnectOptions,
    getReverseQuickConnectOptions,
    rf,
  ]);

  const TEXT_PROMPT_MAX_CONNECTIONS = 20;
  const isTextHandle = React.useCallback(
    (handle?: string | null) =>
      typeof handle === "string" && handle.startsWith("text"),
    []
  );
  const normalizeHandleValue = React.useCallback((handle?: string | null) => {
    if (typeof handle !== "string") return "";
    return handle.trim().toLowerCase();
  }, []);

  const isTextSourceHandle = React.useCallback(
    (handle?: string | null) => {
      const value = normalizeHandleValue(handle);
      if (!value) return true;
      return (
        value === "text" ||
        value.startsWith("text") ||
        value.startsWith("prompt") ||
        value === "response-text" ||
        value === "result-text" ||
        value === "responsetext"
      );
    },
    [normalizeHandleValue]
  );

  const isImageSourceHandle = React.useCallback(
    (handle?: string | null) => {
      const value = normalizeHandleValue(handle);
      if (!value) return true;
      return (
        value === "img" ||
        value.startsWith("img") ||
        value === "image" ||
        value.startsWith("image") ||
        value === "refer" ||
        value === "omniimage" ||
        value === "cref" ||
        value === "elementimg"
      );
    },
    [normalizeHandleValue]
  );

  // 辅助函数：检查是否为图片相关的 handle（兼容 "image" 和 "img"）
  const isImageHandle = React.useCallback(
    (handle?: string | null): boolean => {
      if (!handle) return false;
      return handle === "image" || handle === "img";
    },
    []
  );

  const canKlingNodeUseAudioInput = React.useCallback((node?: Node | null) => {
    // Kling 2.6/3.0 的 sound 参数只支持 UI 布尔开关（sound=on/off），不接受连线输入
    return false;
  }, []);

  const isKling26Node = React.useCallback((node?: Node | null) => {
    if (!node) return false;
    const nodeData = (node.data || {}) as Record<string, any>;
    const klingModel =
      nodeData.klingModel ||
      (node.type === "kling30Video"
        ? "kling-v3-0"
        : node.type === "kling26Video" || nodeData.provider === "kling-2.6"
        ? "kling-v2-6"
        : "kling-v2-6");
    return klingModel === "kling-v2-6" || klingModel === "kling-v3-0";
  }, []);

  /** Kling 2.6/3.0 pro 模式支持首尾帧（image-2）；std 模式仅 1 张图 */
  const canKlingNodeUseImage2Input = React.useCallback((node?: Node | null) => {
    if (!node || (node.type !== "klingVideo" && node.type !== "kling26Video" && node.type !== "kling30Video")) {
      return false;
    }
    const nodeData = (node.data || {}) as Record<string, any>;
    const klingModel =
      nodeData.klingModel ||
      (node.type === "kling30Video"
        ? "kling-v3-0"
        : node.type === "kling26Video" || nodeData.provider === "kling-2.6"
        ? "kling-v2-6"
        : "kling-v2-6");
    const isKling26Model = klingModel === "kling-v2-6" || klingModel === "kling-v3-0";
    const mode = typeof nodeData.mode === "string" ? nodeData.mode : "std";
    return isKling26Model && mode === "pro";
  }, []);

  const isSeedance20ModeValue = React.useCallback(
    (value: unknown): value is Seedance20Mode =>
      typeof value === "string" && SEEDANCE20_MODE_VALUES.includes(value as Seedance20Mode),
    []
  );
  const isSeedance15ModeValue = React.useCallback(
    (value: unknown): value is Seedance15Mode =>
      typeof value === "string" && SEEDANCE15_MODE_VALUES.includes(value as Seedance15Mode),
    []
  );

  const isSeedanceVideoNode = React.useCallback((node?: Node | null): boolean => {
    if (!node) return false;
    const nodeData = (node.data || {}) as Record<string, any>;
    return (
      node.type === "doubaoVideo" ||
      node.type === "seedance20Video" ||
      nodeData.provider === "doubao"
    );
  }, []);

  const resolveSeedanceProfile = React.useCallback(
    (
      node?: Node | null
    ): {
      isSeedance20: boolean;
      model: "seedance-1.5-pro" | "seedance-2.0" | "seedance-2.0-fast";
    } | null => {
      if (!isSeedanceVideoNode(node)) return null;
      const nodeData = (node?.data || {}) as Record<string, any>;
      const model = normalizeSeedanceModelValue(nodeData.seedanceModel);
      return {
        isSeedance20: isSeedance20ModelValue(model),
        model,
      };
    },
    [isSeedanceVideoNode]
  );

  const inferSeedanceMode = React.useCallback(
    (node?: Node | null): SeedanceMode => {
      const profile = resolveSeedanceProfile(node);
      if (!node || !profile) return "text";

      const nodeData = (node.data || {}) as Record<string, any>;
      const legacyMode = String(nodeData.seedanceMode || "").trim().toLowerCase();
      if (profile.isSeedance20) {
        if (isSeedance20ModeValue(nodeData.seedanceMode)) {
          return nodeData.seedanceMode;
        }
        if (legacyMode === "start_end" || legacyMode === "first_frame") {
          return "start_end";
        }
        return "reference_images";
      }

      const explicitMode = isSeedance15ModeValue(nodeData.seedanceMode)
        ? nodeData.seedanceMode
        : undefined;
      if (explicitMode === "start_end") return "start_end";
      if (legacyMode === "start_end") return "start_end";
      if (legacyMode === "first_frame") return "start_end";
      if (legacyMode === "reference_images") return "image";

      const nodeEdges = rf.getEdges().filter((edge) => edge.target === node.id);
      const hasImage2 = nodeEdges.some((edge) => edge.targetHandle === "image-2");
      const totalImageCount = nodeEdges.filter(
        (edge) => edge.targetHandle === "image" || edge.targetHandle === "image-2"
      ).length;
      if (hasImage2) return "start_end";
      if (totalImageCount >= 2) return "start_end";
      if (totalImageCount === 1) return "image";
      if (explicitMode === "image") return "image";
      return "text";
    },
    [
      isSeedance15ModeValue,
      isSeedance20ModeValue,
      resolveSeedanceProfile,
      rf,
    ]
  );

  const getSeedanceModeSpec = React.useCallback(
    (node?: Node | null) => {
      const profile = resolveSeedanceProfile(node);
      if (!profile) {
        return {
          imageHandleMax: 0,
          image2HandleMax: 0,
          videoHandleMax: 0,
          audioHandleMax: 0,
        };
      }
      const mode = inferSeedanceMode(node);
      if (profile.isSeedance20) {
        if (mode === "start_end") {
          return {
            imageHandleMax: 2,
            image2HandleMax: 0,
            videoHandleMax: 0,
            audioHandleMax: 0,
          };
        }
        return {
          imageHandleMax: SEEDANCE20_REFERENCE_IMAGE_MAX,
          image2HandleMax: 0,
          videoHandleMax: SEEDANCE20_REFERENCE_VIDEO_MAX,
          audioHandleMax: SEEDANCE20_REFERENCE_AUDIO_MAX,
        };
      }
      if (mode === "image") {
        return {
          imageHandleMax: 1,
          image2HandleMax: 0,
          videoHandleMax: 0,
          audioHandleMax: 0,
        };
      }
      if (mode === "start_end") {
        return {
          imageHandleMax: 1,
          image2HandleMax: 1,
          videoHandleMax: 0,
          audioHandleMax: 0,
        };
      }
      return {
        imageHandleMax: 1,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
    },
    [inferSeedanceMode, resolveSeedanceProfile]
  );

  const appendSora2History = React.useCallback(
    (
      history: Sora2VideoHistoryItem[] | undefined,
      entry: Sora2VideoHistoryItem
    ): Sora2VideoHistoryItem[] => {
      const base = Array.isArray(history) ? history : [];
      const deduped = base.filter((item) => item.videoUrl !== entry.videoUrl);
      return [entry, ...deduped].slice(0, SORA2_HISTORY_LIMIT);
    },
    []
  );

  const getVideoHistoryKey = React.useCallback(
    (videoUrl?: string | null): string => {
      if (typeof videoUrl !== "string") return "";
      const normalized = normalizeStableRemoteUrl(videoUrl);
      const trimmed = normalized.trim();
      if (!trimmed) return "";
      try {
        const parsed = new URL(
          trimmed,
          typeof window !== "undefined" ? window.location.origin : "http://localhost"
        );
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        const withoutHash = trimmed.split("#")[0] || trimmed;
        return withoutHash.split("?")[0] || withoutHash;
      }
    },
    [normalizeStableRemoteUrl]
  );

  const appendVideoHistory = React.useCallback(
    (history: Array<Record<string, any>> | undefined, entry: Record<string, any>) => {
      const base = Array.isArray(history) ? history : [];
      const entryKey = getVideoHistoryKey(entry?.videoUrl);
      if (!entryKey) return [entry, ...base];
      const deduped = base.filter(
        (item) => getVideoHistoryKey(item?.videoUrl) !== entryKey
      );
      return [entry, ...deduped];
    },
    [getVideoHistoryKey]
  );

  // 允许 TextPrompt -> Generate(text); Image/Generate(img) -> Generate(img)
  const isValidConnection = React.useCallback(
    (connection: Connection) => {
      const { source, target, targetHandle, sourceHandle } = connection;
      if (!source || !target || !targetHandle) return false;
      if (source === target) return false;

      const sourceNode = rf.getNode(source);
      const targetNode = rf.getNode(target);
      if (!sourceNode || !targetNode) return false;

      const canSourceProvideText = (
        node: typeof sourceNode,
        handle?: string | null
      ) =>
        textSourceTypes.includes(node.type || "") &&
        isTextSourceHandle(handle);

      // 检查是否为有效的图片源节点
      const isImageSource = (
        node: typeof sourceNode,
        handle?: string | null
      ) => {
        if (!isImageSourceHandle(handle)) return false;
        const imageNodeTypes = [
          "image",
          "imagePro",
          "generate",
          "generate4",
          "generatePro",
          "generatePro4",
          "generateRef",
          "viewAngle",
          "three",
          "threePathTracer",
          "camera",
          "imageGrid",
          "imageSplit",
          "imageCompress",
          "midjourney",
          "midjourneyV7",
          "niji7",
          "nano2",
          "gptImage2",
          "seedream5",
        ];
        if (imageNodeTypes.includes(node.type || "")) return true;
        // videoFrameExtract 的 image 句柄输出单张图片
        if (node.type === "videoFrameExtract" && handle === "image")
          return true;
        return false;
      };

      // 允许连接到 Generate / Generate4 / GenerateRef / Image / PromptOptimizer
      if (targetNode.type === "generateRef") {
        if (targetHandle === "text")
          return canSourceProvideText(sourceNode, sourceHandle);
        if (targetHandle === "image1" || targetHandle === "refer")
          return isImageSource(sourceNode, sourceHandle);
        if (targetHandle === "image2" || targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (
        targetNode.type === "generate" ||
        targetNode.type === "generate4" ||
        targetNode.type === "generatePro" ||
        targetNode.type === "generatePro4"
      ) {
        if (targetHandle === "text")
          return canSourceProvideText(sourceNode, sourceHandle);
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "viewAngle") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "sora2Video") {
        const sora2GenerationType = getSora2GenerationType(targetNode.data);

        if (sora2GenerationType === "sora2-create-character") {
          if (targetHandle !== "video") return false;
          if (sourceHandle !== "video" && sourceHandle !== "video-out") return false;
          return [
            "video",
            "sora2Video",
      "wan26",
      "wan2R2V",
      "happyhorseR2V",
      "wan27Video",
      "klingVideo",
            "kling26Video",
            "kling30Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
            "seedance20Video",
          ].includes(sourceNode.type || "");
        }

        if (targetHandle === "character") {
          if (sourceHandle === "character") {
            return sourceNode.type === "sora2Video" || sourceNode.type === "sora2Character";
          }
          if (sourceHandle !== "video" && sourceHandle !== "video-out") {
            return false;
          }
          return [
      "video",
      "sora2Video",
      "wan26",
      "wan2R2V",
      "happyhorseR2V",
      "wan27Video",
      "klingVideo",
            "kling26Video",
            "kling30Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
            "seedance20Video",
          ].includes(sourceNode.type || "");
        }

        if (isImageHandle(targetHandle)) {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        return false;
      }

      if (targetNode.type === "sora2Character") {
        if (targetHandle === "video") {
          if (sourceHandle !== "video") return false;
          return [
            "video",
            "sora2Video",
            "wan26",
            "wan2R2V",
            "happyhorseR2V",
            "wan27Video",
            "klingVideo",
            "kling26Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
          ].includes(sourceNode.type || "");
        }
        return false;
      }

      if (targetNode.type === "wan26") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (isImageHandle(targetHandle)) {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "audio") {
          if (sourceHandle !== "audio") return false;
          return ["audioUpload", "minimaxSpeech", "tencentSpeech", "minimaxMusic"].includes(
            sourceNode.type || ""
          );
        }
        return false;
      }

      if (targetNode.type === "wan27Video") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (targetHandle === "image" || targetHandle === "image-2") {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "video") {
          if (sourceHandle !== "video" && sourceHandle !== "video-out") return false;
          return [
            "video",
            "sora2Video",
            "wan26",
            "wan2R2V",
            "happyhorseR2V",
            "wan27Video",
            "klingVideo",
            "kling26Video",
            "kling30Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
            "seedance20Video",
          ].includes(sourceNode.type || "");
        }
        if (targetHandle === "audio") {
          if (sourceHandle !== "audio") return false;
          return ["audioUpload", "minimaxSpeech", "tencentSpeech", "minimaxMusic"].includes(
            sourceNode.type || ""
          );
        }
        return false;
      }

      if (targetNode.type === "audioUpload") {
        if (targetHandle === "audio") {
          if (sourceHandle !== "audio") return false;
          return ["audioUpload", "minimaxSpeech", "tencentSpeech", "minimaxMusic"].includes(
            sourceNode.type || ""
          );
        }
        return false;
      }

      if (targetNode.type === "wan2R2V") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (
          targetHandle === "video-1" ||
          targetHandle === "video-2" ||
          targetHandle === "video-3"
        ) {
          if (sourceHandle !== "video") return false;
          return [
            "video", // 上传视频
            "sora2Video",
            "wan2R2V",
            "happyhorseR2V",
            "wan26",
            "wan27Video",
            "klingVideo",
            "kling26Video",
            "kling30Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
            "seedance20Video",
          ].includes(sourceNode.type || "");
        }
        return false;
      }

      if (targetNode.type === "happyhorseR2V") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (
          typeof targetHandle === "string" &&
          /^image-\d+$/.test(targetHandle)
        ) {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "video") {
          // video-edit 模式下接受视频源
          if (sourceHandle !== "video" && sourceHandle !== "video-out") return false;
          return VIDEO_SOURCE_NODE_TYPES.includes(sourceNode.type || "");
        }
        return false;
      }

      if (isSeedanceVideoNode(targetNode)) {
        const spec = getSeedanceModeSpec(targetNode);
        const incomingCount = rf
          .getEdges()
          .filter(
            (edge) => edge.target === targetNode.id && edge.targetHandle === targetHandle
          ).length;
        if (targetHandle === "image") {
          if (spec.imageHandleMax <= 0) return false;
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "image-2") {
          if (spec.image2HandleMax <= 0) return false;
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "video") {
          if (spec.videoHandleMax <= 0 || incomingCount >= spec.videoHandleMax) return false;
          if (sourceHandle !== "video" && sourceHandle !== "video-out") return false;
          return VIDEO_SOURCE_NODE_TYPES.includes(sourceNode.type || "");
        }
        if (targetHandle === "audio") {
          if (spec.audioHandleMax <= 0 || incomingCount >= spec.audioHandleMax) return false;
          if (sourceHandle !== "audio") return false;
          return ["audioUpload", "minimaxSpeech", "tencentSpeech", "minimaxMusic"].includes(
            sourceNode.type || ""
          );
        }
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        return false;
      }

      if (
        ["klingVideo", "kling26Video", "kling30Video", "viduVideo", "viduQ3", "doubaoVideo"].includes(
          targetNode.type || ""
        )
      ) {
        if (targetHandle === "image-2") {
          // Vidu 固定用 image/image-2 表达图1/图2；Kling 仅 2.6/3.0 pro 可用 image-2
          if (targetNode.type === "viduVideo" || targetNode.type === "viduQ3") {
            return isImageSource(sourceNode, sourceHandle);
          }
          if (!canKlingNodeUseImage2Input(targetNode)) return false;
          return isImageSource(sourceNode, sourceHandle);
        }
        if (isImageHandle(targetHandle)) {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (targetHandle === "audio") {
          if (!canKlingNodeUseAudioInput(targetNode)) return false;
          if (sourceHandle !== "audio") return false;
          return ["audioUpload", "minimaxSpeech", "tencentSpeech", "minimaxMusic"].includes(
            sourceNode.type || ""
          );
        }
        return false;
      }

      // Kling O1 视频节点连接验证 - 支持文本、图片和视频输入
      if (targetNode.type === "klingO1Video") {
        if (isImageHandle(targetHandle) || targetHandle === "elementImg") {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (targetHandle === "video") {
          // 允许从视频节点连接
          return [
            "video",
            "sora2Video",
            "wan26",
            "wan2R2V",
            "happyhorseR2V",
            "wan27Video",
            "klingVideo",
            "kling26Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
          ].includes(sourceNode.type || "");
        }
        return false;
      }

      // Nano2 节点连接验证 - 支持文本和图片输入
      if (targetNode.type === "nano2" || targetNode.type === "gptImage2") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (targetHandle === "img") {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      // Midjourney 节点连接验证 - 仅支持文本输入
      if (targetNode.type === "midjourney") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "midjourneyV7" || targetNode.type === "niji7") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (
          targetHandle === "img" ||
          targetHandle === "omniImage" ||
          targetHandle === "omniimage"
        ) {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "seedream5") {
        if (targetHandle === "prompt") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (targetHandle === "img") {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "minimaxSpeech") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "tencentSpeech") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        if (targetHandle === "video") {
          return ["video", "sora2Video", "wan26", "wan2R2V", "happyhorseR2V", "wan27Video", "klingVideo", "kling26Video", "kling30Video", "klingO1Video", "viduVideo", "viduQ3", "doubaoVideo", "seedance20Video"].includes(sourceNode.type || "");
        }
        return false;
      }
      if (targetNode.type === "minimaxMusic") {
        if (targetHandle === "text") {
          return canSourceProvideText(sourceNode, sourceHandle);
        }
        return false;
      }

      if (targetNode.type === "image") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "imagePro") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "promptOptimize") {
        if (isTextHandle(targetHandle))
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "textPrompt") {
        if (isTextHandle(targetHandle))
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "textPromptPro") {
        if (isTextHandle(targetHandle))
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "analysis") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        if (targetHandle === "text")
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "videoAnalyze") {
        if (targetHandle === "video")
          return [
            "video", // 上传视频
            "sora2Video",
            "klingVideo",
            "kling26Video",
            "kling30Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
            "seedance20Video",
            "wan26",
            "wan2R2V",
            "happyhorseR2V",
            "wan27Video",
          ].includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "videoFrameExtract") {
        if (targetHandle === "video") {
          // Accept video inputs from any video-producing node types (uploads and provider nodes)
          const allowedVideoSourceTypes = [
            "video", // uploaded/local video node
            "sora2Video",
            "wan26",
            "wan2R2V",
            "happyhorseR2V",
            "wan27Video",
            "klingVideo",
            "kling26Video",
            "kling30Video",
            "klingO1Video",
            "viduVideo",
            "viduQ3",
            "doubaoVideo",
            "seedance20Video",
            "genericVideo",
            "seedanceVideo",
          ];
          return allowedVideoSourceTypes.includes(sourceNode.type || "");
        }
        return false;
      }
      if (targetNode.type === "videoToGif") {
        if (targetHandle === "video") {
          if (sourceHandle !== "video" && sourceHandle !== "video-out") return false;
          return (
            VIDEO_SOURCE_NODE_TYPES.includes(sourceNode.type || "") ||
            sourceNode.type === "genericVideo" ||
            sourceNode.type === "seedanceVideo"
          );
        }
        return false;
      }
      if (targetNode.type === "imageGrid") {
        if (targetHandle === "images") {
          // videoFrameExtract 支持单帧/多帧输出
          if (sourceNode.type === "videoFrameExtract") {
            return (
              sourceHandle === "image" ||
              sourceHandle === "images" ||
              sourceHandle === "images-range"
            );
          }
          // imageSplit 输出为 image1..imageN
          if (sourceNode.type === "imageSplit") {
            return (
              typeof sourceHandle === "string" &&
              /^image\d+$/.test(sourceHandle)
            );
          }
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "imageSplit") {
        if (targetHandle === "img") {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "imageCompress") {
        if (targetHandle === "img") {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "textChat") {
        if (isTextHandle(targetHandle))
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "textNote") {
        if (isTextHandle(targetHandle))
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "storyboardSplit") {
        if (isTextHandle(targetHandle))
          return canSourceProvideText(sourceNode, sourceHandle);
        return false;
      }
      return false;
    },
    [
      rf,
      isTextHandle,
      isImageHandle,
      textSourceTypes,
      isTextSourceHandle,
      isImageSourceHandle,
      canKlingNodeUseAudioInput,
      canKlingNodeUseImage2Input,
      getSeedanceModeSpec,
      isSeedanceVideoNode,
    ]
  );

  // 限制：Generate(text) 仅一个连接；Generate(img) 最多6条
  const canAcceptConnection = React.useCallback(
    (params: Connection) => {
      if (!params.target || !params.targetHandle) return false;
      const targetNode = rf.getNode(params.target);
      const currentEdges = rf.getEdges();
      const incoming = currentEdges.filter(
        (e) =>
          e.target === params.target && e.targetHandle === params.targetHandle
      );
      if (
        targetNode?.type === "generate" ||
        targetNode?.type === "generate4" ||
        targetNode?.type === "generatePro" ||
        targetNode?.type === "generatePro4"
      ) {
        if (params.targetHandle === "text") return true; // 允许连接，新线会替换旧线
        if (params.targetHandle === "img") return incoming.length < 6;
      }
      if (targetNode?.type === "generateRef") {
        const handle = params.targetHandle;
        if (handle === "text") return true;
        if (handle === "image1" || handle === "refer") return true;
        if (handle === "image2" || handle === "img") return true;
      }
      if (targetNode?.type === "image") {
        if (params.targetHandle === "img") return true; // 允许连接，新线会替换旧线
      }
      if (targetNode?.type === "imagePro") {
        if (params.targetHandle === "img") return true; // 允许连接，新线会替换旧线
      }
      if (targetNode?.type === "viewAngle") {
        if (params.targetHandle === "img") return true; // 允许连接，新线会替换旧线
      }
      if (targetNode?.type === "promptOptimize") {
        if (isTextHandle(params.targetHandle)) return true; // 仅一条连接，后续替换
      }
      if (targetNode?.type === "textPrompt") {
        if (isTextHandle(params.targetHandle))
          return incoming.length < TEXT_PROMPT_MAX_CONNECTIONS;
      }
      if (targetNode?.type === "textPromptPro") {
        if (isTextHandle(params.targetHandle))
          return incoming.length < TEXT_PROMPT_MAX_CONNECTIONS;
      }
      if (targetNode?.type === "textNote") {
        if (isTextHandle(params.targetHandle)) return true;
      }
      if (targetNode?.type === "sora2Video") {
        const sora2GenerationType = getSora2GenerationType(targetNode.data);

        if (sora2GenerationType === "sora2-create-character") {
          if (params.targetHandle === "video") return true;
          return false;
        }

        // 类型校验由 isValidConnection 负责；这里仅做容量/替换策略控制
        if (isImageHandle(params.targetHandle)) return true;
        if (params.targetHandle === "text") return true;
        if (params.targetHandle === "character") return true;
      }
      if (targetNode?.type === "sora2Character") {
        if (params.targetHandle === "video") return true;
      }
      if (targetNode?.type === "wan26") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (isImageHandle(params.targetHandle)) return true; // 新线会替换旧线
        if (params.targetHandle === "audio") return true; // 新线会替换旧线
      }
      if (targetNode?.type === "wan27Video") {
        if (params.targetHandle === "text") return true;
        if (
          params.targetHandle === "image" ||
          params.targetHandle === "image-2" ||
          params.targetHandle === "video" ||
          params.targetHandle === "audio"
        ) {
          return true;
        }
      }
      if (targetNode?.type === "audioUpload") {
        if (params.targetHandle === "audio") return true; // 新线会替换旧线
      }
      if (targetNode?.type === "wan2R2V") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (params.targetHandle.startsWith("video-")) return true; // 每个 video-* 句柄最多一个，onConnect 会替换
      }
      if (targetNode?.type === "happyhorseR2V") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (params.targetHandle.startsWith("image-")) return true; // 每个 image-N 句柄最多一个
        if (params.targetHandle === "video") return true; // video-edit 模式：唯一一个 video 输入
      }
      // Vidu 视频节点：图1/图2双句柄，每个句柄最多 1 条，总数受模型上限控制
      if (targetNode?.type === "viduVideo") {
        const targetData = ((targetNode.data || {}) as Record<string, any>);
        const maxImages = getEffectiveViduMaxReferenceImages(targetData);
        if (params.targetHandle === "image" || params.targetHandle === "image-2") {
          const sameHandleCount = edges.filter(
            (e) => e.target === params.target && e.targetHandle === params.targetHandle
          ).length;
          const totalImageCount = edges.filter(
            (e) => e.target === params.target && (e.targetHandle === "image" || e.targetHandle === "image-2")
          ).length;
          const projectedTotal = totalImageCount - sameHandleCount + 1;
          return projectedTotal <= maxImages;
        }
        if (params.targetHandle === "text") return true;
      }

      // Vidu Q3 视频节点：图1/图2双句柄，每个句柄最多 1 条，总数最多 2 条
      if (targetNode?.type === "viduQ3") {
        if (params.targetHandle === "image" || params.targetHandle === "image-2") {
          const sameHandleCount = edges.filter(
            (e) => e.target === params.target && e.targetHandle === params.targetHandle
          ).length;
          const totalImageCount = edges.filter(
            (e) => e.target === params.target && (e.targetHandle === "image" || e.targetHandle === "image-2")
          ).length;
          const projectedTotal = totalImageCount - sameHandleCount + 1;
          return projectedTotal <= VIDUQ3_MAX_REFERENCE_IMAGES;
        }
        if (params.targetHandle === "text") return true;
      }
      // Kling 视频节点：std 最多 1 张图，pro 最多 2 张（image + image-2）
      if (targetNode?.type === "klingVideo" || targetNode?.type === "kling26Video" || targetNode?.type === "kling30Video") {
        const nodeData = (targetNode.data || {}) as Record<string, any>;
        const klingModel =
          nodeData.klingModel ||
          (targetNode.type === "kling30Video"
            ? "kling-v3-0"
            : targetNode.type === "kling26Video" || nodeData.provider === "kling-2.6"
            ? "kling-v2-6"
            : "kling-v2-6");
        const isKling26Model = klingModel === "kling-v2-6" || klingModel === "kling-v3-0";
        const mode = typeof nodeData.mode === "string" ? nodeData.mode : "std";

        // Kling 视频节点：每个 handle 最多 1 张图（image 首帧 / image-2 尾帧）
        if (params.targetHandle === "image" || params.targetHandle === "image-2") {
          if (!isImageHandle(params.targetHandle) && params.targetHandle !== "image-2") return false;
          if (params.targetHandle === "image-2") {
            if (!isKling26Model || mode !== "pro") return false;
          }
          // 同一个 handle 只能连 1 张图（不能重复连线替换）
          return incoming.length < 1;
        }
        if (params.targetHandle === "text") return true;
        if (params.targetHandle === "audio") {
          if (!canKlingNodeUseAudioInput(targetNode)) return false;
          return incoming.length < KLING_MAX_AUDIO_INPUTS;
        }
      }
      // Kling O1 视频节点：支持最多 7 张参考图 + 视频输入
      if (targetNode?.type === "klingO1Video") {
        if (params.targetHandle === "image" || params.targetHandle === "elementImg") {
          // 计算image和elementImg的总连接数
          const totalImageConnections = edges.filter(
            (e) => e.target === params.target && (e.targetHandle === "image" || e.targetHandle === "elementImg")
          ).length;
          return totalImageConnections < 7; // 总共最多 7 张图片
        }
        if (params.targetHandle === "text") return true;
        if (params.targetHandle === "video") return incoming.length < 1; // 只支持 1 个视频
      }
      if (isSeedanceVideoNode(targetNode)) {
        const spec = getSeedanceModeSpec(targetNode);
        if (params.targetHandle === "text") return true;
        if (params.targetHandle === "image") {
          if (spec.imageHandleMax <= 0) return false;
          return (
            currentEdges.filter(
              (edge) => edge.target === params.target && edge.targetHandle === "image"
            ).length < spec.imageHandleMax
          );
        }
        if (params.targetHandle === "image-2") {
          if (spec.image2HandleMax <= 0) return false;
          return (
            currentEdges.filter(
              (edge) => edge.target === params.target && edge.targetHandle === "image-2"
            ).length < spec.image2HandleMax
          );
        }
        if (params.targetHandle === "video") {
          return (
            spec.videoHandleMax > 0 &&
            currentEdges.filter(
              (edge) => edge.target === params.target && edge.targetHandle === "video"
            ).length < spec.videoHandleMax
          );
        }
        if (params.targetHandle === "audio") {
          return (
            spec.audioHandleMax > 0 &&
            currentEdges.filter(
              (edge) => edge.target === params.target && edge.targetHandle === "audio"
            ).length < spec.audioHandleMax
          );
        }
      }
      // Doubao 视频节点
      if (targetNode?.type === "doubaoVideo") {
        if (params.targetHandle === "image") return true;
        if (params.targetHandle === "text") return true;
      }
      // Midjourney 节点连接容量控制 - 只支持文本输入
      if (targetNode?.type === "midjourney") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
      }
      // Seedream5 节点连接容量控制
      if (targetNode?.type === "seedream5") {
        if (params.targetHandle === "prompt") return true; // 新线会替换旧线
        if (params.targetHandle === "img") return true; // 图片输入支持多条
      }
      // Nano2 节点连接容量控制 - 支持文本和图片输入
      if (targetNode?.type === "midjourneyV7" || targetNode?.type === "niji7") {
        if (params.targetHandle === "text") return true;
        if (params.targetHandle === "img") return incoming.length < 10;
        if (
          params.targetHandle === "omniImage" ||
          params.targetHandle === "omniimage"
        )
          return true;
      }
      if (targetNode?.type === "nano2" || targetNode?.type === "gptImage2") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (params.targetHandle === "img") return true; // 图片输入
      }
      if (targetNode?.type === "minimaxSpeech") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
      }
      if (targetNode?.type === "tencentSpeech") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (params.targetHandle === "video") return true; // 仅一条视频连接
      }
      if (targetNode?.type === "minimaxMusic") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
      }
      if (targetNode?.type === "analysis") {
        if (params.targetHandle === "img") return true; // 支持多图输入
        if (params.targetHandle === "text") return true; // 追加提示词输入，新线替换旧线
      }
      if (targetNode?.type === "videoAnalyze") {
        if (params.targetHandle === "video") return true; // 仅一条视频连接
      }
      if (targetNode?.type === "videoFrameExtract") {
        if (params.targetHandle === "video") return true; // 仅一条视频连接
      }
      if (targetNode?.type === "videoToGif") {
        if (params.targetHandle === "video") return true; // 仅一条视频连接
      }
      if (targetNode?.type === "imageGrid") {
        if (params.targetHandle === "images") return true; // 允许多条图片连接
      }
      if (targetNode?.type === "imageSplit") {
        if (params.targetHandle === "img") return true; // 仅一条图片连接
      }
      if (targetNode?.type === "imageCompress") {
        if (params.targetHandle === "img") return true; // 仅一条图片连接
      }
      if (targetNode?.type === "textChat") {
        if (isTextHandle(params.targetHandle)) return true;
      }
      if (targetNode?.type === "storyboardSplit") {
        if (isTextHandle(params.targetHandle)) return true;
      }
      return false;
    },
    [
      rf,
      edges,
      isTextHandle,
      isImageHandle,
      canKlingNodeUseAudioInput,
      canKlingNodeUseImage2Input,
      getSeedanceModeSpec,
      isSeedanceVideoNode,
    ]
  );

  const onConnect = React.useCallback(
    (params: Connection) => {
      if (!isValidConnection(params)) return;
      if (!canAcceptConnection(params)) {
        const targetNode = params.target ? rf.getNode(params.target) : undefined;
        if (
          targetNode &&
          (targetNode.type === "klingVideo" || targetNode.type === "kling26Video" || targetNode.type === "kling30Video") &&
          params.targetHandle === "audio"
        ) {
          const canUseAudio = canKlingNodeUseAudioInput(targetNode);
          const incomingAudioCount = rf
            .getEdges()
            .filter((e) => e.target === params.target && e.targetHandle === "audio").length;
          if (!canUseAudio || incomingAudioCount >= KLING_MAX_AUDIO_INPUTS) {
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: {
                  message: canUseAudio
                    ? lt("Kling 音频最多连接 2 条", "Kling audio supports up to 2 connections")
                    : lt(
                        "Kling 2.6/3.0 仅支持 sound 开关，暂不支持音频连线输入",
                        "Kling 2.6/3.0 only supports sound toggle, audio connection is not supported"
                      ),
                  type: "warning",
                },
              })
            );
          }
        }
        return;
      }
      closeConnectQuickMenu({ resetSource: true });

      setEdges((eds) => {
        let next = eds;
        const tgt = rf.getNode(params.target!);

        // 如果是连接到 Image(img)，先移除旧的输入线，再添加新线
        if (
          (tgt?.type === "image" ||
            tgt?.type === "imagePro" ||
            tgt?.type === "viewAngle") &&
          params.targetHandle === "img"
        ) {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "img")
          );
        }

        // 如果是连接到 videoAnalyze(video)，先移除旧的输入线，再添加新线
        if (tgt?.type === "videoAnalyze" && params.targetHandle === "video") {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "video")
          );
        }

        // 如果是连接到 videoFrameExtract(video)，先移除旧的输入线，再添加新线
        if (
          tgt?.type === "videoFrameExtract" &&
          params.targetHandle === "video"
        ) {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "video")
          );
        }
        if (tgt?.type === "videoToGif" && params.targetHandle === "video") {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "video")
          );
        }

        // 如果是连接到 Generate(text) 或 PromptOptimize(text)，先移除旧的输入线，再添加新线
        // 注意：generatePro 和 generatePro4 允许多个 text 输入，不移除旧连接
        const singleTextInputTypes = [
          "generate",
          "generate4",
          "generateRef",
          "promptOptimize",
          "textNote",
          "sora2Video",
          "wan26",
          "wan2R2V",
          "happyhorseR2V",
          "wan27Video",
          "storyboardSplit",
          "midjourney",
          "midjourneyV7",
          "niji7",
          "klingVideo",
          "kling26Video",
          "viduVideo",
          "doubaoVideo",
          "seedance20Video",
          "minimaxSpeech",
          "tencentSpeech",
          "minimaxMusic",
        ];
        if (
          singleTextInputTypes.includes(tgt?.type || "") &&
          isTextHandle(params.targetHandle)
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        if (tgt?.type === "sora2Video" && params.targetHandle === "character") {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === "character"
              )
          );
        }
        if (tgt?.type === "sora2Video" && params.targetHandle === "video") {
          const generationType = getSora2GenerationType(tgt.data);
          if (generationType === "sora2-create-character") {
            next = next.filter(
              (e) =>
                !(
                  e.target === params.target &&
                  e.targetHandle !== undefined
                )
            );
            next = next.filter(
              (e) =>
                !(
                  e.target === params.target &&
                  e.targetHandle === undefined
                )
            );
          }
        }
        if (tgt?.type === "sora2Character" && params.targetHandle === "video") {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle !== undefined
              )
          );
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === undefined
              )
          );
        }
        // Vidu 视频节点：image/image-2 各保留 1 条（新线替换旧线）
        if (
          tgt?.type === "viduVideo" &&
          (params.targetHandle === "image" || params.targetHandle === "image-2")
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        // Vidu Q3 视频节点：image/image-2 各保留 1 条（新线替换旧线）
        if (
          tgt?.type === "viduQ3" &&
          (params.targetHandle === "image" || params.targetHandle === "image-2")
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        // Kling 视频节点：std 最多 1 张图，pro 最多 2 张（image + image-2）
        if ((tgt?.type === "klingVideo" || tgt?.type === "kling26Video") &&
            (params.targetHandle === "image" || params.targetHandle === "image-2")) {
          const nodeData = (tgt.data || {}) as Record<string, any>;
          const klingModel =
            nodeData.klingModel ||
            (tgt?.type === "kling26Video" || nodeData.provider === "kling-2.6"
              ? "kling-v2-6"
              : "kling-v2-6");
          const isKling26Model = klingModel === "kling-v2-6" || klingModel === "kling-v3-0";
          const mode = typeof nodeData.mode === "string" ? nodeData.mode : "std";
          const maxImages = isKling26Model && mode === "pro" ? 2 : 1;
          // image-2 只能在 pro 模式下接，不能替换 image
          if (params.targetHandle === "image-2" && !(isKling26Model && mode === "pro")) {
            return;
          }
          const imgEdges = next.filter(
            (e) => e.target === params.target && (e.targetHandle === "image" || e.targetHandle === "image-2")
          );
          let remainingToDrop = Math.max(0, imgEdges.length - maxImages + 1);
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isImgEdge =
                e.target === params.target && (e.targetHandle === "image" || e.targetHandle === "image-2");
              if (isImgEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        // Kling O1 视频节点：支持最多 7 张参考图
        if (tgt?.type === "klingO1Video" && params.targetHandle === "image") {
          let remainingToDrop = Math.max(
            0,
            next.filter(
              (e) => e.target === params.target && e.targetHandle === "image"
            ).length -
              7 + // Kling O1 支持最多 7 张图片
              1 // +1 for the incoming edge
          );
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isImageEdge =
                e.target === params.target && e.targetHandle === "image";
              if (isImageEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        // Kling O1 视频节点：elementImg 支持最多 7 张参考图
        if (tgt?.type === "klingO1Video" && params.targetHandle === "elementImg") {
          let remainingToDrop = Math.max(
            0,
            next.filter(
              (e) => e.target === params.target && e.targetHandle === "elementImg"
            ).length -
              7 + // elementImg 支持最多 7 张图片
              1 // +1 for the incoming edge
          );
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isElementImgEdge =
                e.target === params.target && e.targetHandle === "elementImg";
              if (isElementImgEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        if (
          isSeedanceVideoNode(tgt) &&
          (params.targetHandle === "image" ||
            params.targetHandle === "image-2" ||
            params.targetHandle === "video" ||
            params.targetHandle === "audio")
        ) {
          const spec = getSeedanceModeSpec(tgt);
          const applyHandleLimit = (handle: "image" | "image-2" | "video" | "audio", max: number) => {
            if (max <= 0) {
              next = next.filter(
                (e) => !(e.target === params.target && e.targetHandle === handle)
              );
              return;
            }
            if (max === 1) {
              next = next.filter(
                (e) => !(e.target === params.target && e.targetHandle === handle)
              );
              return;
            }
            let remainingToDrop = Math.max(
              0,
              next.filter((e) => e.target === params.target && e.targetHandle === handle).length -
                max +
                1
            );
            if (remainingToDrop <= 0) return;
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              if (e.target === params.target && e.targetHandle === handle) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          };

          if (params.targetHandle === "image") {
            applyHandleLimit("image", spec.imageHandleMax);
          } else if (params.targetHandle === "image-2") {
            applyHandleLimit("image-2", spec.image2HandleMax);
          } else if (params.targetHandle === "video") {
            applyHandleLimit("video", spec.videoHandleMax);
          } else if (params.targetHandle === "audio") {
            applyHandleLimit("audio", spec.audioHandleMax);
          }

          if (params.targetHandle === "image" || params.targetHandle === "image-2") {
            const maxImages = spec.imageHandleMax + spec.image2HandleMax;
            if (maxImages > 0) {
              let remainingToDrop = Math.max(
                0,
                next.filter(
                  (e) =>
                    e.target === params.target &&
                    (e.targetHandle === "image" || e.targetHandle === "image-2")
                ).length -
                  maxImages +
                  1
              );
              if (remainingToDrop > 0) {
                next = next.filter((e) => {
                  if (remainingToDrop <= 0) return true;
                  const isSeedanceImageEdge =
                    e.target === params.target &&
                    (e.targetHandle === "image" || e.targetHandle === "image-2");
                  if (isSeedanceImageEdge) {
                    remainingToDrop -= 1;
                    return false;
                  }
                  return true;
                });
              }
            }
          }
        }
        // Sora2 视频节点：限制参考图数量
        if (
          tgt?.type === "sora2Video" &&
          params.targetHandle === "image"
        ) {
          // 允许多条 image 连接，但限制总数；超过时移除最早的
          let remainingToDrop = Math.max(
            0,
            next.filter(
              (e) => e.target === params.target && isImageHandle(e.targetHandle)
            ).length -
              SORA2_MAX_REFERENCE_IMAGES +
              1 // +1 for the incoming edge
          );
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isImageEdge =
                e.target === params.target && isImageHandle(e.targetHandle);
              if (isImageEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        // Kling O1 视频节点：视频输入只允许 1 条，并更新 hasVideoInput 状态
        if (tgt?.type === "klingO1Video" && params.targetHandle === "video") {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "video")
          );
          // 更新节点的 hasVideoInput 状态
          setTimeout(() => {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === params.target
                  ? { ...n, data: { ...n.data, hasVideoInput: true } }
                  : n
              )
            );
          }, 0);
        }
        // wan26 只允许单个 image 输入
        if (tgt?.type === "wan26" && isImageHandle(params.targetHandle)) {
          next = next.filter(
            (e) => !(e.target === params.target && isImageHandle(e.targetHandle))
          );
        }
        if (tgt?.type === "wan26" && params.targetHandle === "audio") {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "audio")
          );
        }
        if (
          tgt?.type === "wan27Video" &&
          (params.targetHandle === "image" ||
            params.targetHandle === "image-2" ||
            params.targetHandle === "video" ||
            params.targetHandle === "audio")
        ) {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === params.targetHandle)
          );
        }
        if (tgt?.type === "audioUpload" && params.targetHandle === "audio") {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "audio")
          );
        }
        if (
          (tgt?.type === "midjourneyV7" || tgt?.type === "niji7") &&
          (params.targetHandle === "omniImage" ||
            params.targetHandle === "omniimage")
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                (e.targetHandle === "omniImage" ||
                  e.targetHandle === "omniimage")
              )
          );
        }
        // wan2R2V: 每个 video-* 句柄只保留 1 条输入线
        if (
          tgt?.type === "wan2R2V" &&
          typeof params.targetHandle === "string" &&
          params.targetHandle.startsWith("video-")
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        // happyhorseR2V: 每个 image-* 句柄只保留 1 条输入线；video 句柄也只 1 条
        if (
          tgt?.type === "happyhorseR2V" &&
          typeof params.targetHandle === "string" &&
          (params.targetHandle.startsWith("image-") ||
            params.targetHandle === "video")
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        if (tgt?.type === "generateRef") {
          const image1Handles = ["image1", "refer"];
          const image2Handles = ["image2", "img"];
          if (
            params.targetHandle &&
            image1Handles.includes(params.targetHandle)
          ) {
            next = next.filter(
              (e) =>
                !(
                  e.target === params.target &&
                  image1Handles.includes(e.targetHandle || "")
                )
            );
          } else if (
            params.targetHandle &&
            image2Handles.includes(params.targetHandle)
          ) {
            next = next.filter(
              (e) =>
                !(
                  e.target === params.target &&
                  image2Handles.includes(e.targetHandle || "")
                )
            );
          }
        }
        const out = addEdge({ ...params, type: "default" }, next);
        return out;
      });
      try {
        historyService.commit("flow-connect").catch(() => {});
      } catch {}

      // 通知节点边已变化（用于刷新外部提示词预览等）
      // 使用 setTimeout 确保在 setEdges 状态更新后再触发
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("flow:edgesChange"));
      }, 0);

      // 若连接到 Image(img)，立即把源图像写入目标
      try {
        const target = rf.getNode(params.target!);
        if (
          (target?.type === "image" ||
            target?.type === "imagePro" ||
            target?.type === "analysis") &&
          params.targetHandle === "img" &&
          params.source
        ) {
          const src = rf.getNode(params.source);
          let img: string | undefined;
          let incomingImageName: string | undefined;
          let incomingThumbnail: string | undefined;
          if (
            src?.type === "generate4" ||
            src?.type === "generatePro4" ||
            src?.type === "midjourneyV7" ||
            src?.type === "niji7"
          ) {
            const handle = (params as any).sourceHandle as string | undefined;
            const idx =
              handle && handle.startsWith("img")
                ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
                : 0;
            const imageUrls = (src.data as any)?.imageUrls as
              | string[]
              | undefined;
            const imgs = (src.data as any)?.images as string[] | undefined;
            img = imageUrls?.[idx] || imgs?.[idx];
            const thumbs = (src.data as any)?.thumbnails as
              | string[]
              | undefined;
            if (Array.isArray(thumbs)) {
              incomingThumbnail = thumbs[idx];
            }
            const imageNames = (src.data as any)?.imageNames as
              | string[]
              | undefined;
            if (Array.isArray(imageNames)) {
              incomingImageName = imageNames[idx];
            }
            if (!img) {
              // 回退到 imageData（若实现了镜像）
              img = (src.data as any)?.imageUrl || (src.data as any)?.imageData;
              incomingImageName =
                incomingImageName ?? (src.data as any)?.imageName;
              incomingThumbnail =
                incomingThumbnail ?? (src.data as any)?.thumbnail;
            }
          } else {
            img = (src?.data as any)?.imageUrl || (src?.data as any)?.imageData;
            incomingImageName = (src?.data as any)?.imageName;
            incomingThumbnail = (src?.data as any)?.thumbnail;
          }
          const normalizedIncomingName =
            typeof incomingImageName === "string"
              ? incomingImageName.trim()
              : "";
          const normalizedIncomingThumbnail =
            typeof incomingThumbnail === "string"
              ? incomingThumbnail.trim()
              : "";
          if (img) {
            const isLikelyRemoteImageRef = (value: string): boolean => {
              const trimmed = value?.trim?.() || "";
              if (!trimmed) return false;
              if (/^https?:\/\//i.test(trimmed)) return true;
              if (
                trimmed.startsWith("/api/assets/proxy") ||
                trimmed.startsWith("/assets/proxy")
              )
                return true;
              if (
                trimmed.startsWith("/") ||
                trimmed.startsWith("./") ||
                trimmed.startsWith("../")
              )
                return true;
              if (/^(templates|projects|uploads|videos)\//i.test(trimmed))
                return true;
              return false;
            };
            const safeIncomingThumbnail =
              normalizedIncomingThumbnail &&
              isLikelyRemoteImageRef(normalizedIncomingThumbnail)
                ? normalizedIncomingThumbnail
                : "";
            setNodes((ns) =>
              ns.map((n) => {
                if (n.id !== target.id) return n;
                const resetStatus =
                  target.type === "analysis"
                    ? { status: "idle", error: undefined, prompt: "", text: "" }
                    : {};
                const thumbPatch =
                  target.type === "image" || target.type === "imagePro"
                    ? { thumbnail: safeIncomingThumbnail || undefined }
                    : {};
                const imagePatch = isLikelyRemoteImageRef(img)
                  ? { imageUrl: img, imageData: undefined }
                  : { imageData: img };
                return {
                  ...n,
                  data: {
                    ...n.data,
                    ...imagePatch,
                    crop: undefined,
                    imageName: normalizedIncomingName || undefined,
                    ...thumbPatch,
                    ...resetStatus,
                  },
                };
              })
            );
          }
        }
      } catch {}
      setIsConnecting(false);
    },
    [
      isValidConnection,
      canAcceptConnection,
      setEdges,
      rf,
      setNodes,
      isTextHandle,
      canKlingNodeUseAudioInput,
      getSeedanceModeSpec,
      isSeedanceVideoNode,
      lt,
      setIsConnecting,
      closeConnectQuickMenu,
    ]
  );

  const handleQuickConnectSelect = React.useCallback(
    (item: QuickConnectMenuItem) => {
      const anchor = connectAnchorRef.current;
      if (!anchor) return;

      const world = { ...connectQuickMenu.world };

      recordQuickConnectUsage(item);
      closeConnectQuickMenu({ resetSource: true });
      const newNodeId = createNodeAtWorldCenter(item.nodeType, world);
      if (!newNodeId) return;

      window.requestAnimationFrame(() => {
        if (anchor.direction === "forward") {
          const sourceHandle =
            typeof anchor.sourceHandle === "string" && anchor.sourceHandle.trim()
              ? anchor.sourceHandle
              : undefined;
          if (!item.targetHandle) return;
          onConnect({
            source: anchor.sourceId,
            sourceHandle,
            target: newNodeId,
            targetHandle: item.targetHandle,
          } as Connection);
          return;
        }

        if (!item.sourceHandle) return;
        onConnect({
          source: newNodeId,
          sourceHandle: item.sourceHandle,
          target: anchor.targetId,
          targetHandle: anchor.targetHandle,
        } as Connection);
      });
    },
    [
      closeConnectQuickMenu,
      connectQuickMenu.world,
      createNodeAtWorldCenter,
      onConnect,
      recordQuickConnectUsage,
    ]
  );

  React.useEffect(() => {
    if (!connectQuickMenu.visible) return;

    const optionByKey = new Map(
      connectQuickMenu.options.map((item) => [getQuickConnectMenuItemKey(item), item])
    );
    const resolveItemByPoint = (
      clientX: number,
      clientY: number
    ): QuickConnectMenuItem | null => {
      const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      if (!hit) return null;
      const optionEl = hit.closest(
        "[data-connect-quick-key]"
      ) as HTMLElement | null;
      const key = optionEl?.dataset?.connectQuickKey;
      if (!key) return null;
      return optionByKey.get(key) ?? null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeConnectQuickMenu({ resetSource: true });
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      const item = resolveItemByPoint(event.clientX, event.clientY);
      setConnectQuickHoverKey(item ? getQuickConnectMenuItemKey(item) : null);
    };
    const onMouseUp = (event: MouseEvent) => {
      const item = resolveItemByPoint(event.clientX, event.clientY);
      if (item) {
        handleQuickConnectSelect(item);
        return;
      }
      closeConnectQuickMenu({ resetSource: true });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [
    connectQuickMenu.visible,
    connectQuickMenu.options,
    closeConnectQuickMenu,
    handleQuickConnectSelect,
  ]);

  // 监听来自节点的本地数据写入（TextPrompt）
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id: string;
        patch: Record<string, any>;
      };
      if (!detail?.id) return;

      // 处理位置偏移（用于中心点缩放）
      const positionOffset = detail.patch?._positionOffset;

      let shouldAutoGenerateThumbnail = false;
      let thumbnailNodeId: string | null = null;
      let thumbnailSourceImageData: string | null = null;

      setNodes((ns) => {
        const targetIndex = ns.findIndex((node) => node.id === detail.id);
        if (targetIndex < 0) return ns;

        const targetNode = ns[targetIndex];
        const patch = { ...(detail.patch || {}) };

        // 移除内部使用的 _positionOffset
        delete patch._positionOffset;

        if (
          Object.prototype.hasOwnProperty.call(patch, "imageData") &&
          !Object.prototype.hasOwnProperty.call(patch, "imageName")
        ) {
          patch.imageName = undefined;
        }
        // imageData 更新时一并清理 thumbnail，避免旧缩略图残留（且 thumbnail 不落库）
        if (Object.prototype.hasOwnProperty.call(patch, "imageData")) {
          patch.thumbnail = undefined;
        }
        // imageData 清空时一并清理 thumbnail，避免大字符串残留
        if (
          Object.prototype.hasOwnProperty.call(patch, "imageData") &&
          !patch.imageData
        ) {
          patch.thumbnail = undefined;
        }

        // 图片节点：若写入 imageData 但未提供 thumbnail，异步生成缩略图
        if (
          Object.prototype.hasOwnProperty.call(patch, "imageData") &&
          patch.imageData &&
          !Object.prototype.hasOwnProperty.call(patch, "thumbnail") &&
          (targetNode.type === "image" || targetNode.type === "imagePro") &&
          !(
            typeof patch.imageData === "string" &&
            patch.imageData.trim().startsWith(FLOW_IMAGE_ASSET_PREFIX)
          )
        ) {
          patch.thumbnail = undefined;
          shouldAutoGenerateThumbnail = true;
          thumbnailNodeId = targetNode.id;
          thumbnailSourceImageData = patch.imageData;
        }

        // 如果有位置偏移，同时更新节点位置
        let newPosition = targetNode.position;
        if (positionOffset) {
          newPosition = {
            x: targetNode.position.x + positionOffset.x,
            y: targetNode.position.y + positionOffset.y,
          };
        }

        const nextNode = {
          ...targetNode,
          position: newPosition,
          data: { ...targetNode.data, ...patch },
        };
        const nextNodes = ns.slice();
        nextNodes[targetIndex] = nextNode;
        return nextNodes;
      });

      if (
        shouldAutoGenerateThumbnail &&
        thumbnailNodeId &&
        thumbnailSourceImageData
      ) {
        void (async () => {
          const thumb = await createThumbnailDataUrl(
            thumbnailSourceImageData,
            256
          );
          if (!thumb) return;
          setNodes((ns) => {
            const targetIndex = ns.findIndex((node) => node.id === thumbnailNodeId);
            if (targetIndex < 0) return ns;
            const targetNode = ns[targetIndex];
            const current = (targetNode.data as any)?.imageData;
            if (current !== thumbnailSourceImageData) return ns;
            const nextNodes = ns.slice();
            nextNodes[targetIndex] = {
              ...targetNode,
              data: { ...targetNode.data, thumbnail: thumb },
            };
            return nextNodes;
          });
        })();
      }

      // 若目标是 Image 且明确清空图片内容，自动断开输入连线。
      // 注意：当 imageData 从 base64 升级为远程 imageUrl 时，不应断线。
      const patchData = detail.patch || {};
      const hasImageDataPatch = Object.prototype.hasOwnProperty.call(
        patchData,
        "imageData"
      );
      const clearsImageData = hasImageDataPatch && !patchData.imageData;
      const hasImageUrlPatch = Object.prototype.hasOwnProperty.call(
        patchData,
        "imageUrl"
      );
      const hasNextImageUrl =
        hasImageUrlPatch &&
        (typeof patchData.imageUrl === "string"
          ? patchData.imageUrl.trim().length > 0
          : Boolean(patchData.imageUrl));
      if (clearsImageData && !hasNextImageUrl) {
        setEdges((eds) =>
          eds.filter(
            (e) => !(e.target === detail.id && e.targetHandle === "img")
          )
        );
      }
    };
    window.addEventListener("flow:updateNodeData", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:updateNodeData",
        handler as EventListener
      );
  }, [setEdges, setNodes]);

  // happyhorse 节点切换 model 时，丢弃在新模式下不再合法的目标连线。
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { id?: string; model?: string }
        | undefined;
      if (!detail?.id || !detail.model) return;
      const validHandlesForModel = (model: string, refCount: number): Set<string> => {
        const set = new Set<string>(["text"]);
        switch (model) {
          case "happyhorse-1.0-t2v":
            break;
          case "happyhorse-1.0-i2v":
            set.add("image-1");
            break;
          case "happyhorse-1.0-r2v":
            for (let i = 1; i <= Math.min(9, Math.max(1, refCount)); i++) {
              set.add(`image-${i}`);
            }
            break;
          case "happyhorse-1.0-video-edit":
            set.add("image-1");
            set.add("video");
            break;
        }
        return set;
      };
      const targetNode = rf.getNode(detail.id);
      const refCountRaw = Number((targetNode?.data as any)?.referenceCount);
      const refCount = Number.isFinite(refCountRaw) ? refCountRaw : 1;
      const valid = validHandlesForModel(detail.model, refCount);
      setEdges((eds) =>
        eds.filter(
          (e) =>
            !(
              e.target === detail.id &&
              typeof e.targetHandle === "string" &&
              !valid.has(e.targetHandle)
            )
        )
      );
    };
    window.addEventListener(
      "happyhorse:modelChanged",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "happyhorse:modelChanged",
        handler as EventListener
      );
  }, [rf, setEdges]);

  // 监听节点右键菜单：复制（写入 Flow 内部剪贴板，Ctrl/Cmd+V 粘贴，Ctrl/Cmd+Shift+V 可保留外部连线）
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nodeId?: string }
        | undefined;
      const allNodes = rf.getNodes();
      const targetNode = detail?.nodeId ? rf.getNode(detail.nodeId) : null;
      const selectedNodes = allNodes.filter((n: any) => n.selected);
      const nodesToCopy =
        targetNode && !targetNode.selected
          ? [targetNode]
          : selectedNodes.length
          ? selectedNodes
          : targetNode
          ? [targetNode]
          : [];

      if (!nodesToCopy.length) return;

      let hasCanvasPayload = false;
      try {
        const canvasPayload = buildCanvasClipboardFromFlowNodes(
          nodesToCopy as any
        );
        if (canvasPayload) {
          clipboardService.setCanvasData(canvasPayload);
          hasCanvasPayload = true;
        }
      } catch {}

      const idSet = new Set(nodesToCopy.map((n: any) => n.id));
      const nodeSnapshots = rfNodesToTplNodes(nodesToCopy as any, {
        preserveImagePayload: true,
      });
      const allEdges = rf.getEdges();
      const relatedEdges = allEdges
        .filter(
          (edge: any) => idSet.has(edge.source) && idSet.has(edge.target)
        );
      const linkedEdges = allEdges.filter((edge: any) => {
        const sourceSelected = idSet.has(edge.source);
        const targetSelected = idSet.has(edge.target);
        return sourceSelected !== targetSelected;
      });
      const edgeSnapshots = rfEdgesToTplEdges(relatedEdges as any);
      const linkedEdgeSnapshots = rfEdgesToTplEdges(linkedEdges as any);
      const minX = Math.min(...nodesToCopy.map((n: any) => n.position?.x ?? 0));
      const minY = Math.min(...nodesToCopy.map((n: any) => n.position?.y ?? 0));

      clipboardService.setActiveZone("flow");
      clipboardService.setFlowData({
        nodes: nodeSnapshots,
        edges: edgeSnapshots,
        linkedEdges: linkedEdgeSnapshots,
        origin: { x: minX, y: minY },
      });

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: hasCanvasPayload
              ? "已复制节点：Flow Ctrl/Cmd+V 粘贴，Ctrl/Cmd+Shift+V 保留原连线，画板 Ctrl/Cmd+V 可粘贴图片"
              : "已复制节点：Ctrl/Cmd+V 粘贴，Ctrl/Cmd+Shift+V 保留原连线",
            type: "success",
          },
        })
      );
    };

    window.addEventListener("flow:copyNode", handler as EventListener);
    return () =>
      window.removeEventListener("flow:copyNode", handler as EventListener);
  }, [
    rf,
    rfNodesToTplNodes,
    rfEdgesToTplEdges,
    buildCanvasClipboardFromFlowNodes,
  ]);

  // 监听节点右键菜单：删除
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nodeId?: string }
        | undefined;
      const allNodes = rf.getNodes();
      const targetNode = detail?.nodeId ? rf.getNode(detail.nodeId) : null;
      const selectedIds = new Set(
        allNodes.filter((n: any) => n.selected).map((n: any) => n.id)
      );
      const ids =
        targetNode && !targetNode.selected
          ? new Set([targetNode.id])
          : selectedIds.size
          ? selectedIds
          : detail?.nodeId
          ? new Set([detail.nodeId])
          : new Set<string>();
      if (!ids.size) return;

      setNodes((prev: any[]) => prev.filter((n: any) => !ids.has(n.id)));
      setEdges((prev: any[]) =>
        prev.filter((e: any) => !ids.has(e.source) && !ids.has(e.target))
      );
      try {
        historyService.commit("flow-delete-node").catch(() => {});
      } catch {}
    };
    window.addEventListener("flow:deleteNode", handler as EventListener);
    return () =>
      window.removeEventListener("flow:deleteNode", handler as EventListener);
  }, [rf, setNodes, setEdges]);

  // 监听节点右键菜单：复制节点（直接在画板上创建副本）
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nodeId?: string }
        | undefined;
      const targetNode = detail?.nodeId ? rf.getNode(detail.nodeId) : null;
      if (!targetNode) return;

      const OFFSET = 40;
      const newId = generateId(targetNode.type || "n");
      const data: any = sanitizeNodeData((targetNode.data as any) || {}, {
        preserveImagePayload: true,
      });

      const newNode = {
        id: newId,
        type: targetNode.type || "default",
        position: {
          x: (targetNode.position?.x ?? 0) + OFFSET,
          y: (targetNode.position?.y ?? 0) + OFFSET,
        },
        data,
        selected: true,
        width: targetNode.width,
        height: targetNode.height,
        style: targetNode.style ? { ...targetNode.style } : undefined,
      } as any;

      setNodes((prev: any[]) =>
        prev.map((node) => ({ ...node, selected: false })).concat([newNode])
      );
      try {
        historyService.commit("flow-duplicate-node").catch(() => {});
      } catch {}

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "已复制节点", type: "success" },
        })
      );
    };
    window.addEventListener("flow:duplicateNode", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:duplicateNode",
        handler as EventListener
      );
  }, [rf, setNodes, sanitizeNodeData]);

  // 监听节点右键菜单：添加到个人库（上传到 OSS 后写入 store）
  React.useEffect(() => {
    const normalizeSource = (value?: string): string | null => {
      const trimmed = value?.trim();
      if (!trimmed) return null;
      if (
        /^data:/i.test(trimmed) ||
        /^blob:/i.test(trimmed) ||
        /^https?:\/\//i.test(trimmed)
      )
        return trimmed;
      return `data:image/png;base64,${trimmed}`;
    };
    const sanitizeFileStem = (value: string): string =>
      value
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 80) || "image";

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            imageData?: string;
            nodeId?: string;
            nodeType?: string;
          }
        | undefined;
      const nodeId = detail?.nodeId;
      const node = nodeId ? rf.getNode(nodeId) : null;
      const rawImageData = detail?.imageData ?? (node?.data as any)?.imageData;
      const source = normalizeSource(rawImageData);
      if (!source) return;

      const nameCandidate =
        (node?.data as any)?.imageName ||
        (node?.data as any)?.label ||
        (node?.data as any)?.title ||
        "";
      const displayName =
        typeof nameCandidate === "string" && nameCandidate.trim()
          ? nameCandidate.trim()
          : `节点资源 ${new Date().toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}`;
      const now = Date.now();
      const fileName = `${sanitizeFileStem(displayName)}_${now}.png`;

      void (async () => {
        try {
          let uploadedUrl: string | null = null;
          let uploadedMeta: {
            width?: number;
            height?: number;
            fileName?: string;
            contentType?: string;
          } | null = null;
          let fileSize: number | undefined;

          try {
            if (source.startsWith("data:")) {
              const uploadResult = await imageUploadService.uploadImageDataUrl(
                source,
                {
                  dir: "uploads/personal-library/images/",
                  fileName,
                }
              );
              if (uploadResult.success && uploadResult.asset?.url) {
                uploadedUrl = uploadResult.asset.url;
                uploadedMeta = {
                  width: uploadResult.asset.width,
                  height: uploadResult.asset.height,
                  fileName: uploadResult.asset.fileName ?? fileName,
                  contentType: uploadResult.asset.contentType ?? "image/png",
                };
              }
            } else {
              let credentials: RequestCredentials | undefined;
              if (source.startsWith("http")) {
                try {
                  const origin = new URL(source).origin;
                  credentials =
                    origin === window.location.origin ? "include" : "omit";
                } catch {
                  credentials = "omit";
                }
              }
              const response = await fetchWithAuth(source, {
                ...(credentials ? { credentials } : {}),
                auth: "omit",
                allowRefresh: false,
              });
              if (response.ok) {
                const blob = await responseToBlob(response);
                const file = new File([blob], fileName, {
                  type: blob.type || "image/png",
                });
                fileSize = file.size;
                const uploadResult = await imageUploadService.uploadImageFile(
                  file,
                  {
                    dir: "uploads/personal-library/images/",
                  }
                );
                if (uploadResult.success && uploadResult.asset?.url) {
                  uploadedUrl = uploadResult.asset.url;
                  uploadedMeta = {
                    width: uploadResult.asset.width,
                    height: uploadResult.asset.height,
                    fileName: uploadResult.asset.fileName ?? file.name,
                    contentType: uploadResult.asset.contentType ?? file.type,
                  };
                }
              }
            }
          } catch {
            // ignore, fallback below
          }

          const finalUrl =
            uploadedUrl || (source.startsWith("http") ? source : null);
          if (!finalUrl) {
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "添加到库失败，请重试", type: "error" },
              })
            );
            return;
          }

          const assetId = createPersonalAssetId("plimg");
          const imageAsset: PersonalImageAsset = {
            id: assetId,
            type: "2d",
            name: displayName,
            url: finalUrl,
            thumbnail: finalUrl,
            fileName: uploadedMeta?.fileName ?? fileName,
            fileSize,
            contentType: uploadedMeta?.contentType,
            width: uploadedMeta?.width,
            height: uploadedMeta?.height,
            createdAt: now,
            updatedAt: now,
          };

          addPersonalAsset(imageAsset);
          void personalLibraryApi.upsert(imageAsset).catch(() => {});

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "已添加到AI资产", type: "success" },
            })
          );
        } catch (error) {
          console.error("添加到库失败:", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "添加到库失败，请重试", type: "error" },
            })
          );
        }
      })();
    };

    window.addEventListener("flow:addToLibrary", handler as EventListener);
    return () =>
      window.removeEventListener("flow:addToLibrary", handler as EventListener);
  }, [rf, addPersonalAsset]);

  // 监听双击输出节点创建新节点并连线
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        sourceId: string;
        sourceHandle: string;
        targetHandle: string;
        nodeType: string;
        offsetX: number;
      };
      if (!detail?.sourceId || !detail?.nodeType) return;

      const sourceNode = rf.getNode(detail.sourceId);
      if (!sourceNode) return;

      // 创建新节点 ID
      const newId = `${detail.nodeType}_${Date.now()}`;

      // 计算新节点位置（在源节点右侧）
      const newPosition = {
        x: sourceNode.position.x + detail.offsetX,
        y: sourceNode.position.y,
      };

      // 根据节点类型创建默认数据
      const newData =
        detail.nodeType === "generatePro"
          ? {
              status: "idle" as const,
              prompts: [""],
              imageWidth: 296,
              title: "Agent",
              enableWebSearch: false,
              modelProvider: resolveFlowModelProvider(undefined, aiProvider),
            }
          : { status: "idle" as const };

      // 添加新节点
      setNodes((ns) =>
        ns.concat([
          {
            id: newId,
            type: detail.nodeType,
            position: newPosition,
            data: newData,
            selected: true,
          } as any,
        ])
      );

      // 取消选中源节点，选中新节点
      setNodes((ns) =>
        ns.map((n) => ({
          ...n,
          selected: n.id === newId,
        }))
      );

      // 创建连线
      setEdges((eds) =>
        addEdge(
          {
            source: detail.sourceId,
            sourceHandle: detail.sourceHandle,
            target: newId,
            targetHandle: detail.targetHandle,
          },
          eds
        )
      );
    };
    window.addEventListener(
      "flow:duplicateAndConnect",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "flow:duplicateAndConnect",
        handler as EventListener
      );
  }, [rf, setNodes, setEdges]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        imageData?: string;
        imageUrl?: string;
        label?: string;
        imageName?: string;
      };
      const imageUrlForNode =
        typeof detail?.imageUrl === "string" ? detail.imageUrl.trim() : "";
      const imageDataForNode =
        typeof detail?.imageData === "string" ? detail.imageData.trim() : "";
      if (!imageUrlForNode && !imageDataForNode) return;
      const normalizedImageName = detail.imageName?.trim();
      const rect = containerRef.current?.getBoundingClientRect();
      const screenPosition = {
        x: (rect?.width || window.innerWidth) / 2 + (Math.random() * 120 - 60),
        y:
          (rect?.height || window.innerHeight) / 2 +
          60 +
          (Math.random() * 80 - 40),
      };
      const position = rf.screenToFlowPosition(screenPosition);
      const id = `img_${Date.now()}`;
      setNodes((ns) =>
        ns.concat([
          {
            id,
            type: "image",
            position,
            data: {
              imageUrl: imageUrlForNode || undefined,
              imageData: imageUrlForNode ? undefined : imageDataForNode,
              label: detail.label || "Image",
              imageName: normalizedImageName || undefined,
              boxW: 260,
              boxH: 240,
            },
            selected: false,
          } as any,
        ])
      );

      // 已有远程 URL：无需再上传替换
      if (imageUrlForNode) {
        try {
          const projectId = useProjectContentStore.getState().projectId;
          const historyId = `${id}-${Date.now()}`;
          void recordImageHistoryEntry({
            id: historyId,
            remoteUrl: imageUrlForNode,
            title: normalizedImageName || "Flow Image",
            nodeId: id,
            nodeType: "image",
            fileName: `${normalizedImageName || `flow_image_${historyId}`}.png`,
            projectId,
            keepThumbnail: false,
          }).catch(() => {});
        } catch {}
        try {
          historyService
            .commit("flow-create-image-from-canvas")
            .catch(() => {});
        } catch {}
        return;
      }

      // 异步上传到 OSS：成功后用远程 URL 替换节点内的内联数据，避免写入项目 JSON/DB
      try {
        const projectId = useProjectContentStore.getState().projectId;
        const historyId = `${id}-${Date.now()}`;
        void recordImageHistoryEntry({
          id: historyId,
          base64: imageDataForNode,
          title: normalizedImageName || "Flow Image",
          nodeId: id,
          nodeType: "image",
          fileName: `${normalizedImageName || `flow_image_${historyId}`}.png`,
          projectId,
          keepThumbnail: false,
        })
          .then(({ remoteUrl }) => {
            if (!remoteUrl) return;
            setNodes((ns) =>
              ns.map((n) => {
                if (n.id !== id) return n;
                if ((n.data as any)?.imageData !== imageDataForNode) return n;
                return {
                  ...n,
                  data: {
                    ...n.data,
                    imageUrl: remoteUrl,
                    imageData: undefined,
                    thumbnail: undefined,
                  },
                };
              })
            );
          })
          .catch(() => {});
      } catch {}
      try {
        historyService.commit("flow-create-image-from-canvas").catch(() => {});
      } catch {}
    };
    window.addEventListener("flow:createImageNode", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:createImageNode",
        handler as EventListener
      );
  }, [rf, setNodes]);

  // 监听 Midjourney Action 事件（U1-U4, V1-V4 等按钮操作）
  React.useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        nodeId: string;
        taskId: string;
        customId: string;
        label?: string;
        state?: string;
      };
      if (!detail?.nodeId || !detail?.taskId || !detail?.customId) return;

      const node = rf.getNode(detail.nodeId);
      if (
        !node ||
        !["midjourney", "midjourneyV7", "niji7"].includes(node.type || "")
      ) {
        return;
      }

      // 设置节点为运行状态
      setNodes((ns) =>
        ns.map((n) =>
          n.id === detail.nodeId
            ? {
                ...n,
                data: { ...n.data, status: "running", error: undefined },
              }
            : n
        )
      );

      try {
        const result = await midjourneyActionViaAPI({
          taskId: detail.taskId,
          customId: detail.customId,
          actionLabel: detail.label,
          state: detail.state,
        });

        if (!result.success || !result.data) {
          const msg = result.error?.message || "Midjourney 操作失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === detail.nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: msg },
                  }
                : n
            )
          );
          return;
        }

        const imgBase64 = result.data.imageData;
        const metadata = result.data.metadata || {};
        const midjourneyMeta = metadata.midjourney || {};
        const midjourneyImageUrl = midjourneyMeta.imageUrl || metadata.imageUrl;
        const normalizedMidjourneyUrl =
          typeof midjourneyImageUrl === "string"
            ? midjourneyImageUrl.trim()
            : "";
        const rawHasRemoteUrl = normalizedMidjourneyUrl.length > 0;
        const rawPreviewSource = rawHasRemoteUrl
          ? normalizedMidjourneyUrl
          : imgBase64;

        let previewSource = rawPreviewSource;
        try {
          if (typeof rawPreviewSource === "string" && rawPreviewSource.trim()) {
            previewSource = await uploadImageToStableUrl(
              rawPreviewSource.trim(),
              `flow_${node.type || "midjourney"}_${detail.nodeId}_${Date.now()}.png`,
              { reuploadUnstableRemote: true }
            );
          }
        } catch (persistErr) {
          console.warn(
            "[Flow] Midjourney action: failed to persist preview to stable storage",
            persistErr
          );
          previewSource = rawPreviewSource;
        }

        const rawImageUrls = Array.isArray(midjourneyMeta.imageUrls)
          ? midjourneyMeta.imageUrls
          : Array.isArray(metadata.imageUrls)
          ? metadata.imageUrls
          : [];
        const midjourneyImageUrls: string[] = [];
        for (let idx = 0; idx < rawImageUrls.length; idx += 1) {
          const item = rawImageUrls[idx];
          if (typeof item !== "string" || !item.trim()) continue;
          const trimmed = item.trim();
          try {
            midjourneyImageUrls.push(
              await uploadImageToStableUrl(
                trimmed,
                `flow_${node.type || "midjourney"}_${detail.nodeId}_${idx}_${Date.now()}.png`,
                { reuploadUnstableRemote: true }
              )
            );
          } catch (persistErr) {
            console.warn(
              "[Flow] Midjourney action: failed to persist imageUrls item",
              persistErr
            );
            midjourneyImageUrls.push(trimmed);
          }
        }

        const hasRemoteUrl =
          typeof previewSource === "string" &&
          previewSource.trim().length > 0 &&
          !isDataImageUrl(previewSource) &&
          !isBlobUrl(previewSource);
        const stableRemoteUrl = hasRemoteUrl ? previewSource : undefined;

        const historyId = previewSource
          ? `${detail.nodeId}-${Date.now()}`
          : undefined;

        setNodes((ns) =>
          ns.map((n) =>
            n.id === detail.nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "succeeded",
                    imageData: hasRemoteUrl ? undefined : previewSource,
                    error: undefined,
                    taskId: midjourneyMeta.taskId || detail.taskId,
                    mjApiState:
                      typeof midjourneyMeta.state === "string"
                        ? midjourneyMeta.state
                        : undefined,
                    buttons: midjourneyMeta.buttons,
                    imageUrl: hasRemoteUrl
                      ? stableRemoteUrl
                      : undefined,
                    imageUrls: midjourneyImageUrls.length > 0
                      ? midjourneyImageUrls
                      : hasRemoteUrl && stableRemoteUrl
                      ? [stableRemoteUrl]
                      : undefined,
                    promptEn: midjourneyMeta.promptEn,
                    lastHistoryId: historyId ?? (n.data as any)?.lastHistoryId,
                  },
                }
              : n
          )
        );

        if (historyId) {
          const projectId = useProjectContentStore.getState().projectId;
          void recordImageHistoryEntry({
            id: historyId,
            base64: hasRemoteUrl ? undefined : previewSource,
            remoteUrl: hasRemoteUrl ? stableRemoteUrl : undefined,
            title: `${node.type === "niji7" ? "Niji 7" : node.type === "midjourneyV7" ? "Midjourney V7" : "Midjourney"} ${
              detail.label || "Action"
            } ${new Date().toLocaleTimeString()}`,
            nodeId: detail.nodeId,
            nodeType: node.type || "midjourney",
            fileName: `flow_${node.type || "midjourney"}_${historyId}.png`,
            projectId,
            keepThumbnail: false,
          })
            .then(({ remoteUrl }) => {
              if (!remoteUrl) return;
              if (hasRemoteUrl) return;
              setNodes((ns) =>
                ns.map((n) => {
                  if (n.id !== detail.nodeId) return n;
                  if ((n.data as any)?.imageData !== previewSource) return n;
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      imageUrl: remoteUrl,
                      imageData: undefined,
                      thumbnail: undefined,
                    },
                  };
                })
              );
            })
            .catch(() => {});
        }      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Midjourney 操作失败";
        setNodes((ns) =>
          ns.map((n) =>
            n.id === detail.nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "failed", error: msg },
                }
              : n
          )
        );
      }
    };

    window.addEventListener("flow:midjourneyAction", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:midjourneyAction",
        handler as EventListener
      );
  }, [rf, setNodes]);

  const happyhorsePollingRef = React.useRef<Set<string>>(new Set());
  const pollHappyhorseTask = React.useCallback(
    async (params: {
      nodeId: string;
      taskId: string;
      apiUsageId?: string;
      prompt?: string;
      quality?: string;
      referenceCount?: number;
    }) => {
      const taskId = params.taskId.trim();
      if (!taskId) return;
      const pollKey = `${params.nodeId}:${taskId}`;
      if (happyhorsePollingRef.current.has(pollKey)) return;
      happyhorsePollingRef.current.add(pollKey);

      const pollInterval = 5000;
      const maxAttempts = 180;
      const generationStartedAt = Date.now();

      const failNode = async (message: string, shouldRefund: boolean) => {
        if (shouldRefund && params.apiUsageId) {
          try {
            await refundVideoTask(params.apiUsageId);
          } catch (refundErr) {
            console.warn("[Flow] HappyHorse refund failed", {
              nodeId: params.nodeId,
              taskId,
              apiUsageId: params.apiUsageId,
              error: refundErr instanceof Error ? refundErr.message : String(refundErr),
            });
          }
        }
        setNodes((ns) =>
          ns.map((n) =>
            n.id === params.nodeId && (n.data as any)?.taskId === taskId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "failed",
                    error: message,
                    taskId: undefined,
                    apiUsageId: undefined,
                    pendingPrompt: undefined,
                    pendingQuality: undefined,
                    pendingReferenceCount: undefined,
                  },
                }
              : n
          )
        );
      };

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, pollInterval));
          }

          const queryResult = await queryDashscopeTask(taskId);
          if (!queryResult.success) continue;

          const status = String(queryResult.status || "").toLowerCase();
          if (status === "succeeded" || status === "success") {
            const videoUrl = queryResult.videoUrl;
            if (!videoUrl) {
              await failNode("任务已完成但未返回视频地址", true);
              return;
            }

            if (params.apiUsageId) {
              const processingTime = Math.max(0, Date.now() - generationStartedAt);
              void markVideoTaskSuccess(params.apiUsageId, processingTime).catch((markErr) => {
                console.warn("[Flow] HappyHorse mark success failed", {
                  nodeId: params.nodeId,
                  taskId,
                  apiUsageId: params.apiUsageId,
                  error: markErr instanceof Error ? markErr.message : String(markErr),
                });
              });
            }

            const elapsedSeconds = Math.max(
              1,
              Math.round((Date.now() - generationStartedAt) / 1000)
            );
            const historyEntry = {
              id: `history-${Date.now()}`,
              videoUrl,
              thumbnail: undefined,
              prompt: params.prompt || "",
              quality: params.quality,
              createdAt: new Date().toISOString(),
              elapsedSeconds,
              referenceCount: params.referenceCount,
            };

            setNodes((ns) =>
              ns.map((n) => {
                if (n.id !== params.nodeId || (n.data as any)?.taskId !== taskId) return n;
                const previousData = (n.data as any) || {};
                return {
                  ...n,
                  data: {
                    ...previousData,
                    status: "succeeded",
                    videoUrl,
                    thumbnail: undefined,
                    error: undefined,
                    videoVersion: Number(previousData.videoVersion || 0) + 1,
                    taskId: undefined,
                    apiUsageId: undefined,
                    pendingPrompt: undefined,
                    pendingQuality: undefined,
                    pendingReferenceCount: undefined,
                    history: appendVideoHistory(
                      previousData.history as Array<Record<string, any>> | undefined,
                      historyEntry
                    ),
                  },
                };
              })
            );
            return;
          }

          if (status === "failed" || status === "error") {
            await failNode("视频生成任务失败", true);
            return;
          }
        }

        await failNode("任务查询超时，请稍后重试", true);
      } finally {
        happyhorsePollingRef.current.delete(pollKey);
      }
    },
    [appendVideoHistory, setNodes]
  );

  React.useEffect(() => {
    nodes.forEach((node) => {
      if (node.type !== "happyhorseR2V") return;
      const data = (node.data as any) || {};
      if (data.status !== "running") return;
      const taskId = typeof data.taskId === "string" ? data.taskId.trim() : "";
      if (!taskId) return;
      void pollHappyhorseTask({
        nodeId: node.id,
        taskId,
        apiUsageId:
          typeof data.apiUsageId === "string" && data.apiUsageId.trim()
            ? data.apiUsageId.trim()
            : undefined,
        prompt: typeof data.pendingPrompt === "string" ? data.pendingPrompt : undefined,
        quality: typeof data.pendingQuality === "string" ? data.pendingQuality : undefined,
        referenceCount:
          typeof data.pendingReferenceCount === "number"
            ? data.pendingReferenceCount
            : undefined,
      });
    });
  }, [nodes, pollHappyhorseTask]);

  // 运行：根据输入自动选择 生图/编辑/融合（支持 generate / generate4 / generateRef）
  const runNode = React.useCallback(
    async (nodeId: string) => {
      console.log('[runNode] 被调用, nodeId:', nodeId);
      const node = rf.getNode(nodeId);
      if (!node) {
        console.log('[runNode] 节点不存在');
        return;
      }
      if ((node.data as any)?.status === "running") {
        console.log("[runNode] 节点正在运行，忽略重复触发");
        return;
      }
      console.log('[runNode] 节点类型:', node.type);

      const currentEdges = rf.getEdges();

      const resolveImageData = (edge: Edge): string | undefined => {
        const srcNode = rf.getNode(edge.source);
        if (!srcNode) return undefined;
        const data = srcNode.data as any;

        if (
          srcNode.type === "generate4" ||
          srcNode.type === "generatePro4" ||
          srcNode.type === "midjourneyV7" ||
          srcNode.type === "niji7"
        ) {
          const handle = (edge as any).sourceHandle as string | undefined;
          const idx = handle?.startsWith("img")
            ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
            : 0;
          const urls = Array.isArray(data?.imageUrls)
            ? (data.imageUrls as string[])
            : undefined;
          const imgs = Array.isArray(data?.images)
            ? (data.images as string[])
            : undefined;
          const thumbs = Array.isArray(data?.thumbnails)
            ? (data.thumbnails as string[])
            : undefined;
          let img = urls?.[idx] || imgs?.[idx] || thumbs?.[idx];
          if (
            !img &&
            typeof data?.imageData === "string" &&
            data.imageData.length
          ) {
            img = data.imageData;
          }
          if (
            !img &&
            typeof data?.imageUrl === "string" &&
            data.imageUrl.length
          ) {
            img = data.imageUrl;
          }
          return img;
        }

        if (typeof data?.imageData === "string") return data.imageData;
        if (typeof data?.imageUrl === "string") return data.imageUrl;
        return undefined;
      };

      const collectImages = (edgesToCollect: Edge[]) =>
        edgesToCollect
          .map(resolveImageData)
          .filter(
            (img): img is string => typeof img === "string" && img.length > 0
          );

      // 运行时图片输入归一化：
      // - 允许节点数据里是 URL/OSS key/flow-asset/base64
      // - 对后端 AI 接口：统一转换成 dataURL(base64) 再发送（避免后端不支持 URL）
      // - 对 ImageSplit：按 splitRects 动态裁切生成 dataURL（不落库）
      const toFetchableUrl = (value: string): string | null => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) return null;

        if (
          /^data:/i.test(trimmed) ||
          /^blob:/i.test(trimmed) ||
          (typeof FLOW_IMAGE_ASSET_PREFIX === "string" &&
            trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX))
        ) {
          return trimmed;
        }

        if (
          trimmed.startsWith("/api/assets/proxy") ||
          trimmed.startsWith("/assets/proxy")
        ) {
          return proxifyRemoteAssetUrl(trimmed);
        }

        const withoutLeading = trimmed.replace(/^\/+/, "");
        if (/^(templates|projects|uploads|videos)\//i.test(withoutLeading)) {
          return proxifyRemoteAssetUrl(
            `/api/assets/proxy?key=${encodeURIComponent(withoutLeading)}`
          );
        }

        if (/^https?:\/\//i.test(trimmed)) return trimmed;

        if (
          trimmed.startsWith("/") ||
          trimmed.startsWith("./") ||
          trimmed.startsWith("../")
        ) {
          try {
            return new URL(trimmed, window.location.origin).toString();
          } catch {
            return null;
          }
        }

        return null;
      };

      const resolveImageValueToDataUrlForBackend = async (
        value?: string
      ): Promise<string | null> => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) {
          console.warn("[resolveImageValueToDataUrlForBackend] 输入为空");
          return null;
        }

        console.log(`[resolveImageValueToDataUrlForBackend] 输入: ${trimmed.slice(0, 80)}...`);

        // 已经是 data URL，直接返回
        if (trimmed.startsWith("data:")) {
          console.log("[resolveImageValueToDataUrlForBackend] 已是 data URL");
          return trimmed;
        }

        // 优先处理 flow-asset: 引用 - 必须转换为 data URL
        if (trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)) {
          console.log("[resolveImageValueToDataUrlForBackend] 检测到 flow-asset 引用，尝试转换...");
          const resolved = await resolveImageToDataUrl(trimmed, { preferProxy: true });
          if (resolved) {
            console.log(`[resolveImageValueToDataUrlForBackend] flow-asset 转换成功: ${resolved.slice(0, 50)}...`);
            return resolved;
          }
          console.warn("[resolveImageValueToDataUrlForBackend] flow-asset 转换失败");
          return null;
        }

        // 处理 blob: URL - 必须转换为 data URL
        if (trimmed.startsWith("blob:")) {
          console.log("[resolveImageValueToDataUrlForBackend] 检测到 blob URL，尝试转换...");
          const resolved = await resolveImageToDataUrl(trimmed, { preferProxy: true });
          if (resolved) {
            console.log(`[resolveImageValueToDataUrlForBackend] blob 转换成功: ${resolved.slice(0, 50)}...`);
            return resolved;
          }
          console.warn("[resolveImageValueToDataUrlForBackend] blob 转换失败");
          return null;
        }

        // 远程 URL - 可以直接返回（后端会处理）
        const normalizedRemote = normalizeStableRemoteUrl(trimmed);
        if (isRemoteUrl(normalizedRemote)) {
          console.log(`[resolveImageValueToDataUrlForBackend] 远程 URL: ${normalizedRemote}`);
          return normalizedRemote;
        }

        // 其他格式通过 toFetchableUrl 处理
        const fetchable = toFetchableUrl(trimmed);
        if (fetchable) {
          console.log(`[resolveImageValueToDataUrlForBackend] fetchable URL: ${fetchable.slice(0, 80)}...`);
          const resolved = await resolveImageToDataUrl(fetchable, {
            preferProxy: true,
          });
          if (resolved) {
            console.log(`[resolveImageValueToDataUrlForBackend] 转换成功: ${resolved.slice(0, 50)}...`);
            return resolved;
          }
          // 尝试直接 fetch
          if (
            fetchable.includes("/api/assets/proxy") ||
            fetchable.includes("/assets/proxy") ||
            fetchable.startsWith(window.location.origin)
          ) {
            try {
              const isAssetProxyFetch =
                fetchable.includes("/api/assets/proxy") ||
                fetchable.includes("/assets/proxy");
              const response = await fetchWithAuth(fetchable, {
                auth: isAssetProxyFetch ? "omit" : "auto",
                ...(isAssetProxyFetch
                  ? { mode: "cors" as RequestMode, credentials: "omit" as RequestCredentials }
                  : {}),
                allowRefresh: false,
              });
              if (!response.ok) {
                console.warn(`[resolveImageValueToDataUrlForBackend] fetch 失败: ${response.status}`);
                return null;
              }
              const blob = await responseToBlob(response);
              const dataUrl = await blobToDataUrl(blob);
              console.log(`[resolveImageValueToDataUrlForBackend] fetch 转换成功: ${dataUrl.slice(0, 50)}...`);
              return dataUrl;
            } catch (err) {
              console.warn("[resolveImageValueToDataUrlForBackend] fetch 异常:", err);
              return null;
            }
          }
          console.warn("[resolveImageValueToDataUrlForBackend] fetchable 转换失败");
          return null;
        }

        // 兜底：认为是裸 base64
        console.log("[resolveImageValueToDataUrlForBackend] 兜底处理为裸 base64");
        return ensureDataUrl(trimmed);
      };

      const resolveFirstImageCandidateToDataUrl = async (
        ...candidates: unknown[]
      ): Promise<string | null> => {
        for (const candidate of candidates) {
          const value = typeof candidate === "string" ? candidate.trim() : "";
          if (!value) continue;
          const resolved = await resolveImageValueToDataUrlForBackend(value);
          if (resolved) return resolved;
        }
        return null;
      };

      const cropImageToDataUrl = async (params: {
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

        // 目标输出尺寸：使用“源坐标系”的裁切尺寸，而不是解码后图片的像素尺寸
        // 否则当 baseRef 实际加载到的是缩略图（naturalW < sourceWidth）时，会把输出错误压缩成缩略图大小（例如 2048->400 导致 1024 变 200）。
        const MAX_OUTPUT_PIXELS = 32_000_000; // ~32MP，避免极端情况下创建超大画布导致内存峰值过高
        const outputScale =
          w * h > MAX_OUTPUT_PIXELS ? Math.sqrt(MAX_OUTPUT_PIXELS / (w * h)) : 1;
        const outW = Math.max(1, Math.floor(w * outputScale));
        const outH = Math.max(1, Math.floor(h * outputScale));

        const fetchable = toFetchableUrl(baseRef) || ensureDataUrl(baseRef);
        const blob = await resolveImageToBlob(fetchable, { preferProxy: true });
        if (!blob) return null;

        const makeCanvas = (cw: number, ch: number): any => {
          if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(cw, ch);
          }
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          return canvas;
        };

        // 优先使用 ImageBitmap（更快且不受 CORS 影响，因为我们是 blob）
        if (typeof createImageBitmap === "function") {
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

	            // 对 source 坐标做整数化，减少边缘采样导致的“白边/透明边”伪影
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

            const canvas = makeCanvas(outW, outH);
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            try {
              // 避免因小数坐标采样造成边缘“白边/透明边”伪影
              // @ts-ignore - 部分环境无此字段
              ctx.imageSmoothingEnabled = true;
            } catch {}
            ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
            const outBlob = await canvasToBlob(canvas, { type: "image/png" });
            return await blobToDataUrl(outBlob);
          } finally {
            try {
              bitmap.close();
            } catch {}
          }
        }

        // 兼容性兜底：HTMLImageElement
        const objectUrl = URL.createObjectURL(blob);
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("图片解码失败"));
            img.src = objectUrl;
          });

          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
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

          const canvas = makeCanvas(outW, outH);
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          try {
            // @ts-ignore - 部分环境无此字段
            ctx.imageSmoothingEnabled = true;
          } catch {}
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          const outBlob = await canvasToBlob(canvas, { type: "image/png" });
          return await blobToDataUrl(outBlob);
        } finally {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch {}
        }
      };

      const resolveNodeImageToDataUrl = async (
        node: RFNode,
        sourceHandle?: string | null,
        visited: Set<string> = new Set()
      ): Promise<string | null> => {
        if (!node || !node.id) {
          console.warn("[resolveNodeImageToDataUrl] 节点无效");
          return null;
        }
        if (visited.has(node.id)) {
          console.warn(`[resolveNodeImageToDataUrl] 循环引用: ${node.id}`);
          return null;
        }
        visited.add(node.id);

        const d = (node.data ?? {}) as any;
        const handle =
          typeof sourceHandle === "string" ? sourceHandle.trim() : "";

        console.log(`[resolveNodeImageToDataUrl] 节点: ${node.id}, 类型: ${node.type}, handle: ${handle}`);
        console.log(`[resolveNodeImageToDataUrl] 节点数据: imageData=${d.imageData?.slice?.(0, 50) || 'undefined'}, imageUrl=${d.imageUrl?.slice?.(0, 50) || 'undefined'}`);

        if (node.type === "imageSplit") {
          const base =
            (typeof d.inputImageUrl === "string" && d.inputImageUrl.trim()) ||
            (typeof d.inputImage === "string" && d.inputImage.trim()) ||
            "";

          const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
          const match = handle ? /^image(\d+)$/.exec(handle) : null;
          const idx = match ? Math.max(0, Number(match[1]) - 1) : 0;

          const rect = splitRects?.[idx];
          const x = typeof rect?.x === "number" ? rect.x : Number(rect?.x ?? 0);
          const y = typeof rect?.y === "number" ? rect.y : Number(rect?.y ?? 0);
          const w =
            typeof rect?.width === "number"
              ? rect.width
              : Number(rect?.width ?? 0);
          const h =
            typeof rect?.height === "number"
              ? rect.height
              : Number(rect?.height ?? 0);

          if (
            base &&
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            w > 0 &&
            h > 0
          ) {
            return await cropImageToDataUrl({
              baseRef: base,
              rect: { x, y, width: w, height: h },
              sourceWidth:
                typeof d.sourceWidth === "number" ? d.sourceWidth : undefined,
              sourceHeight:
                typeof d.sourceHeight === "number" ? d.sourceHeight : undefined,
            });
          }

          // legacy 兜底：有些历史数据可能仍保存了 splitImages
          const splitImages = Array.isArray(d.splitImages) ? d.splitImages : [];
          return await resolveFirstImageCandidateToDataUrl(
            splitImages?.[idx]?.imageData,
            splitImages?.[idx]?.imageUrl
          );
        }

        if (node.type === "imageGrid") {
          return await resolveFirstImageCandidateToDataUrl(
            d.outputImage,
            d.imageUrl,
            d.imageData
          );
        }

        if (node.type === "imageCompress") {
          return await resolveFirstImageCandidateToDataUrl(
            d.outputImage,
            d.imageData,
            d.imageUrl
          );
        }

        if (node.type === "videoFrameExtract" && handle === "image") {
          const frames = Array.isArray(d.frames) ? d.frames : [];
          const selectedFrameIndex = Number(d.selectedFrameIndex ?? 1);
          const idx = Math.max(0, selectedFrameIndex - 1);
          const frame = frames[idx];
          return await resolveFirstImageCandidateToDataUrl(
            frame?.imageUrl,
            frame?.thumbnailDataUrl,
            frame?.imageData
          );
        }

        if (
          node.type === "generate4" ||
          node.type === "generatePro4" ||
          node.type === "midjourneyV7" ||
          node.type === "niji7"
        ) {
          const idx = handle?.startsWith("img")
            ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
            : 0;
          const urls = Array.isArray(d?.imageUrls)
            ? (d.imageUrls as string[])
            : [];
          const imgs = Array.isArray(d?.images) ? (d.images as string[]) : [];
          const thumbs = Array.isArray(d?.thumbnails)
            ? (d.thumbnails as string[])
            : [];
          return await resolveFirstImageCandidateToDataUrl(
            urls[idx],
            imgs[idx],
            thumbs[idx],
            d?.imageData,
            d?.imageUrl
          );
        }

        if (node.type === "image" || node.type === "imagePro") {
          const upstream = currentEdges.find(
            (e) => e.target === node.id && e.targetHandle === "img"
          );

          const crop = (d as any)?.crop as
            | {
                x?: unknown;
                y?: unknown;
                width?: unknown;
                height?: unknown;
                sourceWidth?: unknown;
                sourceHeight?: unknown;
              }
            | undefined;
          if (crop) {
            const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
            const w =
              typeof crop.width === "number"
                ? crop.width
                : Number(crop.width ?? 0);
            const h =
              typeof crop.height === "number"
                ? crop.height
                : Number(crop.height ?? 0);

            const sourceWidth =
              typeof crop.sourceWidth === "number"
                ? crop.sourceWidth
                : Number(crop.sourceWidth ?? 0);
            const sourceHeight =
              typeof crop.sourceHeight === "number"
                ? crop.sourceHeight
                : Number(crop.sourceHeight ?? 0);

            const baseRef =
              (typeof d.imageData === "string" && d.imageData.trim()) ||
              (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
              "";

            // 优先使用节点本地 baseRef；缺失时回溯上游连线作为裁切基底
            const base =
              baseRef ||
              (upstream
                ? await resolveNodeImageToDataUrl(
                    rf.getNode(upstream.source) as any,
                    (upstream as any).sourceHandle,
                    visited
                  )
                : "");

            if (
              base &&
              Number.isFinite(x) &&
              Number.isFinite(y) &&
              w > 0 &&
              h > 0
            ) {
              const cropped = await cropImageToDataUrl({
                baseRef: base,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              });
              if (cropped) return cropped;
            }
          }

          const resolvedDirect = await resolveFirstImageCandidateToDataUrl(
            d.imageData,
            d.imageUrl,
            d.thumbnail
          );
          if (resolvedDirect) return resolvedDirect;

          // Image/ImagePro 作为“显示节点”时，图片可能来自上游连线；优先向上追溯以匹配当前显示内容
          if (upstream) {
            const src = rf.getNode(upstream.source);
            if (src) {
              return await resolveNodeImageToDataUrl(
                src as any,
                (upstream as any).sourceHandle,
                visited
              );
            }
          }
        }

        return await resolveFirstImageCandidateToDataUrl(
          d.imageData,
          d.imageUrl
        );
      };

      const resolveEdgeImageToDataUrl = async (
        edge: Edge
      ): Promise<string | null> => {
        const srcNode = rf.getNode(edge.source);
        if (!srcNode) {
          console.warn(`[resolveEdgeImageToDataUrl] 源节点不存在: ${edge.source}`);
          return null;
        }
        const result = await resolveNodeImageToDataUrl(
          srcNode as any,
          (edge as any).sourceHandle,
          new Set()
        );
        console.log(`[resolveEdgeImageToDataUrl] 边 ${edge.source} -> ${edge.target}, 结果: ${result ? `${result.slice(0, 50)}...` : 'null'}`);
        return result;
      };

      const resolveEdgesAsDataUrls = async (
        edges: Edge[]
      ): Promise<string[]> => {
        console.log(`[resolveEdgesAsDataUrls] 开始解析 ${edges.length} 条边`);
        const out: string[] = [];
        for (const edge of edges) {
          try {
            const dataUrl = await resolveEdgeImageToDataUrl(edge);
            if (dataUrl) {
              out.push(dataUrl);
            } else {
              console.warn(`[resolveEdgesAsDataUrls] 边 ${edge.source} -> ${edge.target} 解析返回 null`);
            }
          } catch (err) {
            console.error(`[resolveEdgesAsDataUrls] 边 ${edge.source} -> ${edge.target} 解析失败:`, err);
          }
        }
        console.log(`[resolveEdgesAsDataUrls] 解析完成，成功 ${out.length}/${edges.length}`);
        return out;
      };
      const getTextPromptForNode = (targetId: string) => {
        const textEdge = currentEdges.find(
          (e) => e.target === targetId && e.targetHandle === "text"
        );
        if (!textEdge) return { text: "", hasEdge: false };
        const promptNode = rf.getNode(textEdge.source);
        if (!promptNode) return { text: "", hasEdge: true };
        const resolved = resolveTextFromSourceNode(
          promptNode,
          textEdge.sourceHandle
        );
        return { text: resolved?.trim() || "", hasEdge: true };
      };

      const getTextPromptsForNode = (targetId: string) => {
        const textEdges = currentEdges.filter(
          (e) => e.target === targetId && e.targetHandle === "text"
        );
        if (!textEdges.length) return { texts: [] as string[], hasEdge: false };

        const texts: string[] = [];
        for (const edge of textEdges) {
          const promptNode = rf.getNode(edge.source);
          if (!promptNode) continue;
          const resolved = resolveTextFromSourceNode(
            promptNode,
            edge.sourceHandle
          );
          const trimmed = resolved?.trim() || "";
          if (trimmed) texts.push(trimmed);
        }

        return { texts, hasEdge: true };
      };

      // Wan2.6 节点处理逻辑
      const parseMidjourneyList = (value: unknown): string[] => {
        if (typeof value !== "string") return [];
        return value
          .split(/[\r\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean);
      };

      const normalizeMidjourneyValue = (value: unknown): string | undefined => {
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      /**
       * Midjourney V7 / Niji 7：走悠船 /v1/tob/diffusion，后端会剥离 iw/sv/sw/ow/exp/cref/sref/oref 等片段；
       * 且禁止把 data: base64 写进提示词（会撑爆请求体导致 500）。参考图仅通过 imageUrls 上传。
       * 速度见 backend/docs/mj v7和Niji 7速度模式文档说明.md（需显式 --fast / --turbo / --draft）。
       */
      const buildMidjourneyPrompt = (
        nodeType: string,
        nodeData: Record<string, any>,
        promptText: string,
        hasImages: boolean
      ) => {
        const isNiji = nodeType === "niji7";
        const errors: string[] = [];
        const flags: string[] = [];
        const basePrompt = (promptText || "").trim();

        if (basePrompt.includes("::")) {
          errors.push("Midjourney V7 / Niji 7 暂不支持多提示词 ::");
        }

        flags.push(isNiji ? "--niji 7" : "--v 7");

        if (nodeData.aspectRatio) flags.push(`--ar ${nodeData.aspectRatio}`);

        const resolvedSpeed =
          nodeData.speedMode === "turbo"
            ? "turbo"
            : !isNiji &&
              (nodeData.speedMode === "draft" || nodeData.draft)
            ? "draft"
            : "fast";
        if (resolvedSpeed === "turbo") flags.push("--turbo");
        else if (resolvedSpeed === "draft" && !isNiji) flags.push("--draft");
        else flags.push("--fast");

        if (nodeData.raw) flags.push("--raw");

        const chaos = normalizeMidjourneyValue(nodeData.chaos);
        if (chaos && chaos !== "0") flags.push(`--chaos ${chaos}`);
        const stylize = normalizeMidjourneyValue(nodeData.stylize) ?? "100";
        if (stylize && stylize !== "100") flags.push(`--stylize ${stylize}`);
        const weird = normalizeMidjourneyValue(nodeData.weird);
        if (weird) flags.push(`--weird ${weird}`);
        const seed = normalizeMidjourneyValue(nodeData.seed);
        if (seed) flags.push(`--seed ${seed}`);

        if (!isNiji) {
          const quality = normalizeMidjourneyValue(nodeData.quality) ?? "1";
          if (quality && quality !== "1") flags.push(`--q ${quality}`);
          const noPrompt = normalizeMidjourneyValue(nodeData.noPrompt);
          if (noPrompt) flags.push(`--no ${noPrompt}`);
          if (nodeData.tile) flags.push("--tile");
        }

        const finalPrompt = [basePrompt, ...flags].filter(Boolean).join(" ").trim();
        if (!basePrompt && !hasImages) {
          errors.push("需要提示词或参考图");
        }

        return { finalPrompt, errors };
      };

      if (node.type === "wan27Video") {
        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText } = getTextPromptForNode(nodeId);
        const promptTextNormalized =
          typeof promptText === "string" ? promptText.trim() : "";

        if (promptTextNormalized.length > 5000) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "Prompt 最多支持 5000 个字符",
                    },
                  }
                : n
            )
          );
          return;
        }

        const sanitizeMediaUrl = (url?: string | null) => {
          if (!url || typeof url !== "string") return undefined;
          const trimmed = url.trim();
          if (!trimmed) return undefined;
          const markdownSplit = trimmed.split("](");
          const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
          const spaceIdx = candidate.indexOf(" ");
          return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
        };

        const resolveVideoUrl = (edge?: Edge): string | undefined => {
          if (!edge) return undefined;
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) return undefined;
          const data = (srcNode.data as any) || {};
          const direct =
            data.videoUrl ||
            data.video_url ||
            data.output?.video_url ||
            (Array.isArray(data.output) ? data.output[0]?.video_url : undefined) ||
            data.raw?.output?.video_url ||
            data.raw?.video_url ||
            data.url ||
            data.src;
          const fromHistory = Array.isArray(data.history) ? data.history[0]?.videoUrl : undefined;
          return sanitizeMediaUrl(direct) || sanitizeMediaUrl(fromHistory);
        };

        const resolveAudioUrl = (edge?: Edge): string | undefined => {
          if (!edge) return undefined;
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) return undefined;
          const data = (srcNode.data as any) || {};
          if (typeof data.audioUrl === "string" && data.audioUrl.trim()) {
            return sanitizeMediaUrl(data.audioUrl);
          }
          if (Array.isArray(data.audioUrls)) {
            const firstAudio = data.audioUrls.find(
              (value: unknown) => typeof value === "string" && value.trim().length > 0
            );
            if (typeof firstAudio === "string") {
              return sanitizeMediaUrl(firstAudio);
            }
          }
          return undefined;
        };

        const uploadResolvedImageEdge = async (edge?: Edge): Promise<string | undefined> => {
          if (!edge) return undefined;
          const images = await resolveEdgesAsDataUrls([edge]);
          const firstImage = images.find((value) => typeof value === "string" && value.trim().length > 0);
          if (!firstImage) return undefined;
          const trimmed = firstImage.trim();
          if (isRemoteUrl(trimmed)) {
            return normalizeStableRemoteUrl(trimmed);
          }
          const uploaded = await uploadImageToOSS(ensureDataUrl(trimmed), projectId);
          return uploaded || undefined;
        };

        const firstFrameEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "image"
        );
        const lastFrameEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "image-2"
        );
        const firstClipEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "video"
        );
        const audioEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "audio"
        );
        const firstFrameEdgeCount = currentEdges.filter(
          (e) => e.target === nodeId && e.targetHandle === "image"
        ).length;
        const lastFrameEdgeCount = currentEdges.filter(
          (e) => e.target === nodeId && e.targetHandle === "image-2"
        ).length;
        const firstClipEdgeCount = currentEdges.filter(
          (e) => e.target === nodeId && e.targetHandle === "video"
        ).length;
        const audioEdgeCount = currentEdges.filter(
          (e) => e.target === nodeId && e.targetHandle === "audio"
        ).length;

        const failWan27Node = (message: string) => {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: message },
                  }
                : n
            )
          );
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "warning" },
            })
          );
        };

        try {
          if (
            firstFrameEdgeCount > 1 ||
            lastFrameEdgeCount > 1 ||
            firstClipEdgeCount > 1 ||
            audioEdgeCount > 1
          ) {
            failWan27Node("Wan2.7 每个媒体句柄最多仅支持 1 条连接");
            return;
          }

          const [firstFrameUrl, lastFrameUrl] = await Promise.all([
            uploadResolvedImageEdge(firstFrameEdge),
            uploadResolvedImageEdge(lastFrameEdge),
          ]);
          const firstClipUrl = resolveVideoUrl(firstClipEdge);
          const audioUrlFromEdge = resolveAudioUrl(audioEdge);
          const audioUrl =
            audioUrlFromEdge ||
            (typeof (node.data as any)?.audioUrl === "string"
              ? sanitizeMediaUrl((node.data as any).audioUrl)
              : undefined);

          const media: Array<{
            type: "first_frame" | "last_frame" | "first_clip" | "driving_audio";
            url: string;
          }> = [];
          if (firstFrameUrl) media.push({ type: "first_frame", url: firstFrameUrl });
          if (lastFrameUrl) media.push({ type: "last_frame", url: lastFrameUrl });
          if (firstClipUrl) media.push({ type: "first_clip", url: firstClipUrl });
          if (audioUrl) media.push({ type: "driving_audio", url: audioUrl });

          const hasFirstFrame = Boolean(firstFrameUrl);
          const hasLastFrame = Boolean(lastFrameUrl);
          const hasFirstClip = Boolean(firstClipUrl);
          const hasDrivingAudio = Boolean(audioUrl);

          if (!hasFirstFrame && !hasFirstClip) {
            failWan27Node("Wan2.7 至少需要首帧图或首段视频（first_frame / first_clip）");
            return;
          }

          if (hasFirstFrame && hasFirstClip) {
            failWan27Node("Wan2.7 不支持同时传入首帧图和首段视频，请二选一");
            return;
          }

          if (hasDrivingAudio && !hasFirstFrame) {
            failWan27Node("驱动音频仅支持与首帧图组合使用");
            return;
          }

          if (hasFirstClip && hasDrivingAudio) {
            failWan27Node("first_clip 视频续写模式暂不支持 driving_audio");
            return;
          }

          if (hasLastFrame && !hasFirstFrame && !hasFirstClip) {
            failWan27Node("last_frame 不能单独使用，请与 first_frame 或 first_clip 组合");
            return;
          }

          const resolution = String((node.data as any)?.resolution || "1080P")
            .trim()
            .toUpperCase();
          if (resolution !== "720P" && resolution !== "1080P") {
            failWan27Node("Wan2.7 分辨率仅支持 720P / 1080P");
            return;
          }

          const durationRaw = Number((node.data as any)?.duration ?? 5);
          const duration = Math.round(durationRaw);
          if (!Number.isFinite(durationRaw) || duration < 2 || duration > 15) {
            failWan27Node("Wan2.7 时长仅支持 2-15 秒");
            return;
          }

          const seedRaw = (node.data as any)?.seed;
          let seed: number | undefined;
          if (
            seedRaw !== undefined &&
            seedRaw !== null &&
            String(seedRaw).trim().length > 0
          ) {
            const parsedSeed = Number(seedRaw);
            if (
              !Number.isInteger(parsedSeed) ||
              parsedSeed < 0 ||
              parsedSeed > 2147483647
            ) {
              failWan27Node("Seed 需为 0 - 2147483647 的整数");
              return;
            }
            seed = parsedSeed;
          }

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "running", error: undefined },
                  }
                : n
            )
          );

          // Prompt Extend 默开启，水印默认关闭（不暴露给前端UI）
          const generationStartedAt = Date.now();

          const result = await generateWan27I2VViaAPI({
            prompt: promptTextNormalized || undefined,
            media,
            parameters: {
              resolution,
              duration,
              prompt_extend: true,
              watermark: false,
              ...(typeof seed === "number" ? { seed } : {}),
            },
          });

          const wanApiUsageId =
            typeof (result as any)?.apiUsageId === "string" &&
            (result as any).apiUsageId.trim().length > 0
              ? (result as any).apiUsageId.trim()
              : undefined;

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }

          const taskId =
            result.data?.taskId ||
            result.data?.task_id ||
            result.data?.output?.task_id;
          if (!taskId) {
            throw new Error("未返回任务ID");
          }

          let videoUrl =
            result.data?.videoUrl ||
            result.data?.video_url ||
            result.data?.output?.video_url;

          if (!videoUrl) {
            const pollInterval = 5000;
            const maxAttempts = 180;

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
              await new Promise((r) => setTimeout(r, pollInterval));
              const queryResult = await queryDashscopeTask(taskId);
              if (!queryResult.success) continue;

              const status = String(queryResult.status || "").toLowerCase();
              if (status === "succeeded" || status === "success") {
                videoUrl = queryResult.videoUrl;
                break;
              }

              if (status === "failed" || status === "error") {
                if (wanApiUsageId) {
                  try {
                    await refundVideoTask(wanApiUsageId);
                  } catch (refundErr) {
                    console.warn("[Flow] Wan2.7 refund after task failed", {
                      nodeId,
                      apiUsageId: wanApiUsageId,
                      error:
                        refundErr instanceof Error
                          ? refundErr.message
                          : String(refundErr),
                    });
                  }
                }
                throw new Error("视频生成任务失败");
              }
            }
          }

          if (!videoUrl) {
            if (wanApiUsageId) {
              try {
                await refundVideoTask(wanApiUsageId);
              } catch (refundErr) {
                console.warn("[Flow] Wan2.7 refund after poll timeout", {
                  nodeId,
                  apiUsageId: wanApiUsageId,
                  error:
                    refundErr instanceof Error ? refundErr.message : String(refundErr),
                });
              }
            }
            throw new Error("任务查询超时，请稍后重试");
          }

          if (wanApiUsageId) {
            const processingTime = Math.max(0, Date.now() - generationStartedAt);
            void markVideoTaskSuccess(wanApiUsageId, processingTime).catch((markErr) => {
              console.warn("[Flow] Wan2.7 mark success failed", {
                nodeId,
                apiUsageId: wanApiUsageId,
                error: markErr instanceof Error ? markErr.message : String(markErr),
              });
            });
          }

          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail: undefined,
            prompt: promptText,
            quality: media.map((item) => item.type).join("+"),
            createdAt: new Date().toISOString(),
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? (() => {
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl,
                        thumbnail: undefined,
                        error: undefined,
                        videoVersion: Number(previousData.videoVersion || 0) + 1,
                        history: appendVideoHistory(
                          previousData.history as Array<Record<string, any>> | undefined,
                          historyEntry
                        ),
                      },
                    };
                  })()
                : n
            )
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: msg },
                  }
                : n
            )
          );
        }
        return;
      }

      if (node.type === "wan26") {
        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        // 检查是否有图片输入（判断 T2V 还是 I2V）
        const imageEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              isImageHandle(e.targetHandle)
          )
          .slice(0, 1);
        const hasImageInput = imageEdges.length > 0;

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    fallbackMessage: undefined,
                  },
                }
              : n
          )
        );

        try {
          let imgUrl: string | undefined = undefined;

          if (hasImageInput) {
            const imageDatas = await resolveEdgesAsDataUrls(imageEdges);
            if (!imageDatas.length) throw new Error("图片输入为空");
            for (const img of imageDatas) {
              const trimmed = typeof img === "string" ? img.trim() : "";
              if (!trimmed) continue;

              // 对 I2V 模式的图片进行尺寸校验和调整
              let processedUrl = trimmed;
              if (isRemoteUrl(trimmed)) {
                processedUrl = normalizeStableRemoteUrl(trimmed);
                // 远程 URL 需要下载后调整尺寸
                const adjusted = await validateAndAdjustImageForWan26(
                  processedUrl,
                  projectId
                );
                if (adjusted !== processedUrl) {
                  // 尺寸被调整了，需要重新上传
                  processedUrl = adjusted;
                }
              } else {
                // 本地 dataUrl 需要先上传后再调整（或者直接调整后上传）
                const dataUrl = ensureDataUrl(trimmed);
                const adjusted = await validateAndAdjustImageForWan26(
                  dataUrl,
                  projectId
                );
                processedUrl = adjusted;
              }
              imgUrl = processedUrl;
            }
          }

          const size = (node.data as any)?.size || "16:9";
          const resolution = (node.data as any)?.resolution || "720P";
          const duration = (node.data as any)?.duration || 5;
          const shotType = (node.data as any)?.shotType || "single";
          const audioInputEdge = currentEdges.find(
            (e) => e.target === nodeId && e.targetHandle === "audio"
          );
          let audioUrlFromEdge: string | undefined = undefined;
          if (audioInputEdge) {
            const audioSourceNode = rf.getNode(audioInputEdge.source);
            if (audioSourceNode) {
              const sourceData = (audioSourceNode.data || {}) as Record<string, any>;
              if (typeof sourceData.audioUrl === "string" && sourceData.audioUrl.trim()) {
                audioUrlFromEdge = sourceData.audioUrl.trim();
              } else if (Array.isArray(sourceData.audioUrls)) {
                const firstAudio = sourceData.audioUrls.find(
                  (value: unknown) => typeof value === "string" && value.trim().length > 0
                );
                if (typeof firstAudio === "string") {
                  audioUrlFromEdge = firstAudio.trim();
                }
              }
            }
            if (!audioUrlFromEdge) {
              throw new Error("语音输入为空");
            }
          }
          const audioUrl =
            audioUrlFromEdge ||
            (typeof (node.data as any)?.audioUrl === "string"
              ? (node.data as any).audioUrl.trim()
              : undefined);

          const wanGenerationStartedAt = Date.now();
          const result = await generateWan26ViaAPI({
            prompt: promptText,
            imgUrl: imgUrl,
            audioUrl: audioUrl,
            parameters: { size, resolution, duration, shot_type: shotType },
          });

          const wanApiUsageId =
            typeof (result as any)?.apiUsageId === "string" &&
            (result as any).apiUsageId.trim().length > 0
              ? (result as any).apiUsageId.trim()
              : undefined;

          const extractVideoUrl = (obj: any): string | undefined => {
            if (!obj) return undefined;
            return (
              obj.videoUrl ||
              obj.video_url ||
              obj.output?.video_url ||
              (Array.isArray(obj.output) && obj.output[0]?.video_url) ||
              obj.raw?.output?.video_url ||
              obj.raw?.video_url ||
              undefined
            );
          };

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }

          let videoUrl = extractVideoUrl(result.data);

          // I2V 异步模式：如果没有直接返回视频地址但有 taskId，则轮询
          const taskId = result.data?.taskId || result.data?.task_id;
          if (!videoUrl && taskId) {
            const pollInterval = 5000; // 5秒
            const maxAttempts = 180; // 最多180次（15分钟）

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              await new Promise((r) => setTimeout(r, pollInterval));

              const queryResult = await queryDashscopeTask(taskId);

              if (!queryResult.success) {
                continue; // 查询失败，继续重试
              }

              const status = queryResult.status?.toLowerCase();

              if (status === "succeeded" || status === "success") {
                videoUrl = queryResult.videoUrl;
                break;
              }

              if (status === "failed" || status === "error") {
                if (wanApiUsageId) {
                  try {
                    await refundVideoTask(wanApiUsageId);
                  } catch (refundErr) {
                    console.warn("[Flow] Wan2.6 refund after task failed", {
                      nodeId,
                      apiUsageId: wanApiUsageId,
                      error:
                        refundErr instanceof Error
                          ? refundErr.message
                          : String(refundErr),
                    });
                  }
                }
                throw new Error("视频生成任务失败");
              }
              // pending/running 状态继续轮询
            }

            if (!videoUrl) {
              if (wanApiUsageId) {
                try {
                  await refundVideoTask(wanApiUsageId);
                } catch (refundErr) {
                  console.warn("[Flow] Wan2.6 refund after poll timeout", {
                    nodeId,
                    apiUsageId: wanApiUsageId,
                    error:
                      refundErr instanceof Error
                        ? refundErr.message
                        : String(refundErr),
                  });
                }
              }
              throw new Error("任务查询超时，请稍后重试");
            }
          }

          if (!videoUrl) {
            throw new Error("未返回视频地址");
          }

          if (wanApiUsageId) {
            const processingTime = Math.max(0, Date.now() - wanGenerationStartedAt);
            void markVideoTaskSuccess(wanApiUsageId, processingTime).catch((markErr) => {
              console.warn("[Flow] Wan2.6 mark success failed", {
                nodeId,
                apiUsageId: wanApiUsageId,
                error: markErr instanceof Error ? markErr.message : String(markErr),
              });
            });
          }

          const thumbnail = result.data?.thumbnail;
          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail,
            prompt: promptText,
            quality: hasImageInput ? "I2V" : "T2V",
            createdAt: new Date().toISOString(),
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? (() => {
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl,
                        thumbnail,
                        error: undefined,
                        videoVersion: Number(previousData.videoVersion || 0) + 1,
                        history: appendVideoHistory(
                          previousData.history as Array<Record<string, any>> | undefined,
                          historyEntry
                        ),
                      },
                    };
                  })()
                : n
            )
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: msg,
                      fallbackMessage: undefined,
                    },
                  }
                : n
            )
          );
        }
        return;
      }

      // Wan2.6 R2V 节点处理逻辑（参考视频生成视频）
      if (node.type === "wan2R2V") {
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        const sanitizeMediaUrl = (url?: string | null) => {
          if (!url || typeof url !== "string") return undefined;
          const trimmed = url.trim();
          if (!trimmed) return undefined;
          const markdownSplit = trimmed.split("](");
          const candidate =
            markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
          const spaceIdx = candidate.indexOf(" ");
          return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
        };

        const resolveVideoUrl = (edge: Edge): string | undefined => {
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) return undefined;
          const data = (srcNode.data as any) || {};
          const direct =
            data.videoUrl ||
            data.video_url ||
            data.output?.video_url ||
            (Array.isArray(data.output)
              ? data.output[0]?.video_url
              : undefined) ||
            data.raw?.output?.video_url ||
            data.raw?.video_url;
          const fromHistory = Array.isArray(data.history)
            ? data.history[0]?.videoUrl
            : undefined;
          return sanitizeMediaUrl(direct) || sanitizeMediaUrl(fromHistory);
        };

        const videoEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              typeof e.targetHandle === "string" &&
              e.targetHandle.startsWith("video-")
          )
          .sort((a, b) =>
            String(a.targetHandle).localeCompare(String(b.targetHandle))
          );
        if (!videoEdges.length) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少参考视频输入",
                    },
                  }
                : n
            )
          );
          return;
        }

        const referenceVideoUrls = videoEdges
          .map(resolveVideoUrl)
          .filter((v): v is string => typeof v === "string" && v.length > 0);
        if (!referenceVideoUrls.length) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "参考视频为空",
                    },
                  }
                : n
            )
          );
          return;
        }

        const sizeMapping: Record<string, string> = {
          "16:9": "1280*720",
          "9:16": "720*1280",
          "1:1": "960*960",
          "4:3": "1088*832",
          "3:4": "832*1088",
        };
        const size = (node.data as any)?.size || "16:9";
        const duration = (node.data as any)?.duration || 5;
        const shotType = (node.data as any)?.shotType || "single";
        const mappedSize = sizeMapping[size] || size;

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        try {
          const result = await generateWan26R2VViaAPI({
            prompt: promptText,
            referenceVideoUrls,
            parameters: { size: mappedSize, duration, shot_type: shotType },
          });

          const extractVideoUrl = (obj: any): string | undefined => {
            if (!obj) return undefined;
            return (
              obj.videoUrl ||
              obj.video_url ||
              obj.output?.video_url ||
              (Array.isArray(obj.output) && obj.output[0]?.video_url) ||
              obj.raw?.output?.video_url ||
              obj.raw?.video_url ||
              undefined
            );
          };

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }
          const videoUrl = extractVideoUrl(result.data);
          if (!videoUrl) {
            throw new Error("未返回视频地址");
          }

          const thumbnail = result.data?.thumbnail;
          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail,
            prompt: promptText,
            quality: "视频融合",
            createdAt: new Date().toISOString(),
            referenceCount: referenceVideoUrls.length,
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? (() => {
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl,
                        thumbnail,
                        error: undefined,
                        videoVersion: Number(previousData.videoVersion || 0) + 1,
                        history: appendVideoHistory(
                          previousData.history as Array<Record<string, any>> | undefined,
                          historyEntry
                        ),
                      },
                    };
                  })()
                : n
            )
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // HappyHorse 1.0 R2V 节点处理逻辑（参考图生成视频）
      if (node.type === "happyhorseR2V") {
        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        const promptTrimmed = (promptText || "").trim();
        if (!promptTrimmed) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        type HHModel =
          | "happyhorse-1.0-t2v"
          | "happyhorse-1.0-i2v"
          | "happyhorse-1.0-r2v"
          | "happyhorse-1.0-video-edit";
        const allowedModels: HHModel[] = [
          "happyhorse-1.0-t2v",
          "happyhorse-1.0-i2v",
          "happyhorse-1.0-r2v",
          "happyhorse-1.0-video-edit",
        ];
        const rawModel = (node.data as any)?.model;
        const hhModel: HHModel = allowedModels.includes(rawModel)
          ? (rawModel as HHModel)
          : "happyhorse-1.0-r2v";

        const referenceCountRaw = Number((node.data as any)?.referenceCount);
        const referenceCount = Number.isFinite(referenceCountRaw)
          ? Math.min(9, Math.max(1, Math.round(referenceCountRaw)))
          : 1;

        // image-N edges（按 model 决定取多少个）
        const allowedImageHandles =
          hhModel === "happyhorse-1.0-r2v"
            ? referenceCount
            : hhModel === "happyhorse-1.0-i2v" ||
              hhModel === "happyhorse-1.0-video-edit"
            ? 1
            : 0;
        const imageEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              typeof e.targetHandle === "string" &&
              /^image-\d+$/.test(e.targetHandle)
          )
          .sort((a, b) => {
            const ai = Number(String(a.targetHandle).slice(6));
            const bi = Number(String(b.targetHandle).slice(6));
            return ai - bi;
          })
          .filter((e) => {
            const idx = Number(String(e.targetHandle).slice(6));
            return idx >= 1 && idx <= allowedImageHandles;
          });

        // video-edit 必须连接一个视频源
        const videoEdge =
          hhModel === "happyhorse-1.0-video-edit"
            ? currentEdges.find(
                (e) => e.target === nodeId && e.targetHandle === "video"
              )
            : undefined;

        if (
          (hhModel === "happyhorse-1.0-i2v" || hhModel === "happyhorse-1.0-r2v") &&
          !imageEdges.length
        ) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error:
                        hhModel === "happyhorse-1.0-i2v"
                          ? "请连接 1 张参考图"
                          : "请至少连接 1 张参考图",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (hhModel === "happyhorse-1.0-video-edit") {
          if (!videoEdge) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "请连接 1 个视频输入",
                      },
                    }
                  : n
              )
            );
            return;
          }
          if (!imageEdges.length) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "请连接 1 张参考图",
                      },
                    }
                  : n
              )
            );
            return;
          }
        }

        const uploadResolvedImageEdge = async (
          edge: Edge
        ): Promise<string | undefined> => {
          const images = await resolveEdgesAsDataUrls([edge]);
          const firstImage = images.find(
            (value) => typeof value === "string" && value.trim().length > 0
          );
          if (!firstImage) return undefined;
          const trimmed = firstImage.trim();
          if (isRemoteUrl(trimmed)) {
            return normalizeStableRemoteUrl(trimmed);
          }
          const uploaded = await uploadImageToOSS(
            ensureDataUrl(trimmed),
            projectId
          );
          return uploaded || undefined;
        };

        const sanitizeRemoteVideoUrl = (raw?: string | null) => {
          if (!raw || typeof raw !== "string") return undefined;
          const trimmed = raw.trim();
          if (!trimmed) return undefined;
          const split = trimmed.split("](");
          const candidate = split.length > 1 ? split[0] : trimmed;
          const space = candidate.indexOf(" ");
          return space > 0 ? candidate.slice(0, space) : candidate;
        };
        const resolveVideoEdgeUrl = (edge?: Edge): string | undefined => {
          if (!edge) return undefined;
          const src = rf.getNode(edge.source);
          if (!src) return undefined;
          const d = (src.data as any) || {};
          const direct =
            d.videoUrl ||
            d.video_url ||
            d.output?.video_url ||
            (Array.isArray(d.output) ? d.output[0]?.video_url : undefined) ||
            d.raw?.output?.video_url ||
            d.raw?.video_url ||
            d.url ||
            d.src;
          const fromHistory = Array.isArray(d.history)
            ? d.history[0]?.videoUrl
            : undefined;
          return (
            sanitizeRemoteVideoUrl(direct) || sanitizeRemoteVideoUrl(fromHistory)
          );
        };

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "running", error: undefined } }
              : n
          )
        );

        try {
          const referenceImageUrls: string[] = [];
          for (const edge of imageEdges) {
            const url = await uploadResolvedImageEdge(edge);
            if (url) referenceImageUrls.push(url);
          }
          const inputVideoUrl = resolveVideoEdgeUrl(videoEdge);

          if (
            (hhModel === "happyhorse-1.0-i2v" ||
              hhModel === "happyhorse-1.0-r2v") &&
            !referenceImageUrls.length
          ) {
            throw new Error("参考图为空");
          }
          if (hhModel === "happyhorse-1.0-video-edit") {
            if (!inputVideoUrl) throw new Error("视频输入为空");
            if (!referenceImageUrls.length) throw new Error("参考图为空");
          }

          const ratio =
            (((node.data as any)?.ratio as
              | "16:9"
              | "9:16"
              | "1:1"
              | "4:3"
              | "3:4"
              | undefined) || "16:9");
          const resolution = (((node.data as any)?.resolution as
            | "720P"
            | "1080P"
            | undefined) || "720P");
          const durationVal = (() => {
            const raw = Number((node.data as any)?.duration);
            if (!Number.isFinite(raw)) return 5;
            return Math.min(15, Math.max(3, Math.round(raw)));
          })();

          // 按所选模型组装 media + parameters
          let media: Array<{
            type: "first_frame" | "reference_image" | "video";
            url: string;
          }> | undefined;
          const parameters: Record<string, any> = { resolution };
          if (hhModel === "happyhorse-1.0-t2v") {
            parameters.ratio = ratio;
            parameters.duration = durationVal;
          } else if (hhModel === "happyhorse-1.0-i2v") {
            media = [{ type: "first_frame", url: referenceImageUrls[0] }];
            parameters.duration = durationVal;
          } else if (hhModel === "happyhorse-1.0-r2v") {
            media = referenceImageUrls.map((url) => ({
              type: "reference_image" as const,
              url,
            }));
            parameters.ratio = ratio;
            parameters.duration = durationVal;
          } else {
            // video-edit
            media = [
              { type: "video", url: inputVideoUrl as string },
              { type: "reference_image", url: referenceImageUrls[0] },
            ];
            // 上游不接受 duration，但前端预扣按 durationVal 计费（保持节点 UI 一致）
            parameters.duration = durationVal;
          }

          const result = await generateHappyhorseVideoViaAPI({
            model: hhModel,
            prompt: promptTrimmed,
            media,
            parameters: parameters as any,
          });

          const extractVideoUrl = (obj: any): string | undefined => {
            if (!obj) return undefined;
            return (
              obj.videoUrl ||
              obj.video_url ||
              obj.output?.video_url ||
              (Array.isArray(obj.output) && obj.output[0]?.video_url) ||
              obj.raw?.output?.video_url ||
              obj.raw?.video_url ||
              undefined
            );
          };

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }
          const videoUrl = extractVideoUrl(result.data);
          const taskId =
            result.data?.taskId ||
            result.data?.task_id ||
            result.data?.output?.task_id ||
            result.data?.raw?.output?.task_id;
          const happyhorseApiUsageId =
            typeof (result as any)?.apiUsageId === "string" &&
            (result as any).apiUsageId.trim().length > 0
              ? (result as any).apiUsageId.trim()
              : undefined;
          if (!videoUrl && taskId) {
            const quality = `${resolution} / ${durationVal}s`;
            const normalizedTaskId = String(taskId);
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "running",
                        error: undefined,
                        taskId: normalizedTaskId,
                        apiUsageId: happyhorseApiUsageId,
                        pendingPrompt: promptTrimmed,
                        pendingQuality: quality,
                        pendingReferenceCount: referenceImageUrls.length,
                      },
                    }
                  : n
              )
            );
            void pollHappyhorseTask({
              nodeId,
              taskId: normalizedTaskId,
              apiUsageId: happyhorseApiUsageId,
              prompt: promptTrimmed,
              quality,
              referenceCount: referenceImageUrls.length,
            });
            return;
          }
          if (!videoUrl) {
            throw new Error("未返回视频地址或任务ID");
          }

          const thumbnail = (result.data as any)?.thumbnail;
          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail,
            prompt: promptTrimmed,
            quality: `${resolution} / ${durationVal}s`,
            createdAt: new Date().toISOString(),
            referenceCount: referenceImageUrls.length,
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? (() => {
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl,
                        thumbnail,
                        error: undefined,
                        videoVersion:
                          Number(previousData.videoVersion || 0) + 1,
                        history: appendVideoHistory(
                          previousData.history as
                            | Array<Record<string, any>>
                            | undefined,
                          historyEntry
                        ),
                      },
                    };
                  })()
                : n
            )
          );
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      if (node.type === "sora2Character") {
        const model =
          (node.data as any)?.model === "sora-2"
            ? "sora-2"
            : "sora-2-pro";
        const timestampsRaw =
          typeof (node.data as any)?.timestamps === "string"
            ? (node.data as any).timestamps.trim()
            : "";
        const timestamps = timestampsRaw || "1,3";
        const sanitizeMediaUrl = (url?: string | null) => {
          if (!url || typeof url !== "string") return undefined;
          const trimmed = url.trim();
          if (!trimmed) return undefined;
          const markdownSplit = trimmed.split("](");
          const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
          const spaceIdx = candidate.indexOf(" ");
          return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
        };

        const resolveVideoUrl = (edge: Edge): string | undefined => {
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) return undefined;
          const data = (srcNode.data as any) || {};
          const direct =
            data.videoUrl ||
            data.video_url ||
            data.output?.video_url ||
            (Array.isArray(data.output) ? data.output[0]?.video_url : undefined) ||
            data.raw?.output?.video_url ||
            data.raw?.video_url;
          const fromHistory = Array.isArray(data.history)
            ? data.history[0]?.videoUrl
            : undefined;
          return sanitizeMediaUrl(direct) || sanitizeMediaUrl(fromHistory);
        };

        const videoEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "video"
        );
        const inputVideoUrl = videoEdge ? resolveVideoUrl(videoEdge) : undefined;
        if (!inputVideoUrl) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: lt("请连接视频输入", "Please connect video input"),
                    },
                  }
                : n
            )
          );
          return;
        }

        // 创建角色：设置参考视频预览
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, videoUrl: inputVideoUrl } } : n
          )
        );

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    timestamps,
                    model,
                  },
                }
              : n
          )
        );

        try {
          const createResult = await createSora2CharacterViaAPI({
            model,
            timestamps,
            url: inputVideoUrl,
          });
          if (!createResult.success || !createResult.data?.taskId) {
            throw new Error(createResult.error?.message || "创建角色任务失败");
          }
          const taskId = createResult.data.taskId;

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      taskId,
                      status: "running",
                      progress: 0,
                      error: undefined,
                    },
                  }
                : n
            )
          );

          let completed = false;
          for (let attempt = 0; attempt < 90; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const taskResult = await querySora2CharacterTaskViaAPI(taskId);
            if (!taskResult.success || !taskResult.data) {
              const errMsg =
                typeof taskResult.error?.message === "string"
                  ? taskResult.error.message.trim()
                  : "";
              const errCode =
                typeof taskResult.error?.code === "string"
                  ? taskResult.error.code
                  : "";
              const isClientError = /^HTTP_4\d\d$/.test(errCode);
              const isRetryableServerError =
                /^HTTP_5\d\d$/.test(errCode) ||
                errCode === "NETWORK_ERROR" ||
                errCode === "TIMEOUT_ERROR";
              if (isClientError) {
                throw new Error(errMsg || "角色任务查询失败");
              }
              if (errMsg && !isRetryableServerError) {
                throw new Error(errMsg || "角色任务查询失败");
              }
              continue;
            }
            const status = String(taskResult.data.status || "").toLowerCase();
            const progress =
              typeof taskResult.data.progress === "number"
                ? taskResult.data.progress
                : undefined;
            const characters = Array.isArray(taskResult.data.characters)
              ? taskResult.data.characters
              : [];

            if (status === "completed" || status === "succeeded") {
              const firstCharacterId = characters.find(
                (item) => typeof item?.id === "string" && item.id.trim().length > 0
              )?.id;
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          status: "succeeded",
                          progress: 100,
                          taskId,
                          characters,
                          characterUrl: firstCharacterId,
                          error: undefined,
                        },
                      }
                    : n
                )
              );
              completed = true;
              break;
            }

            if (["failed", "error", "cancelled", "terminated"].includes(status)) {
              throw new Error("角色任务执行失败");
            }

            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "running",
                        progress,
                        taskId,
                        characters,
                        error: undefined,
                      },
                    }
                  : n
              )
            );
          }

          if (!completed) {
            throw new Error("角色任务轮询超时");
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : "角色任务失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      if (node.type === "sora2Video") {
        const generationType = getSora2GenerationType(node.data);
        const isSora2CreateCharacterMode = generationType === "sora2-create-character";

        if (isSora2CreateCharacterMode) {
          const model =
            (node.data as any)?.model === "sora-2"
              ? "sora-2"
              : "sora-2-pro";
          const timestampsRaw =
            typeof (node.data as any)?.timestamps === "string"
              ? (node.data as any).timestamps.trim()
              : "";
          const timestamps = timestampsRaw || "1,3";

          const sanitizeMediaUrl = (url?: string | null) => {
            if (!url || typeof url !== "string") return undefined;
            const trimmed = url.trim();
            if (!trimmed) return undefined;
            const markdownSplit = trimmed.split("](");
            const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
            const spaceIdx = candidate.indexOf(" ");
            return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
          };

          const resolveVideoUrl = (edge: Edge): string | undefined => {
            const srcNode = rf.getNode(edge.source);
            if (!srcNode) return undefined;
            const data = (srcNode.data as any) || {};
            const direct =
              data.videoUrl ||
              data.video_url ||
              data.output?.video_url ||
              (Array.isArray(data.output) ? data.output[0]?.video_url : undefined) ||
              data.raw?.output?.video_url ||
              data.raw?.video_url;
            const fromHistory = Array.isArray(data.history)
              ? data.history[0]?.videoUrl
              : undefined;
            return sanitizeMediaUrl(direct) || sanitizeMediaUrl(fromHistory);
          };

          const videoEdge = currentEdges.find(
            (e) => e.target === nodeId && e.targetHandle === "video"
          );
          const inputVideoUrl = videoEdge ? resolveVideoUrl(videoEdge) : undefined;
          if (!inputVideoUrl) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "请连接视频输入",
                      },
                    }
                  : n
              )
            );
            return;
          }

          // 创建角色：设置参考视频预览
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, videoUrl: inputVideoUrl } } : n
            )
          );

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "running",
                      error: undefined,
                      timestamps,
                      model,
                    },
                  }
                : n
            )
          );

          try {
            const createResult = await createSora2CharacterViaAPI({
              model,
              timestamps,
              url: inputVideoUrl,
            });
            if (!createResult.success || !createResult.data?.taskId) {
              throw new Error(createResult.error?.message || "创建角色任务失败");
            }
            const taskId = createResult.data.taskId;

            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        taskId,
                        status: "running",
                        progress: 0,
                        error: undefined,
                      },
                    }
                  : n
              )
            );

            let completed = false;
            for (let attempt = 0; attempt < 90; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 5000));
              const taskResult = await querySora2CharacterTaskViaAPI(taskId);
              if (!taskResult.success || !taskResult.data) {
                const errMsg =
                  typeof taskResult.error?.message === "string"
                    ? taskResult.error.message.trim()
                    : "";
                const errCode =
                  typeof taskResult.error?.code === "string"
                    ? taskResult.error.code
                    : "";
                const isClientError = /^HTTP_4\d\d$/.test(errCode);
                const isRetryableServerError =
                  /^HTTP_5\d\d$/.test(errCode) ||
                  errCode === "NETWORK_ERROR" ||
                  errCode === "TIMEOUT_ERROR";
                if (isClientError) {
                  throw new Error(errMsg || "角色任务查询失败");
                }
                if (errMsg && !isRetryableServerError) {
                  throw new Error(errMsg || "角色任务查询失败");
                }
                continue;
              }
              const status = String(taskResult.data.status || "").toLowerCase();
              const progress =
                typeof taskResult.data.progress === "number"
                  ? taskResult.data.progress
                  : undefined;
              const characters = Array.isArray(taskResult.data.characters)
                ? taskResult.data.characters
                : [];

              if (status === "completed" || status === "succeeded") {
                const firstCharacterId = characters.find(
                  (item) => typeof item?.id === "string" && item.id.trim().length > 0
                )?.id;
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "succeeded",
                            progress: 100,
                            taskId,
                            characters,
                            characterUrl: firstCharacterId,
                            error: undefined,
                          },
                        }
                      : n
                  )
                );
                completed = true;
                break;
              }

              if (["failed", "error", "cancelled", "terminated"].includes(status)) {
                throw new Error("角色任务执行失败");
              }

              setNodes((ns) =>
                ns.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          status: "running",
                          progress,
                          taskId,
                          characters,
                          error: undefined,
                        },
                      }
                    : n
                )
              );
            }

            if (!completed) {
              throw new Error("角色任务轮询超时");
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : "角色任务失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
          }
          return;
        }

        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        const promptTextNormalized =
          typeof promptText === "string" ? promptText.trim() : "";
        if (!promptTextNormalized) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        const clipDuration = (() => {
          const nextDuration = (node.data as any)?.clipDuration;
          if (typeof nextDuration === "number" && Number.isFinite(nextDuration)) {
            return nextDuration;
          }
          const legacyDuration = (node.data as any)?.duration;
          if (typeof legacyDuration === "number" && Number.isFinite(legacyDuration)) {
            return legacyDuration;
          }
          return 10;
        })();
        const aspectSetting = (() => {
          const nextAspect = (node.data as any)?.aspectRatio;
          const legacyAspect = (node.data as any)?.size;
          const raw =
            typeof nextAspect === "string" && nextAspect.trim()
              ? nextAspect.trim()
              : typeof legacyAspect === "string" && legacyAspect.trim()
              ? legacyAspect.trim()
              : "";
          if (!raw) return "16:9";
          const ratioMatch = raw.match(/(\d{1,2}:\d{1,2})/);
          return ratioMatch?.[1] || raw;
        })();
        const modelSetting = (() => {
          const raw = (node.data as any)?.model;
          return raw === "sora-2" || raw === "sora-2-pro"
            ? raw
            : "sora-2-pro";
        })();
        const styleSetting =
          typeof (node.data as any)?.style === "string"
            ? (node.data as any).style.trim()
            : "";
        // 内置默认：水印关、缩略图开、隐私关
        const watermarkSetting = false;
        const thumbnailSetting = true;
        const privateModeSetting = false;
        const storyboardSetting = (node.data as any)?.storyboard === true;
        const characterEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "character"
        );
        const hasCharacterConnection = Boolean(characterEdge);
        const characterSourceHandle =
          typeof characterEdge?.sourceHandle === "string"
            ? characterEdge.sourceHandle
            : "";
        const characterSourceNode = characterEdge
          ? rf.getNode(characterEdge.source)
          : undefined;
        const characterTaskIdFromEdge =
          characterSourceHandle === "character" &&
          typeof (characterSourceNode?.data as any)?.taskId === "string"
            ? String((characterSourceNode?.data as any).taskId).trim()
            : "";
        const characterTaskIdSetting = characterTaskIdFromEdge;
        const characterTimestampsSetting =
          characterEdge &&
          typeof (node.data as any)?.characterTimestamps === "string"
            ? (node.data as any).characterTimestamps.trim()
            : "";
        const characterVideoUrlFromEdge = (() => {
          if (!characterEdge) return "";
          if (characterSourceHandle !== "video" && characterSourceHandle !== "video-out") {
            return "";
          }
          const sourceData = (characterSourceNode?.data as any) || {};
          const candidate = [
            sourceData.characterUrl,
            sourceData.videoUrl,
            sourceData.url,
            sourceData.video,
            sourceData.video_url,
          ].find(
            (item) => typeof item === "string" && item.trim().length > 0
          ) as string | undefined;
          if (!candidate) return "";
          const trimmed = candidate.trim();
          return isRemoteUrl(trimmed) ? normalizeStableRemoteUrl(trimmed) : trimmed;
        })();
        let characterUrlSetting =
          characterSourceHandle === "character" &&
          typeof (characterSourceNode?.data as any)?.characterUrl === "string"
            ? String((characterSourceNode?.data as any).characterUrl).trim()
            : characterVideoUrlFromEdge;
        let finalPromptText = promptTextNormalized;

        if (characterEdge && !characterTaskIdSetting && !characterUrlSetting) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "角色视频未就绪，请先生成并连接可用的视频输出",
                    },
                  }
                : n
            )
          );
          return;
        }

        if (characterTaskIdSetting) {
          try {
            const characterTaskRes = await querySora2CharacterTaskViaAPI(characterTaskIdSetting);
            if (!characterTaskRes.success || !characterTaskRes.data) {
              throw new Error(characterTaskRes.error?.message || "角色任务查询失败");
            }
            const characters = Array.isArray(characterTaskRes.data.characters)
              ? characterTaskRes.data.characters
              : [];
            const usernames = characters
              .map((item) =>
                typeof item?.username === "string" ? item.username.trim() : ""
              )
              .filter((item) => item.length > 0);
            if (usernames.length) {
              const missingMentions = usernames
                .map((name) => `@${name}`)
                .filter((mention) => !finalPromptText.includes(mention));
              if (missingMentions.length) {
                finalPromptText = `${finalPromptText} ${missingMentions.join(" ")}`.trim();
              }
            }
            if (!characterUrlSetting) {
              const firstCharacterId = characters.find(
                (item) => typeof item?.id === "string" && item.id.trim().length > 0
              )?.id;
              if (firstCharacterId) {
                characterUrlSetting = firstCharacterId;
              }
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : "角色任务查询失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }
        }

        const imageEdges = hasCharacterConnection
          ? []
          : currentEdges
              .filter((e) => e.target === nodeId && e.targetHandle === "image")
              .slice(0, SORA2_MAX_REFERENCE_IMAGES);
        const referenceImages = hasCharacterConnection
          ? []
          : await resolveEdgesAsDataUrls(imageEdges);

        const generationStartMs = Date.now();
        const referenceImageUrls: string[] = [];
        if (referenceImages.length) {
          try {
            for (const img of referenceImages) {
              const trimmed = typeof img === "string" ? img.trim() : "";
              if (!trimmed) continue;
              if (isRemoteUrl(trimmed)) {
                referenceImageUrls.push(normalizeStableRemoteUrl(trimmed));
                continue;
              }
              const dataUrl = ensureDataUrl(trimmed);
              const uploaded = await uploadImageToOSS(dataUrl, projectId);
              if (!uploaded) {
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "failed",
                            error: "参考图上传失败",
                          },
                        }
                      : n
                  )
                );
                return;
              }
              referenceImageUrls.push(uploaded);
            }
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : "参考图上传失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );
        const videoQuality: Sora2VideoQuality = "sd";

        // 仅将受支持的取值传给后端（避免非法值导致请求失败）
        const aspectRatioForAPI =
          aspectSetting === "16:9" || aspectSetting === "9:16"
            ? (aspectSetting as "16:9" | "9:16")
            : undefined;
        const durationSecondsForAPI =
          clipDuration === 10 || clipDuration === 15 || clipDuration === 25
            ? (clipDuration as 10 | 15 | 25)
            : undefined;

        try {
          console.log("🎬 [Flow] Sending Sora2 video request", {
            nodeId,
            quality: videoQuality,
            model: modelSetting,
            aspectRatio: aspectRatioForAPI,
            duration: durationSecondsForAPI,
            hasCharacterConnection,
            referenceCount: referenceImageUrls.length,
            promptPreview: finalPromptText.slice(0, 120),
          });
          const videoResult = await requestSora2VideoGeneration(
            finalPromptText,
            hasCharacterConnection ? undefined : referenceImageUrls,
            {
              quality: videoQuality,
              model: modelSetting,
              aspectRatio: aspectRatioForAPI,
              durationSeconds: durationSecondsForAPI,
              watermark: watermarkSetting,
              thumbnail: thumbnailSetting,
              privateMode: privateModeSetting,
              style: styleSetting || undefined,
              storyboard: storyboardSetting,
              characterUrl: characterUrlSetting || undefined,
              characterTimestamps: characterTimestampsSetting || undefined,
              characterTaskId: characterTaskIdSetting || undefined,
            }
          );
          console.log("✅ [Flow] Sora2 video response received", {
            nodeId,
            videoUrl: videoResult.videoUrl,
            thumbnail: videoResult.thumbnailUrl,
            status: videoResult.status,
            taskId: videoResult.taskId,
            referencedUrls: videoResult.referencedUrls?.length,
          });

          // 将视频上传到 OSS，获取持久化 URL
          const projectId = useProjectContentStore.getState().projectId;
          let persistedVideoUrl = videoResult.videoUrl;
          let persistedThumbnail = videoResult.thumbnailUrl;

          try {
            console.log("🎬 [Flow] Uploading Sora2 video to OSS...");
            const ossVideoUrl = await uploadVideoToOSS(videoResult.videoUrl, projectId);
            if (ossVideoUrl) {
              persistedVideoUrl = ossVideoUrl;
              console.log("✅ [Flow] Sora2 video uploaded to OSS:", ossVideoUrl);
            }
          } catch (uploadErr) {
            console.warn("⚠️ [Flow] Failed to upload video to OSS, using original URL", uploadErr);
          }

          setNodes((ns) =>
            ns.map((n) => {
              if (n.id !== nodeId) return n;
              const previousData = (n.data as any) || {};
              const nextThumbnail = persistedThumbnail || previousData.thumbnail;
              const elapsedSeconds = Math.max(
                1,
                Math.round((Date.now() - generationStartMs) / 1000)
              );
              const historyEntry: Sora2VideoHistoryItem = {
                id: `sora2-history-${Date.now()}`,
                videoUrl: persistedVideoUrl,
                thumbnail: nextThumbnail,
                prompt: finalPromptText,
                quality: videoQuality,
                createdAt: new Date().toISOString(),
                elapsedSeconds,
              };
              return {
                ...n,
                data: {
                  ...previousData,
                  status: "succeeded",
                  videoUrl: persistedVideoUrl,
                  thumbnail: nextThumbnail,
                  error: undefined,
                  fallbackMessage: (videoResult as any).fallbackMessage,
                  videoVersion: Number(previousData.videoVersion || 0) + 1,
                  history: appendSora2History(
                    previousData.history as Sora2VideoHistoryItem[] | undefined,
                    historyEntry
                  ),
                },
              };
            })
          );
        } catch (error) {
          console.warn("❌ [Flow] Sora2 video request failed", {
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          });
          const msg = error instanceof Error ? error.message : "视频生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // 新的视频生成节点处理逻辑（可灵 Kling、Kling O1、Vidu、Seedance）
      const normalizedVideoNodeType = normalizeFlowNodeType(node.type || "") || node.type || "";
      const newVideoNodeTypes = [
        "klingVideo",
        "kling26Video",
        "kling30Video",
        "klingO1Video",
        "viduVideo",
        "viduQ3",
        "doubaoVideo",
        "seedance20Video",
      ];
      if (newVideoNodeTypes.includes(normalizedVideoNodeType)) {
        const projectId = useProjectContentStore.getState().projectId;
        const rawNodeData = ((node.data as any) || {}) as Record<string, any>;
        const isLegacyKling30Node = node.type === "kling30Video";
        const isLegacyKling26Node = node.type === "kling26Video";
        const inferredViduModel =
          rawNodeData.viduModel ||
          (node.type === "viduQ3" || rawNodeData.provider === "viduq3-pro" ? "q3" : "q2");
        const normalizedViduModelVariant = normalizeViduModelValue(inferredViduModel);
        const viduNodeDataForProvider = {
          ...rawNodeData,
          viduModel: normalizedViduModelVariant,
        };
        // 根据节点类型确定 provider
        let provider: string;
        const klingModel =
          rawNodeData.klingModel ||
          (isLegacyKling30Node || rawNodeData.provider === "kling-o3"
            ? "kling-v3-0"
            : isLegacyKling26Node || rawNodeData.provider === "kling-2.6"
            ? "kling-v2-6"
            : "kling-v2-6");
        if (normalizedVideoNodeType === "klingO1Video") {
          provider = "kling-o3";
        } else if (normalizedVideoNodeType === "klingVideo" || normalizedVideoNodeType === "kling26Video") {
          provider = klingModel === "kling-v3-0" ? "kling-o3" : "kling-2.6";
        } else if (
          normalizedVideoNodeType === "doubaoVideo" ||
          normalizedVideoNodeType === "seedance20Video"
        ) {
          provider = "doubao";
        } else if (normalizedVideoNodeType === "viduVideo" || normalizedVideoNodeType === "viduQ3") {
          provider = getEffectiveViduProvider(viduNodeDataForProvider);
        } else {
          provider = rawNodeData.provider || "kling";
        }
        const isSeedanceNode = provider === "doubao";
        const seedanceModelForRequest = normalizeSeedanceModelValue(
          rawNodeData.seedanceModel ||
            (normalizedVideoNodeType === "seedance20Video"
              ? "seedance-2.0"
              : "seedance-1.5-pro")
        );
        const isSeedance20Request = isSeedance20ModelValue(seedanceModelForRequest);
        const seedanceMode = isSeedanceNode ? inferSeedanceMode(node) : undefined;
        const seedanceModeSpec = isSeedanceNode ? getSeedanceModeSpec(node) : undefined;

        // 先获取图片数量，判断是否需要 prompt
        const maxImages =
          isSeedanceNode && seedanceModeSpec
            ? seedanceModeSpec.imageHandleMax + seedanceModeSpec.image2HandleMax
            : provider === "vidu" || provider === "viduq3-pro"
            ? getEffectiveViduMaxReferenceImages(viduNodeDataForProvider)
            : provider === "kling" || provider === "kling-2.6" || provider === "kling-o3"
            ? KLING_MAX_REFERENCE_IMAGES
            : SORA2_MAX_REFERENCE_IMAGES;

        // 检查是否有视频输入
        const hasVideoInput = currentEdges.some(
          (e) => e.target === nodeId && e.targetHandle === "video"
        );

        const imageHandlePriority = (handle?: string | null): number => {
          if (handle === "image") return 0;
          if (handle === "image-2") return 1;
          if (handle === "elementImg") return 2;
          return 99;
        };

        const imageEdges = currentEdges
          .filter((e) => {
            if (e.target !== nodeId) return false;
            // 有视频输入时，只收集 image / image-2，排除 elementImg
            if (hasVideoInput) {
              return e.targetHandle === "image" || e.targetHandle === "image-2";
            }
            // 无视频输入时，收集 image / image-2 / elementImg
            return (
              e.targetHandle === "image" ||
              e.targetHandle === "image-2" ||
              e.targetHandle === "elementImg"
            );
          })
          .sort((a, b) => {
            const handleDelta =
              imageHandlePriority(a.targetHandle) -
              imageHandlePriority(b.targetHandle);
            if (handleDelta !== 0) return handleDelta;
            return String(a.id || "").localeCompare(String(b.id || ""));
          })
          .slice(0, maxImages);
        const imageCount = imageEdges.length;
        const hasImage2Edge = imageEdges.some((edge) => edge.targetHandle === "image-2");

        // 获取 prompt
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);

        // Vidu 智能模式判断逻辑：
        // - 0张图必须有prompt (text2video)
        // - 1-2张图：有prompt用reference2video，无prompt用img2video/start-end2video
        // - 3-7张图：使用reference2video（必须有prompt，无prompt时使用默认）
        let finalPrompt = promptText;
        const failCurrentVideoNode = (message: string) => {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: message } }
                : n
            )
          );
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "warning" },
            })
          );
        };

        if (isSeedanceNode && seedanceMode && seedanceModeSpec) {
          const seedanceImageCount = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "image"
          ).length;
          const seedanceImage2Count = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "image-2"
          ).length;
          const seedanceVideoCount = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "video"
          ).length;
          const seedanceAudioCount = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "audio"
          ).length;
          const seedanceTotalImageCount = seedanceImageCount + seedanceImage2Count;

          if (isSeedance20Request) {
            if (seedanceMode === "start_end") {
              if (seedanceTotalImageCount < 1 || seedanceTotalImageCount > 2) {
                failCurrentVideoNode("Seedance 2.0 帧模式需要 1-2 张图片");
                return;
              }
            } else if (
              !promptText &&
              seedanceTotalImageCount === 0 &&
              seedanceVideoCount === 0 &&
              seedanceAudioCount === 0
            ) {
              failCurrentVideoNode("全能参考模式至少需要提示词或参考素材");
              return;
            }

            if (seedanceImageCount > seedanceModeSpec.imageHandleMax) {
              failCurrentVideoNode("Seedance 2.0 最多支持 9 张图片参考");
              return;
            }
            if (seedanceVideoCount > seedanceModeSpec.videoHandleMax) {
              failCurrentVideoNode("Seedance 2.0 最多支持 3 条视频参考");
              return;
            }
            if (seedanceAudioCount > seedanceModeSpec.audioHandleMax) {
              failCurrentVideoNode("Seedance 2.0 最多支持 3 条音频参考");
              return;
            }
          } else {
            if (seedanceMode === "text") {
              if (!hasText || !promptText) {
                failCurrentVideoNode("文生视频模式需要提供提示词");
                return;
              }
            } else if (seedanceMode === "image") {
              if (seedanceImageCount < 1) {
                failCurrentVideoNode("图生视频模式至少需要连接 1 张图片");
                return;
              }
            } else if (seedanceMode === "start_end") {
              if (seedanceTotalImageCount < 1 || seedanceTotalImageCount > 2) {
                failCurrentVideoNode("首尾帧模式需要 1-2 张图片");
                return;
              }
            }
          }
        } else if (provider === "vidu" || provider === "viduq3-pro") {
          if (hasImage2Edge && !imageEdges.some((edge) => edge.targetHandle === "image")) {
            failCurrentVideoNode("请先连接图1（image）再连接图2（image-2）");
            return;
          }
          if (hasImage2Edge && imageCount < 2) {
            failCurrentVideoNode("Vidu 图2（image-2）已连接，但缺少图1或图2资源");
            return;
          }
          if (!hasImage2Edge && imageCount >= 2) {
            failCurrentVideoNode("Vidu 两图模式请将第二张图连接到图2句柄（image-2）");
            return;
          }
          if (imageCount === 0 && !hasText) {
            // 0张图必须有prompt
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "文生视频模式需要提供提示词",
                      },
                    }
                  : n
              )
            );
            return;
          }

          // 单图参考且无 prompt 时，补默认提示词
          if (imageCount === 1 && !promptText && !hasImage2Edge) {
            finalPrompt = "基于图片生成视频";
          }
        } else if (
          provider === "kling" ||
          provider === "kling-2.6" ||
          provider === "kling-o3"
        ) {
          // Kling 当前前端最多支持 2 张图：
          // - 0 张图：必须提供非空 prompt（text2video）
          // - 1-2 张图：prompt 可选（image2video / image2video-tail）
          if (imageCount === 0 && !promptText) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "文生视频模式需要提供提示词",
                      },
                    }
                  : n
              )
            );
            return;
          }
        } else {
          // 其他 provider（doubao）必须有 prompt
          if (!hasText) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "缺少 TextPrompt 输入",
                      },
                    }
                  : n
              )
            );
            return;
          }
          if (!promptText) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: { ...n.data, status: "failed", error: "提示词为空" },
                    }
                  : n
              )
            );
            return;
          }
        }

        const viduSemantics = buildViduRequestSemantics({
          rawViduModel: inferredViduModel,
          hasImage2Input: hasImage2Edge,
          imageCount,
          hasPrompt: Boolean(finalPrompt),
        });
        const isViduQ2ProMode = viduSemantics.isQ2ProMode;
        const viduModelForApi = viduSemantics.viduModel;

        const clipDuration =
          typeof (node.data as any)?.clipDuration === "number" &&
          Number.isFinite((node.data as any)?.clipDuration)
            ? Math.round((node.data as any).clipDuration)
            : undefined;
        const configuredDurationOptions = (() => {
          const rawDurations = rawNodeData?.nodeConfigMetadata?.vod?.outputConfig?.durations;
          if (!Array.isArray(rawDurations)) return [] as number[];
          const normalized = Array.from(
            new Set(
              rawDurations
                .map((item) => Number(item))
                .filter((item) => Number.isFinite(item) && item > 0)
                .map((item) => Math.round(item))
            )
          );
          normalized.sort((a, b) => a - b);
          return normalized;
        })();
        const nodeConfigKey =
          typeof rawNodeData?.nodeConfigKey === "string"
            ? rawNodeData.nodeConfigKey.trim()
            : "";
        const normalizedVendorForDuration =
          typeof rawNodeData?.vendorKey === "string"
            ? rawNodeData.vendorKey.trim().toLowerCase()
            : "";
        const normalizedPlatformForDuration =
          typeof rawNodeData?.platformKey === "string"
            ? rawNodeData.platformKey.trim().toLowerCase()
            : "";
        const isTencentKlingO3RouteForDuration =
          provider === "kling-o3" &&
          (normalizedVendorForDuration === "tencent_vod" ||
            normalizedPlatformForDuration === "tencent_vod" ||
            (!normalizedVendorForDuration && !normalizedPlatformForDuration));
        const klingO3DurationRangeMax =
          provider === "kling-o3"
            ? hasVideoInput
              ? 10
              : isTencentKlingO3RouteForDuration
              ? 15
              : 10
            : 10;
        const nodeSupportedSeedanceModels = (() => {
          const rawSupported = rawNodeData?.nodeConfigMetadata?.supportedModels;
          if (!Array.isArray(rawSupported)) return new Set<string>();
          return new Set(
            rawSupported
              .map((item) => String(item).trim().toLowerCase())
              .filter((item) => item.length > 0)
          );
        })();
        const metadataSupportsSeedance20 =
          nodeSupportedSeedanceModels.has("seedance-2.0") ||
          nodeSupportedSeedanceModels.has("seedance-2.0-fast");
        const effectiveConfiguredDurationOptions = (() => {
          if (provider === "kling-o3" && isTencentKlingO3RouteForDuration) {
            return Array.from(
              { length: Math.max(0, klingO3DurationRangeMax - 2) },
              (_, index) => index + 3
            );
          }
          if (!isSeedanceNode) {
            return configuredDurationOptions;
          }

          if (isSeedance20Request) {
            // 兼容历史工作流：旧的 doubaoVideo 元数据通常不是 4-15，切到 2.0 时不应继续拦截 15s。
            if (nodeConfigKey === "doubaoVideo" || !metadataSupportsSeedance20) {
              return [] as number[];
            }

            return configuredDurationOptions.filter(
              (value) =>
                value >= SEEDANCE20_DURATIONS[0] &&
                value <= SEEDANCE20_DURATIONS[SEEDANCE20_DURATIONS.length - 1]
            );
          }

          return [...SEEDANCE15_DURATIONS];
        })();
        if (isSeedanceNode && typeof clipDuration === "number" && Number.isFinite(clipDuration)) {
          if (isSeedance20Request && (clipDuration < 4 || clipDuration > 15)) {
            failCurrentVideoNode("Seedance 2.0 生成时长仅支持 4-15 秒");
            return;
          }
          if (!isSeedance20Request && (clipDuration < 4 || clipDuration > 12)) {
            failCurrentVideoNode("Seedance 1.5 生成时长仅支持 4-12 秒");
            return;
          }
        }
        const aspectSetting =
          typeof (node.data as any)?.aspectRatio === "string"
            ? (node.data as any).aspectRatio
            : "";

        // Kling O1 视频输入处理
        const resolveAudioUrlFromNodeData = (
          sourceData: Record<string, any>
        ): string | undefined => {
          if (typeof sourceData.audioUrl === "string" && sourceData.audioUrl.trim()) {
            return sourceData.audioUrl.trim();
          }
          if (Array.isArray(sourceData.audioUrls)) {
            const firstAudio = sourceData.audioUrls.find(
              (value: unknown) =>
                typeof value === "string" && value.trim().length > 0
            );
            if (typeof firstAudio === "string") return firstAudio.trim();
          }
          return undefined;
        };
        const resolveAudioFromNodeId = (
          sourceNodeId: string,
          visited: Set<string>
        ): { audioUrl?: string; duration?: number } => {
          if (!sourceNodeId || visited.has(sourceNodeId)) return {};
          visited.add(sourceNodeId);
          const sourceNode = rf.getNode(sourceNodeId);
          if (!sourceNode) return {};
          const sourceData = (sourceNode.data || {}) as Record<string, any>;
          const audioUrl = resolveAudioUrlFromNodeData(sourceData);
          const duration =
            typeof sourceData.duration === "number" &&
            Number.isFinite(sourceData.duration) &&
            sourceData.duration > 0
              ? sourceData.duration
              : undefined;
          if (audioUrl) return { audioUrl, duration };
          const upstreamAudioEdges = currentEdges.filter(
            (e) => e.target === sourceNodeId && e.targetHandle === "audio"
          );
          for (const edge of upstreamAudioEdges) {
            const resolved = resolveAudioFromNodeId(edge.source, visited);
            if (resolved.audioUrl) return resolved;
          }
          return {};
        };
        const readAudioDurationFromUrl = async (audioUrl: string): Promise<number> =>
          await new Promise<number>((resolve, reject) => {
            const audio = document.createElement("audio");
            let settled = false;
            const cleanup = () => {
              audio.removeAttribute("src");
              audio.load();
            };
            const timeoutId = window.setTimeout(() => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(
                new Error(
                  lt(
                    "无法读取音频时长，请确认音频可访问",
                    "Unable to read audio duration, please verify audio URL is accessible"
                  )
                )
              );
            }, 8000);
            audio.preload = "metadata";
            audio.src = audioUrl;
            audio.addEventListener(
              "loadedmetadata",
              () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                const duration = Number(audio.duration || 0);
                cleanup();
                if (Number.isFinite(duration) && duration > 0) {
                  resolve(duration);
                } else {
                  reject(
                    new Error(
                      lt(
                        "无法读取音频时长，请确认音频可访问",
                        "Unable to read audio duration, please verify audio URL is accessible"
                      )
                    )
                  );
                }
              },
              { once: true }
            );
            audio.addEventListener(
              "error",
              () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                cleanup();
                reject(
                  new Error(
                    lt(
                      "无法读取音频时长，请确认音频可访问",
                      "Unable to read audio duration, please verify audio URL is accessible"
                    )
                  )
                );
              },
              { once: true }
            );
          });
        let klingAudioUrlsForAPI: string[] | undefined = undefined;
        /* 音频处理逻辑已注释
        if (provider === "kling-2.6" && (node.data as any)?.mode === "pro") {
          const connectedAudioEdges = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "audio"
          );
          const resolvedAudioInputs = connectedAudioEdges
            .map((edge) =>
              resolveAudioFromNodeId(edge.source, new Set<string>([nodeId]))
            )
            .filter(
              (
                item
              ): item is {
                audioUrl: string;
                duration?: number;
              } => typeof item.audioUrl === "string" && item.audioUrl.length > 0
            );
          const connectedAudioUrls = Array.from(
            new Set(resolvedAudioInputs.map((item) => item.audioUrl))
          );
          const connectedAudioDurationHints = new Map<string, number>();
          resolvedAudioInputs.forEach((item) => {
            if (
              typeof item.duration === "number" &&
              Number.isFinite(item.duration) &&
              item.duration > 0 &&
              !connectedAudioDurationHints.has(item.audioUrl)
            ) {
              connectedAudioDurationHints.set(item.audioUrl, item.duration);
            }
          });
          if (connectedAudioEdges.length > 0 && connectedAudioUrls.length === 0) {
            failCurrentVideoNode(
              lt(
                "音频句柄已连接，但未读取到有效音频",
                "Audio handle is connected, but no valid audio was found"
              )
            );
            return;
          }
          if (connectedAudioUrls.length > KLING_MAX_AUDIO_INPUTS) {
            failCurrentVideoNode(
              lt(
                "Kling 音频最多支持 2 条，请减少后重试",
                "Kling audio supports up to 2 inputs, please reduce and retry"
              )
            );
            return;
          }
          for (const audioUrl of connectedAudioUrls) {
            const hintedDuration = connectedAudioDurationHints.get(audioUrl);
            const duration =
              typeof hintedDuration === "number" && Number.isFinite(hintedDuration)
                ? hintedDuration
                : await readAudioDurationFromUrl(audioUrl);
            if (duration < 5 || duration > 30) {
              failCurrentVideoNode(
                `${lt(
                  "音频时长需在 5-30 秒内，当前约",
                  "Audio duration must be between 5 and 30 seconds, current"
                )} ${duration.toFixed(1)}${lt("秒", "s")}`
              );
              return;
            }
          }
          klingAudioUrlsForAPI =
            connectedAudioUrls.length > 0 ? connectedAudioUrls : undefined;
        }
        */
        let seedanceAudioUrlsForAPI: string[] | undefined = undefined;
        if (isSeedanceNode && isSeedance20Request) {
          const connectedAudioEdges = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "audio"
          );
          const resolvedAudioInputs = connectedAudioEdges
            .map((edge) => resolveAudioFromNodeId(edge.source, new Set<string>([nodeId])))
            .filter(
              (
                item
              ): item is {
                audioUrl: string;
                duration?: number;
              } => typeof item.audioUrl === "string" && item.audioUrl.length > 0
            );
          const connectedAudioUrls = Array.from(
            new Set(resolvedAudioInputs.map((item) => item.audioUrl))
          );

          if (connectedAudioEdges.length > 0 && connectedAudioUrls.length === 0) {
            failCurrentVideoNode("音频句柄已连接，但未读取到有效音频");
            return;
          }

          if (connectedAudioUrls.length > SEEDANCE20_REFERENCE_AUDIO_MAX) {
            failCurrentVideoNode("Seedance 2.0 最多支持 3 条音频参考");
            return;
          }

          const connectedAudioDurationHints = new Map<string, number>();
          resolvedAudioInputs.forEach((item) => {
            if (
              typeof item.duration === "number" &&
              Number.isFinite(item.duration) &&
              item.duration > 0 &&
              !connectedAudioDurationHints.has(item.audioUrl)
            ) {
              connectedAudioDurationHints.set(item.audioUrl, item.duration);
            }
          });

          for (const audioUrl of connectedAudioUrls.slice(0, SEEDANCE20_REFERENCE_AUDIO_MAX)) {
            const hintedDuration = connectedAudioDurationHints.get(audioUrl);
            const duration =
              typeof hintedDuration === "number" && Number.isFinite(hintedDuration)
                ? hintedDuration
                : await readAudioDurationFromUrl(audioUrl);
            if (duration > 5) {
              failCurrentVideoNode(
                `Seedance 2.0 音频每条需不超过 5 秒，当前约 ${duration.toFixed(1)} 秒`
              );
              return;
            }
          }

          seedanceAudioUrlsForAPI =
            connectedAudioUrls.length > 0
              ? connectedAudioUrls.slice(0, SEEDANCE20_REFERENCE_AUDIO_MAX)
              : Array.isArray(rawNodeData.audioUrls) && rawNodeData.audioUrls.length > 0
              ? rawNodeData.audioUrls.slice(0, SEEDANCE20_REFERENCE_AUDIO_MAX)
              : undefined;
        }

        let referenceVideoUrl: string | undefined = undefined;
        let referenceVideoUrls: string[] = [];
        if (provider === "kling-o3" || (isSeedanceNode && isSeedance20Request)) {
          const videoEdges = currentEdges.filter(
            (e) => e.target === nodeId && e.targetHandle === "video"
          );
          const resolvedVideoUrls: string[] = [];

          for (const videoEdge of videoEdges) {
            const sourceNode = rf.getNode(videoEdge.source);
            if (!sourceNode) continue;
            const videoUrl =
              (sourceNode.data as any)?.videoUrl ||
              (sourceNode.data as any)?.url ||
              (sourceNode.data as any)?.src;
            if (!videoUrl || typeof videoUrl !== "string") continue;

            const normalizedVideoUrl = videoUrl.trim();
            if (!normalizedVideoUrl) continue;
            resolvedVideoUrls.push(normalizedVideoUrl);

            // 验证视频时长（需要从源节点获取）
            const videoDuration = (sourceNode.data as any)?.duration;
            if (
              provider === "kling-o3" &&
              videoDuration &&
              (videoDuration < 3 || videoDuration > 10)
            ) {
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          status: "failed",
                          error: `视频时长必须在 3-10 秒之间，当前视频时长为 ${videoDuration} 秒`,
                        },
                      }
                    : n
                )
              );
              return;
            }
          }

          referenceVideoUrls = Array.from(new Set(resolvedVideoUrls));
          if (isSeedanceNode && isSeedance20Request) {
            referenceVideoUrls = referenceVideoUrls.slice(0, SEEDANCE20_REFERENCE_VIDEO_MAX);
          } else {
            referenceVideoUrls = referenceVideoUrls.slice(0, 1);
          }
          referenceVideoUrl = referenceVideoUrls[0];

          if (referenceVideoUrl) {
            console.log(
              `🎬 [${isSeedanceNode && isSeedance20Request ? "Seedance 2.0" : "Kling O1"}] 检测到视频输入: ${referenceVideoUrl.slice(0, 80)}...`
            );
          }
        }

        const resolvedEdgePairs: Array<{
          edge: (typeof imageEdges)[number];
          dataUrl: string;
        }> = [];
        for (const edge of imageEdges) {
          const [dataUrl] = await resolveEdgesAsDataUrls([edge]);
          if (dataUrl) resolvedEdgePairs.push({ edge, dataUrl });
        }
        const referenceImages = resolvedEdgePairs.map((p) => p.dataUrl);
        const referenceImageSourceEdges = resolvedEdgePairs.map((p) => p.edge);

        console.log(`🎬 [VideoProvider] 解析后参考图数量: ${referenceImages.length}`);
        referenceImages.forEach((img, i) => {
          console.log(`🎬 [VideoProvider] 参考图${i + 1}: ${img?.slice(0, 60)}...`);
        });

        const generationStartMs = Date.now();
        const referenceImageUrls: string[] = [];
        if (referenceImages.length) {
          try {
            const fetchRemoteImageAsDataUrl = async (url: string) => {
              const fetchUrl = proxifyRemoteAssetUrl(url);
              const init: RequestInit =
                fetchUrl.startsWith("blob:") || fetchUrl.startsWith("data:")
                  ? {}
                  : { mode: "cors", credentials: "omit" };
              const response = await fetchWithAuth(fetchUrl, {
                ...init,
                auth: "omit",
                allowRefresh: false,
              });
              if (!response.ok) {
                throw new Error(`参考图拉取失败: ${response.status}`);
              }
              const blob = await responseToBlob(response);
              return await blobToDataUrl(blob);
            };

            for (const img of referenceImages) {
              const trimmed = typeof img === "string" ? img.trim() : "";
              if (!trimmed) continue;

              // 根据供应商处理图片格式
              if (
                provider === "vidu" ||
                provider === "viduq3-pro" ||
                provider === "doubao" ||
                provider === "kling" ||
                provider === "kling-2.6" ||
                provider === "kling-o3"
              ) {
                // 腾讯 VOD 链路需要可访问的 URL，必须上传到 OSS
                if (isRemoteUrl(trimmed)) {
                  referenceImageUrls.push(normalizeStableRemoteUrl(trimmed));
                } else {
                  const dataUrl = ensureDataUrl(trimmed);
                  if (isSeedanceNode) {
                    const bytes = estimateDataUrlByteLength(dataUrl);
                    if (
                      typeof bytes === "number" &&
                      Number.isFinite(bytes) &&
                      bytes > SEEDANCE_REFERENCE_IMAGE_MAX_BYTES
                    ) {
                      failCurrentVideoNode(
                        `Seedance 图片单图需不超过 30MB，当前约 ${(
                          bytes /
                          1024 /
                          1024
                        ).toFixed(1)}MB`
                      );
                      return;
                    }
                  }
                  const uploaded = await uploadImageToOSS(dataUrl, projectId);
                  if (!uploaded) {
                    setNodes((ns) =>
                      ns.map((n) =>
                        n.id === nodeId
                          ? {
                              ...n,
                              data: {
                                ...n.data,
                                status: "failed",
                                error: "参考图上传失败",
                              },
                            }
                          : n
                      )
                    );
                    return;
                  }
                  referenceImageUrls.push(uploaded);
                }
              } else {
                // 其他供应商直接使用 Base64 Data URI
                if (isRemoteUrl(trimmed)) {
                  const dataUrl = await fetchRemoteImageAsDataUrl(trimmed);
                  referenceImageUrls.push(dataUrl);
                } else {
                  referenceImageUrls.push(ensureDataUrl(trimmed));
                }
              }
            }
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : "参考图上传失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        // 根据供应商调整参数
        const aspectRatioForAPI =
          isSeedanceNode
            ? aspectSetting || undefined
            : provider === "vidu" || provider === "viduq3-pro"
            ? aspectSetting || "16:9"
            : referenceImageUrls.length > 0
            ? undefined
            : aspectSetting || undefined;

        // 不同供应商支持的时长不同
        let durationForAPI: number | undefined = undefined;
        if (typeof clipDuration === "number" && Number.isFinite(clipDuration)) {
          if (effectiveConfiguredDurationOptions.length > 0) {
            if (effectiveConfiguredDurationOptions.includes(clipDuration)) {
              durationForAPI = clipDuration;
            }
          } else if (
            provider === "kling" &&
            (clipDuration === 5 || clipDuration === 10)
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "kling-2.6" &&
            (clipDuration === 5 || clipDuration === 10)
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "kling-o3" &&
            clipDuration >= 3 &&
            clipDuration <= klingO3DurationRangeMax
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "vidu" &&
            clipDuration >= 1 &&
            clipDuration <= 16
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "viduq3-pro" &&
            clipDuration >= 1 &&
            clipDuration <= 16
          ) {
            durationForAPI = clipDuration;
          } else if (
            isSeedanceNode &&
            isSeedance20Request &&
            clipDuration >= 4 &&
            clipDuration <= 15
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "doubao" &&
            !isSeedance20Request &&
            clipDuration >= 4 &&
            clipDuration <= 12
          ) {
            durationForAPI = clipDuration;
          }
          if (durationForAPI === undefined) {
            const fallbackDurationOptions =
              isSeedanceNode
                ? isSeedance20Request
                  ? SEEDANCE20_DURATIONS
                  : SEEDANCE15_DURATIONS
                : configuredDurationOptions;
            const durationHintOptions =
              effectiveConfiguredDurationOptions.length > 0
                ? effectiveConfiguredDurationOptions
                : fallbackDurationOptions;
            const supportedDurationText =
              durationHintOptions.length > 0
                ? `${lt("支持时长", "Supported durations")}: ${durationHintOptions.join("/")}${lt("秒", "s")}`
                : "";
            failCurrentVideoNode(
              `${lt("当前时长不受支持", "Selected duration is not supported")}: ${clipDuration}${lt("秒", "s")}${
                supportedDurationText ? `。${supportedDurationText}` : ""
              }`
            );
            return;
          }
        }

        const seedanceVideoModeForAPI =
          !isSeedanceNode || !seedanceMode
            ? undefined
            : isSeedance20Request
            ? seedanceMode === "start_end"
              ? imageCount >= 2
                ? "start_end"
                : "first_frame"
              : "reference_images"
            : seedanceMode === "text"
            ? "text2video"
            : seedanceMode === "start_end"
            ? imageCount >= 2
              ? "start-end2video"
              : "img2video"
            : "img2video";
        const viduVideoModeForAPI =
          provider !== "vidu" && provider !== "viduq3-pro"
            ? undefined
            : viduSemantics.videoMode;

        try {
          console.log("🎬 [Flow] Sending video request", {
            nodeId,
            provider,
            aspectRatio: aspectRatioForAPI,
            duration: durationForAPI,
            seedanceMode,
            viduVideoMode: viduVideoModeForAPI,
            referenceCount: referenceImageUrls.length,
            referenceVideo: referenceVideoUrls.length > 0 ? "有" : "无",
            promptPreview: finalPrompt?.slice(0, 120) || "(无提示词)",
          });

          const managedRoutePayload = {
            managedModelKey:
              typeof rawNodeData.managedModelKey === "string" &&
              rawNodeData.managedModelKey.trim().length > 0
                ? rawNodeData.managedModelKey.trim()
                : undefined,
            vendorKey:
              typeof rawNodeData.vendorKey === "string" &&
              rawNodeData.vendorKey.trim().length > 0
                ? rawNodeData.vendorKey.trim()
                : undefined,
            platformKey:
              typeof rawNodeData.platformKey === "string" &&
              rawNodeData.platformKey.trim().length > 0
                ? rawNodeData.platformKey.trim()
                : undefined,
          };
          const normalizedVendorKey = (managedRoutePayload.vendorKey || "").toLowerCase();
          const normalizedPlatformKey = (managedRoutePayload.platformKey || "").toLowerCase();
          const isTencentKlingO3Route =
            provider === "kling-o3" &&
            (normalizedVendorKey === "tencent_vod" ||
              normalizedPlatformKey === "tencent_vod" ||
              (!normalizedVendorKey && !normalizedPlatformKey));
          const isTencentKling26Route =
            provider === "kling-2.6" &&
            (normalizedVendorKey === "tencent_vod" ||
              normalizedPlatformKey === "tencent_vod");
          const normalizedKlingSound =
            rawNodeData.sound === undefined || rawNodeData.sound === null
              ? undefined
              : rawNodeData.sound === "on" || rawNodeData.sound === true
              ? "on"
              : "off";
          const rawKlingStoryboardMode = String(rawNodeData.klingStoryboardMode || "")
            .trim()
            .toLowerCase();
          const klingStoryboardMode =
            rawKlingStoryboardMode === "intelligence" ||
            rawKlingStoryboardMode === "smart"
              ? "intelligence"
              : rawKlingStoryboardMode === "customize" || rawKlingStoryboardMode === "custom"
              ? "customize"
              : "single";
          const normalizeTencentStoryboardShots = (
            rawShots: unknown
          ): {
            script: string;
            totalDuration?: number;
            errorKey?: string;
          } => {
            if (!Array.isArray(rawShots) || rawShots.length === 0) {
              return { script: "" };
            }
            if (rawShots.length > 6) {
              return { script: "", errorKey: "too_many" };
            }

            const normalizedShots: Array<{ index: number; prompt: string; duration: number }> = [];
            for (let shotIndex = 0; shotIndex < rawShots.length; shotIndex += 1) {
              const shot = rawShots[shotIndex];
              if (!shot || typeof shot !== "object") {
                return { script: "", errorKey: "invalid_item" };
              }
              const prompt = String((shot as any).prompt || "").trim();
              if (!prompt) {
                return { script: "", errorKey: `missing_prompt_${shotIndex + 1}` };
              }
              const durationRaw = Number((shot as any).duration);
              const duration = Math.round(durationRaw);
              if (!Number.isFinite(durationRaw) || duration < 1) {
                return { script: "", errorKey: `invalid_duration_${shotIndex + 1}` };
              }
              normalizedShots.push({
                index: shotIndex + 1,
                prompt,
                duration,
              });
            }

            return {
              script: JSON.stringify(normalizedShots),
              totalDuration: normalizedShots.reduce((sum, shot) => sum + shot.duration, 0),
            };
          };
          const normalizedTencentStoryboard = normalizeTencentStoryboardShots(
            rawNodeData.klingStoryboardShots
          );
          const manualKlingStoryboardScript =
            typeof rawNodeData.klingStoryboardScript === "string"
              ? rawNodeData.klingStoryboardScript.trim()
              : "";
          const klingStoryboardScript =
            normalizedTencentStoryboard.script || manualKlingStoryboardScript;

          if (isTencentKlingO3Route && klingStoryboardMode === "intelligence" && !finalPrompt) {
            failCurrentVideoNode(
              lt(
                "智能分镜模式需要提示词输入",
                "Intelligent storyboard mode requires prompt input"
              )
            );
            return;
          }
          if (isTencentKlingO3Route && klingStoryboardMode === "customize" && !klingStoryboardScript) {
            failCurrentVideoNode(
              lt(
                "请先添加分镜并填写每个镜头的描述与时长",
                "Please add storyboard shots and fill prompt + duration"
              )
            );
            return;
          }
          if (
            isTencentKlingO3Route &&
            klingStoryboardMode === "customize" &&
            typeof normalizedTencentStoryboard.errorKey === "string"
          ) {
            const key = normalizedTencentStoryboard.errorKey;
            if (key === "too_many") {
              failCurrentVideoNode(
                lt("分镜最多只能添加 6 个镜头", "A maximum of 6 storyboard shots is allowed")
              );
            } else if (key.startsWith("missing_prompt_")) {
              const shotNo = Number(key.replace("missing_prompt_", "")) || 1;
              failCurrentVideoNode(
                lt(`请填写镜头 ${shotNo} 的描述`, `Please fill prompt for shot ${shotNo}`)
              );
            } else if (key.startsWith("invalid_duration_")) {
              const shotNo = Number(key.replace("invalid_duration_", "")) || 1;
              failCurrentVideoNode(
                lt(`镜头 ${shotNo} 的时长必须大于等于 1 秒`, `Shot ${shotNo} duration must be at least 1 second`)
              );
            } else {
              failCurrentVideoNode(
                lt("分镜数据格式有误，请重新填写", "Invalid storyboard data format")
              );
            }
            return;
          }
          if (
            isTencentKlingO3Route &&
            klingStoryboardMode === "customize" &&
            typeof normalizedTencentStoryboard.totalDuration === "number" &&
            normalizedTencentStoryboard.totalDuration !== durationForAPI
          ) {
            failCurrentVideoNode(
              lt(
                `分镜总时长(${normalizedTencentStoryboard.totalDuration}s)需等于节点时长(${durationForAPI}s)`,
                `Storyboard total (${normalizedTencentStoryboard.totalDuration}s) must equal node duration (${durationForAPI}s)`
              )
            );
            return;
          }

          // Seedance 2.0 / 2.0-fast: enrich referenceImages with volcAssetId/Status
          // pulled from the source image node's data, so the backend can replace
          // `image_url.url` with `asset://<volcAssetId>` when volcAssetStatus === 'active'.
          const seedance20ReferenceImages:
            | Array<{
                url: string;
                volcAssetId?: string;
                volcAssetStatus?: "processing" | "active" | "failed";
              }>
            | undefined =
            isSeedanceNode && isSeedance20Request && referenceImageUrls.length > 0
              ? referenceImageUrls.map((url, idx) => {
                  const sourceEdge = referenceImageSourceEdges[idx];
                  const sourceNode = sourceEdge
                    ? rf.getNode(sourceEdge.source)
                    : undefined;
                  const sourceData = (sourceNode?.data as any) || {};
                  const volcAssetId =
                    typeof sourceData.volcAssetId === "string" && sourceData.volcAssetId.length > 0
                      ? sourceData.volcAssetId
                      : undefined;
                  const rawVolcStatus = sourceData.volcAssetStatus;
                  const volcAssetStatus =
                    rawVolcStatus === "processing" ||
                    rawVolcStatus === "active" ||
                    rawVolcStatus === "failed"
                      ? (rawVolcStatus as "processing" | "active" | "failed")
                      : undefined;
                  return { url, volcAssetId, volcAssetStatus };
                })
              : undefined;

          const requestPayload =
            provider === "doubao"
              ? {
                  ...managedRoutePayload,
                  prompt: finalPrompt || undefined,
                  referenceImages:
                    seedance20ReferenceImages !== undefined
                      ? seedance20ReferenceImages
                      : referenceImageUrls.length > 0
                      ? referenceImageUrls
                      : undefined,
                  referenceVideos:
                    referenceVideoUrls.length > 0 ? referenceVideoUrls : undefined,
                  audioUrls:
                    isSeedanceNode && isSeedance20Request
                      ? seedanceAudioUrlsForAPI
                      : Array.isArray(rawNodeData.audioUrls) && rawNodeData.audioUrls.length > 0
                      ? rawNodeData.audioUrls
                      : undefined,
                  duration: durationForAPI,
                  aspectRatio: aspectRatioForAPI,
                  provider: provider as VideoProvider,
                  resolution: rawNodeData.resolution,
                  videoMode: seedanceVideoModeForAPI,
                  generateAudio:
                    isSeedance20Request
                      ? typeof rawNodeData.generateAudio === "boolean"
                        ? rawNodeData.generateAudio
                        : true
                      : undefined,
                  seedanceModel: seedanceModelForRequest,
                }
              : provider === "vidu" || provider === "viduq3-pro"
              ? {
                  ...managedRoutePayload,
                  prompt: finalPrompt,
                  referenceImages:
                    referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
                  duration: durationForAPI,
                  aspectRatio: aspectRatioForAPI,
                  provider: provider as VideoProvider,
                  videoMode: viduVideoModeForAPI,
                  resolution: rawNodeData.resolution,
                  style:
                    viduModelForApi === "q2" && !isViduQ2ProMode
                      ? rawNodeData.style
                      : undefined,
                  offPeak:
                    viduModelForApi === "q2" && !isViduQ2ProMode
                      ? rawNodeData.offPeak
                      : undefined,
                  viduModel: viduModelForApi,
                  viduModelVariant: normalizedViduModelVariant,
                }
              : {
                  ...managedRoutePayload,
                  prompt: finalPrompt,
                  referenceImages:
                    referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
                  duration: durationForAPI,
                  aspectRatio: aspectRatioForAPI,
                  resolution: rawNodeData.resolution,
                  provider: provider as VideoProvider,
                  mode: rawNodeData.mode,
                  klingModel: klingModel === "kling-v3-0" ? "kling-v3-0" : rawNodeData.klingModel,
                  sound:
                    provider === "kling-o3" || provider === "kling-2.6" || provider === "kling"
                      ? isTencentKling26Route
                        ? normalizedKlingSound
                        : rawNodeData.mode === "pro"
                        ? "on"
                        : normalizedKlingSound
                      : undefined,
                  referenceVideo: referenceVideoUrl,
                  referenceVideoType: rawNodeData.referenceVideoType,
                  keepOriginalSound: rawNodeData.keepOriginalSound,
                  klingStoryboardMode: isTencentKlingO3Route
                    ? klingStoryboardMode
                    : undefined,
                  klingStoryboardScript:
                    isTencentKlingO3Route && klingStoryboardMode === "customize"
                      ? klingStoryboardScript
                      : undefined,
                };

          // 调用对应供应商的 API
          const createResult = await generateVideoByProvider({
            ...requestPayload,
          });

          console.log("✅ [Flow] Video task created", {
            nodeId,
            provider,
            taskId: createResult.taskId,
          });

          // 开始轮询查询任务状态
          const pollInterval = 5000; // 5秒
          const maxAttempts = 180; // 最多180次（15分钟）
          const maxConsecutiveQueryErrors = 6; // 连续查询失败 6 次后直接失败返回
          let attempts = 0;
          let consecutiveQueryErrors = 0;
          let pollTimer: number | undefined;
          let settled = false;
          let polling = false;

          const stopPolling = () => {
            settled = true;
            if (typeof pollTimer === "number") {
              window.clearTimeout(pollTimer);
              pollTimer = undefined;
            }
          };

          const scheduleNextPoll = () => {
            if (settled) return;
            pollTimer = window.setTimeout(() => {
              void pollTask();
            }, pollInterval);
          };

          const pollTask = async () => {
            if (settled || polling) return;
            polling = true;
            attempts++;
            try {
              if (attempts > maxAttempts) {
                stopPolling();
                // 超时也尝试退还积分
                if (createResult.apiUsageId) {
                  try {
                    await refundVideoTask(createResult.apiUsageId);
                    console.log("✅ [Flow] Video task credits refunded (timeout)", {
                      nodeId,
                      provider,
                      apiUsageId: createResult.apiUsageId,
                    });
                  } catch (refundError) {
                    console.warn("❌ [Flow] Failed to refund credits (timeout)", {
                      nodeId,
                      provider,
                      apiUsageId: createResult.apiUsageId,
                      error: refundError instanceof Error ? refundError.message : String(refundError),
                    });
                  }
                }
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "failed",
                            error: "任务查询超时",
                          },
                        }
                      : n
                  )
                );
                return;
              }

              const queryResult = await queryVideoTask(
                provider as VideoProvider,
                createResult.taskId
              );
              consecutiveQueryErrors = 0;

              if (queryResult.status === "succeeded") {
                stopPolling();
                if (createResult.apiUsageId) {
                  const processingTime = Math.max(0, Date.now() - generationStartMs);
                  void markVideoTaskSuccess(createResult.apiUsageId, processingTime).catch(
                    (markError) => {
                      console.warn("❌ [Flow] Failed to mark video task success", {
                        nodeId,
                        provider,
                        apiUsageId: createResult.apiUsageId,
                        error:
                          markError instanceof Error
                            ? markError.message
                            : String(markError),
                      });
                    }
                  );
                }
                const elapsedSeconds = Math.max(
                  1,
                  Math.round((Date.now() - generationStartMs) / 1000)
                );
                const historyEntry = {
                  id: `video-history-${Date.now()}`,
                  videoUrl: queryResult.videoUrl,
                  thumbnail: queryResult.thumbnailUrl,
                  prompt: promptText,
                  createdAt: new Date().toISOString(),
                  elapsedSeconds,
                };
                setNodes((ns) =>
                  ns.map((n) => {
                    if (n.id !== nodeId) return n;
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl: queryResult.videoUrl,
                        thumbnail: queryResult.thumbnailUrl,
                        error: undefined,
                        videoVersion:
                          Number(previousData.videoVersion || 0) + 1,
                        history: appendVideoHistory(
                          previousData.history as Array<Record<string, any>> | undefined,
                          historyEntry
                        ),
                      },
                    };
                  })
                );
                return;
              } else if (queryResult.status === "failed") {
                stopPolling();
                // 任务失败，尝试退还积分
                if (createResult.apiUsageId) {
                  try {
                    await refundVideoTask(createResult.apiUsageId);
                    console.log("✅ [Flow] Video task credits refunded", {
                      nodeId,
                      provider,
                      apiUsageId: createResult.apiUsageId,
                    });
                  } catch (refundError) {
                    console.warn("❌ [Flow] Failed to refund credits", {
                      nodeId,
                      provider,
                      apiUsageId: createResult.apiUsageId,
                      error: refundError instanceof Error ? refundError.message : String(refundError),
                    });
                  }
                }
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "failed",
                            error: (queryResult as any).error || "任务生成失败",
                          },
                      }
                    : n
                  )
                );
                return;
              }
              // 其他状态继续轮询
            } catch (error) {
              consecutiveQueryErrors++;
              console.warn("❌ [Flow] Task query failed", {
                nodeId,
                provider,
                attempt: attempts,
                consecutiveQueryErrors,
                error: error instanceof Error ? error.message : String(error),
              });
              if (consecutiveQueryErrors >= maxConsecutiveQueryErrors) {
                stopPolling();
                // 连续查询失败时也尝试退还积分
                if (createResult.apiUsageId) {
                  try {
                    await refundVideoTask(createResult.apiUsageId);
                    console.log("✅ [Flow] Video task credits refunded (query failed)", {
                      nodeId,
                      provider,
                      apiUsageId: createResult.apiUsageId,
                    });
                  } catch (refundError) {
                    console.warn("❌ [Flow] Failed to refund credits (query failed)", {
                      nodeId,
                      provider,
                      apiUsageId: createResult.apiUsageId,
                      error: refundError instanceof Error ? refundError.message : String(refundError),
                    });
                  }
                }
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "failed",
                            error: "任务状态查询失败，请重试",
                          },
                        }
                      : n
                  )
                );
                return;
              }
              // 查询偶发失败时继续轮询
            } finally {
              polling = false;
            }

            scheduleNextPoll();
          };

          // 立即执行一次，后续按 setTimeout 串行轮询，避免并发 poll 导致重复写 history
          void pollTask();
        } catch (error) {
          console.warn("❌ [Flow] Video request failed", {
            nodeId,
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
          const msg = error instanceof Error ? error.message : "视频生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // MiniMax Speech 节点处理逻辑
      if (node.type === "minimaxSpeech") {
        console.log("[minimaxSpeech] 开始处理");
        const { text: promptText, hasEdge: hasTextEdge } = getTextPromptForNode(nodeId);
        const finalText = promptText.trim();

        console.log("[minimaxSpeech] finalText:", finalText);

        if (!hasTextEdge) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 Prompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }

        if (!finalText) {
          console.log("[minimaxSpeech] 文本为空");
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "Prompt 为空",
                    },
                  }
                : n
            )
          );
          return;
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    text: finalText,
                  },
                }
              : n
          )
        );

        try {
          const modelRaw =
            typeof (node.data as any)?.model === "string"
              ? (node.data as any).model.trim()
              : "";
          const model = modelRaw.length ? modelRaw : "speech-2.6-hd";
          const voiceId = (node.data as any)?.voiceId;
          const outputFormat =
            (node.data as any)?.outputFormat === "hex" ? "hex" : "url";
          const emotion = (node.data as any)?.emotion;
          const audioModeRaw = (node.data as any)?.audioMode;
          const audioMode = audioModeRaw === "hex" ? "hex" : "json";
          const soundEffects = Array.isArray((node.data as any)?.soundEffects)
            ? ((node.data as any).soundEffects as string[]).filter((item) =>
                ["spacious_echo", "auditorium_echo", "lofi_telephone", "robotic"].includes(item)
              )
            : undefined;

          console.log("[minimaxSpeech] 调用 API:", {
            text: finalText,
            voiceId,
            model,
            outputFormat,
            emotion,
            audioMode,
            soundEffects,
          });

          const response = await fetchWithAuth("/api/ai/minimax-speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: finalText,
              voiceId,
              model,
              outputFormat,
              emotion,
              audioMode,
              soundEffects,
            }),
          });

          console.log("[minimaxSpeech] API 响应状态:", response.status);

          if (!response.ok) {
            let message = "语音合成失败";
            try {
              const errorData = await response.json();
              message = errorData?.message || errorData?.error || message;
            } catch {}
            throw new Error(message);
          }

          const result = await response.json();
          console.log("[minimaxSpeech] API 结果:", result);

          const audioUrl =
            (typeof result?.audioUrl === "string" && result.audioUrl) ||
            (typeof result?.audio_url === "string" && result.audio_url) ||
            (typeof result?.data?.audio === "string" && result.data.audio);

          if (!audioUrl) {
            throw new Error("语音合成返回缺少音频");
          }

          const historyItemId = `minimax-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const historyItem = {
            id: historyItemId,
            prompt: finalText,
            audioUrl,
            createdAt: Date.now(),
            voiceId: typeof voiceId === "string" ? voiceId : undefined,
            emotion: typeof emotion === "string" ? emotion : undefined,
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      audioUrl,
                      selectedHistoryId: historyItemId,
                      history: [
                        historyItem,
                        ...(
                          Array.isArray((n.data as any)?.history)
                            ? ((n.data as any).history as Array<Record<string, unknown>>)
                                .filter(
                                  (item) =>
                                    typeof item?.audioUrl === "string" &&
                                    item.audioUrl.trim().length > 0
                                )
                                .slice(0, 29)
                            : []
                        ),
                      ],
                      error: undefined,
                    },
                  }
                : n
            )
          );
        } catch (error) {
          console.error("[minimaxSpeech] 错误:", error);
          const msg = error instanceof Error ? error.message : "语音合成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // 腾讯语音合成节点处理逻辑
      if (node.type === "tencentSpeech") {
        const { text: upstreamText, hasEdge: hasTextEdge } = getTextPromptForNode(nodeId);
        const localTextRaw =
          typeof (node.data as any)?.text === "string"
            ? (node.data as any).text
            : "";
        const localText = localTextRaw.trim();
        const finalText = (upstreamText || localText).trim();

        const sanitizeMediaUrl = (url?: string | null) => {
          if (!url || typeof url !== "string") return undefined;
          const trimmed = url.trim();
          if (!trimmed) return undefined;
          const markdownSplit = trimmed.split("](");
          const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
          const spaceIdx = candidate.indexOf(" ");
          return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
        };

        const resolveVideoUrl = (edge: Edge): string | undefined => {
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) return undefined;
          const data = (srcNode.data as any) || {};
          const direct =
            data.videoUrl ||
            data.video_url ||
            data.output?.video_url ||
            (Array.isArray(data.output) ? data.output[0]?.video_url : undefined) ||
            data.raw?.output?.video_url ||
            data.raw?.video_url;
          const fromHistory = Array.isArray(data.history)
            ? data.history[0]?.videoUrl
            : undefined;
          return sanitizeMediaUrl(direct) || sanitizeMediaUrl(fromHistory);
        };

        const videoEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "video"
        );
        const inputVideoUrl = videoEdge ? resolveVideoUrl(videoEdge) : undefined;
        if (!inputVideoUrl) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "请连接视频输入",
                    },
                  }
                : n
            )
          );
          return;
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    inputVideoUrl,
                    text: finalText,
                  },
                }
              : n
          )
        );

        try {
          const speakerUrlInput = (node.data as any)?.speakerUrlInput;
          const voiceId = (node.data as any)?.voiceId;
          const speakerGender = (node.data as any)?.speakerGender;
          const srcLang = (node.data as any)?.srcLang;
          const dstLang = (node.data as any)?.dstLang;
          const srcSubtitleUrl = (node.data as any)?.srcSubtitleUrl;
          const dstSubtitleUrl = (node.data as any)?.dstSubtitleUrl;
          const embedSubtitle = (node.data as any)?.embedSubtitle;
          const font = (node.data as any)?.font;
          const fontSize = (node.data as any)?.fontSize;
          const marginV = (node.data as any)?.marginV;
          const outputPattern = (node.data as any)?.outputPattern;

          const response = await fetchWithAuth("/api/ai/tencent-speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inputVideoUrl,
              text: finalText || undefined,
              speakerUrl: speakerUrlInput?.trim() || undefined,
              voiceId: voiceId?.trim() || undefined,
              speakerGender: speakerGender?.trim() || undefined,
              srcLang: srcLang?.trim() || undefined,
              dstLang: dstLang?.trim() || undefined,
              srcSubtitleUrl: srcSubtitleUrl?.trim() || undefined,
              dstSubtitleUrl: dstSubtitleUrl?.trim() || undefined,
              embedSubtitle,
              font: font?.trim() || undefined,
              fontSize: typeof fontSize === "number" ? fontSize : undefined,
              marginV: typeof marginV === "number" ? marginV : undefined,
              outputPattern: outputPattern?.trim() || undefined,
            }),
          });

          if (!response.ok) {
            let message = "语音合成失败";
            try {
              const errorData = await response.json();
              message = errorData?.message || errorData?.error || message;
            } catch {}
            throw new Error(message);
          }

          const result = await response.json();
          const audioUrl = result?.audioUrl;
          const videoUrl = result?.videoUrl;

          if (!audioUrl && !videoUrl) {
            throw new Error("语音合成返回缺少结果");
          }

          const historyItemId = `tencent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const historyItem = {
            id: historyItemId,
            prompt: finalText,
            audioUrl: audioUrl || "",
            videoUrl: typeof videoUrl === "string" ? videoUrl : undefined,
            createdAt: Date.now(),
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      audioUrl: audioUrl || n.data?.audioUrl,
                      videoUrl: typeof videoUrl === "string" ? videoUrl : n.data?.videoUrl,
                      selectedHistoryId: historyItemId,
                      history: [
                        historyItem,
                        ...(
                          Array.isArray((n.data as any)?.history)
                            ? ((n.data as any).history as Array<Record<string, unknown>>)
                                .filter(
                                  (item) =>
                                    (typeof item?.audioUrl === "string" && item.audioUrl.trim().length > 0) ||
                                    (typeof item?.videoUrl === "string" && item.videoUrl.trim().length > 0)
                                )
                                .slice(0, 29)
                            : []
                        ),
                      ],
                      error: undefined,
                    },
                  }
                : n
            )
          );
        } catch (error) {
          console.error("[tencentSpeech] 错误:", error);
          const msg = error instanceof Error ? error.message : "语音合成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // MiniMax Music 节点处理逻辑
      if (node.type === "minimaxMusic") {
        console.log("[minimaxMusic] 开始处理");
        const { text: upstreamPrompt } = getTextPromptForNode(nodeId);
        const localPromptRaw =
          typeof (node.data as any)?.prompt === "string"
            ? (node.data as any).prompt
            : "";
        const localPrompt = localPromptRaw.trim();
        const finalPrompt = (upstreamPrompt || localPrompt).trim();
        const lyricsRaw =
          typeof (node.data as any)?.lyrics === "string"
            ? (node.data as any).lyrics
            : "";
        const lyrics = lyricsRaw.trim();
        const isInstrumental = (node.data as any)?.isInstrumental === true;
        const lyricsOptimizer = (node.data as any)?.lyricsOptimizer === true;
        const modelRaw =
          typeof (node.data as any)?.model === "string"
            ? (node.data as any).model.trim()
            : "";
        const model = modelRaw === "music-2.5" ? "music-2.5" : "music-2.5+";

        console.log("[minimaxMusic] 输入:", {
          promptLength: finalPrompt.length,
          lyricsLength: lyrics.length,
          isInstrumental,
          lyricsOptimizer,
          model,
        });

        if (isInstrumental && !finalPrompt) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "纯音乐模式需要填写 Prompt",
                    },
                  }
                : n
            )
          );
          return;
        }

        if (!isInstrumental && !lyrics && !lyricsOptimizer) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "请填写歌词，或开启 AI 自动填词",
                    },
                  }
                : n
            )
          );
          return;
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    prompt: finalPrompt,
                    lyrics: lyricsRaw,
                    isInstrumental,
                    lyricsOptimizer,
                    model,
                  },
                }
              : n
          )
        );

        try {
          const requestBody: Record<string, unknown> = {
            model,
            prompt: finalPrompt || undefined,
            isInstrumental,
            lyricsOptimizer,
          };
          if (!isInstrumental && lyrics) {
            requestBody.lyrics = lyrics;
          }

          const response = await fetchWithAuth("/api/ai/minimax-music", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            let message = "音乐生成失败";
            try {
              const errorData = await response.json();
              const messageFromError =
                typeof errorData?.error === "string" && errorData.error.trim()
                  ? errorData.error.trim()
                  : undefined;
              const messageFromMessage = Array.isArray(errorData?.message)
                ? errorData.message.join("; ")
                : typeof errorData?.message === "string"
                ? errorData.message.trim()
                : undefined;
              message = messageFromMessage || messageFromError || message;
            } catch {}
            throw new Error(message);
          }

          const result = await response.json();
          console.log("[minimaxMusic] API 结果:", result);
          const synthesisStatus = Number(result?.status ?? result?.data?.status);
          const audioUrl =
            (typeof result?.audioUrl === "string" && result.audioUrl) ||
            (typeof result?.audio_url === "string" && result.audio_url) ||
            (typeof result?.data?.audio === "string" && result.data.audio);

          if (!audioUrl && synthesisStatus === 1) {
            throw new Error("音乐仍在合成中，请稍后重试（通常需要 1-3 分钟）");
          }
          if (!audioUrl) {
            throw new Error("音乐生成返回缺少音频地址");
          }

          const historyItemId = `minimax-music-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const historyItem = {
            id: historyItemId,
            prompt: finalPrompt,
            lyrics: isInstrumental ? undefined : lyrics,
            isInstrumental,
            lyricsOptimizer,
            audioUrl,
            createdAt: Date.now(),
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      audioUrl,
                      selectedHistoryId: historyItemId,
                      history: [
                        historyItem,
                        ...(
                          Array.isArray((n.data as any)?.history)
                            ? ((n.data as any).history as Array<Record<string, unknown>>)
                                .filter(
                                  (item) =>
                                    typeof item?.audioUrl === "string" &&
                                    item.audioUrl.trim().length > 0
                                )
                                .slice(0, 29)
                            : []
                        ),
                      ],
                      error: undefined,
                    },
                  }
                : n
            )
          );
        } catch (error) {
          console.error("[minimaxMusic] 错误:", error);
          const msg = error instanceof Error ? error.message : "音乐生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // Midjourney 节点处理逻辑
      if (node.type === "midjourney") {
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        // 获取预设提示词
        const presetPrompt =
          typeof (node.data as any)?.presetPrompt === "string"
            ? (node.data as any).presetPrompt.trim()
            : "";
        const finalPrompt = presetPrompt
          ? `${presetPrompt} ${promptText}`
          : promptText;

        // 获取模式和宽高比
        const mjMode = (node.data as any)?.mode || "FAST";
        const mjAspectRatio = (node.data as any)?.aspectRatio;

        // Midjourney 只支持纯文生图，不支持图片输入
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        try {
          // 文生图 (Imagine)
          const mjResult = await generateImageViaAPI({
            prompt: finalPrompt,
            outputFormat: "png",
            aiProvider: "midjourney",
            model: "midjourney-fast",
            aspectRatio: mjAspectRatio,
            providerOptions: {
              midjourney: { mode: mjMode },
            },
          });

          if (!mjResult.success || !mjResult.data) {
            const msg = mjResult.error?.message || "Midjourney 生成失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }

          const mjImgBase64 = mjResult.data.imageData;
          const mjMetadata = mjResult.data.metadata || {};
          const midjourneyMeta = mjMetadata.midjourney || {};
          const midjourneyImageUrl =
            midjourneyMeta.imageUrl || mjMetadata.imageUrl;
          const rawMidjourneyImageUrl =
            typeof midjourneyImageUrl === "string"
              ? midjourneyImageUrl.trim()
              : "";
          const rawPreviewSource =
            rawMidjourneyImageUrl.length > 0 ? rawMidjourneyImageUrl : mjImgBase64;

          let previewSource = rawPreviewSource;
          try {
            if (typeof rawPreviewSource === "string" && rawPreviewSource.trim()) {
              previewSource = await uploadImageToStableUrl(
                rawPreviewSource.trim(),
                `flow_midjourney_${nodeId}_${Date.now()}.png`,
                { reuploadUnstableRemote: true }
              );
            }
          } catch (persistErr) {
            console.warn(
              "[Flow] Midjourney: failed to persist preview to stable storage",
              persistErr
            );
            previewSource = rawPreviewSource;
          }

          const hasRemoteUrl =
            typeof previewSource === "string" &&
            previewSource.trim().length > 0 &&
            !isDataImageUrl(previewSource) &&
            !isBlobUrl(previewSource);
          const stableRemoteUrl = hasRemoteUrl ? previewSource : undefined;

          const rawImageUrls = Array.isArray(midjourneyMeta.imageUrls)
            ? midjourneyMeta.imageUrls
            : Array.isArray(mjMetadata.imageUrls)
            ? mjMetadata.imageUrls
            : [];
          const stableMidjourneyImageUrls: string[] = [];
          for (let idx = 0; idx < rawImageUrls.length; idx += 1) {
            const item = rawImageUrls[idx];
            if (typeof item !== "string" || !item.trim()) continue;
            const trimmed = item.trim();
            try {
              stableMidjourneyImageUrls.push(
                await uploadImageToStableUrl(
                  trimmed,
                  `flow_midjourney_${nodeId}_${idx}_${Date.now()}.png`,
                  { reuploadUnstableRemote: true }
                )
              );
            } catch (persistErr) {
              console.warn(
                "[Flow] Midjourney: failed to persist imageUrls item",
                persistErr
              );
              stableMidjourneyImageUrls.push(trimmed);
            }
          }

          const historyId = previewSource
            ? `${nodeId}-${Date.now()}`
            : undefined;

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      imageData: hasRemoteUrl ? undefined : previewSource,
                      error: undefined,
                      taskId: midjourneyMeta.taskId,
                      mjApiState:
                        typeof midjourneyMeta.state === "string"
                          ? midjourneyMeta.state
                          : undefined,
                      buttons: midjourneyMeta.buttons,
                      imageUrl: hasRemoteUrl
                        ? stableRemoteUrl
                        : undefined,
                      imageUrls: stableMidjourneyImageUrls.length > 0
                        ? stableMidjourneyImageUrls
                        : undefined,
                      promptEn: midjourneyMeta.promptEn,
                      lastHistoryId:
                        historyId ?? (n.data as any)?.lastHistoryId,
                    },
                  }
                : n
            )
          );

          if (historyId) {
            const projectId = useProjectContentStore.getState().projectId;
            const actionLabel = "Imagine";
            void recordImageHistoryEntry({
              id: historyId,
              base64: hasRemoteUrl ? undefined : previewSource,
              remoteUrl: hasRemoteUrl ? stableRemoteUrl : undefined,
              title: `Midjourney ${actionLabel} ${new Date().toLocaleTimeString()}`,
              nodeId,
              nodeType: "midjourney",
              fileName: `flow_midjourney_${historyId}.png`,
              projectId,
              keepThumbnail: false,
              metadata: {
                ...mjMetadata,
                model: "midjourney-fast",
                aiProvider: "midjourney",
                provider: "midjourney",
              },
            })
              .then(({ remoteUrl }) => {
                if (!remoteUrl) return;
                if (hasRemoteUrl) return;
                const outs = rf.getEdges().filter((e) => e.source === nodeId);
                setNodes((ns) =>
                  ns.map((n) => {
                    if (n.id === nodeId) {
                      if ((n.data as any)?.imageData !== previewSource) return n;
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                        },
                      };
                    }
                    if (
                      outs.some((e) => e.target === n.id) &&
                      n.type === "image"
                    ) {
                      if ((n.data as any)?.imageData !== previewSource) return n;
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                        },
                      };
                    }
                    return n;
                  })
                );
              })
              .catch(() => {});
          }

          if (previewSource) {
            // 更新下游节点
            const mjOuts = rf.getEdges().filter((e) => e.source === nodeId);
            if (mjOuts.length) {
              setNodes((ns) =>
                ns.map((n) => {
                  const hits = mjOuts.filter((e) => e.target === n.id);
                  if (!hits.length) return n;
                  if (n.type === "image")
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        ...(hasRemoteUrl
                          ? {
                              imageUrl: normalizedMidjourneyUrl,
                              imageData: undefined,
                            }
                          : { imageData: previewSource }),
                        thumbnail: undefined,
                      },
                    };
                  return n;
                })
              );
            }
          }
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Midjourney 生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // Nano2 节点处理逻辑
      if (node.type === "midjourneyV7" || node.type === "niji7") {
        const { text: promptText } = getTextPromptForNode(nodeId);
        const presetRaw = (node.data as any)?.presetPrompt;
        const preset =
          typeof presetRaw === "string" ? presetRaw.trim() : "";
        const mergedPromptText = sanitizeFlowTextForMidjourneyV7(
          [preset, promptText].filter(Boolean).join(" ").trim()
        );
        const totalImgEdges = currentEdges.filter(
          (e) => e.target === nodeId && e.targetHandle === "img"
        );
        const imgEdges = totalImgEdges.slice(0, 10);
        let imageDatas = await resolveEdgesAsDataUrls(imgEdges);

        const omniImageEdges = currentEdges.filter(
          (e) =>
            e.target === nodeId &&
            (e.targetHandle === "omniImage" || e.targetHandle === "omniimage")
        );
        if (omniImageEdges.length > 1) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: "万物参考（cref）最多支持 1 张图片" } }
                : n
            )
          );
          return;
        }
        if (omniImageEdges.length === 1) {
          const crefDatas = await resolveEdgesAsDataUrls([omniImageEdges[0]]);
          if (crefDatas.length > 0) {
            const beforeCount = imageDatas.length;
            imageDatas = [crefDatas[0], ...imageDatas].slice(0, 10);
            if (beforeCount >= 10) {
              window.dispatchEvent(
                new CustomEvent("toast", {
                  detail: {
                    message: `参考图已满 10 张，万物参考已插入队首并去掉最后一张`,
                    type: "warning",
                  },
                })
              );
            }
          }
        }

        const { finalPrompt, errors } = buildMidjourneyPrompt(
          node.type,
          (node.data || {}) as Record<string, any>,
          mergedPromptText,
          imageDatas.length > 0
        );

        if (errors.length > 0) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: errors.join("\n"),
                    },
                  }
                : n
            )
          );
          return;
        }

        if (totalImgEdges.length > 10) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: `Midjourney 仅支持最多 10 张参考图，当前已自动截取前 10 张`,
                type: "warning",
              },
            })
          );
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        try {
          const modelName = node.type === "niji7" ? "midjourney-niji-7" : "midjourney-v7";
          const actionTitle = node.type === "niji7" ? "Niji 7" : "Midjourney V7";
          const mjResult = await generateImageViaAPI({
            prompt: finalPrompt,
            outputFormat: "png",
            aiProvider: "midjourney",
            model: modelName,
            imageUrls: imageDatas.length > 0 ? imageDatas : undefined,
            providerOptions: {
              midjourney: { mode: "FAST" },
            },
          });

          if (!mjResult.success || !mjResult.data) {
            const msg = mjResult.error?.message || `${actionTitle} 生成失败`;
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }

          const mjImgBase64 = mjResult.data.imageData;
          const mjMetadata = mjResult.data.metadata || {};
          const midjourneyMeta = mjMetadata.midjourney || {};
          const midjourneyImageUrl =
            midjourneyMeta.imageUrl || mjMetadata.imageUrl;
          const rawMidjourneyImageUrl =
            typeof midjourneyImageUrl === "string"
              ? midjourneyImageUrl.trim()
              : "";
          const rawPreviewSource =
            rawMidjourneyImageUrl.length > 0 ? rawMidjourneyImageUrl : mjImgBase64;

          let previewSource = rawPreviewSource;
          try {
            if (typeof rawPreviewSource === "string" && rawPreviewSource.trim()) {
              previewSource = await uploadImageToStableUrl(
                rawPreviewSource.trim(),
                `flow_${node.type}_${nodeId}_${Date.now()}.png`,
                { reuploadUnstableRemote: true }
              );
            }
          } catch (persistErr) {
            console.warn(
              "[Flow] Midjourney V7/Niji7: failed to persist preview to stable storage",
              persistErr
            );
            previewSource = rawPreviewSource;
          }

          const hasRemoteUrl =
            typeof previewSource === "string" &&
            previewSource.trim().length > 0 &&
            !isDataImageUrl(previewSource) &&
            !isBlobUrl(previewSource);
          const stableRemoteUrl = hasRemoteUrl ? previewSource : undefined;

          const rawImageUrls = Array.isArray(midjourneyMeta.imageUrls)
            ? midjourneyMeta.imageUrls
            : Array.isArray(mjMetadata.imageUrls)
            ? mjMetadata.imageUrls
            : [];
          const stableMidjourneyImageUrls: string[] = [];
          for (let idx = 0; idx < rawImageUrls.length; idx += 1) {
            const item = rawImageUrls[idx];
            if (typeof item !== "string" || !item.trim()) continue;
            const trimmed = item.trim();
            try {
              stableMidjourneyImageUrls.push(
                await uploadImageToStableUrl(
                  trimmed,
                  `flow_${node.type}_${nodeId}_${idx}_${Date.now()}.png`,
                  { reuploadUnstableRemote: true }
                )
              );
            } catch (persistErr) {
              console.warn(
                "[Flow] Midjourney V7/Niji7: failed to persist imageUrls item",
                persistErr
              );
              stableMidjourneyImageUrls.push(trimmed);
            }
          }

          const historySeed = Date.now();
          const historySources = (
            stableMidjourneyImageUrls.length > 0
              ? stableMidjourneyImageUrls
              : [stableRemoteUrl || previewSource]
          )
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean);
          const dedupedHistorySources = Array.from(new Set(historySources));
          const historyEntries = dedupedHistorySources.map((source, idx) => {
            const sourceHasRemote =
              !isDataImageUrl(source) && !isBlobUrl(source);
            return {
              id: `${nodeId}-${historySeed}-${idx + 1}`,
              source,
              hasRemote: sourceHasRemote,
            };
          });
          const primaryHistoryEntry = historyEntries[0];

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      imageData: hasRemoteUrl ? undefined : previewSource,
                      error: undefined,
                      taskId: midjourneyMeta.taskId,
                      mjApiState:
                        typeof midjourneyMeta.state === "string"
                          ? midjourneyMeta.state
                          : undefined,
                      buttons: midjourneyMeta.buttons,
                      imageUrl: hasRemoteUrl
                        ? stableRemoteUrl
                        : undefined,
                      imageUrls: stableMidjourneyImageUrls.length > 0
                        ? stableMidjourneyImageUrls
                        : hasRemoteUrl && stableRemoteUrl
                        ? [stableRemoteUrl]
                        : undefined,
                      promptEn: midjourneyMeta.promptEn,
                      lastHistoryId:
                        primaryHistoryEntry?.id ??
                        (n.data as any)?.lastHistoryId,
                    },
                  }
                : n
            )
          );

          if (historyEntries.length > 0) {
            const projectId = useProjectContentStore.getState().projectId;
            historyEntries.forEach((entry, idx) => {
              const itemTitle =
                historyEntries.length > 1
                  ? `${actionTitle} #${idx + 1} ${new Date().toLocaleTimeString()}`
                  : `${actionTitle} ${new Date().toLocaleTimeString()}`;
              void recordImageHistoryEntry({
                id: entry.id,
                base64: entry.hasRemote ? undefined : entry.source,
                remoteUrl: entry.hasRemote ? entry.source : undefined,
                title: itemTitle,
                nodeId,
                nodeType: node.type,
                fileName: `flow_${node.type}_${entry.id}_${idx + 1}.png`,
                projectId,
                keepThumbnail: false,
                metadata: {
                  ...mjMetadata,
                  model: modelName,
                  aiProvider: "midjourney",
                  provider: "midjourney",
                  outputIndex: idx,
                  outputCount: historyEntries.length,
                },
              })
                .then(({ remoteUrl }) => {
                  if (idx !== 0 || !remoteUrl || entry.hasRemote) return;
                  if (entry.source !== previewSource) return;
                  const outs = rf.getEdges().filter((e) => e.source === nodeId);
                  setNodes((ns) =>
                    ns.map((n) => {
                      if (n.id === nodeId) {
                        if ((n.data as any)?.imageData !== previewSource) return n;
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            imageUrl: remoteUrl,
                            imageData: undefined,
                            thumbnail: undefined,
                          },
                        };
                      }
                      if (
                        outs.some((e) => e.target === n.id) &&
                        n.type === "image"
                      ) {
                        if ((n.data as any)?.imageData !== previewSource) return n;
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            imageUrl: remoteUrl,
                            imageData: undefined,
                            thumbnail: undefined,
                          },
                        };
                      }
                      return n;
                    })
                  );
                })
                .catch(() => {});
            });
          }

          if (previewSource) {
            const mjOuts = rf.getEdges().filter((e) => e.source === nodeId);
            if (mjOuts.length) {
              const resolveOutputForHandle = (
                sourceHandle?: string | null
              ): string => {
                const rawHandle =
                  typeof sourceHandle === "string"
                    ? sourceHandle.trim()
                    : "";
                const idx = rawHandle.startsWith("img")
                  ? Math.max(0, Math.min(3, Number(rawHandle.slice(3)) - 1))
                  : 0;
                const picked =
                  stableMidjourneyImageUrls[idx] ||
                  stableMidjourneyImageUrls[0] ||
                  stableRemoteUrl ||
                  previewSource;
                return typeof picked === "string" ? picked.trim() : "";
              };

              const isLikelyRemoteImageRef = (value: string): boolean => {
                const trimmed = value?.trim?.() || "";
                if (!trimmed) return false;
                if (/^https?:\/\//i.test(trimmed)) return true;
                if (
                  trimmed.startsWith("/api/assets/proxy") ||
                  trimmed.startsWith("/assets/proxy")
                )
                  return true;
                if (
                  trimmed.startsWith("/") ||
                  trimmed.startsWith("./") ||
                  trimmed.startsWith("../")
                )
                  return true;
                if (/^(templates|projects|uploads|videos)\//i.test(trimmed))
                  return true;
                return false;
              };

              setNodes((ns) =>
                ns.map((n) => {
                  const hits = mjOuts.filter((e) => e.target === n.id);
                  if (!hits.length) return n;
                  if (n.type === "image") {
                    const resolvedOutput = hits
                      .map((e) =>
                        resolveOutputForHandle((e as any).sourceHandle)
                      )
                      .find((value) => Boolean(value));
                    if (!resolvedOutput) return n;
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        ...(isLikelyRemoteImageRef(resolvedOutput)
                          ? {
                              imageUrl: resolvedOutput,
                              imageData: undefined,
                            }
                          : { imageData: resolvedOutput }),
                        thumbnail: undefined,
                      },
                    };
                  }
                  return n;
                })
              );
            }
          }
        } catch (error) {
          const msg =
            error instanceof Error
              ? error.message
              : node.type === "niji7"
              ? "Niji 7 生成失败"
              : "Midjourney V7 生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      if (node.type === "nano2" || node.type === "gptImage2") {
        const nodeData =
          node.data && typeof node.data === "object"
            ? (node.data as Record<string, any>)
            : {};
        const metadata =
          nodeData.nodeConfigMetadata && typeof nodeData.nodeConfigMetadata === "object"
            ? (nodeData.nodeConfigMetadata as Record<string, any>)
            : undefined;
        const defaultData =
          metadata?.defaultData && typeof metadata.defaultData === "object"
            ? (metadata.defaultData as Record<string, any>)
            : undefined;
        const maxReferenceImagesRaw = Number(
          nodeData.maxReferenceImages ??
            metadata?.maxReferenceImages ??
            defaultData?.maxReferenceImages
        );
        const maxReferenceImages =
          Number.isFinite(maxReferenceImagesRaw) && maxReferenceImagesRaw > 0
            ? Math.max(1, Math.min(16, Math.floor(maxReferenceImagesRaw)))
            : 14;
        const requestedModel =
          (typeof nodeData.model === "string" && nodeData.model.trim()) ||
          (typeof metadata?.model === "string" && metadata.model.trim()) ||
          (typeof defaultData?.model === "string" && defaultData.model.trim()) ||
          "gemini-3.1-flash-image-preview";
        const { text: promptText, hasEdge: hasText } = getTextPromptForNode(nodeId);
        if (!hasText || !promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: "缺少提示词输入" } }
                : n
            )
          );
          return;
        }

        // 获取输入图片
        const imgEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .slice(0, maxReferenceImages);
        const imageDatas = await resolveEdgesAsDataUrls(imgEdges);

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "running", error: undefined } }
              : n
          )
        );

        try {
          const latestBananaImageRoute =
            useAIChatStore.getState().bananaImageRoute || bananaImageRoute;
          const nano2AspectRatio = (() => {
            const raw = nodeData?.aspectRatio ?? defaultData?.aspectRatio;
            return typeof raw === "string" && raw.trim().length ? raw.trim() : undefined;
          })();
          const nano2Resolution = (() => {
            const raw = nodeData?.resolution ?? defaultData?.resolution;
            if (typeof raw !== "string") return "1K";
            const normalized = raw.trim().toUpperCase();
            return normalized || "1K";
          })();
          const gptImage2OfficialFallback =
            typeof nodeData?.officialFallback === "boolean"
              ? nodeData.officialFallback
              : typeof defaultData?.officialFallback === "boolean"
              ? defaultData.officialFallback
              : false;
          const pickStringValue = (value: unknown): string | undefined => {
            if (typeof value !== "string") return undefined;
            const normalized = value.trim();
            return normalized.length > 0 ? normalized : undefined;
          };
          const pickNumberValue = (value: unknown): number | undefined => {
            if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
            return value;
          };
          const gptImage2Quality = (() => {
            const value = pickStringValue(
              nodeData?.quality ?? defaultData?.quality
            )?.toLowerCase();
            return value === "auto" ||
              value === "low" ||
              value === "medium" ||
              value === "high"
              ? value
              : undefined;
          })();
          const gptImage2Background = (() => {
            const value = pickStringValue(
              nodeData?.background ?? defaultData?.background
            )?.toLowerCase();
            return value === "auto" || value === "opaque" || value === "transparent"
              ? value
              : undefined;
          })();
          const gptImage2Moderation = (() => {
            const value = pickStringValue(
              nodeData?.moderation ?? defaultData?.moderation
            )?.toLowerCase();
            return value === "auto" || value === "low" ? value : undefined;
          })();
          const gptImage2OutputFormat = (() => {
            const value = pickStringValue(
              nodeData?.outputFormat ?? defaultData?.outputFormat
            )?.toLowerCase();
            return value === "png" || value === "jpeg" || value === "webp"
              ? value
              : undefined;
          })();
          const gptImage2OutputCompression = pickNumberValue(
            nodeData?.outputCompression ?? defaultData?.outputCompression
          );
          const gptImage2MaskUrl = pickStringValue(
            nodeData?.maskUrl ?? defaultData?.maskUrl
          );
          const result = await generateImageViaAPI({
            prompt: promptText,
            aiProvider: "nano2",
            model: requestedModel,
            providerOptions: {
              banana: {
                imageRoute: latestBananaImageRoute,
              },
            },
            aspectRatio: nano2AspectRatio,
            imageUrls: imageDatas.length > 0 ? imageDatas : undefined,
            imageSize: nano2Resolution,
            ...(node.type === "gptImage2"
              ? {
                  officialFallback: gptImage2OfficialFallback,
                  ...(gptImage2Quality ? { quality: gptImage2Quality } : {}),
                  ...(gptImage2Background
                    ? { background: gptImage2Background }
                    : {}),
                  ...(gptImage2Moderation
                    ? { moderation: gptImage2Moderation }
                    : {}),
                  ...(gptImage2OutputFormat
                    ? { outputFormat: gptImage2OutputFormat }
                    : {}),
                  ...(typeof gptImage2OutputCompression === "number"
                    ? { outputCompression: gptImage2OutputCompression }
                    : {}),
                  ...(gptImage2MaskUrl ? { maskUrl: gptImage2MaskUrl } : {}),
                }
              : {}),
            ...(node.type !== "gptImage2"
              ? {
                  googleSearch:
                    typeof nodeData?.googleSearch === "boolean"
                      ? nodeData.googleSearch
                      : defaultData?.googleSearch,
                  googleImageSearch:
                    typeof nodeData?.googleImageSearch === "boolean"
                      ? nodeData.googleImageSearch
                      : defaultData?.googleImageSearch,
                }
              : {}),
          });

          if (!result.success || !result.data) {
            const msg =
              result.error?.message ||
              (node.type === "gptImage2" ? "Gpt-Imgae-2 生成失败" : "Nano2 生成失败");
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }

          const resolvedImageUrl =
            result.data.imageUrl || result.data.metadata?.imageUrl;
          const rawPreview =
            (typeof resolvedImageUrl === "string" && resolvedImageUrl.trim()) ||
            (typeof result.data.imageData === "string" &&
              result.data.imageData.trim()) ||
            (typeof result.data.imageUrl === "string" &&
              result.data.imageUrl.trim()) ||
            "";

          let stableImageRef = rawPreview;
          try {
            if (rawPreview) {
              stableImageRef = await uploadImageToStableUrl(
                rawPreview,
                `flow_${node.type === "gptImage2" ? "gpt_image_2" : "nano2"}_${nodeId}_${Date.now()}.png`,
                { reuploadUnstableRemote: true }
              );
            }
          } catch (persistErr) {
            console.warn(
              "[Flow] Nano2: failed to persist preview to stable storage",
              persistErr
            );
            stableImageRef = rawPreview;
          }

          const nodeImageUrl =
            stableImageRef &&
            !isDataImageUrl(stableImageRef) &&
            !isBlobUrl(stableImageRef)
              ? stableImageRef
              : undefined;
          const nodeImageData =
            stableImageRef &&
            (isDataImageUrl(stableImageRef) || isBlobUrl(stableImageRef))
              ? stableImageRef
              : undefined;

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      imageUrl: nodeImageUrl,
                      imageData: nodeImageData,
                      error: undefined,
                    },
                  }
                : n
            )
          );

          if (stableImageRef) {
            try {
              const projectId = useProjectContentStore.getState().projectId;
              const historyId = `${nodeId}-${Date.now()}`;
              const historyRemote =
                !isDataImageUrl(stableImageRef) && !isBlobUrl(stableImageRef);
              const historyPrefix = node.type === "gptImage2" ? "Gpt-Imgae-2" : "Nano2";
              void recordImageHistoryEntry({
                id: historyId,
                base64: historyRemote ? undefined : stableImageRef,
                remoteUrl: historyRemote ? stableImageRef : undefined,
                title: `${historyPrefix} ${new Date().toLocaleTimeString()}`,
                nodeId,
                nodeType: "generate",
                fileName: `flow_${node.type === "gptImage2" ? "gpt_image_2" : "nano2"}_${historyId}.png`,
                projectId,
                keepThumbnail: false,
                metadata: {
                  ...(result.data.metadata || {}),
                  model: result.data.model || requestedModel,
                  aiProvider: "nano2",
                  provider: "nano2",
                },
              }).catch(() => {});
            } catch {}
          }
        } catch (error) {
          const msg =
            error instanceof Error
              ? error.message
              : node.type === "gptImage2"
              ? "Gpt-Imgae-2 生成失败"
              : "Nano2 生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // Seedream5 节点处理逻辑
      if (node.type === "seedream5") {
        // 获取 prompt 输入（注意句柄名是 "prompt" 不是 "text"）
        const promptEdge = currentEdges.find(
          (e) => e.target === nodeId && e.targetHandle === "prompt"
        );
        let promptText = "";
        if (promptEdge) {
          const promptNode = rf.getNode(promptEdge.source);
          if (promptNode) {
            const resolved = resolveTextFromSourceNode(promptNode, promptEdge.sourceHandle);
            promptText = resolved?.trim() || "";
          }
        }

        // 获取输入图片（最多5张）
        const imgEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .slice(0, 5);
        const imageDatas = await resolveEdgesAsDataUrls(imgEdges);

        // 提示超过5张图片
        const totalImgEdges = currentEdges.filter(
          (e) => e.target === nodeId && e.targetHandle === "img"
        );
        if (totalImgEdges.length > 5) {
          console.warn(`Seedream5: 最多支持5张参考图，当前连接了${totalImgEdges.length}张，只使用前5张`);
        }

        // 验证：至少需要提示词或图片之一
        const hasValidPrompt = promptText && promptText.trim().length > 0;
        if (!hasValidPrompt && imageDatas.length === 0) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: "需要提示词或参考图" } }
                : n
            )
          );
          return;
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "running", error: undefined } }
              : n
          )
        );

        try {
          const normalizeSeedreamSizeForAPI = (raw: unknown): string => {
            const value = typeof raw === "string" ? raw.trim() : "";
            if (!value) return "2K";
            const compact = value.replace(/\s+/g, "");
            const upper = compact.toUpperCase();
            if (upper === "2K" || upper === "3K") return upper;
            const dimMatch = compact.match(/^(\d{3,5})[xX](\d{3,5})$/);
            if (dimMatch) return `${dimMatch[1]}x${dimMatch[2]}`;
            console.warn(`Seedream5: invalid size "${value}", fallback to 2K`);
            return "2K";
          };
          const seedreamSizeForAPI = normalizeSeedreamSizeForAPI(
            (node.data as any)?.size
          );

          const result = await generateImageViaAPI({
            prompt: promptText || "",
            aiProvider: "seedream5",
            imageSize: seedreamSizeForAPI,
            imageUrls: imageDatas.length > 0 ? imageDatas : undefined,
            batchMode: false,
            batchCount: 4,
          });

          if (!result.success || !result.data) {
            const msg = result.error?.message || "Seedream 5.0 生成失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }

          const resolvedImageUrl = result.data.imageUrl || result.data.metadata?.imageUrl;
          const imageData = resolvedImageUrl || result.data.imageData || result.data.imageUrl;

          // 支持批量返回多张图片
          const imageUrls = result.data.imageUrls || result.data.metadata?.imageUrls;
          const finalImagesRaw =
            imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0
              ? imageUrls
              : [imageData];

          const stableFinalImages: string[] = [];
          for (let i = 0; i < finalImagesRaw.length; i += 1) {
            const item = finalImagesRaw[i];
            if (typeof item !== "string" || !item.trim()) continue;
            const trimmed = item.trim();
            try {
              stableFinalImages.push(
                await uploadImageToStableUrl(
                  trimmed,
                  `flow_seedream5_${nodeId}_${i}_${Date.now()}.png`,
                  { reuploadUnstableRemote: true }
                )
              );
            } catch (persistErr) {
              console.warn(
                "[Flow] Seedream5: failed to persist preview to stable storage",
                persistErr
              );
              stableFinalImages.push(trimmed);
            }
          }

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      images: stableFinalImages,
                      imageUrls: stableFinalImages,
                      imageUrl: stableFinalImages[0],
                      error: undefined,
                    },
                  }
                : n
            )
          );

          const historySource = stableFinalImages[0];
          if (historySource) {
            try {
              const projectId = useProjectContentStore.getState().projectId;
              const historyId = `${nodeId}-${Date.now()}`;
              const historyRemote =
                !isDataImageUrl(historySource) && !isBlobUrl(historySource);

              void recordImageHistoryEntry({
                id: historyId,
                base64: historyRemote ? undefined : historySource,
                remoteUrl: historyRemote ? historySource : undefined,
                title: `Seedream 5.0 ${new Date().toLocaleTimeString()}`,
                nodeId,
                nodeType: "generate",
                fileName: `flow_seedream5_${historyId}.png`,
                projectId,
                keepThumbnail: false,
                metadata: { provider: "seedream5" },
              });
            } catch (err) {
              console.warn("记录图片历史失败:", err);
            }
          }
        } catch (err: any) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: err.message || "生成失败" } }
                : n
            )
          );
        }
        return;
      }

      if (
        node.type !== "generate" &&
        node.type !== "generate4" &&
        node.type !== "generateRef" &&
        node.type !== "viewAngle" &&
        node.type !== "generatePro" &&
        node.type !== "generatePro4"
      )
        return;

      const { text: promptFromText, hasEdge: hasPromptEdge } =
        getTextPromptForNode(nodeId);
      const { texts: promptsFromTextEdges } = getTextPromptsForNode(nodeId);

      const failWithMessage = (message: string) => {
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "failed", error: message } }
              : n
          )
        );
      };

      let prompt = "";

      if (node.type === "generateRef") {
        const rawBase =
          typeof (node.data as any)?.referencePrompt === "string"
            ? (node.data as any).referencePrompt
            : "";
        const basePrompt = rawBase.trim().length
          ? rawBase.trim()
          : DEFAULT_REFERENCE_PROMPT;
        const pieces = [basePrompt, promptFromText.trim()].filter(Boolean);
        prompt = pieces.join("，").trim();
        if (!prompt.length) {
          failWithMessage("提示词为空");
          return;
        }
      } else if (node.type === "viewAngle") {
        const base = (() => {
          const raw = (node.data as any)?.generatedPrompt;
          return typeof raw === "string" ? raw.trim() : "";
        })();
        const suffix = (() => {
          const raw = (node.data as any)?.promptSuffix;
          return typeof raw === "string" ? raw.trim() : "";
        })();
        const promptParts = [base, suffix].filter(Boolean);
        prompt = promptParts.join(", ").trim();
        if (!prompt.length) {
          failWithMessage("视角提示词为空");
          return;
        }
      } else if (node.type === "generatePro" || node.type === "generatePro4") {
        // GeneratePro / GeneratePro4: 合并本地 prompts 数组和外部提示词
        const localPrompts = (() => {
          const raw = (node.data as any)?.prompts;
          if (Array.isArray(raw)) {
            return raw
              .filter(
                (p: unknown) => typeof p === "string" && p.trim().length > 0
              )
              .map((p: string) => p.trim());
          }
          return [];
        })();
        const externalPrompts = promptsFromTextEdges;

        // 合并：外部提示词 + 本地提示词数组（依次叠加）
        const allPrompts = [...externalPrompts, ...localPrompts].filter(
          Boolean
        );
        prompt = allPrompts.join(" ").trim();

        if (!prompt.length) {
          failWithMessage("提示词为空（请输入本地提示词或连接外部提示词）");
          return;
        }
      } else {
        if (!hasPromptEdge) {
          failWithMessage("缺少 TextPrompt 输入");
          return;
        }
        prompt = promptFromText.trim();
        if (!prompt.length) {
          failWithMessage("提示词为空");
          return;
        }
      }

      if (node.type === "generate") {
        const preset = (() => {
          const raw = (node.data as any)?.presetPrompt;
          return typeof raw === "string" ? raw.trim() : "";
        })();
        if (preset) {
          prompt = `${preset} ${prompt}`.trim();
        }
      }

      let imageDatas: string[] = [];

      if (node.type === "generateRef") {
        const primaryEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              ["image2", "img"].includes(e.targetHandle || "")
          )
          .slice(0, 1);
        const referEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              ["image1", "refer"].includes(e.targetHandle || "")
          )
          .slice(0, 1);
        imageDatas = [
          ...(await resolveEdgesAsDataUrls(primaryEdges)),
          ...(await resolveEdgesAsDataUrls(referEdges)),
        ];
      } else if (node.type === "viewAngle") {
        const inputEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .slice(0, 1);
        imageDatas = await resolveEdgesAsDataUrls(inputEdges);
        if (imageDatas.length === 0) {
          failWithMessage("缺少图片输入");
          return;
        }
      } else {
        const imgEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .slice(0, 6);
        imageDatas = await resolveEdgesAsDataUrls(imgEdges);
      }

      // 运行时图片输入归一化（优先走 sourceImageUrl，避免大体积 sourceImage 触发上游 500）：
      // - 仅当已是后端可直连的 HTTPS 资源时直传；
      // - 其余（代理 URL、key、data/blob/flow-asset、裸 base64）统一先上传 OSS，失败即中断。
      if (imageDatas.length > 0) {
        const projectId = useProjectContentStore.getState().projectId;
        const weakRawBase64 = (value: string): boolean => {
          const compact = value.replace(/\s+/g, "");
          if (!compact || compact.length >= 2048) return false;
          if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return false;
          return true;
        };
        const normalizedInputs: string[] = [];
        for (const value of imageDatas) {
          const trimmed = typeof value === "string" ? value.trim() : "";
          if (!trimmed) continue;

          const remote = normalizeRemoteUrl(trimmed);
          const canPassRemoteDirectly =
            Boolean(remote) &&
            !isAssetProxyRef(remote) &&
            isLikelyBackendAllowedRemoteUrl(remote) &&
            !requiresManagedImageUpload(remote);

          if (canPassRemoteDirectly && remote) {
            normalizedInputs.push(remote);
            continue;
          }

          const uploadInput = weakRawBase64(trimmed)
            ? ensureDataUrl(trimmed)
            : trimmed;
          const uploaded = await uploadImageToOSS(uploadInput, projectId);
          if (uploaded && isRemoteUrl(uploaded)) {
            normalizedInputs.push(uploaded);
          } else {
            failWithMessage("图片上传失败，无法用于编辑/融合，请检查上传与 OSS 配置");
            return;
          }
        }
        imageDatas = normalizedInputs;
      }

      console.log(`[Flow Debug] Node ${nodeId} (${node.type}) 准备运行:`, {
        prompt: prompt.substring(0, 50) + "...",
        imageDatasCount: imageDatas.length,
        imageDatas: imageDatas.map((img) => img?.substring(0, 50) + "..."),
        imgEdges: currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .map((e) => ({ source: e.source, handle: e.targetHandle })),
      });

      const aspectRatioValue = (() => {
        const raw = (node.data as any)?.aspectRatio;
        return typeof raw === "string" && raw.trim().length
          ? (raw.trim() as AIImageGenerateRequest["aspectRatio"])
          : undefined;
      })();
      const runProvider = resolveFlowModelProvider(
        (node.data as any)?.modelProvider,
        aiProvider
      );
      const effectiveAspectRatio =
        node.type === "generate" && runProvider === "banana-2.5"
          ? undefined
          : aspectRatioValue;

      // 优先使用节点本地的 imageSize，否则使用全局设置
      const nodeSizeValue = (() => {
        const raw = (node.data as any)?.imageSize;
        if (raw === "0.5K" || raw === "1K" || raw === "2K" || raw === "4K")
          return raw;
        return undefined;
      })();
      const effectiveImageSize =
        nodeSizeValue || imageSize || "1K";
      const enableWebSearchForNode =
        (node.type === "generatePro" || node.type === "generatePro4") &&
        Boolean((node.data as any)?.enableWebSearch ?? globalWebSearchEnabled);
      const resolveBananaRouteProviderOptions = (
        providerName: string
      ): AIImageGenerateRequest["providerOptions"] | undefined => {
        const latestBananaImageRoute =
          useAIChatStore.getState().bananaImageRoute || bananaImageRoute;
        const normalized = providerName.trim().toLowerCase();
        if (
          normalized === "banana" ||
          normalized.startsWith("banana-") ||
          normalized === "gemini-pro" ||
          normalized === "nano2"
        ) {
          return {
            banana: {
              imageRoute: latestBananaImageRoute,
            },
          };
        }
        return undefined;
      };
      const providerOptions = resolveBananaRouteProviderOptions(runProvider);
      const nodeConfigCreditParams: Pick<
        AIImageGenerateRequest,
        "nodeConfigKey" | "nodeConfigNameZh" | "nodeConfigNameEn"
      > = {
        nodeConfigKey:
          typeof (node.data as any)?.nodeConfigKey === "string"
            ? (node.data as any).nodeConfigKey.trim()
            : undefined,
        nodeConfigNameZh:
          typeof (node.data as any)?.nodeConfigNameZh === "string"
            ? (node.data as any).nodeConfigNameZh.trim()
            : undefined,
        nodeConfigNameEn:
          typeof (node.data as any)?.nodeConfigNameEn === "string"
            ? (node.data as any).nodeConfigNameEn.trim()
            : undefined,
      };

      // 根据节点类型和全局模式选择模型
      const nodeSpecificModel = (() => {
        // 专业生图节点：按 provider 选择对应模型
        if (node.type === "generatePro" || node.type === "generatePro4") {
          if (runProvider === "banana-3.1" || runProvider === "nano2") {
            return "gemini-3.1-flash-image-preview";
          }
          if (runProvider === "banana-2.5") {
            return "gemini-2.5-flash-image-preview";
          }
          return "gemini-3-flash-preview";
        }
        // 其他节点（包括 generate/generate4/image 等）使用全局模型设置
        return getImageModelForProvider(runProvider);
      })();

      if (node.type === "generate4") {
        /** 连续多次调同一接口易被限流，稍作间隔可提高 3、4 张成功率 */
        const MULTI_GENERATE_STAGGER_MS = 650;
        const total = 4;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    images: [],
                    generate4SlotErrors: undefined,
                    generate4PassIndex: 0,
                  },
                }
              : n
          )
        );
        const produced: string[] = [];
        const slotErrors: (string | undefined)[] = Array.from(
          { length: total },
          () => undefined
        );
        /** 已完成第几轮请求（用于 UI：与成功张数无关，避免中间槽失败后误显示「生成中」） */
        const updateMultiGenerateProgress = (passIndex: number) => {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      images: Array.from({ length: total }, (__, idx) => produced[idx] || ""),
                      generate4PassIndex: passIndex,
                    },
                  }
                : n
            )
          );
        };

        for (let i = 0; i < total; i++) {
          if (i > 0) {
            await new Promise((r) => setTimeout(r, MULTI_GENERATE_STAGGER_MS));
          }
          let generatedImage: string | undefined;
          let generatedModel: string | undefined;
          let generatedMetadata: Record<string, any> | undefined;
          try {
            let result: {
              success: boolean;
              data?: AIImageResult;
              error?: { message: string };
            };
            const remoteInputs = imageDatas.filter(isRemoteUrl);
            const hasOnlyRemote =
              imageDatas.length > 0 && remoteInputs.length === imageDatas.length;
            if (imageDatas.length === 0) {
              result = await generateImageViaAPI({
                prompt,
                outputFormat: "png",
                aiProvider: runProvider,
                model: nodeSpecificModel,
                aspectRatio: effectiveAspectRatio,
                imageSize: effectiveImageSize,
                providerOptions,
                ...nodeConfigCreditParams,
                ...(enableWebSearchForNode ? {
                  enableWebSearch: true,
                  googleSearch: true,
                  googleImageSearch: true,
                } : {}),
              });
            } else if (imageDatas.length === 1) {
              result = await editImageViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrl: imageDatas[0] }
                  : { sourceImage: imageDatas[0] }),
                outputFormat: "png",
                aiProvider: runProvider,
                model: nodeSpecificModel,
                aspectRatio: effectiveAspectRatio,
                imageSize: effectiveImageSize,
                providerOptions,
                ...nodeConfigCreditParams,
              });
            } else {
              result = await blendImagesViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrls: imageDatas.slice(0, 6) }
                  : { sourceImages: imageDatas.slice(0, 6) }),
                outputFormat: "png",
                aiProvider: runProvider,
                model: nodeSpecificModel,
                aspectRatio: effectiveAspectRatio,
                imageSize: effectiveImageSize,
                providerOptions,
                ...nodeConfigCreditParams,
              });
            }

            const generatedSrc =
              result.data?.imageUrl ||
              result.data?.metadata?.imageUrl ||
              result.data?.imageData;

            if (!result.success || !result.data || !generatedSrc) {
              slotErrors[i] =
                result.error?.message ||
                (result.success && !generatedSrc
                  ? "接口成功但未返回图片"
                  : "生成失败");
              if (result.success && result.data && !generatedSrc) {
                console.warn(
                  "⚠️ Flow generate4 success but no image returned",
                  {
                    nodeId,
                    slot: i,
                    aiProvider: runProvider,
                    model: nodeSpecificModel,
                    prompt,
                    hasImage: !!generatedSrc,
                  }
                );
              }
            } else {
              generatedImage = generatedSrc;
              generatedModel = result.data.model || nodeSpecificModel;
              generatedMetadata = result.data.metadata as Record<string, any> | undefined;
            }
          } catch (err: any) {
            slotErrors[i] =
              typeof err?.message === "string" && err.message.trim()
                ? err.message.trim()
                : "请求异常";
            console.warn("⚠️ Flow generate4 slot failed", {
              nodeId,
              slot: i,
              err,
            });
          }

          if (generatedImage) {
            produced[i] = generatedImage;

            const outs = rf
              .getEdges()
              .filter(
                (e) =>
                  e.source === nodeId &&
                  (e as any).sourceHandle === `img${i + 1}`
              );
            if (outs.length) {
              const imgB64 = generatedImage;
              setNodes((ns) =>
                ns.map((n) => {
                  const hits = outs.filter((e) => e.target === n.id);
                  if (!hits.length) return n;
                  if (n.type === "image" && imgB64)
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        imageData: imgB64,
                        thumbnail: undefined,
                      },
                    };
                  return n;
                })
              );
            }

            // 异步上传并写入远程 URL（避免 base64 落盘到项目 JSON/DB）
            try {
              const projectId = useProjectContentStore.getState().projectId;
              const slotIndex = i;
              const historyId = `${nodeId}-${slotIndex}-${Date.now()}`;
              void recordImageHistoryEntry({
                id: historyId,
                base64: generatedImage,
                title: `Generate4 #${
                  slotIndex + 1
                } ${new Date().toLocaleTimeString()}`,
                nodeId,
                nodeType: "generate",
                fileName: `flow_generate4_${historyId}.png`,
                projectId,
                keepThumbnail: false,
                metadata: {
                  ...(generatedMetadata || {}),
                  model: generatedModel || nodeSpecificModel,
                  aiProvider: runProvider,
                  provider: runProvider,
                },
              })
                .then(({ remoteUrl }) => {
                  if (!remoteUrl) return;
                  const outEdges = rf
                    .getEdges()
                    .filter(
                      (e) =>
                        e.source === nodeId &&
                        (e as any).sourceHandle === `img${slotIndex + 1}`
                    );
                  setNodes((ns) =>
                    ns.map((n) => {
                      // 更新 generate4 节点本身：写入 imageUrls 并清理对应 images 槽位
                      if (n.id === nodeId) {
                        const prevUrls = Array.isArray(
                          (n.data as any)?.imageUrls
                        )
                          ? ([...(n.data as any).imageUrls] as string[])
                          : [];
                        prevUrls[slotIndex] = remoteUrl;
                        const prevImages = Array.isArray(
                          (n.data as any)?.images
                        )
                          ? ([...(n.data as any).images] as any[])
                          : [];
                        if (prevImages[slotIndex] === generatedImage) {
                          prevImages[slotIndex] = "";
                        }
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            imageUrls: prevUrls,
                            images: prevImages,
                          },
                        };
                      }

                      // 更新下游 Image 节点：替换为远程 URL，清理 base64
                      if (
                        outEdges.some((e) => e.target === n.id) &&
                        n.type === "image" &&
                        (n.data as any)?.imageData === generatedImage
                      ) {
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            imageUrl: remoteUrl,
                            imageData: undefined,
                            thumbnail: undefined,
                          },
                        };
                      }

                      return n;
                    })
                  );
                })
                .catch(() => {});
            } catch {}
          }

          updateMultiGenerateProgress(i + 1);
        }

        const okCount = produced.filter(Boolean).length;
        const hasAny = okCount > 0;
        const imagesDense = Array.from(
          { length: total },
          (_, idx) => produced[idx] || ""
        );
        const partialHint =
          hasAny && okCount < total
            ? `仅成功 ${okCount}/${total} 张，其余槽位见下方说明（常见于接口限流或额度不足）。`
            : undefined;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: hasAny ? "succeeded" : "failed",
                    error: hasAny ? partialHint : "全部生成失败",
                    images: imagesDense,
                    generate4SlotErrors: slotErrors.some((e) => Boolean(e))
                      ? slotErrors
                      : undefined,
                    generate4PassIndex: undefined,
                  },
                }
              : n
          )
        );

        return;
      }

      // 处理 generatePro4 节点：并发生成4张图片
      if (node.type === "generatePro4") {
        const total = 4;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    images: [],
                  },
                }
              : n
          )
        );

        // 并发生成4张图片
        const generateSingleImage = async (
          index: number
        ): Promise<{
          index: number;
          image?: string;
          error?: string;
          model?: string;
          metadata?: Record<string, any>;
        }> => {
          try {
            let result: {
              success: boolean;
              data?: AIImageResult;
              error?: { message: string };
            };
            const remoteInputs = imageDatas.filter(isRemoteUrl);
            const hasOnlyRemote =
              imageDatas.length > 0 && remoteInputs.length === imageDatas.length;
            if (imageDatas.length === 0) {
              result = await generateImageViaAPI({
                prompt,
                outputFormat: "png",
                aiProvider: runProvider,
                model: nodeSpecificModel,
                aspectRatio: effectiveAspectRatio,
                imageSize: effectiveImageSize,
                providerOptions,
                ...nodeConfigCreditParams,
                ...(enableWebSearchForNode ? {
                  enableWebSearch: true,
                  googleSearch: true,
                  googleImageSearch: true,
                } : {}),
              });
            } else if (imageDatas.length === 1) {
              result = await editImageViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrl: imageDatas[0] }
                  : { sourceImage: imageDatas[0] }),
                outputFormat: "png",
                aiProvider: runProvider,
                model: nodeSpecificModel,
                aspectRatio: effectiveAspectRatio,
                imageSize: effectiveImageSize,
                providerOptions,
                ...nodeConfigCreditParams,
              });
            } else {
              result = await blendImagesViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrls: imageDatas.slice(0, 6) }
                  : { sourceImages: imageDatas.slice(0, 6) }),
                outputFormat: "png",
                aiProvider: runProvider,
                model: nodeSpecificModel,
                aspectRatio: effectiveAspectRatio,
                imageSize: effectiveImageSize,
                providerOptions,
                ...nodeConfigCreditParams,
              });
            }

            const generatedSrc =
              result.data?.imageUrl ||
              result.data?.metadata?.imageUrl ||
              result.data?.imageData;
            if (result.success && generatedSrc) {
              return {
                index,
                image: generatedSrc,
                model: result.data?.model || nodeSpecificModel,
                metadata: result.data?.metadata as Record<string, any> | undefined,
              };
            }
            // 返回错误信息
            return { index, error: result.error?.message || "生成失败" };
          } catch (err) {
            console.error(
              `[generatePro4] Image ${index} generation error:`,
              err
            );
            return {
              index,
              error: err instanceof Error ? err.message : "生成异常",
            };
          }
        };

        // 创建4个并发任务
        const tasks = Array.from({ length: total }, (_, i) =>
          generateSingleImage(i)
        );
        const produced: string[] = new Array(total).fill("");
        const errors: string[] = [];

        // 使用 Promise.all 等待所有任务完成，同时监听每个完成的结果
        const results = await Promise.all(
          tasks.map(async (task) => {
            const result = await task;
            if (result.image) {
              produced[result.index] = result.image;

              // 更新UI显示已完成的图片
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: { ...n.data, images: [...produced] },
                      }
                    : n
                )
              );

              // 更新连接的下游节点
              const outs = rf
                .getEdges()
                .filter(
                  (e) =>
                    e.source === nodeId &&
                    (e as any).sourceHandle === `img${result.index + 1}`
                );
              if (outs.length) {
                const imgB64 = result.image;
                setNodes((ns) =>
                  ns.map((n) => {
                    const hits = outs.filter((e) => e.target === n.id);
                    if (!hits.length) return n;
                    if (n.type === "image" && imgB64)
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageData: imgB64,
                          thumbnail: undefined,
                        },
                      };
                    return n;
                  })
                );
              }

              // 异步上传并写入远程 URL（避免 base64 落盘到项目 JSON/DB）
              try {
                const projectId = useProjectContentStore.getState().projectId;
                const slotIndex = result.index;
                const base64 = result.image;
                const historyId = `${nodeId}-${slotIndex}-${Date.now()}`;
                void recordImageHistoryEntry({
                  id: historyId,
                  base64,
                  title: `GeneratePro4 #${
                    slotIndex + 1
                  } ${new Date().toLocaleTimeString()}`,
                  nodeId,
                  nodeType: "generatePro4",
                  fileName: `flow_generatepro4_${historyId}.png`,
                  projectId,
                  keepThumbnail: false,
                  metadata: {
                    ...(result.metadata || {}),
                    model: result.model || nodeSpecificModel,
                    aiProvider: runProvider,
                    provider: runProvider,
                  },
                })
                  .then(({ remoteUrl }) => {
                    if (!remoteUrl) return;
                    const outEdges = rf
                      .getEdges()
                      .filter(
                        (e) =>
                          e.source === nodeId &&
                          (e as any).sourceHandle === `img${slotIndex + 1}`
                      );
                    setNodes((ns) =>
                      ns.map((n) => {
                        // 更新 generatePro4 节点本身：写入 imageUrls 并清理对应 images 槽位
                        if (n.id === nodeId) {
                          const prevUrls = Array.isArray(
                            (n.data as any)?.imageUrls
                          )
                            ? ([...(n.data as any).imageUrls] as string[])
                            : [];
                          prevUrls[slotIndex] = remoteUrl;
                          const prevImages = Array.isArray(
                            (n.data as any)?.images
                          )
                            ? ([...(n.data as any).images] as any[])
                            : [];
                          if (prevImages[slotIndex] === base64) {
                            prevImages[slotIndex] = "";
                          }
                          return {
                            ...n,
                            data: {
                              ...n.data,
                              imageUrls: prevUrls,
                              images: prevImages,
                            },
                          };
                        }

                        // 更新下游 Image 节点：替换为远程 URL，清理 base64
                        if (
                          outEdges.some((e) => e.target === n.id) &&
                          n.type === "image" &&
                          (n.data as any)?.imageData === base64
                        ) {
                          return {
                            ...n,
                            data: {
                              ...n.data,
                              imageUrl: remoteUrl,
                              imageData: undefined,
                              thumbnail: undefined,
                            },
                          };
                        }

                        return n;
                      })
                    );
                  })
                  .catch(() => {});
              } catch {}
            } else if (result.error) {
              errors.push(`图${result.index + 1}: ${result.error}`);
            }
            return result;
          })
        );

        const hasAny = produced.filter(Boolean).length > 0;
        const errorMsg = errors.length > 0 ? errors.join("; ") : "全部生成失败";
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: hasAny ? "succeeded" : "failed",
                    error: hasAny ? undefined : errorMsg,
                    images: [...produced],
                  },
                }
              : n
          )
        );

        return;
      }

      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  status: "running",
                  error: undefined,
                  responseText: undefined,
                },
              }
            : n
        )
      );

      try {
        let result: {
          success: boolean;
          data?: AIImageResult;
          error?: { message: string };
        };

        const executeImageRequest = async (
          provider: string,
          model: string,
          imageSizeOverride?: "0.5K" | "1K" | "2K" | "4K"
        ) => {
          const requestProviderOptions = resolveBananaRouteProviderOptions(provider);
          const remoteInputs = imageDatas.filter(isRemoteUrl);
          const hasOnlyRemote =
            imageDatas.length > 0 && remoteInputs.length === imageDatas.length;
          const requestImageSize = imageSizeOverride || effectiveImageSize;
          if (imageDatas.length === 0) {
            return await generateImageViaAPI({
              prompt,
              outputFormat: "png",
              aiProvider: provider,
              model,
              aspectRatio: effectiveAspectRatio,
              imageSize: requestImageSize,
              providerOptions: requestProviderOptions,
              ...nodeConfigCreditParams,
              ...(enableWebSearchForNode ? { enableWebSearch: true } : {}),
            });
          }
          if (imageDatas.length === 1) {
            console.log("[FlowOverlay] editImage调用参数:", {
              aiProvider: provider,
              model,
              nodeSpecificModel,
              imageSize: requestImageSize,
            });
            return await editImageViaAPI({
              prompt,
              ...(hasOnlyRemote
                ? { sourceImageUrl: imageDatas[0] }
                : { sourceImage: imageDatas[0] }),
              outputFormat: "png",
              aiProvider: provider,
              model,
              aspectRatio: effectiveAspectRatio,
              imageSize: requestImageSize,
              providerOptions: requestProviderOptions,
              ...nodeConfigCreditParams,
            });
          }
          return await blendImagesViaAPI({
            prompt,
            ...(hasOnlyRemote
              ? { sourceImageUrls: imageDatas.slice(0, 6) }
              : { sourceImages: imageDatas.slice(0, 6) }),
            outputFormat: "png",
            aiProvider: provider,
            model,
            aspectRatio: effectiveAspectRatio,
            imageSize: requestImageSize,
            providerOptions: requestProviderOptions,
            ...nodeConfigCreditParams,
          });
        };

        result = await executeImageRequest(runProvider, nodeSpecificModel);

        if (!result.success || !result.data) {
          const msg = result.error?.message || "执行失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: msg,
                      responseText: undefined,
                    },
                  }
                : n
            )
          );
          return;
        }

        const out = result.data;
        const generatedResponseText =
          typeof out.textResponse === "string" && out.textResponse.trim().length > 0
            ? out.textResponse.trim()
            : undefined;
        const imgBase64 =
          out.imageUrl || out.metadata?.imageUrl || out.imageData;
        if (!imgBase64) {
          console.warn("⚠️ Flow generate success but no image returned", {
            nodeId,
            aiProvider: runProvider,
            model: nodeSpecificModel,
            prompt,
            hasImage: !!imgBase64,
          });
        }

        // 先设置原图，然后异步生成缩略图
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "succeeded",
                    imageData: imgBase64,
                    error: undefined,
                    responseText: generatedResponseText,
                  },
                }
              : n
          )
        );

        if (generatedResponseText) {
          window.dispatchEvent(
            new CustomEvent("flow:updateNodeData", {
              detail: {
                id: nodeId,
                patch: { responseText: generatedResponseText },
              },
            })
          );
        }

        if (imgBase64) {
          const outs = rf.getEdges().filter((e) => e.source === nodeId);
          if (outs.length) {
            setNodes((ns) =>
              ns.map((n) => {
                const hits = outs.filter((e) => e.target === n.id);
                if (!hits.length) return n;
                if (n.type === "image")
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      imageData: imgBase64,
                      thumbnail: undefined,
                    },
                  };
                return n;
              })
            );
          }
        }

        // 异步上传并写入远程 URL（避免 base64 落盘到项目 JSON/DB）
        if (imgBase64) {
          try {
            const projectId = useProjectContentStore.getState().projectId;
            const historyId = `${nodeId}-${Date.now()}`;
            const historyNodeType =
              node.type === "generatePro" ? "generatePro" : "generate";
            void recordImageHistoryEntry({
              id: historyId,
              base64: imgBase64,
              title: `${
                node.type === "generatePro"
                  ? "GeneratePro"
                  : node.type === "generateRef"
                  ? "GenerateRef"
                  : node.type === "viewAngle"
                  ? "ViewAngle"
                  : "Generate"
              } ${new Date().toLocaleTimeString()}`,
              nodeId,
              nodeType: historyNodeType,
              fileName: `flow_${node.type || "generate"}_${historyId}.png`,
              projectId,
              keepThumbnail: false,
              metadata: {
                ...(out.metadata || {}),
                model: out.model || nodeSpecificModel,
                aiProvider: runProvider,
                provider: runProvider,
              },
            })
              .then(({ remoteUrl }) => {
                if (!remoteUrl) return;
                const outs = rf.getEdges().filter((e) => e.source === nodeId);
                setNodes((ns) =>
                  ns.map((n) => {
                    // 更新当前生成节点自身
                    if (n.id === nodeId) {
                      if ((n.data as any)?.imageData !== imgBase64) return n;
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                          lastHistoryId:
                            historyId ?? (n.data as any)?.lastHistoryId,
                        },
                      };
                    }

                    // 同步更新下游 Image 节点：替换为远程 URL，清理 base64
                    if (
                      outs.some((e) => e.target === n.id) &&
                      n.type === "image" &&
                      (n.data as any)?.imageData === imgBase64
                    ) {
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                        },
                      };
                    }

                    return n;
                  })
                );
              })
              .catch(() => {});
          } catch {}
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "failed", error: msg } }
              : n
          )
        );
      }
    },
    [
      aiProvider,
      appendSora2History,
      appendVideoHistory,
      globalWebSearchEnabled,
      getSeedanceModeSpec,
      imageModel,
      inferSeedanceMode,
      pollHappyhorseTask,
      rf,
      setNodes,
      uploadImageToStableUrl,
    ]
  );

  // 定义稳定的onSend回调
  const onSendHandler = React.useCallback(
    async (id: string) => {
      const node = rf.getNode(id);
      if (!node) return;
      const anchorClient = resolveFlowNodeSendAnchorClient({ nodeId: id });
      const cacheKey = "flow_send_image_cache_v1";
      const getCachedUrl = (key: string): string | null => {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (!raw) return null;
          const data = JSON.parse(raw) as Record<string, { url: string; ts: number }>;
          const entry = data[key];
          return entry?.url || null;
        } catch {
          return null;
        }
      };
      const setCachedUrl = (key: string, url: string) => {
        try {
          const raw = localStorage.getItem(cacheKey);
          const data = (raw ? JSON.parse(raw) : {}) as Record<
            string,
            { url: string; ts: number }
          >;
          data[key] = { url, ts: Date.now() };
          const keys = Object.keys(data);
          if (keys.length > 50) {
            const sorted = keys.sort((a, b) => data[a].ts - data[b].ts);
            sorted.slice(0, keys.length - 50).forEach((k) => delete data[k]);
          }
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {}
      };
      const hash32 = (input: string): string => {
        let hash = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
          hash ^= input.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16);
      };
      const fingerprintDataUrl = (dataUrl: string): string => {
        const sampleSize = 256;
        const head = dataUrl.slice(0, sampleSize);
        const tail = dataUrl.slice(Math.max(0, dataUrl.length - sampleSize));
        return `${dataUrl.length}:${hash32(`${head}|${tail}`)}`;
      };
      const normalizeForCanvas = (value?: string): string | null => {
        const trimmed = value?.trim();
        if (!trimmed) return null;
        if (
          trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX) // 本地 IndexedDB 引用不直接外发
        )
          return null;
        if (
          /^data:/i.test(trimmed) ||
          /^https?:\/\//i.test(trimmed) ||
          trimmed.startsWith("/api/assets/proxy") ||
          trimmed.startsWith("/assets/proxy") ||
          trimmed.startsWith("/") ||
          trimmed.startsWith("./") ||
          trimmed.startsWith("../") ||
          /^(templates|projects|uploads|videos)\//i.test(trimmed)
        )
          return trimmed;
        return `data:image/png;base64,${trimmed}`;
      };

      const cropImageToDataUrl = async (params: {
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
        if (!blob) return null;

        const makeCanvas = (cw: number, ch: number): any => {
          if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(cw, ch);
          }
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          return canvas;
        };

        if (typeof createImageBitmap === "function") {
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

            const canvas = makeCanvas(w, h);
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
        }

        return null;
      };

      if (
        node.type === "generate4" ||
        node.type === "generatePro4" ||
        node.type === "midjourneyV7" ||
        node.type === "niji7"
      ) {
        const imgs = ((node.data as any)?.images as string[] | undefined) || [];
        const urls =
          ((node.data as any)?.imageUrls as string[] | undefined) || [];
        const merged = Array.from(
          { length: Math.max(imgs.length, urls.length) },
          (_, idx) => urls[idx] || imgs[idx]
        );
        const normalizedImages = merged
          .map(normalizeForCanvas)
          .filter(Boolean) as string[];
        if (!normalizedImages.length) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "没有可发送的图片", type: "warning" },
            })
          );
          return;
        }

        const parallelGroupSeed = Date.now();
        const parallelGroupId = `flow_send_${id}_${parallelGroupSeed}`;
        const projectId = useProjectContentStore.getState().projectId;
        normalizedImages.forEach((dataUrl, idx) => {
          const fileName = `flow_${id}_${idx + 1}.png`;
          const isRemoteRef =
            !isDataImageUrl(dataUrl) && !isBlobUrl(dataUrl);
          void recordImageHistoryEntry({
            id: `${id}-send-${parallelGroupSeed}-${idx + 1}`,
            base64: isRemoteRef ? undefined : dataUrl,
            remoteUrl: isRemoteRef ? dataUrl : undefined,
            title: `发送到画板 ${
              node.type === "niji7"
                ? "Niji 7"
                : node.type === "midjourneyV7"
                ? "Midjourney V7"
                : node.type === "generatePro4"
                ? "GeneratePro4"
                : "Generate4"
            } #${idx + 1}`,
            nodeId: id,
            nodeType: node.type,
            fileName,
            projectId,
            keepThumbnail: false,
            skipInitialStoreUpdate: true,
            metadata: {
              source: "flow-send",
              nodeType: node.type,
              outputIndex: idx,
              outputCount: normalizedImages.length,
            },
          });
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: dataUrl,
                fileName,
                operationType: "generate",
                smartPosition: undefined,
                anchorClient,
                sourceImageId: undefined,
                sourceImages: undefined,
                preferHorizontal: true,
                parallelGroupId,
                parallelGroupIndex: idx,
                parallelGroupTotal: normalizedImages.length,
              },
            })
          );
        });

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: `已发送 ${normalizedImages.length} 张图片到画板`,
              type: "success",
            },
          })
        );
        return;
      }

      // nano2 单图节点：与 generate4 相同的上传优先策略，确保远程 URL 先上传到 OSS 再派发画板事件
      if (node.type === "nano2" || node.type === "gptImage2") {
        const rawImageUrl =
          ((node.data as any)?.imageUrl as string | undefined) ||
          ((node.data as any)?.imageData as string | undefined);

        let normalizedUrl = normalizeForCanvas(rawImageUrl);
        if (!normalizedUrl && rawImageUrl?.trim()) {
          normalizedUrl = await resolveImageToDataUrl(rawImageUrl, { preferProxy: true });
        }
        if (!normalizedUrl) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "没有可发送的图片", type: "warning" },
            })
          );
          return;
        }

        const fileName = `flow_${node.type === "gptImage2" ? "gpt_image_2" : "nano2"}_${id}_${Date.now()}.png`;
        const pid = useProjectContentStore.getState().projectId;

        try {
          const uploadResult = await imageUploadService.uploadImageSource(normalizedUrl, {
            fileName,
            projectId: pid ?? undefined,
            dir: pid ? `projects/${pid}/images/` : undefined,
          });
          if (uploadResult.success && uploadResult.asset?.url) {
            const resolved = (uploadResult.asset.key || "").trim() || uploadResult.asset.url;
            window.dispatchEvent(
              new CustomEvent("triggerQuickImageUpload", {
                detail: {
                  imageData: resolved,
                  fileName,
                  operationType: "generate",
                  smartPosition: undefined,
                  anchorClient,
                  forceAnchorPosition: true,
                  sourceImageId: undefined,
                  sourceImages: undefined,
                },
              })
            );
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "图片已发送到画板", type: "success" },
              })
            );
            return;
          }
        } catch {}

        // 上传失败时：直接派发事件（blob/data URL 由画板保存流程补传 OSS）
        window.dispatchEvent(
          new CustomEvent("triggerQuickImageUpload", {
            detail: {
              imageData: normalizedUrl,
              fileName,
              operationType: "generate",
              smartPosition: undefined,
              anchorClient,
              forceAnchorPosition: true,
              sourceImageId: undefined,
              sourceImages: undefined,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "图片已发送到画板", type: "success" },
          })
        );
        return;
      }

      if (node.type === "image" || node.type === "imagePro") {
        const resolveCropFromImageChain = (
          current: any,
          visited: Set<string>
        ): {
          baseRef: string;
          rect: { x: number; y: number; width: number; height: number };
          sourceWidth?: number;
          sourceHeight?: number;
        } | null => {
          if (!current?.id || visited.has(current.id)) return null;
          visited.add(current.id);
          if (current.type !== "image" && current.type !== "imagePro") return null;

          const d = (current.data ?? {}) as any;
          const crop = d?.crop as
            | {
                x?: unknown;
                y?: unknown;
                width?: unknown;
                height?: unknown;
                sourceWidth?: unknown;
                sourceHeight?: unknown;
              }
            | undefined;
          const baseRef =
            (typeof d.imageData === "string" && d.imageData.trim()) ||
            (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
            "";
          if (crop && baseRef) {
            const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
            const h = typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth =
                typeof crop.sourceWidth === "number"
                  ? crop.sourceWidth
                  : Number(crop.sourceWidth ?? 0);
              const sourceHeight =
                typeof crop.sourceHeight === "number"
                  ? crop.sourceHeight
                  : Number(crop.sourceHeight ?? 0);
              return {
                baseRef,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              };
            }
          }

          const upstream = rf
            .getEdges()
            .find((e) => e.target === current.id && e.targetHandle === "img");
          if (!upstream) return null;
          const up = rf.getNode(upstream.source);
          const handle = (upstream as any).sourceHandle as string | undefined;
          if (up?.type === "imageSplit") {
            const splitData = (up.data ?? {}) as any;
            const base =
              (typeof splitData.inputImageUrl === "string" && splitData.inputImageUrl.trim()) ||
              (typeof splitData.inputImage === "string" && splitData.inputImage.trim()) ||
              "";
            const match = handle ? /^image(\d+)$/.exec(handle) : null;
            const idx = match ? Math.max(0, Number(match[1]) - 1) : 0;
            const splitRects = Array.isArray(splitData.splitRects) ? splitData.splitRects : [];
            const rect = splitRects?.[idx];
            const x = typeof rect?.x === "number" ? rect.x : Number(rect?.x ?? 0);
            const y = typeof rect?.y === "number" ? rect.y : Number(rect?.y ?? 0);
            const w = typeof rect?.width === "number" ? rect.width : Number(rect?.width ?? 0);
            const h = typeof rect?.height === "number" ? rect.height : Number(rect?.height ?? 0);
            if (base && Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth =
                typeof splitData.sourceWidth === "number" ? splitData.sourceWidth : undefined;
              const sourceHeight =
                typeof splitData.sourceHeight === "number" ? splitData.sourceHeight : undefined;
              return {
                baseRef: base,
                rect: { x, y, width: w, height: h },
                sourceWidth,
                sourceHeight,
              };
            }
            return null;
          }
          if (up?.type === "image" || up?.type === "imagePro") {
            return resolveCropFromImageChain(up, visited);
          }
          return null;
        };

        const d = (node.data ?? {}) as any;
        const baseRef =
          (typeof d.imageData === "string" && d.imageData.trim()) ||
          (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
          "";
        const cropSpec = resolveCropFromImageChain(node, new Set());
        if (cropSpec?.baseRef) {
          const cropped = await cropImageToDataUrl({
            baseRef: cropSpec.baseRef,
            rect: cropSpec.rect,
            sourceWidth: cropSpec.sourceWidth,
            sourceHeight: cropSpec.sourceHeight,
          });
          if (cropped) {
            const fingerprint = fingerprintDataUrl(cropped);
            const cachedUrl = getCachedUrl(fingerprint);
            const fileName = `flow_${id}_${Date.now()}.png`;
            if (cachedUrl) {
              window.dispatchEvent(
                new CustomEvent("triggerQuickImageUpload", {
                  detail: {
                    imageData: cachedUrl,
                    fileName,
                    operationType: "generate",
                    smartPosition: undefined,
                    anchorClient,
                    forceAnchorPosition: true,
                    sourceImageId: undefined,
                    sourceImages: undefined,
                  },
                })
              );
              window.dispatchEvent(
                new CustomEvent("toast", {
                  detail: { message: "图片已发送到画板", type: "success" },
                })
              );
              return;
            }

            try {
              const blob = await resolveImageToBlob(cropped, { preferProxy: true });
              if (blob) {
                const file = new File([blob], fileName, { type: "image/png" });
                const uploadResult = await imageUploadService.uploadImageFile(file, {
                  fileName,
                  contentType: "image/png",
                });
                if (uploadResult.success && uploadResult.asset?.url) {
                  setCachedUrl(fingerprint, uploadResult.asset.url);
                  window.dispatchEvent(
                    new CustomEvent("triggerQuickImageUpload", {
                      detail: {
                        imageData: uploadResult.asset.url,
                        fileName,
                        operationType: "generate",
                        smartPosition: undefined,
                        anchorClient,
                        forceAnchorPosition: true,
                        sourceImageId: undefined,
                        sourceImages: undefined,
                      },
                    })
                  );
                  window.dispatchEvent(
                    new CustomEvent("toast", {
                      detail: { message: "图片已发送到画板", type: "success" },
                    })
                  );
                  return;
                }
              }
            } catch {}

            window.dispatchEvent(
              new CustomEvent("triggerQuickImageUpload", {
                detail: {
                  imageData: cropped,
                  fileName,
                  operationType: "generate",
                  smartPosition: undefined,
                  anchorClient,
                  forceAnchorPosition: true,
                  sourceImageId: undefined,
                  sourceImages: undefined,
                },
              })
            );
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "图片已发送到画板", type: "success" },
              })
            );
            return;
          }
        }

        const normalized = normalizeForCanvas(baseRef);
        const resolved =
          normalized ||
          (baseRef
            ? await resolveImageToDataUrl(baseRef, { preferProxy: true })
            : null);
        if (!resolved) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "没有可发送的图片", type: "warning" },
            })
          );
          return;
        }

        const fileName = `flow_${id}_${Date.now()}.png`;
        window.dispatchEvent(
          new CustomEvent("triggerQuickImageUpload", {
            detail: {
              imageData: resolved,
              fileName,
              operationType: "generate",
              smartPosition: undefined,
              anchorClient,
              forceAnchorPosition: true,
              sourceImageId: undefined,
              sourceImages: undefined,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "图片已发送到画板", type: "success" },
          })
        );
        return;
      }

      // 默认单图（generate / generatePro / generateRef）
      const rawImageUrl =
        ((node.data as any)?.imageUrl as string | undefined) ||
        ((node.data as any)?.imageData as string | undefined);
      const dataUrl = normalizeForCanvas(rawImageUrl);
      if (!dataUrl) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "没有可发送的图片", type: "warning" },
          })
        );
        return;
      }

      const fileName = `flow_${Date.now()}.png`;
      let sendPayload = dataUrl;

      // Midjourney CDN 等外站 https：先发起到项目 OSS，避免画板资产长期 pendingUpload
      if (
        (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) &&
        requiresManagedImageUpload(dataUrl)
      ) {
        try {
          const pid = useProjectContentStore.getState().projectId;
          const uploadResult = await imageUploadService.uploadImageSource(dataUrl, {
            fileName,
            projectId: pid ?? undefined,
            dir: pid ? `projects/${pid}/images/` : undefined,
          });
          if (uploadResult.success && uploadResult.asset?.url) {
            const key = (uploadResult.asset.key || "").trim();
            sendPayload = key || uploadResult.asset.url;
          }
        } catch {
          // 保存时仍会通过 resolveImageToBlob 尝试补传
        }
      }

      // 🔥 关键修复：当图片源不可直接外发（flow-asset: / blob: / data:image/）
      // 时，先上传到 OSS，再用远程 URL 派发事件，避免画板保存被阻塞。
      if (
        !dataUrl.startsWith("http://") &&
        !dataUrl.startsWith("https://") &&
        !dataUrl.startsWith("/api/assets/proxy") &&
        !dataUrl.startsWith("/assets/proxy") &&
        !dataUrl.startsWith("/") &&
        !dataUrl.startsWith("./") &&
        !dataUrl.startsWith("../") &&
        !/^(templates|projects|uploads|videos)\//i.test(dataUrl)
      ) {
        try {
          const uploadResult = await imageUploadService.uploadImageSource(dataUrl, {
            fileName,
          });
          if (uploadResult.success && uploadResult.asset?.url) {
            window.dispatchEvent(
              new CustomEvent("triggerQuickImageUpload", {
                detail: {
                  imageData: uploadResult.asset.url,
                  fileName,
                  operationType: "generate",
                  smartPosition: undefined,
                  anchorClient,
                  forceAnchorPosition: true,
                  sourceImageId: undefined,
                  sourceImages: undefined,
                },
              })
            );
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "图片已发送到画板", type: "success" },
              })
            );
            return;
          }
        } catch {
          // 上传失败时继续走原有流程（走 blob URL + pendingUpload）
        }
      }

      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData: sendPayload,
            fileName,
            operationType: "generate",
            smartPosition: undefined,
            anchorClient,
            forceAnchorPosition: true,
            sourceImageId: undefined,
            sourceImages: undefined,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "图片已发送到画板", type: "success" },
        })
      );
    },
    [rf, aiProvider, bananaImageRoute, imageModel, imageSize, globalWebSearchEnabled]
  );

  const runGroupNodes = React.useCallback(
    async (groupId: string) => {
      if (!groupId) return;

      let started = false;
      setRunningGroupIds((prev) => {
        if (prev.includes(groupId)) return prev;
        started = true;
        return prev.concat(groupId);
      });
      if (!started) return;

      try {
        const allNodes = (rf.getNodes?.() || []) as RFNode[];
        const allEdges = (rf.getEdges?.() || []) as Edge[];
        const groupNode = allNodes.find((node) => node.id === groupId);
        if (!groupNode || !isGroupNode(groupNode)) return;

        const childIds = getGroupChildIds(groupNode);
        const childNodes = childIds
          .map((childId) => allNodes.find((node) => node.id === childId))
          .filter((node): node is RFNode => !!node && !isGroupNode(node));

        const childSet = new Set(childNodes.map((node) => node.id));
        const compareNodePosition = (a: RFNode, b: RFNode) => {
          const ax = Number(a.position?.x ?? 0);
          const bx = Number(b.position?.x ?? 0);
          if (Math.abs(ax - bx) > 0.01) return ax - bx;
          const ay = Number(a.position?.y ?? 0);
          const by = Number(b.position?.y ?? 0);
          return ay - by;
        };

        const indegree = new Map<string, number>();
        const nextMap = new Map<string, Set<string>>();
        childNodes.forEach((node) => {
          indegree.set(node.id, 0);
          nextMap.set(node.id, new Set<string>());
        });

        allEdges.forEach((edge) => {
          if (!childSet.has(edge.source) || !childSet.has(edge.target)) return;
          if (edge.source === edge.target) return;
          const next = nextMap.get(edge.source);
          if (!next || next.has(edge.target)) return;
          next.add(edge.target);
          indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
        });

        const childNodeMap = new Map(childNodes.map((node) => [node.id, node]));
        const queue = childNodes
          .filter((node) => (indegree.get(node.id) || 0) === 0)
          .sort(compareNodePosition);
        const topoOrdered: RFNode[] = [];
        const visited = new Set<string>();

        while (queue.length > 0) {
          const current = queue.shift() as RFNode;
          if (visited.has(current.id)) continue;
          visited.add(current.id);
          topoOrdered.push(current);

          const neighbors = Array.from(nextMap.get(current.id) || []);
          neighbors.forEach((neighborId) => {
            const nextDeg = (indegree.get(neighborId) || 0) - 1;
            indegree.set(neighborId, nextDeg);
            if (nextDeg === 0) {
              const neighbor = childNodeMap.get(neighborId);
              if (neighbor && !visited.has(neighbor.id)) {
                queue.push(neighbor);
              }
            }
          });
          queue.sort(compareNodePosition);
        }

        if (topoOrdered.length < childNodes.length) {
          childNodes
            .filter((node) => !visited.has(node.id))
            .sort(compareNodePosition)
            .forEach((node) => topoOrdered.push(node));
        }

        const runnableNodes = topoOrdered.filter((node) =>
          FLOW_GROUP_RUNNABLE_TYPES.has(String(node.type || ""))
        );

        if (!runnableNodes.length) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "该分组内没有可运行节点", type: "warning" },
            })
          );
          return;
        }

        let successCount = 0;
        let failedCount = 0;

        for (const node of runnableNodes) {
          try {
            const nodeType = String(node.type || "");
            if (FLOW_GROUP_LOCAL_RUN_TYPES.has(nodeType)) {
              const ok = await new Promise<boolean>((resolve) => {
                let settled = false;
                const timeout = window.setTimeout(() => {
                  if (settled) return;
                  settled = true;
                  resolve(false);
                }, 180000);

                window.dispatchEvent(
                  new CustomEvent("flow:run-node", {
                    detail: {
                      id: node.id,
                      done: (result?: boolean) => {
                        if (settled) return;
                        settled = true;
                        window.clearTimeout(timeout);
                        resolve(result !== false);
                      },
                    },
                  })
                );
              });
              if (ok) {
                successCount += 1;
              } else {
                failedCount += 1;
              }
            } else {
              await runNode(node.id);
              successCount += 1;
            }
          } catch {
            failedCount += 1;
          }
        }

        const message =
          failedCount > 0
            ? `分组运行完成：成功 ${successCount}，失败 ${failedCount}`
            : `分组运行完成：共执行 ${successCount} 个节点`;

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message,
              type: failedCount > 0 ? "warning" : "success",
            },
          })
        );
      } finally {
        setRunningGroupIds((prev) => prev.filter((id) => id !== groupId));
      }
    },
    [rf, runNode]
  );

  const runGlobalNodes = React.useCallback(async () => {
    let started = false;
    setIsGlobalRunning((prev) => {
      if (prev) return prev;
      started = true;
      return true;
    });
    if (!started) return;
    globalRunStopRequestedRef.current = false;
    try {
      (window as Window & { __tanvaFlowGlobalRunning?: boolean }).__tanvaFlowGlobalRunning = true;
    } catch {}

    window.dispatchEvent(
      new CustomEvent("flow:global-run-state", {
        detail: { running: true },
      })
    );

    try {
      const allNodes = (rf.getNodes?.() || []) as RFNode[];
      const allEdges = (rf.getEdges?.() || []) as Edge[];
      const normalNodes = allNodes.filter((node) => !isGroupNode(node));

      if (!normalNodes.length) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "当前没有可运行节点", type: "warning" },
          })
        );
        return;
      }

      const nodeSet = new Set(normalNodes.map((node) => node.id));
      const compareNodePosition = (a: RFNode, b: RFNode) => {
        const ax = Number(a.position?.x ?? 0);
        const bx = Number(b.position?.x ?? 0);
        if (Math.abs(ax - bx) > 0.01) return ax - bx;
        const ay = Number(a.position?.y ?? 0);
        const by = Number(b.position?.y ?? 0);
        return ay - by;
      };

      const indegree = new Map<string, number>();
      const nextMap = new Map<string, Set<string>>();
      normalNodes.forEach((node) => {
        indegree.set(node.id, 0);
        nextMap.set(node.id, new Set<string>());
      });

      allEdges.forEach((edge) => {
        if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) return;
        if (edge.source === edge.target) return;
        const next = nextMap.get(edge.source);
        if (!next || next.has(edge.target)) return;
        next.add(edge.target);
        indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
      });

      const nodeMap = new Map(normalNodes.map((node) => [node.id, node]));
      const queue = normalNodes
        .filter((node) => (indegree.get(node.id) || 0) === 0)
        .sort(compareNodePosition);
      const topoOrdered: RFNode[] = [];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift() as RFNode;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        topoOrdered.push(current);

        const neighbors = Array.from(nextMap.get(current.id) || []);
        neighbors.forEach((neighborId) => {
          const nextDeg = (indegree.get(neighborId) || 0) - 1;
          indegree.set(neighborId, nextDeg);
          if (nextDeg === 0) {
            const neighbor = nodeMap.get(neighborId);
            if (neighbor && !visited.has(neighbor.id)) {
              queue.push(neighbor);
            }
          }
        });
        queue.sort(compareNodePosition);
      }

      if (topoOrdered.length < normalNodes.length) {
        normalNodes
          .filter((node) => !visited.has(node.id))
          .sort(compareNodePosition)
          .forEach((node) => topoOrdered.push(node));
      }

      const runnableNodes = topoOrdered.filter((node) =>
        FLOW_GROUP_RUNNABLE_TYPES.has(String(node.type || ""))
      );

      if (!runnableNodes.length) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "当前没有可运行节点", type: "warning" },
          })
        );
        return;
      }

      let successCount = 0;
      let failedCount = 0;
      let stoppedByUser = false;

      for (const node of runnableNodes) {
        if (globalRunStopRequestedRef.current) {
          stoppedByUser = true;
          break;
        }
        try {
          const nodeType = String(node.type || "");
          if (FLOW_GROUP_LOCAL_RUN_TYPES.has(nodeType)) {
            const localRunPromise = new Promise<boolean>((resolve) => {
              let settled = false;
              const timeout = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
              }, 180000);

              window.dispatchEvent(
                new CustomEvent("flow:run-node", {
                  detail: {
                    id: node.id,
                    done: (result?: boolean) => {
                      if (settled) return;
                      settled = true;
                      window.clearTimeout(timeout);
                      resolve(result !== false);
                    },
                  },
                })
              );
            });
            const ok = await new Promise<boolean>((resolve) => {
              let settled = false;
              const handleStop = () => {
                if (settled) return;
                settled = true;
                globalRunStopRequestedRef.current = true;
                resolve(false);
              };
              window.addEventListener(
                "flow:stop-global",
                handleStop as EventListener,
                { once: true }
              );
              void localRunPromise.then((value) => {
                if (settled) return;
                settled = true;
                window.removeEventListener(
                  "flow:stop-global",
                  handleStop as EventListener
                );
                resolve(value);
              });
            });
            if (globalRunStopRequestedRef.current) {
              stoppedByUser = true;
              break;
            }
            if (ok) {
              successCount += 1;
            } else {
              failedCount += 1;
            }
          } else {
            const ok = await new Promise<boolean>((resolve) => {
              let settled = false;
              const handleStop = () => {
                if (settled) return;
                settled = true;
                globalRunStopRequestedRef.current = true;
                resolve(false);
              };
              window.addEventListener(
                "flow:stop-global",
                handleStop as EventListener,
                { once: true }
              );
              void runNode(node.id)
                .then(() => {
                  if (settled) return;
                  settled = true;
                  window.removeEventListener(
                    "flow:stop-global",
                    handleStop as EventListener
                  );
                  resolve(true);
                })
                .catch(() => {
                  if (settled) return;
                  settled = true;
                  window.removeEventListener(
                    "flow:stop-global",
                    handleStop as EventListener
                  );
                  resolve(false);
                });
            });
            if (globalRunStopRequestedRef.current) {
              stoppedByUser = true;
              break;
            }
            if (ok) successCount += 1;
            else failedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }

      const executedCount = successCount + failedCount;
      const message = stoppedByUser
        ? failedCount > 0
          ? `全局运行已终止：已执行 ${executedCount} 个节点（成功 ${successCount}，失败 ${failedCount}）`
          : `全局运行已终止：已执行 ${executedCount} 个节点`
        : failedCount > 0
          ? `全局运行完成：成功 ${successCount}，失败 ${failedCount}`
          : `全局运行完成：共执行 ${successCount} 个节点`;

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message,
            type: stoppedByUser || failedCount > 0 ? "warning" : "success",
          },
        })
      );
    } finally {
      setIsGlobalRunning(false);
      globalRunStopRequestedRef.current = false;
      try {
        (window as Window & { __tanvaFlowGlobalRunning?: boolean }).__tanvaFlowGlobalRunning = false;
      } catch {}
      window.dispatchEvent(
        new CustomEvent("flow:global-run-state", {
          detail: { running: false },
        })
      );
    }
  }, [rf, runNode]);

  React.useEffect(() => {
    const handler = () => {
      void runGlobalNodes();
    };
    window.addEventListener("flow:run-global", handler as EventListener);
    return () => {
      window.removeEventListener("flow:run-global", handler as EventListener);
    };
  }, [runGlobalNodes]);

  React.useEffect(() => {
    const handler = () => {
      globalRunStopRequestedRef.current = true;
    };
    window.addEventListener("flow:stop-global", handler as EventListener);
    return () => {
      window.removeEventListener("flow:stop-global", handler as EventListener);
    };
  }, []);

  // 连接状态回调
  const onConnectStart = React.useCallback(
    (_event: any, params: any) => {
      clearConnectHoverTimer();
      connectHoverAnchorRef.current = null;
      closeConnectQuickMenu({ resetSource: true });

      const nodeId = typeof params?.nodeId === "string" ? params.nodeId : "";
      const handleType =
        typeof params?.handleType === "string" ? params.handleType : "";
      const handleId =
        typeof params?.handleId === "string" ? params.handleId.trim() : "";
      if (nodeId && handleType === "source") {
        connectAnchorRef.current = {
          direction: "forward",
          sourceId: nodeId,
          sourceHandle: handleId || undefined,
        };
      } else if (nodeId && handleType === "target" && handleId) {
        connectAnchorRef.current = {
          direction: "reverse",
          targetId: nodeId,
          targetHandle: handleId,
        };
      } else {
        connectAnchorRef.current = null;
      }
      setIsConnecting(true);
    },
    [clearConnectHoverTimer, closeConnectQuickMenu, setIsConnecting]
  );
  const onConnectEnd = React.useCallback(
    () => {
      clearConnectHoverTimer();
      connectHoverAnchorRef.current = null;
      if (!connectQuickMenuVisibleRef.current) {
        connectAnchorRef.current = null;
      }
      setIsConnecting(false);
    },
    [clearConnectHoverTimer, setIsConnecting]
  );

  const collapsedChildMapCacheRef = React.useRef<{
    signature: string;
    map: Map<string, string>;
  }>({ signature: "", map: new Map() });

  const collapsedGroupsSignature = React.useMemo(() => {
    const parts: string[] = [];
    nodes.forEach((node) => {
      if (!isGroupNode(node as RFNode) || !isGroupCollapsed(node as RFNode)) {
        return;
      }
      const groupId = String(node.id);
      const childIds = getGroupChildIds(node as RFNode);
      parts.push(`${groupId}:${childIds.join(",")}`);
    });
    parts.sort();
    return parts.join("|");
  }, [nodes]);

  const collapsedChildToGroupId = React.useMemo(() => {
    const cached = collapsedChildMapCacheRef.current;
    if (cached.signature === collapsedGroupsSignature) {
      return cached.map;
    }

    const hidden = new Map<string, string>();
    nodes.forEach((node) => {
      if (!isGroupNode(node as RFNode) || !isGroupCollapsed(node as RFNode)) {
        return;
      }
      const groupId = String(node.id);
      getGroupChildIds(node as RFNode).forEach((childId) => {
        if (!hidden.has(childId)) {
          hidden.set(childId, groupId);
        }
      });
    });
    collapsedChildMapCacheRef.current = {
      signature: collapsedGroupsSignature,
      map: hidden,
    };
    return hidden;
  }, [nodes, collapsedGroupsSignature]);

  const collapsedChildNodeIds = React.useMemo(
    () => new Set(Array.from(collapsedChildToGroupId.keys())),
    [collapsedChildToGroupId]
  );

  const groupPreviewImagesByGroupId = React.useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node as RFNode]));
    const previews = new Map<string, string[]>();

    nodes.forEach((node) => {
      if (!isGroupNode(node as RFNode)) return;
      const childIds = getGroupChildIds(node as RFNode);
      const images: string[] = [];
      const seen = new Set<string>();

      for (const childId of childIds) {
        const childNode = nodeById.get(childId);
        if (!childNode || isGroupNode(childNode)) continue;
        const candidates = collectPreviewImagesFromNode(childNode);
        for (const value of candidates) {
          if (seen.has(value)) continue;
          seen.add(value);
          images.push(value);
          if (images.length >= GROUP_PREVIEW_IMAGE_LIMIT) break;
        }
        if (images.length >= GROUP_PREVIEW_IMAGE_LIMIT) break;
      }

      previews.set(String(node.id), images);
    });

    return previews;
  }, [nodes]);

  // 在 node 渲染前为 Generate 节点注入 onRun 回调
  const nodeWithHandlersCacheRef = React.useRef<
    Map<string, { source: RFNode; enhanced: RFNode }>
  >(new Map());
  React.useEffect(() => {
    nodeWithHandlersCacheRef.current.clear();
  }, [
    nodeCreditsByType,
    managedRuntimeByType,
    aiProvider,
    bananaImageRoute,
    imageSize,
    imageModel,
    runNode,
    onSendHandler,
    promptGroupName,
    updateGroupName,
    changeGroupColor,
    dissolveGroups,
    runGroupNodes,
    runningGroupIds,
    seedance2AccessEnabled,
    seedance2AccessResolved,
    toggleGroupCollapsed,
    groupPreviewImagesByGroupId,
    isFlowBlackTheme,
  ]);
  const nodesWithHandlers = React.useMemo(
    () => {
      const prevCache = nodeWithHandlersCacheRef.current;
      const nextCache = new Map<string, { source: RFNode; enhanced: RFNode }>();

      const rendered = nodes.map((n) => {
        const cacheKey = String(n.id);
        const cached = prevCache.get(cacheKey);
        if (cached && cached.source === (n as RFNode)) {
          nextCache.set(cacheKey, cached);
          return cached.enhanced;
        }

        const resolvedType = typeof n.type === "string" ? normalizeFlowNodeType(n.type) : null;
        const managedRuntime =
          resolvedType ? managedRuntimeByType.get(resolvedType) : undefined;
        const mapFallbackCredits =
          resolvedType && typeof NODE_CREDITS_MAP[resolvedType] === "number"
            ? Number(NODE_CREDITS_MAP[resolvedType])
            : undefined;
        const runtimeNodeData = {
          ...(n.data || {}),
          ...(managedRuntime?.nodeConfigKey &&
          (typeof n.data?.nodeConfigKey !== "string" || !n.data.nodeConfigKey.trim())
            ? { nodeConfigKey: managedRuntime.nodeConfigKey }
            : {}),
          ...(managedRuntime?.managedModelKey &&
          (typeof n.data?.managedModelKey !== "string" || !n.data.managedModelKey.trim())
            ? { managedModelKey: managedRuntime.managedModelKey }
            : {}),
          ...(managedRuntime?.vendorKey &&
          (typeof n.data?.vendorKey !== "string" || !n.data.vendorKey.trim())
            ? { vendorKey: managedRuntime.vendorKey }
            : {}),
          ...(managedRuntime?.platformKey &&
          (typeof n.data?.platformKey !== "string" || !n.data.platformKey.trim())
            ? { platformKey: managedRuntime.platformKey }
            : {}),
          ...(managedRuntime?.nodeConfigMetadata &&
          (!n.data?.nodeConfigMetadata || typeof n.data.nodeConfigMetadata !== "object")
            ? { nodeConfigMetadata: managedRuntime.nodeConfigMetadata }
            : {}),
        } as Record<string, any>;
        const defaultCreditsPerCall =
          (typeof runtimeNodeData.creditsPerCall === "number"
            ? runtimeNodeData.creditsPerCall
            : undefined) ??
          (resolvedType ? nodeCreditsByType.get(resolvedType) : undefined) ??
          mapFallbackCredits;
        const creditsPerCall = resolveStableRouteCredits({
          nodeType: typeof n.type === "string" ? n.type : resolvedType || undefined,
          nodeData: runtimeNodeData,
          fallbackCredits: defaultCreditsPerCall,
          aiProvider,
          bananaImageRoute,
          globalImageSize: imageSize || null,
          globalImageModel: imageModel || null,
        });
        let enhancedNode: RFNode;
        if (n.type === FLOW_GROUP_NODE_TYPE) {
          enhancedNode = {
            ...n,
            data: {
              ...runtimeNodeData,
              isDarkTheme: isFlowBlackTheme,
              onRenameGroup: promptGroupName,
              onUpdateGroupName: updateGroupName,
              onChangeGroupColor: changeGroupColor,
              onUngroup: (groupId: string) => dissolveGroups([groupId]),
              onRunGroup: runGroupNodes,
              groupRunning: runningGroupIds.includes(n.id),
              onToggleCollapse: toggleGroupCollapsed,
              groupCollapsed: isGroupCollapsed(n as RFNode),
              groupChildCount: getGroupChildIds(n as RFNode).length,
              groupPreviewImages: groupPreviewImagesByGroupId.get(String(n.id)) || [],
            },
          } as RFNode;
        } else if (
          n.type === "generate" ||
          n.type === "generate4" ||
          n.type === "generateRef" ||
          n.type === "viewAngle" ||
          n.type === "generatePro" ||
          n.type === "generatePro4" ||
          n.type === "analysis" ||
          n.type === "midjourney" ||
          n.type === "midjourneyV7" ||
          n.type === "niji7" ||
          n.type === "nano2" ||
          n.type === "gptImage2" ||
          n.type === "textChat" ||
          n.type === "promptOptimize" ||
          n.type === "seedream5" ||
          n.type === "minimaxSpeech" ||
          n.type === "tencentSpeech" ||
          n.type === "minimaxMusic" ||
          n.type === "image" ||
          n.type === "imagePro"
        ) {
          enhancedNode = {
            ...n,
            data: {
              ...runtimeNodeData,
              onRun: runNode,
              onSend: onSendHandler,
              creditsPerCall,
            },
          } as RFNode;
        } else if (
          n.type === "sora2Video" ||
          n.type === "sora2Character" ||
          n.type === "wan26" ||
          n.type === "wan2R2V" ||
          n.type === "happyhorseR2V" ||
          n.type === "wan27Video" ||
          n.type === "klingVideo" ||
          n.type === "kling26Video" ||
          n.type === "kling30Video" ||
          n.type === "klingO1Video" ||
          n.type === "viduVideo" ||
          n.type === "viduQ3" ||
          n.type === "doubaoVideo" ||
          n.type === "seedance20Video"
        ) {
          enhancedNode = {
            ...n,
            data: {
              ...runtimeNodeData,
              onRun: runNode,
              creditsPerCall,
              seedance2AccessEnabled,
              seedance2AccessResolved,
            },
          } as RFNode;
        } else {
          enhancedNode = n as RFNode;
        }

        nextCache.set(cacheKey, {
          source: n as RFNode,
          enhanced: enhancedNode,
        });
        return enhancedNode;
      });

      nodeWithHandlersCacheRef.current = nextCache;
      return rendered;
    },
    [
      nodes,
      nodeCreditsByType,
      managedRuntimeByType,
      aiProvider,
      bananaImageRoute,
      imageSize,
      imageModel,
      runNode,
      onSendHandler,
      promptGroupName,
      updateGroupName,
      changeGroupColor,
      dissolveGroups,
      runGroupNodes,
      runningGroupIds,
      seedance2AccessEnabled,
      seedance2AccessResolved,
      toggleGroupCollapsed,
      groupPreviewImagesByGroupId,
      isFlowBlackTheme,
    ]
  );

  const nodesForRender = React.useMemo(
    () =>
      nodesWithHandlers.map((node) => {
        if (!collapsedChildNodeIds.has(node.id)) return node;
        return {
          ...node,
          hidden: true,
          selected: false,
          draggable: false,
          selectable: false,
        };
      }),
    [nodesWithHandlers, collapsedChildNodeIds]
  );

  const edgesForRender = React.useMemo(
    () => {
      if (effectiveFlowLowDetailMode) return [];
      const mapped: Edge[] = [];
      edges.forEach((edge) => {
        const sourceGroupId = collapsedChildToGroupId.get(edge.source);
        const targetGroupId = collapsedChildToGroupId.get(edge.target);
        const edgeStrokeColor = resolveEdgeStrokeColor(
          edgeColorMode,
          edge.sourceHandle,
          edge.targetHandle
        );
        const edgeStyle = {
          ...(edge.style || {}),
          stroke: edgeStrokeColor,
        };
        const baseData =
          edge.data && typeof edge.data === "object"
            ? (edge.data as Record<string, unknown>)
            : {};

        if (!sourceGroupId && !targetGroupId) {
          mapped.push({
            ...edge,
            style: edgeStyle,
            hidden: false,
            data: {
              ...baseData,
              collapsedProxy: false,
              originalEdgeId: edge.id,
              sourceGroupId: undefined,
              targetGroupId: undefined,
            },
          });
          return;
        }

        if (sourceGroupId && targetGroupId && sourceGroupId === targetGroupId) {
          mapped.push({
            ...edge,
            style: edgeStyle,
            hidden: true,
            selected: false,
            data: {
              ...baseData,
              collapsedProxy: true,
              collapsedInternal: true,
              originalEdgeId: edge.id,
              sourceGroupId,
              targetGroupId,
            },
          });
          return;
        }

        mapped.push({
          ...edge,
          style: edgeStyle,
          hidden: false,
          source: sourceGroupId || edge.source,
          target: targetGroupId || edge.target,
          sourceHandle: sourceGroupId
            ? "group-proxy-source"
            : edge.sourceHandle,
          targetHandle: targetGroupId
            ? "group-proxy-target"
            : edge.targetHandle,
          selected: false,
          data: {
            ...baseData,
            collapsedProxy: true,
            originalEdgeId: edge.id,
            sourceGroupId,
            targetGroupId,
          },
        });
      });
      return mapped;
    },
    [edges, collapsedChildToGroupId, edgeColorMode, effectiveFlowLowDetailMode]
  );
  const edgesForInteraction = React.useMemo(
    () => edgesForRender,
    [edgesForRender]
  );

  // 简单的全局调试API，便于从控制台添加节点
  React.useEffect(() => {
    (window as any).tanvaFlow = {
      addTextPrompt: (x = 0, y = 0, text = "") => {
        const id = `tp_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "textPrompt",
              position: { x, y },
              data: { text, title: "Prompt" },
            },
          ] as any)
        );
        return id;
      },
      addTextNote: (x = 0, y = 0, text = "") => {
        const id = `tn_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "textNote", position: { x, y }, data: { text } },
          ] as any)
        );
        return id;
      },
      addImage: (x = 0, y = 0, imageData?: string) => {
        const id = `img_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "image", position: { x, y }, data: { imageData } },
          ] as any)
        );
        return id;
      },
      addThree: (x = 0, y = 0) => {
        const id = `three_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "three", position: { x, y }, data: {} },
          ] as any)
        );
        return id;
      },
      addThreeFromScreen: (
        screenX = window.innerWidth / 2,
        screenY = window.innerHeight / 2,
        dataPatch?: Record<string, any>
      ) => {
        const id = `three_${Date.now()}`;
        const position = rf.screenToFlowPosition({
          x: screenX,
          y: screenY,
        });
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "three",
              position,
              data:
                dataPatch && Object.keys(dataPatch).length > 0
                  ? { ...dataPatch }
                  : {},
            },
          ] as any)
        );
        return id;
      },
      addCamera: (x = 0, y = 0) => {
        const id = `camera_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "camera", position: { x, y }, data: {} },
          ] as any)
        );
        return id;
      },
      addGenerate: (x = 0, y = 0) => {
        const id = `gen_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "generate",
              position: { x, y },
              data: { status: "idle", presetPrompt: "" },
            },
          ] as any)
        );
        return id;
      },
      addGenerate4: (x = 0, y = 0) => {
        const id = `gen4_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "generate4",
              position: { x, y },
              data: { status: "idle", images: [] },
            },
          ] as any)
        );
        return id;
      },
      connect: (
        source: string,
        target: string,
        targetHandle:
          | "text"
          | "img"
          | "image1"
          | "image2"
          | "refer"
          | "text-top-in"
          | "text-bottom-in"
          | "text-left-in"
          | "text-right-in"
      ) => {
        const conn = { source, target, targetHandle } as any;
        if (
          isValidConnection(conn as any) &&
          canAcceptConnection(conn as any)
        ) {
          setEdges((eds) => addEdge(conn, eds));
          return true;
        }
        return false;
      },
      // 暴露 React Flow 实例，用于框选工具选择节点
      selectNodesInBox: (screenRect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => {
        try {
          const allNodes = rf.getNodes();
          const selectedNodeIds: string[] = [];

          // 获取 Flow 容器的位置
          const container = containerRef.current;
          if (!container) return [];

          // 将屏幕坐标转换为相对于 Flow 容器的坐标
          const containerRect = container.getBoundingClientRect();
          const relativeX = screenRect.x - containerRect.left;
          const relativeY = screenRect.y - containerRect.top;

          // 将屏幕坐标的选择框转换为 Flow 坐标
          const topLeft = rf.screenToFlowPosition({
            x: relativeX,
            y: relativeY,
          });
          const bottomRight = rf.screenToFlowPosition({
            x: relativeX + screenRect.width,
            y: relativeY + screenRect.height,
          });

          // 确保坐标顺序正确
          const minX = Math.min(topLeft.x, bottomRight.x);
          const maxX = Math.max(topLeft.x, bottomRight.x);
          const minY = Math.min(topLeft.y, bottomRight.y);
          const maxY = Math.max(topLeft.y, bottomRight.y);

          // 检查每个节点是否在选择框内
          for (const node of allNodes) {
            const nodeX = node.position?.x ?? 0;
            const nodeY = node.position?.y ?? 0;

            // 获取节点的实际大小
            const nodeWidth = node.data?.boxW ?? node.width ?? 150;
            const nodeHeight = node.data?.boxH ?? node.height ?? 100;

            // 计算节点的边界
            const nodeLeft = nodeX;
            const nodeRight = nodeX + nodeWidth;
            const nodeTop = nodeY;
            const nodeBottom = nodeY + nodeHeight;

            // 检查节点是否与选择框相交
            const isIntersecting =
              nodeLeft < maxX &&
              nodeRight > minX &&
              nodeTop < maxY &&
              nodeBottom > minY;

            if (isIntersecting) {
              selectedNodeIds.push(node.id);
            }
          }

          // 更新节点选择状态
          if (selectedNodeIds.length > 0) {
            setNodes((prevNodes) =>
              prevNodes.map((node) => ({
                ...node,
                selected: selectedNodeIds.includes(node.id),
              }))
            );
          }

          return selectedNodeIds;
        } catch (error) {
          console.warn("选择节点失败:", error);
          return [];
        }
      },
      // 选择所有节点
      selectAllNodes: () => {
        setNodes((prevNodes) =>
          prevNodes.map((node) => ({ ...node, selected: true }))
        );
      },
      // 取消选择所有节点
      deselectAllNodes: () => {
        setNodes((prevNodes) =>
          prevNodes.map((node) => ({ ...node, selected: false }))
        );
      },
      // 暴露 React Flow 实例
      rf: rf,
    };
    return () => {
      delete (window as any).tanvaFlow;
    };
  }, [setNodes, setEdges, isValidConnection, canAcceptConnection, rf]);

  const addAtCenter = React.useCallback(
    (
      type:
        | "textPrompt"
        | "textPromptPro"
        | "textChat"
        | "textNote"
        | "promptOptimize"
        | "image"
        | "generate"
        | "generatePro"
        | "generate4"
        | "generateRef"
        | "analysis"
    ) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const centerScreen = {
        x: (rect?.width || window.innerWidth) / 2,
        y: (rect?.height || window.innerHeight) / 2,
      };
      const center = rf.screenToFlowPosition(centerScreen);
      const id = `${type}_${Date.now()}`;
      const base: any = {
        id,
        type,
        position: center,
        data:
          type === "textPrompt"
            ? { text: "", title: "Prompt" }
            : type === "textPromptPro"
            ? { prompts: [""], text: "", textMode: "raw" }
            : type === "textNote"
            ? { text: "" }
            : type === "textChat"
            ? {
                title: "Text Chat",
                status: "idle" as const,
                manualInput: "",
                responseText: "",
                enableWebSearch: false,
                modelProvider: resolveFlowModelProvider(undefined, aiProvider),
              }
            : type === "promptOptimize"
            ? {
                text: "",
                expandedText: "",
                modelProvider: resolveFlowModelProvider(undefined, aiProvider),
              }
            : type === "generate"
            ? {
                status: "idle",
                presetPrompt: "",
                modelProvider: resolveFlowModelProvider(undefined, aiProvider),
              }
            : type === "generatePro"
            ? {
                status: "idle",
                prompts: [""],
                title: "Agent",
                enableWebSearch: false,
                modelProvider: resolveFlowModelProvider(undefined, aiProvider),
              }
            : type === "generate4"
            ? { status: "idle", images: [] }
            : type === "generateRef"
            ? { status: "idle", referencePrompt: undefined }
            : type === "analysis"
            ? {
                status: "idle",
                prompt: "",
                analysisPrompt: undefined,
                analysisProvider: "banana-2.5" as const,
              }
            : { imageData: undefined },
      };
      setNodes((ns) => ns.concat([base]));
      try {
        historyService.commit("flow-add-at-center").catch(() => {});
      } catch {}
      return id;
    },
    [aiProvider, rf, setNodes]
  );

  const showFlowPanel = useUIStore((s) => s.showFlowPanel);
  const flowUIEnabled = useUIStore((s) => s.flowUIEnabled);

  const selectedNonGroupNodeCount = React.useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.selected &&
          !isGroupNode(node as RFNode) &&
          !collapsedChildNodeIds.has(node.id)
      ).length,
    [nodes, collapsedChildNodeIds]
  );
  const selectedGroupIds = React.useMemo(
    () => getSelectedGroupIds(nodes as RFNode[]),
    [nodes, getSelectedGroupIds]
  );
  const canCreateGroup = selectedNonGroupNodeCount >= 2;
  const canDissolveGroup = selectedGroupIds.length > 0;

  const FlowToolbar =
    flowUIEnabled && showFlowPanel ? (
      <div
        className='tanva-flow-toolbar'
        style={{
          position: "absolute",
          top: 56,
          right: 16,
          zIndex: 10,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 8,
        }}
      >
        <button
          onClick={() => addAtCenter("textPrompt")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          文字
        </button>
        <button
          onClick={() => addAtCenter("textNote")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          文本卡片
        </button>
        <button
          onClick={() => addAtCenter("textChat")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          文字交互
        </button>
        <button
          onClick={() => addAtCenter("promptOptimize")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          优化
        </button>
        <button
          onClick={() => addAtCenter("analysis")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          分析
        </button>
        <button
          onClick={() => addAtCenter("image")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          图片
        </button>
        <button
          onClick={() => addAtCenter("generate")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "#fff",
          }}
        >
          生成
        </button>
        <button
          onClick={() => addAtCenter("generateRef")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "#fff",
          }}
        >
          参考生成
        </button>
        <button
          onClick={() => addAtCenter("generate4")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "#fff",
          }}
        >
          Multi Generate
        </button>
        <div
          style={{
            width: 1,
            height: 20,
            background: "#e5e7eb",
            margin: "0 4px",
          }}
        />
        <button
          onClick={() => createGroupFromSelection()}
          disabled={!canCreateGroup}
          title='打组 (G)'
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: canCreateGroup ? "#fff" : "#f3f4f6",
            color: canCreateGroup ? "#111827" : "#9ca3af",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: canCreateGroup ? "pointer" : "not-allowed",
          }}
        >
          <Group size={14} />
          打组
        </button>
        <button
          onClick={() => dissolveGroups(selectedGroupIds)}
          disabled={!canDissolveGroup}
          title='解组 (Shift + G)'
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: canDissolveGroup ? "#fff" : "#f3f4f6",
            color: canDissolveGroup ? "#111827" : "#9ca3af",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: canDissolveGroup ? "pointer" : "not-allowed",
          }}
        >
          <Ungroup size={14} />
          解组
        </button>
        <div
          style={{
            width: 1,
            height: 20,
            background: "#e5e7eb",
            margin: "0 4px",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          <input
            type='checkbox'
            checked={backgroundEnabled}
            onChange={(e) => setBackgroundEnabled(e.target.checked)}
          />{" "}
          Flow背景
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
          title='开启后视窗外节点会卸载以节省性能，但拖回视窗时会有重新渲染/加载感'
        >
          <input
            type='checkbox'
            checked={effectiveOnlyRenderVisibleElements}
            onChange={(e) => setOnlyRenderVisibleElements(e.target.checked)}
            disabled={isLargeGraphForVisibleRendering}
          />{" "}
          {isLargeGraphForVisibleRendering
            ? "仅渲染可见(性能, 自动)"
            : "仅渲染可见(性能)"}
        </label>
        {isLargeGraphForSnapAlignment && (
          <span style={{ fontSize: 12, color: "#b45309" }}>
            大图模式已自动关闭吸附对齐
          </span>
        )}
        {isLargeGraphForMiniMapImageOverlay && (
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            大图模式已自动关闭 MiniMap 图片层
          </span>
        )}
        {effectiveFlowLowDetailMode && (
          <span style={{ fontSize: 12, color: "#4b5563" }}>
            低缩放已隐藏连线与 MiniMap（节点 UI 保留）
          </span>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
          title='显示拖拽/缩放交互的估算帧率（节点拖拽、图片拖拽/缩放；每 250ms 刷新一次）'
        >
          <input
            type='checkbox'
            checked={showFpsOverlay}
            onChange={(e) => setShowFpsOverlay(e.target.checked)}
          />{" "}
          FPS
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          连线色
          <select
            value={edgeColorMode}
            onChange={(e) => setEdgeColorMode(e.target.value as FlowEdgeColorMode)}
            style={{
              fontSize: 12,
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "4px 6px",
              background: "#fff",
            }}
          >
            <option value={FlowEdgeColorMode.STANDARD}>标准色</option>
            <option value={FlowEdgeColorMode.HANDLE}>跟随句柄</option>
          </select>
        </label>
        {backgroundEnabled && (
          <>
            <select
              value={backgroundVariant}
              onChange={(e) =>
                setBackgroundVariant(e.target.value as FlowBackgroundVariant)
              }
              style={{
                fontSize: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: "4px 6px",
                background: "#fff",
              }}
            >
              <option value={FlowBackgroundVariant.DOTS}>点阵</option>
              <option value={FlowBackgroundVariant.LINES}>网格线</option>
              <option value={FlowBackgroundVariant.CROSS}>十字网格</option>
            </select>
            <input
              type='color'
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              title='背景颜色'
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: "none",
                background: "transparent",
              }}
            />
            <label style={{ fontSize: 12 }}>
              间距
              <input
                type='number'
                inputMode='numeric'
                min={4}
                max={100}
                value={bgGapInput}
                onChange={(e) => setBgGapInput(e.target.value)}
                onBlur={(e) => commitGap(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    commitGap((e.target as HTMLInputElement).value);
                }}
                style={{
                  width: 56,
                  marginLeft: 4,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              尺寸
              <input
                type='number'
                inputMode='numeric'
                min={0.5}
                max={10}
                step={0.5}
                value={bgSizeInput}
                onChange={(e) => setBgSizeInput(e.target.value)}
                onBlur={(e) => commitSize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    commitSize((e.target as HTMLInputElement).value);
                }}
                style={{
                  width: 44,
                  marginLeft: 4,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              透明度
              <input
                type='range'
                min={0}
                max={1}
                step={0.1}
                value={backgroundOpacity}
                onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                style={{ width: 60, marginLeft: 4 }}
              />
            </label>
          </>
        )}
      </div>
    ) : null;

  const connectQuickMenuStyle = React.useMemo(() => {
    if (!connectQuickMenu.visible) {
      return { display: "none" } as React.CSSProperties;
    }
    const viewportWidth =
      typeof window !== "undefined" ? window.innerWidth : 1280;
    const viewportHeight =
      typeof window !== "undefined" ? window.innerHeight : 720;
    const menuWidth = 260;
    const menuEstimatedHeight = 48 + Math.max(1, connectQuickMenu.options.length) * 44;
    const maxLeft = Math.max(12, viewportWidth - menuWidth - 12);
    const maxTop = Math.max(12, viewportHeight - menuEstimatedHeight - 12);
    const alignedLeft =
      connectQuickMenu.alignEdge === "right"
        ? connectQuickMenu.screen.x - menuWidth
        : connectQuickMenu.screen.x;
    const left = Math.min(maxLeft, Math.max(12, alignedLeft));
    const top = Math.min(
      maxTop,
      Math.max(12, connectQuickMenu.screen.y - menuEstimatedHeight / 2)
    );
    return {
      position: "fixed",
      left,
      top,
      width: menuWidth,
      zIndex: 130,
      pointerEvents: "auto",
    } as React.CSSProperties;
  }, [
    connectQuickMenu.alignEdge,
    connectQuickMenu.visible,
    connectQuickMenu.options.length,
    connectQuickMenu.screen.x,
    connectQuickMenu.screen.y,
  ]);

  // 计算添加面板的容器内定位
  const addPanelStyle = React.useMemo(() => {
    if (!addPanel.visible) return { display: "none" } as React.CSSProperties;
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect ? addPanel.screen.x - rect.left : addPanel.screen.x;
    const top = rect ? addPanel.screen.y - rect.top : addPanel.screen.y;
    return {
      position: "absolute",
      left: `${left}px`,
      top: `${top}px`,
      transform: "translate(-50%, -50%)",
      zIndex: 100,
    } as React.CSSProperties;
  }, [addPanel.visible, addPanel.screen.x, addPanel.screen.y]);

  const handleContainerDoubleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isBlankArea(e.clientX, e.clientY)) {
        const world = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        openAddPanelAtContainerCenter({
          tab: "nodes",
          allowedTabs: ["nodes", "beta", "custom"],
          world,
        });
      }
    },
    [openAddPanelAtContainerCenter, isBlankArea, rf]
  );

  const commitEdgeLabelValue = React.useCallback(
    (edgeId: string, value: string) => {
      const trimmed = value.trim();
      let changed = false;
      setEdges((prev) =>
        prev.map((edge) => {
          if (edge.id !== edgeId) return edge;
          const prevValue = typeof edge.label === "string" ? edge.label : "";
          if (prevValue === trimmed) return edge;
          changed = true;
          if (trimmed) {
            return { ...edge, label: trimmed };
          }
          const next = { ...edge };
          delete (next as any).label;
          return next;
        })
      );
      if (changed) {
        try {
          historyService.commit("flow-edge-label").catch(() => {});
        } catch {}
      }
    },
    [setEdges]
  );

  const finalizeEdgeLabelEditor = React.useCallback(
    (commit: boolean) => {
      setEdgeLabelEditor((prev) => {
        if (commit && prev.edgeId) {
          commitEdgeLabelValue(prev.edgeId, prev.value);
        }
        return createEdgeLabelEditorState();
      });
    },
    [commitEdgeLabelValue]
  );

  const handleEdgeLabelChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setEdgeLabelEditor((prev) => ({ ...prev, value }));
    },
    []
  );

  const handleEdgeLabelKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finalizeEdgeLabelEditor(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finalizeEdgeLabelEditor(false);
      }
    },
    [finalizeEdgeLabelEditor]
  );

  const handleEdgeLabelBlur = React.useCallback(() => {
    finalizeEdgeLabelEditor(true);
  }, [finalizeEdgeLabelEditor]);

  const handleEdgeDoubleClick = React.useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      event.stopPropagation();

      const containerRect = containerRef.current?.getBoundingClientRect();
      const targetElement = event.target as HTMLElement | null;
      const targetRect = targetElement?.getBoundingClientRect?.();
      const globalX = targetRect
        ? targetRect.left + targetRect.width / 2
        : event.clientX;
      const globalY = targetRect
        ? targetRect.top + targetRect.height / 2
        : event.clientY;
      let localX = containerRect ? globalX - containerRect.left : globalX;
      let localY = containerRect ? globalY - containerRect.top : globalY;
      if (containerRect) {
        const margin = 16;
        localX = Math.min(
          Math.max(margin, localX),
          containerRect.width - margin
        );
        localY = Math.min(
          Math.max(margin, localY),
          containerRect.height - margin
        );
      }

      const allEdges = (rf.getEdges?.() || edges) as Edge[];
      const currentEdge = allEdges.find((e) => e.id === edge.id);
      const existingValue =
        typeof currentEdge?.label === "string" ? currentEdge.label : "";

      setEdgeLabelEditor((prev) => {
        if (prev.visible && prev.edgeId && prev.edgeId !== edge.id) {
          commitEdgeLabelValue(prev.edgeId, prev.value);
        }
        return {
          visible: true,
          edgeId: edge.id,
          value: existingValue,
          position: { x: localX, y: localY },
        };
      });

      try {
        const selection = window.getSelection?.();
        selection?.removeAllRanges?.();
      } catch {}
    },
    [rf, edges, commitEdgeLabelValue]
  );

  const handleEdgeClick = React.useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      event.stopPropagation();
      const edgeId = edge.id;
      setNodes((prev: any[]) =>
        prev.map((node) => (node.selected ? { ...node, selected: false } : node))
      );
      setEdges((prev: any[]) =>
        prev.map((e) => ({ ...e, selected: e.id === edgeId }))
      );
    },
    [setEdges, setNodes]
  );

  const deleteSelectedEdges = React.useCallback(() => {
    const selectedEdgeIds = new Set(
      (rf.getEdges?.() || [])
        .filter((edge: any) => edge?.selected)
        .map((edge: any) => edge.id)
        .filter(Boolean)
    );
    if (!selectedEdgeIds.size) return false;

    setEdges((prev: any[]) => prev.filter((e: any) => !selectedEdgeIds.has(e.id)));
    setEdgeLabelEditor((prev) =>
      prev.edgeId && selectedEdgeIds.has(prev.edgeId)
        ? createEdgeLabelEditorState()
        : prev
    );
    try {
      historyService.commit("flow-delete-edge").catch(() => {});
    } catch {}
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("flow:edgesChange"));
    }, 0);
    return true;
  }, [rf, setEdges]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;

      const active = document.activeElement as HTMLElement | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        (tagName === "input" ||
          tagName === "textarea" ||
          (active as any).isContentEditable);
      if (isEditable) return;

      if (deleteSelectedEdges()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [deleteSelectedEdges]);

  // -------- 模板：实例化与保存 --------
  const instantiateTemplateAt = React.useCallback(
    async (tpl: FlowTemplate, world: { x: number; y: number }) => {
      if (!tpl?.nodes?.length) return;
      const minX = Math.min(...tpl.nodes.map((n) => n.position?.x || 0));
      const minY = Math.min(...tpl.nodes.map((n) => n.position?.y || 0));
      const idMap = new Map<string, string>();
      tpl.nodes.forEach((n) => {
        const newId = generateId(n.type || "n");
        idMap.set(n.id, newId);
      });
      const legacyChildrenByGroupOldId = new Map<string, string[]>();
      tpl.nodes.forEach((n: any) => {
        const parentId =
          typeof n?.parentNode === "string" ? n.parentNode.trim() : "";
        if (!parentId) return;
        const list = legacyChildrenByGroupOldId.get(parentId) || [];
        list.push(String(n.id));
        legacyChildrenByGroupOldId.set(parentId, list);
      });
      const newNodes = tpl.nodes.map((n) => {
        const newId = idMap.get(n.id) || generateId(n.type || "n");
        const data: any = { ...(n.data || {}) };
        delete data.onRun;
        delete data.onSend;
        delete data.status;
        delete data.error;
        if ((n as any).type === FLOW_GROUP_NODE_TYPE) {
          const explicitChildren = Array.isArray(data.childNodeIds)
            ? data.childNodeIds.map((childId: string) => idMap.get(childId) || null)
            : [];
          const legacyChildren = (
            legacyChildrenByGroupOldId.get(String(n.id)) || []
          ).map((childOldId: string) => idMap.get(childOldId) || null);
          data.childNodeIds = Array.from(
            new Set([...explicitChildren, ...legacyChildren].filter(Boolean))
          );
        }
        return {
          id: newId,
          type: n.type as any,
          position: {
            x: world.x + (n.position.x - minX),
            y: world.y + (n.position.y - minY),
          },
          data,
          width: (n as any).width,
          height: (n as any).height,
          style: (n as any).style ? { ...(n as any).style } : undefined,
          parentNode: undefined,
          extent: undefined,
          selectable: true,
          draggable: true,
        } as any;
      });
      const newEdges = (tpl.edges || []).map((e) => ({
        id: generateId("e"),
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        sourceHandle: normalizeFlowSourceHandle((e as any).sourceHandle),
        targetHandle: normalizeFlowTargetHandle((e as any).targetHandle),
        type: e.type || "default",
        label: e.label,
      })) as any[];
      setNodes((ns) => ns.concat(newNodes));
      setEdges((es) => es.concat(newEdges));
      setAddPanel((v) => ({ ...v, visible: false }));
    },
    [setNodes, setEdges]
  );

  // 监听模板实例化事件（从 TemplateModal 触发）
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        template: FlowTemplate;
      };
      if (!detail?.template?.nodes?.length) {
        console.warn("[FlowOverlay] instantiateTemplate: 模板数据无效", detail);
        return;
      }
      const container = document.querySelector(".react-flow");
      const rect = container?.getBoundingClientRect();
      const centerX = rect ? rect.width / 2 : 400;
      const centerY = rect ? rect.height / 2 : 300;
      const world = rf.screenToFlowPosition({ x: centerX, y: centerY });
      console.log("[FlowOverlay] 收到模板实例化事件，位置:", world);
      instantiateTemplateAt(detail.template, world);
    };
    window.addEventListener("flow:instantiateTemplate", handler as EventListener);
    return () =>
      window.removeEventListener("flow:instantiateTemplate", handler as EventListener);
  }, [rf, instantiateTemplateAt]);

  const saveCurrentAsTemplate = React.useCallback(async () => {
    const allNodes = rf.getNodes();
    const selected = allNodes.filter((n: any) => n.selected);
    const nodesToSave = selected.length ? selected : allNodes;
    if (!nodesToSave.length) return;
    const edgesAll = rf.getEdges();
    const nodeIdSet = new Set(nodesToSave.map((n) => n.id));
    const edgesToSave = edgesAll.filter(
      (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
    );
    const name =
      prompt("模板名称", `模板_${new Date().toLocaleString()}`) ||
      `模板_${Date.now()}`;
    const id = generateId("tpl");
    const minX = Math.min(...nodesToSave.map((n) => n.position.x));
    const minY = Math.min(...nodesToSave.map((n) => n.position.y));
    try {
      const templateNodes = await Promise.all(
        nodesToSave.map(async (n: any) => {
          const raw = { ...(n.data || {}) };
          delete raw.onRun;
          delete raw.onSend;
          const data: any = sanitizeNodeData(raw) || {};
          delete data.status;
          delete data.error;
          delete data.taskId;
          delete data.buttons;
          delete data.lastHistoryId;

          const nodeType = String(n.type || "");

          // ImageSplit：只保留可持久化的原图引用 + 裁切矩形（不保存切片图片数据）
          if (nodeType === "imageSplit") {
            const candidateInput =
              (typeof data.inputImageUrl === "string" &&
              data.inputImageUrl.trim()
                ? data.inputImageUrl
                : undefined) ??
              (typeof data.inputImage === "string" && data.inputImage.trim()
                ? data.inputImage
                : undefined);

            if (candidateInput) {
              data.inputImageUrl = await uploadImageToStableUrl(
                String(candidateInput).trim(),
                `flow_template_${id}_${String(n.id)}_input.png`
              );
              delete data.inputImage;
            }

            const existingRects = Array.isArray(data.splitRects)
              ? data.splitRects
              : [];
            const legacyImages = Array.isArray(data.splitImages)
              ? data.splitImages
              : [];
            if (existingRects.length === 0 && legacyImages.length > 0) {
              const rects = legacyImages
                .map((img: any, idx: number) => ({
                  index:
                    typeof img?.index === "number" && Number.isFinite(img.index)
                      ? img.index
                      : idx,
                  x: Number(img?.x ?? 0),
                  y: Number(img?.y ?? 0),
                  width: Number(img?.width ?? 0),
                  height: Number(img?.height ?? 0),
                }))
                .filter(
                  (r: any) =>
                    Number.isFinite(r.x) &&
                    Number.isFinite(r.y) &&
                    Number.isFinite(r.width) &&
                    Number.isFinite(r.height) &&
                    r.width > 0 &&
                    r.height > 0
                );
              if (rects.length > 0) {
                data.splitRects = rects;
              }
            }
            if (Array.isArray(data.splitImages)) {
              delete data.splitImages;
            }
          }

          // 多图：仅存 imageUrls，避免 base64 过大
          const rawImages: unknown[] = Array.isArray(data.images)
            ? data.images
            : [];
          const rawImageUrls: unknown[] = Array.isArray(data.imageUrls)
            ? data.imageUrls
            : [];
          const rawThumbnails: unknown[] = Array.isArray(data.thumbnails)
            ? data.thumbnails
            : [];
          if (rawImages.length || rawImageUrls.length || rawThumbnails.length) {
            const len = Math.max(
              rawImages.length,
              rawImageUrls.length,
              rawThumbnails.length
            );
            const urls: string[] = [];
            for (let i = 0; i < len; i += 1) {
              const candidate =
                rawImageUrls[i] ?? rawImages[i] ?? rawThumbnails[i];
              const candidateStr =
                typeof candidate === "string" ? candidate.trim() : "";
              if (!candidateStr) {
                const historyUrl =
                  nodeType === "generatePro4"
                    ? getHistoryRemoteUrlForNode(String(n.id), i)
                    : null;
                urls.push(historyUrl || "");
                continue;
              }
              urls.push(
                await uploadImageToStableUrl(
                  candidateStr,
                  `flow_template_${id}_${String(n.id)}_${i + 1}.png`
                )
              );
            }
            data.imageUrls = urls;
            delete data.images;
            delete data.imageData;
            delete data.thumbnails;
            delete data.thumbnail;
          }

          // 单图：仅存 imageUrl，避免 base64 过大
          const candidateSingle =
            (typeof data.imageUrl === "string" && data.imageUrl.trim()
              ? data.imageUrl
              : undefined) ??
            (typeof data.imageData === "string" && data.imageData.trim()
              ? data.imageData
              : undefined) ??
            (typeof data.thumbnail === "string" && data.thumbnail.trim()
              ? data.thumbnail
              : undefined);
          if (candidateSingle) {
            const candidateStr = String(candidateSingle).trim();
            data.imageUrl = await uploadImageToStableUrl(
              candidateStr,
              `flow_template_${id}_${String(n.id)}.png`
            );
            delete data.imageData;
            delete data.thumbnail;
            delete data.thumbnails;
          } else if (
            typeof data.imageData === "string" ||
            typeof data.imageUrl === "string"
          ) {
            delete data.imageData;
            delete data.thumbnail;
            delete data.thumbnails;
          } else {
            const historyUrl = getHistoryRemoteUrlForNode(String(n.id));
            if (historyUrl) data.imageUrl = historyUrl;
          }

          stripLargeInlineBlobsInPlace(data);

          return {
            id: n.id,
            type: n.type || "default",
            position: { x: n.position.x - minX, y: n.position.y - minY },
            data,
            boxW: (n as any).data?.boxW,
            boxH: (n as any).data?.boxH,
            width: (n as any).width,
            height: (n as any).height,
            style: (n as any).style ? { ...(n as any).style } : undefined,
            parentNode: (n as any).parentNode,
            extent: (n as any).extent,
            selectable: (n as any).selectable,
            draggable: (n as any).draggable,
          };
        })
      );

      const tpl: FlowTemplate = {
        schemaVersion: 1,
        id,
        name,
        nodes: templateNodes as any,
        edges: edgesToSave.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: normalizeFlowSourceHandle((e as any).sourceHandle),
          targetHandle: normalizeFlowTargetHandle((e as any).targetHandle),
          type: e.type || "default",
          label: typeof e.label === "string" ? e.label : undefined,
        })) as any,
      };
      await saveUserTemplate(tpl);
      const list = await listUserTemplates();
      setUserTplList(list);
      alert("已保存为模板");
    } catch (error) {
      console.error("保存模板失败", error);
      alert("保存模板失败：图片上传或模板序列化失败，请重试");
    }
  }, [
    getHistoryRemoteUrlForNode,
    isRemoteUrl,
    normalizeStableRemoteUrl,
    rf,
    sanitizeNodeData,
    setUserTplList,
    stripLargeInlineBlobsInPlace,
    uploadImageToStableUrl,
  ]);

  const flowSnapViewport = React.useMemo(() => {
    const fallback = initialViewport || { x: 0, y: 0, zoom: 1 };
    try {
      const viewport = rfRef.current.getViewport?.();
      if (
        viewport &&
        Number.isFinite(Number(viewport.x)) &&
        Number.isFinite(Number(viewport.y)) &&
        Number.isFinite(Number(viewport.zoom)) &&
        Number(viewport.zoom) > 0
      ) {
        return {
          x: Number(viewport.x),
          y: Number(viewport.y),
          zoom: Number(viewport.zoom),
        };
      }
    } catch {}
    return {
      x: Number(fallback.x || 0),
      y: Number(fallback.y || 0),
      zoom: Number(fallback.zoom || 1) || 1,
    };
  }, [initialViewport]);

  return (
    <FlowRenderModeProvider value={flowRenderModeValue}>
      <div
        ref={containerRef}
        className={`tanva-flow-overlay absolute inset-0 ${
          isFlowBlackTheme ? "tanva-flow-theme-mono-dark" : ""
        } ${
          isPointerMode ? "pointer-mode" : ""
        } ${isMarqueeMode ? "marquee-mode" : ""} ${
          effectiveFlowLowDetailMode ? "low-detail-mode" : ""
        }`}
        onDoubleClick={handleContainerDoubleClick}
        onPointerDownCapture={() => clipboardService.setActiveZone("flow")}
      >
        {FlowToolbar}
        <ReactFlow
        nodes={nodesForRender}
        edges={edgesForInteraction}
        onNodesChange={onNodesChangeWithHistory}
        onEdgesChange={onEdgesChangeWithHistory}
        defaultViewport={initialViewport}
        onNodeDragStart={(event, node) => {
          nodeDraggingRef.current = true;
          setIsNodeDragging(true);
          const allNodes = rf.getNodes();
          const selectedNodes = allNodes.filter(
            (n: any) => n.selected || n.id === node.id
          );
          draggingGroupNodeRef.current = selectedNodes.some(
            (n: any) => isGroupNode(n) || Boolean((n as any).parentId)
          );
          // 检测 Alt 键是否按下
          const altPressed = event.altKey;
          if (altPressed) {
            // Alt+拖拽复制时关闭吸附，避免副本与原节点重叠后“回吸”。
            clearFlowSnapState();
            // Alt+拖拽：创建副本并让副本跟随鼠标移动，原节点保持原有连线与位置
            if (selectedNodes.length > 0) {
              const startPositions = new Map<
                string,
                { x: number; y: number }
              >();
              const startAbsPositions = new Map<
                string,
                { x: number; y: number }
              >();
              const idMap = new Map<string, string>();
              const clonedNodes = selectedNodes.map((n: any) => {
                startPositions.set(n.id, { x: n.position.x, y: n.position.y });
                startAbsPositions.set(n.id, {
                  x: (n as any).positionAbsolute?.x ?? n.position.x,
                  y: (n as any).positionAbsolute?.y ?? n.position.y,
                });
                const newId = generateId(n.type || "n");
                idMap.set(n.id, newId);
                const rawData = { ...(n.data || {}) };
                delete rawData.onRun;
                delete rawData.onSend;
                const data = sanitizeNodeData(rawData, {
                  preserveImagePayload: true,
                });
                if (data) {
                  delete data.status;
                  delete data.error;
                }
                return {
                  id: newId,
                  type: n.type || "default",
                  position: { x: n.position.x, y: n.position.y }, // 原位置
                  data,
                  selected: true, // 副本选中，符合“复制后继续操作副本”的直觉
                  width: n.width,
                  height: n.height,
                  style: n.style ? { ...n.style } : undefined,
                };
              });

              // 复制相关的边
              const selectedIds = new Set(selectedNodes.map((n: any) => n.id));
              const relatedEdges = rf
                .getEdges()
                .filter(
                  (edge: any) =>
                    selectedIds.has(edge.source) && selectedIds.has(edge.target)
                );
              const clonedEdges = relatedEdges
                .map((edge: any) => {
                  const source = idMap.get(edge.source);
                  const target = idMap.get(edge.target);
                  if (!source || !target) return null;
                  return {
                    id: generateId("e"),
                    source,
                    target,
                    sourceHandle: normalizeFlowSourceHandle(edge.sourceHandle),
                    targetHandle: normalizeFlowTargetHandle(edge.targetHandle),
                    type: edge.type || "default",
                    label: edge.label,
                  };
                })
                .filter(Boolean);

              // 添加副本到节点列表（拖拽期间通过 onNodesChange 把位移重映射到副本）
              const selectedIdSet = new Set(
                selectedNodes.map((n: any) => n.id)
              );
              setNodes((prev: any[]) =>
                prev
                  .map((n: any) =>
                    selectedIdSet.has(n.id) ? { ...n, selected: false } : n
                  )
                  .concat(clonedNodes)
              );
              if (clonedEdges.length > 0) {
                setEdges((prev: any[]) => [...prev, ...clonedEdges]);
              }

              // 记录已创建副本，用于在 dragStop 时提交历史
              altDragStartRef.current = {
                nodeId: node.id,
                altPressed: true,
                startPositions,
                startAbsPositions,
                idMap,
                cloned: true,
              };
            } else {
              altDragStartRef.current = null;
            }
          } else {
            altDragStartRef.current = null;
            const draggingNodes =
              selectedNodes.length > 0 ? (selectedNodes as RFNode[]) : ([node] as RFNode[]);
            prepareFlowSnapping(draggingNodes, String(node.id));
          }
        }}
        onNodeDragStop={(event, node) => {
          nodeDraggingRef.current = false;
          draggingGroupNodeRef.current = false;
          setIsNodeDragging(false);
          clearFlowSnapState();

          // Alt+拖拽复制：副本已在 dragStart 时创建，这里只需提交历史
          if (
            altDragStartRef.current?.altPressed &&
            altDragStartRef.current.cloned
          ) {
            // 提交历史记录
            try {
              historyService.commit("flow-alt-drag-clone").catch(() => {});
            } catch {}

            // 提交到项目内容
            const ns = rfNodesToTplNodes(nodesRef.current as any);
            const es = rfEdgesToTplEdges(edgesRef.current);
            scheduleCommit(ns, es);

            // 不要立刻清理：ReactFlow 可能会在 dragStop 之后再派发一次 position(dragging:false)，
            // 需要让 onNodesChange 继续把“原节点位移”重映射到副本，避免最终落点回到原节点上。
            const snapshot = altDragStartRef.current;
            window.setTimeout(() => {
              if (altDragStartRef.current === snapshot) {
                altDragStartRef.current = null;
              }
            }, 0);
            syncViewportToCanvasStore();
            return;
          }

          // 清理 Alt 拖拽状态
          altDragStartRef.current = null;

          // 普通拖拽：提交位置变化
          const ns = rfNodesToTplNodes(nodesRef.current as any);
          const es = rfEdgesToTplEdges(edgesRef.current);
          scheduleCommit(ns, es);
          syncViewportToCanvasStore();
        }}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onEdgeClick={handleEdgeClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={false}
        panOnDrag={!isPointerMode}
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        selectionOnDrag={isPointerMode}
        selectNodesOnDrag={!isPointerMode}
        nodesDraggable={true}
        nodesConnectable={!isPointerMode && !effectiveFlowLowDetailMode}
        multiSelectionKeyCode={isPointerMode ? null : ["Meta", "Control"]}
        selectionKeyCode={isPointerMode ? null : null}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements={effectiveOnlyRenderVisibleElements}
      >
        {backgroundEnabled && (
          <Background
            variant={
              backgroundVariant === FlowBackgroundVariant.DOTS
                ? BackgroundVariant.Dots
                : backgroundVariant === FlowBackgroundVariant.LINES
                ? BackgroundVariant.Lines
                : BackgroundVariant.Cross
            }
            gap={backgroundGap}
            size={backgroundSize}
            color={backgroundColor}
            style={{ opacity: backgroundOpacity }}
          />
        )}
        {!effectiveFlowLowDetailMode && (
          <>
            {/* 视口由 Canvas 驱动，禁用 MiniMap 交互避免竞态 */}
            <MiniMap pannable={false} zoomable={false} />
            {/* 将画布上的图片以绿色块显示在 MiniMap 内；大图时关闭该叠加层以减负 */}
            {!isLargeGraphForMiniMapImageOverlay && <MiniMapImageOverlay />}
          </>
        )}
      </ReactFlow>

      {!effectiveFlowLowDetailMode && flowSnapAlignments.length > 0 && (
        <svg className='tanva-flow-snap-guides' aria-hidden='true'>
          {flowSnapAlignments.map((alignment, index) => {
            const zoom = Math.max(0.1, Number(flowSnapViewport.zoom) || 1);
            const offsetX = Number(flowSnapViewport.x) || 0;
            const offsetY = Number(flowSnapViewport.y) || 0;
            /* 节点对齐：线宽为原先一半（原先 0.8/zoom） */
            const strokeWidth = 0.4 / zoom;
            const dashLength = 3.5 / zoom;
            const color =
              isFlowBlackTheme
                ? "#ffffff"
                : alignment.type === "centerX" || alignment.type === "centerY"
                ? FLOW_SNAP_GUIDE_COLORS.center
                : FLOW_SNAP_GUIDE_COLORS.edge;
            if (alignment.orientation === "vertical") {
              const x = alignment.position * zoom + offsetX;
              const y1 = alignment.start * zoom + offsetY;
              const y2 = alignment.end * zoom + offsetY;
              return (
                <line
                  key={`v-${alignment.type}-${Math.round(alignment.position)}-${index}`}
                  x1={x}
                  y1={y1}
                  x2={x}
                  y2={y2}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dashLength} ${dashLength}`}
                />
              );
            }
            const y = alignment.position * zoom + offsetY;
            const x1 = alignment.start * zoom + offsetX;
            const x2 = alignment.end * zoom + offsetX;
            return (
              <line
                key={`h-${alignment.type}-${Math.round(alignment.position)}-${index}`}
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashLength} ${dashLength}`}
              />
            );
          })}
        </svg>
      )}

      <div
        ref={connectQuickMenuRef}
        style={connectQuickMenuStyle}
        data-prevent-add-panel
      >
        {connectQuickMenu.visible && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              boxShadow: "0 20px 40px rgba(15,23,42,0.2)",
              overflow: "hidden",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 12px",
                borderBottom: "1px solid #f1f5f9",
                background: "#f8fafc",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
                {lt("可连接节点", "Connectable Nodes")}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 10,
              }}
            >
              {connectQuickMenu.options.map((item) => {
                const optionKey = getQuickConnectMenuItemKey(item);
                const hovered = connectQuickHoverKey === optionKey;
                return (
                  <button
                    key={optionKey}
                    data-connect-quick-key={optionKey}
                    type='button'
                    onMouseEnter={() => setConnectQuickHoverKey(optionKey)}
                    onMouseLeave={() =>
                      setConnectQuickHoverKey((prev) =>
                        prev === optionKey ? null : prev
                      )
                    }
                    style={{
                      border: hovered ? "1px solid #2563eb" : "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: hovered ? "#eff6ff" : "#fff",
                      color: hovered ? "#1d4ed8" : "#0f172a",
                      fontSize: 13,
                      fontWeight: 500,
                      padding: "9px 10px",
                      textAlign: "left",
                      cursor: "pointer",
                      boxShadow: hovered
                        ? "0 6px 18px rgba(37,99,235,0.16)"
                        : "none",
                      transition: "all 0.12s ease",
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showFpsOverlay && (
        <div
          ref={fpsOverlayRef}
          id='tanva-fps-overlay'
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            pointerEvents: "none",
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 16,
            border: "1px solid rgba(229,231,235,0.9)",
            background: "rgba(255,255,255,0.85)",
            color: "#111827",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        >
          {(fpsMode || "Image") + " FPS"}: {dragFps ? dragFps.toFixed(1) : "--"}{" "}
          | max: {dragMaxFrameMs ? dragMaxFrameMs.toFixed(1) : "--"}ms | long:{" "}
          {dragLongFrames}
        </div>
      )}

      {edgeLabelEditor.visible && (
        <div
          className='tanva-edge-label-editor'
          style={{
            left: edgeLabelEditor.position.x,
            top: edgeLabelEditor.position.y,
          }}
          data-prevent-add-panel
        >
          <input
            ref={edgeLabelInputRef}
            value={edgeLabelEditor.value}
            onChange={handleEdgeLabelChange}
            onKeyDown={handleEdgeLabelKeyDown}
            onBlur={handleEdgeLabelBlur}
            placeholder={lt("输入文本", "Enter text")}
          />
        </div>
      )}

      {/* 添加面板（双击空白处出现） */}
      <div ref={addPanelRef} style={addPanelStyle} className='tanva-add-panel'>
        {addPanel.visible && (
          <div
            style={{
              background: isFlowBlackTheme ? "#111111" : "#fff",
              border: isFlowBlackTheme
                ? "1px solid #404040"
                : "1px solid #e5e7eb",
              borderRadius: 16,
              boxShadow: isFlowBlackTheme
                ? "0 22px 48px rgba(0,0,0,0.55), 0 8px 18px rgba(0,0,0,0.35)"
                : "0 18px 45px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)",
              width: "60vw",
              minWidth: 720,
              maxWidth: 960,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "10px 12px 0",
                borderBottom: "none",
                background: isFlowBlackTheme ? "#161616" : "#f5f7fa",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
              }}
            >
              <div style={{ display: "flex", gap: 2 }}>
                {allowedAddTabs.includes("nodes") && (
                  <button
                    onClick={() => setAddTabWithMemory("nodes", allowedAddTabs)}
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "nodes" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border:
                        addTab === "nodes" && isFlowBlackTheme
                          ? "1px solid #404040"
                          : "none",
                      background:
                        addTab === "nodes"
                          ? isFlowBlackTheme
                            ? "#262626"
                            : "#fff"
                          : "transparent",
                      color:
                        addTab === "nodes"
                          ? isFlowBlackTheme
                            ? "#ffffff"
                            : "#111827"
                          : isFlowBlackTheme
                            ? "#888888"
                            : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    {lt("节点", "Nodes")}
                  </button>
                )}
                {allowedAddTabs.includes("beta") && (
                  <button
                    onClick={() => setAddTabWithMemory("beta", allowedAddTabs)}
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "beta" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border:
                        addTab === "beta" && isFlowBlackTheme
                          ? "1px solid #404040"
                          : "none",
                      background:
                        addTab === "beta"
                          ? isFlowBlackTheme
                            ? "#262626"
                            : "#fff"
                          : "transparent",
                      color:
                        addTab === "beta"
                          ? isFlowBlackTheme
                            ? "#ffffff"
                            : "#111827"
                          : isFlowBlackTheme
                            ? "#888888"
                            : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    {lt("Beta节点", "Beta Nodes")}
                  </button>
                )}
                {allowedAddTabs.includes("custom") && (
                  <button
                    onClick={() =>
                      setAddTabWithMemory("custom", allowedAddTabs)
                    }
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "custom" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border:
                        addTab === "custom" && isFlowBlackTheme
                          ? "1px solid #404040"
                          : "none",
                      background:
                        addTab === "custom"
                          ? isFlowBlackTheme
                            ? "#262626"
                            : "#fff"
                          : "transparent",
                      color:
                        addTab === "custom"
                          ? isFlowBlackTheme
                            ? "#ffffff"
                            : "#111827"
                          : isFlowBlackTheme
                            ? "#888888"
                            : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    {lt("定制化节点", "Custom Nodes")}
                  </button>
                )}
                {allowedAddTabs.includes("templates") && (
                  <>
                    <button
                      onClick={() => {
                        setAddTabWithMemory("templates", allowedAddTabs);
                        setTemplateScope("public");
                      }}
                      style={{
                        padding: "10px 18px 14px",
                        fontSize: 13,
                        fontWeight:
                          addTab === "templates" && templateScope === "public"
                            ? 600
                            : 500,
                        borderRadius: "24px 24px 0 0",
                        border:
                          addTab === "templates" && templateScope === "public"
                            ? isFlowBlackTheme
                              ? "1px solid #404040"
                              : "none"
                            : "none",
                        background:
                          addTab === "templates" && templateScope === "public"
                            ? isFlowBlackTheme
                              ? "#262626"
                              : "#fff"
                            : "transparent",
                        color:
                          addTab === "templates" && templateScope === "public"
                            ? isFlowBlackTheme
                              ? "#ffffff"
                              : "#111827"
                            : isFlowBlackTheme
                              ? "#888888"
                              : "#374151",
                        marginBottom: -2,
                        transition: "all 0.15s ease",
                        cursor: "pointer",
                      }}
                    >
                      {lt("公共模板", "Public Templates")}
                    </button>
                    <button
                      onClick={() => {
                        setAddTabWithMemory("templates", allowedAddTabs);
                        setTemplateScope("mine");
                      }}
                      style={{
                        padding: "10px 18px 14px",
                        fontSize: 13,
                        fontWeight:
                          addTab === "templates" && templateScope === "mine"
                            ? 600
                            : 500,
                        borderRadius: "24px 24px 0 0",
                        border:
                          addTab === "templates" && templateScope === "mine"
                            ? isFlowBlackTheme
                              ? "1px solid #404040"
                              : "none"
                            : "none",
                        background:
                          addTab === "templates" && templateScope === "mine"
                            ? isFlowBlackTheme
                              ? "#262626"
                              : "#fff"
                            : "transparent",
                        color:
                          addTab === "templates" && templateScope === "mine"
                            ? isFlowBlackTheme
                              ? "#ffffff"
                              : "#111827"
                            : isFlowBlackTheme
                              ? "#888888"
                              : "#374151",
                        marginBottom: -2,
                        transition: "all 0.15s ease",
                        cursor: "pointer",
                      }}
                    >
                      {lt("我的模板", "My Templates")}
                    </button>
                  </>
                )}
                {/* 个人库标签已移至独立按钮，此处隐藏 */}
                {false && allowedAddTabs.includes("personal") && (
                  <button
                    onClick={() =>
                      setAddTabWithMemory("personal", allowedAddTabs)
                    }
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "personal" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border: "none",
                      background:
                        addTab === "personal" ? "#fff" : "transparent",
                      color: addTab === "personal" ? "#111827" : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    {lt("AI资产", "AI Assets")}
                  </button>
                )}
              </div>
            </div>
            {addTab === "nodes" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  paddingTop: 8,
                  background: isFlowBlackTheme ? "#161616" : "transparent",
                  borderRadius: isFlowBlackTheme ? 12 : 0,
                  border: isFlowBlackTheme ? "1px solid #2b2b2b" : "none",
                }}
              >
                <div style={{ padding: "0 20px 20px" }}>
                  {groupedNodePaletteConfigs.map((group) => (
                    <section key={group.key} style={nodePaletteSectionStyle}>
                      <div style={nodePaletteSectionHeaderStyle}>
                        <div>
                          <div
                            style={{
                              ...nodePaletteSectionTitleStyle,
                              color: isFlowBlackTheme ? "#ffffff" : "#111827",
                            }}
                          >
                            {group.title}
                          </div>
                          <div
                            style={{
                              ...nodePaletteSectionSubtitleStyle,
                              color: isFlowBlackTheme ? "#888888" : "#6b7280",
                            }}
                          >
                            {group.subtitle}
                          </div>
                        </div>
                        <span
                          style={{
                            ...nodePaletteSectionCountStyle,
                            color: isFlowBlackTheme ? "#ffffff" : "#4b5563",
                            background: isFlowBlackTheme ? "#1d1d1d" : "#f3f4f6",
                            border: isFlowBlackTheme
                              ? "1px solid #404040"
                              : "1px solid #e5e7eb",
                          }}
                        >
                          {group.items.length} {lt("个", "items")}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                          gap: 12,
                        }}
                      >
                        {group.items.map((config) => {
                          const isDisabled =
                            config.status === "maintenance" ||
                            config.status === "coming_soon";
                          const isVipNode = config.nodeKey === "seedance20Video" || (config.metadata as Record<string, any>)?.vipOnly === true;
                          const isVipLocked = !membershipActive && isVipNode;
                          const badge = getStatusBadge(config.status);
                          const rawCaption = buildNodePaletteCaption(config);
                          const caption =
                            !isZh &&
                            typeof rawCaption === "string" &&
                            /[\u3400-\u9fff]/.test(rawCaption)
                              ? `${config.nameEn || "Node"} description`
                              : rawCaption;
                          return (
                            <NodePaletteButton
                              key={config.nodeKey}
                              zh={config.nameZh}
                              en={config.nameEn}
                              caption={caption}
                              badge={badge}
                              status={config.status}
                              credits={resolveNodeConfigCreditsPerCall(config)}
                              disabled={isDisabled || isVipLocked}
                              isDarkTheme={isFlowBlackTheme}
                              showZh={isZh}
                              vipOnly={isVipLocked}
                              onClick={() =>
                                createNodeAtWorldCenter(
                                  resolveFlowNodeTypeFromConfig(config),
                                  { ...addPanel.world },
                                  (((config.metadata ?? {}) as Record<string, any>)
                                    .defaultData as Record<string, any>) || undefined,
                                  config
                                )
                              }
                            />
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            ) : addTab === "beta" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  padding: "12px 18px 18px",
                }}
              >
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}
                  >
                    {lt("Beta 节点", "Beta Nodes")}
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
                    {lt("实验性功能节点", "Experimental feature nodes")}
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: 10,
                  }}
                >
                  {BETA_NODE_ITEMS.map((item) => (
                    <NodePaletteButton
                      key={item.key}
                      zh={item.zh}
                      en={item.en}
                      badge={item.badge}
                      credits={NODE_CREDITS_MAP[item.key]}
                      isDarkTheme={isFlowBlackTheme}
                      showZh={isZh}
                      onClick={() =>
                        createNodeAtWorldCenter(
                          item.key,
                          { ...addPanel.world }
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ) : addTab === "custom" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 40,
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    background: "#f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <svg
                    width='32'
                    height='32'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='#9ca3af'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  >
                    <rect x='3' y='3' width='7' height='7' rx='1' />
                    <rect x='14' y='3' width='7' height='7' rx='1' />
                    <rect x='3' y='14' width='7' height='7' rx='1' />
                    <path d='M17.5 14v7' />
                    <path d='M14 17.5h7' />
                  </svg>
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 8,
                  }}
                >
                  {lt("定制化节点", "Custom Nodes")}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#6b7280",
                    textAlign: "center",
                  }}
                >
                  {lt(
                    "为您量身定制的专属节点，敬请期待",
                    "Tailor-made nodes for your workflow are coming soon"
                  )}
                </div>
              </div>
            ) : addTab === "templates" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  padding: "12px 18px 18px",
                  background: isFlowBlackTheme ? "#161616" : "transparent",
                  borderRadius: isFlowBlackTheme ? 12 : 0,
                  border: isFlowBlackTheme ? "1px solid #2b2b2b" : "none",
                }}
              >
                {templateScope === "public" && tplIndex ? (
                  <div style={{ marginBottom: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        <button
                          onClick={() => setActiveBuiltinCategory("")}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 999,
                            border:
                              "1px solid " +
                              (!activeBuiltinCategory
                                ? isFlowBlackTheme
                                  ? "#404040"
                                  : "#18181b"
                                : isFlowBlackTheme
                                  ? "#2f2f2f"
                                  : "#e5e7eb"),
                            background: !activeBuiltinCategory
                              ? isFlowBlackTheme
                                ? "#262626"
                                : "#18181b"
                              : isFlowBlackTheme
                                ? "#1d1d1d"
                                : "#fff",
                            color: !activeBuiltinCategory
                              ? "#fff"
                              : isFlowBlackTheme
                                ? "#888888"
                                : "#374151",
                            fontSize: 12,
                            fontWeight: !activeBuiltinCategory ? 600 : 500,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            boxShadow: !activeBuiltinCategory
                              ? isFlowBlackTheme
                                ? "0 8px 16px rgba(0, 0, 0, 0.4)"
                                : "0 10px 18px rgba(0, 0, 0, 0.18)"
                              : "none",
                          }}
                        >
                          {lt("全部", "All")}
                        </button>
                        {builtinCategories.map((cat) => {
                          const isActive = activeBuiltinCategory === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() =>
                                setActiveBuiltinCategory((prev) =>
                                  prev === cat ? "" : cat
                                )
                              }
                              style={{
                                padding: "6px 14px",
                                borderRadius: 999,
                                border:
                                  "1px solid " +
                                  (isActive
                                    ? isFlowBlackTheme
                                      ? "#404040"
                                      : "#18181b"
                                    : isFlowBlackTheme
                                      ? "#2f2f2f"
                                      : "#e5e7eb"),
                                background: isActive
                                  ? isFlowBlackTheme
                                    ? "#262626"
                                    : "#18181b"
                                  : isFlowBlackTheme
                                    ? "#1d1d1d"
                                    : "#fff",
                                color: isActive
                                  ? "#fff"
                                  : isFlowBlackTheme
                                    ? "#888888"
                                    : "#374151",
                                fontSize: 12,
                                fontWeight: isActive ? 600 : 500,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                boxShadow: isActive
                                  ? isFlowBlackTheme
                                    ? "0 8px 16px rgba(0, 0, 0, 0.4)"
                                    : "0 10px 18px rgba(0, 0, 0, 0.18)"
                                  : "none",
                              }}
                            >
                              {getTemplateCategoryLabel(cat)}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ width: 1 }} />
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 20,
                      }}
                    >
                      {filteredTplIndex.map((item) => (
                        <SharedTemplateCard
                          key={item.id}
                          item={item as any}
                          onClick={() => {
                            const anchorWorld = { ...addPanel.world };
                            (async () => {
                              const tpl = await loadBuiltInTemplateById(
                                item.id
                              );
                              if (tpl)
                                instantiateTemplateAt(
                                  tpl,
                                  anchorWorld
                                );
                            })();
                          }}
                        />
                      ))}
                      {Array.from({
                        length: getPlaceholderCount(filteredTplIndex.length, {
                          minVisible: 6,
                        }),
                      }).map((_, idx) => (
                        <TemplatePlaceholder
                          key={`builtin-placeholder-${idx}`}
                          label={lt("敬请期待更多模板", "More templates coming soon")}
                          subtitle={lt(
                            "我们正在准备更多创意模板",
                            "We are preparing more creative templates"
                          )}
                          isDarkTheme={isFlowBlackTheme}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {templateScope === "mine" ? (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <button
                        onClick={exportFlow}
                        title='导出当前编排为JSON'
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: isFlowBlackTheme
                            ? "1px solid #404040"
                            : "1px solid #e5e7eb",
                          background: isFlowBlackTheme ? "#1d1d1d" : "#fff",
                          color: isFlowBlackTheme ? "#ffffff" : "#374151",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = isFlowBlackTheme
                            ? "#262626"
                            : "#f9fafb";
                          e.currentTarget.style.borderColor = isFlowBlackTheme
                            ? "#5a5a5a"
                            : "#d1d5db";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isFlowBlackTheme
                            ? "#1d1d1d"
                            : "#fff";
                          e.currentTarget.style.borderColor = isFlowBlackTheme
                            ? "#404040"
                            : "#e5e7eb";
                        }}
                      >
                        <Upload size={14} strokeWidth={2} />
                        {isExporting ? "导出中..." : "导出"}
                      </button>
                      <button
                        onClick={handleImportClick}
                        title='导入JSON并复现编排'
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: isFlowBlackTheme
                            ? "1px solid #404040"
                            : "1px solid #e5e7eb",
                          background: isFlowBlackTheme ? "#1d1d1d" : "#fff",
                          color: isFlowBlackTheme ? "#ffffff" : "#374151",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = isFlowBlackTheme
                            ? "#262626"
                            : "#f9fafb";
                          e.currentTarget.style.borderColor = isFlowBlackTheme
                            ? "#5a5a5a"
                            : "#d1d5db";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isFlowBlackTheme
                            ? "#1d1d1d"
                            : "#fff";
                          e.currentTarget.style.borderColor = isFlowBlackTheme
                            ? "#404040"
                            : "#e5e7eb";
                        }}
                      >
                        <Download size={14} strokeWidth={2} />
                        导入
                      </button>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 20,
                      }}
                    >
                      <AddTemplateCard
                        onAdd={saveCurrentAsTemplate}
                        label={
                          userTplList.length
                            ? "保存当前为新模板"
                            : "创建我的第一个模板"
                        }
                        isDarkTheme={isFlowBlackTheme}
                      />
                      {userTplList.map((item) => {
                        return (
                          <UserTemplateCard
                            key={item.id}
                            item={item}
                            isDarkTheme={isFlowBlackTheme}
                            onInstantiate={async () => {
                              const anchorWorld = { ...addPanel.world };
                              const tpl = await getUserTemplate(item.id);
                              if (tpl)
                                instantiateTemplateAt(
                                  tpl,
                                  anchorWorld
                                );
                            }}
                            onDelete={async () => {
                              if (
                                confirm(
                                  `确定要删除模板 "${item.name}" 吗？此操作无法撤销。`
                                )
                              ) {
                                try {
                                  await deleteUserTemplate(item.id);
                                  const list = await listUserTemplates();
                                  setUserTplList(list);
                                } catch (err) {
                                  console.error("删除模板失败:", err);
                                  alert("删除模板失败");
                                }
                              }
                            }}
                          />
                        );
                      })}
                      {Array.from({
                        length:
                          userTplList.length === 0
                            ? 0
                            : getPlaceholderCount(userTplList.length + 1, {
                                minVisible: 4,
                              }),
                      }).map((_, idx) => (
                        <TemplatePlaceholder
                          key={`user-placeholder-${idx}`}
                          label={lt("敬请期待更多模板", "More templates coming soon")}
                          subtitle={lt(
                            "我们正在准备更多创意模板",
                            "We are preparing more creative templates"
                          )}
                          isDarkTheme={isFlowBlackTheme}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : addTab === "personal" ? (
              <PersonalLibraryPanel />
            ) : null}
          </div>
        )}
        <input
          ref={importInputRef}
          type='file'
          accept='application/json'
          style={{ display: "none" }}
          onChange={(e) => handleImportFiles(e.target.files)}
        />
        </div>
      </div>
    </FlowRenderModeProvider>
  );
}

export default function FlowOverlay() {
  // 若未启用 Flow UI，则让该层不拦截指针事件
  const flowUIEnabled = useUIStore((s) => s.flowUIEnabled);
  const wrapperStyle: React.CSSProperties = flowUIEnabled
    ? { pointerEvents: "auto" }
    : { pointerEvents: "none" };
  return (
    <div style={{ position: "absolute", inset: 0, ...wrapperStyle }}>
      <ReactFlowProvider>
        <FlowInner />
      </ReactFlowProvider>
    </div>
  );
}
