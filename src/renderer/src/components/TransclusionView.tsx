import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, AlertTriangle, Pencil, FileSymlink } from 'lucide-react'
import DOMPurify from 'dompurify'
import { useTranslations } from '../i18n'
import type { Note } from '../types/note'

// Simple debounce utility
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId)
  }
  return debounced as T & { cancel: () => void }
}

interface TransclusionAttrs {
  noteId: string
  noteName: string
  targetType: 'note' | 'heading' | 'block'
  targetValue: string | null
  collapsed: boolean
  maxHeight: number
}

// TipTap JSON node interface
interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

// 从 TipTap 节点中提取纯文本
function getTextFromNode(node: TiptapNode): string {
  if (node.text) return node.text
  if (!node.content) return ''
  return node.content.map(getTextFromNode).join('')
}

// 将 TipTap JSON 转换为 HTML
function tiptapToHtml(nodes: TiptapNode[]): string {
  return nodes.map(node => nodeToHtml(node)).join('')
}

function nodeToHtml(node: TiptapNode): string {
  const { type, attrs, content, text, marks } = node

  // 文本节点
  if (type === 'text' && text) {
    let html = escapeHtml(text)
    if (marks) {
      for (const mark of marks) {
        html = wrapMark(html, mark)
      }
    }
    return html
  }

  // 递归处理子内容
  const inner = content ? tiptapToHtml(content) : ''

  switch (type) {
    case 'doc':
      return inner
    case 'paragraph':
      return `<p>${inner || '<br>'}</p>`
    case 'heading': {
      const level = (attrs?.level as number) || 1
      return `<h${level}>${inner}</h${level}>`
    }
    case 'bulletList':
      return `<ul>${inner}</ul>`
    case 'orderedList':
      return `<ol>${inner}</ol>`
    case 'listItem':
      return `<li>${inner}</li>`
    case 'taskList':
      return `<ul class="task-list">${inner}</ul>`
    case 'taskItem': {
      const checked = attrs?.checked ? 'checked' : ''
      return `<li class="task-item"><input type="checkbox" ${checked} disabled />${inner}</li>`
    }
    case 'blockquote':
      return `<blockquote>${inner}</blockquote>`
    case 'codeBlock': {
      const lang = escapeHtml((attrs?.language as string) || '')
      return `<pre><code class="language-${lang}">${inner}</code></pre>`
    }
    case 'horizontalRule':
      return '<hr>'
    case 'hardBreak':
      return '<br>'
    case 'image': {
      const src = attrs?.src as string || ''
      const alt = attrs?.alt as string || ''
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`
    }
    case 'callout': {
      const calloutType = escapeHtml(attrs?.type as string || 'info')
      return `<div class="callout callout-${calloutType}">${inner}</div>`
    }
    case 'table':
      return `<table>${inner}</table>`
    case 'tableRow':
      return `<tr>${inner}</tr>`
    case 'tableCell':
      return `<td>${inner}</td>`
    case 'tableHeader':
      return `<th>${inner}</th>`
    // Special block types - render as placeholder (cannot nest interactive blocks)
    case 'transclusionBlock': {
      const noteName = attrs?.noteName as string || 'Note'
      return `<div class="transclusion-placeholder">[Embedded: ${escapeHtml(noteName)}]</div>`
    }
    case 'embedBlock': {
      const platform = attrs?.platform as string || 'Embed'
      return `<div class="embed-placeholder">[${escapeHtml(platform)}]</div>`
    }
    case 'dataviewBlock':
      return `<div class="dataview-placeholder">[Dataview Query]</div>`
    default:
      // Log unknown node types for debugging
      if (type !== 'doc' && process.env.NODE_ENV === 'development') {
        console.debug('[tiptapToHtml] Unknown node type:', type)
      }
      return inner
  }
}

function wrapMark(html: string, mark: { type: string; attrs?: Record<string, unknown> }): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${html}</strong>`
    case 'italic':
      return `<em>${html}</em>`
    case 'underline':
      return `<u>${html}</u>`
    case 'strike':
      return `<s>${html}</s>`
    case 'code':
      return `<code>${html}</code>`
    case 'highlight':
      return `<mark>${html}</mark>`
    case 'link': {
      const href = mark.attrs?.href as string || ''
      // Filter dangerous protocols
      if (href.toLowerCase().startsWith('javascript:') || href.toLowerCase().startsWith('data:')) {
        return html
      }
      return `<a href="${escapeHtml(href)}">${html}</a>`
    }
    case 'textStyle': {
      const color = mark.attrs?.color as string
      if (color) return `<span style="color:${escapeHtml(color)}">${html}</span>`
      return html
    }
    case 'noteLink': {
      const noteTitle = mark.attrs?.noteTitle as string || ''
      return `<span class="note-link">${html || noteTitle}</span>`
    }
    default:
      return html
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 解析 TipTap JSON 内容
function parseTiptapContent(content: string): TiptapNode | null {
  if (!content) return null
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content
    return parsed as TiptapNode
  } catch {
    return null
  }
}

// 从 TipTap JSON 中提取指定章节
function extractHeadingSectionFromJson(doc: TiptapNode, headingText: string): TiptapNode[] | null {
  if (!doc.content) return null

  const normalizedSearch = headingText.trim().toLowerCase()
  let startIndex = -1
  let startLevel = 0

  // 查找匹配的标题
  for (let i = 0; i < doc.content.length; i++) {
    const node = doc.content[i]
    if (node.type === 'heading') {
      const text = getTextFromNode(node).trim()
      const textLower = text.toLowerCase()

      // 1. 精确匹配
      if (text === headingText) {
        startIndex = i
        startLevel = (node.attrs?.level as number) || 1
        break
      }
      // 2. 忽略大小写匹配
      if (textLower === normalizedSearch) {
        startIndex = i
        startLevel = (node.attrs?.level as number) || 1
        break
      }
      // 3. 模糊匹配
      if (textLower.startsWith(normalizedSearch) || textLower.includes(normalizedSearch)) {
        startIndex = i
        startLevel = (node.attrs?.level as number) || 1
        break
      }
    }
  }

  if (startIndex === -1) return null

  // 收集从该标题到下一个同级或更高级标题之间的所有内容
  const result: TiptapNode[] = [doc.content[startIndex]]

  for (let i = startIndex + 1; i < doc.content.length; i++) {
    const node = doc.content[i]
    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) || 1
      if (level <= startLevel) break
    }
    result.push(node)
  }

  return result
}

