/**
 * Google Gemini 3 Pro Image API 相关类型定义
 * 支持 gemini-2.5-flash-image-preview 模型
 */

// AI鍥惧儚鐢熸垚璇锋眰鍙傛暟
export interface RunningHubNodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  description?: string;
}

export interface RunningHubGenerateOptions {
  webappId?: string;
  webhookUrl?: string;
  nodeInfoList: RunningHubNodeInfo[];
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface MidjourneyAccountFilter {
  channelId?: string;
  instanceId?: string;
  modes?: string[];
  remark?: string;
  remix?: string;
  remixAutoConsidered?: boolean;
}

export interface MidjourneyProviderOptions {
  mode?: 'FAST' | 'RELAX';
  botType?: string;
  notifyHook?: string;
  state?: string;
  dimensions?: 'PORTRAIT' | 'SQUARE' | 'LANDSCAPE';
  base64Array?: string[];
  base64?: string;
  maskBase64?: string;
  remix?: boolean;
  accountFilter?: MidjourneyAccountFilter;
}

export interface MidjourneyButtonInfo {
  customId: string;
  label: string;
  emoji?: string | null;
  type?: number;
  style?: number;
  disabled?: boolean;
}

export type BananaImageRoute = 'normal' | 'stable';

export interface BananaProviderOptions {
  imageRoute?: BananaImageRoute;
}

export interface MidjourneyMetadata {
  taskId: string;
  buttons?: MidjourneyButtonInfo[];
  imageUrl?: string;
  status?: string;
  parentTaskId?: string;
  actionCustomId?: string;
  modalPrompt?: string;
  prompt?: string;
  promptEn?: string;
  description?: string;
  properties?: Record<string, unknown>;
}

export interface AIProviderOptions {
  banana?: BananaProviderOptions;
  runningHub?: RunningHubGenerateOptions;
  midjourney?: MidjourneyProviderOptions;
  [key: string]: unknown;
}

export interface MidjourneyActionRequest {
  taskId: string;
  customId: string;
  state?: string;
  notifyHook?: string;
  chooseSameChannel?: string | boolean;
  accountFilter?: MidjourneyAccountFilter;
}

export interface MidjourneyModalRequest {
  taskId: string;
  prompt?: string;
  maskBase64?: string;
}

export type SupportedAIProvider =
  | 'gemini'
  | 'gemini-pro'
  | 'banana'
  | 'banana-2.5'
  | 'banana-3.1'
  | 'runninghub'
  | 'midjourney'
  | 'nano2'
  | 'seedream5';

export interface AIImageGenerateRequest {
  prompt: string;
  model?: string;
  aiProvider?: SupportedAIProvider;
  providerOptions?: AIProviderOptions;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8'; // 闀垮姣旓紙瀹樻柟鏀寔鏋氫妇锛?
  imageSize?: string; // 鍥惧儚灏哄锛屾敮鎸?2K/3K 鎴?2048x2048 杩欑被鍍忕礌鍊?
  thinkingLevel?: 'high' | 'low'; // 鎬濊€冪骇鍒紙浠?Gemini 3锛?
  imageOnly?: boolean; // 鏂板锛氫粎杩斿洖鍥惧儚锛屼笉杩斿洖鏂囨湰
  enableWebSearch?: boolean; // 鐢熷浘闃舵鍚敤鑱旂綉鎼滅储锛堢敤浜庢敮鎸?147 Ultra 绛夐摼璺級
  imageUrls?: string[]; // Nano2 鍙傝€冨浘鐗?URL 鍒楄〃
  googleSearch?: boolean; // Nano2 Google 鏂囨湰鎼滅储澧炲己
  googleImageSearch?: boolean; // Nano2 Google 鍥剧墖鎼滅储澧炲己
  batchMode?: boolean; // Seedream5 鎵归噺妯″紡
  batchCount?: number; // Seedream5 鎵归噺鏁伴噺
  parallelGroupId?: string; // 对话框并行生图批次ID（仅用于积分流水聚合）
  parallelGroupIndex?: number; // 对话框并行生图序号（0-based）
  parallelGroupTotal?: number; // 对话框并行生图总数
  officialFallback?: boolean; // gpt-image-2: whether to enable official upstream fallback
  quality?: 'auto' | 'low' | 'medium' | 'high';
  background?: 'auto' | 'opaque' | 'transparent';
  moderation?: 'auto' | 'low';
  outputCompression?: number;
  maskUrl?: string;
  nodeConfigKey?: string;
  nodeConfigNameZh?: string;
  nodeConfigNameEn?: string;
  billingModeName?: string;
  billingTitleSource?: 'dialog' | 'node';
}

// AI鍥惧儚缂栬緫璇锋眰鍙傛暟
export interface AIImageEditRequest {
  prompt: string;
  sourceImage?: string; // base64 encoded image
  sourceImageUrl?: string; // remote URL to be handled by backend
  model?: string;
  aiProvider?: SupportedAIProvider;
  providerOptions?: AIProviderOptions;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8'; // 闀垮姣旓紙瀹樻柟鏀寔鏋氫妇锛?
  imageSize?: '0.5K' | '1K' | '2K' | '4K'; // 鍥惧儚灏哄锛堥珮娓呰缃紝浠?Gemini 3锛?
  thinkingLevel?: 'high' | 'low'; // 鎬濊€冪骇鍒紙浠?Gemini 3锛?
  imageOnly?: boolean; // 鏂板锛氫粎杩斿洖鍥惧儚锛屼笉杩斿洖鏂囨湰
  parallelGroupId?: string;
  parallelGroupIndex?: number;
  parallelGroupTotal?: number;
  nodeConfigKey?: string;
  nodeConfigNameZh?: string;
  nodeConfigNameEn?: string;
  billingModeName?: string;
  billingTitleSource?: 'dialog' | 'node';
}

// AI鍥惧儚铻嶅悎璇锋眰鍙傛暟
export interface AIImageBlendRequest {
  prompt: string;
  sourceImages?: string[]; // base64 encoded images
  sourceImageUrls?: string[]; // remote URLs to be handled by backend
  model?: string;
  aiProvider?: SupportedAIProvider;
  providerOptions?: AIProviderOptions;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  aspectRatio?:
    | '1:1'
    | '2:3'
    | '3:2'
    | '3:4'
    | '4:3'
    | '4:5'
    | '5:4'
    | '9:16'
    | '16:9'
    | '21:9'
    | '2:1'
    | '1:2'
    | '9:21'
    | '4:1'
    | '1:4'
    | '8:1'
    | '1:8'; // 闀垮姣旓紙瀹樻柟鏀寔鏋氫妇锛?
  imageSize?: '0.5K' | '1K' | '2K' | '4K'; // 鍥惧儚灏哄锛堥珮娓呰缃紝浠?Gemini 3锛?
  thinkingLevel?: 'high' | 'low'; // 鎬濊€冪骇鍒紙浠?Gemini 3锛?
  imageOnly?: boolean; // 鏂板锛氫粎杩斿洖鍥惧儚锛屼笉杩斿洖鏂囨湰
  parallelGroupId?: string;
  parallelGroupIndex?: number;
  parallelGroupTotal?: number;
  nodeConfigKey?: string;
  nodeConfigNameZh?: string;
  nodeConfigNameEn?: string;
  billingModeName?: string;
  billingTitleSource?: 'dialog' | 'node';
}

// AI鐢熸垚缁撴灉
export interface AIImageResult {
  id: string;
  imageData?: string; // base64 encoded image (鍙€夛紝API鍙兘鍙繑鍥炴枃鏈?
  imageUrl?: string; // 杩滅▼ URL锛堟帹鑽愮敤浜庣敾甯冩寔涔呭寲锛岄伩鍏?base64/dataURL锛?
  textResponse?: string; // AI鐨勬枃鏈洖澶嶏紝濡?Okay, here's a cat for you!"
  prompt: string;
  model: string;
  createdAt: Date;
  hasImage: boolean; // 鏍囪瘑鏄惁鍖呭惈鍥惧儚鏁版嵁
  metadata?: {
    provider?: string;
    aspectRatio?: string;
    outputFormat?: string;
    processingTime?: number;
    tokenUsage?: number;
    imageUrl?: string;
    midjourney?: MidjourneyMetadata;
    [key: string]: unknown;
  };
}

// AI娴佸紡鍝嶅簲杩涘害浜嬩欢
export interface AIStreamProgressEvent {
  operationType: string;
  phase: 'starting' | 'text_received' | 'text_delta' | 'image_received' | 'completed' | 'error';
  chunkCount?: number;
  textLength?: number;
  hasImage?: boolean;
  message?: string;
  // 鏂板锛氭枃鏈閲忎笌瀹屾暣鏂囨湰锛堝彲閫夛級
  deltaText?: string;
  fullText?: string;
  timestamp: number;
}

// AI鐢熸垚鐘舵€?
export const AIGenerationStatus = {
  IDLE: 'idle',
  GENERATING: 'generating',
  SUCCESS: 'success',
  ERROR: 'error'
} as const;

export type AIGenerationStatus = typeof AIGenerationStatus[keyof typeof AIGenerationStatus];

// AI閿欒绫诲瀷
export interface AIError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
}

