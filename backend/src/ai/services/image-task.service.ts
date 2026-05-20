import { BadGatewayException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation.service';
import { AIProviderFactory } from '../ai-provider.factory';
import { OpenObserveTelemetryService } from '../../telemetry/openobserve-telemetry.service';
import { captureTraceContext, runWithSpan, type PersistedTraceContext } from '../../telemetry/tracing';
import { OssService } from '../../oss/oss.service';
import { CreditsService } from '../../credits/credits.service';
import { ApiResponseStatus } from '../../credits/dto/credits.dto';
import crypto from 'crypto';
import { Readable } from 'stream';

export type ImageTaskType = 'generate' | 'edit' | 'blend' | 'expand';
export type ImageTaskStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
type BananaImageRoute = 'normal' | 'stable';

/**
 * 根据任务类型和模型映射到 ServiceType
 */
function resolveTaskServiceType(taskType: ImageTaskType, model?: string): string {
  const normalizedModel = model?.trim().toLowerCase();
  switch (taskType) {
    case 'generate':
      if (normalizedModel?.includes('gpt-image-2')) return 'gpt-image-2';
      if (normalizedModel?.includes('3.1')) return 'gemini-3.1-image';
      if (normalizedModel?.includes('2.5')) return 'gemini-2.5-image';
      return 'gemini-3-pro-image';
    case 'edit':
      if (normalizedModel?.includes('3.1')) return 'gemini-3.1-image-edit';
      if (normalizedModel?.includes('2.5')) return 'gemini-2.5-image-edit';
      return 'gemini-image-edit';
    case 'blend':
      if (normalizedModel?.includes('3.1')) return 'gemini-3.1-image-blend';
      if (normalizedModel?.includes('2.5')) return 'gemini-2.5-image-blend';
      return 'gemini-image-blend';
    default:
      return 'gemini-3-pro-image';
  }
}

@Injectable()
export class ImageTaskService {
  private readonly logger = new Logger(ImageTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imageGenService: ImageGenerationService,
    private readonly providerFactory: AIProviderFactory,
    private readonly telemetryService: OpenObserveTelemetryService,
    private readonly oss: OssService,
    private readonly creditsService: CreditsService,
  ) {}

  private extractProviderImagePayload(resultData: any): { imageUrl?: string; imageData?: string } {
    if (!resultData || typeof resultData !== 'object') return {};

    const directImageUrl =
      typeof resultData.imageUrl === 'string' && /^https?:\/\//i.test(resultData.imageUrl)
        ? resultData.imageUrl
        : undefined;

    const metadataImageUrl =
      !directImageUrl &&
      resultData.metadata &&
      typeof resultData.metadata.imageUrl === 'string' &&
      /^https?:\/\//i.test(resultData.metadata.imageUrl)
        ? resultData.metadata.imageUrl
        : undefined;

    const imageUrl = directImageUrl || metadataImageUrl;
    if (imageUrl) return { imageUrl };

    const imageData =
      typeof resultData.imageData === 'string' && resultData.imageData.trim().length > 0
        ? resultData.imageData
        : undefined;
    if (imageData) return { imageData };

    return {};
  }

  private normalizeBananaImageRoute(raw: unknown): BananaImageRoute | null {
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'normal' || normalized === 'apimart') return 'normal';
    if (normalized === 'stable' || normalized === 'tencent') return 'stable';
    return null;
  }

  private resolveTaskBananaImageRoute(requestData: any): BananaImageRoute | null {
    const providerOptions =
      requestData?.providerOptions && typeof requestData.providerOptions === 'object'
        ? requestData.providerOptions
        : null;

    const nestedRoute = this.normalizeBananaImageRoute(providerOptions?.banana?.imageRoute);
    if (nestedRoute) return nestedRoute;

    const optionsLegacyRoute = this.normalizeBananaImageRoute(providerOptions?.bananaImageRoute);
    if (optionsLegacyRoute) return optionsLegacyRoute;

    return this.normalizeBananaImageRoute(requestData?.bananaImageRoute);
  }

  private resolveEffectiveProviderName(task: any, requestData: any): string {
    const providerName = String(task.aiProvider || 'gemini').trim();
    const normalizedProvider = providerName.toLowerCase();
    const normalizedModel = String(requestData?.model || '').trim().toLowerCase();
    const isGptImage2Model = normalizedModel.includes('gpt-image-2');

    if (!isGptImage2Model) return providerName;

    const route = this.resolveTaskBananaImageRoute(requestData);
    if (route === 'stable' && !normalizedProvider.startsWith('banana')) {
      this.logger.log(
        `[ImageTask] forcing provider to banana for gpt-image-2 stable route (from=${providerName || 'gemini'})`,
      );
      return 'banana';
    }

    if (normalizedProvider === 'gemini') {
      return 'nano2';
    }

    return providerName;
  }

  private async executeWithProviderOrGemini(taskType: ImageTaskType, task: any): Promise<any> {
    const requestData = task.requestData as any;
    const effectiveProviderName = this.resolveEffectiveProviderName(task, requestData);

    if (effectiveProviderName && effectiveProviderName !== 'gemini') {
      const provider = this.providerFactory.getProvider(requestData?.model, effectiveProviderName);
      let providerResult: any;

      switch (taskType) {
        case 'generate':
          providerResult = await provider.generateImage(requestData);
          break;
        case 'edit':
          providerResult = await provider.editImage(requestData);
          break;
        case 'blend':
          providerResult = await provider.blendImages(requestData);
          break;
        default:
          throw new Error(`Unsupported task type for provider path: ${taskType}`);
      }

      if (!providerResult?.success || !providerResult?.data) {
        const message =
          providerResult?.error?.message || `Provider ${effectiveProviderName} returned failed response`;
        throw new Error(message);
      }

      const normalized = this.extractProviderImagePayload(providerResult.data);
      if (!normalized.imageUrl && !normalized.imageData) {
        throw new BadGatewayException('Provider task succeeded but no image payload returned');
      }

      return {
        ...providerResult.data,
        ...normalized,
      };
    }

    switch (taskType) {
      case 'generate':
        return this.imageGenService.generateImage(requestData);
      case 'edit':
        return this.imageGenService.editImage(requestData);
      case 'blend':
        return this.imageGenService.blendImages(requestData);
      default:
        throw new Error(`Unsupported task type: ${taskType}`);
    }
  }

  private extractBase64Payload(imageValue: string): string {
    const trimmed = imageValue.trim();
    const match = trimmed.match(/^data:[^;,]+;base64,(.+)$/i);
    return (match ? match[1] : trimmed).replace(/\s+/g, '');
  }

  private inferImageMimeFromBuffer(buffer: Buffer): { mimeType: string; extension: string } {
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    ) {
      return { mimeType: 'image/png', extension: 'png' };
    }

    if (buffer.length >= 3 && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    }

    if (buffer.length >= 6) {
      const header = buffer.subarray(0, 6).toString('ascii');
      if (header === 'GIF87a' || header === 'GIF89a') {
        return { mimeType: 'image/gif', extension: 'gif' };
      }
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { mimeType: 'image/webp', extension: 'webp' };
    }

    throw new BadGatewayException('图像任务输出不是受支持的图片格式，无法上传到 OSS');
  }

  private async uploadImagePayloadToOss(
    imageValue: string,
    userId: string,
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException('OSS 未配置或已禁用，无法持久化图像任务结果');
    }

    const payload = this.extractBase64Payload(imageValue);
    if (!payload) {
      throw new BadGatewayException('图像任务输出为空，无法上传到 OSS');
    }

    const decodeCandidate = (encoding: BufferEncoding): Buffer => {
      try {
        return Buffer.from(payload, encoding);
      } catch {
        return Buffer.alloc(0);
      }
    };

    let buffer = decodeCandidate('base64');
    if (!buffer.length) {
      buffer = decodeCandidate('base64url');
    }
    if (!buffer.length) {
      throw new BadGatewayException('图像任务输出解码失败，无法上传到 OSS');
    }

    let mimeType: string;
    let extension: string;
    try {
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(buffer));
    } catch (error) {
      const bufferAlt = decodeCandidate('base64url');
      if (!bufferAlt.length) throw error;
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(bufferAlt));
      buffer = bufferAlt;
    }

    const userTag = crypto.createHash('sha1').update(String(userId)).digest('hex').slice(0, 8);
    const key = `uploads/ai/tasks/${userTag}/${Date.now()}-${crypto
      .randomBytes(6)
      .toString('hex')}.${extension}`;

    const { url } = await this.oss.putStream(key, Readable.from(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

    return { url, key, mimeType, size: buffer.length };
  }

  private async uploadRemoteImageToOss(
    imageUrl: string,
    userId: string,
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException('OSS 未配置或已禁用，无法持久化图像任务结果');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new BadGatewayException(`抓取图像任务外链失败: HTTP ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new BadGatewayException(`图像任务外链返回了非法 content-type: ${contentType || 'unknown'}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const { mimeType, extension } = this.inferImageMimeFromBuffer(buffer);
      const userTag = crypto.createHash('sha1').update(String(userId)).digest('hex').slice(0, 8);
      const key = `uploads/ai/tasks/${userTag}/${Date.now()}-${crypto
        .randomBytes(6)
        .toString('hex')}.${extension}`;

      const { url } = await this.oss.putStream(key, Readable.from(buffer), {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });

      return { url, key, mimeType, size: buffer.length };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 创建图像生成任务
   */
  async createTask(
    userId: string,
    type: ImageTaskType,
    prompt: string,
    requestData: Record<string, any>,
    aiProvider?: string,
    traceContext?: PersistedTraceContext,
  ) {
    const persistedTraceContext = captureTraceContext(traceContext);
    const requestPayload = {
      ...(requestData || {}),
      traceId: persistedTraceContext.traceId || null,
      parentRequestId: persistedTraceContext.parentRequestId || null,
      parentSpanId: persistedTraceContext.parentSpanId || null,
      traceFlags: persistedTraceContext.traceFlags ?? 1,
    };

    const task = await this.prisma.imageTask.create({
      data: {
        userId,
        type,
        prompt,
        requestData: requestPayload,
        aiProvider,
        status: 'queued',
        retryCount: 0,
      },
    });

    this.logger.log(`创建图像任务: taskId=${task.id}, type=${type}, userId=${userId}`);
    void this.telemetryService.ingestGenerationTask({
      traceId: persistedTraceContext.traceId || null,
      parentRequestId: persistedTraceContext.parentRequestId || null,
      taskId: task.id,
      taskType: type,
      stage: 'queued',
      userId,
      provider: aiProvider || null,
      prompt: prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        requestKeys: Object.keys(requestPayload),
      },
      receivedAt: new Date().toISOString(),
    });

    // 异步执行任务（不等待）
    this.executeTask(task.id).catch((error) => {
      this.logger.error(`任务执行失败: taskId=${task.id}, error=${error.message}`);
    });

    return task;
  }

  /**
   * 查询任务状态
   */
  async getTaskStatus(taskId: string, userId: string) {
    const task = await this.prisma.imageTask.findFirst({
      where: { id: taskId, userId },
    });

    if (!task) {
      throw new NotFoundException(`任务不存在: taskId=${taskId}`);
    }

    return task;
  }

  /**
   * 执行图像生成任务
   */
  private async executeTask(taskId: string): Promise<void> {
    const task = await this.prisma.imageTask.findUnique({ where: { id: taskId } });
    if (!task) {
      this.logger.error(`任务不存在: taskId=${taskId}`);
      return;
    }

    const taskRequestData =
      task.requestData && typeof task.requestData === 'object'
        ? (task.requestData as Record<string, any>)
        : null;
    const taskTraceContext: PersistedTraceContext = {
      traceId: taskRequestData?.traceId || null,
      parentRequestId: taskRequestData?.parentRequestId || null,
      parentSpanId: taskRequestData?.parentSpanId || null,
      traceFlags:
        typeof taskRequestData?.traceFlags === 'number' ? taskRequestData.traceFlags : 1,
    };

    // 解析任务的服务类型
    const model = taskRequestData?.model as string | undefined;
    const taskType = task.type as ImageTaskType;
    const serviceType = resolveTaskServiceType(taskType, model);
    const outputImageCount = 1; // 默认生成1张图片
    const apiUsageId = taskRequestData?.apiUsageId as string | undefined;

    // 如果有 apiUsageId，则说明已在控制器层预扣积分；否则需要自己处理
    const needsCreditsProcessing = !apiUsageId;

    await runWithSpan(
      `image-task.${taskType}`,
      taskTraceContext,
      {
        'app.task.id': taskId,
        'app.task.type': task.type,
        'app.user.id': task.userId,
        'app.ai.provider': task.aiProvider || 'unknown',
        'app.credits.apiUsageId': apiUsageId || 'none',
        'app.credits.needsProcessing': needsCreditsProcessing,
      },
      async () => {
        const startedAt = Date.now();
        let effectiveApiUsageId: string | undefined = apiUsageId;

        try {
          // 如果需要自己处理积分，则先预扣积分
          if (needsCreditsProcessing) {
            try {
              const deductResult = await this.creditsService.preDeductCredits({
                userId: task.userId,
                serviceType: serviceType as any,
                model,
                inputImageCount: 0,
                outputImageCount,
                requestParams: {
                  taskId,
                  taskType,
                },
              });
              effectiveApiUsageId = deductResult.apiUsageId;
              this.logger.debug(
                `异步任务预扣积分: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}`
              );
            } catch (deductError) {
              // 预扣积分失败，标记任务失败
              const errorMsg =
                deductError instanceof Error ? deductError.message : String(deductError);
              this.logger.error(`异步任务预扣积分失败: taskId=${taskId}, error=${errorMsg}`);
              await this.prisma.imageTask.update({
                where: { id: taskId },
                data: {
                  status: 'failed',
                  error: `积分预扣失败: ${errorMsg}`,
                  completedAt: new Date(),
                },
              });
              return;
            }
          }

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: { status: 'processing' },
          });
          this.logger.log(
            `开始执行任务: taskId=${taskId}, type=${taskType}, apiUsageId=${effectiveApiUsageId}`
          );
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType,
            stage: 'processing',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'processing',
            metadata: {
              requestKeys: task.requestData && typeof task.requestData === 'object'
                ? Object.keys(task.requestData as Record<string, unknown>)
                : [],
            },
            receivedAt: new Date().toISOString(),
          });

          let result: any;

          switch (taskType) {
            case 'generate':
              result = await this.executeWithProviderOrGemini('generate', task);
              break;
            case 'edit':
              result = await this.executeWithProviderOrGemini('edit', task);
              break;
            case 'blend':
              result = await this.executeWithProviderOrGemini('blend', task);
              break;
            case 'expand':
              throw new Error('扩图功能暂未实现异步模式');
            default:
              throw new Error(`不支持的任务类型: ${taskType}`);
          }

          const taskImagePayload =
            typeof result?.imageUrl === 'string' && /^https?:\/\//i.test(result.imageUrl)
              ? result.imageUrl
              : typeof result?.imageData === 'string'
              ? result.imageData
              : '';

          if (!taskImagePayload) {
            throw new BadGatewayException('Image task succeeded but no image payload returned');
          }

          let persistedImageUrl: string | null = null;
          let persistedThumbnailUrl: string | null = null;
          if (taskImagePayload) {
            if (/^https?:\/\//i.test(taskImagePayload)) {
              const uploaded = await this.uploadRemoteImageToOss(taskImagePayload, task.userId);
              persistedImageUrl = uploaded.url;
              persistedThumbnailUrl = uploaded.url;
            } else {
              const uploaded = await this.uploadImagePayloadToOss(taskImagePayload, task.userId);
              persistedImageUrl = uploaded.url;
              persistedThumbnailUrl = uploaded.url;
            }
          }

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: {
              status: 'succeeded',
              imageUrl: persistedImageUrl,
              thumbnailUrl: persistedThumbnailUrl,
              textResponse: result.textResponse,
              completedAt: new Date(),
            },
          });

          // 任务成功，更新积分状态为成功
          if (effectiveApiUsageId) {
            try {
              await this.creditsService.updateApiUsageStatus(
                effectiveApiUsageId,
                ApiResponseStatus.SUCCESS,
                undefined,
                Date.now() - startedAt
              );
            } catch (updateError) {
              this.logger.warn(
                `更新API使用记录状态失败: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}, error=${updateError}`
              );
            }
          }

          this.logger.log(`任务执行成功: taskId=${taskId}`);
          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType,
            stage: 'succeeded',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'succeeded',
            durationMs: Date.now() - startedAt,
            metadata: {
              hasImage: Boolean(persistedImageUrl),
              hasTextResponse: Boolean(result?.textResponse),
            },
            receivedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`任务执行失败: taskId=${taskId}, error=${errorMessage}`);

          await this.prisma.imageTask.update({
            where: { id: taskId },
            data: {
              status: 'failed',
              error: errorMessage || '图像生成失败',
              completedAt: new Date(),
            },
          });

          // GPT-image-2 节点失败时不返还积分
          const resolvedServiceType = resolveTaskServiceType(taskType, taskRequestData?.model || undefined);
          const skipRefund = resolvedServiceType === 'gpt-image-2';

          // 任务失败，标记积分状态为失败
          if (effectiveApiUsageId) {
            try {
              await this.creditsService.updateApiUsageStatus(
                effectiveApiUsageId,
                ApiResponseStatus.FAILED,
                errorMessage,
                Date.now() - startedAt
              );

              if (skipRefund) {
                this.logger.warn(
                  `异步任务失败（不退积分）: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}, serviceType=${resolvedServiceType}`
                );
              } else {
                // 执行退款
                await this.creditsService.refundCredits(task.userId, effectiveApiUsageId);
                this.logger.log(
                  `异步任务失败已退款: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}`
                );
              }
            } catch (creditsError) {
              const creditsErrorMsg =
                creditsError instanceof Error ? creditsError.message : String(creditsError);
              this.logger.error(
                `异步任务积分退款失败: taskId=${taskId}, apiUsageId=${effectiveApiUsageId}, error=${creditsErrorMsg}`
              );
            }
          }

          void this.telemetryService.ingestGenerationTask({
            traceId: taskTraceContext.traceId || null,
            parentRequestId: taskTraceContext.parentRequestId || null,
            taskId,
            taskType,
            stage: 'failed',
            userId: task.userId,
            provider: task.aiProvider || null,
            prompt: task.prompt?.slice(0, 500) || null,
            status: 'failed',
            error: errorMessage || '图像生成失败',
            receivedAt: new Date().toISOString(),
          });
        }
      },
    );
  }
}
