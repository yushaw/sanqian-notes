import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { useI18n } from '../i18n/context'
import { BlockAIGenerateButton } from './BlockAIGenerateButton'

// Lazy-load mermaid (~500KB) -- only fetched when a mermaid block is first rendered
let mermaidPromise: Promise<typeof import('mermaid')> | null = null
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
      })
      return mod
    })
  }
  return mermaidPromise
}

export function MermaidView({ node, updateAttributes, selected }: NodeViewProps) {
  const { t } = useI18n()
  const attrs = node.attrs as { code: string }
  const [isEditing, setIsEditing] = useState(false)
  const [code, setCode] = useState(attrs.code)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Render Mermaid chart
  const renderMermaid = useCallback(async (mermaidCode: string) => {
    try {
      setError(null)
      const { default: mermaid } = await getMermaid()
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const { svg } = await mermaid.render(id, mermaidCode)
      setSvg(svg)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.media.mermaidError)
      setSvg('')
    }
  }, [t.media.mermaidError])

  // Initial render and re-render on code change
  useEffect(() => {
    // Delay rendering to ensure DOM is ready
    const timer = setTimeout(() => {
      renderMermaid(attrs.code)
    }, 100)
    return () => clearTimeout(timer)
  }, [attrs.code, renderMermaid])

  // Focus when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      )
    }
  }, [isEditing])

  const handleDoubleClick = () => {
    setIsEditing(true)
    setCode(attrs.code)
  }

  const handleSave = () => {
    updateAttributes({ code })
    setIsEditing(false)
  }

  const handleCancel = () => {
    setCode(attrs.code)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <NodeViewWrapper className={`mermaid-wrapper ${selected ? 'selected' : ''}`}>
      {isEditing ? (
        <div className="mermaid-editor">
          <div className="mermaid-editor-header">
            <BlockAIGenerateButton
              blockType="mermaid"
              currentContent={code}
              onGenerated={(content) => setCode(content)}
              placeholder={t.ai?.mermaidPlaceholder || 'Describe the diagram you want...'}
            />
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            className="mermaid-textarea"
            placeholder={t.media.mermaidPlaceholder}
            rows={8}
          />
          <div className="mermaid-editor-actions">
            <button onClick={handleCancel} className="mermaid-btn mermaid-btn-cancel">
              {t.actions.cancel}
            </button>
            <button onClick={handleSave} className="mermaid-btn mermaid-btn-save">
              {t.actions.save} (⌘S)
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="mermaid-preview"
          onDoubleClick={handleDoubleClick}
        >
          {error ? (
            <div className="mermaid-error">
              <span className="mermaid-error-icon">⚠</span>
              <span>{error}</span>
            </div>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } }) }} />
          )}
          <div className="mermaid-hint">{t.media.doubleClickEdit}</div>
        </div>
      )}
    </NodeViewWrapper>
  )
}