// AI鍥惧儚鍒嗘瀽璇锋眰鍙傛暟
export interface AIImageAnalyzeRequest {
  prompt?: string;
  sourceImage: string; // base64 encoded image
  sourceImages?: string[]; // base64/url array for multi-image analysis
  sourceImageUrl?: string; // URL to remote image
  model?: string;
  aiProvider?: SupportedAIProvider;
  providerOptions?: AIProviderOptions;
}

// AI鍥惧儚鍒嗘瀽缁撴灉
export interface AIImageAnalysisResult {
  analysis: string;
  confidence?: number;
  tags?: string[];
}

// AI鏂囨湰瀵硅瘽璇锋眰鍙傛暟
export interface AITextChatRequest {
  prompt: string;
  model?: string;
  aiProvider?: SupportedAIProvider;
  providerOptions?: AIProviderOptions;
  billingTag?: 'text_chat' | 'prompt_optimize';
  thinkingLevel?: 'high' | 'low'; // 鎬濊€冪骇鍒紙浠?Gemini 3锛?
  context?: string[];
  enableWebSearch?: boolean; // 鏄惁鍚敤鑱旂綉鎼滅储
}

// 缃戠粶鎼滅储缁撴灉
export interface WebSearchResult {
  searchQueries: string[]; // 鎵ц鐨勬悳绱㈡煡璇?
  sources: WebSearchSource[]; // 鎼滅储鏉ユ簮
  hasSearchResults: boolean; // 鏄惁鍖呭惈鎼滅储缁撴灉
}

