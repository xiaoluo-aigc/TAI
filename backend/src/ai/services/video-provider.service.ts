// Video provider integration (Kling/Vidu/Seedance) with OSS post-processing.
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VideoProviderRequestDto } from "../dto/video-provider.dto";
import type { ReferenceImageItem } from "../dto/video-provider.dto";
import { OssService } from "../../oss/oss.service";
import { Readable } from "node:stream";
import { TencentVodAigcService } from "./tencent-vod-aigc.service";
import {
  ModelRoutingService,
  type ResolvedManagedModelRoute,
} from "./model-routing.service";
import type { TencentVodAigcCreateVideoTaskRequest } from "./tencent-vod-aigc.service";

// 默认请求超时时间（毫秒）
const DEFAULT_FETCH_TIMEOUT = 180000; // 3分钟
const QUERY_FETCH_TIMEOUT = 60000; // 60秒（避免触发阿里云 ESA 300秒超时限制，采用短超时+快速轮询策略）
const IMAGE_FETCH_TIMEOUT = 60000;
const MANAGED_IMAGE_KEY_REGEX = /^(projects|uploads|templates|videos|ai)\//i;
const MANAGED_KLING26_TENCENT_TASK_PREFIX = "tencentvod-kling26-";
const MANAGED_KLING30_TENCENT_TASK_PREFIX = "tencentvod-kling30-";
const MANAGED_VIDU_TENCENT_PREFIX = "tencentvod-vidu-";

type ManagedTencentVideoModelKey =
  | "kling-2.6"
  | "kling-3.0"
  | "vidu-q2"
  | "vidu-q3"
  | "seedance-1.5"
  | "seedance-2.0";

const MANAGED_TENCENT_VIDEO_MODEL_META: Record<
  ManagedTencentVideoModelKey,
  { prefix: string; label: string; uploadKeyPrefix: string }
> = {
  "kling-2.6": {
    prefix: MANAGED_KLING26_TENCENT_TASK_PREFIX,
    label: "Kling 2.6",
    uploadKeyPrefix: "kling-2.6",
  },
  "kling-3.0": {
    prefix: MANAGED_KLING30_TENCENT_TASK_PREFIX,
    label: "Kling 3.0",
    uploadKeyPrefix: "kling-3.0",
  },
  "vidu-q2": {
    prefix: `${MANAGED_VIDU_TENCENT_PREFIX}q2-`,
    label: "Vidu Q2",
    uploadKeyPrefix: "vidu-q2",
  },
  "vidu-q3": {
    prefix: `${MANAGED_VIDU_TENCENT_PREFIX}q3-`,
    label: "Vidu Q3",
    uploadKeyPrefix: "vidu-q3",
  },
  "seedance-1.5": {
    prefix: "tencentvod-seedance15-",
    label: "Seedance 1.5-Pro",
    uploadKeyPrefix: "seedance-1.5",
  },
  "seedance-2.0": {
    prefix: "tencentvod-seedance20-",
    label: "Seedance 2.0",
    uploadKeyPrefix: "seedance-2.0",
  },
};

type ViduManagedModelVersion = "q2" | "q3";

type SeedanceManagedModelVersion = "1.5-pro" | "2.0" | "2.0-fast";

type ManagedV2ExecutionBranch = "legacy" | "v2_request_profile";

type ManagedV2RequestStage = {
  method?: string;
  path?: string;
  headers?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  responseMapping?: Record<string, string[]>;
};

type ManagedV2RequestProfile = {
  enabled?: boolean;
  version?: string;
  transport?: string;
  create?: ManagedV2RequestStage;
  query?: ManagedV2RequestStage;
};

type ManagedV2ParsedTask = {
  modelKey: string;
  vendorKey: string;
  rawTaskId: string;
};

const resolveSeedanceUpstreamModelId = (modelVersion: SeedanceManagedModelVersion): string => {
  switch (modelVersion) {
    case "2.0":
      return "doubao-seedance-2-0-260128";
    case "2.0-fast":
      return "doubao-seedance-2-0-fast-260128";
    default:
      return "doubao-seedance-1-5-pro-251215";
  }
};

