import React from 'react';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Eraser, Square, Trash2, Box, Image, Layers, Sparkles, Type, GitBranch, MousePointer2, LayoutTemplate, FolderOpen, HelpCircle, MessageCircle, Copy, ClipboardPaste } from 'lucide-react';
import TextStylePanel from './TextStylePanel';
import ColorPicker from './ColorPicker';
import AbrBrushPicker from './AbrBrushPicker';
import { useToolStore, useUIStore } from '@/stores';
import { useShallow } from 'zustand/react/shallow';
import { useAIChatStore } from '@/stores/aiChatStore';
import type { LineStyle } from '@/stores/toolStore';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import paper from 'paper';
import { isRaster } from '@/utils/paperCoords';
import { canvasToDataUrl } from '@/utils/imageConcurrency';
import { isRemoteUrl, normalizePersistableImageRef } from '@/utils/imageSource';
import { useLocaleText } from '@/utils/localeText';
import { useFlowOnboardingStore } from '@/stores/flowOnboardingStore';
import { useCommentStore } from '@/stores/commentStore';
import { SHOW_FLOW_ONBOARDING_TOOLBAR, SHOW_TEAM_COLLABORATION } from '@/config/featureFlags';
import '@/components/collaboration/comment-mode.css';

// 统一画板：移除 Node 模式专属按钮组件

// 自定义图标组件（仅保留当前使用的）

// 直线工具图标
const StraightLineIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// 自由绘制图标
const FreeDrawIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <path
      d="M2 10 Q4 2 6 6 T10 4 Q12 8 14 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const DashedSelectIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" fill="none" />
  </svg>
);

const MarqueeSelectIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" fill="none" />
    <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const CircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

const LineStyleIcon: React.FC<{ className?: string; styleType: LineStyle }> = ({ className, styleType }) => {
  if (styleType === 'dashed') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3" />
      </svg>
    );
  }

  if (styleType === 'dash-dot') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 2 1 2" />
      </svg>
    );
  }

  if (styleType === 'sketch-end-heavy') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="2.5" cy="8" r="1.6" fill="currentColor" />
        <circle cx="13.5" cy="8" r="1.6" fill="currentColor" />
      </svg>
    );
  }

  if (styleType === 'sketch-center-heavy') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="8" r="1.7" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

