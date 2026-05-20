import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto, TemplateQueryDto } from '../dto/template.dto';
import { OssService } from '../../oss/oss.service';
import { sanitizeDesignJson } from '../../utils/designJsonSanitizer';

const sanitizeNullableString = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const sanitized = sanitizeDesignJson(value);
  return typeof sanitized === 'string' ? sanitized : null;
};

@Injectable()
export class TemplateService {
  private static readonly FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';

  constructor(private readonly prisma: PrismaService, private readonly oss: OssService) {}

  private isVipOnlyTemplate(tags?: string[] | null): boolean {
    if (!Array.isArray(tags) || tags.length === 0) {
      return false;
    }

    const normalizedTags = tags
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean);

    return normalizedTags.some((tag) => tag === 'vip' || tag === 'vip-only' || tag === '仅vip');
  }

  private normalizeTemplateLibraryAccess(value: unknown): 'basic' | 'full' {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      normalized === 'full' ||
      normalized === 'all' ||
      normalized === '全部开放' ||
      normalized === '全部'
    ) {
      return 'full';
    }
    return 'basic';
  }

  private async getFreeTierTemplateLibraryAccess(): Promise<'basic' | 'full'> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: TemplateService.FREE_TIER_BENEFITS_SETTING_KEY },
      select: { value: true },
    });
    if (!setting?.value) {
      return 'basic';
    }

    try {
      const parsed = JSON.parse(setting.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return this.normalizeTemplateLibraryAccess(
          (parsed as Record<string, unknown>).templateLibraryAccess,
        );
      }
    } catch {
      return 'basic';
    }

    return 'basic';
  }

  private async resolveUserTemplateLibraryAccess(userId: string): Promise<'basic' | 'full'> {
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
      return this.getFreeTierTemplateLibraryAccess();
    }

    const plan = await this.prisma.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
      select: { metadata: true },
    });

    if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
      return this.normalizeTemplateLibraryAccess(
        (plan.metadata as Record<string, unknown>).templateLibraryAccess,
      );
    }

    return 'basic';
  }

  async canUserUseTemplate(templateId: string, userId: string): Promise<boolean> {
    const template = await this.prisma.publicTemplate.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        tags: true,
      },
    });

    if (!template) {
      throw new NotFoundException('模板不存在');
    }

    if (!this.isVipOnlyTemplate(template.tags)) {
      return true;
    }

    return (await this.resolveUserTemplateLibraryAccess(userId)) === 'full';
  }

  async createTemplate(dto: CreateTemplateDto, createdBy?: string) {
    let templateData = dto.templateData;
    if (!templateData && dto.templateJsonKey) {
      // 从 OSS 拉取 JSON 内容
      const json = await this.oss.getJSON(dto.templateJsonKey);
      if (!json) {
        throw new Error(`无法从 OSS 读取模板 JSON 文件: ${dto.templateJsonKey}`);
      }
      templateData = json;
    }
    // 只有当既没有 templateData 也没有 templateJsonKey 时才设为空对象
    if (
      (templateData === undefined || templateData === null) &&
      !dto.templateJsonKey
    ) {
      templateData = {};
    }
    if (templateData) {
      templateData = sanitizeDesignJson(templateData);
    }

    // 名称默认为 "未命名模板"
    const name = dto.name?.trim() || '未命名模板';

    return this.prisma.publicTemplate.create({
      data: {
        name,
        category: dto.category,
        description: dto.description,
        tags: dto.tags || [],
        thumbnail: sanitizeNullableString(dto.thumbnail),
        thumbnailSmall: sanitizeNullableString((dto as any).thumbnailSmall),
        templateData,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdBy,
        updatedBy: createdBy,
      },
    });
  }

  async getTemplates(query: TemplateQueryDto) {
    const { page = 1, pageSize = 10, category, isActive, search } = query;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (typeof isActive === 'boolean') {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [search] } },
      ];
    }

    const [templates, total] = await Promise.all([
      this.prisma.publicTemplate.findMany({
        where,
        orderBy: [
          { updatedAt: 'desc' },
        ],
        skip,
        take: pageSize,
      }),
      this.prisma.publicTemplate.count({ where }),
    ]);

    return {
      items: templates,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getTemplateById(id: string) {
    const template = await this.prisma.publicTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('模板不存在');
    }

    return template;
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto, updatedBy?: string) {
    const template = await this.getTemplateById(id);
    let resolvedTemplateData = dto.templateData;
    if (resolvedTemplateData === undefined && (dto as any).templateJsonKey) {
      const json = await this.oss.getJSON((dto as any).templateJsonKey);
      resolvedTemplateData = json ?? undefined;
    }
    if (resolvedTemplateData !== undefined) {
      resolvedTemplateData = sanitizeDesignJson(resolvedTemplateData);
    }

    return this.prisma.publicTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.thumbnail !== undefined && { thumbnail: sanitizeNullableString(dto.thumbnail) }),
        ...((dto as any).thumbnailSmall !== undefined && { thumbnailSmall: sanitizeNullableString((dto as any).thumbnailSmall) }),
        ...(resolvedTemplateData !== undefined && { templateData: resolvedTemplateData }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        updatedBy,
      },
    });
  }

  async deleteTemplate(id: string) {
    const template = await this.getTemplateById(id);

    await this.prisma.publicTemplate.delete({
      where: { id },
    });

    return { success: true };
  }

  async getTemplateCategories() {
    // 优先从系统设置中读取持久化的分类列表
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'template_categories' } });
    if (setting && setting.value) {
      try {
        const list = JSON.parse(setting.value);
        if (Array.isArray(list)) {
          const filtered = list.filter(Boolean);
          // 将"其他"分类固定在末尾
          const other = filtered.filter((c: string) => c === '其他');
          const rest = filtered.filter((c: string) => c !== '其他').sort();
          return [...rest, ...other];
        }
      } catch (e) {
        // ignore parse error and fallback
      }
    }

    // fallback: 从现有模板中收集分类
    const categories = await this.prisma.publicTemplate.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ['category'],
    });

    const cats = categories.map(c => c.category).filter(Boolean);
    // 将"其他"分类固定在末尾
    const other = cats.filter(c => c === '其他');
    const rest = cats.filter(c => c !== '其他').sort();
    return [...rest, ...other];
  }

  async getActiveTemplatesForFrontend() {
    const templates = await this.prisma.publicTemplate.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        tags: true,
        thumbnail: true,
        thumbnailSmall: true,
      },
      orderBy: [
        { createdAt: 'desc' },
      ],
    });

    return templates.map(template => ({
      id: template.id,
      name: template.name,
      category: template.category,
      description: template.description,
      tags: template.tags,
      thumbnail: template.thumbnail,
      thumbnailSmall: template.thumbnailSmall,
    }));
  }
}
