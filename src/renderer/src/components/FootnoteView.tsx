import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../i18n/context'

interface FootnoteAttrs {
  id: number
  content: string
}

export function FootnoteView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const { t } = useI18n()
  const attrs = node.attrs as FootnoteAttrs
  // 空内容时自动进入编辑模式（从斜杠菜单插入的新脚注）
  const [isEditing, setIsEditing] = useState(!attrs.content)
  const [showTooltip, setShowTooltip] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      // 延迟聚焦，确保编辑器操作完成后再获取焦点
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isEditing])

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

      {/* Edit popup */}
      {isEditing && (
        <div className="footnote-editor">
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
        </div>
      )}
    </NodeViewWrapper>
  )
}
