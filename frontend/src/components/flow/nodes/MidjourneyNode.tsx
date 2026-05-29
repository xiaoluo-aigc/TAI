import React from 'react';
import { Handle, Position, useStore } from 'reactflow';
import { HelpCircle, Send as SendIcon, Sparkles } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import SmartImage from '../../ui/SmartImage';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { parseFlowImageAssetRef } from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import {
  isAssetKeyRef,
  isBlobUrl,
  isDataImageUrl,
  isRemoteUrl,
  toRenderableImageSrc,
} from '@/utils/imageSource';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { useLocaleText } from '@/utils/localeText';
import { useAIChatStore } from '@/stores/aiChatStore';
import { flowImagePreviewWell, flowLetterboxBackground } from './flowNodeDarkTheme';
import RunCreditBadge from './RunCreditBadge';
import { useImageNodeCreditsPreview } from '../hooks/useImageNodeCreditsPreview';

type MidjourneyMode = 'FAST' | 'RELAX';
type AdvancedMidjourneyType = 'midjourneyV7' | 'niji7';

type MidjourneyButtonInfo = {
  customId: string;
  emoji?: string;
  label?: string;
  type?: number;
  style?: number;
};

/**
 * 分组规则：优先与历史「label 以 U/V 开头」一致（用 U/V+数字 避免误判 Upscale 等）；
 * 再兼容少数中转返回的 upscale_1 / variation_2。
 * 展示文案统一为 U1–U4、V1–V4 纯文字（不用 emoji）。
 */
type MjActionButtonGroup = 'upscale' | 'variation' | 'other';

function classifyMidjourneyActionButton(btn: MidjourneyButtonInfo): {
  group: MjActionButtonGroup;
  displayLabel: string;
  sortKey: number;
} {
  const raw = (btn.label ?? '').trim();
  const lower = raw.toLowerCase();

  const legacyU = raw.match(/^U\s*(\d+)/i);
  if (legacyU) {
    const n = parseInt(legacyU[1], 10);
    return { group: 'upscale', displayLabel: `U${n}`, sortKey: n };
  }
  const legacyV = raw.match(/^V\s*(\d+)/i);
  if (legacyV) {
    const n = parseInt(legacyV[1], 10);
    return { group: 'variation', displayLabel: `V${n}`, sortKey: n };
  }

  const upscaleNum = lower.match(/upscale[_\s-]*(\d+)/);
  if (upscaleNum) {
    const n = parseInt(upscaleNum[1], 10);
    return { group: 'upscale', displayLabel: `U${n}`, sortKey: n };
  }
  const upWord = lower.match(/upscal(?:e|ing)\s*#?\s*(\d+)/);
  if (upWord) {
    const n = parseInt(upWord[1], 10);
    return { group: 'upscale', displayLabel: `U${n}`, sortKey: n };
  }

  const variationNum = lower.match(/variation[_\s-]*(\d+)/);
  if (variationNum) {
    const n = parseInt(variationNum[1], 10);
    return { group: 'variation', displayLabel: `V${n}`, sortKey: n };
  }

  const zhUp = raw.match(/放大\s*(\d+)/);
  if (zhUp) {
    const n = parseInt(zhUp[1], 10);
    return { group: 'upscale', displayLabel: `U${n}`, sortKey: n };
  }
  const zhVar = raw.match(/变体\s*(\d+)/);
  if (zhVar) {
    const n = parseInt(zhVar[1], 10);
    return { group: 'variation', displayLabel: `V${n}`, sortKey: n };
  }

  return {
    group: 'other',
    displayLabel: raw || '•',
    sortKey: 999,
  };
}

type Props = {
  id: string;
  type?: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    thumbnail?: string;
    imageUrls?: string[]; // V7/Niji7 多图支持
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    mode?: MidjourneyMode;
    presetPrompt?: string;
    creditsPerCall?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
    // Midjourney 特有的元数据
    taskId?: string;
    /** 147 action 可选参数，与轮询任务 state 一致 */
    mjApiState?: string;
    buttons?: MidjourneyButtonInfo[];
    imageUrl?: string;
    promptEn?: string;
    lastHistoryId?: string;
    speedMode?: 'draft' | 'fast' | 'turbo';
    raw?: boolean;
    chaos?: string | number;
    stylize?: string | number;
    weird?: string | number;
    seed?: string | number;
    noPrompt?: string;
    imageWeight?: string | number;
    styleRefs?: string;
    styleVersion?: string | number;
    styleWeight?: string | number;
    quality?: '1' | '2' | '4';
    draft?: boolean;
    tile?: boolean;
    omniReference?: string;
    omniWeight?: string | number;
    exp?: string | number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
  };
  selected?: boolean;
};

