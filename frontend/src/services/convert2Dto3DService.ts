/**
 * 2D转3D服务
 * 调用后端API将2D图片转换为3D模型
 */

import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";
// 后端基础地址，可通过 .env 的 VITE_API_BASE_URL 覆盖，默认 http://localhost:4000
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const buildUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

export interface Convert2Dto3DRequest {
  imageUrl?: string; // OSS原生可访问的图片URL
  prompt?: string;
  projectId?: string;
}

export interface Convert2Dto3DResponse {
  success: boolean;
  modelUrl: string; // 3D模型访问URL (https://img.tgtai.com/view/{filename})
  promptId?: string;
  modelKey?: string;
  error?: string;
}

export interface Convert2Dto3DTaskCreateResponse {
  success: boolean;
  taskId?: string;
  status?: "pending" | "processing";
  message?: string;
  error?: string;
}

export interface Convert2Dto3DTaskStatusResponse {
  success: boolean;
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed";
  modelUrl?: string;
  promptId?: string;
  modelKey?: string;
  error?: string;
  message?: string;
}

const extractApiErrorMessage = (errorData: unknown): string | null => {
  if (!errorData || typeof errorData !== "object") return null;
  const data = errorData as {
    message?: unknown;
    error?: unknown;
    statusCode?: unknown;
  };

  if (typeof data.message === "string" && data.message.trim().length > 0) {
    return data.message.trim();
  }
  if (
    Array.isArray(data.message) &&
    data.message.length > 0 &&
    data.message.every((item) => typeof item === "string")
  ) {
    return data.message.join("; ");
  }
  if (typeof data.error === "string" && data.error.trim().length > 0) {
    return data.error.trim();
  }
  return null;
};

const isInsufficientCreditsMessage = (message: string): boolean => {
  if (!message) return false;
  return (
    message.includes("积分不足") ||
    /insufficient\s+credits?/i.test(message) ||
    /balance.*insufficient/i.test(message)
  );
};

/**
 * 创建2D转3D任务
 */
export async function createConvert2Dto3DTask(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DTaskCreateResponse> {
  try {
    logger.info("2D to 3D create task request", {
      hasImageUrl: Boolean(request.imageUrl),
      imageUrl: request.imageUrl?.slice(0, 200),
      projectId: request.projectId,
      promptLength: request.prompt?.trim().length ?? 0,
    });
    const response = await fetchWithAuth(buildUrl("/api/ai/convert-2d-to-3d"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const rawErrorMessage =
        extractApiErrorMessage(errorData) || `HTTP ${response.status}`;
      let errorMessage = rawErrorMessage;
      const lower = String(rawErrorMessage).toLowerCase();
      if (
        response.status === 524 ||
        response.status === 504 ||
        lower.includes('timeout') ||
        lower.includes('timed out') ||
        lower.includes('gateway timeout')
      ) {
        errorMessage = '2D转3D处理超时（Hunyuan3D 需要较长时间），请稍后重试。';
      } else if (response.status >= 500) {
        errorMessage = '2D转3D服务暂时不可用，请稍后重试。';
      }
      if (isInsufficientCreditsMessage(rawErrorMessage)) {
        errorMessage = "积分不足，2D转3D 需要 200 积分，请先充值后重试";
      }
      logger.error("2D to 3D conversion failed", {
        status: response.status,
        rawError: rawErrorMessage,
        error: errorMessage,
        errorData,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }

    const data = await response.json();
    logger.info("2D to 3D create task response", {
      taskId: data?.taskId,
      status: data?.status,
      success: data?.success,
      message: data?.message,
    });

    return {
      success: Boolean(data?.success),
      taskId: typeof data?.taskId === "string" ? data.taskId : undefined,
      status:
        data?.status === "pending" || data?.status === "processing"
          ? data.status
          : undefined,
      message: typeof data?.message === "string" ? data.message : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error("2D to 3D conversion error", error);

    return {
      success: false,
      error: message,
    };
  }
}

export async function queryConvert2Dto3DTask(
  taskId: string
): Promise<Convert2Dto3DTaskStatusResponse> {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return {
      success: false,
      taskId,
      status: "failed",
      error: "taskId 不能为空",
    };
  }

  try {
    const response = await fetchWithAuth(
      buildUrl(`/api/ai/convert-2d-to-3d/task/${encodeURIComponent(normalizedTaskId)}`)
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMessage =
        extractApiErrorMessage(data) || `HTTP ${response.status}`;
      return {
        success: false,
        taskId: normalizedTaskId,
        status: "failed",
        error: errorMessage,
      };
    }

    const status =
      data?.status === "pending" ||
      data?.status === "processing" ||
      data?.status === "completed" ||
      data?.status === "failed"
        ? data.status
        : "failed";

    return {
      success: Boolean(data?.success),
      taskId: normalizedTaskId,
      status,
      modelUrl: typeof data?.modelUrl === "string" ? data.modelUrl : undefined,
      promptId: typeof data?.promptId === "string" ? data.promptId : undefined,
      modelKey: typeof data?.modelKey === "string" ? data.modelKey : undefined,
      error: typeof data?.error === "string" ? data.error : undefined,
      message: typeof data?.message === "string" ? data.message : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error("2D to 3D task query error", error);
    return {
      success: false,
      taskId: normalizedTaskId,
      status: "failed",
      error: message,
    };
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

export async function waitForConvert2Dto3DTask(
  taskId: string,
  options?: { maxWaitMs?: number; pollIntervalMs?: number }
): Promise<Convert2Dto3DResponse> {
  const maxWaitMs = options?.maxWaitMs ?? 10 * 60 * 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 5000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const result = await queryConvert2Dto3DTask(taskId);
    if (result.status === "completed" && result.modelUrl) {
      return {
        success: true,
        modelUrl: result.modelUrl,
        promptId: result.promptId,
        modelKey: result.modelKey,
      };
    }
    if (result.status === "failed") {
      return {
        success: false,
        modelUrl: "",
        error: result.error || "2D转3D失败",
      };
    }

    await sleep(pollIntervalMs);
  }

  return {
    success: false,
    modelUrl: "",
    error: "2D转3D任务超时，请稍后重试。",
  };
}

/**
 * 将2D图片转换为3D模型
 */
export async function convert2Dto3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  const createResult = await createConvert2Dto3DTask(request);
  if (!createResult.success || !createResult.taskId) {
    return {
      success: false,
      modelUrl: "",
      error: createResult.error || "2D转3D任务创建失败",
    };
  }

  return waitForConvert2Dto3DTask(createResult.taskId);
}
