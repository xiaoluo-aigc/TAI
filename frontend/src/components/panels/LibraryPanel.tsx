import React from "react";
import { Button } from "../ui/button";
import SmartImage from "../ui/SmartImage";
import ImagePreviewModal from "../ui/ImagePreviewModal";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Send,
  Image as ImageIcon,
  Box,
  Plus,
  Search,
  Loader2,
} from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useProjectStore } from "@/stores/projectStore";
import { imageUploadService } from "@/services/imageUploadService";
import {
  model3DUploadService,
  type Model3DData,
} from "@/services/model3DUploadService";
import { model3DPreviewService } from "@/services/model3DPreviewService";
import { personalLibraryApi } from "@/services/personalLibraryApi";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { fetchWithAuth } from "@/services/authFetch";
import { blobToDataUrl, responseToBlob } from "@/utils/imageConcurrency";
import {
  createPersonalAssetId,
  usePersonalLibraryStore,
  type PersonalAssetType,
  type PersonalLibraryAsset,
  type PersonalImageAsset,
  type PersonalModelAsset,
  type PersonalSvgAsset,
} from "@/stores/personalLibraryStore";
import {
  globalImageHistoryApi,
  type GlobalImageHistoryItem,
} from "@/services/globalImageHistoryApi";
import type { StoredImageAsset } from "@/types/canvas";
import { useLocaleText } from "@/utils/localeText";

const formatSize = (bytes?: number): string => {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const formatHistoryDate = (value: string, locale: string): string => {
  return new Date(value).toLocaleDateString(locale, {
    month: "2-digit",
    day: "2-digit",
  });
};

const SOURCE_TYPE_LABELS: Record<string, { zh: string; en: string }> = {
  generate: { zh: "图片生成", en: "Image Generate" },
  generatePro: { zh: "图片生成Pro", en: "Image Generate Pro" },
  generatePro4: { zh: "图片生成Pro4", en: "Image Generate Pro4" },
  midjourney: { zh: "Midjourney", en: "Midjourney" },
  "3d": { zh: "3D生成", en: "3D Generate" },
  camera: { zh: "相机", en: "Camera" },
  image: { zh: "图片", en: "Image" },
  imagePro: { zh: "图片Pro", en: "Image Pro" },
};

type LibraryTab = "global-history" | "project-history" | "manual";
const HISTORY_PAGE_SIZE = 20;

type HistoryPageSlot = number | "ellipsis-left" | "ellipsis-right";

const buildHistoryPageSlots = (
  currentPage: number,
  totalPages: number
): HistoryPageSlot[] => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-right", totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis-left",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ];
};

const getTypeLabel = (
  type: PersonalAssetType
): { label: string; icon: React.ReactNode; bgColor: string } => {
  switch (type) {
    case "2d":
      return {
        label: "2D",
        icon: <ImageIcon className='w-3 h-3' />,
        bgColor: "bg-blue-100 text-blue-700",
      };
    case "3d":
      return {
        label: "3D",
        icon: <Box className='w-3 h-3' />,
        bgColor: "bg-purple-100 text-purple-700",
      };
    default:
      return {
        label: "SVG",
        icon: <ImageIcon className='w-3 h-3' />,
        bgColor: "bg-green-100 text-green-700",
      };
  }
};

