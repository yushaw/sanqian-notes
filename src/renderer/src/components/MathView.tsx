import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import katex from 'katex'
import { useTranslations } from '../i18n'

interface MathAttrs {
  latex: string
  display?: string
}

export function MathView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const attrs = node.attrs as MathAttrs
  // 空内容时自动进入编辑模式（从斜杠菜单插入的新节点）
  const [isEditing, setIsEditing] = useState(!attrs.latex)
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

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    // 如果内容为空，删除这个公式节点
    if (!latex?.trim()) {
      deleteNode()
      // 删除后将焦点还给编辑器，确保可以 undo
      editor.commands.focus()
      return
    }
    if (latex !== attrs.latex) {
      updateAttributes({ latex })
    }
  }, [latex, attrs.latex, updateAttributes, deleteNode, editor])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsEditing(false)
      // Escape 时如果内容为空也删除
      if (!latex?.trim()) {
        deleteNode()
        // 删除后将焦点还给编辑器，确保可以 undo
        editor.commands.focus()
        return
      }
      if (latex !== attrs.latex) {
        updateAttributes({ latex })
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      setIsEditing(false)
      if (latex !== attrs.latex) {
        updateAttributes({ latex })
      }
    }
  }, [latex, attrs.latex, updateAttributes, deleteNode, editor])

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
          onDoubleClick={handleDoubleClick}
          title={t.media.editFormula}
        />
      )}
    </NodeViewWrapper>
  )
}