/**
 * 带超时的 fetch 请求
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_FETCH_TIMEOUT, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface VideoGenerationResult {
  taskId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  videoUrl?: string;
  thumbnailUrl?: string;
  execution?: {
    modelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    route?: "legacy" | "tencent_vod";
    providerChannel?: string;
    routedProvider?: string;
    fallbackUsed?: boolean;
  };
}

@Injectable()
export class VideoProviderService {
  private readonly logger = new Logger(VideoProviderService.name);
  private readonly doubaoVideoCache = new Map<string, string>();
  private readonly managedV2TaskPrefix = "managedv2:";

  constructor(
    private readonly oss: OssService,
    private readonly tencentVodAigcService: TencentVodAigcService,
    private readonly modelRoutingService: ModelRoutingService,
  ) {}

  private withExecutionMetadata(
    result: VideoGenerationResult,
    route: ResolvedManagedModelRoute,
    fallbackUsed: boolean,
  ): VideoGenerationResult {
    return {
      ...result,
      execution: {
        modelKey: route.model.modelKey,
        vendorKey: route.vendor.vendorKey,
        platformKey: route.vendor.platformKey || route.vendor.vendorKey,
        route: route.route,
        providerChannel: route.vendor.platformKey || route.vendor.vendorKey,
        routedProvider: route.vendor.provider || undefined,
        fallbackUsed,
      },
    };
  }

  private summarizeError(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return String(error);
  }

  private shouldFallbackToAlternativeRoute(error: unknown): boolean {
    if (error instanceof ServiceUnavailableException) return true;
    if (error instanceof BadRequestException) return false;
    const message = this.summarizeError(error);
    return /(暂不支持|未配置|未找到|不可用|unavailable|not support|not supported)/i.test(message);
  }

  private async executeManagedRouteWithFallback(
    modelKey: string,
    preferredVendorKey: string | undefined,
    executor: (route: ResolvedManagedModelRoute) => Promise<VideoGenerationResult>,
  ): Promise<VideoGenerationResult | null> {
    const candidates = await this.modelRoutingService.resolveVideoModelCandidates(
      modelKey,
      preferredVendorKey,
    );
    if (!candidates.length) return null;

    let lastError: unknown = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const route = candidates[index];
      const fallbackUsed = index > 0;
      try {
        const result = await executor(route);
        if (fallbackUsed) {
          this.logger.warn(
            `Video generation fallback succeeded for ${modelKey}: vendor=${route.vendor.vendorKey}, route=${route.route}`,
          );
        }
        return this.withExecutionMetadata(result, route, fallbackUsed);
      } catch (error) {
        lastError = error;
        const canFallback =
          index < candidates.length - 1 && this.shouldFallbackToAlternativeRoute(error);
        this.logger.warn(
          `Video generation route failed for ${modelKey}: vendor=${route.vendor.vendorKey}, route=${route.route}, fallback=${canFallback ? "next" : "stop"}, error=${this.summarizeError(error)}`,
        );
        if (!canFallback) {
          throw error;
        }
      }
    }

    if (lastError) throw lastError;
    return null;
  }

  private resolveOssHosts(): string[] {
    return this.oss.publicHosts();
  }

  private isOssPublicUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      const ossHosts = this.resolveOssHosts();
      return ossHosts.some(
        (ossHost) => host === ossHost || host.endsWith("." + ossHost)
      );
    } catch {
      return false;
    }
  }

  private isAllowedUpstreamHost(hostname: string): boolean {
    const allowed = this.oss.allowedPublicHosts();
    return allowed.some(
      (host) => hostname === host || hostname.endsWith("." + host)
    );
  }

  private extractManagedImageKey(input: string): string | null {
    const trimmed = typeof input === "string" ? input.trim() : "";
    if (!trimmed) return null;

    const normalizeKey = (raw?: string | null): string | null => {
      const value = typeof raw === "string" ? raw.trim().replace(/^\/+/, "") : "";
      if (!value) return null;
      return MANAGED_IMAGE_KEY_REGEX.test(value) ? value : null;
    };

    const normalizedDirect = normalizeKey(trimmed);
    if (normalizedDirect) return normalizedDirect;

    try {
      const parsed = new URL(trimmed);
      const keyFromPath = normalizeKey(parsed.pathname);
      if (keyFromPath) return keyFromPath;

      const keyFromQuery = normalizeKey(parsed.searchParams.get("key"));
      if (keyFromQuery) return keyFromQuery;

      const nestedUrl = parsed.searchParams.get("url");
      if (nestedUrl && nestedUrl !== trimmed) {
        const keyFromNested = this.extractManagedImageKey(nestedUrl);
        if (keyFromNested) return keyFromNested;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private buildBucketOriginUrlForKey(key: string): string | null {
    const normalizedKey = typeof key === "string" ? key.trim().replace(/^\/+/, "") : "";
    if (!normalizedKey) return null;
    const [bucketOriginHost] = this.resolveOssHosts();
    if (!bucketOriginHost) return null;
    return `https://${bucketOriginHost}/${normalizedKey}`;
  }

  private normalizeManagedAssetUrlForUpstream(input: string): string {
    const trimmed = typeof input === "string" ? input.trim() : "";
    if (!trimmed) return "";
    const managedKey = this.extractManagedImageKey(trimmed);
    if (!managedKey) return trimmed;
    return this.buildBucketOriginUrlForKey(managedKey) || this.oss.publicUrl(managedKey);
  }

  private buildImageFetchCandidates(imageUrl: string): string[] {
    const trimmed = typeof imageUrl === "string" ? imageUrl.trim() : "";
    if (!trimmed) return [];

    const candidates: string[] = [];
    const pushCandidate = (candidate?: string | null) => {
      const value = typeof candidate === "string" ? candidate.trim() : "";
      if (!value) return;
      if (!/^https?:\/\//i.test(value)) return;
      if (!candidates.includes(value)) {
        candidates.push(value);
      }
    };

    pushCandidate(trimmed);

    const managedKey = this.extractManagedImageKey(trimmed);
    if (managedKey) {
      pushCandidate(this.buildBucketOriginUrlForKey(managedKey));
      pushCandidate(this.oss.publicUrl(managedKey));
    }

    try {
      const parsed = new URL(trimmed);
      const nestedUrl = parsed.searchParams.get("url");
      if (nestedUrl) {
        pushCandidate(nestedUrl);
        const nestedKey = this.extractManagedImageKey(nestedUrl);
        if (nestedKey) {
          pushCandidate(this.buildBucketOriginUrlForKey(nestedKey));
          pushCandidate(this.oss.publicUrl(nestedKey));
        }
      }
    } catch {
      // ignore
    }

    return candidates;
  }

  private async uploadRemoteVideoToOss(
    sourceUrl: string,
    taskId: string
  ): Promise<string> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException("OSS 未配置，无法上传视频");
    }

    const cached = this.doubaoVideoCache.get(taskId);
    if (cached) return cached;

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new BadRequestException("视频 URL 无效");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BadRequestException("视频 URL 协议不支持");
    }

    if (!this.isAllowedUpstreamHost(parsed.hostname)) {
      this.logger.warn(`视频来源域名不在白名单: ${parsed.hostname}`);
      // 不抛出异常，直接返回原始 URL
      return sourceUrl;
    }

    const response = await fetchWithTimeout(sourceUrl, {
      method: 'GET',
      timeout: IMAGE_FETCH_TIMEOUT,
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `视频拉取失败: HTTP ${response.status}`
      );
    }

    const body = response.body;
    if (!body) {
      throw new ServiceUnavailableException("视频响应为空");
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    const extension =
      contentType.includes("video/") && contentType.split("/")[1]
        ? contentType.split("/")[1].split(";")[0].trim()
        : "mp4";

    // 根据 taskId 前缀确定存储路径
    const provider = taskId.startsWith("vidu-") ? "vidu"
      : taskId.startsWith("kling-") ? "kling"
      : "doubao";
    const key = `ai/videos/${provider}/${taskId}-${Date.now()}.${extension}`;

    const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => Readable })
      .fromWeb;
    const nodeStream =
      typeof fromWeb === "function"
        ? fromWeb(body as unknown)
        : Readable.from(Buffer.from(await response.arrayBuffer()));

    const { url } = await this.oss.putStream(key, nodeStream, {
      headers: { "Content-Type": contentType },
    });

    this.doubaoVideoCache.set(taskId, url);
    return url;
  }

  private async uploadBase64ImageToOSS(
    base64Data: string,
    mimeType: string = "image/png"
  ): Promise<string> {
    try {
      const input = typeof base64Data === "string" ? base64Data.trim() : "";
      if (!input) {
        throw new Error("Empty image input");
      }

      const managedKey = this.extractManagedImageKey(input);
      if (managedKey) {
        return this.normalizeManagedAssetUrlForUpstream(input);
      }

      if (input.startsWith("http://") || input.startsWith("https://")) {
        this.logger.log(`📎 Image is a URL, downloading: ${input.substring(0, 100)}...`);

        // 如果已经是 OSS URL，直接返回
        if (this.isOssPublicUrl(input)) {
          return input;
        }

        // 下载远程图片并上传到 OSS（对托管资源增加 OSS 原始域名候选，避免 CDN 在服务端/上游不可达）
        const fetchCandidates = this.buildImageFetchCandidates(input);
        if (!fetchCandidates.length) {
          throw new Error("Failed to fetch image: no valid candidate URL");
        }

        let imageBuffer: Buffer | null = null;
        let contentType = "image/jpeg";
        const errors: string[] = [];

        for (const candidate of fetchCandidates) {
          try {
            const response = await fetchWithTimeout(candidate, {
              method: "GET",
              timeout: IMAGE_FETCH_TIMEOUT,
            });
            if (!response.ok) {
              errors.push(`${candidate} -> HTTP ${response.status}`);
              continue;
            }
            const nextContentType = response.headers.get("content-type") || "image/jpeg";
            if (!nextContentType.toLowerCase().startsWith("image/")) {
              errors.push(`${candidate} -> invalid content-type ${nextContentType}`);
              continue;
            }
            imageBuffer = Buffer.from(await response.arrayBuffer());
            if (!imageBuffer.length) {
              errors.push(`${candidate} -> empty body`);
              continue;
            }
            contentType = nextContentType;
            break;
          } catch (error) {
            errors.push(
              `${candidate} -> ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        if (!imageBuffer) {
          throw new Error(
            `Failed to fetch image from all candidates: ${errors
              .slice(0, 3)
              .join(" | ")}`
          );
        }

        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const rawExtension = contentType.split("/")[1]?.split(";")[0] || "jpg";
        const extension = /^[a-z0-9]+$/i.test(rawExtension) ? rawExtension.toLowerCase() : "jpg";
        const key = `ai/images/video-provider-inputs/${timestamp}-${randomId}.${extension}`;

        const result = await this.oss.putStream(
          key,
          Readable.from(imageBuffer)
        );

        this.logger.log(`📤 Downloaded and uploaded image to OSS: ${result.url}`);
        return result.url;
      }

      const cleanBase64 = input.includes("base64,")
        ? input.split("base64,")[1]
        : input;

      const imageBuffer = Buffer.from(cleanBase64, "base64");
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const extension = mimeType.split("/")[1] || "png";
      const key = `ai/images/kling-inputs/${timestamp}-${randomId}.${extension}`;

      const result = await this.oss.putStream(
        key,
        Readable.from(imageBuffer)
      );

      this.logger.log(`📤 Uploaded image to OSS: ${result.url}`);
      return result.url;
    } catch (error) {
      this.logger.error(`❌ Failed to upload image to OSS: ${error}`);
      throw error;
    }
  }

  private async prepareViduReferenceImages(referenceImages?: ReferenceImageItem[]): Promise<string[]> {
    if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
      return [];
    }

    const output: string[] = [];
    for (const image of referenceImages) {
      const raw = typeof image === "string" ? image : image.url;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const normalized = await this.uploadBase64ImageToOSS(trimmed);
      output.push(normalized);
    }
    return output;
  }

  private async splitAndUploadReferenceImages(
    referenceImages: ReferenceImageItem[] | undefined,
  ): Promise<{
    uploadedStringUrls: string[];
    objectItems: Array<Exclude<ReferenceImageItem, string>>;
  }> {
    const rawItems = Array.isArray(referenceImages) ? referenceImages : [];
    const stringItems = rawItems.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    const objectItems = rawItems.filter(
      (item): item is Exclude<ReferenceImageItem, string> => typeof item !== "string",
    );
    const uploadedStringUrls = (
      await Promise.all(stringItems.map((item) => this.uploadBase64ImageToOSS(item)))
    ).filter(Boolean) as string[];
    return { uploadedStringUrls, objectItems };
  }

  private summarizeImageHosts(images: string[]): string {
    const hosts = Array.from(
      new Set(
        images
          .map((image) => {
            try {
              return new URL(image).hostname;
            } catch {
              return "non-url";
            }
          })
          .filter(Boolean)
      )
    );
    return hosts.join(",") || "none";
  }

  private isUpstreamImageFetchFailure(responseText: string): boolean {
    const raw = (responseText || "").toLowerCase();
    return (
      raw.includes("http_request_failed") ||
      raw.includes("upstream") ||
      raw.includes("请求上游地址失败") ||
      raw.includes("failed to get the contents of the file") ||
      raw.includes("failed to get contents of the file") ||
      raw.includes("get the contents of the file") ||
      raw.includes("content of the file")
    );
  }

  private isModelNotSupportedError(responseText: string): boolean {
    const raw = (responseText || "").toLowerCase();
    return (
      raw.includes("model is not supported") ||
      raw.includes("model_not_supported") ||
      raw.includes("不支持")
    );
  }

  private async remoteImageUrlToDataUrl(url: string): Promise<string> {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      timeout: DEFAULT_FETCH_TIMEOUT,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image url: HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  }

  private async convertKlingPayloadImagesToDataUrl(payload: any): Promise<any> {
    const next = JSON.parse(JSON.stringify(payload || {}));
    const toDataUrlIfRemote = async (
      value?: string
    ): Promise<string | undefined> => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      if (!/^https?:\/\//i.test(trimmed)) return trimmed;
      return this.remoteImageUrlToDataUrl(trimmed);
    };

    if (typeof next.image === "string") {
      next.image = await toDataUrlIfRemote(next.image);
    }
    if (typeof next.image_tail === "string") {
      next.image_tail = await toDataUrlIfRemote(next.image_tail);
    }
    if (Array.isArray(next.image_list)) {
      for (let i = 0; i < next.image_list.length; i += 1) {
        const item = next.image_list[i];
        if (item && typeof item.image === "string") {
          item.image = await toDataUrlIfRemote(item.image);
        }
      }
    }
    return next;
  }

  private logProviderPayload(provider: string, payload: any) {
    try {
      const safe = JSON.parse(
        JSON.stringify(payload, (_k, v) => {
          if (typeof v === "string" && v.length > 200) {
            return `${v.slice(0, 200)}...[truncated ${v.length} chars]`;
          }
          if (Array.isArray(v) && v.length > 10) {
            return `[array length ${v.length}]`;
          }
          return v;
        })
      );
      this.logger.debug(
        `🔁 ${provider} request payload: ${JSON.stringify(safe)}`
      );
    } catch {
      this.logger.debug(`🔁 ${provider} request payload (failed to stringify)`);
    }
  }

  // API Keys 优先从环境变量获取，否则使用默认值（仅供参考）
  private readonly apiKeys = {
    kling: process.env.KLING_API_KEY || "sk-kling-xxx",
    "kling-2.6": process.env.KLING_API_KEY || "sk-kling-xxx",
    "kling-o3": process.env.KLING_API_KEY || "sk-kling-xxx",
    vidu: process.env.VIDU_API_KEY || "sk-vidu-xxx",
    "viduq3-pro": process.env.VIDU_API_KEY || "sk-vidu-xxx",
    doubao:
      process.env.DOUBAO_API_KEY || "0ac5fae84-f299-4db4-8d7e-3f7fc355c6ac",
  };

  /**
   * 创建生成任务
   */
  async generateVideo(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const { provider } = options;

    if (
      (provider === "kling" || provider === "kling-2.6" || provider === "kling-o3") &&
      options.klingModel === "kling-v3-0"
    ) {
      return this.generateManagedKling30(options);
    }

    if (
      (provider === "kling" || provider === "kling-2.6") &&
      options.klingModel === "kling-v2-6"
    ) {
      return this.generateManagedKling26(options);
    }

    if (provider === "kling-o3") {
      return this.generateManagedKlingO3(options);
    }

    if (provider === "vidu" || provider === "viduq3-pro") {
      return this.generateManagedVidu(options);
    }

    if (provider === "doubao") {
      return this.generateManagedSeedance(options);
    }

    const apiKey = this.apiKeys[provider];

    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException(`${provider} API Key 未配置`);
    }

    this.logger.log(
      `🎬 视频生成任务创建: provider=${provider}, prompt=${options.prompt?.substring(
        0,
        50
      ) || "N/A"}...`
    );

    switch (provider) {
      case "kling":
        return this.generateKling(options, apiKey);
      case "kling-2.6":
        return this.generateKling26(options, apiKey);
      default:
        throw new Error(`不支持的供应商: ${provider}`);
    }
  }

  /**
   * 查询任务状态
   */
  async queryTask(
    provider: "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao",
    taskId: string
  ): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string }> {
    if (taskId.startsWith(this.managedV2TaskPrefix)) {
      return this.queryManagedV2Task(taskId);
    }

    const managedTencentTask = this.parseManagedTencentTaskId(taskId);
    if (managedTencentTask) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (
      (provider === "kling" || provider === "kling-2.6") &&
      taskId.startsWith(MANAGED_KLING26_TENCENT_TASK_PREFIX)
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (provider === "kling-o3") {
      return this.queryManagedKlingO3(taskId);
    }

    if (
      (provider === "kling" || provider === "kling-2.6") &&
      taskId.startsWith(MANAGED_KLING30_TENCENT_TASK_PREFIX)
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (
      (provider === "vidu" || provider === "viduq3-pro") &&
      taskId.startsWith(MANAGED_VIDU_TENCENT_PREFIX)
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    if (
      provider === "doubao" &&
      (taskId.startsWith("tencentvod-seedance15-") ||
        taskId.startsWith("tencentvod-seedance20-"))
    ) {
      return this.queryManagedTencentVideoTask(taskId);
    }

    const apiKey = this.apiKeys[provider];
    if (!apiKey) throw new Error(`${provider} API Key 未配置`);

    switch (provider) {
      case "doubao":
        return this.queryDoubao(taskId, apiKey);
      case "kling":
        return this.queryKling(taskId, apiKey);
      case "kling-2.6":
        return this.queryKling26(taskId, apiKey);
      case "vidu":
        return this.queryVidu(taskId, apiKey);
      case "viduq3-pro":
        return this.queryViduQ3Pro(taskId, apiKey);
      default:
        throw new Error(`不支持的供应商: ${provider}`);
    }
  }

  private async generateManagedKlingO3(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const managedResult = await this.executeManagedRouteWithFallback(
      "kling-o3",
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task("kling-o3", options, route);
      }
      if (route.route === "tencent_vod") {
        return this.generateKlingOmniViaTencent(options, route.vendor);
      }

      const apiKey = this.apiKeys["kling-o3"];
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException("kling-o3 API Key 未配置");
      }
      return this.generateKlingO1(options, apiKey);
      },
    );
    if (managedResult) return managedResult;

    const apiKey = this.apiKeys["kling-o3"];
    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-o3 API Key 未配置");
    }
    return this.generateKlingO1(options, apiKey);
  }

  private async generateManagedKling26(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const managedResult = await this.executeManagedRouteWithFallback(
      "kling-2.6",
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task("kling-2.6", options, route);
      }
      if (route.route === "tencent_vod") {
        const result = await this.generateKlingViaTencent(
          options,
          route.vendor,
          "2.6"
        );
        return this.withManagedTencentTaskPrefix("kling-2.6", result);
      }

      const apiKey = this.apiKeys["kling-2.6"];
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException("kling-2.6 API Key 未配置");
      }
      return this.generateKling26(options, apiKey);
      },
    );
    if (managedResult) return managedResult;

    const apiKey = this.apiKeys["kling-2.6"];
    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-2.6 API Key 未配置");
    }
    return this.generateKling26(options, apiKey);
  }

  private async generateManagedKling30(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const managedResult = await this.executeManagedRouteWithFallback(
      "kling-3.0",
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task("kling-3.0", options, route);
      }
      if (route.route === "tencent_vod") {
        const result = await this.generateKlingViaTencent(
          options,
          route.vendor,
          "3.0"
        );
        return {
          ...result,
          taskId: `${MANAGED_KLING30_TENCENT_TASK_PREFIX}${result.taskId}`,
        };
      }

      const klingO3ApiKey = this.apiKeys["kling-o3"];
      if (!klingO3ApiKey || klingO3ApiKey.includes("xxx")) {
        throw new ServiceUnavailableException("kling-o3 API Key 未配置");
      }

      return this.generateKlingO1(
        {
          ...options,
          provider: "kling-o3",
        },
        klingO3ApiKey,
      );
      },
    );
    if (managedResult) return managedResult;

    const klingO3ApiKey = this.apiKeys["kling-o3"];
    if (!klingO3ApiKey || klingO3ApiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-o3 API Key 未配置");
    }

    return this.generateKlingO1(
      {
        ...options,
        provider: "kling-o3",
      },
      klingO3ApiKey,
    );
  }

  private async queryManagedKlingO3(taskId: string) {
    const route = await this.modelRoutingService.resolveVideoModel("kling-o3");
    if (route?.route === "tencent_vod") {
      return this.queryTencentManagedVideoTask(taskId, "kling-o3", "Kling 3.0-Omni");
    }

    const apiKey = this.apiKeys["kling-o3"];
    if (!apiKey || apiKey.includes("xxx")) {
      throw new ServiceUnavailableException("kling-o3 API Key 未配置");
    }
    return this.queryKlingO1(taskId, apiKey);
  }

  private async generateManagedVidu(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const resolved = this.resolveManagedViduModel(options);
    const managedResult = await this.executeManagedRouteWithFallback(
      resolved.modelKey,
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task(resolved.modelKey, options, route);
      }

      if (route.route === "tencent_vod") {
        const result = await this.generateViduViaTencent(
          options,
          route.vendor,
          resolved.modelVersion,
        );
        return this.withManagedTencentTaskPrefix(resolved.modelKey, result);
      }

      const apiKey = this.apiKeys[resolved.legacyProvider];
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException(`${resolved.legacyProvider} API Key 未配置`);
      }

      if (resolved.modelVersion === "q2") {
        return this.generateVidu(options, apiKey);
      }

      if (resolved.modelVersion === "q3") {
        return this.generateViduQ3Pro(options, apiKey);
      }

      throw new ServiceUnavailableException(
        `旧链路暂不支持 ${resolved.label}，请在模型管理切换到腾讯 VOD`
      );
      },
    );
    if (managedResult) return managedResult;

    throw new ServiceUnavailableException(`未找到 ${resolved.label} 的可用生成链路`);
  }

  private async generateManagedSeedance(
    options: VideoProviderRequestDto
  ): Promise<VideoGenerationResult> {
    const resolved = this.resolveManagedSeedanceModel(options);
    const managedResult = await this.executeManagedRouteWithFallback(
      resolved.modelKey,
      options.vendorKey,
      async (route) => {
      if (this.shouldUseManagedV2RequestProfile(route)) {
        return this.createManagedV2Task(resolved.modelKey, options, route);
      }

      if (route.route === "tencent_vod") {
        const result = await this.generateSeedanceViaTencent(
          options,
          route.vendor,
          resolved.modelVersion
        );
        return this.withManagedTencentTaskPrefix(resolved.modelKey, result);
      }

      const apiKey = this.apiKeys.doubao;
      if (!apiKey || apiKey.includes("xxx")) {
        throw new ServiceUnavailableException("doubao API Key 未配置");
      }
      return this.generateDoubao(options, apiKey, resolved.modelVersion);
      },
    );
    if (managedResult) return managedResult;

    throw new ServiceUnavailableException(`未找到 ${resolved.label} 的可用生成链路`);
  }

  private shouldUseManagedV2RequestProfile(route: ResolvedManagedModelRoute): boolean {
    const branch = String(route.vendor?.metadata?.executionBranch || "legacy").trim();
    const profile = route.vendor?.metadata?.requestProfile;
    return branch === "v2_request_profile" && !!profile && profile.enabled !== false;
  }

  private getManagedV2RequestProfile(route: ResolvedManagedModelRoute): ManagedV2RequestProfile | null {
    const profile = route.vendor?.metadata?.requestProfile;
    if (!profile || typeof profile !== "object") {
      return null;
    }
    return profile as ManagedV2RequestProfile;
  }

  private buildManagedV2TaskId(modelKey: string, vendorKey: string, rawTaskId: string): string {
    return `${this.managedV2TaskPrefix}${encodeURIComponent(modelKey)}:${encodeURIComponent(vendorKey)}:${encodeURIComponent(rawTaskId)}`;
  }

  private parseManagedV2TaskId(taskId: string): ManagedV2ParsedTask | null {
    if (!taskId.startsWith(this.managedV2TaskPrefix)) {
      return null;
    }
    const payload = taskId.slice(this.managedV2TaskPrefix.length);
    const first = payload.indexOf(":");
    const second = payload.indexOf(":", first + 1);
    if (first < 0 || second < 0) {
      return null;
    }

    try {
      return {
        modelKey: decodeURIComponent(payload.slice(0, first)),
        vendorKey: decodeURIComponent(payload.slice(first + 1, second)),
        rawTaskId: decodeURIComponent(payload.slice(second + 1)),
      };
    } catch {
      return null;
    }
  }

  private getProviderApiKey(provider: string): string {
    const key = this.apiKeys[provider as keyof typeof this.apiKeys];
    if (!key || key.includes("xxx")) {
      throw new ServiceUnavailableException(`${provider} API Key 未配置`);
    }
    return key;
  }

  private buildManagedV2PromptText(options: VideoProviderRequestDto): string {
    return typeof options.prompt === "string" ? options.prompt.trim() : "";
  }

  private normalizeManagedV2ReferenceVideos(options: VideoProviderRequestDto): string[] {
    const candidates = [
      ...(Array.isArray(options.referenceVideos) ? options.referenceVideos : []),
      options.referenceVideo,
    ];

    return candidates
      .map((item) =>
        typeof item === "string" ? this.normalizeManagedAssetUrlForUpstream(item) : ""
      )
      .filter((item, index, array) => !!item && array.indexOf(item) === index);
  }

  private normalizeManagedV2ReferenceAudios(options: VideoProviderRequestDto): string[] {
    return (Array.isArray(options.audioUrls) ? options.audioUrls : [])
      .map((item) =>
        typeof item === "string" ? this.normalizeManagedAssetUrlForUpstream(item) : ""
      )
      .filter((item, index, array) => !!item && array.indexOf(item) === index);
  }

  private normalizeSeedanceApiResolution(
    modelKey: string,
    route: ResolvedManagedModelRoute,
    resolution: unknown,
  ): string | undefined {
    const normalized = typeof resolution === "string" ? resolution.trim() : "";
    if (!normalized) return undefined;
    if (!modelKey.startsWith("seedance-")) return normalized;
    if (route.vendor.vendorKey !== "seedance_api") return normalized;

    const upper = normalized.toUpperCase();
    if (upper === "480P") return "480p";
    if (upper === "720P") return "720p";
    if (upper === "1080P") return "1080p";
    return normalized;
  }

  private async buildManagedV2RequestContext(
    modelKey: string,
    options: VideoProviderRequestDto,
    route: ResolvedManagedModelRoute,
  ) {
    // Object items (volc asset references) are passed through as-is; string items go through OSS upload.
    const { uploadedStringUrls, objectItems } = await this.splitAndUploadReferenceImages(options.referenceImages);

    const promptText = this.buildManagedV2PromptText(options);
    const referenceVideos = this.normalizeManagedV2ReferenceVideos(options);
    const referenceAudios = this.normalizeManagedV2ReferenceAudios(options);
    const resolutionForRequest = this.normalizeSeedanceApiResolution(
      modelKey,
      route,
      options.resolution,
    );
    const content: any[] = [];

    if (promptText) {
      content.push({ type: "text", text: promptText });
    }

    // String items: already resolved to HTTPS URLs via OSS upload
    for (const imageUrl of uploadedStringUrls) {
      content.push({
        type: "image_url",
        image_url: { url: imageUrl },
        role: "reference_image",
      });
    }

    // Object items: apply asset:// substitution for sd2 active assets, fallback to HTTPS URL
    const isSeedance20 = modelKey === "seedance-2.0" || modelKey === "seedance-2.0-fast";
    for (const item of objectItems) {
      let url: string;
      if (isSeedance20 && item.volcAssetStatus === "active" && item.volcAssetId) {
        url = `asset://${item.volcAssetId}`;
      } else {
        url = item.url;
      }
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
    }

    for (const videoUrl of referenceVideos) {
      content.push({
        type: "video_url",
        video_url: { url: videoUrl },
        role: "reference_video",
      });
    }

    for (const audioUrl of referenceAudios) {
      content.push({
        type: "audio_url",
        audio_url: { url: audioUrl },
        role: "reference_audio",
      });
    }

    const objectItemUrls = objectItems.map((item) =>
      isSeedance20 && item.volcAssetStatus === "active" && item.volcAssetId
        ? `asset://${item.volcAssetId}`
        : item.url,
    );
    const allResolvedUrls = [...uploadedStringUrls, ...objectItemUrls];

    const transport = String(route.vendor?.metadata?.requestProfile?.transport || "").trim();
    const baseContext: Record<string, any> = {
      request: {
        ...options,
        resolution: resolutionForRequest,
        prompt: options.prompt || "",
        promptWithParams: promptText,
        seedanceUpstreamModelId:
          modelKey.startsWith("seedance-")
            ? resolveSeedanceUpstreamModelId(this.resolveManagedSeedanceModel(options).modelVersion)
            : undefined,
        referenceImages: allResolvedUrls,
        referenceImage: allResolvedUrls[0] || "",
        referenceVideos,
        referenceVideo: referenceVideos[0] || "",
        audioUrls: referenceAudios,
        generateAudio: options.generateAudio,
        content,
      },
      vendor: {
        vendorKey: route.vendor.vendorKey,
        provider: route.vendor.provider || options.provider,
        modelKey,
        modelName: route.vendor.modelName || "",
        modelVersion: route.vendor.modelVersion || "",
      },
    };

    if (transport !== "tencent_vod_aigc_video") {
      const apiKey = this.getProviderApiKey(route.vendor.provider || options.provider);
      baseContext.auth = {
        bearer: `Bearer ${apiKey}`,
      };
    }

    if (modelKey.startsWith("vidu-")) {
      const resolved = this.resolveManagedViduModel(options);
      const vodRequest = this.buildViduTencentCreateTaskRequest(
        options,
        route.vendor,
        resolved.modelVersion
      );
      return {
        ...baseContext,
        vod: {
          prompt: vodRequest.prompt || "",
          fileInfos: vodRequest.fileInfos || [],
          lastFrameUrl: vodRequest.lastFrameUrl || "",
          aspectRatio: vodRequest.aspectRatio || "",
          duration: vodRequest.duration || "",
          resolution: vodRequest.resolution || "",
          modelName: vodRequest.modelName,
          modelVersion: vodRequest.modelVersion,
          storageMode: vodRequest.storageMode || "Temporary",
          enhancePrompt: vodRequest.enhancePrompt || "Enabled",
        },
      };
    }

    if (modelKey.startsWith("seedance-")) {
      const resolved = this.resolveManagedSeedanceModel(options);
      const vodRequest = this.buildSeedanceTencentCreateTaskRequest(
        options,
        route.vendor,
        resolved.modelVersion
      );
      return {
        ...baseContext,
        vod: {
          prompt: vodRequest.prompt || "",
          fileInfos: vodRequest.fileInfos || [],
          lastFrameUrl: vodRequest.lastFrameUrl || "",
          aspectRatio: vodRequest.aspectRatio || "",
          duration: vodRequest.duration || "",
          resolution: vodRequest.resolution || "",
          modelName: vodRequest.modelName,
          modelVersion: vodRequest.modelVersion,
          audioGeneration: vodRequest.audioGeneration || "Disabled",
          storageMode: vodRequest.storageMode || "Temporary",
          enhancePrompt: vodRequest.enhancePrompt || "Enabled",
        },
      };
    }

    return baseContext;
  }

  private buildViduTencentCreateTaskRequest(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: ViduManagedModelVersion
  ): TencentVodAigcCreateVideoTaskRequest {
    const normalizedImages = Array.isArray(options.referenceImages)
      ? options.referenceImages
          .map((item) => typeof item === "string" ? item : item.url)
          .map((item) => this.normalizeManagedAssetUrlForUpstream(item))
          .filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];

    const normalizedPrompt =
      typeof options.prompt === "string" && options.prompt.trim()
        ? options.prompt.trim()
        : "";

    const resolvedModelVersion =
      (vendorConfig.modelVersion || fallbackModelVersion).trim().toLowerCase() as ViduManagedModelVersion;

    const explicitVideoMode = String(options.videoMode || "")
      .trim()
      .toLowerCase();
    const forceStartEndMode =
      explicitVideoMode === "start-end2video" ||
      explicitVideoMode === "start_end" ||
      explicitVideoMode === "start-end";

    if (forceStartEndMode && normalizedImages.length < 2) {
      throw new BadRequestException("Vidu 首尾帧模式至少需要 2 张图片（图1/图2）");
    }

    const isStartEndCandidate =
      forceStartEndMode ||
      (normalizedImages.length >= 2 &&
        !normalizedPrompt &&
        resolvedModelVersion === "q2");

    const primaryImages = isStartEndCandidate ? normalizedImages.slice(0, 1) : normalizedImages;
    const lastFrameUrl = isStartEndCandidate ? normalizedImages[1] : undefined;

    const fileInfos = primaryImages.map((url, index) => ({
      type: "Url" as const,
      category: "Image" as const,
      url,
      objectId: `id${index + 1}`,
      usage: undefined,
    }));

    if (!normalizedPrompt && fileInfos.length === 0) {
      throw new BadRequestException("文生视频模式需要提供提示词");
    }

    const resolutionRaw =
      typeof options.resolution === "string" && options.resolution.trim()
        ? options.resolution.trim().toUpperCase()
        : "720P";

    const duration =
      typeof options.duration === "number" && Number.isFinite(options.duration)
        ? Math.max(1, Math.min(16, Math.round(options.duration)))
        : resolvedModelVersion.startsWith("q3")
        ? 8
        : 5;

    return {
      modelName: vendorConfig.modelName || "Vidu",
      modelVersion: vendorConfig.modelVersion || fallbackModelVersion,
      prompt: normalizedPrompt || undefined,
      fileInfos,
      aspectRatio: options.aspectRatio,
      duration,
      resolution: resolutionRaw,
      storageMode: "Temporary",
      enhancePrompt: "Enabled",
      lastFrameUrl,
    };
  }

  private buildSeedanceTencentCreateTaskRequest(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: SeedanceManagedModelVersion
  ): TencentVodAigcCreateVideoTaskRequest {
    const normalizedImages = Array.isArray(options.referenceImages)
      ? options.referenceImages
          .map((item) => typeof item === "string" ? item : item.url)
          .map((item) => this.normalizeManagedAssetUrlForUpstream(item))
          .filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];

    const normalizedPrompt =
      typeof options.prompt === "string" && options.prompt.trim()
        ? options.prompt.trim()
        : "";

    if (!normalizedPrompt && normalizedImages.length === 0) {
      throw new BadRequestException("Seedance 需要提供提示词或至少 1 张参考图");
    }

    const fileInfos = normalizedImages.map((url, index) => ({
      type: "Url" as const,
      category: "Image" as const,
      url,
      objectId: `id${index + 1}`,
    }));

    const requestedResolution =
      typeof options.resolution === "string" && options.resolution.trim()
        ? options.resolution.trim().toUpperCase()
        : "720P";
    const resolvedModelVersion =
      (vendorConfig.modelVersion || fallbackModelVersion).trim().toLowerCase();
    const resolution =
      resolvedModelVersion === "1.5-pro"
        ? "720P"
        : requestedResolution === "480P" || requestedResolution === "720P"
        ? requestedResolution
        : "720P";
    const duration =
      typeof options.duration === "number" && Number.isFinite(options.duration)
        ? resolvedModelVersion === "1.5-pro"
          ? Math.max(3, Math.min(10, Math.round(options.duration)))
          : Math.max(4, Math.min(15, Math.round(options.duration)))
        : 5;

    return {
      modelName: vendorConfig.modelName || "Seedance",
      modelVersion: vendorConfig.modelVersion || fallbackModelVersion,
      prompt: normalizedPrompt || undefined,
      fileInfos,
      aspectRatio: options.aspectRatio,
      duration,
      resolution,
      audioGeneration:
        resolvedModelVersion === "1.5-pro"
          ? "Disabled"
          : options.generateAudio
          ? "Enabled"
          : "Disabled",
      storageMode: "Temporary",
      enhancePrompt: "Enabled",
    };
  }

  private resolveTemplatePath(source: any, path: string): any {
    const normalized = path.trim();
    if (!normalized) return undefined;
    return normalized.split(".").reduce((acc, segment) => {
      if (acc == null) return undefined;
      if (/^\d+$/.test(segment)) {
        const index = Number(segment);
        return Array.isArray(acc) ? acc[index] : undefined;
      }
      return acc[segment];
    }, source);
  }

  private renderTemplateValue(value: any, context: any): any {
    if (typeof value === "string") {
      const exact = value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
      if (exact) {
        return this.resolveTemplatePath(context, exact[1]);
      }

      return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token) => {
        const resolved = this.resolveTemplatePath(context, token);
        if (resolved == null) return "";
        if (typeof resolved === "object") {
          return JSON.stringify(resolved);
        }
        return String(resolved);
      });
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.renderTemplateValue(item, context))
        .filter((item) => item !== undefined && item !== null && item !== "");
    }

    if (value && typeof value === "object") {
      const next: Record<string, any> = {};
      Object.entries(value).forEach(([key, item]) => {
        const rendered = this.renderTemplateValue(item, context);
        if (rendered !== undefined && rendered !== null && rendered !== "") {
          next[key] = rendered;
        }
      });
      return next;
    }

    return value;
  }

  private readMappedValue(source: any, paths?: string[]): any {
    if (!Array.isArray(paths)) return undefined;
    for (const path of paths) {
      const value = this.resolveTemplatePath(source, path);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  }

  private async executeManagedV2Stage(
    stage: ManagedV2RequestStage,
    context: any,
  ): Promise<{ raw: any; mapped: Record<string, any> }> {
    const method = String(stage.method || "GET").toUpperCase();
    const url = String(this.renderTemplateValue(stage.path || "", context) || "").trim();
    if (!url) {
      throw new ServiceUnavailableException("V2 请求配置缺少 path");
    }

    const headers = (this.renderTemplateValue(stage.headers || {}, context) || {}) as Record<string, any>;
    const query = (this.renderTemplateValue(stage.query || {}, context) || {}) as Record<string, any>;
    const body = this.renderTemplateValue(stage.body, context);

    const finalUrl = new URL(url);
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      finalUrl.searchParams.set(key, String(value));
    });

    const response = await fetchWithTimeout(finalUrl.toString(), {
      method,
      headers: Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, String(value)])
      ),
      body:
        body === undefined || body === null || method === "GET"
          ? undefined
          : JSON.stringify(body),
      timeout: method === "GET" ? QUERY_FETCH_TIMEOUT : DEFAULT_FETCH_TIMEOUT,
    });

    const raw = await response.json().catch(async () => ({
      message: await response.text().catch(() => ""),
    }));

    if (!response.ok) {
      throw new Error(
        this.readMappedValue(raw, stage.responseMapping?.error) ||
          raw?.error?.message ||
          raw?.message ||
          `HTTP ${response.status}`
      );
    }

    const mapped = Object.fromEntries(
      Object.entries(stage.responseMapping || {}).map(([key, paths]) => [
        key,
        this.readMappedValue(raw, paths),
      ])
    );

    return { raw, mapped };
  }

  private async createManagedV2Task(
    modelKey: string,
    options: VideoProviderRequestDto,
    route: ResolvedManagedModelRoute,
  ): Promise<VideoGenerationResult> {
    const profile = this.getManagedV2RequestProfile(route);
    if (!profile?.create) {
      throw new ServiceUnavailableException(`V2 配置缺少 create 阶段: ${modelKey}`);
    }

    const context = await this.buildManagedV2RequestContext(modelKey, options, route);
    const transport = String(profile.transport || "").trim();

    let rawTaskId = "";
    if (transport === "tencent_vod_aigc_video") {
      const payload = this.renderTemplateValue(profile.create.body || {}, context) as TencentVodAigcCreateVideoTaskRequest;
      const result = await this.tencentVodAigcService.createVideoTask(payload);
      rawTaskId = String(result.taskId || "").trim();
    } else {
      const { mapped } = await this.executeManagedV2Stage(profile.create, context);
      rawTaskId = String(mapped.taskId || mapped.id || "").trim();
    }

    if (!rawTaskId) {
      throw new ServiceUnavailableException(`V2 创建任务未返回 taskId: ${modelKey}`);
    }

    return {
      taskId: this.buildManagedV2TaskId(modelKey, route.vendor.vendorKey, rawTaskId),
      status: "queued",
    };
  }

  private normalizeManagedV2Status(
    route: ResolvedManagedModelRoute,
    status: any,
  ): "queued" | "processing" | "succeeded" | "failed" {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return "queued";

    const polling =
      route.vendor?.metadata?.polling && typeof route.vendor.metadata.polling === "object"
        ? (route.vendor.metadata.polling as Record<string, any>)
        : {};

    const successStatuses = Array.isArray(polling.successStatuses)
      ? polling.successStatuses.map((item: unknown) => String(item).trim().toLowerCase())
      : ["succeeded", "success", "completed", "done", "finish", "finished"];
    const failedStatuses = Array.isArray(polling.failedStatuses)
      ? polling.failedStatuses.map((item: unknown) => String(item).trim().toLowerCase())
      : ["failed", "error", "canceled", "cancelled", "timeout", "expired", "fail"];
    const processingStatuses = Array.isArray(polling.processingStatuses)
      ? polling.processingStatuses.map((item: unknown) => String(item).trim().toLowerCase())
      : ["running", "processing", "pending", "queued", "submitted", "waiting"];

    if (successStatuses.includes(normalized)) return "succeeded";
    if (failedStatuses.includes(normalized)) return "failed";
    if (processingStatuses.includes(normalized)) return normalized === "queued" ? "queued" : "processing";
    return "processing";
  }

  private extractTencentVodTerminalError(raw: any): string | null {
    const aigcTask = raw?.AigcVideoTask || raw?.AIGCVideoTask || raw?.Response?.AigcVideoTask || raw?.Response?.AIGCVideoTask;
    const procedureTask = raw?.ProcedureTask || raw?.Response?.ProcedureTask;

    const errCode = Number(aigcTask?.ErrCode || procedureTask?.ErrCode || 0);
    const errCodeExt = String(aigcTask?.ErrCodeExt || procedureTask?.ErrCodeExt || "").trim();
    const message = String(aigcTask?.Message || procedureTask?.Message || raw?.Message || raw?.Response?.Message || "").trim();

    if (errCode > 0 || errCodeExt || message) {
      return [errCode > 0 ? `ErrCode=${errCode}` : "", errCodeExt, message]
        .filter(Boolean)
        .join(" ");
    }

    return null;
  }

  private async queryManagedV2Task(taskId: string) {
    const parsed = this.parseManagedV2TaskId(taskId);
    if (!parsed) {
      return { status: "processing" };
    }

    const route = await this.modelRoutingService.resolveVideoModelByVendor(
      parsed.modelKey,
      parsed.vendorKey,
      { includeDisabled: true },
    );
    if (!route || !this.shouldUseManagedV2RequestProfile(route)) {
      throw new ServiceUnavailableException(`未找到 V2 任务配置: ${parsed.modelKey}/${parsed.vendorKey}`);
    }

    const profile = this.getManagedV2RequestProfile(route);
    if (!profile?.query) {
      throw new ServiceUnavailableException(`V2 配置缺少 query 阶段: ${parsed.modelKey}`);
    }

    const transport = String(profile.transport || "").trim();
    let mapped: Record<string, any> = {};

    if (transport === "tencent_vod_aigc_video") {
      const result = await this.tencentVodAigcService.queryVideoTask(parsed.rawTaskId);
      mapped = {
        status: result.status,
        videoUrl: result.videoUrl,
        fileId: result.fileId,
        requestId: result.requestId,
        error: this.extractTencentVodTerminalError(result.raw),
      };
    } else {
      const apiKey = this.getProviderApiKey(route.vendor.provider || "doubao");
      const context = {
        task: { id: parsed.rawTaskId },
        auth: { bearer: `Bearer ${apiKey}` },
      };
      ({ mapped } = await this.executeManagedV2Stage(profile.query, context));
    }

    const status = this.normalizeManagedV2Status(route, mapped.status);

    if (status === "succeeded") {
      const upstreamUrl = String(mapped.videoUrl || "").trim();
      if (!upstreamUrl) {
        throw new ServiceUnavailableException(
          String(mapped.error || "").trim() || "V2 查询成功但返回空视频链接"
        );
      }
      if (this.isOssPublicUrl(upstreamUrl)) {
        return { status, videoUrl: upstreamUrl };
      }
      const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, parsed.rawTaskId);
      return { status, videoUrl: ossUrl };
    }

    if (status === "failed") {
      return {
        status,
        error: String(mapped.error || "生成失败"),
      };
    }

    return { status };
  }

  private withManagedTencentTaskPrefix(
    modelKey: ManagedTencentVideoModelKey,
    result: VideoGenerationResult,
  ): VideoGenerationResult {
    const meta = MANAGED_TENCENT_VIDEO_MODEL_META[modelKey];
    return {
      ...result,
      taskId: `${meta.prefix}${result.taskId}`,
    };
  }

  private parseManagedTencentTaskId(taskId: string): {
    modelKey: ManagedTencentVideoModelKey;
    rawTaskId: string;
  } | null {
    for (const [modelKey, meta] of Object.entries(MANAGED_TENCENT_VIDEO_MODEL_META) as Array<
      [ManagedTencentVideoModelKey, (typeof MANAGED_TENCENT_VIDEO_MODEL_META)[ManagedTencentVideoModelKey]]
    >) {
      if (taskId.startsWith(meta.prefix)) {
        return {
          modelKey,
          rawTaskId: taskId.slice(meta.prefix.length),
        };
      }
    }
    return null;
  }

  private async queryManagedTencentVideoTask(taskId: string) {
    const parsed = this.parseManagedTencentTaskId(taskId);
    if (!parsed) {
      return { status: "processing" };
    }

    const meta = MANAGED_TENCENT_VIDEO_MODEL_META[parsed.modelKey];
    return this.queryTencentManagedVideoTask(parsed.rawTaskId, meta.uploadKeyPrefix, meta.label);
  }

  private resolveManagedViduModel(options: VideoProviderRequestDto): {
    modelKey: ManagedTencentVideoModelKey;
    modelVersion: ViduManagedModelVersion;
    legacyProvider: "vidu" | "viduq3-pro";
    label: string;
  } {
    const normalized = String(options.viduModel || "").trim().toLowerCase();
    const isQ2Family =
      normalized === "" ||
      normalized === "q2" ||
      normalized === "q2-pro" ||
      normalized === "q2pro" ||
      normalized === "q2-turbo" ||
      normalized === "q2turbo";
    const isQ3Family =
      normalized === "q3" ||
      normalized === "q3-pro" ||
      normalized === "q3pro" ||
      normalized === "q3-turbo" ||
      normalized === "q3turbo" ||
      normalized === "q3-mix" ||
      normalized === "q3mix";
    if (!isQ2Family && !isQ3Family) {
      throw new BadRequestException("暂不支持该 Vidu 模型版本，仅支持 q2 / q3");
    }

    if (isQ3Family) {
      return {
        modelKey: "vidu-q3",
        modelVersion: "q3",
        legacyProvider: "viduq3-pro",
        label: "Vidu Q3",
      };
    }

    return {
      modelKey: "vidu-q2",
      modelVersion: "q2",
      legacyProvider: "vidu",
      label: "Vidu Q2",
    };
  }

  private resolveManagedSeedanceModel(options: VideoProviderRequestDto): {
    modelKey: "seedance-1.5" | "seedance-2.0";
    modelVersion: SeedanceManagedModelVersion;
    label: string;
  } {
    const normalized = String(options.seedanceModel || "").trim().toLowerCase();
    if (normalized === "seedance-2.0-fast" || normalized === "2.0-fast") {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0-fast",
        label: "Seedance 2.0 Fast",
      };
    }
    if (normalized === "seedance-2.0" || normalized === "2.0") {
      return {
        modelKey: "seedance-2.0",
        modelVersion: "2.0",
        label: "Seedance 2.0",
      };
    }

    return {
      modelKey: "seedance-1.5",
      modelVersion: "1.5-pro",
      label: "Seedance 1.5-Pro",
    };
  }

  private async generateKlingOmniViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string }
  ): Promise<VideoGenerationResult> {
    return this.generateKlingViaTencent(options, vendorConfig, "3.0-Omni");
  }

  private isTencentKling3ModelVersion(modelVersion: string): boolean {
    const normalized = String(modelVersion || "").trim().toLowerCase();
    return normalized === "3.0" || normalized === "3.0-omni";
  }

  private normalizeTencentKlingStoryboardMode(
    rawMode: unknown
  ): "single" | "intelligence" | "customize" {
    const normalized = String(rawMode || "")
      .trim()
      .toLowerCase();
    if (!normalized || normalized === "single" || normalized === "none" || normalized === "off") {
      return "single";
    }
    if (normalized === "intelligence" || normalized === "smart") {
      return "intelligence";
    }
    if (normalized === "customize" || normalized === "custom") {
      return "customize";
    }
    throw new BadRequestException(
      "Tencent Kling 分镜模式无效，仅支持 single / intelligence / customize"
    );
  }

  private parseTencentKlingCustomStoryboardShots(
    script: string
  ): Array<{ index: number; prompt: string; duration: number }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      throw new BadRequestException("腾讯 Kling 自定义分镜脚本 JSON 格式无效");
    }

    const source = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as any).multi_prompt)
      ? (parsed as any).multi_prompt
      : null;

    if (!source) {
      throw new BadRequestException(
        "腾讯 Kling 自定义分镜脚本需为数组，格式示例：[{\"index\":1,\"prompt\":\"...\",\"duration\":2}]"
      );
    }

    if (source.length < 1 || source.length > 6) {
      throw new BadRequestException("腾讯 Kling 自定义分镜数量需在 1 到 6 之间");
    }

    return source.map((item: any, position: number) => {
      if (!item || typeof item !== "object") {
        throw new BadRequestException(`腾讯 Kling 自定义分镜第 ${position + 1} 项格式无效`);
      }
      const prompt = String((item as any).prompt || "").trim();
      if (!prompt) {
        throw new BadRequestException(`腾讯 Kling 自定义分镜第 ${position + 1} 项缺少 prompt`);
      }
      if (prompt.length > 512) {
        throw new BadRequestException(
          `腾讯 Kling 自定义分镜第 ${position + 1} 项 prompt 长度不能超过 512`
        );
      }

      const durationRaw = Number((item as any).duration);
      const duration = Math.round(durationRaw);
      if (!Number.isFinite(durationRaw) || duration < 1) {
        throw new BadRequestException(
          `腾讯 Kling 自定义分镜第 ${position + 1} 项 duration 必须为大于等于 1 的数字`
        );
      }

      const indexRaw = Number((item as any).index);
      const index =
        Number.isFinite(indexRaw) && Math.round(indexRaw) >= 1
          ? Math.round(indexRaw)
          : position + 1;

      return {
        index,
        prompt,
        duration,
      };
    });
  }

  private buildTencentKlingStoryboardExtInfo(
    options: VideoProviderRequestDto,
    modelVersion: string,
    taskDuration: number
  ): string | undefined {
    if (!this.isTencentKling3ModelVersion(modelVersion)) {
      return undefined;
    }

    const storyboardMode = this.normalizeTencentKlingStoryboardMode(
      options.klingStoryboardMode
    );
    const additionalParameters: Record<string, any> = {};

    if (storyboardMode === "single") {
      additionalParameters.multi_shot = false;
    } else if (storyboardMode === "intelligence") {
      if (!String(options.prompt || "").trim()) {
        throw new BadRequestException("腾讯 Kling 智能分镜模式需要填写提示词");
      }
      additionalParameters.multi_shot = true;
      additionalParameters.shot_type = "intelligence";
      additionalParameters.short_type = "intelligence";
    } else {
      const scriptRaw = String(options.klingStoryboardScript || "").trim();
      if (!scriptRaw) {
        throw new BadRequestException("腾讯 Kling 自定义分镜模式需要填写分镜脚本 JSON");
      }
      const shots = this.parseTencentKlingCustomStoryboardShots(scriptRaw);
      const totalShotDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
      if (totalShotDuration !== taskDuration) {
        throw new BadRequestException(
          `腾讯 Kling 自定义分镜总时长需等于任务时长：当前分镜总时长 ${totalShotDuration}s，任务时长 ${taskDuration}s`
        );
      }
      additionalParameters.multi_shot = true;
      additionalParameters.shot_type = "customize";
      additionalParameters.short_type = "customize";
      additionalParameters.multi_prompt = shots;
    }

    return JSON.stringify({
      AdditionalParameters: JSON.stringify(additionalParameters),
    });
  }

  private async generateKlingViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: string
  ): Promise<VideoGenerationResult> {
    const referenceAudios = this.normalizeManagedV2ReferenceAudios(options);
    if (referenceAudios.length > 0) {
      this.logger.warn(
        `Tencent Kling (${fallbackModelVersion}) does not support audio URL reference input; audioUrls will be ignored`,
      );
    }

    const normalizedImages = Array.isArray(options.referenceImages)
      ? options.referenceImages
          .map((item) => typeof item === "string" ? item : item.url)
          .map((item) => this.normalizeManagedAssetUrlForUpstream(item))
          .filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    const normalizedReferenceVideo =
      typeof options.referenceVideo === "string"
        ? this.normalizeManagedAssetUrlForUpstream(options.referenceVideo)
        : "";

    const modelVersion = vendorConfig.modelVersion || fallbackModelVersion;
    const normalizedModelVersion = String(modelVersion || "").trim().toLowerCase();
    const isKling26Model =
      normalizedModelVersion === "2.6" || normalizedModelVersion === "2.6.0";
    const isKling30Family = this.isTencentKling3ModelVersion(modelVersion);
    const hasReferenceVideo =
      typeof normalizedReferenceVideo === "string" && normalizedReferenceVideo.trim().length > 0;
    const isStartEndMode = isKling26Model && normalizedImages.length >= 2;

    if (hasReferenceVideo && !isKling30Family) {
      throw new BadRequestException(`腾讯 VOD Kling ${fallbackModelVersion} 暂不支持视频参考模式`);
    }

    const firstFrameUrl = normalizedImages[0];
    const lastFrameUrl =
      !hasReferenceVideo && isStartEndMode && normalizedImages.length >= 2
        ? normalizedImages[1]
        : undefined;
    const imageFileInfos = firstFrameUrl
      ? isStartEndMode
        ? [
            {
              type: "Url" as const,
              category: "Image" as const,
              url: firstFrameUrl,
              usage: "FirstFrame" as const,
            },
          ]
        : normalizedImages.map((url, index) => ({
            type: "Url" as const,
            category: "Image" as const,
            url,
            objectId: `id${index + 1}`,
            usage: "Reference" as const,
          }))
      : [];
    const normalizedReferenceVideoType: "feature" | "base" =
      String(options.referenceVideoType || "").trim().toLowerCase() === "base"
        ? "base"
        : "feature";
    const normalizedKeepOriginalSound: "Enabled" | "Disabled" =
      String(options.keepOriginalSound || "").trim().toLowerCase() === "yes"
        ? "Enabled"
        : "Disabled";
    const videoFileInfos = hasReferenceVideo
      ? [
          {
            type: "Url" as const,
            category: "Video" as const,
            url: normalizedReferenceVideo,
            referenceType: normalizedReferenceVideoType,
            keepOriginalSound: normalizedKeepOriginalSound,
          },
        ]
      : [];
    const fileInfos = [...imageFileInfos, ...videoFileInfos];

    const rawResolution =
      typeof options.resolution === "string" && options.resolution.trim()
        ? options.resolution.trim().toUpperCase()
        : "";
    const defaultResolution = options.mode === "pro" ? "1080P" : "720P";
    const resolutionRaw = isKling26Model
      ? rawResolution === "720P" || rawResolution === "1080P"
        ? rawResolution
        : defaultResolution
      : rawResolution || defaultResolution;

    const requestedDuration =
      typeof options.duration === "number" && Number.isFinite(options.duration)
        ? Math.round(options.duration)
        : undefined;
    const duration = isKling26Model
      ? requestedDuration === 10
        ? 10
        : 5
      : requestedDuration !== undefined
      ? Math.max(3, Math.min(15, requestedDuration))
      : 5;

    if (hasReferenceVideo && duration > 10) {
      throw new BadRequestException("腾讯 Kling 视频参考模式仅支持 3~10 秒时长");
    }

    const normalizedSound =
      typeof options.sound === "string" ? options.sound.trim().toLowerCase() : "";
    let audioGeneration: "Enabled" | "Disabled";
    if (normalizedSound === "on") {
      audioGeneration = "Enabled";
    } else if (normalizedSound === "off") {
      audioGeneration = "Disabled";
    } else {
      audioGeneration = options.mode === "pro" ? "Enabled" : "Disabled";
    }

    if (isKling26Model && isStartEndMode && audioGeneration === "Enabled") {
      this.logger.warn(
        "Tencent Kling 2.6 start-end mode only supports no-audio, forcing OutputConfig.AudioGeneration=Disabled",
      );
      audioGeneration = "Disabled";
    }

    const extInfo = this.buildTencentKlingStoryboardExtInfo(
      options,
      modelVersion,
      duration
    );

    const { taskId } = await this.tencentVodAigcService.createVideoTask({
      modelName: vendorConfig.modelName || "Kling",
      modelVersion,
      prompt: options.prompt,
      fileInfos,
      lastFrameUrl,
      aspectRatio: options.aspectRatio,
      duration,
      resolution: resolutionRaw,
      audioGeneration,
      storageMode: "Temporary",
      enhancePrompt: "Enabled",
      extInfo,
    });

    return {
      taskId,
      status: "queued",
    };
  }

  private async generateViduViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: ViduManagedModelVersion
  ): Promise<VideoGenerationResult> {
    const request = this.buildViduTencentCreateTaskRequest(
      options,
      vendorConfig,
      fallbackModelVersion
    );
    const { taskId } = await this.tencentVodAigcService.createVideoTask(request);

    return {
      taskId,
      status: "queued",
    };
  }

  private async generateSeedanceViaTencent(
    options: VideoProviderRequestDto,
    vendorConfig: { modelName?: string; modelVersion?: string },
    fallbackModelVersion: SeedanceManagedModelVersion
  ): Promise<VideoGenerationResult> {
    const request = this.buildSeedanceTencentCreateTaskRequest(
      options,
      vendorConfig,
      fallbackModelVersion
    );
    const { taskId } = await this.tencentVodAigcService.createVideoTask(request);

    return {
      taskId,
      status: "queued",
    };
  }

  private async queryTencentManagedVideoTask(
    taskId: string,
    uploadKeyPrefix: string,
    modelLabel: string
  ) {
    const result = await this.tencentVodAigcService.queryVideoTask(taskId);
    const normalizedStatus = String(result.status || "").trim().toLowerCase();
    const terminalError = this.extractTencentVodTerminalError(result.raw);

    if (
      normalizedStatus === "finish" ||
      normalizedStatus === "finished" ||
      normalizedStatus === "success" ||
      normalizedStatus === "succeed" ||
      normalizedStatus === "succeeded" ||
      normalizedStatus === "completed"
    ) {
      if (terminalError && !result.videoUrl) {
        return { status: "failed", error: terminalError } as any;
      }
      if (!result.videoUrl) {
        this.logger.warn(
          `Tencent VOD ${modelLabel} completed without videoUrl yet, continue polling: ${JSON.stringify(
            {
              taskId,
              status: result.status,
              fileId: result.fileId,
              requestId: result.requestId,
              terminalError,
              procedureStatus: (result.raw?.ProcedureTask as any)?.Status || null,
              procedureErrCode: (result.raw?.ProcedureTask as any)?.ErrCode || null,
              procedureMessage: (result.raw?.ProcedureTask as any)?.Message || null,
            }
          )}`
        );
        return { status: "processing" };
      }
      const ossUrl = this.isOssPublicUrl(result.videoUrl)
        ? result.videoUrl
        : await this.uploadRemoteVideoToOss(result.videoUrl, `${uploadKeyPrefix}-${taskId}`);
      return { status: "succeeded", videoUrl: ossUrl };
    }

    if (
      normalizedStatus === "failed" ||
      normalizedStatus === "fail" ||
      normalizedStatus === "error" ||
      normalizedStatus === "cancelled" ||
      normalizedStatus === "timeout" ||
      normalizedStatus === "exception"
    ) {
      const message =
        (result.raw?.ProcedureTask as any)?.Message ||
        (result.raw?.AigcVideoTask as any)?.Message ||
        "生成失败";
      return { status: "failed", error: message } as any;
    }

    return { status: "processing" };
  }

  /**
   * Seedance 1.5 Pro视频生成
   */
  private async generateDoubao(
    options: VideoProviderRequestDto,
    apiKey: string,
    modelVersion: SeedanceManagedModelVersion = "1.5-pro"
  ): Promise<VideoGenerationResult> {
    const normalizedPrompt =
      typeof options.prompt === "string" ? options.prompt.trim() : "";
    let promptText = normalizedPrompt;
    const params: string[] = [];
    const isSeedance2Model = modelVersion === "2.0" || modelVersion === "2.0-fast";

    if (options.aspectRatio) {
      params.push(`--ratio ${options.aspectRatio}`);
    }
    if (options.duration) {
      params.push(`--dur ${options.duration}`);
    }
    if (options.camerafixed !== undefined) {
      params.push(`--camerafixed ${options.camerafixed}`);
    }
    if (options.watermark !== undefined) {
      params.push(`--watermark ${options.watermark}`);
    }

    if (!isSeedance2Model && params.length > 0) {
      promptText = `${promptText} ${params.join(" ")}`;
    }

    const content: any[] = [];
    const referenceVideos = this.normalizeManagedV2ReferenceVideos(options);
    const referenceAudios = this.normalizeManagedV2ReferenceAudios(options);

    if (promptText) {
      content.push({ type: "text", text: promptText });
    }

    // 处理参考图片：如果是 base64，先上传到 OSS；volc asset 对象在 sd2 时使用 asset:// 协议
    const { uploadedStringUrls, objectItems } = await this.splitAndUploadReferenceImages(options.referenceImages);

    for (const imageUrl of uploadedStringUrls) {
      content.push({
        type: "image_url",
        image_url: { url: imageUrl },
        role: "reference_image",
      });
      this.logger.log(`📸 Seedance 参考图片已处理: ${imageUrl.substring(0, 100)}...`);
    }

    for (const item of objectItems) {
      let url: string;
      if (isSeedance2Model && item.volcAssetStatus === "active" && item.volcAssetId) {
        url = `asset://${item.volcAssetId}`;
      } else {
        url = item.url;
      }
      content.push({
        type: "image_url",
        image_url: { url },
        role: "reference_image",
      });
      this.logger.log(`📸 Seedance 参考图片 (asset/url): ${url.substring(0, 100)}`);
    }

    for (const videoUrl of referenceVideos) {
      content.push({
        type: "video_url",
        video_url: { url: videoUrl },
        role: "reference_video",
      });
    }

    for (const audioUrl of referenceAudios) {
      content.push({
        type: "audio_url",
        audio_url: { url: audioUrl },
        role: "reference_audio",
      });
    }

    if (!content.length) {
      throw new BadRequestException("Seedance 需要提供提示词或至少一种参考素材");
    }

    const modelId = resolveSeedanceUpstreamModelId(modelVersion);

    const payload: Record<string, any> = {
      model: modelId,
      content,
    };

    if (isSeedance2Model) {
      if (typeof options.generateAudio === "boolean") {
        payload.generate_audio = options.generateAudio;
      }
      if (typeof options.videoMode === "string" && options.videoMode.trim()) {
        payload.video_mode = options.videoMode.trim();
      }
      if (typeof options.aspectRatio === "string" && options.aspectRatio.trim()) {
        payload.ratio = options.aspectRatio.trim();
      }
      if (typeof options.duration === "number" && Number.isFinite(options.duration)) {
        payload.duration = options.duration;
      }
      if (typeof options.resolution === "string" && options.resolution.trim()) {
        payload.resolution = options.resolution.trim().toUpperCase();
      }
      if (typeof options.watermark === "boolean") {
        payload.watermark = options.watermark;
      }
    }

    this.logProviderPayload("doubao", payload);

    const response = await fetchWithTimeout(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        timeout: DEFAULT_FETCH_TIMEOUT,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error?.message || error.message || `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.id || data.platform_id,
      status: "queued",
    };
  }

  private async queryDoubao(taskId: string, apiKey: string) {
    try {
      const response = await fetchWithTimeout(
        `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: QUERY_FETCH_TIMEOUT,
        }
      );

      const data = await response.json();
      this.logger.log(
        `🔍 Seedance 1.5 Pro任务状态查询: taskId=${taskId}, status=${data.status}`
      );

      if (data.status === "succeeded") {
        const upstreamUrl: string | undefined = data.content?.video_url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Seedance 返回空视频链接");
        }
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, taskId);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.status === "failed") {
        this.logger.error(
          `❌ Seedance 1.5 Pro任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.error || data.reason || data
          )}`
        );
        return {
          status: "failed",
          error: data.error?.message || data.reason || "生成失败",
        };
      }

      return { status: data.status || "queued" };
    } catch (error) {
      this.logger.error(
        `❌ Seedance 1.5 Pro查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }`
      );
      throw error;
    }
  }

  /**
   * 可灵 Kling 视频生成
   */
  private async generateKling(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    let videoMode = options.videoMode;
    const imageCount = options.referenceImages?.length || 0;
    const hasPrompt = !!options.prompt;
    const KLING_DEFAULT_REFERENCE_PROMPT = "参考图片内容生成视频";

    if (!videoMode) {
      if (imageCount === 0) {
        videoMode = "text2video";
      } else if (imageCount === 1) {
        videoMode = "image2video";
      } else if (imageCount === 2) {
        videoMode = "image2video-tail";
      } else {
        videoMode = "multi-image2video";
      }
    }

    const endpointMap: Record<string, string> = {
      "image2video": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "image2video-tail": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "multi-image2video": "https://models.kapon.cloud/kling/v1/videos/multi-image2video",
      "text2video": "https://models.kapon.cloud/kling/v1/videos/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];

    const payload: any = {
      model_name: (options as any).klingModel || "kling-v2-6",
      mode: (options as any).mode || "std",
      duration: options.duration === 10 ? "10" : "5",
    };

    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    }

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频需要提供 prompt 参数");
      }
      payload.prompt = options.prompt;
    } else if (videoMode === "image2video") {
      const img0 = options.referenceImages![0];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
    } else if (videoMode === "image2video-tail") {
      const img0 = options.referenceImages![0];
      const img1 = options.referenceImages![1];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      payload.image_tail = await this.uploadBase64ImageToOSS(typeof img1 === "string" ? img1 : img1.url);
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    } else if (videoMode === "multi-image2video") {
      payload.model_name = "kling-v1-6";
      const imageUrls = await Promise.all(
        options.referenceImages!.slice(0, 4).map(img => this.uploadBase64ImageToOSS(typeof img === "string" ? img : img.url))
      );
      payload.image_list = imageUrls.map(url => ({ image: url }));
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    }

    this.logProviderPayload("kling", payload);
    this.logger.log(`🎬 Kling: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

    let response = await fetchWithTimeout(endpoint, {
      method: "POST",
      timeout: DEFAULT_FETCH_TIMEOUT,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let textBody = await response.text().catch(() => "");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));

      this.logger.error(
        `❌ Kling 生成失败: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
          0,
          1000
        )}, headers=${JSON.stringify(headers)}`
      );

      const shouldRetryWithModelFallback =
        this.isModelNotSupportedError(textBody) &&
        payload.model_name === "kling-v2-1";

      if (shouldRetryWithModelFallback) {
        try {
          const fallbackPayload = { ...payload, model_name: "kling-v2-6" };
          this.logger.warn(
            `Kling model kling-v2-1 is not supported upstream, retrying with kling-v2-6: mode=${videoMode}`
          );
          this.logProviderPayload("kling-retry-model-fallback", fallbackPayload);
          response = await fetchWithTimeout(endpoint, {
            method: "POST",
            timeout: DEFAULT_FETCH_TIMEOUT,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(fallbackPayload),
          });
          if (response.ok) {
            const data = await response.json();
            return {
              taskId: data.data?.task_id,
              status: "queued",
            };
          }
          textBody = await response.text().catch(() => "");
          this.logger.error(
            `Kling model fallback retry failed: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
              0,
              1000
            )}`
          );
        } catch (retryError) {
          this.logger.error(
            `Kling model fallback retry exception: ${
              retryError instanceof Error ? retryError.message : String(retryError)
            }`
          );
        }
      }

      const shouldRetryWithDataUrl =
        this.isUpstreamImageFetchFailure(textBody) &&
        (videoMode === "image2video" ||
          videoMode === "image2video-tail" ||
          videoMode === "multi-image2video");

      if (shouldRetryWithDataUrl) {
        try {
          const retryPayload = await this.convertKlingPayloadImagesToDataUrl(payload);
          this.logger.warn(
            `Kling upstream failed to fetch image URL, retrying with data-url payload: mode=${videoMode}`
          );
          this.logProviderPayload("kling-retry-dataurl", retryPayload);
          response = await fetchWithTimeout(endpoint, {
            method: "POST",
            timeout: DEFAULT_FETCH_TIMEOUT,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(retryPayload),
          });
          if (response.ok) {
            const data = await response.json();
            return {
              taskId: data.data?.task_id,
              status: "queued",
            };
          }
          textBody = await response.text().catch(() => "");
          this.logger.error(
            `Kling data-url retry failed: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
              0,
              1000
            )}`
          );
        } catch (retryError) {
          this.logger.error(
            `Kling data-url retry exception: ${
              retryError instanceof Error ? retryError.message : String(retryError)
            }`
          );
        }
      }

      let error: any = {};
      if (textBody) {
        try {
          error = JSON.parse(textBody);
        } catch {
          error = {};
        }
      }
      throw new Error(
        error.error?.message ||
          error.message ||
          textBody ||
          `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.data?.task_id,
      status: "queued",
    };
  }

  private async queryKling(taskId: string, apiKey: string) {
    try {
      // Kling 的查询路径在 Kapon 上区分不同模式
      // 依次尝试 text2video、image2video、multi-image2video 路径
      const endpoints = [
        `https://models.kapon.cloud/kling/v1/videos/text2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/image2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/multi-image2video/${taskId}`,
      ];

      let data: any = null;

      for (const endpoint of endpoints) {
        const response = await fetchWithTimeout(endpoint, {
          method: 'GET',
          timeout: QUERY_FETCH_TIMEOUT,
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const result = await response.json().catch(() => ({}));

        // 如果获取到有效数据，使用该结果
        if (result.data && result.code === 0) {
          data = result;
          break;
        }
      }

      if (!data || !data.data) {
        throw new Error("无法查询到任务状态");
      }

      this.logger.log(
        `🔍 Kling 任务状态查询: taskId=${taskId}, status=${data.data?.task_status}`
      );

      if (data.data?.task_status === "succeed") {
        const upstreamUrl: string | undefined = data.data.task_result?.videos?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Kling 返回空视频链接");
        }
        // 如果已经是 OSS URL，直接返回
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        // 上传到 OSS
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling-${taskId}`);
        this.logger.log(`📤 Kling 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.data?.task_status === "failed") {
        this.logger.error(
          `❌ Kling 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.data.task_result || data
          )}`
        );
        return {
          status: "failed",
          error: data.data?.task_status_msg || "生成失败",
        };
      }

      return { status: data.data?.task_status || "processing" };
    } catch (error) {
      this.logger.error(
        `❌ Kling 查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }`
      );
      throw error;
    }
  }

  /**
   * 可灵 Kling 2.6 视频生成 (使用 kling-v2-6 模型)
   */
  private async generateKling26(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    let videoMode = options.videoMode;
    const imageCount = options.referenceImages?.length || 0;
    const KLING_DEFAULT_REFERENCE_PROMPT = "参考图片内容生成视频";

    if (!videoMode) {
      if (imageCount === 0) {
        videoMode = "text2video";
      } else if (imageCount === 1) {
        videoMode = "image2video";
      } else if (imageCount === 2) {
        videoMode = "image2video-tail";
      } else {
        videoMode = "multi-image2video";
      }
    }

    const endpointMap: Record<string, string> = {
      "image2video": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "image2video-tail": "https://models.kapon.cloud/kling/v1/videos/image2video",
      "multi-image2video": "https://models.kapon.cloud/kling/v1/videos/multi-image2video",
      "text2video": "https://models.kapon.cloud/kling/v1/videos/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];

    const mode = (options as any).mode || "std";
    const normalizedSound =
      typeof options.sound === "string" ? options.sound.trim().toLowerCase() : "";
    const payload: any = {
      model_name: (options as any).klingModel || "kling-v2-6",
      mode: mode,
      duration: Number(options.duration) === 10 ? "10" : "5",
    };

    if (normalizedSound === "on") {
      payload.sound = "on";
    } else if (normalizedSound === "off") {
      payload.sound = "off";
    } else if (mode === "pro") {
      payload.sound = "on";
    }
    if (typeof payload.sound === "string") {
      this.logger.log(`🎵 Kling 2.6 音频参数: sound=${payload.sound}`);
    }

    this.logger.log(`🎬 Kling 2.6 参数: duration=${options.duration}, 转换后=${Number(options.duration) === 10 ? "10" : "5"}`);

    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    }

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频需要提供 prompt 参数");
      }
      payload.prompt = options.prompt;
    } else if (videoMode === "image2video") {
      const img0 = options.referenceImages![0];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      if (options.prompt) {
        payload.prompt = options.prompt;
      }
    } else if (videoMode === "image2video-tail") {
      const img0 = options.referenceImages![0];
      const img1 = options.referenceImages![1];
      payload.image = await this.uploadBase64ImageToOSS(typeof img0 === "string" ? img0 : img0.url);
      payload.image_tail = await this.uploadBase64ImageToOSS(typeof img1 === "string" ? img1 : img1.url);
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
      // 首尾帧模式不支持音效，且 kling-v2-6/std 不支持 image_tail，必须用 pro
      payload.mode = "pro";
      payload.sound = "off";
    } else if (videoMode === "multi-image2video") {
      const imageUrls = await Promise.all(
        options.referenceImages!.slice(0, 4).map(img => this.uploadBase64ImageToOSS(typeof img === "string" ? img : img.url))
      );
      payload.image_list = imageUrls.map(url => ({ image: url }));
      payload.prompt = options.prompt || KLING_DEFAULT_REFERENCE_PROMPT;
    }

    this.logProviderPayload("kling-2.6", payload);
    this.logger.log(`🎬 Kling 2.6: mode=${videoMode}, images=${imageCount}, endpoint=${endpoint}`);

    let response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeout: DEFAULT_FETCH_TIMEOUT,
    });

    if (!response.ok) {
      let textBody = await response.text().catch(() => "");
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));

      this.logger.error(
        `❌ Kling 2.6 生成失败: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
          0,
          1000
        )}, headers=${JSON.stringify(headers)}`
      );

      const shouldRetryWithDataUrl =
        this.isUpstreamImageFetchFailure(textBody) &&
        (videoMode === "image2video" ||
          videoMode === "image2video-tail" ||
          videoMode === "multi-image2video");

      if (shouldRetryWithDataUrl) {
        try {
          const retryPayload = await this.convertKlingPayloadImagesToDataUrl(payload);
          this.logger.warn(
            `Kling 2.6 upstream failed to fetch image URL, retrying with data-url payload: mode=${videoMode}`
          );
          this.logProviderPayload("kling-2.6-retry-dataurl", retryPayload);
          response = await fetchWithTimeout(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(retryPayload),
            timeout: DEFAULT_FETCH_TIMEOUT,
          });
          if (response.ok) {
            const data = await response.json();
            return {
              taskId: data.data?.task_id,
              status: "queued",
            };
          }
          textBody = await response.text().catch(() => "");
          this.logger.error(
            `Kling 2.6 data-url retry failed: HTTP ${response.status}, mode=${videoMode}, response_text=${textBody.slice(
              0,
              1000
            )}`
          );
        } catch (retryError) {
          this.logger.error(
            `Kling 2.6 data-url retry exception: ${
              retryError instanceof Error ? retryError.message : String(retryError)
            }`
          );
        }
      }

      let error: any = {};
      if (textBody) {
        try {
          error = JSON.parse(textBody);
        } catch {
          error = {};
        }
      }
      throw new Error(
        error.error?.message ||
          error.message ||
          textBody ||
          `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.data?.task_id,
      status: "queued",
    };
  }

  private async queryKling26(taskId: string, apiKey: string) {
    try {
      const endpoints = [
        `https://models.kapon.cloud/kling/v1/videos/text2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/image2video/${taskId}`,
        `https://models.kapon.cloud/kling/v1/videos/multi-image2video/${taskId}`,
      ];

      let data: any = null;

      for (const endpoint of endpoints) {
        const response = await fetchWithTimeout(endpoint, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: QUERY_FETCH_TIMEOUT,
        });
        const result = await response.json().catch(() => ({}));

        if (result.data && result.code === 0) {
          data = result;
          break;
        }
      }

      if (!data || !data.data) {
        throw new Error("无法查询到任务状态");
      }

      this.logger.log(
        `🔍 Kling 2.6 任务状态查询: taskId=${taskId}, status=${data.data?.task_status}`
      );

      if (data.data?.task_status === "succeed") {
        const upstreamUrl: string | undefined = data.data.task_result?.videos?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Kling 2.6 返回空视频链接");
        }

        // 处理缩略图
        let thumbnailUrl: string | undefined;
        const upstreamThumbnail = data.data.task_result?.videos?.[0]?.cover_image_url;
        if (upstreamThumbnail) {
          if (this.isOssPublicUrl(upstreamThumbnail)) {
            thumbnailUrl = upstreamThumbnail;
          } else {
            try {
              thumbnailUrl = await this.uploadRemoteVideoToOss(upstreamThumbnail, `kling26-thumb-${taskId}`);
              this.logger.log(`📤 Kling 2.6 缩略图已上传到 OSS: ${thumbnailUrl}`);
            } catch (error) {
              this.logger.warn(`⚠️ Kling 2.6 缩略图上传失败: ${error}`);
            }
          }
        }

        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl, thumbnailUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling26-${taskId}`);
        this.logger.log(`📤 Kling 2.6 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl, thumbnailUrl };
      }

      if (data.data?.task_status === "failed") {
        this.logger.error(
          `❌ Kling 2.6 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.data.task_result || data
          )}`
        );
        return {
          status: "failed",
          error: data.data?.task_status_msg || "生成失败",
        };
      }

      return { status: data.data?.task_status || "processing" };
    } catch (error) {
      // 超时或网络错误时，不抛异常，返回 processing 状态让前端继续轮询
      const isTimeout = error instanceof Error && error.message.includes('超时');
      this.logger.warn(
        `⚠️ Kling 2.6 查询${isTimeout ? '超时' : '异常'}: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }，将继续轮询`
      );
      // 返回 processing 状态，让前端继续轮询而不是报错
      return { status: "processing" };
    }
  }

  /**
   * Vidu 视频生成
   */
  private async generateVidu(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    const preparedReferenceImages = await this.prepareViduReferenceImages(
      options.referenceImages
    );

    // 确定视频生成模式（智能判断）
    let videoMode = options.videoMode;
    const imageCount = preparedReferenceImages.length;
    const hasPrompt = !!options.prompt;

    // 如果没有指定模式，根据图片数量和是否有prompt智能判断
    if (!videoMode) {
      if (imageCount === 0) {
        // 0张图：文生视频
        videoMode = "text2video";
      } else if (imageCount === 1) {
        // 1张图：有prompt用参考生视频，无prompt用图生视频
        videoMode = hasPrompt ? "reference2video" : "img2video";
      } else if (imageCount === 2) {
        // 2张图：有prompt用参考生视频，无prompt用首尾帧
        videoMode = hasPrompt ? "reference2video" : "start-end2video";
      } else {
        // 3+张图：参考生视频
        videoMode = "reference2video";
      }
    }

    const endpointMap: Record<string, string> = {
      "img2video": "https://models.kapon.cloud/vidu/ent/v2/img2video",
      "start-end2video": "https://models.kapon.cloud/vidu/ent/v2/start-end2video",
      "reference2video": "https://models.kapon.cloud/vidu/ent/v2/reference2video",
      "text2video": "https://models.kapon.cloud/vidu/ent/v2/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];
    const payload: any = {};

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq2";
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.style = options.style || "general";
      payload.off_peak = options.offPeak || false;
    } else if (videoMode === "img2video") {
      payload.model = "viduq2";
      payload.images = [preparedReferenceImages[0]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
      payload.off_peak = options.offPeak || false;
    } else if (videoMode === "start-end2video") {
      payload.model = "viduq2";
      payload.images = [preparedReferenceImages[0], preparedReferenceImages[1]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "reference2video") {
      if (!options.prompt) {
        throw new Error("参考生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq2";
      payload.images = preparedReferenceImages.slice(0, 7);
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
    }

    payload.aspect_ratio = options.aspectRatio || "16:9";

    this.logProviderPayload("vidu", payload);
    this.logger.log(
      `🎬 Vidu: mode=${videoMode}, images=${imageCount}, hosts=${this.summarizeImageHosts(
        preparedReferenceImages
      )}, endpoint=${endpoint}`
    );

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      timeout: DEFAULT_FETCH_TIMEOUT,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      this.logger.error(
        `❌ Vidu 生成失败: HTTP ${response.status}, error=${JSON.stringify(
          error
        )}`
      );
      throw new Error(
        error.error?.message || error.message || `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.task_id || data.id,
      status: "queued",
    };
  }

  private async queryVidu(taskId: string, apiKey: string) {
    try {
      const response = await fetchWithTimeout(
        `https://models.kapon.cloud/vidu/ent/v2/tasks/${taskId}/creations`,
        {
          method: 'GET',
          timeout: QUERY_FETCH_TIMEOUT,
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const data = await response.json();

      this.logger.log(
        `🔍 Vidu 任务状态查询: taskId=${taskId}, state=${data.state}`
      );

      if (data.state === "success") {
        const upstreamUrl: string | undefined = data.creations?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Vidu 返回空视频链接");
        }
        // 如果已经是 OSS URL，直接返回
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        // 上传到 OSS
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `vidu-${taskId}`);
        this.logger.log(`📤 Vidu 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.state === "failed") {
        this.logger.error(
          `❌ Vidu 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.error || data
          )}`
        );
        return {
          status: "failed",
          error: data.error?.message || "生成失败",
        };
      }

      return { status: data.state || "processing" };
    } catch (error) {
      this.logger.error(
        `❌ Vidu 查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }`
      );
      throw error;
    }
  }

  /**
   * 可灵 Kling O1 (Omni Video) 视频生成
   * 支持：文生视频、图片参考、首尾帧、视频编辑
   */
  private async generateKlingO1(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    const endpoint = "https://models.kapon.cloud/kling/v1/videos/omni-video";
    const imageCount = options.referenceImages?.length || 0;
    const hasVideo =
      typeof options.referenceVideo === "string" &&
      options.referenceVideo.trim().length > 0;
    const normalizedReferenceVideo = hasVideo
      ? this.normalizeManagedAssetUrlForUpstream(options.referenceVideo!)
      : undefined;

    const payload: any = {
      model_name: "kling-v3-omni",
      mode: options.mode || "std",
    };

    const normalizedSound =
      typeof options.sound === "string" ? options.sound.trim().toLowerCase() : "";
    if (normalizedSound === "on") {
      payload.sound = "on";
    } else if (normalizedSound === "off") {
      payload.sound = "off";
    } else if ((options.mode || "std") === "pro") {
      payload.sound = "on";
    }

    // 处理 prompt（Kling O1 要求 prompt 必填）
    if (options.prompt) {
      payload.prompt = options.prompt;
    } else if (imageCount > 0) {
      // 有图片但没有 prompt，使用默认描述
      payload.prompt = "根据参考图片生成视频";
    } else {
      // 既没有图片也没有 prompt，使用通用默认值
      payload.prompt = "生成视频";
    }

    // 处理时长 (3-10秒)
    if (options.duration) {
      const dur = Math.max(3, Math.min(10, options.duration));
      payload.duration = String(dur);
    } else {
      payload.duration = "5";
    }

    // 处理画面比例
    // Kling O1 要求：没有首帧图片且不是视频编辑模式时必须指定 aspect_ratio
    const isVideoEdit = hasVideo && options.referenceVideoType === "base";
    const hasFirstFrame = imageCount > 0 && !hasVideo; // 只有无视频时才会设置首帧

    if (options.aspectRatio) {
      payload.aspect_ratio = options.aspectRatio;
    } else if (!hasFirstFrame && !isVideoEdit) {
      // 没有首帧且不是视频编辑模式，默认 16:9
      payload.aspect_ratio = "16:9";
    }

    // 处理图片列表
    if (imageCount > 0) {
      const imageList: any[] = [];
      for (let i = 0; i < Math.min(imageCount, 7); i++) {
        const imgRaw = options.referenceImages![i];
        const imgUrl = await this.uploadBase64ImageToOSS(typeof imgRaw === "string" ? imgRaw : imgRaw.url);
        const imgItem: any = { image_url: imgUrl };
        // 只有在无视频输入时，才可以设置首尾帧
        if (!hasVideo) {
          if (i === 0 && imageCount >= 1) {
            imgItem.type = "first_frame";
          } else if (i === 1 && imageCount === 2) {
            imgItem.type = "end_frame";
          }
        }
        imageList.push(imgItem);
      }
      payload.image_list = imageList;
    }

    // 处理参考视频
    if (hasVideo) {
      payload.video_list = [{
        video_url: normalizedReferenceVideo,
        refer_type: options.referenceVideoType || "feature",
        keep_original_sound: options.keepOriginalSound || "no",
      }];
    }

    this.logProviderPayload("kling-o3", payload);
    this.logger.log(`🎬 Kling O1: images=${imageCount}, hasVideo=${hasVideo}, endpoint=${endpoint}`);

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeout: DEFAULT_FETCH_TIMEOUT,
    });

    if (!response.ok) {
      const textBody = await response.text().catch(() => "");
      this.logger.error(
        `❌ Kling O1 生成失败: HTTP ${response.status}, response_text=${textBody.slice(0, 1000)}`
      );
      let error: any = {};
      if (textBody) {
        try {
          error = JSON.parse(textBody);
        } catch {}
      }
      throw new Error(
        error.error?.message || error.message || textBody || `HTTP ${response.status}`
      );
    }

    const data = await response.json();
    return {
      taskId: data.data?.task_id,
      status: "queued",
    };
  }

  private async queryKlingO1(taskId: string, apiKey: string) {
    try {
      const endpoint = `https://models.kapon.cloud/kling/v1/videos/omni-video/${taskId}`;
      const response = await fetchWithTimeout(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: QUERY_FETCH_TIMEOUT,
      });
      const data = await response.json();

      this.logger.log(
        `🔍 Kling O1 任务状态查询: taskId=${taskId}, status=${data.data?.task_status}`
      );

      if (data.data?.task_status === "succeed") {
        const upstreamUrl: string | undefined = data.data.task_result?.videos?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Kling O1 返回空视频链接");
        }
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `kling-o3-${taskId}`);
        this.logger.log(`📤 Kling O1 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.data?.task_status === "failed") {
        this.logger.error(
          `❌ Kling O1 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.data.task_result || data
          )}`
        );
        return {
          status: "failed",
          error: data.data?.task_status_msg || "生成失败",
        };
      }

      return { status: data.data?.task_status || "processing" };
    } catch (error) {
      // 超时或网络错误时，不抛异常，返回 processing 状态让前端继续轮询
      const isTimeout = error instanceof Error && error.message.includes('超时');
      this.logger.warn(
        `⚠️ Kling O1 查询${isTimeout ? '超时' : '异常'}: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }，将继续轮询`
      );
      // 返回 processing 状态，让前端继续轮询而不是报错
      return { status: "processing" };
    }
  }

  /**
   * Vidu Q3 Pro 视频生成
   */
  private async generateViduQ3Pro(
    options: VideoProviderRequestDto,
    apiKey: string
  ): Promise<VideoGenerationResult> {
    const preparedReferenceImages = await this.prepareViduReferenceImages(
      options.referenceImages
    );

    // 确定视频生成模式
    let videoMode = options.videoMode;
    const imageCount = preparedReferenceImages.length;
    const hasPrompt = !!options.prompt;

    // 智能判断模式
    if (!videoMode) {
      if (imageCount === 0) {
        videoMode = "text2video";
      } else if (imageCount === 1) {
        videoMode = hasPrompt ? "reference2video" : "img2video";
      } else if (imageCount === 2) {
        videoMode = hasPrompt ? "reference2video" : "start-end2video";
      } else if (imageCount === 3) {
        videoMode = "start-mid-end2video";
      } else {
        throw new Error("viduq3-pro 最多支持3张图片");
      }
    }

    const endpointMap: Record<string, string> = {
      "img2video": "https://models.kapon.cloud/vidu/ent/v2/img2video",
      "start-end2video": "https://models.kapon.cloud/vidu/ent/v2/start-end2video",
      "start-mid-end2video": "https://models.kapon.cloud/vidu/ent/v2/start-mid-end2video",
      "reference2video": "https://models.kapon.cloud/vidu/ent/v2/reference2video",
      "text2video": "https://models.kapon.cloud/vidu/ent/v2/text2video",
    };
    const endpoint = endpointMap[videoMode] || endpointMap["text2video"];
    const payload: any = {};

    if (videoMode === "text2video") {
      if (!options.prompt) {
        throw new Error("文生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq3-pro";
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.style = options.style || "general";
    } else if (videoMode === "img2video") {
      payload.model = "viduq3-pro";
      payload.images = [preparedReferenceImages[0]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "start-end2video") {
      payload.model = "viduq3-pro";
      payload.images = [preparedReferenceImages[0], preparedReferenceImages[1]];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "start-mid-end2video") {
      payload.model = "viduq3-pro";
      payload.images = [
        preparedReferenceImages[0],
        preparedReferenceImages[1],
        preparedReferenceImages[2],
      ];
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
      payload.aspect_ratio = options.aspectRatio || "16:9";
    } else if (videoMode === "reference2video") {
      if (!options.prompt) {
        throw new Error("参考生视频模式需要提供 prompt 参数");
      }
      payload.model = "viduq3-pro";
      payload.images = preparedReferenceImages.slice(0, 7);
      payload.prompt = options.prompt;
      payload.duration = options.duration || 5;
      payload.resolution = options.resolution || "720p";
    }

    payload.aspect_ratio = options.aspectRatio || "16:9";

    this.logProviderPayload("viduq3-pro", payload);
    this.logger.log(
      `🎬 Vidu Q3 Pro: mode=${videoMode}, images=${imageCount}, hosts=${this.summarizeImageHosts(
        preparedReferenceImages
      )}, endpoint=${endpoint}`
    );

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      timeout: DEFAULT_FETCH_TIMEOUT,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Vidu Q3 Pro API 错误: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    this.logger.log(`✅ Vidu Q3 Pro 任务创建成功: taskId=${data.id}`);

    return {
      taskId: data.id,
      status: "queued",
    };
  }

  /**
   * Vidu Q3 Pro 任务查询
   */
  private async queryViduQ3Pro(taskId: string, apiKey: string) {
    try {
      const response = await fetchWithTimeout(
        `https://models.kapon.cloud/vidu/ent/v2/tasks/${taskId}/creations`,
        {
          method: 'GET',
          timeout: QUERY_FETCH_TIMEOUT,
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const data = await response.json();

      this.logger.log(
        `🔍 Vidu Q3 Pro 任务状态查询: taskId=${taskId}, state=${data.state}`
      );

      if (data.state === "success") {
        const upstreamUrl: string | undefined = data.creations?.[0]?.url;
        if (!upstreamUrl) {
          throw new ServiceUnavailableException("Vidu Q3 Pro 返回空视频链接");
        }
        if (this.isOssPublicUrl(upstreamUrl)) {
          return { status: "succeeded", videoUrl: upstreamUrl };
        }
        const ossUrl = await this.uploadRemoteVideoToOss(upstreamUrl, `viduq3-pro-${taskId}`);
        this.logger.log(`📤 Vidu Q3 Pro 视频已上传到 OSS: ${ossUrl}`);
        return { status: "succeeded", videoUrl: ossUrl };
      }

      if (data.state === "failed") {
        this.logger.error(
          `❌ Vidu Q3 Pro 任务失败: taskId=${taskId}, error=${JSON.stringify(
            data.error || data
          )}`
        );
        return {
          status: "failed",
          error: data.error?.message || "生成失败",
        };
      }

      return { status: data.state === "processing" ? "processing" : "queued" };
    } catch (error) {
      this.logger.warn(
        `⚠️ Vidu Q3 Pro 查询异常: taskId=${taskId}, error=${
          error instanceof Error ? error.message : error
        }，将继续轮询`
      );
      return { status: "processing" };
    }
  }
}
