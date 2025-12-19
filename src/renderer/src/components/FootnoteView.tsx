import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../i18n/context'

interface FootnoteAttrs {
  id: number
  content: string
}

export function FootnoteView({ node, updateAttributes, selected }: NodeViewProps) {
  const { t } = useI18n()
  const attrs = node.attrs as FootnoteAttrs
  const [isEditing, setIsEditing] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
  }

  const handleBlur = () => {
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
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
