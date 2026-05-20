import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider } from './ai-provider.interface';
import { Nano2Service } from '../services/nano2.service';
import { TencentVodAigcService } from '../services/tencent-vod-aigc.service';

type BananaImageRoute = 'normal' | 'stable';
type GptImage2Quality = 'auto' | 'low' | 'medium' | 'high';
type GptImage2Background = 'auto' | 'opaque' | 'transparent';
type GptImage2Moderation = 'auto' | 'low';
type GptImage2OutputFormat = 'png' | 'jpeg' | 'webp';

const GPT_IMAGE_2_OFFICIAL_MODEL = 'gpt-image-2-official';
const GPT_IMAGE_2_4K_SIZE_SET = new Set(['16:9', '9:16', '2:1', '1:2', '21:9', '9:21']);

@Injectable()
export class Nano2Provider implements IAIProvider {
  private readonly logger = new Logger(Nano2Provider.name);
  private available = false;

  constructor(
    private readonly config: ConfigService,
    private readonly nano2Service: Nano2Service,
    private readonly tencentVodAigcService: TencentVodAigcService,
  ) {}

  async initialize(): Promise<void> {
    const apiKey = this.config.get<string>('NANO2_API_KEY');
    this.available = !!apiKey;
    this.logger.log(`Nano2 provider initialized: ${this.available ? 'available' : 'unavailable'}`);
  }

  isAvailable(): boolean {
    return this.available;
  }

  getProviderInfo(): any {
    return { name: 'nano2', model: 'gpt-image-2' };
  }

