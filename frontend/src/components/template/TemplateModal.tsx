import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, UploadCloud, Download } from "lucide-react";
import type { FlowTemplate, TemplateIndexEntry } from "@/types/template";
import SmartImage from "@/components/ui/SmartImage";
import {
  loadBuiltInTemplateIndex,
  loadBuiltInTemplateById,
  listUserTemplates,
  getUserTemplate,
  saveUserTemplate,
  deleteUserTemplate,
  generateId,
} from "@/services/templateStore";
import SharedTemplateCard from "./SharedTemplateCard";
import {
  fetchTemplateCategories,
  fetchTemplates,
  sortPublicTemplateCategories,
  isHiddenPublicTemplateCategory,
} from "@/services/publicTemplateService";
import { useTranslation } from "react-i18next";
// import { useReactFlow } from 'reactflow'; // 暂时注释，因为FloatingHeader不在ReactFlow上下文中

type LocaleTextGetter = (zh: string, en: string) => string;

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstantiateTemplate?: (template: FlowTemplate) => void;
}

// 模板分类从后端维护并读取；前端使用该列表渲染分类标签

// 用户模板卡片组件
const UserTemplateCard: React.FC<{
  item: {
    id: string;
    name: string;
    category?: string;
    tags?: string[];
    thumbnail?: string;
    createdAt: string;
    updatedAt: string;
  };
  onInstantiate: () => Promise<void>;
  onDelete: () => Promise<void>;
  lt: LocaleTextGetter;
}> = ({ item, onInstantiate, onDelete, lt }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 18,
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "18px 20px",
        background: "#fff",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
        minHeight: 160,
        height: 160,
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#18181b";
        e.currentTarget.style.background = "#f4f4f5";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 16px 32px rgba(0, 0, 0, 0.12)";
        setIsHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#e5e7eb";
        e.currentTarget.style.background = "#fff";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
        setIsHovered(false);
      }}
      onClick={async (e) => {
        if ((e.target as HTMLElement).closest(".delete-btn")) return;
        await onInstantiate();
      }}
    >
      <div
        style={{
          flex: "0 0 50%",
          maxWidth: "50%",
          height: "100%",
          background: item.thumbnail ? "transparent" : "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {item.thumbnail ? (
          <SmartImage
            src={item.thumbnail}
            alt={item.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>{lt("暂无预览", "No preview")}</div>
        )}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          justifyContent: "center",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#111827",
              marginBottom: 6,
            }}
          >
            {item.name}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {lt("更新于", "Updated")} {new Date(item.updatedAt).toLocaleString()}
          </div>
        </div>
        {item.category ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            {lt("分类：", "Category: ")}
            {item.category}
          </div>
        ) : null}
        {item.tags?.length ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            {lt("标签：", "Tags: ")}
            {item.tags.join(" / ")}
          </div>
        ) : null}
      </div>
      {isHovered && (
        <button
          className='delete-btn'
          style={{
            position: "absolute",
            right: 16,
            top: 16,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid #fecaca",
            background: "#fff",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fee2e2";
            e.currentTarget.style.borderColor = "#fca5a5";
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.borderColor = "#fecaca";
            e.currentTarget.style.transform = "scale(1)";
          }}
          title={lt("删除模板", "Delete template")}
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

const AddTemplateCard: React.FC<{
  onAdd: () => Promise<void>;
  label?: string;
  lt: LocaleTextGetter;
}> = ({ onAdd, label, lt }) => {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <button
      type='button'
      onClick={async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
          await onAdd();
        } finally {
          setIsLoading(false);
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        border: "1px dashed #a1a1aa",
        borderRadius: 12,
        padding: "18px 20px",
        minHeight: 160,
        height: 160,
        background: "#fafafa",
        color: "#18181b",
        cursor: isLoading ? "wait" : "pointer",
        transition: "all 0.15s ease",
        gap: 10,
        fontSize: 13,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        if (isLoading) return;
        e.currentTarget.style.background = "#f4f4f5";
        e.currentTarget.style.borderColor = "#71717a";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 12px 24px rgba(0, 0, 0, 0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fafafa";
        e.currentTarget.style.borderColor = "#a1a1aa";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
      disabled={isLoading}
    >
      <Plus size={24} strokeWidth={2.5} />
      <div>{isLoading ? lt("保存中…", "Saving...") : label || lt("保存为模板", "Save as template")}</div>
    </button>
  );
};

const TemplatePlaceholder: React.FC<{ label?: string; lt: LocaleTextGetter }> = ({
  label,
  lt,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: 18,
      border: "1px dashed #d1d5db",
      borderRadius: 12,
      padding: "18px 20px",
      minHeight: 160,
      height: 160,
      background: "#f9fafb",
      transition: "all 0.2s ease",
    }}
  >
    <div
      style={{
        flex: "0 0 50%",
        maxWidth: "50%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        borderRadius: 8,
        color: "#94a3b8",
      }}
    >
      <Plus size={28} strokeWidth={2} />
    </div>
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        justifyContent: "center",
        color: "#94a3b8",
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {label || lt("敬请期待更多模板", "More templates coming soon")}
      </div>
      <div>{lt("我们正在准备更多创意模板", "We're preparing more creative templates")}</div>
    </div>
  </div>
);

export default function TemplateModal({
  isOpen,
  onClose,
  onInstantiateTemplate,
}: TemplateModalProps) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || "")
    .toLowerCase()
    .startsWith("zh");
  const lt: LocaleTextGetter = (zh, en) => (isZh ? zh : en);
  const otherCategory = lt("其他", "Other");
  const isOtherCategory = useCallback(
    (category: string) => category === "其他" || category === "Other",
    []
  );
  const normalizeCategory = useCallback(
    (category?: string) =>
      category && category.trim()
        ? isOtherCategory(category)
          ? otherCategory
          : category
        : otherCategory,
    [isOtherCategory, otherCategory]
  );

  // const rf = useReactFlow(); // 暂时注释
  const [templateScope, setTemplateScope] = useState<"public" | "mine">(
    "public"
  );
  const [builtinCategories, setBuiltinCategories] = useState<string[]>([]);
  const [activeBuiltinCategory, setActiveBuiltinCategory] =
    useState<string>("");
  // 切换为单选模式：仅允许选择一个内置分类；空字符串表示未筛选（显示全部）
  const [tplIndex, setTplIndex] = useState<TemplateIndexEntry[] | null>(null);
  const [userTplList, setUserTplList] = useState<
    Array<{
      id: string;
      name: string;
      category?: string;
      tags?: string[];
      thumbnail?: string;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [tplLoading, setTplLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const filteredTplIndex = useMemo(() => {
    if (!tplIndex) return [];
    const visible = tplIndex.filter(
      (item) => !isHiddenPublicTemplateCategory(normalizeCategory(item.category)),
    );
    if (!activeBuiltinCategory) return visible;
    return visible.filter(
      (item) => normalizeCategory(item.category) === activeBuiltinCategory
    );
  }, [tplIndex, activeBuiltinCategory, normalizeCategory]);

  const getPlaceholderCount = useCallback(
    (len: number, opts?: { columns?: number; minVisible?: number }) => {
      const columns = opts?.columns ?? 2;
      const minVisible = opts?.minVisible ?? 0;
      const minFill = len < minVisible ? minVisible - len : 0;
      const remainder = len % columns;
      const columnFill = remainder ? columns - remainder : 0;
      return Math.max(minFill, columnFill);
    },
    []
  );

  // ESC关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // 加载模板数据
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setTplLoading(true);
      try {
        if (!tplIndex) {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map((item) => ({
            ...item,
            category: normalizeCategory(item.category),
          }));
          if (!cancelled) {
            setTplIndex(normalizedIdx);
          }
        }
        const list = await listUserTemplates();
        if (!cancelled) setUserTplList(list);
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, tplIndex, normalizeCategory]);

  // 从后端加载可用分类（管理员在后台可维护）
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const cats = await fetchTemplateCategories();
        if (!cancelled) {
          if (Array.isArray(cats) && cats.length) {
            setBuiltinCategories(sortPublicTemplateCategories(cats));
          } else {
            setBuiltinCategories([otherCategory]);
          }
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, isOtherCategory, otherCategory]);

  // 根据所选分类从后端拉取模板（单选）
  useEffect(() => {
    if (!isOpen || templateScope !== "public") return;
    let cancelled = false;
    (async () => {
      try {
        // 未选中任何分类：始终使用内置索引（全部）
        if (!activeBuiltinCategory) {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map((item) => ({
            ...item,
            category: normalizeCategory(item.category),
          }));
          if (!cancelled) setTplIndex(normalizedIdx);
          return;
        }

        // 选中单个分类：请求该分类的模板
        const res = await fetchTemplates({
          category: activeBuiltinCategory,
          isActive: true,
          pageSize: 1000,
        }).catch(() => null);
        const arr = res && Array.isArray((res as any).items) ? (res as any).items : [];
        const normalized = arr.map((it: any) => ({
          id: it.id,
          name: it.name,
          category: normalizeCategory(it.category),
          description: it.description,
          tags: it.tags,
          thumbnail: it.thumbnail || it.thumbnailSmall,
          updatedAt: it.updatedAt || it.updated_at || "",
        }));
        if (!cancelled) {
          setTplIndex(normalized);
        }
      } catch (e) {
        // fallback to built-in index
        try {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map((item) => ({
            ...item,
            category: normalizeCategory(item.category),
          }));
          if (!cancelled) setTplIndex(normalizedIdx);
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, templateScope, activeBuiltinCategory, normalizeCategory]);

  const instantiateTemplateAt = useCallback(
    async (tpl: FlowTemplate) => {
      if (!tpl?.nodes?.length) return;

      // 通过全局事件通知Flow组件实例化模版
      const event = new CustomEvent("flow:instantiateTemplate", {
        detail: { template: tpl },
      });
      window.dispatchEvent(event);

      if (onInstantiateTemplate) {
        onInstantiateTemplate(tpl);
      }
      // 不自动关闭，让用户可以继续选择其他模版
      // onClose();
    },
    [onInstantiateTemplate, onClose]
  );

  const saveCurrentAsTemplate = useCallback(async () => {
    // 暂时禁用保存功能，因为不在ReactFlow上下文中
    alert(lt("保存模板功能需要在 Flow 画布中使用", "Template saving is available in the Flow canvas"));
  }, [lt]);

  const handleExportTemplates = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("flow:export-template-request"));
  }, []);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => {
        console.error("Template import failed:", reader.error);
        if (importInputRef.current) {
          importInputRef.current.value = "";
        }
      };
      reader.onload = () => {
        try {
          const text = String(reader.result ?? "");
          window.dispatchEvent(
            new CustomEvent("flow:import-template-json", {
              detail: { content: text },
            })
          );
        } finally {
          if (importInputRef.current) {
            importInputRef.current.value = "";
          }
        }
      };
      reader.readAsText(file);
    },
    []
  );

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* 透明遮罩层，用于点击外部关闭 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: "rgba(255, 255, 255, 0.45)",
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            boxShadow:
              "0 18px 45px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)",
            width: "min(60vw, 900px)",
            maxWidth: 900,
            height: "80vh",
            maxHeight: "80vh",
            position: "relative",
            pointerEvents: "auto",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 标题栏 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "20px 24px 12px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f5f7fa",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            }}
          >
            <div style={{ display: "flex", gap: 2 }}>
              <button
                onClick={() => setTemplateScope("public")}
                style={{
                  padding: "10px 18px 14px",
                  fontSize: 13,
                  fontWeight: templateScope === "public" ? 600 : 500,
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  background:
                    templateScope === "public" ? "#fff" : "transparent",
                  color: templateScope === "public" ? "#111827" : "#374151",
                  marginBottom: -2,
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
              >
                {lt("公共模板", "Public Templates")}
              </button>
              <button
                onClick={() => setTemplateScope("mine")}
                style={{
                  padding: "10px 18px 14px",
                  fontSize: 13,
                  fontWeight: templateScope === "mine" ? 600 : 500,
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  background: templateScope === "mine" ? "#fff" : "transparent",
                  color: templateScope === "mine" ? "#111827" : "#374151",
                  marginBottom: -2,
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
              >
                {lt("我的模板", "My Templates")}
              </button>
            </div>
          </div>

          {/* 内容区域 */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 24px 24px",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: templateScope === "public" ? 12 : 18,
              }}
            >
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
                  {templateScope === "public"
                    ? lt("公共模板", "Public Templates")
                    : lt("我的模板", "My Templates")}
                </div>
                {tplLoading ? (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    {lt("加载中…", "Loading...")}
                  </div>
                ) : null}
              </div>
            </div>

            {templateScope === "public" && tplIndex ? (
              <div style={{ marginBottom: 18 }}>
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 14,
                    marginLeft: -24,
                    marginRight: -24,
                    padding: "8px 24px 10px",
                    background: "#fff",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  {builtinCategories.map((cat) => {
                    const isActive = activeBuiltinCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() =>
                          setActiveBuiltinCategory((prev) => (prev === cat ? "" : cat))
                        }
                        style={{
                          padding: "6px 14px",
                          borderRadius: 999,
                          border:
                            "1px solid " + (isActive ? "#18181b" : "#e5e7eb"),
                          background: isActive ? "#18181b" : "#fff",
                          color: isActive ? "#fff" : "#374151",
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 500,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          boxShadow: isActive
                            ? "0 10px 18px rgba(0, 0, 0, 0.18)"
                            : "none",
                        }}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 20,
                  }}
                >
                  {filteredTplIndex.map((item) => (
                    <div key={item.id}>
                      <SharedTemplateCard
                        item={item}
                        onClick={() => {
                          (async () => {
                            console.log("[TemplateModal] Template clicked:", item.id, item.name);
                            const tpl = await loadBuiltInTemplateById(item.id);
                            console.log("[TemplateModal] Template loaded:", tpl);
                            if (tpl) {
                              console.log("[TemplateModal] Template node count:", tpl.nodes?.length);
                              instantiateTemplateAt(tpl);
                            } else {
                              console.warn("[TemplateModal] Template data is empty");
                            }
                          })();
                        }}
                      />
                    </div>
                  ))}
                  {Array.from({
                    length: getPlaceholderCount(filteredTplIndex.length, {
                      minVisible: 1,
                    }),
                  }).map((_, idx) => (
                    <TemplatePlaceholder
                      key={`builtin-placeholder-${idx}`}
                      label={lt("敬请期待更多模板", "More templates coming soon")}
                      lt={lt}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {templateScope === "mine" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 20,
                }}
              >
                <AddTemplateCard
                  onAdd={saveCurrentAsTemplate}
                  lt={lt}
                  label={
                    userTplList.length
                      ? lt("保存当前为新模板", "Save current as a new template")
                      : lt("创建我的第一个模板", "Create my first template")
                  }
                />
                {userTplList.map((item) => {
                  return (
                    <UserTemplateCard
                      key={item.id}
                      item={item}
                      onInstantiate={async () => {
                        const tpl = await getUserTemplate(item.id);
                        if (tpl) instantiateTemplateAt(tpl);
                      }}
                      onDelete={async () => {
                        if (
                          confirm(
                            lt(
                              `确定要删除模板 "${item.name}" 吗？此操作无法撤销。`,
                              `Delete template "${item.name}"? This action cannot be undone.`
                            )
                          )
                        ) {
                          try {
                            await deleteUserTemplate(item.id);
                            const list = await listUserTemplates();
                            setUserTplList(list);
                          } catch (err) {
                            console.error("Template delete failed:", err);
                            alert(lt("删除模板失败", "Failed to delete template"));
                          }
                        }
                      }}
                      lt={lt}
                    />
                  );
                })}
                {Array.from({
                  length:
                    userTplList.length === 0
                      ? 0
                      : getPlaceholderCount(userTplList.length + 1, {
                          minVisible: 1,
                        }),
                }).map((_, idx) => (
                  <TemplatePlaceholder key={`user-placeholder-${idx}`} lt={lt} />
                ))}
              </div>
            ) : null}
          </div>
          <input
            ref={importInputRef}
            type='file'
            accept='application/json'
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
      </div>
    </>,
    document.body
  );
}
//
