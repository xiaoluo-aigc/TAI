import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ModelRoutingService } from "./model-routing.service";
import { TencentVodAigcService } from "./tencent-vod-aigc.service";

type VideoQuality = "hd" | "sd";
type Sora2GenerationModel = "sora-2" | "sora-2-vip" | "sora-2-pro";

// ==================== 旧API (普通Sora2) 配置 ====================
const SORA2_VIDEO_MODELS: Record<VideoQuality, string> = {
  hd: process.env.SORA2_HD_MODEL || "sora-2-pro-reverse",
  sd: process.env.SORA2_SD_MODEL || "sora-2-reverse",
};

const SORA2_FAILED_STATUSES = ["failed", "error", "blocked", "terminated"];
const SORA2_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv"];
const SORA2_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const SORA2_ASYNC_HOST_HINTS = ["asyncdata.", "asyncndata."];
const SORA2_MAX_FOLLOW_DEPTH = 2;
const SORA2_FETCH_TIMEOUT_MS = 120000;
const SORA2_MAX_RETRY = 3;
const SORA2_RETRY_BASE_DELAY_MS = 1200;
const SORA2_POLL_INTERVAL_MS = 5000;
const SORA2_POLL_MAX_ATTEMPTS = 120;
const SORA2_POLL_STATUSES = ["queued", "processing", "downloading", "pending"];
const SORA2_TENCENT_TASK_PREFIX = "tencentvod-sora2-";

// ==================== APIMart Sora2 Pro 配置 ====================
const SORA2_APIMART_POLL_INTERVAL_MS = 5000;
const SORA2_APIMART_POLL_MAX_ATTEMPTS = 180;
const SORA2_APIMART_FETCH_TIMEOUT_MS = 30000;
const SORA2_APIMART_MAX_CONSECUTIVE_TIMEOUTS = 30;
const SORA2_APIMART_FAILED_STATUSES = [
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
  "terminated",
  "rejected",
  "blocked",
];
const SORA2_APIMART_ALLOWED_STYLES = new Set([
  "thanksgiving",
  "comic",
  "news",
  "selfie",
  "nostalgic",
  "anime",
]);

// ==================== 新API (Sora2 Pro - newapi.megabyai.cc) 配置 ====================
// 使用 OpenAI 兼容接口 /v1/videos
const SORA2_V2_POLL_INTERVAL_MS = 5000;
const SORA2_V2_POLL_MAX_ATTEMPTS = 180; // 增加到180次，约15分钟
const SORA2_V2_FAILED_STATUSES = ["failed", "error", "cancelled", "FAILURE"];
const SORA2_V2_FETCH_TIMEOUT_MS = 180000; // 增加到3分钟

// Sora2 Pro 模型选择（根据质量和是否图生视频）
const getSora2ProModel = (quality: "standard" | "hd", isImageToVideo: boolean): string => {
  // 根据文档，模型名称为:
  // - sora-2-text-to-video (标准文生视频)
  // - sora-2-pro-text-to-video (Pro文生视频)
  // - sora-2-image-to-video (标准图生视频)
  // - sora-2-pro-image-to-video (Pro图生视频)

  // hd 质量使用 pro 模型，sd 质量使用标准模型
  if (quality === "hd") {
    return isImageToVideo ? "sora-2-pro-image-to-video" : "sora-2-pro-text-to-video";
  }
  return isImageToVideo ? "sora-2-image-to-video" : "sora-2-text-to-video";
};

interface Sora2ResolvedMedia {
  videoUrl?: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  taskInfo?: Record<string, any> | null;
  taskId?: string;
  status?: string;
  errorMessage?: string;
}

interface GenerateVideoOptions {
  prompt: string;
  referenceImageUrls?: string[];
  quality?: VideoQuality;
  /** APIMart 模型 */
  model?: Sora2GenerationModel;
  /** 画面比例，仅极速 Sora2 支持，例如 '16:9' | '9:16' */
  aspectRatio?: "16:9" | "9:16";
  /** 时长（秒），仅极速 Sora2 支持，例如 '10' | '15' | '25' */
  duration?: "10" | "15" | "25";
  /** APIMart 可选高级参数 */
  watermark?: boolean;
  thumbnail?: boolean;
  privateMode?: boolean;
  style?: string;
  storyboard?: boolean;
  characterUrl?: string;
  characterTimestamps?: string;
  characterTaskId?: string;
}

interface CreateCharacterTaskOptions {
  model?: "sora-2" | "sora-2-pro";
  timestamps: string;
  url?: string;
  fromTask?: string;
}

export interface Sora2VideoTaskQueryResult {
  id: string;
  status: string;
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  raw?: Record<string, any>;
}

type Sora2CharacterInfo = {
  id?: string;
  display_name?: string;
  profile_picture_url?: string;
  username?: string;
};

