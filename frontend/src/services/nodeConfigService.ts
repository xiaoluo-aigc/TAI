/**
 * 节点配置服务
 * 从后端获取节点配置，用于动态控制节点面板显示
 */
import { getApiBaseUrl } from "../utils/assetProxy";
import { pickLocaleText } from "@/utils/localeText";

export interface NodeConfig {
  nodeKey: string;
  nameZh: string;
  nameEn: string;
  category: "input" | "image" | "video" | "audio" | "other";
  status: "normal" | "maintenance" | "coming_soon" | "disabled";
  statusMessage?: string;
  creditsPerCall: number;
  priceYuan?: number;
  serviceType?: string;
  sortOrder: number;
  description?: string;
  metadata?: Record<string, any>;
}

// 缓存配置
let cachedConfigs: NodeConfig[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

/** 跨标签页通知画布刷新节点配置（与 localStorage 事件 key 一致） */
export const NODE_CONFIG_SYNC_STORAGE_KEY = "tanva:nodeConfigRev";

/** 同窗口内通知（storage 事件不会在写入的当前标签页触发） */
export const NODE_CONFIG_SYNC_DOM_EVENT = "tanva:nodeConfigsUpdated";

/**
 * 管理端更新节点配置后调用：清空内存缓存并通知其他标签页重新拉取
 */
export function notifyNodeConfigsUpdated(): void {
  clearNodeConfigCache();
  try {
    localStorage.setItem(NODE_CONFIG_SYNC_STORAGE_KEY, String(Date.now()));
  } catch {
    // 隐私模式等场景忽略
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NODE_CONFIG_SYNC_DOM_EVENT));
  }
}

/**
 * 获取所有节点配置
 * @param options.force 为 true 时跳过内存缓存（管理端保存后、收到同步通知时使用）
 */
export async function fetchNodeConfigs(options?: {
  force?: boolean;
}): Promise<NodeConfig[]> {
  const force = Boolean(options?.force);
  if (!force && cachedConfigs && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedConfigs;
  }

  try {
    const apiBaseUrl = getApiBaseUrl();
    const response = await fetch(`${apiBaseUrl}/api/public/ai/node-configs`);

    if (!response.ok) {
      console.warn("获取节点配置失败，使用默认配置");
      return getDefaultConfigs();
    }

    const configs = await response.json();

    // 更新缓存
    cachedConfigs = configs;
    cacheTimestamp = Date.now();

    return configs;
  } catch (error) {
    console.warn("获取节点配置出错，使用默认配置:", error);
    return getDefaultConfigs();
  }
}

/**
 * 清除缓存（用于管理员更新配置后刷新）
 */
export function clearNodeConfigCache() {
  cachedConfigs = null;
  cacheTimestamp = 0;
}

/**
 * 获取状态对应的 badge 文本
 */
export function getStatusBadge(status: string): string | undefined {
  switch (status) {
    case "maintenance":
      return pickLocaleText("维护中", "Maintenance");
    case "coming_soon":
      return pickLocaleText("即将开放", "Coming Soon");
    case "disabled":
      return pickLocaleText("已禁用", "Disabled");
    default:
      return undefined;
  }
}

/**
 * 默认配置（后端不可用时的降级方案）
 */
