/**
 * AI聊天对话框状态管理
 * 管理对话框显示、输入内容和生成状态
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import paper from "paper";
import { aiImageService } from "@/services/aiImageService";
import { paperSandboxService } from "@/services/paperSandboxService";
import { fetchWithAuth } from "@/services/authFetch";
import {
  generateImageViaAPI,
  editImageViaAPI,
  blendImagesViaAPI,
  analyzeImageViaAPI,
  generateTextResponseViaAPI,
  midjourneyActionViaAPI,
  generateVideoViaAPI,
  generateVideoAsyncAPI,
  querySora2VideoTaskViaAPI,
} from "@/services/aiBackendAPI";
import {
  generateVideoByProvider,
  markVideoTaskSuccess,
  queryVideoTask,
  refundVideoTask,
  type VideoProvider,
} from "@/services/videoProviderAPI";
import { useUIStore } from "@/stores/uiStore";
import { contextManager } from "@/services/contextManager";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { ossUploadService, dataURLToBlob, dataURLToBlobAsync } from "@/services/ossUploadService";
import { imageUploadService } from "@/services/imageUploadService";
import { createSafeStorage } from "@/stores/storageUtils";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { isInsufficientCreditsErrorMessage } from "@/utils/creditsError";
import { createImagePreviewDataUrl } from "@/utils/imagePreview";
import { logger } from "@/utils/logger";
import { createAsyncLimiter, mapWithLimit } from "@/utils/asyncLimit";
import {
  resolveImageToBlob,
  resolveImageToDataUrl,
  isPersistableImageRef,
  normalizeRemoteUrl,
  isLikelyBackendAllowedRemoteUrl,
  requiresManagedImageUpload,
  toRenderableImageSrc,
} from "@/utils/imageSource";
import {
  isBananaRouteProvider,
  isTencentBananaAnalyzeSupported,
  isTencentStableBananaRoute,
} from "@/utils/bananaRouteCapabilities";
import { FLOW_MODEL_PROVIDER_SYNC_EVENT } from "@/utils/flowModelProvider";
import {
  blobToDataUrl as blobToDataUrlLimited,
  canvasToBlob,
  canvasToDataUrl,
  responseToBlob,
} from "@/utils/imageConcurrency";
import {
  STORE_NAMES,
  idbGet,
  idbPut,
  idbEnforceLimit,
  isMigrationDone,
  markMigrationDone,
  isIndexedDBAvailable,
} from "@/services/indexedDBService";
import type { StoredImageAsset } from "@/types/canvas";
import type {
  AIImageResult,
  BananaImageRoute,
  RunningHubGenerateOptions,
  AIProviderOptions,
  SupportedAIProvider,
  MidjourneyMetadata,
  AIError,
  AIImageEditRequest,
} from "@/types/ai";
import type {
  ConversationContext,
  OperationHistory,
  SerializedConversationContext,
  SerializedChatMessage,
} from "@/types/context";

// 本地存储会话的读取工具（用于无项目或早期回退场景）
const LOCAL_SESSIONS_KEY = "tanva_aiChat_sessions";
const LOCAL_ACTIVE_KEY = "tanva_aiChat_activeSessionId";
const IDB_SESSIONS_KEY = "local_sessions";
const AI_CHAT_STORE_NAME = STORE_NAMES.AI_CHAT_SESSIONS;
const AI_CHAT_VIDEO_CACHE_STORE_NAME = STORE_NAMES.AI_CHAT_VIDEO_CACHE;
const AI_CHAT_PREFERENCES_VERSION = 1;
const AI_CHAT_SEEDANCE_MODEL = "seedance-1.5-pro" as const;
const AI_CHAT_VIDEO_DURATION_OPTIONS = [3, 4, 5, 6, 8, 10] as const;

type AIChatVideoDurationSeconds =
  (typeof AI_CHAT_VIDEO_DURATION_OPTIONS)[number];

// 🔥 全局待生成图片计数器（防止连续快速生成时重叠）
let generatingImageCount = 0;

const placeholderLogger = logger.scope("placeholder");

// 限制图片上传并发，避免同时 atob/encode/上传导致内存峰值
const aiChatUploadLimiter = createAsyncLimiter(2);
// 限制 AI 对话图片历史/缩略图处理并发，避免多图同时转码导致瞬时内存峰值
const aiChatHistoryLimiter = createAsyncLimiter(2);

// AI Chat 并行图片生成并发上限（1-10，可通过 env 覆盖）
const MAX_AI_IMAGE_PARALLEL_CONCURRENCY = 10;
const AI_IMAGE_PARALLEL_CONCURRENCY_LIMIT = (() => {
  const raw = String(
    import.meta.env.VITE_AI_IMAGE_PARALLEL_CONCURRENCY ?? ""
  ).trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(MAX_AI_IMAGE_PARALLEL_CONCURRENCY, parsed);
  }
  return MAX_AI_IMAGE_PARALLEL_CONCURRENCY;
})();

// IndexedDB 存储的会话数据结构
interface IDBSessionsData {
  id: string;
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
  updatedAt: number;
}

interface IDBVideoCacheData {
  id: string;
  sessionId: string;
  messageId: string;
  sourceUrl: string;
  blob: Blob;
  contentType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

const videoObjectUrlByAssetId = new Map<string, string>();
const videoObjectUrlByMessageId = new Map<string, string>();

const buildVideoCacheAssetId = (sessionId: string, messageId: string): string =>
  `${sessionId}::${messageId}`;

const resolveSessionIdByMessageId = (messageId: string): string | null => {
  const contexts = contextManager.getAllSessions();
  for (const context of contexts) {
    if (context.messages.some((message) => message.id === messageId)) {
      return context.sessionId;
    }
  }
  return null;
};

const revokeVideoObjectUrlForMessage = (messageId: string): void => {
  const currentUrl = videoObjectUrlByMessageId.get(messageId);
  if (!currentUrl) return;
  videoObjectUrlByMessageId.delete(messageId);
  const keepByOtherMessage = Array.from(videoObjectUrlByMessageId.values()).some(
    (url) => url === currentUrl
  );
  if (keepByOtherMessage) return;

  for (const [assetId, mappedUrl] of videoObjectUrlByAssetId.entries()) {
    if (mappedUrl === currentUrl) {
      videoObjectUrlByAssetId.delete(assetId);
      break;
    }
  }
  try {
    URL.revokeObjectURL(currentUrl);
  } catch {}
};

const revokeAllVideoObjectUrls = (): void => {
  for (const objectUrl of videoObjectUrlByAssetId.values()) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }
  videoObjectUrlByAssetId.clear();
  videoObjectUrlByMessageId.clear();
};

const bindVideoObjectUrlToMessage = (
  assetId: string,
  messageId: string,
  objectUrl: string
): void => {
  revokeVideoObjectUrlForMessage(messageId);

  const previousAssetUrl = videoObjectUrlByAssetId.get(assetId);
  if (previousAssetUrl && previousAssetUrl !== objectUrl) {
    try {
      URL.revokeObjectURL(previousAssetUrl);
    } catch {}
  }

  videoObjectUrlByAssetId.set(assetId, objectUrl);
  videoObjectUrlByMessageId.set(messageId, objectUrl);
};

// 内存优化常量 (P0 修复)
const MAX_MESSAGES_PER_SESSION = 100;
const MAX_IMAGE_BASE64_SIZE = 500 * 1024; // 500KB 以上的 Base64 考虑清理

// 内存优化：清理消息中的大型 Base64 (P0 修复)
const optimizeMessagesMemory = (messages: ChatMessage[]): ChatMessage[] => {
  return messages.map((msg, index) => {
    // 只清理旧消息（保留最近3条以便快速交互）
    const isOldMessage = index < messages.length - 3;
    if (!isOldMessage) return msg;

    const hasRemoteUrl = !!(msg.imageRemoteUrl && msg.imageRemoteUrl.startsWith("http"));
    const hasBlobSource =
      (typeof msg.sourceImageData === "string" && msg.sourceImageData.startsWith("blob:")) ||
      (Array.isArray(msg.sourceImagesData) &&
        msg.sourceImagesData.some(
          (v) => typeof v === "string" && v.startsWith("blob:")
        )) ||
      (typeof msg.thumbnail === "string" && msg.thumbnail.startsWith("blob:"));

    // 只有在有远程URL（可回放）或 blob URL（不可持久化且容易泄漏）时才清理
    if (!hasRemoteUrl && !hasBlobSource) return msg;

    const nextMsg = { ...msg };
    let changed = false;

    // 有远程URL时，直接清理 imageData（完整 base64）
    if (hasRemoteUrl && msg.imageData) {
      nextMsg.imageData = undefined;
      changed = true;
    }

    // 清理 sourceImageData
    if (
      msg.sourceImageData &&
      (hasRemoteUrl || msg.sourceImageData.startsWith("blob:"))
    ) {
      nextMsg.sourceImageData = undefined;
      changed = true;
    }

    // 清理 sourceImagesData 数组
    if (Array.isArray(msg.sourceImagesData) && msg.sourceImagesData.length > 0) {
      if (hasRemoteUrl) {
        nextMsg.sourceImagesData = [];
        changed = true;
      } else {
        const filtered = msg.sourceImagesData.filter(
          (v) => !(typeof v === "string" && v.startsWith("blob:"))
        );
        if (filtered.length !== msg.sourceImagesData.length) {
          nextMsg.sourceImagesData = filtered;
          changed = true;
        }
      }
    }

    // blob thumbnail 无法跨刷新复用，且会占用内存
    if (typeof msg.thumbnail === "string" && msg.thumbnail.startsWith("blob:")) {
      nextMsg.thumbnail = undefined;
      changed = true;
    }

    return changed ? nextMsg : msg;
  });
};

// 从 localStorage 读取（兼容旧数据）
function readSessionsFromLocalStorage(): {
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
} | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (!raw) return null;
    const sessions = JSON.parse(raw) as SerializedConversationContext[];
    const activeSessionId = localStorage.getItem(LOCAL_ACTIVE_KEY) || null;
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    return { sessions, activeSessionId };
  } catch {
    return null;
  }
}

// 从 IndexedDB 读取会话
async function readSessionsFromIDB(): Promise<{
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
} | null> {
  try {
    const data = await idbGet<IDBSessionsData>(
      AI_CHAT_STORE_NAME,
      IDB_SESSIONS_KEY
    );
    if (!data || !Array.isArray(data.sessions) || data.sessions.length === 0) {
      return null;
    }
    return { sessions: data.sessions, activeSessionId: data.activeSessionId };
  } catch {
    return null;
  }
}

// 写入会话到 IndexedDB
async function writeSessionsToIDB(
  sessions: SerializedConversationContext[],
  activeSessionId: string | null
): Promise<void> {
  try {
    const data: IDBSessionsData = {
      id: IDB_SESSIONS_KEY,
      sessions,
      activeSessionId,
      updatedAt: Date.now(),
    };
    await idbPut(AI_CHAT_STORE_NAME, data);
  } catch (err) {
    console.warn("[AIChat] 写入 IndexedDB 失败:", err);
  }
}

// 从 IndexedDB 或 localStorage 加载会话（含迁移逻辑）
async function loadLocalSessions(): Promise<{
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
} | null> {
  // 优先从 IndexedDB 读取
  const idbData = await readSessionsFromIDB();
  if (idbData) {
    return idbData;
  }

  // 检查是否需要从 localStorage 迁移
  if (!isMigrationDone(AI_CHAT_STORE_NAME) && isIndexedDBAvailable()) {
    const legacyData = readSessionsFromLocalStorage();
    if (legacyData && legacyData.sessions.length > 0) {
      console.log(
        `[AIChat] 从 localStorage 迁移 ${legacyData.sessions.length} 个会话`
      );
      await writeSessionsToIDB(legacyData.sessions, legacyData.activeSessionId);
      markMigrationDone(AI_CHAT_STORE_NAME);
      // 清理 localStorage
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LOCAL_SESSIONS_KEY);
        localStorage.removeItem(LOCAL_ACTIVE_KEY);
      }
      return legacyData;
    }
    markMigrationDone(AI_CHAT_STORE_NAME);
  }

  // 兜底：尝试从 localStorage 读取
  return readSessionsFromLocalStorage();
}

export interface ChatMessage {
  id: string;
  type: "user" | "ai" | "error";
  content: string;
  timestamp: Date;
  /**
   * 是否预计会返回图像结果（用于控制 UI 的图像占位符）
   */
  expectsImageOutput?: boolean;
  /**
   * 是否预计会返回视频结果（用于控制 UI 的视频占位符）
   */
  expectsVideoOutput?: boolean;
  imageData?: string;
  imageRemoteUrl?: string;
  thumbnail?: string;
  // 视频相关字段
  videoUrl?: string;
  videoThumbnail?: string;
  videoDuration?: number;
  videoReferencedUrls?: string[];
  videoTaskId?: string | null;
  videoStatus?: string | null;
  videoSourceUrl?: string;
  // 本地视频缓存（IndexedDB）信息：videoLocalUrl 仅运行时有效，不参与持久化
  videoLocalAssetId?: string;
  videoLocalUrl?: string;
  videoMetadata?: Record<string, any>;
  sourceImageData?: string;
  sourceImagesData?: string[];
  webSearchResult?: unknown;
  provider?: AIProviderType;
  metadata?: Record<string, any>;
  // 🔥 每条消息的独立生成状态
  generationStatus?: {
    isGenerating: boolean;
    progress: number;
    error: string | null;
    stage?: string;
  };
  // 🔥 并行生成分组
  groupId?: string; // 所属批量生成组ID
  groupIndex?: number; // 在组内的位置 (0-based)
  groupTotal?: number; // 组内总数量
}


const formatMessageContentForLog = (content: string): string => {
  if (!content) return "";
  const trimmed = content.trim();
  const maxLength = 200;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}...`
    : trimmed;
};

const logChatConversationSnapshot = (messages: ChatMessage[]): void => {
  try {
    const _tail = messages.slice(-8).map((msg) => ({
      id: msg.id,
      type: msg.type,
      provider: msg.provider,
      content: formatMessageContentForLog(msg.content),
      expectsImageOutput: msg.expectsImageOutput,
      stage: msg.generationStatus?.stage,
      hasImage: Boolean(msg.imageData || msg.imageRemoteUrl || msg.thumbnail),
      timestamp: toISOString(msg.timestamp),
    }));
    // 对话快照已记录
  } catch (error) {
    console.warn("⚠️ 无法打印AI对话内容:", error);
  }
};

type MessageOverride = {
  userMessageId: string;
  aiMessageId: string;
};

type ExecuteProcessFlowOptions = {
  override?: MessageOverride;
  selectedTool?: AvailableTool | null;
  parameters?: { prompt: string };
};

export type PreciseEditContext = {
  targetImageId: string;
  targetImageSource: string;
  cropRectNormalized: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  createdAt: number;
};

export interface GenerationStatus {
  isGenerating: boolean;
  progress: number;
  error: string | null;
  stage?: string;
}

export interface ChatSessionSummary {
  sessionId: string;
  name: string;
  lastActivity: Date;
  messageCount: number;
  preview?: string;
}

let hasHydratedSessions = false;
let isHydratingNow = false;
let refreshSessionsTimeout: ReturnType<typeof setTimeout> | null = null;
let legacyMigrationInProgress = false;

type AutoModeMultiplier = 1 | 2 | 4 | 8;
export type SendShortcut = "enter" | "mod-enter";
export type ChatTheme = "white" | "black";

const toISOString = (
  value: Date | string | number | null | undefined
): string => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

const cloneSafely = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value ?? null)) ?? (value as T);

export type ManualAIMode =
  | "auto"
  | "text"
  | "generate"
  | "edit"
  | "blend"
  | "analyze"
  | "video"
  | "vector";
type AvailableTool =
  | "generateImage"
  | "editImage"
  | "blendImages"
  | "analyzeImage"
  | "analyzePdf"
  | "chatResponse"
  | "generateVideo"
  | "generatePaperJS";

type AIProviderType = SupportedAIProvider;

type SetAIProviderOptions = {
  syncFlowNodes?: boolean;
  source?: "global" | "dialog" | "internal";
};

const isBananaImageProvider = (provider: AIProviderType): boolean =>
  isBananaRouteProvider(provider) ||
  provider === "gemini-pro" ||
  provider === "nano2";

const isAnalyzeDisabledOnCurrentBananaRoute = (
  provider: AIProviderType,
  bananaImageRoute: BananaImageRoute
): boolean => {
  return (
    isTencentStableBananaRoute(provider, bananaImageRoute) &&
    !isTencentBananaAnalyzeSupported()
  );
};

const withBananaRouteProviderOptions = (
  provider: AIProviderType,
  baseOptions: AIProviderOptions | undefined,
  route: BananaImageRoute
): AIProviderOptions | undefined => {
  if (!isBananaImageProvider(provider)) return baseOptions;
  return {
    ...(baseOptions || {}),
    banana: {
      ...(baseOptions?.banana || {}),
      imageRoute: route,
    },
  };
};

const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
const GEMINI_PRO_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
const GEMINI_FLASH_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
const DEFAULT_TEXT_MODEL = "gemini-3-flash-preview";
const GEMINI_PRO_TEXT_MODEL = "gemini-3-flash-preview";
const BANANA_PRO_TEXT_MODEL = "gemini-3-flash-preview";
const BANANA_25_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
const BANANA_25_TEXT_MODEL = "gemini-2.5-flash";
const BANANA_31_TEXT_MODEL = "gemini-3.1-pro-preview";
const BANANA_31_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const SEEDREAM5_IMAGE_MODEL = "doubao-seedream-5-0-260128";
export const SORA2_VIDEO_MODELS = {
  hd: "sora-2-pro-reverse",
  sd: "sora-2-reverse",
} as const;
export type Sora2VideoQuality = keyof typeof SORA2_VIDEO_MODELS;
export const DEFAULT_SORA2_VIDEO_QUALITY: Sora2VideoQuality = "sd";
const RUNNINGHUB_IMAGE_MODEL = "runninghub-su-effect";
const MIDJOURNEY_IMAGE_MODEL = "midjourney-fast";
const RUNNINGHUB_PRIMARY_NODE_ID =
  import.meta.env?.VITE_RUNNINGHUB_PRIMARY_NODE_ID ?? "112";
const RUNNINGHUB_REFERENCE_NODE_ID =
  import.meta.env?.VITE_RUNNINGHUB_REFERENCE_NODE_ID ?? "158";
const RUNNINGHUB_WEBAPP_ID = import.meta.env?.VITE_RUNNINGHUB_WEBAPP_ID;
const RUNNINGHUB_WEBHOOK_URL = import.meta.env?.VITE_RUNNINGHUB_WEBHOOK_URL;
const ENABLE_VIDEO_CANVAS_PLACEMENT = false;
const VIDEO_FETCH_TIMEOUT_MS = 60000;
const DEFAULT_PLACEHOLDER_EDGE = 512;
const MIN_PLACEHOLDER_EDGE = 96;
const INLINE_MEDIA_LIMIT = 150_000; // ~150KB string; guard against oversized base64 persisting in memory/localStorage

type PlaceholderSpec = {
  placeholderId: string;
  center?: { x: number; y: number } | null;
  width: number;
  height: number;
  operationType?: string;
  /**
   * 使用画布的智能排版逻辑（无 center 时会自动计算）
   */
  preferSmartLayout?: boolean;
  /**
   * 智能排版参考的源图（编辑）
   */
  sourceImageId?: string;
  /**
   * 智能排版参考的源图列表（融合）
   */
  sourceImages?: string[];
  /**
   * 预计算的智能位置（如果已算好，可直接用）
   */
  smartPosition?: { x: number; y: number };
  /**
   * 并行分组信息，用于在画布上横向排版
   */
  groupId?: string;
  groupIndex?: number;
  groupTotal?: number;
  /**
   * 是否优先横向排版（X4 等并行模式）
   */
  preferHorizontal?: boolean;
  /**
   * 分组级别的锚点（用于整行对齐）
   */
  groupAnchor?: { x: number; y: number } | null;
};

const parseAspectRatioValue = (ratio?: string | null): number | null => {
  if (!ratio) return null;
  const parts = ratio.split(":").map((v) => Number(v));
  if (
    parts.length !== 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1]) ||
    parts[0] <= 0 ||
    parts[1] <= 0
  ) {
    return null;
  }
  return parts[0] / parts[1];
};

const estimatePlaceholderSize = (params: {
  aspectRatio?: string | null;
  imageSize?: "1K" | "2K" | "4K" | null;
  fallbackBounds?: { width: number; height: number } | null;
}): { width: number; height: number } => {
  if (
    params.fallbackBounds &&
    params.fallbackBounds.width > 0 &&
    params.fallbackBounds.height > 0
  ) {
    return {
      width: params.fallbackBounds.width,
      height: params.fallbackBounds.height,
    };
  }

  const ratio = parseAspectRatioValue(params.aspectRatio) || 1;
  let baseEdge = DEFAULT_PLACEHOLDER_EDGE;

  if (params.imageSize === "2K") {
    baseEdge = DEFAULT_PLACEHOLDER_EDGE * 1.1;
  } else if (params.imageSize === "4K") {
    baseEdge = DEFAULT_PLACEHOLDER_EDGE * 1.25;
  }

  if (ratio >= 1) {
    return {
      width: baseEdge,
      height: Math.max(MIN_PLACEHOLDER_EDGE, baseEdge / ratio),
    };
  }

  return {
    width: Math.max(MIN_PLACEHOLDER_EDGE, baseEdge * ratio),
    height: baseEdge,
  };
};

const getViewCenter = (): { x: number; y: number } | null => {
  try {
    const paperView =
      paper?.view ||
      (typeof window !== "undefined" ? (window as any)?.paper?.view : null);
    if (paperView?.center) {
      return { x: paperView.center.x, y: paperView.center.y };
    }
  } catch {}
  return null;
};

const clampToUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const loadImageElementFromBlob = async (blob: Blob): Promise<HTMLImageElement> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片解码失败"));
      image.src = objectUrl;
    });
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }
};

const mergePrecisePatchIntoImage = async (params: {
  baseImageSource: string;
  patchImageSource: string;
  cropRectNormalized: PreciseEditContext["cropRectNormalized"];
}): Promise<Blob | null> => {
  const baseBlob = await resolveImageToBlob(params.baseImageSource);
  const patchBlob = await resolveImageToBlob(params.patchImageSource);
  if (!baseBlob || !patchBlob) return null;

  const [baseImage, patchImage] = await Promise.all([
    loadImageElementFromBlob(baseBlob),
    loadImageElementFromBlob(patchBlob),
  ]);

  const baseWidth = Math.max(
    1,
    Math.round(baseImage.naturalWidth || baseImage.width || 1)
  );
  const baseHeight = Math.max(
    1,
    Math.round(baseImage.naturalHeight || baseImage.height || 1)
  );

  const canvas = document.createElement("canvas");
  canvas.width = baseWidth;
  canvas.height = baseHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, baseWidth, baseHeight);
  ctx.drawImage(baseImage, 0, 0, baseWidth, baseHeight);

  const nx = clampToUnit(params.cropRectNormalized.x);
  const ny = clampToUnit(params.cropRectNormalized.y);
  const nw = clampToUnit(params.cropRectNormalized.width);
  const nh = clampToUnit(params.cropRectNormalized.height);
  if (nw <= 0 || nh <= 0) return null;

  const cropX = Math.min(baseWidth - 1, Math.max(0, Math.round(nx * baseWidth)));
  const cropY = Math.min(
    baseHeight - 1,
    Math.max(0, Math.round(ny * baseHeight))
  );
  const cropWidth = Math.max(
    1,
    Math.min(baseWidth - cropX, Math.round(nw * baseWidth))
  );
  const cropHeight = Math.max(
    1,
    Math.min(baseHeight - cropY, Math.round(nh * baseHeight))
  );

  ctx.drawImage(patchImage, cropX, cropY, cropWidth, cropHeight);

  try {
    return await canvasToBlob(canvas, { type: "image/png", quality: 0.92 });
  } catch {
    return null;
  }
};

const appendImageSourceCandidate = (bucket: string[], value: unknown): void => {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (bucket.includes(trimmed)) return;
  bucket.push(trimmed);
};

const collectPreciseBaseSourceCandidates = (
  imageId: string,
  preferredSource: string
): string[] => {
  const candidates: string[] = [];
  appendImageSourceCandidate(candidates, preferredSource);

  try {
    const runtime = (window as any)?.tanvaImageInstances as any[] | undefined;
    if (Array.isArray(runtime)) {
      const target = runtime.find((item) => String(item?.id) === String(imageId));
      if (target) {
        appendImageSourceCandidate(candidates, target?.imageData?.localDataUrl);
        appendImageSourceCandidate(candidates, target?.imageData?.src);
        appendImageSourceCandidate(candidates, target?.imageData?.url);
        appendImageSourceCandidate(candidates, target?.imageData?.remoteUrl);
        appendImageSourceCandidate(candidates, target?.imageData?.key);
      }
    }
  } catch {}

  try {
    const project = paper?.project as any;
    const rasterClass = (paper as any).Raster;
    if (project?.getItems && rasterClass) {
      const rasters = project.getItems({ class: rasterClass }) as any[];
      rasters.forEach((raster) => {
        if (!raster) return;
        const rid =
          raster?.data?.imageId ||
          raster?.parent?.data?.imageId ||
          raster?.data?.id ||
          raster?.id;
        if (String(rid) !== String(imageId)) return;
        appendImageSourceCandidate(candidates, raster?.data?.__tanvaSourceRef);
        appendImageSourceCandidate(candidates, raster?.data?.remoteUrl);
        appendImageSourceCandidate(candidates, raster?.source);
        appendImageSourceCandidate(candidates, raster?.image?.src);
      });
    }
  } catch {}

  return candidates;
};

const mergePrecisePatchWithFallback = async (params: {
  baseImageSources: string[];
  patchImageSources: string[];
  cropRectNormalized: PreciseEditContext["cropRectNormalized"];
}): Promise<Blob | null> => {
  for (const baseImageSource of params.baseImageSources) {
    for (const patchImageSource of params.patchImageSources) {
      try {
        const merged = await mergePrecisePatchIntoImage({
          baseImageSource,
          patchImageSource,
          cropRectNormalized: params.cropRectNormalized,
        });
        if (merged) return merged;
      } catch {}
    }
  }
  return null;
};

const dispatchPlaceholderEvent = (
  placeholder: PlaceholderSpec,
  action: "add" | "remove" = "add"
) => {
  if (typeof window === "undefined") return;
  try {
    placeholderLogger.debug("[占位符事件] 派发事件:", { action, placeholder });
    window.dispatchEvent(
      new CustomEvent("predictImagePlaceholder", {
        detail:
          action === "add"
            ? { ...placeholder, action }
            : { placeholderId: placeholder.placeholderId, action },
      })
    );
  } catch (error) {
    placeholderLogger.warn("派发占位符事件失败", error);
  }
};

type VideoPosterBuildResult = {
  dataUrl: string;
  origin: "thumbnail" | "videoFrame" | "placeholder";
  sourceImageUrl?: string;
};

const GEMINI_FALLBACK_PROVIDERS: AIProviderType[] = ["gemini", "gemini-pro"];

const isQuotaOrRateLimitError = (error?: AIError | null): boolean => {
  if (!error) return false;
  const code = (error.code || "").toLowerCase();
  const message = (error.message || "").toLowerCase();
  if (code.includes("429") || code.includes("rate") || code.includes("quota")) {
    return true;
  }
  return (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("resource_exhausted") ||
    message.includes("429")
  );
};

const shouldFallbackToGeminiFlash = (
  provider: AIProviderType,
  model: string,
  error?: AIError | null
): boolean => {
  if (!GEMINI_FALLBACK_PROVIDERS.includes(provider)) return false;
  if (model !== GEMINI_PRO_IMAGE_MODEL) return false;
  return isQuotaOrRateLimitError(error);
};

export const getImageModelForProvider = (provider: AIProviderType): string => {
  if (provider === "gemini-pro") {
    return GEMINI_PRO_IMAGE_MODEL;
  }
  if (provider === "runninghub") {
    return RUNNINGHUB_IMAGE_MODEL;
  }
  if (provider === "midjourney") {
    return MIDJOURNEY_IMAGE_MODEL;
  }
  if (provider === "banana-2.5") {
    return BANANA_25_IMAGE_MODEL;
  }
  if (provider === "banana-3.1") {
    return BANANA_31_IMAGE_MODEL;
  }
  if (provider === "seedream5") {
    return SEEDREAM5_IMAGE_MODEL;
  }
  return DEFAULT_IMAGE_MODEL;
};

export const getAnalyzeModelForProvider = (
  provider: AIProviderType
): string => {
  if (provider === "banana-2.5") return BANANA_25_IMAGE_MODEL;
  if (provider === "banana-3.1" || provider === "nano2") return BANANA_31_IMAGE_MODEL;
  if (provider === "banana") return GEMINI_PRO_IMAGE_MODEL;
  return getImageModelForProvider(provider);
};

const TEXT_MODEL_BY_PROVIDER: Record<AIProviderType, string> = {
  gemini: DEFAULT_TEXT_MODEL,
  "gemini-pro": GEMINI_PRO_TEXT_MODEL,
  banana: BANANA_PRO_TEXT_MODEL,
  "banana-2.5": BANANA_25_TEXT_MODEL,
  "banana-3.1": BANANA_31_TEXT_MODEL,
  runninghub: DEFAULT_TEXT_MODEL,
  midjourney: DEFAULT_TEXT_MODEL,
  nano2: BANANA_31_TEXT_MODEL,
  seedream5: DEFAULT_TEXT_MODEL,
};

export const getTextModelForProvider = (provider: AIProviderType): string => {
  return TEXT_MODEL_BY_PROVIDER[provider] || DEFAULT_TEXT_MODEL;
};

type RunningHubStageUpdater = (stage: string, progress?: number) => void;

type ProcessMetrics = {
  startTime: number;
  lastStepTime: number;
  traceId: string;
  messageId?: string;
};

type MidjourneyActionOptions = {
  parentMessageId: string;
  taskId: string;
  customId: string;
  buttonLabel?: string;
  displayPrompt?: string;
};

const getTimestamp = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const createProcessMetrics = (): ProcessMetrics => {
  const now = getTimestamp();
  return {
    startTime: now,
    lastStepTime: now,
    traceId: `flow-${now.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`,
  };
};

const getResultImageRemoteUrl = (
  result?: AIImageResult | null
): string | undefined => {
  const pickRemote = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return undefined;
    return trimmed;
  };
  const pickRemoteFromList = (list: unknown): string | undefined => {
    if (!Array.isArray(list)) return undefined;
    for (const item of list) {
      const picked = pickRemote(item);
      if (picked) return picked;
    }
    return undefined;
  };

  const fromRoot =
    pickRemote((result as any)?.imageUrl) ||
    pickRemote((result as any)?.remoteUrl) ||
    pickRemote((result as any)?.url) ||
    pickRemoteFromList((result as any)?.imageUrls) ||
    pickRemoteFromList((result as any)?.urls);
  if (fromRoot) return fromRoot;

  const metadata = (result as any)?.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;

  const midMeta = metadata.midjourney as MidjourneyMetadata | undefined;
  const fromMeta =
    pickRemote(midMeta?.imageUrl) ||
    pickRemote((metadata as any)?.imageUrl) ||
    pickRemote((metadata as any)?.remoteUrl) ||
    pickRemote((metadata as any)?.url) ||
    pickRemoteFromList((metadata as any)?.imageUrls) ||
    pickRemoteFromList((metadata as any)?.urls);
  if (fromMeta) return fromMeta;

  const candidates = [
    (metadata as any)?.result,
    (metadata as any)?.output,
    (metadata as any)?.outputs,
    (metadata as any)?.data,
  ];
  for (const candidate of candidates) {
    const picked =
      pickRemote((candidate as any)?.imageUrl) ||
      pickRemote((candidate as any)?.remoteUrl) ||
      pickRemote((candidate as any)?.url) ||
      pickRemoteFromList((candidate as any)?.imageUrls) ||
      pickRemoteFromList((candidate as any)?.urls);
    if (picked) return picked;
  }

  return undefined;
};

const logProcessStep = (
  metrics: ProcessMetrics | undefined,
  _label: string
) => {
  if (!metrics) return;
  const now = getTimestamp();
  metrics.lastStepTime = now;
  // 性能指标已记录
};

const ensureDataUrl = (imageData: string): string =>
  imageData.startsWith("data:image")
    ? imageData
    : `data:image/png;base64,${imageData}`;

const MAX_IMAGE_PREVIEW_SIZE = 512;
const buildImagePreviewSafely = async (
  dataUrl: string
): Promise<string | null> => {
  if (!dataUrl) return null;
  try {
    return await createImagePreviewDataUrl(dataUrl, {
      maxSize: MAX_IMAGE_PREVIEW_SIZE,
      mimeType: "image/webp",
      quality: 0.82,
    });
  } catch (error) {
    console.warn("⚠️ 生成图像缩略图失败:", error);
    return null;
  }
};

const cacheGeneratedImageResult = ({
  messageId,
  prompt,
  result,
  assets,
  inlineImageData,
}: {
  messageId: string;
  prompt: string;
  result: AIImageResult;
  assets?: { remoteUrl?: string; thumbnail?: string };
  inlineImageData?: string | null;
}) => {
  const resolvedImageId = result.id || messageId;
  const preview =
    assets?.thumbnail ||
    (inlineImageData ? ensureDataUrl(inlineImageData) : undefined);
  const remoteUrl = assets?.remoteUrl ?? getResultImageRemoteUrl(result);

  if (!preview && !remoteUrl) {
    return;
  }

  try {
    contextManager.cacheLatestImage(preview ?? null, resolvedImageId, prompt, {
      remoteUrl: remoteUrl ?? null,
    });
  } catch (error) {
    console.warn("⚠️ 缓存最新生成图像失败:", error);
  }
};

const LEGACY_INLINE_IMAGE_THRESHOLD = 350_000;
const isRemoteUrl = (value?: string | null): boolean =>
  typeof value === "string" && /^https?:\/\//i.test(value);
const normalizeInlineImageData = (value?: string | null): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) {
    // 处理重复 data URL 前缀的情况：
    // 例如 "data:image/png;base64,data:image/png;base64,AAAA..."
    const parts = trimmed.split(",");
    if (parts.length >= 3 && parts[1].startsWith("data:")) {
      const meta = parts[0];
      const last = parts[parts.length - 1];
      return `${meta},${last}`;
    }
    return trimmed;
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 120) {
    return `data:image/png;base64,${compact}`;
  }
  return null;
};

type CachedImagePayload = NonNullable<
  ReturnType<(typeof contextManager)["getCachedImage"]>
>;

const resolveCachedImageForImageTools = async (
  cached: CachedImagePayload
): Promise<string | null> => {
  const candidate = cached.imageData ?? cached.remoteUrl ?? null;
  if (!candidate || typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  console.log(`[resolveCachedImageForImageTools] 输入: ${trimmed.slice(0, 80)}...`);

  // 如果已经是 data URL，直接返回
  if (trimmed.startsWith("data:image/")) {
    console.log("[resolveCachedImageForImageTools] 已是 data URL");
    return trimmed;
  }

  // 如果是远程 URL (http/https)，直接返回
  if (/^https?:\/\//i.test(trimmed)) {
    console.log("[resolveCachedImageForImageTools] 远程 URL");
    return trimmed;
  }

  // 其他格式（flow-asset:, blob:, OSS key 等）需要转换为 data URL
  console.log("[resolveCachedImageForImageTools] 尝试转换为 data URL...");
  const resolved = await resolveImageToDataUrl(trimmed, { preferProxy: true });
  if (resolved) {
    console.log(`[resolveCachedImageForImageTools] 转换成功: ${resolved.slice(0, 50)}...`);
    return resolved;
  }

  console.warn("[resolveCachedImageForImageTools] 转换失败，返回原值");
  return trimmed;
};
const shouldUploadLegacyInline = (
  inline: string | null,
  remote?: string | null
) =>
  Boolean(
    inline &&
      !isRemoteUrl(remote) &&
      inline.length > LEGACY_INLINE_IMAGE_THRESHOLD
  );

const dropLargeInline = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // blob URL 仅在当前页面会话有效，不能持久化（刷新后会失效）
  if (/^blob:/i.test(trimmed)) return undefined;
  // remove whitespace to measure real length
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length > INLINE_MEDIA_LIMIT) return undefined;
  return compact;
};

type PlacementAssets = {
  remoteUrl?: string;
  thumbnail?: string;
};

const resolveImageForPlacement = ({
  inlineData,
  result,
  uploadedAssets,
  fallbackRemote,
}: {
  inlineData?: string | null;
  result?: AIImageResult | null;
  uploadedAssets?: PlacementAssets;
  fallbackRemote?: string | null;
}): string | null => {
  const remoteCandidate =
    fallbackRemote ||
    uploadedAssets?.remoteUrl ||
    getResultImageRemoteUrl(result);

  if (remoteCandidate) {
    return remoteCandidate;
  }

  const inlineCandidate =
    normalizeInlineImageData(inlineData) ??
    normalizeInlineImageData(result?.imageData) ??
    normalizeInlineImageData(uploadedAssets?.thumbnail);

  if (inlineCandidate) {
    return ensureDataUrl(inlineCandidate);
  }

  return null;
};

const buildImagePayloadForUpload = (
  imageSrc: string,
  fileName: string
): string | StoredImageAsset => {
  if (!imageSrc) return imageSrc;
  let trimmed = imageSrc.trim();

  // 直接传递可用的 Blob URL
  if (/^blob:/i.test(trimmed)) {
    return trimmed;
  }

  // 规范化 Data URL，修复可能存在的重复前缀
  if (/^data:image\//i.test(trimmed)) {
    const normalized = normalizeInlineImageData(trimmed);
    return normalized ?? trimmed;
  }

  // 远程 URL：包装为资源对象，避免当作 Data URL 处理失败
  const pendingUpload = requiresManagedImageUpload(trimmed);
  const remoteUrl = normalizeRemoteUrl(trimmed) ?? undefined;
  return {
    id: `${pendingUpload ? "remote_pending" : "remote"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url: trimmed,
    src: trimmed,
    remoteUrl,
    fileName,
    contentType: "image/png",
    pendingUpload,
  };
};

