import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { MODEL_PROVIDER_MAPPING_SETTING_KEY } from '../../ai/services/model-routing.service';
import {
  resolveManagedModelPricingV2,
  resolveManagedVendorDefaultPricing,
  resolveManagedVendorPricingV2,
  type ManagedPricingVendorLike,
} from '../../ai/services/model-pricing-resolver';

export interface NodeConfigDto {
  nodeKey: string;
  nameZh: string;
  nameEn: string;
  category?: string;
  status?: string;
  statusMessage?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder?: number;
  isVisible?: boolean;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UpdateNodeConfigDto {
  nameZh?: string;
  nameEn?: string;
  category?: string;
  status?: string;
  statusMessage?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder?: number;
  isVisible?: boolean;
  description?: string;
  metadata?: Record<string, any>;
}

interface ManagedModelConfig {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled?: boolean;
  defaultVendor?: string;
  vendors?: Array<Record<string, any>>;
  metadata?: Record<string, any>;
}

interface ModelProviderMappingV2Like {
  models?: ManagedModelConfig[];
}

export interface ManagedPricingPreviewInput {
  modelKey: string;
  vendorKey: string;
  context: Record<string, any>;
  pricing?: ManagedPricingVendorLike['pricing'];
  metadata?: Record<string, any>;
  creditsPerCall?: number;
  priceYuan?: number;
}

interface NodeConfigMetadataLike {
  modelKeys?: unknown;
  supportedModels?: unknown;
  defaultData?: unknown;
  vod?: unknown;
  managedModelKey?: unknown;
  managedRoutes?: unknown;
}

interface ManagedRouteView {
  modelKey: string;
  defaultVendor?: string;
  vendors: Array<{
    vendorKey: string;
    platformKey?: string;
    label?: string;
    provider?: string;
    route?: string;
    modelName?: string;
    modelVersion?: string;
    creditsPerCall?: number;
    priceYuan?: number;
    pricing?: Record<string, any>;
  }>;
}

const buildVodNodeMetadata = (
  base: Record<string, any>,
  vod: Record<string, any>,
  options?: {
    nodeKind?: string;
    upstreamDomain?: string;
  },
): Record<string, any> => ({
  ...base,
  nodeKind: options?.nodeKind || 'vod_video_generation',
  routeStrategy: 'model_management_v2',
  upstreamDomain: options?.upstreamDomain || 'vod.tencentcloudapi.com',
  vod,
});

const buildManagedImageNodeMetadata = (params: {
  modelKeys: string[];
  managedModelKey: string;
  defaultData?: Record<string, any>;
  nodeKind?: string;
}): Record<string, any> => ({
  modelKeys: params.modelKeys,
  managedModelKey: params.managedModelKey,
  routeStrategy: 'model_management_v2',
  nodeKind: params.nodeKind || 'ai_image_generation',
  defaultData: {
    managedModelKey: params.managedModelKey,
    ...(params.defaultData || {}),
  },
});

const SEEDANCE20_SUPPORTED_MODELS = ['seedance-1.5-pro', 'seedance-2.0', 'seedance-2.0-fast'];
const SEEDANCE20_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const SEEDANCE20_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const SEEDANCE20_RESOLUTIONS = ['480P', '720P', '1080P'];
const SEEDANCE20_INPUT_MODES = [
  'text',
  'first_frame',
  'start_end',
  'reference_images',
  'reference_video',
  'image_audio',
  'image_video',
  'video_audio',
  'image_video_audio',
];
const SEEDANCE20_NOTES = [
  '当前接入模型 ID: doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128',
  '节点采用自动模式推导：最多支持 9 张参考图，尾帧/视频/音频各 1 路，运行时按已连接输入自动确定上游 video_mode',
];

@Injectable()
export class NodeConfigService {
  private readonly logger = new Logger(NodeConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeManagedTaskType(value?: string): 'text' | 'image' | 'video' {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized === 'text' || normalized === 'input') return 'text';
    if (normalized === 'image') return 'image';
    return 'video';
  }

  private normalizeManagedNodeCategory(
    value: string | undefined,
    taskType: 'text' | 'image' | 'video',
  ): 'input' | 'image' | 'video' | 'audio' | 'other' {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (
      normalized === 'input' ||
      normalized === 'image' ||
      normalized === 'video' ||
      normalized === 'audio' ||
      normalized === 'other'
    ) {
      return normalized;
    }
    if (taskType === 'text') return 'input';
    if (taskType === 'image') return 'image';
    return 'video';
  }

  private async getEnabledManagedModelKeySet(): Promise<Set<string>> {
    const managedModelMap = await this.getManagedModelConfigMap();
    return new Set(Array.from(managedModelMap.keys()));
  }

