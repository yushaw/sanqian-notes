import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, ArrowRight } from 'lucide-react'

// Lazy-load KaTeX (~270KB JS + 23KB CSS) -- only fetched when a math block is first rendered
let katexPromise: Promise<typeof import('katex')> | null = null
let katexCssInjected = false
function getKaTeX() {
  if (!katexPromise) {
    katexPromise = import('katex')
    if (!katexCssInjected) {
      katexCssInjected = true
      import('katex/dist/katex.min.css')
    }
  }
  return katexPromise
}
import { useTranslations } from '../i18n'
import { BlockAIGenerateButton } from './BlockAIGenerateButton'
import { useBlockAIGenerate } from '../hooks/useBlockAIGenerate'
import { toast } from '../utils/toast'

interface MathAttrs {
  latex: string
  display?: string
}

export function MathView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const attrs = node.attrs as MathAttrs
  // 空内容时自动进入编辑模式（从斜杠菜单插入的新节点）
  const [isEditing, setIsEditing] = useState(!attrs.latex)
  const [latex, setLatex] = useState(attrs.latex)
  const [showInlineAI, setShowInlineAI] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renderRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const aiInputRef = useRef<HTMLTextAreaElement>(null)
  const t = useTranslations()

  const isDisplayMode = attrs.display === 'yes'

  // AI generate hook for inline mode
  const { generate, isGenerating } = useBlockAIGenerate({
    onComplete: (result) => {
      setLatex(result)
      setShowInlineAI(false)
      setAiPrompt('')
      // Auto-save for inline-mode
      if (!isDisplayMode) {
        updateAttributes({ latex: result })
      }
      // Refocus the math textarea
      textareaRef.current?.focus()
    },
    onError: (error) => {
      console.error('[MathView AI] Error:', error)
      toast(error, { type: 'error' })
    }
  })

  // Render KaTeX (lazy-loaded)
  useEffect(() => {
    if (!isEditing && renderRef.current) {
      const el = renderRef.current
      getKaTeX().then(({ default: katexLib }) => {
        try {
          katexLib.render(attrs.latex || '?', el, {
            displayMode: isDisplayMode,
            throwOnError: false,
            strict: false,
          })
        } catch {
          el.textContent = attrs.latex || '?'
        }
      }).catch(() => {
        el.textContent = attrs.latex || '?'
      })
    }
  }, [attrs.latex, isEditing, isDisplayMode])

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [])

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      // 延迟聚焦，确保编辑器操作完成后再获取焦点
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.select()
          resizeTextarea()
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isEditing, resizeTextarea])

  // Sync local state when attrs change
  useEffect(() => {
    setLatex(attrs.latex)
  }, [attrs.latex])

  // 单击已选中的节点进入编辑模式
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (selected) {
      e.preventDefault()
      e.stopPropagation()
      setIsEditing(true)
    }
    // 未选中时不阻止事件，让 ProseMirror 处理选中
  }, [selected])

  // 双击直接进入编辑模式（无论是否已选中）
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  // Shared exit logic for blur handling
  const exitEditMode = useCallback((currentLatex: string) => {
    setIsEditing(false)
    // 如果内容为空，删除这个公式节点
    if (!currentLatex?.trim()) {
      deleteNode()
      // 删除后将焦点还给编辑器，确保可以 undo
      editor.commands.focus()
      return
    }
    if (currentLatex !== attrs.latex) {
      updateAttributes({ latex: currentLatex })
    }
  }, [attrs.latex, updateAttributes, deleteNode, editor])

  // Container-level blur handler - fires when focus leaves the entire container
  const handleContainerBlur = useCallback((e: React.FocusEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    // Only exit if focus is moving outside the container
    if (!relatedTarget || !containerRef.current?.contains(relatedTarget)) {
      // Skip if AI is generating
      if (isGenerating) return
      exitEditMode(latex)
    }
  }, [latex, isGenerating, exitEditMode])

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is moving to an element inside the container (e.g., AI button)
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (relatedTarget && containerRef.current?.contains(relatedTarget)) {
      return // Don't exit edit mode if focus stays within container
    }

    exitEditMode(latex)
  }, [latex, exitEditMode])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      exitEditMode(latex)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      exitEditMode(latex)
    }
  }, [latex, exitEditMode])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLatex(e.target.value)
    resizeTextarea()
  }, [resizeTextarea])

  return (
    <NodeViewWrapper
      as="span"
      className={`math-node-wrapper ${selected ? 'selected' : ''} ${isEditing ? 'editing' : ''} ${isDisplayMode ? 'display-mode' : 'inline-mode'}`}
    >
      {isEditing ? (
        <div className="math-editor-container" ref={containerRef} onBlur={handleContainerBlur}>
          {isDisplayMode && (
            <div className="math-editor-header">
              <BlockAIGenerateButton
                blockType="math"
                currentContent={latex}
                onGenerated={(content) => setLatex(content)}
                placeholder={t.ai?.mathPlaceholder || 'Describe the formula...'}
              />
            </div>
          )}
          {!isDisplayMode && showInlineAI ? (
            <>
              <textarea
                ref={aiInputRef}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onBlur={(e) => {
                  // Let container-level blur handle exit if focus moves outside
                  const relatedTarget = e.relatedTarget as HTMLElement | null
                  if (relatedTarget && containerRef.current?.contains(relatedTarget)) {
                    return
                  }
                  if (!isGenerating) {
                    setShowInlineAI(false)
                    setAiPrompt('')
                    exitEditMode(latex)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && aiPrompt.trim() && !isGenerating) {
                    e.preventDefault()
                    generate('math', aiPrompt, latex)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setShowInlineAI(false)
                    setAiPrompt('')
                    setTimeout(() => textareaRef.current?.focus(), 0)
                  }
                }}
                placeholder={t.ai?.mathPlaceholder || 'Describe the formula...'}
                className="math-input math-ai-input"
                rows={1}
                disabled={isGenerating}
              />
              <button
                className="math-inline-ai-btn math-inline-ai-run"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (aiPrompt.trim() && !isGenerating) {
                    generate('math', aiPrompt, latex)
                  }
                }}
                disabled={!aiPrompt.trim() || isGenerating}
                title={t.ai?.generate || 'Generate'}
              >
                {isGenerating ? <span className="math-inline-ai-spinner" /> : <ArrowRight size={12} strokeWidth={2} />}
              </button>
              <button
                className="math-inline-ai-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowInlineAI(false)
                  setAiPrompt('')
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
                title={t.actions?.cancel || 'Cancel'}
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={latex}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="math-input"
                rows={1}
              />
              {!isDisplayMode && (
                <button
                  className="math-inline-ai-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setShowInlineAI(true)
                    setTimeout(() => aiInputRef.current?.focus(), 0)
                  }}
                  title={t.ai?.generate || 'AI Generate'}
                >
                  <Sparkles size={12} strokeWidth={1.5} />
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <span
          ref={renderRef}
          className="math-render"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          title={t.media.editFormula}
        />
      )}
    </NodeViewWrapper>
  )
}
