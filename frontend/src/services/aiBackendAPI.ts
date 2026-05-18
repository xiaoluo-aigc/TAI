/**
 * 后端 AI API 调用适配层
 * 将前端的本地调用改为调用后端 API
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AIImageGenerateRequest,
  AIImageEditRequest,
  AIImageBlendRequest,
  AIImageAnalyzeRequest,
  AITextChatRequest,
  AIImageResult,
  AIImageAnalysisResult,
  AITextChatResult,
  AIServiceResponse,
  SupportedAIProvider,
  MidjourneyActionRequest,
  MidjourneyModalRequest,
} from "@/types/ai";
import { fetchWithAuth } from "./authFetch";
import { logger } from "@/utils/logger";

// 后端基础地址，统一从 .env 读取；无配置则默认 http://localhost:4000
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api";
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const BANANA_25_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
const BANANA_31_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const RUNNINGHUB_IMAGE_MODEL = "runninghub-su-effect";
const MIDJOURNEY_IMAGE_MODEL = "midjourney-fast";
const SEEDREAM5_IMAGE_MODEL = "doubao-seedream-5-0-260128";

const getTimestamp = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const logApiTiming = (
  endpoint: string,
  startTime: number,
  meta?: Record<string, any>
) => {
  const duration = getTimestamp() - startTime;
  logger.perf(`AI API ${endpoint}`, duration, meta);
};

type ImageResponseLogMeta = {
  endpoint: string;
  provider?: SupportedAIProvider;
  model?: string;
  prompt?: string;
};

const truncateText = (value: string, maxLength: number = 80) =>
  typeof value === "string" && value.length > maxLength
    ? `${value.slice(0, maxLength)}...`
    : value;

const logAIImageResponse = (
  meta: ImageResponseLogMeta,
  payload: { imageData?: string; imageUrl?: string; textResponse?: string }
) => {
  const hasImageData =
    typeof payload.imageData === "string" &&
    payload.imageData.trim().length > 0;
  const hasImageUrl =
    typeof payload.imageUrl === "string" && payload.imageUrl.trim().length > 0;
  const textResponse =
    typeof payload.textResponse === "string" &&
    payload.textResponse.trim().length > 0
      ? payload.textResponse
      : "";
  const logger = hasImageData || hasImageUrl ? console.log : console.warn;

  logger(`${hasImageData || hasImageUrl ? "🖼️" : "📝"} [AI API] ${meta.endpoint} 响应摘要`, {
    provider: meta.provider || "unknown",
    model: meta.model || "unspecified",
    promptPreview: meta.prompt ? truncateText(meta.prompt, 60) : "N/A",
    hasImageData,
    imageDataLength: payload.imageData?.length || 0,
    hasImageUrl,
    imageUrlPreview: payload.imageUrl ? truncateText(payload.imageUrl, 120) : "N/A",
    textResponsePreview: textResponse ? truncateText(textResponse, 80) : "N/A",
  });

  console.log(`🧾 [AI API] ${meta.endpoint} 返回详情`, {
    textResponse: textResponse || "(无文本返回)",
    hasImage: hasImageData || hasImageUrl,
  });
};

const generateUUID = () => {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fall back
  }

  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
        .slice(6, 8)
        .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
  } catch {
    // ignore and fall back
  }

  try {
    return uuidv4();
  } catch {
    // ignore final fallback
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const buildIdempotencyKey = (scope: string) =>
  `${scope}-${Date.now()}-${generateUUID()}`;

type BananaImageRoute = "normal" | "stable";

const normalizeBananaImageRoute = (value: unknown): BananaImageRoute | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "normal" || normalized === "apimart") return "normal";
  if (normalized === "stable" || normalized === "tencent") return "stable";
  return null;
};

const normalizeBananaImageSizeToken = (
  value: unknown
): "0.5K" | "1K" | "2K" | "4K" | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "0.5K" ||
    normalized === "1K" ||
    normalized === "2K" ||
    normalized === "4K"
  ) {
    return normalized;
  }
  return null;
};

const isBananaRouteCapableProvider = (
  provider: SupportedAIProvider | undefined
): boolean => {
  const normalized = String(provider || "").trim().toLowerCase();
  return (
    normalized === "banana" ||
    normalized === "banana-3.0" ||
    normalized === "banana-2.5" ||
    normalized === "banana-3.1" ||
    normalized === "gemini-pro" ||
    normalized === "nano2"
  );
};

const resolvePersistedBananaImageRoute = (): BananaImageRoute | null => {
  if (typeof window === "undefined") return null;
  try {
    const runtimeRoute = normalizeBananaImageRoute(
      (window as any).__tanvaBananaImageRoute
    );
    if (runtimeRoute) return runtimeRoute;

    const raw = window.localStorage.getItem("ai-chat-preferences");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as
      | { state?: { bananaImageRoute?: unknown }; bananaImageRoute?: unknown }
      | null;
    return (
      normalizeBananaImageRoute(parsed?.state?.bananaImageRoute) ||
      normalizeBananaImageRoute(parsed?.bananaImageRoute)
    );
  } catch {
    return null;
  }
};

const resolveRequestBananaImageRoute = (request: {
  providerOptions?: Record<string, any>;
}): BananaImageRoute | null => {
  const routeFromRequest =
    normalizeBananaImageRoute(request.providerOptions?.banana?.imageRoute) ||
    normalizeBananaImageRoute(request.providerOptions?.bananaImageRoute);
  if (routeFromRequest) return routeFromRequest;
  return resolvePersistedBananaImageRoute();
};

const attachBananaRouteToProviderOptions = <T extends {
  aiProvider?: SupportedAIProvider;
  providerOptions?: Record<string, any>;
  imageSize?: string;
}>(
  request: T
): { request: T; bananaImageRoute: BananaImageRoute | null } => {
  if (!isBananaRouteCapableProvider(request.aiProvider)) {
    return { request, bananaImageRoute: null };
  }
  const resolvedRoute = resolveRequestBananaImageRoute(request);
  if (!resolvedRoute) {
    return { request, bananaImageRoute: null };
  }

  const baseOptions =
    request.providerOptions && typeof request.providerOptions === "object"
      ? request.providerOptions
      : {};
  const bananaOptions =
    baseOptions.banana && typeof baseOptions.banana === "object"
      ? baseOptions.banana
      : {};
  const normalizedImageSize =
    normalizeBananaImageSizeToken(request.imageSize) ||
    (typeof request.imageSize === "string" ? request.imageSize : undefined);
  const nextRequest = {
    ...request,
    ...(normalizedImageSize ? { imageSize: normalizedImageSize } : {}),
    providerOptions: {
      ...baseOptions,
      banana: {
        ...bananaOptions,
        imageRoute: resolvedRoute,
      },
      bananaImageRoute: resolvedRoute,
    },
  } as T;
  return { request: nextRequest, bananaImageRoute: resolvedRoute };
};

// 前端图像接口重试会导致同一次用户操作产生多条积分扣减/退款流水；
// 统一收敛为单次请求，容错交给后端 provider 内部重试与 fallback。
const MAX_IMAGE_GENERATION_ATTEMPTS = 1;
const NO_IMAGE_RETRY_DELAY_MS = 800;
const TEXT_CHAT_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeAIErrorMessage = (
  rawMessage?: string,
  status?: number
): string => {
  const normalized = typeof rawMessage === 'string' ? rawMessage.trim() : '';
  const lower = normalized.toLowerCase();

  // 524 或任何包含 timeout/gateway timeout 的错误
  if (
    status === 524 ||
    lower.includes('524') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('gateway timeout') ||
    lower.includes('服务器处理超时')
  ) {
    return '图像生成处理超时（已等待 15 分钟），请简化参数后重试。';
  }

  // 500/502/503/504 统一提示
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return '图像供应商服务暂时不可用，请稍后重试。';
  }

  if (normalized) return normalized;
  return '网络异常，请稍后重试';
};

const normalizeImageGenerationErrorMessage = normalizeAIErrorMessage;

const parseHttpStatusFromErrorCode = (code?: string): number | null => {
  if (!code) return null;
  const match = code.match(/^HTTP_(\d{3})$/);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
};

const isRetryableImageGenerationError = (error?: {
  code?: string;
  message?: string;
}): boolean => {
  if (!error) return false;
  if (error.code === "NETWORK_ERROR") return true;

  const status = parseHttpStatusFromErrorCode(error.code);
  if (status !== null) {
    if (status === 408 || status === 429) return true;
    if (status >= 500) return true;
  }

  const message = String(error.message ?? "").toLowerCase();
  if (!message) return false;

  // 后端上游偶发返回空图（截图中对应：生成图像数据为空，无法上传。）
  const transientPatterns = [
    "生成图像数据为空",
    "no image data",
    "returned no image",
    "empty image",
  ];
  return transientPatterns.some((pattern) =>
    message.includes(pattern.toLowerCase())
  );
};

const resolveDefaultModel = (
  requestModel: string | undefined,
  provider: SupportedAIProvider | undefined
): string => {
  if (requestModel) return requestModel;
  if (provider === "banana-2.5") return BANANA_25_IMAGE_MODEL;
  if (provider === "banana-3.1" || provider === "nano2") {
    return BANANA_31_IMAGE_MODEL;
  }
  if (provider === "runninghub") return RUNNINGHUB_IMAGE_MODEL;
  if (provider === "midjourney") return MIDJOURNEY_IMAGE_MODEL;
  if (provider === "seedream5") return SEEDREAM5_IMAGE_MODEL;
  return DEFAULT_IMAGE_MODEL;
};

type BackendImagePayload = {
  imageData?: string;
  imageUrl?: string;
  textResponse?: string;
  metadata?: Record<string, any>;
};

const mapBackendImageResult = ({
  data,
  prompt,
  model,
  outputFormat,
}: {
  data: BackendImagePayload;
  prompt: string;
  model: string;
  outputFormat?: string;
}): AIImageResult => {
  const metadata: Record<string, any> = {
    ...(data.metadata ?? {}),
  };

  const resolvedImageUrl =
    typeof data.imageUrl === "string" && data.imageUrl.trim().length > 0
      ? data.imageUrl.trim()
      : typeof metadata.imageUrl === "string" && metadata.imageUrl.trim().length > 0
      ? String(metadata.imageUrl).trim()
      : undefined;

  if (resolvedImageUrl) {
    metadata.imageUrl = resolvedImageUrl;
  }

  // 确保 imageData 带 data URI 前缀，避免裸 base64 无法直接展示
  const normalizedImageData =
    typeof data.imageData === "string" && data.imageData.trim().length > 0
      ? data.imageData.startsWith("data:")
        ? data.imageData
        : `data:image/${
            metadata.outputFormat || outputFormat || "png"
          };base64,${data.imageData}`
      : undefined;

  if (!metadata.outputFormat) {
    metadata.outputFormat = outputFormat || "png";
  }

  const hasImage = Boolean(resolvedImageUrl || normalizedImageData);

  return {
    id: generateUUID(),
    imageData: resolvedImageUrl ? undefined : normalizedImageData,
    imageUrl: resolvedImageUrl,
    textResponse: data.textResponse,
    prompt,
    model,
    createdAt: new Date(),
    hasImage,
    metadata,
  };
};

async function performGenerateImageRequest(
  request: AIImageGenerateRequest,
  idempotencyKey: string
): Promise<AIServiceResponse<AIImageResult>> {
  const { request: requestWithRoute, bananaImageRoute } =
    attachBananaRouteToProviderOptions(request);
  // 🔍 调试日志：前端发送的完整请求参数
  console.log("🚀 [Frontend → Backend] generate-image 请求参数:", {
    aiProvider: requestWithRoute.aiProvider,
    model: requestWithRoute.model,
    imageSize: requestWithRoute.imageSize,
    aspectRatio: requestWithRoute.aspectRatio,
    thinkingLevel: requestWithRoute.thinkingLevel,
    imageOnly: requestWithRoute.imageOnly,
    enableWebSearch: requestWithRoute.enableWebSearch,
    googleSearch: requestWithRoute.googleSearch,
    googleImageSearch: requestWithRoute.googleImageSearch,
    bananaImageRoute:
      bananaImageRoute ||
      requestWithRoute.providerOptions?.banana?.imageRoute ||
      requestWithRoute.providerOptions?.bananaImageRoute,
    prompt: requestWithRoute.prompt?.substring(0, 50) + "...",
  });
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(bananaImageRoute
          ? { "X-Banana-Image-Route": bananaImageRoute }
          : {}),
      },
      body: JSON.stringify(requestWithRoute),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeImageGenerationErrorMessage(
            errorData?.message,
            response.status
          ),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    const resolvedModel = resolveDefaultModel(
      requestWithRoute.model,
      requestWithRoute.aiProvider
    );

    logAIImageResponse(
      {
        endpoint: "generate-image",
        provider: requestWithRoute.aiProvider,
        model: resolvedModel,
        prompt: requestWithRoute.prompt,
      },
      {
        imageData: data.imageData,
        imageUrl: data.imageUrl,
        textResponse: data.textResponse,
      }
    );

    const mapped = mapBackendImageResult({
      data,
      prompt: requestWithRoute.prompt,
      model: resolvedModel,
      outputFormat: requestWithRoute.outputFormat || "png",
    });
    if (!mapped.hasImage || (!mapped.imageData && !mapped.imageUrl)) {
      return {
        success: false,
        error: {
          code: "NO_IMAGE_PAYLOAD",
          message:
            typeof data?.textResponse === "string" && data.textResponse.trim().length > 0
              ? `generate-image returned no image payload: ${data.textResponse.trim()}`
              : "generate-image succeeded but returned no image payload",
          details: {
            endpoint: "generate-image",
          },
          timestamp: new Date(),
        },
      };
    }

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message:
          error instanceof Error && error.message
            ? `网络异常：${error.message}`
            : "网络异常，请检查后端服务是否可用",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 生成图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function generateImageViaAPI(
  request: AIImageGenerateRequest
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const idempotencyKey = buildIdempotencyKey("generate-image");
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResponse = await performGenerateImageRequest(request, idempotencyKey);

    if (!lastResponse.success || !lastResponse.data) {
      if (
        attempt < MAX_IMAGE_GENERATION_ATTEMPTS &&
        isRetryableImageGenerationError(lastResponse.error)
      ) {
        console.warn("⚠️ generate-image request failed, auto retrying", {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: resolveDefaultModel(request.model, request.aiProvider),
          errorCode: lastResponse.error?.code,
          errorMessage: lastResponse.error?.message,
        });
        await sleep(NO_IMAGE_RETRY_DELAY_MS * attempt);
        continue;
      }

      logApiTiming("generate-image", startedAt, {
        success: false,
        attempts,
        provider: request.aiProvider,
        model: resolveDefaultModel(request.model, request.aiProvider),
        status: lastResponse.error?.code,
      });
      return lastResponse;
    }

    if (
      lastResponse.data.hasImage &&
      (lastResponse.data.imageUrl || lastResponse.data.imageData)
    ) {
      logApiTiming("generate-image", startedAt, {
        success: true,
        attempts,
        provider: request.aiProvider,
        model: lastResponse.data.model,
      });
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn(
        "⚠️ Flow generate success but no image returned, auto retrying",
        {
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: request.model,
          textResponse: lastResponse.data.textResponse,
        }
      );
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  logApiTiming("generate-image", startedAt, {
    success: lastResponse?.success ?? false,
    attempts,
    provider: request.aiProvider,
    model:
      lastResponse?.data?.model ||
      resolveDefaultModel(request.model, request.aiProvider),
  });
  return (
    lastResponse ?? {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "图像生成失败（未收到有效响应）",
        timestamp: new Date(),
      },
    }
  );
}

/**
 * 编辑图像 - 通过后端 API
 * 注意：优先使用 sourceImageUrl；若无则使用 sourceImage（base64）
 */
