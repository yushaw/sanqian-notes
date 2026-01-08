import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n/context'

interface FootnoteAttrs {
  id: number
  content: string
}

interface PopupPosition {
  top: number
  left: number
}

export function FootnoteView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const { t } = useI18n()
  const attrs = node.attrs as FootnoteAttrs
  // 空内容时自动进入编辑模式（从斜杠菜单插入的新脚注）
  const [isEditing, setIsEditing] = useState(!attrs.content)
  const [showTooltip, setShowTooltip] = useState(false)
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ top: 0, left: 0 })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const refSpanRef = useRef<HTMLSpanElement>(null)

  // 计算弹窗位置，确保不超出视口
  const updatePopupPosition = useCallback(() => {
    if (refSpanRef.current) {
      const rect = refSpanRef.current.getBoundingClientRect()
      // 紧凑样式：CSS max-width: 320px，高度包含 header + textarea + hint
      const popupWidth = 320
      const popupHeight = 120

      let top = rect.bottom + 4
      let left = rect.left

      // 右边界检查
      if (left + popupWidth > window.innerWidth - 16) {
        left = window.innerWidth - popupWidth - 16
      }

      // 左边界检查
      if (left < 16) {
        left = 16
      }

      // 下边界检查 - 如果下方空间不足，显示在上方
      if (top + popupHeight > window.innerHeight - 16) {
        top = rect.top - popupHeight - 4
      }

      setPopupPosition({ top, left })
    }
  }, [])

  useEffect(() => {
    if (isEditing) {
      // 使用 requestAnimationFrame 确保 DOM 完全渲染后再计算位置
      const rafId = requestAnimationFrame(() => {
        updatePopupPosition()
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [isEditing, updatePopupPosition])

  // 滚动或窗口大小变化时关闭弹窗
  useEffect(() => {
    if (!isEditing) return

    const handleScrollOrResize = () => {
      setIsEditing(false)
      // 如果内容为空，删除脚注
      if (!attrs.content?.trim()) {
        deleteNode()
      }
    }

    // 使用 capture 确保能捕获所有滚动事件
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isEditing, attrs.content, deleteNode])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
  }

  const handleBlur = () => {
    setIsEditing(false)
    // 如果内容为空，删除这个脚注（使用可选链防止 undefined）
    if (!attrs.content?.trim()) {
      deleteNode()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsEditing(false)
      // Escape 时如果内容为空也删除
      if (!attrs.content?.trim()) {
        deleteNode()
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      setIsEditing(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateAttributes({ content: e.target.value })
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`footnote-wrapper ${selected ? 'selected' : ''}`}
    >
      <span
        ref={refSpanRef}
        className="footnote-ref"
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        [{attrs.id}]
      </span>

      {/* Tooltip on hover */}
      {showTooltip && attrs.content && !isEditing && (
        <div className="footnote-tooltip">
          {attrs.content}
        </div>
      )}

      {/* Edit popup - 使用 Portal 渲染到 body，避免被父元素遮挡 */}
      {isEditing && createPortal(
        <div
          className="footnote-editor"
          style={{
            position: 'fixed',
            top: popupPosition.top,
            left: popupPosition.left,
            zIndex: 9999
          }}
        >
          <div className="footnote-editor-header">
            {t.slashCommand.footnote} {attrs.id}
          </div>
          <textarea
            ref={inputRef}
            value={attrs.content}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={t.media.footnotePlaceholder}
            rows={3}
          />
          <div className="footnote-editor-hint">
            {t.media.footnoteHint}
          </div>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  )
}