// 构建图片 src - 优先使用 OSS URL，避�?proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (isDataImageUrl(trimmed) || isBlobUrl(trimmed)) {
    return trimmed;
  }

  if (isAssetKeyRef(trimmed)) {
    const key = trimmed.replace(/^\/+/, '');
    return proxifyRemoteAssetUrl(
      `/api/assets/proxy?key=${encodeURIComponent(key)}`,
      { forceProxy: true }
    );
  }

  if (isRemoteUrl(trimmed)) {
    const renderable = toRenderableImageSrc(trimmed);
    return renderable || proxifyRemoteAssetUrl(trimmed, { forceProxy: true });
  }

  return toRenderableImageSrc(trimmed) || undefined;
};

const isAdvancedMidjourneyType = (type?: string): type is AdvancedMidjourneyType =>
  type === 'midjourneyV7' || type === 'niji7';

function MidjourneyNodeInner({ id, type, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isAdvanced = isAdvancedMidjourneyType(type);
  const isNiji = type === 'niji7';
  const accentColor = isNiji ? '#ec4899' : '#8b5cf6';
  const accentSoft = isNiji ? '#fdf2f8' : '#faf5ff';
  const accentBorder = isNiji ? '#f9a8d4' : '#e9d5ff';
  const isDarkTheme = useAIChatStore((state) => state.chatTheme === 'black');
  const title = isAdvanced ? (isNiji ? 'Niji 7' : 'Midjourney V7') : 'Midjourney';
  const { status, error } = data;
  const rawFullValue = data.imageUrl || data.imageData;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = fullAssetId ? (fullAssetUrl || undefined) : buildImageSrc(rawFullValue);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = thumbAssetId ? (thumbAssetUrl || fullSrc) : (buildImageSrc(rawThumbValue) || fullSrc);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = React.useState(false);
  const advancedImageOutputHandlePositions = ['28%', '42%', '58%', '72%'] as const;
  const advancedImageOutputHandleIds = ['img1', 'img2', 'img3', 'img4'] as const;

  const borderColor = selected ? accentColor : '#e5e7eb';
  const boxShadow = selected
    ? isNiji
      ? '0 0 0 2px rgba(236,72,153,0.12)'
      : '0 0 0 2px rgba(139,92,246,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);

  const allImages = React.useMemo(
    () => {
      // 优先使用 V7/Niji7 �?imageUrls
      if (data.imageUrls && data.imageUrls.length > 0) {
        return data.imageUrls.map((url, idx) => ({
          id: `mj-${idx}`,
          src: buildImageSrc(url),
          title: `Image ${idx + 1}`,
          timestamp: Date.now() + idx,
        } as ImageItem));
      }
      return projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          } as ImageItem)
      );
    },
    [projectHistory, data.imageUrls]
  );

  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter((edge) => edge.target === id && edge.targetHandle === 'img').length;
  });
  const aspectRatioValue = isAdvanced ? (data.aspectRatio ?? '1:1') : (data.aspectRatio ?? '');
  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: isAdvanced ? (type as 'midjourneyV7' | 'niji7') : 'midjourney',
    aiProvider: 'midjourney',
    aspectRatio: aspectRatioValue || undefined,
    referenceImageCount: imageInputCount,
    managedModelKey: data.managedModelKey,
    vendorKey: data.vendorKey,
    platformKey: data.platformKey,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === 'number' ? backendCredits : data.creditsPerCall;

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const updateData = React.useCallback(
    (patch: Partial<Props['data']>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  // 宽高比选择
  const aspectOptions = React.useMemo(
    () => [
      { label: lt('自动', 'Auto'), value: '' },
      { label: '1:1', value: '1:1' },
      { label: '3:4', value: '3:4' },
      { label: '4:3', value: '4:3' },
      { label: '2:3', value: '2:3' },
      { label: '3:2', value: '3:2' },
      { label: '4:5', value: '4:5' },
      { label: '5:4', value: '5:4' },
      { label: '9:16', value: '9:16' },
      { label: '16:9', value: '16:9' },
      { label: '21:9', value: '21:9' },
    ],
    [lt]
  );

  const updateAspectRatio = React.useCallback(
    (ratio: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { aspectRatio: ratio || undefined } },
        })
      );
    },
    [id]
  );

  // 预设提示�?
  const presetPromptValue = data.presetPrompt ?? '';
  const updatePresetPrompt = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { presetPrompt: value } },
        })
      );
    },
    [id]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 处理 Midjourney 按钮操作（U1-U4, V1-V4 等）
  const handleButtonAction = React.useCallback(
    async (button: MidjourneyButtonInfo) => {
      if (!data.taskId || actionLoading) return;

      setActionLoading(button.customId);

      try {
        window.dispatchEvent(
          new CustomEvent('flow:midjourneyAction', {
            detail: {
              nodeId: id,
              taskId: data.taskId,
              customId: button.customId,
              label: button.label,
              state:
                typeof data.mjApiState === 'string' && data.mjApiState.trim()
                  ? data.mjApiState.trim()
                  : undefined,
            },
          })
        );
      } catch (err) {
        console.error('Midjourney action failed:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [id, data.taskId, data.mjApiState, actionLoading]
  );

  // 当节点数据更新时同步最新历史图�?id（历史写入在 FlowOverlay 中统一处理，避�?onlyRenderVisibleElements 时丢失）
  React.useEffect(() => {
    if (status === 'succeeded' && data.lastHistoryId) {
      setCurrentImageId(data.lastHistoryId);
    }
  }, [data.lastHistoryId, status]);

  // 处理图片切换
  const handleImageChange = React.useCallback(
    (imageId: string) => {
      const selectedImage = allImages.find((item) => item.id === imageId);
      if (selectedImage) {
        setCurrentImageId(imageId);
      }
    },
    [allImages]
  );

  // ESC 关闭预览
  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  // 渲染 Midjourney 操作按钮（兼容 U1 / upscale_1 等多种上游 label）
  const renderActionButtons = () => {
    if (!data.buttons || data.buttons.length === 0) return null;

    const withMeta = data.buttons.map((b) => ({
      btn: b,
      ...classifyMidjourneyActionButton(b),
    }));
    const upscaleButtons = withMeta
      .filter((x) => x.group === 'upscale')
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((x) => x);
    const variationButtons = withMeta
      .filter((x) => x.group === 'variation')
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((x) => x);
    const otherButtons = withMeta.filter((x) => x.group === 'other');

    const actionPanelBg = isDarkTheme ? '#161616' : accentSoft;
    const actionPanelBorder = isDarkTheme ? '#2f2f2f' : accentBorder;
    const uvLabelColor = isDarkTheme ? '#a1a1aa' : '#9ca3af';
    const accentHoverBg = isDarkTheme
      ? (isNiji ? 'rgba(236,72,153,0.12)' : 'rgba(139,92,246,0.14)')
      : accentSoft;

    const buttonStyle: React.CSSProperties = isDarkTheme
      ? {
          fontSize: 11,
          height: 26,
          borderRadius: 6,
          border: '1px solid #404040',
          background: '#252525',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#e5e7eb',
          fontWeight: 500,
        }
      : {
          fontSize: 11,
          height: 26,
          borderRadius: 6,
          border: '1px solid #e5e7eb',
          background: '#fff',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#4b5563',
          fontWeight: 500,
        };

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = accentColor;
      e.currentTarget.style.color = accentColor;
      e.currentTarget.style.background = accentHoverBg;
      e.currentTarget.style.transform = 'translateY(-1px)';
      e.currentTarget.style.boxShadow = `0 2px 4px ${accentColor}1a`;
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = isDarkTheme ? '#404040' : '#e5e7eb';
      e.currentTarget.style.color = isDarkTheme ? '#e5e7eb' : '#4b5563';
      e.currentTarget.style.background = isDarkTheme ? '#252525' : '#fff';
      e.currentTarget.style.transform = 'none';
      e.currentTarget.style.boxShadow = 'none';
    };

    return (
      <div
        className="nodrag"
        style={{
          marginTop: 10,
          padding: '10px 12px',
          background: actionPanelBg,
          borderRadius: 8,
          border: `1px solid ${actionPanelBorder}`,
        }}
      >
        <div style={{ fontSize: 11, color: accentColor, marginBottom: 8, fontWeight: 600 }}>
          {lt('Midjourney 操作', 'Midjourney actions')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {upscaleButtons.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: uvLabelColor, fontWeight: 600 }}>U</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {upscaleButtons.map(({ btn, displayLabel }) => (
                  <button
                    key={btn.customId}
                    onClick={() => handleButtonAction(btn)}
                    disabled={!!actionLoading}
                    style={{
                      ...buttonStyle,
                      opacity: actionLoading === btn.customId ? 0.6 : 1,
                    }}
                    onMouseEnter={!actionLoading ? handleMouseEnter : undefined}
                    onMouseLeave={!actionLoading ? handleMouseLeave : undefined}
                    title={btn.label || displayLabel}
                  >
                    {displayLabel}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {variationButtons.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: uvLabelColor, fontWeight: 600 }}>V</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {variationButtons.map(({ btn, displayLabel }) => (
                  <button
                    key={btn.customId}
                    onClick={() => handleButtonAction(btn)}
                    disabled={!!actionLoading}
                    style={{
                      ...buttonStyle,
                      opacity: actionLoading === btn.customId ? 0.6 : 1,
                    }}
                    onMouseEnter={!actionLoading ? handleMouseEnter : undefined}
                    onMouseLeave={!actionLoading ? handleMouseLeave : undefined}
                    title={btn.label || displayLabel}
                  >
                    {displayLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {otherButtons.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 2,
              paddingTop: 8,
              borderTop: `1px dashed ${isDarkTheme ? '#404040' : accentBorder}`,
              justifyContent: 'center'
            }}>
              {otherButtons.map(({ btn, displayLabel }) => (
                <button
                  key={btn.customId}
                  onClick={() => handleButtonAction(btn)}
                  disabled={!!actionLoading}
                  style={{
                    ...buttonStyle,
                    width: 'auto',
                    minWidth: 32,
                    padding: '0 10px',
                    opacity: actionLoading === btn.customId ? 0.6 : 1,
                  }}
                  onMouseEnter={!actionLoading ? handleMouseEnter : undefined}
                  onMouseLeave={!actionLoading ? handleMouseLeave : undefined}
                  title={btn.label || displayLabel}
                >
                  {btn.emoji || btn.label || displayLabel}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const commonInputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: 12,
    padding: '4px 6px',
    borderRadius: 6,
    border: '1px solid #e5e7eb',
    outline: 'none',
    background: '#fff',
    color: '#111827',
  };

  const commonLabelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 2,
  };

  const renderAdvancedContent = () => {
    const resolvedSpeedMode =
      data.speedMode === 'draft' || data.speedMode === 'fast' || data.speedMode === 'turbo'
        ? data.speedMode
        : data.draft
          ? 'draft'
          : 'fast';
    const speedMode = isNiji && resolvedSpeedMode === 'draft' ? 'fast' : resolvedSpeedMode;
    const qualityValue = data.quality ?? '1';
    const chaosValue = String(data.chaos ?? '0');
    const stylizeValue = String(data.stylize ?? '100');
    const weirdValue = String(data.weird ?? '');
    const hasAdvancedOverrides =
      (!isNiji && qualityValue !== '1') ||
      chaosValue !== '0' ||
      stylizeValue !== '100' ||
      weirdValue !== '' ||
      String(data.seed ?? '') !== '' ||
      Boolean(data.raw) ||
      speedMode === 'turbo' ||
      (!isNiji && speedMode === 'draft') ||
      (!isNiji && Boolean(data.tile)) ||
      (!isNiji && String(data.noPrompt ?? '').trim() !== '') ||
      String(data.presetPrompt ?? '').trim() !== '';

    return (
      <>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={16} color={accentColor} />
            <span style={{ fontWeight: 600, color: accentColor }}>{title}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setShowHelp((value) => !value)}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                background: showHelp ? accentColor : '#f3f4f6',
                color: showHelp ? '#fff' : '#6b7280',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title={lt('玩法说明', 'Help')}
            >
              <HelpCircle size={14} />
            </button>
            <button
              onClick={onRun}
              disabled={status === 'running'}
              className="run-btn-with-credit midjourney-run-btn"
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: status === 'running' ? '#e5e7eb' : accentColor,
                color: '#fff',
                borderRadius: 6,
                border: 'none',
                cursor: status === 'running' ? 'not-allowed' : 'pointer',
              }}
            >
              {status === 'running' ? (
                <span className="run-text-trigger">Running...</span>
              ) : (
                <>
                  <span className="run-text-trigger">Run</span>
                  <RunCreditBadge credits={resolvedRunCredits} runButton />
                </>
              )}
            </button>
            <button
              onClick={onSend}
              disabled={!(data.imageData || data.imageUrl)}
              title={!(data.imageData || data.imageUrl) ? lt('无可发送的图像', 'No image to send') : lt('发送到画布', 'Send to canvas')}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                background: !(data.imageData || data.imageUrl) ? '#e5e7eb' : accentColor,
                color: '#fff',
                borderRadius: 6,
                border: 'none',
                cursor: !(data.imageData || data.imageUrl) ? 'not-allowed' : 'pointer',
              }}
            >
              <SendIcon size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {showHelp && (
          <div
            style={{
              fontSize: 11,
              color: '#374151',
              background: accentSoft,
              padding: 8,
              borderRadius: 6,
              marginBottom: 8,
              border: `1px solid ${accentBorder}`,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: accentColor }}>
              {title} {lt('玩法说明', 'Usage')}
            </div>
            <div>{isNiji ? lt('适合动漫角色、分镜、游戏立绘和日系插画。', 'Best for anime, character art, and stylized illustrations.') : lt('适合商业视觉、产品图、电影感场景和概念设计。', 'Best for commercial visuals, product shots, and cinematic concepts.')}</div>
            <div>{lt('支持文本生图，也支持连接最多 10 张参考图。', 'Supports text-to-image and up to 10 reference images.')}</div>
            <div>{lt('连图后 prompt 可继续填写；只接图也能运行。', 'You can still add prompt after connecting images; image-only generation is also allowed.')}</div>
            <div>{lt('V7 / Niji 7 不支持多提示词 ::。', 'V7 / Niji 7 do not support multi-prompt "::".')}</div>
            <div>
              {lt(
                '万物参考请连「omni」柄（与参考图一并上传，勿在提示词里写 base64）；当前悠船接入不在提示词中传 sref/sv/sw/ow/exp/iw。',
                'Use the omni handle for character-style refs (uploaded with images; do not put base64 in the prompt). This channel does not send sref/sv/sw/ow/exp/iw in the prompt text.'
              )}
            </div>
          </div>
        )}

        {imageInputCount > 10 && (
          <div
            style={{
              fontSize: 11,
              color: '#b91c1c',
              background: '#fef2f2',
              padding: '6px 8px',
              borderRadius: 6,
              marginBottom: 8,
              border: '1px solid #fecaca',
            }}
          >
            {lt(`已连接 ${imageInputCount} 张参考图，最多支持 10 张，运行时只读取前 10 张。`, `Connected ${imageInputCount} references. Only the first 10 will be used.`)}
          </div>
        )}

        <div style={{ marginBottom: 8 }}>
          <label style={commonLabelStyle}>{lt('预设提示词', 'Preset prompt')}</label>
          <input
            value={presetPromptValue}
            onChange={(e) => updatePresetPrompt(e.target.value)}
            placeholder={lt('可选，与左侧 Text 提示词拼接', 'Optional; prepended before the Text prompt')}
            style={commonInputStyle}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={commonLabelStyle}>{lt('尺寸比例', 'Aspect ratio')}</label>
            <select
              value={aspectRatioValue}
              onChange={(e) => updateAspectRatio(e.target.value)}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            >
              {aspectOptions.map((opt) => (
                <option key={opt.value || 'auto'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={commonLabelStyle}>{lt('速度模式', 'Speed')}</label>
            <select
              value={speedMode}
              onChange={(e) => {
                const nextSpeedMode = e.target.value as 'draft' | 'fast' | 'turbo';
                updateData({
                  speedMode: nextSpeedMode,
                  // Keep legacy field in sync so old persisted flows behave consistently.
                  draft: !isNiji && nextSpeedMode === 'draft',
                });
              }}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            >
              {!isNiji && <option value="draft">{lt('草图模式', 'Draft')}</option>}
              <option value="fast">{lt('快速', 'Fast')}</option>
              <option value="turbo">{lt('极速', 'Turbo')}</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setShowAdvancedControls((value) => !value)}
            style={{
              width: '100%',
              border: `1px solid ${accentBorder}`,
              background: accentSoft,
              color: accentColor,
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              padding: '7px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          >
            <span>{lt('高级控制', 'Advanced controls')}</span>
            <span>
              {showAdvancedControls
                ? lt('收起', 'Hide')
                : lt('展开', 'Show')}
            </span>
          </button>
        </div>

        {showAdvancedControls && (
          <>
        <div style={{ display: 'grid', gridTemplateColumns: isNiji ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          {!isNiji && (
            <div>
              <label style={commonLabelStyle}>{lt('质量', 'Quality')}</label>
              <select
                value={qualityValue}
                onChange={(e) => updateData({ quality: e.target.value as '1' | '2' | '4' })}
                style={commonInputStyle}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4">4</option>
              </select>
            </div>
          )}
          <div>
            <label style={commonLabelStyle}>{lt('混乱度', 'Chaos')}</label>
            <input
              value={chaosValue}
              onChange={(e) => updateData({ chaos: e.target.value })}
              placeholder={lt('默认 0，填 0–100', 'Default 0; 0–100')}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
          <div>
            <label style={commonLabelStyle}>{lt('风格化', 'Stylize')}</label>
            <input
              value={stylizeValue}
              onChange={(e) => updateData({ stylize: e.target.value })}
              placeholder="0-1000"
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={commonLabelStyle}>{lt('怪异度', 'Weird')}</label>
            <input
              value={weirdValue}
              onChange={(e) => updateData({ weird: e.target.value })}
              placeholder="0-3000"
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
          <div>
            <label style={commonLabelStyle}>{lt('随机种子', 'Seed')}</label>
            <input
              value={String(data.seed ?? '')}
              onChange={(e) => updateData({ seed: e.target.value })}
              placeholder="0-4294967295"
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(data.raw)}
              onChange={(e) => updateData({ raw: e.target.checked })}
              style={{ marginRight: 6 }}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
            <span>{lt('原始风格 Raw', 'Raw style')}</span>
          </label>
          {!isNiji && (
            <label style={{ display: 'flex', alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(data.tile)}
                onChange={(e) => updateData({ tile: e.target.checked })}
                style={{ marginRight: 6 }}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
              <span>{lt('平铺纹理', 'Tile')}</span>
            </label>
          )}
        </div>

        {!isNiji && (
          <div style={{ marginBottom: 8 }}>
            <label style={commonLabelStyle}>{lt('否定提示词', 'No prompt')}</label>
            <input
              value={data.noPrompt ?? ''}
              onChange={(e) => updateData({ noPrompt: e.target.value })}
              placeholder={lt('例如：text, watermark, blurry', 'For example: text, watermark, blurry')}
              style={commonInputStyle}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </div>
        )}

        {/* V7/Niji7 多图矩阵显示 */}
          </>
        )}

        {data.imageUrls && data.imageUrls.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 4,
              marginBottom: 8,
            }}
          >
            {data.imageUrls.slice(0, 4).map((url, idx) => (
              <div
                key={idx}
                onDoubleClick={() => {
                  setCurrentImageId(`mj-${idx}`);
                  setPreview(true);
                }}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 6,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  position: 'relative',
                  ...flowImagePreviewWell(isDarkTheme, {
                    background: accentSoft,
                    border: `1px solid ${accentBorder}`,
                  }),
                }}
                title={lt('双击预览', 'Double click to preview')}
              >
                <SmartImage
                  src={buildImageSrc(url)}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    background: flowLetterboxBackground(isDarkTheme),
                  }}
                />
                {/* 图片序号标签 */}
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 4,
                    fontSize: 10,
                    color: '#6b7280',
                    background: 'rgba(255,255,255,0.85)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontWeight: 500,
                  }}
                >
                  {idx + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            onDoubleClick={() => fullSrc && setPreview(true)}
            style={{
              width: '100%',
              height: 180,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              ...flowImagePreviewWell(isDarkTheme, {
                background: accentSoft,
                border: `1px solid ${accentBorder}`,
              }),
            }}
            title={displaySrc ? lt('双击预览', 'Double click to preview') : undefined}
          >
            {displaySrc ? (
              <SmartImage
                src={displaySrc}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: flowLetterboxBackground(isDarkTheme),
                }}
              />
            ) : (
              <div style={{ textAlign: 'center' }}>
                <Sparkles size={24} color={isNiji ? '#f9a8d4' : '#c4b5fd'} />
                <div style={{ fontSize: 12, color: accentColor, marginTop: 4 }}>
                  {lt('等待生成', 'Waiting for generation')}
                </div>
              </div>
            )}
          </div>
        )}

        <GenerationProgressBar status={status} simulateDurationMs={60 * 1000} />

        {status === 'failed' && error && (
          <div
            style={{
              fontSize: 11,
              color: '#ef4444',
              marginTop: 4,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error}
          </div>
        )}

        {renderActionButtons()}
      </>
    );
  };

  return (
    <div
      style={{
        width: isAdvanced ? 300 : 280,
        padding: 10,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
      }}
    >
      {isAdvanced ? renderAdvancedContent() : (
        <>
      {/* 标题�?*/}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={16} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: '#7c3aed' }}>Midjourney</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRun}
            disabled={status === 'running'}
            className="run-btn-with-credit midjourney-run-btn"
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: status === 'running' ? '#e5e7eb' : '#8b5cf6',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: status === 'running' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'running' ? (
              <span className="run-text-trigger">Running...</span>
            ) : (
              <>
                <span className="run-text-trigger">Run</span>
                <RunCreditBadge credits={resolvedRunCredits} runButton />
              </>
            )}
          </button>
          <button
            onClick={onSend}
            disabled={!(data.imageData || data.imageUrl)}
            title={!(data.imageData || data.imageUrl) ? lt('无可发送的图像', 'No image to send') : lt('发送到画布', 'Send to canvas')}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: !(data.imageData || data.imageUrl) ? '#e5e7eb' : '#8b5cf6',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: !(data.imageData || data.imageUrl) ? 'not-allowed' : 'pointer',
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 预设提示�?*/}
      <div style={{ marginBottom: 8 }}>
        <label
          style={{
            display: 'block',
            fontSize: 11,
            color: '#6b7280',
            marginBottom: 2,
          }}
        >
          {lt('预设提示词', 'Preset prompt')}
        </label>
        <input
          value={presetPromptValue}
          onChange={(event) => updatePresetPrompt(event.target.value)}
          placeholder={lt("生成时自动拼接在提示词前", "Auto-prepended before the prompt during generation")}
          style={{
            width: '100%',
            fontSize: 12,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid #e5e7eb',
            outline: 'none',
            background: '#fff',
          }}
          onPointerDownCapture={stopNodeDrag}
          onPointerDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
        />
      </div>

      {/* 尺寸选择 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <label
          className="nodrag nopan"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: '#6b7280',
          }}
        >
          {lt('尺寸', 'Aspect')}
          <select
            value={aspectRatioValue}
            onChange={(e) => updateAspectRatio(e.target.value)}
            onPointerDown={stopNodeDrag}
            onPointerDownCapture={stopNodeDrag}
            onMouseDown={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            onClick={stopNodeDrag}
            onClickCapture={stopNodeDrag}
            className="nodrag nopan"
            style={{
              fontSize: 11,
              padding: '2px 4px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              background: '#fff',
              color: '#111827',
            }}
          >
            {aspectOptions.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 图片预览区域 */}
      <div
        onDoubleClick={() => fullSrc && setPreview(true)}
        style={{
          width: '100%',
          height: 180,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...flowImagePreviewWell(isDarkTheme, {
            background: '#faf5ff',
            border: '1px solid #e9d5ff',
          }),
        }}
        title={displaySrc ? lt('双击预览', 'Double click to preview') : undefined}
      >
        {displaySrc ? (
          <SmartImage
            src={displaySrc}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: flowLetterboxBackground(isDarkTheme),
            }}
          />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <Sparkles size={24} color="#c4b5fd" />
            <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>{lt('等待生成', 'Waiting for generation')}</div>
          </div>
        )}
      </div>

      <GenerationProgressBar status={status} simulateDurationMs={60 * 1000} />

      {/* 错误信息 */}
      {status === 'failed' && error && (
        <div
          style={{
            fontSize: 11,
            color: '#ef4444',
            marginTop: 4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      {/* Midjourney 操作按钮 */}
      {renderActionButtons()}

      {/* 连接�?- MJ 只支持文生图，无 image 输入 */}
        </>
      )}

      {isAdvanced ? (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="text"
            style={{ top: '34%' }}
            onMouseEnter={() => setHover('prompt-in')}
            onMouseLeave={() => setHover(null)}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="img"
            style={{ top: '58%' }}
            onMouseEnter={() => setHover('img-in')}
            onMouseLeave={() => setHover(null)}
          />
          {!isNiji && (
            <Handle
              type="target"
              position={Position.Left}
              id="omniImage"
              style={{ top: '78%' }}
              onMouseEnter={() => setHover('omni-image-in')}
              onMouseLeave={() => setHover(null)}
            />
          )}
          {advancedImageOutputHandleIds.map((handleId, idx) => (
            <Handle
              key={handleId}
              type="source"
              position={Position.Right}
              id={handleId}
              style={{ top: advancedImageOutputHandlePositions[idx] }}
              onMouseEnter={() => setHover(`${handleId}-out`)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          {/* 兼容旧工程：保留 img 输出句柄，避免历史连线失效 */}
          <Handle
            type="source"
            position={Position.Right}
            id="img"
            style={{ top: '50%', opacity: 0, pointerEvents: 'none' }}
          />
          {hover === 'prompt-in' && (
            <div
              className="flow-tooltip"
              style={{ left: -8, top: '34%', transform: 'translate(-100%, -50%)' }}
            >
              prompt
            </div>
          )}
          {hover === 'img-in' && (
            <div
              className="flow-tooltip"
              style={{ left: -8, top: '58%', transform: 'translate(-100%, -50%)' }}
            >
              image
            </div>
          )}
          {!isNiji && hover === 'omni-image-in' && (
            <div
              className="flow-tooltip"
              style={{ left: -8, top: '78%', transform: 'translate(-100%, -50%)' }}
            >
              {lt('万物参考图', 'Omni reference image')}
            </div>
          )}
          {advancedImageOutputHandleIds.map((handleId, idx) =>
            hover === `${handleId}-out` ? (
              <div
                key={`${handleId}-tooltip`}
                className="flow-tooltip"
                style={{
                  right: -8,
                  top: advancedImageOutputHandlePositions[idx],
                  transform: 'translate(100%, -50%)',
                }}
              >
                {`image#${idx + 1}`}
              </div>
            ) : null
          )}
        </>
      ) : (
        <>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('img-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 连接点提�?*/}
      {hover === 'prompt-in' && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}
        >
          prompt
        </div>
      )}
      {hover === 'img-out' && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}
        >
          image
        </div>
      )}

      {/* 图片预览模态框 */}
        </>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src || fullSrc || ''
            : fullSrc || ''
        }
        imageTitle={lt("Midjourney 图片预览", "Midjourney image preview")}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}

export default React.memo(MidjourneyNodeInner);