async function performEditImageRequest(
  request: AIImageEditRequest,
  idempotencyKey: string
): Promise<AIServiceResponse<AIImageResult>> {
  const { request: requestWithRoute, bananaImageRoute } =
    attachBananaRouteToProviderOptions(request);
  // 🔍 调试日志：前端发送的完整请求参数
  console.log("🚀 [Frontend → Backend] edit-image 请求参数:", {
    aiProvider: requestWithRoute.aiProvider,
    model: requestWithRoute.model,
    imageSize: requestWithRoute.imageSize,
    aspectRatio: requestWithRoute.aspectRatio,
    thinkingLevel: requestWithRoute.thinkingLevel,
    imageOnly: requestWithRoute.imageOnly,
    bananaImageRoute:
      bananaImageRoute ||
      requestWithRoute.providerOptions?.banana?.imageRoute ||
      requestWithRoute.providerOptions?.bananaImageRoute,
    prompt: requestWithRoute.prompt?.substring(0, 50) + "...",
    sourceImage: requestWithRoute.sourceImageUrl ? requestWithRoute.sourceImageUrl.substring(0, 80) + '...' : (requestWithRoute.sourceImage?.substring(0, 80) + '...' || 'N/A'),
  });
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/edit-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(bananaImageRoute
          ? { "X-Banana-Image-Route": bananaImageRoute }
          : {}),
      },
      body: JSON.stringify(requestWithRoute),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeImageGenerationErrorMessage(
            errorData?.message,
            response.status
          ),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    const resolvedModel = resolveDefaultModel(
      requestWithRoute.model,
      requestWithRoute.aiProvider
    );

    logAIImageResponse(
      {
        endpoint: "edit-image",
        provider: requestWithRoute.aiProvider,
        model: resolvedModel,
        prompt: requestWithRoute.prompt,
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse,
      }
    );

    const mapped = mapBackendImageResult({
      data,
      prompt: requestWithRoute.prompt,
      model: resolvedModel,
      outputFormat: requestWithRoute.outputFormat || "png",
    });
    if (!mapped.hasImage || (!mapped.imageData && !mapped.imageUrl)) {
      return {
        success: false,
        error: {
          code: "NO_IMAGE_PAYLOAD",
          message:
            typeof data?.textResponse === "string" && data.textResponse.trim().length > 0
              ? `edit-image returned no image payload: ${data.textResponse.trim()}`
              : "edit-image succeeded but returned no image payload",
          details: {
            endpoint: "edit-image",
          },
          timestamp: new Date(),
        },
      };
    }

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message:
          error instanceof Error && error.message
            ? `网络异常：${error.message}`
            : "网络异常，请检查后端服务是否可用",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 编辑图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function editImageViaAPI(
  request: AIImageEditRequest
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const idempotencyKey = buildIdempotencyKey("edit-image");
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResponse = await performEditImageRequest(request, idempotencyKey);

    if (!lastResponse.success || !lastResponse.data) {
      const isNetworkFailure = lastResponse.error?.code === "NETWORK_ERROR";
      if (
        attempt < MAX_IMAGE_GENERATION_ATTEMPTS &&
        !isNetworkFailure &&
        isRetryableImageGenerationError(lastResponse.error)
      ) {
        console.warn("⚠️ edit-image request failed, auto retrying", {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: resolveDefaultModel(request.model, request.aiProvider),
          errorCode: lastResponse.error?.code,
          errorMessage: lastResponse.error?.message,
        });
        await sleep(NO_IMAGE_RETRY_DELAY_MS * attempt);
        continue;
      }

      logApiTiming("edit-image", startedAt, {
        success: false,
        attempts,
        provider: request.aiProvider,
        model: resolveDefaultModel(request.model, request.aiProvider),
        status: lastResponse.error?.code,
      });
      return lastResponse;
    }

    if (
      lastResponse.data.hasImage &&
      (lastResponse.data.imageData || lastResponse.data.imageUrl)
    ) {
      logApiTiming("edit-image", startedAt, {
        success: true,
        attempts,
        provider: request.aiProvider,
        model: lastResponse.data.model,
      });
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn(
        "⚠️ Edit image success but no image returned, auto retrying",
        {
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: request.model,
          textResponse: lastResponse.data.textResponse,
        }
      );
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  logApiTiming("edit-image", startedAt, {
    success: lastResponse?.success ?? false,
    attempts,
    provider: request.aiProvider,
    model:
      lastResponse?.data?.model ||
      resolveDefaultModel(request.model, request.aiProvider),
  });
  return (
    lastResponse ?? {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Image edit failed without a response",
        timestamp: new Date(),
      },
    }
  );
}

