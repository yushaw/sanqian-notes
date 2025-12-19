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

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as ImageAttrs
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [imageError, setImageError] = useState(false)
  const t = useTranslations()

  // 存储事件处理器引用以便清理
  const handlersRef = useRef<{
    move: ((e: MouseEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })

  // 组件卸载时清理事件监听
  useEffect(() => {
    return () => {
      if (handlersRef.current.move) {
        document.removeEventListener('mousemove', handlersRef.current.move)
      }
      if (handlersRef.current.up) {
        document.removeEventListener('mouseup', handlersRef.current.up)
      }
    }
  }, [])

  const handleImageLoad = () => {
    if (imageRef.current) {
      const { naturalWidth, naturalHeight } = imageRef.current
      setAspectRatio(naturalWidth / naturalHeight)
      setImageError(false)
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
    const startWidth = attrs.width || imageRef.current?.naturalWidth || containerRef.current?.offsetWidth || 300
    const ratio = aspectRatio || 1

    setIsResizing(true)

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX
      // 左边 handle：向左拖动（deltaX < 0）应该增大图片
      // 右边 handle：向右拖动（deltaX > 0）应该增大图片
      const adjustedDelta = direction === 'left' ? -deltaX : deltaX
      let newWidth = startWidth + adjustedDelta

      // 限制尺寸：最小 50px，最大为容器宽度或 1200px
      const maxWidth = containerRef.current?.parentElement?.offsetWidth || 1200
      newWidth = Math.max(50, Math.min(maxWidth, newWidth))
      const newHeight = Math.round(newWidth / ratio)

      updateAttributes({
        width: Math.round(newWidth),
        height: newHeight,
      })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      handlersRef.current.move = null
      handlersRef.current.up = null
    }

    // 保存引用以便清理
    handlersRef.current.move = handleMouseMove
    handlersRef.current.up = handleMouseUp

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [aspectRatio, updateAttributes, attrs.width])

  return (
    <NodeViewWrapper className={`image-wrapper align-${attrs.align || 'center'}`}>
      <div
        ref={containerRef}
        className={`image-container ${selected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{
          width: attrs.width ? `${attrs.width}px` : 'auto',
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