// 从 TipTap JSON 中提取指定 block
function extractBlockFromJson(doc: TiptapNode, blockId: string): TiptapNode | null {
  if (!doc.content) return null

  // 递归查找
  function findBlock(nodes: TiptapNode[]): TiptapNode | null {
    for (const node of nodes) {
      if (node.attrs?.blockId === blockId) {
        return node
      }
      if (node.content) {
        const found = findBlock(node.content)
        if (found) return found
      }
    }
    return null
  }

  return findBlock(doc.content)
}

// 计算内容统计
function getContentStats(html: string): { paragraphs: number; chars: number } {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const paragraphs = doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6').length
  const chars = doc.body.textContent?.length || 0
  return { paragraphs, chars }
}

export function TransclusionView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as TransclusionAttrs
  const { noteId, noteName, targetType, targetValue, collapsed, maxHeight } = attrs

  const t = useTranslations()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [sourceNote, setSourceNote] = useState<Note | null>(null)
  const [resizeHeight, setResizeHeight] = useState(maxHeight)
  const [isResizing, setIsResizing] = useState(false)

  // 加载源笔记内容
  const loadContent = useCallback(async () => {
    if (!noteId) {
      setError(t.transclusion?.noNoteId || 'No note ID specified')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const note = await window.electron.note.getById(noteId)

      if (!note) {
        setError(t.transclusion?.noteNotFound || 'Note not found or deleted')
        setSourceNote(null)
        setContent('')
        setLoading(false)
        return
      }

      setSourceNote(note as Note)

      // 解析 TipTap JSON 内容
      const doc = parseTiptapContent(note.content || '')
      if (!doc) {
        setContent('')
        setLoading(false)
        return
      }

      let htmlContent = ''

      // 根据目标类型提取内容
      if (targetType === 'heading' && targetValue) {
        const sectionNodes = extractHeadingSectionFromJson(doc, targetValue)
        if (sectionNodes) {
          htmlContent = tiptapToHtml(sectionNodes)
        } else {
          setError(t.transclusion?.headingNotFound || `Heading "${targetValue}" not found`)
        }
      } else if (targetType === 'block' && targetValue) {
        const blockNode = extractBlockFromJson(doc, targetValue)
        if (blockNode) {
          htmlContent = tiptapToHtml([blockNode])
        } else {
          setError(t.transclusion?.blockNotFound || `Block "${targetValue}" not found`)
        }
      } else {
        // 整个笔记
        htmlContent = tiptapToHtml(doc.content || [])
      }

      setContent(htmlContent)
    } catch (err) {
      console.error('[Transclusion] Failed to load note:', err)
      setError(t.transclusion?.loadError || 'Failed to load note content')
    } finally {
      setLoading(false)
    }
  }, [noteId, targetType, targetValue, t])

  // 初始加载
  useEffect(() => {
    loadContent()
  }, [loadContent])

  // Debounced load for data change events
  const debouncedLoadContent = useMemo(
    () => debounce(loadContent, 500),
    [loadContent]
  )

  // 监听笔记变更事件
  useEffect(() => {
    const cleanup = window.electron.note.onDataChanged(() => {
      // 重新加载内容 (debounced to prevent excessive refreshes)
      debouncedLoadContent()
    })
    return () => {
      cleanup()
      debouncedLoadContent.cancel()
    }
  }, [debouncedLoadContent])

  // 同步 maxHeight 属性变化到本地状态
  useEffect(() => {
    setResizeHeight(maxHeight)
  }, [maxHeight])

  // 拖拽调整高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)

    const startY = e.clientY
    const startHeight = resizeHeight
    let currentHeight = startHeight

    // 禁用文本选择
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault()
      const delta = moveEvent.clientY - startY
      // 限制范围: 100-800px，取整
      const maxAllowed = Math.min(800, window.innerHeight * 0.8)
      currentHeight = Math.round(Math.max(100, Math.min(maxAllowed, startHeight + delta)))
      setResizeHeight(currentHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      // 恢复文本选择
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      updateAttributes({ maxHeight: currentHeight })
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [resizeHeight, updateAttributes])

  // 切换折叠状态
  const toggleCollapsed = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    updateAttributes({ collapsed: !collapsed })
  }

  // 刷新内容
  const handleRefresh = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    loadContent()
  }

  // 生成显示标题
  const displayTitle = (() => {
    let title = noteName || sourceNote?.title || t.transclusion?.unknownNote || 'Unknown Note'
    if (targetType === 'heading' && targetValue) {
      title += `#${targetValue}`
    } else if (targetType === 'block' && targetValue) {
      title += `^${targetValue}`
    }
    return title
  })()

  // 内容统计
  const stats = content ? getContentStats(content) : { paragraphs: 0, chars: 0 }

  // 编辑链接 - 触发重新选择
  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 派发事件，让 Editor.tsx 打开选择弹窗
    window.dispatchEvent(new CustomEvent('transclusion:edit', {
      detail: { updateAttributes }
    }))
  }

  // 在新标签页打开笔记
  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!noteId) return
    // 派发事件，在新标签页打开笔记
    window.dispatchEvent(new CustomEvent('note:open-in-new-tab', {
      detail: {
        noteId,
        targetType,
        targetValue
      }
    }))
  }

  return (
    <NodeViewWrapper className={`transclusion-block-wrapper ${selected ? 'selected' : ''}`} data-drag-handle>
      <div className={`transclusion-block ${collapsed ? 'collapsed' : ''} ${error ? 'has-error' : ''}`}>
        {/* 头部 */}
        <div
          className="transclusion-header"
          onClick={toggleCollapsed}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleCollapsed()
            }
          }}
        >
          <div className="transclusion-header-left">
            {collapsed ? (
              <ChevronRight className="transclusion-icon" size={14} />
            ) : (
              <ChevronDown className="transclusion-icon" size={14} />
            )}
            <span className="transclusion-title" title={displayTitle}>
              {displayTitle}
            </span>
            {collapsed && (
              <span className="transclusion-stats">
                ({stats.paragraphs} {t.transclusion?.paragraphs || 'blocks'})
              </span>
            )}
          </div>
          <div className="transclusion-header-right">
            <button
              className="transclusion-action"
              onClick={handleRefresh}
              title={t.transclusion?.refresh || 'Refresh'}
            >
              <RefreshCw size={12} />
            </button>
            <button
              className="transclusion-action"
              onClick={handleEdit}
              title={t.transclusion?.editLink || 'Edit'}
            >
              <Pencil size={12} />
            </button>
            <button
              className="transclusion-action"
              onClick={handleOpen}
              title="Open in new tab"
            >
              <FileSymlink size={12} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        {!collapsed && (
          <div className="transclusion-content-wrapper">
            {loading ? (
              <div className="transclusion-loading">
                <div className="transclusion-spinner" />
                <span>{t.transclusion?.loading || 'Loading...'}</span>
              </div>
            ) : error ? (
              <div className="transclusion-error">
                <AlertTriangle size={20} />
                <span>{error}</span>
                <div className="transclusion-error-actions">
                  <button onClick={handleRefresh}>
                    {t.transclusion?.retry || 'Retry'}
                  </button>
                  <button onClick={handleEdit}>
                    {t.transclusion?.editLink || 'Edit'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="transclusion-content ProseMirror"
                  style={{ maxHeight: `${resizeHeight}px` }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
                />
                <div
                  className="transclusion-resize-handle"
                  onMouseDown={handleResizeStart}
                >
                  <div className="transclusion-resize-bar" />
                  {isResizing && <span className="transclusion-resize-value">{resizeHeight}px</span>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
