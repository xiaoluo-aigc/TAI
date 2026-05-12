import {
  getPublicAssetBaseUrl,
  proxifyRemoteAssetUrl,
  resolvePublicAssetUrlFromKey,
} from "@/utils/assetProxy";
import {
  FLOW_IMAGE_ASSET_PREFIX,
  getFlowImageBlob,
  parseFlowImageAssetRef,
} from "@/services/flowImageAssetStore";
import { blobToDataUrl, responseToBlob } from "@/utils/imageConcurrency";
import { fetchWithAuth } from "@/services/authFetch";

export type RemoteUrl = `http://${string}` | `https://${string}`;
export type BlobUrl = `blob:${string}`;
export type DataUrl = `data:${string}`;
export type DataImageUrl = `data:image/${string}`;

const DEFAULT_MANAGED_ASSET_HOST = "tai-ai.tos-cn-guangzhou.volces.com";
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 8_000;
const WEAK_NETWORK_IMAGE_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_IMAGE_FETCH_RETRIES = 1;
const WEAK_NETWORK_IMAGE_FETCH_RETRIES = 2;
const RETRYABLE_IMAGE_FETCH_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// 优先使用环境变量配置的 OSS/CDN 基础地址；未配置则返回 null。
const getOssBaseUrl = (): string | null => {
  const envBase = getPublicAssetBaseUrl();
  if (envBase) return envBase.endsWith("/") ? envBase : `${envBase}/`;
  return `https://${DEFAULT_MANAGED_ASSET_HOST}/`;
};

const shouldAvoidSameOriginDirectBase = (baseUrl: string): boolean => {
  if (typeof window === "undefined" || !window.location?.origin) return false;
  try {
    const parsed = new URL(baseUrl);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

type RuntimeNetworkConnection = {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
};

const isWeakNetworkRuntime = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const navWithConnection = navigator as Navigator & {
    connection?: RuntimeNetworkConnection;
    mozConnection?: RuntimeNetworkConnection;
    webkitConnection?: RuntimeNetworkConnection;
  };
  const conn =
    navWithConnection.connection ||
    navWithConnection.mozConnection ||
    navWithConnection.webkitConnection;
  if (!conn) return false;
  try {
    if (conn.saveData === true) return true;
    const effectiveType = String(conn.effectiveType || "").toLowerCase();
    if (
      effectiveType === "slow-2g" ||
      effectiveType === "2g" ||
      effectiveType === "3g"
    ) {
      return true;
    }
    const downlink = Number(conn.downlink);
    if (Number.isFinite(downlink) && downlink > 0 && downlink < 1.2) {
      return true;
    }
    const rtt = Number(conn.rtt);
    if (Number.isFinite(rtt) && rtt >= 450) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

const getImageFetchPolicy = () => {
  const weak = isWeakNetworkRuntime();
  return {
    timeoutMs: weak ? WEAK_NETWORK_IMAGE_FETCH_TIMEOUT_MS : DEFAULT_IMAGE_FETCH_TIMEOUT_MS,
    retries: weak ? WEAK_NETWORK_IMAGE_FETCH_RETRIES : DEFAULT_IMAGE_FETCH_RETRIES,
  };
};

const createTimeoutLinkedSignal = (timeoutMs: number, parentSignal?: AbortSignal) => {
  const controller = new AbortController();
  let abortedByTimeout = false;
  const timer = globalThis.setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, Math.max(1000, timeoutMs));

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const cleanup = () => {
    globalThis.clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  };

  return {
    signal: controller.signal,
    cleanup,
    isTimeoutAbort: () => abortedByTimeout,
  };
};

const fetchImageResponse = async (
  url: string,
  init?: { signal?: AbortSignal }
): Promise<Response | null> => {
  const policy = getImageFetchPolicy();
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const linked = createTimeoutLinkedSignal(policy.timeoutMs, init?.signal);
    try {
      const response = isBlobUrl(url)
        ? await fetch(url, { signal: linked.signal })
        : await fetchWithAuth(url, {
            mode: "cors",
            credentials: "omit",
            auth: "omit",
            allowRefresh: false,
            signal: linked.signal,
          });
      if (
        response.ok ||
        !RETRYABLE_IMAGE_FETCH_STATUS.has(response.status) ||
        attempt >= policy.retries
      ) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < policy.retries;
      if (!canRetry || (init?.signal?.aborted && !linked.isTimeoutAbort())) {
        throw error;
      }
    } finally {
      linked.cleanup();
    }

    await sleep(220 * (attempt + 1));
  }

  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  return null;
};

export const isRemoteUrl = (value?: string | null): value is RemoteUrl =>
  typeof value === "string" && /^https?:\/\//i.test(value.trim());

export const normalizeRemoteUrl = (value?: string | null): RemoteUrl | null => {
  if (!isRemoteUrl(value)) return null;
  return value.trim() as RemoteUrl;
};

export const areAllRemoteUrls = (
  values: Array<string | null | undefined>
): values is RemoteUrl[] => {
  if (!Array.isArray(values) || values.length === 0) return false;
  return values.every((value) => isRemoteUrl(value));
};

export const collectRemoteUrls = (
  values: Array<string | null | undefined>
): RemoteUrl[] =>
  values
    .map((value) => normalizeRemoteUrl(value))
    .filter((value): value is RemoteUrl => Boolean(value));

export const isBlobUrl = (value?: string | null): value is BlobUrl =>
  typeof value === "string" && /^blob:/i.test(value.trim());

export const isDataImageUrl = (value?: string | null): value is DataImageUrl =>
  typeof value === "string" && /^data:image\//i.test(value.trim());

export const isDataUrl = (value?: string | null): value is DataUrl =>
  typeof value === "string" && /^data:/i.test(value.trim());

export const isAssetProxyRef = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("/api/assets/proxy") ||
    trimmed.startsWith("/assets/proxy")
  ) {
    return true;
  }
  if (!isRemoteUrl(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.pathname === "/api/assets/proxy" || url.pathname === "/assets/proxy";
  } catch {
    return false;
  }
};

