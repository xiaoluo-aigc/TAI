import {
  Body,
  Controller,
  Logger,
  Post,
  UseGuards,
  ServiceUnavailableException,
  BadGatewayException,
  InternalServerErrorException,
  HttpException,
  Get,
  Optional,
  Req,
  BadRequestException,
  ForbiddenException,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageGenerationService, ImageGenerationResult } from './image-generation.service';
import { BackgroundRemovalService } from './services/background-removal.service';
import { ImageTaskService } from './services/image-task.service';
import { AIProviderFactory } from './ai-provider.factory';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ToolSelectionRequestDto } from './dto/tool-selection.dto';
import { RemoveBackgroundDto } from './dto/background-removal.dto';
import { getGeminiApiKeyFromEnv } from './services/gemini-api-key.util';
import {
  GenerateImageDto,
  EditImageDto,
  BlendImagesDto,
  AnalyzeImageDto,
  TextChatDto,
  MidjourneyActionDto,
  MidjourneyModalDto,
  Convert2Dto3DDto,
  ExpandImageDto,
} from './dto/image-generation.dto';
import { MinimaxSpeechDto } from './dto/minimax-speech.dto';
import { MinimaxMusicDto } from './dto/minimax-music.dto';
import { TencentSpeechDto } from './dto/tencent-speech.dto';
import { PaperJSGenerateRequestDto, PaperJSGenerateResponseDto } from './dto/paperjs-generation.dto';
import { Img2VectorRequestDto, Img2VectorResponseDto } from './dto/img2vector.dto';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { MidjourneyProvider } from './providers/midjourney.provider';
import { UsersService } from '../users/users.service';
import { CreditsService } from '../credits/credits.service';
import { ServiceType } from '../credits/credits.config';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { GenerateVideoDto } from './dto/video-generation.dto';
import { CreateSora2CharacterDto } from './dto/sora2-character.dto';
import { VeoGenerateVideoDto, VeoVideoResponseDto, VeoModelsResponseDto } from './dto/veo-video.dto';
import { Sora2VideoService } from './services/sora2-video.service';
import { VeoVideoService } from './services/veo-video.service';
import { VideoProviderService } from './services/video-provider.service';
import { ModelRoutingService } from './services/model-routing.service';
import { MinimaxSpeechService } from './services/minimax-speech.service';
import { MinimaxMusicService } from './services/minimax-music.service';
import { TencentSpeechService } from './services/tencent-speech.service';
import { PrismaService } from '../prisma/prisma.service';
import { applyWatermarkToBase64 } from './services/watermark.util';
import { VideoWatermarkService } from './services/video-watermark.service';
import {
  createAsyncTask,
  updateAsyncTask,
  getAsyncTaskResult,
} from './services/async-video-task.store';
import { VideoProviderRequestDto } from './dto/video-provider.dto';
import { AnalyzeVideoDto } from './dto/video-analysis.dto';
import { OssService } from '../oss/oss.service';
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { Readable } from 'stream';
import { verify } from 'jsonwebtoken';
import { OpenObserveTelemetryService } from '../telemetry/openobserve-telemetry.service';
import { captureTraceContext, runWithSpan, type PersistedTraceContext } from '../telemetry/tracing';

type GenerateImageUrlResult = {
  imageUrl: string;
  textResponse: string;
  metadata?: Record<string, any>;
};

type TraceableReq = {
  id?: string;
  traceId?: string;
  headers?: Record<string, unknown>;
};

const MANAGED_IMAGE_KEY_REGEX = /^(projects|uploads|templates|videos|ai)\//i;
const FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';
const PRIVILEGED_ADMIN_ROLES = new Set(['admin', 'normal_admin']);