  private normalizeRoute(raw: unknown): BananaImageRoute | null {
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'normal' || normalized === 'apimart') return 'normal';
    if (normalized === 'stable' || normalized === 'tencent') return 'stable';
    return null;
  }

  private resolveUserRoute(providerOptions?: Record<string, any>): BananaImageRoute {
    const nested = this.normalizeRoute(providerOptions?.banana?.imageRoute);
    if (nested) return nested;
    const legacy = this.normalizeRoute(providerOptions?.bananaImageRoute);
    if (legacy) return legacy;
    // GPT Image 2 默认按尊享（stable）路线走，不走普通路线
    return 'stable';
  }

  private isGptImage2Model(model: string): boolean {
    return model.toLowerCase().includes('gpt-image-2');
  }

  private normalizeResolution(rawResolution: unknown, isGptImage2Model: boolean): string {
    const normalized = String(rawResolution || '1K').trim().toUpperCase();
    if (normalized === '2K') return isGptImage2Model ? '2k' : '2K';
    if (normalized === '4K') return isGptImage2Model ? '4k' : '4K';
    return isGptImage2Model ? '1k' : '1K';
  }

  private normalizeOutputFormat(raw: unknown): GptImage2OutputFormat | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'png' || normalized === 'jpeg' || normalized === 'webp') {
      return normalized as GptImage2OutputFormat;
    }
    return undefined;
  }

  private normalizeQuality(raw: unknown): GptImage2Quality | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized as GptImage2Quality;
    }
    return undefined;
  }

  private normalizeBackground(raw: unknown): GptImage2Background | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'opaque' || normalized === 'transparent') {
      return normalized as GptImage2Background;
    }
    return undefined;
  }

  private normalizeModeration(raw: unknown): GptImage2Moderation | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'low') {
      return normalized as GptImage2Moderation;
    }
    return undefined;
  }

  private normalizeOutputCompression(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.max(0, Math.min(100, Math.trunc(raw)));
  }

  private validateGptImage24kResolution(size: string, resolution: string): void {
    if (resolution !== '4k') return;
    if (GPT_IMAGE_2_4K_SIZE_SET.has(size)) return;
    throw new Error(
      `gpt-image-2-official does not support 4k with size=${size}. Supported 4k ratios: ${Array.from(
        GPT_IMAGE_2_4K_SIZE_SET,
      ).join(', ')}`,
    );
  }

  private isUpstream5xxError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /HTTP\s5\d\d/.test(message);
  }

  private parsePositiveInt(raw: unknown, fallback: number): number {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
    if (typeof raw === 'string') {
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) {
        return Math.floor(num);
      }
    }
    return fallback;
  }

  async generateImage(request: any): Promise<any> {
    const requestedModel =
      typeof request.model === 'string' && request.model.trim()
        ? request.model.trim()
        : 'gemini-3.1-flash-image-preview';
    const isGptImage2Model = this.isGptImage2Model(requestedModel);
    const userRoute = this.resolveUserRoute(request.providerOptions);
    const useOfficialProfile = isGptImage2Model && userRoute === 'stable';
    const upstreamModel = useOfficialProfile ? GPT_IMAGE_2_OFFICIAL_MODEL : requestedModel;
    const requestedSize = (() => {
      const raw = request.aspectRatio ?? (isGptImage2Model ? '1:1' : '16:9');
      return typeof raw === 'string' && raw.trim() ? raw.trim() : (isGptImage2Model ? '1:1' : '16:9');
    })();

    const normalizedResolution = this.normalizeResolution(
      request.resolution || request.imageSize || '1K',
      isGptImage2Model,
    );

    if (useOfficialProfile) {
      this.validateGptImage24kResolution(requestedSize, normalizedResolution);
    }

    this.logger.log(
      `[Nano2/Image] route=${userRoute}, requestedModel=${requestedModel}, upstreamModel=${upstreamModel}, size=${requestedSize}, resolution=${normalizedResolution}`,
    );

    const outputFormat = this.normalizeOutputFormat(request.outputFormat ?? request.output_format);
    const outputCompression = this.normalizeOutputCompression(
      request.outputCompression ?? request.output_compression,
    );
    const maskUrl =
      typeof request.maskUrl === 'string'
        ? request.maskUrl.trim()
        : typeof request.mask_url === 'string'
          ? request.mask_url.trim()
          : '';

    const officialBackground = this.normalizeBackground(request.background) ?? 'auto';
    const sanitizedOfficialBackground = officialBackground === 'transparent' ? 'auto' : officialBackground;
    if (useOfficialProfile && officialBackground === 'transparent') {
      this.logger.warn(
        '[Nano2/Image] gpt-image-2-official does not support transparent background, downgraded to auto',
      );
    }

    const buildSubmitRequest = (resolution: string) => ({
      prompt: request.prompt,
      model: upstreamModel,
      size: requestedSize,
      n: 1,
      image_urls: request.imageUrls || request.image_urls,
      resolution,
      ...(isGptImage2Model
        ? useOfficialProfile
          ? {
              quality: this.normalizeQuality(request.quality) ?? 'auto',
              background: sanitizedOfficialBackground,
              moderation: this.normalizeModeration(request.moderation) ?? 'auto',
              output_format: outputFormat ?? 'png',
              ...((outputFormat === 'jpeg' || outputFormat === 'webp') &&
              typeof outputCompression === 'number'
                ? { output_compression: outputCompression }
                : {}),
              ...(maskUrl ? { mask_url: maskUrl } : {}),
            }
          : {
              official_fallback:
                typeof request.officialFallback === 'boolean' ? request.officialFallback : false,
            }
        : {
            google_search: request.googleSearch,
            google_image_search: request.googleImageSearch,
          }),
    });

    let finalResolution = normalizedResolution;

    // TODO: stable 路由可接入腾讯云 VOD AIGC 图像生成以获得更稳定的排队和 15 分钟超长轮询。
    //       需先确认 GPT Image 2 在腾讯云 VOD AIGC 的 modelName / modelVersion 映射。
    //       当前 stable 路由仍走 Apimart 的 gpt-image-2-official。

    let result;
    try {
      result = await this.nano2Service.generateImage(buildSubmitRequest(finalResolution));
    } catch (error) {
      const shouldFallbackTo2k =
        useOfficialProfile &&
        finalResolution === '4k' &&
        this.isUpstream5xxError(error);
      if (!shouldFallbackTo2k) {
        throw error;
      }

      finalResolution = '2k';
      this.logger.warn(
        `[Nano2/Image] Official 4k request failed with upstream 5xx, retrying once with 2k. size=${requestedSize}, model=${upstreamModel}`,
      );
      result = await this.nano2Service.generateImage(buildSubmitRequest(finalResolution));
    }

    this.logger.log(`Nano2 task submitted: ${result.taskId}`);

    // 从配置读取轮询参数，支持环境变量覆盖
    const pollingWindowMs = this.parsePositiveInt(
      this.config.get<string>('NANO2_POLL_MAX_WAIT_MS'),
      15 * 60 * 1000,
    );
    const pollIntervalMs = this.parsePositiveInt(
      this.config.get<string>('NANO2_POLL_INTERVAL_MS'),
      3_000,
    );
    const initialDelayMs = this.parsePositiveInt(
      this.config.get<string>('NANO2_POLL_INITIAL_DELAY_MS'),
      10_000,
    );
    const maxPollAttempts = this.parsePositiveInt(
      this.config.get<string>('NANO2_POLL_MAX_ATTEMPTS'),
      300,
    );
    const startedAt = Date.now();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    await sleep(initialDelayMs);

    let attempt = 0;
    let successWithoutUrlAttempts = 0;
    const successWithoutUrlRetryLimit = 8;

    while (Date.now() - startedAt < pollingWindowMs && attempt < maxPollAttempts) {
      attempt += 1;
      let taskResult;
      try {
        taskResult = await this.nano2Service.queryTask(result.taskId);
      } catch (err: any) {
        if (err.message?.includes('404')) {
          this.logger.warn(`Nano2 task ${result.taskId} not found yet (attempt ${attempt}), retrying...`);
          await sleep(pollIntervalMs);
          continue;
        }
        throw err;
      }

      this.logger.log(`Nano2 task ${result.taskId} status: ${taskResult.status} (attempt ${attempt})`);

      if (taskResult.status === 'succeeded' || taskResult.status === 'completed') {
        if (taskResult.imageUrl) {
          return {
            success: true,
            data: {
              imageData: null,
              imageUrl: taskResult.imageUrl,
              textResponse: 'Image generated successfully',
              metadata: {
                taskId: result.taskId,
                imageUrl: taskResult.imageUrl,
                provider: 'nano2',
                aiProvider: 'nano2',
                model: upstreamModel,
                route: userRoute,
                resolution: finalResolution,
              },
            },
          };
        }

        // 成功但无 URL，额外容忍几次轮询
        successWithoutUrlAttempts += 1;
        if (successWithoutUrlAttempts >= successWithoutUrlRetryLimit) {
          this.logger.error(
            `Nano2 task ${result.taskId} completed but image URL is missing after ${successWithoutUrlAttempts} success-state retries`,
          );
          return {
            success: false,
            error: { message: 'Nano2 task completed but no image URL returned' },
          };
        }

        this.logger.warn(
          `Nano2 task ${result.taskId} reached success without image URL (attempt ${successWithoutUrlAttempts}/${successWithoutUrlRetryLimit}), continue polling...`,
        );
        await sleep(pollIntervalMs);
        continue;
      }

      if (taskResult.status === 'failed' || taskResult.status === 'error') {
        return {
          success: false,
          error: { message: 'Nano2 image generation failed' },
        };
      }

      await sleep(pollIntervalMs);
    }

    // 区分超时原因
    if (attempt >= maxPollAttempts) {
      return {
        success: false,
        error: { message: `Nano2 image generation timeout after ${maxPollAttempts} polling attempts` },
      };
    }
    return {
      success: false,
      error: { message: 'Nano2 image generation timeout after 15 minutes' },
    };
  }

  async editImage(request: any): Promise<any> {
    throw new Error('Nano2 does not support image editing');
  }

  async blendImages(request: any): Promise<any> {
    throw new Error('Nano2 does not support image blending');
  }

  async analyzeImage(request: any): Promise<any> {
    throw new Error('Nano2 does not support image analysis');
  }

  async generateText(request: any): Promise<any> {
    throw new Error('Nano2 does not support text generation');
  }

  async selectTool(request: any): Promise<any> {
    throw new Error('Nano2 does not support tool selection');
  }

  async generatePaperJS(request: any): Promise<any> {
    throw new Error('Nano2 does not support PaperJS generation');
  }
}