export const isAssetKeyRef = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const withoutLeading = trimmed.replace(/^\/+/, "");
  return /^(templates|projects|uploads|videos)\//i.test(withoutLeading);
};

const normalizeUrlHost = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const stripProtocolAndPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const noProtocol = trimmed.replace(/^https?:\/\//i, "");
  const hostOnly = noProtocol.split("/")[0] || "";
  return hostOnly.trim().toLowerCase();
};

const hostMatches = (hostname: string, allowedHost: string): boolean =>
  hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);

const BACKEND_DEFAULT_ALLOWED_HOSTS = [
  "aliyuncs.com",
  "amazonaws.com.cn",
  "amazonaws.com",
  "s3.cn-northwest-1.amazonaws.com.cn",
  "apimart.ai",
  "kechuangai.com",
  "models.kapon.cloud",
  "volces.com",
  "tencentcos.cn",
  "myqcloud.com",
  "tai-ai.tos-cn-guangzhou.volces.com",
];

const getManagedAssetHosts = (): Set<string> => {
  const hosts = new Set<string>([DEFAULT_MANAGED_ASSET_HOST]);
  const publicBaseHost = normalizeUrlHost(getPublicAssetBaseUrl());
  if (publicBaseHost) hosts.add(publicBaseHost);
  if (typeof window !== "undefined" && window.location?.hostname) {
    const runtimeHost = String(window.location.hostname).trim().toLowerCase();
    if (runtimeHost && runtimeHost !== "localhost") {
      hosts.add(runtimeHost);
    }
  }
  return hosts;
};

const getLikelyBackendAllowedHosts = (): Set<string> => {
  const hosts = new Set<string>(BACKEND_DEFAULT_ALLOWED_HOSTS);
  getManagedAssetHosts().forEach((host) => hosts.add(host));
  const extraHostsRaw = String(
    (import.meta.env.VITE_ALLOWED_PROXY_HOSTS as string | undefined) || ""
  );
  extraHostsRaw
    .split(",")
    .map((host) => stripProtocolAndPath(host))
    .filter(Boolean)
    .forEach((host) => hosts.add(host));
  return hosts;
};

