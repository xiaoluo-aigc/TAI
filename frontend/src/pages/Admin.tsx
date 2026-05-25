import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { authApi } from "@/services/authApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithAuth } from "@/services/authFetch";
import {
  getDashboardStats,
  getUsers,
  getApiUsageStats,
  getApiUsageRecords,
  addCredits,
  deductCredits,
  deleteUserAccount,
  unbindUserWechat,
  updateUserStatus,
  updateUserRole,
  getSettings,
  getSetting,
  upsertSetting,
  previewManagedPricing,
  getMembershipCreditPolicy,
  updateMembershipCreditPolicy,
  getAdminMembershipPlans,
  createAdminMembershipPlan,
  updateAdminMembershipPlan,
  getAdminUserMembershipState,
  getAdminUserMembershipTransitionPreview,
  adminExpireUserMembershipNow,
  adminAdjustUserMembershipPeriod,
  adminChangeUserMembershipPlan,
  adminApplyScheduledMembershipChanges,
  adminExpireMembershipScan,
  adminIssueDailyMembershipGifts,
  adminDecayMembershipGifts,
  adminRefreshYearlyMembershipQuota,
  getWatermarkWhitelist,
  addToWatermarkWhitelist,
  removeFromWatermarkWhitelist,
  getPaidUsers,
  getCreditChangeRecords,
  getAdminUserCreditTransactions,
  getCreditAnomalyRecords,
  getNodeConfigs,
  updateNodeConfig,
  createNodeConfig,
  deleteNodeConfig,
  type DashboardStats,
  type UserWithCredits,
  type ApiUsageStats,
  type ApiUsageRecord,
  type Pagination,
  type SystemSetting,
  type ManagedPricingPreviewResponse,
  type MembershipCreditPolicyConfig,
  type MembershipCreditPolicyView,
  type AdminMembershipPlan,
  type AdminMembershipStateResponse,
  type WatermarkWhitelistUser,
  type PaidUser,
  type PaidUsersSortBy,
  type CreditChangeRecord,
  type AdminUserCreditTransaction,
  type CreditAnomalyRecord,
  type NodeConfig,
  listVolcReviewGroups,
  cleanupVolcReviewGroup,
} from "@/services/adminApi";
import { notifyNodeConfigsUpdated } from "@/services/nodeConfigService";
import {
  fetchTemplates,
  fetchTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  fetchTemplateCategories,
} from "@/services/publicTemplateService";
import type { PublicTemplate } from "@/services/publicTemplateService";
import { OpenObserveLogButton } from "@/components/admin/OpenObserveLogButton";

const FULL_ADMIN_ROLE = "admin";
const NORMAL_ADMIN_ROLE = "normal_admin";

type AdminTabKey =
  | "dashboard"
  | "users"
  | "paid-users"
  | "credit-records"
  | "credit-anomalies"
  | "api-stats"
  | "api-records"
  | "watermark"
  | "node-configs"
  | "settings"
  | "templates"
  | "volc-review";

const NORMAL_ADMIN_ALLOWED_TABS = new Set<AdminTabKey>([
  "dashboard",
  "users",
  "api-stats",
  "api-records",
  "watermark",
  "templates",
]);

const normalizeRole = (role?: string | null) => (role || "").trim().toLowerCase();

const canAccessAdminPanel = (role?: string | null) => {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === FULL_ADMIN_ROLE || normalizedRole === NORMAL_ADMIN_ROLE;
};

const isFullAdmin = (role?: string | null) => normalizeRole(role) === FULL_ADMIN_ROLE;

const canAccessAdminTab = (role: string | null | undefined, tab: AdminTabKey) => {
  if (isFullAdmin(role)) return true;
  return normalizeRole(role) === NORMAL_ADMIN_ROLE && NORMAL_ADMIN_ALLOWED_TABS.has(tab);
};

// 统计卡片组件
function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className='bg-white rounded-lg border p-4 shadow-sm'>
      <div className='text-sm text-gray-500'>{title}</div>
      <div className='text-2xl font-bold mt-1'>{value}</div>
      {subtitle && <div className='text-xs text-gray-400 mt-1'>{subtitle}</div>}
    </div>
  );
}

function DashboardTrendChart({
  data,
}: {
  data: DashboardStats["userTrend"];
}) {
  if (!data || data.length === 0) {
    return <div className='text-sm text-gray-400 py-8 text-center'>暂无趋势数据</div>;
  }

  const maxValue = Math.max(
    ...data.map((item) => Math.max(item.registeredUsers, item.dailyActiveUsers)),
    1
  );
  const midValue = Math.max(1, Math.round(maxValue / 2));

  const toPoints = (key: "registeredUsers" | "dailyActiveUsers") =>
    data
      .map((item, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * 100;
        const y = 100 - (item[key] / maxValue) * 100;
        return `${x},${y}`;
      })
      .join(" ");

  const regPoints = toPoints("registeredUsers");
  const dauPoints = toPoints("dailyActiveUsers");

  return (
    <div>
      <div className='flex items-center gap-5 text-xs text-gray-600 mb-3'>
        <div className='flex items-center gap-2'>
          <span className='w-2.5 h-2.5 rounded-full bg-blue-500' />
          <span>注册用户</span>
        </div>
        <div className='flex items-center gap-2'>
          <span className='w-2.5 h-2.5 rounded-full bg-emerald-500' />
          <span>日活用户</span>
        </div>
      </div>
      <div className='grid grid-cols-[38px_1fr] gap-2'>
        <div className='relative h-44 text-[11px] text-gray-400 leading-none select-none'>
          <span className='absolute left-0 top-0'>{maxValue}</span>
          <span className='absolute left-0 top-1/2 -translate-y-1/2'>{midValue}</span>
          <span className='absolute left-0 bottom-0'>0</span>
        </div>
        <div className='relative h-44'>
          <svg width='100%' height='100%' viewBox='0 0 100 100' preserveAspectRatio='none'>
            <line x1='0' y1='100' x2='100' y2='100' stroke='#e5e7eb' strokeWidth='0.6' />
            <line x1='0' y1='66.6' x2='100' y2='66.6' stroke='#f3f4f6' strokeWidth='0.5' />
            <line x1='0' y1='33.3' x2='100' y2='33.3' stroke='#f3f4f6' strokeWidth='0.5' />

            <polyline
              fill='none'
              stroke='#3b82f6'
              strokeWidth='2'
              points={regPoints}
              vectorEffect='non-scaling-stroke'
            />
            <polyline
              fill='none'
              stroke='#10b981'
              strokeWidth='2'
              points={dauPoints}
              vectorEffect='non-scaling-stroke'
            />
          </svg>
          <div className='absolute bottom-0 left-0 right-0 flex justify-between text-[11px] text-gray-400'>
            <span>{data[0]?.date}</span>
            <span>{data[Math.floor(data.length / 2)]?.date}</span>
            <span>{data[data.length - 1]?.date}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const MODEL_PROVIDER_MAPPING_SETTING_KEY = "model_provider_mapping_v2";
type ModelVendorRouteType = "legacy" | "tencent_vod";
type ManagedModelTaskType = "text" | "image" | "video";

interface ManagedVendorPlatformConfig {
  platformKey: string;
  platformName?: string;
  enabled?: boolean;
  route?: ModelVendorRouteType;
  provider?: string;
  description?: string;
  metadata?: Record<string, any>;
}

interface ManagedModelVendorConfig {
  vendorKey: string;
  platformKey?: string;
  label?: string;
  enabled?: boolean;
  route?: ModelVendorRouteType;
  provider?: string;
  creditsPerCall?: number;
  priceYuan?: number;
  modelName?: string;
  modelVersion?: string;
  pricing?: {
    version?: string;
    dimensions?: Array<
      | string
      | {
          key: string;
          label?: string;
          type?: "string" | "number" | "boolean" | "enum";
          required?: boolean;
          options?: Array<{
            value: string | number | boolean;
            label?: string;
          }>;
          description?: string;
        }
    >;
    defaults?: {
      credits?: number;
      priceYuan?: number;
      costYuan?: number;
    };
    rules?: Array<{
      ruleKey?: string;
      label?: string;
      priority?: number;
      when?: Record<string, any>;
      match?: Record<string, any>;
      price?: {
        credits?: number;
        priceYuan?: number;
        costYuan?: number;
      };
      creditsPerCall?: number;
      priceYuan?: number;
      costYuan?: number;
    }>;
    matchingRules?: Array<{
      ruleKey?: string;
      label?: string;
      enabled?: boolean;
      priority?: number;
      evaluatorKey?: string;
      conditions?: {
        all?: Array<{
          field?: string;
          op?: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
          value?: unknown;
        }>;
        any?: Array<{
          field?: string;
          op?: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
          value?: unknown;
        }>;
      };
    }>;
    evaluators?: Record<
      string,
      {
        type?: "fixed" | "linear" | "base_plus_linear" | "lookup_matrix";
        priceYuan?: number;
        credits?: number;
        costYuan?: number;
        unitField?: string;
        unitPriceYuan?: number;
        basePriceYuan?: number;
        includedUnits?: number;
        extraUnitPriceYuan?: number;
        axes?: string[];
        matrix?: Record<string, unknown>;
      }
    >;
    displayConfig?: {
      specAxes?: string[];
      labels?: Record<string, string>;
      presets?: Array<Record<string, string | number | boolean>>;
      defaultSelections?: Record<string, string | number | boolean>;
    };
  };
  metadata?: Record<string, any>;
}

interface ManagedModelConfig {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled?: boolean;
  defaultVendor?: string;
  vendors?: ManagedModelVendorConfig[];
  metadata?: Record<string, any>;
}

interface ManagedModelNodeConfig {
  enabled?: boolean;
  nodeKey?: string;
  flowNodeType?: string;
  category?: "input" | "image" | "video";
  creditsPerCall?: number;
  sortOrder?: number;
  description?: string;
}

interface ModelProviderMappingV2 {
  version?: string;
  platforms?: ManagedVendorPlatformConfig[];
  models?: ManagedModelConfig[];
}

const getManagedVendorStateKey = (
  model?: Pick<ManagedModelConfig, "modelKey"> | null,
  vendor?: Pick<ManagedModelVendorConfig, "vendorKey"> | null,
  vendorIndex?: number
) => {
  const modelKey = String(model?.modelKey || "").trim() || "unknown-model";
  const resolvedVendorKey = String(vendor?.vendorKey || "").trim() || `vendor-${vendorIndex ?? 0}`;
  return `${modelKey}::${resolvedVendorKey}::${vendorIndex ?? 0}`;
};

type ManagedSpecPricingRule = {
  ruleKey?: string;
  label?: string;
  match?: Record<string, any>;
  priority?: number;
  creditsPerCall?: number;
  priceYuan?: number;
  costYuan?: number;
};

type ManagedPricingDimensionDefinition = {
  key: string;
  label?: string;
  type?: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  options?: Array<{
    value: string | number | boolean;
    label?: string;
  }>;
  description?: string;
};

type ManagedPricingConditionRow = {
  field: string;
  op: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "exists";
  value: string | number | boolean | Array<string | number | boolean>;
};

type ManagedPricingMatchingRule = {
  ruleKey: string;
  label: string;
  enabled: boolean;
  priority: number;
  evaluatorKey: string;
  conditions: {
    all: ManagedPricingConditionRow[];
    any: ManagedPricingConditionRow[];
  };
};

type ManagedPricingEvaluator =
  | {
      type: "fixed";
      priceYuan?: number;
      credits?: number;
      costYuan?: number;
    }
  | {
      type: "linear";
      unitField?: string;
      unitPriceYuan?: number;
      costYuan?: number;
    }
  | {
      type: "base_plus_linear";
      basePriceYuan?: number;
      includedUnits?: number;
      unitField?: string;
      extraUnitPriceYuan?: number;
      costYuan?: number;
    }
  | {
      type: "lookup_matrix";
      axes?: string[];
      matrix?: Record<string, unknown>;
      costYuan?: number;
    };

type ManagedPricingV2View = {
  version: string;
  dimensions: ManagedPricingDimensionDefinition[];
  matchingRules: ManagedPricingMatchingRule[];
  evaluators: Record<string, ManagedPricingEvaluator>;
  displayConfig: {
    specAxes: string[];
    labels: Record<string, string>;
    presets: Array<Record<string, string | number | boolean>>;
    defaultSelections: Record<string, string | number | boolean>;
  };
};

const normalizeFiniteNumber = (value: unknown): number | undefined => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const resolvePricingV2DefaultBundle = (
  vendor?: Partial<ManagedModelVendorConfig>
): { credits?: number; priceYuan?: number } | undefined => {
  const pricing =
    vendor?.pricing && typeof vendor.pricing === "object" ? vendor.pricing : undefined;
  const matchingRules = Array.isArray(pricing?.matchingRules) ? pricing.matchingRules : [];
  const evaluators =
    pricing?.evaluators && typeof pricing.evaluators === "object" ? pricing.evaluators : undefined;
  const context =
    pricing?.displayConfig &&
    typeof pricing.displayConfig === "object" &&
    !Array.isArray(pricing.displayConfig) &&
    pricing.displayConfig.defaultSelections &&
    typeof pricing.displayConfig.defaultSelections === "object" &&
    !Array.isArray(pricing.displayConfig.defaultSelections)
      ? (pricing.displayConfig.defaultSelections as Record<string, string | number | boolean>)
      : undefined;

  if (!context || matchingRules.length === 0 || !evaluators || Object.keys(evaluators).length === 0) {
    return undefined;
  }

  const matchCondition = (condition?: { field?: string; op?: string; value?: unknown }) => {
    const field = String(condition?.field || "").trim();
    if (!field) return false;
    const actual = context[field];
    const op = condition?.op || "eq";
    if (op === "exists") return actual !== undefined && actual !== null && actual !== "";
    if (actual === undefined) return false;
    if (op === "in") {
      const list = Array.isArray(condition?.value) ? condition.value : [];
      return list.some((item) => item === actual);
    }
    if (op === "eq") return condition?.value === actual;
    const actualNumber = normalizeFiniteNumber(actual);
    const expectedNumber = normalizeFiniteNumber(condition?.value);
    if (actualNumber === undefined || expectedNumber === undefined) return false;
    if (op === "gt") return actualNumber > expectedNumber;
    if (op === "gte") return actualNumber >= expectedNumber;
    if (op === "lt") return actualNumber < expectedNumber;
    if (op === "lte") return actualNumber <= expectedNumber;
    return false;
  };

  const matchedRule = [...matchingRules]
    .filter((rule) => rule && rule.enabled !== false && rule.evaluatorKey)
    .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0))
    .find((rule) => {
      const all = Array.isArray(rule.conditions?.all) ? rule.conditions.all : [];
      const any = Array.isArray(rule.conditions?.any) ? rule.conditions.any : [];
      const allMatched = all.every((condition) => matchCondition(condition));
      const anyMatched = any.length === 0 || any.some((condition) => matchCondition(condition));
      return allMatched && anyMatched;
    });

  if (!matchedRule) return undefined;
  const evaluator =
    matchedRule.evaluatorKey && evaluators[matchedRule.evaluatorKey]
      ? evaluators[matchedRule.evaluatorKey]
      : undefined;
  if (!evaluator) return undefined;

  if (evaluator.type === "fixed") {
    const priceYuan = normalizeFiniteNumber(evaluator.priceYuan);
    const credits =
      normalizeFiniteNumber(evaluator.credits) ??
      (priceYuan !== undefined ? Math.ceil(priceYuan * 100) : undefined);
    if (priceYuan === undefined && credits === undefined) return undefined;
    return {
      ...(credits !== undefined ? { credits } : {}),
      ...(priceYuan !== undefined ? { priceYuan } : {}),
    };
  }

  if (evaluator.type === "linear") {
    const unitField = String(evaluator.unitField || "").trim();
    const unitValue = normalizeFiniteNumber(context[unitField]);
    const unitPriceYuan = normalizeFiniteNumber(evaluator.unitPriceYuan);
    if (!unitField || unitValue === undefined || unitPriceYuan === undefined) return undefined;
    const priceYuan = Number((unitValue * unitPriceYuan).toFixed(3));
    return { priceYuan, credits: Math.ceil(priceYuan * 100) };
  }

  return undefined;
};

const getVendorPricingDefaults = (vendor?: Partial<ManagedModelVendorConfig>) => {
  const defaults =
    vendor?.pricing &&
    typeof vendor.pricing === "object" &&
    vendor.pricing.defaults &&
    typeof vendor.pricing.defaults === "object"
      ? vendor.pricing.defaults
      : undefined;

  const credits =
    typeof defaults?.credits === "number" && Number.isFinite(defaults.credits)
      ? defaults.credits
      : typeof vendor?.creditsPerCall === "number" && Number.isFinite(vendor.creditsPerCall)
      ? vendor.creditsPerCall
      : undefined;
  const priceYuan =
    typeof defaults?.priceYuan === "number" && Number.isFinite(defaults.priceYuan)
      ? defaults.priceYuan
      : typeof vendor?.priceYuan === "number" && Number.isFinite(vendor.priceYuan)
      ? vendor.priceYuan
      : undefined;

  const derived = credits === undefined && priceYuan === undefined ? resolvePricingV2DefaultBundle(vendor) : undefined;

  return {
    ...(credits !== undefined ? { credits } : derived?.credits !== undefined ? { credits: derived.credits } : {}),
    ...(priceYuan !== undefined ? { priceYuan } : derived?.priceYuan !== undefined ? { priceYuan: derived.priceYuan } : {}),
  };
};

const updateVendorPricingDefaults = (
  vendor: ManagedModelVendorConfig,
  patch: { credits?: number; priceYuan?: number }
): ManagedModelVendorConfig => {
  const currentPricing =
    vendor.pricing && typeof vendor.pricing === "object" ? { ...vendor.pricing } : {};
  const nextDefaults =
    currentPricing.defaults && typeof currentPricing.defaults === "object"
      ? { ...currentPricing.defaults }
      : {};

  if ("credits" in patch) {
    const credits = normalizeFiniteNumber(patch.credits);
    if (credits !== undefined && credits >= 0) {
      nextDefaults.credits = credits;
    } else {
      delete nextDefaults.credits;
    }
  }

  if ("priceYuan" in patch) {
    const priceYuan = normalizeFiniteNumber(patch.priceYuan);
    if (priceYuan !== undefined && priceYuan >= 0) {
      nextDefaults.priceYuan = priceYuan;
    } else {
      delete nextDefaults.priceYuan;
    }
  }

  const nextPricing =
    Object.keys(nextDefaults).length > 0
      ? {
          ...currentPricing,
          version: currentPricing.version || "v1",
          defaults: nextDefaults,
        }
      : Object.keys(currentPricing).length > 0
      ? {
          ...currentPricing,
          defaults: undefined,
        }
      : undefined;

  return {
    ...vendor,
    ...(patch.credits !== undefined ? { creditsPerCall: normalizeFiniteNumber(patch.credits) } : {}),
    ...(patch.priceYuan !== undefined ? { priceYuan: normalizeFiniteNumber(patch.priceYuan) } : {}),
    pricing:
      nextPricing && Object.keys(nextPricing).some((key) => (nextPricing as any)[key] !== undefined)
        ? nextPricing
        : undefined,
  };
};

const readVendorSpecPricingRules = (
  vendor?: ManagedModelVendorConfig
): ManagedSpecPricingRule[] => {
  const pricingRules =
    vendor?.pricing &&
    typeof vendor.pricing === "object" &&
    Array.isArray(vendor.pricing.rules)
      ? vendor.pricing.rules
      : [];
  if (pricingRules.length > 0) {
    return pricingRules
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        ruleKey: typeof item.ruleKey === "string" ? item.ruleKey : "",
        label: typeof item.label === "string" ? item.label : "",
        priority:
          typeof item.priority === "number" && Number.isFinite(item.priority)
            ? item.priority
            : undefined,
        match:
          item.when && typeof item.when === "object" && !Array.isArray(item.when)
            ? { ...item.when }
            : item.match && typeof item.match === "object" && !Array.isArray(item.match)
            ? { ...item.match }
            : {},
        creditsPerCall:
          typeof item.price?.credits === "number" && Number.isFinite(item.price.credits)
            ? item.price.credits
            : typeof item.creditsPerCall === "number" && Number.isFinite(item.creditsPerCall)
            ? item.creditsPerCall
            : 0,
        priceYuan:
          typeof item.price?.priceYuan === "number" && Number.isFinite(item.price.priceYuan)
            ? item.price.priceYuan
            : typeof item.priceYuan === "number" && Number.isFinite(item.priceYuan)
            ? item.priceYuan
            : undefined,
        costYuan:
          typeof item.price?.costYuan === "number" && Number.isFinite(item.price.costYuan)
            ? item.price.costYuan
            : typeof item.costYuan === "number" && Number.isFinite(item.costYuan)
            ? item.costYuan
            : undefined,
      }));
  }

  const legacyRules = Array.isArray(vendor?.metadata?.specPricing) ? vendor?.metadata?.specPricing : [];
  return legacyRules
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ruleKey: typeof item.ruleKey === "string" ? item.ruleKey : "",
      label: typeof item.label === "string" ? item.label : "",
      match:
        item.match && typeof item.match === "object" && !Array.isArray(item.match)
          ? { ...item.match }
          : {},
      creditsPerCall:
        typeof item.creditsPerCall === "number" && Number.isFinite(item.creditsPerCall)
          ? item.creditsPerCall
          : 0,
      priceYuan:
        typeof item.priceYuan === "number" && Number.isFinite(item.priceYuan)
          ? item.priceYuan
          : undefined,
      costYuan:
        typeof item.costYuan === "number" && Number.isFinite(item.costYuan)
          ? item.costYuan
          : undefined,
    }));
};

const writeVendorSpecPricingRules = (
  vendor: ManagedModelVendorConfig,
  rules: ManagedSpecPricingRule[]
): ManagedModelVendorConfig => {
  const cleanedRules = rules
    .map((rule, index) => ({
      ruleKey: String(rule.ruleKey || "").trim() || `rule_${index + 1}`,
      label: String(rule.label || "").trim(),
      priority:
        typeof rule.priority === "number" && Number.isFinite(rule.priority)
          ? rule.priority
          : undefined,
      when:
        rule.match && typeof rule.match === "object" && !Array.isArray(rule.match)
          ? Object.fromEntries(
              Object.entries(rule.match).filter(([, value]) => {
                if (typeof value === "string") return value.trim().length > 0;
                return value !== undefined && value !== null && value !== "";
              })
            )
          : {},
      price: {
        ...(typeof rule.creditsPerCall === "number" && Number.isFinite(rule.creditsPerCall)
          ? { credits: rule.creditsPerCall }
          : {}),
        ...(typeof rule.priceYuan === "number" && Number.isFinite(rule.priceYuan)
          ? { priceYuan: rule.priceYuan }
          : {}),
        ...(typeof rule.costYuan === "number" && Number.isFinite(rule.costYuan)
          ? { costYuan: rule.costYuan }
          : {}),
      },
      creditsPerCall:
        typeof rule.creditsPerCall === "number" && Number.isFinite(rule.creditsPerCall)
          ? rule.creditsPerCall
          : undefined,
      priceYuan:
        typeof rule.priceYuan === "number" && Number.isFinite(rule.priceYuan)
          ? rule.priceYuan
          : undefined,
      costYuan:
        typeof rule.costYuan === "number" && Number.isFinite(rule.costYuan)
          ? rule.costYuan
          : undefined,
    }))
    .filter((rule) => Object.keys(rule.when).length > 0);

  const nextMetadata =
    vendor.metadata && typeof vendor.metadata === "object" ? { ...vendor.metadata } : {};
  if (cleanedRules.length > 0) {
    nextMetadata.specPricing = cleanedRules.map((rule) => ({
      ruleKey: rule.ruleKey,
      label: rule.label,
      match: rule.when,
      creditsPerCall: rule.creditsPerCall,
      priceYuan: rule.priceYuan,
      costYuan: rule.costYuan,
    }));
  } else {
    delete nextMetadata.specPricing;
  }

  const nextPricing =
    vendor.pricing && typeof vendor.pricing === "object" ? { ...vendor.pricing } : {};
  if (cleanedRules.length > 0) {
    nextPricing.version = nextPricing.version || "v1";
    nextPricing.rules = cleanedRules;
  } else {
    delete nextPricing.rules;
  }

  return {
    ...vendor,
    pricing: Object.keys(nextPricing).length > 0 ? nextPricing : undefined,
    metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
  };
};

const normalizePricingDimensions = (
  vendor?: ManagedModelVendorConfig
): ManagedPricingDimensionDefinition[] => {
  const raw = vendor?.pricing?.dimensions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return {
          key: item,
          label: item,
          type: "string" as const,
          required: false,
        };
      }
      if (item && typeof item === "object" && typeof item.key === "string") {
        return {
          key: item.key,
          label: item.label || item.key,
          type: item.type || "string",
          required: item.required === true,
          options: Array.isArray(item.options)
            ? item.options.map((option) => ({
                value: option.value,
                label: option.label || String(option.value),
              }))
            : undefined,
          description: item.description,
        };
      }
      return null;
    })
    .filter(Boolean) as ManagedPricingDimensionDefinition[];
};

const PRICING_FIELD_LABELS: Record<string, string> = {
  duration: "时长（秒）",
  durationSec: "时长（秒）",
  resolution: "分辨率",
  viduModel: "Vidu 型号",
  viduModelVariant: "Vidu 型号",
  seedanceModel: "Seedance 型号",
  seedanceMode: "生成模式",
  inputType: "输入类型",
  mode: "模式",
  sound: "声音",
  hasAudio: "声音",
  generateAudio: "音频生成",
  offPeak: "错峰模式",
  watermark: "水印",
  referenceVideo: "视频参考",
  referenceVideoType: "视频参考类型",
};

const stringifyLegacyOptionValue = (value: string | number | boolean) => {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

const inferLegacyDimensionType = (
  values: Array<string | number | boolean>,
  key: string
): ManagedPricingDimensionDefinition["type"] => {
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  if (key === "duration" || key === "durationSec") return "number";
  if (values.every((value) => typeof value === "number")) return "enum";
  return "enum";
};

const buildLegacyDisplayLabel = (key: string, value: string | number | boolean) => {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (key === "duration" || key === "durationSec") {
    return `${value} 秒`;
  }
  return String(value);
};

const buildLegacyPricingV2FromRules = (
  pricing: Record<string, any>,
  vendor?: ManagedModelVendorConfig
): ManagedPricingV2View | null => {
  const rules = Array.isArray(pricing?.rules) ? pricing.rules.filter(Boolean) : [];
  if (rules.length === 0) return null;

  const fieldValueMap = new Map<string, Array<string | number | boolean>>();
  const addFieldValue = (field: string, value: unknown) => {
    if (!field) return;
    const existing = fieldValueMap.get(field) || [];
    const values = Array.isArray(value) ? value : [value];
    values.forEach((entry) => {
      if (
        typeof entry !== "string" &&
        typeof entry !== "number" &&
        typeof entry !== "boolean"
      ) {
        return;
      }
      if (!existing.some((item) => stringifyLegacyOptionValue(item) === stringifyLegacyOptionValue(entry))) {
        existing.push(entry);
      }
    });
    fieldValueMap.set(field, existing);
  };

  rules.forEach((rule) => {
    const when = rule?.when && typeof rule.when === "object" ? rule.when : {};
    Object.entries(when).forEach(([field, value]) => addFieldValue(field, value));
  });

  const dimensions = Array.from(fieldValueMap.entries()).map(([field, values]) => {
    const type = inferLegacyDimensionType(values, field);
    return {
      key: field,
      label: PRICING_FIELD_LABELS[field] || field,
      type,
      required: true,
      description: undefined,
      options:
        type === "number" && field !== "duration" && field !== "durationSec"
          ? undefined
          : values.map((value) => ({
              value,
              label: buildLegacyDisplayLabel(field, value),
            })),
    } satisfies ManagedPricingDimensionDefinition;
  });

  const matchingRules: ManagedPricingMatchingRule[] = rules.map((rule: Record<string, any>, index: number) => {
    const when = rule?.when && typeof rule.when === "object" ? rule.when : {};
    return {
      ruleKey: String(rule?.ruleKey || "").trim() || `legacy_rule_${index + 1}`,
      label: String(rule?.label || "").trim() || `规则 ${index + 1}`,
      enabled: true,
      priority: typeof rule?.priority === "number" ? rule.priority : 100,
      evaluatorKey: String(rule?.ruleKey || "").trim() || `legacy_rule_${index + 1}_eval`,
      conditions: {
        all: Object.entries(when).map(([field, value]) => ({
          field,
          op: Array.isArray(value) ? ("in" as const) : ("eq" as const),
          value: value as string | number | boolean | Array<string | number | boolean>,
        })),
        any: [],
      },
    };
  });

  const evaluators: Record<string, ManagedPricingEvaluator> = Object.fromEntries(
    rules.map((rule: Record<string, any>, index: number) => {
      const evaluatorKey = String(rule?.ruleKey || "").trim() || `legacy_rule_${index + 1}_eval`;
      const price =
        rule?.price && typeof rule.price === "object" && !Array.isArray(rule.price) ? rule.price : {};
      return [
        evaluatorKey,
        {
          type: "fixed",
          priceYuan:
            typeof price.priceYuan === "number" && Number.isFinite(price.priceYuan)
              ? price.priceYuan
              : typeof rule?.priceYuan === "number" && Number.isFinite(rule.priceYuan)
              ? rule.priceYuan
              : undefined,
          credits:
            typeof price.credits === "number" && Number.isFinite(price.credits)
              ? price.credits
              : typeof rule?.creditsPerCall === "number" && Number.isFinite(rule.creditsPerCall)
              ? rule.creditsPerCall
              : undefined,
        } satisfies ManagedPricingEvaluator,
      ] as const;
    })
  );

  const firstRuleWhen =
    rules[0]?.when && typeof rules[0].when === "object" && !Array.isArray(rules[0].when)
      ? rules[0].when
      : {};

  return {
    version: "v2",
    dimensions,
    matchingRules,
    evaluators,
    displayConfig: {
      specAxes: dimensions.map((dimension) => dimension.key),
      labels: Object.fromEntries(
        dimensions.flatMap((dimension) =>
          (dimension.options || []).map((option) => [
            `${dimension.key}.${stringifyLegacyOptionValue(option.value)}`,
            option.label || String(option.value),
          ])
        )
      ),
      presets: rules.slice(0, 16).map((rule) =>
        rule?.when && typeof rule.when === "object" && !Array.isArray(rule.when) ? { ...rule.when } : {}
      ),
      defaultSelections:
        Object.keys(firstRuleWhen).length > 0
          ? { ...firstRuleWhen }
          : {
              ...(getVendorPricingDefaults(vendor).credits !== undefined
                ? { credits: getVendorPricingDefaults(vendor).credits }
                : {}),
            },
    },
  };
};

const buildLegacyPricingV2FromFormula = (pricing: Record<string, any>): ManagedPricingV2View | null => {
  const adjustments =
    pricing?.formula?.adjustments && Array.isArray(pricing.formula.adjustments)
      ? pricing.formula.adjustments.filter(Boolean)
      : [];
  if (adjustments.length === 0) return null;

  const fieldValueMap = new Map<string, Array<string | number | boolean>>();
  const linearUnitFields = new Set<string>();

  adjustments.forEach((adjustment: Record<string, any>) => {
    const when = adjustment?.when && typeof adjustment.when === "object" ? adjustment.when : {};
    Object.entries(when).forEach(([field, value]) => {
      const existing = fieldValueMap.get(field) || [];
      const values = Array.isArray(value) ? value : [value];
      values.forEach((entry) => {
        if (
          typeof entry !== "string" &&
          typeof entry !== "number" &&
          typeof entry !== "boolean"
        ) {
          return;
        }
        if (!existing.some((item) => stringifyLegacyOptionValue(item) === stringifyLegacyOptionValue(entry))) {
          existing.push(entry);
        }
      });
      fieldValueMap.set(field, existing);
    });
    const unitField =
      typeof adjustment?.multiplier?.field === "string" ? adjustment.multiplier.field.trim() : "";
    if (unitField) {
      linearUnitFields.add(unitField);
      if (!fieldValueMap.has(unitField)) fieldValueMap.set(unitField, []);
    }
  });

  const dimensions = Array.from(fieldValueMap.entries()).map(([field, values]) => {
    const type = linearUnitFields.has(field) ? "number" : inferLegacyDimensionType(values, field);
    return {
      key: field,
      label: PRICING_FIELD_LABELS[field] || field,
      type,
      required: true,
      description: undefined,
      options:
        type === "number"
          ? undefined
          : values.map((value) => ({
              value,
              label: buildLegacyDisplayLabel(field, value),
            })),
    } satisfies ManagedPricingDimensionDefinition;
  });

  const matchingRules: ManagedPricingMatchingRule[] = adjustments.map((adjustment: Record<string, any>, index: number) => {
    const when = adjustment?.when && typeof adjustment.when === "object" ? adjustment.when : {};
    return {
      ruleKey: String(adjustment?.key || "").trim() || `legacy_formula_${index + 1}`,
      label: String(adjustment?.label || "").trim() || `公式规则 ${index + 1}`,
      enabled: true,
      priority: 100 + (adjustments.length - index),
      evaluatorKey: `${String(adjustment?.key || "").trim() || `legacy_formula_${index + 1}`}_eval`,
      conditions: {
        all: Object.entries(when).map(([field, value]) => ({
          field,
          op: Array.isArray(value) ? ("in" as const) : ("eq" as const),
          value: value as string | number | boolean | Array<string | number | boolean>,
        })),
        any: [],
      },
    };
  });

  const evaluators: Record<string, ManagedPricingEvaluator> = Object.fromEntries(
    adjustments.map((adjustment: Record<string, any>, index: number) => {
      const baseKey = String(adjustment?.key || "").trim() || `legacy_formula_${index + 1}`;
      const unitField =
        typeof adjustment?.multiplier?.field === "string" ? adjustment.multiplier.field.trim() : "";
      const unitPrice =
        adjustment?.unitPrice && typeof adjustment.unitPrice === "object" ? adjustment.unitPrice : {};
      return [
        `${baseKey}_eval`,
        unitField
          ? ({
              type: "linear",
              unitField,
              unitPriceYuan:
                typeof unitPrice.priceYuan === "number" && Number.isFinite(unitPrice.priceYuan)
                  ? unitPrice.priceYuan
                  : 0,
            } satisfies ManagedPricingEvaluator)
          : ({
              type: "fixed",
              priceYuan:
                typeof unitPrice.priceYuan === "number" && Number.isFinite(unitPrice.priceYuan)
                  ? unitPrice.priceYuan
                  : undefined,
              credits:
                typeof unitPrice.credits === "number" && Number.isFinite(unitPrice.credits)
                  ? unitPrice.credits
                  : undefined,
            } satisfies ManagedPricingEvaluator),
      ] as const;
    })
  );

  const defaultSelections = Object.fromEntries(
    dimensions.map((dimension) => {
      if (linearUnitFields.has(dimension.key)) {
        return [dimension.key, dimension.key === "duration" || dimension.key === "durationSec" ? 5 : 0];
      }
      const firstValue = dimension.options?.[0]?.value;
      if (firstValue !== undefined) return [dimension.key, firstValue];
      if (dimension.type === "boolean") return [dimension.key, false];
      return [dimension.key, ""];
    })
  );

  return {
    version: "v2",
    dimensions,
    matchingRules,
    evaluators,
    displayConfig: {
      specAxes: dimensions.map((dimension) => dimension.key),
      labels: Object.fromEntries(
        dimensions.flatMap((dimension) =>
          (dimension.options || []).map((option) => [
            `${dimension.key}.${stringifyLegacyOptionValue(option.value)}`,
            option.label || String(option.value),
          ])
        )
      ),
      presets: adjustments.slice(0, 16).map((adjustment: Record<string, any>) => ({
        ...(adjustment?.when && typeof adjustment.when === "object" && !Array.isArray(adjustment.when)
          ? adjustment.when
          : {}),
        ...Array.from(linearUnitFields).reduce<Record<string, number>>((acc, field) => {
          acc[field] = field === "duration" || field === "durationSec" ? 5 : 0;
          return acc;
        }, {}),
      })),
      defaultSelections,
    },
  };
};

const createEmptyPricingDimension = (): ManagedPricingDimensionDefinition => ({
  key: "",
  label: "",
  type: "enum",
  required: false,
  options: [],
  description: "",
});

const createEmptyMatchingRule = (): ManagedPricingMatchingRule => ({
  ruleKey: "",
  label: "",
  enabled: true,
  priority: 100,
  evaluatorKey: "",
  conditions: { all: [], any: [] },
});

const createEmptyConditionRow = (): ManagedPricingConditionRow => ({
  field: "",
  op: "eq",
  value: "",
});

const createEvaluatorByType = (
  type: "fixed" | "linear" | "base_plus_linear" | "lookup_matrix"
): ManagedPricingEvaluator => {
  if (type === "fixed") return { type, priceYuan: 0 };
  if (type === "linear") return { type, unitField: "", unitPriceYuan: 0 };
  if (type === "base_plus_linear") {
    return { type, basePriceYuan: 0, includedUnits: 1, unitField: "", extraUnitPriceYuan: 0 };
  }
  return { type, axes: [], matrix: {} };
};

const getVendorPricingV2 = (vendor?: ManagedModelVendorConfig): ManagedPricingV2View => {
  const pricing = vendor?.pricing && typeof vendor.pricing === "object" ? vendor.pricing : undefined;
  const normalizedDimensions = normalizePricingDimensions(vendor);
  const hasV2Shape =
    Array.isArray(pricing?.matchingRules) ||
    (pricing?.evaluators && typeof pricing.evaluators === "object") ||
    normalizedDimensions.length > 0;
  if (!hasV2Shape) {
    const legacyFromRules = pricing ? buildLegacyPricingV2FromRules(pricing, vendor) : null;
    if (legacyFromRules) return legacyFromRules;
    const legacyFromFormula = pricing ? buildLegacyPricingV2FromFormula(pricing) : null;
    if (legacyFromFormula) return legacyFromFormula;
  }
  return {
    version: pricing?.version || "v2",
    dimensions: normalizedDimensions,
    matchingRules: Array.isArray(pricing?.matchingRules)
      ? pricing?.matchingRules.map((rule: Record<string, any>) => ({
          ruleKey: rule.ruleKey || "",
          label: rule.label || "",
          enabled: rule.enabled !== false,
          priority: typeof rule.priority === "number" ? rule.priority : 100,
          evaluatorKey: rule.evaluatorKey || "",
          conditions: {
            all: Array.isArray(rule.conditions?.all)
              ? rule.conditions?.all.map((row: Record<string, any>) => ({
                  field: row.field || "",
                  op: row.op || "eq",
                  value: (row.value ?? "") as string | number | boolean | Array<string | number | boolean>,
                }))
              : [],
            any: Array.isArray(rule.conditions?.any)
              ? rule.conditions?.any.map((row: Record<string, any>) => ({
                  field: row.field || "",
                  op: row.op || "eq",
                  value: (row.value ?? "") as string | number | boolean | Array<string | number | boolean>,
                }))
              : [],
          },
        })) as ManagedPricingMatchingRule[]
      : [],
    evaluators:
      pricing?.evaluators && typeof pricing.evaluators === "object"
        ? ({ ...pricing.evaluators } as Record<string, ManagedPricingEvaluator>)
        : ({} as Record<string, ManagedPricingEvaluator>),
    displayConfig: {
      specAxes: Array.isArray(pricing?.displayConfig?.specAxes) ? pricing?.displayConfig?.specAxes : [],
      labels:
        pricing?.displayConfig?.labels && typeof pricing.displayConfig.labels === "object"
          ? { ...pricing.displayConfig.labels }
          : {},
      presets: Array.isArray(pricing?.displayConfig?.presets) ? pricing?.displayConfig?.presets : [],
      defaultSelections:
        pricing?.displayConfig?.defaultSelections &&
        typeof pricing.displayConfig.defaultSelections === "object"
          ? { ...pricing.displayConfig.defaultSelections }
          : {},
    },
  };
};

const writeVendorPricingV2 = (
  vendor: ManagedModelVendorConfig,
  next: ReturnType<typeof getVendorPricingV2>
): ManagedModelVendorConfig => {
  const currentPricing =
    vendor.pricing && typeof vendor.pricing === "object" ? { ...vendor.pricing } : {};

  const dimensions = next.dimensions
    .map((item) => ({
      key: String(item.key || "").trim(),
      label: String(item.label || "").trim() || String(item.key || "").trim(),
      type: item.type || "string",
      required: item.required === true,
      options: Array.isArray(item.options)
        ? item.options
            .map((option) => ({
              value: option.value,
              label: String(option.label || option.value),
            }))
            .filter((option) => String(option.value).trim().length > 0)
        : undefined,
      description: String(item.description || "").trim() || undefined,
    }))
    .filter((item) => item.key);

  const matchingRules = next.matchingRules
    .map((rule, index) => ({
      ruleKey: String(rule.ruleKey || "").trim() || `rule_v2_${index + 1}`,
      label: String(rule.label || "").trim() || undefined,
      enabled: rule.enabled !== false,
      priority: typeof rule.priority === "number" ? rule.priority : 100,
      evaluatorKey: String(rule.evaluatorKey || "").trim(),
      conditions: {
        all: (rule.conditions?.all || [])
          .map((row) => ({
            field: String(row.field || "").trim(),
            op: row.op || "eq",
            value: row.value,
          }))
          .filter((row) => row.field),
        any: (rule.conditions?.any || [])
          .map((row) => ({
            field: String(row.field || "").trim(),
            op: row.op || "eq",
            value: row.value,
          }))
          .filter((row) => row.field),
      },
    }))
    .filter((rule) => rule.evaluatorKey && ((rule.conditions.all?.length || 0) > 0 || (rule.conditions.any?.length || 0) > 0));

  const evaluators = Object.fromEntries(
    Object.entries(next.evaluators || {})
      .map(([key, value]) => [String(key).trim(), value] as const)
      .filter(([key, value]) => key && value && typeof value === "object" && typeof (value as any).type === "string")
  );

  return {
    ...vendor,
    pricing: {
      ...currentPricing,
      version: "v2",
      dimensions,
      matchingRules,
      evaluators,
      displayConfig: {
        specAxes: (next.displayConfig.specAxes || []).filter(Boolean),
        labels: next.displayConfig.labels || {},
        presets: next.displayConfig.presets || [],
        defaultSelections: next.displayConfig.defaultSelections || {},
      },
    },
  };
};

const stringifyConditionValue = (value: unknown) => {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
};

const parseConditionValue = (raw: string, type?: ManagedPricingDimensionDefinition["type"], op?: string) => {
  if (op === "in") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        if (type === "number") return Number(item);
        if (type === "boolean") return item === "true";
        return item;
      });
  }
  if (type === "number") return raw.trim() === "" ? "" : Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
};

const getDimensionOptionValues = (dimension?: ManagedPricingDimensionDefinition) => {
  if (!dimension) return [];
  if (Array.isArray(dimension.options) && dimension.options.length > 0) {
    return dimension.options.map((option) => option.value);
  }
  return [];
};

const getLookupMatrixValue = (matrix: Record<string, unknown> | undefined, path: Array<string>) => {
  let current: unknown = matrix;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const setLookupMatrixValue = (
  matrix: Record<string, unknown> | undefined,
  path: Array<string>,
  value: number | undefined
): Record<string, unknown> => {
  const next = matrix && typeof matrix === "object" && !Array.isArray(matrix)
    ? JSON.parse(JSON.stringify(matrix))
    : {};
  let current: Record<string, unknown> = next;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      if (value === undefined || Number.isNaN(value)) {
        delete current[key];
      } else {
        current[key] = value;
      }
      return;
    }
    const child =
      current[key] && typeof current[key] === "object" && !Array.isArray(current[key])
        ? (current[key] as Record<string, unknown>)
        : {};
    current[key] = child;
    current = child;
  });
  return next;
};

const validatePricingV2 = (pricing: ReturnType<typeof getVendorPricingV2>) => {
  const issues: Array<{ level: "error" | "warning"; message: string }> = [];
  const dimensionKeySet = new Set(pricing.dimensions.map((dimension) => dimension.key).filter(Boolean));
  const evaluatorKeys = new Set(Object.keys(pricing.evaluators || {}));

  pricing.dimensions.forEach((dimension, index) => {
    if (!dimension.key.trim()) {
      issues.push({ level: "error", message: `维度 #${index + 1} 缺少 key` });
    }
    if ((dimension.type === "enum" || dimension.type === "boolean") && (!dimension.options || dimension.options.length === 0)) {
      issues.push({
        level: "warning",
        message: `维度 ${dimension.label || dimension.key || `#${index + 1}`} 是 ${dimension.type}，但未配置 options`,
      });
    }
  });

  pricing.matchingRules.forEach((rule, index) => {
    if (!rule.ruleKey.trim()) {
      issues.push({ level: "error", message: `规则 #${index + 1} 缺少 ruleKey` });
    }
    if (!rule.evaluatorKey.trim()) {
      issues.push({ level: "error", message: `规则 ${rule.ruleKey || `#${index + 1}`} 未绑定 evaluatorKey` });
    } else if (!evaluatorKeys.has(rule.evaluatorKey)) {
      issues.push({
        level: "error",
        message: `规则 ${rule.ruleKey || `#${index + 1}`} 绑定的 evaluatorKey ${rule.evaluatorKey} 不存在`,
      });
    }
    const allCount = rule.conditions.all.length;
    const anyCount = rule.conditions.any.length;
    if (allCount === 0 && anyCount === 0) {
      issues.push({ level: "error", message: `规则 ${rule.ruleKey || `#${index + 1}`} 没有任何条件` });
    }
    [...rule.conditions.all, ...rule.conditions.any].forEach((condition, conditionIndex) => {
      if (!condition.field.trim()) {
        issues.push({
          level: "error",
          message: `规则 ${rule.ruleKey || `#${index + 1}`} 的条件 #${conditionIndex + 1} 缺少字段`,
        });
      } else if (!dimensionKeySet.has(condition.field)) {
        issues.push({
          level: "error",
          message: `规则 ${rule.ruleKey || `#${index + 1}`} 使用了未定义维度 ${condition.field}`,
        });
      }
    });
  });

  Object.entries(pricing.evaluators || {}).forEach(([key, evaluator]) => {
    if (evaluator.type === "linear") {
      if (!evaluator.unitField?.trim()) {
        issues.push({ level: "error", message: `Evaluator ${key} 缺少 unitField` });
      } else if (!dimensionKeySet.has(evaluator.unitField)) {
        issues.push({ level: "error", message: `Evaluator ${key} 的 unitField ${evaluator.unitField} 未定义` });
      }
    }
    if (evaluator.type === "base_plus_linear") {
      if (!evaluator.unitField?.trim()) {
        issues.push({ level: "error", message: `Evaluator ${key} 缺少 unitField` });
      } else if (!dimensionKeySet.has(evaluator.unitField)) {
        issues.push({ level: "error", message: `Evaluator ${key} 的 unitField ${evaluator.unitField} 未定义` });
      }
    }
    if (evaluator.type === "lookup_matrix") {
      const axes = Array.isArray(evaluator.axes) ? evaluator.axes.filter(Boolean) : [];
      if (axes.length === 0) {
        issues.push({ level: "error", message: `Evaluator ${key} 缺少 axes` });
      }
      axes.forEach((axis: string) => {
        if (!dimensionKeySet.has(axis)) {
          issues.push({ level: "error", message: `Evaluator ${key} 使用了未定义维度 ${axis}` });
          return;
        }
        const dimension = pricing.dimensions.find((item) => item.key === axis);
        if (!dimension?.options || dimension.options.length === 0) {
          issues.push({
            level: "warning",
            message: `Evaluator ${key} 的轴 ${axis} 没有 options，可视化矩阵无法完整渲染`,
          });
        }
      });
    }
  });

  (pricing.displayConfig.specAxes || []).forEach((axis) => {
    if (!dimensionKeySet.has(axis)) {
      issues.push({ level: "warning", message: `displayConfig.specAxes 使用了未定义维度 ${axis}` });
    }
  });

  (pricing.displayConfig.presets || []).forEach((preset, index) => {
    pricing.dimensions.forEach((dimension) => {
      const value = preset?.[dimension.key];
      if ((value === undefined || value === null || value === "") && dimension.required) {
        issues.push({
          level: "warning",
          message: `Preset ${index + 1} 缺少必填维度 ${dimension.label || dimension.key}`,
        });
      }
    });
  });

  return issues;
};

const createEnumDimension = (
  key: string,
  label: string,
  values: Array<string | number | boolean>,
  options?: {
    required?: boolean;
    labels?: Record<string, string>;
    description?: string;
  }
): ManagedPricingDimensionDefinition => ({
  key,
  label,
  type: "enum",
  required: options?.required === true,
  options: values.map((value) => ({
    value,
    label: options?.labels?.[String(value)] || String(value),
  })),
  description: options?.description,
});

const createBooleanDimension = (
  key: string,
  label: string,
  options?: {
    required?: boolean;
    trueLabel?: string;
    falseLabel?: string;
    description?: string;
  }
): ManagedPricingDimensionDefinition => ({
  key,
  label,
  type: "boolean",
  required: options?.required === true,
  options: [
    { value: false, label: options?.falseLabel || "否" },
    { value: true, label: options?.trueLabel || "是" },
  ],
  description: options?.description,
});

const createNumberDimension = (
  key: string,
  label: string,
  options?: {
    required?: boolean;
    description?: string;
  }
): ManagedPricingDimensionDefinition => ({
  key,
  label,
  type: "number",
  required: options?.required === true,
  description: options?.description,
});

const createKling26PricingTemplate = () => ({
  version: "v2",
  dimensions: [
    createEnumDimension("generationMode", "生成方式", ["i2v"], {
      required: true,
      labels: { i2v: "图生视频" },
    }),
    createBooleanDimension("hasAudio", "是否带音频", {
      required: true,
      falseLabel: "无声",
      trueLabel: "有声",
    }),
    createEnumDimension("qualityMode", "质量档位", ["std", "pro"], {
      required: true,
      labels: { std: "标准（std）", pro: "高品质（pro）" },
    }),
    createEnumDimension("durationSec", "时长（秒）", [5, 10], {
      required: true,
      labels: { "5": "5 秒", "10": "10 秒" },
    }),
  ],
  matchingRules: [
    {
      ruleKey: "kling26_i2v_rule",
      label: "Kling 2.6 图生视频价格矩阵",
      enabled: true,
      priority: 100,
      evaluatorKey: "kling26_matrix",
      conditions: {
        all: [{ field: "generationMode", op: "eq" as const, value: "i2v" }],
        any: [],
      },
    },
  ],
  evaluators: {
    kling26_matrix: {
      type: "lookup_matrix" as const,
      axes: ["hasAudio", "qualityMode", "durationSec"],
      matrix: {
        false: {
          std: { "5": 1.5, "10": 3 },
          pro: { "5": 3, "10": 5 },
        },
        true: {
          std: { "5": 5, "10": 10 },
          pro: { "5": 6, "10": 12 },
        },
      },
    },
  },
  displayConfig: {
    specAxes: ["hasAudio", "qualityMode", "durationSec"],
    labels: {
      "generationMode.i2v": "图生视频",
      "hasAudio.false": "无声",
      "hasAudio.true": "有声",
      "qualityMode.std": "标准（std）",
      "qualityMode.pro": "高品质（pro）",
      "durationSec.5": "5 秒",
      "durationSec.10": "10 秒",
    },
    defaultSelections: {
      generationMode: "i2v",
      hasAudio: false,
      qualityMode: "std",
      durationSec: 5,
    },
    presets: [
      { generationMode: "i2v", hasAudio: false, qualityMode: "std", durationSec: 5 },
      { generationMode: "i2v", hasAudio: false, qualityMode: "pro", durationSec: 5 },
      { generationMode: "i2v", hasAudio: true, qualityMode: "std", durationSec: 5 },
      { generationMode: "i2v", hasAudio: true, qualityMode: "pro", durationSec: 5 },
      { generationMode: "i2v", hasAudio: false, qualityMode: "std", durationSec: 10 },
      { generationMode: "i2v", hasAudio: false, qualityMode: "pro", durationSec: 10 },
      { generationMode: "i2v", hasAudio: true, qualityMode: "std", durationSec: 10 },
      { generationMode: "i2v", hasAudio: true, qualityMode: "pro", durationSec: 10 },
    ],
  },
});

const createKling30PricingTemplate = () => ({
  version: "v2",
  dimensions: [
    createEnumDimension("generationMode", "生成方式", ["t2v", "i2v", "start_end_frame"], {
      required: true,
      labels: {
        t2v: "文生视频",
        i2v: "图生视频",
        start_end_frame: "首尾帧",
      },
    }),
    createBooleanDimension("hasAudio", "是否带音频", {
      required: true,
      falseLabel: "无声",
      trueLabel: "有声",
    }),
    createEnumDimension("qualityMode", "质量档位", ["std", "pro"], {
      required: true,
      labels: { std: "标准（720P）", pro: "高品质（1080P）" },
    }),
    createEnumDimension("durationSec", "时长（秒）", [5, 10], {
      required: true,
      labels: { "5": "5 秒", "10": "10 秒" },
    }),
  ],
  matchingRules: [
    {
      ruleKey: "kling30_common_rule",
      label: "Kling 3.0 通用价格矩阵",
      enabled: true,
      priority: 100,
      evaluatorKey: "kling30_matrix",
      conditions: {
        all: [
          {
            field: "generationMode",
            op: "in" as const,
            value: ["t2v", "i2v", "start_end_frame"],
          },
        ],
        any: [],
      },
    },
  ],
  evaluators: {
    kling30_matrix: {
      type: "lookup_matrix" as const,
      axes: ["hasAudio", "qualityMode", "durationSec"],
      matrix: {
        false: {
          std: { "5": 3, "10": 6 },
          pro: { "5": 4, "10": 8 },
        },
        true: {
          std: { "5": 4.5, "10": 9 },
          pro: { "5": 6, "10": 12 },
        },
      },
    },
  },
  displayConfig: {
    specAxes: ["generationMode", "hasAudio", "qualityMode", "durationSec"],
    labels: {
      "generationMode.t2v": "文生视频",
      "generationMode.i2v": "图生视频",
      "generationMode.start_end_frame": "首尾帧",
      "hasAudio.false": "无声",
      "hasAudio.true": "有声",
      "qualityMode.std": "标准（720P）",
      "qualityMode.pro": "高品质（1080P）",
      "durationSec.5": "5 秒",
      "durationSec.10": "10 秒",
    },
    defaultSelections: {
      generationMode: "t2v",
      hasAudio: false,
      qualityMode: "std",
      durationSec: 5,
    },
    presets: [
      { generationMode: "t2v", hasAudio: false, qualityMode: "std", durationSec: 5 },
      { generationMode: "t2v", hasAudio: false, qualityMode: "pro", durationSec: 5 },
      { generationMode: "i2v", hasAudio: false, qualityMode: "std", durationSec: 5 },
      { generationMode: "i2v", hasAudio: true, qualityMode: "std", durationSec: 5 },
      { generationMode: "start_end_frame", hasAudio: false, qualityMode: "std", durationSec: 5 },
      { generationMode: "t2v", hasAudio: false, qualityMode: "std", durationSec: 10 },
      { generationMode: "t2v", hasAudio: true, qualityMode: "std", durationSec: 10 },
      { generationMode: "i2v", hasAudio: true, qualityMode: "pro", durationSec: 10 },
    ],
  },
});

const createQ3TurboPricingTemplate = () => ({
  version: "v2",
  dimensions: [
    createEnumDimension("generationMode", "生成方式", ["t2v", "i2v", "start_end_frame"], {
      required: true,
      labels: {
        t2v: "文生视频",
        i2v: "图生视频",
        start_end_frame: "首尾帧",
      },
    }),
    createEnumDimension("resolution", "分辨率", ["540P", "720P", "1080P"], {
      required: true,
      labels: {
        "540P": "540P",
        "720P": "720P",
        "1080P": "1080P",
      },
    }),
    createNumberDimension("durationSec", "时长（秒）", {
      required: true,
      description: "按秒线性计费",
    }),
  ],
  matchingRules: [
    {
      ruleKey: "q3_turbo_540p_rule",
      label: "Q3 Turbo 540P 线性计费",
      enabled: true,
      priority: 100,
      evaluatorKey: "q3_turbo_540p_linear",
      conditions: {
        all: [
          { field: "generationMode", op: "in" as const, value: ["t2v", "i2v", "start_end_frame"] },
          { field: "resolution", op: "eq" as const, value: "540P" },
        ],
        any: [],
      },
    },
    {
      ruleKey: "q3_turbo_720p_rule",
      label: "Q3 Turbo 720P 线性计费",
      enabled: true,
      priority: 110,
      evaluatorKey: "q3_turbo_720p_linear",
      conditions: {
        all: [
          { field: "generationMode", op: "in" as const, value: ["t2v", "i2v", "start_end_frame"] },
          { field: "resolution", op: "eq" as const, value: "720P" },
        ],
        any: [],
      },
    },
    {
      ruleKey: "q3_turbo_1080p_rule",
      label: "Q3 Turbo 1080P 线性计费",
      enabled: true,
      priority: 120,
      evaluatorKey: "q3_turbo_1080p_linear",
      conditions: {
        all: [
          { field: "generationMode", op: "in" as const, value: ["t2v", "i2v", "start_end_frame"] },
          { field: "resolution", op: "eq" as const, value: "1080P" },
        ],
        any: [],
      },
    },
  ],
  evaluators: {
    q3_turbo_540p_linear: {
      type: "linear" as const,
      unitField: "durationSec",
      unitPriceYuan: 0.25,
    },
    q3_turbo_720p_linear: {
      type: "linear" as const,
      unitField: "durationSec",
      unitPriceYuan: 0.375,
    },
    q3_turbo_1080p_linear: {
      type: "linear" as const,
      unitField: "durationSec",
      unitPriceYuan: 0.5,
    },
  },
  displayConfig: {
    specAxes: ["generationMode", "resolution", "durationSec"],
    labels: {
      "generationMode.t2v": "文生视频",
      "generationMode.i2v": "图生视频",
      "generationMode.start_end_frame": "首尾帧",
      "resolution.540P": "540P",
      "resolution.720P": "720P",
      "resolution.1080P": "1080P",
    },
    defaultSelections: {
      generationMode: "t2v",
      resolution: "540P",
      durationSec: 5,
    },
    presets: [
      { generationMode: "t2v", resolution: "540P", durationSec: 5 },
      { generationMode: "t2v", resolution: "720P", durationSec: 5 },
      { generationMode: "t2v", resolution: "1080P", durationSec: 5 },
      { generationMode: "i2v", resolution: "540P", durationSec: 5 },
      { generationMode: "i2v", resolution: "720P", durationSec: 10 },
      { generationMode: "start_end_frame", resolution: "1080P", durationSec: 10 },
    ],
  },
});

const createWanPricingTemplate = (
  generationModes: Array<"t2v" | "i2v" | "r2v">
) => ({
  version: "v2",
  defaults: {
    credits: 400,
    priceYuan: 4,
  },
  dimensions: [
    createEnumDimension("generationMode", "生成方式", generationModes, {
      required: true,
      labels: {
        t2v: "文生视频",
        i2v: "图生视频",
        r2v: "参考视频",
      },
    }),
    createEnumDimension("resolution", "分辨率", ["720P", "1080P"], {
      required: true,
      labels: {
        "720P": "720P",
        "1080P": "1080P",
      },
    }),
    createNumberDimension("durationSec", "时长（秒）", {
      required: true,
      description: "按秒线性计费",
    }),
  ],
  matchingRules: [
    {
      ruleKey: "wan_720p_linear",
      label: "Wan 720P 按秒计费",
      enabled: true,
      priority: 100,
      evaluatorKey: "wan_720p_linear_eval",
      conditions: {
        all: [
          { field: "generationMode", op: "in" as const, value: generationModes },
          { field: "resolution", op: "eq" as const, value: "720P" },
        ],
        any: [],
      },
    },
    {
      ruleKey: "wan_1080p_linear",
      label: "Wan 1080P 按秒计费",
      enabled: true,
      priority: 110,
      evaluatorKey: "wan_1080p_linear_eval",
      conditions: {
        all: [
          { field: "generationMode", op: "in" as const, value: generationModes },
          { field: "resolution", op: "eq" as const, value: "1080P" },
        ],
        any: [],
      },
    },
  ],
  evaluators: {
    wan_720p_linear_eval: {
      type: "linear" as const,
      unitField: "durationSec",
      unitPriceYuan: 0.8,
    },
    wan_1080p_linear_eval: {
      type: "linear" as const,
      unitField: "durationSec",
      unitPriceYuan: 1.2,
    },
  },
  displayConfig: {
    specAxes: ["generationMode", "resolution", "durationSec"],
    labels: {
      "generationMode.t2v": "文生视频",
      "generationMode.i2v": "图生视频",
      "generationMode.r2v": "参考视频",
      "resolution.720P": "720P",
      "resolution.1080P": "1080P",
      "durationSec.5": "5 秒",
      "durationSec.10": "10 秒",
      "durationSec.15": "15 秒",
    },
    defaultSelections: {
      generationMode: generationModes[0],
      resolution: "720P",
      durationSec: 5,
    },
    presets: generationModes.flatMap((generationMode) =>
      ["720P", "1080P"].flatMap((resolution) =>
        [5, 10, 15].map((durationSec) => ({
          generationMode,
          resolution,
          durationSec,
        }))
      )
    ),
  },
});

const mergeFallbackStructure = <T,>(fallback: T, current?: Partial<T> | null): T => {
  if (Array.isArray(fallback)) {
    return (Array.isArray(current) ? current : fallback) as T;
  }
  if (fallback && typeof fallback === "object") {
    const next: Record<string, unknown> = {
      ...(fallback as Record<string, unknown>),
    };
    if (current && typeof current === "object" && !Array.isArray(current)) {
      Object.entries(current as Record<string, unknown>).forEach(([key, value]) => {
        next[key] = mergeFallbackStructure(
          (fallback as Record<string, unknown>)[key],
          value as never
        );
      });
    }
    return next as T;
  }
  return (current === undefined ? fallback : current) as T;
};

const MANAGED_MODEL_TASK_TYPE_OPTIONS: Array<{
  value: ManagedModelTaskType;
  label: string;
}> = [
  { value: "text", label: "文本" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
];

const MANAGED_NODE_TEMPLATE_OPTIONS: Record<
  ManagedModelTaskType,
  Array<{ value: string; label: string; category: "input" | "image" | "video" }>
> = {
  text: [
    { value: "textPrompt", label: "提示词节点", category: "input" },
    { value: "textChat", label: "文本对话节点", category: "input" },
    { value: "promptOptimize", label: "提示词优化节点", category: "input" },
  ],
  image: [
    { value: "generate", label: "图片生成节点", category: "image" },
    { value: "generatePro", label: "自定义图片节点", category: "image" },
    { value: "seedream5", label: "Seedream 5 节点", category: "image" },
    { value: "midjourney", label: "Midjourney 节点", category: "image" },
    { value: "analysis", label: "图像分析节点", category: "image" },
  ],
  video: [
    { value: "kling26Video", label: "Kling 2.6 视频节点", category: "video" },
    { value: "kling30Video", label: "Kling 3.0 视频节点", category: "video" },
    { value: "klingO1Video", label: "Kling 3.0-Omni 视频节点", category: "video" },
    { value: "viduVideo", label: "Vidu 视频节点", category: "video" },
    { value: "doubaoVideo", label: "Seedance 1.5 视频节点", category: "video" },
    { value: "seedance20Video", label: "Seedance 2.0 视频节点", category: "video" },
    { value: "sora2Video", label: "Sora 2 视频节点", category: "video" },
    { value: "wan26", label: "Wan 2.6 视频节点", category: "video" },
    { value: "wan2R2V", label: "Wan 参考视频节点", category: "video" },
    { value: "happyhorseR2V", label: "快乐马节点", category: "video" },
    { value: "wan27Video", label: "Wan 2.7 视频节点", category: "video" },
  ],
};

const normalizeManagedModelTaskType = (value?: string): ManagedModelTaskType => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "text" || normalized === "input") return "text";
  if (normalized === "image") return "image";
  return "video";
};

const inferManagedNodeTemplate = (model: Partial<ManagedModelConfig>): string => {
  const modelKey = String(model.modelKey || "")
    .trim()
    .toLowerCase();
  if (model.metadata?.nodeConfig && typeof model.metadata.nodeConfig === "object") {
    const explicit = String((model.metadata.nodeConfig as any).flowNodeType || "").trim();
    if (explicit) return explicit;
  }
  if (modelKey === "kling-2.6") return "kling26Video";
  if (modelKey === "kling-3.0") return "kling30Video";
  if (modelKey === "kling-o3") return "klingO1Video";
  if (modelKey === "vidu-q3") return "viduVideo";
  if (modelKey === "seedance-1.5") return "doubaoVideo";
  if (modelKey === "seedance-2.0") return "seedance20Video";
  if (modelKey === "sora-2") return "sora2Video";
  if (modelKey === "seedream5") return "seedream5";
  if (modelKey === "wan-2.6") return "wan26";
  if (modelKey === "wan-2.6-r2v") return "wan2R2V";
  if (modelKey === "happyhorse-1.0-r2v") return "happyhorseR2V";
  if (modelKey === "wan-2.7") return "wan27Video";

  const taskType = normalizeManagedModelTaskType(model.taskType);
  return MANAGED_NODE_TEMPLATE_OPTIONS[taskType][0]?.value || "kling30Video";
};

const shouldReuseTemplateNodeKey = (modelKey?: string): boolean => {
  const normalized = String(modelKey || "")
    .trim()
    .toLowerCase();
  return [
    "kling-2.6",
    "kling-3.0",
    "kling-o3",
    "vidu-q2",
    "vidu-q3",
    "sora-2",
    "seedance-1.5",
    "seedance-2.0",
    "seedream5",
    "midjourney",
    "wan-2.6",
    "wan-2.6-r2v",
    "happyhorse-1.0-r2v",
    "wan-2.7",
  ].includes(normalized);
};

const buildManagedNodeConfig = (
  model: Partial<ManagedModelConfig>,
  overrides?: Partial<ManagedModelNodeConfig>
): ManagedModelNodeConfig => {
  const taskType = normalizeManagedModelTaskType(model.taskType);
  const flowNodeType =
    overrides?.flowNodeType ||
    (model.metadata?.nodeConfig &&
    typeof model.metadata.nodeConfig === "object" &&
    typeof (model.metadata.nodeConfig as any).flowNodeType === "string"
      ? String((model.metadata.nodeConfig as any).flowNodeType)
      : inferManagedNodeTemplate(model));
  const matchedTemplate =
    MANAGED_NODE_TEMPLATE_OPTIONS[taskType].find((item) => item.value === flowNodeType) ||
    MANAGED_NODE_TEMPLATE_OPTIONS[taskType][0];
  const defaultVendorCredits = (() => {
    const vendors = Array.isArray(model.vendors) ? model.vendors : [];
    const preferredVendor =
      vendors.find((vendor) => vendor.vendorKey === model.defaultVendor) || vendors[0];
    const credits = Number(getVendorPricingDefaults(preferredVendor).credits);
    return Number.isFinite(credits) && credits >= 0 ? credits : 0;
  })();
  return {
    enabled: true,
    nodeKey:
      overrides?.nodeKey ||
      (model.metadata?.nodeConfig &&
      typeof model.metadata.nodeConfig === "object" &&
      typeof (model.metadata.nodeConfig as any).nodeKey === "string"
        ? String((model.metadata.nodeConfig as any).nodeKey)
        : shouldReuseTemplateNodeKey(model.modelKey)
        ? matchedTemplate?.value || flowNodeType
        : ""),
    flowNodeType: matchedTemplate?.value || flowNodeType,
    category: overrides?.category || matchedTemplate?.category || (taskType === "text" ? "input" : taskType),
    creditsPerCall:
      typeof overrides?.creditsPerCall === "number"
        ? overrides.creditsPerCall
        : defaultVendorCredits,
    sortOrder: typeof overrides?.sortOrder === "number" ? overrides.sortOrder : undefined,
    description: overrides?.description || "",
  };
};

const getManagedNodeConfig = (model: Partial<ManagedModelConfig>): ManagedModelNodeConfig => {
  const existing =
    model.metadata?.nodeConfig && typeof model.metadata.nodeConfig === "object"
      ? (model.metadata.nodeConfig as ManagedModelNodeConfig)
      : undefined;
  return buildManagedNodeConfig(model, existing);
};

const DEFAULT_SEEDANCE20_V2_VENDOR_METADATA = {
  executionBranch: "v2_request_profile",
  requestProfile: {
    enabled: true,
    version: "v2",
    create: {
      method: "POST",
      path: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      headers: {
        Authorization: "{{auth.bearer}}",
        "Content-Type": "application/json",
      },
      body: {
        model: "{{request.seedanceUpstreamModelId}}",
        content: "{{request.content}}",
        video_mode: "{{request.videoMode}}",
        generate_audio: "{{request.generateAudio}}",
        ratio: "{{request.aspectRatio}}",
        duration: "{{request.duration}}",
        resolution: "{{request.resolution}}",
        watermark: "{{request.watermark}}",
      },
      responseMapping: {
        taskId: ["id", "platform_id"],
        status: ["status"],
      },
    },
    query: {
      method: "GET",
      path: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{{task.id}}",
      headers: {
        Authorization: "{{auth.bearer}}",
      },
      responseMapping: {
        status: ["status"],
        videoUrl: ["content.video_url"],
        error: ["error.message", "reason"],
      },
    },
  },
} as const;

const SEEDANCE20_SUPPORTED_MODELS = ["seedance-1.5-pro", "seedance-2.0", "seedance-2.0-fast"];
const SEEDANCE20_VOD_METADATA = {
  outputConfig: {
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480P", "720P"],
    audioGeneration: true,
  },
  inputModes: [
    "text",
    "first_frame",
    "start_end",
    "reference_images",
    "smart_frames",
    "reference_video",
    "image_audio",
    "image_video",
    "video_audio",
    "image_video_audio",
  ],
  notes: [
    "当前接入模型 ID: doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128",
    "多图参考支持 1-9 张图片，首尾帧固定 2 张，智能多帧支持 2-10 张图片",
  ],
} as const;

const DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA = {
  executionBranch: "v2_request_profile",
  requestProfile: {
    enabled: true,
    version: "v2",
    transport: "tencent_vod_aigc_video",
    create: {
      body: {
        modelName: "{{vendor.modelName}}",
        modelVersion: "{{vendor.modelVersion}}",
        prompt: "{{vod.prompt}}",
        fileInfos: "{{vod.fileInfos}}",
        lastFrameUrl: "{{vod.lastFrameUrl}}",
        aspectRatio: "{{vod.aspectRatio}}",
        duration: "{{vod.duration}}",
        resolution: "{{vod.resolution}}",
        storageMode: "{{vod.storageMode}}",
        enhancePrompt: "{{vod.enhancePrompt}}",
      },
      responseMapping: {
        taskId: ["taskId"],
        requestId: ["requestId"],
      },
    },
    query: {
      responseMapping: {
        status: ["status"],
        videoUrl: ["videoUrl"],
        fileId: ["fileId"],
        requestId: ["requestId"],
      },
    },
  },
} as const;

const DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA = {
  executionBranch: "v2_request_profile",
  requestProfile: {
    enabled: true,
    version: "v2",
    transport: "tencent_vod_aigc_video",
    create: {
      body: {
        modelName: "{{vendor.modelName}}",
        modelVersion: "{{vendor.modelVersion}}",
        prompt: "{{vod.prompt}}",
        fileInfos: "{{vod.fileInfos}}",
        aspectRatio: "{{vod.aspectRatio}}",
        duration: "{{vod.duration}}",
        resolution: "{{vod.resolution}}",
        audioGeneration: "{{vod.audioGeneration}}",
        storageMode: "{{vod.storageMode}}",
        enhancePrompt: "{{vod.enhancePrompt}}",
      },
      responseMapping: {
        taskId: ["taskId"],
        requestId: ["requestId"],
      },
    },
    query: {
      responseMapping: {
        status: ["status"],
        videoUrl: ["videoUrl"],
        fileId: ["fileId"],
        requestId: ["requestId"],
      },
    },
  },
} as const;

const DEFAULT_TENCENT_VOD_PLATFORM_METADATA = {
  service: "tencent_vod",
  endpoint: "https://vod.tencentcloudapi.com/",
  upstreamDomain: "vod.tencentcloudapi.com",
  apiVersion: "2018-07-17",
  createTask: {
    method: "POST",
    action: "CreateAigcVideoTask",
    url: "https://vod.tencentcloudapi.com/",
  },
  queryTask: {
    method: "POST",
    action: "DescribeTaskDetail",
    url: "https://vod.tencentcloudapi.com/",
  },
  polling: {
    strategy: "describe_task_detail",
    successStatuses: ["FINISH", "SUCCESS", "SUCCEEDED", "COMPLETED"],
    processingStatuses: ["WAITING", "PROCESSING", "RUNNING", "QUEUED", "PENDING"],
    failedStatuses: ["FAIL", "FAILED", "ERROR", "CANCELED", "CANCELLED"],
  },
  responseMapping: {
    taskId: ["Response.TaskId"],
    status: ["Response.Status", "Response.TaskStatus"],
    fileId: ["Response.FileId", "Response.MediaInfo.FileId"],
    fileUrl: ["Response.FileUrl", "Response.MediaUrl", "Response.PlayUrl"],
    message: ["Response.Message", "Response.Error.Message"],
    requestId: ["Response.RequestId"],
  },
} as const;

const DEFAULT_MODEL_VENDOR_PLATFORMS: ManagedVendorPlatformConfig[] = [
  {
    platformKey: "legacy",
    platformName: "旧链路(Kapon)",
    enabled: true,
    route: "legacy",
    description: "保留当前默认老链路，未切厂商时回退使用",
  },
  {
    platformKey: "tencent_vod",
    platformName: "腾讯 VOD",
    enabled: true,
    route: "tencent_vod",
    description: "腾讯云 VOD AIGC 视频生成",
    metadata: DEFAULT_TENCENT_VOD_PLATFORM_METADATA,
  },
  {
    platformKey: "vidu_api",
    platformName: "Vidu API",
    enabled: true,
    route: "legacy",
    provider: "vidu",
    description: "Vidu 官方或兼容 API 渠道",
  },
  {
    platformKey: "sora2_api",
    platformName: "Sora 2 API",
    enabled: true,
    route: "legacy",
    provider: "sora2",
    description: "Sora 2 视频生成渠道占位",
  },
  {
    platformKey: "seedance_api",
    platformName: "Seedance API",
    enabled: true,
    route: "legacy",
    provider: "doubao",
    description: "Seedance 视频生成渠道占位",
  },
];

const DEFAULT_MODEL_CATALOG: ManagedModelConfig[] = [
  {
    modelKey: "gemini-2.5-image",
    modelName: "Nano Banana Fast",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-2.5",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-2.5-image",
          taskType: "image",
          vendors: [{ vendorKey: "banana-2.5", creditsPerCall: 20 }],
          defaultVendor: "banana-2.5",
        },
        {
          flowNodeType: "generate",
          nodeKey: "generate",
          category: "image",
          creditsPerCall: 20,
          description: "Nano Banana Fast 文生图",
        }
      ),
      specPricing: {
        defaults: { credits: 20 },
        rules: [],
      },
    },
    vendors: [
      {
        vendorKey: "banana-2.5",
        platformKey: "banana-2.5",
        label: "Fast / Nano Banana 2.5",
        enabled: true,
        route: "legacy",
        provider: "banana-2.5",
        modelName: "Nano Banana",
        modelVersion: "2.5",
        creditsPerCall: 20,
        pricing: {
          defaults: { credits: 20, priceYuan: 0.2 },
          rules: [],
        },
      },
    ],
  },
  {
    modelKey: "gemini-3-pro-image",
    modelName: "Nano Banana Pro",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-3-pro-image",
          taskType: "image",
          vendors: [{ vendorKey: "banana", creditsPerCall: 40 }],
          defaultVendor: "banana",
        },
        {
          flowNodeType: "generatePro",
          nodeKey: "generatePro",
          category: "image",
          creditsPerCall: 40,
          description: "Nano Banana Pro 高质量生图",
        }
      ),
      specPricing: {
        defaults: { credits: 40 },
        rules: [
          { when: { resolution: "2K" }, price: { credits: 60, priceYuan: 0.6 } },
          { when: { resolution: "4K" }, price: { credits: 80, priceYuan: 0.8 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana",
        platformKey: "banana",
        label: "Pro / Nano Banana Pro",
        enabled: true,
        route: "legacy",
        provider: "banana",
        modelName: "Nano Banana Pro",
        modelVersion: "3.0",
        creditsPerCall: 40,
        pricing: {
          defaults: { credits: 40, priceYuan: 0.4 },
          rules: [
            { when: { resolution: "2K" }, price: { credits: 60, priceYuan: 0.6 } },
            { when: { resolution: "4K" }, price: { credits: 80, priceYuan: 0.8 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-3.1-image",
    modelName: "Nano Banana 2",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-3.1",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-3.1-image",
          taskType: "image",
          vendors: [{ vendorKey: "banana-3.1", creditsPerCall: 30 }],
          defaultVendor: "banana-3.1",
        },
        {
          flowNodeType: "generatePro",
          nodeKey: "generatePro",
          category: "image",
          creditsPerCall: 30,
          description: "Nano Banana 2 生图",
        }
      ),
      specPricing: {
        defaults: { credits: 30 },
        rules: [
          { when: { resolution: "0.5K" }, price: { credits: 30, priceYuan: 0.3 } },
          { when: { resolution: "2K" }, price: { credits: 40, priceYuan: 0.4 } },
          { when: { resolution: "4K" }, price: { credits: 50, priceYuan: 0.5 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana-3.1",
        platformKey: "banana-3.1",
        label: "Ultra / Nano Banana 2",
        enabled: true,
        route: "legacy",
        provider: "banana-3.1",
        modelName: "Nano Banana 2",
        modelVersion: "3.1",
        creditsPerCall: 30,
        pricing: {
          defaults: { credits: 30, priceYuan: 0.3 },
          rules: [
            { when: { resolution: "0.5K" }, price: { credits: 30, priceYuan: 0.3 } },
            { when: { resolution: "2K" }, price: { credits: 40, priceYuan: 0.4 } },
            { when: { resolution: "4K" }, price: { credits: 50, priceYuan: 0.5 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-image-edit",
    modelName: "Nano Banana Pro 图像编辑",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-image-edit",
          taskType: "image",
          vendors: [{ vendorKey: "banana", creditsPerCall: 40 }],
          defaultVendor: "banana",
        },
        {
          flowNodeType: "generatePro",
          nodeKey: "generatePro",
          category: "image",
          creditsPerCall: 40,
          description: "Nano Banana Pro 图像编辑",
        }
      ),
      specPricing: {
        defaults: { credits: 40 },
        rules: [
          { when: { resolution: "2K" }, price: { credits: 60, priceYuan: 0.6 } },
          { when: { resolution: "4K" }, price: { credits: 80, priceYuan: 0.8 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana",
        platformKey: "banana",
        label: "Pro / Nano Banana Pro",
        enabled: true,
        route: "legacy",
        provider: "banana",
        modelName: "Nano Banana Pro Edit",
        modelVersion: "3.0",
        creditsPerCall: 40,
        pricing: {
          defaults: { credits: 40, priceYuan: 0.4 },
          rules: [
            { when: { resolution: "2K" }, price: { credits: 60, priceYuan: 0.6 } },
            { when: { resolution: "4K" }, price: { credits: 80, priceYuan: 0.8 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-3.1-image-edit",
    modelName: "Nano Banana 2 图像编辑",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-3.1",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-3.1-image-edit",
          taskType: "image",
          vendors: [{ vendorKey: "banana-3.1", creditsPerCall: 30 }],
          defaultVendor: "banana-3.1",
        },
        {
          flowNodeType: "generatePro",
          nodeKey: "generatePro",
          category: "image",
          creditsPerCall: 30,
          description: "Nano Banana 2 图像编辑",
        }
      ),
      specPricing: {
        defaults: { credits: 30 },
        rules: [
          { when: { resolution: "0.5K" }, price: { credits: 30, priceYuan: 0.3 } },
          { when: { resolution: "2K" }, price: { credits: 40, priceYuan: 0.4 } },
          { when: { resolution: "4K" }, price: { credits: 50, priceYuan: 0.5 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana-3.1",
        platformKey: "banana-3.1",
        label: "Ultra / Nano Banana 2",
        enabled: true,
        route: "legacy",
        provider: "banana-3.1",
        modelName: "Nano Banana 2 Edit",
        modelVersion: "3.1",
        creditsPerCall: 30,
        pricing: {
          defaults: { credits: 30, priceYuan: 0.3 },
          rules: [
            { when: { resolution: "0.5K" }, price: { credits: 30, priceYuan: 0.3 } },
            { when: { resolution: "2K" }, price: { credits: 40, priceYuan: 0.4 } },
            { when: { resolution: "4K" }, price: { credits: 50, priceYuan: 0.5 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-image-blend",
    modelName: "Nano Banana Pro 图像融合",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-image-blend",
          taskType: "image",
          vendors: [{ vendorKey: "banana", creditsPerCall: 40 }],
          defaultVendor: "banana",
        },
        {
          flowNodeType: "generateReference",
          nodeKey: "generateReference",
          category: "image",
          creditsPerCall: 40,
          description: "Nano Banana Pro 图像融合",
        }
      ),
      specPricing: {
        defaults: { credits: 40 },
        rules: [
          { when: { resolution: "2K" }, price: { credits: 60, priceYuan: 0.6 } },
          { when: { resolution: "4K" }, price: { credits: 80, priceYuan: 0.8 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana",
        platformKey: "banana",
        label: "Pro / Nano Banana Pro",
        enabled: true,
        route: "legacy",
        provider: "banana",
        modelName: "Nano Banana Pro Blend",
        modelVersion: "3.0",
        creditsPerCall: 40,
        pricing: {
          defaults: { credits: 40, priceYuan: 0.4 },
          rules: [
            { when: { resolution: "2K" }, price: { credits: 60, priceYuan: 0.6 } },
            { when: { resolution: "4K" }, price: { credits: 80, priceYuan: 0.8 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-3.1-image-blend",
    modelName: "Nano Banana 2 图像融合",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-3.1",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-3.1-image-blend",
          taskType: "image",
          vendors: [{ vendorKey: "banana-3.1", creditsPerCall: 30 }],
          defaultVendor: "banana-3.1",
        },
        {
          flowNodeType: "generateReference",
          nodeKey: "generateReference",
          category: "image",
          creditsPerCall: 30,
          description: "Nano Banana 2 图像融合",
        }
      ),
      specPricing: {
        defaults: { credits: 30 },
        rules: [
          { when: { resolution: "0.5K" }, price: { credits: 30, priceYuan: 0.3 } },
          { when: { resolution: "2K" }, price: { credits: 40, priceYuan: 0.4 } },
          { when: { resolution: "4K" }, price: { credits: 50, priceYuan: 0.5 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana-3.1",
        platformKey: "banana-3.1",
        label: "Ultra / Nano Banana 2",
        enabled: true,
        route: "legacy",
        provider: "banana-3.1",
        modelName: "Nano Banana 2 Blend",
        modelVersion: "3.1",
        creditsPerCall: 30,
        pricing: {
          defaults: { credits: 30, priceYuan: 0.3 },
          rules: [
            { when: { resolution: "0.5K" }, price: { credits: 30, priceYuan: 0.3 } },
            { when: { resolution: "2K" }, price: { credits: 40, priceYuan: 0.4 } },
            { when: { resolution: "4K" }, price: { credits: 50, priceYuan: 0.5 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-image-analyze",
    modelName: "Nano Banana Pro 图像分析",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-image-analyze",
          taskType: "image",
          vendors: [{ vendorKey: "banana", creditsPerCall: 30 }],
          defaultVendor: "banana",
        },
        {
          flowNodeType: "analysis",
          nodeKey: "analysis",
          category: "image",
          creditsPerCall: 30,
          description: "Nano Banana Pro 图像分析",
        }
      ),
      specPricing: {
        defaults: { credits: 30 },
        rules: [
          { when: { resolution: "source" }, price: { credits: 30, priceYuan: 0.3 } },
        ],
      },
    },
    vendors: [
      {
        vendorKey: "banana",
        platformKey: "banana",
        label: "Pro / Nano Banana Pro",
        enabled: true,
        route: "legacy",
        provider: "banana",
        modelName: "Nano Banana Pro Analyze",
        modelVersion: "3.0",
        creditsPerCall: 30,
        pricing: {
          defaults: { credits: 30, priceYuan: 0.3 },
          rules: [
            { when: { resolution: "source" }, price: { credits: 30, priceYuan: 0.3 } },
          ],
        },
      },
    ],
  },
  {
    modelKey: "gemini-2.5-image-edit",
    modelName: "Nano Banana Fast 图像编辑",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-2.5",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-2.5-image-edit",
          taskType: "image",
          vendors: [{ vendorKey: "banana-2.5", creditsPerCall: 20 }],
          defaultVendor: "banana-2.5",
        },
        {
          flowNodeType: "generatePro",
          nodeKey: "generatePro",
          category: "image",
          creditsPerCall: 20,
          description: "Nano Banana Fast 图像编辑",
        }
      ),
      specPricing: {
        defaults: { credits: 20 },
        rules: [],
      },
    },
    vendors: [
      {
        vendorKey: "banana-2.5",
        platformKey: "banana-2.5",
        label: "Fast / Nano Banana 2.5",
        enabled: true,
        route: "legacy",
        provider: "banana-2.5",
        modelName: "Nano Banana Edit",
        modelVersion: "2.5",
        creditsPerCall: 20,
        pricing: {
          defaults: { credits: 20, priceYuan: 0.2 },
          rules: [],
        },
      },
    ],
  },
  {
    modelKey: "gemini-2.5-image-blend",
    modelName: "Nano Banana Fast 图像融合",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-2.5",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-2.5-image-blend",
          taskType: "image",
          vendors: [{ vendorKey: "banana-2.5", creditsPerCall: 20 }],
          defaultVendor: "banana-2.5",
        },
        {
          flowNodeType: "generateReference",
          nodeKey: "generateReference",
          category: "image",
          creditsPerCall: 20,
          description: "Nano Banana Fast 图像融合",
        }
      ),
      specPricing: {
        defaults: { credits: 20 },
        rules: [],
      },
    },
    vendors: [
      {
        vendorKey: "banana-2.5",
        platformKey: "banana-2.5",
        label: "Fast / Nano Banana 2.5",
        enabled: true,
        route: "legacy",
        provider: "banana-2.5",
        modelName: "Nano Banana Blend",
        modelVersion: "2.5",
        creditsPerCall: 20,
        pricing: {
          defaults: { credits: 20, priceYuan: 0.2 },
          rules: [],
        },
      },
    ],
  },
  {
    modelKey: "gemini-2.5-image-analyze",
    modelName: "Nano Banana Fast 图像分析",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-2.5",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-2.5-image-analyze",
          taskType: "image",
          vendors: [{ vendorKey: "banana-2.5", creditsPerCall: 10 }],
          defaultVendor: "banana-2.5",
        },
        {
          flowNodeType: "analysis",
          nodeKey: "analysis",
          category: "image",
          creditsPerCall: 10,
          description: "Nano Banana Fast 图像分析",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "banana-2.5",
        platformKey: "banana-2.5",
        label: "Fast / Nano Banana 2.5",
        enabled: true,
        route: "legacy",
        provider: "banana-2.5",
        modelName: "Nano Banana Analyze",
        modelVersion: "2.5",
        creditsPerCall: 10,
      },
    ],
  },
  {
    modelKey: "gemini-3.1-image-analyze",
    modelName: "Nano Banana Ultra 图像分析",
    taskType: "image",
    enabled: true,
    defaultVendor: "banana-3.1",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "gemini-3.1-image-analyze",
          taskType: "image",
          vendors: [{ vendorKey: "banana-3.1", creditsPerCall: 20 }],
          defaultVendor: "banana-3.1",
        },
        {
          flowNodeType: "analysis",
          nodeKey: "analysis",
          category: "image",
          creditsPerCall: 20,
          description: "Nano Banana Ultra 图像分析",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "banana-3.1",
        platformKey: "banana-3.1",
        label: "Ultra / Nano Banana 2",
        enabled: true,
        route: "legacy",
        provider: "banana-3.1",
        modelName: "Nano Banana 2 Analyze",
        modelVersion: "3.1",
        creditsPerCall: 20,
      },
    ],
  },
  {
    modelKey: "seedream5",
    modelName: "Seedream 5.0",
    taskType: "image",
    enabled: true,
    defaultVendor: "seedream5",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "seedream5",
          taskType: "image",
          vendors: [{ vendorKey: "seedream5", creditsPerCall: 30 }],
          defaultVendor: "seedream5",
        },
        {
          flowNodeType: "seedream5",
          nodeKey: "seedream5",
          category: "image",
          creditsPerCall: 30,
          description: "Seedream 5.0 图像生成",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "seedream5",
        platformKey: "seedream5",
        label: "Seedream 5.0",
        enabled: true,
        route: "legacy",
        provider: "seedream5",
        modelName: "Seedream",
        modelVersion: "5.0",
        creditsPerCall: 30,
      },
    ],
  },
  {
    modelKey: "midjourney",
    modelName: "Midjourney",
    taskType: "image",
    enabled: true,
    defaultVendor: "midjourney",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "midjourney",
          taskType: "image",
          vendors: [{ vendorKey: "midjourney", creditsPerCall: 50 }],
          defaultVendor: "midjourney",
        },
        {
          flowNodeType: "midjourney",
          nodeKey: "midjourney",
          category: "image",
          creditsPerCall: 50,
          description: "Midjourney 生图",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "midjourney",
        platformKey: "midjourney",
        label: "Midjourney",
        enabled: true,
        route: "legacy",
        provider: "midjourney",
        modelName: "Midjourney",
        modelVersion: "fast",
        creditsPerCall: 50,
      },
    ],
  },
  {
    modelKey: "wan-2.6",
    modelName: "Wan 2.6",
    taskType: "video",
    enabled: true,
    defaultVendor: "dashscope",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "wan-2.6",
          taskType: "video",
          vendors: [{ vendorKey: "dashscope", creditsPerCall: 600 }],
          defaultVendor: "dashscope",
        },
        {
          flowNodeType: "wan26",
          nodeKey: "wan26",
          category: "video",
          creditsPerCall: 600,
          description: "Wan 2.6 视频生成",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "dashscope",
        platformKey: "dashscope",
        label: "DashScope",
        enabled: true,
        route: "legacy",
        provider: "dashscope",
        modelName: "Wan",
        modelVersion: "2.6",
        creditsPerCall: 400,
        priceYuan: 4,
        pricing: createWanPricingTemplate(["t2v", "i2v"]),
      },
    ],
  },
  {
    modelKey: "wan-2.6-r2v",
    modelName: "Wan 2.6 参考视频",
    taskType: "video",
    enabled: true,
    defaultVendor: "dashscope",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "wan-2.6-r2v",
          taskType: "video",
          vendors: [{ vendorKey: "dashscope", creditsPerCall: 600 }],
          defaultVendor: "dashscope",
        },
        {
          flowNodeType: "wan2R2V",
          nodeKey: "wan2R2V",
          category: "video",
          creditsPerCall: 600,
          description: "Wan 2.6 参考视频生成",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "dashscope",
        platformKey: "dashscope",
        label: "DashScope",
        enabled: true,
        route: "legacy",
        provider: "dashscope",
        modelName: "Wan",
        modelVersion: "2.6-r2v",
        creditsPerCall: 400,
        priceYuan: 4,
        pricing: createWanPricingTemplate(["r2v"]),
      },
    ],
  },
  {
    modelKey: "happyhorse-1.0-r2v",
    modelName: "HappyHorse",
    taskType: "video",
    enabled: true,
    defaultVendor: "dashscope",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "happyhorse-1.0-r2v",
          taskType: "video",
          vendors: [{ vendorKey: "dashscope", creditsPerCall: 600 }],
          defaultVendor: "dashscope",
        },
        {
          flowNodeType: "happyhorseR2V",
          nodeKey: "happyhorseR2V",
          category: "video",
          creditsPerCall: 600,
          description: "快乐马 1.0 参考图视频生成（按分辨率×时长动态计费）",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "dashscope",
        platformKey: "dashscope",
        label: "DashScope",
        enabled: true,
        route: "legacy",
        provider: "dashscope",
        modelName: "HappyHorse",
        modelVersion: "1.0-r2v",
        creditsPerCall: 600,
        priceYuan: 6,
      },
    ],
  },
  {
    modelKey: "wan-2.7",
    modelName: "Wan 2.7",
    taskType: "video",
    enabled: true,
    defaultVendor: "dashscope",
    metadata: {
      nodeConfig: buildManagedNodeConfig(
        {
          modelKey: "wan-2.7",
          taskType: "video",
          vendors: [{ vendorKey: "dashscope", creditsPerCall: 600 }],
          defaultVendor: "dashscope",
        },
        {
          flowNodeType: "wan27Video",
          nodeKey: "wan27Video",
          category: "video",
          creditsPerCall: 600,
          description: "Wan 2.7 I2V 视频生成",
        }
      ),
    },
    vendors: [
      {
        vendorKey: "dashscope",
        platformKey: "dashscope",
        label: "DashScope",
        enabled: true,
        route: "legacy",
        provider: "dashscope",
        modelName: "Wan",
        modelVersion: "2.7-i2v",
        creditsPerCall: 400,
        priceYuan: 4,
        pricing: createWanPricingTemplate(["i2v"]),
      },
    ],
  },
  {
    modelKey: "kling-2.6",
    modelName: "Kling 2.6",
    taskType: "video",
    enabled: true,
    defaultVendor: "legacy",
    vendors: [
      {
        vendorKey: "legacy",
        platformKey: "legacy",
        label: "旧链路(Kapon)",
        enabled: true,
        route: "legacy",
        provider: "kling-2.6",
        modelName: "Kling",
        modelVersion: "2.6",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "kling-2.6",
        modelName: "Kling",
        modelVersion: "2.6",
      },
    ],
  },
  {
    modelKey: "kling-3.0",
    modelName: "Kling 3.0",
    taskType: "video",
    enabled: true,
    defaultVendor: "legacy",
    vendors: [
      {
        vendorKey: "legacy",
        platformKey: "legacy",
        label: "旧链路(Kapon)",
        enabled: true,
        route: "legacy",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0",
      },
    ],
  },
  {
    modelKey: "kling-o3",
    modelName: "Kling 3.0-Omni",
    taskType: "video",
    enabled: true,
    defaultVendor: "legacy",
    vendors: [
      {
        vendorKey: "legacy",
        platformKey: "legacy",
        label: "旧链路(Kapon)",
        enabled: true,
        route: "legacy",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0-Omni",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "kling-o3",
        modelName: "Kling",
        modelVersion: "3.0-Omni",
      },
    ],
  },
  {
    modelKey: "vidu-q2",
    modelName: "Vidu Q2",
    taskType: "video",
    enabled: true,
    defaultVendor: "vidu_api",
    vendors: [
      {
        vendorKey: "vidu_api",
        platformKey: "vidu_api",
        label: "Vidu API",
        enabled: true,
        route: "legacy",
        provider: "vidu",
        modelName: "Vidu",
        modelVersion: "Q2",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "vidu",
        modelName: "Vidu",
        modelVersion: "q2",
        metadata: DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
      },
    ],
  },
  {
    modelKey: "vidu-q3",
    modelName: "Vidu Q3",
    taskType: "video",
    enabled: true,
    defaultVendor: "vidu_api",
    vendors: [
      {
        vendorKey: "vidu_api",
        platformKey: "vidu_api",
        label: "Vidu API",
        enabled: true,
        route: "legacy",
        provider: "viduq3-pro",
        modelName: "Vidu",
        modelVersion: "Q3",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "vidu",
        modelName: "Vidu",
        modelVersion: "q3",
        metadata: DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
      },
    ],
  },
  {
    modelKey: "sora-2",
    modelName: "Sora 2",
    taskType: "video",
    enabled: true,
    defaultVendor: "sora2_api",
    vendors: [
      {
        vendorKey: "sora2_api",
        platformKey: "sora2_api",
        label: "Sora 2 API",
        enabled: true,
        route: "legacy",
        provider: "sora2",
        modelName: "Sora",
        modelVersion: "2.0",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "sora2",
        modelName: "OS",
        modelVersion: "2.0",
      },
    ],
  },
  {
    modelKey: "seedance-1.5",
    modelName: "Seedance 1.5",
    taskType: "video",
    enabled: true,
    defaultVendor: "seedance_api",
    vendors: [
      {
        vendorKey: "seedance_api",
        platformKey: "seedance_api",
        label: "Seedance API",
        enabled: true,
        route: "legacy",
        provider: "doubao",
        modelName: "Seedance",
        modelVersion: "1.5-pro",
      },
      {
        vendorKey: "tencent_vod",
        platformKey: "tencent_vod",
        label: "腾讯 VOD",
        enabled: false,
        route: "tencent_vod",
        provider: "doubao",
        modelName: "Seedance",
        modelVersion: "1.5-pro",
        metadata: DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA,
      },
    ],
  },
  {
    modelKey: "seedance-2.0",
    modelName: "Seedance 2.0",
    taskType: "video",
    enabled: true,
    defaultVendor: "seedance_api",
    vendors: [
      {
        vendorKey: "seedance_api",
        platformKey: "seedance_api",
        label: "Seedance API",
        enabled: true,
        route: "legacy",
        provider: "doubao",
        modelName: "Seedance",
        modelVersion: "2.0",
        metadata: DEFAULT_SEEDANCE20_V2_VENDOR_METADATA,
      },
    ],
  },
];

const DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE = JSON.stringify(
  {
    version: "v2",
    platforms: DEFAULT_MODEL_VENDOR_PLATFORMS,
    models: DEFAULT_MODEL_CATALOG,
  },
  null,
  2
);

const createEmptyVendor = (): ManagedModelVendorConfig => ({
  vendorKey: "",
  platformKey: "",
  label: "",
  enabled: true,
  route: "legacy",
  provider: "",
  modelName: "",
  modelVersion: "",
  pricing: {
    version: "v1",
    defaults: {
      credits: 0,
    },
  },
});

const createEmptyModel = (): ManagedModelConfig => ({
  modelKey: "",
  modelName: "",
  taskType: "video",
  enabled: true,
  defaultVendor: "",
  metadata: {
    nodeConfig: buildManagedNodeConfig({ taskType: "video" }),
  },
  vendors: [createEmptyVendor()],
});

const createEmptyPlatform = (): ManagedVendorPlatformConfig => ({
  platformKey: "",
  platformName: "",
  enabled: true,
  route: "legacy",
  provider: "",
  description: "",
});

const ensureModelDefaultVendor = (model: ManagedModelConfig): ManagedModelConfig => {
  const vendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
  if (!vendors.length) {
    return model;
  }

  const existingDefaultVendor =
    typeof model.defaultVendor === "string" ? model.defaultVendor.trim() : "";
  const resolvedDefaultVendor =
    (existingDefaultVendor && vendors.some((vendor) => vendor.vendorKey === existingDefaultVendor)
      ? existingDefaultVendor
      : "") ||
    vendors.find((vendor) => vendor.enabled !== false)?.vendorKey ||
    vendors[0]?.vendorKey ||
    "";

  return {
    ...model,
    defaultVendor: resolvedDefaultVendor,
    vendors: vendors.map((vendor) => ({
      ...vendor,
      enabled:
        vendor.vendorKey === resolvedDefaultVendor ? true : vendor.enabled !== false,
    })),
  };
};

const getDefaultVendorMetadataTemplate = (
  modelKey?: string,
  vendorKey?: string
): Record<string, any> | undefined => {
  const model = DEFAULT_MODEL_CATALOG.find((item) => item.modelKey === modelKey);
  const vendor = model?.vendors?.find((item) => item.vendorKey === vendorKey);
  return vendor?.metadata && typeof vendor.metadata === "object"
    ? JSON.parse(JSON.stringify(vendor.metadata))
    : undefined;
};

const validateManagedModelMapping = (input: ModelProviderMappingV2) => {
  const issues: string[] = [];

  (input.models || []).forEach((model) => {
    (model.vendors || []).forEach((vendor) => {
      const executionBranch = String(vendor.metadata?.executionBranch || "legacy").trim();
      const hasRequestProfile =
        !!vendor.metadata?.requestProfile &&
        typeof vendor.metadata.requestProfile === "object" &&
        vendor.metadata.requestProfile.enabled !== false;

      if (executionBranch === "v2_request_profile" && !hasRequestProfile) {
        issues.push(
          `${model.modelKey || "-"} / ${vendor.vendorKey || "-"} 缺少 metadata.requestProfile`
        );
      }
    });
  });

  if (issues.length) {
    throw new Error(`以下 V2 厂商配置不完整：${issues.join("；")}`);
  }
};

const normalizeModelMapping = (input?: Partial<ModelProviderMappingV2>): ModelProviderMappingV2 => {
  const inputPlatformMap = new Map(
    (Array.isArray(input?.platforms) ? input!.platforms!.filter(Boolean) : []).map((platform) => [
      typeof platform?.platformKey === "string" ? platform.platformKey : "",
      platform,
    ])
  );
  const mergedPlatformInputs = [
    ...(Array.isArray(input?.platforms) ? input!.platforms!.filter(Boolean) : []),
    ...DEFAULT_MODEL_VENDOR_PLATFORMS.filter(
      (platform) => platform.platformKey && !inputPlatformMap.has(platform.platformKey)
    ),
  ];

  const platforms: ManagedVendorPlatformConfig[] = mergedPlatformInputs.length
    ? mergedPlatformInputs.map((platform) => ({
        platformKey:
          typeof platform?.platformKey === "string" ? platform.platformKey : "",
        platformName:
          typeof platform?.platformName === "string" ? platform.platformName : "",
        enabled: platform?.enabled !== false,
        route:
          platform?.route === "tencent_vod"
            ? ("tencent_vod" as ModelVendorRouteType)
            : ("legacy" as ModelVendorRouteType),
        provider: typeof platform?.provider === "string" ? platform.provider : "",
        description:
          typeof platform?.description === "string" ? platform.description : "",
        metadata:
          platform?.metadata && typeof platform.metadata === "object"
            ? platform.metadata
            : undefined,
      }))
    : [];
  const defaultModelMap = new Map(
    DEFAULT_MODEL_CATALOG.filter((model) => model?.modelKey).map((model) => [model.modelKey, model])
  );
  const inputModels = Array.isArray(input?.models) ? input.models.filter(Boolean) : [];
  const inputModelMap = new Map(
    inputModels
      .filter((model) => typeof model?.modelKey === "string" && model.modelKey.trim())
      .map((model) => [model.modelKey, model])
  );
  const mergedModelInputs = [
    ...DEFAULT_MODEL_CATALOG.map((defaultModel) => inputModelMap.get(defaultModel.modelKey) || defaultModel),
    ...inputModels.filter((model) => {
      const modelKey = typeof model?.modelKey === "string" ? model.modelKey.trim() : "";
      return !modelKey || !defaultModelMap.has(modelKey);
    }),
  ];

  const models: ManagedModelConfig[] = mergedModelInputs.length
    ? mergedModelInputs.map((model) => ({
        modelKey: typeof model?.modelKey === "string" ? model.modelKey : "",
        modelName: typeof model?.modelName === "string" ? model.modelName : "",
        taskType: typeof model?.taskType === "string" ? model.taskType : "",
        enabled: model?.enabled !== false,
        defaultVendor:
          typeof model?.defaultVendor === "string" ? model.defaultVendor : "",
        vendors: Array.isArray(model?.vendors)
          ? model.vendors.map((vendor) => ({
              vendorKey: typeof vendor?.vendorKey === "string" ? vendor.vendorKey : "",
              platformKey:
                typeof vendor?.platformKey === "string" ? vendor.platformKey : "",
              label: typeof vendor?.label === "string" ? vendor.label : "",
              enabled: vendor?.enabled !== false,
              route:
                vendor?.route === "tencent_vod"
                  ? ("tencent_vod" as ModelVendorRouteType)
                  : ("legacy" as ModelVendorRouteType),
              provider: typeof vendor?.provider === "string" ? vendor.provider : "",
              modelName: typeof vendor?.modelName === "string" ? vendor.modelName : "",
              modelVersion:
                typeof vendor?.modelVersion === "string" ? vendor.modelVersion : "",
              creditsPerCall:
                typeof vendor?.creditsPerCall === "number" && Number.isFinite(vendor.creditsPerCall)
                  ? vendor.creditsPerCall
                  : undefined,
              priceYuan:
                typeof vendor?.priceYuan === "number" && Number.isFinite(vendor.priceYuan)
                  ? vendor.priceYuan
                  : undefined,
              pricing:
                vendor?.pricing && typeof vendor.pricing === "object"
                  ? vendor.pricing
                  : undefined,
              metadata:
                vendor?.metadata && typeof vendor.metadata === "object"
                  ? vendor.metadata
                  : undefined,
            }))
          : [],
        metadata:
          model?.metadata && typeof model.metadata === "object"
            ? model.metadata
            : undefined,
      }))
    : [];

  const normalized: ModelProviderMappingV2 = {
    version: typeof input?.version === "string" ? input.version : "v2",
    platforms,
    models,
  };

  return {
    ...normalized,
    models: (normalized.models || []).map((model) => {
      if (model.modelKey === "vidu-q2" || model.modelKey === "vidu-q3") {
        const isQ3 = model.modelKey === "vidu-q3";
        const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
        const legacyVendor =
          existingVendors.find((vendor) => vendor.vendorKey === "vidu_api") || {
            vendorKey: "vidu_api",
            platformKey: "vidu_api",
            label: "Vidu API",
            enabled: true,
            route: "legacy" as ModelVendorRouteType,
            provider: isQ3 ? "viduq3-pro" : "vidu",
            modelName: "Vidu",
            modelVersion: isQ3 ? "Q3" : "Q2",
          };
        const tencentVodVendor =
          existingVendors.find((vendor) => vendor.vendorKey === "tencent_vod") || {
            vendorKey: "tencent_vod",
            platformKey: "tencent_vod",
            label: "腾讯 VOD",
            enabled: false,
            route: "tencent_vod" as ModelVendorRouteType,
            provider: "vidu",
            modelName: "Vidu",
            modelVersion: isQ3 ? "q3" : "q2",
          };

        return ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || "vidu_api",
          vendors: [
            {
              ...legacyVendor,
              platformKey: "vidu_api",
              label: legacyVendor.label || "Vidu API",
              enabled: legacyVendor.enabled !== false,
              route: "legacy",
              provider: legacyVendor.provider || (isQ3 ? "viduq3-pro" : "vidu"),
              modelName: legacyVendor.modelName || "Vidu",
              modelVersion: legacyVendor.modelVersion || (isQ3 ? "Q3" : "Q2"),
            },
            {
              ...tencentVodVendor,
              platformKey: "tencent_vod",
              label: tencentVodVendor.label || "腾讯 VOD",
              enabled: tencentVodVendor.enabled === true,
              route: "tencent_vod",
              provider: tencentVodVendor.provider || "vidu",
              modelName: tencentVodVendor.modelName || "Vidu",
              modelVersion: tencentVodVendor.modelVersion || (isQ3 ? "q3" : "q2"),
              metadata:
                tencentVodVendor.metadata && typeof tencentVodVendor.metadata === "object"
                  ? tencentVodVendor.metadata
                  : DEFAULT_TENCENT_VOD_VIDU_V2_VENDOR_METADATA,
            },
          ],
        });
      }

      if (model.modelKey === "sora-2") {
        const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
        const soraApiVendor =
          existingVendors.find((vendor) => vendor.vendorKey === "sora2_api") || {
            vendorKey: "sora2_api",
            platformKey: "sora2_api",
            label: "Sora 2 API",
            enabled: true,
            route: "legacy" as ModelVendorRouteType,
            provider: "sora2",
            modelName: "Sora",
            modelVersion: "2.0",
          };
        const tencentVodVendor =
          existingVendors.find((vendor) => vendor.vendorKey === "tencent_vod") || {
            vendorKey: "tencent_vod",
            platformKey: "tencent_vod",
            label: "腾讯 VOD",
            enabled: false,
            route: "tencent_vod" as ModelVendorRouteType,
            provider: "sora2",
            modelName: "OS",
            modelVersion: "2.0",
          };

        return ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || "sora2_api",
          vendors: [
            {
              ...soraApiVendor,
              platformKey: "sora2_api",
              label: soraApiVendor.label || "Sora 2 API",
              enabled: soraApiVendor.enabled !== false,
              route: "legacy",
              provider: soraApiVendor.provider || "sora2",
              modelName: soraApiVendor.modelName || "Sora",
              modelVersion: soraApiVendor.modelVersion || "2.0",
            },
            {
              ...tencentVodVendor,
              platformKey: "tencent_vod",
              label: tencentVodVendor.label || "腾讯 VOD",
              enabled: tencentVodVendor.enabled === true,
              route: "tencent_vod",
              provider: tencentVodVendor.provider || "sora2",
              modelName: tencentVodVendor.modelName || "OS",
              modelVersion: tencentVodVendor.modelVersion || "2.0",
            },
          ],
        });
      }

      if (model.modelKey === "seedance-1.5") {
        const existingVendors = Array.isArray(model.vendors) ? model.vendors.filter(Boolean) : [];
        const seedanceVendor =
          existingVendors.find((vendor) => vendor.vendorKey === "seedance_api") || {
            vendorKey: "seedance_api",
            platformKey: "seedance_api",
            label: "Seedance API",
            enabled: true,
            route: "legacy" as ModelVendorRouteType,
            provider: "doubao",
            modelName: "Seedance",
            modelVersion: "1.5-pro",
          };
        const tencentVodVendor =
          existingVendors.find((vendor) => vendor.vendorKey === "tencent_vod") || {
            vendorKey: "tencent_vod",
            platformKey: "tencent_vod",
            label: "腾讯 VOD",
            enabled: false,
            route: "tencent_vod" as ModelVendorRouteType,
            provider: "doubao",
            modelName: "Seedance",
            modelVersion: "1.5-pro",
          };

        return ensureModelDefaultVendor({
          ...model,
          defaultVendor: model.defaultVendor || "seedance_api",
          vendors: [
            {
              ...seedanceVendor,
              platformKey: "seedance_api",
              label: seedanceVendor.label || "Seedance API",
              enabled: seedanceVendor.enabled !== false,
              route: "legacy",
              provider: seedanceVendor.provider || "doubao",
              modelName: seedanceVendor.modelName || "Seedance",
              modelVersion: seedanceVendor.modelVersion || "1.5-pro",
            },
            {
              ...tencentVodVendor,
              platformKey: "tencent_vod",
              label: tencentVodVendor.label || "腾讯 VOD",
              enabled: tencentVodVendor.enabled === true,
              route: "tencent_vod",
              provider: tencentVodVendor.provider || "doubao",
              modelName: tencentVodVendor.modelName || "Seedance",
              modelVersion: tencentVodVendor.modelVersion || "1.5-pro",
              metadata:
                tencentVodVendor.metadata && typeof tencentVodVendor.metadata === "object"
                  ? tencentVodVendor.metadata
                  : DEFAULT_TENCENT_VOD_SEEDANCE15_V2_VENDOR_METADATA,
            },
          ],
        });
      }

      if (model.modelKey !== "seedance-2.0") {
        return model;
      }

      const existingVendor =
        (model.vendors || []).find((vendor) => vendor.vendorKey === "seedance_api") || null;

      return ensureModelDefaultVendor({
        ...model,
        defaultVendor: "seedance_api",
        vendors: [
          {
            ...(existingVendor || {}),
            vendorKey: "seedance_api",
            platformKey: "seedance_api",
            label: existingVendor?.label || "Seedance API",
            enabled: existingVendor?.enabled !== false,
            route: "legacy",
            provider: "doubao",
            modelName: existingVendor?.modelName || "Seedance",
            modelVersion: "2.0",
            creditsPerCall:
              typeof existingVendor?.creditsPerCall === "number" && Number.isFinite(existingVendor.creditsPerCall)
                ? existingVendor.creditsPerCall
                : undefined,
            priceYuan:
              typeof existingVendor?.priceYuan === "number" && Number.isFinite(existingVendor.priceYuan)
                ? existingVendor.priceYuan
                : undefined,
            pricing:
              existingVendor?.pricing && typeof existingVendor.pricing === "object"
                ? existingVendor.pricing
                : undefined,
            metadata:
              existingVendor?.metadata && typeof existingVendor.metadata === "object"
                ? existingVendor.metadata
                : DEFAULT_SEEDANCE20_V2_VENDOR_METADATA,
          },
        ],
      });
    }).map((model) => ensureModelDefaultVendor(model)),
  };
};

const buildPersistedModelMapping = (input: ModelProviderMappingV2): ModelProviderMappingV2 => {
  const normalized = normalizeModelMapping(input);
  const platformMap = new Map(
    (normalized.platforms || []).map((platform) => [platform.platformKey, platform] as const)
  );

  return {
    ...normalized,
    models: (normalized.models || []).map((model) => ({
      ...model,
      vendors: (model.vendors || []).map((vendor) => {
        const platform =
          vendor.platformKey && platformMap.has(vendor.platformKey)
            ? platformMap.get(vendor.platformKey)
            : undefined;

        return {
          ...vendor,
          label: vendor.label || platform?.platformName || vendor.vendorKey,
          route: vendor.route || platform?.route || "legacy",
          provider: vendor.provider || platform?.provider || "",
        };
      }),
    })),
  };
};

const stringifyPrettyJson = (value: unknown) => JSON.stringify(value, null, 2);

type VideoModelRouteSelection = {
  sora2: "zhenzhen" | "147" | "apimart";
  seedance: "volcengine";
  kling: "kapon" | "tengxun";
  vidu: "kapon" | "tengxun";
};

const VIDEO_MODEL_ROUTE_DEFAULT_SELECTION: VideoModelRouteSelection = {
  sora2: "zhenzhen",
  seedance: "volcengine",
  kling: "tengxun",
  vidu: "tengxun",
};

const VIDEO_MODEL_ROUTE_OPTIONS: Record<
  keyof VideoModelRouteSelection,
  Array<{ value: string; label: string; description: string }>
> = {
  sora2: [
    { value: "zhenzhen", label: "贞贞", description: "Sora2 走贞贞供应商路线" },
    { value: "147", label: "147", description: "Sora2 走 147 供应商路线" },
    { value: "apimart", label: "api mart", description: "Sora2 走 api mart 供应商路线" },
  ],
  seedance: [
    { value: "volcengine", label: "火山引擎", description: "Seedance 固定走火山引擎路线" },
  ],
  kling: [
    { value: "kapon", label: "kapon", description: "Kling 使用 kapon 供应商路线" },
    { value: "tengxun", label: "腾讯", description: "Kling 使用腾讯供应商路线" },
  ],
  vidu: [
    { value: "kapon", label: "kapon", description: "Vidu 使用 kapon 供应商路线" },
    { value: "tengxun", label: "腾讯", description: "Vidu 使用腾讯供应商路线" },
  ],
};

const VIDEO_MODEL_KLING_KEYS = ["kling-2.6", "kling-3.0", "kling-o3"];
const VIDEO_MODEL_VIDU_KEYS = ["vidu-q2", "vidu-q3"];
const VIDEO_MODEL_SEEDANCE_KEYS = ["seedance-1.5", "seedance-2.0"];

const deriveVideoModelRouteSelection = (
  source?: Partial<ModelProviderMappingV2>
): VideoModelRouteSelection => {
  const normalized = normalizeModelMapping(source);
  const modelMap = new Map(
    (normalized.models || []).map((item) => [item.modelKey, item] as const)
  );

  const soraModel = modelMap.get("sora-2");
  const soraVendor = (soraModel?.vendors || []).find(
    (vendor) => vendor.vendorKey === "sora2_api"
  );
  const soraMarker = String(
    soraVendor?.metadata?.channel || soraVendor?.provider || ""
  )
    .trim()
    .toLowerCase();

  let sora2: VideoModelRouteSelection["sora2"] = "zhenzhen";
  if (soraMarker.includes("147")) {
    sora2 = "147";
  } else if (soraMarker.includes("api") || soraMarker.includes("mart")) {
    sora2 = "apimart";
  }

  const klingModel = VIDEO_MODEL_KLING_KEYS.map((key) => modelMap.get(key)).find(Boolean);
  const viduModel = VIDEO_MODEL_VIDU_KEYS.map((key) => modelMap.get(key)).find(Boolean);

  return {
    sora2,
    seedance: "volcengine",
    kling: klingModel?.defaultVendor === "tencent_vod" ? "tengxun" : "kapon",
    vidu: viduModel?.defaultVendor === "tencent_vod" ? "tengxun" : "kapon",
  };
};

const applyVideoModelRouteSelectionToMapping = (
  source: ModelProviderMappingV2,
  selection: VideoModelRouteSelection
): ModelProviderMappingV2 => {
  const normalized = normalizeModelMapping(source);
  const models = [...(normalized.models || [])];

  const ensureModel = (modelKey: string): ManagedModelConfig => {
    const existingIndex = models.findIndex((item) => item.modelKey === modelKey);
    if (existingIndex >= 0) {
      const existing = models[existingIndex];
      const cloned: ManagedModelConfig = {
        ...existing,
        vendors: (existing.vendors || []).map((vendor) => ({
          ...vendor,
          metadata:
            vendor.metadata && typeof vendor.metadata === "object"
              ? { ...vendor.metadata }
              : vendor.metadata,
        })),
      };
      models[existingIndex] = cloned;
      return cloned;
    }

    const fallback = DEFAULT_MODEL_CATALOG.find((item) => item.modelKey === modelKey);
    const createdSource: ManagedModelConfig = fallback
      ? JSON.parse(JSON.stringify(fallback))
      : {
          modelKey,
          modelName: modelKey,
          taskType: "video",
          enabled: true,
          defaultVendor: "",
          vendors: [],
        };

    const created =
      normalizeModelMapping({ models: [createdSource] }).models?.[0] || createdSource;
    models.push(created);
    return created;
  };

  const ensureVendor = (
    model: ManagedModelConfig,
    vendorKey: string,
    fallback: ManagedModelVendorConfig
  ): ManagedModelVendorConfig => {
    const vendors = [...(model.vendors || [])];
    const vendorIndex = vendors.findIndex((vendor) => vendor.vendorKey === vendorKey);
    const existing = vendorIndex >= 0 ? vendors[vendorIndex] : undefined;
    const nextVendor: ManagedModelVendorConfig = {
      ...fallback,
      ...existing,
      metadata:
        fallback.metadata || existing?.metadata
          ? {
              ...(fallback.metadata && typeof fallback.metadata === "object"
                ? fallback.metadata
                : {}),
              ...(existing?.metadata && typeof existing.metadata === "object"
                ? existing.metadata
                : {}),
            }
          : undefined,
    };

    if (vendorIndex >= 0) {
      vendors[vendorIndex] = nextVendor;
    } else {
      vendors.push(nextVendor);
    }

    model.vendors = vendors;
    return nextVendor;
  };

  const setActiveVendor = (model: ManagedModelConfig, activeVendorKey: string) => {
    model.vendors = (model.vendors || []).map((vendor) => ({
      ...vendor,
      enabled: vendor.vendorKey === activeVendorKey,
    }));
    model.defaultVendor = activeVendorKey;
    model.enabled = true;
  };

  const soraModel = ensureModel("sora-2");
  const soraProviderMap: Record<VideoModelRouteSelection["sora2"], string> = {
    zhenzhen: "sora2",
    "147": "147",
    apimart: "apimart",
  };
  const soraVendor = ensureVendor(soraModel, "sora2_api", {
    vendorKey: "sora2_api",
    platformKey: "sora2_api",
    label: "Sora2 API",
    enabled: true,
    route: "legacy",
    provider: soraProviderMap[selection.sora2],
    modelName: "Sora",
    modelVersion: "2.0",
  });
  const soraTencentVendor = ensureVendor(soraModel, "tencent_vod", {
    vendorKey: "tencent_vod",
    platformKey: "tencent_vod",
    label: "腾讯",
    enabled: false,
    route: "tencent_vod",
    provider: "sora2",
    modelName: "OS",
    modelVersion: "2.0",
  });
  soraVendor.provider = soraProviderMap[selection.sora2];
  soraVendor.enabled = true;
  soraVendor.route = "legacy";
  soraVendor.metadata = {
    ...(soraVendor.metadata && typeof soraVendor.metadata === "object"
      ? soraVendor.metadata
      : {}),
    channel: selection.sora2,
  };
  soraTencentVendor.enabled = false;
  soraTencentVendor.route = "tencent_vod";
  setActiveVendor(soraModel, "sora2_api");

  VIDEO_MODEL_SEEDANCE_KEYS.forEach((modelKey) => {
    const model = ensureModel(modelKey);
    const seedanceVendor = ensureVendor(model, "seedance_api", {
      vendorKey: "seedance_api",
      platformKey: "seedance_api",
      label: "火山引擎",
      enabled: true,
      route: "legacy",
      provider: "doubao",
      modelName: "Seedance",
      modelVersion: modelKey === "seedance-2.0" ? "2.0" : "1.5-pro",
    });
    seedanceVendor.label = "火山引擎";
    seedanceVendor.enabled = true;
    seedanceVendor.route = "legacy";
    seedanceVendor.provider = "doubao";

    const tencentVendor = ensureVendor(model, "tencent_vod", {
      vendorKey: "tencent_vod",
      platformKey: "tencent_vod",
      label: "腾讯",
      enabled: false,
      route: "tencent_vod",
      provider: "doubao",
      modelName: "Seedance",
      modelVersion: "1.5-pro",
    });
    tencentVendor.enabled = false;

    setActiveVendor(model, "seedance_api");
  });

  const klingLegacyMeta: Record<string, { provider: string; modelVersion: string }> = {
    "kling-2.6": { provider: "kling-2.6", modelVersion: "2.6" },
    "kling-3.0": { provider: "kling-o3", modelVersion: "3.0" },
    "kling-o3": { provider: "kling-o3", modelVersion: "3.0-Omni" },
  };

  VIDEO_MODEL_KLING_KEYS.forEach((modelKey) => {
    const meta = klingLegacyMeta[modelKey];
    const model = ensureModel(modelKey);

    const legacyVendor = ensureVendor(model, "legacy", {
      vendorKey: "legacy",
      platformKey: "legacy",
      label: "kapon",
      enabled: true,
      route: "legacy",
      provider: meta.provider,
      modelName: "Kling",
      modelVersion: meta.modelVersion,
    });
    legacyVendor.label = "kapon";
    legacyVendor.enabled = true;
    legacyVendor.route = "legacy";
    legacyVendor.provider = meta.provider;
    legacyVendor.modelName = "Kling";
    legacyVendor.modelVersion = meta.modelVersion;

    const tencentVendor = ensureVendor(model, "tencent_vod", {
      vendorKey: "tencent_vod",
      platformKey: "tencent_vod",
      label: "腾讯",
      enabled: false,
      route: "tencent_vod",
      provider: meta.provider,
      modelName: "Kling",
      modelVersion: meta.modelVersion,
    });
    tencentVendor.label = "腾讯";
    tencentVendor.route = "tencent_vod";
    tencentVendor.provider = meta.provider;
    tencentVendor.modelName = "Kling";
    tencentVendor.modelVersion = meta.modelVersion;

    const activeVendor = selection.kling === "tengxun" ? "tencent_vod" : "legacy";
    setActiveVendor(model, activeVendor);
  });

  const viduMeta: Record<string, { provider: string; modelVersion: string; tencentVersion: string }> = {
    "vidu-q2": { provider: "vidu", modelVersion: "Q2", tencentVersion: "q2" },
    "vidu-q3": { provider: "viduq3-pro", modelVersion: "Q3", tencentVersion: "q3" },
  };

  VIDEO_MODEL_VIDU_KEYS.forEach((modelKey) => {
    const meta = viduMeta[modelKey];
    const model = ensureModel(modelKey);

    const legacyVendor = ensureVendor(model, "vidu_api", {
      vendorKey: "vidu_api",
      platformKey: "vidu_api",
      label: "kapon",
      enabled: true,
      route: "legacy",
      provider: meta.provider,
      modelName: "Vidu",
      modelVersion: meta.modelVersion,
    });
    legacyVendor.label = "kapon";
    legacyVendor.enabled = true;
    legacyVendor.route = "legacy";
    legacyVendor.provider = meta.provider;
    legacyVendor.modelName = "Vidu";
    legacyVendor.modelVersion = meta.modelVersion;

    const tencentVendor = ensureVendor(model, "tencent_vod", {
      vendorKey: "tencent_vod",
      platformKey: "tencent_vod",
      label: "腾讯",
      enabled: false,
      route: "tencent_vod",
      provider: "vidu",
      modelName: "Vidu",
      modelVersion: meta.tencentVersion,
    });
    tencentVendor.label = "腾讯";
    tencentVendor.route = "tencent_vod";
    tencentVendor.provider = "vidu";
    tencentVendor.modelName = "Vidu";
    tencentVendor.modelVersion = meta.tencentVersion;

    const activeVendor = selection.vidu === "tengxun" ? "tencent_vod" : "vidu_api";
    setActiveVendor(model, activeVendor);
  });

  return normalizeModelMapping({
    ...normalized,
    models: models.map((model) => ensureModelDefaultVendor(model)),
  });
};
const MANAGED_MODEL_SUPPORTED_MODELS_MAP: Record<string, string[]> = {
  "gemini-2.5-image": ["gemini-2.5-flash-image-preview"],
  "gemini-2.5-image-edit": ["gemini-2.5-flash-image-preview"],
  "gemini-2.5-image-blend": ["gemini-2.5-flash-image-preview"],
  "gemini-2.5-image-analyze": ["gemini-2.5-flash-image-preview"],
  "gemini-3.1-image-analyze": ["gemini-3.1-flash-image-preview"],
  "seedream5": ["doubao-seedream-5-0-260128"],
  "midjourney": ["midjourney-fast"],
  "wan-2.6": ["wan2.6-t2v", "wan2.6-i2v"],
  "wan-2.6-r2v": ["wan2.6-r2v"],
  "happyhorse-1.0-r2v": ["happyhorse-1.0-r2v"],
  "wan-2.7": ["wan2.7-i2v"],
  "gemini-3-pro-image": ["gemini-2.5-flash-image-preview"],
  "gemini-3.1-image": ["gemini-3.1-flash-image-preview"],
  "gemini-image-edit": ["gemini-2.5-flash-image-preview"],
  "gemini-3.1-image-edit": ["gemini-3.1-flash-image-preview"],
  "gemini-image-blend": ["gemini-2.5-flash-image-preview"],
  "gemini-3.1-image-blend": ["gemini-3.1-flash-image-preview"],
  "gemini-image-analyze": ["gemini-2.5-flash-image-preview"],
  "kling-2.6": ["kling-v2-6"],
  "kling-3.0": ["kling-v3-0"],
  "kling-o3": ["kling-o3"],
  "vidu-q2": ["q2"],
  "vidu-q3": ["q3"],
  "seedance-1.5": ["seedance-1.5-pro"],
  "seedance-2.0": SEEDANCE20_SUPPORTED_MODELS,
  "sora-2": ["sora-2", "sora-2-pro"],
};

const MANAGED_MODEL_SERVICE_TYPE_MAP: Record<string, string> = {
  "gemini-2.5-image": "gemini-2.5-image",
  "gemini-2.5-image-edit": "gemini-2.5-image-edit",
  "gemini-2.5-image-blend": "gemini-2.5-image-blend",
  "gemini-2.5-image-analyze": "gemini-2.5-image-analyze",
  "gemini-3.1-image-analyze": "gemini-3.1-image-analyze",
  "seedream5": "doubao-seedream-5-0-260128",
  "midjourney": "midjourney-imagine",
  "wan-2.6": "wan26-video",
  "wan-2.6-r2v": "wan26-r2v",
  "happyhorse-1.0-r2v": "happyhorse-r2v-video",
  "wan-2.7": "wan27-video",
  "gemini-3-pro-image": "gemini-3-pro-image",
  "gemini-3.1-image": "gemini-3.1-image",
  "gemini-image-edit": "gemini-image-edit",
  "gemini-3.1-image-edit": "gemini-3.1-image-edit",
  "gemini-image-blend": "gemini-image-blend",
  "gemini-3.1-image-blend": "gemini-3.1-image-blend",
  "gemini-image-analyze": "gemini-image-analyze",
  "kling-2.6": "kling-2.6-video",
  "kling-3.0": "kling-3.0-video",
  "kling-o3": "kling-o1-video",
  "vidu-q2": "vidu-video",
  "vidu-q3": "viduq3-pro-video",
  "seedance-1.5": "doubao-video",
  "seedance-2.0": "doubao-video",
  "sora-2": "sora-sd",
};

const MANAGED_MODEL_OUTPUT_CONFIG_MAP: Record<
  string,
  {
    aspectRatios?: string[];
    durations?: number[];
    resolutions?: string[];
    audioGeneration?: boolean;
  }
> = {
  "kling-2.6": {
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "kling-3.0": {
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "kling-o3": {
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "vidu-q2": {
    aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"],
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    resolutions: ["540P", "720P", "1080P"],
  },
  "vidu-q3": {
    aspectRatios: ["16:9", "9:16", "3:4", "4:3", "1:1"],
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    resolutions: ["540P", "720P", "1080P"],
  },
  "seedance-1.5": {
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10],
    resolutions: ["720P"],
  },
  "seedance-2.0": {
    aspectRatios: [...SEEDANCE20_VOD_METADATA.outputConfig.aspectRatios],
    durations: [...SEEDANCE20_VOD_METADATA.outputConfig.durations],
    resolutions: [...SEEDANCE20_VOD_METADATA.outputConfig.resolutions],
    audioGeneration: SEEDANCE20_VOD_METADATA.outputConfig.audioGeneration,
  },
  "sora-2": {
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10, 15],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "wan-2.6": {
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [5, 10, 15],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "wan-2.6-r2v": {
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [5, 10, 15],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "happyhorse-1.0-r2v": {
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
  "wan-2.7": {
    durations: [5, 10, 15],
    resolutions: ["720P", "1080P"],
    audioGeneration: true,
  },
};


const MANAGED_IMAGE_PRICING_CONFIG_MAP: Record<
  string,
  {
    modes?: Array<{ value: string; label: string }>;
    imageSizes?: string[];
    qualities?: string[];
    outputCounts?: number[];
    referenceImageCounts?: number[];
  }
> = {
  "gemini-2.5-image": {
    modes: [{ value: "generate", label: "文生图" }],
    imageSizes: ["768", "1024", "1536", "2048", "1K", "2K"],
    qualities: ["standard", "hd"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [0],
  },
  "gemini-2.5-image-edit": {
    modes: [{ value: "edit", label: "图像编辑" }],
    imageSizes: ["768", "1024", "1536", "2048", "1K", "2K"],
    qualities: ["standard", "hd"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [1, 2, 4],
  },
  "gemini-2.5-image-blend": {
    modes: [{ value: "reference", label: "参考图生成" }],
    imageSizes: ["768", "1024", "1536", "2048", "1K", "2K"],
    qualities: ["standard", "hd"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [1, 2, 4],
  },
  "gemini-2.5-image-analyze": {
    modes: [{ value: "analysis", label: "图像分析" }],
    imageSizes: ["source"],
    qualities: ["standard"],
    outputCounts: [1],
    referenceImageCounts: [1],
  },
  "gemini-3.1-image-analyze": {
    modes: [{ value: "analysis", label: "图像分析" }],
    imageSizes: ["source"],
    qualities: ["standard"],
    outputCounts: [1],
    referenceImageCounts: [1],
  },
  "seedream5": {
    modes: [{ value: "generate", label: "文生图" }],
    imageSizes: ["1K", "2K", "4K"],
    qualities: ["standard", "hd"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [0],
  },
  "gemini-3-pro-image": {
    modes: [{ value: "generate", label: "高质量文生图" }],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [0],
  },
  "gemini-3.1-image": {
    modes: [{ value: "generate", label: "文生图" }],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [0],
  },
  "gemini-image-edit": {
    modes: [{ value: "edit", label: "图像编辑" }],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [1, 2, 4],
  },
  "gemini-3.1-image-edit": {
    modes: [{ value: "edit", label: "图像编辑" }],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [1, 2, 4],
  },
  "gemini-image-blend": {
    modes: [{ value: "reference", label: "参考图生成" }],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [1, 2, 4],
  },
  "gemini-3.1-image-blend": {
    modes: [{ value: "reference", label: "参考图生成" }],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [1, 2, 4],
  },
  "gemini-image-analyze": {
    modes: [{ value: "analysis", label: "图像分析" }],
    imageSizes: ["source"],
    qualities: ["standard"],
    outputCounts: [1],
    referenceImageCounts: [1],
  },
  generate: {
    modes: [{ value: "generate", label: "文生图" }],
    imageSizes: ["768", "1024", "1536", "2048", "1K", "2K"],
    qualities: ["standard", "hd"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [0],
  },
  generatePro: {
    modes: [
      { value: "generate", label: "文生图" },
      { value: "edit", label: "编辑" },
      { value: "reference", label: "参考图生成" },
    ],
    imageSizes: ["1024", "1536", "2048", "1K", "2K", "4K"],
    qualities: ["standard", "hd", "pro"],
    outputCounts: [1, 2, 4],
    referenceImageCounts: [0, 1, 2, 4],
  },
  midjourney: {
    modes: [
      { value: "generate", label: "文生图" },
      { value: "reference", label: "参考图生成" },
    ],
    imageSizes: ["1024", "1536", "2048"],
    qualities: ["standard", "pro"],
    outputCounts: [1, 4],
    referenceImageCounts: [0, 1, 2, 4],
  },
  analysis: {
    modes: [{ value: "analysis", label: "图像分析" }],
    imageSizes: ["source"],
    qualities: ["standard"],
    outputCounts: [1],
    referenceImageCounts: [1],
  },
};

const getManagedImagePricingConfig = (model?: ManagedModelConfig, nodeConfig?: ManagedModelNodeConfig) => {
  const modelKey = String(model?.modelKey || '').trim();
  const flowNodeType = String(nodeConfig?.flowNodeType || '').trim();
  return (
    (modelKey && MANAGED_IMAGE_PRICING_CONFIG_MAP[modelKey]) ||
    (flowNodeType && MANAGED_IMAGE_PRICING_CONFIG_MAP[flowNodeType]) ||
    {
      modes: [
        { value: "generate", label: "文生图" },
        { value: "edit", label: "编辑" },
        { value: "reference", label: "参考图生成" },
      ],
      imageSizes: ["1024", "1536", "2048", "1K", "2K"],
      qualities: ["standard", "hd", "pro"],
      outputCounts: [1, 2, 4],
      referenceImageCounts: [0, 1, 2, 4],
    }
  );
};

const readManagedModelMetadataRecord = (model?: ManagedModelConfig): Record<string, any> =>
  model?.metadata && typeof model.metadata === "object" ? (model.metadata as Record<string, any>) : {};

const getManagedModelServiceType = (model?: ManagedModelConfig): string => {
  const metadata = readManagedModelMetadataRecord(model);
  const explicit = String(metadata.serviceType || "").trim();
  return explicit || (model?.modelKey ? MANAGED_MODEL_SERVICE_TYPE_MAP[model.modelKey] || "" : "");
};

const getManagedModelSupportedModels = (model?: ManagedModelConfig): string[] => {
  const metadata = readManagedModelMetadataRecord(model);
  const explicit = Array.isArray(metadata.supportedModels)
    ? metadata.supportedModels
        .map((item: unknown) => String(item || "").trim())
        .filter(Boolean)
    : [];
  if (explicit.length > 0) return explicit;
  return model?.modelKey ? MANAGED_MODEL_SUPPORTED_MODELS_MAP[model.modelKey] || [] : [];
};

const getManagedModelOutputConfig = (model?: ManagedModelConfig) => {
  const metadata = readManagedModelMetadataRecord(model);
  const explicit = metadata.outputConfig;
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    return explicit as {
      aspectRatios?: string[];
      durations?: number[];
      resolutions?: string[];
      audioGeneration?: boolean;
    };
  }
  return model?.modelKey ? MANAGED_MODEL_OUTPUT_CONFIG_MAP[model.modelKey] : undefined;
};

const parseCommaSeparatedList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseCommaSeparatedNumbers = (value: string) =>
  parseCommaSeparatedList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

const buildManagedNodeMetadata = (model: ManagedModelConfig): Record<string, any> => {
  const taskType = normalizeManagedModelTaskType(model.taskType);
  const nodeConfig = getManagedNodeConfig(model);
  const defaultVendor =
    (model.vendors || []).find((vendor) => vendor.vendorKey === model.defaultVendor) ||
    (model.vendors || []).find((vendor) => vendor.enabled !== false) ||
    model.vendors?.[0];
  const supportedModels = getManagedModelSupportedModels(model);
  const managedRoutes = {
    modelKey: model.modelKey,
    defaultVendor: model.defaultVendor || defaultVendor?.vendorKey || "",
    vendors: (model.vendors || [])
      .filter((vendor) => vendor.enabled !== false && String(vendor.vendorKey || "").trim())
      .map((vendor) => ({
        vendorKey: vendor.vendorKey,
        platformKey: vendor.platformKey,
        label: vendor.label,
        provider: vendor.provider,
        route: vendor.route,
        modelName: vendor.modelName,
        modelVersion: vendor.modelVersion,
        creditsPerCall: getVendorPricingDefaults(vendor).credits,
        priceYuan: getVendorPricingDefaults(vendor).priceYuan,
        pricing:
          vendor.pricing && typeof vendor.pricing === "object"
            ? vendor.pricing
            : undefined,
      })),
  };
  const metadata: Record<string, any> = {
    type: nodeConfig.flowNodeType,
    provider: defaultVendor?.provider || "",
    managedModelKey: model.modelKey,
    managedTaskType: taskType,
    managedRoutes,
    nodeConfig,
    modelKeys: [model.modelKey],
  };

  if (supportedModels.length > 0) {
    metadata.supportedModels = supportedModels;
  }

  if (taskType === "video") {
    const outputConfig = getManagedModelOutputConfig(model);
    metadata.vod = {
      label: defaultVendor?.label || model.modelName || model.modelKey,
      modelName: defaultVendor?.modelName || model.modelName || model.modelKey,
      modelVersion: defaultVendor?.modelVersion || "",
      ...(outputConfig ? { outputConfig } : {}),
      ...(model.modelKey === "seedance-2.0" ? SEEDANCE20_VOD_METADATA : {}),
    };
  }

  const defaultVendorCredits = getVendorPricingDefaults(defaultVendor).credits;

  if (model.modelKey.startsWith("vidu-")) {
    const defaultViduModel = supportedModels[0] || "q2";
    metadata.defaultData = {
      provider: defaultViduModel === "q2" ? "vidu" : "viduq3-pro",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      viduModel: defaultViduModel,
      resolution: "720p",
      clipDuration: defaultViduModel === "q2" ? 5 : 8,
    };
  } else if (model.modelKey.startsWith("kling-")) {
    metadata.defaultData = {
      provider: defaultVendor?.provider || "",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      klingModel: supportedModels[0] || "kling-v2-6",
      clipDuration: 5,
    };
  } else if (model.modelKey.startsWith("seedance-")) {
    metadata.defaultData = {
      provider: defaultVendor?.provider || "doubao",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      seedanceModel: supportedModels[0] || "seedance-1.5-pro",
      clipDuration: 5,
      resolution: "720P",
      ...(model.modelKey === "seedance-2.0"
        ? {
            seedanceMode: "text",
            generateAudio: true,
          }
        : {}),
    };
  } else if (model.modelKey === "sora-2") {
    metadata.defaultData = {
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      generationType: "sora2",
      model: "sora-2-pro",
      clipDuration: 10,
      aspectRatio: "16:9",
      watermark: false,
      thumbnailEnabled: true,
      privateMode: false,
      storyboard: false,
    };
  } else if (model.modelKey === "wan-2.6") {
    metadata.defaultData = {
      provider: defaultVendor?.provider || "dashscope",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      size: "16:9",
      resolution: "720P",
      duration: 5,
      shotType: "single",
    };
  } else if (model.modelKey === "wan-2.6-r2v") {
    metadata.defaultData = {
      provider: defaultVendor?.provider || "dashscope",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      size: "16:9",
      duration: 5,
      shotType: "single",
    };
  } else if (model.modelKey === "happyhorse-1.0-r2v") {
    metadata.defaultData = {
      provider: defaultVendor?.provider || "dashscope",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      ratio: "16:9",
      resolution: "720P",
      duration: 5,
      referenceCount: 1,
      watermark: false,
    };
  } else if (model.modelKey === "wan-2.7") {
    metadata.defaultData = {
      provider: defaultVendor?.provider || "dashscope",
      managedModelKey: model.modelKey,
      vendorKey: defaultVendor?.vendorKey,
      platformKey: defaultVendor?.platformKey || defaultVendor?.vendorKey,
      creditsPerCall: defaultVendorCredits,
      resolution: "1080P",
      duration: 5,
      promptExtend: true,
      watermark: false,
    };
  }

  return metadata;
};

// 用户管理 Tab
function UsersTab({
  canManageSensitiveUserFields,
}: {
  canManageSensitiveUserFields: boolean;
}) {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [users, setUsers] = useState<UserWithCredits[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [unbindingWechatUserId, setUnbindingWechatUserId] = useState<string | null>(null);

  // 积分操作弹窗
  const [creditModal, setCreditModal] = useState<{
    userId: string;
    userName: string;
    type: "add" | "deduct";
  } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditDetailModal, setCreditDetailModal] = useState<{
    userId: string;
    userName: string;
  } | null>(null);
  const [creditDetailLoading, setCreditDetailLoading] = useState(false);
  const [creditDetailRecords, setCreditDetailRecords] = useState<{
    recharge: CreditChangeRecord[];
    manualAdd: CreditChangeRecord[];
    inviteReward: CreditChangeRecord[];
  }>({
    recharge: [],
    manualAdd: [],
    inviteReward: [],
  });
  const [creditDetailTransactions, setCreditDetailTransactions] = useState<
    AdminUserCreditTransaction[]
  >([]);
  const [membershipDrawer, setMembershipDrawer] = useState<{
    userId: string;
    userName: string;
  } | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipState, setMembershipState] =
    useState<AdminMembershipStateResponse | null>(null);
  const [membershipPreview, setMembershipPreview] = useState<any | null>(null);
  const [membershipPlans, setMembershipPlans] = useState<AdminMembershipPlan[]>([]);
  const [membershipReason, setMembershipReason] = useState("");
  const [membershipDays, setMembershipDays] = useState("30");
  const [membershipPlanCode, setMembershipPlanCode] = useState("");
  const [membershipEffectiveMode, setMembershipEffectiveMode] = useState<
    "immediate" | "next_cycle"
  >("immediate");
  const tableColumnCount = canManageSensitiveUserFields ? 9 : 7;

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await getUsers({ page, pageSize: 10, search });
      setUsers(result.users);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载用户失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, search]);

  const handleCreditOperation = async () => {
    if (!creditModal || !creditAmount || !creditReason) return;

    try {
      if (creditModal.type === "add") {
        await addCredits(
          creditModal.userId,
          parseInt(creditAmount),
          creditReason
        );
      } else {
        await deductCredits(
          creditModal.userId,
          parseInt(creditAmount),
          creditReason
        );
      }
      setCreditModal(null);
      setCreditAmount("");
      setCreditReason("");
      loadUsers();
    } catch (error: any) {
      alert(error.message || "操作失败");
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    try {
      await updateUserStatus(userId, status);
      loadUsers();
    } catch (error) {
      console.error("更新状态失败:", error);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await updateUserRole(userId, role);
      if (userId === currentUserId) {
        const latestUser = await authApi.me().catch(() => null);
        if (latestUser) {
          useAuthStore.setState({ user: latestUser });
        } else {
          useAuthStore.setState((state) => ({
            user: state.user ? { ...state.user, role } : state.user,
          }));
        }
      }
      loadUsers();
    } catch (error) {
      console.error("更新角色失败:", error);
    }
  };

  const handleDeleteUser = async (user: UserWithCredits) => {
    if (user.id === currentUserId) {
      alert("不能删除当前登录账号");
      return;
    }

    const displayName = user.name || user.phone;
    const confirmed = window.confirm(
      `确认删除账号「${displayName}」吗？\n手机号：${user.phone}\n此操作不可撤销，并会删除该账号关联数据。`
    );
    if (!confirmed) return;

    setDeletingUserId(user.id);
    try {
      await deleteUserAccount(user.id);
      await loadUsers();
    } catch (error: any) {
      alert(error.message || "删除账号失败");
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleUnbindWechat = async (user: UserWithCredits) => {
    if (!user.wechatBound) return;

    const displayName = user.name || user.phone;
    const confirmed = window.confirm(
      `确认解绑账号「${displayName}」的微信号吗？\n手机号：${user.phone}\n解绑后该用户需要重新扫码并验证手机号才能再次绑定。`
    );
    if (!confirmed) return;

    setUnbindingWechatUserId(user.id);
    try {
      await unbindUserWechat(user.id);
      await loadUsers();
    } catch (error: any) {
      alert(error.message || "解绑微信失败");
    } finally {
      setUnbindingWechatUserId(null);
    }
  };

  const loadCreditDetails = async (user: UserWithCredits) => {
    setCreditDetailModal({
      userId: user.id,
      userName: user.name || user.phone,
    });
    setCreditDetailLoading(true);
    setCreditDetailTransactions([]);
    try {
      const [rechargeResult, manualAddResult, inviteResult, transactionResult] =
        await Promise.all([
          getCreditChangeRecords({
            userId: user.id,
            source: "recharge",
            page: 1,
            pageSize: 100,
          }),
          getCreditChangeRecords({
            userId: user.id,
            source: "admin_add",
            page: 1,
            pageSize: 100,
          }),
          getCreditChangeRecords({
            userId: user.id,
            source: "invite_reward",
            page: 1,
            pageSize: 100,
          }),
          getAdminUserCreditTransactions(user.id, {
            page: 1,
            pageSize: 100,
          }),
        ]);

      setCreditDetailRecords({
        recharge: rechargeResult.records,
        manualAdd: manualAddResult.records,
        inviteReward: inviteResult.records,
      });
      setCreditDetailTransactions(transactionResult.transactions || []);
    } catch (error) {
      console.error("加载积分详情失败:", error);
      setCreditDetailRecords({
        recharge: [],
        manualAdd: [],
        inviteReward: [],
      });
      setCreditDetailTransactions([]);
    } finally {
      setCreditDetailLoading(false);
    }
  };

  const formatChannelLabel = (channel: string | null | undefined): string => {
    if (!channel) return "-";
    const normalized = channel.trim().toLowerCase();
    if (normalized.includes("apimart")) return "M";
    if (normalized === "legacy" || normalized.includes("147")) return "A";
    return channel;
  };

  const loadMembershipState = async (userId: string, preferredPlanCode?: string) => {
    setMembershipLoading(true);
    try {
      const result = await getAdminUserMembershipState(userId);
      setMembershipState(result);
      setMembershipPlanCode((current) => {
        if (preferredPlanCode?.trim()) return preferredPlanCode.trim();
        if (current.trim()) return current;
        return result.current.plan?.code || "";
      });
    } catch (error: any) {
      alert(error.message || "加载用户会员状态失败");
    } finally {
      setMembershipLoading(false);
    }
  };

  const openMembershipDrawer = async (user: UserWithCredits) => {
    if (membershipPlans.length === 0) {
      try {
        const plans = await getAdminMembershipPlans();
        setMembershipPlans(plans.filter((plan) => plan.isActive));
      } catch (error) {
        console.error("加载会员套餐列表失败:", error);
      }
    }
    setMembershipDrawer({
      userId: user.id,
      userName: user.name || user.phone,
    });
    setMembershipReason("");
    setMembershipDays("30");
    setMembershipEffectiveMode("immediate");
    setMembershipPreview(null);
    setMembershipState(null);
    setMembershipPlanCode("");
    await loadMembershipState(user.id);
  };

  const handlePreviewMembershipTransition = async () => {
    if (!membershipDrawer) return;
    if (!membershipPlanCode.trim()) {
      alert("请先选择目标套餐");
      return;
    }
    setMembershipLoading(true);
    try {
      const result = await getAdminUserMembershipTransitionPreview(
        membershipDrawer.userId,
        membershipPlanCode.trim(),
      );
      setMembershipPreview(result);
    } catch (error: any) {
      alert(error.message || "预览失败");
    } finally {
      setMembershipLoading(false);
    }
  };

  const runMembershipAction = async (
    runner: () => Promise<void>,
    successMessage: string,
  ) => {
    if (!membershipDrawer) return;
    setMembershipLoading(true);
    try {
      await runner();
      alert(successMessage);
      setMembershipPreview(null);
      await Promise.all([
        loadMembershipState(membershipDrawer.userId, membershipPlanCode.trim()),
        loadUsers(),
      ]);
    } catch (error: any) {
      alert(error.message || "执行失败");
    } finally {
      setMembershipLoading(false);
    }
  };

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Button
          onClick={() => {
            setPage(1);
            loadUsers();
          }}
        >
          搜索
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[1100px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>手机号</th>
                <th className='px-4 py-3 text-left'>积分余额</th>
                <th className='px-4 py-3 text-left'>总消费</th>
                <th className='px-4 py-3 text-left'>API调用</th>
                {canManageSensitiveUserFields && (
                  <th className='px-4 py-3 text-left'>角色</th>
                )}
                {canManageSensitiveUserFields && (
                  <th className='px-4 py-3 text-left'>状态</th>
                )}
                <th className='px-4 py-3 text-left'>注册时间</th>
                <th className='px-4 py-3 text-left'>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={tableColumnCount}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    加载中...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColumnCount}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div>{user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>
                        {user.email || "-"}
                      </div>
                      <div className='mt-1 text-xs'>
                        <span
                          className={
                            user.wechatBound ? 'text-green-600' : 'text-gray-400'
                          }
                        >
                          {user.wechatBound ? '微信已绑定' : '微信未绑定'}
                        </span>
                      </div>
                    </td>
                    <td className='px-4 py-3'>{user.phone}</td>
                    <td className='px-4 py-3 font-medium text-blue-600'>
                      {user.creditBalance}
                    </td>
                    <td className='px-4 py-3'>{user.totalSpent}</td>
                    <td className='px-4 py-3'>{user.apiCallCount}</td>
                    {canManageSensitiveUserFields && (
                      <td className='px-4 py-3'>
                        <select
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(user.id, e.target.value)
                          }
                          className='text-xs border rounded px-2 py-1'
                        >
                          <option value='user'>用户</option>
                          <option value='normal_admin'>普通管理</option>
                          <option value='admin'>管理员</option>
                        </select>
                      </td>
                    )}
                    {canManageSensitiveUserFields && (
                      <td className='px-4 py-3'>
                        <select
                          value={user.status}
                          onChange={(e) =>
                            handleStatusChange(user.id, e.target.value)
                          }
                          className='text-xs border rounded px-2 py-1'
                        >
                          <option value='active'>正常</option>
                          <option value='inactive'>禁用</option>
                          <option value='banned'>封禁</option>
                        </select>
                      </td>
                    )}
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3'>
                      <div className='flex flex-wrap gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setCreditModal({
                              userId: user.id,
                              userName: user.name || user.phone,
                              type: "add",
                            })
                          }
                        >
                          充值
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setCreditModal({
                              userId: user.id,
                              userName: user.name || user.phone,
                              type: "deduct",
                            })
                          }
                        >
                          扣除
                        </Button>
                        {canManageSensitiveUserFields && (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => void openMembershipDrawer(user)}
                          >
                            会员
                          </Button>
                        )}
                        {canManageSensitiveUserFields && (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => loadCreditDetails(user)}
                          >
                            详情
                          </Button>
                        )}
                        {canManageSensitiveUserFields && user.wechatBound && (
                          <Button
                            size='sm'
                            variant='outline'
                            className='border-amber-300 text-amber-700 hover:bg-amber-50'
                            disabled={unbindingWechatUserId === user.id}
                            onClick={() => handleUnbindWechat(user)}
                          >
                            {unbindingWechatUserId === user.id ? "解绑中..." : "解绑微信"}
                          </Button>
                        )}
                        {canManageSensitiveUserFields && (
                          <Button
                            size='sm'
                            variant='outline'
                            className='border-red-300 text-red-600 hover:bg-red-50'
                            disabled={
                              deletingUserId === user.id || user.id === currentUserId
                            }
                            onClick={() => handleDeleteUser(user)}
                          >
                            {deletingUserId === user.id ? "删除中..." : "删除"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>
            共 {pagination.total} 条记录
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {membershipDrawer && (
        <div className='fixed inset-0 z-50 bg-black/40'>
          <div
            className='absolute inset-0'
            onClick={() => {
              if (!membershipLoading) setMembershipDrawer(null);
            }}
          />
          <div className='absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl'>
            <div className='sticky top-0 z-10 border-b bg-white px-6 py-4'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <h3 className='text-lg font-semibold'>会员操作</h3>
                  <div className='mt-1 text-sm text-gray-500'>
                    {membershipDrawer.userName} · {membershipDrawer.userId}
                  </div>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setMembershipDrawer(null)}
                  disabled={membershipLoading}
                >
                  关闭
                </Button>
              </div>
            </div>

            <div className='space-y-4 p-6'>
              {membershipState ? (
                <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
                  <div className='rounded-lg border border-gray-200 p-4'>
                    <div className='text-xs text-gray-500'>当前生效套餐</div>
                    <div className='mt-1 text-base font-semibold text-gray-900'>
                      {membershipState.current.plan?.name || "标准版"}
                    </div>
                    <div className='mt-2 text-xs text-gray-500'>
                      到期：
                      {" "}
                      {membershipState.current.entitlement.currentPeriodEndAt
                        ? new Date(
                            membershipState.current.entitlement.currentPeriodEndAt,
                          ).toLocaleString()
                        : "-"}
                    </div>
                  </div>
                  <div className='rounded-lg border border-gray-200 p-4'>
                    <div className='text-xs text-gray-500'>下周期套餐</div>
                    <div className='mt-1 text-base font-semibold text-gray-900'>
                      {membershipState.nextChange?.targetPlanName || "未安排"}
                    </div>
                    <div className='mt-2 text-xs text-gray-500'>
                      生效：
                      {" "}
                      {membershipState.nextChange?.effectiveAt
                        ? new Date(membershipState.nextChange.effectiveAt).toLocaleString()
                        : "-"}
                    </div>
                  </div>
                  <div className='rounded-lg border border-gray-200 p-4'>
                    <div className='text-xs text-gray-500'>积分结构</div>
                    <div className='mt-1 text-sm text-gray-700'>
                      订阅积分：{membershipState.balances.subscriptionCredits}
                    </div>
                    <div className='mt-1 text-sm text-gray-700'>
                      赠送积分：{membershipState.balances.giftCredits}
                    </div>
                    <div className='mt-1 text-sm text-gray-700'>
                      固定积分：{membershipState.balances.fixedCredits}
                    </div>
                  </div>
                </div>
              ) : (
                <div className='rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500'>
                  {membershipLoading ? "加载会员状态中..." : "暂无会员状态数据"}
                </div>
              )}

              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>目标套餐</div>
                  <select
                    className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                    value={membershipPlanCode}
                    onChange={(e) => setMembershipPlanCode(e.target.value)}
                  >
                    <option value=''>请选择套餐</option>
                    {membershipPlans.map((plan) => (
                      <option key={plan.id} value={plan.code}>
                        {plan.name} ({plan.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>调整天数</div>
                  <Input
                    value={membershipDays}
                    onChange={(e) => setMembershipDays(e.target.value)}
                    placeholder='30 或 -7'
                  />
                </div>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>生效方式</div>
                  <select
                    className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                    value={membershipEffectiveMode}
                    onChange={(e) =>
                      setMembershipEffectiveMode(e.target.value as "immediate" | "next_cycle")
                    }
                  >
                    <option value='immediate'>立即生效</option>
                    <option value='next_cycle'>下周期生效</option>
                  </select>
                </div>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>操作原因</div>
                  <Input
                    value={membershipReason}
                    onChange={(e) => setMembershipReason(e.target.value)}
                    placeholder='例如：客服补偿 / 手动纠正 / 用户申请换档'
                  />
                </div>
              </div>

              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  onClick={() => void handlePreviewMembershipTransition()}
                  disabled={membershipLoading}
                >
                  预览切换结果
                </Button>
                <Button
                  variant='outline'
                  onClick={() =>
                    void runMembershipAction(
                      () =>
                        adminExpireUserMembershipNow(
                          membershipDrawer.userId,
                          membershipReason || undefined,
                        ),
                      "已立即让该用户会员到期",
                    )
                  }
                  disabled={membershipLoading}
                >
                  立即到期
                </Button>
                <Button
                  variant='outline'
                  onClick={() =>
                    void runMembershipAction(
                      () =>
                        adminAdjustUserMembershipPeriod(
                          membershipDrawer.userId,
                          Number(membershipDays || 0),
                          membershipReason || undefined,
                        ),
                      "会员时长已调整",
                    )
                  }
                  disabled={membershipLoading}
                >
                  调整时长
                </Button>
                <Button
                  onClick={() =>
                    void runMembershipAction(
                      async () => {
                        if (!membershipPlanCode.trim()) {
                          throw new Error("请先选择目标套餐");
                        }
                        await adminChangeUserMembershipPlan({
                          userId: membershipDrawer.userId,
                          planCode: membershipPlanCode.trim(),
                          effectiveMode: membershipEffectiveMode,
                          reason: membershipReason || undefined,
                        });
                      },
                      membershipEffectiveMode === "immediate" ? "套餐已立即切换" : "已安排下周期切换",
                    )
                  }
                  disabled={membershipLoading}
                >
                  变更套餐
                </Button>
              </div>

              {membershipPreview && (
                <div className='rounded-lg border border-blue-200 bg-blue-50 p-4'>
                  <div className='text-sm font-medium text-blue-900'>切换结果预览</div>
                  <div className='mt-2 text-sm text-blue-800'>
                    动作：{membershipPreview.actionType} / 生效方式：{membershipPreview.effectiveMode}
                  </div>
                  <div className='mt-1 text-sm text-blue-800'>
                    应付金额：¥{membershipPreview.payableAmount ?? 0} / 即时补发积分：
                    {membershipPreview.immediateCreditDelta ?? 0}
                  </div>
                  <div className='mt-1 text-sm text-blue-800'>
                    当前套餐：{membershipPreview.currentPlan?.name || "无"} / 目标套餐：
                    {membershipPreview.targetPlan?.name || "-"}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 积分操作弹窗 */}
      {creditModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 w-96'>
            <h3 className='text-lg font-semibold mb-4'>
              {creditModal.type === "add" ? "充值积分" : "扣除积分"} -{" "}
              {creditModal.userName}
            </h3>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  积分数量
                </label>
                <Input
                  type='number'
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder='输入积分数量'
                />
              </div>
              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  操作原因
                </label>
                <Input
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder='输入操作原因'
                />
              </div>
              <div className='flex gap-2 justify-end'>
                <Button variant='outline' onClick={() => setCreditModal(null)}>
                  取消
                </Button>
                <Button onClick={handleCreditOperation}>确认</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 积分来源详情弹窗 */}
      {creditDetailModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-lg p-6 w-full max-w-6xl max-h-[85vh] overflow-auto'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-lg font-semibold'>
                积分详情 - {creditDetailModal.userName}
              </h3>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCreditDetailModal(null)}
              >
                关闭
              </Button>
            </div>

            {creditDetailLoading ? (
              <div className='py-10 text-center text-gray-500'>加载中...</div>
            ) : (
              <div className='space-y-4'>
                <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                  <div className='border rounded-lg p-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <h4 className='font-medium text-gray-800'>充值积分</h4>
                      <span className='text-xs text-gray-500'>
                        {creditDetailRecords.recharge.length} 条
                      </span>
                    </div>
                    <div className='space-y-2 max-h-[52vh] overflow-auto pr-1'>
                      {creditDetailRecords.recharge.length === 0 ? (
                        <div className='text-xs text-gray-400 py-6 text-center'>
                          暂无记录
                        </div>
                      ) : (
                        creditDetailRecords.recharge.map((record) => (
                          <div key={record.id} className='border rounded p-2 text-xs'>
                            <div className='text-gray-500'>
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='font-medium text-green-600 mt-1'>
                              +{record.amount} 积分
                            </div>
                            <div className='text-gray-600 mt-1'>{record.description}</div>
                            <div className='text-gray-400 mt-1'>
                              剩余积分: {record.balanceAfter}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className='border rounded-lg p-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <h4 className='font-medium text-gray-800'>手动增加积分</h4>
                      <span className='text-xs text-gray-500'>
                        {creditDetailRecords.manualAdd.length} 条
                      </span>
                    </div>
                    <div className='space-y-2 max-h-[52vh] overflow-auto pr-1'>
                      {creditDetailRecords.manualAdd.length === 0 ? (
                        <div className='text-xs text-gray-400 py-6 text-center'>
                          暂无记录
                        </div>
                      ) : (
                        creditDetailRecords.manualAdd.map((record) => (
                          <div key={record.id} className='border rounded p-2 text-xs'>
                            <div className='text-gray-500'>
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='font-medium text-blue-600 mt-1'>
                              +{record.amount} 积分
                            </div>
                            <div className='text-gray-600 mt-1'>{record.description}</div>
                            <div className='text-gray-400 mt-1'>
                              管理员: {record.admin?.name || record.admin?.phone || "-"}
                            </div>
                            <div className='text-gray-400 mt-1'>
                              剩余积分: {record.balanceAfter}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className='border rounded-lg p-4'>
                    <div className='flex items-center justify-between mb-3'>
                      <h4 className='font-medium text-gray-800'>邀请奖励积分</h4>
                      <span className='text-xs text-gray-500'>
                        {creditDetailRecords.inviteReward.length} 条
                      </span>
                    </div>
                    <div className='space-y-2 max-h-[52vh] overflow-auto pr-1'>
                      {creditDetailRecords.inviteReward.length === 0 ? (
                        <div className='text-xs text-gray-400 py-6 text-center'>
                          暂无记录
                        </div>
                      ) : (
                        creditDetailRecords.inviteReward.map((record) => (
                          <div key={record.id} className='border rounded p-2 text-xs'>
                            <div className='text-gray-500'>
                              {new Date(record.createdAt).toLocaleString()}
                            </div>
                            <div className='font-medium text-emerald-600 mt-1'>
                              +{record.amount} 积分
                            </div>
                            <div className='text-gray-600 mt-1'>{record.description}</div>
                            <div className='text-gray-400 mt-1'>
                              剩余积分: {record.balanceAfter}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className='border rounded-lg overflow-hidden'>
                  <div className='px-4 py-3 bg-gray-50 border-b flex items-center justify-between'>
                    <h4 className='font-medium text-gray-800'>细分积分明细</h4>
                    <span className='text-xs text-gray-500'>
                      {creditDetailTransactions.length} 条
                    </span>
                  </div>

                  {creditDetailTransactions.length === 0 ? (
                    <div className='py-10 text-center text-gray-500 text-sm'>暂无记录</div>
                  ) : (
                    <div className='max-h-[45vh] overflow-auto'>
                      <table className='w-full text-sm'>
                        <thead className='sticky top-0 bg-white z-10'>
                          <tr className='border-b text-gray-500 text-xs bg-gray-50'>
                            <th className='px-4 py-3 text-left'>项目</th>
                            <th className='px-4 py-3 text-right'>积分</th>
                            <th className='px-4 py-3 text-right'>剩余积分</th>
                            <th className='px-4 py-3 text-left'>生成时间</th>
                            <th className='px-4 py-3 text-left'>花费时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditDetailTransactions.map((tx) => {
                            const durationSeconds =
                              typeof tx.processingTime === "number"
                                ? Math.max(0, Math.round(tx.processingTime / 1000))
                                : null;
                            const isPositive = tx.amount > 0;

                            return (
                              <tr key={tx.id} className='border-b hover:bg-gray-50'>
                                <td className='px-4 py-3'>
                                  <div className='font-medium text-gray-800'>
                                    {tx.description}
                                  </div>
                                  {tx.channel && (
                                    <div className='text-xs text-gray-500 mt-0.5'>
                                      渠道: {formatChannelLabel(tx.channel)}
                                    </div>
                                  )}
                                  <div className='text-xs text-gray-500 mt-0.5'>
                                    模型: {typeof tx.model === "string" && tx.model.trim().length > 0 ? tx.model : "--"}
                                  </div>
                                </td>
                                <td
                                  className={`px-4 py-3 text-right font-semibold ${
                                    isPositive ? "text-green-600" : "text-orange-600"
                                  }`}
                                >
                                  {isPositive ? "+" : ""}
                                  {tx.amount}
                                </td>
                                <td className='px-4 py-3 text-right text-blue-600 font-medium'>
                                  {tx.balanceAfter}
                                </td>
                                <td className='px-4 py-3 text-gray-600 whitespace-nowrap'>
                                  {new Date(tx.createdAt).toLocaleString()}
                                </td>
                                <td className='px-4 py-3 text-gray-600 whitespace-nowrap'>
                                  {durationSeconds !== null ? `${durationSeconds}秒` : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// API 使用统计 Tab
function ApiStatsTab() {
  const [stats, setStats] = useState<ApiUsageStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);
      try {
        const result = await getApiUsageStats();
        setStats(result);
      } catch (error) {
        console.error("加载统计失败:", error);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  const totalPages = Math.max(1, Math.ceil(stats.length / pageSize));
  const pagedStats = stats.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className='bg-white rounded-lg border overflow-hidden'>
      <div className='max-h-[1200px] overflow-auto'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='px-4 py-3 text-left'>服务名称</th>
              <th className='px-4 py-3 text-left'>服务类型</th>
              <th className='px-4 py-3 text-left'>提供商</th>
              <th className='px-4 py-3 text-left'>用户</th>
              <th className='px-4 py-3 text-right'>总调用</th>
              <th className='px-4 py-3 text-right'>成功</th>
              <th className='px-4 py-3 text-right'>失败</th>
              <th className='px-4 py-3 text-right'>成功率</th>
              <th className='px-4 py-3 text-right'>消耗积分</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                  加载中...
                </td>
              </tr>
            ) : stats.length === 0 ? (
              <tr>
                <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>
                  暂无数据
                </td>
              </tr>
            ) : (
              pagedStats.map((stat) => (
                <tr
                  key={stat.serviceType}
                  className='border-t hover:bg-gray-50'
                >
                  <td className='px-4 py-3 font-medium'>{stat.serviceName}</td>
                  <td className='px-4 py-3 text-gray-500'>
                    {stat.serviceType}
                  </td>
                  <td className='px-4 py-3'>
                    <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                      {stat.provider}
                    </span>
                  </td>
                  <td className='px-4 py-3'>
                    <div className='space-y-1'>
                      <div className='text-xs text-gray-500'>
                        共 {stat.userCount} 个用户
                      </div>
                      {stat.topUsers.length > 0 && (
                        <div className='space-y-0.5'>
                          {stat.topUsers.map((user, idx) => (
                            <div key={user.userId} className='text-xs'>
                              <span className='font-medium'>
                                {user.userName || user.userPhone}
                              </span>
                              <span className='text-gray-400 ml-1'>
                                ({user.callCount}次)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className='px-4 py-3 text-right'>{stat.totalCalls}</td>
                  <td className='px-4 py-3 text-right text-green-600'>
                    {stat.successfulCalls}
                  </td>
                  <td className='px-4 py-3 text-right text-red-600'>
                    {stat.failedCalls}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    {stat.totalCalls > 0
                      ? (
                          (stat.successfulCalls / stat.totalCalls) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </td>
                  <td className='px-4 py-3 text-right font-medium'>
                    {stat.totalCreditsUsed}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {stats.length > 0 && totalPages > 1 && (
        <div className='mt-4 flex justify-center gap-2 pb-4'>
          <Button
            variant='outline'
            size='sm'
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className='px-4 py-2 text-sm'>
            {page} / {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

// API 调用记录 Tab
function ApiRecordsTab() {
  const [records, setRecords] = useState<ApiUsageRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedRequestRecord, setSelectedRequestRecord] =
    useState<ApiUsageRecord | null>(null);
  const [filters, setFilters] = useState({
    userSearch: "",
    serviceType: "",
    provider: "",
    status: "",
  });

  const loadRecords = async () => {
    setLoading(true);
    try {
      const result = await getApiUsageRecords({
        page,
        pageSize: 10,
        ...filters,
      });
      setRecords(result.records);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [page, filters]);

  const updateFilters = (patch: Partial<typeof filters>) => {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  };

  const statusColors: Record<string, string> = {
    success: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    pending: "bg-yellow-100 text-yellow-700",
  };

  const formatExecutionChannelLabel = (
    channel: string | null | undefined,
  ): string => {
    const normalized = typeof channel === "string" ? channel.trim().toLowerCase() : "";
    if (!normalized) return "-";
    if (normalized === "legacy" || normalized.includes("147")) return "147";
    if (normalized.includes("apimart")) return "Apimart";
    if (normalized === "tencent") return "Tencent";
    if (normalized === "tencent_vod") return "Tencent VOD";
    return channel!.trim();
  };

  const getRecordChannelLabel = (record: ApiUsageRecord) => {
    const actualChannel =
      record.requestParams?.channel ||
      record.requestParams?.executionChannel ||
      record.requestParams?.providerChannel ||
      record.requestParams?.platformKey ||
      record.requestParams?.vendorKey ||
      record.requestParams?.channelHint;

    if (typeof actualChannel === "string" && actualChannel.trim()) {
      return formatExecutionChannelLabel(actualChannel);
    }

    return formatExecutionChannelLabel(record.provider);
  };

  const isRecordObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const pickString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  };

  const isRenderableImageRef = (value?: string): boolean => {
    if (!value) return false;
    if (value.startsWith("data:") || value.startsWith("blob:")) return false;
    if (/^[A-Za-z0-9+/=]{80,}$/.test(value)) return false;
    return true;
  };

  const findNestedString = (
    value: unknown,
    keys: readonly string[],
    depth = 0,
  ): string | undefined => {
    if (depth > 2 || !isRecordObject(value)) return undefined;

    for (const key of keys) {
      const candidate = pickString(value[key]);
      if (candidate) return candidate;
    }

    for (const nested of Object.values(value)) {
      const candidate = findNestedString(nested, keys, depth + 1);
      if (candidate) return candidate;
    }

    return undefined;
  };

  const findNestedImage = (value: unknown, depth = 0): string | undefined => {
    if (depth > 2 || !isRecordObject(value)) return undefined;

    const imageKeys = [
      "requestThumbnailUrl",
      "requestThumbnail",
      "thumbnailUrl",
      "thumbnail",
      "sourceImageUrl",
      "referenceImage",
      "inputImageUrl",
      "imageUrl",
      "image",
      "cover",
      "poster",
    ] as const;

    const imageListKeys = [
      "sourceImages",
      "referenceImages",
      "inputImages",
      "images",
    ] as const;

    for (const key of imageKeys) {
      const candidate = pickString(value[key]);
      if (isRenderableImageRef(candidate)) return candidate;
    }

    for (const key of imageListKeys) {
      const list = value[key];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const candidate = pickString(entry);
        if (isRenderableImageRef(candidate)) return candidate;
      }
    }

    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) {
        for (const entry of nested) {
          if (!isRecordObject(entry)) continue;
          const candidate = findNestedImage(entry, depth + 1);
          if (candidate) return candidate;
        }
        continue;
      }

      const candidate = findNestedImage(nested, depth + 1);
      if (candidate) return candidate;
    }

    return undefined;
  };

  const getRequestPrompt = (record: ApiUsageRecord): string | undefined =>
    pickString(
      findNestedString(record.requestParams, [
        "requestPrompt",
        "originalPrompt",
        "fullPrompt",
        "promptText",
        "prompt",
        "textPrompt",
        "inputPrompt",
        "userPrompt",
      ]),
    );

  const getRequestThumbnail = (record: ApiUsageRecord): string | undefined =>
    findNestedImage(record.requestParams);

  const formatRequestJson = (record: ApiUsageRecord): string => {
    if (!record.requestParams) return "{}";
    try {
      return JSON.stringify(record.requestParams, null, 2);
    } catch {
      return String(record.requestParams);
    }
  };

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          value={filters.userSearch}
          onChange={(e) => updateFilters({ userSearch: e.target.value })}
          placeholder='用户ID / 手机 / 邮箱 / 昵称'
          className='max-w-xs text-sm'
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilters({ status: e.target.value })}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部状态</option>
          <option value='success'>成功</option>
          <option value='failed'>失败</option>
          <option value='pending'>处理中</option>
        </select>
        <select
          value={filters.provider}
          onChange={(e) => updateFilters({ provider: e.target.value })}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部提供商</option>
          <option value='gemini'>Gemini</option>
          <option value='sora'>Sora</option>
          <option value='midjourney'>Midjourney</option>
          <option value='imgly'>IMGLY</option>
        </select>
        <Button
          variant='outline'
          onClick={() => {
            setPage(1);
            loadRecords();
          }}
        >
          刷新
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[1100px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='whitespace-nowrap px-4 py-3 text-left'>时间</th>
                <th className='whitespace-nowrap px-4 py-3 text-left'>用户</th>
                <th className='whitespace-nowrap px-4 py-3 text-left'>服务</th>
                <th className='whitespace-nowrap px-4 py-3 text-left'>提供商</th>
                <th className='whitespace-nowrap px-4 py-3 text-left'>渠道商</th>
                <th className='whitespace-nowrap px-4 py-3 text-left'>请求</th>
                <th className='whitespace-nowrap px-4 py-3 text-right'>消耗积分</th>
                <th className='whitespace-nowrap px-4 py-3 text-right'>耗时</th>
                <th className='whitespace-nowrap px-4 py-3 text-left'>状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    加载中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                records.map((record) => {
                  const requestPrompt = getRequestPrompt(record);
                  const requestThumbnail = getRequestThumbnail(record);

                  return (
                    <tr key={record.id} className='border-t hover:bg-gray-50'>
                      <td className='px-4 py-3 text-xs text-gray-500'>
                        {new Date(record.createdAt).toLocaleString()}
                      </td>
                      <td className='px-4 py-3'>
                        <div>{record.user?.name || "-"}</div>
                        <div className='text-xs text-gray-400'>
                          {record.user?.phone || record.userId}
                        </div>
                        {record.user?.email && (
                          <div className='text-xs text-gray-400'>
                            {record.user.email}
                          </div>
                        )}
                        <div className='font-mono text-[10px] text-gray-300'>
                          {record.userId.slice(0, 8)}
                        </div>
                      </td>
                      <td className='px-4 py-3'>{record.serviceName}</td>
                      <td className='px-4 py-3'>
                        <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                          {record.provider}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <span className='px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs'>
                          {getRecordChannelLabel(record)}
                        </span>
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex min-w-[220px] items-center gap-3'>
                          {requestThumbnail ? (
                            <img
                              src={requestThumbnail}
                              alt='请求缩略图'
                              className='h-12 w-12 rounded-md border border-gray-200 object-cover'
                              loading='lazy'
                            />
                          ) : (
                            <div className='flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-[10px] text-gray-400'>
                              无图
                            </div>
                          )}
                          <div className='min-w-0 flex-1'>
                            <div className='text-xs text-gray-500'>
                              {requestPrompt ? "提示词已隐藏" : "无提示词"}
                            </div>
                            <Button
                              variant='outline'
                              size='sm'
                              className='mt-1 h-7 px-2 text-xs'
                              onClick={() => setSelectedRequestRecord(record)}
                            >
                              查看完整请求
                            </Button>
                          </div>
                        </div>
                      </td>
                      <td className='px-4 py-3 text-right font-medium'>
                        {record.responseStatus === "failed" ? (
                          <span className='text-green-600'>
                            已退还 {record.creditsUsed}
                          </span>
                        ) : (
                          record.creditsUsed
                        )}
                      </td>
                      <td className='px-4 py-3 text-right text-gray-500'>
                        {record.processingTime
                          ? `${record.processingTime}ms`
                          : "-"}
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex flex-col items-start gap-2'>
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              statusColors[record.responseStatus] || ""
                            }`}
                          >
                            {record.responseStatus === "success"
                              ? "成功"
                              : record.responseStatus === "failed"
                              ? "失败"
                              : "处理中"}
                          </span>
                          {record.responseStatus === "failed" && (
                            <OpenObserveLogButton
                              record={{
                                id: record.id,
                                apiUsageId: record.id,
                                userId: record.userId,
                                provider: record.provider,
                                serviceType: record.serviceType,
                                responseStatus: record.responseStatus,
                                createdAt: record.createdAt,
                                requestParams: record.requestParams ?? undefined,
                                metadata: {
                                  errorMessage: record.errorMessage,
                                },
                              }}
                              className='h-7 px-2 text-xs'
                            />
                          )}
                        </div>
                        {record.errorMessage && (
                          <div
                            className='text-xs text-red-500 mt-1 max-w-xs truncate'
                            title={record.errorMessage}
                          >
                            {record.errorMessage}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex justify-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className='px-4 py-2 text-sm'>
            {page} / {pagination.totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page === pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {selectedRequestRecord && (
        <div
          className='fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4'
          onClick={() => setSelectedRequestRecord(null)}
        >
          <div
            className='max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex items-center justify-between border-b px-5 py-4'>
              <div>
                <h3 className='text-base font-semibold text-gray-900'>完整请求</h3>
                <p className='mt-1 text-xs text-gray-500'>
                  {selectedRequestRecord.serviceName} · {new Date(selectedRequestRecord.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setSelectedRequestRecord(null)}
              >
                关闭
              </Button>
            </div>

            <div className='grid gap-5 overflow-auto p-5 md:grid-cols-[280px_minmax(0,1fr)]'>
              <div className='space-y-4'>
                <div>
                  <div className='mb-2 text-xs font-medium text-gray-500'>请求缩略图</div>
                  {getRequestThumbnail(selectedRequestRecord) ? (
                    <img
                      src={getRequestThumbnail(selectedRequestRecord)}
                      alt='请求缩略图'
                      className='h-56 w-full rounded-lg border border-gray-200 object-cover'
                    />
                  ) : (
                    <div className='flex h-56 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400'>
                      这条记录没有请求缩略图
                    </div>
                  )}
                </div>

                <div>
                  <div className='mb-2 text-xs font-medium text-gray-500'>提示词</div>
                  <div className='max-h-56 overflow-auto rounded-lg border bg-gray-50 p-3 text-sm whitespace-pre-wrap break-words text-gray-800'>
                    {getRequestPrompt(selectedRequestRecord) || "这条记录没有提示词"}
                  </div>
                </div>
              </div>

              <div>
                <div className='mb-2 text-xs font-medium text-gray-500'>请求参数 JSON</div>
                <pre className='max-h-[65vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100'>
                  {formatRequestJson(selectedRequestRecord)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SEEDREAM5_PROVIDER_OPTIONS = [
  {
    value: "doubao",
    label: "豆包",
    description: "使用豆包 Seedream 5.0 通道（ARK）",
  },
  {
    value: "watcha",
    label: "观猹",
    description: "使用观猹 Seedream 5.0 通道（tokendance.agent-universe.cn）",
  },
];

const BANANA_PROVIDER_OPTIONS = [
  {
    value: "apimart",
    label: "Apimart（推荐）",
    description: "普通路线使用 Apimart (api.apimart.ai)",
  },
  {
    value: "legacy",
    label: "147",
    description: "普通路线使用 147 (api1.147ai.com)",
  },
];

const BANANA_TEXT_PROVIDER_OPTIONS = [
  {
    value: "auto",
    label: "自动切换",
    description: "优先使用 Apimart 语言接口，失败后自动切换到 147",
  },
  {
    value: "legacy_auto",
    label: "自动切换（147优先）",
    description: "优先使用 147 语言接口，失败后自动切换到 Apimart",
  },
  {
    value: "apimart",
    label: "Apimart",
    description: "强制使用 Apimart 语言接口 (api.apimart.ai)",
  },
  {
    value: "legacy",
    label: "147",
    description: "强制使用 147 语言接口 (api1.147ai.com)",
  },
];

// 公共模板管理 Tab
function TemplatesTab() {
  const VIP_ONLY_TEMPLATE_TAG = "vip-only";
  const inferTemplateScope = (tags?: string[]) => {
    const normalizedTags = Array.isArray(tags)
      ? tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
      : [];
    return normalizedTags.includes(VIP_ONLY_TEMPLATE_TAG) || normalizedTags.includes("vip") || normalizedTags.includes("仅vip")
      ? "vip-only"
      : "all";
  };

  const applyTemplateScopeToTags = (existingTags: string[] | undefined, scope: "all" | "vip-only") => {
    const baseTags = (existingTags || []).filter((tag) => {
      const normalized = String(tag).trim().toLowerCase();
      return normalized !== VIP_ONLY_TEMPLATE_TAG && normalized !== "vip" && normalized !== "仅vip";
    });

    if (scope === "vip-only") {
      return [...baseTags, VIP_ONLY_TEMPLATE_TAG];
    }

    return baseTags;
  };

  const [templates, setTemplates] = useState<PublicTemplate[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined);
  const [categories, setCategories] = useState<string[]>([]);

  // 创建/编辑模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PublicTemplate | null>(
    null
  );
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    description: "",
    thumbnail: "",
    thumbnailSmall: "",
    templateData: "",
    templateJsonKey: undefined as string | undefined,
    isActive: true,
    templateScope: "all" as "all" | "vip-only",
  });
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [jsonFileName, setJsonFileName] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [smallImageFileName, setSmallImageFileName] = useState<string | null>(
    null
  );

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const result = await fetchTemplates({
        page,
        pageSize: 10,
        category: category || undefined,
        isActive,
        search: search || undefined,
      });
      setTemplates(result.items);
      setPagination(result);
    } catch (error) {
      console.error("加载模板失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const result = await fetchTemplateCategories();
      // 将"其他"分类固定在末尾
      if (Array.isArray(result)) {
        const otherCat = result.filter((c) => c === "其他");
        const restCats = result.filter((c) => c !== "其他");
        setCategories([...restCats, ...otherCat]);
      } else {
        setCategories(result);
      }
    } catch (error) {
      console.error("加载分类失败:", error);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadCategories();
  }, [page, category, isActive, search]);

  const handleCreate = () => {
    setEditingTemplate(null);
    setFormData({
      name: "",
      category: "",
      description: "",
      thumbnail: "",
      thumbnailSmall: "",
      templateData: "",
      templateJsonKey: undefined,
      isActive: true,
      templateScope: "all",
    });
    setJsonFileName(null);
    setImageFileName(null);
    setModalOpen(true);
  };

  const handleEdit = async (template: PublicTemplate) => {
    const fullTemplate = await fetchTemplate(template.id);
    setEditingTemplate(fullTemplate);
    setFormData({
      name: fullTemplate.name,
      category: fullTemplate.category || "",
      description: fullTemplate.description || "",
      thumbnail: fullTemplate.thumbnail || "",
      thumbnailSmall: fullTemplate.thumbnailSmall || "",
      templateData: JSON.stringify(fullTemplate.templateData, null, 2),
      templateJsonKey: undefined,
      isActive: fullTemplate.isActive ?? true,
      templateScope: inferTemplateScope(fullTemplate.tags),
    });
    setJsonFileName(null);
    setImageFileName(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      let payload: any = {
        name: formData.name || undefined,
        category: formData.category || undefined,
        description: formData.description || undefined,
        thumbnail: formData.thumbnail || undefined,
        thumbnailSmall: formData.thumbnailSmall || undefined,
        isActive: formData.isActive,
        tags: applyTemplateScopeToTags(editingTemplate?.tags, formData.templateScope),
      };

      // 清理空值
      Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) delete payload[key];
      });

      if (formData.templateJsonKey) {
        payload.templateJsonKey = formData.templateJsonKey;
      } else if (formData.templateData && formData.templateData.trim()) {
        let templateData;
        try {
          templateData = JSON.parse(formData.templateData);
        } catch (e) {
          alert("模板数据必须是有效的JSON格式");
          return;
        }
        payload.templateData = templateData;
      }
      // templateData 为空时不发送该字段

      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, payload);
      } else {
        await createTemplate(payload);
      }

      setModalOpen(false);
      loadTemplates();
    } catch (error: any) {
      alert(error.message || "保存失败");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定要删除模板"${name}"吗？此操作无法撤销。`)) return;

    try {
      await deleteTemplate(id);
      loadTemplates();
    } catch (error: any) {
      alert(error.message || "删除失败");
    }
  };

  // 读取 JSON 文件并填充到模板数据
  const handleJsonFileChange = async (file?: File) => {
    if (!file) return;
    setJsonFileName(file.name);
    try {
      // 验证文件大小 (限制为32MB)
      if (file.size > 32 * 1024 * 1024) {
        alert("JSON文件大小不能超过32MB");
        return;
      }

      // 验证文件类型
      if (!file.name.toLowerCase().endsWith(".json")) {
        alert("请选择JSON格式的文件");
        return;
      }

      // 读取并验证JSON格式
      const content = await file.text();
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseError) {
        alert("JSON文件格式不正确，请检查文件内容");
        return;
      }

      // 直接将 JSON 内容设置为 templateData，不再依赖 OSS 读取
      setFormData({
        ...formData,
        templateJsonKey: undefined,
        templateData: JSON.stringify(parsedJson, null, 2)
      });
    } catch (err: any) {
      console.error("JSON 读取失败:", err);
      alert(`JSON 读取失败: ${err.message || "未知错误"}`);
    }
  };

  // 上传文件到 OSS（使用 presign PUT 方式）
  const uploadFileToOSS = async (
    file: File,
    dir = "templates/thumbs/",
    maxSize?: number
  ): Promise<string> => {
    const token = localStorage.getItem("authToken");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const API_BASE =
      import.meta.env.VITE_API_BASE_URL &&
      import.meta.env.VITE_API_BASE_URL.trim().length > 0
        ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
        : "http://localhost:4000";

    // 生成文件 key
    const key = `${dir.replace(/\/+$/, '')}/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const contentType = file.type || "application/octet-stream";

    // 调用 presign 接口获取上传 URL（新的 PUT 方式）
    const resp = await fetchWithAuth(`${API_BASE}/api/uploads/presign`, {
      method: "POST",
      headers,
      body: JSON.stringify({ key, contentType }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(
        `获取上传凭证失败: ${errorData.message || resp.statusText}`
      );
    }

    const presign = await resp.json();
    if (!presign || !presign.uploadUrl) {
      throw new Error("上传凭证格式错误");
    }

    // 使用 PUT 方式直接上传到 OSS
    const uploadResp = await fetch(presign.uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": contentType,
      },
    });

    if (!uploadResp.ok) {
      throw new Error(
        `上传到OSS失败 (${uploadResp.status})`
      );
    }

    // 返回公共访问 URL
    return presign.publicUrl || `${presign.uploadUrl.split('?')[0]}`;
  };

  const handleImageFileChange = async (file?: File) => {
    if (!file) return;
    setIsUploadingImage(true);
    setImageFileName(file.name);
    try {
      const url = await uploadFileToOSS(file, "templates/thumbs/");
      setFormData({ ...formData, thumbnail: url });
    } catch (err: any) {
      console.error("图片上传失败:", err);
      alert("图片上传失败");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSmallImageFileChange = async (file?: File) => {
    if (!file) return;
    setIsUploadingImage(true);
    setSmallImageFileName(file.name);
    try {
      const url = await uploadFileToOSS(file, "templates/thumbs_small/");
      setFormData({ ...formData, thumbnailSmall: url });
    } catch (err: any) {
      console.error("小缩略图上传失败:", err);
      alert("小缩略图上传失败");
    } finally {
      setIsUploadingImage(false);
    }
  };

  return (
    <div>
      <div className='mb-4 flex gap-2 flex-wrap'>
        <Input
          placeholder='搜索模板名称/描述'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部分类</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <select
          value={isActive === undefined ? "" : isActive.toString()}
          onChange={(e) =>
            setIsActive(
              e.target.value === "" ? undefined : e.target.value === "true"
            )
          }
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部状态</option>
          <option value='true'>启用</option>
          <option value='false'>禁用</option>
        </select>
        <Button onClick={() => setPage(1)}>搜索</Button>
        <Button onClick={handleCreate}>创建模板</Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[800px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>模板</th>
                <th className='px-4 py-3 text-left'>分类</th>
                <th className='px-4 py-3 text-left'>状态</th>
                <th className='px-4 py-3 text-left'>更新时间</th>
                <th className='px-4 py-3 text-left'>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    加载中...
                  </td>
                </tr>
              ) : templates.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className='px-4 py-8 text-center text-gray-500'
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr key={template.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div>
                        <div className='font-medium'>{template.name}</div>
                        {template.description && (
                          <div className='text-xs text-gray-500 mt-1'>
                            {template.description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className='px-4 py-3'>
                      {template.category && (
                        <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                          {template.category}
                        </span>
                      )}
                    </td>

                    <td className='px-4 py-3'>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          template.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {template.isActive ? "启用" : "禁用"}
                      </span>
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {template.updatedAt
                        ? new Date(template.updatedAt).toLocaleString()
                        : ""}
                    </td>
                    <td className='px-4 py-3'>
                      <div className='flex gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => handleEdit(template)}
                        >
                          编辑
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            handleDelete(template.id, template.name)
                          }
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>
            共 {pagination.total} 条记录
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 创建/编辑模态框 */}
      {modalOpen && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-auto'>
            <h3 className='text-lg font-semibold mb-4'>
              {editingTemplate ? "编辑模板" : "创建模板"}
            </h3>
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>
                    模板名称 *
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder='输入模板名称'
                  />
                </div>
              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  分类
                </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value })
                    }
                    className='w-full border rounded px-3 py-2'
                  >
                    <option value=''>请选择分类</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <div className='flex gap-2 mt-2'>
                    <input
                      type='text'
                      id='new-category-input'
                      className='flex-1 border rounded px-3 py-2 text-sm'
                      placeholder='输入新分类名称'
                    />
                    <button
                      type='button'
                      className='px-3 py-2 bg-blue-600 text-white rounded text-sm'
                      onClick={async () => {
                        const input = document.getElementById('new-category-input') as HTMLInputElement;
                        const newCat = input?.value?.trim();
                        if (!newCat) {
                          alert('请输入分类名称');
                          return;
                        }
                        if (categories.includes(newCat)) {
                          alert('该分类已存在');
                          return;
                        }
                        try {
                          const res = await fetchWithAuth(
                            "/api/admin/templates/categories",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ category: newCat }),
                            }
                          );
                          if (!res.ok) throw new Error("添加分类失败");
                          const data = await res.json();
                          if (data?.success) {
                            await loadCategories();
                            input.value = '';
                            setFormData({ ...formData, category: newCat });
                          } else {
                            alert(data?.message || "添加分类失败");
                          }
                        } catch (err) {
                          console.error("添加分类失败", err);
                          alert("添加分类失败");
                        }
                      }}
                    >
                      添加
                    </button>
                    <button
                      type='button'
                      className='px-3 py-2 bg-red-500 text-white rounded text-sm'
                      onClick={async () => {
                        if (!formData.category) {
                          alert('请先选择要删除的分类');
                          return;
                        }
                        if (formData.category === '其他') {
                          alert('"其他"分类不能删除');
                          return;
                        }
                        if (!confirm(`确定要删除分类"${formData.category}"吗？`)) {
                          return;
                        }
                        try {
                          const res = await fetchWithAuth(
                            `/api/admin/templates/categories/${encodeURIComponent(formData.category)}`,
                            { method: "DELETE" }
                          );
                          if (!res.ok) throw new Error("删除分类失败");
                          const data = await res.json();
                          if (data?.success) {
                            await loadCategories();
                            setFormData({ ...formData, category: '' });
                          } else {
                            alert(data?.message || "删除分类失败");
                          }
                        } catch (err) {
                          console.error("删除分类失败", err);
                          alert("删除分类失败");
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>可用范围</label>
                <select
                  value={formData.templateScope}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      templateScope: e.target.value as "all" | "vip-only",
                    })
                  }
                  className='w-full border rounded px-3 py-2'
                >
                  <option value='all'>全部</option>
                  <option value='vip-only'>仅VIP</option>
                </select>
                <div className='mt-1 text-xs text-gray-500'>
                  仅 VIP 模板会自动带上 `vip-only` tag，普通用户无法直接使用。
                </div>
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>描述</label>
                <Input
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder='输入模板描述'
                />
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  缩略图 (图片上传)
                </label>
                <input
                  type='file'
                  accept='image/*'
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageFileChange(f);
                  }}
                />
                {imageFileName && (
                  <div className='text-xs text-gray-500 mt-1'>
                    已选择: {imageFileName}{" "}
                    {isUploadingImage ? "(上传中...)" : ""}
                  </div>
                )}
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  小缩略图 (40x40)
                </label>
                <input
                  type='file'
                  accept='image/*'
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSmallImageFileChange(f);
                  }}
                />
                {smallImageFileName && (
                  <div className='text-xs text-gray-500 mt-1'>
                    已选择: {smallImageFileName}{" "}
                    {isUploadingImage ? "(上传中...)" : ""}
                  </div>
                )}
              </div>

              <div className='flex items-center gap-4'>
                <label className='flex items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={formData.isActive}
                    onChange={(e) =>
                      setFormData({ ...formData, isActive: e.target.checked })
                    }
                  />
                  <span className='text-sm text-gray-600'>启用</span>
                </label>
              </div>

              <div>
                <label className='block text-sm text-gray-600 mb-1'>
                  模板数据 (JSON 文件上传) *
                </label>
                <input
                  type='file'
                  accept='application/json'
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleJsonFileChange(f);
                  }}
                />
                {jsonFileName && (
                  <div className='text-xs text-gray-500 mt-1'>
                    已选择: {jsonFileName}
                  </div>
                )}
              </div>

              <div className='flex gap-2 justify-end'>
                <Button variant='outline' onClick={() => setModalOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleSave}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 审核素材组管理 Tab
function VolcReviewTab() {
  const [groups, setGroups] = useState<{ id: string; date: string; groupId: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVolcReviewGroups();
      setGroups(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCleanup = async () => {
    const date = dateInput.trim() || undefined;
    setMsg(null);
    try {
      const result = await cleanupVolcReviewGroup(date);
      setMsg({ text: result.deleted ? `已删除 ${result.date} 的素材组` : `${result.date} 无记录，无需清除`, ok: result.deleted });
      void load();
    } catch (e: any) {
      setMsg({ text: e?.message || "操作失败", ok: false });
    }
  };

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
      <h2 className="text-lg font-semibold">审核素材组管理</h2>
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="日期（如 2026-04-19），空则清除 3 天前"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-64"
        />
        <button
          onClick={handleCleanup}
          className="px-4 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        >
          清除素材组
        </button>
        <button onClick={load} className="px-4 py-1.5 border rounded text-sm hover:bg-gray-50">
          刷新
        </button>
      </div>
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</p>
      )}
      {loading ? (
        <p className="text-sm text-gray-400">加载中…</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4">日期</th>
              <th className="py-2 pr-4">素材组 ID</th>
              <th className="py-2 pr-4">创建时间</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr><td colSpan={4} className="py-4 text-center text-gray-400">暂无记录</td></tr>
            ) : groups.map((g) => (
              <tr key={g.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-4 font-mono">{g.date}</td>
                <td className="py-2 pr-4 font-mono text-xs text-gray-500">{g.groupId}</td>
                <td className="py-2 pr-4 text-gray-400">{new Date(g.createdAt).toLocaleString("zh-CN")}</td>
                <td className="py-2">
                  <button
                    onClick={async () => {
                      if (!confirm(`确认删除 ${g.date} 的素材组？`)) return;
                      try {
                        await cleanupVolcReviewGroup(g.date);
                        void load();
                      } catch (e: any) {
                        setMsg({ text: e?.message || "删除失败", ok: false });
                      }
                    }}
                    className="px-2 py-1 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// 水印白名单管理 Tab
function WatermarkWhitelistTab() {
  const [whitelistUsers, setWhitelistUsers] = useState<WatermarkWhitelistUser[]>([]);
  const [allUsers, setAllUsers] = useState<UserWithCredits[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const loadWhitelist = async () => {
    setLoading(true);
    try {
      const result = await getWatermarkWhitelist({ page, pageSize: 10, search });
      setWhitelistUsers(result.users);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载白名单失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      const result = await getUsers({ page: 1, pageSize: 50, search: userSearch });
      setAllUsers(result.users);
    } catch (error) {
      console.error("加载用户列表失败:", error);
    }
  };

  useEffect(() => {
    loadWhitelist();
  }, [page, search]);

  useEffect(() => {
    if (showAddModal) {
      loadAllUsers();
    }
  }, [showAddModal, userSearch]);

  const handleAdd = async (userId: string) => {
    try {
      await addToWatermarkWhitelist(userId);
      setShowAddModal(false);
      loadWhitelist();
    } catch (error: any) {
      alert(error.message || "添加失败");
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("确定要从白名单中移除该用户吗？")) return;
    try {
      await removeFromWatermarkWhitelist(userId);
      loadWhitelist();
    } catch (error: any) {
      alert(error.message || "移除失败");
    }
  };

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Button onClick={() => { setPage(1); loadWhitelist(); }}>搜索</Button>
        <Button onClick={() => setShowAddModal(true)}>添加用户</Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='px-4 py-3 text-left'>用户</th>
              <th className='px-4 py-3 text-left'>手机号</th>
              <th className='px-4 py-3 text-left'>邮箱</th>
              <th className='px-4 py-3 text-left'>添加时间</th>
              <th className='px-4 py-3 text-left'>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className='px-4 py-8 text-center text-gray-500'>加载中...</td>
              </tr>
            ) : whitelistUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className='px-4 py-8 text-center text-gray-500'>暂无数据</td>
              </tr>
            ) : (
              whitelistUsers.map((user) => (
                <tr key={user.id} className='border-t hover:bg-gray-50'>
                  <td className='px-4 py-3'>{user.name || "-"}</td>
                  <td className='px-4 py-3'>{user.phone}</td>
                  <td className='px-4 py-3'>{user.email || "-"}</td>
                  <td className='px-4 py-3 text-xs text-gray-500'>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className='px-4 py-3'>
                    <Button size='sm' variant='outline' onClick={() => handleRemove(user.id)}>
                      移除
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>{page} / {pagination.totalPages}</span>
            <Button variant='outline' size='sm' disabled={page === pagination.totalPages} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* 添加用户弹窗 */}
      {showAddModal && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-white rounded-lg p-6 w-[500px] max-h-[80vh] overflow-auto'>
            <h3 className='text-lg font-semibold mb-4'>添加用户到白名单</h3>
            <Input
              placeholder='搜索用户手机号/邮箱/昵称'
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className='mb-4'
            />
            <div className='max-h-[400px] overflow-auto border rounded'>
              <table className='w-full text-sm'>
                <thead className='bg-gray-50 sticky top-0'>
                  <tr>
                    <th className='px-3 py-2 text-left'>用户</th>
                    <th className='px-3 py-2 text-left'>手机号</th>
                    <th className='px-3 py-2 text-left'>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((user) => (
                    <tr key={user.id} className='border-t hover:bg-gray-50'>
                      <td className='px-3 py-2'>{user.name || "-"}</td>
                      <td className='px-3 py-2'>{user.phone}</td>
                      <td className='px-3 py-2'>
                        <Button size='sm' onClick={() => handleAdd(user.id)}>添加</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className='mt-4 flex justify-end'>
              <Button variant='outline' onClick={() => setShowAddModal(false)}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 付费用户管理 Tab
function PaidUsersTab() {
  const [users, setUsers] = useState<PaidUser[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<PaidUsersSortBy>("amount");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await getPaidUsers({ page, pageSize: 10, search, sortBy, sortOrder });
      setUsers(result.users);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载付费用户失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [page, search, sortBy, sortOrder]);

  return (
    <div>
      <div className='mb-4 flex gap-2'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <Button onClick={() => { setPage(1); loadUsers(); }}>搜索</Button>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as PaidUsersSortBy);
            setPage(1);
          }}
          className='h-10 rounded-md border border-input bg-background px-3 py-2 text-sm'
        >
          <option value='amount'>按金额排序</option>
          <option value='registeredAt'>按注册时间排序</option>
          <option value='paidAt'>按支付时间排序</option>
        </select>
        <Button
          variant='outline'
          onClick={() => {
            setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
            setPage(1);
          }}
        >
          {sortOrder === "desc" ? "降序" : "升序"}
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[800px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>手机号</th>
                <th className='px-4 py-3 text-right'>总支付金额</th>
                <th className='px-4 py-3 text-right'>订单数</th>
                <th className='px-4 py-3 text-right'>积分余额</th>
                <th className='px-4 py-3 text-right'>已消费积分</th>
                <th className='px-4 py-3 text-left'>状态</th>
                <th className='px-4 py-3 text-left'>注册时间</th>
                <th className='px-4 py-3 text-left'>支付时间</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>加载中...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className='px-4 py-8 text-center text-gray-500'>暂无付费用户</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3'>
                      <div>{user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>{user.email || "-"}</div>
                    </td>
                    <td className='px-4 py-3'>{user.phone}</td>
                    <td className='px-4 py-3 text-right font-medium text-green-600'>
                      ¥{user.totalPaid.toFixed(2)}
                    </td>
                    <td className='px-4 py-3 text-right'>{user.orderCount}</td>
                    <td className='px-4 py-3 text-right text-blue-600'>{user.creditBalance}</td>
                    <td className='px-4 py-3 text-right'>{user.totalSpent}</td>
                    <td className='px-4 py-3'>
                      {user.noWatermark ? (
                        <span className='px-2 py-1 rounded text-xs bg-blue-100 text-blue-700'>
                          VIP
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs ${
                          user.status === 'active' ? 'bg-green-100 text-green-700' :
                          user.status === 'inactive' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {user.status === 'active' ? '正常' : user.status === 'inactive' ? '禁用' : '封禁'}
                        </span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500'>
                      {user.lastPaidAt ? new Date(user.lastPaidAt).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>{page} / {pagination.totalPages}</span>
            <Button variant='outline' size='sm' disabled={page === pagination.totalPages} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// 积分变更记录 Tab
function CreditChangeRecordsTab() {
  const [records, setRecords] = useState<CreditChangeRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | "recharge" | "admin_add" | "admin_deduct">("all");

  const loadRecords = async () => {
    setLoading(true);
    try {
      const result = await getCreditChangeRecords({
        page,
        pageSize: 20,
        search,
        source,
      });
      setRecords(result.records);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载积分变更记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [page, search, source]);

  const sourceText: Record<string, string> = {
    recharge: "充值到账",
    admin_add: "后台加积分",
    admin_deduct: "后台扣积分",
  };

  const sourceClass: Record<string, string> = {
    recharge: "bg-green-100 text-green-700",
    admin_add: "bg-blue-100 text-blue-700",
    admin_deduct: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className='mb-4 flex gap-2 flex-wrap'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <select
          value={source}
          onChange={(e) => {
            setPage(1);
            setSource(e.target.value as "all" | "recharge" | "admin_add" | "admin_deduct");
          }}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value='all'>全部来源</option>
          <option value='recharge'>充值到账</option>
          <option value='admin_add'>后台加积分</option>
          <option value='admin_deduct'>后台扣积分</option>
        </select>
        <Button
          onClick={() => {
            setPage(1);
            loadRecords();
          }}
        >
          搜索
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[900px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>时间</th>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>来源</th>
                <th className='px-4 py-3 text-right'>变更积分</th>
                <th className='px-4 py-3 text-right'>变更后余额</th>
                <th className='px-4 py-3 text-left'>管理员</th>
                <th className='px-4 py-3 text-left'>支付信息</th>
                <th className='px-4 py-3 text-left'>备注</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    加载中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    暂无记录
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3 text-xs text-gray-500 whitespace-nowrap'>
                      {new Date(record.createdAt).toLocaleString()}
                    </td>
                    <td className='px-4 py-3'>
                      <div>{record.user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>{record.user.phone}</div>
                    </td>
                    <td className='px-4 py-3'>
                      <span className={`px-2 py-1 rounded text-xs ${sourceClass[record.source] || "bg-gray-100 text-gray-700"}`}>
                        {sourceText[record.source] || record.source}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${record.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {record.amount >= 0 ? "+" : ""}
                      {record.amount}
                    </td>
                    <td className='px-4 py-3 text-right text-blue-600 font-medium'>
                      {record.balanceAfter}
                    </td>
                    <td className='px-4 py-3'>
                      {record.admin ? (
                        <div>
                          <div>{record.admin.name || "-"}</div>
                          <div className='text-xs text-gray-400'>{record.admin.phone}</div>
                        </div>
                      ) : (
                        <span className='text-gray-400'>-</span>
                      )}
                    </td>
                    <td className='px-4 py-3'>
                      {record.payment ? (
                        <div className='text-xs'>
                          <div className='font-medium text-gray-700'>¥{record.payment.amount.toFixed(2)}</div>
                          <div className='text-gray-400'>{record.payment.orderNo}</div>
                        </div>
                      ) : (
                        <span className='text-gray-400'>-</span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500 max-w-[280px] truncate' title={record.description}>
                      {record.description}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreditAnomaliesTab() {
  const [records, setRecords] = useState<CreditAnomalyRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<"" | "yellow" | "red" | "purple">("");

  const loadRecords = async () => {
    setLoading(true);
    try {
      const result = await getCreditAnomalyRecords({
        page,
        pageSize: 20,
        search: search || undefined,
        severity: severity || undefined,
      });
      setRecords(result.records);
      setPagination(result.pagination);
    } catch (error) {
      console.error("加载积分异常记录失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [page, search, severity]);

  const severityText: Record<string, string> = {
    yellow: "黄色预警",
    red: "红色预警",
    purple: "紫色预警",
  };

  const severityClass: Record<string, string> = {
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
    purple: "bg-purple-100 text-purple-800",
  };

  const amountClass: Record<string, string> = {
    yellow: "text-yellow-700",
    red: "text-red-700",
    purple: "text-purple-700",
  };

  return (
    <div>
      <div className='mb-4 flex gap-2 flex-wrap'>
        <Input
          placeholder='搜索手机号/邮箱/昵称'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='max-w-xs'
        />
        <select
          value={severity}
          onChange={(e) => {
            setPage(1);
            setSeverity(e.target.value as "" | "yellow" | "red" | "purple");
          }}
          className='border rounded px-3 py-2 text-sm'
        >
          <option value=''>全部等级</option>
          <option value='yellow'>黄色 (&gt;2000)</option>
          <option value='red'>红色 (&gt;5000)</option>
          <option value='purple'>紫色 (&gt;10000)</option>
        </select>
        <Button
          onClick={() => {
            setPage(1);
            loadRecords();
          }}
        >
          搜索
        </Button>
      </div>

      <div className='bg-white rounded-lg border overflow-hidden'>
        <div className='max-h-[900px] overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-3 text-left'>日期</th>
                <th className='px-4 py-3 text-left'>用户</th>
                <th className='px-4 py-3 text-left'>预警等级</th>
                <th className='px-4 py-3 text-right'>当天累计增加</th>
                <th className='px-4 py-3 text-right'>最大单笔</th>
                <th className='px-4 py-3 text-right'>笔数</th>
                <th className='px-4 py-3 text-left'>来源分布</th>
                <th className='px-4 py-3 text-left'>最后变更</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    加载中...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className='px-4 py-8 text-center text-gray-500'>
                    暂无异常记录
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr key={record.id} className='border-t hover:bg-gray-50'>
                    <td className='px-4 py-3 text-xs text-gray-600 whitespace-nowrap'>
                      {record.dayLabel}
                    </td>
                    <td className='px-4 py-3'>
                      <div>{record.user.name || "-"}</div>
                      <div className='text-xs text-gray-400'>{record.user.phone}</div>
                    </td>
                    <td className='px-4 py-3'>
                      <span className={`px-2 py-1 rounded text-xs ${severityClass[record.severity] || "bg-gray-100 text-gray-700"}`}>
                        {severityText[record.severity] || record.severity}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${amountClass[record.severity] || "text-yellow-700"}`}>
                      +{record.totalAmount}
                    </td>
                    <td className='px-4 py-3 text-right'>{record.maxSingleAmount}</td>
                    <td className='px-4 py-3 text-right'>{record.transactionCount}</td>
                    <td className='px-4 py-3 text-xs text-gray-600'>
                      <div className='space-y-1'>
                        {record.sourceBreakdown.slice(0, 3).map((item) => (
                          <div key={item.sourceKey} className='whitespace-nowrap'>
                            {item.sourceLabel}: +{item.amount} ({item.count}笔)
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className='px-4 py-3 text-xs text-gray-500 whitespace-nowrap'>
                      {new Date(record.lastTransactionAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className='mt-4 flex items-center justify-center gap-4'>
          <span className='text-sm text-gray-500'>共 {pagination.total} 条记录</span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className='px-4 py-2 text-sm'>
              {page} / {pagination.totalPages}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page === pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelManagementTab() {
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [mappingDraft, setMappingDraft] = useState<ModelProviderMappingV2>(() =>
    normalizeModelMapping(JSON.parse(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE))
  );
  const [routeSelection, setRouteSelection] = useState<VideoModelRouteSelection>(() =>
    deriveVideoModelRouteSelection(JSON.parse(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE))
  );

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const syncDraftFromObject = (input: ModelProviderMappingV2) => {
    const normalized = normalizeModelMapping(input);
    setMappingDraft(normalized);
    setRouteSelection(deriveVideoModelRouteSelection(normalized));
    return normalized;
  };

  const loadMapping = async () => {
    setLoading(true);
    setStatusText("");
    try {
      const settings = await getSettings();
      const existing = settings.find(
        (item) => item.key === MODEL_PROVIDER_MAPPING_SETTING_KEY
      );
      const nextText =
        existing?.value?.trim() || DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE;
      const parsed = JSON.parse(nextText);
      syncDraftFromObject(parsed);
      setLastUpdatedAt(existing?.updatedAt || null);
    } catch (error) {
      console.error("加载视频模型管理配置失败:", error);
      setStatusText("加载失败，请稍后重试");
      showToast("加载视频模型管理配置失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMapping();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatusText("");
    try {
      const nextDraft = applyVideoModelRouteSelectionToMapping(mappingDraft, routeSelection);
      const payloadObject = buildPersistedModelMapping(nextDraft);
      validateManagedModelMapping(payloadObject);
      const saved = await upsertSetting({
        key: MODEL_PROVIDER_MAPPING_SETTING_KEY,
        value: JSON.stringify(payloadObject, null, 2),
        description: "视频模型供应商路线管理(JSON 映射，V2)",
      });
      syncDraftFromObject(payloadObject);
      setLastUpdatedAt(saved.updatedAt);
      setStatusText("保存成功");
      notifyNodeConfigsUpdated();
      showToast("视频模型管理配置已保存");
    } catch (error: any) {
      setStatusText("保存失败，请稍后重试");
      showToast(error?.message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateRouteSelection = <K extends keyof VideoModelRouteSelection>(
    key: K,
    value: VideoModelRouteSelection[K]
  ) => {
    setRouteSelection((current) => ({
      ...current,
      [key]: value,
    }));
    setStatusText("");
  };

  const renderRouteOptions = (
    routeKey: keyof VideoModelRouteSelection,
    groupName: string
  ) => {
    const options = VIDEO_MODEL_ROUTE_OPTIONS[routeKey];
    const selectedValue = routeSelection[routeKey];

    return (
      <div className='space-y-3'>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
              selectedValue === option.value
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <input
              type='radio'
              name={groupName}
              value={option.value}
              checked={selectedValue === option.value}
              onChange={() =>
                updateRouteSelection(routeKey, option.value as VideoModelRouteSelection[typeof routeKey])
              }
              className='mt-1'
            />
            <div>
              <div className='font-medium'>{option.label}</div>
              <div className='text-sm text-gray-500'>{option.description}</div>
            </div>
          </label>
        ))}
      </div>
    );
  };

  return (
    <div className='space-y-4'>
      {toast && (
        <div className='fixed right-6 top-6 z-[70]'>
          <div
            className={`min-w-[240px] rounded-lg border px-4 py-3 text-sm shadow-lg ${
              toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-2'>视频模型管理</h3>
        <p className='text-sm text-gray-500'>
          使用和系统设置内 Banana 供应商切换一致的交互方式，按模型选择默认供应商路线。
        </p>
        <div className='mt-3 text-xs text-gray-500'>
          配置 Key: {MODEL_PROVIDER_MAPPING_SETTING_KEY}
          {lastUpdatedAt
            ? ` · 最后更新：${new Date(lastUpdatedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}`
            : ""}
        </div>
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>sora2 供应商</h3>
        <p className='text-sm text-gray-500 mb-4'>sora2 供应商：贞贞、147、api mart</p>
        {renderRouteOptions("sora2", "videoModelSora2Provider")}
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>seedance 供应商</h3>
        <p className='text-sm text-gray-500 mb-4'>seedance 供应商：火山引擎</p>
        {renderRouteOptions("seedance", "videoModelSeedanceProvider")}
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>kling 供应商</h3>
        <p className='text-sm text-gray-500 mb-4'>kling 供应商：kapon、腾讯</p>
        {renderRouteOptions("kling", "videoModelKlingProvider")}
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>vidu 供应商</h3>
        <p className='text-sm text-gray-500 mb-4'>vidu 供应商：kapon、腾讯</p>
        {renderRouteOptions("vidu", "videoModelViduProvider")}
      </div>

      <div className='flex flex-wrap gap-3'>
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? "保存中..." : "保存设置"}
        </Button>
        <Button variant='outline' onClick={loadMapping} disabled={saving || loading}>
          {loading ? "加载中..." : "重新加载"}
        </Button>
        <Button
          variant='outline'
          onClick={() => {
            setRouteSelection(VIDEO_MODEL_ROUTE_DEFAULT_SELECTION);
            setStatusText("已恢复默认路线，未保存");
          }}
          disabled={saving || loading}
        >
          恢复默认
        </Button>
      </div>
      {statusText && <div className='text-sm text-gray-500'>{statusText}</div>}
    </div>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seedream5Provider, setSeedream5Provider] = useState("doubao");
  const [bananaProvider, setBananaProvider] = useState("auto");
  const [bananaTextProvider, setBananaTextProvider] = useState("auto");

  // 微信二维码状态
  const [officialQrCode, setOfficialQrCode] = useState<string>("");
  const [groupQrCode, setGroupQrCode] = useState<string>("");
  const [uploadingOfficial, setUploadingOfficial] = useState(false);
  const [uploadingGroup, setUploadingGroup] = useState(false);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const result = await getSettings();
      setSettings(result);
      const seedreamSetting = result.find((s) => s.key === "seedream5_provider");
      if (seedreamSetting) {
        setSeedream5Provider(seedreamSetting.value);
      }
      const bananaSetting = result.find((s) => s.key === "banana_provider");
      if (bananaSetting) {
        const normalizedProvider =
          bananaSetting.value === "legacy" ? "legacy" : "apimart";
        setBananaProvider(normalizedProvider);
      } else {
        setBananaProvider("apimart");
      }
      const bananaTextSetting = result.find(
        (s) => s.key === "banana_text_provider"
      );
      if (bananaTextSetting) {
        setBananaTextProvider(bananaTextSetting.value);
      }
      // 加载微信二维码设置
      const officialSetting = result.find((s) => s.key === "wechat_official_account_qrcode");
      if (officialSetting) {
        setOfficialQrCode(officialSetting.value);
      }
      const groupSetting = result.find((s) => s.key === "wechat_group_qrcode");
      if (groupSetting) {
        setGroupQrCode(groupSetting.value);
      }
    } catch (error) {
      console.error("加载设置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // 上传二维码图片
  const handleQrCodeUpload = async (
    file: File,
    type: 'official' | 'group'
  ) => {
    const setUploading = type === 'official' ? setUploadingOfficial : setUploadingGroup;
    const settingKey = type === 'official' ? 'wechat_official_account_qrcode' : 'wechat_group_qrcode';
    const description = type === 'official' ? '微信公众号二维码' : '微信交流群二维码';

    setUploading(true);
    try {
      // 使用 OSS 上传
      const { uploadToOSS } = await import('@/services/ossUploadService');
      const result = await uploadToOSS(file, {
        dir: 'settings/qrcodes/',
        fileName: file.name,
      });

      if (!result.success || !result.url) {
        throw new Error(result.error || '上传失败');
      }

      // 保存到系统设置
      await upsertSetting({
        key: settingKey,
        value: result.url,
        description,
      });

      // 更新本地状态
      if (type === 'official') {
        setOfficialQrCode(result.url);
      } else {
        setGroupQrCode(result.url);
      }

      alert('上传成功');
      loadSettings();
    } catch (error: any) {
      alert(error.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveBananaProvider = async () => {
    setSaving(true);
    try {
      const normalizedProvider = bananaProvider === "legacy" ? "legacy" : "apimart";
      await upsertSetting({
        key: "banana_provider",
        value: normalizedProvider,
        description: "Banana 普通路线图像供应商（147 / Apimart）",
      });
      alert("保存成功");
      loadSettings();
    } catch (error: any) {
      alert(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSeedream5Provider = async () => {
    setSaving(true);
    try {
      await upsertSetting({
        key: "seedream5_provider",
        value: seedream5Provider,
        description: "Seedream 5.0 图像通道供应商选择（豆包 / 观猹）",
      });
      alert("保存成功");
      loadSettings();
    } catch (error: any) {
      alert(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBananaTextProvider = async () => {
    setSaving(true);
    try {
      await upsertSetting({
        key: "banana_text_provider",
        value: bananaTextProvider,
        description: "Gemini 生文普通渠道供应商路线（147 / Apimart）",
      });
      alert("保存成功");
      loadSettings();
    } catch (error: any) {
      alert(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className='text-center py-8 text-gray-500'>加载中...</div>;
  }

  return (
    <div className='space-y-6'>
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>Seedream 5.0 通道设置</h3>
        <p className='text-sm text-gray-500 mb-4'>
          选择 Seedream 5.0 使用的供应商通道，可在豆包与观猹之间切换。
        </p>
        <div className='space-y-3'>
          {SEEDREAM5_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
                seedream5Provider === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type='radio'
                name='seedream5Provider'
                value={option.value}
                checked={seedream5Provider === option.value}
                onChange={(e) => setSeedream5Provider(e.target.value)}
                className='mt-1'
              />
              <div>
                <div className='font-medium'>{option.label}</div>
                <div className='text-sm text-gray-500'>
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className='mt-4'>
          <Button onClick={handleSaveSeedream5Provider} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>Banana 图像生成设置</h3>
        <p className='text-sm text-gray-500 mb-4'>
          仅控制画板 AI 设置中「普通路线」使用的供应商（147 / Apimart）。
          尊享路线由用户在画板侧选择后走腾讯直连，不在此处配置。
        </p>
        <div className='space-y-3'>
          {BANANA_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
                bananaProvider === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type='radio'
                name='bananaProvider'
                value={option.value}
                checked={bananaProvider === option.value}
                onChange={(e) => setBananaProvider(e.target.value)}
                className='mt-1'
              />
              <div>
                <div className='font-medium'>{option.label}</div>
                <div className='text-sm text-gray-500'>
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className='mt-4'>
          <Button onClick={handleSaveBananaProvider} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>Gemini 生文普通渠道供应商路线</h3>
        <p className='text-sm text-gray-500 mb-4'>
          仅控制普通渠道下的 Gemini 生文供应商（文本对话、工具选择、提示词优化等）。
          尊享渠道固定走腾讯；普通渠道按这里配置使用 147 / Apimart（可自动切换）。
        </p>
        <div className='space-y-3'>
          {BANANA_TEXT_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition ${
                bananaTextProvider === option.value
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type='radio'
                name='bananaTextProvider'
                value={option.value}
                checked={bananaTextProvider === option.value}
                onChange={(e) => setBananaTextProvider(e.target.value)}
                className='mt-1'
              />
              <div>
                <div className='font-medium'>{option.label}</div>
                <div className='text-sm text-gray-500'>
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className='mt-4'>
          <Button onClick={handleSaveBananaTextProvider} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </div>

      {/* 微信二维码设置 */}
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>微信咨询二维码</h3>
        <p className='text-sm text-gray-500 mb-4'>
          设置欢迎页面右下角悬浮按钮显示的微信二维码，用于用户咨询和加入交流群。
        </p>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
          {/* 公众号二维码 */}
          <div className='border rounded-lg p-4'>
            <div className='text-sm font-medium mb-3'>公众号二维码</div>
            <div className='flex flex-col items-center'>
              <div className='w-32 h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden'>
                {officialQrCode ? (
                  <img src={officialQrCode} alt='公众号二维码' className='w-full h-full object-contain' />
                ) : (
                  <span className='text-gray-400 text-xs'>暂无图片</span>
                )}
              </div>
              <label className='cursor-pointer'>
                <input
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleQrCodeUpload(file, 'official');
                    e.target.value = '';
                  }}
                  disabled={uploadingOfficial}
                />
                <span className={`px-4 py-2 text-sm rounded-lg border transition ${
                  uploadingOfficial
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white hover:bg-gray-50 text-gray-700 cursor-pointer'
                }`}>
                  {uploadingOfficial ? '上传中...' : officialQrCode ? '更换图片' : '上传图片'}
                </span>
              </label>
            </div>
          </div>

          {/* 交流群二维码 */}
          <div className='border rounded-lg p-4'>
            <div className='text-sm font-medium mb-3'>微信交流群二维码</div>
            <div className='flex flex-col items-center'>
              <div className='w-32 h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden'>
                {groupQrCode ? (
                  <img src={groupQrCode} alt='交流群二维码' className='w-full h-full object-contain' />
                ) : (
                  <span className='text-gray-400 text-xs'>暂无图片</span>
                )}
              </div>
              <label className='cursor-pointer'>
                <input
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleQrCodeUpload(file, 'group');
                    e.target.value = '';
                  }}
                  disabled={uploadingGroup}
                />
                <span className={`px-4 py-2 text-sm rounded-lg border transition ${
                  uploadingGroup
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white hover:bg-gray-50 text-gray-700 cursor-pointer'
                }`}>
                  {uploadingGroup ? '上传中...' : groupQrCode ? '更换图片' : '上传图片'}
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 当前设置列表 */}
      <div className='bg-white rounded-lg border p-6 shadow-sm'>
        <h3 className='text-lg font-semibold mb-4'>所有系统设置</h3>
        {settings.length === 0 ? (
          <p className='text-gray-500'>暂无设置</p>
        ) : (
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='px-4 py-2 text-left'>键名</th>
                <th className='px-4 py-2 text-left'>值</th>
                <th className='px-4 py-2 text-left'>描述</th>
                <th className='px-4 py-2 text-left'>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <tr key={setting.id} className='border-t'>
                  <td className='px-4 py-2 font-mono text-xs'>{setting.key}</td>
                  <td className='px-4 py-2'>
                    <span className='px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs'>
                      {setting.value}
                    </span>
                  </td>
                  <td className='px-4 py-2 text-gray-500'>
                    {setting.description || "-"}
                  </td>
                  <td className='px-4 py-2 text-xs text-gray-400'>
                    {new Date(setting.updatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function VipManagementTab() {
  const TEMPLATE_LIBRARY_ACCESS_OPTIONS = ["基础可用", "全部开放"] as const;
  const SEEDANCE2_ACCESS_OPTIONS = [
    { value: "disabled", label: "不支持" },
    { value: "enabled", label: "支持" },
  ] as const;
  const HAPPYHORSE_ACCESS_OPTIONS = SEEDANCE2_ACCESS_OPTIONS;
  const NO_WATERMARK_ACCESS_OPTIONS = [
    { value: "disabled", label: "不支持" },
    { value: "enabled", label: "支持" },
  ] as const;
  const FREE_TIER_BENEFITS_SETTING_KEY = "membership_free_tier_benefits";
  const DEFAULT_FREE_TIER_BENEFITS = {
    coreBenefits: "图片与视频生成不限每日次数",
    templateLibraryAccess: "基础可用",
    inviteLimit: 5,
    imageDailyLimit: 0,
    videoDailyLimit: 0,
    seedance2Access: "disabled",
    happyhorseAccess: "disabled",
    supportLevel: "有限技术支持",
  };
  const DEFAULT_PLAN_METADATA_TEXT = JSON.stringify(
    {
      planCode: "",
      pauseGiftDecay: true,
    },
    null,
    2,
  );

  const getPlanMetadataObject = (metadata?: Record<string, any> | null) =>
    metadata && typeof metadata === "object" ? metadata : {};

  const getPlanCoreBenefits = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).coreBenefits;
    return typeof value === "string" ? value : "";
  };

  const getPlanTemplateLibraryAccess = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).templateLibraryAccess;
    return typeof value === "string" && value.trim() ? value.trim() : "";
  };

  const getPlanInviteLimit = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).inviteLimit;
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return value.trim();
    return "";
  };

  const getPlanSupportLevel = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).supportLevel;
    return typeof value === "string" ? value : "";
  };

  const getPlanSeedance2Access = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).seedance2Access;
    return value === "enabled" ? "enabled" : "disabled";
  };

  const getPlanHappyhorseAccess = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).happyhorseAccess;
    return value === "enabled" ? "enabled" : "disabled";
  };

  const getPlanNoWatermarkAccess = (metadata?: Record<string, any> | null) => {
    const value = getPlanMetadataObject(metadata).noWatermarkAccess;
    return value === "enabled" ? "enabled" : "disabled";
  };

  const buildPlanMetadata = (
    baseMetadata: Record<string, any>,
    form: {
      coreBenefits: string;
      templateLibraryAccess: string;
      inviteLimit: string;
      seedance2Access: string;
      happyhorseAccess: string;
      noWatermarkAccess: string;
      supportLevel: string;
    },
  ) => {
    const nextMetadata = { ...baseMetadata };

    if (form.coreBenefits.trim()) {
      nextMetadata.coreBenefits = form.coreBenefits.trim();
    } else {
      delete nextMetadata.coreBenefits;
    }

    if (form.templateLibraryAccess.trim()) {
      nextMetadata.templateLibraryAccess = form.templateLibraryAccess.trim();
    } else {
      delete nextMetadata.templateLibraryAccess;
    }

    if (form.supportLevel.trim()) {
      nextMetadata.supportLevel = form.supportLevel.trim();
    } else {
      delete nextMetadata.supportLevel;
    }

    if (form.seedance2Access === "enabled") {
      nextMetadata.seedance2Access = "enabled";
    } else {
      nextMetadata.seedance2Access = "disabled";
    }

    if (form.happyhorseAccess === "enabled") {
      nextMetadata.happyhorseAccess = "enabled";
    } else {
      nextMetadata.happyhorseAccess = "disabled";
    }

    if (form.noWatermarkAccess === "enabled") {
      nextMetadata.noWatermarkAccess = "enabled";
    } else {
      nextMetadata.noWatermarkAccess = "disabled";
    }

    const inviteLimitText = form.inviteLimit.trim();
    if (inviteLimitText) {
      const inviteLimit = Number(inviteLimitText);
      if (!Number.isFinite(inviteLimit) || inviteLimit < 0) {
        throw new Error("邀请上限必须是大于等于 0 的数字");
      }
      nextMetadata.inviteLimit = Math.trunc(inviteLimit);
    } else {
      delete nextMetadata.inviteLimit;
    }

    return nextMetadata;
  };

  const [plans, setPlans] = useState<AdminMembershipPlan[]>([]);
  const [policyView, setPolicyView] = useState<MembershipCreditPolicyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [freeTierModalOpen, setFreeTierModalOpen] = useState(false);
  const [planMetadataText, setPlanMetadataText] = useState(DEFAULT_PLAN_METADATA_TEXT);
  const [opsLoading, setOpsLoading] = useState(false);
  const [savingFreeTierBenefits, setSavingFreeTierBenefits] = useState(false);
  const [freeTierBenefits, setFreeTierBenefits] = useState<{
    monthlyQuotaCredits: string;
    dailyRewardCredits: string;
    consecutive7DayRewardMultiplier: string;
    coreBenefits: string;
    templateLibraryAccess: string;
    inviteLimit: string;
    imageDailyLimit: string;
    videoDailyLimit: string;
    seedance2Access: string;
    happyhorseAccess: string;
    supportLevel: string;
  }>({
    monthlyQuotaCredits: "500",
    dailyRewardCredits: "50",
    consecutive7DayRewardMultiplier: "3",
    coreBenefits: DEFAULT_FREE_TIER_BENEFITS.coreBenefits,
    templateLibraryAccess: DEFAULT_FREE_TIER_BENEFITS.templateLibraryAccess,
    inviteLimit: String(DEFAULT_FREE_TIER_BENEFITS.inviteLimit),
    imageDailyLimit: String(DEFAULT_FREE_TIER_BENEFITS.imageDailyLimit),
    videoDailyLimit: String(DEFAULT_FREE_TIER_BENEFITS.videoDailyLimit),
    seedance2Access: DEFAULT_FREE_TIER_BENEFITS.seedance2Access,
    happyhorseAccess: DEFAULT_FREE_TIER_BENEFITS.happyhorseAccess,
    supportLevel: DEFAULT_FREE_TIER_BENEFITS.supportLevel,
  });
  const [policyForm, setPolicyForm] = useState<MembershipCreditPolicyConfig>({
    dailyGiftDecayCredits: 50,
    fixedCreditExpireDays: 730,
    freeUserMonthlyQuotaCredits: 500,
    dailyRewardCredits: 50,
    consecutive7DayRewardMultiplier: 3,
    membershipRefreshCycleDays: 30,
  });
  const [planForm, setPlanForm] = useState<{
    code: string;
    name: string;
    billingCycle: "monthly" | "yearly";
    price: string;
    monthlyQuotaCredits: string;
    signupBonusCredits: string;
    dailyGiftCredits: string;
    coreBenefits: string;
    templateLibraryAccess: string;
    inviteLimit: string;
    seedance2Access: string;
    happyhorseAccess: string;
    noWatermarkAccess: string;
    supportLevel: string;
    sortOrder: string;
    isActive: boolean;
  }>({
    code: "",
    name: "",
    billingCycle: "monthly",
    price: "",
    monthlyQuotaCredits: "0",
    signupBonusCredits: "0",
    dailyGiftCredits: "0",
    coreBenefits: "",
    templateLibraryAccess: "",
    inviteLimit: "",
    seedance2Access: "disabled",
    happyhorseAccess: "disabled",
    noWatermarkAccess: "disabled",
    supportLevel: "",
    sortOrder: "0",
    isActive: true,
  });

  const loadVipData = async () => {
    setLoading(true);
    try {
      const [plansResult, policyResult, freeTierSetting] = await Promise.all([
        getAdminMembershipPlans(),
        getMembershipCreditPolicy(),
        getSetting(FREE_TIER_BENEFITS_SETTING_KEY).catch(() => null),
      ]);
      setPlans(plansResult);
      setPolicyView(policyResult);
      setPolicyForm(policyResult.effective);
      let parsedFreeTier = DEFAULT_FREE_TIER_BENEFITS;
      if (freeTierSetting?.value) {
        try {
          const raw = JSON.parse(freeTierSetting.value);
          parsedFreeTier = {
            coreBenefits:
              typeof raw?.coreBenefits === "string" && raw.coreBenefits.trim()
                ? raw.coreBenefits.trim()
                : DEFAULT_FREE_TIER_BENEFITS.coreBenefits,
            templateLibraryAccess:
              typeof raw?.templateLibraryAccess === "string" && raw.templateLibraryAccess.trim()
                ? raw.templateLibraryAccess.trim()
                : DEFAULT_FREE_TIER_BENEFITS.templateLibraryAccess,
            inviteLimit:
              Number.isFinite(Number(raw?.inviteLimit)) && Number(raw.inviteLimit) >= 0
                ? Math.trunc(Number(raw.inviteLimit))
                : DEFAULT_FREE_TIER_BENEFITS.inviteLimit,
            imageDailyLimit: DEFAULT_FREE_TIER_BENEFITS.imageDailyLimit,
            videoDailyLimit: DEFAULT_FREE_TIER_BENEFITS.videoDailyLimit,
            seedance2Access:
              raw?.seedance2Access === "enabled" ? "enabled" : DEFAULT_FREE_TIER_BENEFITS.seedance2Access,
            happyhorseAccess:
              raw?.happyhorseAccess === "enabled" ? "enabled" : DEFAULT_FREE_TIER_BENEFITS.happyhorseAccess,
            supportLevel:
              typeof raw?.supportLevel === "string" && raw.supportLevel.trim()
                ? raw.supportLevel.trim()
                : DEFAULT_FREE_TIER_BENEFITS.supportLevel,
          };
        } catch {
          parsedFreeTier = DEFAULT_FREE_TIER_BENEFITS;
        }
      }
      setFreeTierBenefits({
        monthlyQuotaCredits: String(policyResult.effective.freeUserMonthlyQuotaCredits),
        dailyRewardCredits: String(policyResult.effective.dailyRewardCredits),
        consecutive7DayRewardMultiplier: String(
          policyResult.effective.consecutive7DayRewardMultiplier,
        ),
        coreBenefits: parsedFreeTier.coreBenefits,
        templateLibraryAccess: parsedFreeTier.templateLibraryAccess,
        inviteLimit: String(parsedFreeTier.inviteLimit),
        imageDailyLimit: String(parsedFreeTier.imageDailyLimit),
        videoDailyLimit: String(parsedFreeTier.videoDailyLimit),
        seedance2Access: parsedFreeTier.seedance2Access,
        happyhorseAccess: parsedFreeTier.happyhorseAccess,
        supportLevel: parsedFreeTier.supportLevel,
      });
    } catch (error) {
      console.error("加载 VIP 管理数据失败:", error);
      alert("加载 VIP 管理数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVipData();
  }, []);

  const resetPlanForm = () => {
    setEditingPlanId(null);
    setPlanMetadataText(DEFAULT_PLAN_METADATA_TEXT);
    setPlanForm({
      code: "",
      name: "",
      billingCycle: "monthly",
      price: "",
      monthlyQuotaCredits: "0",
      signupBonusCredits: "0",
      dailyGiftCredits: "0",
      coreBenefits: "",
      templateLibraryAccess: "",
      inviteLimit: "",
      seedance2Access: "disabled",
      happyhorseAccess: "disabled",
      noWatermarkAccess: "disabled",
      supportLevel: "",
      sortOrder: "0",
      isActive: true,
    });
  };

  const closePlanModal = () => {
    setPlanModalOpen(false);
    resetPlanForm();
  };

  const openCreatePlanModal = () => {
    resetPlanForm();
    setPlanModalOpen(true);
  };

  const handleEditPlan = (plan: AdminMembershipPlan) => {
    setEditingPlanId(plan.id);
    setPlanForm({
      code: plan.code,
      name: plan.name,
      billingCycle: plan.billingCycle,
      price: String(plan.price),
      monthlyQuotaCredits: String(plan.monthlyQuotaCredits),
      signupBonusCredits: String(plan.signupBonusCredits),
      dailyGiftCredits: String(plan.dailyGiftCredits),
      coreBenefits: getPlanCoreBenefits(plan.metadata),
      templateLibraryAccess: getPlanTemplateLibraryAccess(plan.metadata),
      inviteLimit: getPlanInviteLimit(plan.metadata),
      seedance2Access: getPlanSeedance2Access(plan.metadata),
      happyhorseAccess: getPlanHappyhorseAccess(plan.metadata),
      noWatermarkAccess: getPlanNoWatermarkAccess(plan.metadata),
      supportLevel: getPlanSupportLevel(plan.metadata),
      sortOrder: String(plan.sortOrder),
      isActive: plan.isActive,
    });
    setPlanMetadataText(JSON.stringify(plan.metadata || {}, null, 2));
    setPlanModalOpen(true);
  };

  const parsePlanPayload = () => {
    let metadata: Record<string, any> = {};
    try {
      metadata = planMetadataText.trim() ? JSON.parse(planMetadataText) : {};
    } catch {
      throw new Error("套餐 metadata JSON 格式不正确");
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new Error("套餐 metadata JSON 必须是对象");
    }

    if (!planForm.code.trim() || !planForm.name.trim() || !planForm.price.trim()) {
      throw new Error("请填写套餐编码、名称和价格");
    }

    metadata = buildPlanMetadata(metadata, {
      coreBenefits: planForm.coreBenefits,
      templateLibraryAccess: planForm.templateLibraryAccess,
      inviteLimit: planForm.inviteLimit,
      seedance2Access: planForm.seedance2Access,
      happyhorseAccess: planForm.happyhorseAccess,
      noWatermarkAccess: planForm.noWatermarkAccess,
      supportLevel: planForm.supportLevel,
    });

    return {
      code: planForm.code.trim(),
      name: planForm.name.trim(),
      billingCycle: planForm.billingCycle,
      price: Number(planForm.price),
      monthlyQuotaCredits: Number(planForm.monthlyQuotaCredits || 0),
      signupBonusCredits: Number(planForm.signupBonusCredits || 0),
      dailyGiftCredits: Number(planForm.dailyGiftCredits || 0),
      sortOrder: Number(planForm.sortOrder || 0),
      isActive: planForm.isActive,
      metadata,
    };
  };

  const handleSavePlan = async () => {
    setSavingPlan(true);
    try {
      const payload = parsePlanPayload();
      if (editingPlanId) {
        await updateAdminMembershipPlan(editingPlanId, payload);
        alert("会员套餐已更新");
      } else {
        await createAdminMembershipPlan(payload);
        alert("会员套餐已创建");
      }
      closePlanModal();
      loadVipData();
    } catch (error: any) {
      alert(error.message || "保存套餐失败");
    } finally {
      setSavingPlan(false);
    }
  };

  const handleTogglePlanActive = async (plan: AdminMembershipPlan) => {
    try {
      await updateAdminMembershipPlan(plan.id, { isActive: !plan.isActive });
      loadVipData();
    } catch (error: any) {
      alert(error.message || "更新套餐状态失败");
    }
  };

  const handleSaveFreeTierBenefits = async () => {
    setSavingFreeTierBenefits(true);
    try {
      const monthlyQuotaCredits = Number(freeTierBenefits.monthlyQuotaCredits || 0);
      const dailyRewardCredits = Number(freeTierBenefits.dailyRewardCredits || 0);
      const consecutive7DayRewardMultiplier = Number(
        freeTierBenefits.consecutive7DayRewardMultiplier || 0,
      );
      const inviteLimit = Number(freeTierBenefits.inviteLimit || 0);
      const imageDailyLimit = DEFAULT_FREE_TIER_BENEFITS.imageDailyLimit;
      const videoDailyLimit = DEFAULT_FREE_TIER_BENEFITS.videoDailyLimit;
      if (!Number.isFinite(monthlyQuotaCredits) || monthlyQuotaCredits < 0) {
        throw new Error("免费用户月额度必须是大于等于 0 的数字");
      }
      if (!Number.isFinite(dailyRewardCredits) || dailyRewardCredits < 0) {
        throw new Error("免费签到积分必须是大于等于 0 的数字");
      }
      if (
        !Number.isFinite(consecutive7DayRewardMultiplier) ||
        consecutive7DayRewardMultiplier < 0
      ) {
        throw new Error("7日连签倍率必须是大于等于 0 的数字");
      }
      if (!Number.isFinite(inviteLimit) || inviteLimit < 0) {
        throw new Error("免费用户邀请上限必须是大于等于 0 的数字");
      }
      if (!Number.isFinite(imageDailyLimit) || imageDailyLimit < 0) {
        throw new Error("免费用户日生图上限必须是大于等于 0 的数字");
      }
      if (!Number.isFinite(videoDailyLimit) || videoDailyLimit < 0) {
        throw new Error("免费用户日视频上限必须是大于等于 0 的数字");
      }

      await Promise.all([
        upsertSetting({
          key: FREE_TIER_BENEFITS_SETTING_KEY,
          value: JSON.stringify({
            coreBenefits: freeTierBenefits.coreBenefits.trim(),
            templateLibraryAccess: freeTierBenefits.templateLibraryAccess.trim(),
            inviteLimit: Math.trunc(inviteLimit),
            imageDailyLimit: Math.trunc(imageDailyLimit),
            videoDailyLimit: Math.trunc(videoDailyLimit),
            seedance2Access: freeTierBenefits.seedance2Access === "enabled" ? "enabled" : "disabled",
            happyhorseAccess: "disabled",
            supportLevel: freeTierBenefits.supportLevel.trim(),
          }),
          description: "会员权益配置：免费用户档位",
        }),
        updateMembershipCreditPolicy({
          freeUserMonthlyQuotaCredits: Math.trunc(monthlyQuotaCredits),
          dailyRewardCredits: Math.trunc(dailyRewardCredits),
          consecutive7DayRewardMultiplier: Math.trunc(consecutive7DayRewardMultiplier),
        }),
      ]);
      setFreeTierModalOpen(false);
      await loadVipData();
      alert("免费用户权益已保存");
    } catch (error: any) {
      alert(error.message || "保存免费用户权益失败");
    } finally {
      setSavingFreeTierBenefits(false);
    }
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const payload: MembershipCreditPolicyConfig = {
        dailyGiftDecayCredits: Number(policyForm.dailyGiftDecayCredits),
        fixedCreditExpireDays: Number(policyForm.fixedCreditExpireDays),
        freeUserMonthlyQuotaCredits: Number(policyForm.freeUserMonthlyQuotaCredits),
        dailyRewardCredits: Number(policyForm.dailyRewardCredits),
        consecutive7DayRewardMultiplier: Number(policyForm.consecutive7DayRewardMultiplier),
        membershipRefreshCycleDays: Number(policyForm.membershipRefreshCycleDays),
      };
      const result = await updateMembershipCreditPolicy(payload);
      setPolicyView(result);
      setPolicyForm(result.effective);
      alert("VIP 策略已保存");
    } catch (error: any) {
      alert(error.message || "保存策略失败");
    } finally {
      setSavingPolicy(false);
    }
  };

  const runMembershipOp = async (
    runner: () => Promise<any>,
    successMessage: (result: any) => string,
  ) => {
    try {
      setOpsLoading(true);
      const result = await runner();
      alert(successMessage(result));
    } catch (error: any) {
      alert(error.message || "执行失败");
    } finally {
      setOpsLoading(false);
    }
  };

  if (loading && !policyView) {
    return <div className='py-8 text-center text-gray-500'>加载中...</div>;
  }

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        <StatCard title='会员套餐数' value={plans.length} />
        <StatCard title='启用套餐' value={plans.filter((plan) => plan.isActive).length} />
        <StatCard
          title='固定积分时效'
          value={`${policyForm.fixedCreditExpireDays} 天`}
          subtitle='0 表示永久'
        />
      </div>

      <div className='rounded-lg border bg-white p-6 shadow-sm'>
          <div className='mb-4 flex items-center justify-between gap-4'>
            <div>
              <h3 className='text-lg font-semibold'>会员积分策略</h3>
              <p className='mt-1 text-sm text-gray-500'>
              这里配置赠送积分衰减、固定积分时效和刷新周期。免费用户月额度、签到积分、连签倍率已收口到“免费用户”套餐内配置。
              </p>
            </div>
            <Button onClick={handleSavePolicy} disabled={savingPolicy}>
            {savingPolicy ? "保存中..." : "保存策略"}
          </Button>
        </div>

        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {[
            ["dailyGiftDecayCredits", "赠送积分日衰减", "每天自动衰减的赠送积分数量"],
            ["fixedCreditExpireDays", "固定积分有效期", "充值/后台补发积分的有效天数，0 为永久"],
            ["membershipRefreshCycleDays", "会员刷新周期", "月卡/年卡配额刷新按这个周期计算"],
          ].map(([key, label, hint]) => (
            <div key={key} className='rounded-lg border border-gray-200 p-4'>
              <div className='text-sm font-medium text-gray-900'>{label}</div>
              <div className='mt-1 text-xs text-gray-500'>{hint}</div>
              <Input
                type='number'
                min='0'
                className='mt-3'
                value={String(policyForm[key as keyof MembershipCreditPolicyConfig])}
                onChange={(e) =>
                  setPolicyForm((current) => ({
                    ...current,
                    [key]: Number(e.target.value || 0),
                  }))
                }
              />
              {policyView?.defaults?.[key as keyof MembershipCreditPolicyConfig] !== undefined && (
                <div className='mt-2 text-xs text-gray-400'>
                  默认值：{String(policyView.defaults[key as keyof MembershipCreditPolicyConfig])}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className='rounded-lg border bg-white p-6 shadow-sm'>
        <div className='rounded-lg border border-dashed border-gray-200 p-4'>
          <div className='text-sm font-medium text-gray-900'>验证完整性按钮</div>
          <div className='mt-1 text-xs text-gray-500'>
            用于立即执行定时任务对应逻辑，避免联调时等待 cron。
          </div>
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                void runMembershipOp(
                  () => adminApplyScheduledMembershipChanges(),
                  (result) => `待生效订阅切换已执行，应用 ${result.appliedCount ?? 0} 条`,
                )
              }
              disabled={opsLoading}
            >
              立即执行待生效切换
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                void runMembershipOp(
                  () => adminExpireMembershipScan(),
                  (result) =>
                    `到期扫描完成，expiredSubscriptions=${result.expiredSubscriptions ?? 0}，expiredLots=${result.expiredLots ?? 0}`,
                )
              }
              disabled={opsLoading}
            >
              立即执行到期扫描
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                void runMembershipOp(
                  () => adminIssueDailyMembershipGifts(),
                  (result) => `自动每日赠送已停用，issued=${result.issuedSubscriptions ?? 0}，granted=${result.grantedCredits ?? 0}`,
                )
              }
              disabled={opsLoading}
            >
              校验自动赠送停用状态
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                void runMembershipOp(
                  () => adminDecayMembershipGifts(),
                  (result) => `赠送积分衰减完成，users=${result.affectedUsers ?? 0}，decayed=${result.decayedCredits ?? 0}`,
                )
              }
              disabled={opsLoading}
            >
              立即执行赠送衰减
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                void runMembershipOp(
                  () => adminRefreshYearlyMembershipQuota(),
                  (result) => `年费月额度刷新完成，subscriptions=${result.refreshedSubscriptions ?? 0}，granted=${result.grantedCredits ?? 0}`,
                )
              }
              disabled={opsLoading}
            >
              立即刷新年费月额度
            </Button>
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-white p-6 shadow-sm'>
        <div className='mb-4 flex items-center justify-between'>
          <div>
            <h3 className='text-lg font-semibold'>会员套餐列表</h3>
            <p className='mt-1 text-sm text-gray-500'>
              管理免费用户与前台可售 VIP 套餐，支持权益、排序、启停和额度配置。
            </p>
          </div>
          <Button variant='outline' onClick={openCreatePlanModal}>
            新建套餐
          </Button>
        </div>

        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50 text-gray-600'>
              <tr>
                <th className='px-3 py-2 text-left'>套餐</th>
                <th className='px-3 py-2 text-left'>周期</th>
                <th className='px-3 py-2 text-left'>价格</th>
                <th className='px-3 py-2 text-left'>总额度</th>
                <th className='px-3 py-2 text-left'>月额度</th>
                <th className='px-3 py-2 text-left'>签到积分</th>
                <th className='px-3 py-2 text-left'>模板库</th>
                <th className='px-3 py-2 text-left'>邀请上限</th>
                <th className='px-3 py-2 text-left'>支持等级</th>
                <th className='px-3 py-2 text-left'>状态</th>
                <th className='px-3 py-2 text-left'>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr className='border-t align-top bg-amber-50/40'>
                <td className='px-3 py-3'>
                  <div className='font-medium text-gray-900'>免费用户</div>
                  <div className='mt-1 font-mono text-xs text-gray-500'>free_user</div>
                </td>
                <td className='px-3 py-3'>默认</td>
                <td className='px-3 py-3'>¥0.00</td>
                <td className='px-3 py-3'>{freeTierBenefits.monthlyQuotaCredits || "0"}</td>
                <td className='px-3 py-3'>{freeTierBenefits.monthlyQuotaCredits || "0"}</td>
                <td className='px-3 py-3'>-</td>
                <td className='px-3 py-3'>{freeTierBenefits.templateLibraryAccess || "-"}</td>
                <td className='px-3 py-3'>{freeTierBenefits.inviteLimit || "-"}</td>
                <td className='px-3 py-3'>{freeTierBenefits.supportLevel || "-"}</td>
                <td className='px-3 py-3'>
                  <span className='rounded bg-blue-100 px-2 py-1 text-xs text-blue-700'>启用中</span>
                </td>
                <td className='px-3 py-3'>
                  <div className='mb-1 text-xs text-gray-500'>
                    {Number(freeTierBenefits.imageDailyLimit || 0) <= 0 &&
                    Number(freeTierBenefits.videoDailyLimit || 0) <= 0
                      ? "图片与视频生成不限每日次数"
                      : `每天最多 ${freeTierBenefits.imageDailyLimit || "0"} 张图、${freeTierBenefits.videoDailyLimit || "0"} 个视频`}
                  </div>
                  <div className='mb-1 text-xs text-gray-500'>
                    {`Seedance 2 权益：${freeTierBenefits.seedance2Access === "enabled" ? "支持" : "不支持"}`}
                  </div>
                  <div className='mb-1 text-xs text-gray-500'>快乐马权益：不支持</div>
                  <div className='mb-1 text-xs text-gray-500'>无水印权益：不支持</div>
                  <div className='flex flex-wrap gap-2'>
                    <Button size='sm' variant='outline' onClick={() => setFreeTierModalOpen(true)}>
                      编辑
                    </Button>
                  </div>
                </td>
              </tr>
              {plans.map((plan) => (
                <tr key={plan.id} className='border-t align-top'>
                  <td className='px-3 py-3'>
                    <div className='font-medium text-gray-900'>{plan.name}</div>
                    <div className='mt-1 font-mono text-xs text-gray-500'>{plan.code}</div>
                  </td>
                  <td className='px-3 py-3'>{plan.billingCycle === "yearly" ? "年费" : "月费"}</td>
                  <td className='px-3 py-3'>¥{Number(plan.price).toFixed(2)}</td>
                  <td className='px-3 py-3'>{Number(plan.monthlyQuotaCredits) + Number(plan.signupBonusCredits)}</td>
                  <td className='px-3 py-3'>{plan.monthlyQuotaCredits}</td>
                  <td className='px-3 py-3'>{plan.dailyGiftCredits}</td>
                  <td className='px-3 py-3'>{getPlanTemplateLibraryAccess(plan.metadata) || "-"}</td>
                  <td className='px-3 py-3'>{getPlanInviteLimit(plan.metadata) || "-"}</td>
                    <td className='px-3 py-3'>{getPlanSupportLevel(plan.metadata) || "-"}</td>
                    <td className='px-3 py-3'>
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        plan.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {plan.isActive ? "启用中" : "已停用"}
                    </span>
                  </td>
                  <td className='px-3 py-3'>
                    <div className='mb-1 text-xs text-gray-500'>{getPlanCoreBenefits(plan.metadata) || "-"}</div>
                    <div className='mb-1 text-xs text-gray-500'>
                      {`Seedance 2 权益：${getPlanSeedance2Access(plan.metadata) === "enabled" ? "支持" : "不支持"}`}
                    </div>
                    <div className='mb-1 text-xs text-gray-500'>
                      {`快乐马权益：${getPlanHappyhorseAccess(plan.metadata) === "enabled" ? "支持" : "不支持"}`}
                    </div>
                    <div className='mb-1 text-xs text-gray-500'>
                      {`无水印权益：${getPlanNoWatermarkAccess(plan.metadata) === "enabled" ? "支持" : "不支持"}`}
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      <Button size='sm' variant='outline' onClick={() => handleEditPlan(plan)}>
                        编辑
                      </Button>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => handleTogglePlanActive(plan)}
                      >
                        {plan.isActive ? "停用" : "启用"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr>
                  <td colSpan={11} className='px-3 py-8 text-center text-gray-500'>
                    暂无会员套餐
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {planModalOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-6 shadow-xl'>
            <div className='mb-4 flex items-start justify-between gap-4'>
              <div>
                <h3 className='text-lg font-semibold'>
                  {editingPlanId ? "编辑会员套餐" : "新建会员套餐"}
                </h3>
                <p className='mt-1 text-sm text-gray-500'>
                  前端展示与下单都会读这里的套餐数据，编码建议保持稳定。
                </p>
              </div>
              <Button variant='outline' onClick={closePlanModal}>
                关闭
              </Button>
            </div>

            <div className='space-y-4'>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <div>
                <div className='mb-1 text-sm text-gray-600'>套餐编码</div>
                <Input
                  value={planForm.code}
                  onChange={(e) => setPlanForm((current) => ({ ...current, code: e.target.value }))}
                  placeholder='vip_199_monthly'
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>套餐名称</div>
                <Input
                  value={planForm.name}
                  onChange={(e) => setPlanForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder='VIP 199 月卡'
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>计费周期</div>
                <select
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                  value={planForm.billingCycle}
                  onChange={(e) =>
                    setPlanForm((current) => ({
                      ...current,
                      billingCycle: e.target.value as "monthly" | "yearly",
                    }))
                  }
                >
                  <option value='monthly'>月费</option>
                  <option value='yearly'>年费</option>
                </select>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>价格</div>
                <Input
                  type='number'
                  min='0'
                  step='0.01'
                  value={planForm.price}
                  onChange={(e) => setPlanForm((current) => ({ ...current, price: e.target.value }))}
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>月额度积分</div>
                <Input
                  type='number'
                  min='0'
                  value={planForm.monthlyQuotaCredits}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, monthlyQuotaCredits: e.target.value }))
                  }
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>附加积分</div>
                <Input
                  type='number'
                  min='0'
                  value={planForm.signupBonusCredits}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, signupBonusCredits: e.target.value }))
                  }
                />
                <div className='mt-1 text-xs text-gray-400'>用于补充套餐总额度，不再对外单独展示。</div>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>签到积分额度</div>
                <Input
                  type='number'
                  min='0'
                  value={planForm.dailyGiftCredits}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, dailyGiftCredits: e.target.value }))
                  }
                />
                <div className='mt-1 text-xs text-gray-400'>
                  该值只用于会员每日签到发放，不会由系统自动按天直接入账。
                </div>
              </div>
              <div className='md:col-span-2'>
                <div className='mb-1 text-sm text-gray-600'>核心权益</div>
                <Input
                  value={planForm.coreBenefits}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, coreBenefits: e.target.value }))
                  }
                  placeholder='去水印、Seedance 2 / 快乐马权益、积分不衰减，每日签到 50 积分'
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>模板库权限</div>
                <select
                  value={planForm.templateLibraryAccess}
                  onChange={(e) =>
                    setPlanForm((current) => ({
                      ...current,
                      templateLibraryAccess: e.target.value,
                    }))
                  }
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                >
                  {TEMPLATE_LIBRARY_ACCESS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>Seedance 2 权益</div>
                <select
                  value={planForm.seedance2Access}
                  onChange={(e) =>
                    setPlanForm((current) => ({
                      ...current,
                      seedance2Access: e.target.value,
                    }))
                  }
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                >
                  {SEEDANCE2_ACCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>快乐马权益</div>
                <select
                  value={planForm.happyhorseAccess}
                  onChange={(e) =>
                    setPlanForm((current) => ({
                      ...current,
                      happyhorseAccess: e.target.value,
                    }))
                  }
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                >
                  {HAPPYHORSE_ACCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className='mt-1 text-xs text-gray-400'>默认不支持；成功充值用户也可使用，未充值会员需启用该套餐权益。</div>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>无水印权益</div>
                <select
                  value={planForm.noWatermarkAccess}
                  onChange={(e) =>
                    setPlanForm((current) => ({
                      ...current,
                      noWatermarkAccess: e.target.value,
                    }))
                  }
                  className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                >
                  {NO_WATERMARK_ACCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>邀请上限</div>
                <Input
                  type='number'
                  min='0'
                  value={planForm.inviteLimit}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, inviteLimit: e.target.value }))
                  }
                  placeholder='20'
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>支持等级</div>
                <Input
                  value={planForm.supportLevel}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, supportLevel: e.target.value }))
                  }
                  placeholder='官方支持'
                />
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>排序</div>
                <Input
                  type='number'
                  value={planForm.sortOrder}
                  onChange={(e) =>
                    setPlanForm((current) => ({ ...current, sortOrder: e.target.value }))
                  }
                />
              </div>
            </div>

            <label className='flex items-center gap-2 text-sm text-gray-700'>
              <input
                type='checkbox'
                checked={planForm.isActive}
                onChange={(e) => setPlanForm((current) => ({ ...current, isActive: e.target.checked }))}
              />
              套餐启用
            </label>

            <div>
              <div className='mb-1 text-sm text-gray-600'>metadata JSON</div>
              <textarea
                className='min-h-[160px] w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs'
                value={planMetadataText}
                onChange={(e) => setPlanMetadataText(e.target.value)}
              />
            </div>

            <div className='flex gap-3'>
              <Button onClick={handleSavePlan} disabled={savingPlan}>
                {savingPlan ? "保存中..." : editingPlanId ? "保存套餐" : "创建套餐"}
              </Button>
              <Button variant='outline' onClick={closePlanModal}>
                取消
              </Button>
            </div>
          </div>
        </div>
        </div>
      )}

      {freeTierModalOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl'>
            <div className='mb-4 flex items-start justify-between gap-4'>
              <div>
                <h3 className='text-lg font-semibold'>编辑免费用户权益</h3>
                <p className='mt-1 text-sm text-gray-500'>
                  这里配置免费用户在权益对比表中的展示与邀请上限。
                </p>
              </div>
              <Button variant='outline' onClick={() => setFreeTierModalOpen(false)}>
                关闭
              </Button>
            </div>

            <div className='space-y-4'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>免费用户月额度积分</div>
                  <Input
                    type='number'
                    min='0'
                    value={freeTierBenefits.monthlyQuotaCredits}
                    onChange={(e) =>
                      setFreeTierBenefits((current) => ({
                        ...current,
                        monthlyQuotaCredits: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className='rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700'>
                  标准版图片与视频生成功能不限每日次数（固定策略）
                </div>
              </div>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>免费签到积分</div>
                  <Input
                    type='number'
                    min='0'
                    value={freeTierBenefits.dailyRewardCredits}
                    onChange={(e) =>
                      setFreeTierBenefits((current) => ({
                        ...current,
                        dailyRewardCredits: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className='md:max-w-xs'>
                  <div className='mb-1 text-sm text-gray-600'>7日连签倍率</div>
                  <Input
                    type='number'
                    min='0'
                    value={freeTierBenefits.consecutive7DayRewardMultiplier}
                    onChange={(e) =>
                      setFreeTierBenefits((current) => ({
                        ...current,
                        consecutive7DayRewardMultiplier: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>核心权益</div>
                <Input
                  value={freeTierBenefits.coreBenefits}
                  onChange={(e) =>
                    setFreeTierBenefits((current) => ({ ...current, coreBenefits: e.target.value }))
                  }
                />
              </div>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>模板库权限</div>
                  <select
                    value={freeTierBenefits.templateLibraryAccess}
                    onChange={(e) =>
                      setFreeTierBenefits((current) => ({
                        ...current,
                        templateLibraryAccess: e.target.value,
                      }))
                    }
                    className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm'
                  >
                    {TEMPLATE_LIBRARY_ACCESS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <div className='mb-1 text-sm text-gray-600'>邀请上限</div>
                  <Input
                    type='number'
                    min='0'
                    value={freeTierBenefits.inviteLimit}
                    onChange={(e) =>
                      setFreeTierBenefits((current) => ({ ...current, inviteLimit: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <div className='mb-1 text-sm text-gray-600'>支持等级</div>
                <Input
                  value={freeTierBenefits.supportLevel}
                  onChange={(e) =>
                    setFreeTierBenefits((current) => ({ ...current, supportLevel: e.target.value }))
                  }
                />
              </div>

              <div className='flex gap-3'>
                <Button onClick={handleSaveFreeTierBenefits} disabled={savingFreeTierBenefits}>
                  {savingFreeTierBenefits ? "保存中..." : "保存权益"}
                </Button>
                <Button variant='outline' onClick={() => setFreeTierModalOpen(false)}>
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 节点配置管理 Tab
function NodeConfigsTab() {
  const [configs, setConfigs] = useState<NodeConfig[]>([]);
  const [managedModels, setManagedModels] = useState<ManagedModelConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState<NodeConfig | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [metadataText, setMetadataText] = useState("{}");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importingModelKey, setImportingModelKey] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const result = await getNodeConfigs();
      setConfigs(result);
    } catch (error) {
      console.error("加载节点配置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    const loadManagedModels = async () => {
      try {
        const settings = await getSettings();
        const existing = settings.find(
          (item) => item.key === MODEL_PROVIDER_MAPPING_SETTING_KEY
        );
        const source = existing?.value?.trim()
          ? JSON.parse(existing.value)
          : JSON.parse(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE);
        const normalized = normalizeModelMapping(source);
        setManagedModels(normalized.models || []);
      } catch (error) {
        console.error("加载模型管理配置失败:", error);
        setManagedModels([]);
      }
    };

    loadManagedModels();
  }, []);

  const handleEdit = (config: NodeConfig) => {
    setEditingConfig({ ...config });
    setMetadataText(JSON.stringify(config.metadata || {}, null, 2));
    setIsCreating(false);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingConfig({
      nodeKey: "",
      nameZh: "",
      nameEn: "",
      category: "other",
      status: "normal",
      creditsPerCall: 0,
      sortOrder: 0,
      isVisible: true,
    });
    setMetadataText("{}");
    setIsCreating(true);
    setModalOpen(true);
  };

  const handleImportFromManagedModel = async () => {
    const model = managedModels.find((item) => item.modelKey === importingModelKey);
    if (!model) {
      showToast("请选择要导入的模型", "error");
      return;
    }

    const nodeConfig = getManagedNodeConfig(model);
    const nodeKey = nodeConfig.nodeKey || "";
    if (!nodeKey) {
      showToast("该模型缺少可复用的节点标识，请先补充模型节点模板", "error");
      return;
    }

    if (configs.some((item) => item.nodeKey === nodeKey)) {
      showToast(`节点标识 ${nodeKey} 已存在，请直接在节点管理中编辑`, "error");
      return;
    }

    const taskType = normalizeManagedModelTaskType(model.taskType);
    const payload = {
      nodeKey,
      nameZh: model.modelName || model.modelKey,
      nameEn: model.modelKey,
      category: nodeConfig.category || (taskType === "text" ? "input" : taskType),
      status: "normal" as const,
      creditsPerCall: nodeConfig.creditsPerCall || 0,
      serviceType: getManagedModelServiceType(model) || undefined,
      sortOrder: nodeConfig.sortOrder || 0,
      isVisible: true,
      description: nodeConfig.description || `${model.modelName || model.modelKey} 节点（模型管理导入）`,
      metadata: buildManagedNodeMetadata(model),
    };

    try {
      await createNodeConfig(payload);
      notifyNodeConfigsUpdated();
      showToast(`已导入节点 ${payload.nameZh}`);
      setImportModalOpen(false);
      setImportingModelKey("");
      loadConfigs();
    } catch (error: any) {
      showToast(error.message || "导入失败", "error");
    }
  };

  const handleSave = async () => {
    if (!editingConfig) return;
    let parsedMetadata: Record<string, any> = {};
    try {
      parsedMetadata = metadataText.trim() ? JSON.parse(metadataText) : {};
    } catch {
      showToast("metadata JSON 格式不正确", "error");
      return;
    }

    if (isCreating) {
      if (!editingConfig.nodeKey || !editingConfig.nameZh || !editingConfig.nameEn) {
        showToast("请填写节点标识、中文名称和英文名称", "error");
        return;
      }
      try {
        await createNodeConfig({
          nodeKey: editingConfig.nodeKey,
          nameZh: editingConfig.nameZh,
          nameEn: editingConfig.nameEn,
          category: editingConfig.category,
          status: editingConfig.status,
          statusMessage: editingConfig.statusMessage,
          creditsPerCall: editingConfig.creditsPerCall,
          priceYuan: editingConfig.priceYuan,
          serviceType: editingConfig.serviceType,
          sortOrder: editingConfig.sortOrder,
          isVisible: editingConfig.isVisible,
          description: editingConfig.description,
          metadata: parsedMetadata,
        });
        notifyNodeConfigsUpdated();
        setModalOpen(false);
        setEditingConfig(null);
        setMetadataText("{}");
        showToast("节点配置已创建");
        loadConfigs();
      } catch (error: any) {
        showToast(error.message || "创建失败", "error");
      }
    } else {
      try {
        await updateNodeConfig(editingConfig.nodeKey, {
          nameZh: editingConfig.nameZh,
          nameEn: editingConfig.nameEn,
          category: editingConfig.category,
          status: editingConfig.status,
          statusMessage: editingConfig.statusMessage,
          creditsPerCall: editingConfig.creditsPerCall,
          priceYuan: editingConfig.priceYuan,
          serviceType: editingConfig.serviceType,
          sortOrder: editingConfig.sortOrder,
          isVisible: editingConfig.isVisible,
          description: editingConfig.description,
          metadata: parsedMetadata,
        });
        notifyNodeConfigsUpdated();
        setModalOpen(false);
        setEditingConfig(null);
        setMetadataText("{}");
        showToast("节点配置已保存");
        loadConfigs();
      } catch (error: any) {
        showToast(error.message || "保存失败", "error");
      }
    }
  };

  const handleDelete = async (nodeKey: string, nameZh: string) => {
    if (!confirm(`确定要删除节点"${nameZh}"吗？此操作不可恢复。`)) {
      return;
    }
    try {
      await deleteNodeConfig(nodeKey);
      notifyNodeConfigsUpdated();
      showToast(`节点 ${nameZh} 已删除`);
      loadConfigs();
    } catch (error: any) {
      showToast(error.message || "删除失败", "error");
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const summarizeMetadata = (metadata?: Record<string, any>) => {
    if (!metadata || typeof metadata !== "object") return "-";
    const vod = metadata.vod && typeof metadata.vod === "object" ? metadata.vod : undefined;
    if (vod) {
      const res = Array.isArray(vod.outputConfig?.resolutions)
        ? vod.outputConfig.resolutions.join("/")
        : "";
      return [
        "VOD",
        vod.modelName,
        vod.modelVersion,
        res,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (Array.isArray(metadata.modelKeys) && metadata.modelKeys.length > 0) {
      return metadata.modelKeys.join(", ");
    }
    if (typeof metadata.provider === "string" && metadata.provider.trim()) {
      return metadata.provider.trim();
    }
    return "-";
  };

  const statusOptions = [
    { value: "normal", label: "正常" },
    { value: "maintenance", label: "维护中" },
    { value: "coming_soon", label: "即将开放" },
    { value: "disabled", label: "已禁用" },
  ];

  const categoryOptions = [
    { value: "input", label: "输入节点" },
    { value: "image", label: "图像生成" },
    { value: "video", label: "视频生成" },
    { value: "other", label: "其他" },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "normal":
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">正常</span>;
      case "maintenance":
        return <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">维护中</span>;
      case "coming_soon":
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">即将开放</span>;
      case "disabled":
        return <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">已禁用</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{status}</span>;
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case "input":
        return <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">输入</span>;
      case "image":
        return <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">图像</span>;
      case "video":
        return <span className="px-2 py-1 bg-pink-100 text-pink-700 rounded text-xs">视频</span>;
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">其他</span>;
    }
  };

  return (
    <div>
      {toast && (
        <div className="fixed right-6 top-6 z-[70]">
          <div
            className={`min-w-[240px] rounded-lg border px-4 py-3 text-sm shadow-lg ${
              toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
      <div className="mb-4">
        <div className="flex gap-2">
          <Button onClick={handleCreate}>添加节点</Button>
          <Button variant="outline" onClick={() => setImportModalOpen(true)}>
            从模型管理导入
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="max-h-[800px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">节点</th>
                <th className="px-4 py-3 text-left">分类</th>
                <th className="px-4 py-3 text-left">状态</th>
                <th className="px-4 py-3 text-right">积分/次</th>
                <th className="px-4 py-3 text-right">原价(元)</th>
                <th className="px-4 py-3 text-left">服务类型</th>
                <th className="px-4 py-3 text-left">配置摘要</th>
                <th className="px-4 py-3 text-center">显示</th>
                <th className="px-4 py-3 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">加载中...</td>
                </tr>
              ) : configs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    暂无数据，请点击"初始化默认配置"
                  </td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.nodeKey} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{config.nameZh}</div>
                      <div className="text-xs text-gray-400">{config.nodeKey}</div>
                    </td>
                    <td className="px-4 py-3">{getCategoryBadge(config.category)}</td>
                    <td className="px-4 py-3">
                      {getStatusBadge(config.status)}
                      {config.statusMessage && (
                        <div className="text-xs text-gray-400 mt-1">{config.statusMessage}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {config.creditsPerCall > 0 ? config.creditsPerCall : <span className="text-green-600">免费</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {config.priceYuan ? `¥${config.priceYuan}` : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {config.serviceType || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[260px] truncate" title={summarizeMetadata(config.metadata)}>
                      {summarizeMetadata(config.metadata)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {config.isVisible ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-600">✗</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(config)}>
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(config.nodeKey, config.nameZh)}
                          className="text-red-600 hover:text-red-700 hover:border-red-300"
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑弹窗 */}
      {modalOpen && editingConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
            <h3 className="text-lg font-semibold mb-4">
              {isCreating ? "添加节点" : `编辑节点 - ${editingConfig.nameZh}`}
            </h3>
            <div className="space-y-4">
              {isCreating && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">节点标识 *</label>
                  <Input
                    value={editingConfig.nodeKey}
                    onChange={(e) => setEditingConfig({ ...editingConfig, nodeKey: e.target.value })}
                    placeholder="如：myNewNode（唯一标识，创建后不可修改）"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">中文名称 *</label>
                  <Input
                    value={editingConfig.nameZh}
                    onChange={(e) => setEditingConfig({ ...editingConfig, nameZh: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">英文名称 *</label>
                  <Input
                    value={editingConfig.nameEn}
                    onChange={(e) => setEditingConfig({ ...editingConfig, nameEn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">分类</label>
                  <select
                    value={editingConfig.category}
                    onChange={(e) => setEditingConfig({ ...editingConfig, category: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    {categoryOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">状态</label>
                  <select
                    value={editingConfig.status}
                    onChange={(e) => setEditingConfig({ ...editingConfig, status: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    {statusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">状态说明（可选）</label>
                <Input
                  value={editingConfig.statusMessage || ""}
                  onChange={(e) => setEditingConfig({ ...editingConfig, statusMessage: e.target.value })}
                  placeholder="如：接口维护中，预计明天恢复"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">积分消耗/次</label>
                  <Input
                    type="number"
                    value={editingConfig.creditsPerCall}
                    onChange={(e) => setEditingConfig({ ...editingConfig, creditsPerCall: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">原价(元)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingConfig.priceYuan || ""}
                    onChange={(e) => setEditingConfig({ ...editingConfig, priceYuan: parseFloat(e.target.value) || undefined })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">服务类型</label>
                  <Input
                    value={editingConfig.serviceType || ""}
                    onChange={(e) => setEditingConfig({ ...editingConfig, serviceType: e.target.value })}
                    placeholder="如：kling-o1-video"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">排序</label>
                  <Input
                    type="number"
                    value={editingConfig.sortOrder}
                    onChange={(e) => setEditingConfig({ ...editingConfig, sortOrder: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">描述</label>
                <Input
                  value={editingConfig.description || ""}
                  onChange={(e) => setEditingConfig({ ...editingConfig, description: e.target.value })}
                  placeholder="节点功能描述"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Metadata JSON</label>
                <textarea
                  value={metadataText}
                  onChange={(e) => setMetadataText(e.target.value)}
                  rows={14}
                  className="w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-blue-400"
                  placeholder='{"vod":{"modelName":"Kling","modelVersion":"3.0"}}'
                />
                <div className="mt-1 text-xs text-gray-400">
                  节点面板、画布视频节点的 VOD 能力展示都从这里读取。
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingConfig.isVisible}
                    onChange={(e) => setEditingConfig({ ...editingConfig, isVisible: e.target.checked })}
                  />
                  <span className="text-sm text-gray-600">在节点面板中显示</span>
                </label>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => { setModalOpen(false); setEditingConfig(null); setMetadataText("{}"); }}>
                  取消
                </Button>
                <Button onClick={handleSave}>保存</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold mb-4">从模型管理导入节点</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">选择模型</label>
                <select
                  value={importingModelKey}
                  onChange={(e) => setImportingModelKey(e.target.value)}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">请选择模型管理中的模型</option>
                  {managedModels.map((model) => {
                    const nodeConfig = getManagedNodeConfig(model);
                    return (
                      <option key={model.modelKey} value={model.modelKey}>
                        {(model.modelName || model.modelKey) +
                          " / nodeKey=" +
                          (nodeConfig.nodeKey || "-")}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm text-gray-600">
                该操作会基于模型管理中的动态 JSON 自动创建一条节点管理配置。
                画布内节点仍然只以节点管理中的显式配置为准。
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setImportModalOpen(false);
                    setImportingModelKey("");
                  }}
                >
                  取消
                </Button>
                <Button onClick={handleImportFromManagedModel} disabled={!importingModelKey}>
                  导入并创建
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UnifiedModelManagementTab() {
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [mappingDraft, setMappingDraft] = useState<ModelProviderMappingV2>(() =>
    buildPersistedModelMapping(JSON.parse(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE))
  );
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [selectedPlatformIndex, setSelectedPlatformIndex] = useState<number | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelTypeFilter, setModelTypeFilter] = useState<"all" | ManagedModelTaskType>("all");
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonText, setJsonText] = useState(DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE);
  const [showPlatformPanel, setShowPlatformPanel] = useState(false);
  const [showAdvancedModelConfig, setShowAdvancedModelConfig] = useState(false);
  const [showAdvancedVendorConfig, setShowAdvancedVendorConfig] = useState(false);
  const [pricingJsonDraftByVendor, setPricingJsonDraftByVendor] = useState<Record<string, string>>({});
  const [pricingPreviewByVendor, setPricingPreviewByVendor] = useState<
    Record<string, ManagedPricingPreviewResponse | null>
  >({});
  const [pricingPreviewLoadingByVendor, setPricingPreviewLoadingByVendor] = useState<
    Record<string, boolean>
  >({});
  const [pricingPresetPreviewByVendor, setPricingPresetPreviewByVendor] = useState<
    Record<string, ManagedPricingPreviewResponse[]>
  >({});
  const [pricingPresetPreviewLoadingByVendor, setPricingPresetPreviewLoadingByVendor] = useState<
    Record<string, boolean>
  >({});

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const cloneMapping = (input: ModelProviderMappingV2): ModelProviderMappingV2 =>
    JSON.parse(stringifyPrettyJson(buildPersistedModelMapping(input)));

  const createSpecRule = () => ({
    label: "",
    match: { resolution: "720P", duration: 5 } as Record<string, any>,
    creditsPerCall: 0,
    priceYuan: undefined,
  });

  const syncDraftFromObject = (input: ModelProviderMappingV2) => {
    const normalized = cloneMapping(input);
    setMappingDraft(normalized);
    setJsonText(stringifyPrettyJson(normalized));
    setPricingJsonDraftByVendor({});
    setPricingPreviewByVendor({});
    setPricingPreviewLoadingByVendor({});
    setPricingPresetPreviewByVendor({});
    setPricingPresetPreviewLoadingByVendor({});

    const modelCount = normalized.models?.length || 0;
    setSelectedModelIndex((current) => {
      if (modelCount === 0) return 0;
      return Math.min(current, modelCount - 1);
    });

    const platformCount = normalized.platforms?.length || 0;
    setSelectedPlatformIndex((current) => {
      if (current === null) return platformCount > 0 ? 0 : null;
      if (platformCount === 0) return null;
      return Math.min(current, platformCount - 1);
    });

    return normalized;
  };

  const loadMapping = async () => {
    setLoading(true);
    setStatusText("");
    try {
      const settings = await getSettings();
      const existing = settings.find((item) => item.key === MODEL_PROVIDER_MAPPING_SETTING_KEY);
      const nextText = existing?.value?.trim() || DEFAULT_MODEL_PROVIDER_MAPPING_TEMPLATE;
      const parsed = JSON.parse(nextText);
      syncDraftFromObject(parsed);
      setLastUpdatedAt(existing?.updatedAt || null);
    } catch (error) {
      console.error("加载统一模型管理配置失败:", error);
      setStatusText("加载失败，请稍后重试");
      showToast("加载统一模型管理配置失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMapping();
  }, []);

  const parseJsonDraft = () => {
    let parsed: ModelProviderMappingV2;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error("JSON 格式不正确，请先修正后再导入");
    }
    const payloadObject = buildPersistedModelMapping(parsed);
    validateManagedModelMapping(payloadObject);
    return payloadObject;
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusText("");
    try {
      const payloadObject = buildPersistedModelMapping(mappingDraft);
      validateManagedModelMapping(payloadObject);
      const saved = await upsertSetting({
        key: MODEL_PROVIDER_MAPPING_SETTING_KEY,
        value: stringifyPrettyJson(payloadObject),
        description: "统一模型管理(JSON 映射，V2)",
      });
      syncDraftFromObject(payloadObject);
      setLastUpdatedAt(saved.updatedAt);
      setStatusText("保存成功");
      notifyNodeConfigsUpdated();
      showToast("统一模型管理配置已保存");
    } catch (error: any) {
      setStatusText("保存失败，请稍后重试");
      showToast(error?.message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const applyMappingMutation = (mutator: (draft: ModelProviderMappingV2) => void) => {
    setMappingDraft((current) => {
      const next = cloneMapping(current);
      mutator(next);
      const normalized = buildPersistedModelMapping(next);
      setJsonText(stringifyPrettyJson(normalized));
      return normalized;
    });
    setStatusText("已修改，未保存");
  };

  const summary = {
    models: mappingDraft.models?.length || 0,
    vendors: (mappingDraft.models || []).reduce(
      (total, model) => total + (Array.isArray(model.vendors) ? model.vendors.length : 0),
      0
    ),
    platforms: mappingDraft.platforms?.length || 0,
  };

  const platformList = mappingDraft.platforms || [];
  const modelList = mappingDraft.models || [];
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const filteredModelEntries = modelList
    .map((model, index) => ({ model, index }))
    .filter(({ model }) => {
      const matchesType =
        modelTypeFilter === "all" ||
        normalizeManagedModelTaskType(model.taskType) === modelTypeFilter;
      if (!matchesType) return false;
      if (!normalizedModelSearch) return true;
      const haystacks = [model.modelName, model.modelKey, model.defaultVendor];
      return haystacks.some((value) => String(value || "").toLowerCase().includes(normalizedModelSearch));
    });
  const selectedModel = modelList[selectedModelIndex];
  const selectedModelServiceType = selectedModel ? getManagedModelServiceType(selectedModel) : "";
  const selectedModelSupportedModels = selectedModel ? getManagedModelSupportedModels(selectedModel) : [];
  const selectedModelOutputConfig = selectedModel ? getManagedModelOutputConfig(selectedModel) : undefined;
  const selectedNodeConfig = selectedModel ? getManagedNodeConfig(selectedModel) : undefined;
  const selectedTaskType = selectedModel
    ? normalizeManagedModelTaskType(selectedModel.taskType)
    : "image";
  const recommendedNodeCategory: "input" | "image" | "video" =
    selectedTaskType === "text" ? "input" : selectedTaskType;
  const selectedManagedMetadata = selectedModel ? buildManagedNodeMetadata(selectedModel) : undefined;
  const selectedVodConfig =
    selectedManagedMetadata?.vod && typeof selectedManagedMetadata.vod === "object"
      ? (selectedManagedMetadata.vod as Record<string, any>)
      : undefined;
  const selectedImagePricingConfig = selectedModel
    ? getManagedImagePricingConfig(selectedModel, selectedNodeConfig)
    : undefined;
  const selectedPlatform =
    selectedPlatformIndex !== null && selectedPlatformIndex >= 0
      ? platformList[selectedPlatformIndex]
      : undefined;

  const updateSelectedPlatform = (patch: Partial<ManagedVendorPlatformConfig>) => {
    if (selectedPlatformIndex === null) return;
    applyMappingMutation((draft) => {
      const target = draft.platforms?.[selectedPlatformIndex];
      if (!target) return;
      Object.assign(target, patch);
    });
  };

  const addPlatform = () => {
    applyMappingMutation((draft) => {
      draft.platforms = [...(draft.platforms || []), createEmptyPlatform()];
    });
    setSelectedPlatformIndex(platformList.length);
  };

  const removePlatform = (index: number) => {
    applyMappingMutation((draft) => {
      draft.platforms = (draft.platforms || []).filter((_, currentIndex) => currentIndex !== index);
    });
    setSelectedPlatformIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  const updateSelectedModel = (patch: Partial<ManagedModelConfig>) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const target = draft.models?.[selectedModelIndex];
      if (!target) return;
      Object.assign(target, patch);
    });
  };

  const updateSelectedModelMetadata = (patch: Record<string, any>) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const target = draft.models?.[selectedModelIndex];
      if (!target) return;
      target.metadata = {
        ...(target.metadata && typeof target.metadata === "object" ? target.metadata : {}),
        ...patch,
      };
    });
  };

  const updateSelectedModelOutputConfig = (patch: Record<string, any>) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const target = draft.models?.[selectedModelIndex];
      if (!target) return;
      const metadata = target.metadata && typeof target.metadata === "object" ? { ...target.metadata } : {};
      const currentOutputConfig =
        metadata.outputConfig && typeof metadata.outputConfig === "object" && !Array.isArray(metadata.outputConfig)
          ? { ...metadata.outputConfig }
          : {};
      metadata.outputConfig = {
        ...currentOutputConfig,
        ...patch,
      };
      target.metadata = metadata;
    });
  };

  const updateSelectedNodeConfig = (patch: Partial<ManagedModelNodeConfig>) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const target = draft.models?.[selectedModelIndex];
      if (!target) return;
      const nodeConfig = getManagedNodeConfig(target);
      target.metadata = {
        ...(target.metadata && typeof target.metadata === "object" ? target.metadata : {}),
        nodeConfig: {
          ...nodeConfig,
          ...patch,
        },
      };
    });
  };

  const addModel = () => {
    applyMappingMutation((draft) => {
      draft.models = [...(draft.models || []), createEmptyModel()];
    });
    setSelectedModelIndex(modelList.length);
  };

  const removeModel = (index: number) => {
    applyMappingMutation((draft) => {
      draft.models = (draft.models || []).filter((_, currentIndex) => currentIndex !== index);
    });
    setSelectedModelIndex((current) => {
      if (current <= 0) return 0;
      if (current >= index) return current - 1;
      return current;
    });
  };

  const updateVendor = (vendorIndex: number, patch: Partial<ManagedModelVendorConfig>) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const model = draft.models?.[selectedModelIndex];
      const target = model?.vendors?.[vendorIndex];
      if (!target) return;
      Object.assign(target, patch);
      if (patch.vendorKey && model?.defaultVendor === target.vendorKey) {
        model.defaultVendor = patch.vendorKey;
      }
    });
  };

  const applyPlatformToVendor = (vendorIndex: number, platformKey: string) => {
    if (!selectedModel) return;
    const platform = platformList.find((item) => item.platformKey === platformKey);
    updateVendor(vendorIndex, {
      platformKey,
      route: platform?.route || "legacy",
      provider: platform?.provider || undefined,
      label: platform?.platformName || undefined,
    });
  };

  const updateVendorSpecRules = (
    vendorIndex: number,
    nextRules: ManagedSpecPricingRule[]
  ) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const model = draft.models?.[selectedModelIndex];
      const target = model?.vendors?.[vendorIndex];
      if (!target || !model?.vendors) return;
      model.vendors[vendorIndex] = writeVendorSpecPricingRules(target, nextRules);
    });
  };

  const updateVendorPricingV2 = (
    vendorIndex: number,
    mutator: (current: ReturnType<typeof getVendorPricingV2>) => ReturnType<typeof getVendorPricingV2>
  ) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const model = draft.models?.[selectedModelIndex];
      const target = model?.vendors?.[vendorIndex];
      if (!target || !model?.vendors) return;
      const nextPricing = mutator(getVendorPricingV2(target));
      model.vendors[vendorIndex] = writeVendorPricingV2(target, nextPricing);
    });
  };

  const importVendorPricingV2Template = (
    vendorIndex: number,
    templateFactory: () => ReturnType<typeof getVendorPricingV2>,
    label: string
  ) => {
    const vendor = selectedModel?.vendors?.[vendorIndex];
    const stateKey = getManagedVendorStateKey(selectedModel, vendor, vendorIndex);
    const nextPricing = templateFactory();
    updateVendorPricingV2(vendorIndex, () => nextPricing);
    setPricingJsonDraftByVendor((current) => ({
      ...current,
      [stateKey]: JSON.stringify(nextPricing, null, 2),
    }));
    setPricingPreviewByVendor((current) => ({ ...current, [stateKey]: null }));
    setPricingPresetPreviewByVendor((current) => ({ ...current, [stateKey]: [] }));
    showToast(`${label} 已导入，可直接试算`, "success");
  };

  const resetVendorPricingJsonDraft = (
    vendorIndex: number,
    vendor: ManagedModelVendorConfig
  ) => {
    const stateKey = getManagedVendorStateKey(selectedModel, vendor, vendorIndex);
    const pricingV2 = getVendorPricingV2(vendor);
    setPricingJsonDraftByVendor((current) => ({
      ...current,
      [stateKey]: JSON.stringify(pricingV2, null, 2),
    }));
  };

  const applyVendorPricingJsonDraft = (
    vendorIndex: number,
    vendor: ManagedModelVendorConfig
  ) => {
    const stateKey = getManagedVendorStateKey(selectedModel, vendor, vendorIndex);
    const currentPricing = getVendorPricingV2(vendor);
    const raw = pricingJsonDraftByVendor[stateKey] ?? JSON.stringify(currentPricing, null, 2);
    try {
      const parsed = JSON.parse(raw);
      const nextPricing = getVendorPricingV2({
        ...vendor,
        pricing: parsed,
      } as ManagedModelVendorConfig);
      updateVendorPricingV2(vendorIndex, () => nextPricing);
      setPricingJsonDraftByVendor((current) => ({
        ...current,
        [stateKey]: JSON.stringify(nextPricing, null, 2),
      }));
      setPricingPreviewByVendor((current) => ({ ...current, [stateKey]: null }));
      setPricingPresetPreviewByVendor((current) => ({ ...current, [stateKey]: [] }));
      showToast("pricing.v2 JSON 已应用，可直接试算", "success");
    } catch (error: any) {
      showToast(error?.message || "pricing.v2 JSON 解析失败", "error");
    }
  };


  const previewVendorPricing = async (vendorIndex: number, vendor: ManagedModelVendorConfig) => {
    if (!selectedModel?.modelKey || !vendor.vendorKey) {
      showToast("请先填写 modelKey 和 vendorKey", "error");
      return;
    }
    const stateKey = getManagedVendorStateKey(selectedModel, vendor, vendorIndex);
    const pricingV2 = getVendorPricingV2(vendor);
    const contextBase =
      pricingV2.displayConfig.defaultSelections && Object.keys(pricingV2.displayConfig.defaultSelections).length > 0
        ? pricingV2.displayConfig.defaultSelections
        : Object.fromEntries(
            pricingV2.dimensions
              .map((dimension) => {
                if (Array.isArray(dimension.options) && dimension.options.length > 0) {
                  return [dimension.key, dimension.options[0]?.value];
                }
                if (dimension.type === "boolean") return [dimension.key, false];
                if (dimension.type === "number") return [dimension.key, 0];
                return [dimension.key, ""];
              })
              .filter(([key]) => String(key).trim().length > 0)
          );

    setPricingPreviewLoadingByVendor((current) => ({ ...current, [stateKey]: true }));
    try {
      const result = await previewManagedPricing({
        modelKey: selectedModel.modelKey,
        vendorKey: vendor.vendorKey,
        context: contextBase,
        pricing: vendor.pricing as Record<string, any> | undefined,
        metadata: vendor.metadata,
        creditsPerCall: vendor.creditsPerCall,
        priceYuan: vendor.priceYuan,
      });
      setPricingPreviewByVendor((current) => ({ ...current, [stateKey]: result }));
      showToast(`已试算 ${vendor.vendorKey}`, "success");
    } catch (error: any) {
      showToast(error?.message || "试算失败", "error");
    } finally {
      setPricingPreviewLoadingByVendor((current) => ({ ...current, [stateKey]: false }));
    }
  };

  const previewVendorPricingPresets = async (
    vendorIndex: number,
    vendor: ManagedModelVendorConfig
  ) => {
    if (!selectedModel?.modelKey || !vendor.vendorKey) {
      showToast("请先填写 modelKey 和 vendorKey", "error");
      return;
    }
    const stateKey = getManagedVendorStateKey(selectedModel, vendor, vendorIndex);
    const pricingV2 = getVendorPricingV2(vendor);
    const presets = Array.isArray(pricingV2.displayConfig.presets)
      ? pricingV2.displayConfig.presets
      : [];
    if (presets.length === 0) {
      showToast("请先添加 presets 再批量试算", "error");
      return;
    }

    setPricingPresetPreviewLoadingByVendor((current) => ({ ...current, [stateKey]: true }));
    try {
      const results = await Promise.all(
        presets.map((preset) =>
          previewManagedPricing({
            modelKey: selectedModel.modelKey,
            vendorKey: vendor.vendorKey,
            context: {
              ...(pricingV2.displayConfig.defaultSelections || {}),
              ...(preset || {}),
            },
            pricing: vendor.pricing as Record<string, any> | undefined,
            metadata: vendor.metadata,
            creditsPerCall: vendor.creditsPerCall,
            priceYuan: vendor.priceYuan,
          })
        )
      );
      setPricingPresetPreviewByVendor((current) => ({ ...current, [stateKey]: results }));
      showToast(`已批量试算 ${results.length} 个 preset`, "success");
    } catch (error: any) {
      showToast(error?.message || "批量试算失败", "error");
    } finally {
      setPricingPresetPreviewLoadingByVendor((current) => ({ ...current, [stateKey]: false }));
    }
  };

  const addVendor = () => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const model = draft.models?.[selectedModelIndex];
      if (!model) return;
      model.vendors = [...(model.vendors || []), createEmptyVendor()];
    });
  };

  const removeVendor = (vendorIndex: number) => {
    if (!selectedModel) return;
    applyMappingMutation((draft) => {
      const model = draft.models?.[selectedModelIndex];
      if (!model) return;
      const nextVendors = (model.vendors || []).filter((_, currentIndex) => currentIndex !== vendorIndex);
      model.vendors = nextVendors;
      if (model.defaultVendor === (selectedModel.vendors || [])[vendorIndex]?.vendorKey) {
        model.defaultVendor = nextVendors[0]?.vendorKey || "";
      }
    });
  };

  const handleImportJson = () => {
    try {
      const payloadObject = parseJsonDraft();
      syncDraftFromObject(payloadObject);
      setJsonModalOpen(false);
      setStatusText("已导入 JSON，未保存");
      showToast("JSON 已导入到表单", "success");
    } catch (error: any) {
      showToast(error?.message || "JSON 导入失败", "error");
    }
  };

  const vendorCards = selectedModel?.vendors || [];

  return (
    <div className='space-y-4'>
      {toast && (
        <div className='fixed right-6 top-6 z-[70]'>
          <div
            className={`min-w-[240px] rounded-lg border px-4 py-3 text-sm shadow-lg ${
              toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      <div className='bg-white rounded-lg border p-6 shadow-sm space-y-3'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <h3 className='text-lg font-semibold mb-2'>统一模型管理</h3>
            <p className='text-sm text-gray-500'>
              主界面使用列表 + 表单维护模型、平台、厂商和规格价；JSON 仅作为导入/整体替换使用。
            </p>
            <div className='mt-2 text-xs text-gray-500'>
              配置 Key: {MODEL_PROVIDER_MAPPING_SETTING_KEY}
              {lastUpdatedAt
                ? ` · 最后更新：${new Date(lastUpdatedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })}`
                : ""}
            </div>
          </div>
          <div className='flex flex-wrap gap-3'>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? "保存中..." : "保存设置"}
            </Button>
            <Button variant='outline' onClick={loadMapping} disabled={saving || loading}>
              {loading ? "加载中..." : "重新加载"}
            </Button>
            <Button variant='outline' onClick={() => setJsonModalOpen(true)} disabled={saving || loading}>
              JSON 导入/替换
            </Button>
          </div>
        </div>
        <div className='grid gap-3 md:grid-cols-3'>
          <div className='rounded-lg border bg-gray-50 px-4 py-3'>
            <div className='text-xs text-gray-500'>模型数</div>
            <div className='text-xl font-semibold'>{summary.models}</div>
          </div>
          <div className='rounded-lg border bg-gray-50 px-4 py-3'>
            <div className='text-xs text-gray-500'>厂商路线数</div>
            <div className='text-xl font-semibold'>{summary.vendors}</div>
          </div>
          <div className='rounded-lg border bg-gray-50 px-4 py-3'>
            <div className='text-xs text-gray-500'>平台数</div>
            <div className='text-xl font-semibold'>{summary.platforms}</div>
          </div>
        </div>
        {statusText && <div className='text-sm text-gray-500'>{statusText}</div>}
      </div>

      <div className='grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]'>
        <div className='space-y-4'>
          <div className='bg-white rounded-lg border p-4 shadow-sm'>
            <div className='mb-3 flex items-center justify-between'>
              <h4 className='font-semibold'>模型列表</h4>
              <Button size='sm' onClick={addModel}>新增模型</Button>
            </div>
            <div className='mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px]'>
              <Input
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder='搜索模型名 / modelKey / 默认厂商'
              />
              <select
                value={modelTypeFilter}
                onChange={(e) => setModelTypeFilter(e.target.value as "all" | ManagedModelTaskType)}
                className='w-full rounded border px-3 py-2 text-sm'
              >
                <option value='all'>全部类型</option>
                <option value='image'>图片</option>
                <option value='video'>视频</option>
                <option value='text'>文本</option>
              </select>
            </div>
            <div className='space-y-2'>
              {modelList.length === 0 ? (
                <div className='rounded-lg border border-dashed px-3 py-6 text-center text-sm text-gray-500'>
                  暂无模型，点击“新增模型”开始配置。
                </div>
              ) : filteredModelEntries.length === 0 ? (
                <div className='rounded-lg border border-dashed px-3 py-6 text-center text-sm text-gray-500'>
                  没有匹配的模型，试试清空搜索或切换类型筛选。
                </div>
              ) : (
                filteredModelEntries.map(({ model, index }) => {
                  const vendors = Array.isArray(model.vendors) ? model.vendors.length : 0;
                  const isActive = index === selectedModelIndex;
                  return (
                    <button
                      key={`${model.modelKey || 'model'}-${index}`}
                      type='button'
                      onClick={() => setSelectedModelIndex(index)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                        isActive ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'
                      }`}
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div>
                          <div className='font-medium'>{model.modelName || '未命名模型'}</div>
                          <div className='text-xs text-gray-500'>{model.modelKey || '未设置 modelKey'}</div>
                          <div className='mt-1 text-xs text-gray-400'>
                            {normalizeManagedModelTaskType(model.taskType)} · {vendors} 条厂商路线
                          </div>
                        </div>
                        <span className={`rounded px-2 py-1 text-xs ${model.enabled !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {model.enabled !== false ? '启用' : '停用'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className='flex justify-end'>
            <button
              type='button'
              className='text-xs text-gray-500 underline-offset-2 hover:underline'
              onClick={() => setShowPlatformPanel((prev) => !prev)}
            >
              {showPlatformPanel ? "收起平台管理" : "展开平台管理"}
            </button>
          </div>

          {showPlatformPanel && (
            <div className='bg-white rounded-lg border p-4 shadow-sm'>
              <div className='mb-3 flex items-center justify-between'>
                <h4 className='font-semibold'>平台列表</h4>
                <Button size='sm' variant='outline' onClick={addPlatform}>新增平台</Button>
              </div>
              <div className='space-y-2'>
                {platformList.length === 0 ? (
                  <div className='rounded-lg border border-dashed px-3 py-6 text-center text-sm text-gray-500'>暂无平台配置</div>
                ) : (
                  platformList.map((platform, index) => {
                    const isActive = selectedPlatformIndex === index;
                    return (
                      <button
                        key={`${platform.platformKey || 'platform'}-${index}`}
                        type='button'
                        onClick={() => setSelectedPlatformIndex(index)}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                          isActive ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300'
                        }`}
                      >
                        <div className='font-medium'>{platform.platformName || '未命名平台'}</div>
                        <div className='text-xs text-gray-500'>{platform.platformKey || '未设置 platformKey'}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className='space-y-4'>
          <div className='bg-white rounded-lg border p-6 shadow-sm'>
            <div className='mb-4 flex items-start justify-between gap-4'>
              <div>
                <h4 className='font-semibold'>模型表单</h4>
                <p className='text-sm text-gray-500'>
                  这里维护模型基础信息、节点模板和厂商路线。价格配置以数据库已落地的 `pricing.v2 JSON` 为准。
                </p>
              </div>
              {selectedModel && (
                <Button
                  size='sm'
                  variant='outline'
                  className='text-red-600 hover:text-red-700 hover:border-red-300'
                  onClick={() => removeModel(selectedModelIndex)}
                >
                  删除模型
                </Button>
              )}
            </div>

            {!selectedModel ? (
              <div className='rounded-lg border border-dashed px-4 py-10 text-center text-sm text-gray-500'>
                请选择左侧模型，或新增一个模型。
              </div>
            ) : (
              <div className='space-y-6'>
                <div className='rounded-lg border bg-blue-50 px-4 py-3 text-sm text-blue-800'>
                  Workflow: Basic info / Capability / Node mapping / Vendor pricing
                </div>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div>
                    <label className='block text-sm text-gray-600 mb-1'>模型 Key</label>
                    <Input
                      value={selectedModel.modelKey || ''}
                      onChange={(e) => updateSelectedModel({ modelKey: e.target.value })}
                      placeholder='如：kling-3.0'
                    />
                  </div>
                  <div>
                    <label className='block text-sm text-gray-600 mb-1'>模型名称</label>
                    <Input
                      value={selectedModel.modelName || ''}
                      onChange={(e) => updateSelectedModel({ modelName: e.target.value })}
                      placeholder='如：Kling 3.0'
                    />
                  </div>
                </div>

                <div className='grid gap-4 md:grid-cols-3'>
                  <div>
                    <label className='block text-sm text-gray-600 mb-1'>任务类型</label>
                    <select
                      value={normalizeManagedModelTaskType(selectedModel.taskType)}
                      onChange={(e) => updateSelectedModel({ taskType: e.target.value })}
                      className='w-full rounded border px-3 py-2'
                    >
                      {MANAGED_MODEL_TASK_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className='block text-sm text-gray-600 mb-1'>默认厂商</label>
                    <select
                      value={selectedModel.defaultVendor || ''}
                      onChange={(e) => updateSelectedModel({ defaultVendor: e.target.value })}
                      className='w-full rounded border px-3 py-2'
                    >
                      <option value=''>请选择默认厂商</option>
                      {vendorCards.map((vendor) => (
                        <option key={vendor.vendorKey || Math.random()} value={vendor.vendorKey || ''}>
                          {vendor.label || vendor.vendorKey || '未命名厂商'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className='flex items-end'>
                    <label className='inline-flex items-center gap-2 text-sm text-gray-600'>
                      <input
                        type='checkbox'
                        checked={selectedModel.enabled !== false}
                        onChange={(e) => updateSelectedModel({ enabled: e.target.checked })}
                      />
                      模型启用
                    </label>
                  </div>
                </div>

                <div className='rounded-lg border p-4'>
                  <div className='mb-3 flex items-center justify-between'>
                    <div className='font-medium text-gray-800'>能力配置</div>
                    <button
                      type='button'
                      className='text-xs text-gray-500 underline-offset-2 hover:underline'
                      onClick={() => setShowAdvancedModelConfig((prev) => !prev)}
                    >
                      {showAdvancedModelConfig ? "收起高级配置" : "展开高级配置"}
                    </button>
                  </div>
                  {showAdvancedModelConfig ? (
                    <div className='grid gap-4 md:grid-cols-2'>
                      <div>
                        <label className='block text-sm text-gray-600 mb-1'>serviceType</label>
                        <Input
                          value={selectedModelServiceType}
                          onChange={(e) => updateSelectedModelMetadata({ serviceType: e.target.value.trim() })}
                          placeholder='如：gemini-3-pro-image / wan26-video'
                        />
                      </div>
                      <div>
                        <label className='block text-sm text-gray-600 mb-1'>supportedModels</label>
                        <Input
                          value={selectedModelSupportedModels.join(', ')}
                          onChange={(e) => updateSelectedModelMetadata({ supportedModels: parseCommaSeparatedList(e.target.value) })}
                          placeholder='逗号分隔，如：wan2.6-t2v, wan2.6-i2v'
                        />
                      </div>
                    </div>
                  ) : (
                    <div className='rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-600'>
                      Service: <span className='font-medium'>{selectedModelServiceType || "-"}</span>
                      {" | "}
                      Models: <span className='font-medium'>{selectedModelSupportedModels.join(", ") || "-"}</span>
                    </div>
                  )}

                  {normalizeManagedModelTaskType(selectedModel.taskType) === 'video' && (
                    <div className='mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
                      <div>
                        <label className='block text-sm text-gray-600 mb-1'>比例</label>
                        <Input
                          value={Array.isArray(selectedModelOutputConfig?.aspectRatios) ? selectedModelOutputConfig.aspectRatios.join(', ') : ''}
                          onChange={(e) => updateSelectedModelOutputConfig({ aspectRatios: parseCommaSeparatedList(e.target.value) })}
                          placeholder='16:9, 9:16, 1:1'
                        />
                      </div>
                      <div>
                        <label className='block text-sm text-gray-600 mb-1'>时长</label>
                        <Input
                          value={Array.isArray(selectedModelOutputConfig?.durations) ? selectedModelOutputConfig.durations.join(', ') : ''}
                          onChange={(e) => updateSelectedModelOutputConfig({ durations: parseCommaSeparatedNumbers(e.target.value) })}
                          placeholder='5, 10, 15'
                        />
                      </div>
                      <div>
                        <label className='block text-sm text-gray-600 mb-1'>分辨率</label>
                        <Input
                          value={Array.isArray(selectedModelOutputConfig?.resolutions) ? selectedModelOutputConfig.resolutions.join(', ') : ''}
                          onChange={(e) => updateSelectedModelOutputConfig({ resolutions: parseCommaSeparatedList(e.target.value) })}
                          placeholder='720P, 1080P'
                        />
                      </div>
                      <div className='flex items-end'>
                        <label className='inline-flex items-center gap-2 text-sm text-gray-600'>
                          <input
                            type='checkbox'
                            checked={selectedModelOutputConfig?.audioGeneration === true}
                            onChange={(e) => updateSelectedModelOutputConfig({ audioGeneration: e.target.checked })}
                          />
                          支持音频生成
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div className='rounded-lg border bg-gray-50 p-4'>
                  <div className='mb-3 font-medium text-gray-800'>节点映射</div>
                  <div className='mb-3 text-xs text-gray-500'>
                    推荐分类：<span className='font-medium'>{recommendedNodeCategory}</span>
                  </div>
                  <div className='grid gap-4 md:grid-cols-2'>
                    <div>
                      <label className='block text-sm text-gray-600 mb-1'>节点标识</label>
                      <Input
                        value={selectedNodeConfig?.nodeKey || ''}
                        onChange={(e) => updateSelectedNodeConfig({ nodeKey: e.target.value })}
                        placeholder='如：kling30Video'
                      />
                    </div>
                    <div>
                      <label className='block text-sm text-gray-600 mb-1'>Flow 节点模板</label>
                      <select
                        value={selectedNodeConfig?.flowNodeType || ''}
                        onChange={(e) => updateSelectedNodeConfig({ flowNodeType: e.target.value })}
                        className='w-full rounded border px-3 py-2'
                      >
                        {MANAGED_NODE_TEMPLATE_OPTIONS[normalizeManagedModelTaskType(selectedModel.taskType)].map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    {showAdvancedModelConfig && (
                      <div>
                        <label className='block text-sm text-gray-600 mb-1'>分类</label>
                        <select
                          value={selectedNodeConfig?.category || recommendedNodeCategory}
                          onChange={(e) => updateSelectedNodeConfig({ category: e.target.value as 'input' | 'image' | 'video' })}
                          className='w-full rounded border px-3 py-2'
                        >
                          <option value='input'>输入</option>
                          <option value='image'>图片</option>
                          <option value='video'>视频</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label className='block text-sm text-gray-600 mb-1'>节点默认积分</label>
                      <Input
                        type='number'
                        value={selectedNodeConfig?.creditsPerCall ?? 0}
                        onChange={(e) => updateSelectedNodeConfig({ creditsPerCall: Number(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>

                <div className='rounded-lg border p-4'>
                  <div className='mb-3 flex items-center justify-between'>
                    <div>
                      <div className='font-medium text-gray-800'>厂商路线与定价</div>
                      <div className='text-sm text-gray-500'>默认价格在上方维护，规格差异在下方规则矩阵覆盖。</div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <button
                        type='button'
                        className='text-xs text-gray-500 underline-offset-2 hover:underline'
                        onClick={() => setShowAdvancedVendorConfig((prev) => !prev)}
                      >
                        {showAdvancedVendorConfig ? "收起厂商高级字段" : "展开厂商高级字段"}
                      </button>
                      <Button size='sm' variant='outline' onClick={addVendor}>新增厂商</Button>
                    </div>
                  </div>

                  <div className='space-y-4'>
                    {vendorCards.length === 0 ? (
                      <div className='rounded-lg border border-dashed px-4 py-8 text-center text-sm text-gray-500'>暂无厂商路线</div>
                    ) : (
                      vendorCards.map((vendor, vendorIndex) => {
                        const vendorStateKey = getManagedVendorStateKey(selectedModel, vendor, vendorIndex);
                        const specRules = readVendorSpecPricingRules(vendor);
                        const vendorPricingDefaults = getVendorPricingDefaults(vendor);
                        const pricingV2 = getVendorPricingV2(vendor);
                        const pricingV2Issues = validatePricingV2(pricingV2);
                        const dimensionOptions = pricingV2.dimensions.map((dimension) => ({
                          value: dimension.key,
                          label: dimension.label || dimension.key,
                          type: dimension.type || "string",
                        }));
                        const evaluatorEntries = Object.entries(pricingV2.evaluators || {});
                        const previewResult = pricingPreviewByVendor[vendorStateKey];
                        const previewLoading = pricingPreviewLoadingByVendor[vendorStateKey] === true;
                        const presetPreviewResults = pricingPresetPreviewByVendor[vendorStateKey] || [];
                        const presetPreviewLoading =
                          pricingPresetPreviewLoadingByVendor[vendorStateKey] === true;
                        const hasPricingV2Errors = pricingV2Issues.some((issue) => issue.level === "error");
                        const pricingJsonDraft =
                          pricingJsonDraftByVendor[vendorStateKey] ??
                          JSON.stringify(pricingV2, null, 2);
                        return (
                          <div key={`${vendor.vendorKey || 'vendor'}-${vendorIndex}`} className='rounded-lg border bg-gray-50 p-4'>
                            <div className='mb-3 flex items-center justify-between'>
                              <div className='font-medium text-gray-800'>
                                厂商 {vendorIndex + 1} {vendor.label ? `· ${vendor.label}` : ''}
                              </div>
                              <Button
                                size='sm'
                                variant='outline'
                                className='text-red-600 hover:text-red-700 hover:border-red-300'
                                onClick={() => removeVendor(vendorIndex)}
                              >
                                删除厂商
                              </Button>
                            </div>

                            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                              <div>
                                <label className='block text-sm text-gray-600 mb-1'>vendorKey</label>
                                <Input
                                  value={vendor.vendorKey || ''}
                                  onChange={(e) => updateVendor(vendorIndex, { vendorKey: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className='block text-sm text-gray-600 mb-1'>展示名称</label>
                                <Input
                                  value={vendor.label || ''}
                                  onChange={(e) => updateVendor(vendorIndex, { label: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className='block text-sm text-gray-600 mb-1'>绑定平台</label>
                                <select
                                  value={vendor.platformKey || ''}
                                  onChange={(e) => applyPlatformToVendor(vendorIndex, e.target.value)}
                                  className='w-full rounded border px-3 py-2'
                                >
                                  <option value=''>不绑定平台</option>
                                  {platformList.map((platform) => (
                                    <option key={platform.platformKey || Math.random()} value={platform.platformKey || ''}>
                                      {platform.platformName || platform.platformKey || '未命名平台'}
                                    </option>
                                  ))}
                                </select>
                                {showAdvancedVendorConfig && (
                                  <Input
                                    className='mt-2'
                                    value={vendor.platformKey || ''}
                                    onChange={(e) => updateVendor(vendorIndex, { platformKey: e.target.value })}
                                    placeholder='也可手动填写 platformKey'
                                  />
                                )}
                              </div>
                              {showAdvancedVendorConfig && (
                                <>
                                  <div>
                                    <label className='block text-sm text-gray-600 mb-1'>provider</label>
                                    <Input
                                      value={vendor.provider || ''}
                                      onChange={(e) => updateVendor(vendorIndex, { provider: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label className='block text-sm text-gray-600 mb-1'>modelName</label>
                                    <Input
                                      value={vendor.modelName || ''}
                                      onChange={(e) => updateVendor(vendorIndex, { modelName: e.target.value })}
                                    />
                                  </div>
                                  <div>
                                    <label className='block text-sm text-gray-600 mb-1'>modelVersion</label>
                                    <Input
                                      value={vendor.modelVersion || ''}
                                      onChange={(e) => updateVendor(vendorIndex, { modelVersion: e.target.value })}
                                    />
                                  </div>
                                </>
                              )}
                              <div>
                                <label className='block text-sm text-gray-600 mb-1'>默认积分</label>
                                <Input
                                  type='number'
                                  value={vendorPricingDefaults.credits ?? 0}
                                  onChange={(e) =>
                                    updateVendor(
                                      vendorIndex,
                                      updateVendorPricingDefaults(vendor, {
                                        credits: Number(e.target.value) || 0,
                                      })
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className='block text-sm text-gray-600 mb-1'>默认价格(元)</label>
                                <Input
                                  type='number'
                                  step='0.01'
                                  value={vendorPricingDefaults.priceYuan ?? ''}
                                  onChange={(e) =>
                                    updateVendor(
                                      vendorIndex,
                                      updateVendorPricingDefaults(vendor, {
                                        priceYuan:
                                          e.target.value.trim() === ''
                                            ? undefined
                                            : Number(e.target.value),
                                      })
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <label className='block text-sm text-gray-600 mb-1'>线路类型</label>
                                <select
                                  value={vendor.route || 'legacy'}
                                  onChange={(e) => updateVendor(vendorIndex, { route: e.target.value as ModelVendorRouteType })}
                                  className='w-full rounded border px-3 py-2'
                                >
                                  <option value='legacy'>legacy</option>
                                  <option value='tencent_vod'>tencent_vod</option>
                                </select>
                              </div>
                              {showAdvancedVendorConfig && (
                                <div>
                                  <label className='block text-sm text-gray-600 mb-1'>Route type</label>
                                  <select
                                    value={vendor.route || 'legacy'}
                                    onChange={(e) => updateVendor(vendorIndex, { route: e.target.value as ModelVendorRouteType })}
                                    className='w-full rounded border px-3 py-2'
                                  >
                                    <option value='legacy'>legacy</option>
                                    <option value='tencent_vod'>tencent_vod</option>
                                  </select>
                                </div>
                              )}
                              <div className='flex items-end gap-4'>
                                <label className='inline-flex items-center gap-2 text-sm text-gray-600'>
                                  <input
                                    type='checkbox'
                                    checked={vendor.enabled !== false}
                                    onChange={(e) => updateVendor(vendorIndex, { enabled: e.target.checked })}
                                  />
                                  厂商启用
                                </label>
                                <label className='inline-flex items-center gap-2 text-sm text-gray-600'>
                                  <input
                                    type='radio'
                                    name='defaultVendor'
                                    checked={(selectedModel.defaultVendor || '') === (vendor.vendorKey || '') && !!vendor.vendorKey}
                                    onChange={() => updateSelectedModel({ defaultVendor: vendor.vendorKey || '' })}
                                  />
                                  设为默认
                                </label>
                              </div>
                            </div>

                            <div className='mt-4 rounded-lg border bg-white p-4'>
                              <div className='mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4'>
                                <div className='mb-3 flex items-center justify-between gap-3'>
                                  <div>
                                    <div className='font-medium text-blue-900'>定价配置 v2</div>
                                    <div className='text-xs text-blue-700'>
                                      直接维护厂商下的 `pricing.v2 JSON`，并通过试算验证最终价格与积分。
                                    </div>
                                  </div>
                                  <div className='flex items-center gap-2'>
                                    <span className='rounded bg-white px-2 py-1 text-xs text-gray-600'>
                                      version: {pricingV2.version}
                                    </span>
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      onClick={() => previewVendorPricingPresets(vendorIndex, vendor)}
                                      disabled={
                                        presetPreviewLoading ||
                                        hasPricingV2Errors ||
                                        (pricingV2.displayConfig.presets || []).length === 0
                                      }
                                    >
                                      {presetPreviewLoading ? "批量试算中..." : "批量试算"}
                                    </Button>
                                    <Button
                                      size='sm'
                                      variant='outline'
                                      onClick={() => previewVendorPricing(vendorIndex, vendor)}
                                      disabled={previewLoading || hasPricingV2Errors}
                                    >
                                      {previewLoading ? "试算中..." : "试算 v2"}
                                    </Button>
                                  </div>
                                </div>

                                <div className='mb-4 space-y-4'>
                                  <div className='rounded-lg border border-emerald-200 bg-emerald-50 p-3'>
                                    <div className='mb-2 flex items-center justify-between gap-3'>
                                      <div>
                                        <div className='text-sm font-medium text-emerald-900'>AI / JSON 应用</div>
                                        <div className='text-xs text-emerald-700'>
                                          使用你们本地 AI 对话生成标准 `pricing.v2 JSON`，然后粘贴到这里直接应用。
                                        </div>
                                      </div>
                                      <div className='flex items-center gap-2'>
                                        <Button
                                          size='sm'
                                          variant='outline'
                                          onClick={() => resetVendorPricingJsonDraft(vendorIndex, vendor)}
                                        >
                                          重置为当前配置
                                        </Button>
                                        <Button
                                          size='sm'
                                          onClick={() => applyVendorPricingJsonDraft(vendorIndex, vendor)}
                                        >
                                          应用 JSON
                                        </Button>
                                      </div>
                                    </div>
                                    <textarea
                                      value={pricingJsonDraft}
                                      onChange={(e) =>
                                        setPricingJsonDraftByVendor((current) => ({
                                          ...current,
                                          [vendorStateKey]: e.target.value,
                                        }))
                                      }
                                      rows={18}
                                      className='w-full rounded border border-emerald-200 bg-white px-3 py-2 font-mono text-xs leading-5'
                                      spellCheck={false}
                                      placeholder='将 AI 生成的 pricing.v2 JSON 粘贴到这里'
                                    />
                                  </div>
                                </div>

                                <div className='space-y-4'>
                                  {pricingV2Issues.length > 0 && (
                                    <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'>
                                      <div className='mb-2 flex items-center justify-between'>
                                        <div className='font-medium text-amber-900'>校验提示</div>
                                        <div className='text-xs text-amber-700'>
                                          {pricingV2Issues.filter((item) => item.level === "error").length} 个错误，
                                          {pricingV2Issues.filter((item) => item.level === "warning").length} 个警告
                                        </div>
                                      </div>
                                      <div className='space-y-1 text-xs'>
                                        {pricingV2Issues.map((issue, issueIndex) => (
                                          <div
                                            key={`pricing-issue-${issueIndex}`}
                                            className={issue.level === "error" ? "text-red-700" : "text-amber-800"}
                                          >
                                            {issue.level === "error" ? "错误" : "警告"}: {issue.message}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className='hidden rounded-lg border bg-white p-3'>
                                    <div className='mb-3 flex items-center justify-between'>
                                      <div className='font-medium text-gray-800'>1. 维度定义</div>
                                      <Button
                                        size='sm'
                                        variant='outline'
                                        onClick={() =>
                                          updateVendorPricingV2(vendorIndex, (current) => ({
                                            ...current,
                                            dimensions: [...current.dimensions, createEmptyPricingDimension()],
                                          }))
                                        }
                                      >
                                        新增维度
                                      </Button>
                                    </div>
                                    <div className='space-y-3'>
                                      {pricingV2.dimensions.length === 0 ? (
                                        <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                                          暂无 v2 维度。先定义报价上下文维度，例如 `generationMode / durationSec / hasAudio`。
                                        </div>
                                      ) : (
                                        pricingV2.dimensions.map((dimension, dimensionIndex) => (
                                          <div key={`${dimension.key || "dimension"}-${dimensionIndex}`} className='rounded border p-3'>
                                            <div className='grid gap-3 md:grid-cols-4'>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>key</label>
                                                <Input
                                                  value={dimension.key || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.dimensions];
                                                      next[dimensionIndex] = { ...next[dimensionIndex], key: e.target.value };
                                                      return { ...current, dimensions: next };
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>label</label>
                                                <Input
                                                  value={dimension.label || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.dimensions];
                                                      next[dimensionIndex] = { ...next[dimensionIndex], label: e.target.value };
                                                      return { ...current, dimensions: next };
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>type</label>
                                                <select
                                                  value={dimension.type || "string"}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.dimensions];
                                                      next[dimensionIndex] = { ...next[dimensionIndex], type: e.target.value as ManagedPricingDimensionDefinition["type"] };
                                                      return { ...current, dimensions: next };
                                                    })
                                                  }
                                                  className='w-full rounded border px-3 py-2'
                                                >
                                                  <option value='string'>string</option>
                                                  <option value='number'>number</option>
                                                  <option value='boolean'>boolean</option>
                                                  <option value='enum'>enum</option>
                                                </select>
                                              </div>
                                              <div className='flex items-end justify-between gap-2'>
                                                <label className='inline-flex items-center gap-2 text-xs text-gray-600'>
                                                  <input
                                                    type='checkbox'
                                                    checked={dimension.required === true}
                                                    onChange={(e) =>
                                                      updateVendorPricingV2(vendorIndex, (current) => {
                                                        const next = [...current.dimensions];
                                                        next[dimensionIndex] = { ...next[dimensionIndex], required: e.target.checked };
                                                        return { ...current, dimensions: next };
                                                      })
                                                    }
                                                  />
                                                  required
                                                </label>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  className='text-red-600 hover:text-red-700'
                                                  onClick={() =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      dimensions: current.dimensions.filter((_, index) => index !== dimensionIndex),
                                                    }))
                                                  }
                                                >
                                                  删除
                                                </Button>
                                              </div>
                                            </div>
                                            {(dimension.type === "enum" || dimension.type === "boolean") && (
                                              <div className='mt-3'>
                                                <label className='block text-xs text-gray-600 mb-1'>options</label>
                                                <Input
                                                  value={(dimension.options || [])
                                                    .map((option) => `${option.value}:${option.label || option.value}`)
                                                    .join(", ")}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.dimensions];
                                                      next[dimensionIndex] = {
                                                        ...next[dimensionIndex],
                                                        options: e.target.value
                                                          .split(",")
                                                          .map((item) => item.trim())
                                                          .filter(Boolean)
                                                          .map((item) => {
                                                            const [rawValue, rawLabel] = item.split(":");
                                                            const normalizedValue =
                                                              dimension.type === "boolean"
                                                                ? rawValue.trim() === "true"
                                                                : rawValue.trim();
                                                            return {
                                                              value: normalizedValue,
                                                              label: (rawLabel || rawValue).trim(),
                                                            };
                                                          }),
                                                      };
                                                      return { ...current, dimensions: next };
                                                    })
                                                  }
                                                  placeholder='例如：t2v:文生视频, i2v:图生视频'
                                                />
                                              </div>
                                            )}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>

                                  <div className='hidden rounded-lg border bg-white p-3'>
                                    <div className='mb-3 flex items-center justify-between'>
                                      <div className='font-medium text-gray-800'>2. 匹配规则</div>
                                      <Button
                                        size='sm'
                                        variant='outline'
                                        onClick={() =>
                                          updateVendorPricingV2(vendorIndex, (current) => ({
                                            ...current,
                                            matchingRules: [...current.matchingRules, createEmptyMatchingRule()],
                                          }))
                                        }
                                      >
                                        新增规则
                                      </Button>
                                    </div>
                                    <div className='space-y-3'>
                                      {pricingV2.matchingRules.length === 0 ? (
                                        <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                                          暂无 v2 匹配规则。命中规则后会通过 evaluatorKey 跳转到价格求值器。
                                        </div>
                                      ) : (
                                        pricingV2.matchingRules.map((rule, ruleIndex) => (
                                          <div key={`${rule.ruleKey || "rule"}-${ruleIndex}`} className='rounded border p-3 space-y-3'>
                                            <div className='grid gap-3 md:grid-cols-5'>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>ruleKey</label>
                                                <Input
                                                  value={rule.ruleKey || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.matchingRules];
                                                      next[ruleIndex] = { ...next[ruleIndex], ruleKey: e.target.value };
                                                      return { ...current, matchingRules: next };
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>label</label>
                                                <Input
                                                  value={rule.label || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.matchingRules];
                                                      next[ruleIndex] = { ...next[ruleIndex], label: e.target.value };
                                                      return { ...current, matchingRules: next };
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>priority</label>
                                                <Input
                                                  type='number'
                                                  value={rule.priority ?? 100}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.matchingRules];
                                                      next[ruleIndex] = { ...next[ruleIndex], priority: Number(e.target.value) || 0 };
                                                      return { ...current, matchingRules: next };
                                                    })
                                                  }
                                                />
                                              </div>
                                              <div>
                                                <label className='block text-xs text-gray-600 mb-1'>evaluatorKey</label>
                                                <select
                                                  value={rule.evaluatorKey || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.matchingRules];
                                                      next[ruleIndex] = { ...next[ruleIndex], evaluatorKey: e.target.value };
                                                      return { ...current, matchingRules: next };
                                                    })
                                                  }
                                                  className='w-full rounded border px-3 py-2'
                                                >
                                                  <option value=''>请选择 evaluator</option>
                                                  {evaluatorEntries.map(([key, evaluator]) => (
                                                    <option key={key} value={key}>{key} ({evaluator.type})</option>
                                                  ))}
                                                </select>
                                              </div>
                                              <div className='flex items-end justify-between gap-2'>
                                                <label className='inline-flex items-center gap-2 text-xs text-gray-600'>
                                                  <input
                                                    type='checkbox'
                                                    checked={rule.enabled !== false}
                                                    onChange={(e) =>
                                                      updateVendorPricingV2(vendorIndex, (current) => {
                                                        const next = [...current.matchingRules];
                                                        next[ruleIndex] = { ...next[ruleIndex], enabled: e.target.checked };
                                                        return { ...current, matchingRules: next };
                                                      })
                                                    }
                                                  />
                                                  enabled
                                                </label>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  className='text-red-600 hover:text-red-700'
                                                  onClick={() =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      matchingRules: current.matchingRules.filter((_, index) => index !== ruleIndex),
                                                    }))
                                                  }
                                                >
                                                  删除
                                                </Button>
                                              </div>
                                            </div>

                                            <div className='space-y-2'>
                                              <div className='flex items-center justify-between'>
                                                <div className='text-xs font-medium text-gray-600'>ALL 条件</div>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  onClick={() =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.matchingRules];
                                                      const target = next[ruleIndex];
                                                      next[ruleIndex] = {
                                                        ...target,
                                                        conditions: {
                                                          all: [...(target.conditions?.all || []), createEmptyConditionRow()],
                                                          any: target.conditions?.any || [],
                                                        },
                                                      };
                                                      return { ...current, matchingRules: next };
                                                    })
                                                  }
                                                >
                                                  新增条件
                                                </Button>
                                              </div>
                                              {(rule.conditions?.all || []).map((condition, conditionIndex) => {
                                                const dimension = pricingV2.dimensions.find((item) => item.key === condition.field);
                                                return (
                                                  <div key={`${condition.field || "condition"}-${conditionIndex}`} className='grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_72px]'>
                                                    <select
                                                      value={condition.field || ""}
                                                      onChange={(e) =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          const rows = [...(target.conditions?.all || [])];
                                                          rows[conditionIndex] = { ...rows[conditionIndex], field: e.target.value };
                                                          next[ruleIndex] = { ...target, conditions: { all: rows, any: target.conditions?.any || [] } };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                      className='w-full rounded border px-3 py-2'
                                                    >
                                                      <option value=''>选择字段</option>
                                                      {dimensionOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                      ))}
                                                    </select>
                                                    <select
                                                      value={condition.op || "eq"}
                                                      onChange={(e) =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          const rows = [...(target.conditions?.all || [])];
                                                          rows[conditionIndex] = { ...rows[conditionIndex], op: e.target.value as ManagedPricingConditionRow["op"] };
                                                          next[ruleIndex] = { ...target, conditions: { all: rows, any: target.conditions?.any || [] } };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                      className='w-full rounded border px-3 py-2'
                                                    >
                                                      <option value='eq'>eq</option>
                                                      <option value='in'>in</option>
                                                      <option value='gt'>gt</option>
                                                      <option value='gte'>gte</option>
                                                      <option value='lt'>lt</option>
                                                      <option value='lte'>lte</option>
                                                    </select>
                                                    <Input
                                                      value={stringifyConditionValue(condition.value)}
                                                      onChange={(e) =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          const rows = [...(target.conditions?.all || [])];
                                                          rows[conditionIndex] = {
                                                            ...rows[conditionIndex],
                                                            value: parseConditionValue(e.target.value, dimension?.type, rows[conditionIndex]?.op),
                                                          };
                                                          next[ruleIndex] = { ...target, conditions: { all: rows, any: target.conditions?.any || [] } };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                      placeholder={condition.op === "in" ? "逗号分隔多个值" : "值"}
                                                    />
                                                    <Button
                                                      size='sm'
                                                      variant='outline'
                                                      className='text-red-600 hover:text-red-700'
                                                      onClick={() =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          next[ruleIndex] = {
                                                            ...target,
                                                            conditions: {
                                                              all: (target.conditions?.all || []).filter((_, index) => index !== conditionIndex),
                                                              any: target.conditions?.any || [],
                                                            },
                                                          };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                    >
                                                      删除
                                                    </Button>
                                                  </div>
                                                );
                                              })}
                                            </div>

                                            <div className='space-y-2'>
                                              <div className='flex items-center justify-between'>
                                                <div className='text-xs font-medium text-gray-600'>ANY 条件</div>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  onClick={() =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const next = [...current.matchingRules];
                                                      const target = next[ruleIndex];
                                                      next[ruleIndex] = {
                                                        ...target,
                                                        conditions: {
                                                          all: target.conditions?.all || [],
                                                          any: [...(target.conditions?.any || []), createEmptyConditionRow()],
                                                        },
                                                      };
                                                      return { ...current, matchingRules: next };
                                                    })
                                                  }
                                                >
                                                  新增条件
                                                </Button>
                                              </div>
                                              {(rule.conditions?.any || []).map((condition, conditionIndex) => {
                                                const dimension = pricingV2.dimensions.find((item) => item.key === condition.field);
                                                return (
                                                  <div key={`any-${condition.field || "condition"}-${conditionIndex}`} className='grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_72px]'>
                                                    <select
                                                      value={condition.field || ""}
                                                      onChange={(e) =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          const rows = [...(target.conditions?.any || [])];
                                                          rows[conditionIndex] = { ...rows[conditionIndex], field: e.target.value };
                                                          next[ruleIndex] = { ...target, conditions: { all: target.conditions?.all || [], any: rows } };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                      className='w-full rounded border px-3 py-2'
                                                    >
                                                      <option value=''>选择字段</option>
                                                      {dimensionOptions.map((option) => (
                                                        <option key={`any-${option.value}`} value={option.value}>{option.label}</option>
                                                      ))}
                                                    </select>
                                                    <select
                                                      value={condition.op || "eq"}
                                                      onChange={(e) =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          const rows = [...(target.conditions?.any || [])];
                                                          rows[conditionIndex] = { ...rows[conditionIndex], op: e.target.value as ManagedPricingConditionRow["op"] };
                                                          next[ruleIndex] = { ...target, conditions: { all: target.conditions?.all || [], any: rows } };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                      className='w-full rounded border px-3 py-2'
                                                    >
                                                      <option value='eq'>eq</option>
                                                      <option value='in'>in</option>
                                                      <option value='gt'>gt</option>
                                                      <option value='gte'>gte</option>
                                                      <option value='lt'>lt</option>
                                                      <option value='lte'>lte</option>
                                                    </select>
                                                    <Input
                                                      value={stringifyConditionValue(condition.value)}
                                                      onChange={(e) =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          const rows = [...(target.conditions?.any || [])];
                                                          rows[conditionIndex] = {
                                                            ...rows[conditionIndex],
                                                            value: parseConditionValue(e.target.value, dimension?.type, rows[conditionIndex]?.op),
                                                          };
                                                          next[ruleIndex] = { ...target, conditions: { all: target.conditions?.all || [], any: rows } };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                      placeholder={condition.op === "in" ? "逗号分隔多个值" : "值"}
                                                    />
                                                    <Button
                                                      size='sm'
                                                      variant='outline'
                                                      className='text-red-600 hover:text-red-700'
                                                      onClick={() =>
                                                        updateVendorPricingV2(vendorIndex, (current) => {
                                                          const next = [...current.matchingRules];
                                                          const target = next[ruleIndex];
                                                          next[ruleIndex] = {
                                                            ...target,
                                                            conditions: {
                                                              all: target.conditions?.all || [],
                                                              any: (target.conditions?.any || []).filter((_, index) => index !== conditionIndex),
                                                            },
                                                          };
                                                          return { ...current, matchingRules: next };
                                                        })
                                                      }
                                                    >
                                                      删除
                                                    </Button>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>

                                  <div className='hidden rounded-lg border bg-white p-3'>
                                    <div className='mb-3 flex items-center justify-between'>
                                      <div className='font-medium text-gray-800'>3. Evaluator</div>
                                      <div className='flex gap-2'>
                                        {(["fixed", "linear", "base_plus_linear", "lookup_matrix"] as const).map((type) => (
                                          <Button
                                            key={type}
                                            size='sm'
                                            variant='outline'
                                            onClick={() =>
                                              updateVendorPricingV2(vendorIndex, (current) => ({
                                                ...current,
                                                evaluators: {
                                                  ...current.evaluators,
                                                  [`eval_${type}_${Object.keys(current.evaluators || {}).length + 1}`]: createEvaluatorByType(type),
                                                },
                                              }))
                                            }
                                          >
                                            新增 {type}
                                          </Button>
                                        ))}
                                      </div>
                                    </div>
                                    <div className='space-y-3'>
                                      {evaluatorEntries.length === 0 ? (
                                        <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                                          暂无 evaluator。建议先创建 `lookup_matrix` 或 `linear`。
                                        </div>
                                      ) : (
                                        evaluatorEntries.map(([evaluatorKey, evaluator]) => (
                                          <div key={evaluatorKey} className='rounded border p-3 space-y-3'>
                                            <div className='flex items-center justify-between gap-3'>
                                              <div className='font-medium text-gray-800'>{evaluatorKey}</div>
                                              <div className='flex items-center gap-2'>
                                                <span className='rounded bg-gray-100 px-2 py-1 text-xs text-gray-600'>{evaluator.type}</span>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  className='text-red-600 hover:text-red-700'
                                                  onClick={() =>
                                                    updateVendorPricingV2(vendorIndex, (current) => {
                                                      const nextEvaluators = { ...current.evaluators };
                                                      delete nextEvaluators[evaluatorKey];
                                                      return { ...current, evaluators: nextEvaluators };
                                                    })
                                                  }
                                                >
                                                  删除
                                                </Button>
                                              </div>
                                            </div>

                                            {evaluator.type === "fixed" && (
                                              <div className='grid gap-3 md:grid-cols-2'>
                                                <div>
                                                  <label className='block text-xs text-gray-600 mb-1'>priceYuan</label>
                                                  <Input
                                                    type='number'
                                                    step='0.001'
                                                    value={evaluator.priceYuan ?? 0}
                                                    onChange={(e) =>
                                                      updateVendorPricingV2(vendorIndex, (current) => ({
                                                        ...current,
                                                        evaluators: {
                                                          ...current.evaluators,
                                                          [evaluatorKey]: { ...evaluator, priceYuan: Number(e.target.value) || 0 },
                                                        },
                                                      }))
                                                    }
                                                  />
                                                </div>
                                              </div>
                                            )}

                                            {evaluator.type === "linear" && (
                                              <div className='grid gap-3 md:grid-cols-2'>
                                                <div>
                                                  <label className='block text-xs text-gray-600 mb-1'>unitField</label>
                                                  <select
                                                    value={evaluator.unitField || ""}
                                                    onChange={(e) =>
                                                      updateVendorPricingV2(vendorIndex, (current) => ({
                                                        ...current,
                                                        evaluators: {
                                                          ...current.evaluators,
                                                          [evaluatorKey]: { ...evaluator, unitField: e.target.value },
                                                        },
                                                      }))
                                                    }
                                                    className='w-full rounded border px-3 py-2'
                                                  >
                                                    <option value=''>选择字段</option>
                                                    {dimensionOptions.map((option) => (
                                                      <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className='block text-xs text-gray-600 mb-1'>unitPriceYuan</label>
                                                  <Input
                                                    type='number'
                                                    step='0.001'
                                                    value={evaluator.unitPriceYuan ?? 0}
                                                    onChange={(e) =>
                                                      updateVendorPricingV2(vendorIndex, (current) => ({
                                                        ...current,
                                                        evaluators: {
                                                          ...current.evaluators,
                                                          [evaluatorKey]: { ...evaluator, unitPriceYuan: Number(e.target.value) || 0 },
                                                        },
                                                      }))
                                                    }
                                                  />
                                                </div>
                                              </div>
                                            )}

                                            {evaluator.type === "base_plus_linear" && (
                                              <div className='grid gap-3 md:grid-cols-4'>
                                                <Input
                                                  type='number'
                                                  value={evaluator.basePriceYuan ?? 0}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      evaluators: {
                                                        ...current.evaluators,
                                                        [evaluatorKey]: { ...evaluator, basePriceYuan: Number(e.target.value) || 0 },
                                                      },
                                                    }))
                                                  }
                                                  placeholder='basePriceYuan'
                                                />
                                                <Input
                                                  type='number'
                                                  value={evaluator.includedUnits ?? 1}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      evaluators: {
                                                        ...current.evaluators,
                                                        [evaluatorKey]: { ...evaluator, includedUnits: Number(e.target.value) || 1 },
                                                      },
                                                    }))
                                                  }
                                                  placeholder='includedUnits'
                                                />
                                                <select
                                                  value={evaluator.unitField || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      evaluators: {
                                                        ...current.evaluators,
                                                        [evaluatorKey]: { ...evaluator, unitField: e.target.value },
                                                      },
                                                    }))
                                                  }
                                                  className='w-full rounded border px-3 py-2'
                                                >
                                                  <option value=''>选择字段</option>
                                                  {dimensionOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                  ))}
                                                </select>
                                                <Input
                                                  type='number'
                                                  step='0.001'
                                                  value={evaluator.extraUnitPriceYuan ?? 0}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      evaluators: {
                                                        ...current.evaluators,
                                                        [evaluatorKey]: { ...evaluator, extraUnitPriceYuan: Number(e.target.value) || 0 },
                                                      },
                                                    }))
                                                  }
                                                  placeholder='extraUnitPriceYuan'
                                                />
                                              </div>
                                            )}

                                            {evaluator.type === "lookup_matrix" && (
                                              <div className='space-y-3'>
                                                <div>
                                                  <label className='block text-xs text-gray-600 mb-1'>axes</label>
                                                  <Input
                                                    value={(evaluator.axes || []).join(", ")}
                                                    onChange={(e) =>
                                                      updateVendorPricingV2(vendorIndex, (current) => ({
                                                        ...current,
                                                        evaluators: {
                                                          ...current.evaluators,
                                                          [evaluatorKey]: {
                                                            ...evaluator,
                                                            axes: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                                                          },
                                                        },
                                                      }))
                                                    }
                                                    placeholder='例如：hasAudio, qualityMode, durationSec'
                                                  />
                                                </div>
                                                {(() => {
                                                  const axes = Array.isArray(evaluator.axes)
                                                    ? evaluator.axes.filter(Boolean) as string[]
                                                    : [];
                                                  const axisDimensions = axes.map((axis: string) =>
                                                    pricingV2.dimensions.find((dimension) => dimension.key === axis)
                                                  );
                                                  const axisValues = axisDimensions.map((dimension: ManagedPricingDimensionDefinition | undefined) =>
                                                    getDimensionOptionValues(dimension).map((value) => String(value))
                                                  );
                                                  const canRenderMatrix =
                                                    (axes.length === 2 || axes.length === 3) &&
                                                    axisValues.every((values: string[]) => values.length > 0);

                                                  if (!canRenderMatrix) {
                                                    return (
                                                      <div className='rounded border border-dashed px-3 py-4 text-xs text-gray-500'>
                                                        可视化矩阵编辑需要先满足两个条件：1. `axes` 为 2 或 3 个字段；2. 每个轴字段都已经在维度定义里配置离散 options。
                                                      </div>
                                                    );
                                                  }

                                                  if (axes.length === 2) {
                                                    const rowAxis = axes[0];
                                                    const colAxis = axes[1];
                                                    const rowValues = axisValues[0];
                                                    const colValues = axisValues[1];
                                                    return (
                                                      <div className='overflow-x-auto rounded border'>
                                                        <table className='min-w-full border-separate border-spacing-0 text-xs'>
                                                          <thead>
                                                            <tr>
                                                              <th className='bg-gray-50 border px-3 py-2 text-left'>{rowAxis} \\ {colAxis}</th>
                                                              {colValues.map((colValue: string) => (
                                                                <th key={colValue} className='bg-gray-50 border px-3 py-2 text-center'>{colValue}</th>
                                                              ))}
                                                            </tr>
                                                          </thead>
                                                          <tbody>
                                                            {rowValues.map((rowValue: string) => (
                                                              <tr key={rowValue}>
                                                                <td className='border px-3 py-2 font-medium bg-white'>{rowValue}</td>
                                                                {colValues.map((colValue: string) => {
                                                                  const currentValue = getLookupMatrixValue(
                                                                    evaluator.matrix,
                                                                    [rowValue, colValue]
                                                                  );
                                                                  return (
                                                                    <td key={`${rowValue}-${colValue}`} className='border px-2 py-2'>
                                                                      <Input
                                                                        type='number'
                                                                        step='0.001'
                                                                        value={typeof currentValue === "number" ? currentValue : ""}
                                                                        onChange={(e) =>
                                                                          updateVendorPricingV2(vendorIndex, (current) => ({
                                                                            ...current,
                                                                            evaluators: {
                                                                              ...current.evaluators,
                                                                              [evaluatorKey]: {
                                                                                ...evaluator,
                                                                                matrix: setLookupMatrixValue(
                                                                                  evaluator.matrix,
                                                                                  [rowValue, colValue],
                                                                                  e.target.value.trim() === "" ? undefined : Number(e.target.value)
                                                                                ),
                                                                              },
                                                                            },
                                                                          }))
                                                                        }
                                                                        placeholder='-'
                                                                        className='min-w-[92px]'
                                                                      />
                                                                    </td>
                                                                  );
                                                                })}
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      </div>
                                                    );
                                                  }

                                                  const groupAxis = axes[0];
                                                  const rowAxis = axes[1];
                                                  const colAxis = axes[2];
                                                  const groupValues = axisValues[0];
                                                  const rowValues = axisValues[1];
                                                  const colValues = axisValues[2];
                                                  return (
                                                    <div className='space-y-3'>
                                                      {groupValues.map((groupValue: string) => (
                                                        <div key={groupValue} className='rounded border'>
                                                          <div className='border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700'>
                                                            {groupAxis}: {groupValue}
                                                          </div>
                                                          <div className='overflow-x-auto'>
                                                            <table className='min-w-full border-separate border-spacing-0 text-xs'>
                                                              <thead>
                                                                <tr>
                                                                  <th className='bg-gray-50 border px-3 py-2 text-left'>{rowAxis} \\ {colAxis}</th>
                                                                  {colValues.map((colValue: string) => (
                                                                    <th key={colValue} className='bg-gray-50 border px-3 py-2 text-center'>{colValue}</th>
                                                                  ))}
                                                                </tr>
                                                              </thead>
                                                              <tbody>
                                                                {rowValues.map((rowValue: string) => (
                                                                  <tr key={`${groupValue}-${rowValue}`}>
                                                                    <td className='border px-3 py-2 font-medium bg-white'>{rowValue}</td>
                                                                    {colValues.map((colValue: string) => {
                                                                      const currentValue = getLookupMatrixValue(
                                                                        evaluator.matrix,
                                                                        [groupValue, rowValue, colValue]
                                                                      );
                                                                      return (
                                                                        <td key={`${groupValue}-${rowValue}-${colValue}`} className='border px-2 py-2'>
                                                                          <Input
                                                                            type='number'
                                                                            step='0.001'
                                                                            value={typeof currentValue === "number" ? currentValue : ""}
                                                                            onChange={(e) =>
                                                                              updateVendorPricingV2(vendorIndex, (current) => ({
                                                                                ...current,
                                                                                evaluators: {
                                                                                  ...current.evaluators,
                                                                                  [evaluatorKey]: {
                                                                                    ...evaluator,
                                                                                    matrix: setLookupMatrixValue(
                                                                                      evaluator.matrix,
                                                                                      [groupValue, rowValue, colValue],
                                                                                      e.target.value.trim() === "" ? undefined : Number(e.target.value)
                                                                                    ),
                                                                                  },
                                                                                },
                                                                              }))
                                                                            }
                                                                            placeholder='-'
                                                                            className='min-w-[92px]'
                                                                          />
                                                                        </td>
                                                                      );
                                                                    })}
                                                                  </tr>
                                                                ))}
                                                              </tbody>
                                                            </table>
                                                          </div>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  );
                                                })()}
                                                <div>
                                                  <label className='block text-xs text-gray-600 mb-1'>matrix(JSON)</label>
                                                  <textarea
                                                    value={JSON.stringify(evaluator.matrix || {}, null, 2)}
                                                    onChange={(e) => {
                                                      try {
                                                        const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : {};
                                                        updateVendorPricingV2(vendorIndex, (current) => ({
                                                          ...current,
                                                          evaluators: {
                                                            ...current.evaluators,
                                                            [evaluatorKey]: { ...evaluator, matrix: parsed },
                                                          },
                                                        }));
                                                      } catch {
                                                        // keep editing text until valid json by ignoring invalid patch
                                                      }
                                                    }}
                                                    rows={8}
                                                    className='w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs'
                                                    spellCheck={false}
                                                  />
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>

                                  <div className='hidden rounded-lg border bg-white p-3'>
                                    <div className='mb-3 font-medium text-gray-800'>4. 展示配置</div>
                                    <div className='grid gap-3 md:grid-cols-2'>
                                      <div>
                                        <label className='block text-xs text-gray-600 mb-1'>specAxes</label>
                                        <Input
                                          value={(pricingV2.displayConfig.specAxes || []).join(", ")}
                                          onChange={(e) =>
                                            updateVendorPricingV2(vendorIndex, (current) => ({
                                              ...current,
                                              displayConfig: {
                                                ...current.displayConfig,
                                                specAxes: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                                              },
                                            }))
                                          }
                                          placeholder='例如：qualityMode, durationSec'
                                        />
                                      </div>
                                      <div>
                                        <label className='block text-xs text-gray-600 mb-1'>默认规格选择</label>
                                        <div className='grid gap-2 md:grid-cols-2'>
                                          {pricingV2.dimensions.map((dimension) => (
                                            <div key={`default-${dimension.key}`}>
                                              <label className='block text-[11px] text-gray-500 mb-1'>
                                                {dimension.label || dimension.key}
                                              </label>
                                              {dimension.type === "enum" || dimension.type === "boolean" ? (
                                                <select
                                                  value={String(pricingV2.displayConfig.defaultSelections?.[dimension.key] ?? "")}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      displayConfig: {
                                                        ...current.displayConfig,
                                                        defaultSelections: {
                                                          ...current.displayConfig.defaultSelections,
                                                          [dimension.key]:
                                                            dimension.type === "boolean"
                                                              ? e.target.value === "true"
                                                              : e.target.value,
                                                        },
                                                      },
                                                    }))
                                                  }
                                                  className='w-full rounded border px-3 py-2'
                                                >
                                                  <option value=''>未设置</option>
                                                  {(dimension.options || []).map((option) => (
                                                    <option key={`${dimension.key}-${String(option.value)}`} value={String(option.value)}>
                                                      {option.label || String(option.value)}
                                                    </option>
                                                  ))}
                                                </select>
                                              ) : (
                                                <Input
                                                  value={String(pricingV2.displayConfig.defaultSelections?.[dimension.key] ?? "")}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      displayConfig: {
                                                        ...current.displayConfig,
                                                        defaultSelections: {
                                                          ...current.displayConfig.defaultSelections,
                                                          [dimension.key]:
                                                            dimension.type === "number"
                                                              ? (e.target.value.trim() === "" ? "" : Number(e.target.value))
                                                              : e.target.value,
                                                        },
                                                      },
                                                    }))
                                                  }
                                                />
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>

                                    <div className='mt-3'>
                                      <label className='block text-xs text-gray-600 mb-2'>标签映射</label>
                                      <div className='grid gap-2 md:grid-cols-2'>
                                        {pricingV2.dimensions.flatMap((dimension) =>
                                          (dimension.options || []).map((option) => {
                                            const labelKey = `${dimension.key}.${String(option.value)}`;
                                            return (
                                              <div key={labelKey}>
                                                <label className='block text-[11px] text-gray-500 mb-1'>{labelKey}</label>
                                                <Input
                                                  value={pricingV2.displayConfig.labels?.[labelKey] || ""}
                                                  onChange={(e) =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      displayConfig: {
                                                        ...current.displayConfig,
                                                        labels: {
                                                          ...current.displayConfig.labels,
                                                          [labelKey]: e.target.value,
                                                        },
                                                      },
                                                    }))
                                                  }
                                                  placeholder={option.label || String(option.value)}
                                                />
                                              </div>
                                            );
                                          })
                                        )}
                                      </div>
                                    </div>

                                    <div className='mt-4'>
                                      <div className='mb-2 flex items-center justify-between'>
                                        <label className='block text-xs text-gray-600'>预设规格 presets</label>
                                        <div className='flex gap-2'>
                                          <Button
                                            size='sm'
                                            variant='outline'
                                            onClick={() =>
                                              updateVendorPricingV2(vendorIndex, (current) => ({
                                                ...current,
                                                displayConfig: {
                                                  ...current.displayConfig,
                                                  presets: [
                                                    ...(current.displayConfig.presets || []),
                                                    Object.fromEntries(
                                                      current.dimensions.map((dimension) => [
                                                        dimension.key,
                                                        Array.isArray(dimension.options) && dimension.options.length > 0
                                                          ? dimension.options[0]?.value
                                                          : dimension.type === "boolean"
                                                          ? false
                                                          : dimension.type === "number"
                                                          ? 0
                                                          : "",
                                                      ])
                                                    ),
                                                  ],
                                                },
                                              }))
                                            }
                                          >
                                            新增 preset
                                          </Button>
                                          <Button
                                            size='sm'
                                            variant='outline'
                                            onClick={() => previewVendorPricingPresets(vendorIndex, vendor)}
                                            disabled={
                                              presetPreviewLoading ||
                                              hasPricingV2Errors ||
                                              (pricingV2.displayConfig.presets || []).length === 0
                                            }
                                          >
                                            {presetPreviewLoading ? "试算中..." : "批量试算"}
                                          </Button>
                                        </div>
                                      </div>
                                      <div className='space-y-3'>
                                        {(pricingV2.displayConfig.presets || []).length === 0 ? (
                                          <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                                            暂无展示预设。可添加一组默认规格用于价格一览和推荐组合展示。
                                          </div>
                                        ) : (
                                          (pricingV2.displayConfig.presets || []).map((preset, presetIndex) => (
                                            <div key={`preset-${presetIndex}`} className='rounded border p-3'>
                                              <div className='mb-2 flex items-center justify-between'>
                                                <div className='text-xs font-medium text-gray-600'>Preset {presetIndex + 1}</div>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  className='text-red-600 hover:text-red-700'
                                                  onClick={() =>
                                                    updateVendorPricingV2(vendorIndex, (current) => ({
                                                      ...current,
                                                      displayConfig: {
                                                        ...current.displayConfig,
                                                        presets: (current.displayConfig.presets || []).filter((_, index) => index !== presetIndex),
                                                      },
                                                    }))
                                                  }
                                                >
                                                  删除
                                                </Button>
                                              </div>
                                              <div className='grid gap-2 md:grid-cols-2 xl:grid-cols-3'>
                                                {pricingV2.dimensions.map((dimension) => (
                                                  <div key={`preset-${presetIndex}-${dimension.key}`}>
                                                    <label className='block text-[11px] text-gray-500 mb-1'>
                                                      {dimension.label || dimension.key}
                                                    </label>
                                                    {dimension.type === "enum" || dimension.type === "boolean" ? (
                                                      <select
                                                        value={String(preset?.[dimension.key] ?? "")}
                                                        onChange={(e) =>
                                                          updateVendorPricingV2(vendorIndex, (current) => {
                                                            const nextPresets = [...(current.displayConfig.presets || [])];
                                                            const currentPreset = { ...(nextPresets[presetIndex] || {}) };
                                                            currentPreset[dimension.key] =
                                                              dimension.type === "boolean"
                                                                ? e.target.value === "true"
                                                                : e.target.value;
                                                            nextPresets[presetIndex] = currentPreset;
                                                            return {
                                                              ...current,
                                                              displayConfig: {
                                                                ...current.displayConfig,
                                                                presets: nextPresets,
                                                              },
                                                            };
                                                          })
                                                        }
                                                        className='w-full rounded border px-3 py-2'
                                                      >
                                                        <option value=''>未设置</option>
                                                        {(dimension.options || []).map((option) => (
                                                          <option
                                                            key={`preset-${presetIndex}-${dimension.key}-${String(option.value)}`}
                                                            value={String(option.value)}
                                                          >
                                                            {option.label || String(option.value)}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    ) : (
                                                      <Input
                                                        value={String(preset?.[dimension.key] ?? "")}
                                                        onChange={(e) =>
                                                          updateVendorPricingV2(vendorIndex, (current) => {
                                                            const nextPresets = [...(current.displayConfig.presets || [])];
                                                            const currentPreset = { ...(nextPresets[presetIndex] || {}) };
                                                            currentPreset[dimension.key] =
                                                              dimension.type === "number"
                                                                ? (e.target.value.trim() === "" ? "" : Number(e.target.value))
                                                                : e.target.value;
                                                            nextPresets[presetIndex] = currentPreset;
                                                            return {
                                                              ...current,
                                                              displayConfig: {
                                                                ...current.displayConfig,
                                                                presets: nextPresets,
                                                              },
                                                            };
                                                          })
                                                        }
                                                      />
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className='rounded-lg border bg-white p-3'>
                                    <div className='mb-2 flex items-center justify-between gap-3'>
                                      <div className='font-medium text-gray-800'>5. 试算结果</div>
                                      {presetPreviewResults.length > 0 && (
                                        <span className='text-xs text-gray-500'>
                                          已缓存 {presetPreviewResults.length} 条 preset 试算结果
                                        </span>
                                      )}
                                    </div>
                                    {!previewResult ? (
                                      <div className='rounded border border-dashed px-3 py-4 text-sm text-gray-500'>
                                        点击“试算 v2”后，这里会显示命中的规则、evaluator 和最终积分。
                                      </div>
                                    ) : (
                                      <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm'>
                                        <div className='rounded border bg-gray-50 p-3'>
                                          <div className='text-xs text-gray-500'>matchedRuleKey</div>
                                          <div className='font-medium'>{previewResult.matchedRuleKey || "-"}</div>
                                        </div>
                                        <div className='rounded border bg-gray-50 p-3'>
                                          <div className='text-xs text-gray-500'>evaluator</div>
                                          <div className='font-medium'>
                                            {previewResult.evaluatorKey || "-"} {previewResult.evaluatorType ? `(${previewResult.evaluatorType})` : ""}
                                          </div>
                                        </div>
                                        <div className='rounded border bg-gray-50 p-3'>
                                          <div className='text-xs text-gray-500'>priceYuan</div>
                                          <div className='font-medium'>{previewResult.price?.priceYuan ?? "-"}</div>
                                        </div>
                                        <div className='rounded border bg-gray-50 p-3'>
                                          <div className='text-xs text-gray-500'>credits</div>
                                          <div className='font-medium'>{previewResult.price?.credits ?? "-"}</div>
                                        </div>
                                      </div>
                                    )}

                                    {presetPreviewResults.length > 0 && (
                                      <div className='mt-4 overflow-x-auto rounded border'>
                                        <table className='min-w-full text-xs'>
                                          <thead className='bg-gray-50'>
                                            <tr>
                                              <th className='border px-3 py-2 text-left'>Preset</th>
                                              <th className='border px-3 py-2 text-left'>规则</th>
                                              <th className='border px-3 py-2 text-left'>Evaluator</th>
                                              <th className='border px-3 py-2 text-right'>价格(元)</th>
                                              <th className='border px-3 py-2 text-right'>积分</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {presetPreviewResults.map((result, presetIndex) => {
                                              const presetSource =
                                                (pricingV2.displayConfig.presets || [])[presetIndex] || {};
                                              return (
                                                <tr key={`preset-preview-${presetIndex}`}>
                                                  <td className='border px-3 py-2 align-top text-gray-600'>
                                                    <div className='font-medium text-gray-800'>Preset {presetIndex + 1}</div>
                                                    <div className='mt-1 whitespace-pre-wrap break-all'>
                                                      {Object.entries(presetSource)
                                                        .map(([key, value]) => `${key}: ${String(value)}`)
                                                        .join(" · ")}
                                                    </div>
                                                  </td>
                                                  <td className='border px-3 py-2 align-top'>{result.matchedRuleKey || "-"}</td>
                                                  <td className='border px-3 py-2 align-top'>
                                                    {result.evaluatorKey || "-"}
                                                    {result.evaluatorType ? ` (${result.evaluatorType})` : ""}
                                                  </td>
                                                  <td className='border px-3 py-2 align-top text-right'>
                                                    {result.price?.priceYuan ?? "-"}
                                                  </td>
                                                  <td className='border px-3 py-2 align-top text-right font-medium'>
                                                    {result.price?.credits ?? "-"}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {(() => {
                                const taskType = normalizeManagedModelTaskType(selectedModel.taskType);

                                if (taskType === 'video') {
                                  const resolutionOptions = Array.from(
                                    new Set(
                                      [
                                        ...(Array.isArray(selectedVodConfig?.outputConfig?.resolutions)
                                          ? selectedVodConfig.outputConfig.resolutions
                                          : []),
                                        ...specRules
                                          .map((rule) => String(rule.match?.resolution || '').trim().toUpperCase())
                                          .filter(Boolean),
                                      ]
                                    )
                                  );
                                  const durationOptions = Array.from(
                                    new Set(
                                      [
                                        ...(Array.isArray(selectedVodConfig?.outputConfig?.durations)
                                          ? selectedVodConfig.outputConfig.durations
                                          : []),
                                        ...specRules
                                          .map((rule) => Number(rule.match?.duration))
                                          .filter((value) => Number.isFinite(value) && value > 0),
                                      ]
                                    )
                                  ).sort((a, b) => Number(a) - Number(b));
                                  const advancedRuleCount = specRules.filter((rule) => {
                                    const match = rule.match || {};
                                    const keys = Object.keys(match);
                                    return keys.some((key) => key !== 'resolution' && key !== 'duration');
                                  }).length;

                                  const updateMatrixCell = (resolution: string, duration: number, rawValue: string) => {
                                    const normalizedResolution = resolution.trim().toUpperCase();
                                    const numericDuration = Number(duration);
                                    const nextCredits = rawValue.trim() === '' ? null : Number(rawValue);
                                    const remainingRules = specRules.filter((rule) => {
                                      const match = rule.match || {};
                                      return !(
                                        String(match.resolution || '').trim().toUpperCase() === normalizedResolution &&
                                        Number(match.duration) === numericDuration &&
                                        Object.keys(match).every((key) => key === 'resolution' || key === 'duration')
                                      );
                                    });

                                    if (nextCredits !== null && Number.isFinite(nextCredits)) {
                                      remainingRules.push({
                                        label: `${normalizedResolution} / ${numericDuration}s`,
                                        match: { resolution: normalizedResolution, duration: numericDuration },
                                        creditsPerCall: nextCredits,
                                      });
                                    }

                                    updateVendorSpecRules(vendorIndex, remainingRules);
                                  };

                                  return (
                                    <div className='space-y-3'>
                                      <div className='mb-3'>
                                        <div className='font-medium text-gray-800'>视频规格定价表</div>
                                        <div className='text-sm text-gray-500'>仅展示该模型真实支持的分辨率和时长组合，单元格填写积分。</div>
                                      </div>
                                      {resolutionOptions.length === 0 || durationOptions.length === 0 ? (
                                        <div className='rounded border border-dashed px-3 py-6 text-center text-sm text-gray-500'>
                                          当前模型未声明规格支持范围，请先补充模型规格配置。
                                        </div>
                                      ) : (
                                        <div className='space-y-3'>
                                          <div className='overflow-x-auto'>
                                            <table className='min-w-full border-separate border-spacing-0 text-sm'>
                                              <thead>
                                                <tr>
                                                  <th className='sticky left-0 bg-gray-50 border px-3 py-2 text-left'>规格</th>
                                                  {durationOptions.map((duration) => (
                                                    <th key={duration} className='bg-gray-50 border px-3 py-2 text-center whitespace-nowrap'>
                                                      {duration}s
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {resolutionOptions.map((resolution) => (
                                                  <tr key={resolution}>
                                                    <td className='sticky left-0 bg-white border px-3 py-2 font-medium whitespace-nowrap'>
                                                      {resolution}
                                                    </td>
                                                    {durationOptions.map((duration) => {
                                                      const existingRule = specRules.find((rule) => {
                                                        const match = rule.match || {};
                                                        return (
                                                          String(match.resolution || '').trim().toUpperCase() === resolution &&
                                                          Number(match.duration) === Number(duration) &&
                                                          Object.keys(match).every((key) => key === 'resolution' || key === 'duration')
                                                        );
                                                      });
                                                      return (
                                                        <td key={`${resolution}-${duration}`} className='border px-2 py-2'>
                                                          <Input
                                                            type='number'
                                                            value={existingRule?.creditsPerCall ?? ''}
                                                            onChange={(e) => updateMatrixCell(resolution, Number(duration), e.target.value)}
                                                            placeholder='-'
                                                            className='min-w-[96px]'
                                                          />
                                                        </td>
                                                      );
                                                    })}
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>

                                          <div className='rounded-lg border bg-gray-50 px-3 py-3 text-xs text-gray-600'>
                                            留空表示该规格未单独定价，将回退到上面的“默认定价”。
                                            {advancedRuleCount > 0
                                              ? ` 当前还有 ${advancedRuleCount} 条高级规则（含 resolution/duration 以外条件），请在 JSON 导入/替换里维护。`
                                              : ''}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                }

                                const imageModeOptions = selectedImagePricingConfig?.modes || [];
                                const imageSizeOptions = selectedImagePricingConfig?.imageSizes || [];
                                const qualityOptions = selectedImagePricingConfig?.qualities || [];
                                const outputCountOptions = selectedImagePricingConfig?.outputCounts || [1];
                                const referenceImageCountOptions = selectedImagePricingConfig?.referenceImageCounts || [0];
                                const imageRules = specRules;
                                const advancedRuleCount = imageRules.filter((rule) => {
                                  const match = rule.match || {};
                                  return Object.keys(match).some(
                                    (key) => !['mode', 'imageSize', 'outputCount', 'quality', 'referenceImageCount'].includes(key)
                                  );
                                }).length;

                                const addImageRule = () => {
                                  updateVendorSpecRules(vendorIndex, [
                                    ...imageRules,
                                    {
                                      label: '',
                                      match: {
                                        mode: imageModeOptions[0]?.value || 'generate',
                                        imageSize: imageSizeOptions[0] || '1024',
                                        outputCount: outputCountOptions[0] || 1,
                                        quality: qualityOptions[0] || 'standard',
                                        referenceImageCount: referenceImageCountOptions[0] || 0,
                                      },
                                      creditsPerCall: 0,
                                    },
                                  ]);
                                };

                                const patchImageRule = (
                                  ruleIndex: number,
                                  patch: {
                                    label?: string;
                                    match?: Record<string, any>;
                                    creditsPerCall?: number;
                                    priceYuan?: number;
                                  }
                                ) => {
                                  const nextRules = imageRules.map((rule, currentIndex) => {
                                    if (currentIndex !== ruleIndex) return rule;
                                    return {
                                      ...rule,
                                      ...('label' in patch ? { label: patch.label } : {}),
                                      ...('creditsPerCall' in patch ? { creditsPerCall: patch.creditsPerCall } : {}),
                                      ...('priceYuan' in patch ? { priceYuan: patch.priceYuan } : {}),
                                      ...('match' in patch
                                        ? {
                                            match: {
                                              ...(rule.match || {}),
                                              ...(patch.match || {}),
                                            },
                                          }
                                        : {}),
                                    };
                                  });
                                  updateVendorSpecRules(vendorIndex, nextRules);
                                };

                                return (
                                  <div className='space-y-3'>
                                    <div className='flex items-center justify-between'>
                                      <div>
                                        <div className='font-medium text-gray-800'>图片规格规则</div>
                                        <div className='text-sm text-gray-500'>按当前模型支持的模式、尺寸、出图数量和质量组合配置定价。</div>
                                      </div>
                                      <Button size='sm' variant='outline' onClick={addImageRule}>
                                        新增图片规则
                                      </Button>
                                    </div>

                                    {imageRules.length === 0 ? (
                                      <div className='rounded border border-dashed px-3 py-6 text-center text-sm text-gray-500'>
                                        暂无图片规格规则，当前会直接使用厂商默认定价。
                                      </div>
                                    ) : (
                                      <div className='space-y-3'>
                                        {imageRules.map((rule, ruleIndex) => {
                                          const match = rule.match || {};
                                          return (
                                            <div key={`${vendor.vendorKey || 'image-rule'}-${ruleIndex}`} className='rounded-lg border bg-gray-50 p-4'>
                                              <div className='mb-3 flex items-center justify-between'>
                                                <div className='font-medium text-gray-800'>
                                                  图片规则 {ruleIndex + 1}
                                                </div>
                                                <Button
                                                  size='sm'
                                                  variant='outline'
                                                  className='text-red-600 hover:text-red-700 hover:border-red-300'
                                                  onClick={() => updateVendorSpecRules(vendorIndex, imageRules.filter((_, currentIndex) => currentIndex !== ruleIndex))}
                                                >
                                                  删除
                                                </Button>
                                              </div>
                                              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>规则名称</label>
                                                  <Input
                                                    value={rule.label || ''}
                                                    onChange={(e) => patchImageRule(ruleIndex, { label: e.target.value })}
                                                    placeholder='如：1024 单张标准图'
                                                  />
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>模式</label>
                                                  <select
                                                    value={String(match.mode || imageModeOptions[0]?.value || 'generate')}
                                                    onChange={(e) => patchImageRule(ruleIndex, { match: { mode: e.target.value } })}
                                                    className='w-full rounded border px-3 py-2'
                                                  >
                                                    {imageModeOptions.map((option) => (
                                                      <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>尺寸档位</label>
                                                  <select
                                                    value={String(match.imageSize || imageSizeOptions[0] || '1024')}
                                                    onChange={(e) => patchImageRule(ruleIndex, { match: { imageSize: e.target.value } })}
                                                    className='w-full rounded border px-3 py-2'
                                                  >
                                                    {imageSizeOptions.map((option) => (
                                                      <option key={option} value={option}>{option}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>出图数量</label>
                                                  <select
                                                    value={String(Number(match.outputCount) || outputCountOptions[0] || 1)}
                                                    onChange={(e) => patchImageRule(ruleIndex, { match: { outputCount: Number(e.target.value) || 1 } })}
                                                    className='w-full rounded border px-3 py-2'
                                                  >
                                                    {outputCountOptions.map((option) => (
                                                      <option key={option} value={option}>{option}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>质量档位</label>
                                                  <select
                                                    value={String(match.quality || qualityOptions[0] || 'standard')}
                                                    onChange={(e) => patchImageRule(ruleIndex, { match: { quality: e.target.value } })}
                                                    className='w-full rounded border px-3 py-2'
                                                  >
                                                    {qualityOptions.map((option) => (
                                                      <option key={option} value={option}>{option}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>参考图数量</label>
                                                  <select
                                                    value={String(Number(match.referenceImageCount) || referenceImageCountOptions[0] || 0)}
                                                    onChange={(e) => patchImageRule(ruleIndex, { match: { referenceImageCount: Number(e.target.value) || 0 } })}
                                                    className='w-full rounded border px-3 py-2'
                                                  >
                                                    {referenceImageCountOptions.map((option) => (
                                                      <option key={option} value={option}>{option}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>积分</label>
                                                  <Input
                                                    type='number'
                                                    value={rule.creditsPerCall ?? 0}
                                                    onChange={(e) => patchImageRule(ruleIndex, { creditsPerCall: Number(e.target.value) || 0 })}
                                                  />
                                                </div>
                                                <div>
                                                  <label className='block text-sm text-gray-600 mb-1'>价格(元)</label>
                                                  <Input
                                                    type='number'
                                                    step='0.01'
                                                    value={rule.priceYuan ?? ''}
                                                    onChange={(e) =>
                                                      patchImageRule(ruleIndex, {
                                                        priceYuan:
                                                          e.target.value.trim() === ''
                                                            ? undefined
                                                            : Number(e.target.value),
                                                      })
                                                    }
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}

                                        <div className='rounded-lg border bg-gray-50 px-3 py-3 text-xs text-gray-600'>
                                          当前图片模型使用规则卡片而不是矩阵，避免尺寸/数量/质量等维度组合爆炸。
                                          {advancedRuleCount > 0
                                            ? ` 另外还有 ${advancedRuleCount} 条高级规则（含自定义条件），请在 JSON 导入/替换里维护。`
                                            : ''}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`bg-white rounded-lg border p-6 shadow-sm ${!showPlatformPanel ? "hidden" : ""}`}>
            <div className='mb-4 flex items-start justify-between gap-4'>
              <div>
                <h4 className='font-semibold'>平台表单</h4>
                <p className='text-sm text-gray-500'>维护 `platforms[]` 的平台级配置，厂商可以复用这些平台标识。</p>
              </div>
              {selectedPlatform && selectedPlatformIndex !== null && (
                <Button
                  size='sm'
                  variant='outline'
                  className='text-red-600 hover:text-red-700 hover:border-red-300'
                  onClick={() => removePlatform(selectedPlatformIndex)}
                >
                  删除平台
                </Button>
              )}
            </div>

            {!selectedPlatform ? (
              <div className='rounded-lg border border-dashed px-4 py-8 text-center text-sm text-gray-500'>
                请选择左侧平台，或新增一个平台。
              </div>
            ) : (
              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>platformKey</label>
                  <Input
                    value={selectedPlatform.platformKey || ''}
                    onChange={(e) => updateSelectedPlatform({ platformKey: e.target.value })}
                  />
                </div>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>平台名称</label>
                  <Input
                    value={selectedPlatform.platformName || ''}
                    onChange={(e) => updateSelectedPlatform({ platformName: e.target.value })}
                  />
                </div>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>provider</label>
                  <Input
                    value={selectedPlatform.provider || ''}
                    onChange={(e) => updateSelectedPlatform({ provider: e.target.value })}
                  />
                </div>
                <div>
                  <label className='block text-sm text-gray-600 mb-1'>route</label>
                  <select
                    value={selectedPlatform.route || 'legacy'}
                    onChange={(e) => updateSelectedPlatform({ route: e.target.value as ModelVendorRouteType })}
                    className='w-full rounded border px-3 py-2'
                  >
                    <option value='legacy'>legacy</option>
                    <option value='tencent_vod'>tencent_vod</option>
                  </select>
                </div>
                <div className='md:col-span-2 xl:col-span-2'>
                  <label className='block text-sm text-gray-600 mb-1'>描述</label>
                  <Input
                    value={selectedPlatform.description || ''}
                    onChange={(e) => updateSelectedPlatform({ description: e.target.value })}
                  />
                </div>
                <div className='flex items-end'>
                  <label className='inline-flex items-center gap-2 text-sm text-gray-600'>
                    <input
                      type='checkbox'
                      checked={selectedPlatform.enabled !== false}
                      onChange={(e) => updateSelectedPlatform({ enabled: e.target.checked })}
                    />
                    平台启用
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {jsonModalOpen && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-white rounded-lg p-6 w-full max-w-5xl max-h-[90vh] overflow-auto'>
            <div className='mb-4 flex items-start justify-between gap-4'>
              <div>
                <h4 className='text-lg font-semibold'>JSON 导入 / 整体替换</h4>
                <p className='text-sm text-gray-500'>
                  这里用于批量导入或整体替换 `model_provider_mapping_v2`。导入后会同步回列表表单，但不会自动保存。
                </p>
              </div>
              <Button variant='outline' onClick={() => setJsonModalOpen(false)}>关闭</Button>
            </div>
            <div className='rounded-lg border bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4'>
              <code>models[].vendors[].pricing</code> 支持默认价和规格规则，例如 <code>{`{"defaults":{"credits":600,"priceYuan":6},"rules":[{"when":{"resolution":"720P","duration":10},"price":{"credits":900,"priceYuan":9}}]}`}</code>；旧 <code>metadata.specPricing</code> 仍可导入并兼容读取。
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={32}
              className='w-full rounded border border-gray-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-blue-400'
              spellCheck={false}
            />
            <div className='mt-4 flex justify-end gap-3'>
              <Button
                variant='outline'
                onClick={() => {
                  try {
                    const payloadObject = parseJsonDraft();
                    setJsonText(stringifyPrettyJson(payloadObject));
                    showToast('JSON 已格式化', 'success');
                  } catch (error: any) {
                    showToast(error?.message || '格式化失败', 'error');
                  }
                }}
              >
                格式化 JSON
              </Button>
              <Button onClick={handleImportJson}>导入到表单</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 主页面
export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<AdminTabKey>("dashboard");
  const [settingsSubTab, setSettingsSubTab] = useState<
    "system" | "vip-management" | "model-management" | "unified-model-management" | "volc-review"
  >("system");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const userRole = user?.role;
  const hasAdminPanelAccess = canAccessAdminPanel(userRole);
  const canManageSensitiveUserFields = isFullAdmin(userRole);
  const currentTab = canAccessAdminTab(userRole, activeTab) ? activeTab : "dashboard";

  useEffect(() => {
    if (user && !hasAdminPanelAccess) {
      navigate("/");
      return;
    }
  }, [user, hasAdminPanelAccess, navigate]);

  useEffect(() => {
    if (!hasAdminPanelAccess) return;
    if (!canAccessAdminTab(userRole, activeTab)) {
      setActiveTab("dashboard");
    }
  }, [activeTab, hasAdminPanelAccess, userRole]);

  useEffect(() => {
    if (!user || !hasAdminPanelAccess) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const loadDashboard = async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const data = await getDashboardStats();
        if (cancelled) return;
        setStats(data);
        setDashboardError(null);
        setLastUpdatedAt(data.generatedAt);
      } catch (error) {
        if (cancelled) return;
        console.error("加载统计失败:", error);
        setDashboardError("统计刷新失败，请稍后重试");
      } finally {
        if (!cancelled && showLoading) setLoading(false);
      }
    };

    if (currentTab === "dashboard") {
      void loadDashboard(true);
      timer = setInterval(() => {
        void loadDashboard(false);
      }, 10 * 60 * 1000);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [user, hasAdminPanelAccess, currentTab]);

  if (!user || !hasAdminPanelAccess) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <h1 className='text-2xl font-bold mb-2'>无权访问</h1>
          <p className='text-gray-500 mb-4'>您没有管理员权限</p>
          <Button onClick={() => navigate("/")}>返回首页</Button>
        </div>
      </div>
    );
  }

  const tabs: { key: AdminTabKey; label: string }[] = [
    { key: "dashboard", label: "概览" },
    { key: "users", label: "用户管理" },
    { key: "paid-users", label: "付费用户" },
    { key: "credit-records", label: "积分记录" },
    { key: "credit-anomalies", label: "异常积分" },
    { key: "api-stats", label: "API统计" },
    { key: "api-records", label: "API记录" },
    { key: "watermark", label: "水印白名单" },
    { key: "node-configs", label: "节点管理" },
    { key: "templates", label: "公共模板" },
    { key: "settings", label: "系统设置" },
  ];
  const visibleTabs = tabs.filter((tab) => canAccessAdminTab(userRole, tab.key));

  return (
    <div className='h-screen overflow-y-auto bg-gray-100'>
      {/* 顶部导航 */}
      <header className='bg-white border-b'>
        <div className='max-w-7xl mx-auto px-4 py-4 flex items-center justify-between'>
          <div className='flex items-center gap-4'>
            <h1 className='text-xl font-bold'>管理后台</h1>
            <nav className='flex gap-1 ml-8'>
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    currentTab === tab.key
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
          <Button variant='ghost' onClick={() => navigate(-1)}>
            返回
          </Button>
        </div>
      </header>

      {/* 主内容区 */}
      <main className='max-w-7xl mx-auto px-4 py-6'>
        {currentTab === "dashboard" && (
          <div>
            <h2 className='text-lg font-semibold mb-4'>系统概览</h2>
            {loading && !stats ? (
              <div className='text-center py-8 text-gray-500'>加载中...</div>
            ) : stats ? (
              <div className='space-y-4'>
                <div className='text-xs text-gray-500'>
                  自动刷新：每 10 分钟
                  {lastUpdatedAt
                    ? ` · 最后更新 ${new Date(lastUpdatedAt).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}`
                    : ""}
                </div>
                <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
                  <StatCard title='总用户数' value={stats.totalUsers} />
                  <StatCard title='日活用户' value={stats.dailyActiveUsers} subtitle='当天累计去重' />
                  <StatCard title='在线用户' value={stats.onlineUsers} subtitle='最近 15 分钟内有登录态请求' />
                  <StatCard title='当日注册用户' value={stats.todayRegisteredUsers} subtitle='当天新增' />
                  <StatCard
                    title='流通积分'
                    value={stats.totalCreditsInCirculation}
                  />
                  <StatCard title='已消费积分' value={stats.totalCreditsSpent} />
                  <StatCard
                    title='API调用总数'
                    value={stats.totalApiCalls}
                    subtitle={`成功: ${stats.successfulApiCalls} / 失败: ${stats.failedApiCalls}`}
                  />
                  <StatCard
                    title='API成功率'
                    value={
                      stats.totalApiCalls > 0
                        ? `${(
                            (stats.successfulApiCalls / stats.totalApiCalls) *
                            100
                          ).toFixed(1)}%`
                        : "-"
                    }
                  />
                </div>
                <div className='bg-white rounded-lg border p-4 shadow-sm'>
                  <div className='text-sm font-medium text-gray-700 mb-3'>注册用户 vs 日活用户（近 14 天）</div>
                  <DashboardTrendChart data={stats.userTrend} />
                </div>
                {dashboardError && <div className='text-sm text-red-500'>{dashboardError}</div>}
              </div>
            ) : (
              <div className='text-center py-8 text-gray-500'>加载失败</div>
            )}
          </div>
        )}

        {currentTab === "users" && (
          <UsersTab canManageSensitiveUserFields={canManageSensitiveUserFields} />
        )}
        {currentTab === "paid-users" && <PaidUsersTab />}
        {currentTab === "credit-records" && <CreditChangeRecordsTab />}
        {currentTab === "credit-anomalies" && <CreditAnomaliesTab />}
        {currentTab === "api-stats" && <ApiStatsTab />}
        {currentTab === "api-records" && <ApiRecordsTab />}
        {currentTab === "watermark" && <WatermarkWhitelistTab />}
        {currentTab === "node-configs" && <NodeConfigsTab />}
        {currentTab === "templates" && <TemplatesTab />}
        {currentTab === "settings" && (
          <div className='space-y-4'>
            <div className='rounded-lg border bg-white p-2 shadow-sm'>
              <div className='flex flex-wrap gap-2'>
                {[
                  { key: "system", label: "当前系统设置" },
                  { key: "vip-management", label: "VIP管理" },
                  { key: "unified-model-management", label: "统一模型管理" },
                  { key: "model-management", label: "视频模型管理" },
                  { key: "volc-review", label: "审核素材组" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() =>
                      setSettingsSubTab(
                        tab.key as
                          | "system"
                          | "vip-management"
                          | "model-management"
                          | "unified-model-management"
                          | "volc-review"
                      )
                    }
                    className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                      settingsSubTab === tab.key
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {settingsSubTab === "system" && <SettingsTab />}
            {settingsSubTab === "vip-management" && <VipManagementTab />}
            {settingsSubTab === "unified-model-management" && <UnifiedModelManagementTab />}
            {settingsSubTab === "model-management" && <ModelManagementTab />}
            {settingsSubTab === "volc-review" && <VolcReviewTab />}
          </div>
        )}
      </main>
    </div>
  );
}