const migrateMessageImagePayload = async (
  message: ChatMessage,
  projectId: string | null
): Promise<boolean> => {
  const inlineCandidate =
    normalizeInlineImageData(message.imageData) ??
    normalizeInlineImageData(message.thumbnail);
  if (!inlineCandidate) {
    return false;
  }
  let mutated = false;
  const preview = await buildImagePreviewSafely(inlineCandidate);
  if (preview && message.thumbnail !== preview) {
    message.thumbnail = preview;
    mutated = true;
  }
  if (
    preview &&
    typeof message.imageData === "string" &&
    message.imageData.startsWith("data:image") &&
    message.imageData !== preview
  ) {
    message.imageData = preview;
    mutated = true;
  }
  if (shouldUploadLegacyInline(inlineCandidate, message.imageRemoteUrl)) {
    const remoteUrl = await uploadImageToOSS(
      preview ?? inlineCandidate,
      projectId
    );
    if (remoteUrl) {
      message.imageRemoteUrl = remoteUrl;
      message.imageData = preview ?? message.imageData;
      mutated = true;
    }
  }
  return mutated;
};

const migrateCachedImagePayload = async (
  context: ConversationContext,
  projectId: string | null
): Promise<boolean> => {
  if (!context.cachedImages) {
    return false;
  }

  const inlineCandidate = normalizeInlineImageData(
    context.cachedImages.latest ?? null
  );
  if (!inlineCandidate) {
    return false;
  }
  let mutated = false;
  const preview = await buildImagePreviewSafely(inlineCandidate);
  if (preview && context.cachedImages.latest !== preview) {
    context.cachedImages.latest = preview;
    mutated = true;
  }
  if (
    shouldUploadLegacyInline(
      inlineCandidate,
      context.cachedImages.latestRemoteUrl
    )
  ) {
    const remoteUrl = await uploadImageToOSS(
      preview ?? inlineCandidate,
      projectId
    );
    if (remoteUrl) {
      context.cachedImages.latestRemoteUrl = remoteUrl;
      context.cachedImages.latest = preview ?? null;
      mutated = true;
    }
  }
  return mutated;
};

const migrateContextImageHistory = async (
  context: ConversationContext,
  projectId: string | null
): Promise<boolean> => {
  const store = useImageHistoryStore.getState();
  let mutated = false;
  const history = context.contextInfo?.imageHistory ?? [];

  for (const entry of history) {
    const inlineCandidate =
      normalizeInlineImageData(entry.imageData ?? null) ??
      normalizeInlineImageData(entry.thumbnail ?? null);
    let preview: string | null = null;

    if (inlineCandidate) {
      preview = await buildImagePreviewSafely(inlineCandidate);
      if (preview && entry.imageData !== preview) {
        entry.imageData = preview;
        mutated = true;
      }
      if (preview && entry.thumbnail !== preview) {
        entry.thumbnail = preview;
        mutated = true;
      }
    }

    if (
      inlineCandidate &&
      shouldUploadLegacyInline(inlineCandidate, entry.imageRemoteUrl)
    ) {
      const remoteUrl = await uploadImageToOSS(
        preview ?? inlineCandidate,
        projectId
      );
      if (remoteUrl) {
        entry.imageRemoteUrl = remoteUrl;
        entry.imageData = preview ?? entry.imageData;
        mutated = true;
      }
    }

    try {
      store.updateImage(entry.id, {
        remoteUrl: entry.imageRemoteUrl ?? undefined,
        thumbnail: entry.thumbnail ?? undefined,
        src:
          entry.imageRemoteUrl ||
          entry.thumbnail ||
          entry.imageData ||
          undefined,
      });
    } catch {
      // ignore history update failure
    }
  }

  return mutated;
};

const migrateLegacySessions = async (
  contexts: ConversationContext[],
  projectId: string | null
): Promise<boolean> => {
  let mutated = false;
  for (const context of contexts) {
    for (const message of context.messages) {
      if (await migrateMessageImagePayload(message, projectId)) {
        mutated = true;
      }
    }
    if (await migrateCachedImagePayload(context, projectId)) {
      mutated = true;
    }
    if (await migrateContextImageHistory(context, projectId)) {
      mutated = true;
    }
  }
  return mutated;
};

// ==================== Sora2 视频生成相关函数 ====================

export type Sora2VideoGenerationOptions = {
  onProgress?: (stage: string, progress: number) => void;
  quality?: Sora2VideoQuality;
  model?: "sora-2" | "sora-2-pro";
  /** 画面比例，仅极速 Sora2 支持。例如 '16:9' | '9:16' */
  aspectRatio?: "16:9" | "9:16";
  /** 时长（秒），仅极速 Sora2 支持。例如 10 / 15 / 25 */
  durationSeconds?: 10 | 15 | 25;
  watermark?: boolean;
  thumbnail?: boolean;
  privateMode?: boolean;
  style?: string;
  storyboard?: boolean;
  characterUrl?: string;
  characterTimestamps?: string;
  characterTaskId?: string;
};

// 异步任务轮询配置
const ASYNC_POLL_INTERVAL_MS = 5000; // 5秒轮询一次
const ASYNC_POLL_MAX_ATTEMPTS = 180; // 最多轮询 15 分钟
const ASYNC_POLL_MAX_TIMEOUT_MS = ASYNC_POLL_INTERVAL_MS * ASYNC_POLL_MAX_ATTEMPTS;

export async function requestSora2VideoGeneration(
  prompt: string,
  referenceImageUrls?: string | string[] | null,
  options?: Sora2VideoGenerationOptions
) {
  options?.onProgress?.("提交视频生成请求", 10);

  const normalizedImages = Array.isArray(referenceImageUrls)
    ? referenceImageUrls
    : referenceImageUrls
    ? [referenceImageUrls]
    : [];

  const cleanedImageUrls = normalizedImages
    .filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0
    )
    .map((url) => url.trim());

  // 将时长从 number 转为后端期望的字符串枚举
  const duration: "10" | "15" | "25" | undefined =
    options?.durationSeconds === 10 ||
    options?.durationSeconds === 15 ||
    options?.durationSeconds === 25
      ? (String(options.durationSeconds) as "10" | "15" | "25")
      : undefined;

  // 使用异步接口，立即获取 taskId
  const asyncResponse = await generateVideoAsyncAPI({
    prompt,
    referenceImageUrls: cleanedImageUrls.length ? cleanedImageUrls : undefined,
    quality: options?.quality,
    model: options?.model,
    aspectRatio: options?.aspectRatio,
    duration,
    watermark: options?.watermark,
    thumbnail: options?.thumbnail,
    privateMode: options?.privateMode,
    style: options?.style,
    storyboard: options?.storyboard,
    characterUrl: options?.characterUrl,
    characterTimestamps: options?.characterTimestamps,
    characterTaskId: options?.characterTaskId,
  });

  if (!asyncResponse.success || !asyncResponse.data) {
    throw new Error(asyncResponse.error?.message || "视频生成请求失败");
  }

  const { taskId } = asyncResponse.data;
  console.log("[Sora2] Async task created:", taskId);

  // 轮询查询任务状态
  options?.onProgress?.("视频生成中，请稍候...", 20);

  const startTime = Date.now();
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= ASYNC_POLL_MAX_ATTEMPTS; attempt++) {
    // 等待一段时间
    await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS));

    // 检查超时
    if (Date.now() - startTime > ASYNC_POLL_MAX_TIMEOUT_MS) {
      throw new Error("视频生成超时，请稍后重试");
    }

    // 查询任务状态
    const pollResponse = await querySora2VideoTaskViaAPI(taskId);

    if (!pollResponse.success) {
      const failMsg = pollResponse.error?.message || "";
      lastError = failMsg;
      if (isInsufficientCreditsErrorMessage(failMsg)) {
        throw new Error(failMsg);
      }
      // 本服务异步任务失败时查询接口返回 503 + 错误文案，应终止轮询而非空等超时
      if (
        pollResponse.error?.code === "HTTP_503" &&
        typeof taskId === "string" &&
        taskId.startsWith("async-sora2-")
      ) {
        throw new Error(failMsg || "视频生成失败");
      }
      console.warn(`[Sora2] Poll attempt ${attempt} failed:`, lastError);
      // 继续轮询，不立即失败
      options?.onProgress?.(`视频生成中（查询失败，第${attempt}次）...`, 20 + Math.min(50, attempt));
      continue;
    }

    const taskData = pollResponse.data;

    // 计算进度 (20% - 90%)
    const progress = Math.min(90, 20 + (attempt / ASYNC_POLL_MAX_ATTEMPTS) * 70);
    options?.onProgress?.(`视频生成中（${Math.round(progress)}%）...`, progress);

    // 检查任务状态
    const status = taskData?.status?.toLowerCase();

    if (status === 'succeeded') {
      console.log("[Sora2] Task completed:", taskId);
      options?.onProgress?.("视频生成完成", 95);
      return {
        videoUrl: taskData?.videoUrl || taskData?.video_url,
        content: taskData?.content || "视频已生成",
        referencedUrls: taskData?.referencedUrls || [],
        thumbnailUrl: taskData?.thumbnailUrl || taskData?.thumbnail_url,
        status: taskData?.status,
        taskId: taskId,
        taskInfo: taskData?.taskInfo || taskData?.raw,
      };
    }

    if (status === 'failed') {
      const errorMsg = taskData?.raw?.error?.message || taskData?.raw?.message || "视频生成失败";
      throw new Error(errorMsg);
    }

    // pending 或 processing 状态，继续轮询
    console.log(`[Sora2] Poll attempt ${attempt}/${ASYNC_POLL_MAX_ATTEMPTS}:`, status);
  }

  // 轮询次数用尽仍未完成
  throw new Error(lastError || "视频生成超时，请稍后重试");
}
const downloadUrlAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIDEO_FETCH_TIMEOUT_MS);
    const response = await fetchWithAuth(url, {
      signal: controller.signal,
      mode: "cors",
      auth: "omit",
      allowRefresh: false,
      credentials: "omit",
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn("⚠️ 下载缩略图失败:", url, response.status);
      return null;
    }
    const blob = await responseToBlob(response);
    return await blobToDataUrlLimited(blob);
  } catch (error) {
    console.warn("⚠️ 无法下载缩略图:", url, error);
    return null;
  }
};

const fetchVideoBlob = async (url: string): Promise<Blob | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(VIDEO_FETCH_TIMEOUT_MS, 12000)
    );
    const response = await fetchWithAuth(url, {
      signal: controller.signal,
      mode: "cors",
      auth: "omit",
      allowRefresh: false,
      credentials: "omit",
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn("⚠️ 下载视频失败:", url, response.status);
      return null;
    }
    return await response.blob();
  } catch (error) {
    console.warn("⚠️ 无法下载视频:", url, error);
    return null;
  }
};

const ensureVideoBlobMime = (blob: Blob): Blob => {
  if (blob.type && blob.type.startsWith("video/")) {
    return blob;
  }
  return new Blob([blob], { type: "video/mp4" });
};

const cacheVideoBlobForMessage = async (params: {
  sessionId: string;
  messageId: string;
  videoUrl: string;
}): Promise<{ assetId: string; objectUrl: string } | null> => {
  const { sessionId, messageId, videoUrl } = params;
  if (!sessionId || !messageId || !/^https?:\/\//i.test(videoUrl)) {
    return null;
  }

  const blob = await fetchVideoBlob(videoUrl);
  if (!blob || blob.size <= 0) {
    return null;
  }

  const safeBlob = ensureVideoBlobMime(blob);
  const assetId = buildVideoCacheAssetId(sessionId, messageId);
  const now = Date.now();
  const record: IDBVideoCacheData = {
    id: assetId,
    sessionId,
    messageId,
    sourceUrl: videoUrl,
    blob: safeBlob,
    contentType: safeBlob.type || "video/mp4",
    size: safeBlob.size,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await idbPut(AI_CHAT_VIDEO_CACHE_STORE_NAME, record);
    await idbEnforceLimit(AI_CHAT_VIDEO_CACHE_STORE_NAME);
  } catch (error) {
    console.warn("⚠️ 缓存视频到 IndexedDB 失败:", error);
    return null;
  }

  const cachedUrl = videoObjectUrlByAssetId.get(assetId);
  if (cachedUrl) {
    bindVideoObjectUrlToMessage(assetId, messageId, cachedUrl);
    return { assetId, objectUrl: cachedUrl };
  }

  const objectUrl = URL.createObjectURL(safeBlob);
  bindVideoObjectUrlToMessage(assetId, messageId, objectUrl);
  return { assetId, objectUrl };
};

const loadCachedVideoObjectUrl = async (
  sessionId: string,
  messageId: string
): Promise<{ assetId: string; objectUrl: string } | null> => {
  if (!sessionId || !messageId) return null;
  const assetId = buildVideoCacheAssetId(sessionId, messageId);
  const existing = videoObjectUrlByAssetId.get(assetId);
  if (existing) {
    bindVideoObjectUrlToMessage(assetId, messageId, existing);
    return { assetId, objectUrl: existing };
  }

  try {
    const record = await idbGet<IDBVideoCacheData>(
      AI_CHAT_VIDEO_CACHE_STORE_NAME,
      assetId
    );
    if (!record?.blob) return null;

    const safeBlob =
      record.blob instanceof Blob
        ? ensureVideoBlobMime(record.blob)
        : ensureVideoBlobMime(new Blob([record.blob as any]));
    const objectUrl = URL.createObjectURL(safeBlob);
    bindVideoObjectUrlToMessage(assetId, messageId, objectUrl);
    return { assetId, objectUrl };
  } catch (error) {
    console.warn("⚠️ 从 IndexedDB 恢复视频缓存失败:", error);
    return null;
  }
};

const hydrateSessionLocalVideoUrls = async (
  sessionId: string
): Promise<boolean> => {
  const context = contextManager.getSession(sessionId);
  if (!context || !Array.isArray(context.messages)) {
    return false;
  }

  let changed = false;
  for (const message of context.messages) {
    const remoteVideoUrl =
      typeof message.videoUrl === "string" && message.videoUrl.trim()
        ? message.videoUrl.trim()
        : typeof message.videoSourceUrl === "string" &&
          message.videoSourceUrl.trim()
        ? message.videoSourceUrl.trim()
        : "";
    if (!remoteVideoUrl) continue;

    const expectedAssetId = buildVideoCacheAssetId(sessionId, message.id);
    if (message.videoLocalAssetId !== expectedAssetId) {
      message.videoLocalAssetId = expectedAssetId;
      changed = true;
    }
    if (message.videoLocalUrl) {
      message.videoLocalUrl = undefined;
      changed = true;
    }

    const local = await loadCachedVideoObjectUrl(sessionId, message.id);
    if (!local) continue;

    if (
      message.videoLocalAssetId !== local.assetId ||
      message.videoLocalUrl !== local.objectUrl
    ) {
      message.videoLocalAssetId = local.assetId;
      message.videoLocalUrl = local.objectUrl;
      changed = true;
    }
  }

  return changed;
};

const captureVideoPosterFromBlob = async (
  blob: Blob
): Promise<string | null> => {
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(blob);
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(objectUrl);
    };

    const fail = () => {
      cleanup();
      resolve(null);
    };

    video.addEventListener("error", fail);
    video.addEventListener(
      "loadeddata",
      () => {
        try {
          const seekTime = Math.min(0.2, (video.duration || 1) * 0.1);
          const handleSeeked = () => {
            void (async () => {
              const canvas = document.createElement("canvas");
              canvas.width = video.videoWidth || 960;
              canvas.height = video.videoHeight || 540;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                fail();
                return;
              }
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const dataUrl = await canvasToDataUrl(canvas, "image/png");
              cleanup();
              resolve(dataUrl);
            })().catch((error) => {
              console.warn("⚠️ 无法捕获视频帧:", error);
              fail();
            });
          };
          if (seekTime > 0) {
            video.currentTime = seekTime;
            video.addEventListener("seeked", handleSeeked, { once: true });
          } else {
            handleSeeked();
          }
        } catch (error) {
          console.warn("⚠️ 设置视频截帧失败:", error);
          fail();
        }
      },
      { once: true }
    );

    video.src = objectUrl;
  });
};

const buildPlaceholderPoster = (
  prompt: string,
  videoUrl: string
): string | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#1e293b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);

  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 48px "Inter", sans-serif';
  ctx.fillText("🎬 视频占位", 80, 120);

  ctx.font = '24px "Inter", sans-serif';
  const maxWidth = canvas.width - 160;
  const words = `${prompt}\n${videoUrl}`.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  ctx.font = '24px "Inter", sans-serif';
  lines.slice(0, 5).forEach((line, index) => {
    ctx.fillText(line, 80, 180 + index * 36);
  });

  return canvas.toDataURL("image/png");
};

const buildVideoPoster = async (params: {
  prompt: string;
  videoUrl: string;
  thumbnailUrl?: string;
}): Promise<VideoPosterBuildResult | null> => {
  if (params.thumbnailUrl) {
    const downloaded = await downloadUrlAsDataUrl(params.thumbnailUrl);
    if (downloaded) {
      return {
        dataUrl: downloaded,
        origin: "thumbnail",
        sourceImageUrl: params.thumbnailUrl,
      };
    }
  }

  const blob = await fetchVideoBlob(params.videoUrl);
  if (blob) {
    const captured = await captureVideoPosterFromBlob(blob);
    if (captured) {
      return {
        dataUrl: captured,
        origin: "videoFrame",
        sourceImageUrl: params.videoUrl,
      };
    }
  }

  const placeholder = buildPlaceholderPoster(params.prompt, params.videoUrl);
  if (!placeholder) return null;
  return { dataUrl: placeholder, origin: "placeholder" };
};

const computeVideoSmartPosition = (): { x: number; y: number } | undefined => {
  try {
    const cached = contextManager.getCachedImage();
    if (cached?.bounds) {
      const offsetVertical =
        useUIStore.getState().smartPlacementOffsetVertical || 552;
      return {
        x: cached.bounds.x + cached.bounds.width / 2,
        y: cached.bounds.y + cached.bounds.height / 2 + offsetVertical,
      };
    }
  } catch (error) {
    console.warn("⚠️ 计算视频智能位置失败:", error);
  }
  return undefined;
};

const autoPlaceVideoOnCanvas = async (params: {
  prompt: string;
  videoUrl: string;
  thumbnailUrl?: string;
}) => {
  if (typeof window === "undefined") return null;
  try {
    const poster = await buildVideoPoster(params);
    if (!poster) return null;
    const smartPosition = computeVideoSmartPosition();
    window.dispatchEvent(
      new CustomEvent("triggerQuickImageUpload", {
        detail: {
          imageData: poster.dataUrl,
          fileName: `sora-video-${Date.now()}.png`,
          operationType: "video",
          smartPosition,
          videoInfo: {
            videoUrl: params.videoUrl,
            sourceUrl: params.videoUrl,
            thumbnailUrl: poster.sourceImageUrl ?? params.thumbnailUrl,
            prompt: params.prompt,
          },
        },
      })
    );
    return poster.dataUrl;
  } catch (error) {
    console.warn("⚠️ 自动投放视频缩略图失败:", error);
    return null;
  }
};

// ============================================================