async function performBlendImagesRequest(
  request: AIImageBlendRequest,
  idempotencyKey: string
): Promise<AIServiceResponse<AIImageResult>> {
  const { request: requestWithRoute, bananaImageRoute } =
    attachBananaRouteToProviderOptions(request);
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/blend-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(bananaImageRoute
          ? { "X-Banana-Image-Route": bananaImageRoute }
          : {}),
      },
      body: JSON.stringify(requestWithRoute),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeImageGenerationErrorMessage(
            errorData?.message,
            response.status
          ),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    const resolvedModel = resolveDefaultModel(
      requestWithRoute.model,
      requestWithRoute.aiProvider
    );

    logAIImageResponse(
      {
        endpoint: "blend-images",
        provider: requestWithRoute.aiProvider,
        model: resolvedModel,
        prompt: requestWithRoute.prompt,
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse,
      }
    );

    const mapped = mapBackendImageResult({
      data,
      prompt: requestWithRoute.prompt,
      model: resolvedModel,
      outputFormat: requestWithRoute.outputFormat || "png",
    });
    if (!mapped.hasImage || (!mapped.imageData && !mapped.imageUrl)) {
      return {
        success: false,
        error: {
          code: "NO_IMAGE_PAYLOAD",
          message:
            typeof data?.textResponse === "string" && data.textResponse.trim().length > 0
              ? `blend-images returned no image payload: ${data.textResponse.trim()}`
              : "blend-images succeeded but returned no image payload",
          details: {
            endpoint: "blend-images",
          },
          timestamp: new Date(),
        },
      };
    }

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message:
          error instanceof Error && error.message
            ? `网络异常：${error.message}`
            : "网络异常，请检查后端服务是否可用",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 融合图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function blendImagesViaAPI(
  request: AIImageBlendRequest
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const idempotencyKey = buildIdempotencyKey("blend-images");
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResponse = await performBlendImagesRequest(request, idempotencyKey);

    if (!lastResponse.success || !lastResponse.data) {
      if (
        attempt < MAX_IMAGE_GENERATION_ATTEMPTS &&
        isRetryableImageGenerationError(lastResponse.error)
      ) {
        console.warn("⚠️ blend-images request failed, auto retrying", {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: resolveDefaultModel(request.model, request.aiProvider),
          errorCode: lastResponse.error?.code,
          errorMessage: lastResponse.error?.message,
        });
        await sleep(NO_IMAGE_RETRY_DELAY_MS * attempt);
        continue;
      }

      logApiTiming("blend-images", startedAt, {
        success: false,
        attempts,
        provider: request.aiProvider,
        model: resolveDefaultModel(request.model, request.aiProvider),
        status: lastResponse.error?.code,
      });
      return lastResponse;
    }

    if (
      lastResponse.data.hasImage &&
      (lastResponse.data.imageData || lastResponse.data.imageUrl)
    ) {
      logApiTiming("blend-images", startedAt, {
        success: true,
        attempts,
        provider: request.aiProvider,
        model: lastResponse.data.model,
      });
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn(
        "⚠️ Blend images success but no image returned, auto retrying",
        {
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: request.model,
          textResponse: lastResponse.data.textResponse,
        }
      );
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  logApiTiming("blend-images", startedAt, {
    success: lastResponse?.success ?? false,
    attempts,
    provider: request.aiProvider,
    model:
      lastResponse?.data?.model ||
      resolveDefaultModel(request.model, request.aiProvider),
  });
  return (
    lastResponse ?? {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Image blend failed without a response",
        timestamp: new Date(),
      },
    }
  );
}