@ApiTags('ai')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);
  private readonly providerDefaultImageModels: Record<string, string> = {
    gemini: 'gemini-2.5-flash-image-preview',
    'gemini-pro': 'gemini-3-flash-preview',
    banana: 'gemini-3-flash-preview',
    'banana-2.5': 'gemini-2.5-flash-image-preview',
    'banana-3.1': 'gemini-3.1-flash-image-preview',
    runninghub: 'runninghub-su-effect',
    midjourney: 'midjourney-fast',
    nano2: 'gemini-3.1-flash-image-preview',
    seedream5: 'doubao-seedream-5-0-260128',
  };
  private readonly providerDefaultTextModels: Record<string, string> = {
    gemini: 'gemini-3.1-pro',
    'gemini-pro': 'gemini-3.1-pro',
    banana: 'gemini-3-flash-preview',
    'banana-2.5': 'gemini-2.5-flash',
    'banana-3.1': 'gemini-3.1-pro-preview',
    runninghub: 'gemini-3.1-pro',
    midjourney: 'gemini-3.1-pro',
    nano2: 'gemini-3.1-pro-preview',
    seedream5: 'gemini-3.1-pro',
  };
  private readonly providerDefaultAnalyzeModels: Record<string, string> = {
    gemini: 'gemini-3.1-pro',
    'gemini-pro': 'gemini-3.1-pro',
    banana: 'gemini-2.5-flash-image-preview',
    'banana-2.5': 'gemini-2.5-flash-image-preview',
    'banana-3.1': 'gemini-3.1-flash-image-preview',
    runninghub: 'gemini-3.1-pro',
    midjourney: 'gemini-3.1-pro',
    nano2: 'gemini-3.1-flash-image-preview',
    seedream5: 'gemini-3.1-pro',
  };

  private getHttpErrorMessage(status: number): string {
    const messages: Record<number, string> = {
      400: '请求参数错误，请检查输入内容',
      401: 'API密钥无效或已过期，请检查配置',
      403: '权限不足，无法访问该服务',
      404: '请求的资源不存在',
      408: '请求超时，请重试',
      413: '请求数据过大，请压缩图片或减小文件大小',
      429: '请求过于频繁，请稍后重试',
      500: '服务器内部错误，请稍后重试',
      502: '网关错误，服务暂时不可用',
      503: '服务暂时不可用，请稍后重试',
      504: '网关超时，请稍后重试',
      524: '服务器处理超时，请稍后重试或简化请求内容',
    };
    return messages[status] || `服务器返回错误 ${status}`;
  }

  private normalizeSeedance2Access(value: unknown): 'enabled' | 'disabled' {
    return this.normalizePlanFeatureAccess(value);
  }

  private normalizePlanFeatureAccess(value: unknown): 'enabled' | 'disabled' {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      normalized === 'enabled' ||
      normalized === 'allow' ||
      normalized === 'on' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'vip' ||
      normalized === 'supported' ||
      normalized === 'support' ||
      normalized === '支持' ||
      normalized === '可用' ||
      normalized === '1'
    ) {
      return 'enabled';
    }
    if (typeof value === 'boolean') {
      return value ? 'enabled' : 'disabled';
    }
    if (typeof value === 'number') {
      return value > 0 ? 'enabled' : 'disabled';
    }
    return 'disabled';
  }

  private normalizeNoWatermarkAccess(value: unknown): 'enabled' | 'disabled' {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      normalized === 'enabled' ||
      normalized === 'allow' ||
      normalized === 'on' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'vip' ||
      normalized === 'supported' ||
      normalized === 'support' ||
      normalized === '支持' ||
      normalized === '可用' ||
      normalized === '1'
    ) {
      return 'enabled';
    }

    if (typeof value === 'boolean') {
      return value ? 'enabled' : 'disabled';
    }
    if (typeof value === 'number') {
      return value > 0 ? 'enabled' : 'disabled';
    }
    return 'disabled';
  }

  private async resolveUserNoWatermarkAccess(userId: string): Promise<'enabled' | 'disabled'> {
    const now = new Date();
    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
        currentPeriodStartAt: { lte: now },
        currentPeriodEndAt: { gt: now },
      },
      select: {
        membershipPlanId: true,
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!subscription?.membershipPlanId) {
      return 'disabled';
    }

    const plan = await this.prisma.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
      select: { metadata: true },
    });

    if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
      const metadata = plan.metadata as Record<string, unknown>;
      const explicitNoWatermark =
        metadata.noWatermarkAccess ??
        metadata.removeWatermarkAccess ??
        metadata.watermarkFree ??
        metadata.noWatermark;

      // No default VIP bypass: must be explicitly enabled on the membership plan.
      if (
        explicitNoWatermark === undefined ||
        explicitNoWatermark === null ||
        explicitNoWatermark === ''
      ) {
        return 'disabled';
      }
      return this.normalizeNoWatermarkAccess(explicitNoWatermark);
    }

    // Plan metadata absent: default to disabled.
    return 'disabled';
  }

  private async resolveUserSeedance2Access(userId: string): Promise<'enabled' | 'disabled'> {
    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
        currentPeriodStartAt: { lte: new Date() },
        currentPeriodEndAt: { gt: new Date() },
      },
      select: {
        membershipPlanId: true,
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (subscription?.membershipPlanId) {
      const plan = await this.prisma.membershipPlan.findUnique({
        where: { id: subscription.membershipPlanId },
        select: { metadata: true },
      });
      if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
        return this.normalizeSeedance2Access(
          (plan.metadata as Record<string, unknown>).seedance2Access,
        );
      }
      return 'disabled';
    }

    const freeTierSetting = await this.prisma.systemSetting.findUnique({
      where: { key: FREE_TIER_BENEFITS_SETTING_KEY },
      select: { value: true },
    });
    if (!freeTierSetting?.value) {
      return 'disabled';
    }

    try {
      const parsed = JSON.parse(freeTierSetting.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return this.normalizeSeedance2Access(
          (parsed as Record<string, unknown>).seedance2Access,
        );
      }
    } catch {
      return 'disabled';
    }

    return 'disabled';
  }

  private async resolveUserHappyhorseAccess(userId: string): Promise<'enabled' | 'disabled'> {
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: 'paid',
        paidAt: { not: null },
      },
      select: { id: true },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (paidOrder) {
      return 'enabled';
    }

    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
        currentPeriodStartAt: { lte: new Date() },
        currentPeriodEndAt: { gt: new Date() },
      },
      select: {
        membershipPlanId: true,
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!subscription?.membershipPlanId) {
      return 'disabled';
    }

    const plan = await this.prisma.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
      select: { metadata: true },
    });

    if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
      const metadata = plan.metadata as Record<string, unknown>;
      return this.normalizePlanFeatureAccess(
        metadata.happyhorseAccess ?? metadata.happyhorseVideoAccess,
      );
    }

    return 'disabled';
  }

  private async assertHappyhorseEntitlement(userId: string | null): Promise<void> {
    if (!userId) {
      throw new ForbiddenException('快乐马仅支持已充值或已开通对应套餐权益的付费用户使用');
    }

    const access = await this.resolveUserHappyhorseAccess(userId);
    if (access !== 'enabled') {
      throw new ForbiddenException('快乐马仅支持已充值或已开通对应套餐权益的付费用户使用');
    }
  }

  private async assertSeedance2Entitlement(
    userId: string | null,
    dto: VideoProviderRequestDto,
    req: any,
  ): Promise<void> {
    const normalizedProvider = String(dto.provider || '').trim().toLowerCase();
    const normalizedSeedanceModel = String(dto.seedanceModel || '').trim().toLowerCase();
    const isSeedance2Request =
      normalizedProvider === 'doubao' &&
      (normalizedSeedanceModel === 'seedance-2.0' ||
        normalizedSeedanceModel === '2.0' ||
        normalizedSeedanceModel === 'seedance-2.0-fast' ||
        normalizedSeedanceModel === '2.0-fast');

    if (!isSeedance2Request || !userId) {
      return;
    }

    const access = await this.resolveSeedance2CombinedAccess(userId, req);
    if (!access.allowed) {
      throw new BadRequestException(
        'Seedance 2.0 / 2.0 Fast requires VIP access or watermark whitelist access',
      );
    }
  }

  constructor(
    private readonly ai: AiService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly backgroundRemoval: BackgroundRemovalService,
    private readonly factory: AIProviderFactory,
    private readonly convert2Dto3DService: Convert2Dto3DService,
    private readonly expandImageService: ExpandImageService,
    private readonly usersService: UsersService,
    private readonly creditsService: CreditsService,
    private readonly sora2VideoService: Sora2VideoService,
    private readonly videoWatermarkService: VideoWatermarkService,
    private readonly veoVideoService: VeoVideoService,
    private readonly videoProviderService: VideoProviderService,
    private readonly modelRoutingService: ModelRoutingService,
    private readonly minimaxSpeechService: MinimaxSpeechService,
    private readonly tencentSpeechService: TencentSpeechService,
    private readonly minimaxMusicService: MinimaxMusicService,
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
    private readonly telemetryService: OpenObserveTelemetryService,
    @Optional() private readonly imageTaskService?: ImageTaskService,
  ) {}

  private extractAccessToken(req: any): string | null {
    const cookieToken = req?.cookies?.access_token;
    if (typeof cookieToken === 'string' && cookieToken.trim()) {
      return cookieToken.trim();
    }

    const authHeader = req?.headers?.authorization ?? req?.headers?.Authorization;
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * 兼容无守卫场景：优先读取 req.user，其次尝试校验 access token 提取 userId。
   */
  private resolveRequestUserId(req: any): string | null {
    const fromUser = req?.user?.id || req?.user?.sub;
    if (typeof fromUser === 'string' && fromUser.length > 0) {
      return fromUser;
    }

    const token = this.extractAccessToken(req);
    if (!token) {
      return null;
    }

    const secret = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
    try {
      const payload = verify(token, secret) as { sub?: string; id?: string };
      const fromToken = payload?.sub || payload?.id;
      return typeof fromToken === 'string' && fromToken.length > 0 ? fromToken : null;
    } catch {
      return null;
    }
  }

  private normalizeRole(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private isPrivilegedAdminRole(role: unknown): boolean {
    const normalized = this.normalizeRole(role);
    return normalized.length > 0 && PRIVILEGED_ADMIN_ROLES.has(normalized);
  }

  private isSeedance20Model(seedanceModel: unknown): boolean {
    const normalized = typeof seedanceModel === 'string' ? seedanceModel.trim().toLowerCase() : '';
    return (
      normalized === 'seedance-2.0' ||
      normalized === '2.0' ||
      normalized === 'seedance-2.0-fast' ||
      normalized === '2.0-fast'
    );
  }

  private async resolveSeedance2CombinedAccess(
    userId: string,
    req: any,
  ): Promise<{
    allowed: boolean;
    byVip: boolean;
    byWhitelist: boolean;
    byAdmin: boolean;
  }> {
    let byAdmin = this.isPrivilegedAdminRole(req?.user?.role);
    let byWhitelist = false;

    try {
      const user = await this.usersService.findById(userId);
      byAdmin = byAdmin || this.isPrivilegedAdminRole(user?.role);
      byWhitelist = byAdmin || user?.noWatermark === true;
    } catch (e) {
      this.logger.warn('Failed to resolve watermark whitelist for Seedance 2.0 access check', e);
      byWhitelist = await this.canSkipWatermark(req);
    }

    const byVip = (await this.resolveUserSeedance2Access(userId)) === 'enabled';

    return {
      allowed: byVip || byWhitelist,
      byVip,
      byWhitelist,
      byAdmin,
    };
  }

  private async canSkipWatermark(req: any): Promise<boolean> {
    const userId = this.resolveRequestUserId(req);
    if (!userId) {
      return false;
    }
    try {
      const user = await this.usersService.findById(userId);
      if (this.isPrivilegedAdminRole(user?.role) || user?.noWatermark === true) {
        return true;
      }
      return (await this.resolveUserNoWatermarkAccess(userId)) === 'enabled';
    } catch (e) {
      this.logger.warn('检查水印白名单失败', e);
      return false;
    }
  }

  /**
   * 对返回的 base64 图片统一加水印；管理员/白名单用户或失败时返回原图
   */
  private async watermarkIfNeeded(
    imageData?: string | null,
    req?: any
  ): Promise<string | undefined> {
    if (!imageData) return imageData ?? undefined;

    // 检查是否可以跳过水印（管理员或白名单用户）
    const skipWatermark = await this.canSkipWatermark(req);
    if (skipWatermark) {
      return imageData;
    }

    try {
      return await applyWatermarkToBase64(imageData, { text: 'Tanvas AI' });
    } catch (error) {
      this.logger.warn('Watermark failed, fallback to original image', error as any);
      return imageData;
    }
  }

  private extractBase64Payload(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (trimmed.startsWith('data:')) {
      const commaIndex = trimmed.indexOf(',');
      return commaIndex >= 0 ? trimmed.slice(commaIndex + 1).trim() : '';
    }

    const base64Index = trimmed.indexOf('base64,');
    if (base64Index >= 0) {
      return trimmed.slice(base64Index + 'base64,'.length).trim();
    }

    return trimmed;
  }

  private inferImageMimeFromBuffer(buffer: Buffer): { mimeType: string; extension: string } {
    if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
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

    throw new BadGatewayException('生成图像数据不是受支持的图片格式，无法上传。');
  }

  private async uploadGeneratedImageToOss(
    imageBase64: string,
    options?: { userId?: string }
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException(
        'OSS 未配置或已禁用，无法上传生成图片并返回远程 URL（请配置 OSS_* 环境变量，或设置 OSS_ENABLED=true）。'
      );
    }

    const payload = this.extractBase64Payload(imageBase64).replace(/\s+/g, '');
    if (!payload) {
      throw new BadGatewayException('生成图像数据为空，无法上传。');
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
      throw new BadGatewayException('生成图像数据解码失败（空内容），无法上传。');
    }

    let mimeType: string;
    let extension: string;
    try {
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(buffer));
    } catch (error) {
      // base64/base64url 解码结果可能不同（尤其是 URL-safe 字符）
      const bufferAlt = decodeCandidate('base64url');
      if (!bufferAlt.length) {
        throw error;
      }
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(bufferAlt));
      buffer = bufferAlt;
    }
    const randomId = crypto.randomBytes(6).toString('hex');
    const timestamp = Date.now();
    const userTag = options?.userId
      ? crypto.createHash('sha1').update(String(options.userId)).digest('hex').slice(0, 8)
      : 'anonymous';
    const key = `uploads/ai/generated/${userTag}/${timestamp}-${randomId}.${extension}`;

    const stream = Readable.from(buffer);
    const { url } = await this.oss.putStream(key, stream, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

    return { url, key, mimeType, size: buffer.length };
  }

  /**
   * 从请求中获取用户的自定义 Google API Key
   * 如果用户设置了自定义 Key 且 mode 为 'custom'，则返回该 Key
   * 否则返回 null（使用系统默认 Key）
   */
  private async getUserCustomApiKey(req: any): Promise<string | null> {
    try {
      // 如果是 API Key 认证（外部调用），不使用用户自定义 Key
      if (req.apiClient) {
        return null;
      }

      // 获取 JWT 中的用户 ID
      const userId = req.user?.sub;
      if (!userId) {
        return null;
      }

      const { apiKey, mode } = await this.usersService.getGoogleApiKey(userId);

      // 只有当 mode 为 'custom' 且有 apiKey 时才使用
      if (mode === 'custom' && apiKey) {
        this.logger.debug(`Using custom Google API Key for user ${userId.slice(0, 8)}...`);
        return apiKey;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get user custom API key:', error);
      return null;
    }
  }

  /**
   * 判断是否是支持自定义 API Key 的 provider
   * gemini 和 gemini-pro 都支持使用用户自定义的 Google API Key
   */
  private isGeminiProvider(providerName: string | null): boolean {
    return !providerName || providerName === 'gemini' || providerName === 'gemini-pro';
  }

  /**
   * 获取用户ID（从JWT或API Key认证）
   * API Key 认证不扣积分
   */
  private getUserId(req: any): string | null {
    // API Key 认证不扣积分
    if (req.apiClient) {
      return null;
    }
    return req.user?.sub || req.user?.id || null;
  }

  private extractIdempotencyKey(
    req: any,
    requestBody?: Record<string, any>,
  ): string | undefined {
    const pickHeader = (headerName: string): string | undefined => {
      const raw = req?.headers?.[headerName];
      if (Array.isArray(raw)) {
        const first = raw.find((item) => typeof item === 'string' && item.trim().length > 0);
        return typeof first === 'string' ? first.trim() : undefined;
      }
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
      }
      return undefined;
    };

    const bodyKey =
      requestBody && typeof requestBody.idempotencyKey === 'string'
        ? requestBody.idempotencyKey.trim()
        : '';
    const key =
      pickHeader('idempotency-key') ||
      pickHeader('Idempotency-Key') ||
      pickHeader('x-idempotency-key') ||
      pickHeader('x-request-id') ||
      (bodyKey.length > 0 ? bodyKey : undefined);
    if (!key) return undefined;
    return key.slice(0, 128);
  }

  /**
   * 确定图像生成服务类型
   */
  private getImageGenerationServiceType(model?: string, provider?: string): ServiceType {
    const normalizedModel = model?.trim().toLowerCase();

    if (normalizedModel?.includes('gpt-image-2')) {
      return 'gpt-image-2';
    }

    // 根据 provider 和 model 确定服务类型
    if (provider === 'midjourney') {
      return 'midjourney-imagine';
    }

    if (provider === 'seedream5' || normalizedModel?.includes('seedream')) {
      return 'doubao-seedream-5-0-260128';
    }

    if (normalizedModel?.includes('gemini-3.1')) {
      return 'gemini-3.1-image';
    }

    // Gemini 模型
    if (normalizedModel?.includes('gemini-3') || normalizedModel?.includes('imagen-3')) {
      return 'gemini-3-pro-image';
    }

    return 'gemini-2.5-image';
  }

  private normalizeChannelName(channel: string | null | undefined): string | null {
    if (!channel) return null;
    const value = channel.trim().toLowerCase();
    if (!value) return null;
    if (value.includes('apimart')) return 'apimart';
    if (value === 'legacy' || value.includes('147')) return '147';
    if (value === 'stable' || value.includes('tencent') || value.includes('nano')) return 'tencent';
    return value;
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }

  private hasNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private hasNonEmptyStringInList(value: unknown): boolean {
    return Array.isArray(value) && value.some((item) => this.hasNonEmptyString(item));
  }

  private hasImagePayload(result: unknown): boolean {
    const payload = this.asRecord(result);
    if (!payload) return false;
    const metadata = this.asRecord(payload.metadata);

    if (this.hasNonEmptyString(payload.imageData)) return true;
    if (this.hasNonEmptyString(payload.imageUrl)) return true;
    if (this.hasNonEmptyStringInList(payload.imageUrls)) return true;
    if (this.hasNonEmptyStringInList(payload.images)) return true;

    if (!metadata) return false;
    if (this.hasNonEmptyString(metadata.imageData)) return true;
    if (this.hasNonEmptyString(metadata.imageUrl)) return true;
    if (this.hasNonEmptyStringInList(metadata.imageUrls)) return true;
    if (this.hasNonEmptyStringInList(metadata.images)) return true;

    return false;
  }

  private extractExecutionChannel(result: unknown): string | null {
    const payload = this.asRecord(result);
    if (!payload) return null;

    const metadata = this.asRecord(payload.metadata);
    if (metadata && typeof metadata.provider === 'string') {
      return this.normalizeChannelName(metadata.provider);
    }

    if (typeof payload.provider === 'string') {
      return this.normalizeChannelName(payload.provider);
    }

    return null;
  }

  private buildCreditRequestParams(
    providerName: string | null,
    extraParams?: Record<string, any>,
    providerOptions?: Record<string, any>,
  ): Record<string, any> {
    const aiProvider = providerName || 'gemini';
    const bananaImageRoute = this.resolveBananaImageRouteFromProviderOptions(
      providerOptions,
    );
    const channelHint =
      bananaImageRoute === 'stable'
        ? 'tencent'
        : bananaImageRoute === 'normal'
        ? 'apimart'
        : aiProvider === 'nano2'
        ? 'apimart'
        : aiProvider.startsWith('banana')
        ? '147'
        : undefined;

    return {
      ...(extraParams || {}),
      aiProvider,
      channelHint,
      ...(bananaImageRoute ? { bananaImageRoute } : {}),
    };
  }

  private summarizeRequestPrompt(prompt?: string | null): string | undefined {
    if (typeof prompt !== 'string') return undefined;
    const trimmed = prompt.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private extractRenderableRequestImageRefs(values: unknown[]): string[] {
    const candidates: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) continue;
      if (/^[A-Za-z0-9+/=]{80,}$/.test(trimmed)) continue;
      if (!candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    }
    return candidates;
  }

  private buildRequestPromptAndImageParams(
    prompt: string | undefined | null,
    imageRefs?: unknown[],
  ): Record<string, any> {
    const requestPrompt = this.summarizeRequestPrompt(prompt);
    const requestThumbnailUrls = this.extractRenderableRequestImageRefs(
      Array.isArray(imageRefs) ? imageRefs : [],
    );

    return {
      ...(requestPrompt ? { requestPrompt } : {}),
      ...(requestThumbnailUrls[0] ? { requestThumbnailUrl: requestThumbnailUrls[0] } : {}),
      ...(requestThumbnailUrls.length > 0 ? { requestThumbnailUrls } : {}),
    };
  }

  private async buildVideoProviderCreditParams(
    dto: VideoProviderRequestDto,
  ): Promise<Record<string, any>> {
    const params: Record<string, any> = {
      aiProvider: dto.provider,
      ...this.buildRequestPromptAndImageParams(dto.prompt, dto.referenceImages),
    };

    const preferredVendorKey =
      typeof dto.vendorKey === 'string' && dto.vendorKey.trim().length > 0
        ? dto.vendorKey.trim()
        : undefined;

    if (typeof dto.managedModelKey === 'string' && dto.managedModelKey.trim().length > 0) {
      params.managedModelKey = dto.managedModelKey.trim();
    }

    if (preferredVendorKey) {
      params.vendorKey = preferredVendorKey;
    }

    if (typeof dto.platformKey === 'string' && dto.platformKey.trim().length > 0) {
      params.platformKey = dto.platformKey.trim();
    }

    if (dto.klingModel) {
      params.klingModel = dto.klingModel;
    }

    if (dto.viduModel) {
      params.viduModel = dto.viduModel;
    }
    if (dto.viduModelVariant) {
      params.viduModelVariant = dto.viduModelVariant;
    }

    if (dto.seedanceModel) {
      params.seedanceModel = dto.seedanceModel;
    }

    if (typeof dto.mode === 'string' && dto.mode.trim().length > 0) {
      params.mode = dto.mode.trim().toLowerCase();
    }

    if (typeof dto.sound !== 'undefined') {
      params.sound = dto.sound;
      if (typeof dto.sound === 'boolean') {
        params.hasAudio = dto.sound;
      } else if (typeof dto.sound === 'string') {
        const normalizedSound = dto.sound.trim().toLowerCase();
        if (['on', 'true', 'yes', '1'].includes(normalizedSound)) {
          params.hasAudio = true;
        } else if (['off', 'false', 'no', '0'].includes(normalizedSound)) {
          params.hasAudio = false;
        }
      }
    }

    if (typeof dto.duration === 'number' && Number.isFinite(dto.duration)) {
      const normalizedDuration = Math.round(dto.duration);
      params.duration = normalizedDuration;
      params.durationSec = normalizedDuration;
    }

    if (typeof dto.resolution === 'string' && dto.resolution.trim().length > 0) {
      params.resolution = dto.resolution.trim().toUpperCase();
    }

    if (typeof dto.aspectRatio === 'string' && dto.aspectRatio.trim().length > 0) {
      params.aspectRatio = dto.aspectRatio.trim();
    }

    if (typeof dto.videoMode === 'string' && dto.videoMode.trim().length > 0) {
      const normalizedVideoMode = dto.videoMode.trim().toLowerCase();
      params.videoMode = normalizedVideoMode;
      params.generationMode = normalizedVideoMode;
    }

    if (typeof dto.klingStoryboardMode === 'string' && dto.klingStoryboardMode.trim().length > 0) {
      params.klingStoryboardMode = dto.klingStoryboardMode.trim().toLowerCase();
    }

    if (typeof dto.generateAudio === 'boolean') {
      params.generateAudio = dto.generateAudio;
      params.hasAudio = dto.generateAudio;
    }

    if (typeof dto.watermark === 'boolean') {
      params.watermark = dto.watermark;
    }

    if (typeof dto.offPeak === 'boolean') {
      params.offPeak = dto.offPeak;
    }

    const referenceImageCount = Array.isArray(dto.referenceImages) ? dto.referenceImages.length : 0;
    const referenceVideoCount = Array.isArray(dto.referenceVideos) ? dto.referenceVideos.length : 0;
    const audioCount = Array.isArray(dto.audioUrls) ? dto.audioUrls.length : 0;
    params.referenceImageCount = referenceImageCount;
    params.referenceVideoCount = referenceVideoCount;
    params.audioInputCount = audioCount;
    const normalizedVideoMode =
      typeof dto.videoMode === 'string' && dto.videoMode.trim().length > 0
        ? dto.videoMode.trim().toLowerCase()
        : '';

    if (referenceVideoCount > 0 || typeof dto.referenceVideo === 'string') {
      params.inputType = 'video';
      params.referenceVideo = true;
      params.hasVideoInput = true;
    } else if (referenceImageCount > 0) {
      params.inputType =
        dto.provider === 'doubao' && audioCount > 0 ? 'image_audio' : 'image';
      params.hasVideoInput = false;
    } else if (normalizedVideoMode === 'text' || normalizedVideoMode === 'text2video') {
      params.inputType = 'text';
      params.hasVideoInput = false;
    } else if (normalizedVideoMode) {
      params.inputType = dto.provider === 'doubao' ? 'image' : 'text';
      params.hasVideoInput = false;
    }

    if (dto.provider === 'doubao' && typeof params.inputType !== 'string') {
      params.inputType = normalizedVideoMode === 'text' ? 'text' : 'image';
    }

    const hasPricingParam = (key: string): boolean => {
      const value = params[key];
      return value !== undefined && value !== null && value !== '';
    };

    const assignPricingDefault = (key: string, value: unknown): void => {
      if (value === undefined || value === null || value === '') return;

      if (key === 'duration' || key === 'durationSec') {
        if (hasPricingParam('duration') || hasPricingParam('durationSec')) return;
        const duration = Number(value);
        if (!Number.isFinite(duration) || duration <= 0) return;
        const normalizedDuration = Math.round(duration);
        params.duration = normalizedDuration;
        params.durationSec = normalizedDuration;
        return;
      }

      if (hasPricingParam(key)) return;

      if (key === 'resolution' && typeof value === 'string') {
        const normalizedResolution = value.trim().toUpperCase();
        if (normalizedResolution) params.resolution = normalizedResolution;
        return;
      }

      params[key] = value;

      if (key === 'sound') {
        if (typeof value === 'boolean') {
          params.hasAudio = value;
        } else if (typeof value === 'string') {
          const normalizedSound = value.trim().toLowerCase();
          if (['on', 'true', 'yes', '1'].includes(normalizedSound)) {
            params.hasAudio = true;
          } else if (['off', 'false', 'no', '0'].includes(normalizedSound)) {
            params.hasAudio = false;
          }
        }
      }
    };

    const applyManagedPricingDefaults = (
      route: Awaited<ReturnType<typeof this.modelRoutingService.resolveVideoModel>>,
    ) => {
      const pricing = route?.vendor?.pricing;
      if (!pricing || typeof pricing !== 'object') return;
      const displayConfig = (pricing as Record<string, any>).displayConfig;
      const defaultSelections =
        displayConfig && typeof displayConfig === 'object' && !Array.isArray(displayConfig)
          ? (displayConfig as Record<string, any>).defaultSelections
          : null;
      if (!defaultSelections || typeof defaultSelections !== 'object' || Array.isArray(defaultSelections)) {
        return;
      }

      for (const [key, value] of Object.entries(defaultSelections)) {
        assignPricingDefault(key, value);
      }
    };

    const assignRouteParams = (
      route: Awaited<ReturnType<typeof this.modelRoutingService.resolveVideoModel>>,
    ) => {
      if (!route) return false;
      params.modelKey = route.model.modelKey;
      params.vendorKey = route.vendor.vendorKey;
      params.platformKey = route.vendor.platformKey || route.vendor.vendorKey;
      params.route = route.route;
      params.providerChannel = route.vendor.platformKey || route.vendor.vendorKey;
      params.routedProvider = route.vendor.provider || dto.provider;
      applyManagedPricingDefaults(route);
      return true;
    };

    const normalizedKlingModel =
      typeof dto.klingModel === 'string' ? dto.klingModel.trim().toLowerCase() : '';

    if (
      (dto.provider === 'kling' ||
        dto.provider === 'kling-2.6' ||
        dto.provider === 'kling-o3') &&
      normalizedKlingModel === 'kling-v3-0'
    ) {
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel('kling-3.0', preferredVendorKey),
      );
      return params;
    }

    if (
      (dto.provider === 'kling' || dto.provider === 'kling-2.6') &&
      (normalizedKlingModel === '' || normalizedKlingModel === 'kling-v2-6')
    ) {
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel('kling-2.6', preferredVendorKey),
      );
      return params;
    }

    if (dto.provider === 'kling-o3') {
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel('kling-o3', preferredVendorKey),
      );
      return params;
    }

    if (dto.provider === 'vidu' || dto.provider === 'viduq3-pro') {
      const normalized = String(dto.viduModel || '').trim().toLowerCase();
      const isQ3Family =
        normalized === 'q3' ||
        normalized === 'q3-pro' ||
        normalized === 'q3pro' ||
        normalized === 'q3-turbo' ||
        normalized === 'q3turbo' ||
        normalized === 'q3-mix' ||
        normalized === 'q3mix';
      const modelKey =
        isQ3Family
          ? 'vidu-q3'
          : 'vidu-q2';
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel(modelKey, preferredVendorKey),
      );
      return params;
    }

    if (dto.provider === 'doubao') {
      const normalized = String(dto.seedanceModel || '').trim().toLowerCase();
      const modelKey = this.isSeedance20Model(normalized) ? 'seedance-2.0' : 'seedance-1.5';
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel(modelKey, preferredVendorKey),
      );
      return params;
    }

    params.routedProvider = dto.provider;
    params.providerChannel = dto.provider;
    return params;
  }

  private resolveVideoProviderServiceType(dto: VideoProviderRequestDto): ServiceType {
    const normalizedKlingModel =
      typeof dto.klingModel === 'string' ? dto.klingModel.trim().toLowerCase() : '';

    if (
      (dto.provider === 'kling' ||
        dto.provider === 'kling-2.6' ||
        dto.provider === 'kling-o3') &&
      normalizedKlingModel === 'kling-v3-0'
    ) {
      return 'kling-3.0-video';
    }

    if (
      (dto.provider === 'kling' || dto.provider === 'kling-2.6') &&
      (normalizedKlingModel === '' || normalizedKlingModel === 'kling-v2-6')
    ) {
      return 'kling-2.6-video';
    }

    return `${dto.provider}-video` as ServiceType;
  }

  private emitVideoProviderGenerationTaskLog(params: {
    stage: 'queued' | 'processing' | 'succeeded' | 'failed';
    userId: string | null;
    provider: string;
    prompt?: string;
    status: string;
    taskId: string;
    apiUsageId?: string | null;
    requestParams?: Record<string, any>;
    error?: string | null;
  }): void {
    const { requestParams } = params;
    void this.telemetryService.ingestGenerationTask({
      traceId: null,
      taskId: params.taskId,
      taskType: 'video-provider',
      stage: params.stage,
      userId: params.userId,
      provider: params.provider,
      prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 500) : null,
      status: params.status,
      error: params.error || null,
      metadata: {
        apiUsageId: params.apiUsageId || null,
        modelKey: requestParams?.modelKey || null,
        vendorKey: requestParams?.vendorKey || null,
        platformKey: requestParams?.platformKey || null,
        route: requestParams?.route || null,
        providerChannel: requestParams?.providerChannel || null,
        routedProvider: requestParams?.routedProvider || null,
        klingModel: requestParams?.klingModel || null,
        viduModel: requestParams?.viduModelVariant || requestParams?.viduModel || null,
        seedanceModel: requestParams?.seedanceModel || null,
      },
      receivedAt: new Date().toISOString(),
    });
  }

  private async buildSora2CreditParams(params: {
    selectedSoraModel: string;
    quality: 'sd' | 'hd';
    aspectRatio?: string;
    duration?: string;
  }): Promise<Record<string, any>> {
    const requestParams: Record<string, any> = {
      quality: params.quality,
      soraModel: params.selectedSoraModel,
      aspectRatio: params.aspectRatio,
      duration: params.duration,
    };

    const route = await this.modelRoutingService.resolveVideoModel('sora-2');
    if (route) {
      requestParams.modelKey = route.model.modelKey;
      requestParams.vendorKey = route.vendor.vendorKey;
      requestParams.platformKey = route.vendor.platformKey || route.vendor.vendorKey;
      requestParams.route = route.route;
      requestParams.providerChannel = route.vendor.platformKey || route.vendor.vendorKey;
      requestParams.routedProvider = route.vendor.provider || params.selectedSoraModel;
    } else {
      requestParams.providerChannel = params.selectedSoraModel;
      requestParams.routedProvider = params.selectedSoraModel;
    }

    return requestParams;
  }

  /**
   * DashScope async video endpoints：仅创建异步任务、尚未产出视频时，积分记录保持 pending，并把 apiUsageId 返回给前端用于失败退款。
   */
  private isDashscopeVideoAsyncPending(result: any): boolean {
    if (!result || result.success !== true || !result.data) return false;
    const d = result.data;
    const videoUrl =
      d.videoUrl ||
      d.video_url ||
      d.output?.video_url ||
      (Array.isArray(d.output) && d.output[0]?.video_url) ||
      d.raw?.output?.video_url ||
      d.raw?.video_url;
    if (videoUrl) return false;
    const taskId = d.taskId || d.task_id;
    return typeof taskId === 'string' && taskId.length > 0;
  }

  private async delay(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async markFailedAndRefundWithRetry(params: {
    userId: string;
    apiUsageId: string;
    serviceType: string;
    errorMessage: string;
    processingTime: number;
  }): Promise<boolean> {
    const markRetryDelaysMs = [0, 120, 360];
    const refundRetryDelaysMs = [0, 150, 420];

    for (let markAttempt = 0; markAttempt < markRetryDelaysMs.length; markAttempt++) {
      if (markAttempt > 0) {
        await this.delay(markRetryDelaysMs[markAttempt]);
      }

      let failedMarked = false;
      try {
        await this.creditsService.updateApiUsageStatus(
          params.apiUsageId,
          ApiResponseStatus.FAILED,
          params.errorMessage,
          params.processingTime,
        );
        failedMarked = true;
      } catch (statusError) {
        this.logger.warn(
          `[${params.serviceType}] mark-failed attempt ${markAttempt + 1} updateApiUsageStatus failed: ${this.summarizeError(
            statusError,
          )}`,
        );
      }

      if (!failedMarked) {
        try {
          await this.creditsService.markApiUsageFailedForUser(
            params.userId,
            params.apiUsageId,
            params.errorMessage,
            params.processingTime,
          );
          failedMarked = true;
        } catch (markError) {
          this.logger.warn(
            `[${params.serviceType}] mark-failed attempt ${markAttempt + 1} markApiUsageFailedForUser failed: ${this.summarizeError(
              markError,
            )}`,
          );
        }
      }

      if (!failedMarked) continue;

      for (let refundAttempt = 0; refundAttempt < refundRetryDelaysMs.length; refundAttempt++) {
        if (refundAttempt > 0) {
          await this.delay(refundRetryDelaysMs[refundAttempt]);
        }
        try {
          await this.creditsService.refundCredits(params.userId, params.apiUsageId);
          return true;
        } catch (refundError) {
          this.logger.warn(
            `[${params.serviceType}] refund attempt ${refundAttempt + 1} failed: ${this.summarizeError(
              refundError,
            )}`,
          );
        }
      }
    }

    return false;
  }

  /**
   * 预扣积分并执行操作
   * @param skipCredits 如果为 true，则跳过积分扣除（例如使用自定义 API Key 时）
   */
  private async withCredits<T>(
    req: any,
    serviceType: ServiceType,
    model: string | undefined,
    operation: () => Promise<T>,
    inputImageCount?: number,
    outputImageCount?: number,
    skipCredits?: boolean,
    requestParams?: Record<string, any>,
    creditOptions?: {
      /** 若返回体为 { success: false }（HTTP 仍 200），视为失败并退款 */
      treatReturnedFailureAsError?: boolean;
      /** 为 true 时不将本次调用标为成功（保持 pending），用于异步任务后续由前端确认失败并退款 */
      skipFinalizeSuccessIf?: (result: T) => boolean;
      /** 对 success=true 的返回体做额外校验，校验失败时按失败处理并退款 */
      validateSuccessResult?: (result: T) => boolean | { ok: boolean; message?: string };
      /** 在创建积分流水后透出 apiUsageId，便于异步链路追加 telemetry 关联字段 */
      onApiUsageId?: (apiUsageId: string) => void;
    },
  ): Promise<T> {
    const userId = this.getUserId(req);

    // 如果没有用户ID（API Key认证）或明确跳过积分，直接执行操作
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      return operation();
    }

    if (skipCredits) {
      await this.creditsService.assertFreeUserUsageQuota(
        userId,
        serviceType,
        outputImageCount,
      );
      this.logger.debug('Using custom API key - skipping credits deduction');
      const result = await operation();
      await this.creditsService.verifyAndRewardInviterSafely(userId, { skipApiUsageCheck: true });
      return result;
    }

    // 确保用户有积分账户
    await this.creditsService.getOrCreateAccount(userId);

    const startTime = Date.now();
    let apiUsageId: string | null = null;
    const sanitizedRequestParams = requestParams
      ? Object.fromEntries(
          Object.entries(requestParams).filter(([_, value]) => value !== undefined),
        )
      : undefined;
    const idempotencyKey = this.extractIdempotencyKey(req, sanitizedRequestParams);

    try {
      // 预扣积分
      const deductResult = await this.creditsService.preDeductCredits({
        userId,
        serviceType,
        model,
        inputImageCount,
        outputImageCount,
        requestParams: sanitizedRequestParams,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
        idempotencyKey,
      });

      apiUsageId = deductResult.apiUsageId;
      this.logger.debug(`Credits pre-deducted: ${serviceType}, apiUsageId: ${apiUsageId}`);
      creditOptions?.onApiUsageId?.(apiUsageId);

      // 执行实际操作
      const result = await operation();

      if (
        creditOptions?.treatReturnedFailureAsError &&
        result &&
        typeof result === 'object' &&
        'success' in (result as object) &&
        (result as any).success === false
      ) {
        const errPayload = (result as any).error;
        const msg =
          typeof errPayload?.message === 'string' && errPayload.message.trim().length > 0
            ? errPayload.message.trim()
            : typeof errPayload?.code === 'string'
              ? errPayload.code
              : '操作失败';
        throw new BadRequestException(msg);
      }

      const validateOutcome = creditOptions?.validateSuccessResult?.(result);
      if (validateOutcome !== undefined) {
        const normalized =
          typeof validateOutcome === 'boolean'
            ? { ok: validateOutcome, message: undefined }
            : validateOutcome;
        if (!normalized?.ok) {
          const message =
            typeof normalized?.message === 'string' && normalized.message.trim().length > 0
              ? normalized.message.trim()
              : 'Operation succeeded but response payload is invalid';
          throw new BadGatewayException(message);
        }
      }

      const executionChannel = this.extractExecutionChannel(result);

      if (apiUsageId) {
        try {
          await this.creditsService.updateApiUsageRequestParams(apiUsageId, {
            channel: executionChannel,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to update apiUsage request params: ${this.summarizeError(error)}`,
          );
        }
      }

      const deferFinalize = Boolean(
        creditOptions?.skipFinalizeSuccessIf &&
          apiUsageId &&
          creditOptions.skipFinalizeSuccessIf(result),
      );
      if (deferFinalize) {
        return { ...(result as object), apiUsageId } as T;
      }

      // 更新状态为成功
      const processingTime = Date.now() - startTime;
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.SUCCESS,
        undefined,
        processingTime,
      );

      return result;
    } catch (error) {
      // 更新状态为失败并退还积分
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // GPT-image-2 及图片下方AI功能（极速抠图、高清放大、智能抠图、一键分层、
      // 2D转3D、图片拓展、改文字等）失败时不返还积分
      const NO_REFUND_SERVICE_TYPES = [
        'gpt-image-2',
        'background-removal',    // 极速抠图
        'gemini-image-edit',     // 高清放大、智能抠图、一键分层、改文字
        'gemini-2.5-image-edit', // 高清放大、智能抠图、一键分层、改文字（2.5模型）
        'gemini-3.1-image-edit', // 高清放大、智能抠图、一键分层、改文字（3.1模型）
        'expand-image',          // 图片拓展
        'convert-2d-to-3d',      // 2D转3D
      ];
      const skipRefund = NO_REFUND_SERVICE_TYPES.includes(serviceType);

      if (skipRefund) {
        this.logger.warn(
          `[${serviceType}] Operation failed - refund skipped (policy): ` +
          `userId=${userId}, apiUsageId=${apiUsageId}, processingTime=${processingTime}ms, ` +
          `error=${this.summarizeError(error)}`
        );
      } else {
        this.logger.error(
          `[${serviceType}] Operation failed - attempting credits refund: ` +
          `userId=${userId}, apiUsageId=${apiUsageId}, processingTime=${processingTime}ms, ` +
          `error=${this.summarizeError(error)}`
        );
      }

      if (apiUsageId) {
        if (skipRefund) {
          // 只标记失败，不执行退款
          try {
            await this.creditsService.updateApiUsageStatus(
              apiUsageId,
              ApiResponseStatus.FAILED,
              errorMessage,
              processingTime,
            );
            this.logger.warn(
              `[${serviceType}] Credits NOT refunded for failed operation (policy): ` +
                `userId=${userId}, apiUsageId=${apiUsageId}`,
            );
          } catch (statusError) {
            this.logger.error(
              `[${serviceType}] Failed to mark failed status (no refund): ` +
                `userId=${userId}, apiUsageId=${apiUsageId}, error=${this.summarizeError(statusError)}`,
            );
          }
        } else {
          const refunded = await this.markFailedAndRefundWithRetry({
            userId,
            apiUsageId,
            serviceType,
            errorMessage,
            processingTime,
          });
          if (refunded) {
            this.logger.warn(
              `[${serviceType}] Credits successfully refunded for failed operation: ` +
                `userId=${userId}, apiUsageId=${apiUsageId}`,
            );
          } else {
            this.logger.error(
              `[${serviceType}] CRITICAL: Failed to mark failed/refund after retries. ` +
                `userId=${userId}, apiUsageId=${apiUsageId}`,
            );
          }
        }
      } else {
        this.logger.error(
          `[${serviceType}] CRITICAL: No apiUsageId available for refund. ` +
          `userId=${userId}, error=${this.summarizeError(error)}`
        );
      }

      if (this.isPrismaPoolTimeoutError(error)) {
        this.logger.warn(
          `Prisma connection pool timeout during ${serviceType}: ${this.summarizeError(error)}`,
        );
        throw new ServiceUnavailableException('数据库繁忙，请稍后重试');
      }

      // 仅在已经完成预扣费并进入上游调用阶段时，才将 quota/rate-limit 归类为上游 429
      if (apiUsageId && this.isRateLimitOrQuotaError(error)) {
        throw new HttpException('上游模型额度不足或请求过于频繁，请稍后重试', 429);
      }

      // 超时类错误统一映射为 HTTP 524（区分网关层 504 与业务层 524）
      const mappedUpstreamError = this.mapUpstreamErrorToHttpException(error);
      if (mappedUpstreamError) {
        throw mappedUpstreamError;
      }

      throw error;
    }
  }

  private resolveImageModel(providerName: string | null, requestedModel?: string): string {
    const rawModel = requestedModel?.trim();
    const model = rawModel;
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultImageModels[providerName] || 'gemini-2.5-flash-image-preview';
    }
    return this.providerDefaultImageModels.gemini;
  }

  private resolveAnalyzeModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested analyze model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultAnalyzeModels[providerName] || 'gemini-3.1-pro';
    }
    return this.providerDefaultAnalyzeModels.gemini;
  }

  private isPdfLikeInput(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    if (/^data:application\/pdf(?:;base64)?,/i.test(trimmed)) {
      return true;
    }

    const compact = trimmed.replace(/\s+/g, '');
    return compact.startsWith('JVBERi');
  }

  private isPdfAnalyzeProviderUnsafe(providerName?: string | null): boolean {
    if (!providerName) {
      return false;
    }

    const normalized = providerName.trim().toLowerCase();
    return (
      normalized !== 'gemini' &&
      normalized !== 'gemini-pro' &&
      normalized !== 'banana' &&
      normalized !== 'banana-2.5' &&
      normalized !== 'banana-3.1'
    );
  }

  private resolveGeminiPdfAnalyzeModel(requestedModel?: string): string {
    const trimmed = requestedModel?.trim();
    if (trimmed?.length && /^gemini-/i.test(trimmed) && !/image-preview/i.test(trimmed)) {
      return trimmed;
    }
    return 'gemini-3-flash-preview';
  }

  private isUpstreamAuthError(error: any): boolean {
    const status = this.extractHttpStatusFromError(error);
    if (status === 401 || status === 403) {
      return true;
    }

    const message = this.summarizeError(error).toLowerCase();
    return (
      message.includes('permission_denied') ||
      message.includes('api key') ||
      message.includes('forbidden') ||
      message.includes('unauthorized')
    );
  }

  private isLeakedApiKeyError(error: any): boolean {
    const message = this.summarizeError(error).toLowerCase();
    const mentionsGeminiKey =
      message.includes('gemini') ||
      message.includes('google api key') ||
      message.includes('gemini api key') ||
      message.includes('api key');
    return (
      mentionsGeminiKey &&
      (message.includes('reported as leaked') || message.includes('leaked'))
    );
  }

  private async analyzeViaGeminiWithPdfFallback(
    dto: AnalyzeImageDto,
    sourceImage: string,
    sourceImages: string[],
    model: string,
    customApiKey: string | null,
    hasPdf: boolean,
  ): Promise<{ text: string }> {
    try {
      const result = await this.imageGeneration.analyzeImage({
        ...dto,
        sourceImage,
        sourceImages,
        model,
        customApiKey,
      });
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!text) {
        throw new ServiceUnavailableException(
          'Analysis returned empty response, please try again later',
        );
      }
      return { text };
    } catch (error) {
      if (!hasPdf) {
        throw error;
      }

      if (this.isUpstreamAuthError(error)) {
        throw error;
      }

      this.logger.warn(
        `Gemini analyze service failed for PDF input, falling back to GeminiProProvider analyzeImage: ${this.summarizeError(error)}`,
      );

      const geminiProvider = this.factory.getProvider(model, 'gemini-pro');
      const fallbackResult = await geminiProvider.analyzeImage({
        prompt: dto.prompt,
        sourceImage,
        sourceImages,
        model,
        providerOptions: dto.providerOptions,
      });

      if (fallbackResult.success && fallbackResult.data) {
        const text =
          typeof fallbackResult.data.text === 'string'
            ? fallbackResult.data.text.trim()
            : '';
        if (!text) {
          throw new ServiceUnavailableException(
            'Analysis returned empty response, please try again later',
          );
        }
        return { text };
      }

      throw new Error(fallbackResult.error?.message || 'Failed to analyze image');
    }
  }

  private resolveGeminiVideoModel(requestedModel?: string): string {
    const trimmed = requestedModel?.trim();
    if (trimmed && /^gemini-/i.test(trimmed)) {
      return trimmed;
    }
    return 'gemini-3-flash-preview';
  }

  private resolveVideoAnalysisProgress(stage: string): number {
    switch (stage) {
      case 'queued':
        return 5;
      case 'download_video':
        return 15;
      case 'extract_frames':
        return 35;
      case 'analyze_frames':
        return 65;
      case 'upload_to_gemini':
        return 40;
      case 'wait_processing':
        return 70;
      case 'generate_content':
      case 'summarize':
        return 90;
      case 'completed':
        return 100;
      default:
        return 50;
    }
  }

  private async runVideoAnalysisPipeline(
    dto: AnalyzeVideoDto,
    options?: {
      onStageChange?: (stage: string, extra?: Record<string, any>) => void;
    },
  ): Promise<{
    analysis: string;
    text: string;
    model?: string;
    provider?: string;
    processingTime: number;
    frameCount?: number;
  }> {
    const startTime = Date.now();
    const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
    const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
    const emitStage = (stage: string, extra?: Record<string, any>) => {
      options?.onStageChange?.(stage, extra);
    };

    const parsedUrl = this.parseAndValidateAllowedUrl(dto.videoUrl);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveGeminiVideoModel(dto.model);

    let tempFile: string | null = null;
    let uploadedFileName: string | null = null;
    let geminiClient: GoogleGenAI | null = null;
    let stage = 'download_video';

    emitStage(stage);

    try {
      const bananaVideoMode =
        providerName === 'banana' || providerName === 'banana-2.5' || providerName === 'banana-3.1'
          ? await this.getBananaImageProviderMode(dto.providerOptions)
          : null;
      const allow147DirectVideoUnderstanding =
        bananaVideoMode === 'legacy' || bananaVideoMode === 'legacy_auto';

      if (providerName && providerName !== 'gemini-pro') {
        if (
          (providerName === 'banana' ||
            providerName === 'banana-2.5' ||
            providerName === 'banana-3.1') &&
          allow147DirectVideoUnderstanding
        ) {
          stage = 'direct_video_understanding';
          emitStage(stage);
          const analysisText = await this.analyzeVideoVia147ChatCompletions({
            model,
            prompt: dto.prompt || '分析这个视频的内容，描述视频中的场景、动作和关键信息',
            videoUrl: parsedUrl.toString(),
          });
          const processingTime = Date.now() - startTime;
          return {
            analysis: analysisText,
            text: analysisText,
            model,
            provider: providerName,
            processingTime,
          };
        }
      }

      stage = 'download_video';
      emitStage(stage);
      this.logger.log('📥 Downloading video from OSS...');
      const videoResponse = await fetch(parsedUrl.toString(), { redirect: 'follow' });
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
      }
      this.parseAndValidateAllowedUrl(videoResponse.url);
      if (!videoResponse.body) {
        throw new Error('Empty video response body');
      }

      const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
      const contentLengthHeader = videoResponse.headers.get('content-length');
      if (contentLengthHeader) {
        const size = Number(contentLengthHeader);
        if (Number.isFinite(size) && size > MAX_VIDEO_BYTES) {
          throw new BadRequestException('视频文件过大，请使用更小的视频');
        }
      }

      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const { pipeline } = await import('stream/promises');
      const { Readable, Transform } = await import('stream');

      const ext = (() => {
        const map: Record<string, string> = {
          'video/mp4': '.mp4',
          'video/quicktime': '.mov',
          'video/x-msvideo': '.avi',
          'video/mpeg': '.mpeg',
          'video/3gpp': '.3gp',
          'video/x-flv': '.flv',
        };
        return map[contentType.split(';')[0].trim().toLowerCase()] || '.mp4';
      })();

      tempFile = path.join(os.tmpdir(), `video-${Date.now()}${ext}`);

      let received = 0;
      const limiter = new Transform({
        transform(chunk, _enc, cb) {
          received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
          if (received > MAX_VIDEO_BYTES) {
            cb(new BadRequestException('Video file too large'));
            return;
          }
          cb(null, chunk);
        },
      });

      await pipeline(
        Readable.fromWeb(videoResponse.body as any),
        limiter,
        fs.createWriteStream(tempFile),
      );

      this.logger.log(`📦 Video downloaded: ${received} bytes, type: ${contentType}`);

      if (providerName && providerName !== 'gemini-pro') {
        stage = 'extract_frames';
        emitStage(stage);
        const provider = this.factory.getProvider(dto.model, providerName);
        const maxFrames = 8;
        const intervalSeconds = 3;
        this.logger.log(`🖼️ Extracting frames via ffmpeg (maxFrames=${maxFrames}, every ${intervalSeconds}s)...`);
        const frames = await this.extractFramesAsDataUrls({
          videoPath: tempFile,
          maxFrames,
          intervalSeconds,
        });
        if (!frames.length) {
          throw new ServiceUnavailableException('无法从视频中提取帧，请检查视频文件是否损坏');
        }

        stage = 'analyze_frames';
        emitStage(stage, { frameCount: frames.length });
        const visionModel = this.resolveImageModel(providerName, dto.model);
        const framePrompt =
          '请描述这一帧画面（场景、人物、动作、字幕/界面元素），尽量客观，不要编造。';
        const frameAnalyses: string[] = [];
        for (let i = 0; i < frames.length; i++) {
          const result = await provider.analyzeImage({
            prompt: framePrompt,
            sourceImage: frames[i],
            model: visionModel,
            providerOptions: dto.providerOptions,
          });
          if (!result.success || !result.data) {
            throw new ServiceUnavailableException(
              result.error?.message || 'Failed to analyze extracted frame',
            );
          }
          frameAnalyses.push(result.data.text);
        }

        stage = 'summarize';
        emitStage(stage, { frameCount: frames.length });
        const userPrompt =
          dto.prompt || '分析这个视频的内容，描述视频中的场景、动作和关键信息';
        const summaryPrompt = [
          '你将获得从同一段视频抽帧得到的多帧描述，请根据这些信息总结整段视频。',
          `用户分析要求：${userPrompt}`,
          '抽帧描述：',
          ...frameAnalyses.map((t, idx) => `${idx + 1}. ${t}`),
          '请输出：1) 视频整体内容概述 2) 关键场景/动作 3) 可能的时间线(如可推断) 4) 关键信息/字幕(如有)。',
        ].join('\n');

        const textResult = await provider.generateText({
          prompt: summaryPrompt,
          model,
          providerOptions: dto.providerOptions,
        });
        if (!textResult.success || !textResult.data) {
          throw new ServiceUnavailableException(
            textResult.error?.message || 'Failed to summarize video frames',
          );
        }

        const analysisText = textResult.data.text || '';
        const processingTime = Date.now() - startTime;
        return {
          analysis: analysisText,
          text: analysisText,
          model,
          provider: providerName,
          processingTime,
          frameCount: frames.length,
        };
      }

      const apiKey = getGeminiApiKeyFromEnv();
      if (!apiKey) {
        throw new Error('Gemini API key not configured');
      }
      geminiClient = new GoogleGenAI({ apiKey });

      stage = 'upload_to_gemini';
      emitStage(stage);
      this.logger.log('📤 Uploading video to Gemini File API...');
      const uploadResult = await geminiClient.files.upload({
        file: tempFile,
        config: { mimeType: contentType, displayName: `video-analysis-${Date.now()}` },
      });

      uploadedFileName = uploadResult.name || null;
      if (!uploadedFileName) {
        throw new Error('Gemini file upload returned empty file name');
      }

      stage = 'wait_processing';
      emitStage(stage);
      const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
      let file = uploadResult;
      while (file.state === 'PROCESSING') {
        if (Date.now() > deadline) {
          throw new ServiceUnavailableException('视频处理超时，请使用更短的视频');
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        file = await geminiClient.files.get({ name: uploadedFileName });
      }

      if (file.state === 'FAILED') {
        throw new Error('Video processing failed');
      }

      stage = 'generate_content';
      emitStage(stage);
      const prompt = dto.prompt || '分析这个视频的内容，描述视频中的场景、动作和关键信息';

      const result = await geminiClient.models.generateContent({
        model,
        contents: [
          { text: prompt },
          {
            fileData: {
              mimeType: file.mimeType,
              fileUri: file.uri,
            },
          },
        ],
      });

      const analysisText = result.text || '';
      const processingTime = Date.now() - startTime;
      return {
        analysis: analysisText,
        text: analysisText,
        model,
        provider: 'gemini',
        processingTime,
      };
    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      const summary = this.summarizeError(error);
      this.logger.error(
        `❌ Video analysis failed at ${stage} after ${processingTime}ms: ${summary}`,
        error?.stack || summary,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      if (this.isLikelyNetworkError(error)) {
        throw new ServiceUnavailableException(`视频分析失败（${stage}）：${summary}`);
      }
      throw new InternalServerErrorException(`视频分析失败（${stage}）：${summary}`);
    } finally {
      try {
        if (tempFile) {
          const fsp = await import('fs/promises');
          await fsp.unlink(tempFile);
        }
      } catch {}

      try {
        if (uploadedFileName) {
          await geminiClient?.files.delete({ name: uploadedFileName });
        }
      } catch {}
    }
  }

  private summarizeError(error: any): string {
    const name = error?.name ? String(error.name) : 'Error';
    const message = error?.message ? String(error.message) : String(error);
    const code = error?.code ? ` code=${String(error.code)}` : '';

    const cause = error?.cause;
    if (!cause) {
      return `${name}: ${message}${code}`;
    }

    const causeName = cause?.name ? String(cause.name) : 'Cause';
    const causeMessage = cause?.message ? String(cause.message) : String(cause);
    const causeCode = cause?.code ? ` code=${String(cause.code)}` : '';
    return `${name}: ${message}${code} (cause: ${causeName}: ${causeMessage}${causeCode})`;
  }

  private isRateLimitOrQuotaError(error: any): boolean {
    if (error instanceof HttpException && error.getStatus() === 429) {
      return true;
    }

    const messages = [
      error?.message,
      error?.cause?.message,
      error?.response?.message,
      typeof error?.response === 'string' ? error.response : '',
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return messages.some((message) => {
      return (
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('resource has been exhausted')
      );
    });
  }

  private isTimeoutLikeError(error: any): boolean {
    const messages = [
      error?.message,
      error?.cause?.message,
      error?.response?.message,
      typeof error?.response === 'string' ? error.response : '',
      error?.error?.message,
      error?.body?.message,
      error?.detail,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return messages.some((message) => {
      return (
        message.includes('524') ||
        message.includes('504') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('gateway timeout') ||
        message.includes('aborterror') ||
        message.includes('aborted')
      );
    });
  }

  private extractHttpStatusFromError(error: any): number | null {
    if (error instanceof HttpException) {
      return error.getStatus();
    }
    const status = error?.status || error?.response?.status || error?.statusCode;
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status;
    }
    const message = String(error?.message || '');
    const match = message.match(/\b(\d{3})\b/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  private mapUpstreamErrorToHttpException(error: any): HttpException | null {
    const status = this.extractHttpStatusFromError(error);

    if (status === 401) {
      return new HttpException('上游模型认证失败，请检查 API Key 配置', 401);
    }

    if (status === 403) {
      return this.isLeakedApiKeyError(error)
        ? new HttpException('Gemini API Key 已被 Google 判定为泄露，需立即更换新的 API Key', 403)
        : new HttpException('上游模型拒绝访问，请检查 API Key 权限或账号状态', 403);
    }

    if (status === 464) {
      return new BadGatewayException('上游任务失败，请稍后重试');
    }

    if (status === 524 || this.isTimeoutLikeError(error)) {
      return new HttpException('服务器处理超时，请稍后重试', 524);
    }

    return null;
  }

  private getTraceId(req: TraceableReq | any): string | null {
    const direct = typeof req?.traceId === 'string' ? req.traceId.trim() : '';
    if (direct) return direct;
    const header = typeof req?.headers?.['x-trace-id'] === 'string'
      ? req.headers['x-trace-id'].trim()
      : '';
    return header || null;
  }

  private getRequestId(req: TraceableReq | any): string | null {
    const requestId = typeof req?.id === 'string' ? req.id.trim() : '';
    return requestId || null;
  }

  private getTraceContext(req: TraceableReq | any): PersistedTraceContext {
    return captureTraceContext({
      traceId: this.getTraceId(req),
      parentRequestId: this.getRequestId(req),
    });
  }

  private isPrismaPoolTimeoutError(error: any): boolean {
    const candidates = [error, error?.cause];
    return candidates.some((candidate) => {
      if (!candidate) return false;
      const code = candidate?.code ? String(candidate.code) : '';
      const message = candidate?.message ? String(candidate.message).toLowerCase() : '';
      return (
        code === 'P2024' ||
        message.includes('timed out fetching a new connection from the connection pool') ||
        message.includes('connection pool timeout')
      );
    });
  }

  private isLikelyNetworkError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('fetch failed')) return true;

    const candidate = error?.cause || error;
    const code = candidate?.code ? String(candidate.code) : '';
    const networkCodes = new Set([
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE',
    ]);
    return networkCodes.has(code);
  }

  private async runCommand(
    command: string,
    args: string[],
    options: { timeoutMs?: number } = {}
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      });
    });
  }

  private async extractFramesAsDataUrls(params: {
    videoPath: string;
    maxFrames: number;
    intervalSeconds: number;
  }): Promise<string[]> {
    const os = await import('os');
    const path = await import('path');
    const fsp = await import('fs/promises');

    const framesDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'video-frames-'));
    try {
      const outputPattern = path.join(framesDir, 'frame-%03d.jpg');
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        params.videoPath,
        '-vf',
        `fps=1/${Math.max(1, Math.floor(params.intervalSeconds))}`,
        '-frames:v',
        String(Math.max(1, Math.floor(params.maxFrames))),
        outputPattern,
      ];

      try {
        await this.runCommand('ffmpeg', args, { timeoutMs: 120_000 });
      } catch (err: any) {
        const code = err?.code ? String(err.code) : '';
        if (code === 'ENOENT' || String(err?.message || '').includes('spawn ffmpeg')) {
          throw new ServiceUnavailableException('服务器未安装 ffmpeg，请联系运维处理');
        }
        throw err;
      }

      const files = (await fsp.readdir(framesDir))
        .filter((f) => f.toLowerCase().endsWith('.jpg'))
        .sort();

      const dataUrls: string[] = [];
      for (const file of files) {
        const buf = await fsp.readFile(path.join(framesDir, file));
        const base64 = buf.toString('base64');
        dataUrls.push(`data:image/jpeg;base64,${base64}`);
      }
      return dataUrls;
    } finally {
      try {
        await fsp.rm(framesDir, { recursive: true, force: true });
      } catch {}
    }
  }

  private async analyzeVideoVia147ChatCompletions(params: {
    model: string;
    prompt: string;
    videoUrl: string;
  }): Promise<string> {
    const apiKey =
      process.env.BANANA_API_KEY ||
      process.env.VEO_API_KEY ||
      process.env.SORA2_API_KEY ||
      null;
    if (!apiKey) {
      throw new ServiceUnavailableException('147 API Key 未配置（BANANA_API_KEY），请检查后端环境变量');
    }

    const apiBaseUrl = (
      process.env.VEO_API_ENDPOINT ||
      process.env.VEO_API_BASE_URL ||
      process.env.SORA2_API_ENDPOINT ||
      'https://api1.147ai.com'
    ).replace(/\/+$/, '');

    // 视频分析需要较长时间，设置 5 分钟超时
    const VIDEO_ANALYSIS_TIMEOUT = 5 * 60 * 1000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VIDEO_ANALYSIS_TIMEOUT);

    try {
      const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: params.prompt },
                { type: 'image_url', image_url: { url: params.videoUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ServiceUnavailableException(
          `147 /v1/chat/completions error: HTTP ${response.status} ${text}`.trim()
        );
      }

      const data: any = await response.json().catch(() => ({}));
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim().length) return content.trim();
      if (Array.isArray(content)) {
        const joined = content
          .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
          .join('')
          .trim();
        if (joined.length) return joined;
      }

      throw new ServiceUnavailableException('147 AI 返回了空内容，请稍后重试');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new ServiceUnavailableException(`Video analysis timeout (${VIDEO_ANALYSIS_TIMEOUT / 1000}s)`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseAndValidateAllowedUrl(urlValue: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      throw new BadRequestException('视频 URL 格式无效');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('视频 URL 只支持 http/https 协议');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    this.logger.debug(`Validating URL host: ${hostname}, allowed: ${allowedHosts.join(', ')}`);
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      this.logger.warn(`URL host not allowed: ${hostname}, allowedHosts: ${allowedHosts.join(', ')}`);
      throw new BadRequestException('视频 URL 域名不在允许列表中，请使用白名单内的域名');
    }

    return parsed;
  }

  private normalizeManagedImageKey(raw?: string | null): string | null {
    const value =
      typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : '';
    if (!value) return null;
    return MANAGED_IMAGE_KEY_REGEX.test(value) ? value : null;
  }

  private resolveBucketOriginImageUrl(key: string): string | null {
    const normalizedKey = this.normalizeManagedImageKey(key);
    if (!normalizedKey) return null;
    const hosts = this.oss.publicHosts();
    const bucketOriginHost = hosts[0];
    if (!bucketOriginHost) return null;
    return `https://${bucketOriginHost}/${normalizedKey}`;
  }

  private extractManagedAssetKeyFromImageRef(
    input?: string | null,
    visited: Set<string> = new Set(),
  ): string | null {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (!trimmed) return null;
    if (visited.has(trimmed)) return null;
    visited.add(trimmed);

    const direct = this.normalizeManagedImageKey(trimmed);
    if (direct) return direct;

    try {
      const parsed = new URL(trimmed);
      const fromPath = this.normalizeManagedImageKey(parsed.pathname);
      if (fromPath) return fromPath;

      const fromQueryKey = this.normalizeManagedImageKey(
        parsed.searchParams.get('key'),
      );
      if (fromQueryKey) return fromQueryKey;

      const nestedUrl = parsed.searchParams.get('url');
      if (nestedUrl && nestedUrl !== trimmed) {
        const nestedKey = this.extractManagedAssetKeyFromImageRef(
          nestedUrl,
          visited,
        );
        if (nestedKey) return nestedKey;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private normalizeImageUrlForUpstream(urlValue: string): string {
    const trimmed = typeof urlValue === 'string' ? urlValue.trim() : '';
    if (!trimmed) return '';

    const managedKey = this.extractManagedAssetKeyFromImageRef(trimmed);
    if (!managedKey) return trimmed;

    return (
      this.resolveBucketOriginImageUrl(managedKey) ||
      this.oss.publicUrl(managedKey)
    );
  }

  private normalizeImageUrlsForUpstream(urls: string[]): string[] {
    const out: string[] = [];
    for (const value of urls) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed) continue;
      out.push(this.normalizeImageUrlForUpstream(trimmed));
    }
    return out;
  }

  private isBananaProviderName(providerName: string | null | undefined): boolean {
    const normalized = (providerName || '').trim().toLowerCase();
    return normalized === 'banana' || normalized.startsWith('banana-');
  }

  private resolveBananaImageRouteFromProviderOptions(
    providerOptions?: Record<string, any>,
  ): 'normal' | 'stable' | null {
    const nestedRouteRaw = providerOptions?.banana?.imageRoute;
    const nestedRoute =
      typeof nestedRouteRaw === 'string' ? nestedRouteRaw.trim().toLowerCase() : '';
    if (nestedRoute === 'normal' || nestedRoute === 'stable') {
      return nestedRoute as 'normal' | 'stable';
    }

    const legacyRouteRaw = providerOptions?.bananaImageRoute;
    const legacyRoute =
      typeof legacyRouteRaw === 'string' ? legacyRouteRaw.trim().toLowerCase() : '';
    if (legacyRoute === 'normal' || legacyRoute === 'stable') {
      return legacyRoute as 'normal' | 'stable';
    }

    return null;
  }

  private async getBananaImageProviderMode(
    providerOptions?: Record<string, any>,
  ): Promise<string> {
    const userRoute = this.resolveBananaImageRouteFromProviderOptions(providerOptions);
    if (userRoute) {
      return userRoute === 'stable' ? 'tencent' : 'apimart';
    }

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'banana_provider' },
      });
      return (setting?.value || 'auto').trim().toLowerCase();
    } catch {
      return 'auto';
    }
  }

  private async normalizeSourceImageForTencentForced(
    source: string,
    userId: string,
    context: string,
  ): Promise<string> {
    const value = typeof source === 'string' ? source.trim() : '';
    if (!value) {
      throw new BadRequestException(`Tencent ${context} source image is empty`);
    }

    if (/^(?:tencent-fileid:|fileid:)/i.test(value) || /^\d{6,}$/.test(value)) {
      return value;
    }

    if (/^https?:\/\//i.test(value)) {
      return this.normalizeImageUrlForUpstream(value);
    }

    const upload = await this.uploadGeneratedImageToOss(value, { userId });
    this.logger.log(
      `[${context}] Tencent forced source uploaded to OSS: key=${upload.key}`,
    );
    return upload.url;
  }

  private looksLikeSignedAssetUrl(url: string): boolean {
    return /[?&](?:X-Amz|X-Tos|OSSAccessKeyId|Signature|Expires|x-oss-signature)=/i.test(url);
  }

  private isOwnManagedImageUrl(urlValue: string): boolean {
    const trimmed = typeof urlValue === 'string' ? urlValue.trim() : '';
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
    if (this.looksLikeSignedAssetUrl(trimmed)) return false;

    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      const ownHosts = this.oss.publicHosts().map((item) => item.toLowerCase());
      const hostMatched = ownHosts.some(
        (allowed) => host === allowed || host.endsWith(`.${allowed}`),
      );
      if (!hostMatched) return false;
      return this.normalizeManagedImageKey(parsed.pathname) !== null;
    } catch {
      return false;
    }
  }

  private collectProviderImageUrls(resultData: unknown): string[] {
    const payload = this.asRecord(resultData);
    if (!payload) return [];

    const metadata = this.asRecord(payload.metadata);
    const candidates: string[] = [];
    const pushUrl = (value: unknown) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!/^https?:\/\//i.test(trimmed)) return;
      if (!candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    };
    const pushUrlList = (value: unknown) => {
      if (!Array.isArray(value)) return;
      value.forEach((item) => pushUrl(item));
    };

    pushUrl(payload.imageUrl);
    pushUrlList(payload.imageUrls);
    pushUrlList(payload.images);

    if (metadata) {
      pushUrl(metadata.imageUrl);
      pushUrlList(metadata.imageUrls);
      pushUrlList(metadata.images);
      pushUrl(metadata.sourceImageUrl);
      pushUrlList(metadata.sourceImageUrls);
    }

    return candidates;
  }

  private async persistProviderImageUrlToManaged(
    imageUrl: string,
    req: any,
    userId: string,
  ): Promise<{
    url: string;
    sourceImageUrl: string;
    uploaded: boolean;
    key?: string;
    mimeType?: string;
    bytes?: number;
  }> {
    const sourceImageUrl = imageUrl.trim();
    if (this.isOwnManagedImageUrl(sourceImageUrl)) {
      return { url: sourceImageUrl, sourceImageUrl, uploaded: false };
    }

    const sourceImageDataUrl = await this.fetchImageAsDataUrl(sourceImageUrl);
    const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
    const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });

    return {
      url: upload.url,
      sourceImageUrl,
      uploaded: true,
      key: upload.key,
      mimeType: upload.mimeType,
      bytes: upload.size,
    };
  }

  private async persistProviderImageUrlToManagedWithRetry(
    imageUrl: string,
    req: any,
    userId: string,
  ): Promise<{
    url: string;
    sourceImageUrl: string;
    uploaded: boolean;
    key?: string;
    mimeType?: string;
    bytes?: number;
  }> {
    const maxAttempts = 3;
    const retryDelaysMs = [600, 1200];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.persistProviderImageUrlToManaged(imageUrl, req, userId);
      } catch (error) {
        const shouldRetry =
          attempt < maxAttempts && this.shouldRetryImagePersistError(error);
        if (!shouldRetry) {
          throw error;
        }

        const delayMs =
          retryDelaysMs[attempt - 1] ??
          retryDelaysMs[retryDelaysMs.length - 1] ??
          0;
        this.logger.warn(
          `[persist-provider-image] attempt ${attempt}/${maxAttempts} failed for ${imageUrl}: ${this.summarizeError(
            error,
          )}; retry in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return this.persistProviderImageUrlToManaged(imageUrl, req, userId);
  }

  private shouldRetryImagePersistError(error: unknown): boolean {
    if (error instanceof BadRequestException) {
      return false;
    }

    const status = (error as any)?.status;
    if (typeof status === 'number') {
      return status === 408 || status === 429 || (status >= 500 && status <= 599);
    }

    const summary = this.summarizeError(error);
    return /(timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|HTTP 5\d{2})/i.test(
      summary,
    );
  }

  private parseAndValidateAllowedImageUrl(urlValue: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      throw new BadRequestException('图片 URL 格式无效');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('图片 URL 只支持 http/https 协议');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      this.logger.warn(`Image URL host not allowed: ${hostname}`);
      throw new BadRequestException('图片 URL 域名不在允许列表中，请使用白名单内的域名');
    }

    return parsed;
  }

  private validateImageDataUrl(dataUrl: string): void {
    const match = dataUrl.match(/^data:([^;,]+)/i);
    if (!match) {
      return; // 不是 data URL，可能是纯 base64，让后续处理
    }
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      throw new BadRequestException(
        `Invalid image format: expected image/*, got ${mimeType}`,
      );
    }
  }

  private buildImageFetchCandidates(parsed: URL): string[] {
    const candidates: string[] = [];
    const pushCandidate = (candidate?: string | null) => {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      if (!value) return;
      if (!candidates.includes(value)) {
        candidates.push(value);
      }
    };

    pushCandidate(parsed.toString());

    const managedKey = this.extractManagedAssetKeyFromImageRef(parsed.toString());
    if (managedKey) {
      pushCandidate(this.resolveBucketOriginImageUrl(managedKey));
      pushCandidate(this.oss.publicUrl(managedKey));
    }

    return candidates;
  }

  private normalizeWanI2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    if (typeof next.input.img_url === 'string' && next.input.img_url.trim()) {
      next.input.img_url = this.normalizeImageUrlForUpstream(next.input.img_url);
    }

    return next;
  }

  private inferWanResolutionFromSize(size: unknown): '720P' | '1080P' | undefined {
    if (typeof size !== 'string') return undefined;
    const trimmed = size.trim();
    if (!trimmed) return undefined;

    const explicitTier = trimmed.toUpperCase();
    if (explicitTier === '720P' || explicitTier === '1080P') {
      return explicitTier;
    }

    const match = trimmed.match(/^\s*(\d+)\s*[*xX]\s*(\d+)\s*$/);
    if (!match) return undefined;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;

    return Math.max(width, height) >= 1500 ? '1080P' : '720P';
  }

  private buildWanCreditRequestParams(
    body: any,
    options: {
      managedModelKey: 'wan-2.6' | 'wan-2.6-r2v' | 'wan-2.7';
      generationMode: 't2v' | 'i2v' | 'r2v';
      requestPrompt?: string | null;
      requestThumbnailUrls?: unknown[];
      hasAudio?: boolean;
    },
  ): Record<string, any> {
    const parameters =
      body?.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
        ? body.parameters
        : {};
    const resolution =
      (typeof parameters.resolution === 'string' && parameters.resolution.trim().length > 0
        ? parameters.resolution.trim().toUpperCase()
        : undefined) || this.inferWanResolutionFromSize(parameters.size);
    const durationRaw = Number(parameters.duration);
    const duration =
      Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : undefined;

    return {
      managedModelKey: options.managedModelKey,
      modelKey: options.managedModelKey,
      vendorKey: 'dashscope',
      platformKey: 'dashscope',
      aiProvider: 'dashscope',
      generationMode: options.generationMode,
      ...(resolution ? { resolution } : {}),
      ...(duration ? { duration, durationSec: duration } : {}),
      ...(typeof options.hasAudio === 'boolean' ? { hasAudio: options.hasAudio } : {}),
      ...this.buildRequestPromptAndImageParams(
        options.requestPrompt,
        Array.isArray(options.requestThumbnailUrls) ? options.requestThumbnailUrls : [],
      ),
    };
  }

  private normalizeWan27I2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawMedia = next.input.media;
    if (Array.isArray(rawMedia)) {
      next.input.media = rawMedia
        .map((item: any) => {
          if (!item || typeof item !== 'object') return null;
          const mediaItem: any = { ...item };
          if (typeof mediaItem.url === 'string' && mediaItem.url.trim()) {
            mediaItem.url = this.normalizeImageUrlForUpstream(mediaItem.url);
          }
          return mediaItem;
        })
        .filter((value: any) => value && typeof value.url === 'string' && value.url.trim());
    }

    return next;
  }

  private normalizeWanR2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawReferenceVideos = next.input.reference_video_urls;
    if (Array.isArray(rawReferenceVideos)) {
      next.input.reference_video_urls = rawReferenceVideos
        .map((item: unknown) => {
          if (typeof item !== 'string') return '';
          const trimmed = item.trim();
          if (!trimmed) return '';
          return this.normalizeImageUrlForUpstream(trimmed);
        })
        .filter((value: string) => Boolean(value));
    }

    return next;
  }

  /**
   * 共用：轮询 DashScope 异步视频任务，返回最终视频 URL 或失败/超时错误。
   * 仅供新接入的 endpoint 使用；现有 wan26-* / wan27-* 各自的 inline 轮询保持不变（避免连带回归）。
   */
  private async pollDashScopeVideoTask(
    dashKey: string,
    taskId: string,
    label: string,
  ): Promise<
    | { success: true; data: any }
    | { success: false; error: { message: string; details?: any } }
  > {
    const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
    const intervalMs = 15000;
    const maxAttempts = 40;

    const extractVideoUrl = (obj: any) =>
      obj?.output?.video_url ||
      obj?.video_url ||
      obj?.videoUrl ||
      (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
      undefined;

    this.logger.log(
      `🔁 Start polling DashScope ${label} task ${taskId} (${maxAttempts} attempts, ${intervalMs}ms interval)`,
    );

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      try {
        const statusResp = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${dashKey}`,
            'Content-Type': 'application/json',
          },
        });
        if (!statusResp.ok) {
          const errBody = await statusResp.text().catch(() => '');
          this.logger.warn(`DashScope ${label} status check non-OK`, {
            status: statusResp.status,
            body: errBody,
          });
          continue;
        }
        const statusData = await statusResp.json().catch(() => ({}));
        this.logger.debug(
          `🔎 DashScope ${label} status (attempt ${attempt + 1}): ${JSON.stringify(statusData).slice(0, 200)}`,
        );
        const statusValue = (
          statusData?.output?.task_status ||
          statusData?.status ||
          statusData?.state ||
          statusData?.task_status ||
          ''
        )
          .toString()
          .toLowerCase();

        if (statusValue === 'succeeded' || statusValue === 'success') {
          const finalVideoUrl =
            extractVideoUrl(statusData) ||
            extractVideoUrl(statusData?.result) ||
            extractVideoUrl(statusData?.output) ||
            undefined;
          if (!finalVideoUrl) {
            this.logger.warn(
              `DashScope ${label} task ${taskId} succeeded but no video URL`,
              { dataPreview: JSON.stringify(statusData).slice(0, 400) },
            );
            return {
              success: false,
              error: {
                message: 'DashScope 任务已完成但未返回视频地址',
                details: statusData,
              },
            };
          }
          this.logger.log(
            `✅ DashScope ${label} task ${taskId} succeeded, videoUrl: ${String(finalVideoUrl).slice(0, 120)}`,
          );
          return {
            success: true,
            data: {
              taskId,
              status: statusValue,
              videoUrl: finalVideoUrl,
              video_url: finalVideoUrl,
              output: { video_url: finalVideoUrl },
              raw: statusData,
            },
          };
        }
        if (statusValue === 'failed' || statusValue === 'error') {
          const failureCode =
            statusData?.output?.code ||
            statusData?.code ||
            statusData?.output?.error_code ||
            statusData?.output?.error?.code;
          const failureMessage =
            statusData?.output?.message ||
            statusData?.message ||
            statusData?.output?.error?.message ||
            statusData?.output?.error_message ||
            statusData?.output?.error?.msg ||
            statusData?.output?.reason;
          const message =
            typeof failureMessage === 'string' && failureMessage.trim().length > 0
              ? failureCode
                ? `${String(failureCode)}: ${failureMessage}`
                : failureMessage
              : `DashScope ${label} task failed`;
          this.logger.error(`❌ DashScope ${label} task ${taskId} failed`, {
            message,
            raw: statusData,
          });
          return {
            success: false,
            error: { message, details: statusData },
          };
        }
      } catch (err: any) {
        this.logger.warn(`DashScope ${label} polling exception, will retry`, err);
      }
    }
    this.logger.warn(
      `⏳ DashScope ${label} task ${taskId} polling timed out after ${maxAttempts} attempts`,
    );
    return {
      success: false,
      error: { message: `DashScope ${label} task polling timed out` },
    };
  }

  private static readonly HAPPYHORSE_MODEL_WHITELIST = new Set<string>([
    'happyhorse-1.0-t2v',
    'happyhorse-1.0-i2v',
    'happyhorse-1.0-r2v',
    'happyhorse-1.0-video-edit',
  ]);

  private resolveHappyhorseModelOrThrow(body: any): string {
    const raw = typeof body?.model === 'string' ? body.model.trim() : '';
    if (!raw || !AiController.HAPPYHORSE_MODEL_WHITELIST.has(raw)) {
      throw new BadRequestException(
        `Unsupported HappyHorse model: ${raw || '(empty)'}`,
      );
    }
    return raw;
  }

  /**
   * 通用 happyhorse body 归一化，覆盖 t2v / i2v / r2v / video-edit 4 个模型。
   * - input.media[] 中的 url 走 normalizeImageUrlForUpstream（图片 / 视频 URL 通用，仅做白名单/数据 URL 转远程）
   * - 不存在 type 字段的元素默认补 reference_image（保留 first_frame / video / reference_image 等已有值）
   * - parameters.watermark 强制 false
   */
  private normalizeHappyhorseBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawMedia = next.input.media;
    if (Array.isArray(rawMedia)) {
      next.input.media = rawMedia
        .map((item: any) => {
          if (!item || typeof item !== 'object') return null;
          const mediaItem: any = { ...item };
          if (typeof mediaItem.type !== 'string' || !mediaItem.type.trim()) {
            mediaItem.type = 'reference_image';
          }
          if (typeof mediaItem.url === 'string' && mediaItem.url.trim()) {
            mediaItem.url = this.normalizeImageUrlForUpstream(mediaItem.url);
          }
          return mediaItem;
        })
        .filter(
          (value: any) => value && typeof value.url === 'string' && value.url.trim(),
        );
    }

    // 强制不打水印
    next.parameters = { ...(next.parameters || {}), watermark: false };

    return next;
  }

  private buildHappyhorseCreditRequestParams(
    body: any,
    model: string,
  ): Record<string, any> {
    const parameters =
      body?.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
        ? body.parameters
        : {};
    const resolution =
      typeof parameters.resolution === 'string' && parameters.resolution.trim().length > 0
        ? parameters.resolution.trim().toUpperCase()
        : '720P'; // 节点默认；与节点 UI 默认一致
    const durationRaw = Number(parameters.duration);
    const duration =
      Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.min(15, Math.max(3, Math.round(durationRaw)))
        : 5;

    // 由 model 后缀派生 generationMode
    const generationMode =
      model === 'happyhorse-1.0-t2v'
        ? 't2v'
        : model === 'happyhorse-1.0-i2v'
          ? 'i2v'
          : model === 'happyhorse-1.0-video-edit'
            ? 'video-edit'
            : 'r2v';

    const mediaItems: Array<Record<string, unknown>> = Array.isArray(body?.input?.media)
      ? body.input.media.filter(
          (m: any) => m && typeof m === 'object' && typeof m.url === 'string',
        )
      : [];
    const referenceImageUrls = mediaItems
      .filter((m) => m.type !== 'video')
      .map((m) => m.url as string);
    const referenceVideoUrls = mediaItems
      .filter((m) => m.type === 'video')
      .map((m) => m.url as string);

    return {
      managedModelKey: model,
      modelKey: model,
      vendorKey: 'dashscope',
      platformKey: 'dashscope',
      aiProvider: 'dashscope',
      generationMode,
      resolution,
      duration,
      durationSec: duration,
      referenceImageCount: referenceImageUrls.length,
      referenceVideoCount: referenceVideoUrls.length,
      ...this.buildRequestPromptAndImageParams(
        body?.input?.prompt,
        referenceImageUrls,
      ),
    };
  }

  private async fetchImageAsDataUrl(imageUrl: string): Promise<string> {
    const parsed = this.parseAndValidateAllowedImageUrl(imageUrl);
    const candidates = this.buildImageFetchCandidates(parsed);
    const maxBytes = 30 * 1024 * 1024;
    const errors: string[] = [];

    for (const candidateUrl of candidates) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(candidateUrl, {
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          errors.push(
            `${candidateUrl} -> HTTP ${response.status}${
              text ? ` ${text}` : ''
            }`.trim(),
          );
          continue;
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) {
          errors.push(`${candidateUrl} -> invalid content-type: ${contentType}`);
          continue;
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength && contentLength > maxBytes) {
          throw new BadRequestException('图片文件过大，请使用更小的图片（最大 30MB）');
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) {
          throw new BadRequestException('图片文件过大，请使用更小的图片（最大 30MB）');
        }

        const base64 = buffer.toString('base64');
        return `data:${contentType};base64,${base64}`;
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          errors.push(`${candidateUrl} -> timeout`);
          continue;
        }
        const summary = this.summarizeError(error);
        errors.push(`${candidateUrl} -> ${summary}`);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    this.logger.error(
      `[fetchImageAsDataUrl] all candidates failed for ${imageUrl}: ${errors.join(' | ')}`,
    );
    throw new BadGatewayException('图片资源不可访问，请确认图片链接有效且服务端可访问');
  }

  private resolveTextModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested text model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultTextModels[providerName] || 'gemini-3.1-pro';
    }
    return this.providerDefaultTextModels.gemini;
  }

  private hasVectorIntent(prompt: string): boolean {
    if (!prompt) return false;
    const lower = prompt.toLowerCase();
    const keywords = [
      '矢量',
      '矢量图',
      '矢量化',
      'vector',
      'vectorize',
      'vectorization',
      'svg',
      'paperjs',
      'paper.js',
      'svg path',
      '路径代码',
      'path code',
      'vector graphic',
      'vectorgraphics',
    ];
    return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  }

  private sanitizeAvailableTools(tools?: string[], allowVector: boolean = true): string[] {
    const defaultTools = [
      'generateImage',
      'editImage',
      'blendImages',
      'analyzeImage',
      'chatResponse',
      'generateVideo',
      'generatePaperJS',
    ];

    const base = Array.isArray(tools) && tools.length ? tools : defaultTools;
    const unique = Array.from(new Set(base.filter(Boolean)));
    const filtered = allowVector ? unique : unique.filter((tool) => tool !== 'generatePaperJS');

    if (filtered.length > 0) {
      return filtered;
    }

    return allowVector ? defaultTools : defaultTools.filter((tool) => tool !== 'generatePaperJS');
  }

  private enforceSelectedTool(selectedTool: string, allowedTools: string[]): string {
    if (allowedTools.includes(selectedTool)) {
      return selectedTool;
    }

    const fallback = allowedTools.find((tool) => tool !== 'generatePaperJS') || allowedTools[0] || 'chatResponse';
    this.logger.warn(`Selected tool "${selectedTool}" is not allowed. Falling back to "${fallback}".`);
    return fallback;
  }

  @Post('tool-selection')
  async toolSelection(@Body() dto: ToolSelectionRequestDto, @Req() req: any) {
    const allowVector = this.hasVectorIntent(dto.prompt);
    const availableTools = this.sanitizeAvailableTools(dto.availableTools, allowVector);

    // 🔥 添加详细日志
    this.logger.log('🎯 Tool selection request:', {
      aiProvider: dto.aiProvider,
      model: dto.model,
      prompt: dto.prompt.substring(0, 50) + '...',
      hasImages: dto.hasImages,
      imageCount: dto.imageCount,
      availableTools,
      allowVectorIntent: allowVector,
    });

    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    return this.withCredits(req, 'gemini-tool-selection', dto.model, async () => {
      if (providerName) {
        try {
          // 工具选择属于文本推理，优先使用文本模型链路
          const normalizedModel = this.resolveTextModel(providerName, dto.model);

          this.logger.log(`[${providerName.toUpperCase()}] Using provider for tool selection`, {
            originalModel: dto.model,
            normalizedModel,
          });

          const provider = this.factory.getProvider(normalizedModel, providerName);
        const result = await provider.selectTool({
          prompt: dto.prompt,
          availableTools,
          hasImages: dto.hasImages,
          imageCount: dto.imageCount,
          hasCachedImage: dto.hasCachedImage,
          context: dto.context,
          model: normalizedModel,
          providerOptions: (dto as any).providerOptions,
        });

          if (result.success && result.data) {
            const selectedTool = this.enforceSelectedTool(result.data.selectedTool, availableTools);
            this.logger.log(`✅ [${providerName.toUpperCase()}] Tool selected: ${selectedTool}`);
            return {
              selectedTool,
              parameters: { prompt: dto.prompt },
              reasoning: result.data.reasoning,
              confidence: result.data.confidence,
            };
          }

          const message = result.error?.message ?? 'provider returned an error response';
          this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider responded with error: ${message}`);
          throw new ServiceUnavailableException(
            `[${providerName}] tool selection failed: ${message}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider threw exception: ${message}`);
          throw new ServiceUnavailableException(
            `[${providerName}] tool selection failed: ${message}`
          );
        }
      }

      // 🔥 降级到Google Gemini进行工具选择
      this.logger.log('📊 Falling back to Gemini tool selection');
      const result = await this.ai.runToolSelectionPrompt(dto.prompt, availableTools);
      const selectedTool = this.enforceSelectedTool(result.selectedTool, availableTools);

      this.logger.log('✅ [GEMINI] Tool selected:', selectedTool);
      return {
        selectedTool,
        parameters: { prompt: dto.prompt },
        reasoning: result.reasoning,
        confidence: result.confidence,
      };
    }, undefined, undefined, true, this.buildCreditRequestParams(providerName));
  }

  @Post('generate-image')
  async generateImage(@Body() dto: GenerateImageDto, @Req() req: any): Promise<GenerateImageUrlResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);

    const requestedProviderName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    // 联网开关开启时，Ultra(147) 自动切换到 Nano2(Apimart) 生图链路。
    const providerName =
      requestedProviderName === 'banana-3.1' && dto.enableWebSearch
        ? 'nano2'
        : requestedProviderName;
    if (requestedProviderName !== providerName) {
      this.logger.log(
        `[generate-image] provider rerouted by web search: ${requestedProviderName} -> ${providerName}`
      );
    }
    const model = this.resolveImageModel(providerName, dto.model);
    const serviceType = this.getImageGenerationServiceType(model, providerName || undefined);
    const normalizedImageUrlsForProvider = this.normalizeImageUrlsForUpstream(
      (dto.imageUrls || []).filter(
        (url): url is string =>
          typeof url === 'string' && url.trim().length > 0,
      ),
    );

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;
    const requestedOutputImageCount =
      dto.batchMode && Number.isFinite(Number(dto.batchCount))
        ? Math.max(1, Math.min(10, Math.floor(Number(dto.batchCount))))
        : 1;

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-generate',
      stage: 'queued',
      userId,
      provider: providerName || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        model,
        serviceType,
        skipCredits,
        imageOnly: Boolean(dto.imageOnly),
        aspectRatio: dto.aspectRatio || null,
        imageSize: dto.imageSize || null,
        enableWebSearch: Boolean(dto.enableWebSearch),
        inputImageCount: normalizedImageUrlsForProvider.length,
      },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-generate',
        stage: 'processing',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'processing',
        metadata: {
          model,
          serviceType,
        },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType, model, async () => {
        const maxAttempts = 3;
        const retryDelaysMs = [500, 1200];

        const shouldRetryOutputError = (error: unknown): boolean => {
          if (error instanceof HttpException) {
            return error.getStatus() === 502;
          }

          const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
          if (!message) return false;

          const retryablePatterns = [
            '生成图像数据为空',
            '无图像数据',
            'no image data',
            'stream api returned no image data',
            'not supported',
            '不是受支持的图片格式',
            'base64',
          ];
          return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) {
              this.logger.warn(`[generate-image] 重试生成第 ${attempt}/${maxAttempts} 次`);
            }

            if (providerName && providerName !== 'gemini-pro') {
              const provider = this.factory.getProvider(dto.model, providerName);
              const result = await provider.generateImage({
                prompt: dto.prompt,
                model,
                imageOnly: dto.imageOnly,
                aspectRatio: dto.aspectRatio,
                imageSize: dto.imageSize,
                thinkingLevel: dto.thinkingLevel,
                outputFormat: dto.outputFormat,
                providerOptions: dto.providerOptions,
                enableWebSearch: dto.enableWebSearch,
                imageUrls: normalizedImageUrlsForProvider.length
                  ? normalizedImageUrlsForProvider
                  : undefined,
                googleSearch: dto.googleSearch ?? dto.enableWebSearch,
                googleImageSearch: dto.googleImageSearch ?? dto.enableWebSearch,
                batchMode: dto.batchMode,
                batchCount: dto.batchCount,
              });

              if (result.success && result.data) {
                const responseMetadata: Record<string, any> = {
                  ...(result.data.metadata || {}),
                  ...(dto.enableWebSearch ? { webSearchEnabled: true } : {}),
                };

                // 如果有 imageData，上传到 OSS
                if (result.data.imageData) {
                  const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
                  const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });
                  return {
                    imageUrl: upload.url,
                    textResponse: result.data.textResponse || '',
                    metadata: {
                      ...responseMetadata,
                      imageUrl: upload.url,
                      imageKey: upload.key,
                      mimeType: upload.mimeType,
                      bytes: upload.size,
                    },
                  };
                }

                const providerImageUrls = this.collectProviderImageUrls(result.data);
                if (providerImageUrls.length > 0) {
                  try {
                    const managedResults = await Promise.all(
                      providerImageUrls.map((url) =>
                        this.persistProviderImageUrlToManagedWithRetry(url, req, userId),
                      ),
                    );
                    const managedImageUrls = managedResults
                      .map((item) => item.url)
                      .filter((item): item is string => Boolean(item));

                    if (managedImageUrls.length === 0) {
                      throw new Error('managed image url list is empty');
                    }

                    const primaryImageUrl = managedImageUrls[0];
                    const firstUploaded = managedResults.find((item) => item.uploaded);
                    return {
                      imageUrl: primaryImageUrl,
                      textResponse: result.data.textResponse || '',
                      metadata: {
                        ...responseMetadata,
                        imageUrl: primaryImageUrl,
                        imageUrls: managedImageUrls,
                        sourceImageUrl: providerImageUrls[0],
                        sourceImageUrls: providerImageUrls,
                        ...(firstUploaded
                          ? {
                              imageKey: firstUploaded.key,
                              mimeType: firstUploaded.mimeType,
                              bytes: firstUploaded.bytes,
                            }
                          : {}),
                      },
                    };
                  } catch (error) {
                    this.logger.error(
                      `[generate-image] 外链图片处理失败: ${this.summarizeError(error)}`
                    );
                    throw new BadGatewayException(
                      '外链图片处理失败，请稍后重试（必要时请配置 ALLOWED_PROXY_HOSTS，或检查上游 URL 是否可访问）'
                    );
                  }
                }
              }
              throw new Error(result.error?.message || 'Failed to generate image');
            }

            // gemini 和 gemini-pro 都使用默认的 Gemini 服务
            const data = await this.imageGeneration.generateImage({ ...dto, customApiKey });

            const watermarked = await this.watermarkIfNeeded(data.imageData, req);
            const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });
            return {
              imageUrl: upload.url,
              textResponse: data.textResponse || '',
              metadata: {
                ...(data.metadata || {}),
                ...(dto.enableWebSearch ? { webSearchEnabled: true } : {}),
                imageUrl: upload.url,
                imageKey: upload.key,
                mimeType: upload.mimeType,
                bytes: upload.size,
              },
            };
          } catch (error) {
            if (attempt < maxAttempts && shouldRetryOutputError(error)) {
              const delay =
                retryDelaysMs[attempt - 1] ??
                retryDelaysMs[retryDelaysMs.length - 1] ??
                0;
              this.logger.warn(
                `[generate-image] 第 ${attempt}/${maxAttempts} 次失败（${this.summarizeError(error)}），${delay}ms 后重试`
              );
              if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
              continue;
            }
            throw error;
          }
        }

        throw new InternalServerErrorException('图片生成重试次数耗尽，请稍后重试。');
      }, 0, requestedOutputImageCount, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        aspectRatio: dto.aspectRatio,
        outputImageCount: requestedOutputImageCount,
        parallelGroupId: dto.parallelGroupId,
        parallelGroupIndex: dto.parallelGroupIndex,
        parallelGroupTotal: dto.parallelGroupTotal,
        nodeConfigKey: dto.nodeConfigKey,
        nodeConfigNameZh: dto.nodeConfigNameZh,
        nodeConfigNameEn: dto.nodeConfigNameEn,
        ...this.buildRequestPromptAndImageParams(dto.prompt, normalizedImageUrlsForProvider),
      }, dto.providerOptions), {
        validateSuccessResult: (payload) => ({
          ok: this.hasImagePayload(payload),
          message: 'Image generation succeeded but no image payload returned',
        }),
      });

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-generate',
        stage: 'succeeded',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: {
          model,
          serviceType,
          imageUrl: result.imageUrl,
          hasTextResponse: Boolean(result.textResponse),
        },
        receivedAt: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[generate-image] 失败: ${errorMessage}`);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-generate',
        stage: 'failed',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: {
          model,
          serviceType,
        },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto, @Req() req: any): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 根据模型选择服务类型：Fast (2.5) / Nano banana 2 (3.1) / Pro
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-edit'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-edit'
      : 'gemini-image-edit';
    const requestUserId = this.resolveRequestUserId(req) || 'anonymous';
    const bananaImageMode = this.isBananaProviderName(providerName)
      ? await this.getBananaImageProviderMode(dto.providerOptions)
      : 'auto';
    const tencentForcedBanana =
      this.isBananaProviderName(providerName) && bananaImageMode === 'tencent';
    if (tencentForcedBanana) {
      this.logger.log(
        '[edit-image] banana_provider=tencent detected, preparing Tencent-compatible source image',
      );
    }
    console.log(`\n========== [editImage] ==========`);
    console.log(`dto.model: ${dto.model}`);
    console.log(`resolved model: ${model}`);
    console.log(`serviceType: ${serviceType}`);
    console.log(`=================================\n`);

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-edit',
      stage: 'queued',
      userId,
      provider: providerName || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: { model, serviceType, skipCredits, imageSize: dto.imageSize || null },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-edit',
        stage: 'processing',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'processing',
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType as any, model, async () => {
      const maxAttempts = 3;
      const retryDelaysMs = [500, 1200];

      const shouldRetryOutputError = (error: unknown): boolean => {
        if (error instanceof HttpException) {
          return error.getStatus() === 502;
        }

        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (!message) return false;

        const retryablePatterns = [
          '编辑成功但未返回图片数据',
          '生成图像数据为空',
          '无图像数据',
          'no image data',
          'stream api returned no image data',
          'not supported',
          '不是受支持的图片格式',
          'base64',
        ];
        return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            this.logger.warn(`[edit-image] 重试编辑第 ${attempt}/${maxAttempts} 次`);
          }

          const fallbackUrl =
            !dto.sourceImageUrl && dto.sourceImage && /^https?:\/\//i.test(dto.sourceImage)
              ? dto.sourceImage
              : dto.sourceImageUrl;

          // MJ 支持直接使用 URL，不需要转换为 base64
          const isMidjourney = providerName === 'midjourney';

          let sourceImage: string | undefined;
          if (tencentForcedBanana) {
            if (dto.sourceImage && !fallbackUrl) {
              sourceImage = dto.sourceImage;
            } else if (fallbackUrl) {
              sourceImage = fallbackUrl;
            }
          } else if (isMidjourney && fallbackUrl) {
            // MJ: 直接使用 URL
            sourceImage = fallbackUrl;
          } else if (dto.sourceImage && !fallbackUrl) {
            sourceImage = dto.sourceImage;
          } else if (fallbackUrl) {
            sourceImage = await this.fetchImageAsDataUrl(fallbackUrl);
          }

          if (!sourceImage) {
            throw new BadRequestException('编辑图片接口需要提供 sourceImage 或 sourceImageUrl');
          }

          if (tencentForcedBanana) {
            sourceImage = await this.normalizeSourceImageForTencentForced(
              sourceImage,
              requestUserId,
              'edit-image',
            );
          } else if (!isMidjourney || !sourceImage.startsWith('http')) {
            // 非 MJ 时验证 sourceImage 是有效的图片格式
            this.validateImageDataUrl(sourceImage);
          }

          if (providerName && providerName !== 'gemini-pro') {
            const provider = this.factory.getProvider(dto.model, providerName);
            const result = await provider.editImage({
              prompt: dto.prompt,
              sourceImage,
              model,
              imageOnly: dto.imageOnly,
              aspectRatio: dto.aspectRatio,
              imageSize: dto.imageSize,
              thinkingLevel: dto.thinkingLevel,
              outputFormat: dto.outputFormat,
              providerOptions: dto.providerOptions,
            });
            if (result.success && result.data) {
              if (result.data.imageData) {
                const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
                return {
                  imageData: watermarked,
                  textResponse: result.data.textResponse || '',
                  metadata: result.data.metadata,
                };
              }

              const providerImageUrls = this.collectProviderImageUrls(result.data);
              const providerImageUrl = providerImageUrls[0];
              if (!providerImageUrl) {
                throw new BadGatewayException('编辑成功但未返回图片数据');
              }

              const sourceImageDataUrl = await this.fetchImageAsDataUrl(providerImageUrl);
              const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
              return {
                imageData: watermarked,
                textResponse: result.data.textResponse || '',
                metadata: {
                  ...(result.data.metadata || {}),
                  sourceImageUrl: providerImageUrl,
                  sourceImageUrls: providerImageUrls,
                },
              };
            }
            throw new Error(result.error?.message || 'Failed to edit image');
          }

          // gemini 和 gemini-pro 都使用默认的 Gemini 服务
          const data = await this.imageGeneration.editImage({ ...dto, sourceImage, customApiKey });
          const watermarked = await this.watermarkIfNeeded(data.imageData, req);
          return { ...data, imageData: watermarked };
        } catch (error) {
          if (attempt < maxAttempts && shouldRetryOutputError(error)) {
            const delay =
              retryDelaysMs[attempt - 1] ??
              retryDelaysMs[retryDelaysMs.length - 1] ??
              0;
            this.logger.warn(
              `[edit-image] 第 ${attempt}/${maxAttempts} 次失败（${this.summarizeError(error)}），${delay}ms 后重试`
            );
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException('图片编辑重试次数耗尽，请稍后重试。');
      }, 1, 1, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        aspectRatio: dto.aspectRatio,
        parallelGroupId: dto.parallelGroupId,
        parallelGroupIndex: dto.parallelGroupIndex,
        parallelGroupTotal: dto.parallelGroupTotal,
        nodeConfigKey: dto.nodeConfigKey,
        nodeConfigNameZh: dto.nodeConfigNameZh,
        nodeConfigNameEn: dto.nodeConfigNameEn,
        ...this.buildRequestPromptAndImageParams(dto.prompt, [
          dto.sourceImageUrl,
          dto.sourceImage && /^https?:\/\//i.test(dto.sourceImage) ? dto.sourceImage : undefined,
        ]),
      }, dto.providerOptions), {
        validateSuccessResult: (payload) => ({
          ok: this.hasImagePayload(payload),
          message: 'Image edit succeeded but no image payload returned',
        }),
      });

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-edit',
        stage: 'succeeded',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: { model, serviceType, hasImageData: Boolean(result?.imageData) },
        receivedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-edit',
        stage: 'failed',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto, @Req() req: any): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-blend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 根据模型选择服务类型：Fast (2.5) / Nano banana 2 (3.1) / Pro
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-blend'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-blend'
      : 'gemini-image-blend';
    const requestUserId = this.resolveRequestUserId(req) || 'anonymous';
    const bananaImageMode = this.isBananaProviderName(providerName)
      ? await this.getBananaImageProviderMode(dto.providerOptions)
      : 'auto';
    const tencentForcedBanana =
      this.isBananaProviderName(providerName) && bananaImageMode === 'tencent';
    if (tencentForcedBanana) {
      this.logger.log(
        '[blend-images] banana_provider=tencent detected, preparing Tencent-compatible source images',
      );
    }

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-blend',
      stage: 'queued',
      userId,
      provider: providerName || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: { model, serviceType, skipCredits, imageSize: dto.imageSize || null },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-blend',
        stage: 'processing',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'processing',
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType as any, model, async () => {
      const maxAttempts = 3;
      const retryDelaysMs = [500, 1200];

      const shouldRetryOutputError = (error: unknown): boolean => {
        if (error instanceof HttpException) {
          return error.getStatus() === 502;
        }

        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (!message) return false;

        const retryablePatterns = [
          '融合成功但未返回图片数据',
          '生成图像数据为空',
          '无图像数据',
          'no image data',
          'stream api returned no image data',
          'not supported',
          '不是受支持的图片格式',
          'base64',
        ];
        return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            this.logger.warn(`[blend-images] 重试融合第 ${attempt}/${maxAttempts} 次`);
          }

          const sourceImages = tencentForcedBanana
            ? dto.sourceImages?.length
              ? dto.sourceImages
              : dto.sourceImageUrls?.length
              ? dto.sourceImageUrls
              : []
            : dto.sourceImages?.length
            ? await Promise.all(
                dto.sourceImages.map(async (value) =>
                  /^https?:\/\//i.test(value) ? this.fetchImageAsDataUrl(value) : value,
                ),
              )
            : dto.sourceImageUrls?.length
            ? await Promise.all(dto.sourceImageUrls.map((url) => this.fetchImageAsDataUrl(url)))
            : [];

          if (!sourceImages.length) {
            throw new BadRequestException('融合图片接口需要提供 sourceImages 或 sourceImageUrls（至少两张）');
          }

          const normalizedSourceImages = tencentForcedBanana
            ? await Promise.all(
                sourceImages.map((value, index) =>
                  this.normalizeSourceImageForTencentForced(
                    value,
                    requestUserId,
                    `blend-images#${index + 1}`,
                  ),
                ),
              )
            : sourceImages;

          if (providerName && providerName !== 'gemini-pro') {
            const provider = this.factory.getProvider(dto.model, providerName);
            const result = await provider.blendImages({
              prompt: dto.prompt,
              sourceImages: normalizedSourceImages,
              model,
              imageOnly: dto.imageOnly,
              aspectRatio: dto.aspectRatio,
              imageSize: dto.imageSize,
              thinkingLevel: dto.thinkingLevel,
              outputFormat: dto.outputFormat,
              providerOptions: dto.providerOptions,
            });
            if (result.success && result.data) {
              if (result.data.imageData) {
                const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
                return {
                  imageData: watermarked,
                  textResponse: result.data.textResponse || '',
                  metadata: result.data.metadata,
                };
              }

              const providerImageUrls = this.collectProviderImageUrls(result.data);
              const providerImageUrl = providerImageUrls[0];
              if (!providerImageUrl) {
                throw new BadGatewayException('融合成功但未返回图片数据');
              }

              const sourceImageDataUrl = await this.fetchImageAsDataUrl(providerImageUrl);
              const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
              return {
                imageData: watermarked,
                textResponse: result.data.textResponse || '',
                metadata: {
                  ...(result.data.metadata || {}),
                  sourceImageUrl: providerImageUrl,
                  sourceImageUrls: providerImageUrls,
                },
              };
            }
            throw new Error(result.error?.message || 'Failed to blend images');
          }

          // gemini 和 gemini-pro 都使用默认的 Gemini 服务
          const data = await this.imageGeneration.blendImages({
            ...dto,
            sourceImages: normalizedSourceImages,
            customApiKey,
          });
          const watermarked = await this.watermarkIfNeeded(data.imageData, req);
          return { ...data, imageData: watermarked };
        } catch (error) {
          if (attempt < maxAttempts && shouldRetryOutputError(error)) {
            const delay =
              retryDelaysMs[attempt - 1] ??
              retryDelaysMs[retryDelaysMs.length - 1] ??
              0;
            this.logger.warn(
              `[blend-images] 第 ${attempt}/${maxAttempts} 次失败（${this.summarizeError(error)}），${delay}ms 后重试`
            );
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException('图片融合重试次数耗尽，请稍后重试。');
      }, dto.sourceImages?.length || 0, 1, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        aspectRatio: dto.aspectRatio,
        parallelGroupId: dto.parallelGroupId,
        parallelGroupIndex: dto.parallelGroupIndex,
        parallelGroupTotal: dto.parallelGroupTotal,
        nodeConfigKey: dto.nodeConfigKey,
        nodeConfigNameZh: dto.nodeConfigNameZh,
        nodeConfigNameEn: dto.nodeConfigNameEn,
        ...this.buildRequestPromptAndImageParams(dto.prompt, [
          ...(Array.isArray(dto.sourceImageUrls) ? dto.sourceImageUrls : []),
          ...(Array.isArray(dto.sourceImages) ? dto.sourceImages : []),
        ]),
      }, dto.providerOptions), {
        validateSuccessResult: (payload) => ({
          ok: this.hasImagePayload(payload),
          message: 'Image blend succeeded but no image payload returned',
        }),
      });

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-blend',
        stage: 'succeeded',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: { model, serviceType, hasImageData: Boolean(result?.imageData) },
        receivedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-blend',
        stage: 'failed',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('midjourney/action')
  async midjourneyAction(@Body() dto: MidjourneyActionDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
      const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
      if (!(provider instanceof MidjourneyProvider)) {
        throw new ServiceUnavailableException('MJ 服务暂不可用，请检查账号配置');
      }

      const result = await provider.triggerAction({
        taskId: dto.taskId,
        customId: dto.customId,
        state: dto.state,
        notifyHook: dto.notifyHook,
        chooseSameChannel: dto.chooseSameChannel,
        accountFilter: dto.accountFilter,
      });

      if (result.success && result.data) {
        const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
        return {
          imageData: watermarked,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
        };
      }

      throw new ServiceUnavailableException(
        result.error?.message || 'Failed to execute Midjourney action.'
      );
    }, 0, 1);
  }

  @Post('midjourney/modal')
  async midjourneyModal(@Body() dto: MidjourneyModalDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
      const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
      if (!(provider instanceof MidjourneyProvider)) {
        throw new ServiceUnavailableException('MJ 服务暂不可用，请检查账号配置');
      }

      const result = await provider.executeModal({
        taskId: dto.taskId,
        prompt: dto.prompt,
        maskBase64: dto.maskBase64,
      });

      if (result.success && result.data) {
        const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
        return {
          imageData: watermarked,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
        };
      }

      throw new ServiceUnavailableException(
        result.error?.message || 'Failed to execute Midjourney modal action.'
      );
    }, 0, 1);
  }

  @Post('analyze-image')
  async analyzeImage(@Body() dto: AnalyzeImageDto, @Req() req: any) {
    const requestedProvider =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const normalizedImages = Array.from(
      new Set(
        [
          ...(Array.isArray(dto.sourceImages) ? dto.sourceImages : []),
          ...(typeof dto.sourceImage === 'string' ? [dto.sourceImage] : []),
        ]
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0),
      ),
    );
    if (normalizedImages.length === 0) {
      throw new BadRequestException('分析文件接口需要提供 sourceImage 或 sourceImages');
    }
    const hasPdf = normalizedImages.some((value) => this.isPdfLikeInput(value));
    const shouldForceGeminiForPdf =
      hasPdf && this.isPdfAnalyzeProviderUnsafe(requestedProvider);
    const effectiveProvider = shouldForceGeminiForPdf ? null : requestedProvider;
    const model = shouldForceGeminiForPdf
      ? this.resolveGeminiPdfAnalyzeModel(dto.model)
      : this.resolveAnalyzeModel(effectiveProvider, dto.model);
    const primarySourceImage = normalizedImages[0];

    if (shouldForceGeminiForPdf) {
      this.logger.log(
        `Detected PDF input for analyze-image, rerouting provider ${requestedProvider} to Gemini document analysis with model ${model}`,
      );
    }

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(effectiveProvider)
      ? await this.getUserCustomApiKey(req)
      : null;
    const skipCredits = !!customApiKey;

    // Map analyze billing by provider tier: Fast(2.5), Pro(3.0), Ultra(3.1).
    const serviceType: ServiceType =
      requestedProvider === 'banana-2.5'
        ? 'gemini-2.5-image-analyze'
        : requestedProvider === 'banana-3.1' || requestedProvider === 'nano2'
        ? 'gemini-3.1-image-analyze'
        : 'gemini-image-analyze';

    return this.withCredits(req, serviceType as any, model, async () => {
      if (effectiveProvider && effectiveProvider !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, effectiveProvider);
        const result = await provider.analyzeImage({
          prompt: dto.prompt,
          sourceImage: primarySourceImage,
          sourceImages: normalizedImages,
          model,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          const text =
            typeof result.data.text === 'string' ? result.data.text.trim() : '';
          if (!text) {
            throw new ServiceUnavailableException(
              'Analysis returned empty response, please try again later',
            );
          }
          return {
            text,
          };
        }
        throw new Error(result.error?.message || 'Failed to analyze image');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      return this.analyzeViaGeminiWithPdfFallback(
        dto,
        primarySourceImage,
        normalizedImages,
        model,
        customApiKey,
        hasPdf,
      );
    }, normalizedImages.length, 0, skipCredits, this.buildCreditRequestParams(requestedProvider, {
      ...this.buildRequestPromptAndImageParams(dto.prompt, normalizedImages),
    }, dto.providerOptions));
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto, @Req() req: any) {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);
    const billingTag = dto.billingTag === 'prompt_optimize' ? 'prompt_optimize' : 'text_chat';
    const serviceType: ServiceType =
      billingTag === 'prompt_optimize' ? 'gemini-prompt-optimize' : 'gemini-text';

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, serviceType, model, async () => {
      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.generateText({
          prompt: dto.prompt,
          model,
          enableWebSearch: dto.enableWebSearch,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          return {
            text: result.data.text,
          };
        }
        throw new Error(result.error?.message || 'Failed to generate text');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      return this.imageGeneration.generateTextResponse({ ...dto, customApiKey });
    }, undefined, undefined, skipCredits, this.buildCreditRequestParams(providerName, {
      billingTag,
      model,
      requestedProvider: dto.aiProvider,
      ...this.buildRequestPromptAndImageParams(dto.prompt),
    }, dto.providerOptions));
  }

  @Post('remove-background')
  async removeBackground(@Body() dto: RemoveBackgroundDto, @Req() req: any) {
    this.logger.log('🎯 Background removal request received');

    return this.withCredits(req, 'background-removal', undefined, async () => {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ Background removal succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    }, 1, 1);
  }

  // 开发模式：无需认证的抠图接口
  @Post('remove-background-public')
  async removeBackgroundPublic(@Body() dto: RemoveBackgroundDto) {
    this.logger.log('🎯 Background removal (public) request received');

    try {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        // 默认为base64
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ Background removal (public) succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ Background removal (public) failed:', message);
      throw new ServiceUnavailableException({
        success: false,
        error: message,
      });
    }
  }

  @Get('background-removal-info')
  async getBackgroundRemovalInfo() {
    this.logger.log('📊 Background removal info requested');
    const info = await this.backgroundRemoval.getInfo();
    return info;
  }

  @Post('convert-2d-to-3d')
  async convert2Dto3D(@Body() dto: Convert2Dto3DDto, @Req() req: any) {
    this.logger.log('🎨 2D to 3D conversion request received');

    const userId = req?.user?.id || req?.user?.userId || req?.user?.sub;
    const normalizedImageUrl = dto.imageUrl
      ? this.normalizeImageUrlForUpstream(dto.imageUrl)
      : undefined;
    let apiUsageId: string | undefined;
    this.logger.log(
      `[2D->3D] create request meta userId=${typeof userId === 'string' ? userId : '-'} projectId=${
        dto.projectId || '-'
      } hasImage=${Boolean(normalizedImageUrl)} promptLength=${dto.prompt?.trim().length || 0} normalizedImageUrl=${
        normalizedImageUrl ? normalizedImageUrl.slice(0, 200) : '-'
      }`,
    );

    try {
      const response = await this.withCredits(
        req,
        'convert-2d-to-3d',
        undefined,
        async () => {
          const taskId = `async-2d3d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          this.logger.log(
            `[2D->3D] creating async task taskId=${taskId} apiUsageId=${apiUsageId || '-'} projectId=${
              dto.projectId || '-'
            }`,
          );
          createAsyncTask(taskId);

          if (apiUsageId) {
            try {
              await this.creditsService.updateApiUsageRequestParams(apiUsageId, { taskId });
              this.logger.log(
                `[2D->3D] bound apiUsageId=${apiUsageId} to taskId=${taskId}`,
              );
            } catch (error) {
              this.logger.warn(
                `[2D->3D] Failed to bind taskId to apiUsage: ${this.summarizeError(error)}`,
              );
            }
          }

          this.startAsyncConvert2Dto3DTask(taskId, {
            imageUrl: normalizedImageUrl,
            prompt: dto.prompt,
            projectId: dto.projectId,
            userId: typeof userId === 'string' ? userId : undefined,
            apiUsageId,
          });

          return {
            success: true,
            taskId,
            status: 'pending' as const,
            message: '2D转3D任务已提交，请通过 taskId 轮询查询进度',
          };
      },
      1,
      1,
      false,
      undefined,
      {
        onApiUsageId: (id: string) => {
          apiUsageId = id;
          this.logger.log(`[2D->3D] withCredits allocated apiUsageId=${id}`);
        },
          skipFinalizeSuccessIf: () => true,
        },
      );

      this.logger.log(
        `[2D->3D] create request accepted taskId=${response.taskId || '-'} apiUsageId=${apiUsageId || '-'} status=${
          response.status || '-'
        }`,
      );

      return {
        success: response.success,
        taskId: response.taskId,
        status: response.status,
        message: response.message,
      };
    } catch (error) {
      this.logger.error(
        `[2D->3D] create request failed userId=${typeof userId === 'string' ? userId : '-'} projectId=${
          dto.projectId || '-'
        } apiUsageId=${apiUsageId || '-'} error=${this.summarizeError(error)}`,
      );
      throw error;
    }
  }

  @Get('convert-2d-to-3d/task/:taskId')
  async queryConvert2Dto3DTask(@Param('taskId') taskId: string) {
    const trimmedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
    if (!trimmedTaskId) {
      throw new BadRequestException('taskId 不能为空');
    }

    const task = getAsyncTaskResult(trimmedTaskId);
    if (!task) {
      throw new BadRequestException('任务不存在或已过期');
    }

    if (task.status === 'completed') {
      return {
        success: true,
        taskId: trimmedTaskId,
        status: 'completed',
        modelUrl: task.result?.modelUrl,
        promptId: task.result?.promptId,
        modelKey: task.result?.modelKey,
      };
    }

    if (task.status === 'failed') {
      return {
        success: false,
        taskId: trimmedTaskId,
        status: 'failed',
        error: task.error || '2D转3D任务失败',
      };
    }

    return {
      success: true,
      taskId: trimmedTaskId,
      status: task.status,
      message: task.status === 'processing' ? '2D转3D处理中' : '2D转3D任务排队中',
    };
  }

  private startAsyncConvert2Dto3DTask(
    taskId: string,
    options: {
      imageUrl?: string;
      prompt?: string;
      projectId?: string;
      userId?: string;
      apiUsageId?: string;
    },
  ) {
    this.logger.log(
      `[2D->3D] async task queued taskId=${taskId} apiUsageId=${options.apiUsageId || '-'} projectId=${
        options.projectId || '-'
      } hasImage=${Boolean(options.imageUrl)} promptLength=${options.prompt?.trim().length || 0}`,
    );
    void this.processAsyncConvert2Dto3DTask(taskId, options).catch((error) => {
      this.logger.error(
        `[2D->3D] Async task ${taskId} failed: ${this.summarizeError(error)}`,
      );
    });
  }

  private async processAsyncConvert2Dto3DTask(
    taskId: string,
    options: {
      imageUrl?: string;
      prompt?: string;
      projectId?: string;
      userId?: string;
      apiUsageId?: string;
    },
  ) {
    const startedAt = Date.now();
    this.logger.log(
      `[2D->3D] async task started taskId=${taskId} apiUsageId=${options.apiUsageId || '-'} imageUrl=${
        options.imageUrl ? options.imageUrl.slice(0, 200) : '-'
      }`,
    );
    updateAsyncTask(taskId, { status: 'processing' });

    try {
      const result = await this.convert2Dto3DService.convert2Dto3D({
        imageUrl: options.imageUrl,
        prompt: options.prompt,
        projectId: options.projectId,
        userId: options.userId,
      });

      updateAsyncTask(taskId, {
        status: 'completed',
        result: {
          status: 'completed',
          taskId,
          modelUrl: result.modelUrl,
          modelKey: result.modelKey,
          promptId: result.promptId,
        },
      });

      if (options.apiUsageId) {
        await this.creditsService.updateApiUsageStatus(
          options.apiUsageId,
          ApiResponseStatus.SUCCESS,
          undefined,
          Math.max(0, Date.now() - startedAt),
        );
      }

      this.logger.log(
        `[2D->3D] Async task ${taskId} completed modelUrl=${result.modelUrl.slice(0, 200)} modelKey=${
          result.modelKey || '-'
        } promptId=${result.promptId || '-'}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '2D转3D任务执行失败';

      updateAsyncTask(taskId, {
        status: 'failed',
        error: errorMessage,
      });

      if (options.apiUsageId) {
        try {
          await this.creditsService.updateApiUsageStatus(
            options.apiUsageId,
            ApiResponseStatus.FAILED,
            errorMessage,
            Math.max(0, Date.now() - startedAt),
          );
        } catch (statusError) {
          this.logger.error(
            `[2D->3D] Failed to mark apiUsage failed for task ${taskId}: ${this.summarizeError(
              statusError,
            )}`,
          );
        }
      }

      this.logger.error(
        `[2D->3D] async task execution failed taskId=${taskId} apiUsageId=${options.apiUsageId || '-'} error=${errorMessage}`,
      );
      throw error;
    }
  }

  @Post('expand-image')
  async expandImage(@Body() dto: ExpandImageDto, @Req() req: any) {
    this.logger.log('🖼️ Expand image request received');
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-expand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName =
      typeof dto.aiProvider === 'string' && dto.aiProvider.trim() && dto.aiProvider !== 'gemini'
        ? dto.aiProvider.trim()
        : null;
    const model = this.resolveImageModel(providerName, dto.model);
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-edit'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-edit'
      : 'gemini-image-edit';
    const customApiKey = this.isGeminiProvider(providerName)
      ? await this.getUserCustomApiKey(req)
      : null;
    const skipCredits = !!customApiKey;
    const providerOptions =
      dto.providerOptions && typeof dto.providerOptions === 'object'
        ? dto.providerOptions
        : dto.bananaImageRoute
        ? {
            banana: { imageRoute: dto.bananaImageRoute },
            bananaImageRoute: dto.bananaImageRoute,
          }
        : undefined;

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-expand',
      stage: 'queued',
      userId,
      provider: providerName || 'expand-image',
      prompt: dto.prompt?.slice(0, 500) || '扩图',
      status: 'queued',
      metadata: {
        model,
        serviceType,
        skipCredits,
        imageSize: dto.imageSize || null,
        bananaImageRoute:
          dto.bananaImageRoute ||
          this.resolveBananaImageRouteFromProviderOptions(providerOptions) ||
          null,
        expandRatios: Array.isArray(dto.expandRatios) ? dto.expandRatios : null,
      },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-expand',
        stage: 'processing',
        userId,
        provider: providerName || 'expand-image',
        prompt: dto.prompt?.slice(0, 500) || '扩图',
        status: 'processing',
        metadata: {
          model,
          serviceType,
        },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType as any, model, async () => {
      const normalizedImageUrl = this.normalizeImageUrlForUpstream(dto.imageUrl);
      const expanded = await this.expandImageService.expandImage(
        normalizedImageUrl,
        dto.expandRatios,
        dto.prompt || '扩图'
      );

      const managed = await this.persistProviderImageUrlToManagedWithRetry(
        expanded.imageUrl,
        req,
        userId,
      );

      return {
        success: true,
        imageUrl: managed.url,
        promptId: expanded.promptId,
        metadata: {
          sourceImageUrl: managed.sourceImageUrl,
          uploadedToManaged: managed.uploaded,
          imageKey: managed.key,
          mimeType: managed.mimeType,
          bytes: managed.bytes,
        },
      };
      }, 1, 1, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        aspectRatio: dto.aspectRatio,
        thinkingLevel: dto.thinkingLevel,
        ...this.buildRequestPromptAndImageParams(dto.prompt || '扩图', [dto.imageUrl]),
      }, providerOptions));

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-expand',
        stage: 'succeeded',
        userId,
        provider: providerName || 'expand-image',
        prompt: dto.prompt?.slice(0, 500) || '扩图',
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: {
          model,
          serviceType,
          imageUrl: result.imageUrl,
          promptId: result.promptId,
        },
        receivedAt: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-expand',
        stage: 'failed',
        userId,
        provider: providerName || 'expand-image',
        prompt: dto.prompt?.slice(0, 500) || '扩图',
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: {
          model,
          serviceType,
        },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('generate-video')
  async generateVideo(@Body() dto: GenerateVideoDto, @Req() req: any) {
    const quality = dto.quality === 'sd' ? 'sd' : 'hd';
    const serviceType: ServiceType = quality === 'sd' ? 'sora-sd' : 'sora-hd';
    const selectedSoraModel =
      dto.model === 'sora-2' || dto.model === 'sora-2-pro'
        ? dto.model
        : quality === 'hd'
        ? 'sora-2-pro'
        : 'sora-2';
    const normalizedArray =
      dto.referenceImageUrls?.filter((url) => typeof url === 'string' && url.trim().length > 0) ||
      [];
    const legacySingle = dto.referenceImageUrl?.trim();
    const referenceImageUrlsRaw = legacySingle
      ? [...normalizedArray, legacySingle]
      : normalizedArray;
    const referenceImageUrls = this.normalizeImageUrlsForUpstream(referenceImageUrlsRaw);
    const hasCharacterMode =
      (typeof dto.characterTaskId === 'string' && dto.characterTaskId.trim().length > 0) ||
      (typeof dto.characterUrl === 'string' && dto.characterUrl.trim().length > 0);
    const effectiveReferenceImageUrls = hasCharacterMode ? [] : referenceImageUrls;
    const inputImageCount = effectiveReferenceImageUrls.length || undefined;

    this.logger.log(
      `Video generation request received (quality=${quality}, referenceCount=${effectiveReferenceImageUrls.length}, characterMode=${hasCharacterMode})`,
    );
    this.logger.log(`Video generation full dto: ${JSON.stringify(dto)}`);
    if (hasCharacterMode && referenceImageUrls.length > 0) {
      this.logger.warn(
        `Sora2 character mode detected: ignore ${referenceImageUrls.length} reference image(s)`,
      );
    }

    const soraRequestParams = await this.buildSora2CreditParams({
      selectedSoraModel,
      quality,
      aspectRatio: dto.aspectRatio,
      duration: dto.duration,
    });

    return this.withCredits(
      req,
      serviceType,
      selectedSoraModel,
      async () => {
        const result = await this.sora2VideoService.generateVideo({
          prompt: dto.prompt,
          referenceImageUrls: effectiveReferenceImageUrls,
          quality,
          aspectRatio: dto.aspectRatio,
          duration: dto.duration,
          model: dto.model,
          watermark: dto.watermark,
          thumbnail: dto.thumbnail,
          privateMode: dto.privateMode,
          style: dto.style,
          storyboard: dto.storyboard,
          characterUrl: dto.characterUrl,
          characterTimestamps: dto.characterTimestamps,
          characterTaskId: dto.characterTaskId,
        });

        if (!result?.videoUrl) {
          throw new ServiceUnavailableException(
            result?.fallbackMessage || result?.content || '视频生成失败：未返回可用视频链接',
          );
        }

        const skipWatermark = await this.canSkipWatermark(req);
        this.logger.log(`🎬 Video generated, skipWatermark=${skipWatermark}, videoUrl=${result.videoUrl?.substring(0, 80)}...`);

        if (skipWatermark) {
          this.logger.log('🎬 User can skip watermark (admin or whitelist)');
          let proxiedUrl = result.videoUrl;
          try {
            const uploaded = await this.videoWatermarkService.uploadOriginalToOSS(result.videoUrl);
            proxiedUrl = uploaded.url;
            this.logger.log(
              `✅ Video copied to OSS without watermark: ${proxiedUrl?.substring(0, 80)}...`,
            );
          } catch (error) {
            this.logger.warn('⚠️ Video OSS copy failed, fallback to raw URL', error as any);
          }
          return {
            ...result,
            videoUrl: proxiedUrl,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: proxiedUrl,
            watermarkSkipped: true,
          };
        }

        this.logger.log('🎬 User needs watermark, adding...');
        try {
          const wm = await this.videoWatermarkService.addWatermarkAndUpload(result.videoUrl, {
            text: 'Tanvas AI',
          });
          this.logger.log(`✅ Video watermark success: ${wm.url?.substring(0, 80)}...`);
          return {
            ...result,
            videoUrl: wm.url,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: wm.url,
            watermarkSkipped: false,
          };
        } catch (error) {
          this.logger.error('❌ Video watermark failed:', error);
          return {
            ...result,
            videoUrl: result.videoUrl,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: result.videoUrl,
            watermarkFailed: true,
          };
        }
      },
      inputImageCount,
      0,
      undefined,
      soraRequestParams,
    );
  }

  /**
   * 异步视频生成接口
   * 立即返回 taskId，前端通过轮询 /ai/sora2/video/:taskId 查询进度
   * 解决线上反向代理超时问题（504 Gateway Timeout）
   */
  @Post('generate-video-async')
  async generateVideoAsync(@Body() dto: GenerateVideoDto, @Req() req: any) {
    const quality = dto.quality === 'sd' ? 'sd' : 'hd';
    const serviceType: ServiceType = quality === 'sd' ? 'sora-sd' : 'sora-hd';
    const selectedSoraModel =
      dto.model === 'sora-2' || dto.model === 'sora-2-pro'
        ? dto.model
        : quality === 'hd'
        ? 'sora-2-pro'
        : 'sora-2';
    const normalizedArray =
      dto.referenceImageUrls?.filter((url) => typeof url === 'string' && url.trim().length > 0) ||
      [];
    const legacySingle = dto.referenceImageUrl?.trim();
    const referenceImageUrlsRaw = legacySingle
      ? [...normalizedArray, legacySingle]
      : normalizedArray;
    const referenceImageUrls = this.normalizeImageUrlsForUpstream(referenceImageUrlsRaw);
    const hasCharacterMode =
      (typeof dto.characterTaskId === 'string' && dto.characterTaskId.trim().length > 0) ||
      (typeof dto.characterUrl === 'string' && dto.characterUrl.trim().length > 0);
    const effectiveReferenceImageUrls = hasCharacterMode ? [] : referenceImageUrls;
    const inputImageCount = effectiveReferenceImageUrls.length || undefined;

    this.logger.log(
      `[Async] Video generation request received (quality=${quality}, referenceCount=${effectiveReferenceImageUrls.length}, characterMode=${hasCharacterMode})`,
    );

    const soraRequestParams = await this.buildSora2CreditParams({
      selectedSoraModel,
      quality,
      aspectRatio: dto.aspectRatio,
      duration: dto.duration,
    });

    // 创建异步任务并写入内存存储
    const taskId = `async-sora2-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    createAsyncTask(taskId);
    const traceContext = this.getTraceContext(req);
    void this.telemetryService.ingestGenerationTask({
      traceId: traceContext.traceId || null,
      parentRequestId: traceContext.parentRequestId || null,
      taskId,
      taskType: 'video-generate',
      stage: 'queued',
      userId: this.getUserId(req),
      provider: selectedSoraModel,
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        quality,
        referenceCount: effectiveReferenceImageUrls.length,
        aspectRatio: dto.aspectRatio || null,
        duration: dto.duration || null,
      },
      receivedAt: new Date().toISOString(),
    });

    // 在后台执行实际任务（不阻塞请求）
    this.executeVideoGenerationAsync(
      taskId,
      traceContext,
      req,
      serviceType,
      selectedSoraModel,
      {
        prompt: dto.prompt,
        referenceImageUrls: effectiveReferenceImageUrls,
        quality,
        aspectRatio: dto.aspectRatio,
        duration: dto.duration,
        model: dto.model,
        watermark: dto.watermark,
        thumbnail: dto.thumbnail,
        privateMode: dto.privateMode,
        style: dto.style,
        storyboard: dto.storyboard,
        characterUrl: dto.characterUrl,
        characterTimestamps: dto.characterTimestamps,
        characterTaskId: dto.characterTaskId,
      },
      inputImageCount,
      0,
      soraRequestParams,
    );

    // 立即返回 taskId，不等待视频生成完成
    return {
      success: true,
      taskId,
      status: 'pending',
      message: '视频生成任务已提交，请通过 taskId 轮询查询进度',
    };
  }

  /**
   * 后台执行视频生成（不阻塞 HTTP 请求）
   */
  private async executeVideoGenerationAsync(
    taskId: string,
    traceContext: PersistedTraceContext,
    req: any,
    serviceType: ServiceType,
    selectedSoraModel: string,
    options: Parameters<typeof this.sora2VideoService.generateVideo>[0],
    inputImageCount: number | undefined,
    outputImageCount: number,
    requestParams?: Record<string, any>,
  ): Promise<void> {
    // 异步执行，不等待结果
    this.processVideoGenerationTask(taskId, traceContext, req, serviceType, selectedSoraModel, options, inputImageCount, outputImageCount, requestParams)
      .catch((error) => {
        this.logger.error(`[Async] Video generation task ${taskId} failed:`, error);
      });
  }

  /**
   * 处理视频生成任务（积分扣费 + 实际生成）
   */
  private async processVideoGenerationTask(
    taskId: string,
    traceContext: PersistedTraceContext,
    req: any,
    serviceType: ServiceType,
    selectedSoraModel: string,
    options: Parameters<typeof this.sora2VideoService.generateVideo>[0],
    inputImageCount: number | undefined,
    outputImageCount: number,
    requestParams?: Record<string, any>,
  ): Promise<void> {
    let apiUsageId: string | null = null;

    await runWithSpan(
      'video-task.generate',
      traceContext,
      {
        'app.task.id': taskId,
        'app.task.type': 'video-generate',
        'app.user.id': this.getUserId(req) || 'anonymous',
        'app.ai.provider': selectedSoraModel,
      },
      async () => {
        // 更新任务状态为处理中
        updateAsyncTask(taskId, { status: 'processing' });
        const startedAt = Date.now();
        void this.telemetryService.ingestGenerationTask({
          traceId: traceContext.traceId || null,
          parentRequestId: traceContext.parentRequestId || null,
          taskId,
          taskType: 'video-generate',
          stage: 'processing',
          userId: this.getUserId(req),
          provider: selectedSoraModel,
          prompt: typeof options?.prompt === 'string' ? options.prompt.slice(0, 500) : null,
          status: 'processing',
          metadata: {
            apiUsageId,
            serviceType,
            inputImageCount: inputImageCount ?? null,
            outputImageCount,
          },
          receivedAt: new Date().toISOString(),
        });

        try {
          const result = await this.withCredits(
            req,
            serviceType,
            selectedSoraModel,
            async () => {
              const videoResult = await this.sora2VideoService.generateVideo(options);

              if (!videoResult?.videoUrl) {
                throw new ServiceUnavailableException(
                  videoResult?.fallbackMessage || videoResult?.content || '视频生成失败：未返回可用视频链接',
                );
              }

              const skipWatermark = await this.canSkipWatermark(req);
              this.logger.log(`[Async] Video generated for task ${taskId}, skipWatermark=${skipWatermark}`);

              let finalResult = { ...videoResult };

              if (skipWatermark) {
                let proxiedUrl = videoResult.videoUrl;
                try {
                  const uploaded = await this.videoWatermarkService.uploadOriginalToOSS(videoResult.videoUrl);
                  proxiedUrl = uploaded.url;
                } catch (error) {
                  this.logger.warn(`[Async] Video OSS copy failed for task ${taskId}`, error);
                }
                finalResult = {
                  ...videoResult,
                  videoUrl: proxiedUrl,
                  videoUrlRaw: videoResult.videoUrl,
                  videoUrlWatermarked: proxiedUrl,
                  watermarkSkipped: true,
                };
              } else {
                try {
                  const wm = await this.videoWatermarkService.addWatermarkAndUpload(videoResult.videoUrl, {
                    text: 'Tanvas AI',
                  });
                  finalResult = {
                    ...videoResult,
                    videoUrl: wm.url,
                    videoUrlRaw: videoResult.videoUrl,
                    videoUrlWatermarked: wm.url,
                    watermarkSkipped: false,
                  };
                } catch (error) {
                  this.logger.error(`[Async] Video watermark failed for task ${taskId}:`, error);
                  finalResult = {
                    ...videoResult,
                    videoUrl: videoResult.videoUrl,
                    videoUrlRaw: videoResult.videoUrl,
                    videoUrlWatermarked: videoResult.videoUrl,
                    watermarkFailed: true,
                  };
                }
              }

              return finalResult;
            },
            inputImageCount,
            outputImageCount,
            undefined,
            requestParams,
            {
              onApiUsageId: (value) => {
                apiUsageId = value;
              },
            },
          );

          updateAsyncTask(taskId, {
            status: 'completed',
            result: result as any,
          });
          this.logger.log(`[Async] Video generation task ${taskId} completed successfully`);
          void this.telemetryService.ingestGenerationTask({
            traceId: traceContext.traceId || null,
            parentRequestId: traceContext.parentRequestId || null,
            taskId,
            taskType: 'video-generate',
            stage: 'succeeded',
            userId: this.getUserId(req),
            provider: selectedSoraModel,
            prompt: typeof options?.prompt === 'string' ? options.prompt.slice(0, 500) : null,
            status: 'completed',
            durationMs: Date.now() - startedAt,
            metadata: {
              apiUsageId,
              serviceType,
              hasVideoUrl: Boolean((result as any)?.videoUrl),
            },
            receivedAt: new Date().toISOString(),
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          updateAsyncTask(taskId, {
            status: 'failed',
            error: errorMessage,
          });
          this.logger.error(`[Async] Video generation task ${taskId} failed:`, error);
          void this.telemetryService.ingestGenerationTask({
            traceId: traceContext.traceId || null,
            parentRequestId: traceContext.parentRequestId || null,
            taskId,
            taskType: 'video-generate',
            stage: 'failed',
            userId: this.getUserId(req),
            provider: selectedSoraModel,
            prompt: typeof options?.prompt === 'string' ? options.prompt.slice(0, 500) : null,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            error: errorMessage,
            metadata: {
              apiUsageId,
              serviceType,
            },
            receivedAt: new Date().toISOString(),
          });
          throw error;
        }
      },
    );
  }

  @Post('sora2/character/create')
  async createSora2Character(@Body() dto: CreateSora2CharacterDto) {
    if (!dto.url && !dto.fromTask) {
      throw new BadRequestException('参数 url 和 fromTask 需二选一');
    }
    // 角色创建链路不支持 prompt/image，这里只保留白名单字段
    const safeModel = dto.model;
    const safeTimestamps = typeof dto.timestamps === 'string' ? dto.timestamps.trim() : dto.timestamps;
    const safeUrl = typeof dto.url === 'string' ? dto.url.trim() : dto.url;
    const safeFromTask = typeof dto.fromTask === 'string' ? dto.fromTask.trim() : dto.fromTask;
    return this.sora2VideoService.createCharacterTask({
      model: safeModel,
      timestamps: safeTimestamps,
      url: safeUrl,
      fromTask: safeFromTask,
    });
  }

  @Get('sora2/character/:taskId')
  async querySora2Character(@Param('taskId') taskId: string) {
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId 不能为空');
    }
    return this.sora2VideoService.queryCharacterTask(taskId.trim());
  }

  @Get('sora2/video/:taskId')
  async querySora2VideoTask(@Param('taskId') taskId: string) {
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId 不能为空');
    }
    const trimmedTaskId = taskId.trim();

    // 首先检查是否是异步任务
    const asyncTask = getAsyncTaskResult(trimmedTaskId);
    if (asyncTask) {
      // 异步任务，直接返回存储的结果
      if (asyncTask.status === 'completed' && asyncTask.result) {
        return this.normalizeVideoTaskResponse({
          id: trimmedTaskId,
          status: asyncTask.result.status || 'completed',
          videoUrl: asyncTask.result.videoUrl,
          thumbnailUrl: asyncTask.result.thumbnailUrl,
          raw: asyncTask.result,
        });
      }
      if (asyncTask.status === 'failed') {
        throw new ServiceUnavailableException(asyncTask.error || '视频生成失败');
      }
      // pending 或 processing，返回进行中状态
      return this.normalizeVideoTaskResponse({
        id: trimmedTaskId,
        status: asyncTask.status === 'processing' ? 'processing' : 'pending',
        progress: asyncTask.status === 'processing' ? 50 : 10,
      });
    }

    // 非异步任务，调用原始的 Sora2 查询接口
    return this.normalizeVideoTaskResponse(
      await this.sora2VideoService.queryVideoTask(trimmedTaskId),
    );
  }

  /**
   * 视频生成（通用供应商：可灵、Vidu、Seedance 1.5 Pro）
   * 返回 taskId 和 apiUsageId，前端在任务失败时可请求退款
   */
  @Get('seedance2/access')
  async getSeedance2Access(@Req() req: any) {
    const userId = this.getUserId(req) || this.resolveRequestUserId(req);
    if (!userId) {
      return {
        allowed: false,
        byVip: false,
        byWhitelist: false,
        byAdmin: false,
      };
    }

    return this.resolveSeedance2CombinedAccess(userId, req);
  }

  @Post('generate-video-provider')
  async generateVideoProvider(@Body() dto: VideoProviderRequestDto, @Req() req: any) {
    const userId = this.getUserId(req);
    const effectiveDto: VideoProviderRequestDto = { ...dto };

    // Whitelist/admin users can skip watermark for doubao provider.
    if (effectiveDto.provider === 'doubao') {
      const skipWatermark = await this.canSkipWatermark(req);
      if (skipWatermark) {
        effectiveDto.watermark = false;
      }
    }
    const serviceType = this.resolveVideoProviderServiceType(effectiveDto);

    // 如果没有用户ID（API Key认证），直接执行操作
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      const result = await this.videoProviderService.generateVideo(effectiveDto);
      const { execution: _execution, ...publicResult } = result as any;
      return { ...publicResult, apiUsageId: null };
    }

    // 确保用户有积分账户
    await this.creditsService.getOrCreateAccount(userId);
    const startTime = Date.now();
    const requestParams = await this.buildVideoProviderCreditParams(effectiveDto);
    const idempotencyKey = this.extractIdempotencyKey(req, {
      ...(requestParams || {}),
      ...(typeof (effectiveDto as any)?.idempotencyKey === 'string'
        ? { idempotencyKey: (effectiveDto as any).idempotencyKey }
        : {}),
    });
    const billingModel =
      effectiveDto.klingModel ||
      effectiveDto.viduModelVariant ||
      effectiveDto.viduModel ||
      effectiveDto.seedanceModel ||
      effectiveDto.provider;

    // 预扣积分
    const deductResult = await this.creditsService.preDeductCredits({
      userId,
      serviceType,
      model: billingModel,
      inputImageCount: effectiveDto.referenceImages?.length || undefined,
      outputImageCount: 0,
      requestParams,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      idempotencyKey,
    });

    const apiUsageId = deductResult.apiUsageId;
    this.logger.debug(`Credits pre-deducted for video: ${serviceType}, apiUsageId: ${apiUsageId}`);
    this.emitVideoProviderGenerationTaskLog({
      stage: 'queued',
      userId,
      provider: effectiveDto.provider,
      prompt: effectiveDto.prompt,
      status: 'pending',
      taskId: apiUsageId,
      apiUsageId,
      requestParams,
    });

    try {
      const result = await this.videoProviderService.generateVideo(effectiveDto);
      const execution = (result as any)?.execution as
        | {
            modelKey?: string;
            vendorKey?: string;
            platformKey?: string;
            route?: string;
            providerChannel?: string;
            routedProvider?: string;
            fallbackUsed?: boolean;
          }
        | undefined;
      const normalizedStatus = String(result?.status || '').toLowerCase();

      if (normalizedStatus === 'failed' || normalizedStatus === 'failure') {
        throw new ServiceUnavailableException((result as any)?.error || '视频任务创建失败');
      }

      if (!result?.taskId && !result?.videoUrl) {
        throw new ServiceUnavailableException('视频任务创建失败：未返回 taskId 或 videoUrl');
      }

      if (result?.taskId) {
        await this.creditsService.updateApiUsageRequestParams(apiUsageId, {
          taskId: result.taskId,
          ...(execution?.modelKey ? { modelKey: execution.modelKey } : {}),
          ...(execution?.vendorKey ? { vendorKey: execution.vendorKey } : {}),
          ...(execution?.platformKey ? { platformKey: execution.platformKey } : {}),
          ...(execution?.route ? { route: execution.route } : {}),
          ...(execution?.providerChannel ? { providerChannel: execution.providerChannel } : {}),
          ...(execution?.routedProvider ? { routedProvider: execution.routedProvider } : {}),
          ...(typeof execution?.fallbackUsed === 'boolean'
            ? { fallbackUsed: execution.fallbackUsed }
            : {}),
        });
        this.emitVideoProviderGenerationTaskLog({
          stage: result.videoUrl ? 'succeeded' : 'processing',
          userId,
          provider: effectiveDto.provider,
          prompt: effectiveDto.prompt,
          status: result.videoUrl ? 'succeeded' : (result.status || 'queued'),
          taskId: result.taskId,
          apiUsageId,
          requestParams: {
            ...requestParams,
            taskId: result.taskId,
            ...(execution?.modelKey ? { modelKey: execution.modelKey } : {}),
            ...(execution?.vendorKey ? { vendorKey: execution.vendorKey } : {}),
            ...(execution?.platformKey ? { platformKey: execution.platformKey } : {}),
            ...(execution?.route ? { route: execution.route } : {}),
            ...(execution?.providerChannel ? { providerChannel: execution.providerChannel } : {}),
            ...(execution?.routedProvider ? { routedProvider: execution.routedProvider } : {}),
            ...(typeof execution?.fallbackUsed === 'boolean'
              ? { fallbackUsed: execution.fallbackUsed }
              : {}),
          },
        });
      }

      // 兼容“立即出片”供应商：直接标记成功；异步任务维持 pending，交由轮询结果决定是否退款
      if (result.videoUrl) {
        await this.creditsService.updateApiUsageStatus(
          apiUsageId,
          ApiResponseStatus.SUCCESS,
          undefined,
          0,
        );
      }

      // 返回 apiUsageId，前端在任务失败时可请求退款
      const { execution: _execution, ...publicResult } = result as any;
      return { ...publicResult, apiUsageId };
    } catch (error) {
      // 创建任务失败，立即退款
      const errorMessage = error instanceof Error ? error.message : String(error);
      const processingTime = Math.max(0, Date.now() - startTime);
      this.emitVideoProviderGenerationTaskLog({
        stage: 'failed',
        userId,
        provider: effectiveDto.provider,
        prompt: effectiveDto.prompt,
        status: 'failed',
        taskId: apiUsageId,
        apiUsageId,
        requestParams,
        error: errorMessage,
      });

      const refunded = await this.markFailedAndRefundWithRetry({
        userId,
        apiUsageId,
        serviceType,
        errorMessage,
        processingTime,
      });
      if (refunded) {
        this.logger.debug(`Credits refunded for failed video task creation: ${apiUsageId}`);
      } else {
        this.logger.error(
          `Failed to mark/refund video task after retries. apiUsageId=${apiUsageId}`,
        );
      }
      throw error;
    }
  }

  /**
   * 视频任务失败时退还积分
   */
  @Post('video-task-refund')
  async refundVideoTask(
    @Body() body: { apiUsageId: string },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req);
    if (!userId) {
      throw new BadRequestException('需要用户认证');
    }

    const { apiUsageId } = body;
    if (!apiUsageId) {
      throw new BadRequestException('缺少 apiUsageId 参数');
    }

    try {
      // 先校验归属并标记失败（仅允许当前用户操作自己的记录）
      await this.creditsService.markApiUsageFailedForUser(
        userId,
        apiUsageId,
        '视频生成任务失败',
        0,
      );

      // 退还积分
      const result = await this.creditsService.refundCredits(userId, apiUsageId);
      this.logger.log(`✅ 视频任务积分已处理退款: apiUsageId=${apiUsageId}, balance=${result.newBalance}`);
      return { success: true, newBalance: result.newBalance };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ 视频任务积分退还失败: ${message}`);
      throw error;
    }
  }

  /**
   * 视频任务成功时确认积分状态（将 pending 标记为 success）
   */
  @Post('video-task-success')
  async markVideoTaskSuccess(
    @Body() body: { apiUsageId: string; processingTime?: number },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req);
    if (!userId) {
      throw new BadRequestException('需要用户认证');
    }

    const apiUsageId = typeof body?.apiUsageId === 'string' ? body.apiUsageId.trim() : '';
    if (!apiUsageId) {
      throw new BadRequestException('缺少 apiUsageId 参数');
    }

    const rawProcessingTime = Number(body?.processingTime);
    const processingTime = Number.isFinite(rawProcessingTime)
      ? Math.max(0, Math.round(rawProcessingTime))
      : 0;

    await this.creditsService.markApiUsageSuccessForUser(
      userId,
      apiUsageId,
      processingTime,
    );
    return { success: true };
  }

  /**
   * 查询视频生成任务状态
   */
  @Get('video-task/:provider/:taskId')
  async queryVideoTask(
    @Param('provider') provider: 'kling' | 'kling-2.6' | 'kling-o3' | 'vidu' | 'viduq3-pro' | 'doubao',
    @Param('taskId') taskId: string,
  ) {
    return this.normalizeVideoTaskResponse(
      await this.videoProviderService.queryTask(provider, taskId),
    );
  }

  private normalizeUnifiedVideoStatus(status?: string | null): 'queued' | 'processing' | 'succeeded' | 'failed' {
    const value = String(status || '').trim().toLowerCase();
    if (!value) return 'processing';

    if (
      [
        'queued',
        'queue',
        'pending',
        'submitted',
        'waiting',
      ].includes(value)
    ) {
      return 'queued';
    }

    if (
      [
        'processing',
        'running',
        'progressing',
        'in_progress',
      ].includes(value)
    ) {
      return 'processing';
    }

    if (
      [
        'success',
        'succeed',
        'succeeded',
        'completed',
        'complete',
        'done',
        'finish',
        'finished',
      ].includes(value)
    ) {
      return 'succeeded';
    }

    if (
      [
        'failed',
        'fail',
        'failure',
        'error',
        'cancelled',
        'canceled',
        'timeout',
        'terminated',
        'exception',
        'expired',
      ].includes(value)
    ) {
      return 'failed';
    }

    return 'processing';
  }

  private normalizeVideoTaskResponse<T extends Record<string, any>>(payload: T): T & {
    status: 'queued' | 'processing' | 'succeeded' | 'failed';
  } {
    return {
      ...payload,
      status: this.normalizeUnifiedVideoStatus(payload?.status),
    };
  }

  /**
   * 生成 Paper.js 代码
   */
  @Post('generate-paperjs')
  async generatePaperJS(@Body() dto: PaperJSGenerateRequestDto, @Req() req: any): Promise<PaperJSGenerateResponseDto> {
    this.logger.log(`📐 Paper.js code generation request: ${dto.prompt.substring(0, 50)}...`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-paperjs', model, async () => {
      const startTime = Date.now();

      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);

        const result = await provider.generatePaperJS({
          prompt: dto.prompt,
          model,
          thinkingLevel: dto.thinkingLevel,
          canvasWidth: dto.canvasWidth,
          canvasHeight: dto.canvasHeight,
        });

        if (result.success && result.data) {
          const processingTime = Date.now() - startTime;
          this.logger.log(`✅ Paper.js code generated successfully in ${processingTime}ms`);

          return {
            code: result.data.code,
            explanation: result.data.explanation,
            model,
            provider: providerName,
            createdAt: new Date().toISOString(),
            metadata: {
              canvasSize: {
                width: dto.canvasWidth || 1920,
                height: dto.canvasHeight || 1080,
              },
              processingTime,
            },
          };
        }
        throw new Error(result.error?.message || 'Failed to generate Paper.js code');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      const result = await this.imageGeneration.generatePaperJSCode({
        prompt: dto.prompt,
        model: dto.model,
        thinkingLevel: dto.thinkingLevel,
        canvasWidth: dto.canvasWidth,
        canvasHeight: dto.canvasHeight,
        customApiKey,
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Paper.js code generated successfully in ${processingTime}ms`);

      return {
        code: result.code,
        explanation: result.explanation,
        model: result.model,
        provider: dto.aiProvider || 'gemini',
        createdAt: new Date().toISOString(),
        metadata: {
          canvasSize: {
            width: dto.canvasWidth || 1920,
            height: dto.canvasHeight || 1080,
          },
          processingTime,
        },
      };
    }, undefined, undefined, skipCredits);
  }

  @Post('img2vector')
  async img2Vector(@Body() dto: Img2VectorRequestDto, @Req() req: any): Promise<Img2VectorResponseDto> {
    this.logger.log(`🖼️ Image to vector conversion request`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);
    const normalizedModel = model?.replace(/^banana-/, '') || model;

    // 检查是否使用自定义 API Key
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;
    let fallbackProvider: string | null = null;

    return this.withCredits(req, 'gemini-img2vector', model, async () => {
      const startTime = Date.now();

      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);

        if (typeof (provider as any).img2Vector === 'function') {
          try {
            const result = await (provider as any).img2Vector({
              sourceImage: dto.sourceImage,
              prompt: dto.prompt,
              model,
              thinkingLevel: dto.thinkingLevel,
              canvasWidth: dto.canvasWidth,
              canvasHeight: dto.canvasHeight,
              style: dto.style,
            });

            if (result.success && result.data) {
              const processingTime = Date.now() - startTime;
              this.logger.log(`✅ Image to vector conversion completed in ${processingTime}ms`);

              return {
                code: result.data.code,
                imageAnalysis: result.data.imageAnalysis,
                explanation: result.data.explanation,
                model,
                provider: providerName,
                createdAt: new Date().toISOString(),
                metadata: {
                  canvasSize: {
                    width: dto.canvasWidth || 1920,
                    height: dto.canvasHeight || 1080,
                  },
                  processingTime,
                  style: dto.style || 'detailed',
                },
              };
            }

            const message = result.error?.message || '图片转矢量图失败';
            this.logger.error(`[${providerName}] img2vector failed: ${message}`);
            throw new InternalServerErrorException(message);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[${providerName}] img2vector threw error: ${message}`, error as any);
            throw new InternalServerErrorException(message);
          }
        }

        // 提供商未实现 img2Vector，回退到默认 Gemini 流程
        this.logger.warn(`[${providerName}] img2Vector not implemented, falling back to Gemini service`);
        fallbackProvider = providerName;
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      const result = await this.imageGeneration.img2Vector({
        sourceImage: dto.sourceImage,
        prompt: dto.prompt,
        model: normalizedModel,
        thinkingLevel: dto.thinkingLevel,
        canvasWidth: dto.canvasWidth,
        canvasHeight: dto.canvasHeight,
        style: dto.style,
        customApiKey,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[gemini] img2vector failed: ${message}`, error as any);
        throw new InternalServerErrorException(message);
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Image to vector conversion completed in ${processingTime}ms`);

      return {
        code: result.code,
        imageAnalysis: result.imageAnalysis,
        explanation: result.explanation,
        model: result.model,
        provider: fallbackProvider ? 'gemini' : dto.aiProvider || 'gemini',
        createdAt: new Date().toISOString(),
        metadata: {
          canvasSize: {
            width: dto.canvasWidth || 1920,
            height: dto.canvasHeight || 1080,
          },
          processingTime,
          style: dto.style || 'detailed',
          ...(fallbackProvider ? { fallbackProvider } : {}),
        },
      };
    }, undefined, undefined, skipCredits);
  }

  /**
   * VEO 视频生成 - 获取可用模型列表
   */
  @Get('veo/models')
  async getVeoModels(): Promise<VeoModelsResponseDto[]> {
    this.logger.log('📋 VEO models list requested');
    return this.veoVideoService.getAvailableModels();
  }

  /**
   * VEO 视频生成
   * - veo3-fast: 文字快速生成视频
   * - veo3-pro: 文字生成高质量视频（不支持垫图）
   * - veo3-pro-frames: 图片+文字生成视频（支持垫图）
   */
  @Post('veo/generate')
  async generateVeoVideo(@Body() dto: VeoGenerateVideoDto, @Req() req: any): Promise<VeoVideoResponseDto> {
    this.logger.log(`🎬 VEO video generation request: model=${dto.model}, prompt=${dto.prompt.substring(0, 50)}...`);

    // 验证：veo3-pro-frames 需要图片，其他模式不需要
    if (dto.model === 'veo3-pro-frames' && !dto.referenceImageUrl) {
      throw new BadRequestException('veo3-pro-frames 模式需要提供 referenceImageUrl 参数');
    }

    if (dto.model !== 'veo3-pro-frames' && dto.referenceImageUrl) {
      this.logger.warn(`Model ${dto.model} does not support image input, ignoring referenceImageUrl`);
    }

    const normalizedReferenceImageUrl =
      dto.model === 'veo3-pro-frames' &&
      typeof dto.referenceImageUrl === 'string' &&
      dto.referenceImageUrl.trim()
        ? this.normalizeImageUrlForUpstream(dto.referenceImageUrl)
        : undefined;

    const result = await this.veoVideoService.generateVideo({
      prompt: dto.prompt,
      model: dto.model,
      referenceImageUrl: normalizedReferenceImageUrl,
    });

    return result;
  }

  /**
   * DashScope Wan2.6-t2v proxy endpoint
   */
  @Post('dashscope/generate-wan26-t2v')
  async generateWan26T2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan26-video', 'wan2.6-t2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return { success: false, error: { message: 'DASHSCOPE_API_KEY not configured on server' } };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { success: false, error: { code: `HTTP_${response.status}`, message: data?.message || this.getHttpErrorMessage(response.status), details: data } };
        }

        const extractVideoUrl = (obj: any) => obj?.output?.video_url || obj?.video_url || obj?.videoUrl || (Array.isArray(obj?.output) && obj.output[0]?.video_url) || undefined;
        const videoUrlDirect = extractVideoUrl(data);
        if (videoUrlDirect) return { success: true, data };

        const taskId = data?.taskId || data?.task_id || data?.id || data?.output?.task_id || data?.result?.task_id || data?.output?.[0]?.task_id || data?.data?.task_id || data?.data?.output?.task_id;
        if (!taskId) {
          this.logger.warn('DashScope wan2.6-t2v create response contains no task id and no video url', {
            dataPreview: JSON.stringify(data).slice(0, 400),
          });
          return {
            success: false,
            error: {
              message: 'DashScope 未返回任务 ID 或视频地址',
              details: data,
            },
          };
        }

        const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
        const intervalMs = 15000;
        const maxAttempts = 40;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, intervalMs));
          try {
            const statusResp = await fetch(statusUrl, { method: 'GET', headers: { Authorization: `Bearer ${dashKey}`, 'Content-Type': 'application/json' } });
            if (!statusResp.ok) continue;
            const statusData = await statusResp.json().catch(() => ({}));
            const statusValue = (statusData?.output?.task_status || statusData?.status || statusData?.state || statusData?.task_status || '').toString().toLowerCase();

            if (statusValue === 'succeeded' || statusValue === 'success') {
              const finalVideoUrl = extractVideoUrl(statusData) || extractVideoUrl(statusData?.result) || extractVideoUrl(statusData?.output) || undefined;
              if (!finalVideoUrl) {
                this.logger.warn('DashScope wan2.6-t2v task succeeded but no video URL in response', {
                  taskId,
                  dataPreview: JSON.stringify(statusData).slice(0, 400),
                });
                return {
                  success: false,
                  error: {
                    message: 'DashScope 任务已完成但未返回视频地址',
                    details: statusData,
                  },
                };
              }
              return { success: true, data: { taskId, status: statusValue, videoUrl: finalVideoUrl, video_url: finalVideoUrl, output: { video_url: finalVideoUrl }, raw: statusData } };
            }
            if (statusValue === 'failed' || statusValue === 'error') {
              return { success: false, error: { message: 'DashScope task failed', details: statusData } };
            }
          } catch { continue; }
        }
        return { success: false, error: { message: 'DashScope task polling timed out' } };
      } catch (error: any) {
        this.logger.error('❌ DashScope request exception', error);
        return { success: false, error: { code: 'NETWORK_ERROR', message: error?.message || String(error) } };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.6',
      generationMode: 't2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: typeof body?.input?.audio_url === 'string' ? [body.input.audio_url] : [],
    }), {
      treatReturnedFailureAsError: true,
    });
  }

  /**
   * DashScope Wan2.6-i2v proxy endpoint
   */
  @Post('dashscope/generate-wan2-6-i2v')
  async generateWan26I2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan26-video', 'wan2.6-i2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return {
          success: false,
          error: { message: 'DASHSCOPE_API_KEY not configured on server' },
        };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
      const normalizedBody = this.normalizeWanI2VBodyForUpstream(body);

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(normalizedBody),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.logger.error('DashScope i2v create task failed', {
            status: response.status,
            body: data,
          });
          return {
            success: false,
            error: {
              code: `HTTP_${response.status}`,
              message: data?.message || this.getHttpErrorMessage(response.status),
              details: data,
            },
          };
        }

        this.logger.log('✅ DashScope i2v task created', {
          resultPreview: JSON.stringify(data).slice(0, 200),
        });

        const extractVideoUrl = (obj: any) =>
          obj?.output?.video_url ||
          obj?.video_url ||
          obj?.videoUrl ||
          (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
          undefined;
        const videoUrlDirect = extractVideoUrl(data);
        if (videoUrlDirect) return { success: true, data };

        const taskId =
          data?.taskId ||
          data?.task_id ||
          data?.id ||
          data?.output?.task_id ||
          data?.result?.task_id ||
          data?.output?.[0]?.task_id ||
          data?.data?.task_id ||
          data?.data?.output?.task_id;

        if (!taskId) {
          this.logger.warn('DashScope i2v create response contains no task id and no video url', {
            dataPreview: JSON.stringify(data).slice(0, 200),
          });
          return {
            success: false,
            error: {
              message: 'DashScope 未返回任务 ID 或视频地址',
              details: data,
            },
          };
        }

        // 异步模式：立即返回 taskId，前端轮询查询状态
        this.logger.log(`✅ DashScope i2v task created: ${taskId}`);
        return {
          success: true,
          data: {
            taskId,
            task_id: taskId,
            status: 'pending',
            raw: data,
          },
        };
      } catch (error: any) {
        this.logger.error('❌ DashScope i2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.6',
      generationMode: 'i2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: [
        body?.input?.img_url,
        body?.input?.audio_url,
      ],
      hasAudio: true,
    }), {
      treatReturnedFailureAsError: true,
      skipFinalizeSuccessIf: (r: any) => this.isDashscopeVideoAsyncPending(r),
    });
  }

  /**
   * DashScope Wan2.7-i2v proxy endpoint
   */
  @Post('dashscope/generate-wan2-7-i2v')
  async generateWan27I2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan27-video', 'wan2.7-i2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return {
          success: false,
          error: { message: 'DASHSCOPE_API_KEY not configured on server' },
        };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
      const normalizedBody = this.normalizeWan27I2VBodyForUpstream(body);

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(normalizedBody),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.logger.error('DashScope wan2.7-i2v create task failed', {
            status: response.status,
            body: data,
          });
          return {
            success: false,
            error: {
              code: `HTTP_${response.status}`,
              message: data?.message || this.getHttpErrorMessage(response.status),
              details: data,
            },
          };
        }

        const taskId =
          data?.taskId ||
          data?.task_id ||
          data?.id ||
          data?.output?.task_id ||
          data?.result?.task_id ||
          data?.output?.[0]?.task_id ||
          data?.data?.task_id ||
          data?.data?.output?.task_id;

        if (!taskId) {
          this.logger.warn('DashScope wan2.7-i2v create response contains no task id', {
            dataPreview: JSON.stringify(data).slice(0, 300),
          });
          return {
            success: false,
            error: {
              message: 'DashScope 未返回任务 ID',
              details: data,
            },
          };
        }

        return {
          success: true,
          data: {
            taskId,
            task_id: taskId,
            status: 'pending',
            raw: data,
          },
        };
      } catch (error: any) {
        this.logger.error('❌ DashScope wan2.7-i2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.7',
      generationMode: 'i2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: Array.isArray(body?.input?.media)
        ? body.input.media.map((item: any) => item?.url).filter(Boolean)
        : [],
      hasAudio: true,
    }), {
      treatReturnedFailureAsError: true,
      skipFinalizeSuccessIf: (r: any) => this.isDashscopeVideoAsyncPending(r),
    });
  }

  /**
   * DashScope 任务状态查询接口（前端轮询用）
   */
  @Get('dashscope/task/:taskId')
  async getDashscopeTaskStatus(@Param('taskId') taskId: string) {
    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (!dashKey) {
      return { success: false, error: { message: 'DASHSCOPE_API_KEY not configured' } };
    }

    const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
    try {
      const resp = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${dashKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { success: false, error: { code: `HTTP_${resp.status}`, details: data } };
      }

      const statusValue = (
        data?.output?.task_status || data?.status || data?.state || ''
      ).toString().toLowerCase();

      const extractVideoUrl = (obj: any) =>
        obj?.output?.video_url || obj?.video_url || obj?.videoUrl ||
        (Array.isArray(obj?.output) && obj.output[0]?.video_url) || undefined;

      const videoUrl = extractVideoUrl(data) || extractVideoUrl(data?.output);

      return {
        success: true,
        data: { taskId, status: statusValue, videoUrl, video_url: videoUrl, raw: data },
      };
    } catch (err: any) {
      return { success: false, error: { message: err?.message || String(err) } };
    }
  }

  /**
   * DashScope Wan2.6-r2v proxy endpoint
   */
  @Post('dashscope/generate-wan2-6-r2v')
  async generateWan26R2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan26-r2v', 'wan2.6-r2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return {
          success: false,
          error: { message: 'DASHSCOPE_API_KEY not configured on server' },
        };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
      const normalizedBody = this.normalizeWanR2VBodyForUpstream(body);

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(normalizedBody),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.logger.error('DashScope r2v create task failed', {
            status: response.status,
            body: data,
          });
          return {
            success: false,
            error: {
              code: `HTTP_${response.status}`,
              message: data?.message || this.getHttpErrorMessage(response.status),
              details: data,
            },
          };
        }

        this.logger.log('✅ DashScope r2v task created', {
          resultPreview: JSON.stringify(data).slice(0, 200),
        });

        const extractVideoUrl = (obj: any) =>
          obj?.output?.video_url ||
          obj?.video_url ||
          obj?.videoUrl ||
          (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
          undefined;
        const videoUrlDirect = extractVideoUrl(data);
        if (videoUrlDirect) return { success: true, data };

        const taskId =
          data?.taskId ||
          data?.task_id ||
          data?.id ||
          data?.output?.task_id ||
          data?.result?.task_id ||
          data?.output?.[0]?.task_id ||
          data?.data?.task_id ||
          data?.data?.output?.task_id;
        if (!taskId) {
          this.logger.warn('DashScope r2v create response contains no task id and no video url', {
            dataPreview: JSON.stringify(data).slice(0, 200),
          });
          return {
            success: false,
            error: {
              message: 'DashScope 未返回任务 ID 或视频地址',
              details: data,
            },
          };
        }

        const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
        const intervalMs = 15000;
        const maxAttempts = 40;
        this.logger.log(
          `🔁 Start polling DashScope r2v task ${taskId} (${maxAttempts} attempts, ${intervalMs}ms interval)`
        );
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, intervalMs));
          try {
            const statusResp = await fetch(statusUrl, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${dashKey}`,
                'Content-Type': 'application/json',
              },
            });
            if (!statusResp.ok) {
              const errBody = await statusResp.text().catch(() => '');
              this.logger.warn('DashScope r2v status check non-OK', {
                status: statusResp.status,
                body: errBody,
              });
              continue;
            }
            const statusData = await statusResp.json().catch(() => ({}));
            this.logger.debug(
              `🔎 DashScope r2v status response (attempt ${attempt + 1}): ${JSON.stringify(statusData).slice(0, 200)}`
            );
            const statusValue = (
              statusData?.output?.task_status ||
              statusData?.status ||
              statusData?.state ||
              statusData?.task_status ||
              ''
            )
              .toString()
              .toLowerCase();

            if (statusValue === 'succeeded' || statusValue === 'success') {
              const finalVideoUrl =
                extractVideoUrl(statusData) ||
                extractVideoUrl(statusData?.result) ||
                extractVideoUrl(statusData?.output) ||
                undefined;
              if (!finalVideoUrl) {
                this.logger.warn(`DashScope r2v task ${taskId} succeeded but no video URL in response`, {
                  dataPreview: JSON.stringify(statusData).slice(0, 400),
                });
                return {
                  success: false,
                  error: {
                    message: 'DashScope 任务已完成但未返回视频地址',
                    details: statusData,
                  },
                };
              }
              this.logger.log(
                `✅ DashScope r2v task ${taskId} succeeded, videoUrl: ${String(finalVideoUrl).slice(0, 120)}`
              );
              return {
                success: true,
                data: {
                  taskId,
                  status: statusValue,
                  videoUrl: finalVideoUrl,
                  video_url: finalVideoUrl,
                  output: { video_url: finalVideoUrl },
                  raw: statusData,
                },
              };
            }
            if (statusValue === 'failed' || statusValue === 'error') {
              const failureCode =
                statusData?.output?.code ||
                statusData?.code ||
                statusData?.output?.error_code ||
                statusData?.output?.error?.code;
              const failureMessage =
                statusData?.output?.message ||
                statusData?.message ||
                statusData?.output?.error?.message ||
                statusData?.output?.error_message ||
                statusData?.output?.error?.msg ||
                statusData?.output?.reason;
              const message =
                typeof failureMessage === 'string' && failureMessage.trim().length > 0
                  ? (failureCode ? `${String(failureCode)}: ${failureMessage}` : failureMessage)
                  : 'DashScope r2v task failed';

              this.logger.error(`❌ DashScope r2v task ${taskId} failed`, {
                message,
                raw: statusData,
              });
              return {
                success: false,
                error: { message, details: statusData },
              };
            }
          } catch (err: any) {
            this.logger.warn('DashScope r2v polling exception, will retry', err);
          }
        }
        this.logger.warn(
          `⏳ DashScope r2v task ${taskId} polling timed out after ${maxAttempts} attempts`
        );
        return {
          success: false,
          error: { message: 'DashScope r2v task polling timed out' },
        };
      } catch (error: any) {
        this.logger.error('❌ DashScope r2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.6-r2v',
      generationMode: 'r2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: Array.isArray(body?.input?.reference_video_urls)
        ? body.input.reference_video_urls
        : [],
      hasAudio: true,
    }), {
      treatReturnedFailureAsError: true,
    });
  }

  @Post('dashscope/generate-happyhorse-video')
  async generateHappyhorseVideoViaDashscope(@Body() body: any, @Req() req: any) {
    const model = this.resolveHappyhorseModelOrThrow(body);
    const taskLabel = model.replace(/^happyhorse-1\.0-/, 'happyhorse-');
    await this.assertHappyhorseEntitlement(this.getUserId(req));
    return this.withCredits(
      req,
      'happyhorse-r2v-video',
      model,
      async () => {
        const dashKey = process.env.DASHSCOPE_API_KEY;
        if (!dashKey) {
          this.logger.error('DASHSCOPE_API_KEY not configured');
          return {
            success: false,
            error: { message: 'DASHSCOPE_API_KEY not configured on server' },
          };
        }

        const dashUrl =
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
        const normalizedBody = this.normalizeHappyhorseBodyForUpstream(body);

        try {
          const response = await fetch(dashUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${dashKey}`,
              'X-DashScope-Async': 'enable',
            },
            body: JSON.stringify(normalizedBody),
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            this.logger.error(`DashScope ${taskLabel} create task failed`, {
              status: response.status,
              body: data,
            });
            return {
              success: false,
              error: {
                code: `HTTP_${response.status}`,
                message: data?.message || this.getHttpErrorMessage(response.status),
                details: data,
              },
            };
          }

          this.logger.log(`✅ DashScope ${taskLabel} task created`, {
            resultPreview: JSON.stringify(data).slice(0, 200),
          });

          // 极少数情况下上游可能直接返回视频地址（兜底）
          const directVideoUrl =
            data?.output?.video_url ||
            data?.video_url ||
            data?.videoUrl ||
            (Array.isArray(data?.output) && data.output[0]?.video_url) ||
            undefined;
          if (directVideoUrl) return { success: true, data };

          const taskId =
            data?.taskId ||
            data?.task_id ||
            data?.id ||
            data?.output?.task_id ||
            data?.result?.task_id ||
            data?.output?.[0]?.task_id ||
            data?.data?.task_id ||
            data?.data?.output?.task_id;
          if (!taskId) {
            this.logger.warn(
              `DashScope ${taskLabel} create response contains no task id and no video url`,
              { dataPreview: JSON.stringify(data).slice(0, 200) },
            );
            return {
              success: false,
              error: {
                message: 'DashScope 未返回任务 ID 或视频地址',
                details: data,
              },
            };
          }

          this.logger.log(`✅ DashScope ${taskLabel} task created: ${taskId}`);
          return {
            success: true,
            data: {
              taskId,
              task_id: taskId,
              status: 'pending',
              raw: data,
            },
          };
        } catch (error: any) {
          this.logger.error(`❌ DashScope ${taskLabel} request exception`, error);
          return {
            success: false,
            error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
          };
        }
      },
      undefined,
      undefined,
      undefined,
      this.buildHappyhorseCreditRequestParams(body, model),
      {
        treatReturnedFailureAsError: true,
        skipFinalizeSuccessIf: (r: any) => this.isDashscopeVideoAsyncPending(r),
      },
    );
  }

  /**
   * 视频分析 - 使用 Gemini File API 分析视频内容
   */
  @Post('analyze-video')
  async analyzeVideo(@Body() dto: AnalyzeVideoDto, @Req() req: any) {
    this.logger.log(`🎥 Video analysis request: ${dto.videoUrl?.substring(0, 50)}...`);
    const model = this.resolveGeminiVideoModel(dto.model);

    return this.withCredits(
      req,
      'gemini-video-analyze',
      model,
      async () => this.runVideoAnalysisPipeline(dto),
      1,
      0,
    );
  }

  @Post('analyze-video-async')
  async analyzeVideoAsync(@Body() dto: AnalyzeVideoDto, @Req() req: any) {
    this.logger.log(`🎥 Async video analysis request: ${dto.videoUrl?.substring(0, 50)}...`);

    const model = this.resolveGeminiVideoModel(dto.model);
    const taskId = `async-video-analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createAsyncTask(taskId);
    updateAsyncTask(taskId, {
      result: {
        status: 'queued',
        taskId,
        taskInfo: { stage: 'queued', progress: this.resolveVideoAnalysisProgress('queued') },
      },
    });

    const traceContext = this.getTraceContext(req);
    void this.telemetryService.ingestGenerationTask({
      traceId: traceContext.traceId || null,
      parentRequestId: traceContext.parentRequestId || null,
      taskId,
      taskType: 'video-analyze',
      stage: 'queued',
      userId: this.getUserId(req),
      provider: dto.aiProvider || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        model,
        videoUrlHost: (() => {
          try {
            return new URL(dto.videoUrl).hostname;
          } catch {
            return null;
          }
        })(),
      },
      receivedAt: new Date().toISOString(),
    });

    void this.executeVideoAnalysisAsync(taskId, traceContext, req, { ...dto, model }).catch((error) => {
      this.logger.error(`[Async] Video analysis task ${taskId} failed:`, error);
    });

    return {
      success: true,
      taskId,
      status: 'pending',
      message: '视频分析任务已提交，请通过 taskId 轮询查询进度',
    };
  }

  @Get('analyze-video-task/:taskId')
  async getAnalyzeVideoTaskStatus(@Param('taskId') taskId: string) {
    const trimmedTaskId = taskId?.trim();
    if (!trimmedTaskId) {
      throw new BadRequestException('taskId 不能为空');
    }

    const task = getAsyncTaskResult(trimmedTaskId);
    if (!task) {
      throw new BadRequestException('视频分析任务不存在或已过期');
    }

    if (task.status === 'failed') {
      return {
        status: 'failed',
        error: task.error || '视频分析失败',
        progress: 100,
      };
    }

    if (task.status === 'completed') {
      return {
        status: 'succeeded',
        analysis: task.result?.analysis || task.result?.text || '',
        text: task.result?.text || task.result?.analysis || '',
        provider: task.result?.provider,
        model: task.result?.model,
        processingTime: task.result?.processingTime,
        frameCount: task.result?.frameCount,
        progress: 100,
      };
    }

    const stage =
      typeof task.result?.taskInfo?.stage === 'string' ? task.result.taskInfo.stage : 'processing';
    const progress =
      typeof task.result?.taskInfo?.progress === 'number'
        ? task.result.taskInfo.progress
        : this.resolveVideoAnalysisProgress(stage);

    return {
      status: task.status === 'processing' ? 'processing' : 'pending',
      stage,
      progress,
    };
  }

  private async executeVideoAnalysisAsync(
    taskId: string,
    traceContext: PersistedTraceContext,
    req: any,
    dto: AnalyzeVideoDto,
  ): Promise<void> {
    this.processVideoAnalysisTask(taskId, traceContext, req, dto).catch((error) => {
      this.logger.error(`[Async] Video analysis task ${taskId} failed:`, error);
    });
  }

  private async processVideoAnalysisTask(
    taskId: string,
    traceContext: PersistedTraceContext,
    req: any,
    dto: AnalyzeVideoDto,
  ): Promise<void> {
    let apiUsageId: string | null = null;
    const model = this.resolveGeminiVideoModel(dto.model);

    await runWithSpan(
      'video-task.analyze',
      traceContext,
      {
        'app.task.id': taskId,
        'app.task.type': 'video-analyze',
        'app.user.id': this.getUserId(req) || 'anonymous',
        'app.ai.provider': dto.aiProvider || 'gemini',
      },
      async () => {
        updateAsyncTask(taskId, {
          status: 'processing',
          result: {
            status: 'processing',
            taskId,
            taskInfo: {
              stage: 'download_video',
              progress: this.resolveVideoAnalysisProgress('download_video'),
            },
          },
        });
        const startedAt = Date.now();

        void this.telemetryService.ingestGenerationTask({
          traceId: traceContext.traceId || null,
          parentRequestId: traceContext.parentRequestId || null,
          taskId,
          taskType: 'video-analyze',
          stage: 'processing',
          userId: this.getUserId(req),
          provider: dto.aiProvider || 'gemini',
          prompt: dto.prompt?.slice(0, 500) || null,
          status: 'processing',
          metadata: { model, apiUsageId },
          receivedAt: new Date().toISOString(),
        });

        try {
          const result = await this.withCredits(
            req,
            'gemini-video-analyze',
            model,
            async () =>
              this.runVideoAnalysisPipeline(dto, {
                onStageChange: (stage, extra) => {
                  updateAsyncTask(taskId, {
                    status: 'processing',
                    result: {
                      status: 'processing',
                      taskId,
                      frameCount: typeof extra?.frameCount === 'number' ? extra.frameCount : undefined,
                      taskInfo: {
                        stage,
                        progress: this.resolveVideoAnalysisProgress(stage),
                      },
                    },
                  });
                },
              }),
            1,
            0,
            undefined,
            {
              taskId,
              videoUrl: dto.videoUrl,
              aiProvider: dto.aiProvider,
              requestedProvider: dto.aiProvider,
              model,
              providerOptions: dto.providerOptions,
              bananaImageRoute: dto.bananaImageRoute,
              channelHint: dto.channelHint,
            },
            {
              onApiUsageId: (value) => {
                apiUsageId = value;
              },
            },
          );

          updateAsyncTask(taskId, {
            status: 'completed',
            result: {
              ...result,
              status: 'completed',
              taskId,
              taskInfo: { stage: 'completed', progress: 100 },
            },
          });

          void this.telemetryService.ingestGenerationTask({
            traceId: traceContext.traceId || null,
            parentRequestId: traceContext.parentRequestId || null,
            taskId,
            taskType: 'video-analyze',
            stage: 'succeeded',
            userId: this.getUserId(req),
            provider: dto.aiProvider || 'gemini',
            prompt: dto.prompt?.slice(0, 500) || null,
            status: 'completed',
            durationMs: Date.now() - startedAt,
            metadata: {
              apiUsageId,
              model,
              frameCount: result.frameCount ?? null,
            },
            receivedAt: new Date().toISOString(),
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          updateAsyncTask(taskId, {
            status: 'failed',
            error: errorMessage,
            result: {
              status: 'failed',
              taskId,
              taskInfo: { stage: 'failed', progress: 100 },
            },
          });

          void this.telemetryService.ingestGenerationTask({
            traceId: traceContext.traceId || null,
            parentRequestId: traceContext.parentRequestId || null,
            taskId,
            taskType: 'video-analyze',
            stage: 'failed',
            userId: this.getUserId(req),
            provider: dto.aiProvider || 'gemini',
            prompt: dto.prompt?.slice(0, 500) || null,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            error: errorMessage,
            metadata: { apiUsageId, model },
            receivedAt: new Date().toISOString(),
          });
          throw error;
        }
      },
    );
  }

  /**
   * 异步图像生成 - 创建任务
   */
  @Post('generate-image-async')
  async generateImageAsync(@Body() dto: GenerateImageDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 创建任务
    const task = await this.imageTaskService.createTask(
      userId,
      'generate',
      dto.prompt,
      { ...dto, model },
      providerName || 'gemini',
      { traceId, parentRequestId },
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 异步图像编辑 - 创建任务
   */
  @Post('edit-image-async')
  async editImageAsync(@Body() dto: EditImageDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);
    const requestUserId = this.resolveRequestUserId(req) || userId;
    const bananaImageMode = this.isBananaProviderName(providerName)
      ? await this.getBananaImageProviderMode(dto.providerOptions)
      : 'auto';
    const tencentForcedBanana =
      this.isBananaProviderName(providerName) && bananaImageMode === 'tencent';

    let sourceImage = dto.sourceImage;
    if (tencentForcedBanana) {
      const fallbackUrl =
        !dto.sourceImageUrl && dto.sourceImage && /^https?:\/\//i.test(dto.sourceImage)
          ? dto.sourceImage
          : dto.sourceImageUrl;

      if (sourceImage && !fallbackUrl) {
        sourceImage = sourceImage;
      } else if (fallbackUrl) {
        sourceImage = fallbackUrl;
      }

      if (!sourceImage) {
        throw new BadRequestException('编辑图片接口需要提供 sourceImage 或 sourceImageUrl');
      }

      sourceImage = await this.normalizeSourceImageForTencentForced(
        sourceImage,
        requestUserId,
        'edit-image-async',
      );
    } else if (dto.sourceImageUrl && !sourceImage) {
      sourceImage = await this.fetchImageAsDataUrl(dto.sourceImageUrl);
    }

    const task = await this.imageTaskService.createTask(
      userId,
      'edit',
      dto.prompt,
      { ...dto, sourceImage, model },
      providerName || 'gemini',
      { traceId, parentRequestId },
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 异步图像混合 - 创建任务
   */
  @Post('blend-images-async')
  async blendImagesAsync(@Body() dto: BlendImagesDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);
    const requestUserId = this.resolveRequestUserId(req) || userId;
    const bananaImageMode = this.isBananaProviderName(providerName)
      ? await this.getBananaImageProviderMode(dto.providerOptions)
      : 'auto';
    const tencentForcedBanana =
      this.isBananaProviderName(providerName) && bananaImageMode === 'tencent';

    let sourceImages = dto.sourceImages || [];
    if (tencentForcedBanana) {
      const tencentSourceCandidates = sourceImages.length
        ? sourceImages
        : dto.sourceImageUrls && dto.sourceImageUrls.length > 0
        ? dto.sourceImageUrls
        : [];

      sourceImages = await Promise.all(
        tencentSourceCandidates.map((value, index) =>
          this.normalizeSourceImageForTencentForced(
            value,
            requestUserId,
            `blend-images-async#${index + 1}`,
          ),
        ),
      );
    } else if (dto.sourceImageUrls && dto.sourceImageUrls.length > 0 && sourceImages.length === 0) {
      sourceImages = await Promise.all(
        dto.sourceImageUrls.map((url) => this.fetchImageAsDataUrl(url)),
      );
    }

    const task = await this.imageTaskService.createTask(
      userId,
      'blend',
      dto.prompt,
      { ...dto, sourceImages, model },
      providerName || 'gemini',
      { traceId, parentRequestId },
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 查询图像任务状态
   */
  @Get('image-task/:taskId')
  async getImageTaskStatus(@Param('taskId') taskId: string, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const task = await this.imageTaskService.getTaskStatus(taskId, userId);
    const requestData =
      task.requestData && typeof task.requestData === 'object'
        ? (task.requestData as Record<string, any>)
        : {};
    const resultImageUrls = Array.isArray(requestData.resultImageUrls)
      ? requestData.resultImageUrls.filter(
          (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0,
        )
      : [];
    const resultMetadata =
      requestData.resultMetadata && typeof requestData.resultMetadata === 'object'
        ? (requestData.resultMetadata as Record<string, any>)
        : undefined;

    return {
      status: task.status,
      imageUrl: task.imageUrl,
      imageUrls: resultImageUrls,
      thumbnailUrl: task.thumbnailUrl,
      textResponse: task.textResponse,
      metadata: resultMetadata,
      error: task.error,
      progress: task.status === 'processing' ? 50 : task.status === 'succeeded' ? 100 : 0,
    };
  }

  @Post('tencent-speech')
  async generateTencentSpeech(@Body() dto: TencentSpeechDto, @Req() req: any) {
    return this.withCredits(
      req,
      'tencent-speech',
      undefined,
      async () => this.tencentSpeechService.synthesizeSpeech(dto),
      undefined,
      undefined,
      false,
      {
        inputVideoUrl: dto.inputVideoUrl,
        textLength: (dto.text || '').trim().length || undefined,
        speakerUrl: dto.speakerUrl,
        srcSubtitleUrl: dto.srcSubtitleUrl,
        dstLangs: dto.dstLangs,
      },
    );
  }

  @Post('tencent-speech/async')
  async generateTencentSpeechAsync(@Body() dto: TencentSpeechDto) {
    return this.tencentSpeechService.createAsyncSpeechTask(dto);
  }

  @Get('tencent-speech/async/:taskId')
  async queryTencentSpeechAsyncTask(@Param('taskId') taskId: string) {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId 参数不能为空');
    }
    return this.tencentSpeechService.queryAsyncSpeechTask(normalizedTaskId);
  }

  @Post('minimax-speech')
  async generateSpeech(@Body() dto: MinimaxSpeechDto, @Req() req: any) {
    return this.withCredits(
      req,
      'minimax-speech',
      dto.model,
      async () => this.minimaxSpeechService.synthesizeSpeech(dto),
      undefined,
      undefined,
      false,
      { text: dto.text, voiceId: dto.voiceId, emotion: dto.emotion }
    );
  }

  @Post('minimax-speech/async')
  async generateSpeechAsync(@Body() dto: MinimaxSpeechDto) {
    return this.minimaxSpeechService.createAsyncSpeechTask(dto);
  }

  @Get('minimax-speech/async/:taskId')
  async querySpeechAsyncTask(@Param('taskId') taskId: string) {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId 参数不能为空');
    }
    return this.minimaxSpeechService.queryAsyncSpeechTask(normalizedTaskId);
  }

  @Post('minimax-music')
  async generateMusic(@Body() dto: MinimaxMusicDto, @Req() req: any) {
    return this.withCredits(
      req,
      'minimax-music',
      dto.model,
      async () => this.minimaxMusicService.generateMusic(dto),
    );
  }
}
