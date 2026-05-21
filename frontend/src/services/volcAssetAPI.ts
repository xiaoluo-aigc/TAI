/**
 * 火山引擎素材库API客户端
 * 通过后端代理以避免 CORS 错误并保护 API Key
 */
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type VolcAssetStatus = "processing" | "active" | "failed";

export interface UploadAssetResult {
  assetId: string;
  status: VolcAssetStatus;
  errorMessage?: string;
}

export interface AssetStatusResult {
  status: VolcAssetStatus;
  errorMessage?: string;
}

const VOLC_ASSET_REQUEST_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), VOLC_ASSET_REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

/**
 * 上传素材到火山引擎素材库（通过 URL 拉取）
 */
export async function uploadVolcAsset(sourceUrl: string): Promise<UploadAssetResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await withTimeout(
    (signal) =>
      fetchWithAuth(
        `${apiBaseUrl}/api/volc-asset/upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sourceUrl, assetType: "image" }),
          signal,
        }
      ),
    "审核请求超时，请确认图片链接可访问后重试"
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * 查询火山引擎素材库素材状态
 */
export async function getVolcAssetStatus(assetId: string): Promise<AssetStatusResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await withTimeout(
    (signal) =>
      fetchWithAuth(
        `${apiBaseUrl}/api/volc-asset/${encodeURIComponent(assetId)}/status`,
        { signal }
      ),
    "审核状态查询超时，请重试"
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }

  return response.json();
}
