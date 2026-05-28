import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import paper from 'paper';
import { Button } from '../ui/button';
import SmartImage from '../ui/SmartImage';
import { X, Send, Ruler } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useCanvasStore } from '@/stores';

const isDarkFlowTheme = (): boolean => useAIChatStore.getState().chatTheme === 'black';

// 暗色主题色板
const DARK = {
  overlayBg: 'rgba(0, 0, 0, 0.7)',
  overlayText: '#e5e7eb',
  overlayBorder: 'rgba(255,255,255,0.08)',
  cancelBtnBg: '#2a2a2a',
  cancelBtnBorder: 'rgba(255,255,255,0.12)',
  cancelBtnText: '#e5e7eb',
  frameShadow: '0 30px 70px rgba(0,0,0,0.6)',
  sizeBadgeBg: '#1c1c1c',
  sizeBadgeText: '#e5e7eb',
  sizeBadgeBorder: 'rgba(255,255,255,0.08)',
  sizeBadgeShadow: '0 6px 14px rgba(0,0,0,0.4)',
  frameBorder: '#60a5fa',
  handleBg: '#2563eb',
  handleBorder: 'rgba(255,255,255,0.12)',
  panelTriggerBg: '#2a2a2a',
  panelTriggerBorder: 'rgba(255,255,255,0.12)',
  panelTriggerText: '#e5e7eb',
  panelSendBg: '#2563eb',
  dropdownBg: 'rgba(26,26,26,0.95)',
  dropdownBorder: 'rgba(255,255,255,0.1)',
  dropdownItemHover: 'rgba(255,255,255,0.06)',
} as const;

interface ExpandImageSelectorProps {
  imageBounds: { x: number; y: number; width: number; height: number };
  imageId: string;
  imageUrl: string;
  onSelect: (bounds: { x: number; y: number; width: number; height: number }, expandRatios: { left: number; top: number; right: number; bottom: number }) => void;
  onCancel: () => void;
}

const COMMON_SIZES = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '9:16', ratio: 9 / 16 },
];
const EXPAND_MASK_FILL_COLOR = '#ff0000';

