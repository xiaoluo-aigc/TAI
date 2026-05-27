import React from 'react';
import { Handle, Position, useStore, type ReactFlowState, type Node } from 'reactflow';
import SmartImage from '../../ui/SmartImage';
import { fetchWithAuth } from '@/services/authFetch';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useLocaleText } from '@/utils/localeText';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'converting' | 'ready' | 'error';
    error?: string;
    videoUrl?: string;
    gifUrl?: string;
    fps?: number;
    width?: number;
    startSeconds?: number;
    durationSeconds?: number;
  };
  selected?: boolean;
};

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000') + '/api';

const DEFAULT_FPS = 10;
const DEFAULT_WIDTH = 480;
const DEFAULT_START_SECONDS = 0;

const sanitizeMediaUrl = (raw?: string | null | undefined): string | undefined => {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
};

const resolveVideoUrlFromNode = (node?: Node<any> | null): string | undefined => {
  if (!node) return undefined;
  const data = (node.data ?? {}) as any;

  const candidates = [
    data.videoUrl,
    data.video_url,
    data.videoSourceUrl,
    data.video_source_url,
    data.video,
    data.videoSource,
    data.output?.video_url,
    Array.isArray(data.output) ? data.output[0]?.video_url : undefined,
    data.output?.url,
    data.raw?.output?.video_url,
    data.raw?.video_url,
    Array.isArray(data.history) ? data.history[0]?.videoUrl : undefined,
    data.videoSource?.url,
  ];

  for (const c of candidates) {
    const s = sanitizeMediaUrl(c);
    if (s) return s;
  }
  return undefined;
};

function VideoToGifNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const projectId = useProjectContentStore((s) => s.projectId);
  const [hover, setHover] = React.useState(false);

  const connectedVideoUrl = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (e) =>
            e.target === id &&
            typeof e.targetHandle === 'string' &&
            e.targetHandle.startsWith('video')
        );
        if (!edge) return undefined;
        const sourceNode = state.getNodes().find((n: Node<any>) => n.id === edge.source);
        return resolveVideoUrlFromNode(sourceNode);
      },
      [id]
    )
  );

  const hasVideoConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (edge) =>
            edge.target === id &&
            typeof edge.targetHandle === 'string' &&
            edge.targetHandle.startsWith('video')
        ),
      [id]
    )
  );

  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;
  const status = data.status ?? 'idle';
  const error = data.error;
  const gifUrl = data.gifUrl;

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const fps = typeof data.fps === 'number' ? data.fps : DEFAULT_FPS;
  const width = typeof data.width === 'number' ? data.width : DEFAULT_WIDTH;
  const startSeconds = typeof data.startSeconds === 'number' ? data.startSeconds : DEFAULT_START_SECONDS;
  const durationSeconds = typeof data.durationSeconds === 'number' ? data.durationSeconds : undefined;

  const updateNodeData = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  React.useEffect(() => {
    const patch: Record<string, any> = {};
    if (typeof data.fps === 'undefined') patch.fps = DEFAULT_FPS;
    if (typeof data.width === 'undefined') patch.width = DEFAULT_WIDTH;
    if (typeof data.startSeconds === 'undefined') patch.startSeconds = DEFAULT_START_SECONDS;
    if (Object.keys(patch).length > 0) updateNodeData(patch);
  }, [data.fps, data.startSeconds, data.width, updateNodeData]);

  const handleConvert = React.useCallback(async () => {
    if (!effectiveVideoUrl) {
      updateNodeData({
        status: 'error',
        error: lt('没有可转换的视频输入，请先连接视频节点', 'No video input to convert. Please connect a video node first'),
      });
      return false;
    }
    if (status === 'converting') return false;

    updateNodeData({ status: 'converting', error: undefined });

    try {
      const payload: Record<string, any> = {
        videoUrl: effectiveVideoUrl,
        projectId: projectId ?? undefined,
        fps,
        width,
        startSeconds,
      };
      if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) {
        payload.durationSeconds = durationSeconds;
      }

      const resp = await fetchWithAuth(`${API_BASE_URL}/video-gif/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.message || lt('视频转 GIF 失败', 'Video to GIF conversion failed'));
      }

      const result = await resp.json().catch(() => ({}));
      if (!result?.gifUrl) {
        throw new Error(lt('未返回 GIF 链接', 'No GIF URL returned'));
      }

      updateNodeData({
        status: 'ready',
        error: undefined,
        videoUrl: effectiveVideoUrl,
        gifUrl: result.gifUrl,
      });
      return true;
    } catch (err: any) {
      updateNodeData({
        status: 'error',
        error: err?.message || lt('视频转 GIF 失败', 'Video to GIF conversion failed'),
      });
      return false;
    }
  }, [durationSeconds, effectiveVideoUrl, fps, lt, projectId, startSeconds, status, updateNodeData, width]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>).detail;
      if (!detail || detail.id !== id) return;
      void (async () => {
        try {
          const ok = await handleConvert();
          detail.done?.(ok);
        } catch {
          detail.done?.(false);
        }
      })();
    };

    window.addEventListener('flow:run-node', handler as EventListener);
    return () => {
      window.removeEventListener('flow:run-node', handler as EventListener);
    };
  }, [handleConvert, id]);

  const canConvert = Boolean(effectiveVideoUrl) && status !== 'converting';

  return (
    <div
      style={{
        width: 320,
        padding: 10,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Video to GIF</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {gifUrl && (
            <a
              href={gifUrl}
              download
              target='_blank'
              rel='noreferrer'
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: '#fff',
                color: '#111827',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              {lt('下载', 'Download')}
            </a>
          )}
          <button
            onClick={handleConvert}
            disabled={!canConvert}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: canConvert ? '#111827' : '#e5e7eb',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: canConvert ? 'pointer' : 'not-allowed',
            }}
          >
            {status === 'converting' ? lt('转换中...', 'Converting...') : lt('生成 GIF', 'Create GIF')}
          </button>
        </div>
      </div>

      <div
        style={{
          width: '100%',
          height: 140,
          background: '#111827',
          borderRadius: 6,
          border: '1px solid #eef0f2',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {gifUrl ? (
          <SmartImage
            src={gifUrl}
            alt={lt('GIF 预览', 'GIF preview')}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : effectiveVideoUrl ? (
          <video
            src={effectiveVideoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            preload='metadata'
            controls
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {hasVideoConnection
              ? lt('等待视频输入', 'Waiting for video input')
              : lt('请连接视频节点', 'Please connect a video node')}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        <label style={{ fontSize: 11, color: '#374151' }}>
          FPS
          <input
            type='number'
            className='nodrag nopan'
            value={fps}
            min={2}
            max={20}
            step={1}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 2 && val <= 20) updateNodeData({ fps: Math.round(val) });
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>

        <label style={{ fontSize: 11, color: '#374151' }}>
          {lt('宽度(px)', 'Width(px)')}
          <input
            type='number'
            className='nodrag nopan'
            value={width}
            min={160}
            max={960}
            step={10}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 160 && val <= 960) updateNodeData({ width: Math.round(val) });
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        <label style={{ fontSize: 11, color: '#374151' }}>
          {lt('开始秒数', 'Start(s)')}
          <input
            type='number'
            className='nodrag nopan'
            value={startSeconds}
            min={0}
            max={3600}
            step={0.1}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isFinite(val) && val >= 0 && val <= 3600) {
                updateNodeData({ startSeconds: val });
              }
            }}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>

        <label style={{ fontSize: 11, color: '#374151' }}>
          {lt('持续秒数', 'Duration(s)')}
          <input
            type='number'
            className='nodrag nopan'
            value={typeof durationSeconds === 'number' ? durationSeconds : ''}
            min={0.5}
            step={0.1}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                updateNodeData({ durationSeconds: undefined });
                return;
              }
              const val = Number(raw);
              if (Number.isFinite(val) && val >= 0.5) {
                updateNodeData({ durationSeconds: val });
              }
            }}
            placeholder={lt('默认剩余全段', 'Default: remaining clip')}
            style={{
              marginTop: 4,
              width: '100%',
              fontSize: 12,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
            }}
          />
        </label>
      </div>

      <div style={{ fontSize: 11, color: '#6b7280' }}>
        {lt('未填持续秒数时，会从开始秒数起转换剩余整段视频', 'If duration is empty, converts the remaining clip from the start time')}
      </div>

      {status === 'error' && error && (
        <div
          style={{
            fontSize: 12,
            color: '#ef4444',
            padding: '4px 8px',
            background: '#fef2f2',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      <Handle
        type='target'
        position={Position.Left}
        id='video'
        style={{ top: '50%' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />

      {hover && (
        <div className='flow-tooltip' style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          video
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoToGifNodeInner);
