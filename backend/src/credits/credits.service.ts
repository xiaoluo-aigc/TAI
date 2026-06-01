import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CREDIT_PRICING_CONFIG,
  ServiceType,
} from './credits.config';
import { TransactionType, ApiResponseStatus } from './dto/credits.dto';
import { PricingResponseDto } from './dto/credits.dto';
import { ReferralService } from '../referral/referral.service';
import {
  buildAdminGiftCreditLotData,
  buildDailyRewardCreditLotData,
  buildFreeMonthlyQuotaCreditLotData,
  buildManualCreditLotData,
} from './credit-lot-grants';
import {
  applyLotDeductionsToSnapshots,
  applyLotRestorationsToSnapshots,
  buildHybridCreditDeductionPlan,
  type HybridCreditDeduction,
} from './credit-lot-ledger';
import {
  hydrateCreditConsumePolicyRecord,
  selectCreditConsumePolicyRecord,
  getDefaultCreditConsumePolicy,
  type CreditLotCandidate,
  type CreditLotStatus,
} from './credit-lot-policy';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import {
  MODEL_PROVIDER_MAPPING_SETTING_KEY,
  type ManagedModelConfig,
  type ManagedModelVendorConfig,
} from '../ai/services/model-routing.service';
import {
  resolveManagedModelPricing,
  resolveManagedModelPricingV2,
  resolveManagedVendorDefaultPricing,
  type ManagedPricingMappingLike,
  type ManagedPricingCondition,
  type ManagedPricingDimensionDefinition,
  type ManagedPricingEvaluator,
  type ManagedPricingMatchingRule,
  type ResolvedManagedPricing,
} from '../ai/services/model-pricing-resolver';

let IORedis: any;
try {
  // optional dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  IORedis = require('ioredis');
} catch (e) {
  IORedis = null;
}

const STALE_PENDING_DEFAULT_TIMEOUT_MINUTES = 15;
const STALE_PENDING_DEFAULT_VIDEO_TIMEOUT_MINUTES = 30;
const STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT = '2026-03-28T00:00:00.000Z';
const FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT = '2026-04-15T00:00:00.000Z';
const STALE_PENDING_DEFAULT_BATCH_SIZE = 100;
const PRE_DEDUCT_IDEMPOTENCY_DEFAULT_WINDOW_MS = 15_000;
const PRE_DEDUCT_IDEMPOTENCY_MAX_WINDOW_MS = 120_000;
const PRE_DEDUCT_TRANSACTION_TIMEOUT_MS = 30_000;
const DAILY_REWARD_RESET_HOUR = 3;
const FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';
const DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT = 20;
const DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT = 3;
const DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT = 100;
const DEFAULT_FREE_USER_MONTHLY_VIDEO_LIMIT = 10;
const PREVIEW_CREDITS_CACHE_TTL_SEC = 30;
const GPT_IMAGE2_SERVICE_TYPE = 'gpt-image-2';
const GPT_IMAGE2_CREDITS = 40;
const GPT_IMAGE2_NORMAL_RESOLUTION_PRICING: Record<'1K' | '2K' | '4K', number> = {
  '1K': 20,
  '2K': 30,
  '4K': 40,
};
const GPT_IMAGE2_TENCENT_RESOLUTION_PRICING: Record<'1K' | '2K' | '4K', number> = {
  '1K': 40,
  '2K': 80,
  '4K': 110,
};
const STALE_PENDING_IMAGE_SERVICE_TYPES: ServiceType[] = [
  'gemini-3-pro-image',
  'gemini-3.1-image',
  'gemini-2.5-image',
  'gemini-image-edit',
  'gemini-3.1-image-edit',
  'gemini-2.5-image-edit',
  'gemini-image-blend',
  'gemini-3.1-image-blend',
  'gemini-2.5-image-blend',
  'midjourney-imagine',
  'midjourney-variation',
  'midjourney-upscale',
  'expand-image',
];
const STALE_PENDING_VIDEO_SERVICE_TYPES: ServiceType[] = [
  'sora-sd',
  'sora-hd',
  'wan26-video',
  'wan27-video',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
  'happyhorse-r2v-video',
];
const FREE_USER_IMAGE_LIMITED_SERVICES: ServiceType[] = [
  ...STALE_PENDING_IMAGE_SERVICE_TYPES,
  'midjourney-upscale',
  'expand-image',
];
const FREE_USER_VIDEO_LIMITED_SERVICES: ServiceType[] = [
  'sora-sd',
  'sora-hd',
  'wan26-video',
  'wan27-video',
  'wan26-r2v',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
  'happyhorse-r2v-video',
];

export interface DeductCreditsResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
  apiUsageId: string;
}

export interface AddCreditsResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
}

export interface ApiUsageParams {
  userId: string;
  serviceType: ServiceType;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputImageCount?: number;
  outputImageCount?: number;
  requestParams?: any;
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
  idempotencyWindowMs?: number;
}

interface PricingCatalogRuleConditionView {
  field: string;
  op: string;
  value?: unknown;
}

interface PricingCatalogRuleView {
  ruleKey?: string;
  label?: string;
  priority?: number;
  evaluatorKey?: string;
  evaluatorType?: string;
  formula?: string;
  conditions: {
    all: PricingCatalogRuleConditionView[];
    any: PricingCatalogRuleConditionView[];
  };
}

interface PricingCatalogVendorView {
  vendorKey: string;
  label?: string;
  provider?: string;
  platformKey?: string;
  enabled: boolean;
  creditsPerCall?: number;
  priceYuan?: number;
  pricingVersion?: string;
  defaultPrice: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  dimensions: Array<{
    key: string;
    label?: string;
    type?: string;
    required?: boolean;
    options?: Array<{
      value: string | number | boolean;
      label?: string;
    }>;
    description?: string;
  }>;
  rules: PricingCatalogRuleView[];
}

export interface ManagedPricingCatalogItem {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled: boolean;
  defaultVendor?: string;
  vendors: PricingCatalogVendorView[];
}

type PricingCatalogDimensionView = PricingCatalogVendorView['dimensions'][number];

interface PreviewCreditsParams {
  userId: string;
  serviceType: ServiceType;
  model?: string;
  requestParams?: any;
  outputImageCount?: number;
}

interface CachedPreviewQuotePayload {
  serviceName: string;
  requestedProvider: string | null;
  creditsToDeduct: number;
  managedPricing:
    | {
        source?: string;
        vendorKey?: string;
        ruleKey?: string;
        label?: string;
        evaluatorKey?: string;
        evaluatorType?: string;
        pricingVersion?: string;
        price?: {
          credits?: number;
          priceYuan?: number;
          costYuan?: number;
        };
      }
    | null;
  effectiveRequestParams: any;
}

type SoraBillingModel = 'sora-2' | 'sora-2-vip' | 'sora-2-pro';
type KlingBillingModel = 'kling-v2-6' | 'kling-v3-0' | 'kling-o3';
type BananaTencentPricingTier = 'fast' | 'pro' | 'ultra';
type BananaTextPricingTier = 'fast' | 'pro' | 'ultra';

const BANANA_TENCENT_IMAGE_SERVICE_TIERS: Partial<
  Record<ServiceType, BananaTencentPricingTier>
> = {
  'gemini-2.5-image': 'fast',
  'gemini-2.5-image-edit': 'fast',
  'gemini-2.5-image-blend': 'fast',
  'gemini-3-pro-image': 'pro',
  'gemini-image-edit': 'pro',
  'gemini-image-blend': 'pro',
  'gemini-3.1-image': 'ultra',
  'gemini-3.1-image-edit': 'ultra',
  'gemini-3.1-image-blend': 'ultra',
};

const BANANA_TENCENT_RESOLUTION_PRICING: Record<
  BananaTencentPricingTier,
  Record<'0.5K' | '1K' | '2K' | '4K', number>
> = {
  // 普通路线 (normal/apimart) 定价
  // Fast: 1K=20
  // Pro: 1K=40, 2K=60, 4K=80
  // Ultra: 0.5K=30, 1K=30, 2K=40, 4K=50
  fast: {
    '0.5K': 20,
    '1K': 20,
    '2K': 20,
    '4K': 20,
  },
  // Pro 普通路线
  pro: {
    '0.5K': 40,
    '1K': 40,
    '2K': 60,
    '4K': 80,
  },
  // Ultra 普通路线
  ultra: {
    '0.5K': 30,
    '1K': 30,
    '2K': 40,
    '4K': 50,
  },
};

// 尊享路线 (stable/tencent) 定价
// Fast: 1K=30
// Pro: 1K=90, 2K=100, 4K=170
// Ultra: 0.5K=30, 1K=50, 2K=70, 4K=110
const BANANA_TENCENT_STABLE_RESOLUTION_PRICING: Record<
  BananaTencentPricingTier,
  Record<'0.5K' | '1K' | '2K' | '4K', number>
> = {
  fast: {
    '0.5K': 30,
    '1K': 30,
    '2K': 30,
    '4K': 30,
  },
  pro: {
    '0.5K': 90,
    '1K': 90,
    '2K': 100,
    '4K': 170,
  },
  ultra: {
    '0.5K': 30,
    '1K': 50,
    '2K': 70,
    '4K': 110,
  },
};

const BANANA_TEXT_CHAT_ROUTE_PRICING: Record<
  'normal' | 'stable',
  Record<BananaTextPricingTier, number>