const LineStylePreview: React.FC<{ className?: string; styleType: LineStyle }> = ({ className, styleType }) => {
  if (styleType === 'dashed') {
    return (
      <svg width="56" height="12" viewBox="0 0 56 12" fill="none" className={className}>
        <line x1="4" y1="6" x2="52" y2="6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 4" />
      </svg>
    );
  }

  if (styleType === 'dash-dot') {
    return (
      <svg width="56" height="12" viewBox="0 0 56 12" fill="none" className={className}>
        <line x1="4" y1="6" x2="52" y2="6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="8 3 1.2 3" />
      </svg>
    );
  }

  if (styleType === 'sketch-end-heavy') {
    return (
      <svg width="56" height="12" viewBox="0 0 56 12" fill="none" className={className}>
        <line x1="4" y1="6" x2="52" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="6" cy="6" r="2.2" fill="currentColor" />
        <circle cx="50" cy="6" r="2.2" fill="currentColor" />
      </svg>
    );
  }

  if (styleType === 'sketch-center-heavy') {
    return (
      <svg width="56" height="12" viewBox="0 0 56 12" fill="none" className={className}>
        <line x1="4" y1="6" x2="52" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="28" cy="6" r="2.3" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg width="56" height="12" viewBox="0 0 56 12" fill="none" className={className}>
      <line x1="4" y1="6" x2="52" y2="6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
};

const LINE_STYLE_OPTIONS: Array<{ value: LineStyle; labelZh: string; labelEn: string }> = [
  { value: 'solid', labelZh: '实线', labelEn: 'Solid' },
  { value: 'dashed', labelZh: '虚线', labelEn: 'Dashed' },
  { value: 'dash-dot', labelZh: '点画线', labelEn: 'Dash Dot' },
  { value: 'sketch-end-heavy', labelZh: '手绘风（两头粗）', labelEn: 'Sketch (Heavy Ends)' },
  { value: 'sketch-center-heavy', labelZh: '手绘风（中间粗）', labelEn: 'Sketch (Heavy Center)' },
];

const LineStylePicker: React.FC<{
  value: LineStyle;
  onChange: (style: LineStyle) => void;
  disabled?: boolean;
  title?: string;
}> = ({ value, onChange, disabled = false, title }) => {
  const { lt } = useLocaleText();
  const [isOpen, setIsOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInPanel = panelRef.current?.contains(target);
      const clickedInButton = buttonRef.current?.contains(target);
      if (!clickedInPanel && !clickedInButton) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isOpen]);

  return (
    <div className="relative">
      <div
        ref={buttonRef}
        className={cn(
          "w-6 h-6 rounded border border-gray-300 bg-white cursor-pointer flex items-center justify-center",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        title={title}
      >
        <LineStyleIcon styleType={value} className="w-4 h-4 text-gray-700" />
      </div>

      {isOpen && (
        <div
          ref={panelRef}
          className="absolute left-full top-1/2 z-[1010] ml-2 w-44 -translate-y-1/2 rounded-xl border border-liquid-glass-light bg-liquid-glass-light p-2 shadow-liquid-glass-lg backdrop-blur-minimal backdrop-saturate-125"
        >
          <div className="mb-1 px-1 text-[11px] font-medium text-gray-500">{lt('线条样式', 'Line Style')}</div>
          <div className="flex flex-col gap-1">
            {LINE_STYLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "flex h-8 w-full items-center justify-between rounded-lg border px-2 text-xs font-medium transition-colors",
                  value === option.value
                    ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                    : "border-gray-200 bg-white/95 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                )}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                title={lt(option.labelZh, option.labelEn)}
              >
                <LineStylePreview styleType={option.value} className="h-3 w-14 shrink-0" />
                <span className="ml-2 truncate">{lt(option.labelZh, option.labelEn)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// 添加节点图标 - 带连接线的节点图标
const AddNodeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    {/* 左侧节点 */}
    <rect x="1" y="5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    {/* 右侧节点 */}
    <rect x="10" y="5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    {/* 连接线 */}
    <path d="M6 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    {/* 连接线箭头 */}
    <path d="M8.5 6L10 7.5L8.5 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

// 加号图标 - 用于添加工具主按钮
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// 长宽比选择已迁移至底部 AI 对话框


// 其他未使用的图标已移除，保持文件精简


interface ToolBarProps {
  style?: React.CSSProperties;
  onClearCanvas?: () => void;
}

// 水平滑块已移除（未使用）

// 自定义垂直滑块组件
const VerticalSlider: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}> = ({ value, min, max, onChange, disabled = false }) => {
  const sliderRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    setIsDragging(true);
    updateValue(e);
    e.preventDefault();
  };

  const updateValue = (e: MouseEvent | React.MouseEvent) => {
    if (!sliderRef.current || disabled) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(1, 1 - y / rect.height)); // 从下往上滑动值增大
    const newValue = Math.round(min + percentage * (max - min));
    onChange(newValue);
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        updateValue(e);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 计算滑块位置
  const percentage = (value - min) / (max - min);

  return (
    <div
      ref={sliderRef}
      className={`relative w-2 h-24 bg-gray-200 rounded-full cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onMouseDown={handleMouseDown}
    >
      {/* 填充的进度条 */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-all duration-150 bg-gray-800 rounded-full"
        style={{ height: `${percentage * 100}%` }}
      />
      {/* 滑块圆圈 */}
      <div
        className="absolute w-3 h-3 transition-all duration-150 bg-white border-2 border-gray-800 rounded-full shadow-md"
        style={{ 
          bottom: `calc(${percentage * 100}% - 6px)`,
          left: '50%',
          transform: 'translateX(-50%)'
        }}
      />
    </div>
  );
};

const ToolBar: React.FC<ToolBarProps> = ({ onClearCanvas }) => {
  const { lt } = useLocaleText();
  const flowOnboardingActive = useFlowOnboardingStore((state) => state.active);
  // 使用 Zustand store
  const {
    drawMode,
    currentColor,
    fillColor,
    strokeWidth,
    eraserSize,
    lineStyle,
    isEraser,
    hasFill,
    abrBrushId,
    setDrawMode,
    setCurrentColor,
    setFillColor,
    setStrokeWidth,
    setEraserSize,
    setLineStyle,
    setAbrBrushId,
    toggleEraser,
    toggleFill,
  } = useToolStore(
    useShallow((state) => ({
      drawMode: state.drawMode,
      currentColor: state.currentColor,
      fillColor: state.fillColor,
      strokeWidth: state.strokeWidth,
      eraserSize: state.eraserSize,
      lineStyle: state.lineStyle,
      isEraser: state.isEraser,
      hasFill: state.hasFill,
      abrBrushId: state.abrBrushId,
      setDrawMode: state.setDrawMode,
      setCurrentColor: state.setCurrentColor,
      setFillColor: state.setFillColor,
      setStrokeWidth: state.setStrokeWidth,
      setEraserSize: state.setEraserSize,
      setLineStyle: state.setLineStyle,
      setAbrBrushId: state.setAbrBrushId,
      toggleEraser: state.toggleEraser,
      toggleFill: state.toggleFill,
    })),
  );

  const {
    showLayerPanel: isLayerPanelOpen,
    toggleLayerPanel,
    toggleFlowPanel,
    showFlowPanel,
    flowUIEnabled,
    focusMode,
    showTemplatePanel,
    toggleTemplatePanel,
    setShowTemplatePanel,
    showLibraryPanel,
    toggleLibraryPanel,
  } = useUIStore(
    useShallow((state) => ({
      showLayerPanel: state.showLayerPanel,
      toggleLayerPanel: state.toggleLayerPanel,
      toggleFlowPanel: state.toggleFlowPanel,
      showFlowPanel: state.showFlowPanel,
      flowUIEnabled: state.flowUIEnabled,
      focusMode: state.focusMode,
      showTemplatePanel: state.showTemplatePanel,
      toggleTemplatePanel: state.toggleTemplatePanel,
      setShowTemplatePanel: state.setShowTemplatePanel,
      showLibraryPanel: state.showLibraryPanel,
      toggleLibraryPanel: state.toggleLibraryPanel,
    })),
  );

  // 用于防止事件循环的标志
  const isTogglingFromButtonRef = React.useRef(false);

  // 监听外部关闭模板面板（点击空白、ESC等）
  React.useEffect(() => {
    const handler = (event: Event) => {
      if (isTogglingFromButtonRef.current) return;
      const detail = (event as CustomEvent<any>)?.detail || {};
      if (!detail.visible) {
        if (useUIStore.getState().showTemplatePanel) {
          setShowTemplatePanel(false);
        }
        return;
      }
      const tab = typeof detail.tab === 'string' ? detail.tab : '';
      setShowTemplatePanel(tab === 'templates');
    };
    window.addEventListener('flow:add-panel-visibility-change', handler as EventListener);
    return () => window.removeEventListener('flow:add-panel-visibility-change', handler as EventListener);
  }, [setShowTemplatePanel]);

  const dispatchTemplatePanelState = React.useCallback((visible: boolean) => {
    isTogglingFromButtonRef.current = true;
    const detail = visible
      ? {
          visible: true,
          tab: 'templates',
          scope: 'public',
          allowedTabs: ['templates', 'personal'],
        }
      : { visible: false };
    try { window.dispatchEvent(new CustomEvent('flow:set-template-panel', { detail })); } catch {}
    setTimeout(() => {
      isTogglingFromButtonRef.current = false;
    }, 100);
  }, []);

  // 包装 toggleTemplatePanel：仅在用户点击时同步到 Flow，避免 useEffect 循环触发 #185
  const handleToggleTemplatePanel = React.useCallback(() => {
    toggleTemplatePanel();
    dispatchTemplatePanelState(useUIStore.getState().showTemplatePanel);
  }, [toggleTemplatePanel, dispatchTemplatePanelState]);

  const selectionGroupRef = React.useRef<HTMLDivElement>(null);
  const drawingGroupRef = React.useRef<HTMLDivElement>(null);
  const addToolsGroupRef = React.useRef<HTMLDivElement>(null);
  const [isSelectionMenuOpen, setSelectionMenuOpen] = React.useState(false);
  const [isDrawingMenuOpen, setDrawingMenuOpen] = React.useState(false);
  const [isAddToolsMenuOpen, setAddToolsMenuOpen] = React.useState(false);
  const selectionMenuEnabled = true;
  const isSubMenuOpen = (selectionMenuEnabled && isSelectionMenuOpen) || isDrawingMenuOpen || isAddToolsMenuOpen;
  const drawingModes = ['free', 'line', 'rect', 'circle'] as const;

  const {
    toggleDialog,
    isVisible: isAIDialogVisible,
    isMaximized: isAIChatMaximized,
    setSourceImageForEditing,
    showDialog,
    chatTheme,
  } = useAIChatStore();
  const isBlackTheme = chatTheme === "black";

  // 原始尺寸模式状态
  const [useOriginalSize, setUseOriginalSize] = React.useState(() => {
    return localStorage.getItem('tanva-use-original-size') === 'true';
  });

  // 监听文本样式变化以刷新UI
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const tick = () => forceUpdate((x) => x + 1);
    window.addEventListener('tanvaTextStyleChanged', tick);
    return () => window.removeEventListener('tanvaTextStyleChanged', tick);
  }, []);

  // 自动关闭选择菜单：当不在选择模式时
  React.useEffect(() => {
    if (drawMode !== 'select' && drawMode !== 'marquee' && drawMode !== 'pointer') {
      setSelectionMenuOpen(false);
    }
  }, [drawMode]);

  // 自动关闭绘制菜单：当离开绘制相关模式或启用橡皮擦时
  React.useEffect(() => {
    if (!drawingModes.includes(drawMode as typeof drawingModes[number]) || isEraser) {
      setDrawingMenuOpen(false);
    }
  }, [drawMode, isEraser]);

  // 自动关闭添加工具菜单：当离开相关模式时
  React.useEffect(() => {
    if (drawMode !== 'image' && drawMode !== '3d-model') {
      setAddToolsMenuOpen(false);
    }
  }, [drawMode]);

  // 点击画布空白处自动收起次级菜单
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        target instanceof Element &&
        (target.closest('[data-abr-brush-library]') ||
          target.closest('[data-abr-brush-picker]'))
      ) {
        return;
      }

      if (selectionMenuEnabled) {
        if (
          isSelectionMenuOpen &&
          selectionGroupRef.current &&
          !selectionGroupRef.current.contains(target)
        ) {
          setSelectionMenuOpen(false);
        }
      }

      if (
        isDrawingMenuOpen &&
        drawingGroupRef.current &&
        !drawingGroupRef.current.contains(target)
      ) {
        setDrawingMenuOpen(false);
      }

      if (
        isAddToolsMenuOpen &&
        addToolsGroupRef.current &&
        !addToolsGroupRef.current.contains(target)
      ) {
        setAddToolsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSelectionMenuOpen, isDrawingMenuOpen, isAddToolsMenuOpen]);

  // AI 对话框最大化时隐藏工具栏（专注模式下保留工具栏）
  if (isAIChatMaximized) {
    return null;
  }

  // 判断当前工具是否支持填充
  const supportsFill = (mode: any): boolean => {
    return ['rect', 'circle'].includes(mode);
  };

  // 根据模式获取激活状态的按钮样式
  const inactiveButtonStyle = isBlackTheme
    ? "bg-[#1d1d1d] text-white border border-[#1d1d1d] hover:bg-[#3f3f3f] hover:text-white hover:border-[#3f3f3f]"
    : "bg-white/70 text-gray-700 border-transparent hover:bg-gray-800/10 hover:border-gray-800/20";
  const getActiveButtonStyle = (isActive: boolean) => {
    if (!isActive) {
      return inactiveButtonStyle;
    }
    if (isBlackTheme) {
      return "tanva-toolbar-active bg-white text-[#1d1d1d] border border-white hover:bg-white hover:text-[#1d1d1d] hover:border-white";
    }
    return "bg-gray-800 text-white";
  };

  // 获取绘图子面板按钮样式（绘图工具展开菜单中的按钮）
  const getSubPanelButtonStyle = (isActive: boolean) => {
    if (!isActive) {
      return inactiveButtonStyle;
    }
    if (isBlackTheme) {
      return "tanva-toolbar-active bg-white text-[#1d1d1d] border border-white hover:bg-white hover:text-[#1d1d1d] hover:border-white";
    }
    return "bg-gray-800 text-white";
  };

  // 切换原始尺寸模式
  const toggleOriginalSizeMode = () => {
    const newValue = !useOriginalSize;
    setUseOriginalSize(newValue);
    localStorage.setItem('tanva-use-original-size', newValue.toString());

    // 派发事件通知其他组件
    window.dispatchEvent(new CustomEvent('tanva-size-mode-changed'));

    console.log('🖼️ 原始尺寸模式:', newValue ? '启用' : '禁用');

    if (newValue) {
      console.log('📏 图像将以原始像素尺寸显示（1像素=1像素）');
    } else {
      console.log('📐 图像将自动缩放适应画布');
    }
  };

  // 处理AI编辑图像功能
  const handleAIEditImage = async () => {
    // 检查画布中是否有选中的图像
    const imageInstances = (window as any).tanvaImageInstances || [];
    const selectedImage = imageInstances.find((img: any) => img.isSelected);

    if (selectedImage) {
      // 如果有选中的图像，获取其数据并设置为编辑源
      try {
        // 找到对应的Paper.js Raster对象
        const imageGroup = paper.project?.layers?.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === selectedImage.id
          )
        )[0];

        if (imageGroup) {
          const raster = imageGroup.children.find(child => isRaster(child)) as paper.Raster;
          const remoteCandidate = (() => {
            const candidates = [
              selectedImage?.imageData?.remoteUrl,
              selectedImage?.imageData?.url,
              selectedImage?.imageData?.src,
              (raster as any)?.data?.remoteUrl,
            ];
            for (const candidate of candidates) {
              if (typeof candidate !== "string") continue;
              const trimmed = candidate.trim();
              if (!trimmed) continue;
              const normalized = normalizePersistableImageRef(trimmed) || trimmed;
              if (isRemoteUrl(normalized)) return normalized;
            }
            return null;
          })();

          if (remoteCandidate) {
            setSourceImageForEditing(remoteCandidate);
            showDialog();
            console.log('🎨 已选择图像进行AI编辑');
            return;
          }

          if (raster && raster.canvas) {
            const imageData = await canvasToDataUrl(raster.canvas, 'image/png');
            setSourceImageForEditing(imageData);
            showDialog();
            console.log('🎨 已选择图像进行AI编辑');
          }
        }
      } catch (error) {
        console.error('获取图像数据失败:', error);
      }
    } else {
      // 如果没有选中图像，直接打开对话框让用户上传
      showDialog();
      console.log('🎨 打开AI对话框，用户可上传图像进行编辑');
    }
  };

  // 监听文本样式变化以刷新UI
  //（保留原有逻辑，放到增量effect前已处理）

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
    <div
      className={cn(
        "tanva-toolbar-shell fixed top-1/2 transform -translate-y-1/2 flex flex-col items-center gap-2 px-2 py-2 rounded-[999px] z-[1000] transition-all duration-[50ms] ease-out",
        isBlackTheme
          ? "bg-[#1d1d1d] border border-[#1a1a1a] shadow-[0_20px_48px_rgba(0,0,0,0.6)]"
          : "bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass",
        isLayerPanelOpen ? "left-[322px]" : "left-2"
      )}
    >
      {/* AI 对话开关 - 暂时隐藏 */}
      {false && (
        <Button
          variant={isAIDialogVisible ? 'default' : 'outline'}
          size="sm"
          className={cn(
            "p-0 h-8 w-8 rounded-full",
            getActiveButtonStyle(isAIDialogVisible)
          )}
          onClick={toggleDialog}
          title={isAIDialogVisible ? lt("关闭 AI 对话", "Close AI chat") : lt("打开 AI 对话", "Open AI chat")}
        >
          <Sparkles className="w-4 h-4" />
        </Button>
      )}

      {/* 长宽比选择移至底部 AI 对话框；左侧工具栏不再展示 */}

      {/* Flow 工具开关 */}
      {flowUIEnabled && (
        <Tooltip open={isSubMenuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              variant={showFlowPanel ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "p-0 h-8 w-8 rounded-full",
                getActiveButtonStyle(showFlowPanel)
              )}
              onClick={toggleFlowPanel}
            >
              <GitBranch className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {showFlowPanel ? lt('关闭 Flow 面板', 'Close Flow panel') : lt('打开 Flow 面板', 'Open Flow panel')}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Flow 节点跨项目复制 */}
      {flowUIEnabled && showFlowPanel && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size="sm"
                className="p-0 h-8 w-8 rounded-full"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('tanva-flow-copy-request'));
                }}
                title={lt('复制选中节点', 'Copy selected nodes')}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {lt('复制选中节点', 'Copy selected nodes')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='outline'
                size="sm"
                className="p-0 h-8 w-8 rounded-full"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('tanva-flow-paste-request'));
                }}
                title={lt('粘贴节点', 'Paste nodes')}
              >
                <ClipboardPaste className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {lt('粘贴节点', 'Paste nodes')}
            </TooltipContent>
          </Tooltip>
        </>
      )}

      {/* 预留：若需在主工具栏控制网格背景颜色，可在此恢复控件 */}

      {/* 选择工具分组 */}
      <div className="relative" ref={selectionGroupRef}>
        {/* 主按钮 - 显示当前选择模式 */}
        <Tooltip open={isSubMenuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              variant={drawMode === 'select' || drawMode === 'marquee' || drawMode === 'pointer' ? "default" : "outline"}
              size="sm"
            className={cn(
              "p-0 h-8 w-8 rounded-full",
              getActiveButtonStyle(drawMode === 'select' || drawMode === 'marquee' || drawMode === 'pointer')
            )}
            onClick={() => {
                if (drawMode !== 'select' && drawMode !== 'marquee' && drawMode !== 'pointer') {
                  setDrawMode('select');
                  logger.tool('工具栏主按钮：切换到框选工具');
                  selectionMenuEnabled && setSelectionMenuOpen(true);
                } else if (selectionMenuEnabled) {
                  setSelectionMenuOpen((prev) => !prev);
                } else if (drawMode !== 'select') {
                  setDrawMode('select');
                }
                setDrawingMenuOpen(false);
            }}
          >
            {drawMode === 'select' && <DashedSelectIcon className="w-4 h-4" />}
            {drawMode === 'marquee' && <MarqueeSelectIcon className="w-4 h-4" />}
            {drawMode === 'pointer' && <MousePointer2 className="w-4 h-4" />}
            {/* 如果不是选择模式，显示默认的框选图标但为非激活状态 */}
              {drawMode !== 'select' && drawMode !== 'marquee' && drawMode !== 'pointer' && <DashedSelectIcon className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {drawMode === 'select'
              ? lt('复合选择', 'Composite Select')
              : drawMode === 'marquee'
                ? lt('纯框选（不含节点）', 'Marquee (no nodes)')
                : drawMode === 'pointer'
                  ? lt('节点选择工具', 'Node Select')
                  : lt('点击切换到复合选择', 'Switch to composite select')}
          </TooltipContent>
        </Tooltip>

        {/* 选择次级菜单：点击展开显示 */}
        {selectionMenuEnabled && isSelectionMenuOpen && (
          <div className="absolute left-full ml-3 transition-all duration-[50ms] ease-out z-[1001]" style={{ top: '-14px' }}>
            <div className="flex flex-col items-center gap-3 px-2 py-3 rounded-[999px] bg-liquid-glass-light backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass-light" style={{ marginTop: '1px' }}>
              {/* 选择工具按钮组 */}
              <div className="flex flex-col gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'select' ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'select')
                      )}
                      onClick={() => setDrawMode('select')}
                    >
                      <DashedSelectIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('复合选择', 'Composite Select')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'pointer' ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'pointer')
                      )}
                      onClick={() => setDrawMode('pointer')}
                    >
                      <MousePointer2 className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('节点选择工具', 'Node Select')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'marquee' ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'marquee')
                      )}
                      onClick={() => setDrawMode('marquee')}
                    >
                      <MarqueeSelectIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('纯框选（不含节点）', 'Marquee (no nodes)')}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 添加工具分组（图片/3D/节点） */}
      <div className="relative" ref={addToolsGroupRef}>
        {/* 主按钮 - 加号 */}
        <Tooltip open={isSubMenuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              variant={drawMode === 'image' || drawMode === '3d-model' ? "default" : "outline"}
              size="sm"
              className={cn(
                "p-0 h-8 w-8 rounded-full",
                getActiveButtonStyle(drawMode === 'image' || drawMode === '3d-model')
              )}
              onClick={() => {
                if (drawMode !== 'image' && drawMode !== '3d-model') {
                  setAddToolsMenuOpen(true);
                } else {
                  setAddToolsMenuOpen((prev) => !prev);
                }
                setSelectionMenuOpen(false);
                setDrawingMenuOpen(false);
              }}
            >
              {drawMode === 'image' && <Image className="w-4 h-4" />}
              {drawMode === '3d-model' && <Box className="w-4 h-4" />}
              {drawMode !== 'image' && drawMode !== '3d-model' && <PlusIcon className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {drawMode === 'image'
              ? lt('添加图片', 'Add Image')
              : drawMode === '3d-model'
                ? lt('添加3D模型', 'Add 3D Model')
                : lt('添加内容', 'Add Content')}
          </TooltipContent>
        </Tooltip>

        {/* 添加工具次级菜单 */}
        {isAddToolsMenuOpen && (
          <div className="absolute left-full ml-3 transition-all duration-[50ms] ease-out z-[1001]" style={{ top: '-14px' }}>
            <div className="flex flex-col items-center gap-3 px-2 py-3 rounded-[999px] bg-liquid-glass-light backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass-light" style={{ marginTop: '1px' }}>
              <div className="flex flex-col gap-1">
                {/* 图片工具 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'image' ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'image')
                      )}
                      onClick={() => {
                        setDrawMode('image');
                        setAddToolsMenuOpen(false);
                      }}
                    >
                      <Image className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('添加图片', 'Add Image')}</TooltipContent>
                </Tooltip>

                {/* 3D模型工具 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === '3d-model' ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === '3d-model')
                      )}
                      onClick={() => setDrawMode('3d-model')}
                    >
                      <Box className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('添加3D模型', 'Add 3D Model')}</TooltipContent>
                </Tooltip>

                {/* 节点工具 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        inactiveButtonStyle
                      )}
                      onClick={() => {
                        // 在画布可视区域中心打开节点面板（client 坐标）
                        const canvas =
                          document.querySelector('.tanva-main-canvas') ||
                          document.querySelector('.react-flow');
                        const center = (() => {
                          const rect = canvas?.getBoundingClientRect();
                          if (!rect) {
                            return {
                              x: window.innerWidth / 2,
                              y: window.innerHeight / 2,
                            };
                          }
                          return {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                          };
                        })();
                        window.dispatchEvent(new CustomEvent('flow:set-template-panel', {
                          detail: {
                            visible: true,
                            tab: 'nodes',
                            allowedTabs: ['nodes', 'beta', 'custom'],
                            screen: center,
                          }
                        }));
                        setAddToolsMenuOpen(false);
                      }}
                    >
                      <AddNodeIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('添加节点（双击画布空白处触发）', 'Add Node (double-click blank canvas)')}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 绘制工具分组 */}
      <div className="relative" ref={drawingGroupRef}>
        {/* 主按钮 - 显示当前绘制模式 */}
        <Tooltip open={isSubMenuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              variant={drawMode !== 'select' && drawMode !== 'marquee' && drawMode !== 'pointer' && drawMode !== 'text' && drawMode !== 'image' && drawMode !== '3d-model' && drawMode !== 'screenshot' && drawMode !== 'comment' && !isEraser ? "default" : "outline"}
              size="sm"
              className={cn(
                "p-0 h-8 w-8 rounded-full",
                getActiveButtonStyle(drawMode !== 'select' && drawMode !== 'marquee' && drawMode !== 'pointer' && drawMode !== 'text' && drawMode !== 'image' && drawMode !== '3d-model' && drawMode !== 'screenshot' && drawMode !== 'comment' && !isEraser)
              )}
              onClick={() => {
                const isDrawingMode = drawingModes.includes(drawMode as typeof drawingModes[number]);
                if (!isDrawingMode || isEraser) {
                  setDrawMode('free');
                  logger.tool('工具栏主按钮：切换到绘线工具');
                  setDrawingMenuOpen(true);
                } else {
                  setDrawingMenuOpen((prev) => !prev);
                }
                setSelectionMenuOpen(false);
              }}
            >
              {drawMode === 'free' && <FreeDrawIcon className="w-4 h-4" />}
              {drawMode === 'line' && <StraightLineIcon className="w-4 h-4" />}
              {drawMode === 'rect' && <Square className="w-4 h-4" />}
              {drawMode === 'circle' && <CircleIcon className="w-4 h-4" />}
              {/* 如果是选择模式或独立工具模式，显示默认的自由绘制图标但为非激活状态 */}
              {(drawMode === 'select' || drawMode === 'marquee' || drawMode === 'pointer' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'text' || drawMode === 'screenshot' || drawMode === 'comment' || drawMode === 'polyline') && <FreeDrawIcon className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {drawMode === 'select' || drawMode === 'marquee' || drawMode === 'pointer' || isEraser || drawMode === 'text' || drawMode === 'image' || drawMode === '3d-model' || drawMode === 'screenshot' || drawMode === 'comment'
              ? lt('点击切换到自由绘制工具', 'Switch to free draw')
              : lt(
                  `当前工具：${drawMode === 'free' ? '自由绘制' : drawMode === 'line' ? '直线' : drawMode === 'rect' ? '矩形' : drawMode === 'circle' ? '圆形' : drawMode === 'polyline' ? '多段线' : drawMode}`,
                  `Current tool: ${drawMode === 'free' ? 'Free Draw' : drawMode === 'line' ? 'Line' : drawMode === 'rect' ? 'Rectangle' : drawMode === 'circle' ? 'Circle' : drawMode === 'polyline' ? 'Polyline' : drawMode}`
                )}
          </TooltipContent>
        </Tooltip>

        {/* 绘制次级菜单：点击展开显示 */}
        {isDrawingMenuOpen && !isEraser && (
          <div className="absolute left-full ml-3 transition-all duration-[50ms] ease-out z-[1001] overflow-visible" style={{ top: '-14px' }}>
            <div
              className="flex h-[300px] flex-col overflow-hidden rounded-[999px] border border-liquid-glass-light bg-liquid-glass-light shadow-liquid-glass-lg backdrop-blur-minimal backdrop-saturate-125"
              style={{ marginTop: '1px' }}
            >
              <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto overflow-x-hidden px-2 py-3 scrollbar-hidden">
              {/* 绘图工具按钮组 */}
              <div className="flex flex-col gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'free' && !isEraser ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'free' && !isEraser)
                      )}
                      onClick={() => setDrawMode('free')}
                    >
                      <FreeDrawIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('自由绘制', 'Free Draw')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'line' && !isEraser ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'line' && !isEraser)
                      )}
                      onClick={() => setDrawMode('line')}
                    >
                      <StraightLineIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('绘制直线', 'Draw Line')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'rect' && !isEraser ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'rect' && !isEraser)
                      )}
                      onClick={() => setDrawMode('rect')}
                    >
                      <Square className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('绘制矩形', 'Draw Rectangle')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={drawMode === 'circle' && !isEraser ? 'default' : 'outline'}
                      size="sm"
                      className={cn(
                        "p-0 h-8 w-8 rounded-full",
                        getSubPanelButtonStyle(drawMode === 'circle' && !isEraser)
                      )}
                      onClick={() => setDrawMode('circle')}
                    >
                      <CircleIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>{lt('绘制圆形', 'Draw Circle')}</TooltipContent>
                </Tooltip>
              </div>

              <Separator orientation="horizontal" className="w-6" />

              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-medium text-gray-600">{lt('笔刷', 'Brush')}</span>
                <AbrBrushPicker
                  selectedBrushId={abrBrushId}
                  disabled={isEraser}
                  onSelectBrush={(brushId) => {
                    setAbrBrushId(brushId);
                    if (brushId) {
                      setDrawMode('free');
                    }
                  }}
                />
              </div>

              <Separator orientation="horizontal" className="w-6" />

              {/* 线条颜色选择器 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-medium text-gray-600">{lt('线条', 'Stroke')}</span>
                <ColorPicker
                  value={currentColor}
                  onChange={setCurrentColor}
                  disabled={isEraser}
                  title={lt('线条颜色', 'Stroke Color')}
                  panelPlacement="right"
                />
              </div>

              {/* 线条样式 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-medium text-gray-600">{lt('样式', 'Style')}</span>
                <LineStylePicker
                  value={lineStyle}
                  onChange={setLineStyle}
                  disabled={isEraser || !!abrBrushId}
                  title={lt('线条样式', 'Line Style')}
                />
              </div>

              {/* 填充控制区域 - 只在支持填充的工具时显示 */}
              {supportsFill(drawMode) && (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs font-medium text-gray-600">{lt('填充', 'Fill')}</span>
                  <ColorPicker
                    value={fillColor}
                    onChange={(color) => {
                      setFillColor(color);
                      // 当用户选择颜色时，自动启用填充
                      if (!hasFill) {
                        toggleFill();
                      }
                    }}
                    onTransparentSelect={toggleFill}
                    disabled={isEraser}
                    title={lt('填充颜色', 'Fill Color')}
                    showTransparent={true}
                    isTransparent={!hasFill}
                    showFillPattern={hasFill}
                    panelPlacement="right"
                  />
                </div>
              )}

              {/* 线宽控制 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-medium text-gray-600 tabular-nums">
                  {strokeWidth}
                </span>
                <VerticalSlider
                  value={strokeWidth}
                  min={1}
                  max={20}
                  onChange={setStrokeWidth}
                  disabled={isEraser}
                />
              </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 橡皮擦工具 - 统一画板下仅对绘图生效，节点擦除关闭 */}
      <div className="relative flex flex-col items-center gap-2">
        <Tooltip open={isSubMenuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              onClick={toggleEraser}
              variant={isEraser ? "default" : "outline"}
              size="sm"
              className={cn(
                "p-0 h-8 w-8 rounded-full",
                getActiveButtonStyle(isEraser)
              )}
            >
              <Eraser className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isEraser ? lt("点击切换到画笔", "Switch to brush") : lt("点击切换到橡皮擦", "Switch to eraser")}
          </TooltipContent>
        </Tooltip>

        {isEraser && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-gray-600 tabular-nums">
              {eraserSize}
            </span>
            <VerticalSlider
              value={eraserSize}
              min={2}
              max={50}
              onChange={setEraserSize}
              disabled={false}
            />
            <span className="text-[10px] text-gray-500">{lt('大小', 'Size')}</span>
          </div>
        )}
      </div>

      {/* 独立工具按钮 */}
      <div className="flex flex-col items-center gap-2">
        {/* 文字工具 */}
        <div className="relative">
            <Tooltip open={isSubMenuOpen ? false : undefined}>
              <TooltipTrigger asChild>
                <Button
                  variant={drawMode === 'text' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    "p-0 h-8 w-8 rounded-full",
                    getActiveButtonStyle(drawMode === 'text')
                  )}
                  onClick={() => {
                    setDrawMode('text');
                    logger.tool('工具栏：切换到文字工具');
                  }}
                >
                  <Type className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {lt('点击空白处使用文本工具', 'Click blank area to use text tool')}
              </TooltipContent>
            </Tooltip>

            {/* 文本样式面板 - 当文本工具激活时显示 */}
            {drawMode === 'text' && (
              <TextStylePanel
                currentStyle={(window as any).tanvaTextTool?.getSelectedTextStyle?.() || {
                  fontFamily: '"Heiti SC", "SimHei", "黑体", sans-serif',
                  fontWeight: 'bold',
                  fontSize: 32,
                  color: currentColor,
                  align: 'left',
                  italic: false
                }}
                onStyleChange={(updates) => {
                  const textTool = (window as any).tanvaTextTool;
                  if (textTool) {
                    // 如果有选中的文本，更新该文本的样式
                    if (textTool.selectedTextId) {
                      textTool.updateTextStyle(textTool.selectedTextId, updates);
                    } else {
                      // 否则更新默认样式
                      textTool.updateDefaultStyle(updates);
                    }
                  }
                }}
              />
            )}
        </div>

        {SHOW_TEAM_COLLABORATION ? (
          <div className="relative">
            <Tooltip open={isSubMenuOpen ? false : undefined}>
              <TooltipTrigger asChild>
                <Button
                  variant={drawMode === 'comment' ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'p-0 h-8 w-8 rounded-full',
                    getActiveButtonStyle(drawMode === 'comment')
                  )}
                  onClick={() => {
                    if (drawMode === 'comment') {
                      useCommentStore.getState().reset();
                      setDrawMode('select');
                      logger.tool('工具栏：退出评论模式');
                    } else {
                      setDrawMode('comment');
                      logger.tool('工具栏：切换到评论模式');
                    }
                  }}
                >
                  <MessageCircle className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              {drawMode !== 'comment' ? (
                <TooltipContent side="right">
                  {lt('评论模式', 'Comment mode')}
                </TooltipContent>
              ) : null}
            </Tooltip>
            {drawMode === 'comment' ? (
              <div className="comment-mode-toolbar-hint">
                {lt('评论模式 (点击画布添加评论)', 'Comment mode (click canvas to add)')}
              </div>
            ) : null}
          </div>
        ) : null}

      {/* AI编辑图像工具 - 暂时隐藏 */}
        {/* <Button
          variant="outline"
          size="sm"
          className="w-8 h-8 px-2 py-2 border-gray-300 bg-white/50"
          onClick={handleAIEditImage}
          title="AI编辑图像 - 选择画布中的图像或上传图像进行AI编辑"
        >
          <AIEditImageIcon className="w-4 h-4" />
        </Button> */}

        {/* 原始尺寸模式切换 - 已隐藏，默认使用自适应模式 */}
        {/* <Button
          variant={useOriginalSize ? 'default' : 'outline'}
          size="sm"
          className="w-8 h-8 px-2 py-2 border-gray-300 bg-white/50"
          onClick={toggleOriginalSizeMode}
          title={useOriginalSize ? '当前：原始尺寸模式 (1像素=1像素)' : '当前：自适应模式 (自动缩放)'}
        >
          <Maximize2 className="w-4 h-4" />
        </Button> */}
      </div>

      <Separator orientation="horizontal" className="w-6" />

      {/* 图层工具 */}
      <Tooltip open={isSubMenuOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <Button
            variant={isLayerPanelOpen ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "p-0 h-8 w-8 rounded-full",
              getActiveButtonStyle(isLayerPanelOpen)
            )}
            onClick={toggleLayerPanel}
          >
            <Layers className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{lt('图层面板', 'Layer Panel')}</TooltipContent>
      </Tooltip>

      {/* 素材库按钮 */}
      <Tooltip open={isSubMenuOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <Button
            variant={showLibraryPanel ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "p-0 h-8 w-8 rounded-full",
              getActiveButtonStyle(showLibraryPanel)
            )}
            onClick={toggleLibraryPanel}
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{lt('素材库', 'Asset Library')}</TooltipContent>
      </Tooltip>

      {/* 模板库按钮 */}
      <Tooltip open={isSubMenuOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <Button
            variant={showTemplatePanel ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "p-0 h-8 w-8 rounded-full",
              getActiveButtonStyle(showTemplatePanel)
            )}
            onClick={handleToggleTemplatePanel}
          >
            <LayoutTemplate className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{lt('公共模板', 'Public Templates')}</TooltipContent>
      </Tooltip>

      {SHOW_FLOW_ONBOARDING_TOOLBAR && (
        <Tooltip open={isSubMenuOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              variant={flowOnboardingActive ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "p-0 h-8 w-8 rounded-full",
                getActiveButtonStyle(flowOnboardingActive)
              )}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('flow:start-onboarding'));
              }}
            >
              <HelpCircle className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {flowOnboardingActive
              ? lt('新手引导进行中', 'Onboarding in progress')
              : lt('新手引导', 'Onboarding guide')}
          </TooltipContent>
        </Tooltip>
      )}

      {/* 自动对齐开关已移至设置面板的视图外观中 */}

      {/* 工具按钮 */}
      {onClearCanvas && (
        <div className="flex flex-col items-center gap-2">
          {/* 清理画布按钮 */}
          <Tooltip open={isSubMenuOpen ? false : undefined}>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  if (window.confirm(lt('确定要清空画布吗？此操作将删除所有图元，不可撤销。', 'Clear canvas? This removes all elements and cannot be undone.'))) {
                    onClearCanvas();
                  }
                }}
                variant="outline"
                size="sm"
                className="w-8 h-8 p-0 border-gray-300 rounded-full bg-white/50 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{lt('清空画布', 'Clear Canvas')}</TooltipContent>
          </Tooltip>
          {/* Paper.js 沙盒开关已移至设置面板的高级选项中 */}
          {/* 专注模式按钮已移至独立组件 FocusModeButton */}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
};

export default ToolBar;