interface Sora2CharacterTaskResult {
  id?: string;
  status?: string;
  progress?: number;
  result?: {
    characters?: Sora2CharacterInfo[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface Sora2VideoResult {
  videoUrl: string;
  content: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  status?: string;
  taskId?: string;
  taskInfo?: Record<string, any> | null;
  videoUrlWatermarked?: string;
  videoUrlRaw?: string;
  watermarkSkipped?: boolean;
  watermarkFailed?: boolean;
  /** 备选方案提示信息 */
  fallbackMessage?: string;
}

@Injectable()
export class Sora2VideoService {
  private readonly logger = new Logger(Sora2VideoService.name);
  // 旧API (普通Sora2)
  private readonly apiBase =
    process.env.SORA2_API_ENDPOINT || "https://api1.147ai.com";
  private readonly apiKey = process.env.SORA2_API_KEY;
  // 新API (Sora2 Pro - newapi.megabyai.cc)
  private readonly apiBaseV2 = "https://newapi.megabyai.cc";
  private readonly apiKeyV2 = process.env.NEW_API_KEY;
  // APIMart API（支持完整 Sora2 Pro 参数与角色管理）
  private readonly apiBaseApimart =
    process.env.SORA2_APIMART_API_ENDPOINT || "https://api.apimart.ai";
  private readonly apiKeyApimart =
    process.env.SORA2_APIMART_API_KEY ||
    process.env.APIMART_API_KEY ||
    process.env.NANO2_API_KEY;

  constructor(
    private readonly modelRoutingService: ModelRoutingService,
    private readonly tencentVodAigcService: TencentVodAigcService,
  ) {}

  /**
   * 主入口方法：优先遵循模型管理路由，其余 legacy 路径走默认自动回退策略
   */
  async generateVideo(
    options: GenerateVideoOptions
  ): Promise<Sora2VideoResult> {
    const managedRoute = await this.modelRoutingService.resolveVideoModel("sora-2");
    if (managedRoute?.route === "tencent_vod") {
      this.logger.log("使用腾讯 VOD Sora2 路由");
      return this.generateVideoTencentVod(options, managedRoute.vendor);
    }

    const managedVendorKey = managedRoute?.vendor?.vendorKey || "default";
    const managedPlatformKey =
      managedRoute?.vendor?.platformKey || managedRoute?.vendor?.vendorKey || "default";
    this.logger.log(
      `当前 Sora2 路由: ${managedPlatformKey}/${managedVendorKey} -> auto_fallback`
    );
    const wantsApimart = this.hasApimartOnlyOptions(options);

    // 默认自动模式：如启用 Pro 参数，优先 APIMart
    if (this.apiKeyApimart && wantsApimart) {
      try {
        this.logger.log("尝试使用 APIMart Sora2 API...");
        return await this.generateVideoApimart(options);
      } catch (error) {
        this.logger.warn(
          `APIMart Sora2 API失败，准备切换: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    // 默认自动模式：其次 Sora2 Pro，失败后回退到普通 Sora2
    if (this.apiKeyV2) {
      try {
        this.logger.log("尝试使用Sora2 Pro API...");
        return await this.generateVideoV2(options);
      } catch (error) {
        this.logger.warn(
          `Sora2 Pro API失败，切换到普通Sora2: ${
            error instanceof Error ? error.message : error
          }`
        );
        // 继续使用备选方案
      }
    } else {
      this.logger.log("Sora2 Pro API Key未配置，使用普通Sora2");
    }

    // 备选：普通Sora2 (旧API)
    if (!this.apiKey) {
      throw new ServiceUnavailableException("Sora2 API Key 未配置");
    }

    const result = await this.generateVideoLegacy(options);
    // 如果是从Sora2 Pro回退的，添加提示信息
    if (this.apiKeyV2) {
      result.fallbackMessage = "Sora2 Pro过于繁忙，已为您切换到普通Sora2";
    }
    return result;
  }

  async createCharacterTask(options: CreateCharacterTaskOptions) {
    if (!this.apiKeyApimart) {
      throw new ServiceUnavailableException("APIMart Sora2 API Key 未配置");
    }
    if (!options.url && !options.fromTask) {
      throw new BadRequestException("参数 url 和 fromTask 需二选一");
    }

    const payload: Record<string, any> = {
      model: options.model || "sora-2",
      timestamps: options.timestamps,
    };
    if (options.url) payload.url = options.url;
    if (options.fromTask) payload.from_task = options.fromTask;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SORA2_FETCH_TIMEOUT_MS);
    const response = await fetch(`${this.apiBaseApimart}/v1/videos/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKeyApimart}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`创建角色失败: ${message}`);
    }

    const taskId =
      data?.data?.[0]?.task_id ||
      data?.data?.task_id ||
      data?.task_id ||
      data?.id;
    if (!taskId) {
      throw new ServiceUnavailableException("创建角色失败：未返回任务ID");
    }

    return {
      success: true,
      taskId,
      status: data?.data?.[0]?.status || data?.status || "submitted",
      raw: data,
    };
  }

  async queryCharacterTask(taskId: string) {
    if (!this.apiKeyApimart) {
      throw new ServiceUnavailableException("APIMart Sora2 API Key 未配置");
    }
    const queryController = new AbortController();
    const queryTimer = setTimeout(() => queryController.abort(), SORA2_APIMART_FETCH_TIMEOUT_MS);
    const response = await fetch(
      `${this.apiBaseApimart}/v1/characters_tasks/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKeyApimart}`,
        },
        signal: queryController.signal,
      }
    );
    clearTimeout(queryTimer);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`查询角色失败: ${message}`);
    }

    const payload: Sora2CharacterTaskResult = data?.data || data || {};
    const chars = Array.isArray(payload?.result?.characters)
      ? payload.result?.characters
      : [];