export const isLikelyBackendAllowedRemoteUrl = (
  value?: string | null
): value is RemoteUrl => {
  if (!isRemoteUrl(value)) return false;
  try {
    const hostname = new URL(value.trim()).hostname.toLowerCase();
    if (!hostname) return false;
    const allowedHosts = getLikelyBackendAllowedHosts();
    for (const allowedHost of allowedHosts) {
      if (hostMatches(hostname, allowedHost)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const looksLikeSignedAssetUrl = (url: string): boolean =>
  /[?&](?:X-Amz|X-Tos|OSSAccessKeyId|Signature|Expires)=/i.test(url);

export const isLikelyManagedAssetUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (getManagedAssetHosts().has(host)) return true;
    if (
      host.endsWith(".aliyuncs.com") &&
      /^\/(?:projects|uploads|templates|videos)\//i.test(parsed.pathname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * 上传成功后写入节点的持久化引用：优先可直接访问的 OSS/CDN URL，
 * 避免仅用 key 时必须依赖 /api/assets/proxy（代理或 API 域名配置异常时易裂图）。
 */
export function pickPersistedImageRefFromUploadAsset(
  asset: { url?: string; key?: string } | undefined,
  plannedKey: string
): string {
  const assetKey = typeof asset?.key === "string" ? asset.key.trim() : "";
  if (assetKey) {
    const direct = resolvePublicAssetUrlFromKey(assetKey);
    if (direct) return direct;
    return assetKey;
  }

  const url = typeof asset?.url === "string" ? asset.url.trim() : "";
  if (url && /^https?:\/\//i.test(url)) return url;
  const k =
    assetKey ||
    (typeof plannedKey === "string" ? plannedKey.trim() : "");
  if (k) return k;
  return url;
}

export const isPersistableImageRef = (value?: string | null): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    isDataUrl(trimmed) ||
    isBlobUrl(trimmed) ||
    trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)
  ) {
    return false;
  }
  if (isRemoteUrl(trimmed)) return true;
  if (isAssetProxyRef(trimmed)) return true;
  if (isAssetKeyRef(trimmed)) return true;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return true;
  }
  return false;
};

export const requiresManagedImageUpload = (value?: string | null): boolean => {
  const normalized = normalizePersistableImageRef(value);
  if (!normalized || !isRemoteUrl(normalized)) return false;
  return looksLikeSignedAssetUrl(normalized) || !isLikelyManagedAssetUrl(normalized);
};

/**
 * 将可持久化的图片引用做“去代理包装”：
 * - /api/assets/proxy?key=xxx -> xxx
 * - /api/assets/proxy?url=https://... -> https://...
 * 其他情况原样返回（trim 后）。
 */
export const normalizePersistableImageRef = (value?: string | null): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!isAssetProxyRef(trimmed)) return trimmed;

  try {
    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const url = new URL(trimmed, base);
    const key = url.searchParams.get("key");
    if (key) return key.replace(/^\/+/, "");
    const remote = url.searchParams.get("url");
    if (remote) return remote;
  } catch {
    // ignore
  }
  return trimmed;
};

