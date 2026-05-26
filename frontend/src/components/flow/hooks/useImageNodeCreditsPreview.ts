import React from "react";
import { useBackendCreditsPreview } from "./useBackendCreditsPreview";

type ImageNodeType =
  | "generate"
  | "generatePro"
  | "generateRef"
  | "analysis"
  | "seedream5"
  | "nano2"
  | "gptImage2"
  | "midjourney"
  | "midjourneyV7"
  | "niji7";

type Params = {
  nodeType: ImageNodeType;
  aiProvider?: string | null;
  bananaImageRoute?: string | null;
  imageSize?: string | null;
  aspectRatio?: string | null;
  outputImageCount?: number;
  referenceImageCount?: number;
  managedModelKey?: string | null;
  vendorKey?: string | null;
  platformKey?: string | null;
  enabled?: boolean;
};

const normalizeProvider = (value?: string | null): string => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "gemini-pro") return "banana";
  return normalized;
};

const normalizeBananaImageSize = (value?: string | null): string | undefined => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (
    normalized === "0.5K" ||
    normalized === "1K" ||
    normalized === "2K" ||
    normalized === "4K"
  ) {
    return normalized;
  }
  return undefined;
};

const normalizeSeedreamSize = (value?: string | null): string | undefined => {
  const raw = String(value || "").trim();
  if (!raw) return "2K";
  const compact = raw.replace(/\s+/g, "");
  const upper = compact.toUpperCase();
  if (upper === "2K" || upper === "3K" || upper === "4K" || upper === "1K") {
    return upper;
  }
  const match = compact.match(/^(\d{3,5})[xX](\d{3,5})$/);
  if (!match) return "2K";
  const width = Number(match[1]);
  const height = Number(match[2]);
  const maxEdge = Math.max(width, height);
  if (maxEdge >= 3800) return "4K";
  return "2K";
};

const resolveBananaServiceType = (
  provider: string,
  mode: "generate" | "blend" | "analysis",
  nodeType?: ImageNodeType
): string => {
  if (mode === "analysis") {
    if (provider === "banana-2.5") return "gemini-2.5-image-analyze";
    if (provider === "banana-3.1" || provider === "nano2") {
      return "gemini-3.1-image-analyze";
    }
    return "gemini-image-analyze";
  }

  if (mode === "blend") {
    if (provider === "banana-2.5") return "gemini-2.5-image-blend";
    if (provider === "banana-3.1" || provider === "nano2") {
      return "gemini-3.1-image-blend";
    }
    return "gemini-image-blend";
  }

  if (nodeType === "generatePro") {
    if (provider === "banana-2.5") return "gemini-2.5-image";
    if (provider === "banana-3.1" || provider === "nano2") return "gemini-3.1-image";
    return "gemini-3-pro-image";
  }

  if (provider === "banana-2.5") return "gemini-2.5-image";
  if (provider === "banana-3.1" || provider === "nano2") {
    return "gemini-3.1-image";
  }
  return "gemini-3-pro-image";
};

const resolveManagedModelKey = (
  nodeType: ImageNodeType,
  provider: string,
  managedModelKey?: string | null
): string => {
  const explicit = String(managedModelKey || "").trim();
  if (explicit) return explicit;
  if (nodeType === "seedream5") return "seedream5";
  if (
    nodeType === "midjourney" ||
    nodeType === "midjourneyV7" ||
    nodeType === "niji7"
  ) {
    return "midjourney";
  }
  if (nodeType === "generateRef") {
    return resolveBananaServiceType(provider, "blend");
  }
  if (nodeType === "analysis") {
    return resolveBananaServiceType(provider, "analysis");
  }
  return resolveBananaServiceType(provider, "generate");
};

export const useImageNodeCreditsPreview = ({
  nodeType,
  aiProvider,
  bananaImageRoute,
  imageSize,
  aspectRatio,
  outputImageCount,
  referenceImageCount,
  managedModelKey,
  vendorKey,
  platformKey,
  enabled = true,
}: Params) => {
  const previewConfig = React.useMemo(() => {
    const provider = normalizeProvider(aiProvider);
    const safeReferenceCount =
      typeof referenceImageCount === "number" && Number.isFinite(referenceImageCount)
        ? Math.max(0, Math.round(referenceImageCount))
        : 0;
    const safeAspectRatio =
      typeof aspectRatio === "string" && aspectRatio.trim().length > 0
        ? aspectRatio.trim()
        : undefined;

    if (nodeType === "seedream5") {
      const modelKey = resolveManagedModelKey(nodeType, provider, managedModelKey);
      return {
        serviceType: "doubao-seedream-5-0-260128",
        model: "doubao-seedream-5-0-260128",
        requestParams: {
          aiProvider: "seedream5",
          imageSize: normalizeSeedreamSize(imageSize),
          referenceImageCount: safeReferenceCount,
          modelKey,
          managedModelKey: modelKey,
          vendorKey: vendorKey || undefined,
          platformKey: platformKey || undefined,
        },
      };
    }

    if (
      nodeType === "midjourney" ||
      nodeType === "midjourneyV7" ||
      nodeType === "niji7"
    ) {
      const modelKey = resolveManagedModelKey(nodeType, "midjourney", managedModelKey);
      return {
        serviceType: "midjourney-imagine",
        model: nodeType === "niji7" ? "midjourney-niji-7" : "midjourney-v7",
        requestParams: {
          aiProvider: "midjourney",
          aspectRatio: safeAspectRatio,
          referenceImageCount: safeReferenceCount,
          modelKey,
          managedModelKey: modelKey,
          vendorKey: vendorKey || undefined,
          platformKey: platformKey || undefined,
        },
      };
    }

    const mode =
      nodeType === "generateRef"
        ? "blend"
        : nodeType === "analysis"
        ? "analysis"
        : "generate";
    const serviceType = resolveBananaServiceType(provider, mode, nodeType);
    const modelKey = resolveManagedModelKey(nodeType, provider, managedModelKey);
    const normalizedImageSize = normalizeBananaImageSize(imageSize);

    return {
      serviceType,
      model:
        serviceType === "gemini-2.5-image" ||
        serviceType === "gemini-2.5-image-blend" ||
        serviceType === "gemini-2.5-image-analyze"
          ? "gemini-2.5-flash-image-preview"
          : serviceType === "gemini-3.1-image" ||
            serviceType === "gemini-3.1-image-blend" ||
            serviceType === "gemini-3.1-image-analyze"
          ? "gemini-3.1-flash-image-preview"
          : "gemini-3-flash-preview",
      requestParams: {
        aiProvider: provider,
        imageSize: normalizedImageSize,
        aspectRatio: safeAspectRatio,
        referenceImageCount: safeReferenceCount,
        bananaImageRoute: bananaImageRoute || undefined,
        providerOptions: {
          banana: {
            imageRoute: bananaImageRoute || undefined,
          },
        },
        ...(nodeType === "analysis"
          ? {}
          : {
              modelKey,
              managedModelKey: modelKey,
              vendorKey: vendorKey || undefined,
              platformKey: platformKey || undefined,
            }),
      },
    };
  }, [
    aiProvider,
    aspectRatio,
    bananaImageRoute,
    imageSize,
    managedModelKey,
    nodeType,
    platformKey,
    referenceImageCount,
    vendorKey,
  ]);

  return useBackendCreditsPreview({
    serviceType: previewConfig.serviceType,
    model: previewConfig.model,
    requestParams: previewConfig.requestParams,
    outputImageCount,
    enabled,
  });
};