  private async getManagedModelConfigMap(): Promise<Map<string, ManagedModelConfig>> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
      });
      const raw = setting?.value?.trim();
      if (!raw) {
        return new Map();
      }

      const parsed = JSON.parse(raw) as ModelProviderMappingV2Like;
      const models = Array.isArray(parsed?.models) ? parsed.models.filter(Boolean) : [];

      return new Map(
        models
          .filter(
            (model) =>
              model &&
              model.enabled !== false &&
              typeof model.modelKey === 'string' &&
              model.modelKey.trim(),
          )
          .map((model) => [String(model.modelKey).trim(), model] as const),
      );
    } catch (error) {
      this.logger.warn(
        `读取模型管理配置失败，节点可见性回退为不过滤: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }

  async previewManagedPricing(input: ManagedPricingPreviewInput) {
    const modelKey = String(input?.modelKey || '').trim();
    const vendorKey = String(input?.vendorKey || '').trim();
    if (!modelKey || !vendorKey) {
      throw new NotFoundException('模型或供应商不能为空');
    }

    const pricingContext =
      input.context && typeof input.context === 'object' && !Array.isArray(input.context)
        ? {
            ...input.context,
            modelKey,
            vendorKey,
          }
        : { modelKey, vendorKey };

    let resolved;
    const hasDraftPricing =
      (input.pricing && typeof input.pricing === 'object' && !Array.isArray(input.pricing)) ||
      (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) ||
      typeof input.creditsPerCall === 'number' ||
      typeof input.priceYuan === 'number';

    if (hasDraftPricing) {
      resolved = await resolveManagedVendorPricingV2(
        {
          vendorKey,
          pricing: input.pricing,
          metadata: input.metadata,
          creditsPerCall: input.creditsPerCall,
          priceYuan: input.priceYuan,
        },
        pricingContext,
      );
    } else {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
        select: { value: true },
      });
      const raw = typeof setting?.value === 'string' ? setting.value.trim() : '';
      if (!raw) {
        throw new NotFoundException('模型管理配置不存在');
      }

      const parsed = JSON.parse(raw) as ModelProviderMappingV2Like;
      resolved = await resolveManagedModelPricingV2(
        parsed,
        modelKey,
        vendorKey,
        pricingContext,
      );
    }

    return {
      modelKey,
      vendorKey,
      pricingContext,
      matchedRuleKey: resolved.ruleKey,
      label: resolved.label,
      evaluatorKey: resolved.evaluatorKey,
      evaluatorType: resolved.evaluatorType,
      pricingVersion: resolved.pricingVersion,
      price: resolved.price,
      calcTrace: resolved.calcTrace,
      source: resolved.source,
    };
  }

  private buildManagedRouteView(model: ManagedModelConfig): ManagedRouteView | null {
    const modelKey = typeof model?.modelKey === 'string' ? model.modelKey.trim() : '';
    if (!modelKey) return null;

    const vendors = Array.isArray(model.vendors)
      ? model.vendors
          .filter(
            (vendor) =>
              vendor &&
              vendor.enabled !== false &&
              typeof vendor.vendorKey === 'string' &&
              vendor.vendorKey.trim(),
          )
          .map((vendor) => {
            const resolvedPricing = resolveManagedVendorDefaultPricing(
              vendor as Record<string, any>,
            );
            const credits =
              typeof resolvedPricing.price.credits === 'number'
                ? resolvedPricing.price.credits
                : Number(vendor.creditsPerCall);
            const priceYuan =
              typeof resolvedPricing.price.priceYuan === 'number'
                ? resolvedPricing.price.priceYuan
                : Number(vendor.priceYuan);
            return {
              vendorKey: String(vendor.vendorKey).trim(),
              platformKey:
                typeof vendor.platformKey === 'string' && vendor.platformKey.trim()
                  ? vendor.platformKey.trim()
                  : undefined,
              label:
                typeof vendor.label === 'string' && vendor.label.trim()
                  ? vendor.label.trim()
                  : undefined,
              provider:
                typeof vendor.provider === 'string' && vendor.provider.trim()
                  ? vendor.provider.trim()
                  : undefined,
              route:
                typeof vendor.route === 'string' && vendor.route.trim()
                  ? vendor.route.trim()
                  : undefined,
              modelName:
                typeof vendor.modelName === 'string' && vendor.modelName.trim()
                  ? vendor.modelName.trim()
                  : undefined,
              modelVersion:
                typeof vendor.modelVersion === 'string' && vendor.modelVersion.trim()
                  ? vendor.modelVersion.trim()
                  : undefined,
              creditsPerCall:
                Number.isFinite(credits) && credits >= 0 ? credits : undefined,
              priceYuan:
                Number.isFinite(priceYuan) && priceYuan >= 0 ? priceYuan : undefined,
              pricing:
                vendor.pricing && typeof vendor.pricing === 'object'
                  ? (vendor.pricing as Record<string, any>)
                  : undefined,
            };
          })
      : [];

    return {
      modelKey,
      defaultVendor:
        typeof model.defaultVendor === 'string' && model.defaultVendor.trim()
          ? model.defaultVendor.trim()
          : undefined,
      vendors,
    };
  }

  private hasAvailableManagedModel(
    metadata: NodeConfigMetadataLike | null | undefined,
    enabledModelKeys: Set<string>,
  ): boolean {
    if (!metadata || typeof metadata !== 'object') {
      return true;
    }

    const modelKeys = Array.isArray(metadata.modelKeys)
      ? metadata.modelKeys.map((item) => String(item).trim()).filter(Boolean)
      : [];

    if (!modelKeys.length) {
      return true;
    }

    if (enabledModelKeys.size === 0) {
      return false;
    }

    return modelKeys.some((key) => enabledModelKeys.has(key));
  }

  private normalizeManagedNodeMetadata(
    nodeKey: string,
    metadata: NodeConfigMetadataLike | null | undefined,
    enabledModelKeys: Set<string>,
    managedModelMap: Map<string, ManagedModelConfig>,
  ): Record<string, any> | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return metadata as Record<string, any> | undefined;
    }

    const nextMetadata = { ...(metadata as Record<string, any>) };
    const currentModelKeys = Array.isArray(metadata.modelKeys)
      ? metadata.modelKeys.map((item) => String(item).trim()).filter(Boolean)
      : [];

    if (currentModelKeys.length > 0) {
      nextMetadata.modelKeys = currentModelKeys.filter((key) => enabledModelKeys.has(key));
    }

    const explicitManagedModelKey =
      typeof metadata.managedModelKey === 'string' ? metadata.managedModelKey.trim() : '';
    const targetManagedModelKey =
      explicitManagedModelKey && managedModelMap.has(explicitManagedModelKey)
        ? explicitManagedModelKey
        : currentModelKeys.find((key) => managedModelMap.has(key)) || '';

    if (targetManagedModelKey) {
      const managedModel = managedModelMap.get(targetManagedModelKey);
      const managedRoutes = managedModel ? this.buildManagedRouteView(managedModel) : null;
      if (managedRoutes) {
        nextMetadata.managedModelKey = targetManagedModelKey;
        nextMetadata.managedRoutes = managedRoutes;

        const selectedVendor =
          managedRoutes.vendors.find((vendor) => vendor.vendorKey === managedRoutes.defaultVendor) ||
          managedRoutes.vendors[0];

        if (selectedVendor) {
          if (
            nextMetadata.defaultData &&
            typeof nextMetadata.defaultData === 'object'
          ) {
            nextMetadata.defaultData = {
              ...(nextMetadata.defaultData as Record<string, any>),
              managedModelKey: targetManagedModelKey,
              vendorKey: selectedVendor.vendorKey,
              platformKey: selectedVendor.platformKey || selectedVendor.vendorKey,
              creditsPerCall:
                typeof selectedVendor.creditsPerCall === 'number'
                  ? selectedVendor.creditsPerCall
                  : (nextMetadata.defaultData as Record<string, any>).creditsPerCall,
            };
          }

          if (nextMetadata.vod && typeof nextMetadata.vod === 'object') {
            nextMetadata.vod = {
              ...(nextMetadata.vod as Record<string, any>),
              label:
                selectedVendor.label ||
                (nextMetadata.vod as Record<string, any>).label,
              modelName:
                selectedVendor.modelName ||
                (nextMetadata.vod as Record<string, any>).modelName,
              modelVersion:
                selectedVendor.modelVersion ||
                (nextMetadata.vod as Record<string, any>).modelVersion,
            };
          }
        }
      }
    }

    if (nodeKey === 'viduVideo') {
      const supportsQ2 = enabledModelKeys.has('vidu-q2');
      const supportsQ3Family = enabledModelKeys.has('vidu-q3');
      const supportedModels = [
        ...(supportsQ2 ? ['q2'] : []),
        ...(supportsQ3Family ? ['q3'] : []),
      ];

      nextMetadata.supportedModels = supportedModels;

      const defaultViduModel =
        supportedModels.find(Boolean) || (Array.isArray(metadata.supportedModels)
          ? metadata.supportedModels.map((item) => String(item).trim()).find(Boolean)
          : undefined);

      if (
        nextMetadata.defaultData &&
        typeof nextMetadata.defaultData === 'object' &&
        defaultViduModel
      ) {
        nextMetadata.defaultData = {
          ...(nextMetadata.defaultData as Record<string, any>),
          viduModel: defaultViduModel,
          provider:
            defaultViduModel === 'q2'
              ? 'vidu'
              : 'viduq3-pro',
        };
      }
    }

    return nextMetadata;
  }

  private normalizeNodeConfigOutput<
    T extends {
      nodeKey: string;
      serviceType?: string | null;
      creditsPerCall?: number | null;
      priceYuan?: number | null;
      description?: string | null;
      metadata?: any;
    },
  >(
    config: T,
  ): T {
    const creditsOverride = this.resolveCanonicalNodeCredits(config.nodeKey, config.serviceType);
    let normalizedConfig: T = {
      ...config,
      ...(typeof creditsOverride === 'number' ? { creditsPerCall: creditsOverride } : {}),
    };

    if (normalizedConfig.nodeKey === 'storyboardSplit') {
      normalizedConfig = {
        ...normalizedConfig,
        creditsPerCall: 0,
        priceYuan: null,
        serviceType: undefined,
        description: '将整片分镜脚本提示词拆分为单独条目',
      };
    }

    if (
      normalizedConfig.nodeKey !== 'doubaoVideo' &&
      normalizedConfig.nodeKey !== 'seedance20Video' &&
      normalizedConfig.nodeKey !== 'wan27Video'
    ) {
      return normalizedConfig;
    }

    if (normalizedConfig.nodeKey === 'wan27Video') {
      const metadata = {
        ...(normalizedConfig.metadata && typeof normalizedConfig.metadata === 'object'
          ? normalizedConfig.metadata
          : {}),
        ...buildVodNodeMetadata(
          {
            type: 'wan27Video',
            provider: 'dashscope',
            supportedModels: ['wan2.7-i2v'],
            defaultData: {
              resolution: '1080P',
              duration: 5,
              promptExtend: true,
              watermark: false,
            },
          },
          {
            label: 'DashScope Wan 2.7 I2V',
            modelName: 'Wan',
            modelVersion: '2.7-i2v',
            outputConfig: {
              durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
              resolutions: ['720P', '1080P'],
            },
            inputModes: ['text', 'first_frame', 'last_frame', 'first_clip', 'driving_audio'],
            notes: [
              '支持首帧/尾帧/首片段/驱动音频组合输入',
              '当前复用 DASHSCOPE_API_KEY 作为鉴权',
            ],
          },
          {
            nodeKind: 'dashscope_video_generation',
            upstreamDomain: 'dashscope.aliyuncs.com',
          },
        ),
      };

      return {
        ...normalizedConfig,
        description: '阿里百炼 Wan2.7 I2V 视频生成，走 DashScope 异步任务接口',
        metadata,
      };
    }

    const isSeedance20 = normalizedConfig.nodeKey === 'seedance20Video';
    const modelVersion = isSeedance20 ? '2.0' : '1.5-pro';
    const supportedModels = isSeedance20 ? SEEDANCE20_SUPPORTED_MODELS : ['seedance-1.5-pro'];
    const resolutions = isSeedance20 ? SEEDANCE20_RESOLUTIONS : ['720P'];
    const notes = isSeedance20
      ? SEEDANCE20_NOTES
      : ['1.5-Pro 当前接入默认分辨率限制为 720P'];

    const metadata = {
      ...(normalizedConfig.metadata && typeof normalizedConfig.metadata === 'object'
        ? normalizedConfig.metadata
        : {}),
      ...buildVodNodeMetadata(
        {
          type: 'doubaoVideo',
          provider: 'doubao',
          modelKeys: [isSeedance20 ? 'seedance-2.0' : 'seedance-1.5'],
          supportedModels,
          defaultData: {
            provider: 'doubao',
            seedanceModel: isSeedance20 ? 'seedance-2.0' : 'seedance-1.5-pro',
            clipDuration: 5,
            resolution: '720P',
            seedanceMode: isSeedance20 ? 'text' : undefined,
            generateAudio: isSeedance20 ? true : undefined,
            camerafixed: false,
            watermark: false,
          },
        },
        {
          label: isSeedance20 ? 'Ark Seedance 2.0' : 'Ark Seedance 1.5-Pro',
          modelName: 'Seedance',
          modelVersion,
          outputConfig: {
            aspectRatios: isSeedance20 ? SEEDANCE20_ASPECT_RATIOS : ['16:9', '9:16', '1:1'],
            durations: isSeedance20 ? SEEDANCE20_DURATIONS : [3, 4, 5, 6, 7, 8, 9, 10],
            resolutions,
            audioGeneration: isSeedance20,
          },
          inputModes: isSeedance20 ? SEEDANCE20_INPUT_MODES : ['text', 'image'],
          notes,
        },
        {
          nodeKind: 'ark_video_generation',
          upstreamDomain: 'ark.cn-beijing.volces.com',
        },
      ),
    };

    return {
      ...normalizedConfig,
      description:
        isSeedance20
          ? 'Seedance 2.0视频生成，走火山方舟模型管理'
          : 'Seedance 1.5 Pro视频，走火山方舟模型管理',
      metadata,
    };
  }

  private resolveCanonicalNodeCredits(
    nodeKey: string,
    serviceType?: string | null,
  ): number | undefined {
    if (nodeKey === 'textChat') return 2;
    if (nodeKey === 'promptOptimize') return 5;
    if (nodeKey === 'storyboardSplit') return 0;
    if (serviceType === 'gemini-text') return 2;
    if (serviceType === 'gemini-prompt-optimize') return 5;
    return undefined;
  }

  /**
   * 获取所有节点配置（公开接口，前端使用）
   */
  async getAllNodeConfigs() {
    const configs = await this.prisma.nodeConfig.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }], // 先按 sortOrder 粗排，后面再自定义分类顺序
    });
    const managedModelMap = await this.getManagedModelConfigMap();
    const enabledManagedModelKeys = new Set(Array.from(managedModelMap.keys()));

    // 自定义分类顺序：输入(input) → 图像(image) → 视频(video) → 其他(other)
    const categoryOrder: Record<string, number> = {
      input: 0,
      image: 1,
      video: 2,
      audio: 3,
      other: 4,
    };

    const sorted = configs.sort((a, b) => {
      const ca = categoryOrder[a.category ?? 'other'] ?? 99;
      const cb = categoryOrder[b.category ?? 'other'] ?? 99;
      if (ca !== cb) return ca - cb;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    const dbConfigs = sorted
      .map((config) => {
        const normalizedConfig = this.normalizeNodeConfigOutput({
          nodeKey: config.nodeKey,
          nameZh: config.nameZh,
          nameEn: config.nameEn,
          category: config.category,
          status: config.status,
          statusMessage: config.statusMessage,
          creditsPerCall: config.creditsPerCall,
          priceYuan: config.priceYuan ? Number(config.priceYuan) : null,
          serviceType: config.serviceType,
          sortOrder: config.sortOrder,
          description: config.description,
          metadata: config.metadata,
        });

        const normalizedMetadata = this.normalizeManagedNodeMetadata(
          normalizedConfig.nodeKey,
          normalizedConfig.metadata as NodeConfigMetadataLike | undefined,
          enabledManagedModelKeys,
          managedModelMap,
        );
        const managedRoutes = normalizedMetadata?.managedRoutes as ManagedRouteView | undefined;
        const selectedVendor =
          managedRoutes?.vendors?.find((vendor) => vendor.vendorKey === managedRoutes.defaultVendor) ||
          managedRoutes?.vendors?.[0];

        return {
          ...normalizedConfig,
          creditsPerCall:
            typeof selectedVendor?.creditsPerCall === 'number'
              ? selectedVendor.creditsPerCall
              : normalizedConfig.creditsPerCall,
          priceYuan:
            typeof selectedVendor?.priceYuan === 'number'
              ? selectedVendor.priceYuan
              : normalizedConfig.priceYuan,
          metadata: normalizedMetadata,
        };
      })
      .filter((config) =>
        this.hasAvailableManagedModel(
          config.metadata as NodeConfigMetadataLike | undefined,
          enabledManagedModelKeys,
        ),
      );

    return dbConfigs;
  }

  /**
   * 获取所有节点配置（管理接口，包含隐藏的）
   */
  async getAllNodeConfigsAdmin() {
    const configs = await this.prisma.nodeConfig.findMany({
      orderBy: [{ sortOrder: 'asc' }],
    });

    // 管理端同样按：输入 → 图像 → 视频 → 其他 排序
    const categoryOrder: Record<string, number> = {
      input: 0,
      image: 1,
      video: 2,
      audio: 3,
      other: 4,
    };

    const sorted = configs.sort((a, b) => {
      const ca = categoryOrder[a.category ?? 'other'] ?? 99;
      const cb = categoryOrder[b.category ?? 'other'] ?? 99;
      if (ca !== cb) return ca - cb;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    return sorted.map((config) => this.normalizeNodeConfigOutput({
      id: config.id,
      nodeKey: config.nodeKey,
      nameZh: config.nameZh,
      nameEn: config.nameEn,
      category: config.category,
      status: config.status,
      statusMessage: config.statusMessage,
      creditsPerCall: config.creditsPerCall,
      priceYuan: config.priceYuan ? Number(config.priceYuan) : null,
      serviceType: config.serviceType,
      sortOrder: config.sortOrder,
      isVisible: config.isVisible,
      description: config.description,
      metadata: config.metadata,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));
  }

  /**
   * 获取单个节点配置
   */
  async getNodeConfig(nodeKey: string) {
    const config = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
    });

    if (!config) {
      return null;
    }

    return this.normalizeNodeConfigOutput({
      id: config.id,
      nodeKey: config.nodeKey,
      nameZh: config.nameZh,
      nameEn: config.nameEn,
      category: config.category,
      status: config.status,
      statusMessage: config.statusMessage,
      creditsPerCall: config.creditsPerCall,
      priceYuan: config.priceYuan ? Number(config.priceYuan) : null,
      serviceType: config.serviceType,
      sortOrder: config.sortOrder,
      isVisible: config.isVisible,
      description: config.description,
      metadata: config.metadata,
    });
  }

  /**
   * 创建节点配置
   */
  async createNodeConfig(dto: NodeConfigDto) {
    const config = await this.prisma.nodeConfig.create({
      data: {
        nodeKey: dto.nodeKey,
        nameZh: dto.nameZh,
        nameEn: dto.nameEn,
        category: dto.category || 'other',
        status: dto.status || 'normal',
        statusMessage: dto.statusMessage,
        creditsPerCall: dto.creditsPerCall || 0,
        priceYuan: dto.priceYuan ? new Prisma.Decimal(dto.priceYuan) : null,
        serviceType: dto.serviceType,
        sortOrder: dto.sortOrder || 0,
        isVisible: dto.isVisible ?? true,
        description: dto.description,
        metadata: dto.metadata || {},
      },
    });

    this.logger.log(`创建节点配置: ${dto.nodeKey}`);
    return config;
  }

  /**
   * 更新节点配置
   */
  async updateNodeConfig(nodeKey: string, dto: UpdateNodeConfigDto) {
    const existing = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
    });

    if (!existing) {
      throw new NotFoundException(`节点配置不存在: ${nodeKey}`);
    }

    const updateData: Prisma.NodeConfigUpdateInput = {};

    if (dto.nameZh !== undefined) updateData.nameZh = dto.nameZh;
    if (dto.nameEn !== undefined) updateData.nameEn = dto.nameEn;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.statusMessage !== undefined) updateData.statusMessage = dto.statusMessage;
    if (dto.creditsPerCall !== undefined) updateData.creditsPerCall = dto.creditsPerCall;
    if (dto.priceYuan !== undefined) {
      updateData.priceYuan = dto.priceYuan ? new Prisma.Decimal(dto.priceYuan) : null;
    }
    if (dto.serviceType !== undefined) updateData.serviceType = dto.serviceType;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isVisible !== undefined) updateData.isVisible = dto.isVisible;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

    const config = await this.prisma.nodeConfig.update({
      where: { nodeKey },
      data: updateData,
    });

    this.logger.log(`更新节点配置: ${nodeKey}`);
    return config;
  }

  /**
   * 删除节点配置
   */
  async deleteNodeConfig(nodeKey: string) {
    const existing = await this.prisma.nodeConfig.findUnique({
      where: { nodeKey },
    });

    if (!existing) {
      throw new NotFoundException(`节点配置不存在: ${nodeKey}`);
    }

    await this.prisma.nodeConfig.delete({
      where: { nodeKey },
    });

    this.logger.log(`删除节点配置: ${nodeKey}`);
    return { success: true };
  }

  /**
   * 批量初始化节点配置（用于首次部署）
   */
  async initializeDefaultConfigs() {
    const defaultConfigs: NodeConfigDto[] = [
      // 输入节点 - 免费
      { nodeKey: 'textPrompt', nameZh: '提示词节点', nameEn: 'Prompt', category: 'input', sortOrder: 1, creditsPerCall: 0, description: '输入文本提示词' },
      { nodeKey: 'textPromptPro', nameZh: '高级提示词', nameEn: 'Prompt Pro', category: 'input', sortOrder: 2, creditsPerCall: 0, description: '支持多段提示词输入' },
      { nodeKey: 'image', nameZh: '图片节点', nameEn: 'Image', category: 'input', sortOrder: 3, creditsPerCall: 0, description: '上传或粘贴图片' },
      { nodeKey: 'imagePro', nameZh: '高级图片节点', nameEn: 'Image Pro', category: 'input', sortOrder: 4, creditsPerCall: 0, description: '支持多图输入' },
      { nodeKey: 'video', nameZh: '视频节点', nameEn: 'Video', category: 'input', sortOrder: 5, creditsPerCall: 0, description: '上传视频文件' },
      { nodeKey: 'textNote', nameZh: '文本便签', nameEn: 'Note', category: 'input', sortOrder: 6, creditsPerCall: 0, description: '纯文本记录' },
      { nodeKey: 'camera', nameZh: '相机节点', nameEn: 'Camera', category: 'input', sortOrder: 7, creditsPerCall: 0, description: '截取画布内容' },

      // 生图节点
      { nodeKey: 'generate', nameZh: '生成节点', nameEn: 'Generate', category: 'image', sortOrder: 10, creditsPerCall: 20, serviceType: 'gemini-2.5-image', priceYuan: 0.2, description: '文生图，按次计费' },
      { nodeKey: 'generate4', nameZh: '四图生成', nameEn: 'Generate 4', category: 'image', sortOrder: 11, creditsPerCall: 80, serviceType: 'gemini-2.5-image', priceYuan: 0.8, description: '一次生成4张图' },
      { nodeKey: 'generatePro', nameZh: '自定义节点', nameEn: 'Agent', category: 'image', sortOrder: 12, creditsPerCall: 40, serviceType: 'gemini-3-pro-image', priceYuan: 0.4, description: '高质量文生图' },
      { nodeKey: 'generatePro4', nameZh: '高级四图', nameEn: 'Generate Pro 4', category: 'image', sortOrder: 13, creditsPerCall: 160, serviceType: 'gemini-3-pro-image', priceYuan: 1.6, description: '高质量一次4张' },
      { nodeKey: 'generateReference', nameZh: '参考生成', nameEn: 'Reference', category: 'image', sortOrder: 14, creditsPerCall: 40, serviceType: 'gemini-image-blend', priceYuan: 0.4, description: '参考图生成' },
      { nodeKey: 'midjourney', nameZh: 'Midjourney', nameEn: 'Midjourney', category: 'image', sortOrder: 15, creditsPerCall: 50, serviceType: 'midjourney-imagine', priceYuan: 0.5, description: 'Midjourney生图' },
      {
        nodeKey: 'gptImage2',
        nameZh: 'Gpt-Imgae-2',
        nameEn: 'Gpt-Imgae-2',
        category: 'image',
        sortOrder: 16,
        creditsPerCall: 40,
        serviceType: 'gpt-image-2',
        priceYuan: 0.4,
        description: 'Gpt-Imgae-2，支持文生图/图生图，最多 16 张参考图',
        metadata: {
          type: 'gptImage2',
          flowNodeType: 'gptImage2',
          provider: 'nano2',
          model: 'gpt-image-2',
          aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '2:1', '1:2', '21:9', '9:21'],
          resolutions: ['1K', '2K', '4K'],
          showResolutionSelector: true,
          showGoogleSearch: false,
          showGoogleImageSearch: false,
          maxReferenceImages: 16,
          defaultData: {
            modelProvider: 'nano2',
            model: 'gpt-image-2',
            aspectRatio: '1:1',
            resolution: '1K',
            officialFallback: false,
            maxReferenceImages: 16,
            googleSearch: false,
            googleImageSearch: false,
          },
        },
      },

      // 视频生成节点
      // {
      //   nodeKey: 'klingVideo',
      //   nameZh: 'Kling视频生成',
      //   nameEn: 'Kling',
      //   category: 'video',
      //   sortOrder: 20,
      //   creditsPerCall: 600,
      //   serviceType: 'kling-video',
      //   priceYuan: 6,
      //   status: 'maintenance',
      //   statusMessage: '接口维护中',
      //   description: '可灵视频生成，按次计费',
      // },
      {
        nodeKey: 'kling26Video',
        nameZh: 'Kling 2.6视频生成',
        nameEn: 'Kling 2.6',
        category: 'video',
        sortOrder: 21,
        creditsPerCall: 600,
        serviceType: 'kling-2.6-video',
        priceYuan: 6,
        description: '可灵Kling 2.6视频生成，使用kling-v2-6模型',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'kling26Video',
              provider: 'kling',
              modelKeys: ['kling-2.6'],
              supportedModels: ['kling-v2-6'],
              defaultData: {
                provider: 'kling',
                klingModel: 'kling-v2-6',
                mode: 'std',
                sound: true,
                audioUrls: [],
                clipDuration: 5,
              },
            },
            {
              label: 'VOD Kling 2.6',
              modelName: 'Kling',
              modelVersion: '2.6',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [5, 10],
                resolutions: ['720P', '1080P'],
                audioGeneration: true,
              },
              inputModes: ['text', 'image', 'start_end'],
              notes: ['Kling 2.6 首尾帧模式仅建议在静音场景下使用'],
            },
          ),
        },
      },
      {
        nodeKey: 'kling30Video',
        nameZh: 'Kling 3.0视频生成',
        nameEn: 'Kling 3.0',
        category: 'video',
        sortOrder: 22,
        creditsPerCall: 300,
        serviceType: 'kling-3.0-video',
        priceYuan: 3,
        description: '可灵Kling 3.0视频生成（std=720P/pro=1080P，3~15s，支持多镜头分镜）',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'klingVideo',
              provider: 'kling-o3',
              modelKeys: ['kling-3.0'],
              supportedModels: ['kling-v3-0'],
              defaultData: {
                provider: 'kling-o3',
                klingModel: 'kling-v3-0',
                vendorKey: 'tencent_vod',
                platformKey: 'tencent_vod',
                managedModelKey: 'kling-3.0',
                mode: 'std',
                resolution: '720P',
                sound: true,
                audioUrls: [],
                clipDuration: 5,
                klingStoryboardMode: 'single',
              },
              billingType: 'dynamic',
              durationRange: { min: 3, max: 15 },
            },
            {
              label: 'VOD Kling 3.0',
              modelName: 'Kling',
              modelVersion: '3.0',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                resolutions: ['720P', '1080P'],
                audioGeneration: true,
              },
              inputModes: ['text', 'image'],
              notes: [
                '该节点参数按腾讯 VOD AIGC 文档约束展示',
                'std=720P，pro=1080P，时长 3~15s',
                '支持单镜头、智能分镜、自定义分镜',
                '不支持指定音色（仅有声/无声）',
              ],
            },
          ),
        },
      },
      {
        nodeKey: 'klingO1Video',
        nameZh: 'Kling 3.0-Omni视频生成',
        nameEn: 'Kling 3.0-Omni',
        category: 'video',
        sortOrder: 23,
        creditsPerCall: 1600,
        serviceType: 'kling-o1-video',
        priceYuan: 16,
        description: '可灵Kling 3.0-Omni视频生成',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'klingO1Video',
              provider: 'kling-o3',
              modelKeys: ['kling-o3'],
              supportedModels: ['kling-o3'],
              defaultData: {
                provider: 'kling-o3',
                mode: 'std',
                clipDuration: 5,
                klingStoryboardMode: 'single',
              },
              billingType: 'per_call',
              billingNote: '按次计费，16元/次',
              supportedModes: ['text2video', 'image2video', 'video_edit'],
              durationRange: { min: 3, max: 10 },
            },
            {
              label: 'VOD Kling 3.0-Omni',
              modelName: 'Kling',
              modelVersion: '3.0-Omni',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [3, 4, 5, 6, 7, 8, 9, 10],
                resolutions: ['720P', '1080P'],
                audioGeneration: true,
              },
              inputModes: ['text', 'image', 'reference_video'],
              notes: ['当前接入优先覆盖文生视频和图片参考模式'],
            },
          ),
        },
      },
      {
        nodeKey: 'viduVideo',
        nameZh: 'Vidu视频生成',
        nameEn: 'Vidu',
        category: 'video',
        sortOrder: 24,
        creditsPerCall: 600,
        serviceType: 'vidu-video',
        priceYuan: 6,
        description: 'Vidu 视频生成（统一入口，含 Q2 / Q3）',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'viduVideo',
              provider: 'vidu',
              modelKeys: ['vidu-q2', 'vidu-q3'],
              supportedModels: ['q2', 'q3'],
              defaultData: {
                provider: 'vidu',
                viduModel: 'q2',
                resolution: '720p',
                clipDuration: 5,
              },
            },
            {
              label: 'VOD Vidu',
              modelName: 'Vidu',
              modelVersion: 'q2 / q3',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '3:4', '4:3', '1:1'],
                durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
                resolutions: ['540P', '720P', '1080P'],
              },
              inputModes: ['text', 'image', 'reference'],
              notes: ['Q2 / Q3 统一收拢到同一个 Vidu 节点'],
            },
          ),
        },
      },
      {
        nodeKey: 'doubaoVideo',
        nameZh: 'Seedance 1.5 Pro视频生成',
        nameEn: 'Seedance 1.5 Pro',
        category: 'video',
        sortOrder: 29,
        creditsPerCall: 600,
        serviceType: 'doubao-video',
        priceYuan: 6,
        description: 'Seedance 1.5 Pro视频，走火山方舟模型管理',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'doubaoVideo',
              provider: 'doubao',
              modelKeys: ['seedance-1.5'],
              supportedModels: ['seedance-1.5-pro'],
              defaultData: {
                provider: 'doubao',
                seedanceModel: 'seedance-1.5-pro',
                clipDuration: 5,
                resolution: '720P',
              },
            },
            {
              label: 'Ark Seedance 1.5-Pro',
              modelName: 'Seedance',
              modelVersion: '1.5-pro',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [4, 5, 6, 7, 8, 9, 10, 11, 12],
                resolutions: ['720P'],
              },
              inputModes: ['text', 'image'],
              notes: ['1.5-Pro 当前接入默认分辨率限制为 720P'],
            },
            {
              nodeKind: 'ark_video_generation',
              upstreamDomain: 'ark.cn-beijing.volces.com',
            },
          ),
        },
      },
      {
        nodeKey: 'seedance20Video',
        nameZh: 'Seedance 2.0视频生成',
        nameEn: 'Seedance 2.0',
        category: 'video',
        sortOrder: 30,
        creditsPerCall: 600,
        serviceType: 'doubao-video',
        priceYuan: 6,
        description: 'Seedance 2.0视频生成，走火山方舟模型管理',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'doubaoVideo',
              provider: 'doubao',
              modelKeys: ['seedance-2.0'],
              supportedModels: SEEDANCE20_SUPPORTED_MODELS,
              defaultData: {
                provider: 'doubao',
                seedanceModel: 'seedance-2.0',
                clipDuration: 5,
                resolution: '720P',
                seedanceMode: 'text',
                generateAudio: true,
              },
            },
            {
              label: 'Ark Seedance 2.0',
              modelName: 'Seedance',
              modelVersion: '2.0',
              outputConfig: {
                aspectRatios: SEEDANCE20_ASPECT_RATIOS,
                durations: SEEDANCE20_DURATIONS,
                resolutions: SEEDANCE20_RESOLUTIONS,
                audioGeneration: true,
              },
              inputModes: SEEDANCE20_INPUT_MODES,
              notes: SEEDANCE20_NOTES,
            },
            {
              nodeKind: 'ark_video_generation',
              upstreamDomain: 'ark.cn-beijing.volces.com',
            },
          ),
        },
      },
      {
        nodeKey: 'sora2Video',
        nameZh: 'Sora2 Pro视频生成',
        nameEn: 'Sora2 Pro',
        category: 'video',
        status: 'normal',
        sortOrder: 31,
        creditsPerCall: 900,
        serviceType: 'sora-sd',
        priceYuan: 9,
        description: 'OpenAI Sora2 Pro 视频，支持腾讯 VOD 路由',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'sora2Video',
              provider: 'sora2',
              modelKeys: ['sora-2'],
              supportedModels: ['sora-2', 'sora-2-pro'],
              defaultData: {
                generationType: 'sora2',
                model: 'sora-2-pro',
                clipDuration: 10,
                aspectRatio: '16:9',
                watermark: false,
                thumbnailEnabled: true,
                privateMode: false,
                storyboard: false,
              },
              billingType: 'by_model',
              modelPricing: {
                'sora-2': { credits: 200, priceYuan: 2 },
                'sora-2-vip': { credits: 200, priceYuan: 2 },
                'sora-2-pro': { credits: 750, priceYuan: 7.5 },
              },
            },
            {
              label: 'VOD Sora2 (OS)',
              modelName: 'OS',
              modelVersion: '2.0',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [5, 10, 15],
                resolutions: ['720P', '1080P'],
                audioGeneration: true,
              },
              inputModes: ['text', 'image'],
              notes: [
                '使用腾讯云 VOD OS（Open-Sora）模型生成视频',
                '支持文生视频和图生视频模式',
                '视频时长支持 5/10/15 秒',
              ],
            },
          ),
        },
      },
      {
        nodeKey: 'sora2Character',
        nameZh: 'Sora2角色生成',
        nameEn: 'Sora2 Character',
        category: 'video',
        status: 'normal',
        sortOrder: 32,
        creditsPerCall: 0,
        description: '从视频中提取角色，供 Sora2 Pro 复用',
      },
      {
        nodeKey: 'wan26',
        nameZh: 'Wan2.6视频',
        nameEn: 'Wan2.6',
        category: 'video',
        sortOrder: 33,
        creditsPerCall: 600,
        serviceType: 'wan26-video',
        priceYuan: 6,
        description: '阿里Wan2.6视频生成',
      },
      {
        nodeKey: 'wan2R2V',
        nameZh: 'Wan2参考视频',
        nameEn: 'Wan2 Reference Video',
        category: 'video',
        sortOrder: 34,
        creditsPerCall: 600,
        serviceType: 'wan26-r2v',
        priceYuan: 6,
        description: '参考视频生成',
      },
      {
        nodeKey: 'wan27Video',
        nameZh: 'Wan2.7视频生成',
        nameEn: 'Wan2.7 I2V',
        category: 'video',
        sortOrder: 35,
        creditsPerCall: 600,
        serviceType: 'wan27-video',
        priceYuan: 6,
        description: '阿里百炼 Wan2.7 I2V 视频生成',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'wan27Video',
              provider: 'dashscope',
              supportedModels: ['wan2.7-i2v'],
              defaultData: {
                resolution: '1080P',
                duration: 5,
                promptExtend: true,
                watermark: false,
              },
            },
            {
              label: 'DashScope Wan 2.7 I2V',
              modelName: 'Wan',
              modelVersion: '2.7-i2v',
              outputConfig: {
                durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                resolutions: ['720P', '1080P'],
              },
              inputModes: ['text', 'first_frame', 'last_frame', 'first_clip', 'driving_audio'],
              notes: ['支持图像、视频片段、音频混合输入'],
            },
            {
              nodeKind: 'dashscope_video_generation',
              upstreamDomain: 'dashscope.aliyuncs.com',
            },
          ),
        },
      },
      {
        nodeKey: 'happyhorseR2V',
        nameZh: '快乐马',
        nameEn: 'HappyHorse',
        category: 'video',
        sortOrder: 36,
        creditsPerCall: 600, // fallback；实际按 perSecondByResolution 动态计算
        serviceType: 'happyhorse-r2v-video',
        priceYuan: 6, // 5s/720P 节点默认档
        description: '阿里 HappyHorse 多图参考视频生成',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'happyhorseR2V',
              provider: 'dashscope',
              supportedModels: [
                'happyhorse-1.0-t2v',
                'happyhorse-1.0-i2v',
                'happyhorse-1.0-r2v',
                'happyhorse-1.0-video-edit',
              ],
              defaultData: {
                resolution: '720P',
                ratio: '16:9',
                duration: 5,
                watermark: false,
                referenceCount: 1,
              },
            },
            {
              label: 'DashScope HappyHorse',
              modelName: 'HappyHorse',
              modelVersion: '1.0-r2v',
              outputConfig: {
                durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                resolutions: ['720P', '1080P'],
              },
              inputModes: ['reference_image_1_to_9'],
              notes: ['1~9 张参考图，prompt 用 character1/character2... 占位指代'],
            },
            {
              nodeKind: 'dashscope_video_generation',
              upstreamDomain: 'dashscope.aliyuncs.com',
            },
          ),
        },
      },

      // 其他节点
      { nodeKey: 'videoAnalyze', nameZh: '视频分析节点', nameEn: 'Video Analysis', category: 'other', sortOrder: 30, creditsPerCall: 30, serviceType: 'gemini-video-analyze', priceYuan: 0.3, description: '分析视频内容' },
      { nodeKey: 'videoFrameExtract', nameZh: '视频帧提取', nameEn: 'Frame Extract', category: 'other', sortOrder: 31, creditsPerCall: 0, description: '从视频提取帧，免费' },
      { nodeKey: 'videoToGif', nameZh: '视频转GIF', nameEn: 'Video to GIF', category: 'other', sortOrder: 32, creditsPerCall: 30, serviceType: 'video-to-gif', priceYuan: 0.3, description: '将视频片段转换为GIF' },
      {
        nodeKey: 'analysis',
        nameZh: '图像分析节点',
        nameEn: 'Analysis',
        category: 'other',
        sortOrder: 33,
        creditsPerCall: 10,
        serviceType: 'gemini-2.5-image-analyze',
        priceYuan: 0.1,
        description: '分析图像内容',
        metadata: buildManagedImageNodeMetadata({
          modelKeys: ['gemini-2.5-image-analyze', 'gemini-image-analyze', 'gemini-3.1-image-analyze'],
          managedModelKey: 'gemini-2.5-image-analyze',
          defaultData: {
            creditsPerCall: 10,
          },
          nodeKind: 'ai_image_analysis',
        }),
      },
      { nodeKey: 'promptOptimize', nameZh: '提示词优化', nameEn: 'Optimize', category: 'other', sortOrder: 34, creditsPerCall: 5, serviceType: 'gemini-prompt-optimize', priceYuan: 0.02, description: 'AI优化提示词' },
      { nodeKey: 'textChat', nameZh: '文字对话', nameEn: 'Chat', category: 'other', sortOrder: 35, creditsPerCall: 2, serviceType: 'gemini-text', priceYuan: 0.02, description: 'AI文字对话' },
      { nodeKey: 'storyboardSplit', nameZh: '分镜拆解', nameEn: 'Storyboard', category: 'other', sortOrder: 36, creditsPerCall: 0, description: '将整片分镜脚本提示词拆分为单独条目' },
      { nodeKey: 'imageGrid', nameZh: '图片拼接', nameEn: 'Grid', category: 'other', sortOrder: 37, creditsPerCall: 0, description: '拼接多张图片，免费' },
      { nodeKey: 'imageSplit', nameZh: '图片拆分', nameEn: 'Split', category: 'other', sortOrder: 38, creditsPerCall: 0, description: '拆分图片，免费' },
      { nodeKey: 'imageCompress', nameZh: '图片压缩', nameEn: 'Image Compress', category: 'other', sortOrder: 39, creditsPerCall: 0, description: '按档位压缩图片，免费' },
      { nodeKey: 'three', nameZh: '2D转3D', nameEn: '2D to 3D', category: 'other', sortOrder: 40, creditsPerCall: 200, serviceType: 'convert-2d-to-3d', priceYuan: 2, description: '图片转3D模型' },
      { nodeKey: 'minimaxSpeech', nameZh: 'MiniMax语音合成', nameEn: 'MiniMax Speech', category: 'audio', sortOrder: 41, creditsPerCall: 10, serviceType: 'minimax-speech', priceYuan: 0.1, description: 'MiniMax Speech 语音合成' },
      { nodeKey: 'tencentSpeech', nameZh: '腾讯语音合成', nameEn: 'Tencent Speech', category: 'audio', sortOrder: 42, creditsPerCall: 10, serviceType: 'tencent-speech', priceYuan: 0.1, description: '腾讯 MPS AI 配音语音合成' },
      { nodeKey: 'minimaxMusic', nameZh: 'MiniMax音乐生成', nameEn: 'MiniMax Music', category: 'audio', sortOrder: 43, creditsPerCall: 30, serviceType: 'minimax-music', priceYuan: 0.3, description: 'MiniMax 音乐生成' },
    ];

    let created = 0;
    let skipped = 0;

    for (const config of defaultConfigs) {
      const existing = await this.prisma.nodeConfig.findUnique({
        where: { nodeKey: config.nodeKey },
      });

      if (!existing) {
        await this.createNodeConfig(config);
        created++;
      } else {
        skipped++;
      }
    }

    this.logger.log(`节点配置初始化完成: 创建 ${created} 个, 跳过 ${skipped} 个`);
    return { created, skipped };
  }

  /**
   * 强制同步所有节点配置（覆盖已存在的配置）
   */
  async syncAllConfigs() {
    const defaultConfigs = await this.getDefaultConfigs();

    let created = 0;
    let updated = 0;

    for (const config of defaultConfigs) {
      const existing = await this.prisma.nodeConfig.findUnique({
        where: { nodeKey: config.nodeKey },
      });

      if (!existing) {
        await this.createNodeConfig(config);
        created++;
      } else {
        // 更新已存在的配置
        await this.prisma.nodeConfig.update({
          where: { nodeKey: config.nodeKey },
          data: {
            nameZh: config.nameZh,
            nameEn: config.nameEn,
            category: config.category || 'other',
            status: config.status || 'normal',
            statusMessage: config.statusMessage,
            creditsPerCall: config.creditsPerCall || 0,
            priceYuan: config.priceYuan ? new Prisma.Decimal(config.priceYuan) : null,
            serviceType: config.serviceType,
            sortOrder: config.sortOrder || 0,
            description: config.description,
            metadata: config.metadata || {},
          },
        });
        updated++;
      }
    }

    this.logger.log(`节点配置同步完成: 创建 ${created} 个, 更新 ${updated} 个`);
    return { created, updated };
  }

  /**
   * 获取默认配置列表
   */
  private async getDefaultConfigs(): Promise<NodeConfigDto[]> {
    return [
      // 输入节点 - 免费
      { nodeKey: 'textPrompt', nameZh: '提示词节点', nameEn: 'Prompt', category: 'input', sortOrder: 1, creditsPerCall: 0, description: '输入文本提示词' },
      { nodeKey: 'textPromptPro', nameZh: '高级提示词', nameEn: 'Prompt Pro', category: 'input', sortOrder: 2, creditsPerCall: 0, description: '支持多段提示词输入' },
      { nodeKey: 'image', nameZh: '图片节点', nameEn: 'Image', category: 'input', sortOrder: 3, creditsPerCall: 0, description: '上传或粘贴图片' },
      { nodeKey: 'imagePro', nameZh: '高级图片节点', nameEn: 'Image Pro', category: 'input', sortOrder: 4, creditsPerCall: 0, description: '支持多图输入' },
      { nodeKey: 'video', nameZh: '视频节点', nameEn: 'Video', category: 'input', sortOrder: 5, creditsPerCall: 0, description: '上传视频文件' },
      { nodeKey: 'textNote', nameZh: '文本便签', nameEn: 'Note', category: 'input', sortOrder: 6, creditsPerCall: 0, description: '纯文本记录' },
      { nodeKey: 'camera', nameZh: '相机节点', nameEn: 'Camera', category: 'input', sortOrder: 7, creditsPerCall: 0, description: '截取画布内容' },

      // 生图节点
      { nodeKey: 'generate', nameZh: '生成节点', nameEn: 'Generate', category: 'image', sortOrder: 10, creditsPerCall: 20, serviceType: 'gemini-2.5-image', priceYuan: 0.2, description: '文生图，按次计费' },
      { nodeKey: 'generate4', nameZh: '四图生成', nameEn: 'Generate 4', category: 'image', sortOrder: 11, creditsPerCall: 80, serviceType: 'gemini-2.5-image', priceYuan: 0.8, description: '一次生成4张图' },
      { nodeKey: 'generatePro', nameZh: '自定义节点', nameEn: 'Agent', category: 'image', sortOrder: 12, creditsPerCall: 40, serviceType: 'gemini-3-pro-image', priceYuan: 0.4, description: '高质量文生图' },
      { nodeKey: 'generatePro4', nameZh: '高级四图', nameEn: 'Generate Pro 4', category: 'image', sortOrder: 13, creditsPerCall: 160, serviceType: 'gemini-3-pro-image', priceYuan: 1.6, description: '高质量一次4张' },
      { nodeKey: 'generateReference', nameZh: '参考生成', nameEn: 'Reference', category: 'image', sortOrder: 14, creditsPerCall: 40, serviceType: 'gemini-image-blend', priceYuan: 0.4, description: '参考图生成' },
      { nodeKey: 'midjourney', nameZh: 'Midjourney', nameEn: 'Midjourney', category: 'image', sortOrder: 15, creditsPerCall: 50, serviceType: 'midjourney-imagine', priceYuan: 0.5, description: 'Midjourney生图' },
      {
        nodeKey: 'gptImage2',
        nameZh: 'Gpt-Imgae-2',
        nameEn: 'Gpt-Imgae-2',
        category: 'image',
        sortOrder: 16,
        creditsPerCall: 40,
        serviceType: 'gpt-image-2',
        priceYuan: 0.4,
        description: 'Gpt-Imgae-2 生图，支持文生图/图生图，最多 16 张参考图',
        metadata: {
          type: 'gptImage2',
          flowNodeType: 'gptImage2',
          provider: 'nano2',
          model: 'gpt-image-2',
          aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '2:1', '1:2', '21:9', '9:21'],
          resolutions: ['1K', '2K', '4K'],
          showResolutionSelector: true,
          showGoogleSearch: false,
          showGoogleImageSearch: false,
          maxReferenceImages: 16,
          defaultData: {
            modelProvider: 'nano2',
            model: 'gpt-image-2',
            aspectRatio: '1:1',
            resolution: '1K',
            officialFallback: false,
            maxReferenceImages: 16,
            googleSearch: false,
            googleImageSearch: false,
          },
        },
      },

      // 视频生成节点
      // {
      //   nodeKey: 'klingVideo',
      //   nameZh: 'Kling视频生成',
      //   nameEn: 'Kling',
      //   category: 'video',
      //   sortOrder: 20,
      //   creditsPerCall: 600,
      //   serviceType: 'kling-video',
      //   priceYuan: 6,
      //   status: 'maintenance',
      //   statusMessage: '接口维护中',
      //   description: '可灵视频生成，按次计费',
      // },
      {
        nodeKey: 'kling26Video',
        nameZh: 'Kling 2.6视频生成',
        nameEn: 'Kling 2.6',
        category: 'video',
        sortOrder: 21,
        creditsPerCall: 600,
        serviceType: 'kling-2.6-video',
        priceYuan: 6,
        description: '可灵Kling 2.6视频生成，使用kling-v2-6模型',
        metadata: {
          type: 'kling26Video',
          provider: 'kling',
          modelKeys: ['kling-2.6'],
          supportedModels: ['kling-v2-6'],
          defaultData: {
            provider: 'kling',
            klingModel: 'kling-v2-6',
            mode: 'std',
            sound: true,
            audioUrls: [],
          },
        },
      },
      {
        nodeKey: 'kling30Video',
        nameZh: 'Kling 3.0视频生成',
        nameEn: 'Kling 3.0',
        category: 'video',
        sortOrder: 22,
        creditsPerCall: 300,
        serviceType: 'kling-3.0-video',
        priceYuan: 3,
        description: '可灵Kling 3.0视频生成（std=720P/pro=1080P，3~15s，支持多镜头分镜）',
        metadata: {
          type: 'klingVideo',
          provider: 'kling-o3',
          modelKeys: ['kling-3.0'],
          supportedModels: ['kling-v3-0'],
          billingType: 'dynamic',
          durationRange: { min: 3, max: 15 },
          defaultData: {
            provider: 'kling-o3',
            klingModel: 'kling-v3-0',
            vendorKey: 'tencent_vod',
            platformKey: 'tencent_vod',
            managedModelKey: 'kling-3.0',
            mode: 'std',
            resolution: '720P',
            sound: true,
            audioUrls: [],
            clipDuration: 5,
            klingStoryboardMode: 'single',
          },
        },
      },
      {
        nodeKey: 'klingO1Video',
        nameZh: 'Kling 3.0-Omni视频生成',
        nameEn: 'Kling 3.0-Omni',
        category: 'video',
        sortOrder: 23,
        creditsPerCall: 1600,
        serviceType: 'kling-o1-video',
        priceYuan: 16,
        description: '可灵Kling 3.0-Omni视频生成',
        metadata: {
          type: 'klingO1Video',
          provider: 'kling-o3',
          modelKeys: ['kling-o3'],
          supportedModels: ['kling-o3'],
          defaultData: {
            provider: 'kling-o3',
            mode: 'std',
            clipDuration: 5,
            klingStoryboardMode: 'single',
          },
          billingType: 'per_call',
          billingNote: '按次计费，16元/次',
          supportedModes: ['text2video', 'image2video', 'video_edit'],
          durationRange: { min: 3, max: 10 },
        },
      },
      {
        nodeKey: 'viduVideo',
        nameZh: 'Vidu视频生成',
        nameEn: 'Vidu',
        category: 'video',
        sortOrder: 24,
        creditsPerCall: 600,
        serviceType: 'vidu-video',
        priceYuan: 6,
        description: 'Vidu 视频生成（统一入口，含 Q2 / Q3 / Q3-Mix）',
        metadata: {
          type: 'viduVideo',
          provider: 'vidu',
          modelKeys: ['vidu-q2', 'vidu-q3'],
          supportedModels: ['q2', 'q3'],
          defaultData: {
            provider: 'vidu',
            viduModel: 'q2',
            resolution: '720p',
            style: 'general',
            offPeak: false,
          },
        },
      },
      {
        nodeKey: 'doubaoVideo',
        nameZh: 'Seedance 1.5 Pro视频生成',
        nameEn: 'Seedance 1.5 Pro',
        category: 'video',
        sortOrder: 29,
        creditsPerCall: 600,
        serviceType: 'doubao-video',
        priceYuan: 6,
        description: 'Seedance 1.5 Pro视频，走火山方舟模型管理',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'doubaoVideo',
              provider: 'doubao',
              modelKeys: ['seedance-1.5'],
              supportedModels: ['seedance-1.5-pro'],
              defaultData: {
                provider: 'doubao',
                seedanceModel: 'seedance-1.5-pro',
                camerafixed: false,
                watermark: false,
              },
            },
            {
              label: 'Ark Seedance 1.5-Pro',
              modelName: 'Seedance',
              modelVersion: '1.5-pro',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [4, 5, 6, 7, 8, 9, 10, 11, 12],
                resolutions: ['720P'],
              },
              inputModes: ['text', 'image'],
              notes: ['1.5-Pro 当前接入默认分辨率限制为 720P'],
            },
            {
              nodeKind: 'ark_video_generation',
              upstreamDomain: 'ark.cn-beijing.volces.com',
            },
          ),
        },
      },
      {
        nodeKey: 'seedance20Video',
        nameZh: 'Seedance 2.0视频生成',
        nameEn: 'Seedance 2.0',
        category: 'video',
        sortOrder: 30,
        creditsPerCall: 600,
        serviceType: 'doubao-video',
        priceYuan: 6,
        description: 'Seedance 2.0视频生成，走火山方舟模型管理',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'doubaoVideo',
              provider: 'doubao',
              modelKeys: ['seedance-2.0'],
              supportedModels: SEEDANCE20_SUPPORTED_MODELS,
              defaultData: {
                provider: 'doubao',
                seedanceModel: 'seedance-2.0',
                clipDuration: 5,
                resolution: '720P',
                seedanceMode: 'text',
                generateAudio: true,
                camerafixed: false,
                watermark: false,
              },
            },
            {
              label: 'Ark Seedance 2.0',
              modelName: 'Seedance',
              modelVersion: '2.0',
              outputConfig: {
                aspectRatios: SEEDANCE20_ASPECT_RATIOS,
                durations: SEEDANCE20_DURATIONS,
                resolutions: SEEDANCE20_RESOLUTIONS,
                audioGeneration: true,
              },
              inputModes: SEEDANCE20_INPUT_MODES,
              notes: SEEDANCE20_NOTES,
            },
            {
              nodeKind: 'ark_video_generation',
              upstreamDomain: 'ark.cn-beijing.volces.com',
            },
          ),
        },
      },
      {
        nodeKey: 'sora2Video',
        nameZh: 'Sora2 Pro视频生成',
        nameEn: 'Sora2 Pro',
        category: 'video',
        status: 'normal',
        sortOrder: 31,
        creditsPerCall: 900,
        serviceType: 'sora-sd',
        priceYuan: 9,
        description: 'OpenAI Sora2 Pro 视频，支持腾讯 VOD 路由',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'sora2Video',
              provider: 'sora2',
              modelKeys: ['sora-2'],
              supportedModels: ['sora-2', 'sora-2-pro'],
              defaultData: {
                generationType: 'sora2',
                model: 'sora-2-pro',
                clipDuration: 10,
                aspectRatio: '16:9',
                watermark: false,
                thumbnailEnabled: true,
                privateMode: false,
                storyboard: false,
              },
              billingType: 'by_model',
              modelPricing: {
                'sora-2': { credits: 200, priceYuan: 2 },
                'sora-2-vip': { credits: 200, priceYuan: 2 },
                'sora-2-pro': { credits: 750, priceYuan: 7.5 },
              },
            },
            {
              label: 'VOD Sora2 (OS)',
              modelName: 'OS',
              modelVersion: '2.0',
              outputConfig: {
                aspectRatios: ['16:9', '9:16', '1:1'],
                durations: [5, 10, 15],
                resolutions: ['720P', '1080P'],
                audioGeneration: true,
              },
              inputModes: ['text', 'image'],
              notes: [
                '使用腾讯云 VOD OS（Open-Sora）模型生成视频',
                '支持文生视频和图生视频模式',
                '视频时长支持 5/10/15 秒',
              ],
            },
          ),
        },
      },
      {
        nodeKey: 'sora2Character',
        nameZh: 'Sora2角色生成',
        nameEn: 'Sora2 Character',
        category: 'video',
        status: 'normal',
        sortOrder: 32,
        creditsPerCall: 0,
        description: '从视频中提取角色，供 Sora2 Pro 复用',
      },
      {
        nodeKey: 'wan26',
        nameZh: 'Wan2.6视频',
        nameEn: 'Wan2.6',
        category: 'video',
        sortOrder: 33,
        creditsPerCall: 600,
        serviceType: 'wan26-video',
        priceYuan: 6,
        description: '阿里Wan2.6视频生成',
      },
      {
        nodeKey: 'wan2R2V',
        nameZh: 'Wan2参考视频',
        nameEn: 'Wan2 Reference Video',
        category: 'video',
        sortOrder: 34,
        creditsPerCall: 600,
        serviceType: 'wan26-r2v',
        priceYuan: 6,
        description: '参考视频生成',
      },
      {
        nodeKey: 'wan27Video',
        nameZh: 'Wan2.7视频生成',
        nameEn: 'Wan2.7 I2V',
        category: 'video',
        sortOrder: 35,
        creditsPerCall: 600,
        serviceType: 'wan27-video',
        priceYuan: 6,
        description: '阿里百炼 Wan2.7 I2V 视频生成',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'wan27Video',
              provider: 'dashscope',
              supportedModels: ['wan2.7-i2v'],
              defaultData: {
                resolution: '1080P',
                duration: 5,
                promptExtend: true,
                watermark: false,
              },
            },
            {
              label: 'DashScope Wan 2.7 I2V',
              modelName: 'Wan',
              modelVersion: '2.7-i2v',
              outputConfig: {
                durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                resolutions: ['720P', '1080P'],
              },
              inputModes: ['text', 'first_frame', 'last_frame', 'first_clip', 'driving_audio'],
              notes: ['支持图像、视频片段、音频混合输入'],
            },
            {
              nodeKind: 'dashscope_video_generation',
              upstreamDomain: 'dashscope.aliyuncs.com',
            },
          ),
        },
      },
      {
        nodeKey: 'happyhorseR2V',
        nameZh: '快乐马',
        nameEn: 'HappyHorse',
        category: 'video',
        sortOrder: 36,
        creditsPerCall: 600, // fallback；实际按 perSecondByResolution 动态计算
        serviceType: 'happyhorse-r2v-video',
        priceYuan: 6, // 5s/720P 节点默认档
        description: '阿里 HappyHorse 多图参考视频生成',
        metadata: {
          ...buildVodNodeMetadata(
            {
              type: 'happyhorseR2V',
              provider: 'dashscope',
              supportedModels: [
                'happyhorse-1.0-t2v',
                'happyhorse-1.0-i2v',
                'happyhorse-1.0-r2v',
                'happyhorse-1.0-video-edit',
              ],
              defaultData: {
                resolution: '720P',
                ratio: '16:9',
                duration: 5,
                watermark: false,
                referenceCount: 1,
              },
            },
            {
              label: 'DashScope HappyHorse',
              modelName: 'HappyHorse',
              modelVersion: '1.0-r2v',
              outputConfig: {
                durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                resolutions: ['720P', '1080P'],
              },
              inputModes: ['reference_image_1_to_9'],
              notes: ['1~9 张参考图，prompt 用 character1/character2... 占位指代'],
            },
            {
              nodeKind: 'dashscope_video_generation',
              upstreamDomain: 'dashscope.aliyuncs.com',
            },
          ),
        },
      },

      // 其他节点
      { nodeKey: 'videoAnalyze', nameZh: '视频分析节点', nameEn: 'Video Analysis', category: 'other', sortOrder: 30, creditsPerCall: 30, serviceType: 'gemini-video-analyze', priceYuan: 0.3, description: '分析视频内容' },
      { nodeKey: 'videoFrameExtract', nameZh: '视频帧提取', nameEn: 'Frame Extract', category: 'other', sortOrder: 31, creditsPerCall: 0, description: '从视频提取帧，免费' },
      { nodeKey: 'videoToGif', nameZh: '视频转GIF', nameEn: 'Video to GIF', category: 'other', sortOrder: 32, creditsPerCall: 30, serviceType: 'video-to-gif', priceYuan: 0.3, description: '将视频片段转换为GIF' },
      {
        nodeKey: 'analysis',
        nameZh: '图像分析节点',
        nameEn: 'Analysis',
        category: 'other',
        sortOrder: 33,
        creditsPerCall: 10,
        serviceType: 'gemini-2.5-image-analyze',
        priceYuan: 0.1,
        description: '分析图像内容',
        metadata: buildManagedImageNodeMetadata({
          modelKeys: ['gemini-2.5-image-analyze', 'gemini-image-analyze', 'gemini-3.1-image-analyze'],
          managedModelKey: 'gemini-2.5-image-analyze',
          defaultData: {
            creditsPerCall: 10,
          },
          nodeKind: 'ai_image_analysis',
        }),
      },
      { nodeKey: 'promptOptimize', nameZh: '提示词优化', nameEn: 'Optimize', category: 'other', sortOrder: 34, creditsPerCall: 5, serviceType: 'gemini-prompt-optimize', priceYuan: 0.02, description: 'AI优化提示词' },
      { nodeKey: 'textChat', nameZh: '文字对话', nameEn: 'Chat', category: 'other', sortOrder: 35, creditsPerCall: 2, serviceType: 'gemini-text', priceYuan: 0.02, description: 'AI文字对话' },
      { nodeKey: 'storyboardSplit', nameZh: '分镜拆解', nameEn: 'Storyboard', category: 'other', sortOrder: 36, creditsPerCall: 0, description: '将整片分镜脚本提示词拆分为单独条目' },
      { nodeKey: 'imageGrid', nameZh: '图片拼接', nameEn: 'Grid', category: 'other', sortOrder: 37, creditsPerCall: 0, description: '拼接多张图片，免费' },
      { nodeKey: 'imageSplit', nameZh: '图片拆分', nameEn: 'Split', category: 'other', sortOrder: 38, creditsPerCall: 0, description: '拆分图片，免费' },
      { nodeKey: 'imageCompress', nameZh: '图片压缩', nameEn: 'Image Compress', category: 'other', sortOrder: 39, creditsPerCall: 0, description: '按档位压缩图片，免费' },
      { nodeKey: 'three', nameZh: '2D转3D', nameEn: '2D to 3D', category: 'other', sortOrder: 40, creditsPerCall: 200, serviceType: 'convert-2d-to-3d', priceYuan: 2, description: '图片转3D模型' },
      { nodeKey: 'minimaxSpeech', nameZh: 'MiniMax语音合成', nameEn: 'MiniMax Speech', category: 'audio', sortOrder: 41, creditsPerCall: 10, serviceType: 'minimax-speech', priceYuan: 0.1, description: 'MiniMax Speech 语音合成' },
      { nodeKey: 'tencentSpeech', nameZh: '腾讯语音合成', nameEn: 'Tencent Speech', category: 'audio', sortOrder: 42, creditsPerCall: 10, serviceType: 'tencent-speech', priceYuan: 0.1, description: '腾讯 MPS AI 配音语音合成' },
      { nodeKey: 'minimaxMusic', nameZh: 'MiniMax音乐生成', nameEn: 'MiniMax Music', category: 'audio', sortOrder: 43, creditsPerCall: 30, serviceType: 'minimax-music', priceYuan: 0.3, description: 'MiniMax 音乐生成' },
    ];
  }

  /**
   * 根据 serviceType 获取积分消耗
   */
  async getCreditsForService(serviceType: string): Promise<number | null> {
    const config = await this.prisma.nodeConfig.findFirst({
      where: { serviceType },
    });
    return config?.creditsPerCall ?? null;
  }
}
