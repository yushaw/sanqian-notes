import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'

export function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const { open, summary } = node.attrs as { open: boolean; summary: string }
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleOpen = (e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    e.stopPropagation()
    updateAttributes({ open: !open })
  }

  const handleSummaryDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
  }

  const handleSummaryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateAttributes({ summary: e.target.value })
  }

  const handleSummaryBlur = () => {
    setIsEditing(false)
  }

  const handleSummaryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      setIsEditing(false)
    }
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  return (
    <NodeViewWrapper className={`toggle-block ${open ? 'open' : ''}`}>
      <div className="toggle-header" onClick={toggleOpen}>
        <span className={`toggle-icon ${open ? 'open' : ''}`}>▶</span>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="toggle-summary-input"
            value={summary}
            onChange={handleSummaryChange}
            onBlur={handleSummaryBlur}
            onKeyDown={handleSummaryKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="toggle-summary" onDoubleClick={handleSummaryDoubleClick}>
            {summary}
          </span>
        )}
      </div>
      <div className={`toggle-content ${open ? 'open' : ''}`}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}
