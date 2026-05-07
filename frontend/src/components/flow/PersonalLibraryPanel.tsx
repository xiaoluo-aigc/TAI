import React from "react";
import {
  Download,
  Image as ImageIcon,
  Trash2,
  Upload,
  Box,
  Send,
  FileCode,
} from "lucide-react";
import "./PersonalLibraryPanel.css";
import SmartImage from "@/components/ui/SmartImage";
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
import type { StoredImageAsset } from "@/types/canvas";
import { useLocaleText } from "@/utils/localeText";

interface PersonalLibraryPanelProps {
  padding?: string | number;
}

const formatSize = (bytes?: number): string => {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const PersonalLibraryPanel: React.FC<PersonalLibraryPanelProps> = ({
  padding = "12px 18px 18px",
}) => {
  const { lt } = useLocaleText();
  const [activeType, setActiveType] = React.useState<PersonalAssetType>("2d");
  const [isUploading, setUploading] = React.useState(false);
  const addAsset = usePersonalLibraryStore((state) => state.addAsset);
  const removeAsset = usePersonalLibraryStore((state) => state.removeAsset);
  const updateAsset = usePersonalLibraryStore((state) => state.updateAsset);
  const mergeAssets = usePersonalLibraryStore((state) => state.mergeAssets);
  const allAssets = usePersonalLibraryStore((state) => state.assets);
  const assets = React.useMemo(
    () => allAssets.filter((item) => item.type === activeType),
    [allAssets, activeType]
  );
  const fileInputRef = React.useRef<HTMLInputElement>(null);
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
            console.warn("[PersonalLibrary] 同步 3D 缩略图到后端失败:", error);
          });
      }
    },
    [updateAsset]
  );

  // 进入面板时从后端拉取个人库，避免仅依赖 localStorage
  React.useEffect(() => {
    let cancelled = false;
    void personalLibraryApi
      .list()
      .then((remoteAssets) => {
        if (cancelled) return;
        if (Array.isArray(remoteAssets) && remoteAssets.length) {
          mergeAssets(remoteAssets);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[PersonalLibrary] 拉取个人库失败:", error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mergeAssets]);

  const accept =
    activeType === "2d"
      ? "image/png,image/jpeg,image/jpg,image/gif,image/webp"
      : activeType === "3d"
      ? ".glb,.gltf"
      : "";
  const typeTabs = React.useMemo(
    () => [
      { value: "2d" as const, label: lt("2D 图库", "2D Library") },
      { value: "3d" as const, label: lt("3D 模型", "3D Models") },
      { value: "svg" as const, label: lt("SVG 线条", "SVG Paths") },
    ],
    [lt]
  );
  const uploadLabel =
    activeType === "2d"
      ? lt("上传图片", "Upload Image")
      : activeType === "3d"
      ? lt("上传 3D 模型", "Upload 3D Model")
      : "";
  const showUploadButton = activeType !== "svg";

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
          file.name.replace(/\.[^/.]+$/, "") ||
          asset.fileName ||
          lt("未命名图片", "Untitled Image"),
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
        console.warn("[PersonalLibrary] 同步图片资源到后端失败:", error);
      });
    },
    [addAsset, lt]
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
          file.name.replace(/\.[^/.]+$/, "") ||
          asset.fileName ||
          lt("未命名模型", "Untitled Model"),
        url: asset.url,
        fileName: asset.fileName ?? file.name,
        fileSize: asset.fileSize ?? file.size,
        contentType: asset.contentType ?? file.type,
        format: asset.format,
        createdAt: now,
        updatedAt: now,
      };
      addAsset(modelAsset);
      if (asset.url) {
        void model3DPreviewService
          .generatePreviewAndUpload(asset.url)
          .then((thumbnail) => {
            if (thumbnail) {
              handleModelThumbnailUpdate(id, thumbnail);
            }
          })
          .catch((error) => {
            console.warn("[PersonalLibrary] 3D 预览生成失败:", error);
          });
      }
      void personalLibraryApi.upsert(modelAsset).catch((error) => {
        console.warn("[PersonalLibrary] 同步 3D 资源到后端失败:", error);
      });
    },
    [addAsset, handleModelThumbnailUpdate, lt]
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
      if (activeType === "2d") {
        const result = await imageUploadService.uploadImageFile(file, {
          dir: "uploads/personal-library/images/",
        });
        if (!result.success || !result.asset) {
          alert(result.error || lt("图片上传失败，请重试", "Image upload failed. Please try again."));
          return;
        }
        upsertImageAsset(file, result.asset);
      } else {
        const result = await model3DUploadService.uploadModelFile(file, {
          dir: "uploads/personal-library/models/",
        });
        if (!result.success || !result.asset) {
          alert(result.error || lt("3D 模型上传失败，请重试", "3D model upload failed. Please try again."));
          return;
        }
        upsertModelAsset(file, result.asset);
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
    void personalLibraryApi.remove(asset.id).catch((error) => {
      console.warn("[PersonalLibrary] 删除个人库资源失败:", error);
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
      console.warn("[PersonalLibrary] 将远程图片转换为 DataURL 失败:", error);
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

  return (
    <div
      style={{
        height: "min(70vh, 640px)",
        overflowY: "auto",
        overflowX: "hidden",
        padding,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
            {lt("AI资产", "AI Assets")}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            {lt(
              "支持上传 2D 图片与 3D 模型，随时复用与下载",
              "Upload 2D images and 3D models for quick reuse and download"
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {showUploadButton && (
            <button
              onClick={triggerUpload}
              disabled={isUploading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid #c7d2fe",
                background: isUploading ? "#e0e7ff" : "#eef2ff",
                color: "#4338ca",
                fontSize: 12,
                fontWeight: 600,
                cursor: isUploading ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <Upload size={16} strokeWidth={2} />
              {isUploading ? lt("上传中…", "Uploading...") : uploadLabel}
            </button>
          )}
          <input
            ref={fileInputRef}
            type='file'
            accept={accept}
            onChange={handleUploadFiles}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* 分隔线 */}
      <div style={{ height: 1, background: "#e5e7eb", marginBottom: 16 }} />

      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}
      >
        {typeTabs.map((tab) => {
          const isActive = tab.value === activeType;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveType(tab.value)}
              style={{
                padding: "6px 16px",
                borderRadius: 999,
                border: "1px solid " + (isActive ? "#0ea5e9" : "#e5e7eb"),
                background: isActive ? "#0ea5e9" : "#fff",
                color: isActive ? "#fff" : "#374151",
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: isActive
                  ? "0 10px 18px rgba(14, 165, 233, 0.25)"
                  : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {assets.length === 0 ? (
        <div
          style={{
            border: "1px dashed #cbd5f5",
            borderRadius: 16,
            padding: 36,
            textAlign: "center",
            color: "#6b7280",
            background: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {activeType === "2d"
              ? lt("暂未上传图片", "No images uploaded yet")
              : activeType === "3d"
              ? lt("暂未上传 3D 模型", "No 3D models uploaded yet")
              : lt("暂无 SVG 线条", "No SVG assets yet")}
          </div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {activeType === "svg"
              ? lt(
                  "在画布上选中线条后，右键选择「添加到库」即可保存",
                  'Select paths on canvas, then right-click and choose "Add to Library"'
                )
              : lt("点击右上角上传按钮即可添加资源", "Click the upload button on the top right to add assets")}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              assets.length <= 1
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 20,
            justifyContent: "flex-start",
          }}
        >
          {assets.map((asset) => {
            const is2d = asset.type === "2d";
            const isSvg = asset.type === "svg";
            const is3d = asset.type === "3d";
            return (
              <div
                key={asset.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  background: "#fff",
                  padding: 16,
                  paddingBottom: 64,
                  display: "flex",
                  gap: 14,
                  minHeight: 150,
                  position: "relative",
                  overflow: "hidden",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    flex: "0 0 44%",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: is2d || isSvg ? "#f3f4f6" : "#0f172a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                  }}
                >
                  {is2d || isSvg ? (
                    <SmartImage
                      src={asset.thumbnail || asset.url}
                      alt={asset.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <ModelAssetPreview
                      asset={asset as PersonalModelAsset}
                      onThumbnailReady={handleModelThumbnailUpdate}
                    />
                  )}
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    overflow: "hidden",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "#111827",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={asset.name}
                    >
                      {asset.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6b7280",
                        marginTop: 4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={asset.fileName}
                    >
                      {asset.fileName}
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}
                    >
                      {is2d
                        ? `${(asset as PersonalImageAsset).width ?? "-"} × ${
                            (asset as PersonalImageAsset).height ?? "-"
                          }`
                        : isSvg
                        ? `${(asset as PersonalSvgAsset).width ?? "-"} × ${
                            (asset as PersonalSvgAsset).height ?? "-"
                          }`
                        : (asset as PersonalModelAsset).format?.toUpperCase()}
                      {" · "}
                      {formatSize(asset.fileSize)}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}
                    >
                      {lt("更新时间：", "Updated: ")}
                      {formatDate(asset.updatedAt)}
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      right: 16,
                      bottom: 16,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <button
                      type='button'
                      onClick={() => void handleSendToCanvas(asset)}
                      title={lt("发送到画布", "Send to canvas")}
                      className='personal-library-action-button personal-library-action-button--send'
                    >
                      <Send size={16} strokeWidth={2} />
                    </button>
                    <button
                      type='button'
                      onClick={() => handleDownload(asset)}
                      title={lt("下载", "Download")}
                      className='personal-library-action-button personal-library-action-button--download'
                    >
                      <Download size={16} strokeWidth={2} />
                    </button>
                    <button
                      type='button'
                      onClick={() => handleRemoveAsset(asset)}
                      className='personal-library-action-button personal-library-action-button--delete'
                      title={lt("删除资源", "Delete asset")}
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  </div>
                </div>
                {is3d && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      background: "rgba(255,255,255,0.85)",
                      color: "#0f172a",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Box size={12} />
                    3D
                  </div>
                )}
                {is2d && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      background: "rgba(255,255,255,0.85)",
                      color: "#0f172a",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <ImageIcon size={12} />
                    IMG
                  </div>
                )}
                {isSvg && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      background: "rgba(255,255,255,0.85)",
                      color: "#0f172a",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <FileCode size={12} />
                    SVG
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PersonalLibraryPanel;

interface ModelAssetPreviewProps {
  asset: PersonalModelAsset;
  onThumbnailReady: (id: string, thumbnail: string) => void;
}

const ModelAssetPreview: React.FC<ModelAssetPreviewProps> = ({
  asset,
  onThumbnailReady,
}) => {
  const { lt } = useLocaleText();
  const [previewSrc, setPreviewSrc] = React.useState<string | null>(
    asset.thumbnail ?? null
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const [hasFailed, setHasFailed] = React.useState(false);
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
    setHasFailed(false);
    model3DPreviewService
      .generatePreviewAndUpload(asset.url)
      .then((thumbnailUrl) => {
        if (cancelled) return;
        if (!thumbnailUrl) {
          setHasFailed(true);
          return;
        }
        setPreviewSrc(thumbnailUrl);
        onThumbnailReady(asset.id, thumbnailUrl);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[PersonalLibrary] 3D 预览生成失败:", error);
        setHasFailed(true);
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
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        padding: 12,
        gap: 6,
        textAlign: "center",
      }}
    >
      <Box size={24} />
      <div style={{ fontSize: 12, opacity: 0.85 }}>
        {asset.format?.toUpperCase() || "3D"}
      </div>
      {isLoading && (
        <div style={{ fontSize: 11, opacity: 0.9 }}>
          {lt("预览生成中…", "Preview generating...")}
        </div>
      )}
      {hasFailed && !isLoading && (
        <div style={{ fontSize: 11, opacity: 0.75 }}>
          {lt("无法生成预览", "Preview unavailable")}
        </div>
      )}
    </div>
  );
};
