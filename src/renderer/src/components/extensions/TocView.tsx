import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useTranslations } from '../../i18n'
import type { Transaction } from '@tiptap/pm/state'

interface TocItem {
  id: string       // blockId 或生成的稳定 id
  blockId: string | null  // 原始 blockId，用于跳转查找
  level: number
  text: string
}

export function TocView({ editor, node, updateAttributes, selected }: NodeViewProps) {
  const t = useTranslations()
  const [items, setItems] = useState<TocItem[]>([])
  const collapsed = node.attrs.collapsed as boolean

  // 缓存上次的 heading hash，避免不必要的 re-render
  const lastHashRef = useRef<string>('')
  // 防抖定时器
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 提取标题并生成 hash
  const extractHeadings = useCallback((): { items: TocItem[]; hash: string } => {
    if (!editor) return { items: [], hash: '' }

    const headings: TocItem[] = []
    let hash = ''
    let index = 0
    const { doc } = editor.state

    doc.descendants((node) => {
      if (node.type.name === 'heading' && node.attrs.level <= 3) {
        const blockId = node.attrs.blockId || null
        const text = node.textContent
        // 用 blockId 或稳定的索引作为 key，避免 pos 变化导致 key 不稳定
        const id = blockId || `toc-heading-${index}`
        headings.push({ id, blockId, level: node.attrs.level, text })
        // hash 用于检测变化：level + 内容前20字符
        hash += `${node.attrs.level}:${text.slice(0, 20)}|`
        index++
      }
    })

    return { items: headings, hash }
  }, [editor])

  // 执行更新（带缓存检查）
  const doUpdate = useCallback(() => {
    const { items: newItems, hash } = extractHeadings()
    if (hash !== lastHashRef.current) {
      lastHashRef.current = hash
      setItems(newItems)
    }
  }, [extractHeadings])

  // 防抖更新：每次调用重置计时器
  const scheduleUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(doUpdate, 500)
  }, [doUpdate])

  // 监听编辑器变化
  useEffect(() => {
    if (!editor) return

    // 初始加载
    doUpdate()

    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return
      scheduleUpdate()
    }

    editor.on('transaction', handleTransaction)

    return () => {
      editor.off('transaction', handleTransaction)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [editor, doUpdate, scheduleUpdate])

  // 点击跳转到标题（实时查找位置，避免缓存失效）
  const handleClick = (item: TocItem) => {
    if (!editor) return

    let targetPos: number | null = null
    let matchIndex = 0
    let found = false

    editor.state.doc.descendants((node, pos) => {
      // 已找到则跳过后续遍历
      if (found) return false

      if (node.type.name === 'heading' && node.attrs.level <= 3) {
        // 优先用 blockId 匹配
        if (item.blockId && node.attrs.blockId === item.blockId) {
          targetPos = pos
          found = true
          return false
        }
        // 无 blockId 时用索引匹配
        if (!item.blockId && item.id === `toc-heading-${matchIndex}`) {
          targetPos = pos
          found = true
          return false
        }
        matchIndex++
      }
    })

    if (targetPos !== null) {
      const pos = targetPos
      // 设置光标位置
      editor.chain().focus().setTextSelection(pos + 1).run()

      // 滚动到视口中央（使用 DOM API）
      requestAnimationFrame(() => {
        const { node } = editor.view.domAtPos(pos + 1)
        const element = node instanceof Element ? node : node.parentElement
        // 向上查找最近的 heading 元素，确保滚动到正确位置
        const heading = element?.closest('h1, h2, h3')
        ;(heading || element)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }

  // 阻止点击时编辑器失焦
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  // 切换折叠状态
  const toggleCollapsed = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    updateAttributes({ collapsed: !collapsed })
  }

  return (
    <NodeViewWrapper
      className={`toc-block-wrapper ${selected ? 'selected' : ''}`}
      data-drag-handle
      role="navigation"
      aria-label={t.editor?.toc || 'Table of Contents'}
    >
      <div className={`toc-block ${collapsed ? 'collapsed' : ''}`} onMouseDown={handleMouseDown}>
        {/* 头部 */}
        <div
          className="toc-header"
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
          {collapsed ? (
            <ChevronRight className="toc-icon" size={14} />
          ) : (
            <ChevronDown className="toc-icon" size={14} />
          )}
          <span className="toc-title">{t.editor?.toc || 'Table of Contents'}</span>
          {collapsed && items.length > 0 && (
            <span className="toc-stats">({items.length})</span>
          )}
        </div>

        {/* 内容区 */}
        {!collapsed && (
          <div className="toc-content">
            {items.length === 0 ? (
              <div className="toc-empty">
                {t.editor?.tocEmpty || 'No headings found'}
              </div>
            ) : (
              <div className="toc-items">
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`toc-item toc-level-${item.level}`}
                    onClick={() => handleClick(item)}
                  >
                    {item.text || t.media?.emptyHeading || '(empty heading)'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}
