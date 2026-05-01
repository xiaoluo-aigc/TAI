// @ts-nocheck
/**
 * AI生图对话框组件
 * 固定在屏幕底部中央的对话框，用于AI图像生成
 */

import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "@/services/authFetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
// 比例选择改为自定义浮层（定位到对话框上方）
import ImagePreviewModal from "@/components/ui/ImagePreviewModal";
import SmartImage from "@/components/ui/SmartImage";
import SmoothSmartImage from "@/components/ui/SmoothSmartImage";
import { useAIChatStore, getTextModelForProvider } from "@/stores/aiChatStore";
import { useUIStore } from "@/stores";
import type { ManualAIMode, ChatMessage } from "@/stores/aiChatStore";
import { clipboardJsonService } from "@/services/clipboardJsonService";
import {
  Send,
  AlertCircle,
  Image,
  X,
  History,
  Plus,
  BookOpen,
  SlidersHorizontal,
  Check,
  Loader2,
  Share2,
  Download,
  Brain,
  Clock,
  ChevronDown,
  Copy,
  FileText,
  Play,
  RotateCcw,
  Pencil,
  Lock,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AIStreamProgressEvent,
  MidjourneyButtonInfo,
  MidjourneyMetadata,
  SupportedAIProvider,
} from "@/types/ai";
import PromptOptimizationPanel from "@/components/chat/PromptOptimizationPanel";
import type { PromptOptimizationSettings } from "@/components/chat/PromptOptimizationPanel";
import promptOptimizationService from "@/services/promptOptimizationService";
import { contextManager } from "@/services/contextManager";
import { toRenderableImageSrc } from "@/utils/imageSource";
import {
  getTencentBananaMaxReferenceImages,
  isTencentBananaAnalyzeSupported,
  isTencentStableBananaRoute,
} from "@/utils/bananaRouteCapabilities";

type ManualModeOption = {
  value: ManualAIMode;
  label: string;
  description: string;
};

const BASE_MANUAL_MODE_OPTIONS: ManualModeOption[] = [
  { value: "auto", label: "Auto", description: "智能判断并选择最佳工具" },
  { value: "text", label: "Text", description: "文本对话模式" },
  { value: "generate", label: "Generate", description: "图片生成模式" },
  { value: "edit", label: "Edit", description: "图生图编辑模式" },
  { value: "blend", label: "Blend", description: "多图融合模式" },
  { value: "analyze", label: "Analysis", description: "图像分析模式" },
  { value: "video", label: "Video", description: "视频生成模式" },
  { value: "vector", label: "Vector", description: "矢量图形模式" },
];

// 长按提示词扩写按钮触发面板的最小时长（毫秒）
const LONG_PRESS_DURATION = 550;

const AUTO_MODE_MULTIPLIERS = [1, 2, 4, 8] as const;
const MULTIPLIER_ENABLED_MODES: ManualAIMode[] = [
  "auto",
  "generate",
  "edit",
  "blend",
];

const PROVIDER_MODE_OPTIONS: Partial<
  Record<SupportedAIProvider, ManualModeOption[]>
> = {
  gemini: BASE_MANUAL_MODE_OPTIONS,
  "gemini-pro": BASE_MANUAL_MODE_OPTIONS,
  banana: BASE_MANUAL_MODE_OPTIONS,
  "banana-2.5": BASE_MANUAL_MODE_OPTIONS,
  "banana-3.1": BASE_MANUAL_MODE_OPTIONS,
  runninghub: BASE_MANUAL_MODE_OPTIONS,
  midjourney: BASE_MANUAL_MODE_OPTIONS,
};

// 彩色光晕特效开关（默认关闭，后续需要再开启）
const ENABLE_CHAT_AURA = true;

const MinimalGlobeIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    stroke='currentColor'
    strokeWidth={1.8}
    strokeLinecap='round'
    strokeLinejoin='round'
    {...props}
  >
    <circle cx='12' cy='12' r='8.5' />
    <path d='M12 3.5c2.1 2 3.5 5 3.5 8.5s-1.4 6.5-3.5 8.5c-2.1-2-3.5-5-3.5-8.5s1.4-6.5 3.5-8.5Z' />
    <path d='M4 12h16' />
  </svg>
);

// 长宽比图标 - 简化为矩形框
const AspectRatioIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox='0 0 16 16'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    stroke='currentColor'
    strokeWidth={1.5}
    strokeLinecap='round'
    strokeLinejoin='round'
    {...props}
  >
    <rect x='3' y='5' width='10' height='6' rx='1' />
  </svg>
);

type MidjourneyActionButtonsProps = {
  buttons: MidjourneyButtonInfo[];
  onAction: (button: MidjourneyButtonInfo) => Promise<void>;
};

