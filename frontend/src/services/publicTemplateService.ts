import type { FlowTemplate, TemplateIndexEntry } from "@/types/template";
import { fetchWithAuth } from "./authFetch";

/** 公共模板一级分类 */
export const TEMPLATE_PARENT_CATEGORIES = ["建筑", "其他"] as const;
export type TemplateParentCategory = (typeof TEMPLATE_PARENT_CATEGORIES)[number];

export function isTemplateParentCategory(value: unknown): value is TemplateParentCategory {
  return typeof value === "string" && (TEMPLATE_PARENT_CATEGORIES as readonly string[]).includes(value);
}

export const TEMPLATE_PARENT_CATEGORY_STORAGE_KEY = "tanva:template-parent-category";

export function getStoredTemplateParentCategory(): TemplateParentCategory | null {
  try {
    const stored = localStorage.getItem(TEMPLATE_PARENT_CATEGORY_STORAGE_KEY);
    return isTemplateParentCategory(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function setStoredTemplateParentCategory(category: TemplateParentCategory): void {
  try {
    localStorage.setItem(TEMPLATE_PARENT_CATEGORY_STORAGE_KEY, category);
  } catch {
    // ignore quota / private mode
  }
}

/** 归属「建筑」一级分类的二级分类 */
export const ARCHITECTURE_SECONDARY_CATEGORIES = ["建筑设计", "空间设计"] as const;

export function isArchitectureSecondaryCategory(category: string): boolean {
  const trimmed = typeof category === "string" ? category.trim() : "";
  return (ARCHITECTURE_SECONDARY_CATEGORIES as readonly string[]).includes(trimmed);
}

/** 已下线、不在画布模板面板展示的二级分类 */
export const HIDDEN_PUBLIC_TEMPLATE_CATEGORIES = ["美育设计"] as const;

export function isHiddenPublicTemplateCategory(category: string): boolean {
  const trimmed = typeof category === "string" ? category.trim() : "";
  return (HIDDEN_PUBLIC_TEMPLATE_CATEGORIES as readonly string[]).includes(trimmed);
}

/** 公共模板二级分类：建筑设计置顶 */
export const PRIORITY_PUBLIC_TEMPLATE_CATEGORIES = ["建筑设计"] as const;

export function sortPublicTemplateCategories(categories: string[]): string[] {
  const unique = Array.from(
    new Set(
      categories
        .map((c) => c?.trim())
        .filter(Boolean)
        .filter((c) => !isTemplateParentCategory(c))
        .filter((c) => !isHiddenPublicTemplateCategory(c)) as string[],
    ),
  );
  const other = unique.filter((c) => c === "其他" || c === "Other");
  const rest = unique.filter((c) => c !== "其他" && c !== "Other");
  const priority = PRIORITY_PUBLIC_TEMPLATE_CATEGORIES.filter((c) => rest.includes(c));
  const remaining = rest
    .filter((c) => !PRIORITY_PUBLIC_TEMPLATE_CATEGORIES.includes(c as (typeof PRIORITY_PUBLIC_TEMPLATE_CATEGORIES)[number]))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  const otherSorted = other.sort((a, b) => a.localeCompare(b, "zh-CN"));
  return [...priority, ...remaining, ...otherSorted];
}

export interface PublicTemplate extends TemplateIndexEntry {
  templateData?: FlowTemplate;
  isActive?: boolean;
  sortOrder?: number;
  thumbnailSmall?: string;
  updatedAt?: string;
}

const API_BASE =
  import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

// 简单的授权头构造器：若需自定义认证（例如 Bearer token），在此扩展
export function buildAuthHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  // 如果将来需要在头中加入 Authorization 或其它认证字段，
  // 可以在这里读取 cookie/localStorage 或调用认证服务来获取 token 并设置：
  // const token = getAuthToken();
  // if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// 获取公共模板索引
export async function fetchPublicTemplateIndex(
  parentCategory?: TemplateParentCategory,
): Promise<TemplateIndexEntry[]> {
  try {
    const query = parentCategory
      ? `?parentCategory=${encodeURIComponent(parentCategory)}`
      : "";
    const response = await fetchWithAuth(`${API_BASE}/api/templates/index${query}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("fetchPublicTemplateIndex error:", error);
    return [];
  }
}

// 根据ID获取公共模板数据
export async function fetchPublicTemplateById(
  id: string
): Promise<FlowTemplate | null> {
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/templates/${id}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as FlowTemplate;
  } catch (error) {
    console.warn("fetchPublicTemplateById error:", error);
    return null;
  }
}

export interface CreateTemplateRequest {
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  thumbnailSmall?: string;
  templateData?: any;
  templateJsonKey?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateTemplateRequest {
  name?: string;
  category?: string;
  description?: string;
  tags?: string[];
  thumbnail?: string;
  thumbnailSmall?: string;
  templateData?: any;
  isActive?: boolean;
  sortOrder?: number;
}

export interface TemplateQueryParams {
  page?: number;
  pageSize?: number;
  category?: string;
  parentCategory?: TemplateParentCategory;
  isActive?: boolean;
  search?: string;
}

export type TemplateCategoryGroups = Record<TemplateParentCategory, string[]>;

export interface TemplateListResponse {
  items: PublicTemplate[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 创建模板
export async function createTemplate(
  data: CreateTemplateRequest
): Promise<PublicTemplate> {
  const headers = buildAuthHeaders("application/json");
  const response = await fetchWithAuth(`${API_BASE}/api/admin/templates`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to create template: ${response.statusText}`);
  }

  return response.json();
}

// 获取模板列表
export async function fetchTemplates(
  params: TemplateQueryParams = {}
): Promise<TemplateListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", params.page.toString());
  if (params.pageSize) searchParams.set("pageSize", params.pageSize.toString());
  if (params.category) searchParams.set("category", params.category);
  if (params.parentCategory) searchParams.set("parentCategory", params.parentCategory);
  if (params.isActive !== undefined)
    searchParams.set("isActive", params.isActive.toString());
  if (params.search) searchParams.set("search", params.search);

  const headers = buildAuthHeaders();
  const response = await fetchWithAuth(
    `${API_BASE}/api/admin/templates?${searchParams}`,
    {
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.statusText}`);
  }

  return response.json();
}

// 获取单个模板
export async function fetchTemplate(id: string): Promise<PublicTemplate> {
  const headers = buildAuthHeaders();
  const response = await fetchWithAuth(`${API_BASE}/api/admin/templates/${id}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch template: ${response.statusText}`);
  }

  return response.json();
}

// 更新模板
export async function updateTemplate(
  id: string,
  data: UpdateTemplateRequest
): Promise<PublicTemplate> {
  const headers = buildAuthHeaders("application/json");
  const response = await fetchWithAuth(`${API_BASE}/api/admin/templates/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update template: ${response.statusText}`);
  }

  return response.json();
}

// 删除模板
export async function deleteTemplate(id: string): Promise<void> {
  const headers = buildAuthHeaders();
  const response = await fetchWithAuth(`${API_BASE}/api/admin/templates/${id}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to delete template: ${response.statusText}`);
  }
}

// 获取模板二级分类
export async function fetchTemplateCategories(
  parentCategory?: TemplateParentCategory,
): Promise<string[]> {
  const headers = buildAuthHeaders();
  const query = parentCategory
    ? `?parentCategory=${encodeURIComponent(parentCategory)}`
    : "";
  const response = await fetchWithAuth(`${API_BASE}/api/templates/categories${query}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch categories: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchTemplateCategoryGroups(): Promise<TemplateCategoryGroups> {
  const headers = buildAuthHeaders();
  const response = await fetchWithAuth(`${API_BASE}/api/templates/category-groups`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch category groups: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    建筑: Array.isArray(data?.建筑) ? data.建筑 : [],
    其他: Array.isArray(data?.其他) ? data.其他 : [],
  };
}

export async function fetchAdminTemplateCategoryGroups(): Promise<TemplateCategoryGroups> {
  const headers = buildAuthHeaders();
  const response = await fetchWithAuth(`${API_BASE}/api/admin/templates/category-groups`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch admin category groups: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    建筑: Array.isArray(data?.建筑) ? data.建筑 : [],
    其他: Array.isArray(data?.其他) ? data.其他 : [],
  };
}
