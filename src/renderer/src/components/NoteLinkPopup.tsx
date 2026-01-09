import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Note, Notebook } from '../types/note'
import { useTranslations } from '../i18n'
import { Search, ChevronLeft } from 'lucide-react'

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
  onCreate?: (title: string) => void // 可选，transclusion 模式不需要
  onClose: () => void
  // 新增：搜索模式相关
  searchMode: SearchMode
  selectedNote?: Note | null // 当模式为 heading/block 时，当前选中的笔记
  headings?: HeadingInfo[] // 当前笔记的标题列表
  blocks?: BlockInfo[] // 当前笔记的 block 列表
  onSelectNote?: (note: Note) => void // 选中笔记后进入标题/block 搜索
  isTransclusionMode?: boolean // 是否为 transclusion 模式（不显示创建新笔记选项）
  // 新增：笔记本信息和搜索
  notebooks?: Notebook[] // 笔记本列表，用于显示笔记所属笔记本
  onQueryChange?: (query: string) => void // 搜索回调
  onBack?: () => void // 返回上一级（从 heading/block 模式回到 note 模式）
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
  isTransclusionMode = false,
  notebooks = [],
  onQueryChange,
  onBack,
}: NoteLinkPopupProps) {
  const t = useTranslations()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandUp, setExpandUp] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // 根据 notebook_id 获取笔记本名称
  const getNotebookName = useCallback((notebookId: string | null): string | null => {
    if (!notebookId || notebooks.length === 0) return null
    const notebook = notebooks.find(nb => nb.id === notebookId)
    return notebook?.name || null
  }, [notebooks])

  // 根据搜索模式过滤内容
  const filteredItems = useMemo(() => {
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

  // 检查是否显示"创建新笔记"选项（仅笔记模式，且非 transclusion 模式）
  const showCreate = !isTransclusionMode && searchMode === 'note' && query.length > 0 && !notes.some(
    note => note.title.toLowerCase() === query.toLowerCase()
  ) && onCreate !== undefined

  // 检查是否显示"全文"选项（heading/block 模式下）
  const showFullNote = (searchMode === 'heading' || searchMode === 'block') && selectedNote

  const totalItems = filteredItems.length + (showCreate ? 1 : 0) + (showFullNote ? 1 : 0)

  // Reset selection when query or mode changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, searchMode])

  // Auto-focus search input when popup opens
  useEffect(() => {
    if (onQueryChange && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [onQueryChange])

  // 计算展开方向
  useEffect(() => {
    if (!popupRef.current) return
    const popup = popupRef.current
    const rect = popup.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - position.top
    const spaceAbove = position.top

    // 如果下方空间不够且上方空间更大，则向上展开
    if (rect.height > spaceBelow && spaceAbove > spaceBelow) {
      setExpandUp(true)
    } else {
      setExpandUp(false)
    }
  }, [position.top, totalItems])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // 如果搜索输入框获得焦点，只处理特定按键
      const isInputFocused = document.activeElement === searchInputRef.current

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopImmediatePropagation()
          if (totalItems > 0) {
            setSelectedIndex(prev => (prev + 1) % totalItems)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopImmediatePropagation()
          if (totalItems > 0) {
            setSelectedIndex(prev => (prev - 1 + totalItems) % totalItems)
          }
          break
        case 'Enter':
          e.preventDefault()
          e.stopImmediatePropagation()
          // 计算实际的 item 索引（考虑全文选项）
          const itemIndex = showFullNote ? selectedIndex - 1 : selectedIndex

          // 选择全文选项
          if (showFullNote && selectedIndex === 0) {
            if (selectedNote) {
              onSelect(selectedNote) // 不传 target，表示全文
            }
          } else if (itemIndex >= 0 && itemIndex < filteredItems.length) {
            const item = filteredItems[itemIndex]
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
          } else if (showCreate && onCreate) {
            onCreate(query)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopImmediatePropagation()
          onClose()
          break
        case 'Backspace':
          // 如果搜索输入框获得焦点，不拦截 Backspace
          if (isInputFocused) break
          // 如果在标题/block 模式且 query 为空，返回笔记模式
          if ((searchMode === 'heading' || searchMode === 'block') && query === '') {
            e.preventDefault()
            onClose()
          }
          break
      }
    },
    [selectedIndex, filteredItems, showCreate, showFullNote, query, onSelect, onCreate, onClose, searchMode, selectedNote, onSelectNote, totalItems]
  )

  useEffect(() => {
    // 使用 capture 阶段确保优先于编辑器处理
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
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
      return (t.noteLink?.searchHeadingHint || 'Search headings in "{name}"').replace('{name}', selectedNote?.title || '')
    } else if (searchMode === 'block') {
      return (t.noteLink?.searchBlockHint || 'Search blocks in "{name}"').replace('{name}', selectedNote?.title || '')
    }
    return null
  }

  const modeHint = getModeHint()

  // transclusion 模式下总是显示弹窗（有搜索框）
  if (totalItems === 0 && !modeHint && !isTransclusionMode) {
    return null
  }

  // 渲染列表项
  const renderItem = (item: Note | HeadingInfo | BlockInfo, index: number) => {
    const isSelected = index === selectedIndex

    if (searchMode === 'note') {
      const note = item as Note
      const notebookName = getNotebookName(note.notebook_id)
      return (
        <div
          key={note.id}
          className={`note-link-popup-item ${isSelected ? 'selected' : ''}`}
          onClick={() => onSelectNote ? onSelectNote(note) : onSelect(note)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <div className="note-link-popup-note-info">
            <span className="note-link-popup-title">{note.title || t.noteList.untitled}</span>
            {notebookName && (
              <span className="note-link-popup-notebook">{notebookName}</span>
            )}
          </div>
        </div>
      )
    } else if (searchMode === 'heading') {
      const heading = item as HeadingInfo
      // 计算缩进级别：H1=0, H2=1, H3=2, etc.
      const indentLevel = Math.max(0, heading.level - 1)
      return (
        <div
          key={`heading-${heading.pos}`}
          className={`note-link-popup-item ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${12 + indentLevel * 16}px` }}
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
          <span className={`note-link-popup-icon note-link-popup-icon-heading level-${heading.level}`}>
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
      ref={popupRef}
      className={`note-link-popup ${isTransclusionMode ? 'transclusion-mode' : ''} ${expandUp ? 'expand-up' : ''}`}
      style={{
        position: 'fixed',
        top: expandUp ? 'auto' : position.top,
        // 向上展开时，底部要在光标上方，留出一行高度（约24px）
        bottom: expandUp ? `${window.innerHeight - position.top + 24}px` : 'auto',
        left: position.left,
        zIndex: 1000,
      }}
    >
      {/* 搜索框 */}
      {onQueryChange && (
        <div className="note-link-popup-search">
          {/* 返回按钮 - 仅在 heading/block 模式下显示 */}
          {(searchMode === 'heading' || searchMode === 'block') && onBack && (
            <button
              className="note-link-popup-back"
              onClick={onBack}
              title={t.common?.back || 'Back'}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <Search size={14} className="note-link-popup-search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="note-link-popup-search-input"
            placeholder={
              searchMode === 'heading'
                ? (t.noteLink?.searchHeadingPlaceholder || 'Search headings...')
                : searchMode === 'block'
                  ? (t.noteLink?.searchBlockPlaceholder || 'Search blocks...')
                  : (t.noteLink?.searchPlaceholder || 'Search notes...')
            }
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              // IME 输入法组合状态时不响应
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape') {
                // 这些键由 document 的 keydown 处理
                return
              }
            }}
            autoFocus
          />
        </div>
      )}
      <div ref={listRef} className="note-link-popup-list">
        {/* 全文选项 - heading/block 模式下显示在最前面 */}
        {showFullNote && selectedNote && (
          <div
            className={`note-link-popup-item full-note ${selectedIndex === 0 ? 'selected' : ''}`}
            onClick={() => onSelect(selectedNote)}
            onMouseEnter={() => setSelectedIndex(0)}
          >
            <span className="note-link-popup-title">
              {t.noteLink?.fullNote || 'Full note'}: {selectedNote.title || t.noteList?.untitled}
            </span>
          </div>
        )}
        {filteredItems.map((item, index) => {
          // 如果有全文选项，实际索引要 +1
          const actualIndex = showFullNote ? index + 1 : index
          return renderItem(item, actualIndex)
        })}
        {showCreate && onCreate && (
          <div
            className={`note-link-popup-item create ${
              selectedIndex === (showFullNote ? filteredItems.length + 1 : filteredItems.length) ? 'selected' : ''
            }`}
            onClick={() => onCreate(query)}
            onMouseEnter={() => setSelectedIndex(showFullNote ? filteredItems.length + 1 : filteredItems.length)}
          >
            <span className="note-link-popup-icon">+</span>
            <span className="note-link-popup-title">{(t.noteLink?.create || 'Create "{name}"').replace('{name}', query)}</span>
          </div>
        )}
        {totalItems === 0 && (modeHint || isTransclusionMode) && (
          <div className="note-link-popup-empty">
            {t.noteLink?.noResults || 'No matches found'}
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