const MidjourneyActionButtons: React.FC<MidjourneyActionButtonsProps> = ({
  buttons,
  onAction,
}) => {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const actionableButtons = useMemo(() => {
    const soloSuffix = /::SOLO$/i;
    return buttons.filter((btn) => {
      const customId = btn?.customId?.trim();
      if (!customId) return false;
      if (soloSuffix.test(customId)) {
        // Midjourney 会附带一个 Solo reroll 占位按钮，界面上不需要展示
        return false;
      }
      return Boolean(btn.label?.trim() || customId);
    });
  }, [buttons]);

  if (actionableButtons.length === 0) {
    return null;
  }

  return (
    <div className='pt-2 mt-2 border-t border-slate-200'>
      <div className='mb-2 text-xs text-slate-500'>Midjourney 操作</div>
      <div className='flex flex-wrap gap-2'>
        {actionableButtons.map((button) => {
          const isLoading = loadingId === button.customId;
          return (
            <button
              key={button.customId}
              className={cn(
                "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1",
                button.disabled
                  ? "bg-transparent text-slate-400 border-slate-200 cursor-not-allowed opacity-60"
                  : "bg-transparent text-gray-700 border-gray-200 hover:bg-gray-50/50",
                isLoading && "cursor-wait"
              )}
              disabled={button.disabled || isLoading}
              onClick={async () => {
                if (!button.customId) return;
                setLoadingId(button.customId);
                try {
                  await onAction(button);
                } finally {
                  setLoadingId(null);
                }
              }}
              title={button.label || button.customId}
            >
              {isLoading ? (
                <Loader2 className='h-3.5 w-3.5 animate-spin text-slate-500' />
              ) : (
                <span>{button.label || button.customId}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const HISTORY_DEFAULT_MIN_HEIGHT = 320;

type ResendInfo =
  | { type: "edit"; prompt: string; sourceImage: string }
  | { type: "blend"; prompt: string; sourceImages: string[] };

const extractPromptFromContent = (
  content: string,
  keyword: string
): string | null => {
  if (!content) return null;
  const normalized = content.trim();
  if (!normalized.startsWith(keyword)) return null;
  return normalized.slice(keyword.length).replace(/^\s*[:：]?\s*/, "");
};

const getResendInfoFromMessage = (message: ChatMessage): ResendInfo | null => {
  if (message.type !== "user") return null;

  const editPrompt = extractPromptFromContent(message.content, "编辑图像");
  if (editPrompt !== null && message.sourceImageData) {
    return {
      type: "edit",
      prompt: editPrompt,
      sourceImage: message.sourceImageData,
    };
  }

  if (message.sourceImagesData && message.sourceImagesData.length >= 2) {
    const blendPrompt = extractPromptFromContent(message.content, "融合图像");
    if (blendPrompt !== null) {
      return {
        type: "blend",
        prompt: blendPrompt,
        sourceImages: [...message.sourceImagesData],
      };
    }
  }

  return null;
};

const AIChatDialog: React.FC = () => {
  const { t, i18n } = useTranslation();
  const {
    isVisible,
    isMaximized,
    setIsMaximized,
    currentInput,
    generationStatus,
    messages,
    sourceImageForEditing,
    sourceImagesForBlending,
    sourceImageForAnalysis,
    enableWebSearch,
    aspectRatio,
    imageSize,
    thinkingLevel,
    videoAspectRatio,
    videoDurationSeconds,
    sessions,
    currentSessionId,
    createSession,
    switchSession,
    hideDialog,
    showDialog,
    setCurrentInput,
    clearInput,
    processUserInput,
    setSourceImageForEditing,
    setSourceImageForAnalysis,
    setSourcePdfForAnalysis,
    sourcePdfForAnalysis,
    sourcePdfFileName,
    addImageForBlending,
    removeImageFromBlending,
    clearImagesForBlending,
    getAIMode,
    initializeContext,
    getContextSummary,
    isIterativeMode,
    updateMessageStatus,
    toggleWebSearch,
    setAspectRatio,
    setImageSize,
    setThinkingLevel,
    setVideoAspectRatio,
    setVideoDurationSeconds,
    manualAIMode,
    setManualAIMode,
    autoSelectedTool,
    aiProvider,
    bananaImageRoute,
    setAIProvider,
    autoModeMultiplier,
    setAutoModeMultiplier,
    sendShortcut,
    executeMidjourneyAction,
    expandedPanelStyle,
    chatTheme,
    // 直接调用的图像处理方法（用于重新发送）
    editImage,
    blendImages,
    analyzeImage,
  } = useAIChatStore();
  const focusMode = useUIStore((state) => state.focusMode);
  const showLibraryPanel = useUIStore((state) => state.showLibraryPanel);
  const isBlackTheme = chatTheme === "black";
  const chatLogoSrc = "/logo.png";
  const aiBrandTextClass = isBlackTheme
    ? "text-sm font-bold text-white"
    : "text-sm font-bold text-black";
  const isZh = (i18n.resolvedLanguage || i18n.language || "")
    .toLowerCase()
    .startsWith("zh");
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);

  // 监听aiProvider变化并打印日志
  React.useEffect(() => {
    console.log("🤖 [AI Provider] Changed", {
      provider: aiProvider,
      timestamp: new Date().toISOString(),
    });
  }, [aiProvider]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null); // 输入区域容器 ref
  const dialogRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ensureInputVisibleRafRef = useRef<number | null>(null);
  const collapseHandleRef = useRef<HTMLButtonElement | null>(null);
  const lockButtonRef = useRef<HTMLButtonElement | null>(null);
  const [hoverToggleZone, setHoverToggleZone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const ownedObjectUrlsRef = useRef<Set<string>>(new Set());
  const historyRef = useRef<HTMLDivElement>(null);
  const historyInitialHeightRef = useRef<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const showHistoryRef = useRef(showHistory);
  const [isHistoryLocked, setIsHistoryLocked] = useState(false);
  // isMaximized 现在从 store 获取
  const isMaximizedRef = useRef(isMaximized);
  const prevIsMaximizedRef = useRef(isMaximized);
  const [manuallyClosedHistory, setManuallyClosedHistory] = useState(() => {
    // 刷新页面时默认关闭历史记录
    return true;
  });
  const historySingleClickTimerRef = useRef<number | null>(null);
  const suppressHistoryClickRef = useRef(false);
  const [creatingSession, setCreatingSession] = useState(false);
  // 流式文本渲染状态（仅文本对话）
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoOptimizeEnabled, setAutoOptimizeEnabled] = useState(false);
  // 拖拽移动状态
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffsetX, setDragOffsetX] = useState<number | null>(null);
  const dragStartRef = useRef<{ mouseX: number; elemX: number } | null>(null);
  // 标记是否发生过实际拖拽移动，用于阻止拖拽结束后触发点击事件
  const hasDraggedRef = useRef(false);
  // 拖拽调整高度状态
  const [isResizing, setIsResizing] = useState(false);
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const resizeStartRef = useRef<{ mouseY: number; startHeight: number } | null>(
    null
  );
  const resizeBottomGapRef = useRef(0);
  const [autoOptimizing, setAutoOptimizing] = useState(false);
  const textModel = useMemo(
    () => getTextModelForProvider(aiProvider),
    [aiProvider]
  );
  const [isPromptPanelOpen, setIsPromptPanelOpen] = useState(false);
  const promptButtonRef = useRef<HTMLButtonElement>(null);
  const promptPanelRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggeredRef = useRef(false);
  // 比例面板
  const [isAspectOpen, setIsAspectOpen] = useState(false);
  const aspectPanelRef = useRef<HTMLDivElement | null>(null);
  const aspectButtonRef = useRef<HTMLButtonElement | null>(null);
  const [aspectPos, setAspectPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  // 视频尺寸面板
  const [isVideoAspectOpen, setIsVideoAspectOpen] = useState(false);
  const videoAspectPanelRef = useRef<HTMLDivElement | null>(null);
  const videoAspectButtonRef = useRef<HTMLButtonElement | null>(null);
  const [videoAspectPos, setVideoAspectPos] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });
  const [videoAspectReady, setVideoAspectReady] = useState(false);

  // 视频时长面板
  const [isVideoDurationOpen, setIsVideoDurationOpen] = useState(false);
  const videoDurationPanelRef = useRef<HTMLDivElement | null>(null);
  const videoDurationButtonRef = useRef<HTMLButtonElement | null>(null);
  const [videoDurationPos, setVideoDurationPos] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });
  const [videoDurationReady, setVideoDurationReady] = useState(false);

  // 图像尺寸状态
  const [isImageSizeOpen, setIsImageSizeOpen] = useState(false);
  const imageSizePanelRef = useRef<HTMLDivElement | null>(null);
  const imageSizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [imageSizePos, setImageSizePos] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });
  const [imageSizeReady, setImageSizeReady] = useState(false);

  // 思考级别状态
  const [isThinkingLevelOpen, setIsThinkingLevelOpen] = useState(false);

  // 上传菜单状态
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const thinkingLevelPanelRef = useRef<HTMLDivElement | null>(null);
  const thinkingLevelButtonRef = useRef<HTMLButtonElement | null>(null);
  const [thinkingLevelPos, setThinkingLevelPos] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });
  const [thinkingLevelReady, setThinkingLevelReady] = useState(false);
  const [aspectReady, setAspectReady] = useState(false);
  const [promptSettings, setPromptSettings] =
    useState<PromptOptimizationSettings>({
      language: "中文",
      tone: "",
      focus: "",
      lengthPreference: "balanced",
    });
  // 🔥 跟踪已提交但还未开始生成的任务数量（敲击回车时立即增加）
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  const sendInFlightRef = useRef(false);
  // 🔥 跟踪已处理过计数减少的消息 ID（避免重复减少）
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  // 记录组件挂载时间，用来区分刷新前后的消息
  const hydrationTimestampRef = useRef<number>(Date.now());
  // 彩雾渲染状态（避免初始就显示）
  const [showAura, setShowAura] = useState(false);
  const auraTimerRef = useRef<number | null>(null);

  const isTencentStableBanana = isTencentStableBananaRoute(
    aiProvider,
    bananaImageRoute
  );
  const tencentBananaMaxRefCount = isTencentStableBanana
    ? getTencentBananaMaxReferenceImages(aiProvider)
    : null;
  const availableManualModeOptions = useMemo(() => {
    const baseOptions =
      PROVIDER_MODE_OPTIONS[aiProvider] ?? BASE_MANUAL_MODE_OPTIONS;
    if (!isTencentStableBanana) return baseOptions;
    return baseOptions.filter((option) => option.value !== "analyze");
  }, [aiProvider, isTencentStableBanana]);
  const currentManualMode =
    availableManualModeOptions.find(
      (option) => option.value === manualAIMode
    ) ?? availableManualModeOptions[0];

  const providerToggleOptions: {
    value: SupportedAIProvider;
    label: string;
    description: string;
  }[] = useMemo(
    () => [
      {
        value: "banana-2.5",
        label: "Fast",
        description: t("chat.provider.fastDesc"),
      },
      {
        value: "banana",
        label: "Pro",
        description: t("chat.provider.proDesc"),
      },
      {
        value: "banana-3.1",
        label: "Ultra",
        description: t("chat.provider.ultraDesc"),
      },
    ],
    [t]
  );
  const currentProviderOption =
    providerToggleOptions.find((option) => option.value === aiProvider) ?? null;
  const isDomesticProvider = providerToggleOptions.some(
    (option) => option.value === aiProvider
  );
  const isFastMode = aiProvider === "banana-2.5";
  const isUltraMode = aiProvider === "banana-3.1";
  const isVideoMode =
    manualAIMode === "video" ||
    (manualAIMode === "auto" && autoSelectedTool === "generateVideo");
  const isVectorMode =
    manualAIMode === "vector" ||
    (manualAIMode === "auto" && autoSelectedTool === "generatePaperJS");
  const shouldHideImageParamControls = isVideoMode || isVectorMode;
  const showImageSizeControls =
    !shouldHideImageParamControls &&
    (aiProvider === "gemini-pro" ||
      aiProvider === "banana" ||
      aiProvider === "banana-2.5" ||
      aiProvider === "banana-3.1");
  const showThinkingLevelControls =
    !shouldHideImageParamControls &&
    (aiProvider === "gemini-pro" ||
      aiProvider === "banana" ||
      aiProvider === "banana-2.5" ||
      aiProvider === "banana-3.1");

  const aspectRatioOptions = useMemo(() => {
    const baseRatios = [
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ] as const;
    const ultraExtraRatios = ["4:1", "1:4", "8:1", "1:8"] as const;
    const ratios = isUltraMode
      ? [...baseRatios, ...ultraExtraRatios]
      : baseRatios;
    return [
      { label: t("chat.common.auto"), value: null },
      ...ratios.map((ratio) => ({ label: ratio, value: ratio })),
    ];
  }, [isUltraMode, t]);

  const imageSizeOptions = useMemo(() => {
    if (isFastMode) {
      return [
        { label: t("chat.common.auto"), value: null },
        { label: "1K", value: "1K" },
      ];
    }
    const sizes = [
      ...(isUltraMode ? [{ label: "0.5K", value: "0.5K" }] : []),
      { label: "1K", value: "1K" },
      { label: "2K", value: "2K" },
      { label: "4K", value: "4K" },
    ];
    return [{ label: t("chat.common.auto"), value: null }, ...sizes];
  }, [isFastMode, isUltraMode, t]);

  // 记录最新的最大化状态，供原生事件监听使用
  useEffect(() => {
    isMaximizedRef.current = isMaximized;
  }, [isMaximized]);

  // 记录最新的历史面板状态，供原生事件监听使用
  useEffect(() => {
    showHistoryRef.current = showHistory;
  }, [showHistory]);

  const manualButtonLabel =
    currentManualMode?.label ??
    availableManualModeOptions[0]?.label ??
    t("chat.labels.selectMode");
  const providerButtonLabel =
    currentProviderOption?.label ?? t("chat.labels.domesticModel");
  // 统一向上展开（最大化时避免溢出，紧凑模式保持原有行为）
  const dropdownSide: "top" | "bottom" = "top";

  const handleCycleAutoMultiplier = useCallback(
    (event?: React.MouseEvent) => {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      const currentIndex = AUTO_MODE_MULTIPLIERS.indexOf(
        autoModeMultiplier as (typeof AUTO_MODE_MULTIPLIERS)[number]
      );
      const next =
        AUTO_MODE_MULTIPLIERS[
          (currentIndex + 1) % AUTO_MODE_MULTIPLIERS.length
        ] || AUTO_MODE_MULTIPLIERS[0];
      setAutoModeMultiplier(next);
    },
    [autoModeMultiplier, setAutoModeMultiplier]
  );

  // 如果当前选择的是隐藏的 gemini，自动切换到 gemini-pro
  useEffect(() => {
    if (aiProvider === "gemini") {
      setAIProvider("gemini-pro", { syncFlowNodes: false, source: "internal" });
    }
  }, [aiProvider, setAIProvider]);

  useEffect(() => {
    if (
      !availableManualModeOptions.some(
        (option) => option.value === manualAIMode
      )
    ) {
      const fallback = availableManualModeOptions[0];
      if (fallback) {
        setManualAIMode(fallback.value);
      }
    }
  }, [aiProvider, availableManualModeOptions, manualAIMode, setManualAIMode]);

  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    title: string;
  } | null>(null);

  // 🧠 初始化上下文记忆系统
  useEffect(() => {
    initializeContext();
  }, [initializeContext]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (ensureInputVisibleRafRef.current !== null) {
        if (typeof window !== "undefined") {
          cancelAnimationFrame(ensureInputVisibleRafRef.current);
        }
        ensureInputVisibleRafRef.current = null;
      }
    };
  }, []);

  // 对话框关闭时重置手动关闭标志和拖拽位置
  useEffect(() => {
    if (!isVisible) {
      setManuallyClosedHistory(false);
      setShowHistory(false);
      setIsPromptPanelOpen(false);
      historyInitialHeightRef.current = null;
    }
  }, [isVisible]);

  // 历史面板关闭或最大化时只重置高度基准测量
  useEffect(() => {
    if (!showHistory || isMaximized) {
      historyInitialHeightRef.current = null;
    }
  }, [showHistory, isMaximized]);

  useEffect(() => {
    if (!showHistory || isMaximized) return;
    if (customHeight !== null) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (rect.height > 0) {
      historyInitialHeightRef.current = rect.height;
    }
  }, [showHistory, isMaximized, customHeight]);

  // 拖拽处理函数 - 只在顶部横线标识周边区域可以拖拽
  const handleDragStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 只有在历史面板打开且非最大化时才允许拖拽
      if (!showHistory || isMaximized) return;

      // 检查是否点击在交互元素上（不允许从这些元素开始拖拽）
      const target = e.target as HTMLElement;
      const isInteractive = target.closest(
        'textarea, input, button, a, label, select, [role="button"], img, video, [data-history-ignore-toggle]'
      );
      if (isInteractive) return;

      // 只允许在对话框顶部边缘区域拖拽（横线标识周边，约 20px 高度）
      const dialog = dialogRef.current;
      if (!dialog) return;

      const dialogRect = dialog.getBoundingClientRect();
      const clickY = e.clientY;

      // 只在顶部 20px 区域内允许拖拽
      const isInTopEdge =
        clickY >= dialogRect.top && clickY <= dialogRect.top + 20;

      if (!isInTopEdge) return;

      e.preventDefault();
      e.stopPropagation();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      // 如果已有拖拽位置，使用它；否则使用当前元素位置
      const currentX = dragOffsetX ?? rect.left;

      dragStartRef.current = {
        mouseX: e.clientX,
        elemX: currentX,
      };
      hasDraggedRef.current = false;
      setIsDragging(true);
    },
    [showHistory, isMaximized, dragOffsetX]
  );

  // 拖拽移动和结束处理
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;

      const deltaX = e.clientX - start.mouseX;

      // 只有横向移动超过 3px 才算真正拖拽
      if (!hasDraggedRef.current && Math.abs(deltaX) > 3) {
        hasDraggedRef.current = true;
      }

      if (!hasDraggedRef.current) return;

      let newX = start.elemX + deltaX;

      // 边界检查
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        newX = Math.max(0, Math.min(newX, maxX));
      }

      setDragOffsetX(newX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      // 拖拽后短暂延迟重置标记，阻止后续点击事件
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 100);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // 调整高度处理函数 - 在顶部边缘拖拽调整高度
  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 只有在历史面板打开且非最大化时才允许调整高度
      if (!showHistory || isMaximized) return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const dialogRect = dialog.getBoundingClientRect();
      const mouseY = e.clientY;

      // 检查是否在顶部边缘 8px 范围内（比拖拽移动的 20px 区域小）
      const isInResizeZone =
        mouseY >= dialogRect.top - 4 && mouseY <= dialogRect.top + 8;

      if (!isInResizeZone) return;

      // 检查是否点击在交互元素上
      const target = e.target as HTMLElement;
      const isInteractive = target.closest(
        'textarea, input, button, a, label, select, [role="button"], img, video, [data-history-ignore-toggle]'
      );
      if (isInteractive) return;

      resizeBottomGapRef.current = Math.max(
        window.innerHeight - dialogRect.bottom,
        0
      );

      e.preventDefault();
      e.stopPropagation();

      const currentHeight = customHeight ?? dialogRect.height;
      if (
        !historyInitialHeightRef.current ||
        historyInitialHeightRef.current < HISTORY_DEFAULT_MIN_HEIGHT
      ) {
        historyInitialHeightRef.current = currentHeight;
      }

      resizeStartRef.current = {
        mouseY: e.clientY,
        startHeight: currentHeight,
      };
      hasDraggedRef.current = false;
      setIsResizing(true);
    },
    [showHistory, isMaximized, customHeight]
  );

  // 调整高度移动和结束处理
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;

      const deltaY = resizeStartRef.current.mouseY - e.clientY; // 向上拖拽增加高度

      // 只有移动超过 3px 才算真正调整
      if (!hasDraggedRef.current && Math.abs(deltaY) > 3) {
        hasDraggedRef.current = true;
      }

      if (!hasDraggedRef.current) return;

      let newHeight = resizeStartRef.current.startHeight + deltaY;

      // 限制高度范围
      const minHeight = HISTORY_DEFAULT_MIN_HEIGHT; // 最小高度 320px
      const maxHeight = window.innerHeight - 32; // 最大高度：视口高度减去上下边距
      newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

      setCustomHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
      // 调整后短暂延迟重置标记，阻止后续点击事件
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 100);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // 输入框高度自适应逻辑
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      // 限制最大高度为 260px
      textarea.style.height = `${Math.min(scrollHeight, 260)}px`;
    }
  }, [currentInput]);

  useEffect(() => {
    if (!currentInput && textareaRef.current) {
      textareaRef.current.scrollTop = 0;
    }
  }, [currentInput]);

  const ensureInputVisible = useCallback(() => {
    if (!isVisible) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    const hasSelection = selectionStart !== selectionEnd;
    const isCaretNearEnd =
      !hasSelection && textarea.value.length - selectionEnd <= 80;
    const hiddenBottom =
      textarea.scrollHeight - textarea.clientHeight - textarea.scrollTop;

    if (isCaretNearEnd && hiddenBottom > 4) {
      textarea.scrollTop = textarea.scrollHeight;
    }

    const inputContainer = inputAreaRef.current;
    if (inputContainer && typeof window !== "undefined") {
      const rect = inputContainer.getBoundingClientRect();
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight || 0;
      if (rect.bottom > viewportHeight - 12) {
        inputContainer.scrollIntoView({
          block: "end",
          inline: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [isVisible]);

  const scheduleEnsureInputVisible = useCallback(() => {
    if (typeof window === "undefined") {
      ensureInputVisible();
      return;
    }
    if (ensureInputVisibleRafRef.current !== null) {
      cancelAnimationFrame(ensureInputVisibleRafRef.current);
    }
    ensureInputVisibleRafRef.current = requestAnimationFrame(() => {
      ensureInputVisibleRafRef.current = null;
      ensureInputVisible();
    });
  }, [ensureInputVisible]);

  useEffect(() => {
    if (!isVisible) return;
    scheduleEnsureInputVisible();
  }, [currentInput, isVisible, scheduleEnsureInputVisible]);

  const setHistoryVisibility = useCallback(
    (visible: boolean, manual = false) => {
      if (visible && isHistoryLocked) return;
      setShowHistory(visible);
      if (manual) {
        setManuallyClosedHistory(!visible);
      } else if (visible) {
        setManuallyClosedHistory(false);
      }
    },
    [isHistoryLocked, setShowHistory, setManuallyClosedHistory]
  );

  // 退出最大化时自动收起历史面板，确保还原为紧凑视图
  useEffect(() => {
    const wasMaximized = prevIsMaximizedRef.current;
    prevIsMaximizedRef.current = isMaximized;
    if (wasMaximized && !isMaximized) {
      setHistoryVisibility(false, false);
    }
  }, [isMaximized, setHistoryVisibility]);

  // 当库面板打开时，如果历史记录也打开着，则自动关闭历史记录以避免重叠
  useEffect(() => {
    if (showLibraryPanel && showHistory) {
      setHistoryVisibility(false, true);
    }
  }, [showLibraryPanel, showHistory, setHistoryVisibility]);

  const setMaximizedSafely = useCallback(
    (next: boolean) => {
      if (next && isHistoryLocked) return;
      setIsMaximized(next);
    },
    [isHistoryLocked, setIsMaximized]
  );

  const toggleMaximize = useCallback(() => {
    const next = !isMaximizedRef.current;
    if (next && isHistoryLocked) return;
    setIsMaximized(next);
  }, [isHistoryLocked, setIsMaximized]);

  const handleCollapseToCompact = useCallback(() => {
    if (!showHistory) return;
    setHistoryVisibility(false, true);
    setMaximizedSafely(false);
  }, [setHistoryVisibility, setMaximizedSafely, showHistory]);

  // 上锁后立即收起历史面板并退出最大化
  useEffect(() => {
    if (!isHistoryLocked) return;
    if (showHistory) {
      setHistoryVisibility(false, true);
    }
    if (isMaximized) {
      setMaximizedSafely(false);
    }
  }, [
    isHistoryLocked,
    isMaximized,
    setHistoryVisibility,
    setMaximizedSafely,
    showHistory,
  ]);

  const toggleMaximizeRef = useRef(toggleMaximize);
  useEffect(() => {
    toggleMaximizeRef.current = toggleMaximize;
  }, [toggleMaximize]);

  const handleToggleHistoryLock = useCallback(() => {
    setIsHistoryLocked((prev) => {
      const next = !prev;
      if (next) {
        setHistoryVisibility(false, true);
        setMaximizedSafely(false);
      }
      return next;
    });
  }, [setHistoryVisibility, setMaximizedSafely]);

  const handleSwitchSession = useCallback(
    async (nextSessionId?: string) => {
      if (!nextSessionId || nextSessionId === currentSessionId) return;
      try {
        await switchSession(nextSessionId);
        setHistoryVisibility(true, false);
      } catch (error) {
        console.error("❌ 切换会话失败:", error);
      }
    },
    [currentSessionId, switchSession, setHistoryVisibility]
  );

  const handleCreateSession = useCallback(async () => {
    if (creatingSession) return;
    try {
      setCreatingSession(true);
      await createSession();
      setHistoryVisibility(true, false);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
      }, 0);
    } catch (error) {
      console.error("❌ 创建新会话失败:", error);
    } finally {
      setCreatingSession(false);
    }
  }, [createSession, creatingSession, setHistoryVisibility]);

  const currentSession =
    sessions.find((session) => session.sessionId === currentSessionId) ?? null;

  const formatSessionRelativeTime = useCallback(
    (value?: Date | string | number | null) => {
      if (!value) return "";
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return "";

      const diffMs = Date.now() - date.getTime();
      if (diffMs < 60 * 1000) return "刚刚";

      const minuteMs = 60 * 1000;
      const hourMs = 60 * minuteMs;
      const dayMs = 24 * hourMs;
      const weekMs = 7 * dayMs;
      const monthMs = 30 * dayMs;
      const yearMs = 365 * dayMs;

      if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)} 分钟前`;
      if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)} 小时前`;
      if (diffMs < weekMs) return `${Math.floor(diffMs / dayMs)} 天前`;
      if (diffMs < monthMs) return `${Math.floor(diffMs / weekMs)} 周前`;
      if (diffMs < yearMs) return `${Math.floor(diffMs / monthMs)} 个月前`;
      return `${Math.floor(diffMs / yearMs)} 年前`;
    },
    []
  );

  // 面板外点击关闭
  useEffect(() => {
    if (!isPromptPanelOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (promptPanelRef.current && promptPanelRef.current.contains(target))
        return;
      if (promptButtonRef.current && promptButtonRef.current.contains(target))
        return;
      setIsPromptPanelOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isPromptPanelOpen]);

  // 智能历史记录显示：改为默认关闭，只有用户点击才展开

  // 自动滚动到最新消息
  useEffect(() => {
    if (
      (showHistory || isMaximized) &&
      historyRef.current &&
      (messages.length > 0 || isStreaming)
    ) {
      // 延迟滚动，确保DOM已更新
      const timer = setTimeout(() => {
        if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showHistory, messages.length, isMaximized, isStreaming, streamingText]);

  // 自动聚焦到输入框
  useEffect(() => {
    if (isVisible && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isVisible]);

  // 取消自动关闭对话框功能 - AI生图完成后保持对话框打开
  // useEffect(() => {
  //   let closeTimer: NodeJS.Timeout | null = null;

  //   const handleImageAddedToCanvas = () => {
  //     // 只有在AI生图完成后（progress为100）且对话框可见且没有错误时才关闭
  //     if (isVisible &&
  //         !generationStatus.isGenerating &&
  //         generationStatus.progress === 100 &&
  //         generationStatus.error === null) {
  //       // 清除之前的定时器
  //       if (closeTimer) {
  //         clearTimeout(closeTimer);
  //       }

  //       // 延迟0.1秒关闭，快速响应让用户去看图片
  //       closeTimer = setTimeout(() => {
  //         hideDialog();
  //         console.log('🎯 AI生图完成，对话框已自动关闭');
  //         closeTimer = null;
  //       }, 100);
  //     }
  //   };

  //   // 监听图片上传事件
  //   window.addEventListener('triggerQuickImageUpload', handleImageAddedToCanvas);

  //   return () => {
  //     window.removeEventListener('triggerQuickImageUpload', handleImageAddedToCanvas);
  //     // 清理定时器
  //     if (closeTimer) {
  //       clearTimeout(closeTimer);
  //     }
  //   };
  // }, [isVisible, generationStatus.isGenerating, generationStatus.progress, generationStatus.error, hideDialog]);

  // 切换历史记录显示
  const toggleHistory = (manualOrEvent?: boolean | React.SyntheticEvent) => {
    const manual = typeof manualOrEvent === "boolean" ? manualOrEvent : true;
    const next = !showHistory;
    if (isHistoryLocked && next) return;
    setHistoryVisibility(next, manual);
  };

  const handleHistorySurfaceClick = (
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    // 如果刚刚拖拽过，不触发点击事件
    if (hasDraggedRef.current) return;
    if (isHistoryLocked) return;
    if (isMaximized) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const interactive = target.closest(
      'textarea, input, button, a, label, select, [role="button"], [data-history-ignore-toggle]'
    );
    if (interactive) return;

    // 只在顶部横线区域（20px）触发历史面板展开/收起
    const dialog = dialogRef.current;
    if (!dialog) return;
    const dialogRect = dialog.getBoundingClientRect();
    const clickY = event.clientY;
    const isInTopEdge =
      clickY >= dialogRect.top && clickY <= dialogRect.top + 20;
    if (!isInTopEdge) return;

    if (historySingleClickTimerRef.current) {
      window.clearTimeout(historySingleClickTimerRef.current);
    }

    historySingleClickTimerRef.current = window.setTimeout(() => {
      if (!suppressHistoryClickRef.current) {
        toggleHistory(true);
      }
      suppressHistoryClickRef.current = false;
      historySingleClickTimerRef.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (historySingleClickTimerRef.current) {
        window.clearTimeout(historySingleClickTimerRef.current);
      }
    };
  }, []);

  // 检测长时间停留在“准备中”的生成任务，自动终止以防彩雾长驻
  useEffect(() => {
    if (messages.length === 0) return;
    const now = Date.now();
    const STALE_MS = 45_000; // 45s 视为超时
    const STALE_PROGRESS = 10; // 只处理早期阶段的卡住任务
    const hydrationCutoff = hydrationTimestampRef.current;

    messages.forEach((msg) => {
      if (msg.type !== "ai") return;
      const status = msg.generationStatus;
      if (!status?.isGenerating) return;

      const ts =
        msg.timestamp instanceof Date
          ? msg.timestamp.getTime()
          : new Date(msg.timestamp).getTime();
      if (!Number.isFinite(ts)) return;
      // 刷新前的旧任务不再自动标记为“已停止”
      if (ts <= hydrationCutoff) return;

      const isPreparing =
        (status.stage && status.stage.includes("准备")) ||
        (status.progress ?? 0) <= STALE_PROGRESS;
      const isStale = now - ts > STALE_MS;

      if (isPreparing && isStale) {
        updateMessageStatus(msg.id, {
          isGenerating: false,
          stage: "已终止",
          error: status.error ?? "任务已停止",
        });
      }
    });
  }, [messages, updateMessageStatus]);

  // 刷新后清理旧任务遗留的“任务已停止”提示
  useEffect(() => {
    if (messages.length === 0) return;
    const hydrationCutoff = hydrationTimestampRef.current;

    messages.forEach((msg) => {
      if (msg.type !== "ai") return;
      const status = msg.generationStatus;
      if (!status?.error) return;

      const ts =
        msg.timestamp instanceof Date
          ? msg.timestamp.getTime()
          : new Date(msg.timestamp).getTime();
      if (!Number.isFinite(ts)) return;
      if (ts > hydrationCutoff) return;

      if (status.error === "任务已停止") {
        updateMessageStatus(msg.id, {
          error: null,
          stage: undefined,
        });
      }
    });
  }, [messages, updateMessageStatus]);

  // 订阅AI流式进度事件，按增量渲染文本（仅限"文本对话"）
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<AIStreamProgressEvent>).detail;
      if (!detail || detail.operationType !== "文本对话") return;
      if (detail.phase === "starting") {
        setIsStreaming(true);
        setStreamingText("");
      } else if (detail.phase === "text_delta" && detail.deltaText) {
        setIsStreaming(true);
        setStreamingText((prev) => prev + detail.deltaText);
      } else if (detail.phase === "completed" || detail.phase === "error") {
        // 完成或出错时停止流式展示；最终内容会在消息历史中以正式消息出现
        setIsStreaming(false);
        // 可选：若未能落盘为正式消息，保留 fullText 以防闪烁
        // 当前逻辑由 generateTextResponse 在完成后 addMessage
      }
    };
    window.addEventListener("aiStreamProgress", handler as EventListener);
    return () =>
      window.removeEventListener("aiStreamProgress", handler as EventListener);
  }, []);

  // 🔥 监听消息变化，当 AI 消息生成完成时，减少任务计数（使用 ref 追踪已处理消息 ID）
  useEffect(() => {
    // 遍历所有消息，找出已完成的 AI 消息（生成状态为 false 且有图像或内容）
    const completedAIMessages = messages.filter(
      (msg) =>
        msg.type === "ai" &&
        !msg.generationStatus?.isGenerating &&
        (msg.imageData || msg.content)
    );

    // 遍历已完成的消息，检查是否有未被处理过的消息
    completedAIMessages.forEach((msg) => {
      // 如果这个消息 ID 还没有被标记为已处理
      if (!processedMessageIdsRef.current.has(msg.id)) {
        // 标记为已处理
        processedMessageIdsRef.current.add(msg.id);
        // 减少计数
        setPendingTaskCount((prev) => Math.max(0, prev - 1));
      }
    });
  }, [messages]);

  const createOwnedObjectUrl = useCallback((file: File): string => {
    const url = URL.createObjectURL(file);
    ownedObjectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeOwnedObjectUrl = useCallback((url?: string | null) => {
    if (!url || typeof url !== "string") return;
    if (!url.startsWith("blob:")) return;
    if (!ownedObjectUrlsRef.current.has(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch {}
    ownedObjectUrlsRef.current.delete(url);
  }, []);

  // 组件卸载时，回收本组件创建的所有 ObjectURL，避免内存泄漏
  useEffect(() => {
    return () => {
      ownedObjectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      ownedObjectUrlsRef.current.clear();
    };
  }, []);

  const handleRemoveBlendImage = useCallback(
    (index: number) => {
      const url = sourceImagesForBlending[index];
      revokeOwnedObjectUrl(url);
      removeImageFromBlending(index);
    },
    [removeImageFromBlending, revokeOwnedObjectUrl, sourceImagesForBlending]
  );

  const clearBlendImagesWithRevoke = useCallback(() => {
    sourceImagesForBlending.forEach((url) => revokeOwnedObjectUrl(url));
    clearImagesForBlending();
  }, [clearImagesForBlending, revokeOwnedObjectUrl, sourceImagesForBlending]);

  // 当 Store/消息不再引用某个 blob URL 时，自动回收（避免由流程自动清空造成的“无人 revoke”泄漏）
  useEffect(() => {
    const referenced = new Set<string>();
    const addIfBlob = (value?: unknown) => {
      if (typeof value !== "string") return;
      if (!value.startsWith("blob:")) return;
      referenced.add(value);
    };

    addIfBlob(sourceImageForEditing);
    addIfBlob(sourceImageForAnalysis);
    sourceImagesForBlending.forEach((v) => addIfBlob(v));

    // ContextManager 可能会缓存“最新图像”（例如用户刚上传的 blob URL）
    // 如果这里不算作引用，后续 UI 清空 sourceImage 时会误 revoke，导致“编辑最新图”失效
    try {
      const cached = contextManager.getCurrentContext()?.cachedImages;
      addIfBlob(cached?.latest);
    } catch {}

    // 消息里可能暂存 sourceImageData/sourceImagesData（用于回显/重发），避免误 revoke
    messages.forEach((msg) => {
      addIfBlob((msg as any).sourceImageData);
      const list = (msg as any).sourceImagesData;
      if (Array.isArray(list)) {
        list.forEach((v) => addIfBlob(v));
      }
      addIfBlob((msg as any).imageData);
      addIfBlob((msg as any).thumbnail);
    });

    const toRevoke: string[] = [];
    ownedObjectUrlsRef.current.forEach((url) => {
      if (!referenced.has(url)) {
        toRevoke.push(url);
      }
    });

    toRevoke.forEach((url) => revokeOwnedObjectUrl(url));
  }, [
    messages,
    revokeOwnedObjectUrl,
    sourceImageForAnalysis,
    sourceImageForEditing,
    sourceImagesForBlending,
  ]);

  // 处理粘贴事件 - 支持从剪贴板粘贴图片
  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      // 检查剪贴板中是否有图片
      const items = clipboardData.items;
      const imageItems: DataTransferItem[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          imageItems.push(item);
        }
      }

      // 如果没有图片，让默认行为处理（粘贴文本）
      if (imageItems.length === 0) return;

      // 阻止默认粘贴行为
      event.preventDefault();

      // 如果当前已有图片，则添加到融合模式
      const hasExistingImages =
        sourceImageForEditing ||
        sourceImagesForBlending.length > 0 ||
        sourceImageForAnalysis;

      if (hasExistingImages) {
        // 已有图片：转换为融合模式或添加到融合模式
        if (sourceImageForEditing) {
          addImageForBlending(sourceImageForEditing);
          setSourceImageForEditing(null);
        }
        if (sourceImageForAnalysis) {
          addImageForBlending(sourceImageForAnalysis);
          setSourceImageForAnalysis(null);
        }

        // 添加粘贴的图片到融合数组
        imageItems.forEach((item) => {
          const file = item.getAsFile();
          if (!file) return;
          const objectUrl = createOwnedObjectUrl(file);
          addImageForBlending(objectUrl);
        });
      } else {
        // 没有现有图片：根据粘贴数量决定模式
        if (imageItems.length === 1) {
          // 单图：设置为编辑模式
          const file = imageItems[0].getAsFile();
          if (file) {
            const objectUrl = createOwnedObjectUrl(file);
            setSourceImageForEditing(objectUrl);
          }
        } else {
          // 多图：设置为融合模式
          imageItems.forEach((item) => {
            const file = item.getAsFile();
            if (!file) return;
            const objectUrl = createOwnedObjectUrl(file);
            addImageForBlending(objectUrl);
          });
        }
      }

      console.log("📋 从剪贴板粘贴了", imageItems.length, "张图片");
    },
    [
      sourceImageForEditing,
      sourceImagesForBlending,
      sourceImageForAnalysis,
      addImageForBlending,
      createOwnedObjectUrl,
      setSourceImageForEditing,
      setSourceImageForAnalysis,
    ]
  );

  // 统一的图片上传处理
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // 如果当前已有图片，则添加到融合模式
    const hasExistingImages =
      sourceImageForEditing ||
      sourceImagesForBlending.length > 0 ||
      sourceImageForAnalysis;

    if (hasExistingImages) {
      // 已有图片：转换为融合模式或添加到融合模式
      if (sourceImageForEditing) {
        // 将单图编辑转换为多图融合
        addImageForBlending(sourceImageForEditing);
        setSourceImageForEditing(null);
      }
      if (sourceImageForAnalysis) {
        // 将分析图片转换为多图融合
        addImageForBlending(sourceImageForAnalysis);
        setSourceImageForAnalysis(null);
      }

      // 添加新选择的图片到融合数组
      Array.from(files).forEach((file) => {
        const objectUrl = createOwnedObjectUrl(file);
        addImageForBlending(objectUrl);
      });
    } else {
      // 没有现有图片：根据选择数量决定模式
      if (files.length === 1) {
        // 单图：默认设置为编辑模式（AI会智能判断是编辑还是分析）
        const objectUrl = createOwnedObjectUrl(files[0]);
        setSourceImageForEditing(objectUrl);
      } else {
        // 多图：设置为融合模式
        Array.from(files).forEach((file) => {
          const objectUrl = createOwnedObjectUrl(file);
          addImageForBlending(objectUrl);
        });
      }
    }

    // 清空input值，允许重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleResendFromInfo = useCallback(
    (info: ResendInfo) => {
      console.log("🔁 重新填充历史消息", info);
      setSourceImageForAnalysis(null);

      if (info.type === "edit") {
        clearBlendImagesWithRevoke();
        revokeOwnedObjectUrl(sourceImageForEditing);
        setSourceImageForEditing(info.sourceImage);
      } else if (info.type === "blend") {
        revokeOwnedObjectUrl(sourceImageForEditing);
        setSourceImageForEditing(null);
        clearBlendImagesWithRevoke();
        info.sourceImages.forEach((imageData) =>
          addImageForBlending(imageData)
        );
      }

      setCurrentInput(info.prompt);

      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [
      addImageForBlending,
      clearBlendImagesWithRevoke,
      setCurrentInput,
      setSourceImageForAnalysis,
      setSourceImageForEditing,
      revokeOwnedObjectUrl,
      sourceImageForEditing,
    ]
  );

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      if (typeof window === "undefined") {
        if (type === "error") {
          console.error(message);
        } else {
          console.log(message);
        }
        return;
      }
      try {
        window.dispatchEvent(
          new CustomEvent("toast", { detail: { message, type } })
        );
      } catch (error) {
        if (type === "error") {
          alert(message);
        } else {
          console.log(message);
        }
      }
    },
    []
  );

  const handleCopyMessage = useCallback(
    async (message: ChatMessage) => {
      const text = message.content?.trim();
      if (!text) {
        showToast("没有可复制的内容", "error");
        return;
      }
      try {
        const canUseClipboardAPI =
          typeof navigator !== "undefined" &&
          Boolean(navigator?.clipboard?.writeText);
        if (canUseClipboardAPI) {
          await navigator.clipboard.writeText(text);
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          textArea.style.left = "-9999px";
          textArea.style.top = "-9999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand("copy");
          document.body.removeChild(textArea);
        }
        showToast("已复制消息内容");
      } catch (error) {
        console.error("复制消息失败", error);
        showToast("复制失败，请手动复制", "error");
      }
    },
    [showToast]
  );

  const handleResendMessage = useCallback(
    (message: ChatMessage, resendInfo: ResendInfo | null) => {
      if (resendInfo) {
        handleResendFromInfo(resendInfo);
        showToast("已将内容填回输入框，请手动发送");
        return;
      }

      const content = (message.content || "").trim();
      clearBlendImagesWithRevoke();
      revokeOwnedObjectUrl(sourceImageForEditing);
      setSourceImageForEditing(null);
      setSourceImageForAnalysis(null);

      if (message.sourceImagesData && message.sourceImagesData.length > 0) {
        message.sourceImagesData.forEach((imageData) => {
          if (imageData) addImageForBlending(imageData);
        });
      } else if (message.sourceImageData) {
        if (content.startsWith("分析图片")) {
          setSourceImageForAnalysis(message.sourceImageData);
        } else {
          setSourceImageForEditing(message.sourceImageData);
        }
      }

      setCurrentInput(message.content || "");
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      showToast("已将内容填回输入框，可编辑后发送");
    },
    [
      addImageForBlending,
      clearBlendImagesWithRevoke,
      handleResendFromInfo,
      setCurrentInput,
      setSourceImageForAnalysis,
      setSourceImageForEditing,
      showToast,
      revokeOwnedObjectUrl,
      sourceImageForEditing,
    ]
  );

  // 直接重新发送消息（不填入输入框，直接请求AI，内部处理图片数据但不显示在UI上）
  const handleDirectResend = useCallback(
    async (message: ChatMessage, resendInfo: ResendInfo | null) => {
      if (generationStatus.isGenerating || sendInFlightRef.current) {
        showToast("正在生成中，请稍候", "error");
        return;
      }

      // 准备发送的内容
      const rawContent = (message.content || "").trim();
      if (!rawContent) {
        showToast("没有可发送的内容", "error");
        return;
      }
      sendInFlightRef.current = true;

      // 🔥 立即增加待处理任务计数
      setPendingTaskCount((prev) => prev + 1);

      // 🔥 清空所有 UI 状态中的源图像，确保不会在对话框上方显示图片
      clearBlendImagesWithRevoke();
      revokeOwnedObjectUrl(sourceImageForEditing);
      setSourceImageForEditing(null);
      setSourceImageForAnalysis(null);

      try {
        // 根据 resendInfo 或消息内容判断类型，直接调用相应方法
        if (resendInfo) {
          if (resendInfo.type === "edit" && resendInfo.sourceImage) {
            // 编辑图像：直接调用 editImage，不设置 UI 状态
            await editImage(resendInfo.prompt, resendInfo.sourceImage, false);
            showToast("已重新发送");
            return;
          } else if (resendInfo.type === "blend" && resendInfo.sourceImages?.length >= 2) {
            // 融合图像：直接调用 blendImages，不设置 UI 状态
            await blendImages(resendInfo.prompt, resendInfo.sourceImages);
            showToast("已重新发送");
            return;
          }
        }

        // 检查消息中的图片数据
        if (message.sourceImagesData && message.sourceImagesData.length >= 2) {
          // 融合图像
          const blendPrompt = extractPromptFromContent(rawContent, "融合图像") || rawContent;
          await blendImages(blendPrompt, message.sourceImagesData);
          showToast("已重新发送");
          return;
        }

        if (message.sourceImageData) {
          if (rawContent.startsWith("分析图片")) {
            // 分析图像
            const analyzePrompt = rawContent.replace(/^分析图片[：:]\s*/, "").trim() || rawContent;
            await analyzeImage(analyzePrompt, message.sourceImageData);
            showToast("已重新发送");
            return;
          } else {
            // 编辑图像
            const editPrompt = extractPromptFromContent(rawContent, "编辑图像") || rawContent;
            await editImage(editPrompt, message.sourceImageData, false);
            showToast("已重新发送");
            return;
          }
        }

        // 没有图片数据，发送纯文本
        await processUserInput(rawContent);
        showToast("已重新发送");
      } catch (error) {
        console.error("重新发送失败:", error);
        showToast("重新发送失败", "error");
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [
      analyzeImage,
      blendImages,
      clearBlendImagesWithRevoke,
      editImage,
      generationStatus.isGenerating,
      processUserInput,
      setSourceImageForAnalysis,
      setSourceImageForEditing,
      showToast,
      revokeOwnedObjectUrl,
      sourceImageForEditing,
    ]
  );

  const renderUserMessageActions = (
    message: ChatMessage,
    resendInfo: ResendInfo | null
  ) => {
    if (message.type !== "user") return null;
    const hasText = Boolean(
      message.content && message.content.trim().length > 0
    );
    const isGenerating = generationStatus.isGenerating;
    return (
      <div className='mt-1.5 flex items-center justify-start gap-1'>
        <button
          type='button'
          disabled={!hasText}
          className={cn(
            "p-1.5 rounded-md text-black transition-colors hover:bg-gray-100/50",
            !hasText && "opacity-40 cursor-not-allowed hover:bg-transparent"
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (hasText) {
              void handleCopyMessage(message);
            }
          }}
          title={
            hasText
              ? lt("复制", "Copy")
              : lt("暂无可复制的文本", "No text to copy")
          }
        >
          <Copy className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          disabled={!hasText || isGenerating}
          className={cn(
            "p-1.5 rounded-md text-black transition-colors hover:bg-gray-100/50",
            (!hasText || isGenerating) && "opacity-40 cursor-not-allowed hover:bg-transparent"
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (hasText && !isGenerating) {
              void handleDirectResend(message, resendInfo);
            }
          }}
          title={
            isGenerating
              ? lt("正在生成中", "Generating")
              : lt("重新发送", "Resend")
          }
        >
          <RotateCcw className='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          disabled={!hasText}
          className={cn(
            "p-1.5 rounded-md text-black transition-colors hover:bg-gray-100/50",
            !hasText && "opacity-40 cursor-not-allowed hover:bg-transparent"
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (hasText) {
              handleResendMessage(message, resendInfo);
            }
          }}
          title={lt("重新编辑", "Edit again")}
        >
          <Pencil className='h-3.5 w-3.5' />
        </button>
      </div>
    );
  };

  const startPromptButtonLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsPromptPanelOpen(true);
    }, LONG_PRESS_DURATION);
  };

  const cancelPromptButtonLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePromptButtonPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (generationStatus.isGenerating || autoOptimizing) return;
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    longPressTriggeredRef.current = false;
    startPromptButtonLongPress();
  };

  const handlePromptButtonPointerUp = () => {
    if (generationStatus.isGenerating || autoOptimizing) return;
    cancelPromptButtonLongPress();
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    setAutoOptimizeEnabled((prev) => {
      const next = !prev;
      if (!next) {
        // 关闭功能时，同时隐藏面板
        setIsPromptPanelOpen(false);
      }
      return next;
    });
  };

  const handlePromptButtonPointerLeave = () => {
    cancelPromptButtonLongPress();
    longPressTriggeredRef.current = false;
  };

  const handlePromptButtonPointerCancel = () => {
    cancelPromptButtonLongPress();
    longPressTriggeredRef.current = false;
  };

  // 计算比例面板定位：以输入区域为锚点，优先显示在输入框下方，空间不足时放在上方
  useLayoutEffect(() => {
    if (!isAspectOpen) return;
    const update = () => {
      const panelEl = aspectPanelRef.current;
      const anchorEl = inputAreaRef.current || dialogRef.current;
      if (!panelEl || !anchorEl) return;

      const w = panelEl.offsetWidth;
      const h = panelEl.offsetHeight;
      const offset = isMaximized ? 12 : 20;

      const anchorRect = anchorEl.getBoundingClientRect();
      // 默认显示在输入区域下方
      let top = anchorRect.bottom + offset;
      let left = anchorRect.left + anchorRect.width / 2 - w / 2;

      // 下方空间不足时切换到上方
      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - h - offset);
      }

      // 屏幕边缘保护
      top = Math.min(top, window.innerHeight - h - 8);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setAspectPos({ top, left });
      setAspectReady(true);
    };
    const r = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isAspectOpen, isMaximized]);

  // 计算视频尺寸面板定位
  useLayoutEffect(() => {
    if (!isVideoAspectOpen) return;
    const update = () => {
      const panelEl = videoAspectPanelRef.current;
      const anchorEl = inputAreaRef.current || dialogRef.current;
      if (!panelEl || !anchorEl) return;

      const w = panelEl.offsetWidth;
      const h = panelEl.offsetHeight;
      const offset = isMaximized ? 12 : 20;

      const anchorRect = anchorEl.getBoundingClientRect();
      let top = anchorRect.bottom + offset;
      let left = anchorRect.left + anchorRect.width / 2 - w / 2;

      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - h - offset);
      }

      top = Math.min(top, window.innerHeight - h - 8);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setVideoAspectPos({ top, left });
      setVideoAspectReady(true);
    };
    const r = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isVideoAspectOpen, isMaximized]);

  // 计算视频时长面板定位
  useLayoutEffect(() => {
    if (!isVideoDurationOpen) return;
    const update = () => {
      const panelEl = videoDurationPanelRef.current;
      const anchorEl = inputAreaRef.current || dialogRef.current;
      if (!panelEl || !anchorEl) return;

      const w = panelEl.offsetWidth;
      const h = panelEl.offsetHeight;
      const offset = isMaximized ? 12 : 20;

      const anchorRect = anchorEl.getBoundingClientRect();
      let top = anchorRect.bottom + offset;
      let left = anchorRect.left + anchorRect.width / 2 - w / 2;

      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - h - offset);
      }

      top = Math.min(top, window.innerHeight - h - 8);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setVideoDurationPos({ top, left });
      setVideoDurationReady(true);
    };
    const r = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isVideoDurationOpen, isMaximized]);

  // 计算图像尺寸面板定位：以输入区域为锚点，优先显示在输入框下方，空间不足时放在上方
  useLayoutEffect(() => {
    if (
      !isImageSizeOpen ||
      (aiProvider !== "gemini-pro" &&
        aiProvider !== "banana" &&
        aiProvider !== "banana-2.5" &&
        aiProvider !== "banana-3.1")
    )
      return;
    const update = () => {
      const panelEl = imageSizePanelRef.current;
      const anchorEl = inputAreaRef.current || dialogRef.current;
      if (!panelEl || !anchorEl) return;

      const w = panelEl.offsetWidth;
      const h = panelEl.offsetHeight;
      const offset = isMaximized ? 12 : 20;

      const anchorRect = anchorEl.getBoundingClientRect();
      // 默认显示在输入区域下方
      let top = anchorRect.bottom + offset;
      let left = anchorRect.left + anchorRect.width / 2 - w / 2;

      // 下方空间不足时切换到上方
      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, anchorRect.top - h - offset);
      }

      top = Math.min(top, window.innerHeight - h - 8);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setImageSizePos({ top, left });
      setImageSizeReady(true);
    };
    const r = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isImageSizeOpen, aiProvider, isMaximized]);

  // 计算思考级别面板定位：以输入框为锚点，优先显示在输入框下方，空间不足时放在上方
  useLayoutEffect(() => {
    if (
      !isThinkingLevelOpen ||
      (aiProvider !== "gemini-pro" &&
        aiProvider !== "banana" &&
        aiProvider !== "banana-2.5" &&
        aiProvider !== "banana-3.1")
    )
      return;
    const update = () => {
      const panelEl = thinkingLevelPanelRef.current;
      const inputEl = inputAreaRef.current;
      if (!panelEl || !inputEl) return;

      const w = panelEl.offsetWidth;
      const h = panelEl.offsetHeight;
      const offset = isMaximized ? 12 : 20; // 提高弹层距离，避免贴近输入框

      const inputRect = inputEl.getBoundingClientRect();
      // 默认显示在输入框下方
      let top = inputRect.bottom + offset;
      let left = inputRect.left + inputRect.width / 2 - w / 2;

      // 若底部空间不足，则展示在输入框上方
      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, inputRect.top - h - offset);
      }

      top = Math.min(top, window.innerHeight - h - 8);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

      setThinkingLevelPos({ top, left });
      setThinkingLevelReady(true);
    };
    const r = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isThinkingLevelOpen, aiProvider, isMaximized]);

  // 点击外部关闭比例面板
  useEffect(() => {
    if (!isAspectOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (aspectPanelRef.current?.contains(t)) return;
      if (aspectButtonRef.current?.contains(t as Node)) return;
      setIsAspectOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [isAspectOpen]);

  // 点击外部关闭视频尺寸面板
  useEffect(() => {
    if (!isVideoAspectOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (videoAspectPanelRef.current?.contains(t)) return;
      if (videoAspectButtonRef.current?.contains(t as Node)) return;
      setIsVideoAspectOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [isVideoAspectOpen]);

  // 点击外部关闭视频时长面板
  useEffect(() => {
    if (!isVideoDurationOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (videoDurationPanelRef.current?.contains(t)) return;
      if (videoDurationButtonRef.current?.contains(t as Node)) return;
      setIsVideoDurationOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [isVideoDurationOpen]);

  // 点击外部关闭图像尺寸面板
  useEffect(() => {
    if (!isImageSizeOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (imageSizePanelRef.current?.contains(t)) return;
      if (imageSizeButtonRef.current?.contains(t as Node)) return;
      setIsImageSizeOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [isImageSizeOpen]);

  // 点击外部关闭思考级别面板
  useEffect(() => {
    if (!isThinkingLevelOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (thinkingLevelPanelRef.current?.contains(t)) return;
      if (thinkingLevelButtonRef.current?.contains(t as Node)) return;
      setIsThinkingLevelOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [isThinkingLevelOpen]);

  useEffect(() => {
    if (shouldHideImageParamControls) {
      setIsAspectOpen(false);
      setIsImageSizeOpen(false);
      setIsThinkingLevelOpen(false);
      return;
    }
    setIsVideoAspectOpen(false);
    setIsVideoDurationOpen(false);
  }, [shouldHideImageParamControls]);

  const handlePromptSettingsChange = (next: PromptOptimizationSettings) => {
    setPromptSettings(next);
  };

  const handleApplyOptimizedToInput = (optimized: string) => {
    setCurrentInput(optimized);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
    setIsPromptPanelOpen(false);
    setAutoOptimizeEnabled(false);
  };

  const handleSendOptimizedFromPanel = async (optimized: string) => {
    if (generationStatus.isGenerating || autoOptimizing || sendInFlightRef.current) return;
    if (!isVisible) {
      showDialog();
    }
    const trimmed = optimized.trim();
    if (!trimmed) return;

    sendInFlightRef.current = true;
    try {
      setIsPromptPanelOpen(false);
      setAutoOptimizeEnabled(false);
      clearInput();
      await processUserInput(trimmed);
    } finally {
      sendInFlightRef.current = false;
    }
  };

  // 移除源图像
  const handleRemoveSourceImage = () => {
    revokeOwnedObjectUrl(sourceImageForEditing);
    setSourceImageForEditing(null);
  };

  const selectedImageCount = useMemo(() => {
    let count = 0;
    if (sourceImagesForBlending.length > 0) {
      count += sourceImagesForBlending.length;
    }
    if (sourceImageForEditing) {
      count += 1;
    }
    if (sourceImageForAnalysis) {
      count += 1;
    }
    return count;
  }, [
    sourceImagesForBlending,
    sourceImageForEditing,
    sourceImageForAnalysis,
  ]);

  const hasPdfForAnalysis = Boolean(sourcePdfForAnalysis);

  const getModeSupport = useCallback(
    (mode: ManualAIMode) => {
      const count = selectedImageCount;
      switch (mode) {
        case "auto":
          return { supported: true };
        case "text":
        case "generate":
        case "vector":
          return { supported: count === 0 };
        case "edit":
          return { supported: count === 1 };
        case "blend":
          if (count < 2) return { supported: false };
          if (
            isTencentStableBanana &&
            tencentBananaMaxRefCount !== null &&
            count > tencentBananaMaxRefCount
          ) {
            return { supported: false };
          }
          return { supported: true };
        case "analyze":
          if (isTencentStableBanana && !isTencentBananaAnalyzeSupported()) {
            return { supported: false };
          }
          if (hasPdfForAnalysis) {
            return { supported: count === 0 };
          }
          return { supported: count >= 1 };
        case "video":
          return { supported: count <= 1 };
        default:
          return { supported: true };
      }
    },
    [
      hasPdfForAnalysis,
      isTencentStableBanana,
      selectedImageCount,
      tencentBananaMaxRefCount,
    ]
  );

  const isManualModeSupported = useMemo(() => {
    if (manualAIMode === "auto") return true;
    return getModeSupport(manualAIMode).supported;
  }, [getModeSupport, manualAIMode]);

  const imageInputLimitWarning = useMemo(() => {
    if (!isTencentStableBanana || tencentBananaMaxRefCount === null) return null;
    if (selectedImageCount <= tencentBananaMaxRefCount) return null;
    return `稳定通道下当前模型最多支持${tencentBananaMaxRefCount}张参考图，请减少图片数量`;
  }, [
    isTencentStableBanana,
    selectedImageCount,
    tencentBananaMaxRefCount,
  ]);

  const manualModeWarning = useMemo(() => {
    if (manualAIMode === "auto") return null;
    if (isManualModeSupported) return null;
    // 根据模式提供更清晰的提示
    if (manualAIMode === "edit") {
      return selectedImageCount === 0
        ? "Edit模式需要添加1张图片"
        : "Edit模式仅支持1张图片";
    }
    if (manualAIMode === "blend") {
      if (
        isTencentStableBanana &&
        tencentBananaMaxRefCount !== null &&
        selectedImageCount > tencentBananaMaxRefCount
      ) {
        return `Blend模式在稳定通道下最多支持${tencentBananaMaxRefCount}张图片`;
      }
      return "Blend模式需要添加至少2张以上图片";
    }
    if (manualAIMode === "analyze") {
      if (isTencentStableBanana && !isTencentBananaAnalyzeSupported()) {
        return "稳定通道暂不支持Analysis，请切换到普通通道";
      }
      return hasPdfForAnalysis
        ? "PDF分析模式不支持同时添加图片"
        : "Analysis模式至少需要添加1张图片";
    }
    return `当前模式不支持${selectedImageCount}张图`;
  }, [
    hasPdfForAnalysis,
    isTencentStableBanana,
    isManualModeSupported,
    manualAIMode,
    selectedImageCount,
    tencentBananaMaxRefCount,
  ]);

  // 处理发送 - 使用AI智能工具选择
  const handleSend = async () => {
    const trimmedInput = currentInput.trim();
    if (
      !trimmedInput ||
      generationStatus.isGenerating ||
      autoOptimizing ||
      sendInFlightRef.current
    )
      return;

    if (imageInputLimitWarning) {
      showToast(imageInputLimitWarning, "error");
      return;
    }

    if (manualModeWarning) {
      showToast(manualModeWarning, "error");
      return;
    }
    sendInFlightRef.current = true;

    try {
      if (!isVisible) {
        showDialog();
      }

      // 🔥 发送消息时自动展开历史记录面板（非最大化模式下）
      if (!showHistory && !isMaximized) {
        setHistoryVisibility(true, false);
      }

      // 🔥 立即增加待处理任务计数（敲击回车的反馈）
      setPendingTaskCount((prev) => prev + 1);

      let promptToSend = trimmedInput;

      if (autoOptimizeEnabled) {
        setAutoOptimizing(true);
        try {
          const response = await promptOptimizationService.optimizePrompt({
            input: trimmedInput,
            language: promptSettings.language,
            tone: promptSettings.tone || undefined,
            focus: promptSettings.focus || undefined,
            lengthPreference: promptSettings.lengthPreference,
            aiProvider,
            model: textModel,
          });

          if (response.success && response.data) {
            promptToSend = response.data.optimizedPrompt;
            setCurrentInput(promptToSend);
          } else if (response.error) {
            console.warn(
              "⚠️ 提示词自动扩写失败，将使用原始提示词继续。",
              response.error
            );
          }
        } catch (error) {
          console.error(
            "❌ 自动扩写提示词时发生异常，将使用原始提示词继续。",
            error
          );
        } finally {
          setAutoOptimizing(false);
        }
      }

      clearInput();
      await processUserInput(promptToSend);
    } finally {
      sendInFlightRef.current = false;
    }
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const isModKey = e.ctrlKey || e.metaKey;
      if (sendShortcut === "enter") {
        // Enter 直接发送；Shift+Enter 继续换行
        if (!e.shiftKey) {
          e.preventDefault();
          handleSend();
          return;
        }
      } else if (sendShortcut === "mod-enter" && isModKey) {
        e.preventDefault();
        handleSend();
        return;
      }
    }
    if (e.key === "Escape") {
      hideDialog();
    }
  };

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentInput(e.target.value);
  };

  // 处理图片预览
  const handleImagePreview = (src: string, title: string) => {
    setPreviewImage({ src, title });
  };

  // 关闭图片预览
  const handleClosePreview = () => {
    setPreviewImage(null);
  };

  // 智能提示文字
  const getSmartPlaceholder = () => {
    const mode = getAIMode();
    switch (mode) {
      case "text":
        return t("chat.placeholder.text");
      case "blend":
        return t("chat.placeholder.blend", {
          count: sourceImagesForBlending.length,
        });
      case "edit":
        return t("chat.placeholder.edit");
      case "analyze":
        return t("chat.placeholder.analyze");
      case "video":
        return sourceImageForEditing
          ? t("chat.placeholder.videoWithSource")
          : t("chat.placeholder.video");
      case "vector":
        return t("chat.placeholder.vector");
      default:
        if (manualAIMode === "generate") {
          return t("chat.placeholder.generate");
        }
        return t("chat.placeholder.default");
    }
  };

  const shouldHidePlaceholder =
    pendingTaskCount > 0 ||
    messages.some(
      (msg) => msg.type === "ai" && msg.generationStatus?.isGenerating
    );

  const shouldToggleByDblClick = (
    clientX: number,
    clientY: number,
    target?: HTMLElement | null
  ) => {
    const card = dialogRef.current;
    if (!card) return false;

    const cardRect = card.getBoundingClientRect();
    const insideCard =
      clientX >= cardRect.left &&
      clientX <= cardRect.right &&
      clientY >= cardRect.top &&
      clientY <= cardRect.bottom;
    if (!insideCard) return false;

    // 在交互控件上双击不触发（避免影响输入、按钮、图片等交互）
    const interactive = target?.closest(
      'textarea, input, button, a, img, [role="textbox"], [contenteditable="true"]'
    );
    if (interactive) return false;

    return true;
  };

  const cancelPendingHistoryToggle = () => {
    if (historySingleClickTimerRef.current) {
      window.clearTimeout(historySingleClickTimerRef.current);
      historySingleClickTimerRef.current = null;
    }
  };

  // 外圈双击放大/缩小 - 放宽触发区域：在对话框任意非交互区域双击即可切换
  const handleOuterDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hasDraggedRef.current) return;
    if (
      !shouldToggleByDblClick(
        e.clientX,
        e.clientY,
        e.target as HTMLElement | null
      )
    )
      return;
    cancelPendingHistoryToggle();
    toggleMaximize();
  };

  // 捕获阶段拦截双击：阻止事件继续到画布，并根据状态触发缩放
  const handleDoubleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    // 如果刚刚拖拽过，不触发双击事件
    if (hasDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const card = dialogRef.current;
    if (!card) return;
    cancelPendingHistoryToggle();
    suppressHistoryClickRef.current = true;
    const target = e.target as HTMLElement;
    if (!shouldToggleByDblClick(e.clientX, e.clientY, target)) {
      suppressHistoryClickRef.current = false;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // 尽力阻断同层监听
    // @ts-ignore
    e.nativeEvent?.stopImmediatePropagation?.();

    toggleMaximize();
    suppressHistoryClickRef.current = false;
  };

  // 全局兜底：根据状态决定双击触发区域
  // 注意：Hook 需在任何 early return 之前声明，避免 Hook 次序不一致
  useEffect(() => {
    const onDbl = (ev: MouseEvent) => {
      // 如果刚刚拖拽过，不触发双击事件
      if (hasDraggedRef.current) return;
      const card = dialogRef.current;
      if (!card) return;
      const x = ev.clientX,
        y = ev.clientY;
      const r = card.getBoundingClientRect();
      const insideCard =
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

      const tgt = ev.target as HTMLElement;
      const shouldToggle = shouldToggleByDblClick(x, y, tgt);

      if (shouldToggle) {
        cancelPendingHistoryToggle();
        ev.stopPropagation();
        ev.preventDefault();
        toggleMaximizeRef.current?.();
      }

      // 外部屏蔽：卡片外侧一定范围内，阻止冒泡，防止 Flow 弹出节点面板
      const inOuterShield =
        x >= r.left - 24 &&
        x <= r.right + 24 &&
        y >= r.top - 24 &&
        y <= r.bottom + 24 &&
        !insideCard;
      if (inOuterShield) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    window.addEventListener("dblclick", onDbl, true);
    return () => window.removeEventListener("dblclick", onDbl, true);
  }, []);

  // 根据鼠标位置动态设置光标
  // 放在 early return 之前，避免 Hook 顺序问题
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const card = dialogRef.current;
      const cont = containerRef.current;
      if (!card || !cont) return;
      const x = ev.clientX,
        y = ev.clientY;
      const r = card.getBoundingClientRect();
      const insideCard =
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const target = ev.target as HTMLElement;
      const isLockButton = lockButtonRef.current?.contains(target);
      const interactive = !!target?.closest(
        'textarea, input, button, a, img, [role="textbox"], [contenteditable="true"], [data-history-ignore-toggle]'
      );
      const handleRect = collapseHandleRef.current?.getBoundingClientRect();
      const isInCollapseHandle =
        !!handleRect &&
        x >= handleRect.left &&
        x <= handleRect.right &&
        y >= handleRect.top &&
        y <= handleRect.bottom;

      // 顶部边缘调整高度区域（8px）
      const isInResizeZone =
        showHistory &&
        !isMaximized &&
        !interactive &&
        !isInCollapseHandle &&
        y >= r.top - 4 &&
        y <= r.top + 8 &&
        x >= r.left &&
        x <= r.right;

      // 顶部拖拽移动区域（20px，但不包括调整高度区域）
      const isInTopEdge =
        y >= r.top + 8 && y <= r.top + 20 && x >= r.left && x <= r.right;

      if (isInResizeZone) {
        // 顶部边缘：显示调整高度光标
        cont.style.cursor = "ns-resize";
        setHoverToggleZone(false);
      } else if (isInCollapseHandle) {
        cont.style.cursor =
          showHistory && !isMaximized ? "zoom-out" : "zoom-in";
        setHoverToggleZone(true);
      } else if (isLockButton) {
        cont.style.cursor = "";
        setHoverToggleZone(true);
      } else if (insideCard && !interactive) {
        if (isInTopEdge) {
          // 顶部区域：历史面板打开且非最大化时显示 move 光标（可拖拽）
          if (showHistory && !isMaximized) {
            cont.style.cursor = "move";
          } else if (isHistoryLocked) {
            cont.style.cursor = "not-allowed";
          } else {
            cont.style.cursor = isMaximized ? "zoom-out" : "zoom-in";
          }
        } else if (showHistory || isMaximized) {
          // 非顶部区域：历史面板展开或最大化时显示缩放光标
          cont.style.cursor = isMaximized ? "zoom-out" : "zoom-in";
        }
        setHoverToggleZone(true);
      } else {
        cont.style.cursor = "";
        setHoverToggleZone(false);
      }
    };
    window.addEventListener("mousemove", onMove, true);
    return () => window.removeEventListener("mousemove", onMove, true);
  }, [isHistoryLocked, isMaximized, showHistory]);

  // 捕获阶段拦截双击，避免触发 Flow 节点面板；根据状态决定触发区域
  // 放在 early return 之前，避免 Hook 顺序问题
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      // 如果刚刚拖拽过，不触发双击事件
      if (hasDraggedRef.current) {
        ev.stopPropagation();
        return;
      }

      const card = dialogRef.current;
      if (!card) return;
      const target = ev.target as HTMLElement;
      const shouldToggle = shouldToggleByDblClick(
        ev.clientX,
        ev.clientY,
        target
      );

      if (shouldToggle) {
        cancelPendingHistoryToggle();
        ev.stopPropagation();
        ev.preventDefault();
        toggleMaximizeRef.current?.();
      }
    };
    const el = containerRef.current;
    if (el) el.addEventListener("dblclick", handler, true);
    return () => {
      if (el) el.removeEventListener("dblclick", handler, true);
    };
  }, []);

  // 🔥 对消息进行分组处理，支持并行生成的横向布局（必须在 early return 之前）
  type MessageGroup = {
    groupId: string;
    userMessage: ChatMessage | null;
    aiMessages: ChatMessage[];
    isParallelGroup: boolean;
  };

  const groupedMessages = useMemo(() => {
    const displayMessages = messages.slice(isMaximized ? -50 : -10);
    const groups: MessageGroup[] = [];
    const processedIds = new Set<string>();

    for (const msg of displayMessages) {
      if (processedIds.has(msg.id)) continue;

      // 如果消息有 groupId，找出同组的所有消息
      if (msg.groupId) {
        const groupMessages = displayMessages.filter(
          (m) => m.groupId === msg.groupId
        );
        const userMsg = groupMessages.find((m) => m.type === "user") || null;
        const aiMsgs = groupMessages
          .filter((m) => m.type === "ai")
          .sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0));

        // 标记所有同组消息为已处理
        groupMessages.forEach((m) => processedIds.add(m.id));

        groups.push({
          groupId: msg.groupId,
          userMessage: userMsg,
          aiMessages: aiMsgs,
          isParallelGroup:
            aiMsgs.length > 1 || (aiMsgs[0]?.groupTotal ?? 1) > 1,
        });
      } else {
        // 单独的消息
        processedIds.add(msg.id);
        if (msg.type === "user") {
          groups.push({
            groupId: msg.id,
            userMessage: msg,
            aiMessages: [],
            isParallelGroup: false,
          });
        } else {
          groups.push({
            groupId: msg.id,
            userMessage: null,
            aiMessages: [msg],
            isParallelGroup: false,
          });
        }
      }
    }

    return groups;
  }, [messages, isMaximized]);

  // 🔥 计算彩雾状态（必须在 early return 之前）
  // 彩雾显示条件：
  // 1. 紧凑模式：始终显示
  // 2. 展开模式 + 透明背景：显示
  // 3. 展开模式 + 纯色背景：不显示
  // 4. 最大化模式：不显示
  const generatingTaskCountForAura = messages.filter(
    (msg) => msg.type === "ai" && msg.generationStatus?.isGenerating
  ).length;
  const isCompactMode = !showHistory && !isMaximized;
  const isExpandedWithTransparent = showHistory && !isMaximized && expandedPanelStyle === "transparent";
  const shouldShowAuraEffect = isCompactMode || isExpandedWithTransparent;
  const hasActiveAuraForEffect =
    ENABLE_CHAT_AURA && generatingTaskCountForAura > 0 && shouldShowAuraEffect;

  // 控制彩雾挂载/卸载，避免静止状态出现
  useEffect(() => {
    if (!ENABLE_CHAT_AURA) {
      if (auraTimerRef.current) {
        window.clearTimeout(auraTimerRef.current);
        auraTimerRef.current = null;
      }
      setShowAura(false);
      return;
    }

    if (hasActiveAuraForEffect) {
      if (auraTimerRef.current) {
        window.clearTimeout(auraTimerRef.current);
        auraTimerRef.current = null;
      }
      setShowAura(true);
      return;
    }
    auraTimerRef.current = window.setTimeout(() => {
      setShowAura(false);
      auraTimerRef.current = null;
    }, 400);
    return () => {
      if (auraTimerRef.current) {
        window.clearTimeout(auraTimerRef.current);
        auraTimerRef.current = null;
      }
    };
  }, [hasActiveAuraForEffect]);

  // 如果对话框不可见，不渲染（统一画板下始终可见时显示）
  if (!isVisible) return null;

  // 🔥 修改发送按钮的禁用条件：允许在生成中继续发送（并行模式）
  const canSend =
    currentInput.trim().length > 0 &&
    !autoOptimizing &&
    (manualAIMode === "auto" || isManualModeSupported);
  const hasHistoryContent = messages.length > 0 || isStreaming;
  const shouldShowHistoryPanel =
    (showHistory || isMaximized) && (hasHistoryContent || showHistory);
  const hasImagePreview = Boolean(
    sourceImageForEditing ||
      sourceImagesForBlending.length > 0 ||
      sourceImageForAnalysis ||
      sourcePdfForAnalysis
  );
  const renderableSourceImageForEditing = sourceImageForEditing
    ? toRenderableImageSrc(sourceImageForEditing) || sourceImageForEditing
    : null;
  const renderableSourceImagesForBlending = React.useMemo(
    () =>
      sourceImagesForBlending.map(
        (value) => toRenderableImageSrc(value) || value
      ),
    [sourceImagesForBlending]
  );
  // 最大化时不显示顶部横条指示器
  const showHistoryHoverIndicator = !isMaximized;
  const historyHoverIndicatorExpanded =
    showHistoryHoverIndicator && showHistory;
  const historyHoverIndicatorOffset = historyHoverIndicatorExpanded ? 3 : 5; // px offset relative to card top
  const historyPanelMinHeight =
    showHistory && !hasHistoryContent
      ? isMaximized
        ? "calc(100vh - 300px)"
        : "320px"
      : undefined;
  const shouldShowLockButton =
    !(showHistory && !isMaximized) && hoverToggleZone;

  // 🔥 计算正在进行的生成任务数量
  const generatingTaskCount = messages.filter(
    (msg) => msg.type === "ai" && msg.generationStatus?.isGenerating
  ).length;

  // 🔥 显示计数 = pendingTaskCount（包括未开始和生成中的任务）
  const _displayTaskCount = pendingTaskCount;
  // 🔥 回复状态背景：紧凑模式或展开透明模式下显示彩雾
  const hasActiveAura =
    ENABLE_CHAT_AURA && generatingTaskCount > 0 && shouldShowAuraEffect;

  // 判断是否使用实心面板样式（展开/最大化模式下用户可选）
  const useSolidPanel = !isCompactMode && expandedPanelStyle === "solid";

  const sendShortcutHint =
    sendShortcut === "enter"
      ? lt("快捷键：Enter 发送，Shift+Enter 换行", "Shortcut: Enter to send, Shift+Enter for newline")
      : lt("快捷键：Ctrl/Cmd + Enter 发送，Enter 换行", "Shortcut: Ctrl/Cmd + Enter to send, Enter for newline");
  const sendButtonTitle =
    imageInputLimitWarning || manualModeWarning || sendShortcutHint;

  // 计算拖拽时是否使用自定义位置
  const useDragPosition = showHistory && !isMaximized && dragOffsetX !== null;

  // 计算展开模式的动态样式
  const getExpandedModeStyle = () => {
    if (!showHistory || isMaximized) return undefined;

    const style: React.CSSProperties = {};

    // 如果用户手动拖拽过位置
    if (dragOffsetX !== null) {
      style.left = dragOffsetX;
      style.right = "auto";
      style.transform = "none";
    } else {
      // 默认右对齐：需要显式设置 left: auto，并留出与上下相同的 16px 间距
      style.left = "auto";
      style.right = 16;
    }

    // 如果用户手动调整过高度，计算对应的 top 值
    if (customHeight !== null) {
      // bottom 固定为 16px，根据 customHeight 计算 top
      const calculatedTop = window.innerHeight - 16 - customHeight;
      style.top = Math.max(16, calculatedTop); // 最小 top 为 16px
    }

    return style;
  };

  return (
    <div
      ref={containerRef}
      data-prevent-add-panel
      aria-hidden={focusMode}
      className={cn(
        "fixed transition-all ease-out",
        isDragging || isResizing ? "select-none" : "select-text",
        isMaximized
          ? "top-2 left-2 right-2 bottom-2 z-[9999]" // 最大化：接近全屏，最高 z-index 确保在所有元素之上
          : "z-50",
        !isMaximized && showHistory
          ? "top-4 bottom-4 max-w-[580px] w-[580px] px-4" // 展开模式：右侧全高，固定宽度（刚好容纳4张图）
          : !isMaximized
          ? "bottom-3 left-1/2 transform -translate-x-1/2 w-full max-w-[600px] px-4" // 紧凑模式：底部居中
          : "",
        !isDragging && !isResizing && "duration-300",
        (isDragging || isResizing) && "duration-0",
        focusMode && "hidden"
      )}
      style={showHistory && !isMaximized ? getExpandedModeStyle() : undefined}
      onMouseDown={(e) => {
        // 先尝试调整高度，如果不是调整高度区域则尝试拖拽移动
        handleResizeStart(e);
        if (!isResizing) {
          handleDragStart(e);
        }
      }}
      onDoubleClick={handleOuterDoubleClick}
      onDoubleClickCapture={handleDoubleClickCapture}
    >
      <div
        ref={dialogRef}
        data-prevent-add-panel
        className={cn(
          "transition-all ease-out relative overflow-visible group ai-chat-glow-border",
          isBlackTheme && "ai-chat-theme-premium-dark",
          isBlackTheme && isCompactMode && "ai-chat-panel-compact ai-chat-panel-transparent",
          isBlackTheme && !isCompactMode && !useSolidPanel && "ai-chat-panel-transparent",
          isBlackTheme && !isCompactMode && useSolidPanel && "ai-chat-panel-solid",
          // 紧凑模式：透明玻璃效果
          isCompactMode &&
            (isBlackTheme
              ? "border border-[#1a1a1a] shadow-[0_20px_48px_rgba(0,0,0,0.55)]"
              : "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg"),
          // 展开/最大化模式：根据用户设置选择透明或实心
          !isCompactMode &&
            !useSolidPanel &&
            (isBlackTheme
              ? "border border-[#1a1a1a] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
              : "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg"),
          !isCompactMode &&
            useSolidPanel &&
            (isBlackTheme
              ? "border border-[#1a1a1a] shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
              : "bg-white shadow-xl"),
          isMaximized ? "h-full flex flex-col rounded-2xl" : "p-4 rounded-2xl",
          showHistory && !isMaximized && "h-full flex flex-col -mr-4", // 展开模式：填满容器高度并贴合屏幕右侧
          isDragging || isResizing ? "duration-0" : "duration-300"
        )}
        style={
          showHistory && !isMaximized && customHeight
            ? { height: customHeight }
            : undefined
        }
        onClick={handleHistorySurfaceClick}
        onDoubleClick={handleOuterDoubleClick}
        onDoubleClickCapture={handleDoubleClickCapture}
      >
        {showHistoryHoverIndicator && (
          <button
            type='button'
            ref={collapseHandleRef}
            className={cn(
              "absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-150 focus:outline-none",
              "pointer-events-none group-hover:pointer-events-auto",
              showHistory ? "cursor-zoom-out" : "cursor-zoom-in"
            )}
            style={{ top: historyHoverIndicatorOffset }}
            onMouseDown={(e) => {
              // 避免触发拖拽/调整高度
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (showHistory) {
                handleCollapseToCompact();
              } else {
                setHistoryVisibility(true, true);
              }
            }}
            title={lt("点击收起或展开 AI 对话", "Collapse or expand AI chat")}
            aria-label={lt("点击收起或展开 AI 对话", "Collapse or expand AI chat")}
          >
            <div
              className={cn(
                "w-8 h-1.5 rounded-full bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass transition-all duration-200",
                historyHoverIndicatorExpanded ? "opacity-90" : "opacity-80"
              )}
            />
          </button>
        )}
        {showAura && (
          <div
            aria-hidden='true'
            className={cn(
              "ai-chat-task-aura",
              isMaximized
                ? "ai-chat-task-aura--maximized"
                : "ai-chat-task-aura--compact",
              hasActiveAura && "ai-chat-task-aura--active"
            )}
          />
        )}
        {shouldShowLockButton && (
          <button
            type='button'
            data-history-ignore-toggle
            ref={lockButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleHistoryLock();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-pressed={isHistoryLocked}
            title={
              isHistoryLocked
                ? lt(
                    "已上锁：禁止展开历史记录或最大化",
                    "Locked: history expand/maximize is disabled"
                  )
                : lt(
                    "解锁后可展开历史记录或最大化",
                    "Unlock to expand history or maximize"
                  )
            }
            className={cn(
              "absolute left-1/2 bottom-[-1px] -translate-x-1/2 flex h-5 w-5 cursor-pointer items-center justify-center",
              "text-slate-400 opacity-70 hover:opacity-100 transition-colors duration-200",
              isHistoryLocked
                ? "text-slate-500 hover:text-slate-600"
                : "hover:text-slate-500"
            )}
          >
            {isHistoryLocked ? (
              <Lock className='w-3 h-3' />
            ) : (
              <Unlock className='w-3 h-3' />
            )}
          </button>
        )}
        {/* 🔥 任务计数器徽章 - 右上角（更小尺寸）已关闭 */}

        {/* 内容区域 */}
        <div
          ref={contentRef}
          data-chat-content
          className={cn(
            "flex flex-col",
            (showHistory || isMaximized) && "flex-1 min-h-0",
            isMaximized ? "p-4 h-full overflow-visible" : "",
            // 展开模式始终填满纵向空间，方便输入框贴底
            showHistory && !isMaximized && "h-full"
          )}
        >
          {/* 输入区域 */}
          <div
            ref={inputAreaRef}
            className={cn(
              "order-2 flex-shrink-0",
              showHistory && !isMaximized && "mt-auto",
              isMaximized && "mt-auto",
              shouldShowHistoryPanel && "pt-2"
            )}
            onDoubleClick={(e) => {
              try {
                const t = textareaRef.current;
                if (!t) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMaximize();
                  return;
                }
                const r = t.getBoundingClientRect();
                const x = e.clientX,
                  y = e.clientY;
                const insideText =
                  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
                if (!insideText) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMaximize();
                  return;
                }
                // 判断是否在"外圈框"区域：靠近边缘的环（阈值 24px）
                const edgeDist = Math.min(
                  x - r.left,
                  r.right - x,
                  y - r.top,
                  r.bottom - y
                );
                if (edgeDist <= 24) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleMaximize();
                }
              } catch {}
            }}
          >
            {/* 统一的图像预览区域 - 位于输入框上方 */}
            {hasImagePreview && (
              <div className='mb-3'>
                <div className='flex flex-wrap gap-2'>
                  {/* 单图编辑显示 */}
                  {renderableSourceImageForEditing && (
                    <div className='relative group'>
                      <SmoothSmartImage
                        src={renderableSourceImageForEditing}
                        alt='编辑图像'
                        className='object-cover w-16 h-16 border rounded shadow-sm'
                      />
                      <button
                        onClick={handleRemoveSourceImage}
                        className='absolute flex items-center justify-center w-4 h-4 text-white transition-opacity bg-red-500 rounded-full opacity-0 -top-1 -right-1 hover:bg-red-600 group-hover:opacity-100'
                        title={lt("删除图片", "Remove image")}
                      >
                        <X className='w-2.5 h-2.5' />
                      </button>
                    </div>
                  )}

                  {/* 分析图像显示 - 隐藏无法显示的预览 */}
                  {false && sourceImageForAnalysis && (
                    <div className='relative group'>
                      <SmartImage
                        src={sourceImageForAnalysis}
                        alt='分析图像'
                        className='object-cover w-16 h-16 border rounded shadow-sm'
                      />
                      <button
                        onClick={() => setSourceImageForAnalysis(null)}
                        className='absolute flex items-center justify-center w-4 h-4 text-white transition-opacity bg-red-500 rounded-full opacity-0 -top-1 -right-1 hover:bg-red-600 group-hover:opacity-100'
                        title={lt("删除图片", "Remove image")}
                      >
                        <X className='w-2.5 h-2.5' />
                      </button>
                    </div>
                  )}

                  {/* 多图融合显示 */}
                  {renderableSourceImagesForBlending.map((imageData, index) => (
                    <div key={index} className='relative group'>
                      <SmoothSmartImage
                        src={imageData}
                        alt={`融合图片 ${index + 1}`}
                        className='object-cover w-16 h-16 border rounded shadow-sm'
                      />
                      {/* 图像序号角标 */}
                      <div
                        className='absolute -top-0.5 -left-0.5 bg-blue-600 text-white w-4 h-4 rounded-full font-medium shadow-sm flex items-center justify-center'
                        style={{ fontSize: "0.6rem" }}
                      >
                        {index + 1}
                      </div>
                      <button
                        onClick={() => handleRemoveBlendImage(index)}
                        className='absolute flex items-center justify-center w-4 h-4 text-white transition-opacity bg-red-500 rounded-full opacity-0 -top-1 -right-1 hover:bg-red-600 group-hover:opacity-100'
                        title={lt(
                          `删除图片 ${index + 1}`,
                          `Remove image ${index + 1}`
                        )}
                      >
                        <X className='w-2.5 h-2.5' />
                      </button>
                    </div>
                  ))}

                  {/* 添加更多图片按钮 */}
                  {(sourceImagesForBlending.length < 4 &&
                    sourceImagesForBlending.length > 0) ||
                  (sourceImageForEditing &&
                    sourceImagesForBlending.length === 0) ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className='flex items-center justify-center w-16 h-16 transition-colors border-2 border-gray-300 border-dashed rounded hover:border-blue-400 group'
                      title={lt("添加更多图片", "Add more images")}
                    >
                      <Plus className='w-6 h-6 text-gray-400 group-hover:text-blue-500' />
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            <div className='relative'>
              {/* PDF 文件 @ 标签提示 - 位于输入框上方 */}
              {sourcePdfForAnalysis && (
                <div className='flex items-center justify-start mb-2'>
                  <div className='relative group'>
                    <div
                      className={cn(
                        "flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full text-xs text-gray-700 max-w-[220px] transition-all duration-200",
                        "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass"
                      )}
                      title={sourcePdfFileName || lt("已添加的 PDF", "Added PDF")}
                    >
                      <span className='inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100/50 text-gray-500 text-[11px] font-semibold'>
                        @
                      </span>
                      <FileText className='w-4 h-4 text-red-500' />
                      <span className='truncate'>
                        {sourcePdfFileName || lt("PDF 文件", "PDF file")}
                      </span>
                    </div>
                    <button
                      onClick={() => setSourcePdfForAnalysis(null)}
                      className='absolute flex items-center justify-center w-4 h-4 text-white transition-opacity bg-red-500 rounded-full opacity-0 -top-1 -right-1 hover:bg-red-600 group-hover:opacity-100'
                      title={lt("删除 PDF", "Remove PDF")}
                    >
                      <X className='w-2.5 h-2.5' />
                    </button>
                  </div>
                </div>
              )}

              <Textarea
                ref={textareaRef}
                value={currentInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={scheduleEnsureInputVisible}
                onClick={scheduleEnsureInputVisible}
                onKeyUp={scheduleEnsureInputVisible}
                placeholder={shouldHidePlaceholder ? "" : getSmartPlaceholder()}
                disabled={false}
                className={cn(
                  "resize-none px-4 pb-12 min-h-[80px] max-h-[260px] text-sm bg-transparent border-gray-300 focus:ring-0 transition-colors duration-200 overflow-y-auto",
                  isBlackTheme && "text-white placeholder:text-[#888888]"
                )}
                rows={1}
              />

              {/* 左侧按钮组 */}
              <div className='absolute flex items-center gap-2 left-2 bottom-2'>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={false}
                      data-dropdown-trigger='true'
                      className={cn(
                        "h-7 pl-2 pr-3 flex select-none items-center gap-1 rounded-full text-xs transition-all duration-200",
                        "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                        manualAIMode !== "auto"
                          ? "bg-gray-100 text-gray-800 border-gray-200"
                          : !generationStatus.isGenerating
                          ? "hover:bg-gray-100 text-gray-700"
                          : "opacity-50 cursor-not-allowed text-gray-400"
                      )}
                    >
                      <SlidersHorizontal className='h-3.5 w-3.5' />
                      <span className='font-medium'>{manualButtonLabel}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align='start'
                    side={dropdownSide}
                    sideOffset={8}
                    className='dropdown-menu-root min-w-[220px] max-h-[400px] overflow-y-auto rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur-md'
                  >
                    <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400'>
                      快速切换模式
                    </DropdownMenuLabel>
                    {availableManualModeOptions.map((option) => {
                      const isActive = manualAIMode === option.value;
                      return (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={(event) => {
                            setManualAIMode(option.value);
                            const root = (
                              event.currentTarget as HTMLElement
                            ).closest(".dropdown-menu-root");
                            const trigger = root?.querySelector(
                              '[data-dropdown-trigger="true"]'
                            ) as HTMLButtonElement | null;
                            if (trigger && !trigger.disabled) {
                              trigger.click();
                            }
                          }}
                          className={cn(
                            "flex items-start gap-2 px-3 py-2 text-xs",
                            isActive
                              ? "bg-gray-100 text-gray-800"
                              : "text-slate-600"
                          )}
                        >
                          <div className='flex-1 space-y-0.5'>
                            <div className='font-medium leading-none'>
                              {option.label}
                            </div>
                            <div className='text-[11px] text-slate-400 leading-snug'>
                              {t(
                                `chat.manualMode.${option.value}Desc`,
                                option.description
                              )}
                            </div>
                          </div>
                          {isActive && (
                            <Check className='h-3.5 w-3.5 text-white' />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>

                {!shouldHideImageParamControls && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={false}
                        data-dropdown-trigger='true'
                        className={cn(
                          "h-7 pl-2 pr-3 flex select-none items-center gap-1 rounded-full text-xs transition-all duration-200",
                          "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                          !generationStatus.isGenerating
                            ? "hover:bg-gray-100 text-gray-700"
                            : "opacity-50 cursor-not-allowed text-gray-400"
                        )}
                        title={t("chat.labels.quickSwitchDomesticModel")}
                      >
                        <span className='font-medium'>{providerButtonLabel}</span>
                        <ChevronDown className='h-3.5 w-3.5 opacity-60' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='start'
                      side={dropdownSide}
                      sideOffset={8}
                      className='dropdown-menu-root min-w-[220px] rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur-md dark:!border-slate-200 dark:!bg-white/95'
                    >
                      <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 dark:!text-slate-400'>
                        {t("chat.labels.quickSwitchModel")}
                      </DropdownMenuLabel>
                      {providerToggleOptions.map((option) => {
                        const isActive = aiProvider === option.value;
                        return (
                          <DropdownMenuItem
                            key={option.value}
                            onClick={(event) => {
                              if (aiProvider !== option.value) {
                                console.log(
                                  "🤖 切换 AI 提供商:",
                                  option.value
                                );
                                setAIProvider(option.value, { source: "dialog" });
                              }
                              const root = (
                                event.currentTarget as HTMLElement
                              ).closest(".dropdown-menu-root");
                              const trigger = root?.querySelector(
                                '[data-dropdown-trigger="true"]'
                              ) as HTMLButtonElement | null;
                              if (trigger && !trigger.disabled) {
                                trigger.click();
                              }
                            }}
                            className={cn(
                              "flex items-start gap-2 px-3 py-2 text-xs",
                              isActive
                                ? "bg-gray-100 text-gray-800 dark:!bg-gray-100 dark:!text-gray-800"
                                : "text-slate-600 hover:bg-gray-100 dark:!text-slate-600 dark:hover:!bg-gray-100"
                            )}
                          >
                            <div className='flex-1 space-y-0.5'>
                              <div className='font-medium leading-none'>
                                {option.label}
                              </div>
                              <div className='text-[11px] text-slate-400 leading-snug dark:!text-slate-400'>
                                {option.description}
                              </div>
                            </div>
                            {isActive && (
                              <Check className='h-3.5 w-3.5 text-slate-700 dark:!text-slate-700' />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {MULTIPLIER_ENABLED_MODES.includes(manualAIMode) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        className={cn(
                          "h-7 px-2 text-[11px] font-normal text-slate-700 transition-colors duration-150",
                          "hover:text-slate-900 active:translate-y-[0.5px]"
                        )}
                        title={lt("选择生成倍数", "Select multiplier")}
                        aria-label={lt(`倍数 ${autoModeMultiplier}X`, `Multiplier ${autoModeMultiplier}X`)}
                      >
                        <span className='inline-flex items-baseline'>
                          <span className='text-sm leading-none'>{autoModeMultiplier}</span>
                          <span className='ml-0.5 text-[9px] leading-none'>X</span>
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='start'
                      side={dropdownSide}
                      sideOffset={8}
                      className='min-w-[80px] rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur-md'
                    >
                      <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400'>
                        {lt("生成倍数", "Multiplier")}
                      </DropdownMenuLabel>
                      {AUTO_MODE_MULTIPLIERS.map((multiplier) => {
                        const isActive = autoModeMultiplier === multiplier;
                        return (
                          <DropdownMenuItem
                            key={multiplier}
                            onClick={() => setAutoModeMultiplier(multiplier)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 text-xs",
                              isActive
                                ? "bg-gray-100 text-gray-800"
                                : "text-slate-600"
                            )}
                          >
                            <span className='inline-flex items-baseline'>
                              <span className='text-sm leading-none'>{multiplier}</span>
                              <span className='ml-0.5 text-[9px] leading-none'>X</span>
                            </span>
                            {isActive && (
                              <Check className='h-3.5 w-3.5 text-gray-600' />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* 长宽比选择按钮 */}
              {!shouldHideImageParamControls && (
                <Button
                  ref={aspectButtonRef}
                  onClick={() => setIsAspectOpen((v) => !v)}
                  disabled={false}
                  size='sm'
                  variant='outline'
                  className={cn(
                    "absolute right-52 bottom-2 h-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    aspectRatio
                      ? isBlackTheme
                        ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626] px-2"
                        : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900 px-2"
                      : "w-7",
                    !aspectRatio && !generationStatus.isGenerating
                      ? isBlackTheme
                        ? "text-white"
                        : "text-slate-700"
                      : !aspectRatio && "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={aspectRatio ? lt(`长宽比: ${aspectRatio}`, `Aspect ratio: ${aspectRatio}`) : lt("选择长宽比", "Select aspect ratio")}
                >
                  {aspectRatio ? (
                    <span className='text-[10px] font-medium leading-none'>{aspectRatio}</span>
                  ) : (
                    <AspectRatioIcon className='h-3.5 w-3.5' />
                  )}
                </Button>
              )}

              {/* 视频尺寸选择按钮 */}
              {isVideoMode && (
                <Button
                  ref={videoAspectButtonRef}
                  onClick={() => setIsVideoAspectOpen((v) => !v)}
                  disabled={false}
                  size='sm'
                  variant='outline'
                  className={cn(
                    "absolute right-28 bottom-2 h-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    videoAspectRatio
                      ? isBlackTheme
                        ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626] px-2"
                        : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900 px-2"
                      : "w-7",
                    !generationStatus.isGenerating
                      ? "text-slate-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={
                    videoAspectRatio
                      ? lt(`尺寸: ${videoAspectRatio}`, `Size: ${videoAspectRatio}`)
                      : lt("选择尺寸", "Select size")
                  }
                >
                  {videoAspectRatio ? (
                    <span className='text-[10px] font-medium leading-none text-white'>
                      {videoAspectRatio}
                    </span>
                  ) : (
                    <AspectRatioIcon className='h-3.5 w-3.5' />
                  )}
                </Button>
              )}

              {/* 视频时长选择按钮 */}
              {isVideoMode && (
                <Button
                  ref={videoDurationButtonRef}
                  onClick={() => setIsVideoDurationOpen((v) => !v)}
                  disabled={false}
                  size='sm'
                  variant='outline'
                  className={cn(
                    "absolute right-20 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200 text-xs",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    videoDurationSeconds
                      ? isBlackTheme
                        ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626]"
                        : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
                      : !generationStatus.isGenerating
                      ? "text-slate-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={
                    videoDurationSeconds
                      ? lt(`时长: ${videoDurationSeconds}秒`, `Duration: ${videoDurationSeconds}s`)
                      : lt("选择时长", "Select duration")
                  }
                >
                  {videoDurationSeconds ? (
                    <span className='font-medium text-[10px] leading-none text-white'>
                      {videoDurationSeconds}s
                    </span>
                  ) : (
                    <Clock className='h-3.5 w-3.5' />
                  )}
                </Button>
              )}

              {/* 高清图片设置按钮 - Gemini Pro 和 Banana API */}
              {showImageSizeControls && (
                <Button
                  ref={imageSizeButtonRef}
                  onClick={() => setIsImageSizeOpen((v) => !v)}
                  disabled={false}
                  size='sm'
                  variant='outline'
                  className={cn(
                    "absolute right-44 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200 text-xs",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    imageSize
                      ? isBlackTheme
                        ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626]"
                        : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
                      : !generationStatus.isGenerating
                      ? isBlackTheme
                        ? "text-white"
                        : "text-slate-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={imageSize ? lt(`分辨率: ${imageSize}`, `Resolution: ${imageSize}`) : lt("选择分辨率", "Select resolution")}
                >
                  <span className='font-medium text-[10px] leading-none'>
                    {imageSize || "HD"}
                  </span>
                </Button>
              )}

              {/* 思考级别按钮 - Gemini Pro 和 Banana API */}
              {showThinkingLevelControls && (
                <Button
                  ref={thinkingLevelButtonRef}
                  onClick={() => setIsThinkingLevelOpen((v) => !v)}
                  disabled={false}
                  size='sm'
                  variant='outline'
                  className={cn(
                    "absolute right-36 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    thinkingLevel
                      ? isBlackTheme
                        ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626]"
                        : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
                      : !generationStatus.isGenerating
                      ? isBlackTheme
                        ? "text-white"
                        : "text-slate-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={
                    thinkingLevel
                      ? lt(
                          `思考级别: ${thinkingLevel === "high" ? "高" : "低"}`,
                          `Thinking level: ${thinkingLevel === "high" ? "High" : "Low"}`
                        )
                      : lt("选择思考级别", "Select thinking level")
                  }
                >
                  <Brain className='h-3.5 w-3.5' />
                </Button>
              )}

              {isAspectOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={aspectPanelRef}
                    className='border rounded-xl bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass'
                    style={{
                      position: "fixed",
                      top: aspectPos.top,
                      left: aspectPos.left,
                      zIndex: 9999,
                      visibility: aspectReady ? "visible" : "hidden",
                    }}
                  >
                    <div className='flex items-center gap-1 p-2'>
                      {aspectRatioOptions.map((opt) => (
                        <button
                          key={opt.label}
                          className={cn(
                            "px-2 py-1 text-xs rounded-md",
                            aspectRatio === opt.value ||
                              (!aspectRatio && opt.value === null)
                              ? "bg-gray-100 text-gray-800 border border-gray-200"
                              : isBlackTheme
                              ? "text-white border border-transparent hover:bg-white/10"
                              : "hover:bg-gray-100 text-gray-700 border border-transparent"
                          )}
                          onClick={() => {
                            console.log("🎚️ 选择长宽比:", opt.value || "自动");
                            setAspectRatio(opt.value as any);
                            setIsAspectOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}

              {/* 视频尺寸下拉菜单 */}
              {isVideoMode &&
                isVideoAspectOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={videoAspectPanelRef}
                    className='border rounded-xl bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass'
                    style={{
                      position: "fixed",
                      top: videoAspectPos.top,
                      left: videoAspectPos.left,
                      zIndex: 9999,
                      visibility: videoAspectReady ? "visible" : "hidden",
                    }}
                  >
	                    <div className='px-3 pt-2 text-[11px] uppercase tracking-wide text-slate-400'>
	                      {lt("尺寸", "Size")}
	                    </div>
	                    <div className='flex items-center gap-1 p-2'>
	                      {[
	                        { label: lt("自动", "Auto"), value: null },
	                        { label: lt("横屏 (16:9)", "Landscape (16:9)"), value: "16:9" },
	                        { label: lt("竖屏 (9:16)", "Portrait (9:16)"), value: "9:16" },
	                      ].map((opt) => (
                        <button
                          key={opt.label}
                          className={cn(
                            "px-2 py-1 text-xs rounded-md whitespace-nowrap",
                            videoAspectRatio === opt.value ||
                              (!videoAspectRatio && opt.value === null)
                              ? "bg-gray-100 text-gray-800 border border-gray-200"
                              : "hover:bg-gray-100 text-gray-700 border border-transparent"
                          )}
                          onClick={() => {
                            setVideoAspectRatio(
                              opt.value as "16:9" | "9:16" | null
                            );
                            setIsVideoAspectOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}

              {/* 视频时长下拉菜单 */}
              {isVideoMode &&
                isVideoDurationOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={videoDurationPanelRef}
                    className='border rounded-xl bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass'
                    style={{
                      position: "fixed",
                      top: videoDurationPos.top,
                      left: videoDurationPos.left,
                      zIndex: 9999,
                      visibility: videoDurationReady ? "visible" : "hidden",
                    }}
                  >
	                    <div className='px-3 pt-2 text-[11px] uppercase tracking-wide text-slate-400'>
	                      {lt("时间长度", "Duration")}
	                    </div>
	                    <div className='flex items-center gap-1 p-2'>
	                      {[
	                        { label: lt("默认", "Default"), value: null },
	                        { label: lt("4秒", "4s"), value: 4 },
	                        { label: lt("5秒", "5s"), value: 5 },
	                        { label: lt("6秒", "6s"), value: 6 },
	                        { label: lt("8秒", "8s"), value: 8 },
	                        { label: lt("10秒", "10s"), value: 10 },
	                        { label: lt("12秒", "12s"), value: 12 },
	                        { label: lt("15秒", "15s"), value: 15 },
	                      ].map((opt) => (
                        <button
                          key={opt.label}
                          className={cn(
                            "px-2 py-1 text-xs rounded-md whitespace-nowrap",
                            videoDurationSeconds === opt.value ||
                              (!videoDurationSeconds && opt.value === null)
                              ? "bg-gray-100 text-gray-800 border border-gray-200"
                              : "hover:bg-gray-100 text-gray-700 border border-transparent"
                          )}
                          onClick={() => {
                            setVideoDurationSeconds(
                              opt.value as 4 | 5 | 6 | 8 | 10 | 12 | 15 | null
                            );
                            setIsVideoDurationOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}

              {/* 图像尺寸下拉菜单 - Gemini Pro 和 Banana API */}
              {showImageSizeControls &&
                isImageSizeOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={imageSizePanelRef}
                    className='border rounded-xl bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass'
                    style={{
                      position: "fixed",
                      top: imageSizePos.top,
                      left: imageSizePos.left,
                      zIndex: 9999,
                      visibility: imageSizeReady ? "visible" : "hidden",
                    }}
                  >
                    <div className='flex items-center gap-1 p-2'>
                      {imageSizeOptions.map((opt) => (
                        <button
                          key={opt.label}
                          className={cn(
                            "px-2 py-1 text-xs rounded-md",
                            imageSize === opt.value ||
                              (!imageSize && opt.value === null)
                              ? "bg-gray-100 text-gray-800 border border-gray-200"
                              : isBlackTheme
                              ? "text-white border border-transparent hover:bg-white/10"
                              : "hover:bg-gray-100 text-gray-700 border border-transparent"
                          )}
                          onClick={() => {
                            console.log(
                              "🖼️ 选择图像尺寸:",
                              opt.value || "自动"
                            );
                            setImageSize(opt.value as any);
                            setIsImageSizeOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}

              {/* 思考级别下拉菜单 - Gemini Pro 和 Banana API */}
              {showThinkingLevelControls &&
                isThinkingLevelOpen &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={thinkingLevelPanelRef}
                    className='border rounded-xl bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass shadow-liquid-glass'
                    style={{
                      position: "fixed",
                      top: thinkingLevelPos.top,
                      left: thinkingLevelPos.left,
                      zIndex: 9999,
                      visibility: thinkingLevelReady ? "visible" : "hidden",
                    }}
                  >
                    <div className='flex items-center gap-1 p-2'>
	                      {[
	                        { label: lt("自动", "Auto"), value: null },
	                        { label: lt("高", "High"), value: "high" },
	                        { label: lt("低", "Low"), value: "low" },
	                      ].map((opt) => (
                        <button
                          key={opt.label}
                          className={cn(
                            "px-2 py-1 text-xs rounded-md",
                            thinkingLevel === opt.value ||
                              (!thinkingLevel && opt.value === null)
                              ? "bg-gray-100 text-gray-800 border border-gray-200"
                              : isBlackTheme
                              ? "text-white border border-transparent hover:bg-white/10"
                              : "hover:bg-gray-100 text-gray-700 border border-transparent"
                          )}
                          onClick={() => {
                            console.log(
                              "🧠 选择思考级别:",
                              opt.value || "自动"
                            );
                            setThinkingLevel(opt.value as any);
                            setIsThinkingLevelOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}

              {/* 联网搜索开关 */}
              {!shouldHideImageParamControls && (
                <Button
                  onClick={toggleWebSearch}
                  disabled={false}
                  size='sm'
                  variant='outline'
                  className={cn(
                    "absolute right-28 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    !generationStatus.isGenerating
                      ? enableWebSearch
                        ? isBlackTheme
                          ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626]"
                          : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
                        : "text-slate-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={lt(
                    `联网搜索: ${enableWebSearch ? "开启" : "关闭"} - 让AI获取实时信息`,
                    `Web search: ${enableWebSearch ? "On" : "Off"} - Allow AI to fetch real-time info`
                  )}
                >
                  <MinimalGlobeIcon className='h-3.5 w-3.5' />
                </Button>
              )}

              {/* 提示词扩写按钮：单击切换自动扩写，长按打开配置面板 */}
              {!shouldHideImageParamControls && (
                <Button
                  ref={promptButtonRef}
                  size='sm'
                  variant='outline'
                  data-chat-secondary-action='true'
                  disabled={autoOptimizing}
                  className={cn(
                    "absolute right-20 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                    "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                    autoOptimizeEnabled
                      ? isBlackTheme
                        ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626]"
                        : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
                      : !generationStatus.isGenerating && !autoOptimizing
                      ? "text-slate-700"
                      : "opacity-50 cursor-not-allowed text-gray-400"
                  )}
                  title={
                    autoOptimizeEnabled
                      ? lt("自动扩写已开启（单击关闭，长按打开设置面板）", "Auto prompt expansion is on (click to disable, long-press for settings)")
                      : lt("单击开启自动扩写，长按打开扩写设置面板", "Click to enable auto expansion, long-press for settings")
                  }
                  onPointerDown={handlePromptButtonPointerDown}
                  onPointerUp={handlePromptButtonPointerUp}
                  onPointerLeave={handlePromptButtonPointerLeave}
                  onPointerCancel={handlePromptButtonPointerCancel}
                  aria-pressed={autoOptimizeEnabled}
                >
                  {autoOptimizing ? (
                    <LoadingSpinner size='sm' />
                  ) : (
                    <BookOpen className='h-3.5 w-3.5' />
                  )}
                </Button>
              )}

              {/* +号上传按钮 - 替换原来的上传图片按钮位置 */}
              <DropdownMenu
                open={isUploadMenuOpen}
                onOpenChange={setIsUploadMenuOpen}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    data-chat-secondary-action='true'
                    disabled={generationStatus.isGenerating}
                    className={cn(
                      "absolute right-12 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                      "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                      !generationStatus.isGenerating
                        ? "hover:bg-liquid-glass-hover text-gray-700"
                        : "opacity-50 cursor-not-allowed text-gray-400"
                    )}
                    title={lt("上传文件", "Upload files")}
                  >
                    <Plus className='h-3.5 w-3.5' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  side='top'
                  sideOffset={40}
                  className='w-auto min-w-[120px] rounded-lg border border-gray-200 bg-white/95 shadow-lg backdrop-blur-md'
                >
                  <DropdownMenuItem
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className='flex items-center gap-2 px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50'
                  >
                    <Image className='w-4 h-4' />
                    <span>{lt("上传图片", "Upload image")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      pdfInputRef.current?.click();
                    }}
                    className='flex items-center gap-2 px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50'
                  >
                    <FileText className='w-4 h-4' />
                    <span>{lt("上传PDF", "Upload PDF")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 发送按钮 */}
              <Button
                onClick={handleSend}
                disabled={!canSend}
                size='sm'
                variant='outline'
                data-chat-primary-action='true'
                title={sendButtonTitle}
                className={cn(
                  "absolute right-4 bottom-2 h-7 w-7 p-0 rounded-full transition-all duration-200",
                  "bg-liquid-glass backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                  canSend
                    ? "hover:bg-liquid-glass-hover text-gray-700"
                    : "opacity-50 cursor-not-allowed text-gray-400"
                )}
              >
                <Play className='h-3.5 w-3.5' />
              </Button>
            </div>

            <PromptOptimizationPanel
              ref={promptPanelRef}
              isOpen={isPromptPanelOpen}
              currentInput={currentInput}
              settings={promptSettings}
              onSettingsChange={handlePromptSettingsChange}
              onApplyToInput={handleApplyOptimizedToInput}
              onSendOptimized={handleSendOptimizedFromPanel}
              autoOptimizeEnabled={autoOptimizeEnabled}
              anchorRef={promptButtonRef}
              containerRef={dialogRef}
            />

            {/* 统一的文件输入 - 支持多选 */}
            <input
              ref={fileInputRef}
              type='file'
              accept='image/png,image/jpeg,image/jpg,image/gif,image/webp'
              multiple
              style={{ display: "none" }}
              onChange={handleImageUpload}
            />
            {/* PDF文件输入 */}
            <input
              ref={pdfInputRef}
              type='file'
              accept='application/pdf'
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  console.log("📄 PDF文件:", file.name, "大小:", file.size);

                  // 检查文件大小（限制 15MB）
                  const MAX_SIZE = 15 * 1024 * 1024;
                  if (file.size > MAX_SIZE) {
                    alert(
                      `PDF 文件过大，最大支持 15MB，当前文件 ${(
                        file.size /
                        1024 /
                        1024
                      ).toFixed(2)}MB`
                    );
                    if (pdfInputRef.current) {
                      pdfInputRef.current.value = "";
                    }
                    return;
                  }

                  // 读取文件为 base64
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const base64Data = event.target?.result as string;
                    if (base64Data) {
                      console.log(
                        "📄 PDF 已读取，数据长度:",
                        base64Data.length
                      );
                      setSourcePdfForAnalysis(base64Data, file.name);
                      // 设置默认提示词
                      if (!currentInput.trim()) {
                        setCurrentInput("请分析这个 PDF 文件的内容");
                      }
                    }
                  };
                  reader.onerror = () => {
                    console.error("❌ 读取 PDF 文件失败");
                    alert("读取 PDF 文件失败，请重试");
                  };
                  reader.readAsDataURL(file);
                }
                if (pdfInputRef.current) {
                  pdfInputRef.current.value = "";
                }
              }}
            />
          </div>

          {/* 错误提示 */}
          {generationStatus.error && (
            <div className='order-3 mt-4'>
              <div className='flex items-center gap-2 p-3 border border-red-200 rounded-lg bg-red-50'>
                <AlertCircle className='flex-shrink-0 w-4 h-4 text-red-600' />
                <span className='text-sm text-red-800'>
                  {generationStatus.error}
                </span>
              </div>
            </div>
          )}

          {/* 消息历史（点击对话框时显示，最大化时始终显示） */}
          {shouldShowHistoryPanel && (
            <div
              data-history-ignore-toggle
              className={cn(
                "order-1 mb-2 flex min-h-0 flex-col",
                hasImagePreview ? "mt-2" : "-mt-1"
              )}
            >
              <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
                <div className='flex min-w-0 items-center gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    data-history-ignore-toggle
                    className='h-8 w-8 rounded-lg bg-transparent p-0 text-slate-700 hover:bg-slate-100/80'
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCreateSession();
                    }}
                    disabled={creatingSession || generationStatus.isGenerating}
                    title={lt(
                      "新建一个独立的聊天会话",
                      "Create a new standalone chat session"
                    )}
                    aria-label={lt("新建聊天会话", "Create new chat session")}
                  >
                    {creatingSession ? (
                      <Loader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <Plus className='h-4 w-4' />
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        data-history-ignore-toggle
                        className='h-8 w-8 rounded-lg bg-transparent p-0 text-slate-700 hover:bg-slate-100/80 disabled:opacity-40'
                        onClick={(e) => e.stopPropagation()}
                        disabled={
                          sessions.length === 0 ||
                          generationStatus.isGenerating ||
                          (isHistoryLocked && !showHistory)
                        }
                        title={lt("历史会话列表", "Session history list")}
                        aria-label={lt("历史会话列表", "Session history list")}
                      >
                        <History className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='start'
                      side='bottom'
                      sideOffset={4}
                      className='w-[min(72vw,392px)] overflow-hidden rounded-[16px] border border-slate-200 bg-white/95 p-0 text-slate-800 shadow-lg backdrop-blur-md'
                    >
                      <DropdownMenuLabel className='px-4 py-3 text-sm font-semibold tracking-normal text-slate-700'>
                        {lt("对话历史", "Conversation history")}
                      </DropdownMenuLabel>
                      {sessions.length === 0 ? (
                        <DropdownMenuItem
                          disabled
                          className='rounded-none border-t border-slate-200 px-4 py-3 text-[11px] text-slate-400'
                        >
                          {lt("暂无会话", "No sessions yet")}
                        </DropdownMenuItem>
                      ) : (
                        sessions.map((session) => {
                          const isActive = session.sessionId === currentSessionId;
                          return (
                            <DropdownMenuItem
                              key={session.sessionId}
                              onClick={() => {
                                void handleSwitchSession(session.sessionId);
                              }}
                              title={session.preview || session.name}
                              className={cn(
                                "rounded-none border-t border-slate-200 px-4 py-3 text-left transition-colors",
                                "flex flex-col items-start gap-1",
                                "data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900",
                                isActive
                                  ? "bg-slate-100 text-slate-900"
                                  : "text-slate-700"
                              )}
                            >
                              <span className='w-full truncate text-sm font-semibold leading-snug'>
                                {`${session.name}${
                                  session.messageCount
                                    ? isZh
                                      ? `（${session.messageCount}条）`
                                      : ` (${session.messageCount} msgs)`
                                    : ""
                                }`}
                              </span>
                              <span className='text-[11px] text-slate-500'>
                                {formatSessionRelativeTime(session.lastActivity)}
                              </span>
                            </DropdownMenuItem>
                          );
                        })
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {/* 🧠 上下文状态指示器 */}
                <div className='flex items-center space-x-2'>
                  {isIterativeMode() && (
                    <span className='px-2 py-1 text-xs text-blue-800 bg-blue-100 rounded-full'>
                      🔄 迭代模式
                    </span>
                  )}
                  {currentSession && (
                    <span className='text-xs text-gray-400'>
                      {currentSession.name}
                      {currentSession.messageCount
                        ? ` · ${currentSession.messageCount}条`
                        : ""}
                    </span>
                  )}
                  <span className='text-xs text-gray-400'>
                    {getContextSummary()}
                  </span>
                </div>
              </div>
              <div
                ref={historyRef}
                className={cn(
                  "overflow-y-auto scrollbar-hidden",
                  isMaximized
                    ? "max-h-screen"
                    : showHistory
                    ? "flex-1 min-h-0"
                    : customHeight
                    ? "flex-1 min-h-0"
                    : "max-h-80"
                )}
                style={{
                  overflowY: "auto",
                  // 展开模式下不限制最大高度，让 flex-1 生效
                  // 最大化模式下留出输入框和顶部工具栏空间
                  maxHeight: isMaximized
                    ? "calc(100vh - 248px)"
                    : showHistory && !customHeight
                    ? undefined
                    : customHeight
                    ? undefined
                    : "320px",
                  minHeight: customHeight ? "100px" : historyPanelMinHeight,
                  // 隐藏滚动条
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className='space-y-1.5 mr-1 pb-6'>
                {/* 🔥 使用分组渲染，支持并行生成的横向布局 */}
                {groupedMessages.map((group) => {
                  // 渲染用户消息
                  const userMessage = group.userMessage;
                  const userResendInfo = userMessage
                    ? getResendInfoFromMessage(userMessage)
                    : null;
                  const userActionButtons = userMessage
                    ? renderUserMessageActions(userMessage, userResendInfo)
                    : null;

                  const normalizeDataUrl = (
                    src?: string | null
                  ): string | undefined => {
                    if (!src) return undefined;
                    const trimmed = src.trim();
                    if (!trimmed.startsWith("data:image")) return trimmed;
                    const parts = trimmed.split(",");
                    if (parts.length >= 3 && parts[1].startsWith("data:")) {
                      // 处理形如 "data:image/png;base64,data:image/png;base64,AAAA..." 的重复前缀
                      const meta = parts[0];
                      const last = parts[parts.length - 1];
                      return `${meta},${last}`;
                    }
                    return trimmed;
                  };

                  const resolveMessageImageSrc = (
                    message: ChatMessage
                  ): string | undefined => {
                    const remote = normalizeDataUrl(
                      toRenderableImageSrc(message.imageRemoteUrl)
                    );
                    if (
                      remote &&
                      !remote.startsWith("data:image") &&
                      !remote.startsWith("blob:")
                    ) {
                      return remote;
                    }

                    const imageData = normalizeDataUrl(
                      toRenderableImageSrc(message.imageData)
                    );
                    if (
                      imageData &&
                      !imageData.startsWith("data:image") &&
                      !imageData.startsWith("blob:")
                    ) {
                      return imageData;
                    }

                    const thumb = normalizeDataUrl(
                      toRenderableImageSrc(message.thumbnail)
                    );
                    if (
                      thumb &&
                      !thumb.startsWith("data:image") &&
                      !thumb.startsWith("blob:")
                    ) {
                      return thumb;
                    }

                    // 兼容历史数据：没有远程图时再回退到旧数据。
                    return remote || imageData || thumb;
                  };

                  // 渲染单个 AI 消息的图片/占位符
                  const renderAiMessageImage = (
                    message: ChatMessage,
                    isCompact: boolean = false
                  ) => {
                    const msgGenerationStatus = message.generationStatus;
                    const msgExpectsImageOutput = Boolean(
                      message.expectsImageOutput
                    );
                    const hasTextContent = Boolean(message.content?.trim());

                    const imageSrc = resolveMessageImageSrc(message);

                    const imageSize = isCompact ? "w-28 h-28" : "w-32 h-32";
                    const shouldHideUltraTextOnlyPlaceholder = Boolean(
                      isUltraMode &&
                        msgExpectsImageOutput &&
                        hasTextContent &&
                        !imageSrc &&
                        !msgGenerationStatus?.isGenerating
                    );

                    if (imageSrc) {
                      return (
                        <SmartImage
                          src={imageSrc}
                          alt={`AI生成的图像${
                            message.groupIndex !== undefined
                              ? ` ${message.groupIndex + 1}`
                              : ""
                          }`}
                          className={`${imageSize} object-cover rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleImagePreview(imageSrc, "AI生成的图像");
                          }}
                          title={lt("点击全屏预览", "Click to preview fullscreen")}
                        />
                      );
                    }

                    if (msgExpectsImageOutput && !shouldHideUltraTextOnlyPlaceholder) {
                      return (
                        <div
                          className={`ai-image-placeholder ${imageSize}`}
                        >
                          <div className='relative z-10 flex flex-col items-center justify-center w-full h-full gap-1 text-xs text-slate-500'>
                            <Loader2 className='w-4 h-4 animate-spin text-slate-400' />
                            <span className='px-1 font-medium text-center'>
                              {message.groupIndex !== undefined
                                ? `${message.groupIndex + 1}/${
                                    message.groupTotal || "?"
                                  }`
                                : msgGenerationStatus?.stage || "生成中"}
                            </span>
                            {typeof msgGenerationStatus?.progress ===
                              "number" && (
                              <span className='text-[10px] text-slate-400'>
                                {msgGenerationStatus.progress.toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  };

                  return (
                    <div key={group.groupId} className='mb-2'>
                      {/* 用户消息 */}
                      {userMessage && (
                        <div className='p-2 ml-3 mr-1 text-sm text-black'>
                          <div
                            className={cn(
                              "relative text-sm text-black markdown-content leading-relaxed",
                              "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass rounded-lg p-3 inline-block"
                            )}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {userMessage.content}
                            </ReactMarkdown>
                            {userActionButtons}
                          </div>
                        </div>
                      )}

                      {/* AI 消息 - 并行组横向布局 */}
                      {group.aiMessages.length > 0 && (
                        <div className='p-2 mr-3 text-sm text-black'>
                          {/* 🔥 并行组：横向排列图片 */}
                          {group.isParallelGroup ? (
                            <>
                              {/* AI Header - 并行组只显示一次 */}
                              <div className='flex items-center gap-2 mb-2'>
                                <SmartImage
                                  src={chatLogoSrc}
                                  alt='TAI Logo'
                                  className='w-4 h-4'
                                />
                                <span className={aiBrandTextClass}>
                                  TAI
                                </span>
                                <span className='text-xs text-gray-400'>
                                  {
                                    group.aiMessages.filter(
                                      (m) =>
                                        m.imageData ||
                                        m.imageRemoteUrl ||
                                        m.thumbnail ||
                                        m.generationStatus?.isGenerating ||
                                        m.expectsImageOutput
                                    ).length
                                  }
                                  /
                                  {group.aiMessages[0]?.groupTotal ||
                                    group.aiMessages.length}{" "}
                                  张
                                </span>
                              </div>
                              <div className='mt-2'>
                                <div
                                  className={cn(
                                    "inline-block rounded-lg p-3",
                                    "bg-liquid-glass-light backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass-light shadow-liquid-glass"
                                  )}
                                >
                                  <div className='flex flex-wrap gap-2'>
                                    {group.aiMessages.map((aiMsg) => {
                                      const rendered = renderAiMessageImage(
                                        aiMsg,
                                        true
                                      );
                                      // 🔥 只渲染有内容的消息
                                      if (!rendered) return null;
                                      return (
                                        <div
                                          key={aiMsg.id}
                                          className='flex-shrink-0'
                                        >
                                          {rendered}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </>
                          ) : (
                            /* 单个 AI 消息：保持原有布局 */
                            group.aiMessages.map((message) => {
                              const midjourneyMeta = message.metadata
                                ?.midjourney as MidjourneyMetadata | undefined;
                    const generationStatus = message.generationStatus;
                    const expectsImageOutput = Boolean(
                      message.expectsImageOutput
                    );
                    const hasTextContent = Boolean(message.content?.trim());
                    const hasGeneratedImage = Boolean(
                      message.imageData ||
                        message.imageRemoteUrl ||
                        message.thumbnail
                    );
                              const hasReferenceImages =
                                Boolean(message.sourceImageData) ||
                                Boolean(
                                  message.sourceImagesData &&
                                    message.sourceImagesData.length > 0
                                );
                              // 视频相关变量
                              const expectsVideoOutput = Boolean(
                                message.expectsVideoOutput
                              );
                              const hasGeneratedVideo = Boolean(
                                message.videoUrl
                              );
                              const isAiMessage = message.type === "ai";
                              const isReferenceOnlyAiMessage = Boolean(
                                isAiMessage &&
                                  hasReferenceImages &&
                                  !expectsImageOutput &&
                                  !hasGeneratedImage
                              );
                    const isImageTaskInFlight = Boolean(
                      isAiMessage &&
                        generationStatus?.isGenerating &&
                        (expectsImageOutput || hasGeneratedImage)
                    );
                    const shouldExpectImageOutput = Boolean(
                      expectsImageOutput &&
                        !(
                          isUltraMode &&
                          hasTextContent &&
                          !hasGeneratedImage &&
                          !generationStatus?.isGenerating
                        )
                    );
                    const isVideoTaskInFlight = Boolean(
                      isAiMessage &&
                        generationStatus?.isGenerating &&
                        (expectsVideoOutput || hasGeneratedVideo)
                    );
                    const showImageLayout =
                      !isReferenceOnlyAiMessage &&
                      (hasGeneratedImage ||
                        hasReferenceImages ||
                        shouldExpectImageOutput ||
                        isImageTaskInFlight);
                    const showVideoLayout =
                      hasGeneratedVideo ||
                      expectsVideoOutput ||
                      isVideoTaskInFlight;
                    const shouldUseVerticalLayout =
                                isAiMessage &&
                        !isReferenceOnlyAiMessage &&
                        (hasGeneratedImage ||
                          shouldExpectImageOutput ||
                          isImageTaskInFlight ||
                          hasGeneratedVideo ||
                          expectsVideoOutput ||
                          isVideoTaskInFlight);
                              const aiHeader = isAiMessage ? (
                                <div className='flex items-center gap-2 mb-2'>
                                  <SmartImage
                                    src={chatLogoSrc}
                                    alt='TAI Logo'
                                    className='w-4 h-4'
                                  />
                                  <span className={aiBrandTextClass}>
                                    TAI
                                  </span>
                                  {(message.webSearchResult?.hasSearchResults ||
                                    (message.metadata as any)?.webSearchEnabled) && (
                                    <div className='flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full'>
                                      <MinimalGlobeIcon className='w-3 h-3' />
                                      <span>已联网</span>
                                    </div>
                                  )}
                                </div>
                              ) : null;
                              const aiTextContent = isAiMessage ? (
                                <div className='text-sm leading-relaxed text-black break-words markdown-content'>
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      p: ({ children }) => (
                                        <p className='mb-1 text-sm'>
                                          {children}
                                        </p>
                                      ),
                                      ul: ({ children }) => (
                                        <ul className='mb-1 ml-2 text-sm list-disc list-inside'>
                                          {children}
                                        </ul>
                                      ),
                                      ol: ({ children }) => (
                                        <ol className='mb-1 ml-2 text-sm list-decimal list-inside'>
                                          {children}
                                        </ol>
                                      ),
                                      li: ({ children }) => (
                                        <li className='mb-0.5 text-sm'>
                                          {children}
                                        </li>
                                      ),
                                      h1: ({ children }) => (
                                        <h1 className='mt-2 mb-2 text-lg font-bold'>
                                          {children}
                                        </h1>
                                      ),
                                      h2: ({ children }) => (
                                        <h2 className='mt-1 mb-1 text-base font-bold'>
                                          {children}
                                        </h2>
                                      ),
                                      h3: ({ children }) => (
                                        <h3 className='mb-1 text-base font-bold'>
                                          {children}
                                        </h3>
                                      ),
                                      code: ({ children, ...props }: any) => {
                                        const inline = !(
                                          "className" in props &&
                                          props.className?.includes("language-")
                                        );
                                        return inline ? (
                                          <code className='px-1 text-xs bg-gray-100 rounded'>
                                            {children}
                                          </code>
                                        ) : (
                                          <pre className='p-1 mb-1 overflow-x-auto text-xs bg-gray-100 rounded'>
                                            <code>{children}</code>
                                          </pre>
                                        );
                                      },
                                      blockquote: ({ children }) => (
                                        <blockquote className='pl-2 mb-1 text-xs italic border-l-2 border-gray-300'>
                                          {children}
                                        </blockquote>
                                      ),
                                      a: ({ href, children }) => (
                                        <a
                                          href={href}
                                          className='text-blue-600 hover:underline'
                                          target='_blank'
                                          rel='noopener noreferrer'
                                        >
                                          {children}
                                        </a>
                                      ),
                                      strong: ({ children }) => (
                                        <strong className='font-semibold'>
                                          {children}
                                        </strong>
                                      ),
                                      em: ({ children }) => (
                                        <em className='italic'>{children}</em>
                                      ),
                                    }}
                                  >
                                    {message.content}
                                  </ReactMarkdown>

                                  {message.webSearchResult
                                    ?.hasSearchResults && (
                                    <div className='pt-2 mt-2 border-t border-gray-100'>
                                      <div className='mb-1 text-xs text-gray-500'>
                                        信息来源：
                                      </div>
                                      <div className='space-y-1'>
                                        {message.webSearchResult.sources
                                          .slice(0, 3)
                                          .map((source: any, idx: number) => (
                                            <div key={idx} className='text-xs'>
                                              <a
                                                href={source.url}
                                                target='_blank'
                                                rel='noopener noreferrer'
                                                className='text-blue-600 hover:underline'
                                                title={source.snippet}
                                              >
                                                {source.title}
                                              </a>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : null;
                              const resendInfo =
                                getResendInfoFromMessage(message);
                              const userActionButtons =
                                renderUserMessageActions(message, resendInfo);
                              const videoPlaybackUrl =
                                message.videoLocalUrl || message.videoUrl;
                              const videoShareUrl =
                                message.videoSourceUrl ||
                                message.videoUrl ||
                                message.videoLocalUrl;
                              return (
                                <div
                                  key={message.id}
                                  className={cn(
                                    "p-2 transition-colors text-sm",
                                    message.type === "user" &&
                                      "text-black ml-3 mr-1",
                                    message.type === "ai" && "text-black mr-3",
                                    message.type === "error" &&
                                      "bg-red-50 text-red-800 mr-1 rounded-lg p-3"
                                  )}
                                >
                                  {/* 🔥 错误显示 - AI 消息级别的错误 */}
                                  {message.type === "ai" &&
                                    message.generationStatus?.error && (
                                      <div className='p-2 mb-2 text-xs text-red-700 border border-red-200 rounded bg-red-50'>
                                        ⚠️ {message.generationStatus.error}
                                      </div>
                                    )}

                                  {/* 如果有视频或正在生成视频，显示视频 */}
                                  {showVideoLayout ? (
                                    isAiMessage ? (
                                      <>
                                        {aiHeader}
                                        {aiTextContent}
                                        <div className='mt-3'>
                                          <div className='inline-block p-3 border rounded-lg bg-liquid-glass-light backdrop-blur-liquid backdrop-saturate-125 border-liquid-glass-light shadow-liquid-glass'>
                                            <div className='flex flex-col items-center gap-3'>
                                              {videoPlaybackUrl ? (
                                                <>
                                                  <video
                                                    controls
                                                    className='w-full max-w-md border rounded-lg shadow-sm'
                                                    style={{
                                                      maxHeight: "400px",
                                                    }}
                                                    poster={
                                                      message.videoThumbnail
                                                    }
                                                    onError={(e) => {
                                                      console.error('视频加载失败:', {
                                                        playback: videoPlaybackUrl,
                                                        remote: message.videoSourceUrl || message.videoUrl,
                                                        error: e,
                                                      });
                                                      const target = e.target as HTMLVideoElement;
                                                      target.style.display = 'none';
                                                      const errorDiv = target.nextElementSibling as HTMLElement;
                                                      if (errorDiv) {
                                                        errorDiv.style.display = 'block';
                                                      }
                                                    }}
                                                  >
                                                    <source
                                                      src={videoPlaybackUrl}
                                                      type='video/mp4'
                                                    />
                                                    您的浏览器不支持 HTML5 video
                                                    标签
                                                  </video>
                                                  <div
                                                    className={`video-error-${message.id} hidden w-full max-w-md p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm`}
                                                    style={{ display: 'none' }}
                                                  >
                                                    <div className='flex items-center gap-2 mb-2'>
                                                      <span className='text-red-500'>⚠️</span>
                                                      <span className='font-medium'>视频加载失败</span>
                                                    </div>
                                                    <p className='mb-2 text-xs text-red-600'>
                                                      视频链接可能已过期或无法访问
                                                    </p>
                                                    <button
                                                      onClick={() => {
                                                        const errorDiv = document.querySelector(`.video-error-${message.id}`) as HTMLElement;
                                                        const video = errorDiv?.previousElementSibling as HTMLVideoElement;
                                                        if (video && errorDiv) {
                                                          video.style.display = 'block';
                                                          video.load();
                                                          errorDiv.style.display = 'none';
                                                        }
                                                      }}
                                                      className='px-3 py-1 text-xs text-red-700 transition-colors bg-red-100 rounded hover:bg-red-200'
                                                    >
                                                      重试加载
                                                    </button>
                                                  </div>
                                                  <div className='flex flex-wrap gap-3 text-xs'>
                                                    {/* 分享/复制 */}
                                                    <button
                                                      onClick={async () => {
                                                        if (!videoShareUrl)
                                                          return;
                                                        try {
                                                          await navigator.clipboard.writeText(
                                                            videoShareUrl
                                                          );
                                                          console.log(
                                                            "✅ 视频链接已复制，可直接粘贴分享"
                                                          );
                                                          alert(
                                                            "✅ 已复制视频链接"
                                                          );
                                                        } catch (err) {
                                                          console.error(
                                                            "❌ 复制失败:",
                                                            err
                                                          );
                                                          alert(
                                                            "复制失败，请手动复制链接"
                                                          );
                                                        }
                                                      }}
                                                      title={lt(
                                                        "分享链接",
                                                        "Share link"
                                                      )}
                                                      className='flex items-center justify-center text-purple-500 transition-colors bg-white border border-purple-100 rounded-full shadow-sm w-9 h-9 hover:bg-purple-50'
                                                    >
                                                      <Share2 className='w-3.5 h-3.5' />
                                                    </button>

                                                    {/* 下载视频 */}
                                                    <button
                                                      onClick={async () => {
                                                        try {
                                                          if (!videoPlaybackUrl && !videoShareUrl) {
                                                            return;
                                                          }
                                                          const downloadTargetUrl =
                                                            videoShareUrl || videoPlaybackUrl!;
                                                          console.log(
                                                            "📥 开始下载视频:",
                                                            downloadTargetUrl
                                                          );

                                                          if (downloadTargetUrl.startsWith("blob:")) {
                                                            const link =
                                                              document.createElement("a");
                                                            link.href = downloadTargetUrl;
                                                            link.download = `video-${
                                                              new Date()
                                                                .toISOString()
                                                                .split("T")[0]
                                                            }.mp4`;
                                                            document.body.appendChild(link);
                                                            link.click();
                                                            document.body.removeChild(link);
                                                            return;
                                                          }

                                                          // 方案 1: 尝试直接 fetch 下载
                                                          try {
                                                            const response =
                                                              await fetchWithAuth(
                                                                downloadTargetUrl,
                                                                {
                                                                  mode: "cors",
                                                                  credentials:
                                                                    "omit",
                                                                  auth: "omit",
                                                                  allowRefresh:
                                                                    false,
                                                                }
                                                              );

                                                            if (response.ok) {
                                                              const blob =
                                                                await response.blob();
                                                              const downloadUrl =
                                                                URL.createObjectURL(
                                                                  blob
                                                                );
                                                              const link =
                                                                document.createElement(
                                                                  "a"
                                                                );

                                                              link.href =
                                                                downloadUrl;
                                                              link.download = `video-${
                                                                new Date()
                                                                  .toISOString()
                                                                  .split("T")[0]
                                                              }.mp4`;

                                                              document.body.appendChild(
                                                                link
                                                              );
                                                              link.click();
                                                              document.body.removeChild(
                                                                link
                                                              );

                                                              setTimeout(() => {
                                                                URL.revokeObjectURL(
                                                                  downloadUrl
                                                                );
                                                              }, 100);

                                                              console.log(
                                                                "✅ 视频下载成功"
                                                              );
                                                              alert(
                                                                "✅ 视频下载成功！"
                                                              );
                                                              return;
                                                            }
                                                          } catch (fetchError) {
                                                            console.warn(
                                                              "⚠️ Fetch 下载失败，使用降级方案...",
                                                              fetchError
                                                            );
                                                          }

                                                          // 降级方案: 在新标签页打开（让浏览器处理下载）
                                                          console.log(
                                                            "⚠️ 使用浏览器默认下载"
                                                          );
                                                          const link =
                                                            document.createElement(
                                                              "a"
                                                            );
                                                          link.href =
                                                            downloadTargetUrl;
                                                          link.download = `video-${
                                                            new Date()
                                                              .toISOString()
                                                              .split("T")[0]
                                                          }.mp4`;
                                                          document.body.appendChild(
                                                            link
                                                          );
                                                          link.click();
                                                          document.body.removeChild(
                                                            link
                                                          );
                                                        } catch (error) {
                                                          console.error(
                                                            "❌ 视频下载失败:",
                                                            error
                                                          );
                                                          alert(
                                                            "❌ 下载失败，已尝试复制链接。\n\n" +
                                                              "您可以在浏览器中新开标签或使用下载工具。"
                                                          );
                                                          try {
                                                            await navigator.clipboard.writeText(
                                                              downloadTargetUrl
                                                            );
                                                          } catch {}
                                                        }
                                                      }}
                                                      title={lt(
                                                        "下载视频",
                                                        "Download video"
                                                      )}
                                                      className='flex items-center justify-center text-blue-500 transition-colors bg-white border border-gray-200 rounded-full shadow-sm w-9 h-9 hover:bg-gray-800/10'
                                                    >
                                                      <Download className='w-3.5 h-3.5' />
                                                    </button>
                                                  </div>
                                                  {(message.videoStatus ||
                                                    message.videoTaskId) && (
                                                    <div className='text-[11px] text-gray-500 mt-1 w-full'>
                                                      {message.videoStatus && (
                                                        <span>
                                                          状态:{" "}
                                                          {message.videoStatus}
                                                        </span>
                                                      )}
                                                      {message.videoStatus &&
                                                        message.videoTaskId && (
                                                          <span className='mx-1'>
                                                            ·
                                                          </span>
                                                        )}
                                                      {message.videoTaskId && (
                                                        <span>
                                                          任务ID:{" "}
                                                          {message.videoTaskId}
                                                        </span>
                                                      )}
                                                    </div>
                                                  )}
                                                </>
                                              ) : (
                                                <div className='w-48 h-32 ai-image-placeholder'>
                                                  <div className='relative z-10 flex flex-col items-center justify-center w-full h-full gap-2 text-xs text-slate-500'>
                                                    <Loader2 className='w-5 h-5 animate-spin text-slate-400' />
                                                    <span className='font-medium'>
                                                      {generationStatus?.stage ||
                                                        "正在生成视频"}
                                                    </span>
                                                    {typeof generationStatus?.progress ===
                                                      "number" && (
                                                      <span className='text-[11px] text-slate-400'>
                                                        {generationStatus.progress.toFixed(
                                                          1
                                                        )}
                                                        %
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </>
                                    ) : null
                                  ) : /* 如果有图像、源图像或正在等待图像，使用特殊布局 */
                                  showImageLayout ? (
                                    isAiMessage ? (
                                      <>
                                        {aiHeader}
                                        {aiTextContent}
                                        <div className='mt-3'>
                                          <div
                                            className={cn(
                                              "inline-block rounded-lg p-3",
                                              "bg-liquid-glass-light backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass-light shadow-liquid-glass"
                                            )}
                                          >
                                            {shouldUseVerticalLayout ? (
                                              <>
                                                <div className='flex justify-center'>
                                                  {(() => {
                                                    const imageSrc =
                                                      resolveMessageImageSrc(
                                                        message
                                                      );
                                                    if (imageSrc) {
                                                      return (
                                                        <SmartImage
                                                          src={imageSrc}
                                                          alt='AI生成的图像'
                                                          className='object-cover w-32 h-32 transition-shadow border rounded-lg shadow-sm cursor-pointer hover:shadow-md'
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleImagePreview(
                                                              imageSrc,
                                                              "AI生成的图像"
                                                            );
                                                          }}
                                                          title={lt(
                                                            "点击全屏预览",
                                                            "Click to preview fullscreen"
                                                          )}
                                                        />
                                                      );
                                                    }
                                                    if (!shouldExpectImageOutput)
                                                      return null;
                                                    return (
                                                      <div className='w-32 h-32 ai-image-placeholder'>
                                                        <div className='relative z-10 flex flex-col items-center justify-center w-full h-full gap-2 text-xs text-slate-500'>
                                                          <Loader2 className='w-5 h-5 animate-spin text-slate-400' />
                                                          <span className='font-medium'>
                                                            {generationStatus?.stage ||
                                                              "正在生成图像"}
                                                          </span>
                                                          {typeof generationStatus?.progress ===
                                                            "number" && (
                                                            <span className='text-[11px] text-slate-400'>
                                                              {generationStatus.progress.toFixed(
                                                                1
                                                              )}
                                                              %
                                                            </span>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })()}
                                                </div>
                                                {midjourneyMeta?.buttons
                                                  ?.length &&
                                                  midjourneyMeta.taskId && (
                                                    <MidjourneyActionButtons
                                                      buttons={
                                                        midjourneyMeta.buttons as MidjourneyButtonInfo[]
                                                      }
                                                      onAction={async (
                                                        button
                                                      ) => {
                                                        if (!button.customId)
                                                          return;
                                                        await executeMidjourneyAction(
                                                          {
                                                            parentMessageId:
                                                              message.id,
                                                            taskId:
                                                              midjourneyMeta.taskId,
                                                            customId:
                                                              button.customId,
                                                            buttonLabel:
                                                              button.label,
                                                            displayPrompt:
                                                              midjourneyMeta.prompt ||
                                                              message.content,
                                                          }
                                                        );
                                                      }}
                                                    />
                                                  )}
                                              </>
                                            ) : (
                                              <div className='flex items-start gap-3'>
                                                <div className='flex-shrink-0'>
                                                  {message.sourceImageData && (
                                                    <div className='mb-2'>
                                                      <SmartImage
                                                        src={
                                                          message.sourceImageData
                                                        }
                                                        alt='源图像'
                                                        className='object-cover w-16 h-16 transition-shadow border rounded shadow-sm cursor-pointer hover:shadow-md'
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleImagePreview(
                                                            message.sourceImageData!,
                                                            "源图像"
                                                          );
                                                        }}
                                                        title={lt(
                                                          "点击全屏预览",
                                                          "Click to preview fullscreen"
                                                        )}
                                                      />
                                                    </div>
                                                  )}
                                                  {message.sourceImagesData &&
                                                    message.sourceImagesData
                                                      .length > 0 && (
                                                      <div className='mb-2'>
                                                        <div className='grid grid-cols-2 gap-1 max-w-20'>
                                                          {message.sourceImagesData.map(
                                                            (
                                                              imageData,
                                                              index
                                                            ) => (
                                                              <div
                                                                key={index}
                                                                className='relative'
                                                              >
                                                                <SmartImage
                                                                  src={
                                                                    imageData
                                                                  }
                                                                  alt={`融合图像 ${
                                                                    index + 1
                                                                  }`}
                                                                  className='object-cover w-8 h-8 transition-shadow border rounded shadow-sm cursor-pointer hover:shadow-md'
                                                                  onClick={(
                                                                    e
                                                                  ) => {
                                                                    e.stopPropagation();
                                                                    handleImagePreview(
                                                                      imageData,
                                                                      `融合图像 ${
                                                                        index +
                                                                        1
                                                                      }`
                                                                    );
                                                                  }}
                                                                  title={lt(
                                                                    `点击全屏预览融合图像 ${
                                                                      index + 1
                                                                    }`,
                                                                    `Click to preview blended image ${
                                                                      index + 1
                                                                    } fullscreen`
                                                                  )}
                                                                />
                                                                <div
                                                                  className='absolute -top-0.5 -left-0.5 bg-blue-600 text-white text-xs w-4 h-4 rounded-full font-medium shadow-sm flex items-center justify-center'
                                                                  style={{
                                                                    fontSize:
                                                                      "0.6rem",
                                                                  }}
                                                                >
                                                                  {index + 1}
                                                                </div>
                                                              </div>
                                                            )
                                                          )}
                                                        </div>
                                                      </div>
                                                    )}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    ) : (
                                      <div
                                        className={cn(
                                          "relative inline-block rounded-lg p-3",
                                          message.type === "user" &&
                                            "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass",
                                          message.type !== "user" &&
                                            "bg-liquid-glass-light backdrop-blur-liquid backdrop-saturate-125 border border-liquid-glass-light shadow-liquid-glass"
                                        )}
                                      >
                                        <div className='flex items-start gap-3'>
                                          {/* 左边：图像 */}
                                          <div className='flex-shrink-0'>
                                            {message.sourceImageData && (
                                              <div className='mb-2'>
                                                <SmartImage
                                                  src={message.sourceImageData}
                                                  alt='源图像'
                                                  className='object-cover w-16 h-16 transition-shadow border rounded shadow-sm cursor-pointer hover:shadow-md'
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleImagePreview(
                                                      message.sourceImageData!,
                                                      "源图像"
                                                    );
                                                  }}
                                                  title={lt(
                                                    "点击全屏预览",
                                                    "Click to preview fullscreen"
                                                  )}
                                                />
                                              </div>
                                            )}
                                            {message.sourceImagesData &&
                                              message.sourceImagesData.length >
                                                0 && (
                                                <div className='mb-2'>
                                                  <div className='grid grid-cols-2 gap-1 max-w-20'>
                                                    {message.sourceImagesData.map(
                                                      (imageData, index) => (
                                                        <div
                                                          key={index}
                                                          className='relative'
                                                        >
                                                          <SmartImage
                                                            src={imageData}
                                                            alt={`融合图像 ${
                                                              index + 1
                                                            }`}
                                                            className='object-cover w-8 h-8 transition-shadow border rounded shadow-sm cursor-pointer hover:shadow-md'
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              handleImagePreview(
                                                                imageData,
                                                                `融合图像 ${
                                                                  index + 1
                                                                }`
                                                              );
                                                            }}
                                                            title={lt(
                                                              `点击全屏预览融合图像 ${
                                                                index + 1
                                                              }`,
                                                              `Click to preview blended image ${
                                                                index + 1
                                                              } fullscreen`
                                                            )}
                                                          />
                                                          <div
                                                            className='absolute -top-0.5 -left-0.5 bg-blue-600 text-white text-xs w-4 h-4 rounded-full font-medium shadow-sm flex items-center justify-center'
                                                            style={{
                                                              fontSize:
                                                                "0.6rem",
                                                            }}
                                                          >
                                                            {index + 1}
                                                          </div>
                                                        </div>
                                                      )
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                          </div>

                                          {/* 右边：文字内容 */}
                                          <div className='flex-1 min-w-0'>
                                            <div className='text-sm leading-relaxed text-black break-words markdown-content'>
                                              <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                  p: ({ children }) => (
                                                    <p className='mb-1 text-sm'>
                                                      {children}
                                                    </p>
                                                  ),
                                                  ul: ({ children }) => (
                                                    <ul className='mb-1 ml-2 text-sm list-disc list-inside'>
                                                      {children}
                                                    </ul>
                                                  ),
                                                  ol: ({ children }) => (
                                                    <ol className='mb-1 ml-2 text-sm list-decimal list-inside'>
                                                      {children}
                                                    </ol>
                                                  ),
                                                  li: ({ children }) => (
                                                    <li className='mb-0.5 text-sm'>
                                                      {children}
                                                    </li>
                                                  ),
                                                  h1: ({ children }) => (
                                                    <h1 className='mt-2 mb-2 text-lg font-bold'>
                                                      {children}
                                                    </h1>
                                                  ),
                                                  h2: ({ children }) => (
                                                    <h2 className='mt-1 mb-1 text-base font-bold'>
                                                      {children}
                                                    </h2>
                                                  ),
                                                  h3: ({ children }) => (
                                                    <h3 className='mb-1 text-base font-bold'>
                                                      {children}
                                                    </h3>
                                                  ),
                                                  code: ({
                                                    children,
                                                    ...props
                                                  }: any) => {
                                                    const inline = !(
                                                      "className" in props &&
                                                      props.className?.includes(
                                                        "language-"
                                                      )
                                                    );
                                                    return inline ? (
                                                      <code className='px-1 text-xs bg-gray-100 rounded'>
                                                        {children}
                                                      </code>
                                                    ) : (
                                                      <pre className='p-1 mb-1 overflow-x-auto text-xs bg-gray-100 rounded'>
                                                        <code>{children}</code>
                                                      </pre>
                                                    );
                                                  },
                                                  blockquote: ({
                                                    children,
                                                  }) => (
                                                    <blockquote className='pl-2 mb-1 text-xs italic border-l-2 border-gray-300'>
                                                      {children}
                                                    </blockquote>
                                                  ),
                                                  a: ({ href, children }) => (
                                                    <a
                                                      href={href}
                                                      className='text-blue-600 hover:underline'
                                                      target='_blank'
                                                      rel='noopener noreferrer'
                                                    >
                                                      {children}
                                                    </a>
                                                  ),
                                                  strong: ({ children }) => (
                                                    <strong className='font-semibold'>
                                                      {children}
                                                    </strong>
                                                  ),
                                                  em: ({ children }) => (
                                                    <em className='italic'>
                                                      {children}
                                                    </em>
                                                  ),
                                                }}
                                              >
                                                {message.content}
                                              </ReactMarkdown>
                                            </div>
                                            {userActionButtons}
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  ) : isAiMessage ? (
                                    <>
                                      {aiHeader}
                                      {aiTextContent}
                                    </>
                                  ) : (
                                    <div
                                      className={cn(
                                        "relative text-sm text-black markdown-content leading-relaxed",
                                        message.type === "user" &&
                                          "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 border border-liquid-glass shadow-liquid-glass rounded-lg p-3 inline-block"
                                      )}
                                    >
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                          p: ({ children }) => (
                                            <p className='mb-1 text-sm'>
                                              {children}
                                            </p>
                                          ),
                                          ul: ({ children }) => (
                                            <ul className='mb-1 ml-2 text-sm list-disc list-inside'>
                                              {children}
                                            </ul>
                                          ),
                                          ol: ({ children }) => (
                                            <ol className='mb-1 ml-2 text-sm list-decimal list-inside'>
                                              {children}
                                            </ol>
                                          ),
                                          li: ({ children }) => (
                                            <li className='mb-0.5 text-sm'>
                                              {children}
                                            </li>
                                          ),
                                          h1: ({ children }) => (
                                            <h1 className='mt-1 mb-1 text-base font-bold'>
                                              {children}
                                            </h1>
                                          ),
                                          h2: ({ children }) => (
                                            <h2 className='text-sm font-bold mb-0.5'>
                                              {children}
                                            </h2>
                                          ),
                                          h3: ({ children }) => (
                                            <h3 className='text-sm font-bold mb-0.5'>
                                              {children}
                                            </h3>
                                          ),
                                          code: ({
                                            children,
                                            ...props
                                          }: any) => {
                                            const inline = !(
                                              "className" in props &&
                                              props.className?.includes(
                                                "language-"
                                              )
                                            );
                                            return inline ? (
                                              <code
                                                className='bg-gray-100 px-0.5 rounded'
                                                style={{ fontSize: "0.7rem" }}
                                              >
                                                {children}
                                              </code>
                                            ) : (
                                              <pre
                                                className='bg-gray-100 p-0.5 rounded overflow-x-auto mb-0.5'
                                                style={{ fontSize: "0.7rem" }}
                                              >
                                                <code>{children}</code>
                                              </pre>
                                            );
                                          },
                                          blockquote: ({ children }) => (
                                            <blockquote className='border-l-2 border-gray-300 pl-1 italic mb-0.5'>
                                              {children}
                                            </blockquote>
                                          ),
                                          a: ({ href, children }) => (
                                            <a
                                              href={href}
                                              className='text-blue-600 hover:underline'
                                              target='_blank'
                                              rel='noopener noreferrer'
                                            >
                                              {children}
                                            </a>
                                          ),
                                          strong: ({ children }) => (
                                            <strong className='font-semibold'>
                                              {children}
                                            </strong>
                                          ),
                                          em: ({ children }) => (
                                            <em className='italic'>
                                              {children}
                                            </em>
                                          ),
                                        }}
                                      >
                                        {message.content}
                                      </ReactMarkdown>
                                      {userActionButtons}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 流式文本临时气泡（仅文本对话） */}
                {isStreaming && streamingText && (
                  <div
                    className={cn(
                      "p-2 transition-colors text-sm text-black mr-3"
                    )}
                  >
                    {/* AI消息标识 */}
                    <div className='flex items-center gap-2 mb-2'>
                      <SmartImage
                        src={chatLogoSrc}
                        alt='TAI Logo'
                        className='w-4 h-4'
                      />
                      <span className={aiBrandTextClass}>
                        TAI
                      </span>
                    </div>
                    <div className='text-sm leading-relaxed text-black break-words markdown-content'>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingText}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <ImagePreviewModal
          isOpen={true}
          imageSrc={previewImage.src}
          imageTitle={previewImage.title}
          onClose={handleClosePreview}
        />
      )}
    </div>
  );
};

export default AIChatDialog;