const normalizePossiblyDuplicatedDataUrl = (dataUrl: string): string => {
  const trimmed = dataUrl.trim();
  if (!/^data:image\//i.test(trimmed)) return trimmed;
  // 处理 "data:image/png;base64,data:image/png;base64,AAAA..." 重复前缀
  const parts = trimmed.split(",");
  if (parts.length >= 3 && parts[1].startsWith("data:")) {
    const meta = parts[0];
    const last = parts[parts.length - 1];
    return `${meta},${last}`;
  }
  return trimmed;
};

/**
 * 用于 <img src> 的安全格式化：
 * - data:image/* -> 原样（并修复重复前缀）
 * - blob:/http(s) -> 原样（http(s) 会按需要走 assets proxy）
 * - /api/assets/proxy?... -> 补齐 base（适配生产静态部署）
 * - OSS key (projects/... 等) -> 一律转为 /api/assets/proxy?key=...（避免直连 CDN 自定义域名证书错误如 ERR_CERT_COMMON_NAME_INVALID）
 * - 其他路径（/ ./ ../）-> 原样（视为同源静态资源）
 * - 其他（认为是裸 base64）-> 补 data:image/png;base64 前缀
 */
export const toRenderableImageSrc = (value?: string | null): string | null => {
  if (!value || typeof value !== "string") return null;
  const normalized = normalizePersistableImageRef(value);
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  // 运行时引用：必须由 useFlowImageAssetUrl / useNonBase64ImageSrc 等解析，禁止当作 base64 包装
  if (parseFlowImageAssetRef(trimmed)) return null;
  if (isDataImageUrl(trimmed)) return normalizePossiblyDuplicatedDataUrl(trimmed);
  // Explicitly disable blob: in render/display chain.
  if (isBlobUrl(trimmed)) return null;
  if (isAssetKeyRef(trimmed)) {
    const withoutLeading = trimmed.replace(/^\/+/, "");
    const direct = resolvePublicAssetUrlFromKey(withoutLeading);
    if (direct) return direct;
    const directBase = getOssBaseUrl();
    if (directBase && !shouldAvoidSameOriginDirectBase(directBase)) {
      return `${directBase}${withoutLeading}`;
    }
    return withoutLeading.startsWith("/") ? withoutLeading : `/${withoutLeading}`;
  }
  if (isRemoteUrl(trimmed)) {
    const managedDirect = trimmed;
    if (isLikelyManagedAssetUrl(managedDirect)) {
      try {
        const parsed = new URL(managedDirect);
        const pathKey = parsed.pathname.replace(/^\/+/, "");
        if (isAssetKeyRef(pathKey)) {
          const direct = resolvePublicAssetUrlFromKey(pathKey);
          if (direct) return direct;
          const directBase = getOssBaseUrl();
          if (directBase && !shouldAvoidSameOriginDirectBase(directBase)) {
            return `${directBase}${pathKey}`;
          }
        }
      } catch {
        // ignore
      }
      return managedDirect;
    }
    try {
      const parsed = new URL(managedDirect);
      const pathKey = parsed.pathname.replace(/^\/+/, "");
      if (isAssetKeyRef(pathKey)) {
        const direct = resolvePublicAssetUrlFromKey(pathKey);
        if (direct) return direct;
        const directBase = getOssBaseUrl();
        if (directBase && !shouldAvoidSameOriginDirectBase(directBase)) {
          return `${directBase}${pathKey}`;
        }
      }

      const host = parsed.hostname.toLowerCase();
      const hotlinkSensitiveHosts = ["apimart.ai"];
      const needsDisplayProxy = hotlinkSensitiveHosts.some(
        (h) => host === h || host.endsWith(`.${h}`)
      );
      if (needsDisplayProxy) {
        return proxifyRemoteAssetUrl(managedDirect, { forceProxy: true });
      }
    } catch {
      // ignore
    }
    return proxifyRemoteAssetUrl(managedDirect);
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }
  // 兜底：裸 base64
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return null;
  return `data:image/png;base64,${compact}`;
};

/**
 * 将任意图片输入（dataURL/base64/blobURL/remoteURL）转换为 dataURL（供 AI/上传使用）。
 * 注意：remoteURL 会优先走 proxifyRemoteAssetUrl 以降低 CORS 失败概率。
 */
export const resolveImageToDataUrl = async (
  value?: string | null,
  options?: { preferProxy?: boolean }
): Promise<string | null> => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  console.log(`[resolveImageToDataUrl] 输入: ${trimmed.slice(0, 80)}...`);

  const flowAssetId = parseFlowImageAssetRef(trimmed);
  if (flowAssetId) {
    console.log(`[resolveImageToDataUrl] 检测到 flow-asset 引用, assetId: ${flowAssetId}`);
    try {
      const blob = await getFlowImageBlob(flowAssetId);
      if (!blob) {
        console.warn(`[resolveImageToDataUrl] flow-asset blob 为空, assetId: ${flowAssetId}`);
        return null;
      }
      console.log(`[resolveImageToDataUrl] flow-asset blob 获取成功, size: ${blob.size}, type: ${blob.type}`);
      const dataUrl = await blobToDataUrl(blob);
      console.log(`[resolveImageToDataUrl] flow-asset 转换成功: ${dataUrl.slice(0, 50)}...`);
      return normalizePossiblyDuplicatedDataUrl(dataUrl);
    } catch (err) {
      console.error(`[resolveImageToDataUrl] flow-asset 转换失败:`, err);
      return null;
    }
  }

  if (isDataImageUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] 已是 data URL`);
    return normalizePossiblyDuplicatedDataUrl(trimmed);
  }

  // blob:/data:/http(s)/proxy-path/key/path 统一 fetch -> blob -> dataURL
  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    const normalized = typeof candidate === "string" ? candidate.trim() : "";
    if (!normalized) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };
  if (isRemoteUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] 远程 URL`);
    const preferProxy = options?.preferProxy ?? true;
    if (preferProxy) {
      try {
        addCandidate(proxifyRemoteAssetUrl(trimmed));
      } catch {}
      // 即使全局关闭了渲染代理，分析/上传链路仍应优先尝试后端代理，避免浏览器端 CORS 不稳定。
      if (isLikelyBackendAllowedRemoteUrl(trimmed)) {
        try {
          addCandidate(proxifyRemoteAssetUrl(trimmed, { forceProxy: true }));
        } catch {}
      }
    }
    addCandidate(trimmed);
  } else if (isBlobUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] blob URL`);
    addCandidate(trimmed);
  } else if (isDataUrl(trimmed)) {
    console.log(`[resolveImageToDataUrl] data URL (非图片)`);
    addCandidate(trimmed);
  } else if (isAssetProxyRef(trimmed)) {
    console.log(`[resolveImageToDataUrl] asset proxy 引用`);
    addCandidate(proxifyRemoteAssetUrl(trimmed));
  } else if (isAssetKeyRef(trimmed)) {
    console.log(`[resolveImageToDataUrl] asset key 引用`);
    const withoutLeading = trimmed.replace(/^\/+/, "");
    // 优先直接使用环境配置的公共 OSS/CDN URL，缺失时走代理
    const directBase = getOssBaseUrl();
    if (directBase && !shouldAvoidSameOriginDirectBase(directBase)) {
      addCandidate(`${directBase}${withoutLeading}`);
    }
    // 兜底：走代理
    addCandidate(
      proxifyRemoteAssetUrl(`/api/assets/proxy?key=${encodeURIComponent(withoutLeading)}`, {
        forceProxy: true,
      })
    );
  } else if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    console.log(`[resolveImageToDataUrl] 相对路径`);
    try {
      const base =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "http://localhost";
      addCandidate(new URL(trimmed, base).toString());
    } catch {
      // ignore
    }
  } else {
    // 兜底：裸 base64
    console.log(`[resolveImageToDataUrl] 兜底处理为裸 base64`);
    const compact = trimmed.replace(/\s+/g, "");
    if (!compact) return null;
    return `data:image/png;base64,${compact}`;
  }

  console.log(`[resolveImageToDataUrl] 候选 URL 数量: ${candidates.length}`);

  for (const url of candidates) {
    console.log(`[resolveImageToDataUrl] 尝试 fetch: ${url.slice(0, 80)}...`);
    try {
      // 资产代理是公开读接口，不应携带凭证；否则跨域下会触发 wildcard+credentials 的 CORS 拦截。
      const response = await fetchImageResponse(url);
      if (!response) continue;
      if (!response.ok) {
        console.warn(`[resolveImageToDataUrl] fetch 失败: ${response.status}`);
        continue;
      }
      const blob = await responseToBlob(response);
      // 验证 blob 是图片类型
      if (!blob.type.startsWith("image/")) {
        console.warn(
          `[resolveImageToDataUrl] 跳过非图片类型: ${blob.type}, url: ${url}`
        );
        continue;
      }
      const dataUrl = await blobToDataUrl(blob);
      console.log(`[resolveImageToDataUrl] 转换成功: ${dataUrl.slice(0, 50)}...`);
      return normalizePossiblyDuplicatedDataUrl(dataUrl);
    } catch (err) {
      console.warn(`[resolveImageToDataUrl] fetch 异常:`, err);
      // try next candidate
    }
  }

  console.warn("[resolveImageToDataUrl] 所有候选 URL 均失败");
  return null;
};

/**
 * 将 dataURL/blobURL/remoteURL 转成 Blob（上传用）。对 dataURL 优先使用 fetch 解码，避免 atob+大数组导致 JS 堆峰值。
 */
export const resolveImageToBlob = async (
  value: string,
  options?: { preferProxy?: boolean }
): Promise<Blob | null> => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  const flowAssetId = parseFlowImageAssetRef(trimmed);
  if (flowAssetId) {
    try {
      return await getFlowImageBlob(flowAssetId);
    } catch {
      return null;
    }
  }

  const candidates: string[] = [];
  const addCandidate = (candidate?: string | null) => {
    const normalized = typeof candidate === "string" ? candidate.trim() : "";
    if (!normalized) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };
  if (isRemoteUrl(trimmed)) {
    const preferProxy = options?.preferProxy ?? true;
    if (preferProxy) {
      try {
        addCandidate(proxifyRemoteAssetUrl(trimmed));
      } catch {}
      if (isLikelyBackendAllowedRemoteUrl(trimmed)) {
        try {
          addCandidate(proxifyRemoteAssetUrl(trimmed, { forceProxy: true }));
        } catch {}
      }
    }
    addCandidate(trimmed);
  } else if (isBlobUrl(trimmed) || isDataUrl(trimmed)) {
    addCandidate(trimmed);
  } else if (isAssetProxyRef(trimmed)) {
    // 先把 proxy 引用还原成真实可持久化引用（key 或 remote url）再递归处理，
    // 避免在未开启代理时被解包成“裸 key”后直接 fetch 失败。
    const normalized = normalizePersistableImageRef(trimmed);
    if (normalized && normalized !== trimmed) {
      return await resolveImageToBlob(normalized, options);
    }
    addCandidate(proxifyRemoteAssetUrl(trimmed, { forceProxy: true }));
  } else if (isAssetKeyRef(trimmed)) {
    const withoutLeading = trimmed.replace(/^\/+/, "");
    const directBase = getOssBaseUrl();
    if (directBase && !shouldAvoidSameOriginDirectBase(directBase)) {
      addCandidate(`${directBase}${withoutLeading}`);
    }
    addCandidate(
      proxifyRemoteAssetUrl(
        `/api/assets/proxy?key=${encodeURIComponent(withoutLeading)}`,
        { forceProxy: true }
      )
    );
  } else if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    try {
      const base =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "http://localhost";
      addCandidate(new URL(trimmed, base).toString());
    } catch {
      // ignore
    }
  } else {
    // 裸 base64：补 data:image 前缀后再 fetch，避免 atob+大数组导致 JS 堆峰值
    const compact = trimmed.replace(/\s+/g, "");
    if (!compact) return null;
    return await resolveImageToBlob(`data:image/png;base64,${compact}`, options);
  }

  for (const url of candidates) {
    try {
      const response = await fetchImageResponse(url);
      if (!response) continue;
      if (!response.ok) continue;
      const blob = await responseToBlob(response);
      // 验证 blob 是图片类型
      if (blob.type && !blob.type.startsWith("image/")) {
        console.warn(
          `[resolveImageToBlob] 跳过非图片类型: ${blob.type}, url: ${url}`
        );
        continue;
      }
      return blob;
    } catch {
      // try next candidate
    }
  }
  return null;
};

/**
 * 将任意图片输入转换为可用于渲染的 ObjectURL（blob:...）。
 * 用途：避免在 UI（尤其画布）上直接使用 data:image/base64。
 */
export const resolveImageToObjectUrl = async (
  value?: string | null,
  options?: { preferProxy?: boolean }
): Promise<string | null> => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const blob = await resolveImageToBlob(trimmed, options);
  if (!blob) return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};
