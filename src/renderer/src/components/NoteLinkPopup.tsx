import { useState, useEffect, useRef, useCallback } from 'react'
import type { Note } from '../types/note'

// 搜索模式
export type SearchMode = 'note' | 'heading' | 'block'

// 标题信息
export interface HeadingInfo {
  level: number
  text: string
  pos: number
  blockId?: string
}

// Block 信息
export interface BlockInfo {
  id: string
  type: string
  text: string
  pos: number
}

interface NoteLinkPopupProps {
  notes: Note[]
  query: string
  position: { top: number; left: number }
  onSelect: (note: Note, target?: { type: 'heading' | 'block'; value: string; displayText: string }) => void
  onCreate: (title: string) => void
  onClose: () => void
  // 新增：搜索模式相关
  searchMode: SearchMode
  selectedNote?: Note | null // 当模式为 heading/block 时，当前选中的笔记
  headings?: HeadingInfo[] // 当前笔记的标题列表
  blocks?: BlockInfo[] // 当前笔记的 block 列表
  onSelectNote?: (note: Note) => void // 选中笔记后进入标题/block 搜索
}

export function NoteLinkPopup({
  notes,
  query,
  position,
  onSelect,
  onCreate,
  onClose,
  searchMode,
  selectedNote,
  headings = [],
  blocks = [],
  onSelectNote,
}: NoteLinkPopupProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // 根据搜索模式过滤内容
  const getFilteredItems = useCallback(() => {
    if (searchMode === 'note') {
      // 笔记模式：搜索笔记标题
      return notes.filter(note =>
        note.title.toLowerCase().includes(query.toLowerCase())
      )
    } else if (searchMode === 'heading') {
      // 标题模式：搜索标题
      return headings.filter(heading =>
        heading.text.toLowerCase().includes(query.toLowerCase())
      )
    } else {
      // Block 模式：搜索 block 内容
      return blocks.filter(block =>
        block.text.toLowerCase().includes(query.toLowerCase())
      )
    }
  }, [searchMode, notes, headings, blocks, query])

  const filteredItems = getFilteredItems()

  // 检查是否显示"创建新笔记"选项（仅笔记模式）
  const showCreate = searchMode === 'note' && query.length > 0 && !notes.some(
    note => note.title.toLowerCase() === query.toLowerCase()
  )

  const totalItems = filteredItems.length + (showCreate ? 1 : 0)

  // Reset selection when query or mode changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, searchMode])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev + 1) % Math.max(totalItems, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1))
          break
        case 'Enter':
          e.preventDefault()
          if (selectedIndex < filteredItems.length) {
            const item = filteredItems[selectedIndex]
            if (searchMode === 'note') {
              const note = item as Note
              // 检查 query 是否包含 # 或 ^，如果是则进入子模式
              if (onSelectNote) {
                onSelectNote(note)
              } else {
                onSelect(note)
              }
            } else if (searchMode === 'heading') {
              const heading = item as HeadingInfo
              if (selectedNote) {
                onSelect(selectedNote, {
                  type: 'heading',
                  value: heading.text,
                  displayText: `${selectedNote.title}#${heading.text}`,
                })
              }
            } else {
              const block = item as BlockInfo
              if (selectedNote) {
                onSelect(selectedNote, {
                  type: 'block',
                  value: block.id,
                  displayText: `${selectedNote.title}#^${block.id}`,
                })
              }
            }
          } else if (showCreate) {
            onCreate(query)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'Backspace':
          // 如果在标题/block 模式且 query 为空，返回笔记模式
          if ((searchMode === 'heading' || searchMode === 'block') && query === '') {
            e.preventDefault()
            onClose()
          }
          break
      }
    },
    [selectedIndex, filteredItems, showCreate, query, onSelect, onCreate, onClose, searchMode, selectedNote, onSelectNote, totalItems]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[selectedIndex] as HTMLElement
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // 获取模式提示文本
  const getModeHint = () => {
    if (searchMode === 'heading') {
      return `在 "${selectedNote?.title}" 中搜索标题`
    } else if (searchMode === 'block') {
      return `在 "${selectedNote?.title}" 中搜索段落`
    }
    return null
  }

  const modeHint = getModeHint()

  if (totalItems === 0 && !modeHint) {
    return null
  }

  // 渲染列表项
  const renderItem = (item: Note | HeadingInfo | BlockInfo, index: number) => {
    const isSelected = index === selectedIndex

    if (searchMode === 'note') {
      const note = item as Note
      return (
        <div
          key={note.id}
          className={`note-link-popup-item ${isSelected ? 'selected' : ''}`}
          onClick={() => onSelectNote ? onSelectNote(note) : onSelect(note)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="note-link-popup-icon">📄</span>
          <span className="note-link-popup-title">{note.title || '无标题'}</span>
        </div>
      )
    } else if (searchMode === 'heading') {
      const heading = item as HeadingInfo
      return (
        <div
          key={`heading-${heading.pos}`}
          className={`note-link-popup-item ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            if (selectedNote) {
              onSelect(selectedNote, {
                type: 'heading',
                value: heading.text,
                displayText: `${selectedNote.title}#${heading.text}`,
              })
            }
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="note-link-popup-icon note-link-popup-icon-heading">
            H{heading.level}
          </span>
          <span className="note-link-popup-title">{heading.text}</span>
        </div>
      )
    } else {
      const block = item as BlockInfo
      return (
        <div
          key={`block-${block.pos}`}
          className={`note-link-popup-item ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            if (selectedNote) {
              onSelect(selectedNote, {
                type: 'block',
                value: block.id,
                displayText: `${selectedNote.title}#^${block.id}`,
              })
            }
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="note-link-popup-icon note-link-popup-icon-block">
            {getBlockIcon(block.type)}
          </span>
          <span className="note-link-popup-title">{block.text || `(${block.type})`}</span>
        </div>
      )
    }
  }

  return (
    <div
      className="note-link-popup"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 1000,
      }}
    >
      {modeHint && (
        <div className="note-link-popup-hint">
          {modeHint}
        </div>
      )}
      <div ref={listRef} className="note-link-popup-list">
        {filteredItems.map((item, index) => renderItem(item, index))}
        {showCreate && (
          <div
            className={`note-link-popup-item create ${
              selectedIndex === filteredItems.length ? 'selected' : ''
            }`}
            onClick={() => onCreate(query)}
            onMouseEnter={() => setSelectedIndex(filteredItems.length)}
          >
            <span className="note-link-popup-icon">+</span>
            <span className="note-link-popup-title">创建 "{query}"</span>
          </div>
        )}
        {totalItems === 0 && modeHint && (
          <div className="note-link-popup-empty">
            没有找到匹配项
          </div>
        )}
      </div>
    </div>
  )
}

// 获取 block 类型图标
function getBlockIcon(type: string): string {
  switch (type) {
    case 'heading':
      return 'H'
    case 'paragraph':
      return '¶'
    case 'bulletList':
      return '•'
    case 'orderedList':
      return '1.'
    case 'taskList':
      return '☑'
    case 'blockquote':
      return '"'
    case 'codeBlock':
      return '</>'
    case 'table':
      return '⊞'
    case 'horizontalRule':
      return '—'
    default:
      return '▪'
  }
}
