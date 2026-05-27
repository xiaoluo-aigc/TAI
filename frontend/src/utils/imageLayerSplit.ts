export type LayerSplitLabel =
  | "text-layer"
  | "textless-image"
  | "subject-layer"
  | "background-layer";

export type LayerSplitOutput = {
  label: LayerSplitLabel;
  imageData: string;
};

export type SplitImageDeps = {
  analyzeImage: (args: {
    prompt: string;
    sourceImage: string;
    aiProvider: string;
    model: string;
    providerOptions?: Record<string, unknown>;
  }) => Promise<{
    success: boolean;
    data?: { analysis?: string };
    error?: { message?: string };
  }>;
  editImage: (args: {
    prompt: string;
    sourceImage: string;
    model: string;
    aiProvider: string;
    outputFormat: "png";
    imageOnly: true;
  }) => Promise<{
    success: boolean;
    data?: { imageData?: string };
    error?: { message?: string };
  }>;
  removeBackground: (
    imageDataUrl: string,
    mime: string,
    refine: boolean
  ) => Promise<{
    success: boolean;
    imageData?: string;
    error?: string;
  }>;
  getImageModelForProvider: (provider: string) => string;
  textRecognitionProviderOptions?: Record<string, unknown>;
  log?: (...args: unknown[]) => void;
};

const TEXT_RECOGNITION_PROMPT =
  '请识别图片中所有可见文字，并仅返回 JSON 数组，例如：["文字1","文字2"]。不要返回其他解释。';
const TEXT_EDIT_PROVIDER = "banana";
const TEXT_EDIT_MODEL = "gemini-2.5-flash-image";
const BG_REMOVAL_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image-preview",
] as const;

export function ensureDataUrlString(
  imageData: string,
  mime: string = "image/png"
): string {
  if (!imageData) return "";
  return imageData.startsWith("data:image")
    ? imageData
    : `data:${mime};base64,${imageData}`;
}

