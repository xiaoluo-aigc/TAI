/**
 * 扩图服务
 * 调用后端API进行图片扩图
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

export interface ExpandImageRequest {
  imageUrl: string; // OSS原生可访问的图片URL
  expandRatios: {
    left: number; // 左侧扩图部分/原图长度
    top: number; // 上侧扩图部分/原图高度
    right: number; // 右侧扩图部分/原图长度
    bottom: number; // 下侧扩图部分/原图高度
  };
  prompt?: string; // 提示词，默认为"扩图"
  aiProvider?: string;
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  thinkingLevel?: string;
  bananaImageRoute?: string;
  providerOptions?: Record<string, any>;
}

export interface ExpandImageResponse {
  success: boolean;
  imageUrl: string; // 扩图后的图片访问URL
  promptId?: string;
  error?: string;
}

/**
 * 扩图
 */
export async function expandImage(
  request: ExpandImageRequest
): Promise<ExpandImageResponse> {
  try {
    const response = await fetchWithAuth(buildUrl("/api/ai/expand-image"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let errorMessage = errorData?.message || `HTTP ${response.status}`;
      const lower = String(errorMessage).toLowerCase();
      if (
        response.status === 524 ||
        response.status === 504 ||
        lower.includes('timeout') ||
        lower.includes('timed out') ||
        lower.includes('gateway timeout')
      ) {
        errorMessage = '扩图处理超时（ComfyUI 需要较长时间），请简化参数或稍后重试。';
      } else if (response.status >= 500) {
        errorMessage = '扩图服务暂时不可用，请稍后重试。';
      }
      logger.error("Expand image failed", {
        status: response.status,
        error: errorMessage,
      });

      return {
        success: false,
        imageUrl: "",
        error: errorMessage,
      };
    }

    const data = await response.json();

    return {
      success: true,
      imageUrl: data.imageUrl,
      promptId: data.promptId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error("Expand image error", error);

    return {
      success: false,
      imageUrl: "",
      error: message,
    };
  }
}