async function buildRunningHubProviderOptions(params: {
  primaryImage: string;
  referenceImage?: string | null;
  projectId?: string | null;
  onStageUpdate?: RunningHubStageUpdater;
}): Promise<AIProviderOptions> {
  const { primaryImage, referenceImage, projectId, onStageUpdate } = params;

  onStageUpdate?.("上传SU截图", 25);
  const primaryDataUrl = await resolveImageToDataUrl(primaryImage);
  if (!primaryDataUrl) {
    throw new Error("SU 截图读取失败，请重新选择图片。");
  }
  const primaryUrl = await uploadImageToOSS(primaryDataUrl, projectId);
  if (!primaryUrl) {
    throw new Error("SU 截图上传失败，请稍后重试。");
  }

  const nodeInfoList: RunningHubGenerateOptions["nodeInfoList"] = [
    {
      nodeId: RUNNINGHUB_PRIMARY_NODE_ID,
      fieldName: "image",
      fieldValue: primaryUrl,
      description: "SU截图",
    },
  ];

  if (referenceImage) {
    onStageUpdate?.("上传参考图", 30);
    const referenceDataUrl = await resolveImageToDataUrl(referenceImage);
    if (!referenceDataUrl) {
      throw new Error("参考图读取失败，请重新选择图片。");
    }
    const referenceUrl = await uploadImageToOSS(referenceDataUrl, projectId);
    if (!referenceUrl) {
      throw new Error("参考图上传失败，请稍后重试。");
    }
    nodeInfoList.push({
      nodeId: RUNNINGHUB_REFERENCE_NODE_ID,
      fieldName: "image",
      fieldValue: referenceUrl,
      description: "参考图",
    });
  }

  const runningHubOptions: RunningHubGenerateOptions = {
    nodeInfoList,
  };

  if (RUNNINGHUB_WEBAPP_ID) {
    runningHubOptions.webappId = RUNNINGHUB_WEBAPP_ID;
  }

  if (RUNNINGHUB_WEBHOOK_URL) {
    runningHubOptions.webhookUrl = RUNNINGHUB_WEBHOOK_URL;
  }

  return {
    runningHub: runningHubOptions,
  };
}

// 🔥 图片上传到 OSS 的辅助函数
export async function uploadImageToOSS(
  imageData: string,
  projectId?: string | null
): Promise<string | null> {
  return aiChatUploadLimiter.run(async () => {
    try {
      if (!imageData || typeof imageData !== "string") {
        console.warn("⚠️ 无效的图片数据，跳过上传");
        return null;
      }

      // 优先用 fetch(dataURL/blobURL) -> blob，避免 atob+大数组导致 JS 堆峰值
      const blob =
        (await resolveImageToBlob(imageData, { preferProxy: true })) ||
        (imageData.includes("base64,") ? await dataURLToBlobAsync(imageData) : null);

      if (!blob) {
        console.warn("⚠️ 图片转换 Blob 失败，跳过上传");
        return null;
      }

      const result = await ossUploadService.uploadToOSS(blob, {
        dir: "ai-chat-images/",
        projectId,
        fileName: `ai-chat-${Date.now()}.png`,
        contentType: blob.type || "image/png",
      });

      if (result.success && result.url) {
        return result.url;
      }
      console.error("❌ 图片上传失败:", result.error);
      return null;
    } catch (error) {
      console.error("❌ 图片上传异常:", error);
      return null;
    }
  });
}

const serializeConversation = async (
  context: ConversationContext
): Promise<SerializedConversationContext> => {
  const projectId = useProjectContentStore.getState().projectId;

  const isRemoteUrl = (value: string | undefined): boolean =>
    !!value && /^https?:\/\//.test(value);

  const toPersistableRef = (value?: string | null): string | undefined => {
    if (!value || typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return isPersistableImageRef(trimmed) ? trimmed : undefined;
  };

  const messagesNeedingUpload = context.messages.filter(
    (msg) =>
      !!msg.imageData &&
      !isRemoteUrl(msg.imageData) &&
      !isRemoteUrl(msg.imageRemoteUrl) &&
      msg.imageData.trim().length > 0
  );

  // ⚠️ 用并发限制替换 Promise.all，避免一次性上传多张大图导致内存峰值
  const uploadResults = await mapWithLimit(
    messagesNeedingUpload,
    1,
    async (msg) => {
      try {
        const uploadInput = toRenderableImageSrc(msg.imageData) ?? msg.imageData!;
        const ossUrl = await uploadImageToOSS(uploadInput, projectId);
        return { messageId: msg.id, ossUrl };
      } catch (error) {
        console.warn("⚠️ 上传消息图片失败，使用本地数据回退:", error);
        return { messageId: msg.id, ossUrl: null };
      }
    }
  );
  

  const imageUrlMap = new Map<string, string | null>();
  uploadResults.forEach(({ messageId, ossUrl }) => {
    if (ossUrl) {
      imageUrlMap.set(messageId, ossUrl);
      const target = context.messages.find((m) => m.id === messageId);
      if (target) {
        target.imageRemoteUrl = ossUrl;
      }
    }
  });

  return {
    sessionId: context.sessionId,
    name: context.name,
    startTime: toISOString(context.startTime),
    lastActivity: toISOString(context.lastActivity),
    currentMode: context.currentMode,
    activeImageId: context.activeImageId ?? undefined,
    messages: context.messages.map((message) => {
      const remoteUrl =
        imageUrlMap.get(message.id) ||
        (isRemoteUrl(message.imageRemoteUrl)
          ? message.imageRemoteUrl
          : undefined) ||
        (isRemoteUrl(message.imageData) ? message.imageData : undefined);

      // 设计 JSON 强约束：仅允许可持久化图片引用（remote/proxy/key/path），禁止 data:/blob:/裸 base64 进入项目内容
      const persistableFallback =
        toPersistableRef(message.thumbnail) ??
        toPersistableRef(remoteUrl) ??
        toPersistableRef(message.imageRemoteUrl) ??
        toPersistableRef(message.imageData);

      const safeImageData = remoteUrl
        ? undefined
        : toPersistableRef(message.imageData);
      const safeSourceImageData = toPersistableRef(message.sourceImageData);
      const safeSourceImagesData = Array.isArray(message.sourceImagesData)
        ? message.sourceImagesData
            .map((v) => toPersistableRef(v))
            .filter((v): v is string => Boolean(v))
        : undefined;

      const serialized: SerializedChatMessage = {
        id: message.id,
        type: message.type,
        content: message.content,
        timestamp: toISOString(message.timestamp),
        webSearchResult: cloneSafely(message.webSearchResult),
        imageRemoteUrl: remoteUrl || undefined,
        imageUrl: remoteUrl || undefined,
        imageData: safeImageData,
        thumbnail: persistableFallback,
        expectsImageOutput: message.expectsImageOutput,
        sourceImageData: safeSourceImageData,
        sourceImagesData: safeSourceImagesData,
        provider: message.provider,
        metadata: message.metadata ? cloneSafely(message.metadata) : undefined,
        generationStatus: message.generationStatus
          ? {
              isGenerating: !!message.generationStatus.isGenerating,
              progress: message.generationStatus.progress ?? 0,
              error: message.generationStatus.error ?? null,
              stage: message.generationStatus.stage,
            }
          : undefined,
        videoUrl: message.videoUrl,
        videoSourceUrl: message.videoSourceUrl,
        videoThumbnail: toPersistableRef(message.videoThumbnail),
        videoDuration: message.videoDuration,
        videoReferencedUrls: message.videoReferencedUrls,
        videoTaskId: message.videoTaskId ?? undefined,
        videoStatus: message.videoStatus ?? undefined,
        // 保留并行分组信息，确保刷新/持久化后仍能恢复为同一组
        groupId: message.groupId ?? undefined,
        groupIndex: message.groupIndex ?? undefined,
        groupTotal: message.groupTotal ?? undefined,
      };

      return serialized;
    }),
    operations: context.operations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      timestamp: toISOString(operation.timestamp),
      input: operation.input,
      output: operation.output,
      success: operation.success,
      metadata: operation.metadata ? cloneSafely(operation.metadata) : null,
    })),
    cachedImages: {
      latest: toPersistableRef(context.cachedImages.latest) ?? null,
      latestId: context.cachedImages.latestId ?? null,
      latestPrompt: context.cachedImages.latestPrompt ?? null,
      timestamp: context.cachedImages.timestamp
        ? toISOString(context.cachedImages.timestamp)
        : null,
      latestBounds: context.cachedImages.latestBounds ?? null,
      latestLayerId: context.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: toPersistableRef(context.cachedImages.latestRemoteUrl) ?? null,
    },
    contextInfo: {
      userPreferences: cloneSafely(context.contextInfo.userPreferences ?? {}),
      recentPrompts: [...context.contextInfo.recentPrompts],
      imageHistory: context.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        timestamp: toISOString(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? null,
        thumbnail:
          toPersistableRef(item.thumbnail) ??
          toPersistableRef(item.imageRemoteUrl) ??
          null,
        imageRemoteUrl: toPersistableRef(item.imageRemoteUrl) ?? null,
        imageData: toPersistableRef(item.imageData) ?? null,
      })),
      iterationCount: context.contextInfo.iterationCount,
      lastOperationType: context.contextInfo.lastOperationType,
    },
  };
};

const hasRenderableMedia = (message: {
  imageData?: string | null;
  imageRemoteUrl?: string | null;
  imageUrl?: string | null;
  thumbnail?: string | null;
  videoUrl?: string | null;
  videoThumbnail?: string | null;
}): boolean =>
  Boolean(
    message.imageData ||
      message.imageRemoteUrl ||
      message.imageUrl ||
      message.thumbnail ||
      message.videoUrl ||
      message.videoThumbnail
  );

const shouldDropMessageOnHydrate = (
  message: SerializedChatMessage
): boolean => {
  const hasMedia = hasRenderableMedia(message);
  if (message.type === "error") {
    return true;
  }
  if (message.type === "ai" && message.generationStatus?.error && !hasMedia) {
    return true;
  }
  return false;
};

const hydrateMessageGenerationState = (message: ChatMessage): ChatMessage => {
  if (message.type !== "ai") return message;
  const status = message.generationStatus;
  if (!status) return message;

  const wasInFlight = !!status.isGenerating;
  const hadError =
    typeof status.error === "string" && status.error.trim().length > 0;
  if (!wasInFlight && !hadError) return message;

  const normalizeContent =
    wasInFlight && (message.content?.trim() || "") === "正在准备处理您的请求..."
      ? "上次请求在刷新后已终止，请重新发送。"
      : message.content;
  const hasMedia = hasRenderableMedia(message);

  return {
    ...message,
    content: normalizeContent,
    generationStatus: hasMedia
      ? {
          ...status,
          isGenerating: false,
          progress: status.progress ?? (hadError ? 0 : 100),
          error: null,
          stage: undefined,
        }
      : undefined,
    expectsImageOutput: hasMedia ? message.expectsImageOutput : false,
    expectsVideoOutput: hasMedia ? message.expectsVideoOutput : false,
  };
};

const deserializeConversation = (
  data: SerializedConversationContext
): ConversationContext => {
  const messages: ChatMessage[] = data.messages
    .filter((message) => !shouldDropMessageOnHydrate(message))
    .map((message) => {
      const remoteUrl =
        (message as any).imageRemoteUrl || (message as any).imageUrl;
      const baseImage = message.imageData;
      const thumbnail = message.thumbnail;
      const persistedVideoUrl =
        typeof message.videoUrl === "string" ? message.videoUrl.trim() : "";
      const persistedVideoSourceUrl =
        typeof message.videoSourceUrl === "string"
          ? message.videoSourceUrl.trim()
          : "";
      const normalizedVideoUrl = persistedVideoUrl.startsWith("blob:")
        ? ""
        : persistedVideoUrl;
      const normalizedVideoSourceUrl = persistedVideoSourceUrl.startsWith(
        "blob:"
      )
        ? ""
        : persistedVideoSourceUrl;
      const effectiveVideoUrl =
        normalizedVideoUrl || normalizedVideoSourceUrl || undefined;
      return hydrateMessageGenerationState({
        id: message.id,
        type: message.type,
        content: message.content,
        timestamp: new Date(message.timestamp),
        webSearchResult: message.webSearchResult,
        imageData: baseImage,
        imageRemoteUrl: remoteUrl,
        thumbnail,
        // 恢复并行分组信息，保证刷新后同组消息仍能被识别并一起渲染
        groupId: (message as any).groupId ?? undefined,
        groupIndex: (message as any).groupIndex ?? undefined,
        groupTotal: (message as any).groupTotal ?? undefined,
        expectsImageOutput: message.expectsImageOutput,
        sourceImageData: message.sourceImageData,
        sourceImagesData: message.sourceImagesData,
        provider: message.provider as AIProviderType | undefined,
        metadata: message.metadata ? { ...message.metadata } : undefined,
        generationStatus: message.generationStatus
          ? {
              isGenerating: !!message.generationStatus.isGenerating,
              progress: message.generationStatus.progress ?? 0,
              error: message.generationStatus.error ?? null,
              stage: message.generationStatus.stage,
            }
          : undefined,
        videoUrl: effectiveVideoUrl,
        videoSourceUrl: normalizedVideoSourceUrl || normalizedVideoUrl || undefined,
        videoLocalAssetId: effectiveVideoUrl
          ? buildVideoCacheAssetId(data.sessionId, message.id)
          : undefined,
        videoLocalUrl: undefined,
        videoThumbnail: message.videoThumbnail,
        videoDuration: message.videoDuration,
        videoReferencedUrls: message.videoReferencedUrls,
        videoTaskId: message.videoTaskId ?? null,
        videoStatus: message.videoStatus ?? null,
      });
    });

  const operations: OperationHistory[] = data.operations.map((operation) => ({
    id: operation.id,
    type: operation.type,
    timestamp: new Date(operation.timestamp),
    input: operation.input,
    output: operation.output,
    success: operation.success,
    metadata: operation.metadata ?? undefined,
  }));

  return {
    sessionId: data.sessionId,
    name: data.name,
    startTime: new Date(data.startTime),
    lastActivity: new Date(data.lastActivity),
    messages,
    operations,
    currentMode: data.currentMode,
    activeImageId: data.activeImageId ?? undefined,
    cachedImages: {
      latest: null,
      latestId: data.cachedImages.latestId ?? null,
      latestPrompt: data.cachedImages.latestPrompt ?? null,
      timestamp: data.cachedImages.timestamp
        ? new Date(data.cachedImages.timestamp)
        : null,
      latestBounds: data.cachedImages.latestBounds ?? null,
      latestLayerId: data.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: data.cachedImages.latestRemoteUrl ?? null,
    },
    contextInfo: {
      userPreferences: cloneSafely(data.contextInfo.userPreferences ?? {}),
      recentPrompts: [...data.contextInfo.recentPrompts],
      imageHistory: data.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        imageData:
          item.imageRemoteUrl || item.imageData || item.thumbnail || "",
        imageRemoteUrl: item.imageRemoteUrl || undefined,
        prompt: item.prompt,
        timestamp: new Date(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? undefined,
        thumbnail: item.thumbnail ?? undefined,
      })),
      iterationCount: data.contextInfo.iterationCount,
      lastOperationType: data.contextInfo.lastOperationType,
    },
  };
};

const sessionsEqual = (
  a: SerializedConversationContext[] | undefined,
  b: SerializedConversationContext[]
): boolean => JSON.stringify(a ?? []) === JSON.stringify(b);

interface AIChatState {
  // 对话框状态
  isVisible: boolean;
  isMaximized: boolean; // 对话框是否最大化

  // 输入状态
  currentInput: string;

  // 会话管理
  currentSessionId: string | null;
  sessions: ChatSessionSummary[];

  // 生成状态
  generationStatus: GenerationStatus;

  // 消息历史
  messages: ChatMessage[];

  // 最近生成的图像
  lastGeneratedImage: AIImageResult | null;

  // 图生图状态
  sourceImageForEditing: string | null; // 当前用于编辑的源图像
  preciseEditContext: PreciseEditContext | null; // 精准微调上下文（局部编辑回贴）

  // 多图融合状态
  sourceImagesForBlending: string[]; // 当前用于融合的多张图像

  // 图像分析状态
  sourceImageForAnalysis: string | null; // 当前用于分析的源图像

  // PDF 分析状态
  sourcePdfForAnalysis: string | null; // 当前用于分析的 PDF 文件 (base64)
  sourcePdfFileName: string | null; // 当前上传的 PDF 文件名（用于 UI 提示）

  // 配置选项
  autoDownload: boolean; // 是否自动下载生成的图片
  enableWebSearch: boolean; // 是否启用联网搜索
  imageOnly: boolean; // 仅返回图像，不返回文本（适用于图像生成/编辑/融合）
  aspectRatio:
    | "1:1"
    | "2:3"
    | "3:2"
    | "3:4"
    | "4:3"
    | "4:5"
    | "5:4"
    | "9:16"
    | "16:9"
    | "21:9"
    | null; // 图像长宽比
  imageSize: "1K" | "2K" | "4K" | null; // 图像尺寸（高清设置，仅 Gemini 3）
  thinkingLevel: "high" | "low" | null; // 思考级别（仅 Gemini 3）
  videoAspectRatio: "16:9" | "9:16" | null; // 视频画面比例（Seedance）
  videoDurationSeconds: AIChatVideoDurationSeconds | null; // 视频时长（秒）
  manualAIMode: ManualAIMode;
  autoSelectedTool: AvailableTool | null; // Auto 模式最近一次选择的工具
  aiProvider: AIProviderType; // AI提供商选择 (gemini: Google Gemini, banana: 147 API, runninghub: SU截图转效果, midjourney: 147 Midjourney)
  bananaImageRoute: BananaImageRoute;
  autoModeMultiplier: AutoModeMultiplier;
  sendShortcut: SendShortcut;
  expandedPanelStyle: "transparent" | "solid"; // 展开/最大化模式的面板样式
  chatTheme: ChatTheme; // AI 对话框与工作区主题色（白/黑）

  // 操作方法
  showDialog: () => void;
  hideDialog: () => void;
  toggleDialog: () => void;
  setIsMaximized: (value: boolean) => void; // 设置最大化状态

  // 输入管理
  setCurrentInput: (input: string) => void;
  clearInput: () => void;