> = {
  normal: {
    fast: 5,
    pro: 5,
    ultra: 5,
  },
  stable: {
    fast: 10,
    pro: 10,
    ultra: 10,
  },
};
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);
  private redisClient: any | undefined;
  private readonly freeUserImageQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_IMAGE_LIMITED_SERVICES,
  );
  private readonly freeUserVideoQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_VIDEO_LIMITED_SERVICES,
  );

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly businessPolicyService: BusinessPolicyService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl && IORedis) {
      this.redisClient = new IORedis(redisUrl);
    }
  }

  private stableSerialize(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableSerialize(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableSerialize(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private buildPreviewCreditsCacheKey(params: PreviewCreditsParams): string {
    const signature = this.stableSerialize({
      userId: params.userId,
      serviceType: params.serviceType,
      model: params.model ?? null,
      requestParams: params.requestParams ?? null,
      outputImageCount: params.outputImageCount ?? null,
    });
    const digest = createHash('sha256').update(signature).digest('hex');
    return `credits:preview:v2:${digest}`;
  }

  private async getCachedPreviewQuote(
    params: PreviewCreditsParams,
  ): Promise<CachedPreviewQuotePayload | null> {
    if (!this.redisClient) return null;
    try {
      const raw = await this.redisClient.get(this.buildPreviewCreditsCacheKey(params));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedPreviewQuotePayload;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      this.logger.warn(
        `读取 preview credits Redis 缓存失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async setCachedPreviewQuote(
    params: PreviewCreditsParams,
    payload: CachedPreviewQuotePayload,
  ): Promise<void> {
    if (!this.redisClient) return;
    try {
      await this.redisClient.setex(
        this.buildPreviewCreditsCacheKey(params),
        PREVIEW_CREDITS_CACHE_TTL_SEC,
        JSON.stringify(payload),
      );
    } catch (error) {
      this.logger.warn(
        `写入 preview credits Redis 缓存失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private extractNodeConfigHintsFromRequestParams(requestParams: any): {
    nodeConfigKey?: string;
    nodeConfigNameZh?: string;
    nodeConfigNameEn?: string;
    billingModeName?: string;
    billingTitleSource?: 'dialog' | 'node';
  } {
    if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) {
      return {};
    }

    const nodeConfigKey =
      typeof requestParams.nodeConfigKey === 'string' ? requestParams.nodeConfigKey.trim() : '';
    const nodeConfigNameZh =
      typeof requestParams.nodeConfigNameZh === 'string'
        ? requestParams.nodeConfigNameZh.trim()
        : '';
    const nodeConfigNameEn =
      typeof requestParams.nodeConfigNameEn === 'string'
        ? requestParams.nodeConfigNameEn.trim()
        : '';
    const billingModeName =
      typeof requestParams.billingModeName === 'string'
        ? requestParams.billingModeName.trim()
        : '';
    const billingTitleSourceRaw =
      typeof requestParams.billingTitleSource === 'string'
        ? requestParams.billingTitleSource.trim().toLowerCase()
        : '';
    const billingTitleSource =
      billingTitleSourceRaw === 'dialog' || billingTitleSourceRaw === 'node'
        ? (billingTitleSourceRaw as 'dialog' | 'node')
        : undefined;

    return {
      ...(nodeConfigKey ? { nodeConfigKey } : {}),
      ...(nodeConfigNameZh ? { nodeConfigNameZh } : {}),
      ...(nodeConfigNameEn ? { nodeConfigNameEn } : {}),
      ...(billingModeName ? { billingModeName } : {}),
      ...(billingTitleSource ? { billingTitleSource } : {}),
    };
  }

  private async resolveServicePricing(params: {
    serviceType: ServiceType;
    requestParams?: any;
  }) {
    const staticPricing =
      CREDIT_PRICING_CONFIG[params.serviceType as keyof typeof CREDIT_PRICING_CONFIG];
    const {
      nodeConfigKey,
      nodeConfigNameZh,
      nodeConfigNameEn,
      billingModeName,
      billingTitleSource,
    } = this.extractNodeConfigHintsFromRequestParams(params.requestParams);

    let nodeConfig: {
      nameZh: string;
      nameEn: string;
      creditsPerCall: number;
      serviceType: string | null;
    } | null = null;

    if (nodeConfigKey) {
      const resolvedByKey = await this.prisma.nodeConfig.findUnique({
        where: { nodeKey: nodeConfigKey },
        select: {
          nameZh: true,
          nameEn: true,
          creditsPerCall: true,
          serviceType: true,
        },
      });

      if (
        resolvedByKey &&
        resolvedByKey.serviceType &&
        resolvedByKey.serviceType !== params.serviceType
      ) {
        this.logger.warn(
          `[Credits] Ignore nodeConfigKey=${nodeConfigKey} for service=${params.serviceType}, resolved serviceType=${resolvedByKey.serviceType}`,
        );
      } else {
        nodeConfig = resolvedByKey;
      }
    } else if (!staticPricing) {
      // 仅在静态定价不存在时按 serviceType 兜底，避免多个节点共用 serviceType 时误命中错误名称。
      nodeConfig = await this.prisma.nodeConfig.findFirst({
        where: { serviceType: params.serviceType },
        select: {
          nameZh: true,
          nameEn: true,
          creditsPerCall: true,
          serviceType: true,
        },
      });
    }

    if (!staticPricing && !nodeConfig) {
      return staticPricing;
    }

    const nodeConfigCredits =
      typeof nodeConfig?.creditsPerCall === 'number'
        ? nodeConfig.creditsPerCall
        : staticPricing?.creditsPerCall ?? 0;
    const effectiveCredits =
      params.serviceType === GPT_IMAGE2_SERVICE_TYPE ? GPT_IMAGE2_CREDITS : nodeConfigCredits;
    const resolvedNodeConfigNameZh =
      nodeConfigKey && !nodeConfig ? '' : nodeConfigNameZh;
    const resolvedNodeConfigNameEn =
      nodeConfigKey && !nodeConfig ? '' : nodeConfigNameEn;
    const inferredTitleSource =
      billingTitleSource || (nodeConfigKey ? 'node' : 'dialog');
    const serviceName =
      inferredTitleSource === 'node'
        ? resolvedNodeConfigNameEn ||
          nodeConfig?.nameEn ||
          resolvedNodeConfigNameZh ||
          nodeConfig?.nameZh ||
          staticPricing?.serviceName ||
          params.serviceType
        : billingModeName ||
          resolvedNodeConfigNameZh ||
          resolvedNodeConfigNameEn ||
          nodeConfig?.nameZh ||
          nodeConfig?.nameEn ||
          staticPricing?.serviceName ||
          params.serviceType;

    return {
      ...(staticPricing || {
        provider: 'custom',
        description: `Node-managed pricing for ${params.serviceType}`,
      }),
      serviceName,
      creditsPerCall: effectiveCredits,
    };
  }

  private async resolveEffectiveCreditsQuote(params: {
    serviceType: ServiceType;
    model?: string;
    requestParams?: any;
    outputImageCount?: number;
  }) {
    const normalizedRequestParams = this.normalizeManagedPricingRequestParams(params.requestParams);
    const pricing = await this.resolveServicePricing({
      serviceType: params.serviceType,
      requestParams: normalizedRequestParams,
    });
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${params.serviceType}`);
    }

    let creditsToDeduct: number = pricing.creditsPerCall;
    const managedRoutePricing = await this.resolveManagedRoutePricing(normalizedRequestParams);
    if (typeof managedRoutePricing?.price?.credits === 'number') {
      creditsToDeduct = managedRoutePricing.price.credits;
    }

    const effectiveRequestParams =
      managedRoutePricing &&
      normalizedRequestParams &&
      typeof normalizedRequestParams === 'object'
        ? {
            ...normalizedRequestParams,
            pricingSnapshot: {
              source: managedRoutePricing.source,
              ...(managedRoutePricing.ruleKey ? { ruleKey: managedRoutePricing.ruleKey } : {}),
              ...(managedRoutePricing.label ? { label: managedRoutePricing.label } : {}),
              price: managedRoutePricing.price,
            },
          }
        : normalizedRequestParams;

    const requestedProvider =
      typeof effectiveRequestParams?.aiProvider === 'string'
        ? effectiveRequestParams.aiProvider.trim().toLowerCase()
        : '';

    creditsToDeduct = this.resolveSoraModelCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
      params.model,
    );

    creditsToDeduct = this.resolveKlingModelCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveBananaTextRouteCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
      params.model,
    );

    creditsToDeduct = this.resolveImageResolutionCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveHappyhorseR2VCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveSeedanceCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveFixedAnalyzeCredits(params.serviceType, creditsToDeduct);

    if (params.serviceType === GPT_IMAGE2_SERVICE_TYPE) {
      const gptImage2RouteCredits = this.resolveTencentBananaResolutionCredits(
        params.serviceType,
        effectiveRequestParams,
      );
      creditsToDeduct =
        typeof gptImage2RouteCredits === 'number'
          ? gptImage2RouteCredits
          : GPT_IMAGE2_CREDITS;
    }
    const outputImageCountMultiplier = this.resolveOutputImageCountMultiplier(
      params.serviceType,
      params.outputImageCount,
      effectiveRequestParams,
    );
    if (outputImageCountMultiplier > 1) {
      creditsToDeduct *= outputImageCountMultiplier;
    }

    // 先解析视频服务名称（如 Kling, Sora, Seedance）
    let serviceName = this.resolveManagedVideoServiceName(
      params.serviceType,
      pricing.serviceName,
      effectiveRequestParams,
    );

    // 再解析图片服务名称（格式：基础名称 + 分辨率 + 生成数量 + 路线）
    serviceName = this.resolveBananaImageServiceName(
      params.serviceType,
      serviceName,
      effectiveRequestParams,
      params.outputImageCount,
    );

    return {
      pricing,
      creditsToDeduct,
      managedRoutePricing,
      effectiveRequestParams,
      requestedProvider: requestedProvider || pricing.provider,
      serviceName,
    };
  }

  private resolveFixedAnalyzeCredits(serviceType: ServiceType, currentCredits: number): number {
    if (serviceType === 'gemini-2.5-image-analyze') return 10;
    if (serviceType === 'gemini-image-analyze') return 10;
    if (serviceType === 'gemini-3.1-image-analyze') return 10;
    return currentCredits;
  }

  private resolveOutputImageCountMultiplier(
    serviceType: ServiceType,
    outputImageCount: number | undefined,
    requestParams: any,
  ): number {
    const isImageLikeService =
      serviceType.includes('image') ||
      serviceType.startsWith('midjourney') ||
      serviceType === GPT_IMAGE2_SERVICE_TYPE ||
      serviceType === 'expand-image' ||
      serviceType === 'background-removal';
    if (!isImageLikeService) return 1;

    const directCount = Number(outputImageCount);
    if (Number.isFinite(directCount) && directCount > 1) {
      return Math.max(1, Math.floor(directCount));
    }

    const requestOutputCount = Number(requestParams?.outputImageCount);
    if (Number.isFinite(requestOutputCount) && requestOutputCount > 1) {
      return Math.max(1, Math.floor(requestOutputCount));
    }

    const requestBatchCount = Number(requestParams?.batchCount);
    if (Number.isFinite(requestBatchCount) && requestBatchCount > 1) {
      return Math.max(1, Math.floor(requestBatchCount));
    }

    return 1;
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, any> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    return null;
  }

  private normalizeChannel(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    if (!value) return null;
    if (value === 'normal') return 'apimart';
    if (value === 'stable') return 'tencent';
    if (value === 'nano2') return 'apimart';
    if (value.includes('apimart')) return 'apimart';
    if (value === 'legacy' || value.includes('147')) return '147';
    if (value.includes('tencent')) return 'tencent';
    return value;
  }

  private normalizeSoraBillingModel(raw: unknown): SoraBillingModel | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim().toLowerCase();
    if (value === 'sora-2' || value === 'sora-2-vip' || value === 'sora-2-pro') {
      return value;
    }
    return null;
  }

  private resolveSoraModelCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
    model?: string,
  ): number {
    if (serviceType !== 'sora-sd' && serviceType !== 'sora-hd') {
      return defaultCredits;
    }

    const servicePricing = CREDIT_PRICING_CONFIG[serviceType] as any;
    const modelPricing = servicePricing?.modelPricing;
    if (!modelPricing || typeof modelPricing !== 'object') {
      return defaultCredits;
    }

    const selectedModel =
      this.normalizeSoraBillingModel(requestParams?.soraModel) ||
      this.normalizeSoraBillingModel(model);
    if (!selectedModel) {
      return defaultCredits;
    }

    const configuredCredits = Number(modelPricing?.[selectedModel]?.creditsPerCall);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    return defaultCredits;
  }

  /**
   * Sora 视频服务：Pro 模型（750 积分）显示「Sora 2 Pro 视频生成」，标准/VIP 模型显示「Sora2 视频生成」
   */
  private resolveSoraServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
    model?: string,
  ): string {
    if (serviceType !== 'sora-sd' && serviceType !== 'sora-hd') {
      return defaultServiceName;
    }

    const selectedModel =
      this.normalizeSoraBillingModel(requestParams?.soraModel) ||
      this.normalizeSoraBillingModel(model);
    if (selectedModel === 'sora-2-pro') {
      return serviceType === 'sora-hd' ? 'Sora 2 Pro 高清视频' : 'Sora 2 Pro 视频生成';
    }

    return defaultServiceName;
  }

  private normalizeKlingBillingModel(
    raw: unknown,
    serviceType: ServiceType,
  ): KlingBillingModel | null {
    if (typeof raw === 'string') {
      const value = raw.trim().toLowerCase();
      if (value === 'kling-v2-6') return 'kling-v2-6';
      if (value === 'kling-v3-0') return 'kling-v3-0';
      if (value === 'kling-o3' || value === 'kling-v3-omni') return 'kling-o3';
    }

    if (serviceType === 'kling-3.0-video') return 'kling-v3-0';
    if (serviceType === 'kling-2.6-video' || serviceType === 'kling-video') {
      return 'kling-v2-6';
    }
    if (serviceType === 'kling-o3-video') return 'kling-o3';

    return null;
  }

  private normalizeKlingMode(raw: unknown): 'std' | 'pro' {
    if (typeof raw === 'string' && raw.trim().toLowerCase() === 'pro') {
      return 'pro';
    }
    return 'std';
  }

  private async resolveManagedRoutePricing(
    requestParams: any,
  ): Promise<ResolvedManagedPricing | null> {
    const normalizedRequestParams = this.normalizeManagedPricingRequestParams(requestParams);
    const modelKey =
      typeof normalizedRequestParams?.modelKey === 'string' &&
      normalizedRequestParams.modelKey.trim().length > 0
        ? normalizedRequestParams.modelKey.trim()
        : typeof normalizedRequestParams?.managedModelKey === 'string' &&
            normalizedRequestParams.managedModelKey.trim().length > 0
          ? normalizedRequestParams.managedModelKey.trim()
          : this.inferManagedModelKeyFromRequestParams(normalizedRequestParams);
    const vendorKey =
      typeof normalizedRequestParams?.vendorKey === 'string' &&
      normalizedRequestParams.vendorKey.trim()
        ? normalizedRequestParams.vendorKey.trim()
        : typeof normalizedRequestParams?.platformKey === 'string' &&
            normalizedRequestParams.platformKey.trim()
          ? normalizedRequestParams.platformKey.trim()
          : '';
    if (!modelKey || !vendorKey) return null;

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
        select: { value: true },
      });
      const raw = typeof setting?.value === 'string' ? setting.value.trim() : '';
      if (!raw) return null;

      const parsed = JSON.parse(raw) as ManagedPricingMappingLike;
      const resolved = await resolveManagedModelPricingV2(
        parsed,
        modelKey,
        vendorKey,
        normalizedRequestParams,
      );
      return resolved.source === 'none' ? null : resolved;
    } catch (error) {
      this.logger.warn(
        `读取模型管理线路积分失败，回退服务定价: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private normalizeManagedPricingRequestParams(requestParams: any): any {
    if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) {
      return requestParams;
    }

    // 将 sound("on"/"off"/boolean) 和 generateAudio(boolean) 统一归一化为 hasAudio(boolean)，
    // 使规则引擎中使用 hasAudio 字段的定价规则（Kling O3、Seedance 1.5）能正确匹配。
    let normalized: any = requestParams;
    if (normalized.hasAudio === undefined || normalized.hasAudio === null) {
      if (normalized.sound !== undefined) {
        const s = normalized.sound;
        normalized = {
          ...normalized,
          hasAudio: s === true || s === 'on' || s === 'true' || s === '1',
        };
      } else if (normalized.generateAudio !== undefined) {
        normalized = {
          ...normalized,
          hasAudio: Boolean(normalized.generateAudio),
        };
      }
    }

    // 将 mode("std"/"pro") 归一化为 resolution("720P"/"1080P")，
    // 作为兜底：当 tencent_vod 定价规则按 resolution 匹配但请求只有 mode 时仍能命中。
    if (
      (normalized.resolution === undefined || normalized.resolution === null || normalized.resolution === '') &&
      typeof normalized.mode === 'string'
    ) {
      const m = normalized.mode.trim().toLowerCase();
      if (m === 'pro') {
        normalized = { ...normalized, resolution: '1080P' };
      } else if (m === 'std') {
        normalized = { ...normalized, resolution: '720P' };
      }
    }

    const normalizedVendorKey =
      typeof normalized.vendorKey === 'string' && normalized.vendorKey.trim().length > 0
        ? normalized.vendorKey.trim().toLowerCase()
        : typeof normalized.platformKey === 'string' &&
            normalized.platformKey.trim().length > 0
          ? normalized.platformKey.trim().toLowerCase()
          : '';
    const modelKey =
      typeof normalized.modelKey === 'string' && normalized.modelKey.trim().length > 0
        ? normalized.modelKey.trim().toLowerCase()
        : typeof normalized.managedModelKey === 'string' &&
            normalized.managedModelKey.trim().length > 0
          ? normalized.managedModelKey.trim().toLowerCase()
          : this.inferManagedModelKeyFromRequestParams(normalized).trim().toLowerCase();

    if (normalizedVendorKey !== 'tencent_vod' || modelKey !== 'vidu-q3') {
      return normalized;
    }

    const normalizedVariant =
      typeof normalized.viduModelVariant === 'string'
        ? normalized.viduModelVariant.trim().toLowerCase()
        : '';
    const normalizedModel =
      typeof normalized.viduModel === 'string'
        ? normalized.viduModel.trim().toLowerCase()
        : '';

    if (normalizedVariant === 'q3-turbo' || normalizedVariant === 'q3turbo') {
      normalized = { ...normalized, viduModelVariant: 'q3' };
    }

    if (normalizedModel === 'q3-turbo' || normalizedModel === 'q3turbo') {
      normalized = { ...normalized, viduModel: 'q3' };
    }

    return normalized;
  }

  private inferManagedModelKeyFromRequestParams(requestParams: any): string {
    const seedanceModel =
      typeof requestParams?.seedanceModel === 'string'
        ? requestParams.seedanceModel.trim().toLowerCase()
        : '';
    if (seedanceModel === 'seedance-2.0' || seedanceModel === 'seedance-2.0-fast') {
      return 'seedance-2.0';
    }
    if (
      seedanceModel === 'seedance-1.5' ||
      seedanceModel === 'seedance-1.5-pro' ||
      seedanceModel === '1.5-pro'
    ) {
      return 'seedance-1.5';
    }

    const klingModel =
      typeof requestParams?.klingModel === 'string'
        ? requestParams.klingModel.trim().toLowerCase()
        : '';
    if (klingModel === 'kling-v2-6') return 'kling-2.6';
    if (klingModel === 'kling-v3-0') return 'kling-3.0';
    if (klingModel === 'kling-o3' || klingModel === 'kling-v3-omni') return 'kling-o3';

    const viduModelRaw =
      typeof requestParams?.viduModelVariant === 'string' &&
      requestParams.viduModelVariant.trim().length > 0
        ? requestParams.viduModelVariant.trim().toLowerCase()
        : typeof requestParams?.viduModel === 'string'
          ? requestParams.viduModel.trim().toLowerCase()
          : '';
    if (viduModelRaw) {
      if (
        viduModelRaw === 'q3' ||
        viduModelRaw === 'q3-pro' ||
        viduModelRaw === 'q3pro' ||
        viduModelRaw === 'q3-turbo' ||
        viduModelRaw === 'q3turbo' ||
        viduModelRaw === 'q3-mix' ||
        viduModelRaw === 'q3mix'
      ) {
        return 'vidu-q3';
      }
      return 'vidu-q2';
    }

    const soraModel =
      typeof requestParams?.soraModel === 'string'
        ? requestParams.soraModel.trim().toLowerCase()
        : '';
    if (soraModel === 'sora-2' || soraModel === 'sora-2-vip' || soraModel === 'sora-2-pro') {
      return 'sora-2';
    }

    return '';
  }

  private normalizeKlingDuration(raw: unknown): 5 | 10 | null {
    const value = Number(raw);
    if (value === 5 || value === 10) return value;
    return null;
  }

  private normalizeKlingSound(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return false;
    const value = raw.trim().toLowerCase();
    if (['on', 'yes', 'true', '1'].includes(value)) return true;
    if (['off', 'no', 'false', '0'].includes(value)) return false;
    return false;
  }

  private resolveKlingModelCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    const model = this.normalizeKlingBillingModel(requestParams?.klingModel, serviceType);
    if (model !== 'kling-v2-6' && model !== 'kling-v3-0') {
      return defaultCredits;
    }

    const duration = this.normalizeKlingDuration(requestParams?.duration);
    if (!duration) {
      return defaultCredits;
    }

    const mode = this.normalizeKlingMode(requestParams?.mode);
    const hasSound = this.normalizeKlingSound(requestParams?.sound);
    const pricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const matrix = hasSound ? pricing?.dynamicPricing?.withSound : pricing?.dynamicPricing?.noSound;
    const configuredCredits = Number(matrix?.[mode]?.[String(duration)]);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    return defaultCredits;
  }

  private resolveKlingServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
  ): string {
    const model = this.normalizeKlingBillingModel(requestParams?.klingModel, serviceType);
    if (model !== 'kling-v2-6' && model !== 'kling-v3-0') {
      return defaultServiceName;
    }

    const mode = this.normalizeKlingMode(requestParams?.mode);
    const hasSound = this.normalizeKlingSound(requestParams?.sound);
    const duration = this.normalizeKlingDuration(requestParams?.duration);

    const modelLabel = model === 'kling-v3-0' ? 'Kling 3.0' : 'Kling 2.6';
    const modeLabel = mode === 'pro' ? 'Pro' : 'Std';
    const soundLabel = hasSound ? '有音效' : '无音效';

    if (duration) {
      return `可灵 ${modelLabel} 视频（${soundLabel} / ${modeLabel} / ${duration}秒）`;
    }
    return `可灵 ${modelLabel} 视频（${soundLabel} / ${modeLabel}）`;
  }

  private resolveManagedVideoServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
  ): string {
    if (serviceType !== 'doubao-video') {
      return defaultServiceName;
    }

    const modelKey =
      typeof requestParams?.modelKey === 'string' ? requestParams.modelKey.trim().toLowerCase() : '';
    const seedanceModel =
      typeof requestParams?.seedanceModel === 'string'
        ? requestParams.seedanceModel.trim().toLowerCase()
        : '';

    if (
      seedanceModel === 'seedance-2.0-fast' ||
      seedanceModel === '2.0-fast'
    ) {
      return 'Seedance 2.0 Fast视频生成';
    }

    if (
      modelKey === 'seedance-2.0' ||
      seedanceModel === 'seedance-2.0' ||
      seedanceModel === '2.0'
    ) {
      return 'Seedance 2.0视频生成';
    }

    if (
      modelKey === 'seedance-1.5' ||
      seedanceModel === 'seedance-1.5-pro' ||
      seedanceModel === '1.5-pro'
    ) {
      return 'Seedance 1.5 Pro视频生成';
    }

    return defaultServiceName;
  }

  /**
   * 根据图片服务类型解析显示名称
   * 格式：基础名称 + 分辨率 + 生成数量 + 路线
   * 例如："Nano banana Pro 生图 1K x2 普通"
   */
  private resolveBananaImageServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
    outputImageCount?: number,
  ): string {
    // 判断是否为 Banana 图片服务
    const isBananaImageService =
      serviceType === 'gemini-2.5-image' ||
      serviceType === 'gemini-3-pro-image' ||
      serviceType === 'gemini-3.1-image' ||
      serviceType === 'gemini-image-edit' ||
      serviceType === 'gemini-3.1-image-edit' ||
      serviceType === 'gemini-2.5-image-edit' ||
      serviceType === 'gemini-image-blend' ||
      serviceType === 'gemini-3.1-image-blend' ||
      serviceType === 'gemini-2.5-image-blend' ||
      serviceType === GPT_IMAGE2_SERVICE_TYPE;

    if (!isBananaImageService) {
      return defaultServiceName;
    }

    // 解析路线
    const explicitRoute =
      this.normalizeBananaImageRoute(requestParams?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.banana?.imageRoute);
    let route: 'normal' | 'stable' | null = explicitRoute;
    if (!route) {
      const channelCandidates = [
        requestParams?.channel,
        requestParams?.providerChannel,
        requestParams?.executionChannel,
        requestParams?.channelHint,
      ];
      for (const candidate of channelCandidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = this.normalizeChannel(candidate);
        if (normalized) {
          if (normalized === 'tencent') route = 'stable';
          if (normalized === 'apimart') route = 'normal';
          break;
        }
      }
    }
    const routeLabel = route === 'stable' ? '尊享' : '普通';

    // 解析分辨率
    const imageSize = requestParams?.imageSize;
    let resolutionLabel = '';
    if (imageSize && typeof imageSize === 'string') {
      const normalizedSize = imageSize.trim().toUpperCase();
      if (normalizedSize) {
        resolutionLabel = ` ${normalizedSize}`;
      }
    }

    // 解析生成数量
    let countLabel = '';
    const count = typeof outputImageCount === 'number' && outputImageCount > 1
      ? outputImageCount
      : typeof requestParams?.outputImageCount === 'number' && requestParams.outputImageCount > 1
      ? requestParams.outputImageCount
      : null;
    if (count) {
      countLabel = ` x${count}`;
    }

    return `${defaultServiceName}${resolutionLabel}${countLabel} ${routeLabel}`;
  }

  /**
   * happyhorse-r2v-video 按分辨率 × 时长动态计费
   * pricing.dynamicPricing.perSecondByResolution = { '720P': N, '1080P': M }
   * credits = duration * rate[resolution]，缺失时回落 defaultCredits
   */
  private resolveHappyhorseR2VCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    if (serviceType !== 'happyhorse-r2v-video') return defaultCredits;
    const pricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const matrix = pricing?.dynamicPricing?.perSecondByResolution as
      | Record<string, number>
      | undefined;
    if (!matrix) return defaultCredits;
    const resolution = (requestParams?.resolution || '').toString().toUpperCase();
    const rate = matrix[resolution];
    const duration = Number(requestParams?.duration);
    if (rate && Number.isFinite(duration) && duration > 0) {
      return Math.round(rate * duration);
    }
    return defaultCredits;
  }

  /**
   * Seedance 视频服务积分兜底：
   * managedRoutePricing 可能从 systemSetting 的 MODEL_PROVIDER_MAPPING 中读到错误的 vendor 定价（如 86 积分）。
   * 对于 doubao-video（Seedance 1.5 / 2.0），当 managed pricing 给出的积分过低（< 100）时，
   * 强制回退到 CREDIT_PRICING_CONFIG 中的静态定价（默认 600 积分），防止用户被少扣。
   */
  private resolveSeedanceCredits(
    serviceType: ServiceType,
    currentCredits: number,
    requestParams: any,
  ): number {
    if (serviceType !== 'doubao-video') {
      return currentCredits;
    }
    const MIN_SEEDANCE_CREDITS = 100;
    if (currentCredits >= MIN_SEEDANCE_CREDITS) {
      return currentCredits;
    }
    const staticPricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const fallbackCredits = Number(staticPricing?.creditsPerCall);
    if (Number.isFinite(fallbackCredits) && fallbackCredits >= MIN_SEEDANCE_CREDITS) {
      this.logger.warn(
        `[Credits] Seedance managed pricing credits=${currentCredits} too low, ` +
          `fallback to static pricing credits=${fallbackCredits} for serviceType=${serviceType}`,
      );
      return fallbackCredits;
    }
    return currentCredits;
  }

  /**
   * 根据分辨率解析积分定价
   * 支持按分辨率差异化计费的服务（由 pricing.resolutionPricing 控制）
   */
  private resolveImageResolutionCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    const routeAwareBananaCredits = this.resolveTencentBananaResolutionCredits(
      serviceType,
      requestParams,
    );
    if (typeof routeAwareBananaCredits === 'number') {
      return routeAwareBananaCredits;
    }

    const servicePricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const resolutionPricing = servicePricing?.resolutionPricing;
    if (!resolutionPricing || typeof resolutionPricing !== 'object') {
      return defaultCredits;
    }

    // 获取请求的分辨率
    const requestedImageSize = requestParams?.imageSize;
    if (!requestedImageSize || typeof requestedImageSize !== 'string') {
      return defaultCredits;
    }

    // 标准化分辨率格式（支持 '4K', '2K', '1K', '0.5K' 等）
    const normalizedSize = requestedImageSize.trim().toUpperCase();
    
    // 查找匹配的分辨率定价
    const configuredCredits = Number(resolutionPricing[normalizedSize]);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    // 如果没有找到匹配的分辨率，返回默认值
    return defaultCredits;
  }

  private normalizeResolutionForBananaTencentPricing(
    rawSize: unknown,
    tier: BananaTencentPricingTier,
  ): '0.5K' | '1K' | '2K' | '4K' {
    const normalized = typeof rawSize === 'string' ? rawSize.trim().toUpperCase() : '';
    if (tier === 'fast') return '1K';
    if (tier === 'pro') {
      if (normalized === '2K' || normalized === '4K') return normalized;
      return '1K';
    }
    if (
      normalized === '0.5K' ||
      normalized === '1K' ||
      normalized === '2K' ||
      normalized === '4K'
    ) {
      return normalized;
    }
    return '1K';
  }

  private normalizeResolutionForGptImage2TencentPricing(
    rawSize: unknown,
  ): '1K' | '2K' | '4K' {
    const normalized = typeof rawSize === 'string' ? rawSize.trim().toUpperCase() : '';
    if (normalized === '2K') return '2K';
    if (normalized === '4K') return '4K';
    return '1K';
  }

  private normalizeBananaImageRoute(
    rawRoute: unknown,
  ): 'normal' | 'stable' | null {
    if (typeof rawRoute !== 'string') return null;
    const value = rawRoute.trim().toLowerCase();
    if (!value) return null;
    if (value === 'normal' || value === 'apimart') return 'normal';
    if (value === 'stable' || value === 'tencent') return 'stable';
    return null;
  }

  private resolveBananaTextPricingTierFromProvider(
    rawProvider: unknown,
  ): BananaTextPricingTier | null {
    if (typeof rawProvider !== 'string') return null;
    const provider = rawProvider.trim().toLowerCase();
    if (!provider) return null;
    if (provider === 'banana-2.5') return 'fast';
    if (provider === 'banana-3.1' || provider === 'nano2') return 'ultra';
    if (provider === 'banana' || provider === 'banana-3.0' || provider === 'gemini-pro') {
      return 'pro';
    }
    return null;
  }

  private resolveBananaTextPricingTierFromModel(
    rawModel: unknown,
  ): BananaTextPricingTier | null {
    if (typeof rawModel !== 'string') return null;
    const model = rawModel.trim().toLowerCase();
    if (!model) return null;
    if (model.includes('2.5')) return 'fast';
    if (model.includes('3.1')) return 'ultra';
    if (model.includes('gemini-3') || model.includes('3-pro') || model.includes('3-flash')) {
      return 'pro';
    }
    return null;
  }

  private resolveBananaTextRouteCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
    model?: string,
  ): number {
    if (serviceType === 'gemini-text') {
      return 2;
    }
    if (serviceType === 'gemini-prompt-optimize') {
      return 5;
    }
    return defaultCredits;
  }

  private resolveTencentBananaResolutionCredits(
    serviceType: ServiceType,
    requestParams: any,
  ): number | null {
    // 解析路线：normal=普通路线，stable=尊享路线
    const explicitRoute =
      this.normalizeBananaImageRoute(requestParams?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.banana?.imageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.bananaImageRoute);
    let route: 'normal' | 'stable' | null = explicitRoute;
    if (!route) {
      const channelCandidates = [
        requestParams?.channel,
        requestParams?.providerChannel,
        requestParams?.executionChannel,
        requestParams?.channelHint,
      ];
      for (const candidate of channelCandidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = this.normalizeChannel(candidate);
        if (normalized) {
          if (normalized === 'tencent') route = 'stable';
          if (normalized === 'apimart') route = 'normal';
          break;
        }
      }
    }

    if (serviceType === GPT_IMAGE2_SERVICE_TYPE) {
      if (!route) return null;

      const normalizedSize = this.normalizeResolutionForGptImage2TencentPricing(
        requestParams?.imageSize,
      );
      // 普通路线使用 GPT_IMAGE2_NORMAL_RESOLUTION_PRICING，尊享路线使用 GPT_IMAGE2_TENCENT_RESOLUTION_PRICING
      const configuredCredits = Number(
        route === 'stable'
          ? GPT_IMAGE2_TENCENT_RESOLUTION_PRICING[normalizedSize]
          : GPT_IMAGE2_NORMAL_RESOLUTION_PRICING[normalizedSize],
      );
      if (!Number.isFinite(configuredCredits) || configuredCredits <= 0) {
        return null;
      }
      return configuredCredits;
    }

    const tier = BANANA_TENCENT_IMAGE_SERVICE_TIERS[serviceType];
    if (!tier) return null;

    // 选择定价表：尊享路线(stable)使用 BANANA_TENCENT_STABLE_RESOLUTION_PRICING，普通路线使用 BANANA_TENCENT_RESOLUTION_PRICING
    const pricingTable = route === 'stable'
      ? BANANA_TENCENT_STABLE_RESOLUTION_PRICING[tier]
      : BANANA_TENCENT_RESOLUTION_PRICING[tier];

    const normalizedSize = this.normalizeResolutionForBananaTencentPricing(
      requestParams?.imageSize,
      tier,
    );
    const configuredCredits = Number(pricingTable[normalizedSize]);
    if (!Number.isFinite(configuredCredits) || configuredCredits <= 0) {
      return null;
    }
    return configuredCredits;
  }

  private toCreditLotCandidate(lot: {
    id: string;
    sourceType: string;
    validityType: string;
    scopeType: string | null;
    scopeValue: string | null;
    totalAmount: number;
    remainingAmount: number;
    grantedAt: Date;
    activeAt: Date;
    expiresAt: Date | null;
    priority: number;
    status: string;
  }): CreditLotCandidate {
    return {
      id: lot.id,
      sourceType: lot.sourceType as CreditLotCandidate['sourceType'],
      validityType: lot.validityType as CreditLotCandidate['validityType'],
      scopeType: (lot.scopeType ?? 'global') as CreditLotCandidate['scopeType'],
      scopeValue: lot.scopeValue,
      totalAmount: lot.totalAmount,
      remainingAmount: lot.remainingAmount,
      grantedAt: lot.grantedAt,
      activeAt: lot.activeAt,
      expiresAt: lot.expiresAt,
      priority: lot.priority,
      status: lot.status as CreditLotStatus,
    };
  }

  private extractLotDeductionsFromMetadata(
    metadata: Prisma.JsonValue | null | undefined,
  ): HybridCreditDeduction[] {
    const payload = this.asJsonObject(metadata);
    const rawDeductions = Array.isArray(payload?.deductions) ? payload?.deductions : [];

    const deductions: HybridCreditDeduction[] = [];
    for (const item of rawDeductions) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const kind = entry.kind === 'lot' ? 'lot' : entry.kind === 'legacy_balance' ? 'legacy_balance' : null;
      const amount = typeof entry.amount === 'number' ? Math.floor(entry.amount) : NaN;
      const lotId = typeof entry.lotId === 'string' && entry.lotId.trim().length > 0 ? entry.lotId : undefined;
      if (!kind || !Number.isFinite(amount) || amount <= 0) continue;
      if (kind === 'lot' && !lotId) continue;

      deductions.push(
        kind === 'lot'
          ? { kind, lotId, amount }
          : { kind, amount },
      );
    }

    return deductions;
  }

  private buildLotDeductionsMetadata(
    deductions: HybridCreditDeduction[],
    options?: {
      billingRemark?: string | null;
    },
  ): Prisma.InputJsonValue {
    const deductionPayload = deductions.map((item) =>
      item.kind === 'lot'
        ? {
            kind: item.kind,
            lotId: item.lotId,
            amount: item.amount,
          }
        : {
            kind: item.kind,
            amount: item.amount,
          },
    ) as Prisma.JsonArray;

    const payload: Prisma.JsonObject = {
      deductions: deductionPayload,
    };

    if (typeof options?.billingRemark === 'string' && options.billingRemark.trim().length > 0) {
      payload.billingRemark = options.billingRemark.trim();
    }

    return payload as Prisma.InputJsonValue;
  }

  private getDailyRewardMetadata(
    consecutiveDays: number,
    bonusCredits: number,
    baseCredits: number,
    rewardMultiplier = 1,
    tierCode?: string,
  ): Prisma.InputJsonValue {
    return {
      reason: 'daily_reward',
      consecutiveDays,
      baseCredits,
      rewardMultiplier,
      ...(tierCode ? { tierCode } : {}),
      ...(bonusCredits > 0
        ? {
          bonusCredits,
        }
        : {}),
    } as Prisma.InputJsonValue;
  }

  private normalizeDailyRewardTierCode(raw: string | null | undefined): 'free' | 'vip_69' | 'vip_199' | 'vip_599' {
    if (!raw) return 'free';
    const value = raw.trim().toLowerCase();
    if (!value || value === 'free') return 'free';
    if (value.includes('599')) return 'vip_599';
    if (value.includes('199')) return 'vip_199';
    if (value.includes('69')) return 'vip_69';
    return 'free';
  }

  private async resolveDailyRewardRuleForUser(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<{
    tierCode: 'free' | 'vip_69' | 'vip_199' | 'vip_599';
    baseCredits: number;
    rewardMultiplier: number;
  }> {
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();

    try {
      const entitlement = await client.membershipEntitlementSnapshot.findUnique({
        where: { userId },
        select: {
          currentPlanCode: true,
          membershipStatus: true,
          currentPeriodEndAt: true,
        },
      });

      const isActiveVip =
        entitlement?.membershipStatus === 'active' &&
        entitlement.currentPeriodEndAt instanceof Date &&
        entitlement.currentPeriodEndAt.getTime() > Date.now();

      const tierCode = isActiveVip
        ? this.normalizeDailyRewardTierCode(entitlement?.currentPlanCode)
        : 'free';

      let baseCredits = policy.dailyRewardCredits;

      if (tierCode !== 'free') {
        let membershipGiftCredits = 0;
        const activeSubscription = await client.userMembershipSubscription.findFirst({
          where: {
            userId,
            status: 'active',
            currentPeriodStartAt: { lte: new Date() },
            currentPeriodEndAt: { gt: new Date() },
          },
          select: {
            snapshot: true,
            membershipPlanId: true,
          },
          orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
        });

        const snapshot =
          activeSubscription?.snapshot &&
          typeof activeSubscription.snapshot === 'object' &&
          !Array.isArray(activeSubscription.snapshot)
            ? (activeSubscription.snapshot as Prisma.JsonObject)
            : null;

        if (typeof snapshot?.dailyGiftCredits === 'number' && Number.isFinite(snapshot.dailyGiftCredits)) {
          membershipGiftCredits = Math.trunc(snapshot.dailyGiftCredits);
        } else if (typeof snapshot?.dailyGiftCredits === 'string' && Number.isFinite(Number(snapshot.dailyGiftCredits))) {
          membershipGiftCredits = Math.trunc(Number(snapshot.dailyGiftCredits));
        } else if (activeSubscription?.membershipPlanId) {
          const plan = await client.membershipPlan.findUnique({
            where: { id: activeSubscription.membershipPlanId },
            select: { dailyGiftCredits: true },
          });
          if (typeof plan?.dailyGiftCredits === 'number' && Number.isFinite(plan.dailyGiftCredits)) {
            membershipGiftCredits = Math.trunc(plan.dailyGiftCredits);
          }
        }

        baseCredits = Math.max(0, membershipGiftCredits);
      }

      return {
        tierCode,
        baseCredits,
        rewardMultiplier: Math.max(1, policy.consecutive7DayRewardMultiplier),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return {
          tierCode: 'free',
          baseCredits: policy.dailyRewardCredits,
          rewardMultiplier: Math.max(1, policy.consecutive7DayRewardMultiplier),
        };
      }
      throw error;
    }
  }

  private async resolveCreditConsumePolicy(
    client: PrismaService | Prisma.TransactionClient,
    scope?: {
      serviceType?: string | null;
      provider?: string | null;
      model?: string | null;
    },
  ) {
    const records = await client.creditConsumePolicy.findMany({
      where: {
        isActive: true,
        OR: [
          { scopeType: 'global' },
          ...(scope?.serviceType ? [{ scopeType: 'service_type', scopeValue: scope.serviceType }] : []),
          ...(scope?.provider ? [{ scopeType: 'provider', scopeValue: scope.provider }] : []),
          ...(scope?.model ? [{ scopeType: 'model', scopeValue: scope.model }] : []),
        ],
      },
      select: {
        code: true,
        version: true,
        scopeType: true,
        scopeValue: true,
        sorts: true,
        validityPriority: true,
        sourcePriority: true,
      },
    });

    const record = selectCreditConsumePolicyRecord(records, scope);
    if (!record) {
      return getDefaultCreditConsumePolicy();
    }

    return hydrateCreditConsumePolicyRecord(record);
  }

  private addDays(base: Date, days: number): Date {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
  }

  private getDailyRewardBusinessDayAnchor(date: Date): Date {
    const anchor = new Date(date);
    anchor.setMinutes(0, 0, 0);

    if (anchor.getHours() < DAILY_REWARD_RESET_HOUR) {
      anchor.setDate(anchor.getDate() - 1);
    }

    anchor.setHours(DAILY_REWARD_RESET_HOUR, 0, 0, 0);
    return anchor;
  }

  private diffDailyRewardBusinessDays(now: Date, last: Date): number {
    const nowAnchor = this.getDailyRewardBusinessDayAnchor(now);
    const lastAnchor = this.getDailyRewardBusinessDayAnchor(last);
    return Math.floor((nowAnchor.getTime() - lastAnchor.getTime()) / (24 * 60 * 60 * 1000));
  }

  private resolveFreeMonthlyQuotaCycleWindow(
    anchorAt: Date,
    now: Date,
    cycleDays: number,
  ): { cycleStartAt: Date; cycleEndAt: Date } {
    const safeCycleDays = Math.max(1, Math.floor(cycleDays));
    const elapsedMs = Math.max(0, now.getTime() - anchorAt.getTime());
    const cycleIndex = Math.floor(elapsedMs / (safeCycleDays * 24 * 60 * 60 * 1000));
    const cycleStartAt = this.addDays(anchorAt, cycleIndex * safeCycleDays);
    const cycleEndAt = this.addDays(cycleStartAt, safeCycleDays);

    return {
      cycleStartAt,
      cycleEndAt,
    };
  }

  private async expireFreeUserMonthlyQuotaLotsForAccount(
    tx: Prisma.TransactionClient,
    params: {
      accountId: string;
      now: Date;
      excludeCurrentCycleStartAt?: Date;
      excludeCurrentCycleEndAt?: Date;
    },
  ): Promise<{ expiredLots: number; expiredCredits: number }> {
    const expiredLots = await tx.creditLot.findMany({
      where: {
        accountId: params.accountId,
        status: 'active',
        sourceType: 'subscription',
        validityType: 'fixed_window',
        remainingAmount: { gt: 0 },
        expiresAt: { lte: params.now },
        metadata: {
          path: ['grantedBy'],
          equals: 'free_user_monthly_quota',
        },
      },
      orderBy: [{ expiresAt: 'asc' }, { grantedAt: 'asc' }],
    });

    let expiredLotCount = 0;
    let expiredCredits = 0;

    for (const lot of expiredLots) {
      const metadata = this.asJsonObject(lot.metadata);
      const lotCycleStartAt = typeof metadata?.cycleStartAt === 'string'
        ? new Date(metadata.cycleStartAt)
        : null;
      const lotCycleEndAt = typeof metadata?.cycleEndAt === 'string'
        ? new Date(metadata.cycleEndAt)
        : null;

      if (
        params.excludeCurrentCycleStartAt &&
        params.excludeCurrentCycleEndAt &&
        lotCycleStartAt &&
        lotCycleEndAt &&
        lotCycleStartAt.getTime() === params.excludeCurrentCycleStartAt.getTime() &&
        lotCycleEndAt.getTime() === params.excludeCurrentCycleEndAt.getTime()
      ) {
        continue;
      }

      const account = await tx.creditAccount.findUnique({
        where: { id: params.accountId },
        select: { id: true, balance: true },
      });
      if (!account) {
        continue;
      }

      const amountToExpire = Math.min(lot.remainingAmount, account.balance);
      const balanceBefore = account.balance;
      const balanceAfter = Math.max(0, balanceBefore - amountToExpire);

      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });

      await tx.creditLot.update({
        where: { id: lot.id },
        data: {
          remainingAmount: 0,
          status: 'expired',
        },
      });

      await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.EXPIRE,
          amount: -amountToExpire,
          balanceBefore,
          balanceAfter,
          description: '免费用户月度额度过期清除',
          creditLotId: lot.id,
          businessType: 'free_monthly_quota_expire',
          metadata: {
            expiredAt: params.now.toISOString(),
            originalRemainingAmount: lot.remainingAmount,
            cycleStartAt: lotCycleStartAt?.toISOString() ?? metadata?.cycleStartAt ?? null,
            cycleEndAt: lotCycleEndAt?.toISOString() ?? metadata?.cycleEndAt ?? null,
          },
        },
      });

      expiredLotCount += 1;
      expiredCredits += amountToExpire;
    }

    return { expiredLots: expiredLotCount, expiredCredits };
  }

  private async grantFreeUserMonthlyQuotaIfNeeded(params: {
    userId: string;
    account: {
      id: string;
      balance: number;
      totalEarned: number;
    };
    userCreatedAt?: Date;
    now?: Date;
  }): Promise<boolean> {
    const now = params.now ?? new Date();
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    if (policy.freeUserMonthlyQuotaCredits <= 0) {
      return false;
    }

    const userCreatedAt =
      params.userCreatedAt ??
      (
        await this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { createdAt: true },
        })
      )?.createdAt;
    if (!userCreatedAt) {
      return false;
    }

    const { cycleStartAt, cycleEndAt } = this.resolveFreeMonthlyQuotaCycleWindow(
      userCreatedAt,
      now,
      policy.membershipRefreshCycleDays,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "CreditAccount" WHERE id = ${params.account.id} FOR UPDATE`,
      );

      const account = await tx.creditAccount.findUniqueOrThrow({
        where: { id: params.account.id },
        select: {
          id: true,
          balance: true,
          totalEarned: true,
        },
      });

      const activeSubscription = await tx.userMembershipSubscription.findFirst({
        where: {
          userId: params.userId,
          status: 'active',
          currentPeriodStartAt: { lte: now },
          currentPeriodEndAt: { gt: now },
        },
        select: { id: true },
      });
      if (activeSubscription) {
        return false;
      }

      await this.expireFreeUserMonthlyQuotaLotsForAccount(tx, {
        accountId: account.id,
        now,
        excludeCurrentCycleStartAt: cycleStartAt,
        excludeCurrentCycleEndAt: cycleEndAt,
      });

      const accountAfterExpiry = await tx.creditAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: {
          id: true,
          balance: true,
          totalEarned: true,
        },
      });

      const existingGrant = await tx.creditTransaction.findFirst({
        where: {
          accountId: accountAfterExpiry.id,
          businessType: 'free_monthly_quota',
          createdAt: {
            gte: cycleStartAt,
            lt: cycleEndAt,
          },
        },
        select: { id: true },
      });
      if (existingGrant) {
        return false;
      }

      const lot = await tx.creditLot.create({
        data: buildFreeMonthlyQuotaCreditLotData({
          accountId: accountAfterExpiry.id,
          amount: policy.freeUserMonthlyQuotaCredits,
          grantedAt: now,
          activeAt: now,
          expiresAt: cycleEndAt,
          durationDays: Math.max(
            1,
            Math.ceil((cycleEndAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
          ),
          metadata: {
            grantedBy: 'free_user_monthly_quota',
            cycleStartAt: cycleStartAt.toISOString(),
            cycleEndAt: cycleEndAt.toISOString(),
          },
        }),
      });

      const balanceBefore = accountAfterExpiry.balance;
      const balanceAfter = balanceBefore + policy.freeUserMonthlyQuotaCredits;

      await tx.creditAccount.update({
        where: { id: accountAfterExpiry.id },
        data: {
          balance: balanceAfter,
          totalEarned: accountAfterExpiry.totalEarned + policy.freeUserMonthlyQuotaCredits,
        },
      });

      await tx.creditTransaction.create({
        data: {
          accountId: accountAfterExpiry.id,
          type: TransactionType.EARN,
          amount: policy.freeUserMonthlyQuotaCredits,
          balanceBefore,
          balanceAfter,
          description: '免费用户月度额度发放',
          creditLotId: lot.id,
          businessType: 'free_monthly_quota',
          metadata: {
            cycleStartAt: cycleStartAt.toISOString(),
            cycleEndAt: cycleEndAt.toISOString(),
          },
        },
      });

      return true;
    });
  }

  async cleanupExpiredFreeUserMonthlyQuotaCredits(now = new Date()): Promise<{
    processedAccounts: number;
    expiredLots: number;
    expiredCredits: number;
  }> {
    const accountsWithExpiredQuota = await this.prisma.creditLot.findMany({
      where: {
        status: 'active',
        sourceType: 'subscription',
        validityType: 'fixed_window',
        remainingAmount: { gt: 0 },
        expiresAt: { lte: now },
        metadata: {
          path: ['grantedBy'],
          equals: 'free_user_monthly_quota',
        },
      },
      select: { accountId: true },
      distinct: ['accountId'],
    });

    let processedAccounts = 0;
    let expiredLots = 0;
    let expiredCredits = 0;

    for (const item of accountsWithExpiredQuota) {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "CreditAccount" WHERE id = ${item.accountId} FOR UPDATE`,
        );

        return this.expireFreeUserMonthlyQuotaLotsForAccount(tx, {
          accountId: item.accountId,
          now,
        });
      });

      if (result.expiredLots > 0) {
        processedAccounts += 1;
        expiredLots += result.expiredLots;
        expiredCredits += result.expiredCredits;
      }
    }

    return { processedAccounts, expiredLots, expiredCredits };
  }

  private extractChannelFromApiUsage(apiUsage?: {
    provider?: string | null;
    model?: string | null;
    requestParams?: Prisma.JsonValue | null;
  } | null): string | null {
    if (!apiUsage) return null;
    const params = this.asJsonObject(apiUsage.requestParams);
    const explicitRoute =
      this.normalizeBananaImageRoute(params?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(params?.providerOptions?.banana?.imageRoute) ||
      this.normalizeBananaImageRoute(params?.providerOptions?.bananaImageRoute);
    if (explicitRoute === 'stable') return 'tencent';
    if (explicitRoute === 'normal') return 'apimart';

    const candidates = [
      params?.channel,
      params?.providerChannel,
      params?.executionChannel,
      params?.channelHint,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const normalized = this.normalizeChannel(candidate);
        if (normalized) return normalized;
      }
    }

    if (typeof apiUsage.model === 'string') {
      const normalizedModel = apiUsage.model.toLowerCase();
      if (normalizedModel.includes('147') || normalizedModel.includes('banana')) return '147';
      if (normalizedModel.includes('apimart') || normalizedModel.includes('nano2')) return 'apimart';
    }

    if (apiUsage.provider === 'nano2') return 'apimart';
    if (apiUsage.provider?.startsWith('banana')) return '147';
    return null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private asNullableBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['on', 'yes', 'true', '1'].includes(normalized)) return true;
    if (['off', 'no', 'false', '0'].includes(normalized)) return false;
    return null;
  }

  private formatBillingChannel(channel: string | null): string | null {
    if (!channel) return null;
    if (channel === 'apimart') return '普通路线';
    if (channel === 'tencent') return '尊享路线';
    if (channel === '147') return '官方路线';
    return channel;
  }

  private resolveBillingModelLabel(
    serviceType: ServiceType,
    model: string | undefined,
    requestParams?: Record<string, any> | null,
  ): string | null {
    const isVideoService =
      serviceType.includes('video') ||
      serviceType === 'sora-sd' ||
      serviceType === 'sora-hd' ||
      serviceType === 'wan26-r2v';

    const videoModelCandidates: unknown[] = [
      requestParams?.modelKey,
      requestParams?.managedModelKey,
      requestParams?.klingModel,
      requestParams?.viduModelVariant,
      requestParams?.viduModel,
      requestParams?.seedanceModel,
    ];
    const commonCandidates: unknown[] = [requestParams?.soraModel, model, requestParams?.aiProvider];

    const candidates = isVideoService
      ? [...videoModelCandidates, ...commonCandidates]
      : [...commonCandidates, ...videoModelCandidates];

    for (const candidate of candidates) {
      const normalized = this.asNonEmptyString(candidate);
      if (normalized) return normalized;
    }

    return null;
  }

  private buildBillingRemark(params: {
    serviceType: ServiceType;
    model?: string;
    provider?: string | null;
    requestParams?: Prisma.JsonValue | null;
  }): string | null {
    const requestParams = this.asJsonObject(params.requestParams);
    const remarkParts: string[] = [];

    const modelLabel = this.resolveBillingModelLabel(
      params.serviceType,
      params.model,
      requestParams,
    );
    if (modelLabel) {
      remarkParts.push(`模型: ${modelLabel}`);
    }

    const imageSize = this.asNonEmptyString(requestParams?.imageSize)?.toUpperCase() ?? null;
    const resolution =
      this.asNonEmptyString(requestParams?.resolution)?.toUpperCase() ?? null;
    const aspectRatio = this.asNonEmptyString(requestParams?.aspectRatio);
    const mode = this.asNonEmptyString(requestParams?.mode)?.toLowerCase() ?? null;
    const videoMode = this.asNonEmptyString(requestParams?.videoMode)?.toLowerCase() ?? null;
    const durationRaw = Number(requestParams?.duration);
    const duration = Number.isFinite(durationRaw) ? Math.max(0, Math.round(durationRaw)) : null;
    const hasSound = this.asNullableBoolean(requestParams?.sound);
    const generateAudio = this.asNullableBoolean(requestParams?.generateAudio);
    const channel = this.extractChannelFromApiUsage({
      provider: params.provider ?? null,
      model: params.model ?? null,
      requestParams,
    });
    const channelLabel = this.formatBillingChannel(channel);

    const isVideoService =
      params.serviceType.includes('video') ||
      params.serviceType === 'sora-sd' ||
      params.serviceType === 'sora-hd' ||
      params.serviceType === 'wan26-r2v';

    if (imageSize) {
      remarkParts.push(`尺寸档位: ${imageSize}`);
    }
    if (isVideoService && duration !== null) {
      remarkParts.push(`时长: ${duration}s`);
    }
    if (resolution) {
      remarkParts.push(`分辨率: ${resolution}`);
    }
    if (aspectRatio) {
      remarkParts.push(`画幅: ${aspectRatio}`);
    }
    if (mode) {
      remarkParts.push(`模式: ${mode}`);
    }
    if (videoMode) {
      remarkParts.push(`视频模式: ${videoMode}`);
    }
    if (hasSound !== null) {
      remarkParts.push(`音效: ${hasSound ? '开' : '关'}`);
    }
    if (generateAudio !== null) {
      remarkParts.push(`生成音频: ${generateAudio ? '是' : '否'}`);
    }
    if (channelLabel) {
      remarkParts.push(`渠道: ${channelLabel}`);
    }

    const isBananaImageService =
      Boolean(BANANA_TENCENT_IMAGE_SERVICE_TIERS[params.serviceType]) ||
      params.serviceType === GPT_IMAGE2_SERVICE_TYPE;
    if (isBananaImageService) {
      if (channel === 'tencent') {
        remarkParts.push('计价: 按尊享路线积分价');
      } else if (channel === 'apimart') {
        remarkParts.push('计价: 按普通路线积分价');
      } else if (channel === '147') {
        remarkParts.push('计价: 按官方路线积分价');
      }
    }
    const isBananaTextService =
      params.serviceType === 'gemini-text' ||
      params.serviceType === 'gemini-prompt-optimize';
    if (isBananaTextService) {
      if (channel === 'tencent') {
        remarkParts.push('Pricing: text stable route 10 credits/call');
      } else if (channel === 'apimart') {
        remarkParts.push('Pricing: text normal route 5 credits/call');
      }
    }
    return remarkParts.length > 0 ? remarkParts.join(' | ') : null;
  }

  private parsePositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private getStalePendingTimeoutMinutes(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_TIMEOUT_MINUTES',
      STALE_PENDING_DEFAULT_TIMEOUT_MINUTES,
    );
  }

  private getStalePendingVideoTimeoutMinutes(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_VIDEO_TIMEOUT_MINUTES',
      STALE_PENDING_DEFAULT_VIDEO_TIMEOUT_MINUTES,
    );
  }

  private getStalePendingVideoRefundCutoverAt(): Date | null {
    const raw = process.env.CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT;
    const trimmed = raw?.trim();

    if (trimmed) {
      const normalized = trimmed.toLowerCase();
      if (normalized === 'off' || normalized === 'none' || normalized === '0') {
        return null;
      }

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
      this.logger.warn(
        `Invalid CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT=${trimmed}, fallback to default ${STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT}`,
      );
    }

    const fallback = new Date(STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT);
    if (Number.isNaN(fallback.getTime())) {
      this.logger.warn(
        `Invalid default video refund cutover date ${STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT}, disable cutover filter`,
      );
      return null;
    }
    return fallback;
  }

  private getStalePendingBatchSize(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_TIMEOUT_BATCH_SIZE',
      STALE_PENDING_DEFAULT_BATCH_SIZE,
    );
  }

  private getFreeUsageQuotaCutoverAt(): Date | null {
    const raw = process.env.FREE_USAGE_QUOTA_CUTOVER_AT;
    const trimmed = raw?.trim();

    if (trimmed) {
      const normalized = trimmed.toLowerCase();
      if (normalized === 'off' || normalized === 'none' || normalized === '0') {
        return null;
      }

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }

      this.logger.warn(
        `Invalid FREE_USAGE_QUOTA_CUTOVER_AT=${trimmed}, fallback to default ${FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT}`,
      );
    }

    const fallback = new Date(FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT);
    if (Number.isNaN(fallback.getTime())) {
      this.logger.warn(
        `Invalid default free usage quota cutover date ${FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT}, disable cutover filter`,
      );
      return null;
    }

    return fallback;
  }

  private async getFreeTierBenefitsSetting(): Promise<Record<string, unknown> | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: FREE_TIER_BENEFITS_SETTING_KEY },
      select: { value: true },
    });
    if (!setting?.value) return null;

    try {
      const parsed = JSON.parse(setting.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      this.logger.warn(`免费用户权益配置解析失败 key=${FREE_TIER_BENEFITS_SETTING_KEY}`);
    }

    return null;
  }

  private getFreeUserMonthlyImageLimit(): number {
    const raw = process.env.FREE_USER_MONTHLY_IMAGE_LIMIT;
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT;
    }
    return parsed;
  }

  private async getFreeUserDailyImageLimit(): Promise<number> {
    return this.parsePositiveIntEnv(
      'FREE_USER_DAILY_IMAGE_LIMIT',
      DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT,
    );
  }

  private async getFreeUserDailyVideoLimit(): Promise<number> {
    return this.parsePositiveIntEnv(
      'FREE_USER_DAILY_VIDEO_LIMIT',
      DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT,
    );
  }

  private getFreeUserMonthlyVideoLimit(): number {
    return this.parsePositiveIntEnv(
      'FREE_USER_MONTHLY_VIDEO_LIMIT',
      DEFAULT_FREE_USER_MONTHLY_VIDEO_LIMIT,
    );
  }

  private isFreeUserImageQuotaService(serviceType: ServiceType): boolean {
    return this.freeUserImageQuotaServiceTypes.has(serviceType);
  }

  private isFreeUserVideoQuotaService(serviceType: ServiceType): boolean {
    return this.freeUserVideoQuotaServiceTypes.has(serviceType);
  }

  private resolveImageQuotaRequestCount(requestedOutputImageCount?: number): number {
    if (!Number.isFinite(requestedOutputImageCount)) {
      return 1;
    }
    const normalized = Math.floor(Number(requestedOutputImageCount));
    return normalized > 0 ? normalized : 1;
  }

  private getUtcMonthRange(now: Date): { start: Date; end: Date; label: string } {
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
    const label = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    return { start, end, label };
  }

  private getUtcDayRange(now: Date): { start: Date; end: Date; label: string } {
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const day = now.getUTCDate();
    const start = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex, day + 1, 0, 0, 0, 0));
    const label = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { start, end, label };
  }

  private async countImageQuotaUsage(
    client: PrismaService | Prisma.TransactionClient,
    where: Prisma.ApiUsageRecordWhereInput,
  ): Promise<number> {
    const [knownCountAggregate, unknownCount] = await Promise.all([
      client.apiUsageRecord.aggregate({
        where: {
          ...where,
          outputImageCount: { not: null },
        },
        _sum: {
          outputImageCount: true,
        },
      }),
      client.apiUsageRecord.count({
        where: {
          ...where,
          outputImageCount: null,
        },
      }),
    ]);

    return (knownCountAggregate._sum.outputImageCount ?? 0) + unknownCount;
  }

  private async countVideoQuotaUsage(
    client: PrismaService | Prisma.TransactionClient,
    where: Prisma.ApiUsageRecordWhereInput,
  ): Promise<number> {
    return client.apiUsageRecord.count({ where });
  }

  private async hasPrivilegedUsageQuotaAccess(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const [paidOrder, activeMembership, userProfile] = await Promise.all([
      client.paymentOrder.findFirst({
        where: {
          userId,
          status: 'paid',
        },
        select: { id: true },
      }),
      client.userMembershipSubscription.findFirst({
        where: {
          userId,
          status: 'active',
          currentPeriodStartAt: { lte: new Date() },
          currentPeriodEndAt: { gt: new Date() },
        },
        select: { id: true },
      }),
      client.user.findUnique({
        where: { id: userId },
        select: { role: true, noWatermark: true },
      }),
    ]);

    if (paidOrder || activeMembership || userProfile?.noWatermark === true) return true;
    const role = typeof userProfile?.role === 'string' ? userProfile.role.toLowerCase() : '';
    return role === 'admin' || role === 'normal_admin';
  }

  private async shouldSkipFreeUsageQuota(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    return this.hasPrivilegedUsageQuotaAccess(client, userId);
  }

  private async enforceFreeUserImageQuota(
    client: PrismaService | Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      requestedOutputImageCount?: number;
      skipQuota?: boolean;
    },
  ): Promise<void> {
    const { userId, serviceType, requestedOutputImageCount } = params;
    const monthlyLimit = this.getFreeUserMonthlyImageLimit();
    const dailyLimit = await this.getFreeUserDailyImageLimit();

    if (monthlyLimit <= 0 && dailyLimit <= 0) return;
    if (!this.isFreeUserImageQuotaService(serviceType)) return;
    if (params.skipQuota) return;

    const requestedCount = this.resolveImageQuotaRequestCount(requestedOutputImageCount);
    const now = new Date();
    const quotaCutoverAt = this.getFreeUsageQuotaCutoverAt();
    const baseWhere: Prisma.ApiUsageRecordWhereInput = {
      userId,
      serviceType: { in: FREE_USER_IMAGE_LIMITED_SERVICES },
      responseStatus: { in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS] },
    };

    if (dailyLimit > 0) {
      const { start, end, label } = this.getUtcDayRange(now);
      const effectiveStart =
        quotaCutoverAt && quotaCutoverAt.getTime() > start.getTime() ? quotaCutoverAt : start;
      const usedCount = await this.countImageQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: effectiveStart,
          lt: end,
        },
      });

      if (usedCount + requestedCount > dailyLimit) {
        this.logger.warn(
          `免费用户日生图配额超限 userId=${userId} day=${label} used=${usedCount} requested=${requestedCount} limit=${dailyLimit}`,
        );
        throw new BadRequestException(
          `免费额度已用尽，请前往充值，享有更多权限后可继续生成。免费用户每天最多可使用图片能力 ${dailyLimit} 次（UTC ${label}）。今日已使用 ${usedCount} 次，本次请求 ${requestedCount} 次。`,
        );
      }
    }

    if (monthlyLimit > 0) {
      const { start, end, label } = this.getUtcMonthRange(now);
      const effectiveStart =
        quotaCutoverAt && quotaCutoverAt.getTime() > start.getTime() ? quotaCutoverAt : start;
      const usedCount = await this.countImageQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: effectiveStart,
          lt: end,
        },
      });

      if (usedCount + requestedCount > monthlyLimit) {
        this.logger.warn(
          `免费用户月生图配额超限 userId=${userId} month=${label} used=${usedCount} requested=${requestedCount} limit=${monthlyLimit}`,
        );
        throw new BadRequestException(
          `免费额度已用尽，请前往充值，享有更多权限后可继续生成。免费用户每月最多可使用图片能力 ${monthlyLimit} 次（UTC ${label}）。本月已使用 ${usedCount} 次，本次请求 ${requestedCount} 次。`,
        );
      }
    }
  }

  private async enforceFreeUserVideoQuota(
    client: PrismaService | Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      skipQuota?: boolean;
    },
  ): Promise<void> {
    const { userId, serviceType } = params;
    const dailyLimit = await this.getFreeUserDailyVideoLimit();
    const monthlyLimit = this.getFreeUserMonthlyVideoLimit();

    if (dailyLimit <= 0 && monthlyLimit <= 0) return;
    if (!this.isFreeUserVideoQuotaService(serviceType)) return;
    if (params.skipQuota) return;

    const now = new Date();
    const baseWhere: Prisma.ApiUsageRecordWhereInput = {
      userId,
      serviceType: { in: FREE_USER_VIDEO_LIMITED_SERVICES },
      responseStatus: { in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS] },
    };
    const requestedCount = 1;

    if (dailyLimit > 0) {
      const { start, end, label } = this.getUtcDayRange(now);
      const usedCount = await this.countVideoQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: start,
          lt: end,
        },
      });

      if (usedCount + requestedCount > dailyLimit) {
        this.logger.warn(
          `免费用户日生视频配额超限 userId=${userId} day=${label} used=${usedCount} requested=${requestedCount} limit=${dailyLimit}`,
        );
        throw new BadRequestException(
          `免费额度已用尽，请前往充值，享有更多权限后可继续生成。免费用户每天最多可生成视频 ${dailyLimit} 个（UTC ${label}）。今日已使用 ${usedCount} 个，本次请求 ${requestedCount} 个。`,
        );
      }
    }

    if (monthlyLimit > 0) {
      const { start, end, label } = this.getUtcMonthRange(now);
      const usedCount = await this.countVideoQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: start,
          lt: end,
        },
      });

      if (usedCount + requestedCount > monthlyLimit) {
        this.logger.warn(
          `免费用户月生视频配额超限 userId=${userId} month=${label} used=${usedCount} requested=${requestedCount} limit=${monthlyLimit}`,
        );
        throw new BadRequestException(
          `免费额度已用尽，请前往充值，享有更多权限后可继续生成。免费用户每月最多可生成视频 ${monthlyLimit} 个（UTC ${label}）。本月已使用 ${usedCount} 个，本次请求 ${requestedCount} 个。`,
        );
      }
    }
  }

  async assertFreeUserUsageQuota(
    userId: string,
    serviceType: ServiceType,
    requestedOutputImageCount?: number,
  ): Promise<void> {
    await this.enforceFreeUserImageQuota(this.prisma, {
      userId,
      serviceType,
      requestedOutputImageCount,
    });
    await this.enforceFreeUserVideoQuota(this.prisma, {
      userId,
      serviceType,
    });
  }

  async assertFreeUserImageQuota(
    userId: string,
    serviceType: ServiceType,
    requestedOutputImageCount?: number,
  ): Promise<void> {
    await this.assertFreeUserUsageQuota(userId, serviceType, requestedOutputImageCount);
  }

  /**
   * 判断用户是否为付费用户（有成功支付的订单）
   */
  async isPaidUser(userId: string): Promise<boolean> {
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: 'paid',
      },
    });
    return !!paidOrder;
  }

  /**
   * 获取或创建用户积分账户
   * 使用双重检查锁定模式（Double-Checked Locking）避免并发创建冲突
   */
  async getOrCreateAccount(userId: string) {
    let userCreatedAt: Date | undefined;

    // 第一次检查：快速路径，绝大多数场景直接命中
    let account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (account) {
      userCreatedAt = (
        await this.prisma.user.findUnique({
          where: { id: userId },
          select: { createdAt: true },
        })
      )?.createdAt;
      const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
        userId,
        account,
        userCreatedAt,
      });
      if (!granted) {
        return account;
      }

      return this.prisma.creditAccount.findUniqueOrThrow({
        where: { userId },
      });
    }

    // 第二次检查：在事务内部再次检查，避免并发创建冲突
    try {
      account = await this.prisma.$transaction(async (tx) => {
        // 在事务中再次查询，确保在创建前账户不存在
        // 这样可以避免两个并发请求同时创建的情况
        const existingAccount = await tx.creditAccount.findUnique({
          where: { userId },
        });

        if (existingAccount) {
          return existingAccount;
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { createdAt: true },
        });
        userCreatedAt = user?.createdAt;

        // 新用户不再发放注册积分；仅初始化账户，后续按免费用户月度额度规则补发。
        const newAccount = await tx.creditAccount.create({
          data: {
            userId,
            balance: 0,
            totalEarned: 0,
          },
        });

        return newAccount;
      }, {
        // 设置事务超时和隔离级别
        timeout: 10000, // 10秒超时
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });

      const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
        userId,
        account,
        userCreatedAt,
      });
      if (!granted) {
        return account;
      }

      return this.prisma.creditAccount.findUniqueOrThrow({
        where: { userId },
      });
    } catch (error) {
      // 如果仍然发生唯一约束冲突（理论上不应该，但作为最后的安全网）
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`检测到并发创建账户冲突 userId=${userId}，重新查询`);
        const existingAccount = await this.prisma.creditAccount.findUnique({
          where: { userId },
        });
        if (!existingAccount) {
          // 如果仍然找不到，记录错误并抛出
          this.logger.error(`P2002错误后未找到账户 userId=${userId}`);
          throw error;
        }
        const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
          userId,
          account: existingAccount,
        });
        if (!granted) {
          return existingAccount;
        }

        return this.prisma.creditAccount.findUniqueOrThrow({
          where: { userId },
        });
      }
      throw error;
    }
  }

  async issueFreeUserMonthlyQuotaCredits(now = new Date()) {
    const activeSubscriptionUserIds = new Set(
      (
        await this.prisma.userMembershipSubscription.findMany({
          where: {
            status: 'active',
            currentPeriodStartAt: { lte: now },
            currentPeriodEndAt: { gt: now },
          },
          select: { userId: true },
        })
      ).map((item) => item.userId),
    );

    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    let affectedUsers = 0;
    let grantedCredits = 0;
    let createdLots = 0;

    for (const user of users) {
      if (activeSubscriptionUserIds.has(user.id)) {
        continue;
      }

      const account = await this.getOrCreateAccount(user.id);
      const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
        userId: user.id,
        account,
        userCreatedAt: user.createdAt,
        now,
      });
      if (!granted) {
        continue;
      }

      const policy = await this.businessPolicyService.getMembershipCreditPolicy();
      affectedUsers += 1;
      grantedCredits += policy.freeUserMonthlyQuotaCredits;
      createdLots += 1;
    }

    return {
      affectedUsers,
      grantedCredits,
      createdLots,
    };
  }

  /**
   * 获取用户积分余额
   */
  async getBalance(userId: string): Promise<number> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }
    return account.balance;
  }

  /**
   * 获取用户积分账户详情
   */
  async getAccountDetails(userId: string) {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }
    return {
      balance: account.balance,
      totalEarned: account.totalEarned,
      totalSpent: account.totalSpent,
    };
  }

  /**
   * 检查用户是否有足够积分
   */
  async hasEnoughCredits(userId: string, serviceType: ServiceType): Promise<boolean> {
    const pricing = await this.resolveServicePricing({ serviceType });
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    const balance = await this.getBalance(userId);
    return balance >= pricing.creditsPerCall;
  }

  /**
   * 获取服务定价
   */
  async getServicePricing(serviceType: ServiceType) {
    const pricing = await this.resolveServicePricing({ serviceType });
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }
    return {
      serviceType,
      ...pricing,
    };
  }

  private normalizeCatalogCondition(
    condition: ManagedPricingCondition | null | undefined,
  ): PricingCatalogRuleConditionView | null {
    const field = typeof condition?.field === 'string' ? condition.field.trim() : '';
    if (!field) return null;
    return {
      field,
      op: typeof condition?.op === 'string' ? condition.op : 'eq',
      ...(condition?.value !== undefined ? { value: condition.value } : {}),
    };
  }

  private buildEvaluatorFormula(
    evaluator: ManagedPricingEvaluator | undefined,
  ): string | undefined {
    if (!evaluator || typeof evaluator !== 'object') return undefined;

    if (evaluator.type === 'fixed') {
      const credits =
        typeof evaluator.credits === 'number'
          ? evaluator.credits
          : typeof evaluator.priceYuan === 'number'
          ? Math.ceil(evaluator.priceYuan * 100)
          : undefined;
      return credits !== undefined ? `${credits} 积分` : '固定定价';
    }

    if (evaluator.type === 'linear') {
      const creditsPerUnit = Math.ceil(evaluator.unitPriceYuan * 100);
      return `credits = ${evaluator.unitField} × ${creditsPerUnit}`;
    }

    if (evaluator.type === 'base_plus_linear') {
      const baseCredits = Math.ceil(evaluator.basePriceYuan * 100);
      const extraCreditsPerUnit = Math.ceil(evaluator.extraUnitPriceYuan * 100);
      return `credits = ${baseCredits} + max(0, ${evaluator.unitField} - ${evaluator.includedUnits}) × ${extraCreditsPerUnit}`;
    }

    if (evaluator.type === 'lookup_matrix') {
      return `credits = lookup_matrix(${evaluator.axes.join(', ')})`;
    }

    return undefined;
  }

  private buildCatalogRules(vendor: ManagedModelVendorConfig): PricingCatalogRuleView[] {
    const pricing =
      vendor.pricing && typeof vendor.pricing === 'object' && !Array.isArray(vendor.pricing)
        ? vendor.pricing
        : null;
    const matchingRules = Array.isArray(pricing?.matchingRules)
      ? (pricing.matchingRules as ManagedPricingMatchingRule[])
      : [];
    const evaluators =
      pricing?.evaluators && typeof pricing.evaluators === 'object' && !Array.isArray(pricing.evaluators)
        ? (pricing.evaluators as Record<string, ManagedPricingEvaluator>)
        : {};

    const structuredRules = matchingRules.map((rule) => {
      const evaluatorKey =
        typeof rule?.evaluatorKey === 'string' ? rule.evaluatorKey.trim() : '';
      const evaluator = evaluatorKey ? evaluators[evaluatorKey] : undefined;
      return {
        ...(typeof rule?.ruleKey === 'string' && rule.ruleKey.trim()
          ? { ruleKey: rule.ruleKey.trim() }
          : {}),
        ...(typeof rule?.label === 'string' && rule.label.trim()
          ? { label: rule.label.trim() }
          : {}),
        ...(typeof rule?.priority === 'number' ? { priority: rule.priority } : {}),
        ...(evaluatorKey ? { evaluatorKey } : {}),
        ...(typeof evaluator?.type === 'string' ? { evaluatorType: evaluator.type } : {}),
        ...(this.buildEvaluatorFormula(evaluator)
          ? { formula: this.buildEvaluatorFormula(evaluator) }
          : {}),
        conditions: {
          all: (Array.isArray(rule?.conditions?.all) ? rule.conditions.all : [])
            .map((condition) => this.normalizeCatalogCondition(condition))
            .filter((condition): condition is PricingCatalogRuleConditionView => !!condition),
          any: (Array.isArray(rule?.conditions?.any) ? rule.conditions.any : [])
            .map((condition) => this.normalizeCatalogCondition(condition))
            .filter((condition): condition is PricingCatalogRuleConditionView => !!condition),
        },
      } satisfies PricingCatalogRuleView;
    });

    if (structuredRules.length > 0) return structuredRules;

    const legacyRules = Array.isArray((vendor.metadata as Record<string, any> | undefined)?.specPricing?.rules)
      ? ((vendor.metadata as Record<string, any>).specPricing.rules as Array<Record<string, any>>)
      : [];

    return legacyRules.map((rule, index) => {
      const credits =
        typeof rule?.price?.credits === 'number'
          ? rule.price.credits
          : typeof rule?.creditsPerCall === 'number'
          ? rule.creditsPerCall
          : undefined;
      const priceYuan =
        typeof rule?.price?.priceYuan === 'number'
          ? rule.price.priceYuan
          : typeof rule?.priceYuan === 'number'
          ? rule.priceYuan
          : undefined;
      const resolvedCredits =
        credits !== undefined
          ? credits
          : priceYuan !== undefined
          ? Math.ceil(priceYuan * 100)
          : undefined;
      return {
        ruleKey:
          typeof rule?.ruleKey === 'string' && rule.ruleKey.trim()
            ? rule.ruleKey.trim()
            : `legacy_rule_${index + 1}`,
        ...(typeof rule?.label === 'string' && rule.label.trim()
          ? { label: rule.label.trim() }
          : {}),
        ...(resolvedCredits !== undefined
          ? { formula: `${resolvedCredits} 积分` }
          : {}),
        conditions: {
          all: Object.entries(
            rule?.when && typeof rule.when === 'object' && !Array.isArray(rule.when)
              ? rule.when
              : rule?.match && typeof rule.match === 'object' && !Array.isArray(rule.match)
              ? rule.match
              : {},
          ).map(([field, value]) => ({
            field,
            op: 'eq',
            value,
          })),
          any: [],
        },
      };
    });
  }

  private buildCatalogDimensions(vendor: ManagedModelVendorConfig): PricingCatalogDimensionView[] {
    const pricing =
      vendor.pricing && typeof vendor.pricing === 'object' && !Array.isArray(vendor.pricing)
        ? vendor.pricing
        : null;
    const dimensions = Array.isArray(pricing?.dimensions) ? pricing.dimensions : [];
    return dimensions
      .map((dimension): PricingCatalogDimensionView | null => {
        if (typeof dimension === 'string') {
          return { key: dimension };
        }
        const item = dimension as ManagedPricingDimensionDefinition;
        const key = typeof item?.key === 'string' ? item.key.trim() : '';
        if (!key) return null;
        return {
          key,
          ...(typeof item.label === 'string' && item.label.trim()
            ? { label: item.label.trim() }
            : {}),
          ...(typeof item.type === 'string' ? { type: item.type } : {}),
          ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
          ...(typeof item.description === 'string' && item.description.trim()
            ? { description: item.description.trim() }
            : {}),
          ...(Array.isArray(item.options)
            ? {
                options: item.options
                  .filter((option) => option && option.value !== undefined)
                  .map((option) => ({
                    value: option.value,
                    ...(typeof option.label === 'string' && option.label.trim()
                      ? { label: option.label.trim() }
                      : {}),
                  })),
              }
            : {}),
        };
      })
      .filter((dimension): dimension is PricingCatalogDimensionView => dimension !== null);
  }

  async getManagedPricingCatalog(modelKey?: string): Promise<ManagedPricingCatalogItem[]> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
      select: { value: true },
    });
    const raw = typeof setting?.value === 'string' ? setting.value.trim() : '';
    if (!raw) return [];

    const parsed = JSON.parse(raw) as ManagedPricingMappingLike & {
      models?: ManagedModelConfig[];
    };
    const normalizedModelKey = typeof modelKey === 'string' ? modelKey.trim() : '';
    const models = Array.isArray(parsed.models) ? (parsed.models as ManagedModelConfig[]) : [];

    return models
      .filter((model) => {
        const currentModelKey =
          typeof model?.modelKey === 'string' ? model.modelKey.trim() : '';
        if (!currentModelKey) return false;
        if (!normalizedModelKey) return true;
        return currentModelKey === normalizedModelKey;
      })
      .map((model) => {
        const vendors = (Array.isArray(model.vendors) ? model.vendors : [])
          .filter((vendor) => vendor && typeof vendor.vendorKey === 'string' && vendor.vendorKey.trim())
          .map((vendor) => {
            const normalizedVendor = vendor as ManagedModelVendorConfig;
            const defaultPricing = resolveManagedVendorDefaultPricing(normalizedVendor);
            return {
              vendorKey: normalizedVendor.vendorKey.trim(),
              ...(typeof normalizedVendor.label === 'string' && normalizedVendor.label.trim()
                ? { label: normalizedVendor.label.trim() }
                : {}),
              ...(typeof normalizedVendor.provider === 'string' && normalizedVendor.provider.trim()
                ? { provider: normalizedVendor.provider.trim() }
                : {}),
              ...(typeof normalizedVendor.platformKey === 'string' && normalizedVendor.platformKey.trim()
                ? { platformKey: normalizedVendor.platformKey.trim() }
                : {}),
              enabled: normalizedVendor.enabled !== false,
              ...(typeof normalizedVendor.creditsPerCall === 'number'
                ? { creditsPerCall: normalizedVendor.creditsPerCall }
                : {}),
              ...(typeof normalizedVendor.priceYuan === 'number'
                ? { priceYuan: normalizedVendor.priceYuan }
                : {}),
              ...(typeof defaultPricing.pricingVersion === 'string'
                ? { pricingVersion: defaultPricing.pricingVersion }
                : {}),
              defaultPrice: defaultPricing.price || {},
              dimensions: this.buildCatalogDimensions(normalizedVendor),
              rules: this.buildCatalogRules(normalizedVendor),
            } satisfies PricingCatalogVendorView;
          });

        return {
          modelKey: model.modelKey.trim(),
          ...(typeof model.modelName === 'string' && model.modelName.trim()
            ? { modelName: model.modelName.trim() }
            : {}),
          ...(typeof model.taskType === 'string' && model.taskType.trim()
            ? { taskType: model.taskType.trim() }
            : {}),
          enabled: model.enabled !== false,
          ...(typeof model.defaultVendor === 'string' && model.defaultVendor.trim()
            ? { defaultVendor: model.defaultVendor.trim() }
            : {}),
          vendors,
        } satisfies ManagedPricingCatalogItem;
      });
  }

  /**
   * 获取所有服务定价
   */
  async getAllPricing(): Promise<PricingResponseDto[]> {
    const staticEntries = new Map(
      Object.entries(CREDIT_PRICING_CONFIG).map(([key, value]) => [
        key,
        {
          serviceType: key,
          ...value,
        } as PricingResponseDto,
      ]),
    );
    const nodeConfigs = await this.prisma.nodeConfig.findMany({
      where: {
        serviceType: {
          not: null,
        },
      },
      select: {
        serviceType: true,
        nameZh: true,
        creditsPerCall: true,
      },
    });

    for (const item of nodeConfigs) {
      const serviceType =
        typeof item.serviceType === 'string' ? item.serviceType.trim() : '';
      if (!serviceType) continue;

      const fallback = staticEntries.get(serviceType);
      staticEntries.set(serviceType, {
        serviceType,
        serviceName: item.nameZh || fallback?.serviceName || serviceType,
        provider: fallback?.provider || 'custom',
        creditsPerCall:
          serviceType === GPT_IMAGE2_SERVICE_TYPE
            ? GPT_IMAGE2_CREDITS
            : typeof item.creditsPerCall === 'number'
            ? item.creditsPerCall
            : (fallback?.creditsPerCall ?? 0),
        description:
          fallback?.description ||
          `Node-managed pricing for ${item.nameZh || item.serviceType}`,
        maxInputTokens: fallback?.maxInputTokens,
        maxContextLength: fallback?.maxContextLength,
      });
    }

    return Array.from(staticEntries.values());
  }

  /**
   * 预扣积分（在API调用前）
   * 返回 API 使用记录 ID，用于后续更新状态
   */
  private normalizeIdempotencyKey(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 128);
  }

  private normalizeIdempotencyWindowMs(raw: unknown): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return PRE_DEDUCT_IDEMPOTENCY_DEFAULT_WINDOW_MS;
    }
    return Math.min(
      PRE_DEDUCT_IDEMPOTENCY_MAX_WINDOW_MS,
      Math.max(1_000, Math.round(value)),
    );
  }

  private stripDedupMetaFromRequestParams(requestParams: unknown): unknown {
    if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) {
      return requestParams;
    }
    const objectValue = requestParams as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(objectValue)) {
      if (
        key === 'idempotencyKey' ||
        key === 'requestFingerprint' ||
        key === 'idempotencyWindowMs'
      ) {
        continue;
      }
      cloned[key] = value;
    }
    return cloned;
  }

  private stableStringifyForFingerprint(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringifyForFingerprint(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      const keys = Object.keys(objectValue).sort();
      return `{${keys
        .map((key) => `${JSON.stringify(key)}:${this.stableStringifyForFingerprint(objectValue[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(String(value));
  }

  private buildApiUsageRequestFingerprint(params: {
    serviceType: ServiceType;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    inputImageCount?: number;
    outputImageCount?: number;
    requestParams?: unknown;
  }): string {
    const fingerprintPayload = {
      serviceType: params.serviceType,
      model: params.model || null,
      inputTokens: params.inputTokens ?? null,
      outputTokens: params.outputTokens ?? null,
      inputImageCount: params.inputImageCount ?? null,
      outputImageCount: params.outputImageCount ?? null,
      requestParams: this.stripDedupMetaFromRequestParams(params.requestParams),
    };
    const serialized = this.stableStringifyForFingerprint(fingerprintPayload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  private withDedupMetaInRequestParams(
    requestParams: unknown,
    idempotencyKey: string | null,
    requestFingerprint: string | null,
  ): Record<string, any> | undefined {
    const base =
      requestParams && typeof requestParams === 'object' && !Array.isArray(requestParams)
        ? { ...(requestParams as Record<string, any>) }
        : {};
    if (!idempotencyKey && !requestFingerprint) {
      return Object.keys(base).length > 0 ? base : undefined;
    }
    if (idempotencyKey) {
      base.idempotencyKey = idempotencyKey;
    }
    if (requestFingerprint) {
      base.requestFingerprint = requestFingerprint;
    }
    return base;
  }

  private async findDuplicateApiUsageInWindow(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      model?: string;
      idempotencyKey: string | null;
      requestFingerprint: string | null;
      windowStartAt: Date;
    },
  ): Promise<{ apiUsageId: string; transactionId: string | null } | null> {
    const statusFilter = {
      in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS],
    };

    let duplicate = null as { id: string } | null;
    if (params.idempotencyKey) {
      duplicate = await tx.apiUsageRecord.findFirst({
        where: {
          userId: params.userId,
          serviceType: params.serviceType,
          ...(params.model ? { model: params.model } : {}),
          responseStatus: statusFilter,
          createdAt: { gte: params.windowStartAt },
          requestParams: {
            path: ['idempotencyKey'],
            equals: params.idempotencyKey,
          },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!duplicate && !params.idempotencyKey && params.requestFingerprint) {
      duplicate = await tx.apiUsageRecord.findFirst({
        where: {
          userId: params.userId,
          serviceType: params.serviceType,
          ...(params.model ? { model: params.model } : {}),
          responseStatus: statusFilter,
          createdAt: { gte: params.windowStartAt },
          requestParams: {
            path: ['requestFingerprint'],
            equals: params.requestFingerprint,
          },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!duplicate) return null;

    const spendTransaction = await tx.creditTransaction.findFirst({
      where: {
        apiUsageId: duplicate.id,
        type: TransactionType.SPEND,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      apiUsageId: duplicate.id,
      transactionId: spendTransaction?.id ?? null,
    };
  }

  async preDeductCredits(params: ApiUsageParams): Promise<DeductCreditsResult> {
    const {
      userId,
      serviceType,
      model,
      inputTokens,
      outputTokens,
      inputImageCount,
      outputImageCount,
      requestParams,
      ipAddress,
      userAgent,
      idempotencyKey,
      idempotencyWindowMs,
    } = params;
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKey ?? requestParams?.idempotencyKey,
    );
    const normalizedIdempotencyWindowMs = this.normalizeIdempotencyWindowMs(
      idempotencyWindowMs ?? requestParams?.idempotencyWindowMs,
    );
    const requestFingerprint = this.buildApiUsageRequestFingerprint({
      serviceType,
      model,
      inputTokens,
      outputTokens,
      inputImageCount,
      outputImageCount,
      requestParams,
    });

    const {
      pricing,
      creditsToDeduct,
      effectiveRequestParams,
      requestedProvider,
    } = await this.resolveEffectiveCreditsQuote({
      serviceType,
      model,
      requestParams,
      outputImageCount,
    });
    const apiUsageRequestParams = this.withDedupMetaInRequestParams(
      effectiveRequestParams,
      normalizedIdempotencyKey,
      requestFingerprint,
    );

    return await this.prisma.$transaction(async (tx) => {
      // 获取账户并锁定
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      if (normalizedIdempotencyKey || requestFingerprint) {
        const duplicateUsage = await this.findDuplicateApiUsageInWindow(tx, {
          userId,
          serviceType,
          model,
          idempotencyKey: normalizedIdempotencyKey,
          requestFingerprint,
          windowStartAt: new Date(Date.now() - normalizedIdempotencyWindowMs),
        });
        if (duplicateUsage) {
          this.logger.warn(
            `[Credits] Duplicate pre-deduct blocked user=${userId} service=${serviceType} key=${
              normalizedIdempotencyKey || '-'
            } apiUsageId=${duplicateUsage.apiUsageId}`,
          );
          return {
            success: true,
            newBalance: account.balance,
            transactionId:
              duplicateUsage.transactionId || `duplicate:${duplicateUsage.apiUsageId}`,
            apiUsageId: duplicateUsage.apiUsageId,
          };
        }
      }

      const activeLots = await tx.creditLot.findMany({
        where: {
          accountId: account.id,
          status: 'active',
        },
        select: {
          id: true,
          sourceType: true,
          validityType: true,
          scopeType: true,
          scopeValue: true,
          totalAmount: true,
          remainingAmount: true,
          grantedAt: true,
          activeAt: true,
          expiresAt: true,
          priority: true,
          status: true,
        },
      });

      const consumePolicy = await this.resolveCreditConsumePolicy(tx, {
        serviceType,
        provider: requestedProvider || pricing.provider,
        model: model ?? null,
      });
      const deductionPlan = buildHybridCreditDeductionPlan({
        accountBalance: account.balance,
        amount: creditsToDeduct,
        lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
        now: new Date(),
        scope: {
          serviceType,
          provider: requestedProvider || pricing.provider,
          model: model ?? null,
        },
        policy: consumePolicy,
      });

      const skipFreeUsageQuota = await this.shouldSkipFreeUsageQuota(tx, userId);

      await this.enforceFreeUserImageQuota(tx, {
        userId,
        serviceType,
        requestedOutputImageCount: outputImageCount,
        skipQuota: skipFreeUsageQuota,
      });
      await this.enforceFreeUserVideoQuota(tx, {
        userId,
        serviceType,
        skipQuota: skipFreeUsageQuota,
      });

      if (!deductionPlan.sufficient) {
        throw new BadRequestException(`积分不足，当前余额: ${account.balance}，需要: ${creditsToDeduct}`);
      }

      const updatedLots = applyLotDeductionsToSnapshots({
        lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
        deductions: deductionPlan.deductions,
      });

      for (const updatedLot of updatedLots) {
        const originalLot = activeLots.find((lot) => lot.id === updatedLot.id);
        if (!originalLot) continue;
        if (
          originalLot.remainingAmount === updatedLot.remainingAmount &&
          originalLot.status === updatedLot.status
        ) {
          continue;
        }

        await tx.creditLot.update({
          where: { id: updatedLot.id },
          data: {
            remainingAmount: updatedLot.remainingAmount,
            status: updatedLot.status,
          },
        });
      }

      const newBalance = account.balance - deductionPlan.totalDeducted;

      // 按服务类型解析显示名称
      let effectiveServiceName = this.resolveSoraServiceName(
        serviceType,
        pricing.serviceName,
        apiUsageRequestParams,
        model,
      );
      effectiveServiceName = this.resolveKlingServiceName(
        serviceType,
        effectiveServiceName,
        apiUsageRequestParams,
      );
      effectiveServiceName = this.resolveManagedVideoServiceName(
        serviceType,
        effectiveServiceName,
        apiUsageRequestParams,
      );
      // 图片服务名称格式：基础名称 + 分辨率 + 生成数量 + 路线
      effectiveServiceName = this.resolveBananaImageServiceName(
        serviceType,
        effectiveServiceName,
        apiUsageRequestParams,
        outputImageCount,
      );
      const billingRemark = this.buildBillingRemark({
        serviceType,
        model,
        provider: requestedProvider || pricing.provider,
        requestParams: apiUsageRequestParams,
      });

      // 更新账户余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: account.totalSpent + creditsToDeduct,
        },
      });

      // 创建 API 使用记录
      const apiUsage = await tx.apiUsageRecord.create({
        data: {
          userId,
          serviceType,
          serviceName: effectiveServiceName,
          provider: requestedProvider || pricing.provider,
          model,
          creditsUsed: creditsToDeduct,
          inputTokens,
          outputTokens,
          inputImageCount,
          outputImageCount,
          requestParams: apiUsageRequestParams,
          responseStatus: ApiResponseStatus.PENDING,
          ipAddress,
          userAgent,
        },
      });

      // 创建交易记录
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.SPEND,
          amount: -deductionPlan.totalDeducted,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `Use ${effectiveServiceName}${
            apiUsageRequestParams?.imageSize
              ? ` (${apiUsageRequestParams.imageSize})`
              : ''
          }`,
          apiUsageId: apiUsage.id,
          consumePolicyCode: consumePolicy.code,
          consumePolicyVersion: consumePolicy.version,
          metadata: this.buildLotDeductionsMetadata(deductionPlan.deductions, {
            billingRemark,
          }),
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
        apiUsageId: apiUsage.id,
      };
    }, {
      timeout: PRE_DEDUCT_TRANSACTION_TIMEOUT_MS,
    });
  }

  async previewCredits(params: PreviewCreditsParams) {
    const account = await this.getOrCreateAccount(params.userId);
    let cachedQuote = await this.getCachedPreviewQuote(params);

    if (!cachedQuote) {
      const quote = await this.resolveEffectiveCreditsQuote({
        serviceType: params.serviceType,
        model: params.model,
        requestParams: params.requestParams,
        outputImageCount: params.outputImageCount,
      });
      cachedQuote = {
        serviceName: quote.serviceName,
        requestedProvider: quote.requestedProvider,
        creditsToDeduct: quote.creditsToDeduct,
        managedPricing:
          quote.managedRoutePricing?.source && quote.managedRoutePricing.source !== 'none'
            ? {
                source: quote.managedRoutePricing.source,
                vendorKey: quote.managedRoutePricing.vendorKey,
                ruleKey: quote.managedRoutePricing.ruleKey,
                label: quote.managedRoutePricing.label,
                evaluatorKey: quote.managedRoutePricing.evaluatorKey,
                evaluatorType: quote.managedRoutePricing.evaluatorType,
                pricingVersion: quote.managedRoutePricing.pricingVersion,
                price: quote.managedRoutePricing.price,
              }
            : null,
        effectiveRequestParams: quote.effectiveRequestParams ?? null,
      };
      await this.setCachedPreviewQuote(params, cachedQuote);
    }

    return {
      serviceType: params.serviceType,
      serviceName: cachedQuote.serviceName,
      provider: cachedQuote.requestedProvider,
      model: params.model ?? null,
      credits: cachedQuote.creditsToDeduct,
      balance: account.balance,
      sufficient: account.balance >= cachedQuote.creditsToDeduct,
      managedPricing: cachedQuote.managedPricing,
      requestParams: cachedQuote.effectiveRequestParams ?? null,
    };
  }

  /**
   * 更新 API 使用记录状态
   */
  async verifyAndRewardInviterSafely(
    inviteeUserId: string,
    options?: { skipApiUsageCheck?: boolean },
  ): Promise<void> {
    if (!inviteeUserId) return;

    try {
      await this.referralService.verifyAndRewardInviter(inviteeUserId, options);
    } catch (e) {
      this.logger.warn(
        `[Credits] 邀请奖励核验失败 userId=${inviteeUserId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async updateApiUsageStatus(
    apiUsageId: string,
    status: ApiResponseStatus,
    errorMessage?: string,
    processingTime?: number,
  ) {
    const existingUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!existingUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (
      existingUsage.responseStatus === ApiResponseStatus.FAILED &&
      status === ApiResponseStatus.SUCCESS
    ) {
      this.logger.warn(
        `[Credits] Skip status transition failed -> success for apiUsageId=${apiUsageId} to avoid refund mismatch`,
      );
      return existingUsage;
    }

    if (
      existingUsage.responseStatus === ApiResponseStatus.SUCCESS &&
      status === ApiResponseStatus.FAILED
    ) {
      this.logger.warn(
        `[Credits] Skip status transition success -> failed for apiUsageId=${apiUsageId} to avoid reward/settlement mismatch`,
      );
      return existingUsage;
    }

    const updateData: Prisma.ApiUsageRecordUpdateInput = {
      responseStatus: status,
    };

    if (status === ApiResponseStatus.SUCCESS) {
      updateData.errorMessage = null;
    } else if (typeof errorMessage === 'string') {
      updateData.errorMessage = errorMessage;
    }

    if (typeof processingTime === 'number' && Number.isFinite(processingTime)) {
      updateData.processingTime = Math.max(0, Math.round(processingTime));
    }

    const updateResult = await this.prisma.apiUsageRecord.updateMany({
      where: {
        id: apiUsageId,
        ...(status === ApiResponseStatus.SUCCESS
          ? { responseStatus: ApiResponseStatus.PENDING }
          : status === ApiResponseStatus.FAILED
            ? {
                responseStatus: {
                  in: [ApiResponseStatus.PENDING, ApiResponseStatus.FAILED],
                },
              }
            : {}),
      },
      data: updateData,
    });

    const latestUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!latestUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (updateResult.count === 0) {
      if (status === ApiResponseStatus.SUCCESS) {
        this.logger.warn(
          `[Credits] Skip success update because apiUsage is no longer pending: apiUsageId=${apiUsageId}, currentStatus=${latestUsage.responseStatus}`,
        );
      }
      return latestUsage;
    }

    // 如果 API 调用首次从 pending 变为 success，检查是否需要核验邀请奖励
    if (
      status === ApiResponseStatus.SUCCESS &&
      existingUsage.responseStatus !== ApiResponseStatus.SUCCESS &&
      latestUsage.userId
    ) {
      await this.verifyAndRewardInviterSafely(latestUsage.userId);
    }

    return latestUsage;
  }

  async updateApiUsageRequestParams(
    apiUsageId: string,
    requestParamsPatch: Record<string, any>,
  ): Promise<void> {
    const sanitizedPatch = Object.fromEntries(
      Object.entries(requestParamsPatch).filter(([_, value]) => {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        return true;
      }),
    );

    if (Object.keys(sanitizedPatch).length === 0) return;

    const apiUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
      select: { requestParams: true },
    });

    if (!apiUsage) return;

    const existingParams = this.asJsonObject(apiUsage.requestParams) || {};
    await this.prisma.apiUsageRecord.update({
      where: { id: apiUsageId },
      data: {
        requestParams: {
          ...existingParams,
          ...sanitizedPatch,
        },
      },
    });
  }

  /**
   * 标记用户的 API 使用记录为失败（用于可轮询任务的手动退款前置校验）
   */
  async markApiUsageFailedForUser(
    userId: string,
    apiUsageId: string,
    errorMessage: string = 'API调用失败',
    processingTime: number = 0,
  ) {
    const apiUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!apiUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (apiUsage.userId !== userId) {
      throw new BadRequestException('无权操作该 API 使用记录');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.SUCCESS) {
      throw new BadRequestException('成功的 API 调用不支持退款');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.FAILED) {
      return apiUsage;
    }

    const updateResult = await this.prisma.apiUsageRecord.updateMany({
      where: {
        id: apiUsageId,
        responseStatus: ApiResponseStatus.PENDING,
      },
      data: {
        responseStatus: ApiResponseStatus.FAILED,
        errorMessage,
        processingTime,
      },
    });

    if (updateResult.count === 0) {
      const latestUsage = await this.prisma.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!latestUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (latestUsage.responseStatus === ApiResponseStatus.SUCCESS) {
        throw new BadRequestException('成功的 API 调用不支持退款');
      }

      return latestUsage;
    }

    const updatedUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!updatedUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    return updatedUsage;
  }

  /**
   * 标记用户的 API 使用记录为成功（用于可轮询任务在前端确认成功后回写）
   */
  async markApiUsageSuccessForUser(
    userId: string,
    apiUsageId: string,
    processingTime: number = 0,
  ) {
    const apiUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!apiUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (apiUsage.userId !== userId) {
      throw new BadRequestException('无权操作该 API 使用记录');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.FAILED) {
      throw new BadRequestException('失败的 API 调用不支持标记成功');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.SUCCESS) {
      return apiUsage;
    }

    const updateResult = await this.prisma.apiUsageRecord.updateMany({
      where: {
        id: apiUsageId,
        responseStatus: ApiResponseStatus.PENDING,
      },
      data: {
        responseStatus: ApiResponseStatus.SUCCESS,
        errorMessage: null,
        processingTime: Math.max(0, processingTime),
      },
    });

    if (updateResult.count === 0) {
      const latestUsage = await this.prisma.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!latestUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (latestUsage.responseStatus === ApiResponseStatus.FAILED) {
        throw new BadRequestException('失败的 API 调用不支持标记成功');
      }

      return latestUsage;
    }

    const updated = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!updated) {
      throw new NotFoundException('API使用记录不存在');
    }

    await this.verifyAndRewardInviterSafely(userId);
    return updated;
  }

  /**
   * API 调用失败时退还积分
   */
  async refundCredits(userId: string, apiUsageId: string): Promise<AddCreditsResult> {
    return await this.prisma.$transaction(async (tx) => {
      // 获取 API 使用记录
      const apiUsage = await tx.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!apiUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (apiUsage.userId !== userId) {
        throw new BadRequestException('无权退还该 API 调用积分');
      }

      if (apiUsage.responseStatus !== ApiResponseStatus.FAILED) {
        throw new BadRequestException('只能退还失败的API调用积分');
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      // 幂等保护：同一个 apiUsage 只允许创建一次退款交易
      const existingRefund = await tx.creditTransaction.findFirst({
        where: {
          apiUsageId,
          type: TransactionType.REFUND,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (existingRefund) {
        return {
          success: true,
          newBalance: account.balance,
          transactionId: existingRefund.id,
        };
      }

      const creditsToRefund = apiUsage.creditsUsed;
      const newBalance = account.balance + creditsToRefund;
      const adjustedTotalSpent = Math.max(0, account.totalSpent - creditsToRefund);

      const spendTransaction = await tx.creditTransaction.findFirst({
        where: {
          apiUsageId,
          type: TransactionType.SPEND,
        },
        orderBy: { createdAt: 'asc' },
      });

      const lotDeductions = this.extractLotDeductionsFromMetadata(
        spendTransaction?.metadata,
      );

      if (lotDeductions.length > 0) {
        const lotIds = lotDeductions
          .filter((item) => item.kind === 'lot' && !!item.lotId)
          .map((item) => item.lotId as string);

        if (lotIds.length > 0) {
          const lots = await tx.creditLot.findMany({
            where: {
              id: { in: lotIds },
            },
            select: {
              id: true,
              sourceType: true,
              validityType: true,
              scopeType: true,
              scopeValue: true,
              totalAmount: true,
              remainingAmount: true,
              grantedAt: true,
              activeAt: true,
              expiresAt: true,
              priority: true,
              status: true,
            },
          });

          const restoredLots = applyLotRestorationsToSnapshots({
            lots: lots.map((lot) => this.toCreditLotCandidate(lot)),
            deductions: lotDeductions,
          });

          for (const restoredLot of restoredLots) {
            const originalLot = lots.find((lot) => lot.id === restoredLot.id);
            if (!originalLot) continue;
            if (
              originalLot.remainingAmount === restoredLot.remainingAmount &&
              originalLot.status === restoredLot.status
            ) {
              continue;
            }

            await tx.creditLot.update({
              where: { id: restoredLot.id },
              data: {
                remainingAmount: restoredLot.remainingAmount,
                status: restoredLot.status,
              },
            });
          }
        }
      }

      // 更新账户余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: adjustedTotalSpent,
        },
      });

      // 创建退款交易记录
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.REFUND,
          amount: creditsToRefund,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `退还 ${apiUsage.serviceName} 积分（API调用失败）`,
          apiUsageId,
          consumePolicyCode: spendTransaction?.consumePolicyCode ?? null,
          consumePolicyVersion: spendTransaction?.consumePolicyVersion ?? null,
          metadata: lotDeductions.length > 0
            ? this.buildLotDeductionsMetadata(lotDeductions)
            : undefined,
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * 根据实际成功生成的图片数量调整积分（多退少补）
   * 用于图片生成服务，按实际产出数量计费
   */
  async adjustCreditsByOutputCount(
    apiUsageId: string,
    actualOutputCount: number,
  ): Promise<{ success: boolean; adjustedAmount: number; newBalance: number }> {
    if (!Number.isFinite(actualOutputCount) || actualOutputCount < 0) {
      throw new BadRequestException('实际产出数量无效');
    }

    const normalizedCount = Math.floor(actualOutputCount);
    if (normalizedCount === 0) {
      throw new BadRequestException('实际产出数量不能为0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const apiUsage = await tx.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!apiUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (apiUsage.responseStatus !== ApiResponseStatus.SUCCESS) {
        throw new BadRequestException('只能调整成功的API调用积分');
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId: apiUsage.userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const originalRequestParams = this.asJsonObject(apiUsage.requestParams) || {};
      const originalOutputCount = apiUsage.outputImageCount ?? 1;

      if (normalizedCount === originalOutputCount) {
        return { success: true, adjustedAmount: 0, newBalance: account.balance };
      }

      const serviceType = apiUsage.serviceType as ServiceType;
      const isImageLikeService =
        serviceType.includes('image') ||
        serviceType.startsWith('midjourney') ||
        serviceType === GPT_IMAGE2_SERVICE_TYPE ||
        serviceType === 'expand-image' ||
        serviceType === 'background-removal';

      if (!isImageLikeService) {
        return { success: true, adjustedAmount: 0, newBalance: account.balance };
      }

      const unitCredits = Math.floor(apiUsage.creditsUsed / originalOutputCount);
      const newCredits = unitCredits * normalizedCount;
      const creditDifference = newCredits - apiUsage.creditsUsed;

      const existingAdjustment = await tx.creditTransaction.findFirst({
        where: { apiUsageId, type: TransactionType.ADJUSTMENT },
      });

      if (existingAdjustment) {
        return { success: true, adjustedAmount: 0, newBalance: account.balance };
      }

      const spendTransaction = await tx.creditTransaction.findFirst({
        where: { apiUsageId, type: TransactionType.SPEND },
        orderBy: { createdAt: 'asc' },
      });

      const lotDeductions = this.extractLotDeductionsFromMetadata(spendTransaction?.metadata);
      let newBalance = account.balance;

      if (creditDifference < 0) {
        const amountToRefund = Math.abs(creditDifference);

        if (lotDeductions.length > 0) {
          const lotIds = lotDeductions
            .filter((item) => item.kind === 'lot' && !!item.lotId)
            .map((item) => item.lotId as string);

          if (lotIds.length > 0) {
            const lots = await tx.creditLot.findMany({ where: { id: { in: lotIds } } });
            const restoredLots = applyLotRestorationsToSnapshots({
              lots: lots.map((lot) => this.toCreditLotCandidate(lot)),
              deductions: lotDeductions,
            });

            for (const restoredLot of restoredLots) {
              const originalLot = lots.find((lot) => lot.id === restoredLot.id);
              if (!originalLot) continue;

              await tx.creditLot.update({
                where: { id: restoredLot.id },
                data: {
                  remainingAmount: restoredLot.remainingAmount,
                  status: restoredLot.status,
                },
              });
            }
          }
        }

        newBalance = account.balance + amountToRefund;

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
            totalSpent: Math.max(0, account.totalSpent - amountToRefund),
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.ADJUSTMENT,
            amount: amountToRefund,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: `积分调整（${apiUsage.serviceName}）：实际产出 ${normalizedCount} 张，退还 ${amountToRefund} 积分`,
            apiUsageId,
            consumePolicyCode: spendTransaction?.consumePolicyCode ?? null,
            consumePolicyVersion: spendTransaction?.consumePolicyVersion ?? null,
          },
        });

        this.logger.log(
          `[Credits] Credit adjustment (refund): apiUsageId=${apiUsageId}, originalCount=${originalOutputCount}, actualCount=${normalizedCount}, refundAmount=${amountToRefund}`
        );
      } else if (creditDifference > 0) {
        const amountToCharge = creditDifference;

        const activeLots = await tx.creditLot.findMany({
          where: { accountId: account.id, status: 'active' },
          select: {
            id: true, sourceType: true, validityType: true, scopeType: true,
            scopeValue: true, totalAmount: true, remainingAmount: true,
            grantedAt: true, activeAt: true, expiresAt: true, priority: true, status: true,
          },
        });

        const consumePolicy = await this.resolveCreditConsumePolicy(tx, {
          serviceType,
          provider: apiUsage.provider ?? null,
          model: apiUsage.model ?? null,
        });

        const deductionPlan = buildHybridCreditDeductionPlan({
          accountBalance: account.balance,
          amount: amountToCharge,
          lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
          now: new Date(),
          scope: { serviceType, provider: apiUsage.provider ?? null, model: apiUsage.model ?? null },
          policy: consumePolicy,
        });

        if (!deductionPlan.sufficient) {
          throw new BadRequestException(`积分不足，无法完成调整。当前余额: ${account.balance}，需要补扣: ${amountToCharge}`);
        }

        const updatedLots = applyLotDeductionsToSnapshots({
          lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
          deductions: deductionPlan.deductions,
        });

        for (const updatedLot of updatedLots) {
          const originalLot = activeLots.find((lot) => lot.id === updatedLot.id);
          if (!originalLot) continue;

          if (
            originalLot.remainingAmount === updatedLot.remainingAmount &&
            originalLot.status === updatedLot.status
          ) {
            continue;
          }

          await tx.creditLot.update({
            where: { id: updatedLot.id },
            data: {
              remainingAmount: updatedLot.remainingAmount,
              status: updatedLot.status,
            },
          });
        }

        newBalance = account.balance - amountToCharge;

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
            totalSpent: account.totalSpent + amountToCharge,
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.ADJUSTMENT,
            amount: -amountToCharge,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: `积分调整（${apiUsage.serviceName}）：实际产出 ${normalizedCount} 张，补扣 ${amountToCharge} 积分`,
            apiUsageId,
            consumePolicyCode: consumePolicy.code,
            consumePolicyVersion: consumePolicy.version,
            metadata: this.buildLotDeductionsMetadata(deductionPlan.deductions),
          },
        });

        this.logger.log(
          `[Credits] Credit adjustment (charge): apiUsageId=${apiUsageId}, originalCount=${originalOutputCount}, actualCount=${normalizedCount}, chargeAmount=${amountToCharge}`
        );
      }

      await tx.apiUsageRecord.update({
        where: { id: apiUsageId },
        data: {
          outputImageCount: normalizedCount,
          creditsUsed: newCredits,
        },
      });

      return { success: true, adjustedAmount: creditDifference, newBalance };
    });
  }

  /**
   * 自动处理长时间 pending 的生图调用：
   * - 标记为 failed
   * - 执行积分退款（幂等）
   */
  async autoRefundStalePendingImageUsages(options?: {
    timeoutMinutes?: number;
    batchSize?: number;
  }): Promise<{
    scanned: number;
    refunded: number;
    skippedSuccess: number;
    errors: number;
    timeoutMinutes: number;
    batchSize: number;
  }> {
    const timeoutMinutes = options?.timeoutMinutes ?? this.getStalePendingTimeoutMinutes();
    const batchSize = options?.batchSize ?? this.getStalePendingBatchSize();
    return this.autoRefundStalePendingUsagesForServiceTypes(
      STALE_PENDING_IMAGE_SERVICE_TYPES,
      timeoutMinutes,
      batchSize,
    );
  }

  /**
   * 自动处理长时间 pending 的异步视频调用：
   * - 标记为 failed
   * - 执行积分退款（幂等）
   */
  async autoRefundStalePendingVideoUsages(options?: {
    timeoutMinutes?: number;
    batchSize?: number;
  }): Promise<{
    scanned: number;
    refunded: number;
    skippedSuccess: number;
    errors: number;
    timeoutMinutes: number;
    batchSize: number;
  }> {
    const timeoutMinutes = options?.timeoutMinutes ?? this.getStalePendingVideoTimeoutMinutes();
    const batchSize = options?.batchSize ?? this.getStalePendingBatchSize();
    const cutoverAt = this.getStalePendingVideoRefundCutoverAt();
    return this.autoRefundStalePendingUsagesForServiceTypes(
      STALE_PENDING_VIDEO_SERVICE_TYPES,
      timeoutMinutes,
      batchSize,
      cutoverAt,
    );
  }

  private async autoRefundStalePendingUsagesForServiceTypes(
    serviceTypes: ServiceType[],
    timeoutMinutes: number,
    batchSize: number,
    minCreatedAt?: Date | null,
  ): Promise<{
    scanned: number;
    refunded: number;
    skippedSuccess: number;
    errors: number;
    timeoutMinutes: number;
    batchSize: number;
  }> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const createdAtFilter: Prisma.DateTimeFilter = { lt: cutoff };
    if (minCreatedAt) {
      createdAtFilter.gte = minCreatedAt;
    }

    const staleRecords = await this.prisma.apiUsageRecord.findMany({
      where: {
        responseStatus: ApiResponseStatus.PENDING,
        serviceType: { in: serviceTypes },
        createdAt: createdAtFilter,
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: {
        id: true,
        userId: true,
        serviceType: true,
        serviceName: true,
        createdAt: true,
      },
    });

    if (staleRecords.length === 0) {
      return {
        scanned: 0,
        refunded: 0,
        skippedSuccess: 0,
        errors: 0,
        timeoutMinutes,
        batchSize,
      };
    }

    let refunded = 0;
    let skippedSuccess = 0;
    let errors = 0;

    for (const record of staleRecords) {
      const processingTime = Math.max(0, Date.now() - record.createdAt.getTime());
      const timeoutMessage = `超时自动关闭：${timeoutMinutes}分钟未完成`;

      try {
        await this.markApiUsageFailedForUser(
          record.userId,
          record.id,
          timeoutMessage,
          processingTime,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('成功的 API 调用不支持退款')) {
          skippedSuccess += 1;
          continue;
        }
        errors += 1;
        this.logger.error(
          `自动退款标记失败 apiUsageId=${record.id}, serviceType=${record.serviceType}, error=${message}`,
        );
        continue;
      }

      try {
        await this.refundCredits(record.userId, record.id);
        refunded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors += 1;
        this.logger.error(
          `自动退款失败 apiUsageId=${record.id}, serviceType=${record.serviceType}, error=${message}`,
        );
      }
    }

    return {
      scanned: staleRecords.length,
      refunded,
      skippedSuccess,
      errors,
      timeoutMinutes,
      batchSize,
    };
  }

  /**
   * 管理员添加积分
   */
  async adminAddCredits(
    userId: string,
    amount: number,
    description: string,
    adminId: string,
  ): Promise<AddCreditsResult> {
    if (amount <= 0) {
      throw new BadRequestException('添加积分数量必须大于0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const newBalance = account.balance + amount;

      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + amount,
        },
      });

      const creditLot = await tx.creditLot.create({
        data: buildAdminGiftCreditLotData({
          accountId: account.id,
          amount,
          metadata: {
            adminId,
            description,
            grantedBy: 'admin_add',
          },
        }),
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.ADMIN_ADJUST,
          amount,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          creditLotId: creditLot.id,
          metadata: { adminId },
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * 管理员扣除积分
   */
  async adminDeductCredits(
    userId: string,
    amount: number,
    description: string,
    adminId: string,
  ): Promise<AddCreditsResult> {
    if (amount <= 0) {
      throw new BadRequestException('扣除积分数量必须大于0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      if (account.balance < amount) {
        throw new BadRequestException(`用户积分不足，当前余额: ${account.balance}`);
      }

      const newBalance = account.balance - amount;

      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
        },
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.ADMIN_ADJUST,
          amount: -amount,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          metadata: { adminId },
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * 获取用户交易记录
   */
  async getTransactionHistory(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      type?: TransactionType;
    } = {},
  ) {
    const { page = 1, pageSize = 20, type } = options;

    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const where: any = { accountId: account.id };
    if (type) {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.creditTransaction.count({ where }),
    ]);

    const apiUsageIds = Array.from(
      new Set(
        transactions
          .map((tx) => tx.apiUsageId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const apiUsageMap = new Map<
      string,
      {
        serviceType: string;
        provider: string | null;
        model: string | null;
        requestParams: Prisma.JsonValue | null;
        responseStatus: string;
        processingTime: number | null;
      }
    >();

    if (apiUsageIds.length > 0) {
      const apiUsages = await this.prisma.apiUsageRecord.findMany({
        where: { id: { in: apiUsageIds } },
        select: {
          id: true,
          serviceType: true,
          provider: true,
          model: true,
          requestParams: true,
          responseStatus: true,
          processingTime: true,
        },
      });

      for (const usage of apiUsages) {
        apiUsageMap.set(usage.id, usage);
      }
    }

    const enrichedTransactions = transactions.map((tx) => {
      const usage = tx.apiUsageId ? apiUsageMap.get(tx.apiUsageId) : null;
      const metadata = this.asJsonObject(tx.metadata);
      const metadataBillingRemark = this.asNonEmptyString(metadata?.billingRemark);
      const usageRequestParams = this.asJsonObject(usage?.requestParams);
      const rawParallelGroupIndex = usageRequestParams?.parallelGroupIndex;
      const rawParallelGroupTotal = usageRequestParams?.parallelGroupTotal;
      const parallelGroupIndex =
        typeof rawParallelGroupIndex === 'number'
          ? Math.trunc(rawParallelGroupIndex)
          : typeof rawParallelGroupIndex === 'string' && rawParallelGroupIndex.trim().length > 0
            ? Math.trunc(Number(rawParallelGroupIndex))
            : null;
      const parallelGroupTotal =
        typeof rawParallelGroupTotal === 'number'
          ? Math.trunc(rawParallelGroupTotal)
          : typeof rawParallelGroupTotal === 'string' && rawParallelGroupTotal.trim().length > 0
            ? Math.trunc(Number(rawParallelGroupTotal))
            : null;
      const fallbackBillingRemark =
        usage && typeof usage.serviceType === 'string'
          ? this.buildBillingRemark({
              serviceType: usage.serviceType as ServiceType,
              model: usage.model ?? undefined,
              provider: usage.provider ?? null,
              requestParams: usage.requestParams,
            })
          : null;
      return {
        ...tx,
        serviceType: usage?.serviceType ?? null,
        channel: this.extractChannelFromApiUsage(usage),
        provider: usage?.provider ?? null,
        model: usage?.model ?? null,
        billingRemark: metadataBillingRemark ?? fallbackBillingRemark,
        apiResponseStatus: usage?.responseStatus ?? null,
        processingTime: usage?.processingTime ?? null,
        parallelGroupId: this.asNonEmptyString(usageRequestParams?.parallelGroupId),
        parallelGroupIndex:
          typeof parallelGroupIndex === 'number' && Number.isFinite(parallelGroupIndex)
            ? parallelGroupIndex
            : null,
        parallelGroupTotal:
          typeof parallelGroupTotal === 'number' &&
          Number.isFinite(parallelGroupTotal) &&
          parallelGroupTotal > 0
            ? parallelGroupTotal
            : null,
      };
    });

    return {
      transactions: enrichedTransactions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 获取用户 API 使用记录
   */
  async getApiUsageHistory(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      serviceType?: string;
      provider?: string;
      status?: ApiResponseStatus;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ) {
    const { page = 1, pageSize = 20, serviceType, provider, status, startDate, endDate } = options;

    const where: any = { userId };
    if (serviceType) where.serviceType = serviceType;
    if (provider) where.provider = provider;
    if (status) where.responseStatus = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [records, total] = await Promise.all([
      this.prisma.apiUsageRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.apiUsageRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 检查用户今天是否已领取每日奖励
   */
  async canClaimDailyReward(userId: string): Promise<{
    canClaim: boolean;
    lastClaimAt: Date | null;
    tierCode: string;
    todayRewardCredits: number;
    rewardMultiplier: number;
  }> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const rewardRule = await this.resolveDailyRewardRuleForUser(this.prisma, userId);

    if (!account.lastDailyRewardAt) {
      return {
        canClaim: true,
        lastClaimAt: null,
        tierCode: rewardRule.tierCode,
        todayRewardCredits: rewardRule.baseCredits,
        rewardMultiplier: rewardRule.rewardMultiplier,
      };
    }

    const now = new Date();
    const lastClaim = new Date(account.lastDailyRewardAt);
    const isSameBusinessDay = this.diffDailyRewardBusinessDays(now, lastClaim) === 0;

    return {
      canClaim: !isSameBusinessDay,
      lastClaimAt: account.lastDailyRewardAt,
      tierCode: rewardRule.tierCode,
      todayRewardCredits: rewardRule.baseCredits,
      rewardMultiplier: rewardRule.rewardMultiplier,
    };
  }

  /**
   * 领取每日登录奖励
   * 签到积分统一进入 gift 池：普通用户会日衰减，活跃 VIP 因 pauseGiftDecay 不衰减
   * 规则：免费用户使用策略配置的签到积分；付费会员使用套餐 dailyGiftCredits 作为签到基础积分。
   * 连续签到第 7 天按倍率发放，断签或满 7 天后重置到第 1 天，不走自动每日发放。
   */
  async claimDailyReward(userId: string): Promise<AddCreditsResult & {
    alreadyClaimed?: boolean;
    expiresAt?: Date | null;
    consecutiveDays?: number;
    bonusCredits?: number;
    baseCredits?: number;
    rewardMultiplier?: number;
    tierCode?: string;
  }> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE`,
      );

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const now = new Date();
      if (account.lastDailyRewardAt) {
        const lastClaim = new Date(account.lastDailyRewardAt);
        if (this.diffDailyRewardBusinessDays(now, lastClaim) === 0) {
          return {
            success: false,
            newBalance: account.balance,
            transactionId: '',
            alreadyClaimed: true,
          };
        }
      }

      const rewardRule = await this.resolveDailyRewardRuleForUser(tx, userId);
      const expiresAt = null;

      // 计算连续签到天数
      let newConsecutiveDays = 1;
      let bonusCredits = 0;
      let rewardMultiplier = 1;

      if (account.lastCheckInDate) {
        const lastCheckIn = new Date(account.lastCheckInDate);
        const diffDays = this.diffDailyRewardBusinessDays(now, lastCheckIn);

        if (diffDays === 1) {
          // 连续签到
          if (account.consecutiveDays >= 7) {
            // 已满7天，重置到第1天
            newConsecutiveDays = 1;
          } else {
            newConsecutiveDays = account.consecutiveDays + 1;
          }
        } else if (diffDays === 0) {
          // 同一天，保持不变（理论上不会走到这里，因为 canClaim 会返回 false）
          newConsecutiveDays = account.consecutiveDays;
        }
        // diffDays > 1 表示断签，重新从1开始（默认值已经是1）
      }

      // 第7天按策略倍数发放
      if (newConsecutiveDays === 7) {
        rewardMultiplier = Math.max(1, rewardRule.rewardMultiplier);
        bonusCredits = rewardMultiplier > 1
          ? rewardRule.baseCredits * (rewardMultiplier - 1)
          : 0;
      }

      const totalCredits = rewardRule.baseCredits + bonusCredits;
      const newBalance = account.balance + totalCredits;

      // 更新账户余额、最后领取时间和连续签到天数
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + totalCredits,
          lastDailyRewardAt: now,
          lastCheckInDate: now,
          consecutiveDays: newConsecutiveDays,
        },
      });

      // 创建签到交易记录
      const description = bonusCredits > 0
        ? `连续签到第7天，按${rewardMultiplier}倍发放共${totalCredits}积分`
        : `每日签到第${newConsecutiveDays}天`;

      const creditLot = await tx.creditLot.create({
        data: buildDailyRewardCreditLotData({
          accountId: account.id,
          amount: totalCredits,
          expiresAt,
          metadata: this.getDailyRewardMetadata(
            newConsecutiveDays,
            bonusCredits,
            rewardRule.baseCredits,
            rewardMultiplier,
            rewardRule.tierCode,
          ),
        }),
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.DAILY_REWARD,
          amount: totalCredits,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          creditLotId: creditLot.id,
          expiresAt,
          metadata: this.getDailyRewardMetadata(
            newConsecutiveDays,
            bonusCredits,
            rewardRule.baseCredits,
            rewardMultiplier,
            rewardRule.tierCode,
          ),
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
        expiresAt,
        consecutiveDays: newConsecutiveDays,
        bonusCredits,
        baseCredits: rewardRule.baseCredits,
        rewardMultiplier,
        tierCode: rewardRule.tierCode,
      };
    });
  }

  /**
   * 获取用户签到日历状态（7天周期）
   * 规则：连续签到7天后重置，断签也重置
   * 日历显示：已签到(checked)、今日待签(isToday)、未来待签(其他)
   */
  async getCheckInCalendar(userId: string): Promise<{
    consecutiveDays: number;
    lastCheckInDate: Date | null;
    todayCheckedIn: boolean;
    currentBusinessDayStartAt: Date;
    calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }>;
  }> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const now = new Date();
    const todayAnchor = this.getDailyRewardBusinessDayAnchor(now);

    let todayCheckedIn = false;
    let consecutiveDays = account.consecutiveDays || 0;

    if (account.lastCheckInDate) {
      const lastCheckIn = new Date(account.lastCheckInDate);
      todayCheckedIn = this.diffDailyRewardBusinessDays(now, lastCheckIn) === 0;

      // 检查是否断签（超过1天没签到）
      const diffDays = this.diffDailyRewardBusinessDays(now, lastCheckIn);
      if (diffDays > 1) {
        // 断签了，显示为0天（但数据库中的值会在下次签到时重置）
        consecutiveDays = 0;
      }
    }

    // 构建7天日历
    const calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }> = [];

    for (let i = 1; i <= 7; i++) {
      // 已签到：第1天到第consecutiveDays天
      const checked = i <= consecutiveDays;
      // 今日待签：下一个要签到的天数（如果今天还没签到）
      const isToday = !todayCheckedIn && i === consecutiveDays + 1;

      calendarDays.push({
        day: i,
        checked,
        missed: false, // 断签会重置周期，所以当前周期内不存在漏签
        isToday,
      });
    }

    return {
      consecutiveDays,
      lastCheckInDate: account.lastCheckInDate,
      todayCheckedIn,
      currentBusinessDayStartAt: todayAnchor,
      calendarDays,
    };
  }

  /**
   * 清理过期的签到积分（定时任务调用）
   * 只清理普通用户的过期签到积分
   */
  async cleanupExpiredDailyRewards(): Promise<{ processedUsers: number; totalExpiredCredits: number }> {
    const now = new Date();
    const processedUserIds = new Set<string>();
    let totalExpiredCredits = 0;

    const expiredDailyRewardLots = await this.prisma.creditLot.findMany({
      where: {
        status: 'active',
        validityType: 'fixed_window',
        expiresAt: { lte: now },
        metadata: {
          path: ['reason'],
          equals: 'daily_reward',
        },
      },
      include: {
        account: true,
      },
      orderBy: { expiresAt: 'asc' },
    });

    for (const lot of expiredDailyRewardLots) {
      const userId = lot.account.userId;
      processedUserIds.add(userId);

      const isPaid = await this.isPaidUser(userId);
      if (isPaid) {
        await this.prisma.$transaction(async (tx) => {
          await tx.creditLot.update({
            where: { id: lot.id },
            data: {
              validityType: 'permanent',
              expiresAt: null,
            },
          });

          await tx.creditTransaction.updateMany({
            where: {
              creditLotId: lot.id,
              type: TransactionType.DAILY_REWARD,
            },
            data: {
              expiresAt: null,
              isExpired: false,
            },
          });
        });
        continue;
      }

      if (lot.remainingAmount <= 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.creditLot.update({
            where: { id: lot.id },
            data: {
              remainingAmount: 0,
              status: 'expired',
            },
          });

          await tx.creditTransaction.updateMany({
            where: {
              creditLotId: lot.id,
              type: TransactionType.DAILY_REWARD,
            },
            data: {
              isExpired: true,
              expiredAmount: 0,
            },
          });
        });
        continue;
      }

      const account = await this.prisma.creditAccount.findUnique({
        where: { id: lot.accountId },
      });

      if (!account) continue;

      const actualDeduct = Math.min(lot.remainingAmount, account.balance);

      await this.prisma.$transaction(async (tx) => {
        const newBalance = account.balance - actualDeduct;
        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
          },
        });

        await tx.creditLot.update({
          where: { id: lot.id },
          data: {
            remainingAmount: 0,
            status: 'expired',
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.EXPIRE,
            amount: -actualDeduct,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: '签到积分过期清除',
            creditLotId: lot.id,
            metadata: {
              expiredLotId: lot.id,
              originalRemainingAmount: lot.remainingAmount,
            },
          },
        });

        await tx.creditTransaction.updateMany({
          where: {
            creditLotId: lot.id,
            type: TransactionType.DAILY_REWARD,
          },
          data: {
            isExpired: true,
            expiredAmount: actualDeduct,
          },
        });
      });

      totalExpiredCredits += actualDeduct;
    }

    // 查找所有已过期但未处理的签到积分记录
    const expiredTransactions = await this.prisma.creditTransaction.findMany({
      where: {
        type: TransactionType.DAILY_REWARD,
        expiresAt: { lte: now },
        isExpired: false,
        creditLotId: null,
        amount: { gt: 0 }, // 只处理正数（获得积分的记录）
      },
      include: {
        account: true,
      },
    });

    if (expiredTransactions.length === 0) {
      return { processedUsers: processedUserIds.size, totalExpiredCredits };
    }

    // 按用户分组处理
    const userTransactions = new Map<string, typeof expiredTransactions>();
    for (const tx of expiredTransactions) {
      const userId = tx.account.userId;
      if (!userTransactions.has(userId)) {
        userTransactions.set(userId, []);
      }
      userTransactions.get(userId)!.push(tx);
    }

    let processedUsers = 0;

    for (const [userId, transactions] of userTransactions) {
      processedUserIds.add(userId);
      // 再次确认不是付费用户（双重检查）
      const isPaid = await this.isPaidUser(userId);
      if (isPaid) {
        // 付费用户：将这些记录标记为永不过期
        await this.prisma.creditTransaction.updateMany({
          where: {
            id: { in: transactions.map(t => t.id) },
          },
          data: {
            expiresAt: null,
            isExpired: false,
          },
        });
        continue;
      }

      // 计算该用户需要清除的过期积分总额
      const expiredAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

      if (expiredAmount <= 0) continue;

      // 获取用户当前余额
      const account = await this.prisma.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) continue;

      // 实际扣除的积分不能超过当前余额
      const actualDeduct = Math.min(expiredAmount, account.balance);

      if (actualDeduct > 0) {
        await this.prisma.$transaction(async (tx) => {
          // 扣除过期积分
          const newBalance = account.balance - actualDeduct;
          await tx.creditAccount.update({
            where: { id: account.id },
            data: { balance: newBalance },
          });

          // 创建过期扣除记录
          await tx.creditTransaction.create({
            data: {
              accountId: account.id,
              type: TransactionType.EXPIRE,
              amount: -actualDeduct,
              balanceBefore: account.balance,
              balanceAfter: newBalance,
              description: `签到积分过期清除（${transactions.length}笔）`,
              metadata: {
                expiredTransactionIds: transactions.map(t => t.id),
                originalExpiredAmount: expiredAmount,
              },
            },
          });

          // 标记原始交易记录为已过期
          await tx.creditTransaction.updateMany({
            where: {
              id: { in: transactions.map(t => t.id) },
            },
            data: {
              isExpired: true,
              expiredAmount: actualDeduct,
            },
          });
        });

        totalExpiredCredits += actualDeduct;
      } else {
        // 余额为0，只标记为已过期
        await this.prisma.creditTransaction.updateMany({
          where: {
            id: { in: transactions.map(t => t.id) },
          },
          data: {
            isExpired: true,
            expiredAmount: 0,
          },
        });
      }

      processedUsers++;
    }

    const totalProcessedUsers = processedUserIds.size;
    this.logger.log(`签到积分过期清理完成: 处理 ${totalProcessedUsers} 个用户, 清除 ${totalExpiredCredits} 积分`);
    return { processedUsers: totalProcessedUsers, totalExpiredCredits };
  }

  /**
   * 获取用户即将过期的签到积分信息
   */
  async getExpiringCredits(userId: string): Promise<{
    totalExpiring: number;
    expiringDetails: Array<{ amount: number; expiresAt: Date }>;
    isPaidUser: boolean;
  }> {
    const isPaid = await this.isPaidUser(userId);

    if (isPaid) {
      return { totalExpiring: 0, expiringDetails: [], isPaidUser: true };
    }

    const account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return { totalExpiring: 0, expiringDetails: [], isPaidUser: false };
    }

    const [expiringLots, expiringTransactions] = await Promise.all([
      this.prisma.creditLot.findMany({
        where: {
          accountId: account.id,
          status: 'active',
          validityType: 'fixed_window',
          expiresAt: { not: null },
          remainingAmount: { gt: 0 },
          metadata: {
            path: ['reason'],
            equals: 'daily_reward',
          },
        },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.creditTransaction.findMany({
        where: {
          accountId: account.id,
          type: TransactionType.DAILY_REWARD,
          expiresAt: { not: null },
          isExpired: false,
          creditLotId: null,
          amount: { gt: 0 },
        },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const expiringDetails = [
      ...expiringLots.map((lot) => ({
        amount: lot.remainingAmount,
        expiresAt: lot.expiresAt!,
      })),
      ...expiringTransactions.map((t) => ({
        amount: t.amount,
        expiresAt: t.expiresAt!,
      })),
    ].sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());

    const totalExpiring = expiringDetails.reduce((sum, d) => sum + d.amount, 0);

    return { totalExpiring, expiringDetails, isPaidUser: false };
  }
}
