import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type BioAuthStatus = "processing" | "active" | "failed";

export interface StartBioAuthResult {
  taskId: string;
  h5Link: string;
}

export interface BioAuthStatusResult {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;
  groupId?: string;
}

export interface BioAuthGroupItem {
  groupId: string;
  imageUrl: string;
  createdAt: string;
}

export interface ListGroupsResult {
  groups: BioAuthGroupItem[];
}

export interface CreateAssetInGroupResult {
  taskId: string;
}

const BIO_AUTH_REQUEST_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), BIO_AUTH_REQUEST_TIMEOUT_MS);
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

export async function startBioAuth(imageUrl: string): Promise<StartBioAuthResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await withTimeout(
    (signal) =>
      fetchWithAuth(`${apiBaseUrl}/api/bio-auth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
        signal,
      }),
    "启动认证超时，请确认图片链接可访问后重试"
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function getBioAuthStatus(taskId: string): Promise<BioAuthStatusResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await withTimeout(
    (signal) =>
      fetchWithAuth(
        `${apiBaseUrl}/api/bio-auth/${encodeURIComponent(taskId)}/status`,
        { signal }
      ),
    "认证状态查询超时，请重试"
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function listBioAuthGroups(): Promise<ListGroupsResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await withTimeout(
    (signal) => fetchWithAuth(`${apiBaseUrl}/api/bio-auth/groups`, { signal }),
    "认证记录查询超时，请重试"
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function createAssetInGroup(
  groupId: string,
  imageUrl: string,
): Promise<CreateAssetInGroupResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await withTimeout(
    (signal) =>
      fetchWithAuth(`${apiBaseUrl}/api/bio-auth/asset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, imageUrl }),
        signal,
      }),
    "上传认证素材超时，请确认图片链接可访问后重试"
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}