function getDefaultConfigs(): NodeConfig[] {
  return [
    // 输入节点
    { nodeKey: "textPrompt", nameZh: "提示词节点", nameEn: "Prompt", category: "input", status: "normal", sortOrder: 1, creditsPerCall: 0 },
    { nodeKey: "textPromptPro", nameZh: "高级提示词", nameEn: "Prompt Pro", category: "input", status: "normal", sortOrder: 2, creditsPerCall: 0 },
    { nodeKey: "image", nameZh: "图片节点", nameEn: "Image", category: "input", status: "normal", sortOrder: 3, creditsPerCall: 0 },
    { nodeKey: "imagePro", nameZh: "高级图片节点", nameEn: "Image Pro", category: "input", status: "normal", sortOrder: 4, creditsPerCall: 0 },
    { nodeKey: "video", nameZh: "视频节点", nameEn: "Video", category: "input", status: "normal", sortOrder: 5, creditsPerCall: 0 },
    { nodeKey: "textNote", nameZh: "文本便签", nameEn: "Note Node", category: "input", status: "normal", sortOrder: 6, creditsPerCall: 0 },
    { nodeKey: "camera", nameZh: "相机节点", nameEn: "Camera", category: "input", status: "normal", sortOrder: 7, creditsPerCall: 0 },

    // 生图节点
    { nodeKey: "generate", nameZh: "生成节点", nameEn: "Generate", category: "image", status: "normal", sortOrder: 10, creditsPerCall: 20 },
    { nodeKey: "generate4", nameZh: "四图生成", nameEn: "Generate 4", category: "image", status: "normal", sortOrder: 11, creditsPerCall: 80 },
    { nodeKey: "generatePro", nameZh: "自定义节点", nameEn: "Agent", category: "image", status: "normal", sortOrder: 12, creditsPerCall: 40 },
    { nodeKey: "generatePro4", nameZh: "高级四图", nameEn: "Generate Pro 4", category: "image", status: "normal", sortOrder: 13, creditsPerCall: 160 },
    { nodeKey: "generateReference", nameZh: "参考生成", nameEn: "Reference", category: "image", status: "normal", sortOrder: 14, creditsPerCall: 40 },
    { nodeKey: "viewAngle", nameZh: "视角变换", nameEn: "View Angle", category: "image", status: "normal", sortOrder: 15, creditsPerCall: 30 },
    { nodeKey: "midjourney", nameZh: "Midjourney", nameEn: "Midjourney", category: "image", status: "normal", sortOrder: 16, creditsPerCall: 50 },
    { nodeKey: "nano2", nameZh: "Nano2生成", nameEn: "Nano2", category: "image", status: "normal", sortOrder: 17, creditsPerCall: 30 },
    {
      nodeKey: "gptImage2",
      nameZh: "Gpt-Imgae-2",
      nameEn: "Gpt-Imgae-2",
      category: "image",
      status: "normal",
      sortOrder: 18,
      creditsPerCall: 40,
      metadata: {
        type: "gptImage2",
        flowNodeType: "gptImage2",
        provider: "nano2",
        model: "gpt-image-2",
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21"],
        resolutions: ["1K", "2K", "4K"],
        showResolutionSelector: true,
        showGoogleSearch: false,
        showGoogleImageSearch: false,
        maxReferenceImages: 16,
        defaultData: {
          modelProvider: "nano2",
          model: "gpt-image-2",
          aspectRatio: "1:1",
          resolution: "1K",
          quality: "auto",
          officialFallback: false,
          maxReferenceImages: 16,
          googleSearch: false,
          googleImageSearch: false,
        },
      },
      description: "Gpt-Imgae-2 生图，支持文生图/图生图，最多 16 张参考图",
    },

    // 视频节点
    { nodeKey: "wan27Video", nameZh: "Wan2.7视频生成", nameEn: "Wan2.7 I2V", category: "video", status: "normal", sortOrder: 35, creditsPerCall: 0, serviceType: "wan27-video", priceYuan: 6 },

    // 其他节点
    { nodeKey: "videoAnalyze", nameZh: "视频分析节点", nameEn: "Video Analysis", category: "other", status: "normal", sortOrder: 31, creditsPerCall: 30 },
    { nodeKey: "videoFrameExtract", nameZh: "视频帧提取", nameEn: "Frame Extract", category: "other", status: "normal", sortOrder: 32, creditsPerCall: 0 },
    { nodeKey: "analysis", nameZh: "图像分析节点", nameEn: "Analysis", category: "other", status: "normal", sortOrder: 33, creditsPerCall: 10 },
    { nodeKey: "promptOptimize", nameZh: "提示词优化", nameEn: "Optimize", category: "other", status: "normal", sortOrder: 34, creditsPerCall: 5 },
    { nodeKey: "textChat", nameZh: "文字对话", nameEn: "Chat", category: "other", status: "normal", sortOrder: 35, creditsPerCall: 2 },
    { nodeKey: "storyboardSplit", nameZh: "分镜拆解", nameEn: "Storyboard", category: "other", status: "normal", sortOrder: 36, creditsPerCall: 0 },
    { nodeKey: "imageGrid", nameZh: "图片拼接", nameEn: "Grid", category: "other", status: "normal", sortOrder: 37, creditsPerCall: 0 },
    { nodeKey: "imageSplit", nameZh: "图片拆分", nameEn: "Split", category: "other", status: "normal", sortOrder: 38, creditsPerCall: 0 },
    { nodeKey: "imageCompress", nameZh: "图片压缩", nameEn: "Image Compress", category: "other", status: "normal", sortOrder: 39, creditsPerCall: 0 },
    { nodeKey: "three", nameZh: "2D转3D", nameEn: "2D to 3D", category: "other", status: "normal", sortOrder: 40, creditsPerCall: 200 },
    { nodeKey: "audioUpload", nameZh: "语音节点", nameEn: "Audio Node", category: "audio", status: "normal", sortOrder: 41, creditsPerCall: 0 },
    { nodeKey: "minimaxSpeech", nameZh: "MiniMax语音合成", nameEn: "MiniMax Speech", category: "audio", status: "normal", sortOrder: 42, creditsPerCall: 10, serviceType: "minimax-speech" },
    { nodeKey: "videoToGif", nameZh: "视频转GIF", nameEn: "Video to GIF", category: "other", status: "normal", sortOrder: 43, creditsPerCall: 30, serviceType: "video-to-gif", priceYuan: 0.3 },
    { nodeKey: "tencentSpeech", nameZh: "语音合成", nameEn: "Speech Synthesis", category: "audio", status: "normal", sortOrder: 44, creditsPerCall: 10, serviceType: "tencent-speech" },
    { nodeKey: "minimaxMusic", nameZh: "MiniMax音乐生成", nameEn: "MiniMax Music", category: "audio", status: "normal", sortOrder: 45, creditsPerCall: 30, serviceType: "minimax-music" },
  ];
}
