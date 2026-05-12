import React from 'react';
import { Handle, Position, useStore, type ReactFlowState, type Node } from 'reactflow';
import SmartImage from '../../ui/SmartImage';
import { imageUploadService } from '@/services/imageUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { fetchWithAuth } from '@/services/authFetch';
import { useLocaleText } from '@/utils/localeText';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowNodeShellChrome,
  flowNodeWellOutlineBorder,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';

type FrameData = {
  index: number;
  timestamp: number;
  imageUrl: string;
  thumbnailDataUrl?: string;
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'extracting' | 'ready' | 'error';
    error?: string;
    videoUrl?: string;
    videoDuration?: number;
    intervalSeconds: number;
    frames: FrameData[];
    totalFrames: number;
    outputMode: 'all' | 'single' | 'range';
    selectedFrameIndex?: number;
    rangeStart?: number;
    rangeEnd?: number;
    extractProgress?: number;
  };
  selected?: boolean;
};

const DEFAULT_INTERVAL = 3;
const MAX_PREVIEW_FRAMES = 4;

const buildOssThumbnailUrl = (rawUrl: string, width: number): string => {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) return rawUrl;
  if (!/^https?:\/\//i.test(trimmed)) return rawUrl;
  try {
    const url = new URL(trimmed);
    // 仅对阿里云 OSS 做缩略图参数，其他来源保持原样
    if (!url.hostname.endsWith('.aliyuncs.com')) return rawUrl;
    if (url.searchParams.has('x-oss-process')) return rawUrl;
    url.searchParams.set('x-oss-process', `image/resize,w_${Math.max(1, Math.round(width))}`);
    return url.toString();
  } catch {
    return rawUrl;
  }
};

// 后端 API 基础地址
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000') + '/api';

// 判断是否为自己的 OSS（已配置 CORS）
const isOwnOss = (url: string): boolean => {
  try {
    const u = new URL(url);
    // 你自己的 OSS bucket 域名
    const ownHosts = ['tai-ai.tos-cn-guangzhou.volces.com'];
    return ownHosts.some(h => u.hostname === h || u.hostname.endsWith(h));
  } catch {
    return false;
  }
};

// 简单的 URL 清洗器：去掉空白并返回 undefined 当为空
const sanitizeMediaUrl = (raw?: string | null | undefined): string | undefined => {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
};

/**
 * 从一个 React Flow 节点对象中解析尽可能多的 video URL 源。
 * 兼容字段：videoUrl, video_url, videoSourceUrl, output[].video_url, raw.output.video_url, history 等。
 */
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

function VideoFrameExtractNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const { status = 'idle', error, frames = [], totalFrames = 0 } = data;
  const [hover, setHover] = React.useState<string | null>(null);
  const [showAllFrames, setShowAllFrames] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const projectId = useProjectContentStore((s) => s.projectId);

  // 获取连接的视频节点数据：接受所有以 "video" 开头的 targetHandle（兼容 video-xxx）
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
        // 使用解析器从 source node 的 data 中提取 video url（兼容多种字段）
        return resolveVideoUrlFromNode(sourceNode);
      },
      [id]
    )
  );

  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;

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

  const shell = flowNodeShellChrome(isFlowDark, selected);
  const controlField = flowNodeControlField(isFlowDark);
  const mutedWellBg = flowNodeMutedWellBackground(isFlowDark);
  const wellOutline = flowNodeWellOutlineBorder(isFlowDark);
  const borderColor = shell.borderColor;
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const intervalSeconds = data.intervalSeconds ?? DEFAULT_INTERVAL;
  const outputMode = data.outputMode ?? 'all';
  const selectedFrameIndex = data.selectedFrameIndex ?? 1;
  const rangeStart = data.rangeStart ?? 1;
  const rangeEnd = data.rangeEnd ?? Math.max(1, totalFrames);

  const updateNodeData = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch },
    }));
  }, [id]);

  // 初始化默认值
  React.useEffect(() => {
    if (typeof data.intervalSeconds === 'undefined') {
      updateNodeData({ intervalSeconds: DEFAULT_INTERVAL });
    }
    if (typeof data.outputMode === 'undefined') {
      updateNodeData({ outputMode: 'all' });
    }
    if (typeof data.frames === 'undefined') {
      updateNodeData({ frames: [] });
    }
  }, [data.intervalSeconds, data.outputMode, data.frames, updateNodeData]);

  // 前端抽帧核心逻辑
  const extractFramesFrontend = React.useCallback(async () => {
    if (!effectiveVideoUrl) throw new Error(lt('视频 URL 不存在', 'Video URL does not exist'));

    let videoSrc = effectiveVideoUrl;

    // 如果不是自己的 OSS，先通过后端转存到自己的 OSS
    if (!isOwnOss(effectiveVideoUrl)) {
      updateNodeData({ extractProgress: 5 });
      const resp = await fetchWithAuth(`${API_BASE_URL}/uploads/transfer-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: effectiveVideoUrl }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || lt('视频转存失败', 'Video transfer failed'));
      }
      const result = await resp.json();
      if (!result.url) throw new Error(lt('视频转存失败', 'Video transfer failed'));
      videoSrc = result.url;
      updateNodeData({ extractProgress: 10 });
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoSrc;
    video.preload = 'metadata';
    video.muted = true;
    (video as any).playsInline = true;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        video.onloadedmetadata = null;
        video.onerror = null;
        reject(new Error(lt('视频加载超时', 'Video loading timed out')));
      }, 30000);

      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        reject(new Error(lt('视频加载失败，请确保视频URL可访问', 'Video loading failed. Please ensure the video URL is accessible.')));
      };
    });

      const duration = video.duration;
      if (!duration || duration <= 0) {
        throw new Error(lt('无法获取视频时长', 'Unable to get video duration'));
      }

      updateNodeData({ videoDuration: duration });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(lt('Canvas 不可用', 'Canvas is not available'));

      // 计算要抽取的帧数
      const interval = intervalSeconds;
      const frameCount = Math.floor(duration / interval) + 1;
      const extractedFrames: FrameData[] = [];

      for (let i = 0; i < frameCount; i++) {
        const timestamp = Math.min(i * interval, duration - 0.1);

        // 跳转到指定时间
        video.currentTime = timestamp;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });

        // 设置 canvas 尺寸
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // 绘制帧
        ctx.drawImage(video, 0, 0);

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(lt('导出帧失败', 'Failed to export frame')))), 'image/jpeg', 0.7);
        });

        const fileName = `video_frame_${id}_${i + 1}_${Math.round(timestamp * 1000)}.jpg`;
        const uploadResult = await imageUploadService.uploadImageSource(blob, {
          projectId: projectId ?? undefined,
          dir: projectId ? `projects/${projectId}/flow/video-frames/` : 'uploads/flow/video-frames/',
          fileName,
          contentType: 'image/jpeg',
        });

        if (!uploadResult.success || !uploadResult.asset?.url) {
          throw new Error(uploadResult.error || lt('帧上传失败', 'Frame upload failed'));
        }

        const remoteUrl = uploadResult.asset.url;
        const thumbnailUrl = buildOssThumbnailUrl(remoteUrl, 320);

        extractedFrames.push({
          index: i + 1,
          timestamp,
          imageUrl: remoteUrl,
          thumbnailDataUrl: thumbnailUrl,
        });

        // 更新进度
        updateNodeData({
          extractProgress: Math.round(((i + 1) / frameCount) * 100),
        });
      }

      updateNodeData({
        status: 'ready',
        frames: extractedFrames,
        totalFrames: extractedFrames.length,
        rangeEnd: extractedFrames.length,
        extractProgress: 100,
      });

      console.log(`[Frontend] ${lt('抽帧完成', 'Frame extraction completed')}: ${extractedFrames.length}`);
  }, [effectiveVideoUrl, id, intervalSeconds, lt, projectId, updateNodeData]);

  // 统一抽帧入口
  const extractFrames = React.useCallback(async () => {
    if (!effectiveVideoUrl) {
      updateNodeData({
        status: 'error',
        error: lt('没有可抽帧的视频输入，请先连接视频节点', 'No video input to extract frames. Please connect a video node first'),
      });
      return;
    }
    if (status === 'extracting') return;

    updateNodeData({
      status: 'extracting',
      error: undefined,
      frames: [],
      totalFrames: 0,
      extractProgress: 0,
    });

    try {
      await extractFramesFrontend();
    } catch (err: any) {
      console.error('Frame extraction failed:', err);
      updateNodeData({
        status: 'error',
        error: err.message || lt('抽帧失败', 'Frame extraction failed'),
      });
    }
  }, [effectiveVideoUrl, status, extractFramesFrontend, lt, updateNodeData]);

  const onIntervalChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0.5 && val <= 30) {
      updateNodeData({ intervalSeconds: val });
    }
  }, [updateNodeData]);

  const onOutputModeChange = React.useCallback((mode: 'all' | 'single' | 'range') => {
    updateNodeData({ outputMode: mode });
  }, [updateNodeData]);

  const onSelectedFrameChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= totalFrames) {
      updateNodeData({ selectedFrameIndex: val });
    }
  }, [totalFrames, updateNodeData]);

  const onRangeChange = React.useCallback((values: [number, number]) => {
    updateNodeData({ rangeStart: values[0], rangeEnd: values[1] });
  }, [updateNodeData]);

  const canExtract = !!effectiveVideoUrl && status !== 'extracting';

  // 获取输出的帧
  const outputFrames = React.useMemo(() => {
    if (frames.length === 0) return [];
    if (outputMode === 'all') return frames;
    if (outputMode === 'single') {
      const idx = (selectedFrameIndex ?? 1) - 1;
      return frames[idx] ? [frames[idx]] : [];
    }
    if (outputMode === 'range') {
      const start = Math.max(0, (rangeStart ?? 1) - 1);
      const end = Math.min(frames.length, rangeEnd ?? frames.length);
      return frames.slice(start, end);
    }
    return frames;
  }, [frames, outputMode, selectedFrameIndex, rangeStart, rangeEnd]);

  // 预览帧（最多显示4个）
  const previewFrames = frames.slice(0, MAX_PREVIEW_FRAMES);

  return (
    <div
      style={{
        width: 300,
        padding: 10,
        background: shell.background,
        color: shell.color,
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
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600, color: shell.color }}>Video Frame Extract</div>
        <button
          onClick={extractFrames}
          disabled={!canExtract}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            background: canExtract ? '#111827' : '#e5e7eb',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: canExtract ? 'pointer' : 'not-allowed',
          }}
        >
          {status === 'extracting' ? `${lt('提取中', 'Extracting')} ${data.extractProgress || 0}%` : lt('提取帧', 'Extract frames')}
        </button>
      </div>

      {/* 视频预览 */}
      <div
        style={{
          width: '100%',
          height: 100,
          background: '#000',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: `1px solid ${wellOutline}`,
        }}
      >
        {effectiveVideoUrl ? (
          <video
            ref={videoRef}
            src={effectiveVideoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            preload="metadata"
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {hasVideoConnection ? lt('等待视频输入', 'Waiting for video input') : lt('请连接视频节点', 'Please connect a video node')}
          </span>
        )}
      </div>

      {/* 抽帧间隔设置 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: isFlowDark ? '#d1d5db' : '#374151' }}>{lt('抽帧间隔', 'Frame interval')}:</span>
        <input
          type="number"
          className="nodrag nopan"
          value={intervalSeconds}
          onChange={onIntervalChange}
          min={0.5}
          max={30}
          step={0.5}
          style={{
            width: 60,
            fontSize: 12,
            padding: '4px 6px',
            borderRadius: 4,
            ...controlField,
          }}
        />
        <span style={{ fontSize: 12, color: isFlowDark ? '#9ca3af' : '#6b7280' }}>{lt('秒', 's')}</span>
      </div>

      {/* 帧预览区 */}
      {frames.length > 0 && (
        <div style={{ background: mutedWellBg, borderRadius: 6, padding: 8, border: `1px solid ${wellOutline}` }}>
          <div style={{ fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280', marginBottom: 6 }}>
            📷 {lt('已提取', 'Extracted')} {totalFrames} {lt('帧', 'frame(s)')}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {previewFrames.map((frame) => (
              <div
                key={frame.index}
                style={{
                  width: 56,
                  height: 42,
                  borderRadius: 4,
                  overflow: 'hidden',
                  border: `1px solid ${wellOutline}`,
                  position: 'relative',
                }}
              >
                <SmartImage
                  src={frame.thumbnailDataUrl}
                  alt={lt(`帧 ${frame.index}`, `Frame ${frame.index}`)}
                  decoding="async"
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    fontSize: 9,
                    textAlign: 'center',
                    padding: '1px 0',
                  }}
                >
                  {frame.index}
                </div>
              </div>
            ))}
            {frames.length > MAX_PREVIEW_FRAMES && (
              <div
                style={{
                  width: 56,
                  height: 42,
                  borderRadius: 4,
                  background: isFlowDark ? '#252525' : '#e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: isFlowDark ? '#d1d5db' : '#6b7280',
                }}
              >
                +{frames.length - MAX_PREVIEW_FRAMES}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowAllFrames(true)}
            style={{
              marginTop: 6,
              fontSize: 11,
              padding: '3px 8px',
              background: isFlowDark ? '#252525' : '#fff',
              border: `1px solid ${isFlowDark ? '#3f3f46' : '#d1d5db'}`,
              borderRadius: 4,
              cursor: 'pointer',
              color: isFlowDark ? '#e5e7eb' : '#111827',
              width: '100%',
            }}
          >
            {lt('查看全部帧', 'View all frames')}
          </button>
        </div>
      )}

      {/* 输出选择 */}
      {frames.length > 0 && (
        <div style={{ background: isFlowDark ? '#161616' : '#f3f4f6', borderRadius: 6, padding: 8, border: `1px solid ${wellOutline}` }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: shell.color }}>{lt('输出选择', 'Output selection')}</div>

          {/* 全部帧 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer', color: isFlowDark ? '#e5e7eb' : '#111827' }}>
            <input
              type="radio"
              name={`output-${id}`}
              checked={outputMode === 'all'}
              onChange={() => onOutputModeChange('all')}
              className="nodrag"
            />
            <span style={{ fontSize: 12 }}>{lt('全部帧', 'All frames')} ({totalFrames}{lt('张', '')})</span>
          </label>

          {/* 指定帧 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, cursor: 'pointer', color: isFlowDark ? '#e5e7eb' : '#111827' }}>
            <input
              type="radio"
              name={`output-${id}`}
              checked={outputMode === 'single'}
              onChange={() => onOutputModeChange('single')}
              className="nodrag"
            />
            <span style={{ fontSize: 12 }}>{lt('指定帧', 'Selected frame')}:</span>
            {outputMode === 'single' && (
              <input
                type="number"
                className="nodrag nopan"
                value={selectedFrameIndex}
                onChange={onSelectedFrameChange}
                min={1}
                max={totalFrames}
                style={{
                  width: 50,
                  fontSize: 11,
                  padding: '2px 4px',
                  borderRadius: 4,
                  ...controlField,
                }}
              />
            )}
          </label>

          {/* 范围选择 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: isFlowDark ? '#e5e7eb' : '#111827' }}>
            <input
              type="radio"
              name={`output-${id}`}
              checked={outputMode === 'range'}
              onChange={() => onOutputModeChange('range')}
              className="nodrag"
            />
            <span style={{ fontSize: 12 }}>{lt('范围', 'Range')}: {rangeStart}-{rangeEnd}{lt('帧', '')}</span>
          </label>
          {outputMode === 'range' && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                className="nodrag nopan"
                value={rangeStart}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1 && val <= rangeEnd) {
                    onRangeChange([val, rangeEnd]);
                  }
                }}
                min={1}
                max={rangeEnd}
                style={{
                  width: 50,
                  fontSize: 11,
                  padding: '2px 4px',
                  borderRadius: 4,
                  ...controlField,
                }}
              />
              <span style={{ fontSize: 11, color: isFlowDark ? '#d1d5db' : '#111827' }}>{lt('至', 'to')}</span>
              <input
                type="number"
                className="nodrag nopan"
                value={rangeEnd}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= rangeStart && val <= totalFrames) {
                    onRangeChange([rangeStart, val]);
                  }
                }}
                min={rangeStart}
                max={totalFrames}
                style={{
                  width: 50,
                  fontSize: 11,
                  padding: '2px 4px',
                  borderRadius: 4,
                  ...controlField,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {status === 'error' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', padding: '4px 8px', background: isFlowDark ? 'rgba(127, 29, 29, 0.25)' : '#fef2f2', border: `1px solid ${isFlowDark ? 'rgba(239, 68, 68, 0.35)' : '#fecaca'}`, borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* 连接点 - 输入 */}
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-in')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 连接点 - 输出: 全部帧 (images - 黄色) */}
      <Handle
        type="source"
        position={Position.Right}
        id="images"
        style={{ top: '30%' }}
        onMouseEnter={() => setHover('images-out')}
        onMouseLeave={() => setHover(null)}
      />
      {/* 连接点 - 输出: 单帧 (image - 橙色) */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('image-out')}
        onMouseLeave={() => setHover(null)}
      />
      {/* 连接点 - 输出: 范围帧 (images - 黄色) */}
      <Handle
        type="source"
        position={Position.Right}
        id="images-range"
        style={{ top: '70%' }}
        onMouseEnter={() => setHover('images-range-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 工具提示 */}
      {hover === 'video-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          video
        </div>
      )}
      {hover === 'images-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '30%', transform: 'translate(100%, -50%)' }}>
          {lt('images (全部帧)', 'images (all frames)')}
        </div>
      )}
      {hover === 'image-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          {lt('image (单帧)', 'image (single frame)')}
        </div>
      )}
      {hover === 'images-range-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '70%', transform: 'translate(100%, -50%)' }}>
          {lt('images (范围帧)', 'images (range frames)')}
        </div>
      )}

      {/* 全部帧弹窗 */}
      {showAllFrames && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: isFlowDark ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.7)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowAllFrames(false)}
        >
          <div
            style={{
              background: isFlowDark ? '#1c1c1c' : '#fff',
              color: shell.color,
              border: `1px solid ${isFlowDark ? '#3a3a3a' : '#e5e7eb'}`,
              borderRadius: 12,
              padding: 16,
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: shell.color }}>🎞️ {lt('全部帧预览', 'All frame preview')} ({totalFrames}{lt('帧', '')})</h3>
              <button
                onClick={() => setShowAllFrames(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: isFlowDark ? '#9ca3af' : '#6b7280',
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {frames.map((frame) => (
                <div
                  key={frame.index}
                  style={{
                    borderRadius: 6,
                    overflow: 'hidden',
                    border:
                      outputMode === 'single' && selectedFrameIndex === frame.index
                        ? `1px solid ${isFlowDark ? '#60a5fa' : '#2563eb'}`
                        : `1px solid ${isFlowDark ? '#3a3a3a' : '#e5e7eb'}`,
                    background: isFlowDark ? '#161616' : '#ffffff',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    updateNodeData({ outputMode: 'single', selectedFrameIndex: frame.index });
                    setShowAllFrames(false);
                  }}
                >
                  <SmartImage
                    src={frame.thumbnailDataUrl}
                    alt={lt(`帧 ${frame.index}`, `Frame ${frame.index}`)}
                    decoding="async"
                    loading="lazy"
                    style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
                  />
                  <div style={{ padding: '4px 6px', background: isFlowDark ? '#111827' : '#f9fafb', color: isFlowDark ? '#e5e7eb' : '#111827', fontSize: 11 }}>
                    {lt('帧', 'Frame')} {frame.index} | {frame.timestamp.toFixed(1)}s
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 隐藏的 canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

export default React.memo(VideoFrameExtractNodeInner);