type MidjourneyActionParams = MidjourneyActionRequest & {
  displayPrompt?: string;
  actionLabel?: string;
};

export async function midjourneyActionViaAPI(
  params: MidjourneyActionParams
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const { displayPrompt, actionLabel, ...payload } = params;

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/midjourney/action`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("midjourney-action", startedAt, {
        success: false,
        status: response.status,
        action: actionLabel,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeAIErrorMessage(errorData?.message, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    const mapped = mapBackendImageResult({
      data,
      prompt: displayPrompt || actionLabel || "Midjourney 操作",
      model: MIDJOURNEY_IMAGE_MODEL,
    });

    mapped.metadata = {
      ...(mapped.metadata ?? {}),
      actionLabel,
    };

    logApiTiming("midjourney-action", startedAt, {
      success: true,
      action: actionLabel,
    });

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    logApiTiming("midjourney-action", startedAt, {
      success: false,
      action: actionLabel,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

type MidjourneyModalParams = MidjourneyModalRequest & {
  displayPrompt?: string;
};

export async function midjourneyModalViaAPI(
  params: MidjourneyModalParams
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const { displayPrompt, ...payload } = params;

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/midjourney/modal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("midjourney-modal", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeAIErrorMessage(errorData?.message, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    const mapped = mapBackendImageResult({
      data,
      prompt: displayPrompt || "Midjourney 调整",
      model: MIDJOURNEY_IMAGE_MODEL,
    });

    logApiTiming("midjourney-modal", startedAt, {
      success: true,
    });

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    logApiTiming("midjourney-modal", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 分析图像 - 通过后端 API
 */
export async function analyzeImageViaAPI(
  request: AIImageAnalyzeRequest
): Promise<AIServiceResponse<AIImageAnalysisResult>> {
  const startedAt = getTimestamp();
  const { request: requestWithRoute, bananaImageRoute } =
    attachBananaRouteToProviderOptions(request);
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/analyze-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bananaImageRoute
          ? { "X-Banana-Image-Route": bananaImageRoute }
          : {}),
      },
      body: JSON.stringify(requestWithRoute),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("analyze-image", startedAt, {
        success: false,
        status: response.status,
        provider: requestWithRoute.aiProvider,
        model: requestWithRoute.model,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeAIErrorMessage(errorData?.message, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    logApiTiming("analyze-image", startedAt, {
      success: true,
      provider: requestWithRoute.aiProvider,
      model: requestWithRoute.model,
      textLength: typeof data?.text === "string" ? data.text.length : undefined,
    });

    return {
      success: true,
      data: {
        analysis: data.text,
        confidence: 0.95,
        tags: [],
      },
    };
  } catch (error) {
    logApiTiming("analyze-image", startedAt, {
      success: false,
      provider: requestWithRoute.aiProvider,
      model: requestWithRoute.model,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 文本对话 - 通过后端 API
 */
export async function generateTextResponseViaAPI(
  request: AITextChatRequest
): Promise<AIServiceResponse<AITextChatResult>> {
  const startedAt = getTimestamp();
  const { request: requestWithRoute, bananaImageRoute } =
    attachBananaRouteToProviderOptions(request);
  const controller = new AbortController();
  const timeoutId =
    typeof window !== "undefined"
      ? window.setTimeout(() => controller.abort(), TEXT_CHAT_TIMEOUT_MS)
      : setTimeout(() => controller.abort(), TEXT_CHAT_TIMEOUT_MS);
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/text-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bananaImageRoute
          ? { "X-Banana-Image-Route": bananaImageRoute }
          : {}),
      },
      body: JSON.stringify(requestWithRoute),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("text-chat", startedAt, {
        success: false,
        status: response.status,
        provider: requestWithRoute.aiProvider,
        model: requestWithRoute.model,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    logApiTiming("text-chat", startedAt, {
      success: true,
      provider: requestWithRoute.aiProvider,
      model: requestWithRoute.model || "gemini-3-flash-preview",
      textLength: typeof data?.text === "string" ? data.text.length : undefined,
    });

    return {
      success: true,
      data: {
        text: data.text,
        model: requestWithRoute.model || "gemini-3-flash-preview",
        webSearchResult: data.webSearchResult || undefined,
      },
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    logApiTiming("text-chat", startedAt, {
      success: false,
      provider: requestWithRoute.aiProvider,
      model: requestWithRoute.model,
      error: isTimeout
        ? `Request timeout (${TEXT_CHAT_TIMEOUT_MS}ms)`
        : error instanceof Error
        ? error.message
        : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: isTimeout ? "TIMEOUT_ERROR" : "NETWORK_ERROR",
        message: isTimeout
          ? `文本请求超时（${Math.floor(TEXT_CHAT_TIMEOUT_MS / 1000)}秒）`
          : error instanceof Error
          ? error.message
          : "Network error",
        timestamp: new Date(),
      },
    };
  } finally {
    if (typeof window !== "undefined") {
      window.clearTimeout(timeoutId as number);
    } else {
      clearTimeout(timeoutId as ReturnType<typeof setTimeout>);
    }
  }
}

export interface VideoGenerationRequest {
  prompt: string;
  referenceImageUrls?: string[];
  quality?: "hd" | "sd";
  model?: "sora-2" | "sora-2-pro";
  /** 画面比例，仅极速 Sora2 使用。例如 '16:9' | '9:16' */
  aspectRatio?: "16:9" | "9:16";
  /** 时长（秒，仅极速 Sora2 使用）。字符串形式以兼容后端 DTO。 */
  duration?: "10" | "15" | "25";
  watermark?: boolean;
  thumbnail?: boolean;
  privateMode?: boolean;
  style?: string;
  storyboard?: boolean;
  characterUrl?: string;
  characterTimestamps?: string;
  characterTaskId?: string;
}

export interface VideoGenerationResult {
  videoUrl: string;
  content: string;
  referencedUrls: string[];
  thumbnailUrl?: string;
  status?: string;
  taskId?: string;
  taskInfo?: Record<string, any> | null;
  /** 备选方案提示信息 */
  fallbackMessage?: string;
}

const normalizeSora2ErrorMessage = (rawMessage?: string, status?: number): string => {
  const normalized = typeof rawMessage === "string" ? rawMessage.trim() : "";
  const lower = normalized.toLowerCase();

  if (
    lower.includes("content polic") ||
    lower.includes("moderation") ||
    lower.includes("safety") ||
    lower.includes("violate") ||
    normalized.includes("内容政策") ||
    normalized.includes("内容安全") ||
    normalized.includes("违规") ||
    normalized.includes("违反")
  ) {
    return "上传内容可能触发平台内容安全策略，请更换视频或素材后重试。";
  }

  if (
    lower.includes("must have audio") ||
    lower.includes("must contain audio") ||
    lower.includes("audio track") ||
    lower.includes("no audio") ||
    lower.includes("without audio") ||
    lower.includes("silent")
  ) {
    return "上传的视频必须包含音频轨道，请更换带声音的视频后重试。";
  }

  if (
    lower.includes("unsupported") &&
    (lower.includes("format") || lower.includes("codec"))
  ) {
    return "视频格式不受支持，请改用 MP4 或 MOV 格式后重试。";
  }

  if (
    lower.includes("resolution") ||
    lower.includes("dimension") ||
    lower.includes("pixel")
  ) {
    return "视频分辨率不符合供应商要求，请调整尺寸后重试。";
  }

  if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("api key")) {
    return "供应商鉴权失败，请联系管理员检查 Sora2 Key 配置。";
  }

  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "供应商请求过于频繁，请稍后重试。";
  }

  if (
    lower.includes("积分不足") ||
    lower.includes("insufficient credit") ||
    lower.includes("not enough credit") ||
    normalized.includes("积分不足")
  ) {
    return normalized || "积分不足，请先充值后重试。";
  }

  if (
    lower.includes("in_progress") ||
    lower.includes("submitted") ||
    normalized.includes("处理中")
  ) {
    return normalized || "任务仍在处理中，请稍后重试查询。";
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    if (normalized) {
      const genericServerMessage =
        lower === "internal server error" ||
        lower === "service unavailable" ||
        lower === "bad gateway" ||
        lower === "gateway timeout" ||
        /^http\s*\d+$/.test(lower);
      if (!genericServerMessage) {
        return normalized;
      }
    }
    return "Sora2 供应商服务暂时不可用，请稍后重试。";
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Sora2 供应商处理超时，请稍后重试。";
  }

  return normalized || (status ? `HTTP ${status}` : "请求失败");
};

const readBackendErrorMessage = (errorData: any): string => {
  const message = errorData?.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join("；");
  }
  if (typeof errorData?.error === "string") return errorData.error;
  if (typeof errorData?.detail === "string") return errorData.detail;
  return "";
};

export async function generateVideoViaAPI(
  request: VideoGenerationRequest
): Promise<AIServiceResponse<VideoGenerationResult>> {
  const startedAt = getTimestamp();
  const idempotencyKey = buildIdempotencyKey("generate-video");
  try {
    const referenceImageUrls = (request.referenceImageUrls || []).filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0
    );
    const payload: VideoGenerationRequest = {
      ...request,
      referenceImageUrls: referenceImageUrls.length
        ? referenceImageUrls
        : undefined,
    };

    const response = await fetchWithAuth(`${API_BASE_URL}/ai/generate-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const rawMessage = readBackendErrorMessage(errorData);
      logApiTiming("generate-video", startedAt, {
        success: false,
        status: response.status,
        quality: request.quality,
        references: referenceImageUrls.length,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeSora2ErrorMessage(rawMessage, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-video", startedAt, {
      success: true,
      quality: request.quality,
      references: referenceImageUrls.length,
      hasThumbnail: Boolean((data as any)?.thumbnailUrl),
    });
    return {
      success: true,
      data,
    };
  } catch (error) {
    logApiTiming("generate-video", startedAt, {
      success: false,
      quality: request.quality,
      references: Array.isArray(request.referenceImageUrls)
        ? request.referenceImageUrls.length
        : 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 异步视频生成接口
 * 立即返回 taskId，前端通过轮询查询进度
 */
export async function generateVideoAsyncAPI(
  request: VideoGenerationRequest
): Promise<AIServiceResponse<{ taskId: string; status: string; message: string }>> {
  const startedAt = getTimestamp();
  const idempotencyKey = buildIdempotencyKey("generate-video-async");
  try {
    const referenceImageUrls = (request.referenceImageUrls || []).filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0
    );
    const payload: VideoGenerationRequest = {
      ...request,
      referenceImageUrls: referenceImageUrls.length
        ? referenceImageUrls
        : undefined,
    };

    const response = await fetchWithAuth(`${API_BASE_URL}/ai/generate-video-async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const rawMessage = readBackendErrorMessage(errorData);
      logApiTiming("generate-video-async", startedAt, {
        success: false,
        status: response.status,
        quality: request.quality,
        references: referenceImageUrls.length,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeSora2ErrorMessage(rawMessage, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-video-async", startedAt, {
      success: true,
      quality: request.quality,
      references: referenceImageUrls.length,
    });
    return {
      success: true,
      data: {
        taskId: data.taskId,
        status: data.status,
        message: data.message,
      },
    };
  } catch (error) {
    logApiTiming("generate-video-async", startedAt, {
      success: false,
      quality: request.quality,
      references: Array.isArray(request.referenceImageUrls)
        ? request.referenceImageUrls.length
        : 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

export interface Sora2CharacterCreateRequest {
  model?: "sora-2" | "sora-2-pro";
  timestamps: string;
  url?: string;
  fromTask?: string;
}

export interface Sora2CharacterCreateResult {
  success: boolean;
  taskId: string;
  status?: string;
  raw?: Record<string, any>;
}

export interface Sora2CharacterTaskResult {
  id: string;
  status: string;
  progress?: number;
  characters?: Array<{
    id?: string;
    displayName?: string;
    username?: string;
    profilePictureUrl?: string;
  }>;
  raw?: Record<string, any>;
}

export interface Sora2VideoTaskResult {
  id: string;
  status: string;
  progress?: number;
  videoUrl?: string;
  video_url?: string;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  content?: string;
  referencedUrls?: string[];
  taskInfo?: Record<string, any>;
  raw?: Record<string, any>;
}

export async function createSora2CharacterViaAPI(
  request: Sora2CharacterCreateRequest
): Promise<AIServiceResponse<Sora2CharacterCreateResult>> {
  try {
    // 角色创建接口只允许这 4 个字段，防止历史数据中的 prompt/image 混入请求
    const payload: Sora2CharacterCreateRequest = {
      model: request.model,
      timestamps: request.timestamps,
      url: request.url,
      fromTask: request.fromTask,
    };
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/sora2/character/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const rawMessage =
        readBackendErrorMessage(errorData) ||
        (await response.clone().text().catch(() => "")) ||
        `HTTP ${response.status}`;
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeSora2ErrorMessage(rawMessage, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = (await response.json()) as Sora2CharacterCreateResult;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message:
          error instanceof Error && error.message
            ? `网络异常：${error.message}`
            : "网络异常，请检查后端服务是否可用",
        timestamp: new Date(),
      },
    };
  }
}

export async function querySora2CharacterTaskViaAPI(
  taskId: string
): Promise<AIServiceResponse<Sora2CharacterTaskResult>> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/sora2/character/${encodeURIComponent(taskId)}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const rawMessage =
        readBackendErrorMessage(errorData) ||
        (await response.clone().text().catch(() => "")) ||
        `HTTP ${response.status}`;
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeSora2ErrorMessage(rawMessage, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = (await response.json()) as Sora2CharacterTaskResult;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

export async function querySora2VideoTaskViaAPI(
  taskId: string
): Promise<AIServiceResponse<Sora2VideoTaskResult>> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/sora2/video/${encodeURIComponent(taskId)}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const rawMessage =
        readBackendErrorMessage(errorData) ||
        (await response.clone().text().catch(() => "")) ||
        `HTTP ${response.status}`;
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: normalizeSora2ErrorMessage(rawMessage, response.status),
          timestamp: new Date(),
        },
      };
    }

    const data = (await response.json()) as Sora2VideoTaskResult;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6-t2v 文生视频接口
 */
export async function generateWan26T2VViaAPI(request: {
  prompt: string;
  audioUrl?: string;
  parameters?: {
    size?: string;
    duration?: 5 | 10;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.6-t2v",
    input: {
      prompt: request.prompt,
      ...(request.audioUrl && { audio_url: request.audioUrl }),
    },
    parameters: request.parameters || {},
  };

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan26-t2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-6-t2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-6-t2v", startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-6-t2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6-i2v 图生视频接口
 */
export async function generateWan26I2VViaAPI(request: {
  prompt: string;
  imgUrl: string;
  audioUrl?: string;
  parameters?: {
    resolution?: "720P" | "1080P";
    duration?: 5 | 10 | 15;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.6-i2v",
    input: {
      img_url: request.imgUrl,
      prompt: request.prompt,
      ...(request.audioUrl && { audio_url: request.audioUrl }),
    },
    parameters: request.parameters || {},
  };

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan2-6-i2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-6-i2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-6-i2v", startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-6-i2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6 统一接口
 * 前端根据是否有 imgUrl 自动判断调用 T2V 还是 I2V
 */
export async function generateWan26ViaAPI(request: {
  prompt: string;
  imgUrl?: string;
  audioUrl?: string;
  parameters?: {
    size?: string;
    resolution?: string;
    duration?: number;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const sizeMapping: Record<string, string> = {
    "16:9": "1280*720",
    "9:16": "720*1280",
    "1:1": "960*960",
    "4:3": "1088*832",
    "3:4": "832*1088",
  };

  if (request.imgUrl) {
    return generateWan26I2VViaAPI({
      prompt: request.prompt,
      imgUrl: request.imgUrl,
      audioUrl: request.audioUrl,
      parameters: {
        resolution: request.parameters?.resolution as
          | "720P"
          | "1080P"
          | undefined,
        duration: request.parameters?.duration as 5 | 10 | 15 | undefined,
        shot_type: request.parameters?.shot_type,
      },
    });
  } else {
    const mappedSize = request.parameters?.size
      ? sizeMapping[request.parameters.size] || request.parameters.size
      : undefined;

    return generateWan26T2VViaAPI({
      prompt: request.prompt,
      audioUrl: request.audioUrl,
      parameters: {
        size: mappedSize,
        duration: request.parameters?.duration as 5 | 10 | undefined,
        shot_type: request.parameters?.shot_type,
      },
    });
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6-r2v 参考视频生成视频接口
 */
export async function generateWan26R2VViaAPI(request: {
  prompt: string;
  referenceVideoUrls: string[];
  parameters?: {
    size?: string;
    duration?: 5 | 10;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.6-r2v",
    input: {
      prompt: request.prompt,
      reference_video_urls: request.referenceVideoUrls,
    },
    parameters: request.parameters || {},
  };
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan2-6-r2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-6-r2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-6-r2v", startedAt, { success: true });
    // 直接返回后端响应，不再二次包装
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-6-r2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

export type HappyhorseModel =
  | "happyhorse-1.0-t2v"
  | "happyhorse-1.0-i2v"
  | "happyhorse-1.0-r2v"
  | "happyhorse-1.0-video-edit";

export type HappyhorseMediaItem =
  | { type: "first_frame"; url: string }
  | { type: "reference_image"; url: string }
  | { type: "video"; url: string };

/**
 * 调用后端代理的 DashScope HappyHorse 视频生成接口（支持 t2v / i2v / r2v / video-edit）。
 * 由 body.model 决定上游模型；media 数组按所选模型自行组装：
 *   - t2v:        无 media
 *   - i2v:        media = [{type:"first_frame", url}]
 *   - r2v:        media = [{type:"reference_image", url}, ...]
 *   - video-edit: media = [{type:"video", url}, {type:"reference_image", url}]
 */
export async function generateHappyhorseVideoViaAPI(request: {
  model: HappyhorseModel;
  prompt: string;
  media?: HappyhorseMediaItem[];
  parameters?: {
    resolution?: "720P" | "1080P";
    ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
    duration?: number; // 3 ~ 15
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest: Record<string, any> = {
    model: request.model,
    input: {
      prompt: request.prompt,
      ...(request.media && request.media.length > 0
        ? { media: request.media }
        : {}),
    },
    parameters: request.parameters || {},
  };
  const timingLabel = "generate-happyhorse-video";
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-happyhorse-video`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming(timingLabel, startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming(timingLabel, startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming(timingLabel, startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.7-i2v 接口
 */
export async function generateWan27I2VViaAPI(request: {
  prompt?: string;
  media: Array<{
    type: "first_frame" | "last_frame" | "first_clip" | "driving_audio";
    url: string;
  }>;
  parameters?: {
    resolution?: "720P" | "1080P";
    duration?: number;
    prompt_extend?: boolean;
    watermark?: boolean;
    seed?: number;
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.7-i2v",
    input: {
      prompt: request.prompt,
      media: request.media,
    },
    parameters: request.parameters || {},
  };

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan2-7-i2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-7-i2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-7-i2v", startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-7-i2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 查询 DashScope 任务状态（用于 wan2.6 I2V 异步模式轮询）
 */
export async function queryDashscopeTask(taskId: string): Promise<{
  success: boolean;
  status?: string;
  videoUrl?: string;
  error?: { message: string };
}> {
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/task/${encodeURIComponent(taskId)}`,
      { method: "GET" }
    );

    if (!response.ok) {
      return { success: false, error: { message: `HTTP ${response.status}` } };
    }

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      status: result.data?.status,
      videoUrl: result.data?.videoUrl || result.data?.video_url,
    };
  } catch (error) {
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : "Network error" },
    };
  }
}
