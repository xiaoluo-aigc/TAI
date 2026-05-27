import React from 'react';
import { Handle, Position, useStore, type ReactFlowState } from 'reactflow';
import { fetchWithAuth } from '@/services/authFetch';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';
import { useCanvasStore } from '@/stores';
import { useLocaleText } from '@/utils/localeText';
import RunCreditBadge from './RunCreditBadge';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import { useImeSafeTextValue } from '../hooks/useImeSafeTextInput';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    videoUrl?: string;
    prompt?: string;
    error?: string;
    analysisPrompt?: string;
    text?: string;
    creditsPerCall?: number;
  };
  selected?: boolean;
};

const shouldPassWheelToCanvas = (event: { ctrlKey: boolean; metaKey: boolean }) => {
  const store = useCanvasStore.getState();
  const isModifierWheel = event.ctrlKey || event.metaKey;
  return store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;
};

const VIDEO_ANALYSIS_PROMPT_ZH = '分析这个视频，描述场景、动作和关键信息。';
const VIDEO_ANALYSIS_PROMPT_EN =
  'Analyze this video and describe the scenes, actions, and key information.';

const isDefaultVideoAnalysisPrompt = (value?: string): boolean => {
  const prompt = value?.trim();
  return prompt === VIDEO_ANALYSIS_PROMPT_ZH || prompt === VIDEO_ANALYSIS_PROMPT_EN;
};

function VideoAnalyzeNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const analyzeBananaImageRoute: 'normal' | 'stable' =
    bananaImageRoute === 'stable' ? 'stable' : 'normal';
  const textModel = React.useMemo(() => getTextModelForProvider(aiProvider), [aiProvider]);

  const { status, error } = data;
  const hasRunCredits = typeof data.creditsPerCall === 'number' && data.creditsPerCall > 0;
  const [hover, setHover] = React.useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const connectedVideoUrl = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find((e) => e.target === id && e.targetHandle === 'video');
        if (!edge) return undefined;
        const sourceNode = state.getNodes().find((n) => n.id === edge.source);
        const videoUrl = sourceNode?.data?.videoUrl;
        return typeof videoUrl === 'string' ? videoUrl : undefined;
      },
      [id],
    ),
  );

  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;

  const hasVideoConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) => state.edges.some((edge) => edge.target === id && edge.targetHandle === 'video'),
      [id],
    ),
  );

  const shell = flowNodeShellChrome(isFlowDark, !!selected);
  const controlField = flowNodeControlField(isFlowDark);
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  const defaultAnalysisPrompt = lt(VIDEO_ANALYSIS_PROMPT_ZH, VIDEO_ANALYSIS_PROMPT_EN);
  const storedAnalysisPrompt =
    typeof data.analysisPrompt === 'string' ? data.analysisPrompt : undefined;
  const shouldUseLocalizedDefaultPrompt =
    typeof storedAnalysisPrompt === 'undefined' ||
    isDefaultVideoAnalysisPrompt(storedAnalysisPrompt);
  const promptInput = shouldUseLocalizedDefaultPrompt
    ? defaultAnalysisPrompt
    : storedAnalysisPrompt;

  React.useEffect(() => {
    const currentAnalysisPrompt =
      typeof data.analysisPrompt === 'string' ? data.analysisPrompt : undefined;
    const shouldSyncLocalizedDefaultPrompt =
      typeof currentAnalysisPrompt === 'undefined' ||
      isDefaultVideoAnalysisPrompt(currentAnalysisPrompt);

    if (shouldSyncLocalizedDefaultPrompt && data.analysisPrompt !== defaultAnalysisPrompt) {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { analysisPrompt: defaultAnalysisPrompt } },
        }),
      );
    }
  }, [data.analysisPrompt, defaultAnalysisPrompt, id]);

  const commitAnalysisPrompt = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { analysisPrompt: value } },
        }),
      );
    },
    [id],
  );
  const analysisPromptInput = useImeSafeTextValue(promptInput, commitAnalysisPrompt);
  const analysisPromptDraft = analysisPromptInput.value;

  const onAnalyze = React.useCallback(async () => {
    if (!effectiveVideoUrl) {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              status: 'failed',
              error: lt(
                '没有可分析的视频输入，请先连接视频节点',
                'No video input to analyze. Please connect a video node first',
              ),
            },
          },
        }),
      );
      return;
    }

    if (status === 'running' || isAnalyzing) return;

    const promptToUse = analysisPromptDraft.trim();
    if (!promptToUse.length) {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              status: 'failed',
              error: lt('提示词不能为空', 'Prompt cannot be empty'),
            },
          },
        }),
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'running', error: undefined, prompt: '', text: '' } },
      }),
    );

    try {
      setIsAnalyzing(true);

      const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:4000';

      const response = await fetchWithAuth(`${apiBase}/api/ai/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          videoUrl: effectiveVideoUrl,
          aiProvider,
          model: textModel,
          bananaImageRoute: analyzeBananaImageRoute,
          channelHint: analyzeBananaImageRoute === 'stable' ? 'tencent' : 'apimart',
          providerOptions: {
            banana: {
              imageRoute: analyzeBananaImageRoute,
            },
            bananaImageRoute: analyzeBananaImageRoute,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const analysisText = result.analysis || result.text || result.data?.analysis || '';

      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              status: 'succeeded',
              error: undefined,
              prompt: analysisText,
              text: analysisText,
            },
          },
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { status: 'failed', error: msg, prompt: '', text: '' } },
        }),
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [aiProvider, analysisPromptDraft, analyzeBananaImageRoute, effectiveVideoUrl, id, isAnalyzing, lt, status, textModel]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>).detail;
      if (!detail || detail.id !== id) return;
      void (async () => {
        try {
          await onAnalyze();
          detail.done?.(true);
        } catch {
          detail.done?.(false);
        }
      })();
    };

    window.addEventListener('flow:run-node', handler as EventListener);
    return () => window.removeEventListener('flow:run-node', handler as EventListener);
  }, [id, onAnalyze]);

  const canRun = !!effectiveVideoUrl && status !== 'running' && !isAnalyzing;

  return (
    <div
      style={{
        width: 280,
        padding: 8,
        background: shell.background,
        color: shell.color,
        border: `1px solid ${shell.borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600, color: shell.color }}>{lt('视频分析', 'Video Analysis')}</div>
        <button
          className="tanva-video-analyze-run-btn run-btn-with-credit"
          onClick={onAnalyze}
          disabled={!canRun}
          style={{
            cursor: canRun ? 'pointer' : 'not-allowed',
          }}
        >
          {status === 'running' || isAnalyzing ? (
            <span className="run-text-trigger">{lt('分析中...', 'Analyzing...')}</span>
          ) : (
            <>
              <span className="run-text-trigger">{lt('分析', 'Analyze')}</span>
              {hasRunCredits ? <RunCreditBadge credits={data.creditsPerCall} runButton /> : null}
            </>
          )}
        </button>
      </div>

      <div
        style={{
          width: '100%',
          height: 120,
          background: '#000',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: `1px solid ${isFlowDark ? '#333333' : '#eef0f2'}`,
        }}
      >
        {effectiveVideoUrl ? (
          <video
            src={effectiveVideoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            controls
            preload="metadata"
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {hasVideoConnection
              ? lt('等待视频输入', 'Waiting for video input')
              : lt('请连接视频节点', 'Please connect a video node')}
          </span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: shell.color }}>
          {lt('分析提示词', 'Analysis prompt')}
        </div>
        <textarea
          className="nodrag nopan nowheel"
          value={analysisPromptInput.value}
          onChange={analysisPromptInput.onChange}
          onCompositionStart={analysisPromptInput.onCompositionStart}
          onCompositionEnd={analysisPromptInput.onCompositionEnd}
          onWheelCapture={(event) => {
            if (shouldPassWheelToCanvas(event)) return;
            event.stopPropagation();
          }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          placeholder={lt('输入分析提示词', 'Enter analysis prompt')}
          style={{
            width: '100%',
            minHeight: 60,
            resize: 'none',
            fontSize: 12,
            lineHeight: 1.4,
            padding: '6px 8px',
            borderRadius: 6,
            fontFamily: 'inherit',
            ...controlField,
          }}
          disabled={status === 'running' || isAnalyzing}
        />
      </div>

      <div
        style={{
          minHeight: 72,
          maxHeight: 120,
          overflowY: 'auto',
          background: flowNodeMutedWellBackground(isFlowDark),
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          color: isFlowDark ? '#d1d5db' : '#374151',
          whiteSpace: 'pre-wrap',
        }}
      >
        {data.prompt || data.text ? (
          data.prompt || data.text
        ) : (
          <span style={{ color: '#9ca3af' }}>
            {lt('分析结果将显示在这里', 'Analysis result will appear here')}
          </span>
        )}
      </div>

      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('text-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'video-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          video
        </div>
      )}
      {hover === 'text-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          text
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoAnalyzeNodeInner);