// 鎼滅储鏉ユ簮淇℃伅
export interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  relevanceScore?: number;
}

// AI鏂囨湰瀵硅瘽缁撴灉
export interface AITextChatResult {
  text: string;
  model: string;
  tokenUsage?: number;
  webSearchResult?: WebSearchResult; // 鑱旂綉鎼滅储缁撴灉
}

// Paper.js 浠ｇ爜鐢熸垚璇锋眰
export interface AIPaperJSGenerateRequest {
  prompt: string;
  model?: string;
  aiProvider?: SupportedAIProvider;
  thinkingLevel?: 'high' | 'low';
  canvasWidth?: number;
  canvasHeight?: number;
}

// Paper.js 浠ｇ爜鐢熸垚缁撴灉
export interface AIPaperJSResult {
  code: string;
  explanation?: string;
  model: string;
  provider: string;
  createdAt: string;
  metadata?: {
    canvasSize?: { width: number; height: number };
    processingTime?: number;
    [key: string]: unknown;
  };
}

// 鍥惧儚杞煝閲忚姹?
export interface AIImg2VectorRequest {
  sourceImage: string; // base64 encoded image
  prompt?: string;
  model?: string;
  aiProvider?: SupportedAIProvider;
  thinkingLevel?: 'high' | 'low';
  canvasWidth?: number;
  canvasHeight?: number;
  style?: 'simple' | 'detailed' | 'artistic';
}

// 鍥惧儚杞煝閲忕粨鏋?
export interface AIImg2VectorResult {
  code: string;
  imageAnalysis: string;
  explanation?: string;
  model: string;
  provider: string;
  createdAt: string;
  metadata?: {
    canvasSize?: { width: number; height: number };
    processingTime?: number;
    style?: string;
    [key: string]: unknown;
  };
}

// Function Calling 宸ュ叿瀹氫箟
export interface AITool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// 宸ュ叿閫夋嫨璇锋眰
export interface ToolSelectionRequest {
  userInput: string;
  hasImages: boolean;
  imageCount: number;
  hasCachedImage?: boolean; // 鏄惁鏈夌紦瀛樺浘鍍?
  availableTools: string[];
  context?: string;
  prompt?: string;
  aiProvider?: SupportedAIProvider;
  model?: string;
  providerOptions?: AIProviderOptions;
}

// 宸ュ叿閫夋嫨缁撴灉
export interface ToolSelectionResult {
  selectedTool: string;
  parameters: Record<string, any>;
  confidence: number;
  reasoning: string;
}

// AI鏈嶅姟鍝嶅簲
export interface AIServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: AIError;
}