const LibraryPanel: React.FC = () => {
  const { lt, isZh } = useLocaleText();
  const locale = isZh ? "zh-CN" : "en-US";
  const { showLibraryPanel, setShowLibraryPanel } = useUIStore();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const [activeTab, setActiveTab] = React.useState<LibraryTab>("manual");
  const [isUploading, setUploading] = React.useState(false);
  const [isLibraryDragHovering, setLibraryDragHovering] = React.useState(false);
  const [selectedAsset, setSelectedAsset] =
    React.useState<PersonalLibraryAsset | null>(null);
  const [selectedHistoryItem, setSelectedHistoryItem] =
    React.useState<GlobalImageHistoryItem | null>(null);
  const [detailPosition, setDetailPosition] = React.useState<{
    top: number;
  } | null>(null);
  const [previewState, setPreviewState] = React.useState<{
    src: string;
    title: string;
  } | null>(null);
  const addAsset = usePersonalLibraryStore((state) => state.addAsset);
  const removeAsset = usePersonalLibraryStore((state) => state.removeAsset);
  const updateAsset = usePersonalLibraryStore((state) => state.updateAsset);
  const mergeAssets = usePersonalLibraryStore((state) => state.mergeAssets);
  const allAssets = usePersonalLibraryStore((state) => state.assets);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const detailPanelRef = React.useRef<HTMLDivElement>(null);
  const [historyItems, setHistoryItems] = React.useState<GlobalImageHistoryItem[]>(
    []
  );
  const [historyIsLoading, setHistoryIsLoading] = React.useState(false);
  const [historyFilterType, setHistoryFilterType] = React.useState("");
  const [historySearchQuery, setHistorySearchQuery] = React.useState("");
  const [historyPage, setHistoryPage] = React.useState(1);
  const [historyTotalPages, setHistoryTotalPages] = React.useState(1);
  const [historyTotalCount, setHistoryTotalCount] = React.useState(0);
  const [projectHistoryItems, setProjectHistoryItems] = React.useState<
    GlobalImageHistoryItem[]
  >([]);
  const [projectHistoryIsLoading, setProjectHistoryIsLoading] =
    React.useState(false);
  const [projectHistoryFilterType, setProjectHistoryFilterType] =
    React.useState("");
  const [projectHistorySearchQuery, setProjectHistorySearchQuery] =
    React.useState("");
  const [projectHistoryPage, setProjectHistoryPage] = React.useState(1);
  const [projectHistoryTotalPages, setProjectHistoryTotalPages] =
    React.useState(1);
  const [projectHistoryTotalCount, setProjectHistoryTotalCount] =
    React.useState(0);

  const historyQueryOptions = React.useMemo(
    () => ({
      sourceType: historyFilterType.trim() || undefined,
      search: historySearchQuery.trim() || undefined,
    }),
    [historyFilterType, historySearchQuery]
  );

  const historyPageSlots = React.useMemo(
    () => buildHistoryPageSlots(historyPage, historyTotalPages),
    [historyPage, historyTotalPages]
  );
  const projectHistoryQueryOptions = React.useMemo(
    () => ({
      sourceType: projectHistoryFilterType.trim() || undefined,
      search: projectHistorySearchQuery.trim() || undefined,
    }),
    [projectHistoryFilterType, projectHistorySearchQuery]
  );
  const projectHistoryPageSlots = React.useMemo(
    () => buildHistoryPageSlots(projectHistoryPage, projectHistoryTotalPages),
    [projectHistoryPage, projectHistoryTotalPages]
  );

  const getSourceTypeLabel = React.useCallback(
    (type: string) => {
      const item = SOURCE_TYPE_LABELS[type];
      if (!item) return type;
      return lt(item.zh, item.en);
    },
    [lt]
  );

  const handleModelThumbnailUpdate = React.useCallback(
    (assetId: string, thumbnail: string) => {
      updateAsset(assetId, { thumbnail });
      const current = usePersonalLibraryStore
        .getState()
        .assets.find((item) => item.id === assetId);
      if (current) {
        void personalLibraryApi
          .upsert({ ...(current as any), thumbnail, updatedAt: Date.now() })
          .catch((error) => {
            console.warn("[LibraryPanel] 同步 3D 缩略图到个人库失败:", error);
          });
      }
    },
    [updateAsset]
  );

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 监听画布侧的库悬停事件，用于展示占位反馈
  React.useEffect(() => {
    const handleLibraryHover = (event: Event) => {
      const hovering = Boolean(
        (event as CustomEvent<{ hovering: boolean }>).detail?.hovering
      );
      setLibraryDragHovering(hovering);
    };
    window.addEventListener(
      "canvas:library-drag-hover",
      handleLibraryHover as EventListener
    );
    return () => {
      window.removeEventListener(
        "canvas:library-drag-hover",
        handleLibraryHover as EventListener
      );
    };
  }, []);

  // 面板关闭时自动清理悬停态
  React.useEffect(() => {
    if (!showLibraryPanel && isLibraryDragHovering) {
      setLibraryDragHovering(false);
    }
  }, [showLibraryPanel, isLibraryDragHovering]);

  React.useEffect(() => {
    if (activeTab === "manual") {
      setSelectedHistoryItem(null);
      return;
    }
    setSelectedAsset(null);
    setSelectedHistoryItem(null);
  }, [activeTab]);

  const triggerUpload = () => fileInputRef.current?.click();

  const upsertImageAsset = React.useCallback(
    (
      file: File,
      asset: NonNullable<
        Awaited<ReturnType<typeof imageUploadService.uploadImageFile>>["asset"]
      >
    ) => {
      const id = createPersonalAssetId("pl2d");
      const imageAsset: PersonalImageAsset = {
        id,
        type: "2d",
        name:
          file.name.replace(/\.[^/.]+$/, "") || asset.fileName || lt("未命名图片", "Untitled Image"),
        url: asset.url,
        thumbnail: asset.url,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName ?? file.name,
        fileSize: file.size,
        contentType: asset.contentType ?? file.type,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addAsset(imageAsset);
      void personalLibraryApi.upsert(imageAsset).catch((error) => {
        console.warn("[LibraryPanel] 同步图片资源到个人库失败:", error);
      });
    },
    [addAsset]
  );

  const upsertModelAsset = React.useCallback(
    (
      file: File,
      asset: NonNullable<
        Awaited<
          ReturnType<typeof model3DUploadService.uploadModelFile>
        >["asset"]
      >
    ) => {
      const id = createPersonalAssetId("pl3d");
      const now = Date.now();
      const modelAsset: PersonalModelAsset = {
        id,
        type: "3d",
        name:
          file.name.replace(/\.[^/.]+$/, "") || asset.fileName || lt("未命名模型", "Untitled Model"),
        url: asset.url,
        fileName: asset.fileName ?? file.name,
        fileSize: asset.fileSize ?? file.size,
        contentType: asset.contentType ?? file.type,
        format: asset.format,
        createdAt: now,
        updatedAt: now,
      };
      addAsset(modelAsset);
      void personalLibraryApi.upsert(modelAsset).catch((error) => {
        console.warn("[LibraryPanel] 同步 3D 资源到个人库失败:", error);
      });
      if (asset.url) {
        void model3DPreviewService
          .generatePreviewAndUpload(asset.url)
          .then((thumbnailUrl) => {
            if (thumbnailUrl) {
              handleModelThumbnailUpdate(id, thumbnailUrl);
            }
          })
          .catch((error) => {
            console.warn("[LibraryPanel] 3D 预览生成失败:", error);
          });
      }
    },
    [addAsset, handleModelThumbnailUpdate]
  );

  const handleUploadFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const is3D =
        file.name.toLowerCase().endsWith(".glb") ||
        file.name.toLowerCase().endsWith(".gltf");

      if (is3D) {
        const result = await model3DUploadService.uploadModelFile(file, {
          dir: "uploads/personal-library/models/",
        });
        if (!result.success || !result.asset) {
          alert(result.error || lt("3D 模型上传失败，请重试", "3D model upload failed. Please try again."));
          return;
        }
        upsertModelAsset(file, result.asset);
      } else {
        const result = await imageUploadService.uploadImageFile(file, {
          dir: "uploads/personal-library/images/",
        });
        if (!result.success || !result.asset) {
          alert(result.error || lt("图片上传失败，请重试", "Image upload failed. Please try again."));
          return;
        }
        upsertImageAsset(file, result.asset);
      }
    } finally {
      setUploading(false);
      resetFileInput();
    }
  };

  const handleDownload = (asset: PersonalLibraryAsset) => {
    try {
      const link = document.createElement("a");
      link.href = asset.url;
      link.download = asset.fileName || asset.name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(asset.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleRemoveAsset = (asset: PersonalLibraryAsset) => {
    if (!confirm(lt(`确定要删除「${asset.name}」吗？`, `Delete "${asset.name}"?`))) {
      return;
    }
    removeAsset(asset.id);
    setSelectedAsset(null);
    void personalLibraryApi.remove(asset.id).catch((error) => {
      console.warn("[LibraryPanel] 删除个人库资源失败:", error);
    });
  };

  const resolveImageFetchCredentials = (input: string): RequestCredentials => {
    const value = typeof input === "string" ? input.trim() : "";
    if (!value) return "omit";
    if (value.startsWith("data:") || value.startsWith("blob:")) return "omit";
    if (
      value.startsWith("/") ||
      value.startsWith("./") ||
      value.startsWith("../")
    )
      return "include";
    if (!/^https?:\/\//i.test(value)) return "include";
    if (typeof window === "undefined") return "omit";

    try {
      const parsed = new URL(value);
      if (parsed.origin === window.location.origin) return "include";

      const apiBase =
        typeof import.meta.env.VITE_API_BASE_URL === "string"
          ? import.meta.env.VITE_API_BASE_URL.trim()
          : "";
      if (apiBase) {
        try {
          const apiOrigin = new URL(apiBase.replace(/\/+$/, "")).origin;
          if (apiOrigin && parsed.origin === apiOrigin) return "include";
        } catch {}
      }
    } catch {}

    return "omit";
  };

  const readDataUrl = async (url: string): Promise<string | null> => {
    try {
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (trimmed.startsWith("data:image/")) return trimmed;
      // 如果是 OSS 公网资源，优先直接返回远程 URL，避免转换为 data URL 占用内存。
      try {
        const parsed = new URL(trimmed);
        if (parsed.hostname.endsWith(".aliyuncs.com")) {
          return trimmed;
        }
      } catch {}

      const fetchUrl = proxifyRemoteAssetUrl(url);
      const response = await fetchWithAuth(fetchUrl, {
        mode: "cors",
        credentials: resolveImageFetchCredentials(fetchUrl),
        auth: "omit",
        allowRefresh: false,
      });
      if (!response.ok) return null;
      const blob = await responseToBlob(response);
      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn("[LibraryPanel] 将远程图片转换为 DataURL 失败:", error);
      return null;
    }
  };

  const handleSendToCanvas = async (asset: PersonalLibraryAsset) => {
    if (!asset.url) {
      alert(lt("资源缺少可用的链接，无法发送到画板", "This asset has no usable URL and cannot be sent to canvas."));
      return;
    }
    if (asset.type === "2d") {
      const inlineData =
        typeof asset.thumbnail === "string" &&
        asset.thumbnail.startsWith("data:")
          ? asset.thumbnail
          : null;
      const dataUrl = inlineData || (await readDataUrl(asset.url));

      const displayFileName = asset.fileName || `${asset.name}.png`;
      const payload: string | StoredImageAsset = dataUrl
        ? dataUrl
        : {
            id: asset.id,
            url: asset.url,
            src: asset.url,
            fileName: displayFileName,
            width: asset.width,
            height: asset.height,
            contentType: asset.contentType,
            localDataUrl: asset.thumbnail,
          };

      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData: payload,
            fileName: displayFileName,
            operationType: "manual",
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("图片已发送到画板", "Image sent to canvas"), type: "success" },
        })
      );
      return;
    }

    if (asset.type === "3d") {
      const modelAsset = asset as PersonalModelAsset;
      const modelData: Model3DData = {
        url: modelAsset.url,
        key: modelAsset.key,
        path: modelAsset.path || modelAsset.url,
        format: modelAsset.format,
        fileName: modelAsset.fileName || modelAsset.name,
        fileSize: modelAsset.fileSize ?? 0,
        defaultScale: modelAsset.defaultScale || { x: 1, y: 1, z: 1 },
        defaultRotation: modelAsset.defaultRotation || { x: 0, y: 0, z: 0 },
        timestamp: modelAsset.updatedAt || Date.now(),
        camera: modelAsset.camera,
      };
      window.dispatchEvent(
        new CustomEvent("canvas:insert-model3d", {
          detail: {
            modelData,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("3D 模型已发送到画板", "3D model sent to canvas"), type: "success" },
        })
      );
    }

    if (asset.type === "svg") {
      const svgAsset = asset as PersonalSvgAsset;
      const displayFileName = svgAsset.fileName || `${svgAsset.name}.svg`;

      window.dispatchEvent(
        new CustomEvent("canvas:insert-svg", {
          detail: {
            fileName: displayFileName,
            asset: {
              id: svgAsset.id,
              url: svgAsset.url,
              svgContent: svgAsset.svgContent,
              width: svgAsset.width,
              height: svgAsset.height,
              name: svgAsset.name,
              fileName: displayFileName,
            },
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: lt("SVG 已发送到画板", "SVG sent to canvas"), type: "success" },
        })
      );
    }
  };

  const handleHistoryDownload = (item: GlobalImageHistoryItem) => {
    try {
      const link = document.createElement("a");
      link.href = item.imageUrl;
      link.download = `history_${item.id}.png`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.open(item.imageUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleRemoveHistoryItem = async (item: GlobalImageHistoryItem) => {
    if (
      !confirm(
        lt(
          `确定要删除这张历史图片吗？`,
          `Delete this history image?`
        )
      )
    ) {
      return;
    }

    try {
      await globalImageHistoryApi.delete(item.id);
      if (activeTab === "project-history") {
        const result = await globalImageHistoryApi.list({
          limit: HISTORY_PAGE_SIZE,
          page: projectHistoryPage,
          sourceType: projectHistoryQueryOptions.sourceType,
          search: projectHistoryQueryOptions.search,
          sourceProjectId: currentProjectId || undefined,
        });
        setProjectHistoryItems(Array.isArray(result.items) ? result.items : []);
        setProjectHistoryTotalCount(result.totalCount ?? result.items.length);
        setProjectHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
        if (
          typeof result.page === "number" &&
          Number.isFinite(result.page) &&
          result.page !== projectHistoryPage
        ) {
          setProjectHistoryPage(Math.max(1, Math.trunc(result.page)));
        }
      } else {
        const result = await globalImageHistoryApi.list({
          limit: HISTORY_PAGE_SIZE,
          page: historyPage,
          sourceType: historyQueryOptions.sourceType,
          search: historyQueryOptions.search,
        });
        setHistoryItems(Array.isArray(result.items) ? result.items : []);
        setHistoryTotalCount(result.totalCount ?? result.items.length);
        setHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
        if (
          typeof result.page === "number" &&
          Number.isFinite(result.page) &&
          result.page !== historyPage
        ) {
          setHistoryPage(Math.max(1, Math.trunc(result.page)));
        }
      }
      setSelectedHistoryItem(null);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt("历史图片已删除", "History image deleted"),
            type: "success",
          },
        })
      );
    } catch (error) {
      console.warn("[LibraryPanel] 删除历史图片失败:", error);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: lt("删除失败，请稍后重试", "Delete failed. Please try again."),
            type: "error",
          },
        })
      );
    }
  };

  const handleHistorySendToCanvas = async (item: GlobalImageHistoryItem) => {
    if (!item.imageUrl) {
      alert(lt("历史图片缺少可用链接，无法发送到画板", "History image has no usable URL and cannot be sent to canvas."));
      return;
    }
    const dataUrl = await readDataUrl(item.imageUrl);
    const displayFileName = `history_${item.id}.png`;
    const payload: string | StoredImageAsset = dataUrl
      ? dataUrl
      : {
          id: item.id,
          url: item.imageUrl,
          src: item.imageUrl,
          fileName: displayFileName,
        };

    window.dispatchEvent(
      new CustomEvent("triggerQuickImageUpload", {
        detail: {
          imageData: payload,
          fileName: displayFileName,
          operationType: "manual",
        },
      })
    );
    window.dispatchEvent(
      new CustomEvent("toast", {
        detail: { message: lt("历史图片已发送到画板", "History image sent to canvas"), type: "success" },
      })
    );
  };

  const handleClose = () => {
    setShowLibraryPanel(false);
    setSelectedAsset(null);
    setSelectedHistoryItem(null);
    setPreviewState(null);
  };

  const openImagePreview = React.useCallback(
    (src: string | undefined | null, title: string) => {
      const normalized = typeof src === "string" ? src.trim() : "";
      if (!normalized) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: lt("当前素材暂无可预览内容", "No preview available for this asset"),
              type: "warning",
            },
          })
        );
        return;
      }
      setPreviewState({ src: normalized, title });
    },
    [lt]
  );

  const getAssetPreviewSrc = React.useCallback((asset: PersonalLibraryAsset) => {
    if (asset.type === "2d" || asset.type === "svg") {
      return asset.thumbnail || asset.url;
    }
    return (asset as PersonalModelAsset).thumbnail || "";
  }, []);

  const handleAssetDoubleClick = React.useCallback(
    (asset: PersonalLibraryAsset) => {
      openImagePreview(
        getAssetPreviewSrc(asset),
        asset.name || lt("素材预览", "Asset Preview")
      );
    },
    [getAssetPreviewSrc, lt, openImagePreview]
  );

  const handleHistoryItemDoubleClick = React.useCallback(
    (item: GlobalImageHistoryItem) => {
      openImagePreview(
        item.imageUrl,
        item.prompt ||
          (activeTab === "project-history"
            ? lt("项目图片预览", "Project Image Preview")
            : lt("历史图片预览", "History Image Preview"))
      );
    },
    [activeTab, lt, openImagePreview]
  );

  const handleHistoryItemClick = (
    item: GlobalImageHistoryItem,
    event: React.MouseEvent
  ) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDetailPosition({ top: rect.top });
    setSelectedHistoryItem(item);
    setSelectedAsset(null);
  };

  const handleAssetClick = (
    asset: PersonalLibraryAsset,
    event: React.MouseEvent
  ) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // 计算详情面板的位置，使其与点击的缩略图对齐
    setDetailPosition({ top: rect.top });
    setSelectedAsset(asset);
    setSelectedHistoryItem(null);
  };

  // 拖拽开始处理
  const handleDragStart = (
    asset: PersonalLibraryAsset,
    event: React.DragEvent
  ) => {
    // 设置拖拽数据
    if (asset.type === "2d") {
      // 2D 图片：设置 URL，DrawingController 会自动处理
      event.dataTransfer.setData("text/uri-list", asset.url);
      event.dataTransfer.setData("text/plain", asset.url);
      event.dataTransfer.setData(
        "application/x-tanva-asset",
        JSON.stringify({
          type: "2d",
          id: asset.id,
          url: asset.url,
          name: asset.name,
          fileName: asset.fileName,
        })
      );
    } else if (asset.type === "3d") {
      // 3D 模型：设置自定义数据
      const modelAsset = asset as PersonalModelAsset;
      event.dataTransfer.setData(
        "application/x-tanva-asset",
        JSON.stringify({
          type: "3d",
          id: modelAsset.id,
          url: modelAsset.url,
          name: modelAsset.name,
          fileName: modelAsset.fileName,
          format: modelAsset.format,
          key: modelAsset.key,
          path: modelAsset.path,
          defaultScale: modelAsset.defaultScale,
          defaultRotation: modelAsset.defaultRotation,
          camera: modelAsset.camera,
          fileSize: modelAsset.fileSize,
          updatedAt: modelAsset.updatedAt,
        })
      );
    } else if (asset.type === "svg") {
      const svgAsset = asset as PersonalSvgAsset;
      event.dataTransfer.setData("text/uri-list", svgAsset.url);
      event.dataTransfer.setData("text/plain", svgAsset.url);
      event.dataTransfer.setData(
        "application/x-tanva-asset",
        JSON.stringify({
          type: "svg",
          id: svgAsset.id,
          url: svgAsset.url,
          name: svgAsset.name,
          fileName: svgAsset.fileName,
          width: svgAsset.width,
          height: svgAsset.height,
          svgContent: svgAsset.svgContent,
        })
      );
    }
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleHistoryDragStart = (
    item: GlobalImageHistoryItem,
    event: React.DragEvent
  ) => {
    event.dataTransfer.setData("text/uri-list", item.imageUrl);
    event.dataTransfer.setData("text/plain", item.imageUrl);
    event.dataTransfer.setData(
      "application/x-tanva-asset",
      JSON.stringify({
        type: "2d",
        id: item.id,
        url: item.imageUrl,
        name: item.prompt || lt("历史图片", "History Image"),
        fileName: `history_${item.id}.png`,
      })
    );
    event.dataTransfer.effectAllowed = "copy";
  };

  // 拖拽结束处理（用于 3D 模型）
  React.useEffect(() => {
    const handleDrop = (event: DragEvent) => {
      const assetData = event.dataTransfer?.getData(
        "application/x-tanva-asset"
      );
      if (!assetData) return;

      try {
        const asset = JSON.parse(assetData);
        if (asset.type === "3d") {
          // 3D 模型需要通过自定义事件处理
          const modelData: Model3DData = {
            url: asset.url,
            key: asset.key,
            path: asset.path || asset.url,
            format: asset.format,
            fileName: asset.fileName || asset.name,
            fileSize: asset.fileSize ?? 0,
            defaultScale: asset.defaultScale || { x: 1, y: 1, z: 1 },
            defaultRotation: asset.defaultRotation || { x: 0, y: 0, z: 0 },
            timestamp: asset.updatedAt || Date.now(),
            camera: asset.camera,
          };
          window.dispatchEvent(
            new CustomEvent("canvas:insert-model3d", {
              detail: { modelData },
            })
          );
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: lt("3D 模型已添加到画板", "3D model added to canvas"), type: "success" },
            })
          );
        }
      } catch (error) {
        console.warn("[LibraryPanel] 解析拖拽数据失败:", error);
      }
    };

    // 监听从画布拖拽到库的事件
    const handleAddToLibrary = (
      event: CustomEvent<{
        type: "2d" | "3d" | "svg";
        url: string;
        name?: string;
        fileName?: string;
        width?: number;
        height?: number;
        contentType?: string;
      }>
    ) => {
      const { type, url, name, fileName, width, height, contentType } =
        event.detail;
      if (!url) return;

      if (type === "2d") {
        const id = createPersonalAssetId("pl2d");
        const imageAsset: PersonalImageAsset = {
          id,
          type: "2d",
          name: name || fileName?.replace(/\.[^/.]+$/, "") || lt("画布图片", "Canvas Image"),
          url,
          thumbnail: url,
          width,
          height,
          fileName: fileName || lt("画布图片.png", "canvas-image.png"),
          contentType: contentType || "image/png",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        addAsset(imageAsset);
        void personalLibraryApi.upsert(imageAsset).catch((error) => {
          console.warn("[LibraryPanel] 同步图片资源到个人库失败:", error);
        });
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: lt("图片已添加到AI资产", "Image added to AI assets"), type: "success" },
          })
        );
        setLibraryDragHovering(false);
      }
    };

    window.addEventListener("drop", handleDrop);
    window.addEventListener(
      "canvas:add-to-library",
      handleAddToLibrary as EventListener
    );
    return () => {
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener(
        "canvas:add-to-library",
        handleAddToLibrary as EventListener
      );
    };
  }, [addAsset]);

  // 点击外部关闭详情面板
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        detailPanelRef.current &&
        !detailPanelRef.current.contains(event.target as Node)
      ) {
        // 检查是否点击的是缩略图
        const target = event.target as HTMLElement;
        if (!target.closest("[data-library-thumbnail]")) {
          setSelectedAsset(null);
          setSelectedHistoryItem(null);
        }
      }
    };

    if (selectedAsset || selectedHistoryItem) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selectedAsset, selectedHistoryItem]);

  // 打开面板时从后端拉取个人库，避免仅依赖 localStorage
  React.useEffect(() => {
    if (!showLibraryPanel) return;
    let cancelled = false;
    void personalLibraryApi
      .list()
      .then((assets) => {
        if (cancelled) return;
        if (Array.isArray(assets) && assets.length) {
          mergeAssets(assets);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[LibraryPanel] 拉取个人库失败:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showLibraryPanel, mergeAssets]);

  React.useEffect(() => {
    setHistoryPage(1);
  }, [historyQueryOptions.search, historyQueryOptions.sourceType]);
  React.useEffect(() => {
    setProjectHistoryPage(1);
  }, [projectHistoryQueryOptions.search, projectHistoryQueryOptions.sourceType]);

  React.useEffect(() => {
    if (!showLibraryPanel || activeTab !== "global-history") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setHistoryIsLoading(true);
      void globalImageHistoryApi
        .list({
          limit: HISTORY_PAGE_SIZE,
          page: historyPage,
          sourceType: historyQueryOptions.sourceType,
          search: historyQueryOptions.search,
        })
        .then((result) => {
          if (cancelled) return;
          setHistoryItems(Array.isArray(result.items) ? result.items : []);
          setHistoryTotalCount(result.totalCount ?? result.items.length);
          setHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
          if (
            typeof result.page === "number" &&
            Number.isFinite(result.page) &&
            result.page !== historyPage
          ) {
            setHistoryPage(Math.max(1, Math.trunc(result.page)));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[LibraryPanel] 拉取全局历史失败:", error);
            setHistoryItems([]);
            setHistoryTotalPages(1);
            setHistoryTotalCount(0);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setHistoryIsLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    showLibraryPanel,
    activeTab,
    historyPage,
    historyQueryOptions.search,
    historyQueryOptions.sourceType,
  ]);

  React.useEffect(() => {
    if (!showLibraryPanel || activeTab !== "project-history") return;
    if (!currentProjectId) {
      setProjectHistoryItems([]);
      setProjectHistoryTotalCount(0);
      setProjectHistoryTotalPages(1);
      setProjectHistoryIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setProjectHistoryIsLoading(true);
      void globalImageHistoryApi
        .list({
          limit: HISTORY_PAGE_SIZE,
          page: projectHistoryPage,
          sourceType: projectHistoryQueryOptions.sourceType,
          search: projectHistoryQueryOptions.search,
          sourceProjectId: currentProjectId,
        })
        .then((result) => {
          if (cancelled) return;
          setProjectHistoryItems(Array.isArray(result.items) ? result.items : []);
          setProjectHistoryTotalCount(result.totalCount ?? result.items.length);
          setProjectHistoryTotalPages(Math.max(1, result.totalPages ?? 1));
          if (
            typeof result.page === "number" &&
            Number.isFinite(result.page) &&
            result.page !== projectHistoryPage
          ) {
            setProjectHistoryPage(Math.max(1, Math.trunc(result.page)));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn("[LibraryPanel] 拉取项目库失败:", error);
            setProjectHistoryItems([]);
            setProjectHistoryTotalPages(1);
            setProjectHistoryTotalCount(0);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setProjectHistoryIsLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    showLibraryPanel,
    activeTab,
    currentProjectId,
    projectHistoryPage,
    projectHistoryQueryOptions.search,
    projectHistoryQueryOptions.sourceType,
  ]);

  React.useEffect(() => {
    if (!selectedHistoryItem) return;
    const sourceItems =
      activeTab === "project-history" ? projectHistoryItems : historyItems;
    if (!sourceItems.some((item) => item.id === selectedHistoryItem.id)) {
      setSelectedHistoryItem(null);
    }
  }, [activeTab, historyItems, projectHistoryItems, selectedHistoryItem]);

  const isProjectHistoryTab = activeTab === "project-history";
  const activeHistoryItems = isProjectHistoryTab
    ? projectHistoryItems
    : historyItems;
  const activeHistoryIsLoading = isProjectHistoryTab
    ? projectHistoryIsLoading
    : historyIsLoading;
  const activeHistoryFilterType = isProjectHistoryTab
    ? projectHistoryFilterType
    : historyFilterType;
  const activeHistorySearchQuery = isProjectHistoryTab
    ? projectHistorySearchQuery
    : historySearchQuery;
  const activeHistoryPage = isProjectHistoryTab ? projectHistoryPage : historyPage;
  const activeHistoryTotalPages = isProjectHistoryTab
    ? projectHistoryTotalPages
    : historyTotalPages;
  const activeHistoryTotalCount = isProjectHistoryTab
    ? projectHistoryTotalCount
    : historyTotalCount;
  const activeHistoryPageSlots = isProjectHistoryTab
    ? projectHistoryPageSlots
    : historyPageSlots;

  // 面板关闭时隐藏
  if (!showLibraryPanel) return null;

  return (
    <>
      {/* 详情面板 - 在库面板左侧弹出 */}
      {activeTab === "manual" && selectedAsset && (
        <div
          ref={detailPanelRef}
          className='fixed right-[336px] w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-[1001] overflow-hidden'
          style={{
            top: detailPosition?.top ?? 100,
            maxHeight: "calc(100vh - 100px)",
          }}
        >
          {/* 预览图 */}
          <div className='w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden'>
            {selectedAsset.type === "2d" || selectedAsset.type === "svg" ? (
              <SmartImage
                src={selectedAsset.thumbnail || selectedAsset.url}
                alt={selectedAsset.name}
                className='w-full h-full object-contain'
              />
            ) : (
              <ModelPreview
                asset={selectedAsset as PersonalModelAsset}
                onThumbnailReady={handleModelThumbnailUpdate}
                large
              />
            )}
          </div>

          {/* 资源信息 */}
          <div className='p-3 space-y-2'>
            {/* 类型标签 */}
            <div className='flex items-center gap-2'>
              {(() => {
                const typeInfo = getTypeLabel(selectedAsset.type);
                return (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeInfo.bgColor}`}
                  >
                    {typeInfo.icon}
                    {typeInfo.label}
                  </span>
                );
              })()}
            </div>

            {/* 名称 */}
            <div>
              <div
                className='text-sm font-medium text-gray-900 truncate'
                title={selectedAsset.name}
              >
                {selectedAsset.name}
              </div>
            </div>

            {/* 尺寸/格式 */}
            {selectedAsset.type === "2d" || selectedAsset.type === "svg" ? (
              <div>
                <div className='text-xs text-gray-500'>{lt("尺寸", "Dimensions")}</div>
                <div className='text-sm text-gray-700'>
                  {(selectedAsset as PersonalImageAsset | PersonalSvgAsset)
                    .width ?? "-"}{" "}
                  ×{" "}
                  {(selectedAsset as PersonalImageAsset | PersonalSvgAsset)
                    .height ?? "-"}
                </div>
              </div>
            ) : (
              <div>
                <div className='text-xs text-gray-500'>{lt("格式", "Format")}</div>
                <div className='text-sm text-gray-700'>
                  {(
                    selectedAsset as PersonalModelAsset
                  ).format?.toUpperCase() ?? "-"}
                </div>
              </div>
            )}

            {/* 文件大小 */}
            <div>
              <div className='text-xs text-gray-500'>{lt("大小", "Size")}</div>
              <div className='text-sm text-gray-700'>
                {formatSize(selectedAsset.fileSize)}
              </div>
            </div>

            {/* 更新时间 */}
            <div>
              <div className='text-xs text-gray-500'>{lt("更新时间", "Updated")}</div>
              <div className='text-sm text-gray-700'>
                {formatDate(selectedAsset.updatedAt)}
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className='p-3 pt-0 flex justify-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => void handleSendToCanvas(selectedAsset)}
              title={lt("发送到画板", "Send to canvas")}
            >
              <Send className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => handleDownload(selectedAsset)}
              title={lt("下载", "Download")}
            >
              <Download className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => handleRemoveAsset(selectedAsset)}
              title={lt("删除", "Delete")}
            >
              <Trash2 className='h-3 w-3' />
            </Button>
          </div>
        </div>
      )}
      {(activeTab === "global-history" || activeTab === "project-history") &&
        selectedHistoryItem && (
        <div
          ref={detailPanelRef}
          className='fixed right-[336px] w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-[1001] overflow-hidden'
          style={{
            top: detailPosition?.top ?? 100,
            maxHeight: "calc(100vh - 100px)",
          }}
        >
          <div className='w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden'>
            <SmartImage
              src={selectedHistoryItem.imageUrl}
              alt={
                selectedHistoryItem.prompt ||
                (activeTab === "project-history"
                  ? lt("项目图片", "Project Image")
                  : lt("历史图片", "History Image"))
              }
              className='w-full h-full object-contain'
            />
          </div>

          <div className='p-3 space-y-2'>
            <div className='flex items-center gap-2'>
              <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700'>
                <ImageIcon className='w-3 h-3' />
                IMG
              </span>
            </div>

            <div>
              <div
                className='text-sm font-medium text-gray-900 truncate'
                title={
                  selectedHistoryItem.prompt ||
                  (activeTab === "project-history"
                    ? lt("项目图片", "Project Image")
                    : lt("历史图片", "History Image"))
                }
              >
                {selectedHistoryItem.prompt ||
                  (activeTab === "project-history"
                    ? lt("项目图片", "Project Image")
                    : lt("历史图片", "History Image"))}
              </div>
            </div>

            <div>
              <div className='text-xs text-gray-500'>{lt("类型", "Type")}</div>
              <div className='text-sm text-gray-700'>
                {getSourceTypeLabel(selectedHistoryItem.sourceType)}
              </div>
            </div>

            <div>
              <div className='text-xs text-gray-500'>
                {lt("来源项目", "Source Project")}
              </div>
              <div
                className='text-sm text-gray-700 truncate'
                title={selectedHistoryItem.sourceProjectName || "-"}
              >
                {selectedHistoryItem.sourceProjectName || "-"}
              </div>
            </div>

            <div>
              <div className='text-xs text-gray-500'>{lt("创建时间", "Created")}</div>
              <div className='text-sm text-gray-700'>
                {formatDate(new Date(selectedHistoryItem.createdAt).getTime())}
              </div>
            </div>
          </div>

          <div className='p-3 pt-0 flex justify-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => void handleHistorySendToCanvas(selectedHistoryItem)}
              title={lt("发送到画板", "Send to canvas")}
            >
              <Send className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => handleHistoryDownload(selectedHistoryItem)}
              title={lt("下载", "Download")}
            >
              <Download className='h-3 w-3' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              onClick={() => void handleRemoveHistoryItem(selectedHistoryItem)}
              title={lt("删除", "Delete")}
            >
              <Trash2 className='h-3 w-3' />
            </Button>
          </div>
        </div>
      )}

      {/* 主面板 */}
      <div
        data-library-drop-zone='true'
        className={`tanva-library-panel fixed top-0 right-0 h-full w-80 bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border-l border-liquid-glass z-[1000] transform transition-transform duration-[50ms] ease-out flex flex-col overflow-hidden ${
          showLibraryPanel ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {isLibraryDragHovering && (
          <div className='pointer-events-none absolute inset-0 z-[1010] flex items-start justify-center px-3 pt-3'>
            <div className='w-full h-24 rounded-xl border-2 border-dashed border-blue-400/80 bg-blue-50/85 text-blue-700 flex items-center justify-center font-medium shadow-[0_10px_30px_rgba(59,130,246,0.15)] backdrop-blur-sm'>
              {lt("松开添加到库", "Release to add to library")}
            </div>
          </div>
        )}
        {/* 面板头部 */}
        <div className='flex items-center justify-between px-4 pt-6 pb-4'>
          <Button
            variant='ghost'
            size='sm'
            className='h-8 w-8 p-0 text-gray-600 hover:text-gray-800 bg-transparent'
            onClick={handleClose}
            title={lt("收起库面板", "Collapse library panel")}
            aria-label={lt("收起库面板", "Collapse library panel")}
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
          <h2 className='text-lg font-semibold text-gray-800'>{lt("库", "Library")}</h2>
        </div>

        {/* 分隔线 */}
        <div className='mx-4 h-px bg-gray-200' />

        {/* 标签切换 */}
        <div className='px-3 pt-3 pb-2'>
          <div className='tanva-library-tabs grid grid-cols-3 gap-2 rounded-xl bg-gray-100 p-1'>
            <button
              type='button'
              className={`tanva-library-tab h-8 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "global-history"
                  ? "tanva-library-tab-active bg-white text-gray-800 shadow-sm"
                  : "tanva-library-tab-inactive text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("global-history")}
            >
              {lt("全局历史", "Global History")}
            </button>
            <button
              type='button'
              className={`tanva-library-tab h-8 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "project-history"
                  ? "tanva-library-tab-active bg-white text-gray-800 shadow-sm"
                  : "tanva-library-tab-inactive text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("project-history")}
            >
              {lt("项目库", "Project Library")}
            </button>
            <button
              type='button'
              className={`tanva-library-tab h-8 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "manual"
                  ? "tanva-library-tab-active bg-white text-gray-800 shadow-sm"
                  : "tanva-library-tab-inactive text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setActiveTab("manual")}
            >
              {lt("个人素材", "Personal Assets")}
            </button>
          </div>
        </div>

        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type='file'
          accept='image/png,image/jpeg,image/jpg,image/gif,image/webp,.glb,.gltf'
          onChange={handleUploadFiles}
          style={{ display: "none" }}
        />

        {/* 资源网格 */}
        <div className='flex-1 min-h-0 overflow-y-auto'>
          {activeTab === "manual" ? (
            <div className='p-3'>
              <div className='grid grid-cols-3 gap-2'>
                {/* 资源列表 */}
                {allAssets.map((asset) => {
                  const is2dOrSvg = asset.type === "2d" || asset.type === "svg";
                  const isSelected = selectedAsset?.id === asset.id;
                  const typeLabel =
                    asset.type === "2d"
                      ? "IMG"
                      : asset.type === "3d"
                      ? "3D"
                      : "SVG";

                  return (
                    <div
                      key={asset.id}
                      data-library-thumbnail
                      draggable
                      className={`aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-grab transition-all hover:ring-2 hover:ring-blue-400 active:cursor-grabbing relative ${
                        isSelected ? "ring-2 ring-blue-500" : ""
                      }`}
                      onClick={(e) => handleAssetClick(asset, e)}
                      onDoubleClick={() => handleAssetDoubleClick(asset)}
                      onDragStart={(e) => handleDragStart(asset, e)}
                    >
                      {is2dOrSvg ? (
                        <SmartImage
                          src={asset.thumbnail || asset.url}
                          alt={asset.name}
                          className='w-full h-full object-cover'
                          draggable={false}
                        />
                      ) : (
                        <ModelPreview
                          asset={asset as PersonalModelAsset}
                          onThumbnailReady={handleModelThumbnailUpdate}
                        />
                      )}
                      {/* 类型标签 */}
                      <div className='absolute bottom-1 right-1 px-1 py-0.5 bg-black/60 text-white text-[8px] font-medium rounded'>
                        {typeLabel}
                      </div>
                    </div>
                  );
                })}

                {/* 上传按钮方格 - 放在最后 */}
                <div
                  className='tanva-library-upload-tile aspect-square rounded-lg overflow-hidden bg-gray-50 border border-gray-200 cursor-pointer transition-all hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center'
                  onClick={triggerUpload}
                >
                  {isUploading ? (
                    <div className='text-gray-400 text-xs'>{lt("上传中...", "Uploading...")}</div>
                  ) : (
                    <Plus className='w-8 h-8 text-gray-400' />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className='p-3 space-y-3'>
              <div className='flex gap-2'>
                <div className='relative flex-1'>
                  <Search className='pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400' />
                  <input
                    type='text'
                    value={activeHistorySearchQuery}
                    onChange={(event) => {
                      if (isProjectHistoryTab) {
                        setProjectHistorySearchQuery(event.target.value);
                        return;
                      }
                      setHistorySearchQuery(event.target.value);
                    }}
                    placeholder={lt("搜索 prompt...", "Search prompt...")}
                    className='tanva-library-search-input w-full h-8 rounded-lg border border-gray-200 bg-white pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400'
                  />
                </div>
                <select
                  value={activeHistoryFilterType}
                  onChange={(event) => {
                    if (isProjectHistoryTab) {
                      setProjectHistoryFilterType(event.target.value);
                      return;
                    }
                    setHistoryFilterType(event.target.value);
                  }}
                  className='tanva-library-filter-select h-8 max-w-[108px] rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400'
                >
                  <option value=''>{lt("全部类型", "All types")}</option>
                  {Object.keys(SOURCE_TYPE_LABELS).map((key) => (
                    <option key={key} value={key}>
                      {getSourceTypeLabel(key)}
                    </option>
                  ))}
                </select>
              </div>

              {!currentProjectId && isProjectHistoryTab ? (
                <div className='rounded-lg border border-dashed border-gray-200 bg-white/70 py-10 text-center text-xs text-gray-500'>
                  {lt("当前项目未就绪", "Current project is not ready")}
                </div>
              ) : activeHistoryItems.length === 0 && !activeHistoryIsLoading ? (
                <div className='rounded-lg border border-dashed border-gray-200 bg-white/70 py-10 text-center text-xs text-gray-500'>
                  {isProjectHistoryTab
                    ? lt("暂无项目库记录", "No project library records")
                    : lt("暂无全局历史", "No global history")}
                </div>
              ) : (
                <div className='grid grid-cols-2 gap-2'>
                  {activeHistoryItems.map((item) => (
                    <div
                      key={item.id}
                      data-library-thumbnail
                      draggable
                      className='aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-grab transition-all hover:ring-2 hover:ring-blue-400 active:cursor-grabbing relative'
                      onClick={(event) => handleHistoryItemClick(item, event)}
                      onDoubleClick={() => handleHistoryItemDoubleClick(item)}
                      onDragStart={(event) => handleHistoryDragStart(item, event)}
                      title={
                        item.prompt ||
                        (isProjectHistoryTab
                          ? lt("项目图片", "Project Image")
                          : lt("历史图片", "History Image"))
                      }
                    >
                      <SmartImage
                        src={item.imageUrl}
                        alt={
                          item.prompt ||
                          (isProjectHistoryTab
                            ? lt("项目图片", "Project Image")
                            : lt("历史图片", "History Image"))
                        }
                        className='w-full h-full object-cover'
                        draggable={false}
                        loading='lazy'
                      />
                      <div className='absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent flex items-center justify-between text-[10px] text-white'>
                        <span>{formatHistoryDate(item.createdAt, locale)}</span>
                        <span className='px-1 py-0.5 rounded bg-white/25 truncate max-w-[70px] text-right'>
                          {getSourceTypeLabel(item.sourceType)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeHistoryIsLoading ? (
                <div className='flex items-center justify-center gap-1 text-xs text-gray-500 py-1'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  {lt("加载中...", "Loading...")}
                </div>
              ) : null}

              {activeHistoryTotalPages > 1 ? (
                <div className='flex items-center justify-center gap-1'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    disabled={activeHistoryIsLoading || activeHistoryPage <= 1}
                    onClick={() => {
                      if (isProjectHistoryTab) {
                        setProjectHistoryPage((prev) => Math.max(1, prev - 1));
                        return;
                      }
                      setHistoryPage((prev) => Math.max(1, prev - 1));
                    }}
                    aria-label={lt("上一页", "Previous page")}
                    title={lt("上一页", "Previous page")}
                  >
                    <ChevronLeft className='h-3.5 w-3.5' />
                  </Button>
                  {activeHistoryPageSlots.map((slot, index) =>
                    typeof slot === "number" ? (
                      <button
                        key={`page-${slot}`}
                        type='button'
                        className={`h-7 min-w-7 px-1 rounded text-xs border transition-colors ${
                          activeHistoryPage === slot
                            ? "bg-gray-900 border-gray-900 text-white"
                            : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                        onClick={() => {
                          if (isProjectHistoryTab) {
                            setProjectHistoryPage(slot);
                            return;
                          }
                          setHistoryPage(slot);
                        }}
                      >
                        {slot}
                      </button>
                    ) : (
                      <span
                        key={`${slot}-${index}`}
                        className='h-7 min-w-7 inline-flex items-center justify-center text-xs text-gray-400'
                      >
                        ...
                      </span>
                    )
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    disabled={
                      activeHistoryIsLoading ||
                      activeHistoryPage >= activeHistoryTotalPages
                    }
                    onClick={() => {
                      if (isProjectHistoryTab) {
                        setProjectHistoryPage((prev) =>
                          Math.min(activeHistoryTotalPages, prev + 1)
                        );
                        return;
                      }
                      setHistoryPage((prev) =>
                        Math.min(activeHistoryTotalPages, prev + 1)
                      );
                    }}
                    aria-label={lt("下一页", "Next page")}
                    title={lt("下一页", "Next page")}
                  >
                    <ChevronRight className='h-3.5 w-3.5' />
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 面板底部 */}
        <div className='tanva-library-footer p-3 bg-white/80 backdrop-blur-sm border-t border-white/40'>
          <div className='text-xs text-gray-500 text-center'>
            {activeTab === "manual"
              ? lt(`共 ${allAssets.length} 个资源`, `${allAssets.length} assets`)
              : lt(
                  `第 ${activeHistoryPage}/${activeHistoryTotalPages} 页 · 共 ${activeHistoryTotalCount} 条`,
                  `Page ${activeHistoryPage}/${activeHistoryTotalPages} · ${activeHistoryTotalCount} items`
                )}
          </div>
        </div>
      </div>
      <ImagePreviewModal
        isOpen={Boolean(previewState)}
        imageSrc={previewState?.src || ""}
        imageTitle={previewState?.title}
        onClose={() => setPreviewState(null)}
      />
    </>
  );
};

// 3D 模型预览组件
interface ModelPreviewProps {
  asset: PersonalModelAsset;
  onThumbnailReady: (id: string, thumbnail: string) => void;
  large?: boolean;
}

const ModelPreview: React.FC<ModelPreviewProps> = ({
  asset,
  onThumbnailReady,
  large,
}) => {
  const { lt } = useLocaleText();
  const [previewSrc, setPreviewSrc] = React.useState<string | null>(
    asset.thumbnail ?? null
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const requestStartedRef = React.useRef(false);

  React.useEffect(() => {
    setPreviewSrc(asset.thumbnail ?? null);
  }, [asset.thumbnail]);

  React.useEffect(() => {
    if (asset.thumbnail || !asset.url || requestStartedRef.current) {
      return;
    }
    let cancelled = false;
    requestStartedRef.current = true;
    setIsLoading(true);
    model3DPreviewService
      .generatePreviewAndUpload(asset.url)
      .then((thumbnailUrl) => {
        if (cancelled) return;
        if (thumbnailUrl) {
          setPreviewSrc(thumbnailUrl);
          onThumbnailReady(asset.id, thumbnailUrl);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[LibraryPanel] 3D 预览生成失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.thumbnail, asset.url, onThumbnailReady]);

  if (previewSrc) {
    return (
      <SmartImage
        src={previewSrc}
        alt={`${asset.name} ${lt("预览", "Preview")}`}
        className={`w-full h-full ${large ? "object-contain" : "object-cover"}`}
        draggable={false}
      />
    );
  }

  return (
    <div className='w-full h-full bg-gradient-to-br from-purple-500 to-indigo-600 flex flex-col items-center justify-center text-white'>
      <Box className={large ? "w-8 h-8" : "w-4 h-4"} />
      {isLoading && (
        <div className={`mt-1 ${large ? "text-xs" : "text-[8px]"}`}>{lt("加载中", "Loading")}</div>
      )}
    </div>
  );
};

export default LibraryPanel;