const ExpandImageSelector: React.FC<ExpandImageSelectorProps> = ({
  imageBounds,
  imageId,
  imageUrl,
  onSelect,
  onCancel,
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '')
    .toLowerCase()
    .startsWith('zh');
  const lt = (zh: string, en: string) => (isZh ? zh : en);

  // 暗色主题检测
  const [isDark, setIsDark] = useState(() => isDarkFlowTheme());
  useEffect(() => {
    const sub = useAIChatStore.subscribe((state, prevState) => {
      if (state.chatTheme !== prevState.chatTheme) {
        setIsDark(state.chatTheme === 'black');
      }
    });
    return () => sub();
  }, []);
  const [expandRatios, setExpandRatios] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [_selectedSizeLabel, setSelectedSizeLabel] = useState(lt('常用尺寸', 'Common sizes'));
  const [frameBounds, setFrameBounds] = useState(imageBounds);
  const isDraggingRef = useRef(false);
  const hasCustomFrameRef = useRef(false);
  const prevImageIdRef = useRef(imageId);
  const prevImageBoundsRef = useRef(imageBounds);
  const dragStateRef = useRef<{
    index: number;
    startBounds: { x: number; y: number; width: number; height: number };
    startPaper: paper.Point;
    startAspect: number;
  } | null>(null);
  const moveStateRef = useRef<{
    startBounds: { x: number; y: number; width: number; height: number };
    startPaper: paper.Point;
  } | null>(null);
  const { zoom, panX, panY } = useCanvasStore();
  const viewportSignature = `${zoom}:${panX}:${panY}`;

  // Keep local frame synced with image movement while preserving user adjustments
  useEffect(() => {
    const prev = prevImageBoundsRef.current;
    const deltaX = imageBounds.x - prev.x;
    const deltaY = imageBounds.y - prev.y;
    const hasMeaningfulChange =
      Math.abs(deltaX) > 0.5 ||
      Math.abs(deltaY) > 0.5 ||
      Math.abs(imageBounds.width - prev.width) > 0.5 ||
      Math.abs(imageBounds.height - prev.height) > 0.5;

    prevImageBoundsRef.current = imageBounds;

    if (!hasMeaningfulChange || isDraggingRef.current) return;

    setFrameBounds((current) => {
      if (!current) return imageBounds;
      if (!hasCustomFrameRef.current) {
        return imageBounds;
      }

      return {
        x: current.x + deltaX,
        y: current.y + deltaY,
        // Keep fixed expansion size stable; only follow source-image translation.
        width: current.width,
        height: current.height,
      };
    });
  }, [imageBounds]);

  useEffect(() => {
    if (prevImageIdRef.current === imageId) return;
    prevImageIdRef.current = imageId;
    prevImageBoundsRef.current = imageBounds;
    hasCustomFrameRef.current = false;
    setFrameBounds(imageBounds);
    setSelectedSizeLabel(lt('常用尺寸', 'Common sizes'));
  }, [imageId, imageBounds, lt]);

  // 将Paper.js坐标转换为屏幕坐标
  const convertToScreen = useCallback((point: paper.Point) => {
    if (!paper.view) return { x: point.x, y: point.y };
    const dpr = window.devicePixelRatio || 1;
    const viewPoint = paper.view.projectToView(point);
    const canvas = paper.project?.view?.element;
    const rect = canvas?.getBoundingClientRect();
    return {
      x: viewPoint.x / dpr + (rect?.left ?? 0),
      y: viewPoint.y / dpr + (rect?.top ?? 0),
    };
  }, []);

  // 将屏幕坐标转换为Paper.js坐标
  const convertToPaper = useCallback((screenX: number, screenY: number) => {
    if (!paper.view) return new paper.Point(screenX, screenY);
    const dpr = window.devicePixelRatio || 1;
    return paper.view.viewToProject(new paper.Point(screenX * dpr, screenY * dpr));
  }, []);

  // 计算扩图比例
  const calculateExpandRatios = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    const imageWidth = imageBounds.width;
    const imageHeight = imageBounds.height;
    const imageLeft = imageBounds.x;
    const imageTop = imageBounds.y;

    // 计算选择区域相对于图片的位置
    const relativeLeft = Math.max(0, imageLeft - bounds.x);
    const relativeTop = Math.max(0, imageTop - bounds.y);
    const relativeRight = Math.max(0, (bounds.x + bounds.width) - (imageLeft + imageWidth));
    const relativeBottom = Math.max(0, (bounds.y + bounds.height) - (imageTop + imageHeight));

    // 计算扩图比例（扩图部分/原图尺寸）
    return {
      left: relativeLeft / imageWidth,
      top: relativeTop / imageHeight,
      right: relativeRight / imageWidth,
      bottom: relativeBottom / imageHeight,
    };
  }, [imageBounds]);

  // 取消选择
  const handleCancel = useCallback(() => {
    onCancel();
    setSelectedSizeLabel(lt('常用尺寸', 'Common sizes'));
  }, [onCancel, lt]);

  const handleRightClickCancel = useCallback((e?: React.MouseEvent | MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    handleCancel();
  }, [handleCancel]);

  // Handle resizing logic outside useEffect

  const getPaperPointFromClient = useCallback((clientX: number, clientY: number) => {
    const canvas = paper.project?.view?.element;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return convertToPaper(screenX, screenY);
  }, [convertToPaper]);

  const startHandleDrag = useCallback((index: number, clientX: number, clientY: number) => {
    const startPaper = getPaperPointFromClient(clientX, clientY);
    if (!startPaper) return;
    isDraggingRef.current = true;
    hasCustomFrameRef.current = true;
    dragStateRef.current = {
      index,
      startBounds: { ...frameBounds },
      startPaper,
      startAspect: frameBounds.width && frameBounds.height ? frameBounds.width / frameBounds.height : 1,
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const currentPaper = getPaperPointFromClient(event.clientX, event.clientY);
      if (!currentPaper) return;

      const { index: handleIndex, startBounds, startPaper: start, startAspect } = dragStateRef.current;
      const keepAspect = event.altKey && startAspect > 0;

      let newX = startBounds.x;
      let newY = startBounds.y;
      let newWidth = startBounds.width;
      let newHeight = startBounds.height;

      if (keepAspect) {
        const anchor = (() => {
          switch (handleIndex) {
            case 0:
              return { x: startBounds.x + startBounds.width, y: startBounds.y + startBounds.height };
            case 1:
              return { x: startBounds.x, y: startBounds.y + startBounds.height };
            case 2:
              return { x: startBounds.x, y: startBounds.y };
            case 3:
              return { x: startBounds.x + startBounds.width, y: startBounds.y };
            default:
              return { x: startBounds.x, y: startBounds.y };
          }
        })();

        const signX = handleIndex === 0 || handleIndex === 3 ? -1 : 1;
        const signY = handleIndex === 0 || handleIndex === 1 ? -1 : 1;

        let absW = Math.abs(currentPaper.x - anchor.x);
        let absH = Math.abs(currentPaper.y - anchor.y);

        if (absW / absH > startAspect) {
          absW = absH * startAspect;
        } else {
          absH = absW / startAspect;
        }

        const minSize = 40;
        if (absW < minSize) {
          absW = minSize;
          absH = absW / startAspect;
        }
        if (absH < minSize) {
          absH = minSize;
          absW = absH * startAspect;
        }

        newWidth = absW;
        newHeight = absH;

        let cornerX = anchor.x + signX * newWidth;
        let cornerY = anchor.y + signY * newHeight;
        newX = Math.min(anchor.x, cornerX);
        newY = Math.min(anchor.y, cornerY);

        const requiredWidth = imageBounds.width;
        const requiredHeight = imageBounds.height;
        let minWidth = requiredWidth;
        let minHeight = minWidth / startAspect;
        if (minHeight < requiredHeight) {
          minHeight = requiredHeight;
          minWidth = minHeight * startAspect;
        }
        if (newWidth < minWidth || newHeight < minHeight) {
          newWidth = Math.max(newWidth, minWidth);
          newHeight = Math.max(newHeight, minHeight);
          cornerX = anchor.x + signX * newWidth;
          cornerY = anchor.y + signY * newHeight;
          newX = Math.min(anchor.x, cornerX);
          newY = Math.min(anchor.y, cornerY);
        }

        const imageLeft = imageBounds.x;
        const imageTop = imageBounds.y;
        const imageRight = imageBounds.x + imageBounds.width;
        const imageBottom = imageBounds.y + imageBounds.height;

        if (newX > imageLeft) newX = imageLeft;
        if (newY > imageTop) newY = imageTop;
        if (newX + newWidth < imageRight) newX = imageRight - newWidth;
        if (newY + newHeight < imageBottom) newY = imageBottom - newHeight;
      } else {
        const delta = currentPaper.subtract(start);

        const affectsLeft = handleIndex === 0 || handleIndex === 3;
        const affectsTop = handleIndex === 0 || handleIndex === 1;

        switch (handleIndex) {
          case 0: // top-left
            newX += delta.x;
            newY += delta.y;
            newWidth -= delta.x;
            newHeight -= delta.y;
            break;
          case 1: // top-right
            newY += delta.y;
            newWidth += delta.x;
            newHeight -= delta.y;
            break;
          case 2: // bottom-right
            newWidth += delta.x;
            newHeight += delta.y;
            break;
          case 3: // bottom-left
            newX += delta.x;
            newWidth -= delta.x;
            newHeight += delta.y;
            break;
        }

        const minSize = 40;
        if (newWidth < minSize) {
          if (affectsLeft) {
            newX = startBounds.x + (startBounds.width - minSize);
          }
          newWidth = minSize;
        }
        if (newHeight < minSize) {
          if (affectsTop) {
            newY = startBounds.y + (startBounds.height - minSize);
          }
          newHeight = minSize;
        }

        const imageLeft = imageBounds.x;
        const imageTop = imageBounds.y;
        const imageRight = imageBounds.x + imageBounds.width;
        const imageBottom = imageBounds.y + imageBounds.height;

        let newRight = newX + newWidth;
        let newBottom = newY + newHeight;

        if (newX > imageLeft) {
          newX = imageLeft;
          newWidth = newRight - newX;
        }
        if (newRight < imageRight) {
          newRight = imageRight;
          newWidth = newRight - newX;
        }
        if (newY > imageTop) {
          newY = imageTop;
          newHeight = newBottom - newY;
        }
        if (newBottom < imageBottom) {
          newBottom = imageBottom;
          newHeight = newBottom - newY;
        }

        if (newWidth < imageBounds.width) {
          newWidth = imageBounds.width;
          newX = imageBounds.x;
        }
        if (newHeight < imageBounds.height) {
          newHeight = imageBounds.height;
          newY = imageBounds.y;
        }
      }

      setFrameBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      isDraggingRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [frameBounds, getPaperPointFromClient]);

  const handleHandlePointerDown = useCallback((index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    startHandleDrag(index, event.clientX, event.clientY);
  }, [startHandleDrag]);

  const startFrameDrag = useCallback((clientX: number, clientY: number) => {
    const startPaper = getPaperPointFromClient(clientX, clientY);
    if (!startPaper) return;
    isDraggingRef.current = true;
    hasCustomFrameRef.current = true;
    moveStateRef.current = {
      startBounds: { ...frameBounds },
      startPaper,
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!moveStateRef.current) return;
      const currentPaper = getPaperPointFromClient(event.clientX, event.clientY);
      if (!currentPaper) return;

      const { startBounds, startPaper: start } = moveStateRef.current;
      const delta = currentPaper.subtract(start);

      let newX = startBounds.x + delta.x;
      let newY = startBounds.y + delta.y;
      const newWidth = startBounds.width;
      const newHeight = startBounds.height;

      const imageLeft = imageBounds.x;
      const imageTop = imageBounds.y;
      const imageRight = imageBounds.x + imageBounds.width;
      const imageBottom = imageBounds.y + imageBounds.height;

      if (newX > imageLeft) newX = imageLeft;
      if (newY > imageTop) newY = imageTop;
      if (newX + newWidth < imageRight) newX = imageRight - newWidth;
      if (newY + newHeight < imageBottom) newY = imageBottom - newHeight;

      setFrameBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    };

    const handlePointerUp = () => {
      moveStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      isDraggingRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [frameBounds, getPaperPointFromClient, imageBounds]);

  const handleFramePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    startFrameDrag(event.clientX, event.clientY);
  }, [startFrameDrag]);

  // Update ratios on frame change
  useEffect(() => {
    if (frameBounds) {
      setExpandRatios(calculateExpandRatios(frameBounds));
    }
  }, [frameBounds, calculateExpandRatios]);

  // 应用比例（基于当前框）
  const applyAspectRatio = useCallback((ratio: number, label?: string) => {
    if (ratio <= 0) return;
    if (!frameBounds) return;
    hasCustomFrameRef.current = true;

    const currentWidth = frameBounds.width;
    const currentHeight = frameBounds.height;
    const longSide = Math.max(currentWidth, currentHeight);

    let newWidth = currentWidth >= currentHeight ? longSide : longSide * ratio;
    let newHeight = currentWidth >= currentHeight ? longSide / ratio : longSide;

    // 保持至少覆盖原图
    if (newWidth < imageBounds.width) {
      newWidth = imageBounds.width;
      newHeight = newWidth / ratio;
    }
    if (newHeight < imageBounds.height) {
      newHeight = imageBounds.height;
      newWidth = newHeight * ratio;
    }

    const MIN_SIZE = 10;
    newWidth = Math.max(newWidth, MIN_SIZE);
    newHeight = Math.max(newHeight, MIN_SIZE);

    const centerX = frameBounds.x + frameBounds.width / 2;
    const centerY = frameBounds.y + frameBounds.height / 2;

    let newX = centerX - newWidth / 2;
    let newY = centerY - newHeight / 2;
    const imageLeft = imageBounds.x;
    const imageTop = imageBounds.y;
    const imageRight = imageBounds.x + imageBounds.width;
    const imageBottom = imageBounds.y + imageBounds.height;

    // 确保新框始终包住原图（只平移，不缩回原图尺寸）
    if (newX > imageLeft) newX = imageLeft;
    if (newY > imageTop) newY = imageTop;
    if (newX + newWidth < imageRight) newX = imageRight - newWidth;
    if (newY + newHeight < imageBottom) newY = imageBottom - newHeight;

    const newBounds = {
      x: newX,
      y: newY,
      width: newWidth,
      height: newHeight,
    };

    setFrameBounds(newBounds);
    const ratios = calculateExpandRatios(newBounds);
    setExpandRatios(ratios);

    if (label) {
      setSelectedSizeLabel(label);
    }
  }, [frameBounds, imageBounds, calculateExpandRatios]);

  // 确认选择并发送
  const handleConfirm = useCallback(() => {
    if (!frameBounds || !expandRatios) return;
    onSelect(frameBounds, expandRatios);
  }, [frameBounds, expandRatios, onSelect]);

  const screenBounds = useMemo(() => {
    void viewportSignature;
    if (!frameBounds) return null;
    const topLeft = convertToScreen(new paper.Point(frameBounds.x, frameBounds.y));
    const bottomRight = convertToScreen(new paper.Point(frameBounds.x + frameBounds.width, frameBounds.y + frameBounds.height));
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }, [frameBounds, convertToScreen, viewportSignature]);

  const imageScreenBounds = useMemo(() => {
    void viewportSignature;
    const topLeft = convertToScreen(new paper.Point(imageBounds.x, imageBounds.y));
    const bottomRight = convertToScreen(new paper.Point(imageBounds.x + imageBounds.width, imageBounds.y + imageBounds.height));
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }, [imageBounds, convertToScreen, viewportSignature]);

  const previewImagePosition = useMemo(() => {
    if (!screenBounds) return null;
    if (!imageScreenBounds) return null;
    return {
      left: imageScreenBounds.x - screenBounds.x,
      top: imageScreenBounds.y - screenBounds.y,
      width: imageScreenBounds.width,
      height: imageScreenBounds.height,
    };
  }, [imageScreenBounds, screenBounds]);

  const hasExpandArea = useMemo(() => {
    if (!frameBounds) return false;
    const frameRight = frameBounds.x + frameBounds.width;
    const frameBottom = frameBounds.y + frameBounds.height;
    const imageRight = imageBounds.x + imageBounds.width;
    const imageBottom = imageBounds.y + imageBounds.height;

    return (
      frameBounds.x < imageBounds.x - 0.5 ||
      frameBounds.y < imageBounds.y - 0.5 ||
      frameRight > imageRight + 0.5 ||
      frameBottom > imageBottom + 0.5
    );
  }, [frameBounds, imageBounds]);

  // 阻止画板的默认交互，但允许截图选择层工作
  useEffect(() => {
    const canvas = paper.project?.view?.element;
    if (!canvas) return;

    // 设置画板为不可交互，让我们的选择层处理所有鼠标事件
    canvas.style.pointerEvents = 'none';

    return () => {
      canvas.style.pointerEvents = 'auto';
    };
  }, []);

  const controlPanelPosition = useMemo(() => {
    if (!screenBounds) return { left: 0, top: 0 };
    const panelHeight = 106;
    const panelWidth = 50;
    const gap = 12;

    let left = screenBounds.x + screenBounds.width + gap;
    let top = screenBounds.y + screenBounds.height - panelHeight;

    if (left + panelWidth > window.innerWidth - 12) {
      left = window.innerWidth - panelWidth - 12;
    }
    if (top + panelHeight > window.innerHeight - 12) {
      top = window.innerHeight - panelHeight - 12;
    }
    if (top < 12) {
      top = 12;
    }

    return { left, top };
  }, [screenBounds]);

  const sizeBadgePosition = useMemo(() => {
    if (!screenBounds) return { left: 0, top: 0 };
    const gap = 10;
    const left = Math.max(
      Math.min(screenBounds.x + screenBounds.width / 2, window.innerWidth - 80),
      12
    );
    const top = Math.min(screenBounds.y + screenBounds.height + gap, window.innerHeight - 30);
    return { left, top };
  }, [screenBounds]);

  const content = (
    <>
      {/* 全屏覆盖层 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10000,
          cursor: 'crosshair',
          backgroundColor: 'transparent',
          pointerEvents: 'auto',
        }}
        onContextMenu={handleRightClickCancel}
      >
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(0, 0, 0, 0.75)',
            color: isDark ? '#e5e7eb' : 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '14px',
            zIndex: 10001,
            border: isDark ? '1px solid rgba(255,255,255,0.08)' : 'none',
          }}
        >
          {frameBounds
            ? hasExpandArea
              ? lt('红色区域会作为待补全蒙版提交，右键或点击取消按钮退出', 'Red area will be submitted as the fill mask. Right click or click cancel to exit.')
              : lt('请至少拖出一侧超出原图的区域后再发送', 'Expand at least one side beyond the source image before sending.')
            : lt('请拖拽图片角柄调整扩图区域', 'Drag image corner handles to adjust the expansion area.')}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 10000,
            backgroundColor: isDark ? DARK.cancelBtnBg : 'white',
            color: isDark ? DARK.cancelBtnText : undefined,
            borderColor: isDark ? DARK.cancelBtnBorder : undefined,
          }}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {frameBounds && screenBounds && (
        <>
          <div
            style={{
              position: 'fixed',
              left: `${screenBounds.x}px`,
              top: `${screenBounds.y}px`,
              width: `${screenBounds.width}px`,
              height: `${screenBounds.height}px`,
              zIndex: 10000,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: EXPAND_MASK_FILL_COLOR,
                boxShadow: isDark ? DARK.frameShadow : '0 30px 70px rgba(15,23,42,0.25)',
                pointerEvents: 'none',
              }}
            />
            <div
              onPointerDown={handleFramePointerDown}
              style={{
                position: 'absolute',
                inset: 0,
                cursor: 'move',
                background: 'transparent',
                pointerEvents: 'auto',
                zIndex: 2,
              }}
            />
            {imageUrl && previewImagePosition && (
              <SmartImage
                src={imageUrl}
                alt=""
                style={{
                  position: 'absolute',
                  left: `${previewImagePosition.left}px`,
                  top: `${previewImagePosition.top}px`,
                  width: `${previewImagePosition.width}px`,
                  height: `${previewImagePosition.height}px`,
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  zIndex: 1,
                }}
                draggable={false}
              />
            )}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                border: `2px dashed ${isDark ? '#60a5fa' : '#3b82f6'}`,
                borderRadius: 0,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
            {[
              { key: 'tl', style: { left: -8, top: -8 }, cursor: 'nwse-resize', index: 0 },
              { key: 'tr', style: { right: -8, top: -8 }, cursor: 'nesw-resize', index: 1 },
              { key: 'br', style: { right: -8, bottom: -8 }, cursor: 'nwse-resize', index: 2 },
              { key: 'bl', style: { left: -8, bottom: -8 }, cursor: 'nesw-resize', index: 3 },
            ].map(handle => (
              <div
                key={handle.key}
                onPointerDown={handleHandlePointerDown(handle.index)}
                style={{
                  position: 'absolute',
                  width: 14,
                  height: 14,
                  borderRadius: 2,
                  background: isDark ? DARK.handleBg : '#2563eb',
                  border: `1px solid ${isDark ? DARK.handleBorder : '#dbeafe'}`,
                  boxShadow: isDark ? '0 3px 8px rgba(0,0,0,0.4)' : '0 3px 8px rgba(37, 99, 235, 0.18)',
                  cursor: handle.cursor as React.CSSProperties['cursor'],
                  pointerEvents: 'auto',
                  zIndex: 3,
                  ...handle.style,
                }}
              />
            ))}
          </div>
          <div
            style={{
              position: 'fixed',
              left: `${sizeBadgePosition.left}px`,
              top: `${sizeBadgePosition.top}px`,
              zIndex: 10001,
              background: isDark ? DARK.sizeBadgeBg : '#fff',
              color: isDark ? DARK.sizeBadgeText : '#0f172a',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '11px',
              letterSpacing: '0.1px',
              border: `1px solid ${isDark ? DARK.sizeBadgeBorder : 'rgba(15,23,42,0.1)'}`,
              pointerEvents: 'none',
              transform: 'translateX(-50%)',
              boxShadow: isDark ? DARK.sizeBadgeShadow : '0 6px 14px rgba(15, 23, 42, 0.08)',
            }}
          >
            {`${frameBounds.width.toFixed(0)} × ${frameBounds.height.toFixed(0)}`}
          </div>
          <div
            data-expand-panel
            style={{
              position: 'fixed',
              left: `${controlPanelPosition.left}px`,
              top: `${controlPanelPosition.top}px`,
              zIndex: 10001,
              background: 'transparent',
              borderRadius: '18px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              alignItems: 'center',
              boxShadow: 'none',
              pointerEvents: 'auto',
              border: 'none',
              width: '50px',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  style={{
                    color: isDark ? DARK.panelTriggerText : '#0f172a',
                    border: `1px solid ${isDark ? DARK.panelTriggerBorder : 'rgba(15,23,42,0.15)'}`,
                    borderRadius: '999px',
                    width: '34px',
                    height: '34px',
                    background: isDark ? DARK.panelTriggerBg : '#f8fafc',
                    margin: '0px 8px',
                  }}
                  title={lt('选择常用尺寸', 'Select common sizes')}
                >
                  <Ruler className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                style={{
                  width: '74px',
                  background: isDark ? DARK.dropdownBg : 'rgba(255,255,255,0.9)',
                  fontSize: '10px',
                  border: `1px solid ${isDark ? DARK.dropdownBorder : 'rgba(15,23,42,0.08)'}`,
                  backdropFilter: isDark ? 'blur(12px)' : undefined,
                }}
              >
                {COMMON_SIZES.map(({ label, ratio }) => (
                  <DropdownMenuItem
                    key={label}
                    onClick={() => applyAspectRatio(ratio, label)}
                    style={{
                      textAlign: 'center',
                      color: isDark ? '#e5e7eb' : undefined,
                      background: 'transparent',
                    }}
                    className={isDark ? 'dark-dropdown-item' : ''}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirm}
              disabled={!frameBounds || !expandRatios || !hasExpandArea}
              title={lt('发送', 'Send')}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                boxShadow: isDark ? '0 8px 14px rgba(37, 99, 235, 0.35)' : '0 8px 14px rgba(37, 99, 235, 0.25)',
              }}
            >
              <Send className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              title={lt('取消', 'Cancel')}
              style={{
                color: isDark ? DARK.panelTriggerText : '#0f172a',
                border: `1px solid ${isDark ? DARK.panelTriggerBorder : 'rgba(15,23,42,0.15)'}`,
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                background: isDark ? DARK.panelTriggerBg : '#f8fafc',
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
};

export default ExpandImageSelector;
