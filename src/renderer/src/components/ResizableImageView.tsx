import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useRef, useState, useCallback, useEffect } from 'react'
import { useTranslations } from '../i18n'

interface ImageAttrs {
  src: string
  alt?: string
  title?: string
  width?: number
  height?: number
  align?: 'left' | 'center' | 'right'
}

// 对齐图标
const AlignLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="15" y2="12" />
    <line x1="3" y1="18" x2="18" y2="18" />
  </svg>
)

const AlignCenterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="6" y1="12" x2="18" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
)

const AlignRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="9" y1="12" x2="21" y2="12" />
    <line x1="6" y1="18" x2="21" y2="18" />
  </svg>
)

// 全局事件名，用于触发 lightbox
export const IMAGE_LIGHTBOX_EVENT = 'image-lightbox-open'

// 图片默认尺寸限制
const IMAGE_MAX_WIDTH = 600
const IMAGE_MAX_HEIGHT = 500
const IMAGE_TARGET_AREA = 180000

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as ImageAttrs
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [autoSize, setAutoSize] = useState<{ width: number; height: number } | null>(null)
  const [imageError, setImageError] = useState(false)
  const t = useTranslations()

  // 双击打开 lightbox（通过全局事件）
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!imageError && attrs.src) {
      window.dispatchEvent(new CustomEvent(IMAGE_LIGHTBOX_EVENT, {
        detail: { src: attrs.src, alt: attrs.alt }
      }))
    }
  }, [imageError, attrs.src, attrs.alt])

  // 存储事件处理器引用以便清理
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })

  // 组件卸载时清理事件监听
  useEffect(() => {
    // Capture ref for cleanup to avoid stale reference warning
    const handlers = handlersRef.current
    return () => {
      if (handlers.move) {
        document.removeEventListener('mousemove', handlers.move)
      }
      if (handlers.up) {
        document.removeEventListener('mouseup', handlers.up)
      }
    }
  }, [])

  useEffect(() => {
    setAutoSize(null)
  }, [attrs.src, attrs.width, attrs.height])

  const handleImageLoad = () => {
    if (imageRef.current) {
      const { naturalWidth, naturalHeight } = imageRef.current
      const ratio = naturalWidth / naturalHeight
      setAspectRatio(ratio)
      setImageError(false)

      // 如果没有设置尺寸，根据面积和尺寸限制计算默认大小
      if (attrs.width || attrs.height) {
        setAutoSize(null)
        return
      }

      const originalArea = naturalWidth * naturalHeight

      // 如果原图在所有限制内，保持原尺寸
      if (originalArea <= IMAGE_TARGET_AREA && naturalWidth <= IMAGE_MAX_WIDTH && naturalHeight <= IMAGE_MAX_HEIGHT) {
        setAutoSize(null)
        return
      }

      let newWidth = naturalWidth
      let newHeight = naturalHeight

      // 先按面积缩放
      if (originalArea > IMAGE_TARGET_AREA) {
        const scale = Math.sqrt(IMAGE_TARGET_AREA / originalArea)
        newWidth = Math.round(naturalWidth * scale)
        newHeight = Math.round(naturalHeight * scale)
      }

      // 再检查宽度限制
      if (newWidth > IMAGE_MAX_WIDTH) {
        newWidth = IMAGE_MAX_WIDTH
        newHeight = Math.round(newWidth / ratio)
      }

      // 再检查高度限制
      if (newHeight > IMAGE_MAX_HEIGHT) {
        newHeight = IMAGE_MAX_HEIGHT
        newWidth = Math.round(newHeight * ratio)
      }

      // Runtime-only display size to avoid mutating note content on open.
      setAutoSize({
        width: newWidth,
        height: newHeight,
      })
    }
  }

  const handleImageError = () => {
    setImageError(true)
  }

  // 对齐切换
  const handleAlign = useCallback((align: 'left' | 'center' | 'right') => {
    updateAttributes({ align })
  }, [updateAttributes])

  const handleMouseDown = useCallback((e: React.MouseEvent, direction: 'left' | 'right') => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    // 使用图片的实际渲染宽度，如果没有设置 width 属性则取自然宽度
    const startWidth = attrs.width || autoSize?.width || imageRef.current?.naturalWidth || containerRef.current?.offsetWidth || 300
    const ratio = aspectRatio || 1
    const container = containerRef.current
    const maxWidth = container?.parentElement?.offsetWidth || 1200

    // 用于存储最终尺寸
    let finalWidth = startWidth
    let finalHeight = Math.round(startWidth / ratio)

    setIsResizing(true)

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX
      // 左边 handle：向左拖动（deltaX < 0）应该增大图片
      // 右边 handle：向右拖动（deltaX > 0）应该增大图片
      const adjustedDelta = direction === 'left' ? -deltaX : deltaX
      let newWidth = startWidth + adjustedDelta

      // 限制尺寸：最小 50px，最大为容器宽度或 1200px
      newWidth = Math.max(50, Math.min(maxWidth, newWidth))
      const newHeight = Math.round(newWidth / ratio)

      // 保存最终尺寸
      finalWidth = Math.round(newWidth)
      finalHeight = newHeight

      // 直接操作 DOM 实现实时预览，避免触发 React 重新渲染
      if (container) {
        container.style.width = `${finalWidth}px`
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      handlersRef.current.move = null
      handlersRef.current.up = null

      // 只在 mouseup 时更新 TipTap 属性
      updateAttributes({
        width: finalWidth,
        height: finalHeight,
      })
    }

    // 保存引用以便清理
    handlersRef.current.move = handleMouseMove
    handlersRef.current.up = handleMouseUp

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [aspectRatio, autoSize?.width, updateAttributes, attrs.width])

  return (
    <NodeViewWrapper className={`image-wrapper align-${attrs.align || 'center'}`}>
      <div
        ref={containerRef}
        className={`image-container ${selected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{
          width: (attrs.width ?? autoSize?.width) ? `${attrs.width ?? autoSize?.width}px` : 'auto',
          maxWidth: '100%',
        }}
      >
        {imageError ? (
          <div className="image-error">
            <span>{t.media.imageLoadFailed}</span>
          </div>
        ) : (
          <img
            ref={imageRef}
            src={attrs.src}
            alt={attrs.alt || ''}
            title={attrs.title}
            draggable={false}
            onLoad={handleImageLoad}
            onError={handleImageError}
            onDoubleClick={handleDoubleClick}
            style={{ cursor: 'zoom-in' }}
          />
        )}

        {/* Resize handles - 始终渲染，CSS 控制 hover/selected 时显示 */}
        <div
          className="resize-handle resize-handle-e"
          onMouseDown={(e) => handleMouseDown(e, 'right')}
        />
        <div
          className="resize-handle resize-handle-w"
          onMouseDown={(e) => handleMouseDown(e, 'left')}
        />

        {/* 浮动对齐工具栏 - 选中时显示 */}
        {selected && (
          <div className="image-align-toolbar">
            <button
              type="button"
              className={`image-align-btn ${attrs.align === 'left' ? 'active' : ''}`}
              onClick={() => handleAlign('left')}
              title={t.media.alignLeft}
            >
              <AlignLeftIcon />
            </button>
            <button
              type="button"
              className={`image-align-btn ${(!attrs.align || attrs.align === 'center') ? 'active' : ''}`}
              onClick={() => handleAlign('center')}
              title={t.media.alignCenter}
            >
              <AlignCenterIcon />
            </button>
            <button
              type="button"
              className={`image-align-btn ${attrs.align === 'right' ? 'active' : ''}`}
              onClick={() => handleAlign('right')}
              title={t.media.alignRight}
            >
              <AlignRightIcon />
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