  // 消息管理
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => ChatMessage;
  clearMessages: () => void;
  updateMessageStatus: (
    messageId: string,
    status: Partial<ChatMessage["generationStatus"]>
  ) => void;
  updateMessage: (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage
  ) => void;
  refreshSessions: (options?: {
    persistToLocal?: boolean;
    markProjectDirty?: boolean;
    immediate?: boolean;
  }) => Promise<void>;
  createSession: (name?: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  renameCurrentSession: (name: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  hydratePersistedSessions: (
    sessions: SerializedConversationContext[],
    activeSessionId?: string | null,
    options?: { markProjectDirty?: boolean }
  ) => void;
  resetSessions: () => void;

  // 图像生成
  generateImage: (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 图生图功能
  editImage: (
    prompt: string,
    sourceImage: string,
    showImagePlaceholder?: boolean,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  setSourceImageForEditing: (imageData: string | null) => void;
  setPreciseEditContext: (context: PreciseEditContext | null) => void;

  // 画布选中图片同步到AI对话框
  setSourceImagesFromCanvas: (images: string[]) => void;

  // 多图融合功能
  blendImages: (
    prompt: string,
    sourceImages: string[],
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  addImageForBlending: (imageData: string) => void;
  removeImageFromBlending: (index: number) => void;
  clearImagesForBlending: () => void;
  executeMidjourneyAction: (options: MidjourneyActionOptions) => Promise<void>;

  // 图像分析功能
  analyzeImage: (
    prompt: string,
    sourceImage: string | string[],
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  setSourceImageForAnalysis: (imageData: string | null) => void;

  // PDF 分析功能
  analyzePdf: (
    prompt: string,
    sourcePdf: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  setSourcePdfForAnalysis: (
    pdfData: string | null,
    fileName?: string | null
  ) => void;

  // 文本对话功能
  generateTextResponse: (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 视频生成功能
  generateVideo: (
    prompt: string,
    referenceImage?: string | null,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // Paper.js 向量图形生成功能
  generatePaperJSCode: (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 图像转矢量功能
  img2Vector: (
    prompt: string,
    sourceImage: string,
    style?: "simple" | "detailed" | "artistic",
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 智能工具选择功能
  processUserInput: (input: string) => Promise<void>;

  // 核心处理流程
  executeProcessFlow: (
    input: string,
    isRetry?: boolean,
    groupInfo?: { groupId: string; groupIndex: number; groupTotal: number },
    options?: ExecuteProcessFlowOptions
  ) => Promise<void>;

  // 🔥 并行图片生成（使用预创建的消息）
  executeParallelImageGeneration: (
    input: string,
    options: {
      groupId: string;
      groupIndex: number;
      groupTotal: number;
      userMessageId: string;
      aiMessageId: string;
    }
  ) => Promise<void>;

  // 智能模式检测
  getAIMode: () =>
    | "generate"
    | "edit"
    | "blend"
    | "analyze"
    | "analyzePdf"
    | "text"
    | "video"
    | "vector";

  // 配置管理
  toggleAutoDownload: () => void;
  setAutoDownload: (value: boolean) => void;
  toggleWebSearch: () => void;
  setWebSearch: (value: boolean) => void;
  toggleImageOnly: () => void; // 切换仅图像模式
  setImageOnly: (value: boolean) => void;
  setAspectRatio: (
    ratio:
      | "1:1"
      | "2:3"
      | "3:2"
      | "3:4"
      | "4:3"
      | "4:5"
      | "5:4"
      | "9:16"
      | "16:9"
      | "21:9"
      | null
  ) => void; // 设置长宽比
  setImageSize: (size: "1K" | "2K" | "4K" | null) => void; // 设置图像尺寸
  setThinkingLevel: (level: "high" | "low" | null) => void; // 设置思考级别
  setVideoAspectRatio: (ratio: "16:9" | "9:16" | null) => void;
  setVideoDurationSeconds: (seconds: AIChatVideoDurationSeconds | null) => void;
  setManualAIMode: (mode: ManualAIMode) => void;
  setAIProvider: (provider: AIProviderType, options?: SetAIProviderOptions) => void; // 设置AI提供商
  setBananaImageRoute: (route: BananaImageRoute) => void;
  setAutoModeMultiplier: (multiplier: AutoModeMultiplier) => void;
  setSendShortcut: (shortcut: SendShortcut) => void;
  setExpandedPanelStyle: (style: "transparent" | "solid") => void; // 设置展开模式面板样式
  setChatTheme: (theme: ChatTheme) => void;

  // 重置状态
  resetState: () => void;

  // 🧠 上下文管理方法
  initializeContext: () => void;
  getContextSummary: () => string;
  isIterativeMode: () => boolean;
  enableIterativeMode: () => void;
  disableIterativeMode: () => void;
}

export const useAIChatStore = create<AIChatState>()(
  persist(
    (set, get) => {
      const registerMessageImageHistory = async ({
        aiMessageId,
        prompt,
        result,
        operationType,
        aiProvider,
        skipPreview,
      }: {
        aiMessageId: string;
        prompt: string;
        result: AIImageResult;
        operationType: "generate" | "edit" | "blend";
        aiProvider: AIProviderType;
        skipPreview?: boolean;
      }): Promise<{ remoteUrl?: string; thumbnail?: string }> => {
        const inlineImageData =
          typeof result.imageData === "string" && result.imageData.trim().length > 0
            ? result.imageData
            : undefined;
        const initialRemoteUrl = getResultImageRemoteUrl(result);
        if (!inlineImageData && !initialRemoteUrl) {
          return {};
        }

        return aiChatHistoryLimiter.run(async () => {
          const dataUrl = inlineImageData ? ensureDataUrl(inlineImageData) : undefined;
          const previewDataUrl = skipPreview
            ? null
            : dataUrl
            ? await buildImagePreviewSafely(dataUrl)
            : null;
          const projectId = useProjectContentStore.getState().projectId;
          let remoteUrl: string | undefined = initialRemoteUrl;
          try {
            const historyRecord = await recordImageHistoryEntry({
              ...(initialRemoteUrl
                ? { remoteUrl: initialRemoteUrl }
                : { dataUrl }),
              title: prompt,
              nodeId: aiMessageId,
              nodeType: "generate",
              projectId,
              dir: "ai-chat-history/",
              keepThumbnail: Boolean(previewDataUrl),
              thumbnailDataUrl: previewDataUrl ?? undefined,
              metadata: {
                ...(result.metadata || {}),
                model: result.model,
                aiProvider,
                provider: aiProvider,
                operationType,
              },
            });
            remoteUrl = historyRecord.remoteUrl || remoteUrl;
          } catch (error) {
            console.warn("⚠️ 记录AI图像历史失败:", error);
          }

          // 缩略图优先：previewDataUrl（小）-> remoteUrl（小）-> dataUrl（大，仅兜底）
          const thumbnail = previewDataUrl ?? remoteUrl ?? dataUrl;

          const historyEntry = {
            prompt,
            operationType,
            imageData: previewDataUrl ?? (remoteUrl ? undefined : dataUrl),
            parentImageId: undefined,
            thumbnail,
            imageRemoteUrl: remoteUrl,
          };

          const storedHistory = contextManager.addImageHistory(historyEntry);

          try {
            const srcForStore = remoteUrl || dataUrl;
            if (srcForStore) {
              useImageHistoryStore.getState().addImage({
                id: storedHistory.id,
                src: srcForStore,
                remoteUrl: remoteUrl ?? undefined,
                thumbnail,
                title: prompt,
                nodeId: aiMessageId,
                nodeType: "generate",
                projectId,
                timestamp: storedHistory.timestamp.getTime(),
              });
            }
          } catch (error) {
            console.warn("⚠️ 更新图片历史Store失败:", error);
          }

          const assets = {
            remoteUrl: remoteUrl ?? undefined,
            thumbnail,
          };

          // 🔥 若图片已落到画布（placeholderId 对应画布 imageId），尽早把画布图片升级为远程 URL，并释放 base64/blob 内存
          if (assets.remoteUrl && typeof window !== "undefined") {
            try {
              const placeholderId = `ai-placeholder-${aiMessageId}`;
              window.dispatchEvent(
                new CustomEvent("tanva:upgradeImageSource", {
                  detail: {
                    placeholderId,
                    remoteUrl: assets.remoteUrl,
                    aiMessageId,
                  },
                })
              );
            } catch {
              // ignore
            }
          }

          if (assets.remoteUrl || assets.thumbnail) {
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              imageRemoteUrl: assets.remoteUrl || msg.imageRemoteUrl,
              thumbnail: assets.thumbnail ?? msg.thumbnail,
              // 🔥 不在此处强制清空 imageData：对话框/画布仍可能短时间依赖 base64；
              // 统一由外层（generate/edit/blend）在上传成功后延迟清理，避免闪烁/失败回退问题。
            }));

            const context = contextManager.getCurrentContext();
            if (context) {
              const target = context.messages.find((m) => m.id === aiMessageId);
              if (target) {
                target.imageRemoteUrl = assets.remoteUrl || target.imageRemoteUrl;
                target.thumbnail = assets.thumbnail ?? target.thumbnail;
              }
            }
          }

          return assets;
        });
      };

      const triggerLegacyMigration = (
        reason: string,
        markProjectDirty: boolean
      ) => {
        if (legacyMigrationInProgress) {
          return;
        }
        legacyMigrationInProgress = true;
        void (async () => {
          try {
            const contexts = contextManager.getAllSessions();
            const projectId =
              useProjectContentStore.getState().projectId ?? null;
            const migrated = await migrateLegacySessions(contexts, projectId);
            if (!migrated) {
              return;
            }

            const activeSessionId =
              get().currentSessionId ?? contextManager.getCurrentSessionId();
            if (activeSessionId) {
              const updatedContext = contextManager.getSession(activeSessionId);
              if (updatedContext) {
                set({ messages: [...updatedContext.messages] });
              }
            }

            await get().refreshSessions({ markProjectDirty });
          } catch (error) {
            console.error(`❌ ${reason} 会话迁移失败:`, error);
          } finally {
            legacyMigrationInProgress = false;
          }
        })();
      };

      const ensureActiveSession = (): string | null => {
        let sessionId =
          get().currentSessionId || contextManager.getCurrentSessionId();
        if (!sessionId) {
          sessionId = contextManager.createSession();
          set({ currentSessionId: sessionId });
        } else if (contextManager.getCurrentSessionId() !== sessionId) {
          contextManager.switchSession(sessionId);
        }
        return sessionId;
      };

      const rehydrateActiveSessionLocalVideos = async (
        sessionId: string | null
      ): Promise<void> => {
        if (!sessionId) return;
        revokeAllVideoObjectUrls();
        const changed = await hydrateSessionLocalVideoUrls(sessionId);
        if (!changed) return;
        const currentSessionId =
          get().currentSessionId || contextManager.getCurrentSessionId();
        if (currentSessionId !== sessionId) return;
        const context = contextManager.getSession(sessionId);
        if (!context) return;
        set({ messages: [...context.messages] });
      };

      const sanitizeImageInput = (value?: string | null): string | null => {
        if (!value) return null;
        // 先尝试标准化为 data URL
        const normalized = normalizeInlineImageData(value);
        if (normalized) return normalized;

        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) return null;

        // 支持其他有效的图片引用格式
        // flow-asset: IndexedDB 存储的图片
        // blob: 临时 blob URL
        // http/https: 远程 URL
        // projects/uploads/templates/videos: OSS key
        if (
          trimmed.startsWith("flow-asset:") ||
          trimmed.startsWith("blob:") ||
          /^https?:\/\//i.test(trimmed) ||
          /^(projects|uploads|templates|videos)\//i.test(trimmed)
        ) {
          console.log(`[sanitizeImageInput] 保留有效图片引用: ${trimmed.slice(0, 60)}...`);
          return trimmed;
        }

        return null;
      };

      const prefersAnalyzeForMultiImage = (prompt: string): boolean => {
        const text = (prompt || "").trim();
        if (!text) return false;
        const lower = text.toLowerCase();
        const keywords = [
          "analy",
          "analysis",
          "compare",
          "difference",
          "diff",
          "contrast",
          "inspect",
          "review",
          "分析",
          "对比",
          "比较",
          "相同点",
          "共同点",
          "不同点",
          "差异",
          "区别",
          "有什么不同",
        ];
        return keywords.some((keyword) =>
          keyword === keyword.toLowerCase()
            ? lower.includes(keyword)
            : text.includes(keyword)
        );
      };

      return {
        // 初始状态
        isVisible: true,
        isMaximized: false, // 默认不最大化
        currentInput: "",
        currentSessionId: null,
        sessions: [],
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: null,
        },
        messages: [],
        lastGeneratedImage: null,
        sourceImageForEditing: null, // 图生图源图像
        preciseEditContext: null,
        sourceImagesForBlending: [], // 多图融合源图像数组
        sourceImageForAnalysis: null, // 图像分析源图像
        sourcePdfForAnalysis: null, // PDF 分析源文件
        sourcePdfFileName: null,
        autoDownload: false, // 默认不自动下载
        enableWebSearch: false, // 默认关闭联网搜索
        imageOnly: false, // 默认允许返回文本
        aspectRatio: null, // 默认不指定长宽比
        imageSize: null, // 默认图像尺寸为自动（自动模式下优先使用1K）
        thinkingLevel: null, // 默认不指定思考级别
        videoAspectRatio: null,
        videoDurationSeconds: null,
        manualAIMode: "auto",
        autoSelectedTool: null,
        aiProvider: "banana-2.5", // 默认Fast版
        bananaImageRoute: "stable", // 默认走尊享（stable）路线
        autoModeMultiplier: 1,
        sendShortcut: "enter",
        expandedPanelStyle: "transparent", // 默认透明样式
        chatTheme: "white",

        // 对话框控制
        showDialog: () => {
          ensureActiveSession();
          set({ isVisible: true });
        },
        hideDialog: () => set({ isVisible: false }),
        toggleDialog: () => set((state) => ({ isVisible: !state.isVisible })),
        setIsMaximized: (value) => set({ isMaximized: value }),

        // 输入管理
        setCurrentInput: (input) => set({ currentInput: input }),
        clearInput: () => set({ currentInput: "" }),

        // 消息管理
        addMessage: (message) => {
          let sessionId = get().currentSessionId;

          if (!sessionId) {
            sessionId =
              contextManager.getCurrentSessionId() ||
              contextManager.createSession();
            set({ currentSessionId: sessionId });
          } else if (contextManager.getCurrentSessionId() !== sessionId) {
            contextManager.switchSession(sessionId);
          }

          let storedMessage: ChatMessage | null = null;
          const context = contextManager.getCurrentContext();
          const lastMessage = context?.messages[context.messages.length - 1];

          if (
            lastMessage &&
            lastMessage.type === message.type &&
            lastMessage.content === message.content
          ) {
            storedMessage = lastMessage;
          }

          if (!storedMessage) {
            storedMessage = contextManager.addMessage(message);
          }

          set((state) => {
            let nextMessages = state.messages.some(
              (msg) => msg.id === storedMessage!.id
            )
              ? state.messages
              : [...state.messages, storedMessage!];

            // 🛑 硬性限制消息数量 (P0 修复)
            if (nextMessages.length > MAX_MESSAGES_PER_SESSION) {
              nextMessages = nextMessages.slice(-MAX_MESSAGES_PER_SESSION);
            }

            // 🧹 内存优化：清理旧消息中的大型 Base64 (P0 修复)
            nextMessages = optimizeMessagesMemory(nextMessages);

            return { messages: nextMessages };
          });
          // 新消息（用户输入/占位消息）立即写入持久层，避免“刚发出就刷新导致丢失”
          void get().refreshSessions({ immediate: true });
          return storedMessage!;
        },

        clearMessages: () => {
          const currentMessages = get().messages;
          currentMessages.forEach((msg) => {
            if (msg.videoLocalUrl) {
              revokeVideoObjectUrlForMessage(msg.id);
            }
          });
          const state = get();
          const sessionId =
            state.currentSessionId || contextManager.getCurrentSessionId();
          if (sessionId) {
            const context = contextManager.getSession(sessionId);
            if (context) {
              context.messages = [];
              context.lastActivity = new Date();
            }
          }
          set({ messages: [] });
        },

        updateMessageStatus: (messageId, status) => {
          set((state) => ({
            messages: optimizeMessagesMemory(
              state.messages.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      generationStatus: {
                        ...(msg.generationStatus || {}),
                        ...status,
                      } as any,
                    }
                  : msg
              )
            ),
          }));

          // 同步更新到 contextManager
          const context = contextManager.getCurrentContext();
          if (context) {
            const message = context.messages.find((m) => m.id === messageId);
            if (message) {
              message.generationStatus = {
                ...(message.generationStatus || {}),
                ...status,
              } as any;
            }
          }

          // 派发占位符进度更新事件
          if (
            status &&
            typeof status.progress === "number" &&
            typeof window !== "undefined"
          ) {
            const placeholderId = `ai-placeholder-${messageId}`;
            try {
              window.dispatchEvent(
                new CustomEvent("updatePlaceholderProgress", {
                  detail: {
                    placeholderId,
                    progress: status.progress,
                  },
                })
              );
              // 占位框的清理交由生成/上传流程完成，避免在 100% 时提前移除导致落位信息丢失
            } catch (error) {
              placeholderLogger.warn("派发占位符进度更新事件失败", error);
            }
          }
        },

        updateMessage: (messageId, updater) => {
          set((state) => {
            const nextMessages = state.messages.map((msg) =>
              msg.id === messageId ? updater({ ...msg }) : msg
            );
            return {
              messages: optimizeMessagesMemory(nextMessages),
            };
          });

          const context = contextManager.getCurrentContext();
          if (context) {
            const index = context.messages.findIndex(
              (msg) => msg.id === messageId
            );
            if (index >= 0) {
              context.messages[index] = updater({ ...context.messages[index] });
            }
          }
        },

        refreshSessions: async (options) => {
          // 🔥 防止在水合过程中调用
          if (isHydratingNow) {
            return;
          }

          const executePersist = async (): Promise<void> => {
            const { markProjectDirty = true } = options ?? {};
            const listedSessions = contextManager.listSessions();
            const sessionSummaries = listedSessions.map((session) => ({
              sessionId: session.sessionId,
              name: session.name,
              lastActivity: session.lastActivity,
              messageCount: session.messageCount,
              preview: session.preview,
            }));

            // 🔥 异步序列化会话（上传图片到 OSS）
            const serializedSessionsPromises = listedSessions
              .map((session) =>
                contextManager.getSession(session.sessionId)
              )
              .filter(
                (context): context is ConversationContext => !!context
              )
              .map((context) => serializeConversation(context));

            const serializedSessions = await Promise.all(
              serializedSessionsPromises
            );

            set({ sessions: sessionSummaries });

            const activeSessionId =
              get().currentSessionId ??
              contextManager.getCurrentSessionId() ??
              null;

            if (markProjectDirty) {
              const projectStore = useProjectContentStore.getState();
              if (projectStore.projectId && projectStore.hydrated) {
                const previousSessions =
                  projectStore.content?.aiChatSessions ?? [];
                const previousActive =
                  projectStore.content?.aiChatActiveSessionId ?? null;
                if (
                  !sessionsEqual(previousSessions, serializedSessions) ||
                  (previousActive ?? null) !== (activeSessionId ?? null)
                ) {
                  projectStore.updatePartial(
                    {
                      aiChatSessions: serializedSessions,
                      aiChatActiveSessionId: activeSessionId ?? null,
                    },
                    { markDirty: true }
                  );
                }
              } else {
                // 无项目场景：把会话持久化到 IndexedDB
                writeSessionsToIDB(serializedSessions, activeSessionId);
              }
            }
          };

          const immediate = options?.immediate === true;
          if (immediate) {
            if (refreshSessionsTimeout) {
              clearTimeout(refreshSessionsTimeout);
              refreshSessionsTimeout = null;
            }
            await executePersist();
            return;
          }

          // 🔥 实现防抖：清除之前的定时器，300ms后执行
          if (refreshSessionsTimeout) {
            clearTimeout(refreshSessionsTimeout);
          }

          return new Promise<void>((resolve) => {
            refreshSessionsTimeout = setTimeout(async () => {
              try {
                await executePersist();
              } finally {
                refreshSessionsTimeout = null;
                resolve();
              }
            }, 300);
          });
        },

        createSession: async (name) => {
          const sessionId = contextManager.createSession(name);
          const context = contextManager.getCurrentContext();
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          void rehydrateActiveSessionLocalVideos(sessionId);
          get().refreshSessions();
          return sessionId;
        },

        switchSession: async (sessionId) => {
          const switched = contextManager.switchSession(sessionId);
          if (!switched) return;
          const context = contextManager.getSession(sessionId);
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          void rehydrateActiveSessionLocalVideos(sessionId);
          get().refreshSessions();
        },

        renameCurrentSession: async (name) => {
          const sessionId = get().currentSessionId;
          if (!sessionId) return;
          if (contextManager.renameSession(sessionId, name)) {
            get().refreshSessions();
          }
        },

        deleteSession: async (sessionId) => {
          const removed = contextManager.deleteSession(sessionId);
          if (!removed) return;

          const activeId = contextManager.getCurrentSessionId();
          let nextMessages: ChatMessage[] = [];
          if (activeId) {
            const context = contextManager.getSession(activeId);
            if (context) {
              nextMessages = [...context.messages];
            }
          }

          set({
            currentSessionId: activeId || null,
            messages: nextMessages,
          });
          void rehydrateActiveSessionLocalVideos(activeId || null);
          get().refreshSessions();
        },

        hydratePersistedSessions: (
          sessions,
          activeSessionId = null,
          options
        ) => {
          const markProjectDirty = options?.markProjectDirty ?? false;

          // 🔥 设置hydrating标记，防止refreshSessions被调用
          isHydratingNow = true;

          try {
            hasHydratedSessions = true;

            revokeAllVideoObjectUrls();
            contextManager.resetSessions();
            try {
              useImageHistoryStore.getState().clearHistory();
            } catch (error) {
              console.warn("⚠️ 清空图片历史失败:", error);
            }

            sessions.forEach((session) => {
              try {
                const context = deserializeConversation(session);
                contextManager.importSessionData(context);
              } catch (error) {
                console.error("❌ 导入会话失败:", error);
              }
            });

            try {
              const imageHistoryStore = useImageHistoryStore.getState();
              const projectId = useProjectContentStore.getState().projectId;
              const contexts = contextManager.getAllSessions();
              contexts.forEach((context) => {
                context.contextInfo.imageHistory.forEach((item) => {
                  const src =
                    item.imageRemoteUrl || item.imageData || item.thumbnail;
                  if (!src) return;
                  imageHistoryStore.addImage({
                    id: item.id,
                    src,
                    remoteUrl: item.imageRemoteUrl ?? undefined,
                    thumbnail: item.thumbnail ?? undefined,
                    title: item.prompt || "图片",
                    nodeId: item.parentImageId || item.id,
                    nodeType: "generate",
                    projectId,
                    timestamp: item.timestamp.getTime(),
                  });
                });
              });
            } catch (error) {
              console.warn("⚠️ 回填图片历史失败:", error);
            }

            const availableSessions = contextManager.listSessions();
            const candidateIds = new Set(
              availableSessions.map((session) => session.sessionId)
            );

            let targetSessionId: string | null = null;
            if (activeSessionId && candidateIds.has(activeSessionId)) {
              contextManager.switchSession(activeSessionId);
              targetSessionId = activeSessionId;
            } else if (availableSessions.length > 0) {
              const fallbackId = availableSessions[0].sessionId;
              contextManager.switchSession(fallbackId);
              targetSessionId = fallbackId;
            }

            if (!targetSessionId) {
              targetSessionId = contextManager.createSession();
            }

            const context = targetSessionId
              ? contextManager.getSession(targetSessionId)
              : null;
            set({
              currentSessionId: targetSessionId,
              messages: context ? [...context.messages] : [],
            });
            void rehydrateActiveSessionLocalVideos(targetSessionId);

            triggerLegacyMigration(
              "hydratePersistedSessions",
              markProjectDirty
            );
          } finally {
            // 🔥 清除hydrating标记，允许refreshSessions执行
            isHydratingNow = false;

            // 🔥 水合完成后，执行一次refreshSessions
            get().refreshSessions({ markProjectDirty });
          }
        },

        resetSessions: () => {
          // 🔥 防止在hydration期间重置
          if (isHydratingNow) {
            return;
          }

          revokeAllVideoObjectUrls();
          contextManager.resetSessions();

          const sessionId = contextManager.createSession();
          const context = contextManager.getSession(sessionId);
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          hasHydratedSessions = true;
          get().refreshSessions({ markProjectDirty: false });
        },

        // 图像生成主函数（支持并行）
        generateImage: async (
          prompt: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "generateImage entered");

          // 🔥 并行模式：不检查全局状态，每个请求独立
          // 🔥 立即增加正在生成的图片计数
          generatingImageCount++;

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成图像...",
              expectsImageOutput: true,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            // 添加用户消息
            state.addMessage({
              type: "user",
              content: prompt,
            });

            // 🔥 创建占位 AI 消息，带有初始生成状态
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成图像...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              expectsImageOutput: true,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }

          const placeholderId = `ai-placeholder-${aiMessageId}`;
          const removePredictivePlaceholder = () => {
            dispatchPlaceholderEvent(
              {
                placeholderId,
                center: { x: 0, y: 0 },
                width: 0,
                height: 0,
                operationType: "generate",
              },
              "remove"
            );
          };

          try {
            const cached = contextManager.getCachedImage();
            const offsetHorizontal =
              useUIStore.getState().smartPlacementOffsetHorizontal || 522;
            const offsetVertical =
              useUIStore.getState().smartPlacementOffsetVertical || 552;
            let center: { x: number; y: number } | null = null;

            // 🔥 检查是否是并行生成的一部分
            const currentMsg = get().messages.find((m) => m.id === aiMessageId);
            const groupId = currentMsg?.groupId;
            const groupIndex = currentMsg?.groupIndex ?? 0;
            const groupTotal = currentMsg?.groupTotal ?? 1;
            const isParallelGeneration = groupTotal > 1;
            let layoutAnchor: { x: number; y: number } | null = null;

            placeholderLogger.debug(
              "🎯 [generateImage] 准备显示占位符, cached:",
              cached,
              "groupIndex:",
              groupIndex,
              "groupTotal:",
              groupTotal
            );

            if (isParallelGeneration) {
              // 🔥 并行生成：根据 groupIndex 计算不同的位置，避免重叠
              // X4模式：4张图片横向排列成一行
              // 基准位置：缓存图片下方或视口中心
              let baseX: number;
              let baseY: number;

              if (cached?.bounds) {
                // 基于缓存图片位置，在其下方开始新的一行
                baseX = cached.bounds.x + cached.bounds.width / 2;
                baseY =
                  cached.bounds.y + cached.bounds.height / 2 + offsetVertical;
              } else {
                const viewCenter = getViewCenter();
                baseX = viewCenter?.x ?? 0;
                baseY = viewCenter?.y ?? 0;
              }

              layoutAnchor = { x: baseX, y: baseY };

              // 横向排列：每张图片向右偏移 offsetHorizontal
              // groupIndex: 0, 1, 2, 3 -> 横向排列
              center = {
                x: baseX + groupIndex * offsetHorizontal,
                y: baseY,
              };
              placeholderLogger.debug(
                `🎯 [generateImage] 并行生成第${
                  groupIndex + 1
                }/${groupTotal}张，横向排列位置:`,
                center
              );
            } else {
              // 单张生成：使用原有逻辑
              if (cached?.bounds) {
                center = {
                  x:
                    cached.bounds.x +
                    cached.bounds.width / 2 +
                    offsetHorizontal,
                  y: cached.bounds.y + cached.bounds.height / 2,
                };
                layoutAnchor = { ...center };
                placeholderLogger.debug(
                  "🎯 [generateImage] 使用缓存图片位置:",
                  center
                );
              } else {
                center = getViewCenter();
                layoutAnchor = center ? { ...center } : null;
                placeholderLogger.debug(
                  "🎯 [generateImage] 使用视口中心:",
                  center
                );
              }
            }

            // 如果 center 仍然为 null，使用默认位置 (0, 0)
            if (!center) {
              center = { x: 0, y: 0 };
              placeholderLogger.debug("🎯 [generateImage] 使用默认位置 (0, 0)");
            }

            const size = estimatePlaceholderSize({
              aspectRatio: state.aspectRatio,
              imageSize: state.imageSize,
              fallbackBounds: cached?.bounds ?? null,
            });
            placeholderLogger.debug("🎯 [generateImage] 占位符尺寸:", size);

            const smartPosition = center ? { ...center } : undefined;

            dispatchPlaceholderEvent({
              placeholderId,
              center,
              width: size.width,
              height: size.height,
              operationType: "generate",
              preferSmartLayout: true,
              smartPosition,
              groupId,
              groupIndex,
              groupTotal,
              preferHorizontal: isParallelGeneration,
              groupAnchor: layoutAnchor || undefined,
            });
          } catch (error) {
            placeholderLogger.warn("预测占位符生成失败", error);
          }

          let progressInterval: ReturnType<typeof setInterval> | null = null;
          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在生成",
            });

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "generateImage progress interval start");
            const PROGRESS_MAX = 95;
            const PROGRESS_INCREMENT = PROGRESS_MAX / 120; // 约0.79%每秒
            progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX) {
                if (progressInterval) clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX,
                currentProgress + PROGRESS_INCREMENT
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 联网开启时，Ultra 强制走 nano2(apimart gemini-3.1) 以对齐 Nano2 节点行为。
            const effectiveProvider: AIProviderType =
              state.aiProvider === "banana-3.1" && state.enableWebSearch
                ? "nano2"
                : state.aiProvider;
            // nano2 与 banana-3.1 使用同一 3.1 图像模型名
            const modelToUse =
              effectiveProvider === "nano2"
                ? BANANA_31_IMAGE_MODEL
                : getImageModelForProvider(effectiveProvider);
            const enableWebSearchForRequest =
              effectiveProvider === "nano2"
                ? undefined
                : state.enableWebSearch;
            logProcessStep(
              metrics,
              `generateImage calling API (${modelToUse}, provider=${effectiveProvider})`
            );

            let providerOptions: AIProviderOptions | undefined;

            if (state.aiProvider === "runninghub") {
              const suSource = state.sourceImageForEditing;
              if (!suSource) {
                throw new Error(
                  "运行 RunningHub 转换前请先提供一张 SU 截图作为源图像。"
                );
              }

              const projectId = useProjectContentStore.getState().projectId;
              const stageUpdater: RunningHubStageUpdater = (
                stage,
                progress
              ) => {
                const statusUpdate: Partial<ChatMessage["generationStatus"]> = {
                  isGenerating: true,
                  error: null,
                  stage,
                };
                if (typeof progress === "number") {
                  statusUpdate.progress = progress;
                }
                get().updateMessageStatus(aiMessageId!, statusUpdate);
              };

              providerOptions = await buildRunningHubProviderOptions({
                primaryImage: suSource,
                referenceImage: state.sourceImagesForBlending?.[0],
                projectId,
                onStageUpdate: stageUpdater,
              });
            }

            // 🔍 调试日志：打印实际发送的参数
            console.log("🎨 [Generate Image] 请求参数:", {
              aiProvider: effectiveProvider,
              model: modelToUse,
              imageSize: state.imageSize ?? "1K",
              aspectRatio: state.aspectRatio || "auto",
              thinkingLevel: state.thinkingLevel || "auto",
              imageOnly: state.imageOnly,
              enableWebSearch: enableWebSearchForRequest,
              prompt: prompt.substring(0, 50) + "...",
            });

            providerOptions = withBananaRouteProviderOptions(
              effectiveProvider,
              providerOptions,
              state.bananaImageRoute
            );

            const currentMessageForRequest = get().messages.find(
              (m) => m.id === aiMessageId
            );
            const parallelGroupId = currentMessageForRequest?.groupId;
            const parallelGroupIndex = currentMessageForRequest?.groupIndex ?? 0;
            const parallelGroupTotal = currentMessageForRequest?.groupTotal ?? 1;

            const generateRequest =
              effectiveProvider === "nano2"
                ? {
                    // 与 Nano2 节点保持同一请求字段集合
                    prompt,
                    aiProvider: "nano2" as const,
                    providerOptions,
                    aspectRatio: state.aspectRatio || undefined,
                    imageSize: state.imageSize ?? "1K",
                    outputImageCount: parallelGroupTotal > 1 ? parallelGroupTotal : undefined,
                    parallelGroupId,
                    parallelGroupIndex,
                    parallelGroupTotal,
                    googleSearch: state.enableWebSearch,
                    googleImageSearch: state.enableWebSearch,
                  }
                : {
                    prompt,
                    model: modelToUse,
                    aiProvider: effectiveProvider,
                    providerOptions,
                    outputFormat: "png" as const,
                    aspectRatio: state.aspectRatio || undefined,
                    imageSize: state.imageSize ?? "1K", // 自动模式下优先使用1K
                    thinkingLevel: state.thinkingLevel || undefined,
                    imageOnly: state.imageOnly,
                    outputImageCount: parallelGroupTotal > 1 ? parallelGroupTotal : undefined,
                    parallelGroupId,
                    parallelGroupIndex,
                    parallelGroupTotal,
                    ...(enableWebSearchForRequest !== undefined
                      ? { enableWebSearch: enableWebSearchForRequest }
                      : {}),
                    // 对齐 Nano2：联网开关开启时，同时启用文本检索和图片检索参数
                    googleSearch: state.enableWebSearch,
                    googleImageSearch: state.enableWebSearch,
                  };

            const result = await generateImageViaAPI(generateRequest);
            logProcessStep(metrics, "generateImage API response received");

            if (progressInterval) clearInterval(progressInterval);

            if (result.success && result.data) {
              // 生成成功 - 更新消息内容和状态
              const rawTextResponse = (result.data.textResponse || "").trim();
              const normalizedTextResponse = rawTextResponse.toLowerCase();
              const isPlaceholderText =
                normalizedTextResponse === "image generated successfully" ||
                normalizedTextResponse === "generated successfully";
              const shouldUseTextResponse =
                typeof rawTextResponse === "string" &&
                rawTextResponse.length > 0 &&
                !isPlaceholderText;
              const messageContent = shouldUseTextResponse
                ? rawTextResponse
                : result.data.hasImage
                ? `已生成图像: ${prompt}`
                : `无法生成图像: ${prompt}`;

              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;

              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          // 避免把完整 base64 同时存两份（imageData + thumbnail），缩略图由后续异步流程生成/回填
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: state.aiProvider,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));
              logProcessStep(metrics, "editImage message updated");
              logProcessStep(metrics, "generateImage message updated");

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = messageContent;
                  // 避免在 contextManager 里长期保留完整 base64（内存会线性增长）
                  message.imageData = imageRemoteUrl ? undefined : inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  if (imageRemoteUrl) {
                    message.thumbnail = imageRemoteUrl;
                  }
                  message.imageRemoteUrl =
                    imageRemoteUrl || message.imageRemoteUrl;
                  message.metadata = result.data?.metadata;
                  message.provider = state.aiProvider;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // ========== 🔥 清晰的异步流程设计 ==========
              // 步骤1：立即更新对话框显示（使用 base64，不等待上传）- 已在上面完成
              // 步骤2：计算 placementImageData（优先远程URL，否则 dataURL）
              // 步骤3：发送到画布（使用远程URL / dataURL，禁用 blob 显示链路）
              // 步骤4：异步上传到OSS（后台进行，不阻塞显示）
              // 注意：消息状态已在步骤1中更新（generationStatus: { isGenerating: false, progress: 100 }），无需重复更新

              // 步骤2：计算 placementImageData
              const placementImageData = resolveImageForPlacement({
                inlineData: inlineImageData,
                result: result.data,
                fallbackRemote: imageRemoteUrl ?? null,
              });

              // 如果没有可用的图像源，记录原因并返回
              if (!placementImageData) {
                console.warn(
                  "⚠️ [generateImage] 没有可用的图像源，无法显示到画布"
                );
                const noImageSourceError =
                  "生成成功但未获取到可渲染图片资源，请重试";
                if (aiMessageId) {
                  get().updateMessageStatus(aiMessageId, {
                    isGenerating: false,
                    progress: 0,
                    error: noImageSourceError,
                  });
                }
                removePredictivePlaceholder();
                return;
              }

              console.log(
                "✅ [generateImage] 步骤1-2完成：对话框已更新，placementImageData已计算"
              );

              // 步骤3：发送到画布（不等待上传）
              set({ lastGeneratedImage: result.data });

              // 自动添加到画布中央 - 使用快速上传工具的逻辑
              const addImageToCanvas = (
                aiResult: AIImageResult,
                imageSrc: string,
                isParallel: boolean = false,
                parallelGroupInfo?: {
                  groupId: string;
                  groupIndex: number;
                  groupTotal: number;
                }
              ) => {
                const fileName = `${prompt.substring(0, 20)}.${
                  aiResult.metadata?.outputFormat || "png"
                }`;
                const imagePayload = buildImagePayloadForUpload(
                  imageSrc,
                  fileName
                );

                // 优先使用占位框位置；让 quick upload 根据 placeholderId 查找并自适应
                let smartPosition: { x: number; y: number } | undefined =
                  undefined;

                // 直接触发快速上传事件，复用现有的上传逻辑，添加智能排版信息
                window.dispatchEvent(
                  new CustomEvent("triggerQuickImageUpload", {
                    detail: {
                      imageData: imagePayload,
                      fileName: fileName,
                      operationType: "generate",
                      smartPosition,
                      sourceImageId: undefined,
                      sourceImages: undefined,
                      placeholderId,
                      preferHorizontal: isParallel, // 🔥 并行生成时使用横向排列
                      // 🔥 传递并行生成分组信息，用于自动打组
                      parallelGroupId: parallelGroupInfo?.groupId,
                      parallelGroupIndex: parallelGroupInfo?.groupIndex,
                      parallelGroupTotal: parallelGroupInfo?.groupTotal,
                    },
                  })
                );
              };

              // 🔥 从消息中获取 groupIndex，为并行生成的图片添加递增延迟，避免并发冲突
              const currentMsg = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const groupId = currentMsg?.groupId;
              const groupIndex = currentMsg?.groupIndex ?? 0;
              const groupTotal = currentMsg?.groupTotal ?? 1;
              const isParallel = groupTotal > 1; // 🔥 判断是否是并行生成
              const baseDelay = 100;
              const perImageDelay = 300; // 每张图片额外延迟 300ms
              const totalDelay = baseDelay + groupIndex * perImageDelay;

              setTimeout(() => {
                if (result.data) {
                  console.log(
                    `✅ [generateImage] 步骤3执行：发送图片到画布 (延迟${totalDelay}ms, 并行模式: ${isParallel})`
                  );
                  // 🔥 传递并行生成分组信息，用于 X4/X8 自动打组
                  const parallelGroupInfo =
                    isParallel && groupId
                      ? {
                          groupId,
                          groupIndex,
                          groupTotal,
                        }
                      : undefined;
                  addImageToCanvas(
                    result.data,
                    placementImageData,
                    isParallel,
                    parallelGroupInfo
                  );
                }
              }, totalDelay); // 递增延迟，避免并行图片同时添加到画布

              // 步骤4：异步上传历史记录（后台进行，不阻塞显示）
              if (inlineImageData || imageRemoteUrl) {
                const resultForCache: AIImageResult = {
                  ...result.data,
                  imageData: undefined,
                };
                // 不等待上传完成，立即继续
                registerMessageImageHistory({
                  aiMessageId,
                  prompt,
                  result: result.data,
                  operationType: "generate",
                  aiProvider: state.aiProvider,
                  skipPreview: isParallel || state.imageSize === "4K",
                })
                  .then((assets) => {
                    console.log(
                      "✅ [generateImage] 步骤4完成：图片已上传到OSS，remoteUrl:",
                      assets?.remoteUrl?.substring(0, 50)
                    );
                    // 上传完成后更新缓存，但不影响已显示的图片
                    if (assets?.remoteUrl) {
                      cacheGeneratedImageResult({
                        messageId: aiMessageId,
                        prompt,
                        result: resultForCache,
                        assets,
                      });
                    }

                    // 🔥 内存优化：在图片成功上传后，延迟清空 imageData，只保留 thumbnail
                    // 等待画布显示完成（延迟时间 = 画布延迟 + 图片加载时间 + 缓冲）
                    const canvasDisplayDelay = totalDelay + 1000; // 画布延迟 + 1秒缓冲
                    const memoryOptimizationDelay = canvasDisplayDelay + 2000; // 再延迟2秒确保画布已显示

                    setTimeout(() => {
                      const currentState = get();
                      const message = currentState.messages.find(
                        (m) => m.id === aiMessageId
                      );
                      if (!message) return;

                      // 只有在有 thumbnail 和 remoteUrl 的情况下才清空 imageData
                      const hasThumbnail =
                        message.thumbnail && message.thumbnail.length > 0;
                      const hasRemoteUrl =
                        message.imageRemoteUrl &&
                        message.imageRemoteUrl.startsWith("http");
                      const imageDataSize = message.imageData?.length || 0;
                      const thumbnailSize = message.thumbnail?.length || 0;

                      // 如果满足条件：有thumbnail和remoteUrl，且imageData明显大于thumbnail
                      if (
                        hasThumbnail &&
                        hasRemoteUrl &&
                        imageDataSize > thumbnailSize * 2
                      ) {
                        const savedKB = (
                          (imageDataSize - thumbnailSize) /
                          1024
                        ).toFixed(2);
                        console.log(
                          `🧹 [内存优化] 清空消息 ${aiMessageId} 的 imageData，保留 thumbnail 和 remoteUrl`,
                          {
                            imageDataSize:
                              (imageDataSize / 1024).toFixed(2) + "KB",
                            thumbnailSize:
                              (thumbnailSize / 1024).toFixed(2) + "KB",
                            saved: savedKB + "KB",
                          }
                        );

                        get().updateMessage(aiMessageId, (msg) => ({
                          ...msg,
                          imageData: undefined, // 清空完整的 base64，只保留 thumbnail
                        }));

                        const context = contextManager.getCurrentContext();
                        if (context) {
                          const target = context.messages.find(
                            (m) => m.id === aiMessageId
                          );
                          if (target) {
                            target.imageData = undefined;
                          }
                        }
                      }
                    }, memoryOptimizationDelay);
                  })
                  .catch((error) => {
                    console.warn(
                      "⚠️ [generateImage] 步骤4失败：上传图片历史记录失败:",
                      error
                    );
                  });
              } else {
                // 如果没有 inlineImageData，直接缓存
                cacheGeneratedImageResult({
                  messageId: aiMessageId,
                  prompt,
                  result: result.data,
                  assets: undefined,
                  inlineImageData,
                });
              }

              await get().refreshSessions();
              logProcessStep(metrics, "generateImage completed");

              // 可选：自动下载图片到用户的默认下载文件夹
              const downloadImageData = (
                imageData: string,
                prompt: string,
                autoDownload: boolean = false
              ) => {
                if (!autoDownload) {
                  return;
                }

                try {
                  const mimeType = `image/${
                    result.data?.metadata?.outputFormat || "png"
                  }`;
                  const imageDataUrl = `data:${mimeType};base64,${imageData}`;

                  const link = document.createElement("a");
                  link.href = imageDataUrl;

                  // 生成文件名
                  const timestamp = new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-");
                  const promptSafeString = prompt
                    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
                    .substring(0, 30);
                  const extension =
                    result.data?.metadata?.outputFormat || "png";

                  link.download = `ai_generated_${promptSafeString}_${timestamp}.${extension}`;

                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                } catch (error) {
                  console.error("❌ 下载图像失败:", error);
                }
              };

              // 根据配置决定是否自动下载（仅当有图像时）
              const currentState = get();
              if (inlineImageData) {
                downloadImageData(
                  inlineImageData,
                  prompt,
                  currentState.autoDownload
                );
              }

              // 取消自动关闭对话框 - 保持对话框打开状态
              // setTimeout(() => {
              //   get().hideDialog();
              //
              // }, 100); // 延迟0.1秒关闭，让用户看到生成完成的消息
            } else {
              // 生成失败 - 更新消息状态为错误
              const errorMessage = result.error?.message || "图像生成失败";

              get().updateMessageStatus(aiMessageId, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });

              console.error("❌ 图像生成失败:", errorMessage);
              removePredictivePlaceholder();
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            // 🔥 更新消息状态为错误
            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图像生成异常:", error);
            removePredictivePlaceholder();
          } finally {
            if (progressInterval) clearInterval(progressInterval);
            // 🔥 无论成功失败，都减少正在生成的图片计数
            generatingImageCount--;
            logProcessStep(metrics, "generateImage finished (finally)");
          }
        },

        // 图生图功能（支持并行）
        editImage: async (
          prompt: string,
          sourceImage: string,
          showImagePlaceholder: boolean = true,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const preciseEditContext = state.preciseEditContext;
          const metrics = options?.metrics;
          logProcessStep(metrics, "editImage entered");

          // 🔥 并行模式：不检查全局状态
          const displaySourceImage = showImagePlaceholder
            ? toRenderableImageSrc(sourceImage)
            : null;

          const override = options?.override;
          let aiMessageId: string | undefined;
          const currentMsg = override
            ? get().messages.find((m) => m.id === override.aiMessageId)
            : null;
          const groupId = currentMsg?.groupId;
          const groupIndex = currentMsg?.groupIndex ?? 0;
          const groupTotal = currentMsg?.groupTotal ?? 1;
          const isParallelEdit = groupTotal > 1;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: `编辑图像: ${prompt}`,
              sourceImageData: showImagePlaceholder
                ? displaySourceImage ?? msg.sourceImageData
                : msg.sourceImageData,
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在编辑图像...",
              expectsImageOutput: true,
              sourceImageData: showImagePlaceholder
                ? displaySourceImage ?? msg.sourceImageData
                : msg.sourceImageData,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            // 添加用户消息
            const messageData: any = {
              type: "user",
              content: `编辑图像: ${prompt}`,
            };

            if (showImagePlaceholder) {
              messageData.sourceImageData = displaySourceImage ?? undefined;
            }

            state.addMessage(messageData);

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在编辑图像...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              expectsImageOutput: true,
              sourceImageData: showImagePlaceholder
                ? displaySourceImage ?? undefined
                : undefined,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }

          const placeholderId = `ai-placeholder-${aiMessageId}`;
          const removePredictivePlaceholder = () => {
            dispatchPlaceholderEvent(
              {
                placeholderId,
                center: { x: 0, y: 0 },
                width: 0,
                height: 0,
                operationType: "edit",
              },
              "remove"
            );
          };

          try {
            let selectedImageBounds: {
              x: number;
              y: number;
              width: number;
              height: number;
            } | null = null;
            let selectedImageId: string | null = null;
            try {
              if ((window as any).tanvaImageInstances) {
                const selectedImage = (window as any).tanvaImageInstances.find(
                  (img: any) => img.isSelected
                );
                if (selectedImage?.bounds) {
                  selectedImageBounds = selectedImage.bounds;
                  if (typeof selectedImage.id === "string" && selectedImage.id) {
                    selectedImageId = selectedImage.id;
                  }
                }
              }
            } catch {}

            const cached = contextManager.getCachedImage();
            const offsetHorizontal =
              useUIStore.getState().smartPlacementOffsetHorizontal || 522;
            let center: { x: number; y: number } | null = null;

            // 编辑锚点优先使用“当前选中图”，避免误用缓存图导致向右下偏移
            if (selectedImageBounds) {
              center = {
                x:
                  selectedImageBounds.x +
                  selectedImageBounds.width / 2 +
                  offsetHorizontal,
                y: selectedImageBounds.y + selectedImageBounds.height / 2,
              };
            } else if (cached?.bounds) {
              center = {
                x: cached.bounds.x + cached.bounds.width / 2 + offsetHorizontal,
                y: cached.bounds.y + cached.bounds.height / 2,
              };
            } else {
              center = getViewCenter();
            }

            if (center) {
              const size = estimatePlaceholderSize({
                aspectRatio: state.aspectRatio,
                imageSize: state.imageSize,
                fallbackBounds: selectedImageBounds ?? cached?.bounds ?? null,
              });

              dispatchPlaceholderEvent({
                placeholderId,
                center,
                width: size.width,
                height: size.height,
                operationType: "edit",
                preferSmartLayout: true,
                sourceImageId: selectedImageId || cached?.imageId,
                smartPosition: center ? { ...center } : undefined,
                groupId,
                groupIndex,
                groupTotal,
                preferHorizontal: isParallelEdit,
                groupAnchor: center ? { ...center } : undefined,
              });
            }
          } catch (error) {
            placeholderLogger.warn("预测编辑占位符生成失败", error);
          }

          logProcessStep(metrics, "editImage message prepared");

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在编辑",
            });

            // 🔥 统一改为先上传到 OSS，用 URL 传给后端（避免大 base64 中转占用内存/带宽）
            const projectIdEdit = useProjectContentStore.getState().projectId;
            const remoteSourceUrl = normalizeRemoteUrl(sourceImage);
            const remoteSourceAllowed = Boolean(
              remoteSourceUrl &&
                isLikelyBackendAllowedRemoteUrl(remoteSourceUrl)
            );
            let sourceImageUrlForBackend: string | undefined;
            if (state.aiProvider === "runninghub") {
              // RunningHub 走 providerOptions，不从这里取 URL
            } else if (remoteSourceUrl && remoteSourceAllowed) {
              sourceImageUrlForBackend = remoteSourceUrl;
            } else {
              const uploadedUrl = await uploadImageToOSS(sourceImage, projectIdEdit);
              if (uploadedUrl) {
                sourceImageUrlForBackend = uploadedUrl;
              } else if (remoteSourceUrl && !remoteSourceAllowed) {
                throw new Error(
                  "源图 URL 域名不在后端白名单，且上传失败。请先上传到画布/素材库后重试。"
                );
              } else {
                throw new Error("源图上传 OSS 失败，请重新选择图片。");
              }
            }

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "editImage progress interval start");
            const PROGRESS_MAX_EDIT = 95;
            const PROGRESS_INCREMENT_EDIT = PROGRESS_MAX_EDIT / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_EDIT) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_EDIT,
                currentProgress + PROGRESS_INCREMENT_EDIT
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API编辑图像
            const modelToUse = getImageModelForProvider(state.aiProvider);
            logProcessStep(metrics, `editImage calling API (${modelToUse})`);

            let providerOptions: AIProviderOptions | undefined;

            if (state.aiProvider === "runninghub") {
              const projectId = useProjectContentStore.getState().projectId;
              const stageUpdater: RunningHubStageUpdater = (
                stage,
                progress
              ) => {
                const statusUpdate: Partial<ChatMessage["generationStatus"]> = {
                  isGenerating: true,
                  error: null,
                  stage,
                };
                if (typeof progress === "number") {
                  statusUpdate.progress = progress;
                }
                get().updateMessageStatus(aiMessageId!, statusUpdate);
              };

              const normalizedSourceImage = await resolveImageToDataUrl(sourceImage);
              providerOptions = await buildRunningHubProviderOptions({
                primaryImage: normalizedSourceImage || '',
                referenceImage: state.sourceImagesForBlending?.[0],
                projectId,
                onStageUpdate: stageUpdater,
              });
            }

            providerOptions = withBananaRouteProviderOptions(
              state.aiProvider,
              providerOptions,
              state.bananaImageRoute
            );

            const buildEditRequest = async (model: string): Promise<AIImageEditRequest> => ({
              prompt,
              sourceImage: state.aiProvider === "runninghub"
                ? (await resolveImageToDataUrl(sourceImage)) || undefined
                : undefined,
              sourceImageUrl: sourceImageUrlForBackend,
              model,
              aiProvider: state.aiProvider,
              providerOptions,
              outputFormat: "png",
              aspectRatio: state.aspectRatio || undefined,
              imageSize: state.imageSize ?? "1K", // 自动模式下优先使用1K
              thinkingLevel: state.thinkingLevel || undefined,
              imageOnly: state.imageOnly,
              parallelGroupId: groupId,
              parallelGroupIndex: groupIndex,
              parallelGroupTotal: groupTotal,
            });

            // 🔍 调试日志：打印实际发送的参数
            console.log("✏️ [Edit Image] 请求参数:", {
              aiProvider: state.aiProvider,
              model: modelToUse,
              imageSize: state.imageSize ?? "1K",
              aspectRatio: state.aspectRatio || "auto",
              thinkingLevel: state.thinkingLevel || "auto",
              imageOnly: state.imageOnly,
              prompt: prompt.substring(0, 50) + "...",
            });

            let result = await editImageViaAPI(await buildEditRequest(modelToUse));

            clearInterval(progressInterval);

            logProcessStep(metrics, "editImage API response received");

            if (
              !result.success &&
              shouldFallbackToGeminiFlash(
                state.aiProvider,
                modelToUse,
                result.error
              )
            ) {
              console.warn(
                "⚠️ Gemini Pro 编辑失败，准备自动降级到 Gemini 2.5 Flash 模型",
                {
                  errorCode: result.error?.code,
                  errorMessage: result.error?.message,
                }
              );
              logProcessStep(metrics, "editImage fallback triggered");

              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 35;
              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: Math.max(currentProgress, 35),
                error: null,
                stage: "降级 Gemini 2.5 Flash",
              });

              result = await editImageViaAPI(
                await buildEditRequest(GEMINI_FLASH_IMAGE_MODEL)
              );
              logProcessStep(metrics, "editImage fallback response received");

              if (result.success) {
              } else {
                console.error(
                  "❌ Gemini 2.5 Flash 降级编辑仍然失败:",
                  result.error
                );
              }
            }

            if (result.success && result.data) {
              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;
              // 编辑成功 - 更新消息内容和状态
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已编辑图像: ${prompt}`
                  : `无法编辑图像: ${prompt}`);

              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: state.aiProvider,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = messageContent;
                  // 避免在 contextManager 里长期保留完整 base64（内存会线性增长）
                  message.imageData = imageRemoteUrl ? undefined : inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  if (imageRemoteUrl) {
                    message.thumbnail = imageRemoteUrl;
                  }
                  message.imageRemoteUrl =
                    imageRemoteUrl || message.imageRemoteUrl;
                  message.metadata = result.data?.metadata;
                  message.provider = state.aiProvider;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // Prefer remote URL for canvas placement to avoid base64 memory usage.
              const placementImageData = resolveImageForPlacement({
                inlineData: inlineImageData,
                result: result.data,
                fallbackRemote: imageRemoteUrl ?? null,
              });

              if (!placementImageData) {
                console.warn("⚠️ [editImage] 没有可用的图像源，无法显示到画布");
                const noImageSourceError =
                  "编辑成功但未获取到可渲染图片资源，请重试";
                if (aiMessageId) {
                  get().updateMessageStatus(aiMessageId, {
                    isGenerating: false,
                    progress: 0,
                    error: noImageSourceError,
                  });
                }
                removePredictivePlaceholder();
                return;
              }

              console.log(
                "✅ [editImage] 步骤1-2完成：对话框已更新，placementImageData已计算"
              );

              // 先更新 lastGeneratedImage，不等待上传/历史记录
              set({ lastGeneratedImage: result.data });

              // 自动添加到画布
              const addImageToCanvas = (
                aiResult: AIImageResult,
                imageSrc: string,
                isParallel: boolean = false,
                parallelGroupInfo?: {
                  groupId: string;
                  groupIndex: number;
                  groupTotal: number;
                }
              ) => {
                const fileName = `${prompt.substring(0, 20)}.${
                  aiResult.metadata?.outputFormat || "png"
                }`;
                const imagePayload = buildImagePayloadForUpload(
                  imageSrc,
                  fileName
                );

                // 🎯 获取当前选中图片的ID和边界信息用于智能排版
                let selectedImageBounds = null;
                let sourceImageId = null;
                try {
                  if ((window as any).tanvaImageInstances) {
                    const selectedImage = (
                      window as any
                    ).tanvaImageInstances.find((img: any) => img.isSelected);
                    if (selectedImage) {
                      selectedImageBounds = selectedImage.bounds;
                      sourceImageId = selectedImage.id;
                    }
                  }
                } catch (error) {
                  console.warn("获取选中图片信息失败:", error);
                }

                // 让 quick upload 根据 placeholderId/选中图自动定位，避免硬编码向右偏移导致跳位
                let smartPosition: { x: number; y: number } | undefined =
                  undefined;

                window.dispatchEvent(
                  new CustomEvent("triggerQuickImageUpload", {
                    detail: {
                      imageData: imagePayload,
                      fileName: fileName,
                      selectedImageBounds: selectedImageBounds, // 保持兼容性
                      operationType: "edit",
                      smartPosition,
                      sourceImageId: sourceImageId,
                      sourceImages: undefined,
                      placeholderId,
                      preferHorizontal: isParallelEdit,
                      // 🔥 传递并行生成分组信息，用于自动打组
                      parallelGroupId: parallelGroupInfo?.groupId,
                      parallelGroupIndex: parallelGroupInfo?.groupIndex,
                      parallelGroupTotal: parallelGroupInfo?.groupTotal,
                    },
                  })
                );
              };

	              // 🔥 传递并行编辑分组信息，用于自动打组
	              const editParallelGroupInfo =
	                isParallelEdit && groupId
	                  ? {
	                      groupId,
	                      groupIndex,
	                      groupTotal,
	                    }
	                  : undefined;

	              // 并行编辑：为每张图加递增延迟，避免同时上画布导致冲突
	              const baseDelay = 100;
	              const perImageDelay = 300;
	              const totalDelay = baseDelay + groupIndex * perImageDelay;
	              let usedPreciseOverlay = false;

		              if (
		                preciseEditContext &&
		                preciseEditContext.targetImageId &&
		                preciseEditContext.targetImageSource
		              ) {
		                try {
		                  const baseImageSources = collectPreciseBaseSourceCandidates(
		                    preciseEditContext.targetImageId,
		                    preciseEditContext.targetImageSource
		                  );
		                  const patchImageSources: string[] = [];
		                  appendImageSourceCandidate(patchImageSources, placementImageData);
		                  appendImageSourceCandidate(patchImageSources, inlineImageData);
		                  appendImageSourceCandidate(
		                    patchImageSources,
		                    result.data?.imageData
		                  );
		                  appendImageSourceCandidate(patchImageSources, imageRemoteUrl);
		                  appendImageSourceCandidate(
		                    patchImageSources,
		                    getResultImageRemoteUrl(result.data)
		                  );
		                  const mergedBlob = await mergePrecisePatchWithFallback({
		                    baseImageSources,
		                    patchImageSources,
		                    cropRectNormalized: preciseEditContext.cropRectNormalized,
		                  });
		                  if (mergedBlob) {
		                    const mergedDataUrl = await blobToDataUrlLimited(mergedBlob);
		                    try {
	                      window.dispatchEvent(
	                        new CustomEvent("canvas:replace-image-source", {
	                          detail: {
	                            imageId: preciseEditContext.targetImageId,
	                            source: mergedDataUrl,
	                            contentType: "image/png",
	                            fileName: `${prompt.substring(0, 20) || "precise"}_merged.png`,
	                            historyLabel: "precise-edit",
	                          },
	                        })
	                      );
	                      usedPreciseOverlay = true;
	                    } catch {
	                      // ignore
	                    }
		                  } else {
		                    console.warn("⚠️ 精准微调回贴失败：未能合成局部覆盖图");
		                  }
		                } catch (error) {
		                  console.warn("⚠️ 精准微调回贴失败，回退普通上画布:", error);
		                }
		              }

	              // 精准微调上下文只消费一次，避免后续请求误用
	              if (preciseEditContext) {
	                set({ preciseEditContext: null });
	              }

	              if (usedPreciseOverlay) {
	                removePredictivePlaceholder();
	              } else {
	                setTimeout(() => {
	                  if (result.data) {
	                    console.log(
	                      `✅ [editImage] 步骤3执行：发送图片到画布 (延迟${totalDelay}ms, 并行模式: ${isParallelEdit})`
	                    );
	                    addImageToCanvas(
	                      result.data,
	                      placementImageData,
	                      isParallelEdit,
	                      editParallelGroupInfo
	                    );
	                  }
	                }, totalDelay);
	              }

              // 步骤4：异步上传历史记录（后台进行，不阻塞上画布）
              if (inlineImageData || imageRemoteUrl) {
                const resultForCache: AIImageResult = {
                  ...result.data!,
                  imageData: undefined,
                };
                registerMessageImageHistory({
                  aiMessageId,
                  prompt,
                  result: result.data,
                  operationType: "edit",
                  aiProvider: state.aiProvider,
                  skipPreview: isParallelEdit || state.imageSize === "4K",
                })
                  .then((assets) => {
                    console.log(
                      "✅ [editImage] 步骤4完成：图片已上传到OSS，remoteUrl:",
                      assets?.remoteUrl?.substring(0, 50)
                    );
                    cacheGeneratedImageResult({
                      messageId: aiMessageId,
                      prompt,
                      result: resultForCache,
                      assets,
                    });

                    // 🔥 内存优化：在图片成功上传后，延迟清空 imageData，只保留 thumbnail
                    const canvasDisplayDelay = totalDelay + 1000;
                    const memoryOptimizationDelay = canvasDisplayDelay + 2000;

                    setTimeout(() => {
                      const currentState = get();
                      const message = currentState.messages.find(
                        (m) => m.id === aiMessageId
                      );
                      if (!message) return;

                      const hasThumbnail =
                        message.thumbnail && message.thumbnail.length > 0;
                      const hasRemoteUrl =
                        message.imageRemoteUrl &&
                        message.imageRemoteUrl.startsWith("http");
                      const imageDataSize = message.imageData?.length || 0;
                      const thumbnailSize = message.thumbnail?.length || 0;

                      if (
                        hasThumbnail &&
                        hasRemoteUrl &&
                        imageDataSize > thumbnailSize * 2
                      ) {
                        get().updateMessage(aiMessageId, (msg) => ({
                          ...msg,
                          imageData: undefined,
                        }));

                        const context = contextManager.getCurrentContext();
                        if (context) {
                          const target = context.messages.find(
                            (m) => m.id === aiMessageId
                          );
                          if (target) {
                            target.imageData = undefined;
                          }
                        }
                      }
                    }, memoryOptimizationDelay);
                  })
                  .catch((error) => {
                    console.warn("⚠️ [editImage] 上传图片历史记录失败:", error);
                  });
              } else {
                cacheGeneratedImageResult({
                  messageId: aiMessageId,
                  prompt,
                  result: result.data,
                  assets: undefined,
                  inlineImageData,
                });
              }

              await get().refreshSessions();
              logProcessStep(metrics, "editImage completed");

              // 取消自动关闭对话框 - 保持对话框打开状态
              // setTimeout(() => {
              //   get().hideDialog();
              //
              // }, 100); // 延迟0.1秒关闭，让用户看到编辑完成的消息
            } else {
              // 编辑失败 - 更新消息状态为错误
              const errorMessage = result.error?.message || "图像编辑失败";

              get().updateMessageStatus(aiMessageId, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });

              console.error("❌ 图像编辑失败:", errorMessage);
              removePredictivePlaceholder();
            }
          } catch (error) {
            let errorMessage =
              error instanceof Error ? error.message : "未知错误";

            // 🔒 安全检查：防止Base64图像数据被当作错误消息
            if (
              errorMessage &&
              errorMessage.length > 1000 &&
              errorMessage.includes("iVBORw0KGgo")
            ) {
              console.warn(
                "⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息"
              );
              errorMessage = "图像编辑失败，请重试";
            }

            // 🔥 更新消息状态为错误
            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图像编辑异常:", error);
            logProcessStep(metrics, "editImage failed");
            removePredictivePlaceholder();
          }
        },

        setSourceImageForEditing: (imageData: string | null) => {
          if (!imageData) {
            set({ sourceImageForEditing: null });
            return;
          }

          const normalizedImage = sanitizeImageInput(imageData);
          if (!normalizedImage) {
            set({ sourceImageForEditing: null });
            return;
          }

          ensureActiveSession();
          set({ sourceImageForEditing: normalizedImage });

          // 🔥 立即缓存用户上传的图片
          const imageId = `user_upload_${Date.now()}`;
          contextManager.cacheLatestImage(
            normalizedImage,
            imageId,
            "用户上传的图片"
          );
        },

        setPreciseEditContext: (context: PreciseEditContext | null) => {
          if (!context) {
            set({ preciseEditContext: null });
            return;
          }
          if (!context.targetImageId || !context.targetImageSource) {
            set({ preciseEditContext: null });
            return;
          }
          set({ preciseEditContext: context });
        },

        // 画布选中图片同步到AI对话框
        setSourceImagesFromCanvas: (images: string[]) => {
          const normalizedImages = images
            .map((img) => sanitizeImageInput(img))
            .filter((img): img is string => Boolean(img));

          if (normalizedImages.length === 0) {
            // 清空所有源图片
            set({
              sourceImageForEditing: null,
              sourceImagesForBlending: [],
              preciseEditContext: null,
            });
            return;
          }

          ensureActiveSession();

          if (normalizedImages.length === 1) {
            // 单张图片：设置为编辑源图
            const singleImage = normalizedImages[0];
            set({
              sourceImageForEditing: singleImage,
              sourceImagesForBlending: [],
              preciseEditContext: null,
            });
            // 🔥 不再调用 cacheLatestImage，避免覆盖 DrawingController 设置的带 bounds 的缓存
          } else {
            // 多张图片：设置为融合源图
            set({
              sourceImageForEditing: null,
              sourceImagesForBlending: normalizedImages,
              preciseEditContext: null,
            });
            // 🔥 不再调用 cacheLatestImage，避免覆盖 DrawingController 设置的带 bounds 的缓存
          }
        },

        // 多图融合功能（支持并行）
        blendImages: async (
          prompt: string,
          sourceImages: string[],
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "blendImages entered");

          // 🔥 并行模式：不检查全局状态

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: `融合图像: ${prompt}`,
              sourceImagesData: sourceImages,
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在融合图像...",
              expectsImageOutput: true,
              sourceImagesData: sourceImages,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            state.addMessage({
              type: "user",
              content: `融合图像: ${prompt}`,
              sourceImagesData: sourceImages,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在融合图像...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              expectsImageOutput: true,
              sourceImagesData: sourceImages,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "blendImages message prepared");

          // 🔥 获取并行融合的分组信息
          const currentMsg = override
            ? get().messages.find((m) => m.id === override.aiMessageId)
            : null;
          const groupId = currentMsg?.groupId;
          const groupIndex = currentMsg?.groupIndex ?? 0;
          const groupTotal = currentMsg?.groupTotal ?? 1;
          const isParallelBlend = groupTotal > 1;

          const placeholderId = `ai-placeholder-${aiMessageId}`;
          const removePredictivePlaceholder = () => {
            dispatchPlaceholderEvent(
              {
                placeholderId,
                center: { x: 0, y: 0 },
                width: 0,
                height: 0,
                operationType: "blend",
              },
              "remove"
            );
          };

          try {
            const cached = contextManager.getCachedImage();
            const offsetHorizontal =
              useUIStore.getState().smartPlacementOffsetHorizontal || 522;
            const offsetVertical =
              useUIStore.getState().smartPlacementOffsetVertical || 552;
            let center: { x: number; y: number } | null = null;
            let layoutAnchor: { x: number; y: number } | null = null;

            // 🔥 统一并行模式的位置计算逻辑
            if (isParallelBlend) {
              // 并行融合：根据 groupIndex 计算不同的位置，避免重叠
              let baseX: number;
              let baseY: number;

              if (cached?.bounds) {
                baseX = cached.bounds.x + cached.bounds.width / 2;
                baseY =
                  cached.bounds.y + cached.bounds.height / 2 + offsetVertical;
              } else {
                const viewCenter = getViewCenter();
                baseX = viewCenter?.x ?? 0;
                baseY = viewCenter?.y ?? 0;
              }

              layoutAnchor = { x: baseX, y: baseY };
              center = {
                x: baseX + groupIndex * offsetHorizontal,
                y: baseY,
              };
            } else {
              // 单张融合：使用原有逻辑
              if (cached?.bounds) {
                center = {
                  x:
                    cached.bounds.x +
                    cached.bounds.width / 2 +
                    offsetHorizontal,
                  y: cached.bounds.y + cached.bounds.height / 2,
                };
                layoutAnchor = { ...center };
              } else {
                center = getViewCenter();
                layoutAnchor = center ? { ...center } : null;
              }
            }

            if (center) {
              const size = estimatePlaceholderSize({
                aspectRatio: state.aspectRatio,
                imageSize: state.imageSize,
                fallbackBounds: cached?.bounds ?? null,
              });

              dispatchPlaceholderEvent({
                placeholderId,
                center,
                width: size.width,
                height: size.height,
                operationType: "blend",
                preferSmartLayout: true,
                sourceImages,
                smartPosition: center ? { ...center } : undefined,
                groupId,
                groupIndex,
                groupTotal,
                preferHorizontal: isParallelBlend,
                groupAnchor: layoutAnchor || undefined,
              });
            }
          } catch (error) {
            placeholderLogger.warn("预测融合占位符生成失败", error);
          }

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在融合",
            });

            // 🔥 统一改为先上传到 OSS，用 URL 传给后端
            const projectIdBlend = useProjectContentStore.getState().projectId;
            const sourceImageUrls = await mapWithLimit(sourceImages, 2, async (img, index) => {
              const remoteUrl = normalizeRemoteUrl(img);
              const remoteAllowed = Boolean(
                remoteUrl && isLikelyBackendAllowedRemoteUrl(remoteUrl)
              );
              const sourceSummary = (() => {
                const normalized = typeof img === "string" ? img.trim() : "";
                if (!normalized) return "empty";
                if (/^data:image\//i.test(normalized)) {
                  return `data:image(len=${normalized.length})`;
                }
                if (/^blob:/i.test(normalized)) return "blob:url";
                if (/^https?:\/\//i.test(normalized)) {
                  try {
                    const parsed = new URL(normalized);
                    return `remote:${parsed.host}${parsed.pathname.slice(0, 48)}`;
                  } catch {
                    return "remote:invalid";
                  }
                }
                const keyLike = normalized.replace(/^\/+/, "");
                if (/^(projects|uploads|templates|videos)\//i.test(keyLike)) {
                  return "asset:key";
                }
                if (
                  normalized.startsWith("/api/assets/proxy") ||
                  normalized.startsWith("/assets/proxy")
                ) {
                  return "asset:proxy";
                }
                if (/^[A-Za-z0-9+/=\r\n]+$/.test(normalized) && normalized.length > 256) {
                  return `base64:raw(len=${normalized.length})`;
                }
                return `other(len=${normalized.length})`;
              })();

              logger.debug("[blendImages] preparing source image", {
                index,
                sourceSummary,
                remoteAllowed,
              });

              if (remoteUrl && remoteAllowed) return remoteUrl;
              const uploadResult = await imageUploadService.uploadImageSource(img, {
                dir: "ai-chat-images/",
                projectId: projectIdBlend,
                fileName: `ai-chat-blend-${Date.now()}-${index + 1}.png`,
                contentType: "image/png",
              });
              const uploadedUrl = uploadResult.asset?.url?.trim();
              if (uploadedUrl) return uploadedUrl;
              logger.warn("[blendImages] source image upload failed", {
                index,
                sourceSummary,
                remoteAllowed,
                projectId: projectIdBlend ?? null,
                error: uploadResult.error || "unknown",
              });
              if (remoteUrl && !remoteAllowed) {
                throw new Error(
                  "检测到不在后端白名单的图片域名，且上传失败。请先上传到画布/素材库后再融合。"
                );
              }
              throw new Error("融合图片上传 OSS 失败，请重新选择图片。");
            });

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "blendImages progress interval start");
            const PROGRESS_MAX_BLEND = 95;
            const PROGRESS_INCREMENT_BLEND = PROGRESS_MAX_BLEND / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_BLEND) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_BLEND,
                currentProgress + PROGRESS_INCREMENT_BLEND
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            const modelToUse = getImageModelForProvider(state.aiProvider);
            const providerOptions = withBananaRouteProviderOptions(
              state.aiProvider,
              undefined,
              state.bananaImageRoute
            );

            const result = await blendImagesViaAPI({
              prompt,
              sourceImageUrls,
              model: modelToUse,
              aiProvider: state.aiProvider,
              providerOptions,
              outputFormat: "png",
              aspectRatio: state.aspectRatio || undefined,
              imageSize: state.imageSize ?? "1K", // 自动模式下优先使用1K
              thinkingLevel: state.thinkingLevel || undefined,
              imageOnly: state.imageOnly,
              parallelGroupId: groupId,
              parallelGroupIndex: groupIndex,
              parallelGroupTotal: groupTotal,
            });
            logProcessStep(metrics, "blendImages API response received");

            clearInterval(progressInterval);

            if (result.success && result.data) {
              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已融合图像: ${prompt}`
                  : `无法融合图像: ${prompt}`);

              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: state.aiProvider,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));
              logProcessStep(metrics, "blendImages message updated");

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = messageContent;
                  // 避免在 contextManager 里长期保留完整 base64（内存会线性增长）
                  message.imageData = imageRemoteUrl ? undefined : inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  if (imageRemoteUrl) {
                    message.thumbnail = imageRemoteUrl;
                  }
                  message.imageRemoteUrl =
                    imageRemoteUrl || message.imageRemoteUrl;
                  message.metadata = result.data?.metadata;
                  message.provider = state.aiProvider;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // Prefer remote URL for canvas placement to avoid base64 memory usage.
              const placementImageData = resolveImageForPlacement({
                inlineData: inlineImageData,
                result: result.data,
                fallbackRemote: imageRemoteUrl ?? null,
              });

              if (!placementImageData) {
                console.warn(
                  "⚠️ [blendImages] 没有可用的图像源，无法显示到画布"
                );
                const noImageSourceError =
                  "融合成功但未获取到可渲染图片资源，请重试";
                if (aiMessageId) {
                  get().updateMessageStatus(aiMessageId, {
                    isGenerating: false,
                    progress: 0,
                    error: noImageSourceError,
                  });
                }
                removePredictivePlaceholder();
                return;
              }

              console.log(
                "✅ [blendImages] 步骤1-2完成：对话框已更新，placementImageData已计算"
              );

              // 先更新 lastGeneratedImage，不等待上传/历史记录
              set({ lastGeneratedImage: result.data });

              const addImageToCanvas = (
                aiResult: AIImageResult,
                imageSrc: string,
                isParallel: boolean = false,
                parallelGroupInfo?: {
                  groupId: string;
                  groupIndex: number;
                  groupTotal: number;
                }
              ) => {
                const fileName = `${prompt.substring(0, 20)}.${
                  aiResult.metadata?.outputFormat || "png"
                }`;
                const imagePayload = buildImagePayloadForUpload(
                  imageSrc,
                  fileName
                );

                // 🎯 获取源图像ID列表用于智能排版
                let sourceImageIds: string[] = [];
                try {
                  if ((window as any).tanvaImageInstances) {
                    const selectedImages = (
                      window as any
                    ).tanvaImageInstances.filter((img: any) => img.isSelected);
                    sourceImageIds = selectedImages.map((img: any) => img.id);
                  }
                } catch (error) {
                  console.warn("获取源图像IDs失败:", error);
                }

                window.dispatchEvent(
                  new CustomEvent("triggerQuickImageUpload", {
                    detail: {
                      imageData: imagePayload,
                      fileName: fileName,
                      operationType: "blend",
                      // 让 quick upload 根据 placeholderId/源图自动定位，避免跳到缓存链条位置
                      smartPosition: undefined,
                      sourceImageId: undefined,
                      sourceImages:
                        sourceImageIds.length > 0 ? sourceImageIds : undefined,
                      placeholderId,
                      preferHorizontal: isParallelBlend,
                      // 🔥 传递并行生成分组信息，用于自动打组
                      parallelGroupId: parallelGroupInfo?.groupId,
                      parallelGroupIndex: parallelGroupInfo?.groupIndex,
                      parallelGroupTotal: parallelGroupInfo?.groupTotal,
                    },
                  })
                );
              };

              // 🔥 传递并行融合分组信息，用于自动打组
              const blendParallelGroupInfo =
                isParallelBlend && groupId
                  ? {
                      groupId,
                      groupIndex,
                      groupTotal,
                    }
                  : undefined;

              // 并行融合：为每张图加递增延迟，避免同时上画布导致冲突
              const baseDelay = 100;
              const perImageDelay = 300;
              const totalDelay = baseDelay + groupIndex * perImageDelay;

              setTimeout(() => {
                if (result.data) {
                  console.log(
                    `✅ [blendImages] 步骤3执行：发送图片到画布 (延迟${totalDelay}ms, 并行模式: ${isParallelBlend})`
                  );
                  addImageToCanvas(
                    result.data,
                    placementImageData,
                    isParallelBlend,
                    blendParallelGroupInfo
                  );
                }
              }, totalDelay);

              // 步骤4：异步上传历史记录（后台进行，不阻塞上画布）
              if (inlineImageData || imageRemoteUrl) {
                const resultForCache: AIImageResult = {
                  ...result.data!,
                  imageData: undefined,
                };
                registerMessageImageHistory({
                  aiMessageId,
                  prompt,
                  result: result.data,
                  operationType: "blend",
                  aiProvider: state.aiProvider,
                  skipPreview: isParallelBlend || state.imageSize === "4K",
                })
                  .then((assets) => {
                    console.log(
                      "✅ [blendImages] 步骤4完成：图片已上传到OSS，remoteUrl:",
                      assets?.remoteUrl?.substring(0, 50)
                    );
                    cacheGeneratedImageResult({
                      messageId: aiMessageId,
                      prompt,
                      result: resultForCache,
                      assets,
                    });

                    // 🔥 内存优化：在图片成功上传后，延迟清空 imageData，只保留 thumbnail
                    const canvasDisplayDelay = totalDelay + 1000;
                    const memoryOptimizationDelay = canvasDisplayDelay + 2000;

                    setTimeout(() => {
                      const currentState = get();
                      const message = currentState.messages.find(
                        (m) => m.id === aiMessageId
                      );
                      if (!message) return;

                      const hasThumbnail =
                        message.thumbnail && message.thumbnail.length > 0;
                      const hasRemoteUrl =
                        message.imageRemoteUrl &&
                        message.imageRemoteUrl.startsWith("http");
                      const imageDataSize = message.imageData?.length || 0;
                      const thumbnailSize = message.thumbnail?.length || 0;

                      if (
                        hasThumbnail &&
                        hasRemoteUrl &&
                        imageDataSize > thumbnailSize * 2
                      ) {
                        get().updateMessage(aiMessageId, (msg) => ({
                          ...msg,
                          imageData: undefined,
                        }));

                        const context = contextManager.getCurrentContext();
                        if (context) {
                          const target = context.messages.find(
                            (m) => m.id === aiMessageId
                          );
                          if (target) {
                            target.imageData = undefined;
                          }
                        }
                      }
                    }, memoryOptimizationDelay);
                  })
                  .catch((error) => {
                    console.warn(
                      "⚠️ [blendImages] 上传图片历史记录失败:",
                      error
                    );
                  });
              } else {
                cacheGeneratedImageResult({
                  messageId: aiMessageId,
                  prompt,
                  result: result.data,
                  assets: undefined,
                  inlineImageData,
                });
              }

              await get().refreshSessions();
              logProcessStep(metrics, "blendImages completed");

              // 取消自动关闭对话框 - 保持对话框打开状态
              // setTimeout(() => {
              //   get().hideDialog();
              //
              // }, 100); // 延迟0.1秒关闭，让用户看到融合完成的消息
            } else {
              const errorMessage = result.error?.message || "图像融合失败";

              get().updateMessageStatus(aiMessageId, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });

              console.error("❌ 图像融合失败:", errorMessage);
              removePredictivePlaceholder();
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图像融合异常:", error);
            logProcessStep(metrics, "blendImages failed");
            removePredictivePlaceholder();
          }
        },

        addImageForBlending: (imageData: string) => {
          const normalizedImage = sanitizeImageInput(imageData);
          if (!normalizedImage) {
            console.warn("⚠️ 跳过无效的融合图片数据");
            return;
          }

          ensureActiveSession();
          set((state) => ({
            sourceImagesForBlending: [
              ...state.sourceImagesForBlending,
              normalizedImage,
            ],
          }));

          // 🔥 立即缓存用户上传的融合图片（缓存最后一张）
          const imageId = `user_blend_upload_${Date.now()}`;
          contextManager.cacheLatestImage(
            normalizedImage,
            imageId,
            "用户上传的融合图片"
          );
        },

        removeImageFromBlending: (index: number) => {
          set((state) => ({
            sourceImagesForBlending: state.sourceImagesForBlending.filter(
              (_, i) => i !== index
            ),
          }));
        },

        clearImagesForBlending: () => {
          set({ sourceImagesForBlending: [] });
        },

        executeMidjourneyAction: async ({
          parentMessageId,
          taskId,
          customId,
          buttonLabel,
          displayPrompt,
        }: MidjourneyActionOptions) => {
          const state = get();
          const actionLabel = buttonLabel || "Midjourney 操作";
          const parentMessage = state.messages.find(
            (msg) => msg.id === parentMessageId
          );
          const prompt =
            displayPrompt ||
            (parentMessage?.metadata?.midjourney?.prompt as
              | string
              | undefined) ||
            parentMessage?.content ||
            actionLabel;

          const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
            type: "ai",
            content: `正在执行 ${actionLabel}...`,
            generationStatus: {
              isGenerating: true,
              progress: 0,
              error: null,
              stage: "准备中",
            },
            expectsImageOutput: true,
            provider: "midjourney",
          };

          const aiMessage = state.addMessage(placeholderMessage);
          generatingImageCount += 1;

          try {
            const result = await midjourneyActionViaAPI({
              taskId,
              customId,
              actionLabel,
              displayPrompt: prompt,
            });

            if (result.success && result.data) {
              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已生成图像: ${prompt}`
                  : `无法生成图像: ${prompt}`);

              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessage.id
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: "midjourney",
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              const context = contextManager.getCurrentContext();
              if (context) {
                const messageRef = context.messages.find(
                  (m) => m.id === aiMessage.id
                );
                if (messageRef) {
                  messageRef.content = messageContent;
                  messageRef.imageData = imageRemoteUrl
                    ? undefined
                    : inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  if (imageRemoteUrl) {
                    messageRef.thumbnail = imageRemoteUrl;
                  }
                  messageRef.imageRemoteUrl =
                    imageRemoteUrl || messageRef.imageRemoteUrl;
                  messageRef.metadata = result.data?.metadata;
                  messageRef.provider = "midjourney";
                  messageRef.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              let uploadedAssets:
                | { remoteUrl?: string; thumbnail?: string }
                | undefined;
              if (inlineImageData || imageRemoteUrl) {
                uploadedAssets = await registerMessageImageHistory({
                  aiMessageId: aiMessage.id,
                  prompt,
                  result: result.data,
                  operationType: "generate",
                  aiProvider: "midjourney",
                  skipPreview: true,
                });
              }

              if (uploadedAssets?.remoteUrl) {
                result.data.metadata = {
                  ...result.data.metadata,
                  imageUrl: uploadedAssets.remoteUrl,
                };
                result.data.imageData = undefined;
              }

              set({ lastGeneratedImage: result.data });

              await get().refreshSessions();
            } else {
              const errorMessage =
                result.error?.message || "Midjourney 操作失败";
              get().updateMessageStatus(aiMessage.id, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Midjourney 操作失败";
            get().updateMessageStatus(aiMessage.id, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });
            console.error("❌ Midjourney action异常:", error);
          } finally {
            generatingImageCount = Math.max(0, generatingImageCount - 1);
          }
        },

        // 图像分析功能（支持并行）
        analyzeImage: async (
          prompt: string,
          sourceImage: string | string[],
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "analyzeImage entered");

          // 🔥 并行模式：不检查全局状态
          const normalizedAnalyzeSources = Array.from(
            new Set(
              (Array.isArray(sourceImage) ? sourceImage : [sourceImage])
                .map((item) => sanitizeImageInput(item))
                .filter((item): item is string => Boolean(item))
            )
          );

          if (normalizedAnalyzeSources.length === 0) {
            throw new Error("没有可分析的图像");
          }

          const displayAnalyzeSources = normalizedAnalyzeSources.map(
            (item) => toRenderableImageSrc(item) || item
          );
          const displayPrimaryAnalyzeSource = displayAnalyzeSources[0];
          const messageSourceImagesData =
            displayAnalyzeSources.length > 1 ? displayAnalyzeSources : undefined;
          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: prompt ? `分析图片: ${prompt}` : "分析这张图片",
              sourceImageData: displayPrimaryAnalyzeSource ?? msg.sourceImageData,
              sourceImagesData: messageSourceImagesData,
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在分析图片...",
              sourceImageData: displayPrimaryAnalyzeSource ?? msg.sourceImageData,
              sourceImagesData: messageSourceImagesData,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            state.addMessage({
              type: "user",
              content: prompt ? `分析图片: ${prompt}` : "分析这张图片",
              sourceImageData: displayPrimaryAnalyzeSource ?? undefined,
              sourceImagesData: messageSourceImagesData,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在分析图片...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              sourceImageData: displayPrimaryAnalyzeSource ?? undefined,
              sourceImagesData: messageSourceImagesData,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "analyzeImage message prepared");

          let progressInterval: ReturnType<typeof setInterval> | null = null;
          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在分析",
            });

            // 🔥 统一改为先上传到 OSS，用 URL 传给后端
            const primaryAnalyzeSource = normalizedAnalyzeSources[0];
            const projectIdAnalyze = useProjectContentStore.getState().projectId;
            const remoteUrlAnalyze = normalizeRemoteUrl(primaryAnalyzeSource);
            const remoteAllowedAnalyze = Boolean(
              remoteUrlAnalyze && isLikelyBackendAllowedRemoteUrl(remoteUrlAnalyze)
            );
            const uploadedAnalyzeUrl = remoteUrlAnalyze && remoteAllowedAnalyze
              ? remoteUrlAnalyze
              : await uploadImageToOSS(primaryAnalyzeSource, projectIdAnalyze);
            if (!uploadedAnalyzeUrl) {
              if (remoteUrlAnalyze && !remoteAllowedAnalyze) {
                throw new Error(
                  "源图 URL 域名不在后端白名单，且上传失败。请先上传到画布/素材库后重试。"
                );
              }
              throw new Error("源图上传 OSS 失败，请重新选择图片。");
            }

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "analyzeImage progress interval start");
            const PROGRESS_MAX_ANALYZE = 95;
            const PROGRESS_INCREMENT_ANALYZE = PROGRESS_MAX_ANALYZE / 120; // 约0.79%每秒
            progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_ANALYZE) {
                if (progressInterval) {
                  clearInterval(progressInterval);
                  progressInterval = null;
                }
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_ANALYZE,
                currentProgress + PROGRESS_INCREMENT_ANALYZE
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API分析图像（后端接受多图 base64）
            const modelToUse = getAnalyzeModelForProvider(state.aiProvider);
            const analyzeSourceBase64List = await mapWithLimit(
              normalizedAnalyzeSources,
              2,
              async (item) => resolveImageToDataUrl(item)
            );
            const normalizedAnalyzeSourceBase64List = analyzeSourceBase64List.filter(
              (item): item is string =>
                typeof item === "string" && item.trim().length > 0
            );
            if (
              normalizedAnalyzeSourceBase64List.length === 0 ||
              normalizedAnalyzeSourceBase64List.length !==
                normalizedAnalyzeSources.length
            ) {
              throw new Error("部分源图片读取失败，请重新选择后重试。");
            }
            const primaryAnalyzeSourceBase64 =
              normalizedAnalyzeSourceBase64List[0];
            const defaultAnalyzePrompt =
              normalizedAnalyzeSourceBase64List.length > 1
                ? "请详细分析这组图片，并总结它们的差异与共同点"
                : "请详细分析这张图片的内容";

            const result = await analyzeImageViaAPI({
              prompt: prompt || defaultAnalyzePrompt,
              sourceImage: primaryAnalyzeSourceBase64,
              sourceImages: normalizedAnalyzeSourceBase64List,
              model: modelToUse,
              aiProvider: state.aiProvider,
            });

            if (progressInterval) {
              clearInterval(progressInterval);
              progressInterval = null;
            }
            logProcessStep(metrics, "analyzeImage API response received");

            if (result.success && result.data) {
              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: result.data!.analysis,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = result.data!.analysis;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }
              logProcessStep(metrics, "analyzeImage completed");
            } else {
              throw new Error(result.error?.message || "图片分析失败");
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图片分析异常:", error);
            logProcessStep(metrics, "analyzeImage failed");
          } finally {
            if (progressInterval) {
              clearInterval(progressInterval);
            }
          }
        },

        setSourceImageForAnalysis: (imageData: string | null) => {
          if (!imageData) {
            set({ sourceImageForAnalysis: null });
            return;
          }

          const normalizedImage = sanitizeImageInput(imageData);
          if (!normalizedImage) {
            set({ sourceImageForAnalysis: null });
            return;
          }

          ensureActiveSession();
          set({ sourceImageForAnalysis: normalizedImage });

          // 🔥 立即缓存用户上传的分析图片
          const imageId = `user_analysis_upload_${Date.now()}`;
          contextManager.cacheLatestImage(
            normalizedImage,
            imageId,
            "用户上传的分析图片"
          );
        },

        // PDF 分析状态设置
        setSourcePdfForAnalysis: (
          pdfData: string | null,
          fileName?: string | null
        ) => {
          set({
            sourcePdfForAnalysis: pdfData,
            sourcePdfFileName: pdfData ? fileName ?? null : null,
          });
          if (pdfData) {
          }
        },

        // PDF 分析功能
        analyzePdf: async (
          prompt: string,
          sourcePdf: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "analyzePdf entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          // 格式化 PDF 数据
          const formattedPdfData = sourcePdf.startsWith("data:application/pdf")
            ? sourcePdf
            : `data:application/pdf;base64,${sourcePdf}`;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: prompt ? `分析 PDF: ${prompt}` : "分析这个 PDF 文件",
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在分析 PDF 文件...",
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            state.addMessage({
              type: "user",
              content: prompt ? `分析 PDF: ${prompt}` : "分析这个 PDF 文件",
            });

            // 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在分析 PDF 文件...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "analyzePdf message prepared");

          try {
            // 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在分析",
            });

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "analyzePdf progress interval start");
            const PROGRESS_MAX_PDF = 95;
            const PROGRESS_INCREMENT_PDF = PROGRESS_MAX_PDF / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_PDF) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_PDF,
                currentProgress + PROGRESS_INCREMENT_PDF
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API分析 PDF（复用 analyzeImage 接口）
            const modelToUse = getAnalyzeModelForProvider(state.aiProvider);

            const result = await analyzeImageViaAPI({
              prompt: prompt || "请详细分析这个 PDF 文件的内容",
              sourceImage: formattedPdfData,
              model: modelToUse,
              aiProvider: state.aiProvider,
            });

            clearInterval(progressInterval);
            logProcessStep(metrics, "analyzePdf API response received");

            if (result.success && result.data) {
              // 更新消息内容和完成状态
              set((curState) => ({
                messages: curState.messages.map((msg) =>
                  msg.id === aiMessageId
                    ? {
                        ...msg,
                        content: result.data!.analysis,
                        generationStatus: {
                          isGenerating: false,
                          progress: 100,
                          error: null,
                        },
                      }
                    : msg
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = result.data!.analysis;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // 清除 PDF 状态
              set({ sourcePdfForAnalysis: null, sourcePdfFileName: null });
              logProcessStep(metrics, "analyzePdf completed");
            } else {
              throw new Error(result.error?.message || "PDF 分析失败");
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ PDF 分析异常:", error);
            logProcessStep(metrics, "analyzePdf failed");
          }
        },

        // 文本对话功能（支持并行）
        generateTextResponse: async (
          prompt: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          // 🔥 并行模式：不检查全局状态

          const metrics = options?.metrics;
          logProcessStep(metrics, "generateTextResponse entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成文本回复...",
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成文本回复...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              provider: get().aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "generateTextResponse message prepared");

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 50,
              error: null,
              stage: "正在生成文本回复...",
            });

            // 调用后端API生成文本
            const state = get();
            const modelToUse = getTextModelForProvider(state.aiProvider);
            const contextPrompt = contextManager.buildContextPrompt(prompt);
            const providerOptions = withBananaRouteProviderOptions(
              state.aiProvider,
              undefined,
              state.bananaImageRoute
            );

            logProcessStep(
              metrics,
              `generateTextResponse calling API (${modelToUse})`
            );
            const result = await generateTextResponseViaAPI({
              prompt: contextPrompt,
              model: modelToUse,
              aiProvider: state.aiProvider,
              enableWebSearch: state.enableWebSearch,
              thinkingLevel: state.thinkingLevel || undefined,
              providerOptions,
            });
            logProcessStep(
              metrics,
              "generateTextResponse API response received"
            );

            if (result.success && result.data) {
              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: result.data!.text,
                          webSearchResult: result.data!.webSearchResult,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = result.data!.text;
                  message.webSearchResult = result.data!.webSearchResult;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              await get().refreshSessions();
              logProcessStep(metrics, "generateTextResponse completed");
            } else {
              throw new Error(result.error?.message || "文本生成失败");
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 文本生成失败:", errorMessage);
            logProcessStep(metrics, "generateTextResponse failed");
          }
        },

        // 🎬 视频生成方法
        generateVideo: async (
          prompt: string,
          referenceImages?: string | string[] | null,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const metrics = options?.metrics;
          logProcessStep(metrics, "generateVideo entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成视频...",
              expectsVideoOutput: true,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备视频生成",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成视频...",
              expectsVideoOutput: true,
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备视频生成",
              },
              provider: get().aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "generateVideo message prepared");

          try {
            const state = get();
            const provider: VideoProvider = "doubao";
            const aspectRatio = state.videoAspectRatio ?? undefined;
            const durationSeconds = state.videoDurationSeconds ?? undefined;

            const referenceImageList = Array.isArray(referenceImages)
              ? referenceImages
              : referenceImages
              ? [referenceImages]
              : [];
            const referenceImageUrls: string[] = [];

            if (referenceImageList.length) {
              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: 15,
                error: null,
                stage: "处理参考图像",
              });

              for (const img of referenceImageList) {
                if (!img) continue;
                try {
                  const input = toRenderableImageSrc(img) ?? img;
                  const dataUrl = await resolveImageToDataUrl(input, {
                    preferProxy: true,
                  });
                  if (dataUrl) {
                    referenceImageUrls.push(dataUrl);
                  } else {
                    console.warn("⚠️ 参考图像转换失败，继续生成视频");
                  }
                } catch (error) {
                  console.warn("⚠️ 参考图像转换失败，继续生成视频", error);
                }
              }
            }

            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 30,
              error: null,
              stage: "发送请求到 Seedance",
            });

            const videoRequestStartedAt = Date.now();
            logProcessStep(metrics, "generateVideo calling video provider API");
            const videoMode =
              referenceImageUrls.length > 0 ? "reference_images" : "text";

            const createResult = await generateVideoByProvider({
              prompt,
              referenceImages: referenceImageUrls.length
                ? referenceImageUrls
                : undefined,
              duration: durationSeconds,
              aspectRatio,
              provider,
              seedanceModel: AI_CHAT_SEEDANCE_MODEL,
              videoMode,
            });

            logProcessStep(metrics, "generateVideo API response received");

            if (!createResult.taskId && !createResult.videoUrl) {
              throw new Error("视频任务创建失败");
            }

            const finalizeSuccess = async (
              videoUrl: string,
              thumbnailUrl?: string,
              status?: string
            ) => {
              if (createResult.apiUsageId) {
                const processingTime = Math.max(0, Date.now() - videoRequestStartedAt);
                void markVideoTaskSuccess(createResult.apiUsageId, processingTime).catch(
                  (markError) => {
                    console.warn("❌ Seedance 成功状态回写失败", markError);
                  }
                );
              }

              const remoteVideoUrl = videoUrl;
              get().updateMessage(aiMessageId, (msg) => ({
                ...msg,
                type: "ai",
                content: "Seedance 视频生成完成",
                videoUrl: remoteVideoUrl,
                videoSourceUrl: remoteVideoUrl,
                videoTaskId: createResult.taskId ?? msg.videoTaskId ?? null,
                videoStatus: status ?? "succeeded",
                videoThumbnail: msg.videoThumbnail || thumbnailUrl,
                videoMetadata: {
                  ...(msg.videoMetadata || {}),
                  provider,
                  seedanceModel: AI_CHAT_SEEDANCE_MODEL,
                  videoMode,
                  aspectRatio,
                  durationSeconds,
                  apiUsageId: createResult.apiUsageId,
                },
                expectsVideoOutput: false,
                generationStatus: {
                  isGenerating: false,
                  progress: 100,
                  error: null,
                  stage: "完成",
                },
              }));

              const sessionId =
                resolveSessionIdByMessageId(aiMessageId) ||
                get().currentSessionId ||
                contextManager.getCurrentSessionId();
              if (sessionId) {
                try {
                  const localCached = await cacheVideoBlobForMessage({
                    sessionId,
                    messageId: aiMessageId,
                    videoUrl: remoteVideoUrl,
                  });
                  if (localCached) {
                    get().updateMessage(aiMessageId, (msg) => ({
                      ...msg,
                      videoSourceUrl: remoteVideoUrl,
                      videoLocalAssetId: localCached.assetId,
                      videoLocalUrl: localCached.objectUrl,
                    }));
                  }
                } catch (cacheError) {
                  console.warn("⚠️ 视频本地缓存失败，继续使用远程 URL:", cacheError);
                }
              }

              if (ENABLE_VIDEO_CANVAS_PLACEMENT) {
                const placedPoster = await autoPlaceVideoOnCanvas({
                  prompt,
                  videoUrl,
                  thumbnailUrl,
                });
                if (placedPoster && aiMessageId) {
                  get().updateMessage(aiMessageId, (msg) => ({
                    ...msg,
                    videoThumbnail: msg.videoThumbnail || placedPoster,
                  }));
                }
              }

              contextManager.recordOperation({
                type: "generateVideo",
                input: prompt,
                output: videoUrl,
                success: true,
                metadata: {
                  provider,
                  taskId: createResult.taskId,
                  status: status ?? "succeeded",
                  aspectRatio,
                  durationSeconds,
                },
              });

              await get().refreshSessions();
            };

            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              videoTaskId: createResult.taskId ?? null,
              videoStatus: createResult.status ?? null,
              videoMetadata: {
                ...(msg.videoMetadata || {}),
                provider,
                aspectRatio,
                durationSeconds,
                apiUsageId: createResult.apiUsageId,
              },
            }));

            if (createResult.videoUrl) {
              await finalizeSuccess(
                createResult.videoUrl,
                createResult.thumbnailUrl,
                createResult.status
              );
              logProcessStep(metrics, "generateVideo finished (immediate)");
              return;
            }

            const taskId = createResult.taskId!;
            const pollIntervalMs = 5000;
            const maxAttempts = 180;

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              if (attempt > 1) {
                await new Promise((resolve) =>
                  setTimeout(resolve, pollIntervalMs)
                );
              }

              let queryResult:
                | {
                    status: string;
                    videoUrl?: string;
                    thumbnailUrl?: string;
                    error?: string;
                  }
                | undefined;
              try {
                queryResult = await queryVideoTask(provider, taskId);
              } catch (error) {
                console.warn("❌ Seedance 任务查询失败，继续重试", error);
                continue;
              }

              if (!queryResult) continue;
              const rawStatus = queryResult.status || "queued";
              const normalized = String(rawStatus).toLowerCase();

              get().updateMessage(aiMessageId, (msg) => ({
                ...msg,
                videoStatus: rawStatus,
              }));

              if (
                normalized === "succeeded" ||
                normalized === "success" ||
                normalized === "succeed"
              ) {
                if (!queryResult.videoUrl) {
                  throw new Error("Seedance 返回空视频链接");
                }
                await finalizeSuccess(
                  queryResult.videoUrl,
                  queryResult.thumbnailUrl,
                  rawStatus
                );
                logProcessStep(metrics, "generateVideo finished (polled)");
                return;
              }

              if (normalized === "failed" || normalized === "failure") {
                if (createResult.apiUsageId) {
                  try {
                    await refundVideoTask(createResult.apiUsageId);
                  } catch (refundError) {
                    console.warn("❌ Seedance 退款失败", refundError);
                  }
                }
                throw new Error(queryResult.error || "任务生成失败");
              }

              const progress = Math.min(
                95,
                35 + Math.round((attempt / maxAttempts) * 60)
              );
              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress,
                error: null,
                stage: "视频生成中",
              });
            }

            if (createResult.apiUsageId) {
              try {
                await refundVideoTask(createResult.apiUsageId);
              } catch (refundError) {
                console.warn("❌ Seedance 退款失败", refundError);
              }
            }
            throw new Error("任务查询超时");
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "视频生成失败";
            console.error("❌ 视频生成异常:", error);

            // 更新消息状态为错误
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: `视频生成失败: ${errorMessage}`,
              expectsVideoOutput: false,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));

            // 🧠 记录失败
            contextManager.recordOperation({
              type: "generateVideo",
              input: prompt,
              output: undefined,
              success: false,
            });

            logProcessStep(metrics, "generateVideo failed");
          }
        },

        /**
         * 生成 Paper.js 代码并执行
         */
        generatePaperJSCode: async (
          prompt: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "generatePaperJSCode entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成 Paper.js 代码...",
              expectsImageOutput: false,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备代码生成",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成 Paper.js 代码...",
              expectsImageOutput: false,
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备代码生成",
              },
              provider: state.aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "generatePaperJSCode message prepared");

          // 显示占位标记
          if (paperSandboxService.isReady()) {
            paperSandboxService.showVectorPlaceholder();
          }

          try {
            // 更新进度
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 20,
              error: null,
              stage: "生成代码中",
            });

            // 调用 AI 生成 Paper.js 代码
            const result = await aiImageService.generatePaperJSCode({
              prompt,
              aiProvider: state.aiProvider,
              // 根据 provider 选择正确的模型
              model: getTextModelForProvider(state.aiProvider),
              thinkingLevel: state.thinkingLevel ?? undefined,
              canvasWidth: 1920,
              canvasHeight: 1080,
            });

            logProcessStep(metrics, "generatePaperJSCode API call completed");

            if (!result.success || !result.data) {
              throw new Error(result.error?.message || "Paper.js 代码生成失败");
            }

            const { code, explanation } = result.data;

            // 更新进度
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 60,
              error: null,
              stage: "执行代码中",
            });

            // 检查 Paper.js 是否就绪
            if (!paperSandboxService.isReady()) {
              throw new Error("Paper.js 画布尚未就绪，请稍后再试");
            }

            // 执行 Paper.js 代码
            const executionResult = paperSandboxService.executeCode(code);

            if (!executionResult.success) {
              throw new Error(executionResult.error || "代码执行失败");
            }

            // 更新进度
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 85,
              error: null,
              stage: "应用到画布",
            });

            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            // 自动应用到当前图层
            const applyResult = paperSandboxService.applyOutputToActiveLayer();

            if (!applyResult.success) {
              console.warn("⚠️ 应用到画布失败:", applyResult.error);
              // 不抛出错误，因为代码已经执行成功
            }

            // 更新消息为成功
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: `✅ Paper.js 矢量图形已生成到画布中央！\n\n${
                explanation || "代码已成功执行并应用到画布。"
              }`,
              generationStatus: {
                isGenerating: false,
                progress: 100,
                error: null,
                stage: "完成",
              },
            }));

            // 记录操作历史（已注释，contextManager 不支持此方法）
            // contextManager.addOperation({
            //   type: 'generatePaperJS',
            //   input: prompt,
            //   output: { code, explanation },
            //   success: true
            // });

            logProcessStep(
              metrics,
              "generatePaperJSCode completed successfully"
            );
          } catch (error) {
            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            const errorMessage =
              error instanceof Error ? error.message : "Paper.js 代码生成失败";
            console.error("❌ Paper.js 代码生成失败:", errorMessage);

            // 更新消息为错误状态
            get().updateMessage(aiMessageId!, (msg) => ({
              ...msg,
              content: `❌ Paper.js 代码生成失败: ${errorMessage}`,
              generationStatus: {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));

            // 记录操作历史（已注释，contextManager 不支持此方法）
            // contextManager.addOperation({
            //   type: 'generatePaperJS',
            //   input: prompt,
            //   output: undefined,
            //   success: false
            // });

            logProcessStep(metrics, "generatePaperJSCode failed");
            throw error;
          }
        },

        // 图像转矢量 - 分析图像并生成 Paper.js 矢量代码
        img2Vector: async (
          prompt: string,
          sourceImage: string,
          style: "simple" | "detailed" | "artistic" = "detailed",
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "img2Vector entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在分析图像并生成矢量图...",
              expectsImageOutput: false,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "分析图像中",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在分析图像并生成矢量图...",
              expectsImageOutput: false,
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "分析图像中",
              },
              provider: state.aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "img2Vector message prepared");

          // 显示占位标记
          if (paperSandboxService.isReady()) {
            paperSandboxService.showVectorPlaceholder();
          }

          try {
            // 更新进度 - 分析图像
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 20,
              error: null,
              stage: "分析图像中",
            });

            // 调用 AI 进行图像转矢量
            const result = await aiImageService.img2Vector({
              sourceImage,
              prompt,
              aiProvider: state.aiProvider,
              model: getTextModelForProvider(state.aiProvider),
              thinkingLevel: state.thinkingLevel ?? undefined,
              canvasWidth: 1920,
              canvasHeight: 1080,
              style,
            });

            logProcessStep(metrics, "img2Vector API call completed");

            if (!result.success || !result.data) {
              throw new Error(result.error?.message || "图像转矢量失败");
            }

            const { code, imageAnalysis, explanation } = result.data;

            // 更新进度 - 生成代码
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 50,
              error: null,
              stage: "生成代码中",
            });

            // 更新进度 - 执行代码
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 60,
              error: null,
              stage: "执行代码中",
            });

            // 检查 Paper.js 是否就绪
            if (!paperSandboxService.isReady()) {
              throw new Error("Paper.js 画布尚未就绪，请稍后再试");
            }

            // 执行 Paper.js 代码
            const executionResult = paperSandboxService.executeCode(code);

            if (!executionResult.success) {
              throw new Error(executionResult.error || "代码执行失败");
            }

            // 更新进度 - 应用到画布
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 85,
              error: null,
              stage: "应用到画布",
            });

            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            // 自动应用到当前图层
            const applyResult = paperSandboxService.applyOutputToActiveLayer();

            if (!applyResult.success) {
              console.warn("⚠️ 应用到画布失败:", applyResult.error);
            }

            // 更新消息为成功
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: `✅ 图像已转换为矢量图形！\n\n📊 图像分析:\n${imageAnalysis}\n\n${
                explanation || "矢量图已成功生成并应用到画布。"
              }`,
              generationStatus: {
                isGenerating: false,
                progress: 100,
                error: null,
                stage: "完成",
              },
            }));

            logProcessStep(metrics, "img2Vector completed successfully");
          } catch (error) {
            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            const errorMessage =
              error instanceof Error ? error.message : "图像转矢量失败";
            console.error("❌ 图像转矢量失败:", errorMessage);

            // 更新消息为错误状态
            get().updateMessage(aiMessageId!, (msg) => ({
              ...msg,
              content: `❌ 图像转矢量失败: ${errorMessage}`,
              generationStatus: {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));

            logProcessStep(metrics, "img2Vector failed");
            throw error;
          }
        },

        // 🔄 核心处理流程 - 可重试的执行逻辑
        executeProcessFlow: async (
          input: string,
          isRetry: boolean = false,
          groupInfo?: {
            groupId: string;
            groupIndex: number;
            groupTotal: number;
          },
          options?: ExecuteProcessFlowOptions
        ) => {
          const state = get();
          const metrics = createProcessMetrics();
          logProcessStep(metrics, "executeProcessFlow start");

          // 检测迭代意图
          const isIterative = contextManager.detectIterativeIntent(input);
          if (isIterative && !isRetry && !options?.override) {
            contextManager.incrementIteration();
          }

          // 🔥 并行生成时，只有第一个任务创建用户消息
          const isParallelMode = !!groupInfo;
          const isFirstInGroup = groupInfo?.groupIndex === 0;

          // 预先创建用户消息与占位AI消息，提供即时反馈（允许复用外部预创建的消息）
          let messageOverride: MessageOverride;
          if (options?.override) {
            messageOverride = options.override;
          } else {
            let pendingUserMessage: ChatMessage;
            if (isParallelMode && !isFirstInGroup) {
              // 并行模式下，非第一个任务复用第一个任务的用户消息（不重复创建）
              const existingUserMsg = get().messages.find(
                (m) =>
                  m.type === "user" &&
                  m.content === input &&
                  m.groupId === groupInfo.groupId
              );
              pendingUserMessage =
                existingUserMsg ||
                get().addMessage({
                  type: "user",
                  content: input,
                  groupId: groupInfo.groupId,
                  groupIndex: 0,
                  groupTotal: groupInfo.groupTotal,
                });
            } else {
              pendingUserMessage = get().addMessage({
                type: "user",
                content: input,
                ...(groupInfo && {
                  groupId: groupInfo.groupId,
                  groupIndex: 0,
                  groupTotal: groupInfo.groupTotal,
                }),
              });
            }

            const pendingAiMessage = get().addMessage({
              type: "ai",
              content: isParallelMode
                ? `正在生成第 ${(groupInfo?.groupIndex ?? 0) + 1}/${
                    groupInfo?.groupTotal ?? 1
                  } 张...`
                : "正在准备处理您的请求...",
              generationStatus: {
                isGenerating: true,
                progress: 5,
                error: null,
                stage: "准备中",
              },
              ...(groupInfo && {
                groupId: groupInfo.groupId,
                groupIndex: groupInfo.groupIndex,
                groupTotal: groupInfo.groupTotal,
              }),
            });

            messageOverride = {
              userMessageId: pendingUserMessage.id,
              aiMessageId: pendingAiMessage.id,
            };
          }

          metrics.messageId = messageOverride.aiMessageId;
          logProcessStep(metrics, "messages prepared");

          // 准备工具选择请求
          const cachedImage = contextManager.getCachedImage();

          // 计算显式图片数量（不包含缓存图片）
          let explicitImageCount = 0;

          // 计算融合模式的图片数量
          if (state.sourceImagesForBlending.length > 0) {
            explicitImageCount += state.sourceImagesForBlending.length;
          }

          // 如果有编辑图片，计入总数
          if (state.sourceImageForEditing) {
            explicitImageCount += 1;
          }

          // 如果有分析图片，计入总数
          if (state.sourceImageForAnalysis) {
            explicitImageCount += 1;
          }

          // 总图像数量 = 显式图片 + 缓存图片（如果存在）
          const totalImageCount = explicitImageCount + (cachedImage ? 1 : 0);

          const toolSelectionContext = contextManager.buildContextPrompt(input);
          const isSingleExplicitImage =
            explicitImageCount === 1 &&
            state.sourceImagesForBlending.length === 0;
          const hasMultiExplicitImages = explicitImageCount > 1;
          const allowAnalyzeImageTool = !isAnalyzeDisabledOnCurrentBananaRoute(
            state.aiProvider,
            state.bananaImageRoute
          );
          const preferAnalyzeForMultiImage = hasMultiExplicitImages
            ? prefersAnalyzeForMultiImage(input)
            : false;
          const availableToolsForSelection: AvailableTool[] = isSingleExplicitImage
            ? allowAnalyzeImageTool
              ? ["editImage", "analyzeImage"]
              : ["editImage"]
            : hasMultiExplicitImages
              ? allowAnalyzeImageTool && preferAnalyzeForMultiImage
                ? ["analyzeImage", "blendImages"]
                : allowAnalyzeImageTool
                  ? ["blendImages", "analyzeImage"]
                  : ["blendImages"]
              : [
                  "generateImage",
                  "editImage",
                  "blendImages",
                  ...(allowAnalyzeImageTool
                    ? (["analyzeImage"] as AvailableTool[])
                    : []),
                  "chatResponse",
                  "generateVideo",
                  "generatePaperJS",
                ];

          const toolSelectionRequest = {
            userInput: input,
            hasImages: totalImageCount > 0,
            imageCount: explicitImageCount, // 传递显式图片数量，不包含缓存
            hasCachedImage: !!cachedImage, // 单独标记是否有缓存图片
            availableTools: availableToolsForSelection,
            aiProvider: state.aiProvider,
            model: getTextModelForProvider(state.aiProvider),
            context: toolSelectionContext,
          };

          // 根据手动模式或AI选择工具
          const manualMode = state.manualAIMode;
          const manualToolMap: Record<ManualAIMode, AvailableTool | null> = {
            auto: null,
            text: "chatResponse",
            generate: "generateImage",
            edit: "editImage",
            blend: "blendImages",
            analyze: "analyzeImage",
            video: "generateVideo",
            vector: "generatePaperJS",
          };

          let selectedTool: AvailableTool | null = options?.selectedTool ?? null;
          let parameters: { prompt: string } = options?.parameters || {
            prompt: input,
          };

          if (!selectedTool) {
            if (manualMode !== "auto") {
              selectedTool = manualToolMap[manualMode];
            } else {
              // 📄 检测是否有 PDF 文件需要分析
              if (state.sourcePdfForAnalysis) {
                selectedTool = "analyzePdf";
              } else {
                if (!isParallelMode) {
                  get().updateMessage(messageOverride.aiMessageId, (msg) => ({
                    ...msg,
                    content: "正在思考中...",
                    generationStatus: {
                      ...(msg.generationStatus || {
                        isGenerating: true,
                        progress: 0,
                        error: null,
                      }),
                      isGenerating: true,
                      error: null,
                      stage: "思考中",
                    },
                  }));
                }

                // 完全靠 AI 来判断工具选择，包括矢量图生成
                logProcessStep(metrics, "tool selection start");
                const toolSelectionResult = await aiImageService.selectTool(
                  toolSelectionRequest
                );
                logProcessStep(metrics, "tool selection completed");

                if (!toolSelectionResult.success || !toolSelectionResult.data) {
                  const errorMsg =
                    toolSelectionResult.error?.message || "工具选择失败";
                  console.error("❌ 工具选择失败:", errorMsg);
                  throw new Error(errorMsg);
                }

                selectedTool = toolSelectionResult.data
                  .selectedTool as AvailableTool | null;
                parameters = {
                  prompt: toolSelectionResult.data.parameters?.prompt || input,
                };
                if (
                  hasMultiExplicitImages &&
                  preferAnalyzeForMultiImage &&
                  allowAnalyzeImageTool &&
                  selectedTool === "blendImages"
                ) {
                  selectedTool = "analyzeImage";
                  logProcessStep(
                    metrics,
                    "multi-image analyze intent override blendImages->analyzeImage"
                  );
                }
                logProcessStep(
                  metrics,
                  `tool decided: ${selectedTool ?? "none"}`
                );
              }
            }
          }

          if (!allowAnalyzeImageTool && selectedTool === "analyzeImage") {
            selectedTool = hasMultiExplicitImages ? "blendImages" : "editImage";
            logProcessStep(
              metrics,
              "analyzeImage disabled on stable banana route, fallback tool applied"
            );
          }

          if (!selectedTool) {
            throw new Error("未选择执行工具");
          }

          if (manualMode === "auto") {
            set({ autoSelectedTool: selectedTool });
          } else {
            set({ autoSelectedTool: null });
          }

          // 根据选择的工具执行相应操作
          // 获取最新的 store 实例来调用方法
          const store = get();

          try {
            switch (selectedTool) {
              case "generateImage":
                logProcessStep(metrics, "invoking generateImage");
                await store.generateImage(parameters.prompt, {
                  override: messageOverride,
                  metrics,
                });
                logProcessStep(metrics, "generateImage finished");
                break;

              case "editImage":
                if (state.sourceImageForEditing) {
                  logProcessStep(
                    metrics,
                    "invoking editImage with explicit image"
                  );
                  await store.editImage(
                    parameters.prompt,
                    state.sourceImageForEditing,
                    true,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "editImage finished");

                  // 🧠 检测是否需要保持编辑状态
                  if (!isIterative) {
                    store.setSourceImageForEditing(null);
                    contextManager.resetIteration();
                  }
                } else {
                  // 🖼️ 检查是否有缓存的图像可以编辑
                  const cachedImage = contextManager.getCachedImage();

                  const cachedSource = cachedImage
                    ? await resolveCachedImageForImageTools(cachedImage)
                    : null;

                  if (cachedImage && cachedSource) {
                    logProcessStep(
                      metrics,
                      "invoking editImage with cached image"
                    );
                    await store.editImage(
                      parameters.prompt,
                      cachedSource,
                      false,
                      { override: messageOverride, metrics }
                    ); // 不显示图片占位框
                    logProcessStep(metrics, "editImage finished");
                  } else {
                    console.error("❌ 无法编辑图像的原因:", {
                      cachedImage: cachedImage ? "exists" : "null",
                      hasRemoteUrl: !!cachedImage?.remoteUrl,
                      hasImageData: !!cachedImage?.imageData,
                      input: input,
                    });
                    throw new Error("没有可编辑的图像");
                  }
                }
                break;

              case "blendImages":
                if (state.sourceImagesForBlending.length >= 2) {
                  logProcessStep(metrics, "invoking blendImages");
                  await store.blendImages(
                    parameters.prompt,
                    state.sourceImagesForBlending,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "blendImages finished");
                  store.clearImagesForBlending();
                } else {
                  throw new Error("需要至少2张图像进行融合");
                }
                break;

              case "analyzeImage":
                if (
                  isAnalyzeDisabledOnCurrentBananaRoute(
                    state.aiProvider,
                    state.bananaImageRoute
                  )
                ) {
                  throw new Error("稳定通道暂不支持 Analysis，请切换到普通通道");
                }
                if (state.sourceImagesForBlending.length > 0) {
                  logProcessStep(
                    metrics,
                    "invoking analyzeImage (multi-image source)"
                  );
                  await store.analyzeImage(
                    parameters.prompt || input,
                    state.sourceImagesForBlending,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzeImage finished");
                  // 多图分析后保留源图，便于继续迭代提问
                } else if (state.sourceImageForAnalysis) {
                  logProcessStep(
                    metrics,
                    "invoking analyzeImage (analysis source)"
                  );
                  await store.analyzeImage(
                    parameters.prompt || input,
                    state.sourceImageForAnalysis,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzeImage finished");
                  store.setSourceImageForAnalysis(null);
                } else if (state.sourceImageForEditing) {
                  logProcessStep(
                    metrics,
                    "invoking analyzeImage (editing source)"
                  );
                  await store.analyzeImage(
                    parameters.prompt || input,
                    state.sourceImageForEditing,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzeImage finished");
                  // 分析后不清除图像，用户可能还想编辑
                } else {
                  // 🖼️ 检查是否有缓存的图像可以分析
                  const cachedImage = contextManager.getCachedImage();
                  const cachedSource = cachedImage
                    ? await resolveCachedImageForImageTools(cachedImage)
                    : null;
                  if (cachedImage && cachedSource) {
                    logProcessStep(
                      metrics,
                      "invoking analyzeImage (cached image)"
                    );
                    await store.analyzeImage(
                      parameters.prompt || input,
                      cachedSource,
                      { override: messageOverride, metrics }
                    );
                    logProcessStep(metrics, "analyzeImage finished");
                  } else {
                    throw new Error("没有可分析的图像");
                  }
                }
                break;

              case "analyzePdf":
                if (state.sourcePdfForAnalysis) {
                  logProcessStep(metrics, "invoking analyzePdf");
                  await store.analyzePdf(
                    parameters.prompt || input,
                    state.sourcePdfForAnalysis,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzePdf finished");
                  // analyzePdf 方法内部会清除 sourcePdfForAnalysis
                } else {
                  throw new Error("没有可分析的 PDF 文件");
                }
                break;

              case "chatResponse":
                try {
                  logProcessStep(metrics, "invoking generateTextResponse");
                  await store.generateTextResponse(parameters.prompt, {
                    override: messageOverride,
                    metrics,
                  });
                  logProcessStep(metrics, "generateTextResponse finished");
                } catch (error) {
                  console.error("❌ generateTextResponse 执行失败:", error);
                  if (error instanceof Error) {
                    console.error("❌ 错误堆栈:", error.stack);
                  }
                  throw error;
                }
                break;

              case "generateVideo":
                try {
                  logProcessStep(metrics, "invoking generateVideo");
                  await store.generateVideo(
                    parameters.prompt,
                    state.sourceImageForEditing,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "generateVideo finished");
                  // 清理源图像
                  if (state.sourceImageForEditing) {
                    store.setSourceImageForEditing(null);
                  }
                } catch (error) {
                  console.error("❌ generateVideo 执行失败:", error);
                  if (error instanceof Error) {
                    console.error("❌ 错误堆栈:", error.stack);
                  }
                  throw error;
                }
                break;

              case "generatePaperJS":
                try {
                  logProcessStep(metrics, "invoking generatePaperJS");
                  // 检查是否有上传的参考图像用于 img2vector
                  if (state.sourceImageForEditing) {
                    // 使用 img2vector 功能
                    const vectorStyle =
                      (state as any).vectorStyle || "detailed";
                    await store.img2Vector(
                      parameters.prompt,
                      state.sourceImageForEditing,
                      vectorStyle,
                      { override: messageOverride, metrics }
                    );
                    logProcessStep(metrics, "img2Vector finished");
                    // 清理源图像
                    store.setSourceImageForEditing(null);
                  } else {
                    // 使用普通的 generatePaperJS
                    await store.generatePaperJSCode(parameters.prompt, {
                      override: messageOverride,
                      metrics,
                    });
                    logProcessStep(metrics, "generatePaperJS finished");
                  }
                } catch (error) {
                  console.error("❌ Paper.js 代码生成失败:", error);
                  if (error instanceof Error) {
                    console.error("❌ 错误堆栈:", error.stack);
                  }
                  throw error;
                }
                break;

              default:
                throw new Error(`未知工具: ${selectedTool}`);
            }
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : "处理失败";
            get().updateMessage(messageOverride.aiMessageId, (msg) => ({
              ...msg,
              content: `处理失败: ${errorMessage}`,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));
            logProcessStep(metrics, "executeProcessFlow encountered error");
            throw err;
          } finally {
            // 确保无论工具执行成功或失败，都把当前会话状态立刻刷入持久层，
            // 避免 UI 已更新但刷新后回退到旧占位消息。
            try {
              await get().refreshSessions({ immediate: true });
            } catch (persistError) {
              console.warn("⚠️ executeProcessFlow 持久化会话失败:", persistError);
            }
          }
          logProcessStep(metrics, "executeProcessFlow done");
        },

        // 智能工具选择功能 - 统一入口（支持并行生成）
        processUserInput: async (input: string) => {
          const state = get();

          // 🧠 确保有活跃的会话并同步状态
          let sessionId =
            state.currentSessionId || contextManager.getCurrentSessionId();
          if (!sessionId) {
            sessionId = contextManager.createSession();
          } else if (contextManager.getCurrentSessionId() !== sessionId) {
            contextManager.switchSession(sessionId);
          }

          if (sessionId !== state.currentSessionId) {
            const context = contextManager.getSession(sessionId);
            set({
              currentSessionId: sessionId,
              messages: context ? [...context.messages] : [],
            });
          }

          get().refreshSessions();

          // 🧠 检测迭代意图（processUserInput 为统一入口，这里只计一次）
          const isIterative = contextManager.detectIterativeIntent(input);
          if (isIterative) {
            contextManager.incrementIteration();
          }

          // 🔥 工具选择可能较慢：先创建用户消息与占位 AI 消息，提供即时反馈
          const willCallAIToolSelection =
            state.manualAIMode === "auto" &&
            !state.sourcePdfForAnalysis;

          const userMessage = get().addMessage({
            type: "user",
            content: input,
          });

          const thinkingAiMessage = get().addMessage({
            type: "ai",
            content: willCallAIToolSelection
              ? "正在思考中..."
              : "正在准备处理您的请求...",
            generationStatus: {
              isGenerating: true,
              progress: 5,
              error: null,
              stage: willCallAIToolSelection ? "思考中" : "准备中",
            },
            provider: state.aiProvider,
          });

          const messageOverride: MessageOverride = {
            userMessageId: userMessage.id,
            aiMessageId: thinkingAiMessage.id,
          };

          // 🔥 第一步：先进行工具选择，判断用户意图（并复用结果，避免重复调用 /api/ai/tool-selection）
          // 只有确定是图片相关操作后，才应用 multiplier
          const manualMode = state.manualAIMode;
          const manualToolMap: Record<ManualAIMode, AvailableTool | null> = {
            auto: null,
            text: "chatResponse",
            generate: "generateImage",
            edit: "editImage",
            blend: "blendImages",
            analyze: "analyzeImage",
            video: "generateVideo",
            vector: "generatePaperJS",
          };

          let selectedTool: AvailableTool | null = null;
          let parameters: { prompt: string } = { prompt: input };

          // 如果是手动模式，直接使用对应工具
          if (manualMode !== "auto") {
            selectedTool = manualToolMap[manualMode];
          } else {
            // Auto 模式：先检查 PDF，再调用 AI 判断
            if (state.sourcePdfForAnalysis) {
              selectedTool = "analyzePdf";
            } else {
              // 调用 AI 进行工具选择
              const cachedImage = contextManager.getCachedImage();
              let explicitImageCount = 0;
              if (state.sourceImagesForBlending.length > 0) {
                explicitImageCount += state.sourceImagesForBlending.length;
              }
              if (state.sourceImageForEditing) {
                explicitImageCount += 1;
              }
              if (state.sourceImageForAnalysis) {
                explicitImageCount += 1;
              }
              const totalImageCount =
                explicitImageCount + (cachedImage ? 1 : 0);
              const toolSelectionContext =
                contextManager.buildContextPrompt(input);

              const isSingleExplicitImage =
                explicitImageCount === 1 &&
                state.sourceImagesForBlending.length === 0;
              const hasMultiExplicitImages = explicitImageCount > 1;
              const allowAnalyzeImageTool = !isAnalyzeDisabledOnCurrentBananaRoute(
                state.aiProvider,
                state.bananaImageRoute
              );
              const preferAnalyzeForMultiImage = hasMultiExplicitImages
                ? prefersAnalyzeForMultiImage(input)
                : false;

              const availableToolsForSelection: AvailableTool[] =
                isSingleExplicitImage
                  ? allowAnalyzeImageTool
                    ? ["editImage", "analyzeImage"]
                    : ["editImage"]
                  : hasMultiExplicitImages
                    ? allowAnalyzeImageTool && preferAnalyzeForMultiImage
                      ? ["analyzeImage", "blendImages"]
                      : allowAnalyzeImageTool
                        ? ["blendImages", "analyzeImage"]
                        : ["blendImages"]
                    : [
                        "generateImage",
                        "editImage",
                        "blendImages",
                        ...(allowAnalyzeImageTool
                          ? (["analyzeImage"] as AvailableTool[])
                          : []),
                        "chatResponse",
                        "generateVideo",
                        "generatePaperJS",
                      ];

              const toolSelectionRequest = {
                userInput: input,
                hasImages: totalImageCount > 0,
                imageCount: explicitImageCount,
                hasCachedImage: !!cachedImage,
                availableTools: availableToolsForSelection,
                aiProvider: state.aiProvider,
                model: getTextModelForProvider(state.aiProvider),
                context: toolSelectionContext,
              };

              try {
                const toolSelectionResult = await aiImageService.selectTool(
                  toolSelectionRequest
                );
                if (toolSelectionResult.success && toolSelectionResult.data) {
                  selectedTool = toolSelectionResult.data
                    .selectedTool as AvailableTool;
                  parameters = {
                    prompt: toolSelectionResult.data.parameters?.prompt || input,
                  };
                  if (
                    hasMultiExplicitImages &&
                    preferAnalyzeForMultiImage &&
                    allowAnalyzeImageTool &&
                    selectedTool === "blendImages"
                  ) {
                    selectedTool = "analyzeImage";
                  }
                  console.log(
                    `🎯 [工具选择] AI 选择了: ${selectedTool} (singleImage=${isSingleExplicitImage}, multiImage=${hasMultiExplicitImages})`
                  );
                } else {
                  selectedTool = isSingleExplicitImage
                    ? "editImage"
                    : hasMultiExplicitImages
                      ? prefersAnalyzeForMultiImage(input)
                        ? allowAnalyzeImageTool
                          ? "analyzeImage"
                          : "blendImages"
                        : "blendImages"
                      : "chatResponse";
                  console.warn(
                    `⚠️ 工具选择失败，默认使用 ${selectedTool} (singleImage=${isSingleExplicitImage}, multiImage=${hasMultiExplicitImages})`
                  );
                }
              } catch (error) {
                console.error("❌ 工具选择异常:", error);
                selectedTool = isSingleExplicitImage
                  ? "editImage"
                  : hasMultiExplicitImages
                    ? prefersAnalyzeForMultiImage(input)
                      ? allowAnalyzeImageTool
                        ? "analyzeImage"
                        : "blendImages"
                      : "blendImages"
                    : "chatResponse";
              }

              if (!allowAnalyzeImageTool && selectedTool === "analyzeImage") {
                selectedTool = hasMultiExplicitImages
                  ? "blendImages"
                  : "editImage";
              }
            }
          }

          if (!selectedTool) {
            console.warn("⚠️ 未获取到工具选择结果，默认使用 chatResponse");
            selectedTool = "chatResponse";
          }

          // 🔥 第二步：根据选择的工具决定是否应用 multiplier
          // 只有图片生成相关工具才支持并行生成
          const imageGenerationTools: AvailableTool[] = [
            "generateImage",
            "editImage",
            "blendImages",
          ];
          const isImageGenerationTool =
            selectedTool && imageGenerationTools.includes(selectedTool);

          const multiplier: AutoModeMultiplier = isImageGenerationTool
            ? state.autoModeMultiplier
            : 1;

          console.log(
            `🔧 [处理流程] 工具: ${selectedTool}, multiplier: ${multiplier}`
          );

          // 🔥 第三步：根据 multiplier 决定是单次还是并行执行
          if (multiplier === 1) {
            // 单次执行 - 使用 executeProcessFlow，并复用已创建消息与工具选择结果
            try {
              await get().executeProcessFlow(input, false, undefined, {
                override: messageOverride,
                selectedTool,
                parameters,
              });
            } catch (error) {
              let errorMessage =
                error instanceof Error ? error.message : "处理失败";

              if (
                errorMessage &&
                errorMessage.length > 1000 &&
                errorMessage.includes("iVBORw0KGgo")
              ) {
                console.warn(
                  "⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息"
                );
                errorMessage = "图像处理失败，请重试";
              }

              const messages = get().messages;
              const hasErrorSurface = messages.some(
                (msg) =>
                  msg.type === "ai" &&
                  msg.generationStatus?.stage === "已终止" &&
                  msg.generationStatus?.error === errorMessage
              );
              if (!hasErrorSurface) {
                get().addMessage({
                  type: "error",
                  content: `处理失败: ${errorMessage}`,
                });
              }

              console.error("❌ 智能处理异常:", error);
            }
          } else {
            // 🔥 并行生成 - 只有图片相关工具才会走到这里
            const groupId = `group-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`;
            console.log(
              `🚀 [并行生成] 开始并行生成 ${multiplier} 张图片，groupId: ${groupId}, 工具: ${selectedTool}`
            );

            // 🔥 预先创建所有 AI 占位消息
            get().updateMessage(userMessage.id, (msg) => ({
              ...msg,
              groupId,
              groupIndex: 0,
              groupTotal: multiplier,
            }));

            get().updateMessage(thinkingAiMessage.id, (msg) => ({
              ...msg,
              content: `正在生成第 1/${multiplier} 张...`,
              expectsImageOutput: true,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                progress: 5,
                error: null,
                stage: "准备中",
              },
              groupId,
              groupIndex: 0,
              groupTotal: multiplier,
            }));

            const aiMessageIds: string[] = [thinkingAiMessage.id];
            for (let i = 1; i < multiplier; i++) {
              const aiMsg = get().addMessage({
                type: "ai",
                content: `正在生成第 ${i + 1}/${multiplier} 张...`,
                generationStatus: {
                  isGenerating: true,
                  progress: 5,
                  error: null,
                  stage: "准备中",
                },
                groupId,
                groupIndex: i,
                groupTotal: multiplier,
                expectsImageOutput: true,
              });
              aiMessageIds.push(aiMsg.id);
            }

            // 🔥 无论并发是否被降级，都先一次性创建全部画板占位符
            // 避免在 concurrency=1 时用户只能看到第一个占位框，造成“没有多张并行”的误解
            try {
              const cached = contextManager.getCachedImage();
              const offsetHorizontal =
                useUIStore.getState().smartPlacementOffsetHorizontal || 522;
              const offsetVertical =
                useUIStore.getState().smartPlacementOffsetVertical || 552;
              const operationType =
                selectedTool === "editImage"
                  ? "edit"
                  : selectedTool === "blendImages"
                  ? "blend"
                  : "generate";
              const size = estimatePlaceholderSize({
                aspectRatio: state.aspectRatio,
                imageSize: state.imageSize,
                fallbackBounds: cached?.bounds ?? null,
              });

              let baseX: number;
              let baseY: number;
              if (cached?.bounds) {
                baseX = cached.bounds.x + cached.bounds.width / 2;
                baseY =
                  cached.bounds.y + cached.bounds.height / 2 + offsetVertical;
              } else {
                const viewCenter = getViewCenter();
                baseX = viewCenter?.x ?? 0;
                baseY = viewCenter?.y ?? 0;
              }
              const layoutAnchor = { x: baseX, y: baseY };

              aiMessageIds.forEach((id, index) => {
                const center = {
                  x: baseX + index * offsetHorizontal,
                  y: baseY,
                };
                dispatchPlaceholderEvent({
                  placeholderId: `ai-placeholder-${id}`,
                  center,
                  width: size.width,
                  height: size.height,
                  operationType,
                  preferSmartLayout: true,
                  smartPosition: center,
                  groupId,
                  groupIndex: index,
                  groupTotal: multiplier,
                  preferHorizontal: true,
                  groupAnchor: layoutAnchor,
                });
              });
            } catch (error) {
              console.warn("⚠️ [并行生成] 预创建画板占位符失败:", error);
            }

            // ⚠️ 这里不要真正 Promise.all 并发：多张大图同时解码/转码会造成瞬时内存峰值。
            // 改为限制并发执行（仍保留“批量生成”的 UX：先占位，后逐个完成）。
            const deviceMemory =
              typeof navigator !== "undefined"
                ? (navigator as any).deviceMemory
                : undefined;
            const imageSize = state.imageSize ?? "1K";
            const suggestedConcurrency =
              imageSize === "4K" ||
              (typeof deviceMemory === "number" && deviceMemory <= 4)
                ? 1
                : MAX_AI_IMAGE_PARALLEL_CONCURRENCY;
            const concurrencyLimit = Math.min(
              AI_IMAGE_PARALLEL_CONCURRENCY_LIMIT,
              suggestedConcurrency
            );
            const concurrency = Math.max(1, Math.min(multiplier, concurrencyLimit));

            void (async () => {
              const results = await mapWithLimit(
                aiMessageIds,
                concurrency,
                async (aiMessageId, index) => {
                  try {
                    await get().executeParallelImageGeneration(input, {
                      groupId,
                      groupIndex: index,
                      groupTotal: multiplier,
                      userMessageId: userMessage.id,
                      aiMessageId,
                    });
                    return true;
                  } catch (error) {
                    console.error(
                      `❌ [并行生成] 第 ${index + 1} 个任务失败:`,
                      error
                    );
                    get().updateMessageStatus(aiMessageId, {
                      isGenerating: false,
                      error:
                        error instanceof Error ? error.message : "生成失败",
                    });
                    return false;
                  }
                }
              );

              const successCount = results.filter(Boolean).length;
              console.log(
                `✅ [并行生成] 完成，成功 ${successCount}/${multiplier} (concurrency=${concurrency})`
              );
            })().catch((error) => {
              console.error("❌ [并行生成] 执行队列异常:", error);
            });
          }
        },

        // 🔥 并行图片生成 - 使用预创建的消息，直接调用 generateImage
        executeParallelImageGeneration: async (
          input: string,
          options: {
            groupId: string;
            groupIndex: number;
            groupTotal: number;
            userMessageId: string;
            aiMessageId: string;
          }
        ) => {
          const { aiMessageId, userMessageId, groupIndex } = options;
          const metrics = createProcessMetrics();
          metrics.messageId = aiMessageId;
          logProcessStep(
            metrics,
            `parallel generation ${options.groupIndex + 1}/${
              options.groupTotal
            } start`
          );

          // 🔥 为每个并行任务添加递增的启动延迟，避免占位符位置计算冲突
          // 第一个立即开始，后续每个延迟 200ms
          if (groupIndex > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, groupIndex * 200)
            );
          }

          const messageOverride: MessageOverride = {
            userMessageId,
            aiMessageId,
          };

          // 读取当前模式与素材，决定到底是生成、编辑还是融合
          const stateSnapshot = get();
          const manualMode = stateSnapshot.manualAIMode;
          const sourceImageForEditing = stateSnapshot.sourceImageForEditing;
          const blendSources = stateSnapshot.sourceImagesForBlending
            ? [...stateSnapshot.sourceImagesForBlending]
            : [];
          const hasBlendSources = blendSources.length >= 2;

          const decideParallelTool = (): "generate" | "edit" | "blend" => {
            if (manualMode === "edit") return "edit";
            if (manualMode === "blend") return "blend";

            // Auto 模式：优先融合，其次编辑，最后生成
            if (manualMode === "auto") {
              if (hasBlendSources) return "blend";
              if (sourceImageForEditing) return "edit";
              return "generate";
            }

            // 其它模式默认仍然走生成
            return "generate";
          };

          const selectedTool = decideParallelTool();

          try {
            if (selectedTool === "edit") {
              const cached = contextManager.getCachedImage();
              const cachedSource = cached
                ? await resolveCachedImageForImageTools(cached)
                : null;
              const editSource = sourceImageForEditing || cachedSource;

              if (!editSource) {
                console.warn("⚠️ [并行编辑] 未找到可编辑的源图，退回生成逻辑");
                await get().generateImage(input, {
                  override: messageOverride,
                  metrics,
                });
              } else {
                await get().editImage(input, editSource, true, {
                  override: messageOverride,
                  metrics,
                });
              }
              logProcessStep(
                metrics,
                `parallel edit ${options.groupIndex + 1}/${
                  options.groupTotal
                } done`
              );
            } else if (selectedTool === "blend") {
              if (!hasBlendSources) {
                console.warn("⚠️ [并行融合] 源图不足，退回生成逻辑");
                await get().generateImage(input, {
                  override: messageOverride,
                  metrics,
                });
              } else {
                await get().blendImages(input, blendSources, {
                  override: messageOverride,
                  metrics,
                });
                // 并行融合完成后不立即清空源图，由外层流程统一处理
              }
              logProcessStep(
                metrics,
                `parallel blend ${options.groupIndex + 1}/${
                  options.groupTotal
                } done`
              );
            } else {
              // 直接调用 generateImage
              await get().generateImage(input, {
                override: messageOverride,
                metrics,
              });
              logProcessStep(
                metrics,
                `parallel generation ${options.groupIndex + 1}/${
                  options.groupTotal
                } done`
              );
            }
          } catch (error) {
            logProcessStep(
              metrics,
              `parallel generation ${options.groupIndex + 1}/${
                options.groupTotal
              } error`
            );
            throw error;
          }
        },

        getAIMode: () => {
          const state = get();
          if (state.manualAIMode && state.manualAIMode !== "auto") {
            if (state.manualAIMode === "text") return "text";
            return state.manualAIMode;
          }
          if (state.autoSelectedTool === "generateVideo") return "video";
          if (state.sourceImagesForBlending.length >= 2) return "blend";
          if (state.sourceImageForEditing) return "edit";
          if (state.sourcePdfForAnalysis) return "analyzePdf";
          if (state.sourceImageForAnalysis) return "analyze";
          return "generate";
        },

        // 配置管理
        toggleAutoDownload: () =>
          set((state) => ({ autoDownload: !state.autoDownload })),
        setAutoDownload: (value: boolean) => set({ autoDownload: value }),
        toggleWebSearch: () =>
          set((state) => ({ enableWebSearch: !state.enableWebSearch })),
        setWebSearch: (value: boolean) => set({ enableWebSearch: value }),
        toggleImageOnly: () =>
          set((state) => ({ imageOnly: !state.imageOnly })),
        setImageOnly: (value: boolean) => set({ imageOnly: value }),
        setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
        setImageSize: (size) => {
          console.log("📐 [Image Size] 切换分辨率:", {
            from: get().imageSize || "自动(1K)",
            to: size || "自动(1K)",
            currentProvider: get().aiProvider,
            warning:
              size === "4K" && get().aiProvider === "banana-2.5"
                ? "⚠️ Fast模式不支持4K，建议切换到Pro/Ultra"
                : null,
          });
          set({ imageSize: size });
        },
        setThinkingLevel: (level) => set({ thinkingLevel: level }),
        setVideoAspectRatio: (ratio) => set({ videoAspectRatio: ratio }),
        setVideoDurationSeconds: (seconds) =>
          set({ videoDurationSeconds: seconds }),
        setManualAIMode: (mode) =>
          set({ manualAIMode: mode, autoSelectedTool: null }),
        setAIProvider: (provider, options) => {
          console.log("🔄 [AI Provider] 切换模式:", {
            from: get().aiProvider,
            to: provider,
            label:
              provider === "banana-2.5"
                ? "Fast (Fast版)"
                : provider === "banana"
                ? "Pro (Pro版)"
                : provider === "banana-3.1"
                ? "Ultra (Ultra版)"
                : provider,
          });
          set({ aiProvider: provider });
          if (options?.syncFlowNodes === false) return;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent(FLOW_MODEL_PROVIDER_SYNC_EVENT, {
                detail: {
                  provider,
                  source: options?.source || "global",
                },
              })
            );
          }
        },
        setBananaImageRoute: (route) => {
          set({ bananaImageRoute: route });
          if (typeof window !== "undefined") {
            (window as any).__tanvaBananaImageRoute = route;
          }
        },
        setAutoModeMultiplier: (multiplier) => {
          const allowed: AutoModeMultiplier[] = [1, 2, 4, 8];
          const next = allowed.includes(multiplier) ? multiplier : 1;
          set({ autoModeMultiplier: next });
        },
        setSendShortcut: (shortcut) => {
          const next = shortcut === "enter" ? "enter" : "mod-enter";
          set({ sendShortcut: next });
        },
        setExpandedPanelStyle: (style) => {
          const next = style === "solid" ? "solid" : "transparent";
          set({ expandedPanelStyle: next });
        },
        setChatTheme: (theme) => {
          const next: ChatTheme = theme === "black" ? "black" : "white";
          set({ chatTheme: next });
        },

        // 重置状态
        resetState: () => {
          revokeAllVideoObjectUrls();
          set({
            isVisible: false,
            isMaximized: false,
            currentInput: "",
            generationStatus: {
              isGenerating: false,
              progress: 0,
              error: null,
            },
            messages: [],
            lastGeneratedImage: null,
            sourceImageForEditing: null,
            preciseEditContext: null,
            sourceImagesForBlending: [],
            sourceImageForAnalysis: null,
            sourcePdfForAnalysis: null,
            sourcePdfFileName: null,
          });
        },

        // 🧠 上下文管理方法实现
        initializeContext: () => {
          // 异步加载本地会话（IndexedDB 优先，兼容 localStorage）
          if (!hasHydratedSessions) {
            loadLocalSessions().then((stored) => {
              if (stored && stored.sessions.length > 0) {
                get().hydratePersistedSessions(
                  stored.sessions,
                  stored.activeSessionId,
                  { markProjectDirty: false }
                );
              }
            });
          }

          let sessionId = contextManager.getCurrentSessionId();
          if (!sessionId) {
            const existingSessions = contextManager.listSessions();
            if (existingSessions.length > 0) {
              sessionId = existingSessions[0].sessionId;
              contextManager.switchSession(sessionId);
            } else {
              sessionId = contextManager.createSession();
            }
          }

          const context = sessionId
            ? contextManager.getSession(sessionId)
            : null;
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          void rehydrateActiveSessionLocalVideos(sessionId);
          hasHydratedSessions = true;
          get().refreshSessions({ markProjectDirty: false });
        },

        getContextSummary: () => {
          return contextManager.getSessionSummary();
        },

        isIterativeMode: () => {
          const context = contextManager.getCurrentContext();
          return context ? context.contextInfo.iterationCount > 0 : false;
        },

        enableIterativeMode: () => {
          contextManager.incrementIteration();
        },

        disableIterativeMode: () => {
          contextManager.resetIteration();
        },
      };
    },
    {
      name: "ai-chat-preferences",
      storage: createJSONStorage<Partial<AIChatState>>(() =>
        createSafeStorage({ storageName: "ai-chat-preferences" })
      ),
      version: AI_CHAT_PREFERENCES_VERSION,
      migrate: (persistedState: unknown): Partial<AIChatState> => {
        if (!persistedState || typeof persistedState !== "object") return {};
        const state = persistedState as Partial<AIChatState>;

        const validManualModes = [
          "auto",
          "text",
          "generate",
          "edit",
          "blend",
          "analyze",
          "video",
          "vector",
        ];
        const validSendShortcuts = ["enter", "mod-enter"];
        const validExpandedStyles = ["transparent", "solid"];
        const validChatThemes = ["white", "black"];
        const validVideoRatios = ["16:9", "9:16"];
        const validVideoDurations = AI_CHAT_VIDEO_DURATION_OPTIONS.map(String);
        const validBananaImageRoutes = ["normal", "stable"];

        return {
          ...state,
          manualAIMode: validManualModes.includes(String(state.manualAIMode))
            ? (state.manualAIMode as AIChatState["manualAIMode"])
            : "auto",
          autoDownload: typeof state.autoDownload === "boolean" ? state.autoDownload : true,
          enableWebSearch:
            typeof state.enableWebSearch === "boolean" ? state.enableWebSearch : false,
          videoAspectRatio: validVideoRatios.includes(String(state.videoAspectRatio))
            ? (state.videoAspectRatio as AIChatState["videoAspectRatio"])
            : null,
          videoDurationSeconds: validVideoDurations.includes(
            String(state.videoDurationSeconds)
          )
            ? (state.videoDurationSeconds as AIChatState["videoDurationSeconds"])
            : null,
          sendShortcut: validSendShortcuts.includes(String(state.sendShortcut))
            ? (state.sendShortcut as AIChatState["sendShortcut"])
            : "enter",
          expandedPanelStyle: validExpandedStyles.includes(String(state.expandedPanelStyle))
            ? (state.expandedPanelStyle as AIChatState["expandedPanelStyle"])
            : "transparent",
          chatTheme: validChatThemes.includes(String(state.chatTheme))
            ? (state.chatTheme as AIChatState["chatTheme"])
            : "white",
          bananaImageRoute: validBananaImageRoutes.includes(
            String(state.bananaImageRoute)
          )
            ? (state.bananaImageRoute as AIChatState["bananaImageRoute"])
            : "normal",
        };
      },
      partialize: (state) => ({
        manualAIMode: state.manualAIMode,
        aiProvider: state.aiProvider,
        bananaImageRoute: state.bananaImageRoute,
        autoDownload: state.autoDownload,
        enableWebSearch: state.enableWebSearch,
        aspectRatio: state.aspectRatio,
        imageSize: state.imageSize,
        thinkingLevel: state.thinkingLevel,
        videoAspectRatio: state.videoAspectRatio,
        videoDurationSeconds: state.videoDurationSeconds,
        autoModeMultiplier: state.autoModeMultiplier,
        sendShortcut: state.sendShortcut,
        expandedPanelStyle: state.expandedPanelStyle,
        chatTheme: state.chatTheme,
      }),
      // 确保新字段能正确合并，使用初始状态的默认值填充缺失字段
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<AIChatState>),
        // imageOnly 开关已不在对话框中暴露，避免历史持久化把用户锁在"仅图片"模式
        imageOnly: currentState.imageOnly,
        // 每次重新进入都重置为尊享路线，不沿用上次持久化的路线选择
        bananaImageRoute: "stable",
      }),
    }
  )
);

if (typeof window !== "undefined") {
  try {
    // 订阅 messages 变化并记录对话快照
    let previousMessages = useAIChatStore.getState().messages;

    // Vite/React Fast Refresh 下，模块可能被多次重新执行；清理旧订阅，避免重复订阅导致内存增长
    const globalAny = window as any;
    globalAny.__tanvaBananaImageRoute =
      useAIChatStore.getState().bananaImageRoute;
    const prevUnsub = globalAny.__tanvaAIChatDebugUnsubscribe;
    if (typeof prevUnsub === "function") {
      try {
        prevUnsub();
      } catch {}
    }

    globalAny.__tanvaAIChatDebugUnsubscribe = useAIChatStore.subscribe(
      (state) => {
      if (globalAny.__tanvaBananaImageRoute !== state.bananaImageRoute) {
        globalAny.__tanvaBananaImageRoute = state.bananaImageRoute;
      }
      const messages = state.messages;
      if (messages === previousMessages) return;
      previousMessages = messages;
      logChatConversationSnapshot(messages);
      }
    );

    (window as any).tanvaDebugConversation = () => {
      const messages = useAIChatStore.getState().messages;
      logChatConversationSnapshot(messages);
      return messages;
    };
  } catch (error) {
    console.warn("⚠️ 初始化AI对话调试订阅失败:", error);
  }
}

try {
  const hot = (import.meta as any)?.hot;
  if (hot) {
    hot.dispose(() => {
      try {
        const globalAny = window as any;
        const unsub = globalAny.__tanvaAIChatDebugUnsubscribe;
        if (typeof unsub === "function") {
          try {
            unsub();
          } catch {}
        }
        globalAny.__tanvaAIChatDebugUnsubscribe = null;
      } catch {}
    });
  }
} catch {}

/**
 * 上传音频到 OSS
 */
export async function uploadAudioToOSS(
  audioDataOrUrl: string,
  projectId?: string | null
): Promise<string | null> {
  try {
    if (!audioDataOrUrl) return null;
    if (/^https?:\/\//.test(audioDataOrUrl)) return audioDataOrUrl;
    if (!audioDataOrUrl.includes("base64,")) {
      console.warn("⚠️ 非支持的音频数据格式，跳过上传");
      return null;
    }

    const blob = dataURLToBlob(audioDataOrUrl);
    const mimeMatch = audioDataOrUrl.match(/^data:([^;]+);/);
    const contentType = mimeMatch ? mimeMatch[1] : "audio/mpeg";
    const normalizedType = contentType.toLowerCase();
    const extMap: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/aac": "aac",
      "audio/mp4": "m4a",
      "audio/x-m4a": "m4a",
      "audio/ogg": "ogg",
      "audio/opus": "opus",
      "audio/flac": "flac",
      "audio/x-flac": "flac",
      "audio/webm": "webm",
      "audio/amr": "amr",
      "audio/aiff": "aiff",
      "audio/x-aiff": "aiff",
      "audio/x-ms-wma": "wma",
    };
    const ext =
      extMap[normalizedType] ||
      (normalizedType.startsWith("audio/")
        ? normalizedType
            .slice(6)
            .split("+")[0]
            .replace(/^x-/, "")
            .replace("mpeg", "mp3")
        : "mp3");

    const result = await ossUploadService.uploadToOSS(blob, {
      dir: "ai-chat-audios/",
      projectId,
      fileName: `ai-audio-${Date.now()}.${ext || "mp3"}`,
      contentType,
    });

    if (result.success && result.url) {
      return result.url;
    } else {
      const errMsg = result.error || "音频上传失败";
      console.error("❌ 音频上传失败:", errMsg);
      throw new Error(errMsg);
    }
  } catch (error: any) {
    console.error("❌ 音频上传异常:", error);
    throw error;
  }
}

/**
 * 从远程 URL 下载视频并上传到 OSS，返回持久化的 OSS URL
 * 用于将临时的 presigned URL 转换为永久可访问的 OSS URL
 */
export async function uploadVideoToOSS(
  videoUrl: string,
  projectId?: string | null
): Promise<string | null> {
  try {
    if (!videoUrl || typeof videoUrl !== "string") {
      console.warn("⚠️ 无效的视频 URL，跳过上传");
      return null;
    }

    const trimmed = videoUrl.trim();
    if (!trimmed) return null;

    // 如果已经是我们自己的 OSS URL，直接返回
    if (trimmed.includes("aliyuncs.com") && !trimmed.includes("X-Amz")) {
      return trimmed;
    }

    console.log("🎬 [uploadVideoToOSS] 开始下载视频:", trimmed.slice(0, 100));

    // 下载远程视频
    const response = await fetch(trimmed, {
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`视频下载失败: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    console.log("🎬 [uploadVideoToOSS] 视频下载完成, 大小:", blob.size);

    // 确定 content-type
    let contentType = blob.type || "video/mp4";
    if (!contentType.startsWith("video/")) {
      contentType = "video/mp4";
    }

    // 上传到 OSS
    const result = await ossUploadService.uploadToOSS(blob, {
      dir: "ai-generated-videos/",
      projectId,
      fileName: `video-${Date.now()}.mp4`,
      contentType,
    });

    if (result.success && result.url) {
      console.log("✅ [uploadVideoToOSS] 视频上传成功:", result.url);
      return result.url;
    } else {
      const errMsg = result.error || "视频上传失败";
      console.error("❌ [uploadVideoToOSS] 视频上传失败:", errMsg);
      return null;
    }
  } catch (error: any) {
    console.error("❌ [uploadVideoToOSS] 视频上传异常:", error);
    return null;
  }
}

// 当画布被清空时，同步清理 AI 对话框的参考图/缓存图，避免遗留 blob: 引用占用内存
const AI_CHAT_PAPER_CLEARED_LISTENER_FLAG =
  "__tanva_aiChat_paperProjectClearedListenerRegistered";

if (typeof window !== "undefined") {
  const win = window as any;
  if (!win[AI_CHAT_PAPER_CLEARED_LISTENER_FLAG]) {
    win[AI_CHAT_PAPER_CLEARED_LISTENER_FLAG] = true;
    window.addEventListener("paper-project-cleared", () => {
      try {
        const store = useAIChatStore.getState();
        store.setSourceImageForEditing(null);
        store.setPreciseEditContext(null);
        store.clearImagesForBlending();
        store.setSourceImageForAnalysis(null);
        store.setSourcePdfForAnalysis(null);
      } catch {}

      try {
        contextManager.clearImageCache();
      } catch {}
    });
  }
}