    return {
      id: payload?.id || taskId,
      status: payload?.status || "unknown",
      progress: typeof payload?.progress === "number" ? payload.progress : undefined,
      characters: chars.map((item) => ({
        id: item?.id,
        displayName: item?.display_name,
        username: item?.username,
        profilePictureUrl: item?.profile_picture_url,
      })),
      raw: data,
    };
  }

  async queryVideoTask(taskId: string): Promise<Sora2VideoTaskQueryResult> {
    if (taskId?.startsWith(SORA2_TENCENT_TASK_PREFIX)) {
      return this.queryTencentVideoTask(taskId);
    }

    if (!this.apiKeyApimart) {
      throw new ServiceUnavailableException("APIMart Sora2 API Key 未配置");
    }
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException("taskId 不能为空");
    }

    const pollController = new AbortController();
    const pollTimer = setTimeout(() => pollController.abort(), SORA2_APIMART_FETCH_TIMEOUT_MS);
    const response = await fetch(
      `${this.apiBaseApimart}/v1/tasks/${encodeURIComponent(taskId.trim())}?language=zh&t=${Date.now()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKeyApimart}`,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: pollController.signal,
      }
    );
    clearTimeout(pollTimer);

    const dataRaw = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        dataRaw?.error?.message || dataRaw?.message || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`查询视频任务失败: ${message}`);
    }

    const data = this.normalizeApimartTaskPayload(dataRaw, taskId.trim());
    const statusRaw = String(data?.status || "unknown");
    const progress =
      typeof data?.progress === "number" ? data.progress : undefined;
    const { videoUrl, thumbnailUrl } = this.extractApimartMedia(data);

    return {
      id: String(data?.id || data?.task_id || data?.taskId || taskId.trim()),
      status: statusRaw,
      progress,
      videoUrl,
      thumbnailUrl,
      raw: dataRaw,
    };
  }

  private async generateVideoTencentVod(
    options: GenerateVideoOptions,
    vendorConfig: { modelName?: string; modelVersion?: string },
  ): Promise<Sora2VideoResult> {
    const normalizedPrompt =
      typeof options.prompt === "string" && options.prompt.trim()
        ? options.prompt.trim()
        : "";
    const referenceImageUrls = (options.referenceImageUrls || [])
      .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      .map((url) => url.trim());

    if (!normalizedPrompt && referenceImageUrls.length === 0) {
      throw new BadRequestException("Sora 2 需要提供提示词或至少 1 张参考图");
    }

    const durationRaw = options.duration ? Number(options.duration) : undefined;
    const duration =
      typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.round(durationRaw)
        : undefined;

    const { taskId } = await this.tencentVodAigcService.createVideoTask({
      modelName: vendorConfig.modelName || "OS",
      modelVersion: vendorConfig.modelVersion || "2.0",
      prompt: normalizedPrompt || undefined,
      fileInfos: referenceImageUrls.map((url, index) => ({
        type: "Url",
        category: "Image",
        url,
        objectId: `id${index + 1}`,
      })),
      aspectRatio: options.aspectRatio,
      duration,
      resolution: "720P",
      audioGeneration: "Enabled",
      enhancePrompt: "Enabled",
      storageMode: "Temporary",
    });

    const completed = await this.waitForTencentVideoResult(taskId);
    if (!completed.videoUrl) {
      throw new ServiceUnavailableException("腾讯 VOD Sora2 未返回有效视频地址");
    }

    return {
      videoUrl: completed.videoUrl,
      content: `视频已生成（腾讯 VOD Sora2，任务ID: ${taskId}）`,
      referencedUrls: [completed.videoUrl],
      status: completed.status,
      taskId: `${SORA2_TENCENT_TASK_PREFIX}${taskId}`,
      taskInfo: completed.raw || null,
    };
  }

  private async waitForTencentVideoResult(taskId: string): Promise<{
    status: string;
    videoUrl?: string;
    raw?: Record<string, any>;
  }> {
    let lastStatus = "processing";
    let lastRaw: Record<string, any> | undefined;

    await this.delay(5000);
    for (let attempt = 1; attempt <= 120; attempt++) {
      const result = await this.tencentVodAigcService.queryVideoTask(taskId);
      lastStatus = String(result.status || "processing");
      lastRaw = result.raw;
      const normalized = this.normalizeTencentStatus(lastStatus);

      if (normalized === "success") {
        if (result.videoUrl) {
          return {
            status: lastStatus,
            videoUrl: result.videoUrl,
            raw: result.raw,
          };
        }
      }

      if (normalized === "failed") {
        throw new ServiceUnavailableException(
          `腾讯 VOD Sora2 任务失败: ${lastStatus}`
        );
      }

      await this.delay(3000);
    }

    throw new ServiceUnavailableException(
      `腾讯 VOD Sora2 轮询超时，最后状态: ${lastStatus}`
    );
  }

  private async queryTencentVideoTask(taskId: string): Promise<Sora2VideoTaskQueryResult> {
    const rawTaskId = taskId.slice(SORA2_TENCENT_TASK_PREFIX.length).trim();
    if (!rawTaskId) {
      throw new BadRequestException("taskId 不能为空");
    }

    const result = await this.tencentVodAigcService.queryVideoTask(rawTaskId);
    const normalized = this.normalizeTencentStatus(result.status);
    if (normalized === "success" && result.videoUrl) {
      return {
        id: taskId,
        status: "completed",
        progress: 100,
        videoUrl: result.videoUrl,
        raw: result.raw,
      };
    }

    if (normalized === "failed") {
      return {
        id: taskId,
        status: "failed",
        raw: result.raw,
      };
    }

    return {
      id: taskId,
      status: "processing",
      progress: 50,
      raw: result.raw,
    };
  }

  private normalizeTencentStatus(status?: string): "processing" | "success" | "failed" {
    const value = String(status || "").trim().toLowerCase();
    if (
      [
        "finish",
        "finished",
        "success",
        "succeed",
        "succeeded",
        "completed",
        "complete",
        "done",
      ].includes(value)
    ) {
      return "success";
    }

    if (["failed", "fail", "error", "cancelled", "timeout", "exception"].includes(value)) {
      return "failed";
    }

    return "processing";
  }

  private hasApimartOnlyOptions(options: GenerateVideoOptions): boolean {
    return Boolean(
      options.model ||
        options.style ||
        typeof options.watermark === "boolean" ||
        typeof options.thumbnail === "boolean" ||
        typeof options.privateMode === "boolean" ||
        typeof options.storyboard === "boolean" ||
        options.characterUrl ||
        options.characterTimestamps ||
        options.characterTaskId
    );
  }

  /**
   * APIMart Sora2 Pro (api.apimart.ai)
   */
  private async generateVideoApimart(
    options: GenerateVideoOptions
  ): Promise<Sora2VideoResult> {
    if (!this.apiKeyApimart) {
      throw new ServiceUnavailableException("APIMart Sora2 API Key 未配置");
    }

    const startedAt = Date.now();
    let prompt = options.prompt || "";
    let characterUrl =
      typeof options.characterUrl === "string" && options.characterUrl.trim().length > 0
        ? options.characterUrl.trim()
        : undefined;

    if (options.characterTaskId) {
      const task = await this.queryCharacterTask(options.characterTaskId);
      const characters = Array.isArray(task?.characters) ? task.characters : [];
      const usernames = characters
        .map((item: any) =>
          typeof item?.username === "string" ? item.username.trim() : ""
        )
        .filter((name: string) => name.length > 0);
      if (usernames.length) {
        const missingMentions = usernames
          .map((name: string) => `@${name}`)
          .filter((mention: string) => !prompt.includes(mention));
        if (missingMentions.length) {
          prompt = `${prompt} ${missingMentions.join(" ")}`.trim();
        }
      }
      if (!characterUrl) {
        const firstId = characters.find(
          (item: any) => typeof item?.id === "string" && item.id.trim().length > 0
        )?.id;
        if (firstId) {
          characterUrl = firstId;
        }
      }
    }

    const model: Sora2GenerationModel =
      options.model || (options.quality === "hd" ? "sora-2-pro" : "sora-2");
    const durationValue =
      options.duration === "10" || options.duration === "15" || options.duration === "25"
        ? Number(options.duration)
        : undefined;
    if (durationValue === 25 && model !== "sora-2-pro") {
      throw new BadRequestException("仅 sora-2-pro 支持 25 秒时长，请切换模型或改为 10/15 秒");
    }

    const normalizedPrompt = (prompt || "").trim();
    if (!normalizedPrompt) {
      throw new BadRequestException("prompt 不能为空");
    }

    if (options.style && options.style.trim()) {
      const normalizedStyle = options.style.trim().toLowerCase();
      if (!SORA2_APIMART_ALLOWED_STYLES.has(normalizedStyle)) {
        throw new BadRequestException(
          `style 不合法，仅支持: ${Array.from(SORA2_APIMART_ALLOWED_STYLES).join(", ")}`
        );
      }
    }

    if (options.characterTimestamps && options.characterTimestamps.trim()) {
      const ts = options.characterTimestamps.trim();
      const matched = ts.match(/^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
      if (!matched) {
        throw new BadRequestException('character_timestamps 格式错误，应为 "起始秒,结束秒"，例如 "1,3"');
      }
      const start = Number(matched[1]);
      const end = Number(matched[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new BadRequestException('character_timestamps 范围错误，应满足 "结束秒 > 起始秒"');
      }
      if (Math.abs(end - start - 2) > 1e-6) {
        throw new BadRequestException('character_timestamps 仅支持 2 秒区间，例如 "1,3"');
      }
    }

    const createPayload: Record<string, any> = {
      model,
      prompt: normalizedPrompt,
    };
    if (durationValue) createPayload.duration = durationValue;
    if (options.aspectRatio) createPayload.aspect_ratio = options.aspectRatio;
    if (options.watermark === true) createPayload.watermark = true;
    if (options.thumbnail === true) createPayload.thumbnail = true;
    if (options.privateMode === true) createPayload.private = true;
    if (options.storyboard === true) createPayload.storyboard = true;
    if (options.style && options.style.trim()) createPayload.style = options.style.trim();
    if (characterUrl) createPayload.character_url = characterUrl;
    if (options.characterTimestamps && options.characterTimestamps.trim()) {
      createPayload.character_timestamps = options.characterTimestamps.trim();
    }
    const images = (options.referenceImageUrls || [])
      .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      .map((url) => url.trim());
    if (images.length) {
      createPayload.image_urls = images;
    }

    this.logger.log(
      `APIMart Sora2 创建任务: model=${model}, duration=${createPayload.duration || "default"}, ratio=${
        createPayload.aspect_ratio || "default"
      }, refs=${images.length}`
    );
    this.logger.log(`APIMart Sora2 完整请求体: ${JSON.stringify(createPayload)}`);

    const createController = new AbortController();
    const createTimer = setTimeout(() => createController.abort(), SORA2_FETCH_TIMEOUT_MS);
    const response = await fetch(`${this.apiBaseApimart}/v1/videos/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKeyApimart}`,
      },
      body: JSON.stringify(createPayload),
      signal: createController.signal,
    });
    clearTimeout(createTimer);

    const createResult = await response.json().catch(() => ({}));
    this.logger.log(
      `APIMart create response: http=${response.status}, body=${this.toLogSnippet(
        createResult
      )}`
    );
    if (!response.ok) {
      const message =
        createResult?.error?.message ||
        createResult?.message ||
        `HTTP ${response.status}`;
      this.logger.error(
        `APIMart Sora2 创建任务失败: status=${response.status}, message=${message}, payload=${JSON.stringify(
          createPayload
        )}, resp=${JSON.stringify(createResult).slice(0, 1200)}`
      );
      if (response.status === 401 || response.status === 403) {
        throw new ServiceUnavailableException("APIMart 鉴权失败，请检查 NANO2_API_KEY");
      }
      if (response.status >= 500) {
        throw new ServiceUnavailableException("APIMart 服务繁忙，请稍后再试");
      }
      throw new BadRequestException(`APIMart 参数错误: ${message}`);
    }

    const taskId =
      createResult?.data?.[0]?.task_id ||
      createResult?.data?.task_id ||
      createResult?.task_id ||
      createResult?.id;
    if (!taskId) {
      throw new ServiceUnavailableException(
        `Sora2 Pro 未返回任务ID: ${JSON.stringify(createResult)}`
      );
    }
    this.logger.log(
      `APIMart task created: taskId=${taskId}, initialStatus=${
        createResult?.data?.[0]?.status || createResult?.status || "unknown"
      }`
    );

    const pollResult = await this.pollApimartTaskUntilComplete(taskId);
    if (!pollResult) {
      throw new ServiceUnavailableException(
        `Sora2 任务仍在处理中（taskId=${taskId}），请稍后重试查询`
      );
    }

    if (
      pollResult.status &&
      SORA2_APIMART_FAILED_STATUSES.includes(pollResult.status.toLowerCase())
    ) {
      throw new BadRequestException(
        pollResult.errorMessage ||
          `Sora2 任务失败（status=${pollResult.status}）`
      );
    }

    if (!pollResult.videoUrl) {
      throw new ServiceUnavailableException("Sora2 Pro 未返回有效视频地址");
    }

    const elapsedTime = ((Date.now() - startedAt) / 1000).toFixed(2);
    this.logger.log(`APIMart Sora2 视频生成成功，耗时 ${elapsedTime}s`);

    return {
      videoUrl: pollResult.videoUrl,
      content: `视频已生成（Sora2 Pro，任务ID: ${taskId}）`,
      thumbnailUrl: pollResult.thumbnailUrl,
      referencedUrls: pollResult.videoUrl ? [pollResult.videoUrl] : [],
      status: pollResult.status,
      taskId,
      taskInfo: pollResult.taskInfo,
    };
  }

  private async pollApimartTaskUntilComplete(
    taskId: string
  ): Promise<Sora2ResolvedMedia | null> {
    let attempt = 0;
    let consecutiveTimeoutErrors = 0;
    while (attempt < SORA2_APIMART_POLL_MAX_ATTEMPTS) {
      attempt += 1;
      await this.delay(SORA2_APIMART_POLL_INTERVAL_MS);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SORA2_APIMART_FETCH_TIMEOUT_MS);
        let response: Response;
        let endpointLabel = "tasks";
        try {
          const taskQueryUrl = `${this.apiBaseApimart}/v1/tasks/${encodeURIComponent(
            taskId
          )}?language=zh&t=${Date.now()}`;
          const legacyVideoQueryUrl = `${this.apiBaseApimart}/v1/videos/${encodeURIComponent(
            taskId
          )}?t=${Date.now()}`;

          response = await fetch(
            taskQueryUrl,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${this.apiKeyApimart}`,
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
              },
              signal: controller.signal,
            }
          );

          // Backward compatible: some paths still support querying /v1/videos/{taskId}
          if (!response.ok && [400, 404, 405].includes(response.status)) {
            endpointLabel = "videos";
            this.logger.warn(
              `APIMart poll fallback endpoint: task=${taskId}, attempt=${attempt}, from=/v1/tasks to /v1/videos, http=${response.status}`
            );
            response = await fetch(legacyVideoQueryUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${this.apiKeyApimart}`,
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
              },
              signal: controller.signal,
            });
          }
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          consecutiveTimeoutErrors = 0;
          const result = await response.json().catch(() => ({}));
          const data = this.normalizeApimartTaskPayload(result, taskId);
          const statusRaw = String(data?.status || "");
          const status = statusRaw.toLowerCase();
          const providerMessage =
            data?.error?.message || data?.message || data?.fail_reason;

          if (
            status &&
            SORA2_APIMART_FAILED_STATUSES.includes(status)
          ) {
            return {
              status,
              errorMessage:
                providerMessage || `Sora2 任务失败（status=${statusRaw}）`,
              referencedUrls: [],
              taskInfo: data,
            };
          }

          this.logger.warn(
            `APIMart poll non-OK: task=${taskId}, endpoint=${endpointLabel}, attempt=${attempt}, http=${
              response.status
            }, status=${statusRaw || "unknown"}, body=${this.toLogSnippet(data)}`
          );
          continue;
        }
        consecutiveTimeoutErrors = 0;
        const result = await response.json().catch(() => ({}));
        const data = this.normalizeApimartTaskPayload(result, taskId);
        const statusRaw = String(data?.status || "");
        const status = statusRaw.toLowerCase();

        if (status && SORA2_APIMART_FAILED_STATUSES.includes(status)) {
          return {
            status,
            errorMessage:
              data?.error?.message || data?.message || data?.fail_reason,
            referencedUrls: [],
            taskInfo: data,
          };
        }

        const { videoUrl, thumbnailUrl } = this.extractApimartMedia(data);
        this.logger.log(
          `APIMart poll: task=${taskId}, endpoint=${endpointLabel}, attempt=${attempt}, status=${
            statusRaw || "unknown"
          }, hasVideo=${!!videoUrl}, hasThumbnail=${!!thumbnailUrl}`
        );
        if (videoUrl) {
          this.logger.log(
            `APIMart media resolved: task=${taskId}, attempt=${attempt}, videoUrl=${this.toLogSnippet(
              videoUrl,
              220
            )}, thumbnailUrl=${this.toLogSnippet(thumbnailUrl, 220)}`
          );
          return {
            videoUrl,
            thumbnailUrl,
            status: status || "completed",
            referencedUrls: [videoUrl],
            taskInfo: data,
            taskId,
          };
        }

        if (status === "completed" || status === "succeeded" || status === "success") {
          this.logger.warn(
            `APIMart task succeeded but no video URL parsed(task=${taskId}, endpoint=${endpointLabel}, attempt=${attempt}): raw=${JSON.stringify(
              result
            ).slice(0, 900)}, normalized=${JSON.stringify(data).slice(0, 900)}`
          );
        }
      } catch (error) {
        const causeCode =
          typeof (error as any)?.cause?.code === "string"
            ? (error as any).cause.code
            : undefined;
        const isAbortError = (error as any)?.name === "AbortError";
        const effectiveCauseCode = isAbortError ? "ETIMEDOUT" : causeCode;
        this.logger.warn(
          `APIMart Sora2 轮询异常(task=${taskId}, attempt=${attempt}): ${
            error instanceof Error ? error.message : error
          }${effectiveCauseCode ? ` (cause=${effectiveCauseCode})` : ""}`
        );
        if (effectiveCauseCode === "ENOTFOUND") {
          throw new ServiceUnavailableException(
            "APIMart 域名解析失败（api.apimart.ai），请检查服务器 DNS 或代理网络"
          );
        }
        if (effectiveCauseCode === "ETIMEDOUT") {
          consecutiveTimeoutErrors += 1;
          if (consecutiveTimeoutErrors >= SORA2_APIMART_MAX_CONSECUTIVE_TIMEOUTS) {
            throw new ServiceUnavailableException(
              "APIMart 网络连接连续超时，请稍后重试或检查服务器到 api.apimart.ai 的网络链路"
            );
          }
          continue;
        }
      }
    }
    return null;
  }

  private normalizeApimartTaskPayload(
    payload: any,
    taskId?: string
  ): Record<string, any> {
    if (!payload || typeof payload !== "object") {
      return {};
    }

    const root = payload as Record<string, any>;
    const raw = root.data ?? root;

    if (Array.isArray(raw)) {
      const objects = raw.filter(
        (item): item is Record<string, any> =>
          !!item && typeof item === "object" && !Array.isArray(item)
      );

      const matched =
        taskId &&
        objects.find((item) => {
          const candidate =
            item.task_id ?? item.taskId ?? item.id ?? item.video_id ?? item.job_id;
          if (candidate === undefined || candidate === null) return false;
          return String(candidate) === taskId;
        });

      const selected = matched || objects[0];
      const normalizedRoot = root.data === raw ? { ...root, data: raw } : { ...root };
      return selected ? { ...normalizedRoot, ...selected } : normalizedRoot;
    }

    if (raw && typeof raw === "object") {
      const rawObj = raw as Record<string, any>;
      if (rawObj === root) return rawObj;
      return { ...root, ...rawObj };
    }

    return root;
  }

  private extractApimartMedia(data: any): {
    videoUrl?: string;
    thumbnailUrl?: string;
  } {
    if (!data) return {};
    const pickUrl = (candidates: unknown[]): string | undefined => {
      for (const item of candidates) {
        if (typeof item === "string" && item.startsWith("http")) return item;
        if (Array.isArray(item)) {
          const first = item
            .map((entry) => {
              if (typeof entry === "string" && entry.startsWith("http")) return entry;
              if (entry && typeof entry === "object") {
                const obj = entry as Record<string, any>;
                return (
                  (typeof obj.url === "string" && obj.url.startsWith("http") && obj.url) ||
                  (typeof obj.video_url === "string" &&
                    obj.video_url.startsWith("http") &&
                    obj.video_url) ||
                  (typeof obj.thumbnail_url === "string" &&
                    obj.thumbnail_url.startsWith("http") &&
                    obj.thumbnail_url) ||
                  undefined
                );
              }
              return undefined;
            })
            .find((value) => typeof value === "string");
          if (first) return first;
        }
      }
      return undefined;
    };

    const resultObj = data?.result || {};
    let videoUrl = pickUrl([
      data?.video_url,
      data?.video,
      data?.videoUrl,
      data?.url,
      data?.download_url,
      data?.file_url,
      data?.output,
      data?.outputs,
      data?.videos,
      resultObj?.video_url,
      resultObj?.video,
      resultObj?.videoUrl,
      resultObj?.url,
      resultObj?.download_url,
      resultObj?.file_url,
      resultObj?.output,
      resultObj?.outputs,
      resultObj?.videos,
      data?.resource_url,
      data?.resource?.url,
      resultObj?.resource_url,
      resultObj?.resource?.url,
    ]);

    let thumbnailUrl = pickUrl([
      data?.thumbnail_url,
      data?.thumbnail,
      data?.thumbnailUrl,
      resultObj?.thumbnail_url,
      resultObj?.thumbnail,
      resultObj?.thumbnailUrl,
      resultObj?.cover_url,
      data?.cover_url,
      resultObj?.poster_url,
      data?.poster_url,
    ]);

    // Fallback: recursively scan all URLs and infer media type by key/path.
    if (!videoUrl || !thumbnailUrl) {
      const discovered: Array<{ url: string; path: string }> = [];
      const visit = (value: unknown, path: string) => {
        if (!value) return;
        if (typeof value === "string") {
          if (value.startsWith("http")) {
            discovered.push({ url: value, path: path.toLowerCase() });
          }
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((item, index) => visit(item, `${path}[${index}]`));
          return;
        }
        if (typeof value === "object") {
          Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
            visit(item, path ? `${path}.${key}` : key)
          );
        }
      };
      visit(data, "");

      if (!thumbnailUrl) {
        thumbnailUrl = discovered.find((item) => {
          const p = item.path;
          return (
            /(thumb|thumbnail|cover|poster|preview|snapshot|image)/i.test(p) ||
            this.isLikelyImageUrl(item.url)
          );
        })?.url;
      }

      if (!videoUrl) {
        videoUrl =
          discovered.find((item) => {
            const p = item.path;
            return /(video|resource|output|download|file|result)/i.test(p) && !this.isLikelyImageUrl(item.url);
          })?.url ||
          discovered.find((item) => this.isLikelyVideoUrl(item.url))?.url ||
          discovered.find((item) => !this.isLikelyImageUrl(item.url))?.url;
      }
    }

    return { videoUrl, thumbnailUrl };
  }

  /**
   * Sora2 Pro (新API - newapi.megabyai.cc)
   * 使用 OpenAI 兼容接口 /v1/videos
   */
  private async generateVideoV2(
    options: GenerateVideoOptions
  ): Promise<Sora2VideoResult> {
    const startedAt = Date.now();

    // 判断是否为图生视频
    const isImageToVideo =
      options.referenceImageUrls && options.referenceImageUrls.length > 0;

    // 根据参数选择模型
    const duration = options.duration || "10";
    const orientation = options.aspectRatio === "9:16" ? "portrait" : "landscape";
    const qualityLevel = options.quality === "hd" ? "hd" : "standard";

    const model = getSora2ProModel(qualityLevel, !!isImageToVideo);

    this.logger.log(
      `Sora2 Pro 视频生成开始 (model=${model}, duration=${duration}, orientation=${orientation}, quality=${qualityLevel}, isImageToVideo=${!!isImageToVideo})`
    );

    // 根据文档构建请求体
    // 文生视频: { model, prompt, duration, size }
    // 图生视频: { model, prompt, images, duration, size, metadata }
    const size = orientation === "portrait" ? "720x1280" : "1280x720";

    const createPayload: Record<string, any> = {
      model,
      prompt: options.prompt,
      duration: Number(duration),
      size,
    };

    this.logger.log(`Sora2 Pro 完整请求体: ${JSON.stringify(createPayload)}`);

    // 图生视频：添加 images 数组
    if (isImageToVideo) {
      const images = options.referenceImageUrls!.filter(
        (url) => typeof url === "string" && url.trim().length > 0
      );
      if (images.length > 0) {
        createPayload.images = images;
        createPayload.metadata = {
          aspect_ratio: orientation,
          remove_watermark: true,
        };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      SORA2_V2_FETCH_TIMEOUT_MS
    );

    let taskId: string;
    try {
      const createResponse = await fetch(
        `${this.apiBaseV2}/v1/videos`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKeyV2}`,
          },
          body: JSON.stringify(createPayload),
          signal: controller.signal,
        }
      );

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}));
        const message =
          errorData?.error?.message ||
          errorData?.message ||
          `HTTP ${createResponse.status}`;
        this.logger.error(
          `Sora2 Pro 创建任务失败: HTTP ${createResponse.status}, 错误: ${message}, 完整响应: ${JSON.stringify(errorData)}`
        );

        // 检测配额不足错误
        if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('not enough')) {
          throw new ServiceUnavailableException("服务金额不足，请联系管理员");
        }

        if (createResponse.status >= 500) {
          throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
        }
        throw new ServiceUnavailableException(
          `Sora2 Pro 创建任务失败: ${message}`
        );
      }

      const createResult = await createResponse.json();
      this.logger.log(
        `Sora2 Pro 创建任务响应: ${JSON.stringify(createResult)}`
      );

      // 提取 taskId
      taskId =
        createResult?.task_id ||
        createResult?.id ||
        createResult?.data?.task_id ||
        createResult?.data?.id;

      if (!taskId) {
        throw new ServiceUnavailableException(
          `Sora2 Pro 未返回任务ID, 响应: ${JSON.stringify(createResult)}`
        );
      }

      this.logger.log(`Sora2 Pro 任务已创建: ${taskId}`);
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    // 2. 轮询任务状态
    const pollResult = await this.pollV2TaskUntilComplete(taskId);

    if (!pollResult) {
      throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
    }

    if (
      pollResult.status &&
      SORA2_V2_FAILED_STATUSES.includes(pollResult.status)
    ) {
      throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
    }

    if (!pollResult.videoUrl) {
      throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
    }

    const elapsedTime = ((Date.now() - startedAt) / 1000).toFixed(2);
    this.logger.log(`Sora2 Pro 视频生成成功，耗时 ${elapsedTime}s`);

    return {
      videoUrl: pollResult.videoUrl,
      content: `视频已生成（Sora2 Pro，任务ID: ${taskId}）`,
      thumbnailUrl: pollResult.thumbnailUrl,
      referencedUrls: pollResult.videoUrl ? [pollResult.videoUrl] : [],
      status: pollResult.status,
      taskId,
      taskInfo: pollResult.taskInfo,
    };
  }

  /**
   * 轮询Sora2 Pro任务状态
   */
  private async pollV2TaskUntilComplete(
    taskId: string
  ): Promise<Sora2ResolvedMedia | null> {
    let attempt = 0;

    while (attempt < SORA2_V2_POLL_MAX_ATTEMPTS) {
      attempt += 1;
      await this.delay(SORA2_V2_POLL_INTERVAL_MS);

      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          SORA2_V2_FETCH_TIMEOUT_MS
        );

        let response: Response;
        try {
          response = await fetch(
            `${this.apiBaseV2}/v1/videos/${taskId}?t=${Date.now()}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${this.apiKeyV2}`,
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
              },
              signal: controller.signal,
            }
          );
        } catch (fetchError) {
          if ((fetchError as any)?.name === "AbortError") {
            this.logger.warn(`Sora2 Pro 轮询超时 (attempt ${attempt})`);
            continue;
          }
          throw fetchError;
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          this.logger.warn(`Sora2 Pro 轮询失败: HTTP ${response.status}`);
          continue;
        }

        const result = await response.json().catch(() => ({}));
        this.logger.debug(`Sora2 Pro 轮询响应: ${JSON.stringify(result)}`);

        const data = this.normalizeApimartTaskPayload(result, taskId);
        const statusRaw = String(data?.status || result?.status || "");
        const status = statusRaw.toLowerCase();

        // 检查失败状态
        if (
          status &&
          SORA2_V2_FAILED_STATUSES.some(
            (failedStatus) => failedStatus.toLowerCase() === status
          )
        ) {
          return {
            status,
            errorMessage:
              data?.error?.message || data?.message || data?.fail_reason,
            referencedUrls: [],
            taskInfo: data,
          };
        }

        // 尝试提取视频URL（兼容多种字段名）
        const { videoUrl, thumbnailUrl } = this.extractApimartMedia(data);
        this.logger.log(
          `Sora2 Pro poll: task=${taskId}, attempt=${attempt}, status=${
            statusRaw || "unknown"
          }, hasVideo=${!!videoUrl}, hasThumbnail=${!!thumbnailUrl}`
        );

        if (videoUrl) {
          this.logger.log(
            `Sora2 Pro media resolved: task=${taskId}, attempt=${attempt}, videoUrl=${this.toLogSnippet(
              videoUrl,
              220
            )}, thumbnailUrl=${this.toLogSnippet(thumbnailUrl, 220)}`
          );
          return {
            videoUrl,
            thumbnailUrl,
            status: status || "completed",
            referencedUrls: [videoUrl],
            taskInfo: data,
            taskId,
          };
        }

        if (status === "completed" || status === "succeeded" || status === "success") {
          this.logger.warn(
            `Sora2 Pro task succeeded but no video URL parsed(task=${taskId}, attempt=${attempt}): raw=${JSON.stringify(
              result
            ).slice(0, 900)}, normalized=${JSON.stringify(data).slice(0, 900)}`
          );
        }
      } catch (error) {
        this.logger.warn(
          `Sora2 Pro 轮询异常: ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    this.logger.warn(`Sora2 Pro 任务 ${taskId} 轮询超时`);
    return null;
  }

  /**
   * 从Sora2 Pro响应中提取视频URL
   */
  private extractV2VideoUrl(data: any): string | undefined {
    if (!data) return undefined;

    // 常见字段名
    const candidates: unknown[] = [
      data.video_url,
      data.output,
      data.output_url,
      data.video,
      data.url,
      data.result,
      data.resource_url,
      data.media_url,
      data.file_url,
      data?.data?.video_url,
      data?.data?.output,
      data?.data?.url,
      data?.task_result?.video_url,
      data?.task_result?.url,
      data?.task_result?.output,
    ];

    for (const value of candidates) {
      if (typeof value === "string" && value.startsWith("http")) {
        return value;
      }
      if (Array.isArray(value)) {
        const firstUrl = value.find(
          (v) => typeof v === "string" && v.startsWith("http")
        );
        if (firstUrl) return firstUrl;
      }
    }
    return undefined;
  }

  /**
   * 普通Sora2 (旧API - 147ai.com)
   * 使用 /v1/chat/completions 流式接口
   */
  private async generateVideoLegacy(
    options: GenerateVideoOptions
  ): Promise<Sora2VideoResult> {
    const quality: VideoQuality = options.quality === "sd" ? "sd" : "hd";
    const model = this.getModelForQuality(quality);

    let attempt = 0;
    let lastError: unknown = null;
    const startedAt = Date.now();

    while (attempt < SORA2_MAX_RETRY) {
      attempt += 1;
      try {
        this.logger.log(
          `普通Sora2 video generation attempt ${attempt}/${SORA2_MAX_RETRY} (quality=${quality}, model=${model})`
        );

        // Build create payload for /v1/videos (supports JSON creation and optional image URL)
        const isImageToVideo =
          options.referenceImageUrls && options.referenceImageUrls.length > 0;

        // choose model based on duration and aspectRatio if provided, otherwise fallback to existing model mapping
        const selectedModel = (() => {
          // 默认 10 秒横屏（当未传 duration 或 aspectRatio 时）
          const durationNum = options.duration ? Number(options.duration) : 10;
          const isPortrait = options.aspectRatio === "9:16";
          if (durationNum === 10)
            return isPortrait ? "sora2-portrait" : "sora2-landscape";
          if (durationNum === 15)
            return isPortrait ? "sora2-portrait-15s" : "sora2-landscape-15s";
          if (durationNum === 25)
            return isPortrait
              ? "sora2-pro-portrait-25s"
              : "sora2-pro-landscape-25s";
          // 未匹配的时长默认回退为 10s 横屏或竖屏对应模型
          return isPortrait ? "sora2-portrait" : "sora2-landscape";
        })();

        const duration = options.duration ? Number(options.duration) : 10;

        // 构建请求体（通过模型名称区分时长和比例，不需要额外传 duration 和 aspect_ratio）
        const createPayload: Record<string, any> = {
          model: selectedModel,
          prompt: options.prompt,
        };

        // 图生视频：添加 image URL
        if (isImageToVideo) {
          const imageUrl = options.referenceImageUrls!.find(
            (u) => typeof u === "string" && u.trim().length > 0
          );
          if (imageUrl) {
            createPayload.image = imageUrl;
          }
        }

        // 打印请求信息
        this.logger.log(
          `普通Sora2 创建请求: model=${selectedModel}, prompt=${options.prompt.slice(0, 100)}, hasImage=${!!createPayload.image}, imageUrl=${createPayload.image || 'none'}`
        );
        this.logger.log(`普通Sora2 完整请求体: ${JSON.stringify(createPayload)}`);

        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          SORA2_FETCH_TIMEOUT_MS
        );
        let createResponse: Response;
        try {
          createResponse = await fetch(`${this.apiBase}/v1/videos`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(createPayload),
            signal: controller.signal,
          });
        } catch (fetchErr) {
          clearTimeout(timer);
          const name = (fetchErr as any)?.name;
          const msg =
            fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          this.logger.warn(
            `普通Sora2 创建任务 fetch 异常 (attempt ${attempt}): ${msg}`,
            fetchErr as any
          );
          throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
        } finally {
          clearTimeout(timer);
        }

        if (!createResponse.ok) {
          const errorText = await createResponse.text().catch(() => "");
          this.logger.error(
            `❌ 普通Sora2 创建任务失败: HTTP ${
              createResponse.status
            }, body=${errorText.slice(0, 1000)}`
          );
          const parsedError = (() => {
            try {
              return JSON.parse(errorText);
            } catch {
              return null;
            }
          })();
          const message =
            parsedError?.message ||
            parsedError?.error?.message ||
            `HTTP ${createResponse.status}`;
          // 对于服务端错误（5xx），显示友好提示
          if (createResponse.status >= 500) {
            throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
          }
          throw new ServiceUnavailableException(`Sora2 请求失败: ${message}`);
        }

        const createResult = await createResponse.json().catch(() => ({}));
        this.logger.log(
          `普通Sora2 创建任务响应: ${JSON.stringify(createResult).slice(
            0,
            400
          )}`
        );

        // If provider returned direct video url (synchronous), return immediately
        const directVideo =
          createResult?.video_url ||
          createResult?.output?.video_url ||
          createResult?.result?.video_url ||
          createResult?.output ||
          createResult?.result;
        if (typeof directVideo === "string" && directVideo.startsWith("http")) {
          const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
          this.logger.log(`普通Sora2 视频生成(同步)成功，耗时 ${durationSec}s`);
          return {
            videoUrl: directVideo,
            content: `视频已生成（即时返回）`,
            thumbnailUrl: undefined,
            referencedUrls: [directVideo],
            status: "succeeded",
            taskId: createResult?.id || createResult?.task_id,
            taskInfo: createResult,
          };
        }

        // extract task id for polling
        const taskId =
          createResult?.task_id ||
          createResult?.id ||
          createResult?.data?.task_id ||
          createResult?.data?.id;

        if (!taskId) {
          this.logger.error(
            `Sora2 创建任务未返回 task id，响应: ${JSON.stringify(
              createResult
            ).slice(0, 400)}`
          );
          throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
        }

        // Poll task status with adaptive interval (5s -> up to 30s)
        const maxAttempts = SORA2_POLL_MAX_ATTEMPTS;
        let pollAttempt = 0;
        let interval = 5000;
        let finalResult: any = null;
        while (pollAttempt < maxAttempts) {
          pollAttempt += 1;
          await this.delay(interval);
          try {
            const pollController = new AbortController();
            const pollTimer = setTimeout(
              () => pollController.abort(),
              SORA2_FETCH_TIMEOUT_MS
            );
            let statusResp: Response;
            try {
              statusResp = await fetch(
                `${this.apiBase}/v1/videos/${encodeURIComponent(
                  String(taskId)
                )}?t=${Date.now()}`,
                {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                  },
                  signal: pollController.signal,
                }
              );
            } catch (err) {
              clearTimeout(pollTimer);
              this.logger.warn(
                `轮询 Sora2 任务 ${taskId} 异常: ${
                  err instanceof Error ? err.message : err
                }`
              );
              continue;
            } finally {
              clearTimeout(pollTimer);
            }

            if (!statusResp.ok) {
              const txt = await statusResp.text().catch(() => "");
              this.logger.warn(
                `轮询 Sora2 任务非 OK: ${taskId} HTTP ${
                  statusResp.status
                } ${txt.slice(0, 200)}`
              );
              continue;
            }

            const statusDataRaw = await statusResp.json().catch(() => ({}));
            const statusData = this.normalizeApimartTaskPayload(
              statusDataRaw,
              String(taskId)
            );
            const stat = (statusData?.status || "").toString().toLowerCase();
            const {
              videoUrl: polledVideoUrl,
              thumbnailUrl: polledThumbnailUrl,
            } = this.extractApimartMedia(statusData);
            this.logger.log(
              `Sora2 legacy poll: task=${taskId}, attempt=${pollAttempt}, status=${
                stat || "unknown"
              }, hasVideo=${!!polledVideoUrl}, hasThumbnail=${!!polledThumbnailUrl}`
            );

            if (stat === "completed" || stat === "success" || stat === "succeeded") {
              finalResult = statusData;
              break;
            }
            if (SORA2_FAILED_STATUSES.includes(stat)) {
              finalResult = statusData;
              break;
            }
          } catch (err) {
            this.logger.warn(
              `轮询 Sora2 任务 ${taskId} 捕获异常: ${
                err instanceof Error ? err.message : err
              }`
            );
          }
          // adaptive increase: multiply until cap 30s
          interval = Math.min(30000, Math.round(interval * 1.5));
        }

        if (!finalResult) {
          throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
        }

        const statusValue = (finalResult?.status || "")
          .toString()
          .toLowerCase();
        if (SORA2_FAILED_STATUSES.includes(statusValue)) {
          const msg =
            finalResult?.error?.message ||
            finalResult?.message ||
            "Sora2 生成失败";
          throw new BadRequestException(`Sora2 生成失败: ${msg}`);
        }

        const { videoUrl, thumbnailUrl } = this.extractApimartMedia(finalResult);

        if (!videoUrl) {
          this.logger.error(
            `轮询结束但未找到视频 URL，task=${taskId}, resp=${JSON.stringify(
              finalResult
            ).slice(0, 400)}`
          );
          throw new ServiceUnavailableException("服务器不稳定，请稍后再试");
        }

        const totalDur = ((Date.now() - startedAt) / 1000).toFixed(2);
        this.logger.log(
          `普通Sora2 视频生成成功，任务 ${taskId}，耗时 ${totalDur}s`
        );
        return {
          videoUrl,
          content: `视频已生成（任务 ID: ${taskId}）`,
          thumbnailUrl,
          referencedUrls: videoUrl ? [videoUrl] : [],
          status: statusValue,
          taskId,
          taskInfo: finalResult,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof BadRequestException) {
          throw error;
        }

        const retryable = this.isRetryableVideoError(error);
        this.logger.warn(
          `Sora2 attempt ${attempt} failed${retryable ? ", will retry" : ""}: ${
            error instanceof Error ? error.message : error
          }`
        );

        if (retryable && attempt < SORA2_MAX_RETRY) {
          const wait = SORA2_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await this.delay(wait);
          continue;
        }

        if (error instanceof ServiceUnavailableException) {
          throw error;
        }

        throw new ServiceUnavailableException(
          error instanceof Error ? error.message : "服务器不稳定，请稍后再试"
        );
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : "Sora2 视频生成重试仍失败，请稍后再试";
    throw new ServiceUnavailableException(message);
  }

  getModelForQuality(quality: VideoQuality): string {
    return SORA2_VIDEO_MODELS[quality] || SORA2_VIDEO_MODELS.hd;
  }

  private buildMessages(prompt: string, imageUrls?: string[]) {
    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: { url: string };
        }
    > = [
      {
        type: "text",
        text: prompt,
      },
    ];

    const normalizedImages = (imageUrls || [])
      .filter(
        (url): url is string => typeof url === "string" && url.trim().length > 0
      )
      .map((url) => url.trim());

    normalizedImages.forEach((url) => {
      content.push({
        type: "image_url",
        image_url: { url },
      });
    });

    return [
      {
        role: "user",
        content,
      },
    ];
  }

  private async processStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new ServiceUnavailableException("Sora2 响应不可读取");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed?.choices?.[0]?.delta?.content;
            if (chunk) {
              fullContent += chunk;
            }
          } catch {
            this.logger.debug(`无法解析 Sora2 流式片段: ${payload}`);
          }
        }
      }

      if (buffer.startsWith("data: ")) {
        const payload = buffer.slice(6);
        if (payload !== "[DONE]") {
          try {
            const parsed = JSON.parse(payload);
            const chunk = parsed?.choices?.[0]?.delta?.content;
            if (chunk) {
              fullContent += chunk;
            }
          } catch {
            this.logger.debug(`无法解析最终流式片段: ${payload}`);
          }
        }
      }

      return fullContent.trim();
    } finally {
      reader.releaseLock();
    }
  }

  private async resolveSora2Response(
    rawContent: string
  ): Promise<Sora2ResolvedMedia> {
    const referencedUrls = new Set<string>();
    const visitedTaskUrls = new Set<string>();
    let videoUrl: string | undefined;
    let thumbnailUrl: string | undefined;
    let taskInfo: Record<string, any> | null = null;
    let status: string | undefined;
    let taskId: string | undefined;
    let errorMessage: string | undefined;

    type QueueEntry = { type: "text" | "url"; payload: string; depth: number };
    const queue: QueueEntry[] = [
      { type: "text", payload: rawContent, depth: 0 },
    ];

    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth > SORA2_MAX_FOLLOW_DEPTH) {
        continue;
      }

      if (current.type === "url") {
        if (visitedTaskUrls.has(current.payload)) continue;
        visitedTaskUrls.add(current.payload);
        const payload = await this.safeFetchTextWithTimeout(current.payload);
        if (payload) {
          queue.push({ type: "text", payload, depth: current.depth + 1 });
        }
        continue;
      }

      const parsed = this.tryParseJson(current.payload);
      if (parsed) {
        taskInfo = { ...(taskInfo || {}), ...parsed };
        if (!status && typeof parsed.status === "string") {
          status = parsed.status;
        }
        if (!taskId && typeof parsed.id === "string") {
          taskId = parsed.id;
        }
        if (!errorMessage) {
          errorMessage =
            typeof parsed.error?.message === "string"
              ? parsed.error.message
              : typeof parsed.message === "string"
              ? parsed.message
              : undefined;
        }
        this.collectUrlsFromObject(parsed, referencedUrls);
      } else {
        this.extractUrlsFromText(current.payload).forEach((url) =>
          referencedUrls.add(url)
        );
      }

      if (!videoUrl) {
        videoUrl = this.pickFirstMatchingUrl(referencedUrls, (url) =>
          this.isLikelyVideoUrl(url)
        );
      }
      if (!thumbnailUrl) {
        thumbnailUrl = this.pickFirstMatchingUrl(referencedUrls, (url) =>
          this.isLikelyImageUrl(url)
        );
      }

      if (!videoUrl) {
        const taskCandidates = Array.from(referencedUrls).filter(
          (url) => this.isAsyncTaskUrl(url) && !visitedTaskUrls.has(url)
        );
        taskCandidates.slice(0, 2).forEach((url) => {
          queue.push({ type: "url", payload: url, depth: current.depth + 1 });
        });
      }
    }

    return {
      videoUrl,
      thumbnailUrl,
      referencedUrls: Array.from(referencedUrls),
      taskInfo,
      status,
      taskId,
      errorMessage,
    };
  }

  private async pollTaskUntilComplete(
    taskUrls: string[]
  ): Promise<Sora2ResolvedMedia | null> {
    let attempt = 0;

    while (attempt < SORA2_POLL_MAX_ATTEMPTS) {
      attempt += 1;
      await this.delay(SORA2_POLL_INTERVAL_MS);

      for (const taskUrl of taskUrls) {
        try {
          const payload = await this.safeFetchTextWithTimeout(taskUrl);
          if (!payload) continue;

          const resolved = await this.resolveSora2Response(payload);
          if (
            resolved.status &&
            SORA2_FAILED_STATUSES.includes(resolved.status)
          ) {
            return resolved;
          }

          if (resolved.videoUrl) {
            return resolved;
          }

          if (
            resolved.status &&
            SORA2_POLL_STATUSES.includes(resolved.status)
          ) {
            break;
          }
        } catch (error) {
          this.logger.warn(
            `轮询 Sora2 任务失败: ${taskUrl} ${
              error instanceof Error ? error.message : error
            }`
          );
        }
      }
    }

    this.logger.warn("Sora2 任务轮询超时");
    return null;
  }

  private async safeFetchTextWithTimeout(
    url: string,
    timeoutMs: number = SORA2_FETCH_TIMEOUT_MS
  ): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        this.logger.warn(`Sora2 任务跟进请求失败: ${url} ${response.status}`);
        return null;
      }
      return await response.text();
    } catch (error) {
      this.logger.warn(
        `无法访问 Sora2 任务地址 ${url}: ${
          error instanceof Error ? error.message : error
        }`
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private tryParseJson(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  private normalizeUrlCandidate(value: string): string {
    return value
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[,.;)\]\s]+$/g, "");
  }

  private extractUrlsFromText(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    return matches.map((value) => this.normalizeUrlCandidate(value));
  }

  private collectUrlsFromObject(value: unknown, bucket: Set<string>) {
    if (!value) return;
    if (typeof value === "string") {
      if (value.startsWith("http")) {
        bucket.add(this.normalizeUrlCandidate(value));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectUrlsFromObject(item, bucket));
      return;
    }
    if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach((item) =>
        this.collectUrlsFromObject(item, bucket)
      );
    }
  }

  private pickFirstMatchingUrl(
    urls: Iterable<string>,
    matcher: (url: string) => boolean
  ): string | undefined {
    for (const url of urls) {
      if (matcher(url)) {
        return url;
      }
    }
    return undefined;
  }

  private isLikelyVideoUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return SORA2_VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  private isLikelyImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return SORA2_IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
  }

  private isAsyncTaskUrl(url: string): boolean {
    return SORA2_ASYNC_HOST_HINTS.some((mark) => url.includes(mark));
  }

  private toLogSnippet(value: unknown, maxLength: number = 1200): string {
    if (value === undefined || value === null) return "null";
    try {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > maxLength
        ? `${text.slice(0, maxLength)}...(truncated)`
        : text;
    } catch {
      return String(value);
    }
  }

  private isRetryableVideoError(error: unknown): boolean {
    const code = (error as any)?.code as string | undefined;
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    if (code?.startsWith("HTTP_5")) return true;
    if (code === "NETWORK_ERROR") return true;
    if (/load failed/i.test(message)) return true;
    if (/failed to fetch/i.test(message)) return true;
    if (/network.*error/i.test(message)) return true;
    if (/timeout/i.test(message)) return true;
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
