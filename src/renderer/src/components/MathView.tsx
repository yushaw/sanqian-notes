import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import katex from 'katex'
import { useTranslations } from '../i18n'

interface MathAttrs {
  latex: string
  display?: string
}

export function MathView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as MathAttrs
  const [isEditing, setIsEditing] = useState(false)
  const [latex, setLatex] = useState(attrs.latex)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renderRef = useRef<HTMLSpanElement>(null)
  const t = useTranslations()

  const isDisplayMode = attrs.display === 'yes'

  // Render KaTeX
  useEffect(() => {
    if (!isEditing && renderRef.current) {
      try {
        katex.render(attrs.latex || '?', renderRef.current, {
          displayMode: isDisplayMode,
          throwOnError: false,
          strict: false,
        })
      } catch {
        if (renderRef.current) {
          renderRef.current.textContent = attrs.latex || '?'
        }
      }
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
      textareaRef.current.focus()
      textareaRef.current.select()
      resizeTextarea()
    }
  }, [isEditing, resizeTextarea])

  // Sync local state when attrs change
  useEffect(() => {
    setLatex(attrs.latex)
  }, [attrs.latex])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    if (latex !== attrs.latex) {
      updateAttributes({ latex })
    }
  }, [latex, attrs.latex, updateAttributes])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault()
      setIsEditing(false)
      if (latex !== attrs.latex) {
        updateAttributes({ latex })
      }
    }
  }, [latex, attrs.latex, updateAttributes])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLatex(e.target.value)
    resizeTextarea()
  }, [resizeTextarea])

  return (
    <NodeViewWrapper
      as="span"
      className={`math-node-wrapper ${selected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={latex}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="math-input"
          rows={1}
        />
      ) : (
        <span
          ref={renderRef}
          className="math-render"
          onClick={handleClick}
          title={t.media.editFormula}
        />
      )}
    </NodeViewWrapper>
  )
}