function dedupeTexts(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function parseRecognizedTexts(analysis: string): string[] {
  const normalized = analysis.trim();
  if (!normalized) return [];

  const parseJsonTexts = (raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
      if (parsed && typeof parsed === "object") {
        const maybeTexts = (parsed as { texts?: unknown }).texts;
        if (Array.isArray(maybeTexts)) {
          return maybeTexts.filter(
            (item): item is string => typeof item === "string"
          );
        }
      }
    } catch {}
    return [];
  };

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const fromJson = dedupeTexts([
    ...parseJsonTexts(fenced ?? ""),
    ...parseJsonTexts(normalized),
  ]);
  if (fromJson.length > 0) return fromJson.slice(0, 20);

  const lines = normalized
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[\s\-*•\d.)["'`]+/, "")
        .replace(/[\]"'`]+$/, "")
        .trim()
    )
    .filter(Boolean);

  return dedupeTexts(lines).slice(0, 20);
}

async function detectImageText(
  baseImage: string,
  deps: SplitImageDeps
): Promise<string[]> {
  const model = deps.getImageModelForProvider(TEXT_EDIT_PROVIDER);
  const result = await deps.analyzeImage({
    prompt: TEXT_RECOGNITION_PROMPT,
    sourceImage: baseImage,
    aiProvider: TEXT_EDIT_PROVIDER,
    model,
    providerOptions: deps.textRecognitionProviderOptions,
  });

  if (!result.success || !result.data?.analysis) {
    throw new Error(result.error?.message || "文字识别失败");
  }

  return parseRecognizedTexts(result.data.analysis);
}

async function extractTextLayer(
  baseImage: string,
  deps: SplitImageDeps
): Promise<string> {
  const result = await deps.editImage({
    prompt: "提取出来图中的文字，保留文字和文字本身的颜色样式，图形都不要，背景留白色。",
    sourceImage: baseImage,
    model: TEXT_EDIT_MODEL,
    aiProvider: TEXT_EDIT_PROVIDER,
    outputFormat: "png",
    imageOnly: true,
  });

  if (!result.success || !result.data?.imageData) {
    throw new Error(result.error?.message || "文字层提取失败");
  }

  return ensureDataUrlString(result.data.imageData, "image/png");
}

async function removeTextLayer(
  baseImage: string,
  deps: SplitImageDeps
): Promise<string> {
  const result = await deps.editImage({
    prompt: "去掉画面中的所有文字与文字相关图形元素，保留主体、背景、构图、颜色和光影不变，并自然补全被遮挡的区域。",
    sourceImage: baseImage,
    model: TEXT_EDIT_MODEL,
    aiProvider: TEXT_EDIT_PROVIDER,
    outputFormat: "png",
    imageOnly: true,
  });

  if (!result.success || !result.data?.imageData) {
    throw new Error(result.error?.message || "去文字处理失败");
  }

  return ensureDataUrlString(result.data.imageData, "image/png");
}

async function extractBackgroundLayer(
  baseImage: string,
  deps: SplitImageDeps
): Promise<string> {
  const result = await deps.editImage({
    prompt: "去掉画面中的主体，只保留背景。保持背景内容、颜色、光影和风格不变，并自然补全被遮挡的区域。",
    sourceImage: baseImage,
    model: TEXT_EDIT_MODEL,
    aiProvider: TEXT_EDIT_PROVIDER,
    outputFormat: "png",
    imageOnly: true,
  });

  if (!result.success || !result.data?.imageData) {
    throw new Error(result.error?.message || "背景提取失败");
  }

  return ensureDataUrlString(result.data.imageData, "image/png");
}

async function runBackgroundRemoval(
  baseImage: string,
  deps: SplitImageDeps
): Promise<string> {
  let preprocessedImage: string | null = null;

  for (const model of BG_REMOVAL_MODELS) {
    const editResult = await deps.editImage({
      prompt: "只保留完整的主体，背景换成纯色",
      sourceImage: baseImage,
      model,
      aiProvider: TEXT_EDIT_PROVIDER,
      outputFormat: "png",
      imageOnly: true,
    });

    if (editResult.success && editResult.data?.imageData) {
      preprocessedImage = ensureDataUrlString(
        editResult.data.imageData,
        "image/png"
      );
      break;
    }

    deps.log?.("background preprocess failed", { model, error: editResult.error });
  }

  const imageForRemoval = preprocessedImage ?? baseImage;
  const result = await deps.removeBackground(imageForRemoval, "image/png", true);

  if (!result.success || !result.imageData) {
    throw new Error(result.error || "背景移除失败");
  }

  return result.imageData;
}

export async function splitImageIntoLayers(
  baseImage: string,
  deps: SplitImageDeps
): Promise<LayerSplitOutput[]> {
  const outputs: LayerSplitOutput[] = [];
  let workingImage = baseImage;

  let detectedTexts: string[] = [];
  try {
    detectedTexts = await detectImageText(baseImage, deps);
  } catch (error) {
    deps.log?.("detectImageText failed, skip text split", error);
  }

  if (detectedTexts.length > 0) {
    const [textLayerResult, textlessResult] = await Promise.allSettled([
      extractTextLayer(baseImage, deps),
      removeTextLayer(baseImage, deps),
    ]);

    if (textLayerResult.status === "fulfilled") {
      outputs.push({ label: "text-layer", imageData: textLayerResult.value });
    }

    if (textlessResult.status === "fulfilled") {
      outputs.push({ label: "textless-image", imageData: textlessResult.value });
      workingImage = textlessResult.value;
    }
  }

  const [subjectResult, backgroundResult] = await Promise.allSettled([
    runBackgroundRemoval(workingImage, deps),
    extractBackgroundLayer(workingImage, deps),
  ]);

  if (subjectResult.status === "fulfilled") {
    outputs.push({ label: "subject-layer", imageData: subjectResult.value });
  }

  if (backgroundResult.status === "fulfilled") {
    outputs.push({ label: "background-layer", imageData: backgroundResult.value });
  } else if (workingImage !== baseImage) {
    try {
      const fallbackBackground = await extractBackgroundLayer(baseImage, deps);
      outputs.push({ label: "background-layer", imageData: fallbackBackground });
    } catch (error) {
      deps.log?.("background fallback failed", error);
    }
  }

  if (outputs.length === 0) {
    throw new Error("分层失败，请稍后重试");
  }

  return outputs;
}
