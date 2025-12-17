import { useEffect, useCallback, useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CharacterCount from '@tiptap/extension-character-count'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import Image from '@tiptap/extension-image'
import { textblockTypeInputRule } from '@tiptap/core'
import type { Note } from '../types/note'
import { useTranslations } from '../i18n'
import { useTheme } from '../theme'
import { NoteLink } from './extensions/NoteLink'
import { BlockId, generateBlockId } from './extensions/BlockId'
import { NoteLinkPopup, type SearchMode, type HeadingInfo, type BlockInfo } from './NoteLinkPopup'
import { getCursorInfo, type CursorInfo } from '../utils/cursor'
import './Editor.css'

// SVG Icons for toolbar
const ToolbarIcons = {
  bold: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  ),
  italic: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  ),
  strikethrough: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  ),
  heading: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M17 10v8" />
      <path d="M21 10v8" />
      <path d="M17 14h4" />
    </svg>
  ),
  list: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  bulletList: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  orderedList: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  ),
  taskList: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  ),
  block: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  quote: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
    </svg>
  ),
  code: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  typewriter: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="12" rx="2" />
      <path d="M6 20h12" />
      <path d="M12 16v4" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  ),
  focus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
    </svg>
  ),
  chevronUp: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
}

// Custom heading extension - input rules without auto-newline
const CustomHeading = Heading.extend({
  addInputRules() {
    return [1, 2, 3, 4].map(level => {
      return textblockTypeInputRule({
        find: new RegExp(`^(#{${level}})\\s$`),
        type: this.type,
        getAttributes: { level },
      })
    })
  },
})

// 重新导出 CursorInfo 供外部使用
export type { CursorInfo } from '../utils/cursor'

interface EditorProps {
  note: Note | null
  notes: Note[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: () => void
  onTypewriterModeToggle?: (cursorInfo: CursorInfo) => void
}

// 暴露给外部的 Editor 实例接口
export interface EditorHandle {
  getEditor: () => ReturnType<typeof useEditor> | null
}

// Zen Editor component
interface ZenEditorProps {
  note: Note
  notes: Note[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: () => void
  onTypewriterModeToggle?: (cursorInfo: CursorInfo) => void
}

const ZenEditor = forwardRef<EditorHandle, ZenEditorProps>(function ZenEditor({
  note,
  notes,
  onUpdate,
  onNoteClick,
  onCreateNote,
  scrollTarget,
  onScrollComplete,
  onTypewriterModeToggle,
}, ref) {
  const [title, setTitle] = useState(note.title)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isTypewriterMode, setIsTypewriterMode] = useState(false)
  const [showToolbar, setShowToolbar] = useState(false)

  // Note link popup state
  const [showLinkPopup, setShowLinkPopup] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkPopupPosition, setLinkPopupPosition] = useState({ top: 0, left: 0 })
  const [linkStartPos, setLinkStartPos] = useState<number | null>(null)

  // 新增：搜索模式相关状态
  const [searchMode, setSearchMode] = useState<SearchMode>('note')
  const [selectedLinkNote, setSelectedLinkNote] = useState<Note | null>(null)
  const [targetHeadings, setTargetHeadings] = useState<HeadingInfo[]>([])
  const [targetBlocks, setTargetBlocks] = useState<BlockInfo[]>([])

  const t = useTranslations()
  const { resolvedColorMode } = useTheme()
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  // Parse initial content
  const getInitialContent = () => {
    if (!note.content || note.content === '[]' || note.content === '') {
      return ''
    }
    try {
      // Try to parse as Tiptap JSON
      const parsed = JSON.parse(note.content)
      if (parsed.type === 'doc') {
        return parsed
      }
      // If it's BlockNote format, start fresh
      return ''
    } catch {
      // If it's plain text, use it
      return note.content
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // Disable default heading, use custom
      }),
      CustomHeading.configure({
        levels: [1, 2, 3, 4],
      }),
      Placeholder.configure({
        placeholder: t.editor.contentPlaceholder || 'Start writing...',
        emptyEditorClass: 'is-editor-empty',
      }),
      Typography,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'zen-link',
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CharacterCount,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      BlockId,
      NoteLink.configure({
        onNoteClick: (noteId: string, _noteTitle: string, target?: { type: 'heading' | 'block'; value: string }) => {
          onNoteClick(noteId, target)
        },
      }),
    ],
    content: getInitialContent(),
    editorProps: {
      attributes: {
        class: `zen-editor ${isFocusMode ? 'focus-mode' : ''}`,
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      onUpdate(note.id, { content: JSON.stringify(json) })

      // Check for [[ trigger
      const { state } = editor
      const { from } = state.selection
      const textBefore = state.doc.textBetween(Math.max(0, from - 100), from, '')

      // Look for [[ that's not closed
      const lastOpenBracket = textBefore.lastIndexOf('[[')
      const lastCloseBracket = textBefore.lastIndexOf(']]')

      if (lastOpenBracket > lastCloseBracket) {
        // We're inside [[ ]]
        const query = textBefore.slice(lastOpenBracket + 2)

        // 检测搜索模式
        // [[笔记名#标题]] - 标题模式
        // [[笔记名^]] 或 [[笔记名#^blockid]] - block 模式
        const hashIndex = query.indexOf('#')
        const caretIndex = query.indexOf('^')

        if (hashIndex !== -1 && caretIndex !== -1 && caretIndex > hashIndex) {
          // [[笔记名#^...]] - block 模式
          const noteName = query.slice(0, hashIndex)
          const blockQuery = query.slice(caretIndex + 1)
          handleBlockSearch(noteName, blockQuery, from, lastOpenBracket, query)
        } else if (caretIndex !== -1) {
          // [[笔记名^...]] - block 模式
          const noteName = query.slice(0, caretIndex)
          const blockQuery = query.slice(caretIndex + 1)
          handleBlockSearch(noteName, blockQuery, from, lastOpenBracket, query)
        } else if (hashIndex !== -1) {
          // [[笔记名#...]] - 标题模式
          const noteName = query.slice(0, hashIndex)
          const headingQuery = query.slice(hashIndex + 1)
          handleHeadingSearch(noteName, headingQuery, from, lastOpenBracket, query)
        } else {
          // 普通笔记搜索模式
          setSearchMode('note')
          setSelectedLinkNote(null)
          setLinkQuery(query)
          setLinkStartPos(from - query.length - 2)
        }

        // Get cursor position for popup
        const coords = editor.view.coordsAtPos(from)
        setLinkPopupPosition({
          top: coords.bottom + 8,
          left: coords.left,
        })
        setShowLinkPopup(true)
      } else {
        setShowLinkPopup(false)
        setLinkQuery('')
        setLinkStartPos(null)
        setSearchMode('note')
        setSelectedLinkNote(null)
      }
    },
  })

  // 暴露 editor 实例给外部
  useImperativeHandle(ref, () => ({
    getEditor: () => editor,
  }), [editor])

  // 处理标题搜索
  const handleHeadingSearch = useCallback(async (
    noteName: string,
    headingQuery: string,
    from: number,
    _lastOpenBracket: number,
    fullQuery: string
  ) => {
    // 查找匹配的笔记
    const matchedNote = notes.find(n =>
      n.title.toLowerCase() === noteName.toLowerCase() ||
      n.title.toLowerCase().includes(noteName.toLowerCase())
    )

    if (matchedNote) {
      setSearchMode('heading')
      setSelectedLinkNote(matchedNote)
      setLinkQuery(headingQuery)
      setLinkStartPos(from - fullQuery.length - 2)

      // 获取目标笔记的标题列表
      try {
        const content = matchedNote.content
        if (content) {
          const parsed = JSON.parse(content)
          const headings = extractHeadingsFromJSON(parsed)
          setTargetHeadings(headings)
        }
      } catch {
        setTargetHeadings([])
      }
    } else {
      // 没找到笔记，保持笔记搜索模式
      setSearchMode('note')
      setSelectedLinkNote(null)
      setLinkQuery(noteName)
      setLinkStartPos(from - fullQuery.length - 2)
    }
  }, [notes])

  // 处理 block 搜索
  const handleBlockSearch = useCallback(async (
    noteName: string,
    blockQuery: string,
    from: number,
    _lastOpenBracket: number,
    fullQuery: string
  ) => {
    // 查找匹配的笔记
    const matchedNote = notes.find(n =>
      n.title.toLowerCase() === noteName.toLowerCase() ||
      n.title.toLowerCase().includes(noteName.toLowerCase())
    )

    if (matchedNote) {
      setSearchMode('block')
      setSelectedLinkNote(matchedNote)
      setLinkQuery(blockQuery)
      setLinkStartPos(from - fullQuery.length - 2)

      // 获取目标笔记的 block 列表
      try {
        const content = matchedNote.content
        if (content) {
          const parsed = JSON.parse(content)
          const blocks = extractBlocksFromJSON(parsed)
          setTargetBlocks(blocks)
        }
      } catch {
        setTargetBlocks([])
      }
    } else {
      // 没找到笔记，保持笔记搜索模式
      setSearchMode('note')
      setSelectedLinkNote(null)
      setLinkQuery(noteName)
      setLinkStartPos(from - fullQuery.length - 2)
    }
  }, [notes])

  // Sync title when note changes
  useEffect(() => {
    setTitle(note.title)
  }, [note.id, note.title])

  // Auto-resize title textarea
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto'
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
    }
  }, [title])

  // Handle title change
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newTitle = e.target.value
    setTitle(newTitle)
    onUpdate(note.id, { title: newTitle })
  }, [note.id, onUpdate])

  // Handle title keydown - move to editor on Enter
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      editor?.commands.focus('start')
    }
  }, [editor])

  // Handle note link selection (支持标题和 block)
  const handleSelectNoteLink = useCallback((
    selectedNote: Note,
    target?: { type: 'heading' | 'block'; value: string; displayText: string }
  ) => {
    if (!editor || linkStartPos === null) return

    const { from } = editor.state.selection
    const displayText = target?.displayText || selectedNote.title || '无标题'

    // 如果是 block 链接，需要确保目标 block 有 ID
    let targetValue = target?.value
    if (target?.type === 'block' && !targetValue) {
      // 生成新的 block ID
      targetValue = generateBlockId()
      // TODO: 更新目标笔记的 block ID
    }

    // Delete the [[ and query text
    editor
      .chain()
      .focus()
      .deleteRange({ from: linkStartPos, to: from })
      .setNoteLink({
        noteId: selectedNote.id,
        noteTitle: selectedNote.title || '无标题',
        targetType: target?.type || 'note',
        targetValue: targetValue,
      })
      .insertContent(displayText)
      .unsetNoteLink()
      .run()

    setShowLinkPopup(false)
    setLinkQuery('')
    setLinkStartPos(null)
    setSearchMode('note')
    setSelectedLinkNote(null)
  }, [editor, linkStartPos])

  // 选择笔记后进入标题/block 搜索
  const handleSelectNoteForSubSearch = useCallback((selectedNote: Note) => {
    // 在当前输入位置插入 # 进入标题搜索
    // 用户可以继续输入 ^ 进入 block 搜索
    setSelectedLinkNote(selectedNote)
    setSearchMode('heading')
    setLinkQuery('')

    // 获取目标笔记的标题列表
    try {
      const content = selectedNote.content
      if (content) {
        const parsed = JSON.parse(content)
        const headings = extractHeadingsFromJSON(parsed)
        setTargetHeadings(headings)
        const blocks = extractBlocksFromJSON(parsed)
        setTargetBlocks(blocks)
      }
    } catch {
      setTargetHeadings([])
      setTargetBlocks([])
    }
  }, [])

  // Handle create new note from link
  const handleCreateNoteLink = useCallback(async (title: string) => {
    if (!editor || linkStartPos === null) return

    const newNote = await onCreateNote(title)
    const { from } = editor.state.selection

    // Delete the [[ and query text
    editor
      .chain()
      .focus()
      .deleteRange({ from: linkStartPos, to: from })
      .setNoteLink({ noteId: newNote.id, noteTitle: title })
      .insertContent(title)
      .unsetNoteLink()
      .run()

    setShowLinkPopup(false)
    setLinkQuery('')
    setLinkStartPos(null)
    setSearchMode('note')
    setSelectedLinkNote(null)
  }, [editor, linkStartPos, onCreateNote])

  // Close popup on escape
  const handleCloseLinkPopup = useCallback(() => {
    setShowLinkPopup(false)
    setLinkQuery('')
    setLinkStartPos(null)
    setSearchMode('note')
    setSelectedLinkNote(null)
  }, [])

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(prev => !prev)
  }, [])

  // 持续追踪最后的光标位置（即使焦点离开编辑器也能记住）
  const lastCursorInfo = useRef<CursorInfo | null>(null)

  // 监听编辑器选区变化，持续更新 lastCursorInfo
  useEffect(() => {
    if (!editor) return

    const updateCursorInfo = () => {
      const info = getCursorInfo(editor)
      if (info) {
        lastCursorInfo.current = info
      }
    }

    // 初始化
    updateCursorInfo()

    // 监听选区变化
    editor.on('selectionUpdate', updateCursorInfo)
    return () => {
      editor.off('selectionUpdate', updateCursorInfo)
    }
  }, [editor])

  // Toggle typewriter mode
  const toggleTypewriterMode = useCallback(() => {
    // 优先调用外部回调（打开独立的打字机窗口）
    if (onTypewriterModeToggle) {
      // 使用缓存的光标位置（因为点击按钮时焦点已经离开编辑器）
      const cursorInfo = lastCursorInfo.current || getCursorInfo(editor)
      onTypewriterModeToggle(cursorInfo || { blockId: '', offsetInBlock: 0 })
    } else {
      setIsTypewriterMode(prev => !prev)
    }
  }, [onTypewriterModeToggle, editor])

  // Typewriter scroll - keep cursor in center of viewport
  const scrollToCenter = useCallback(() => {
    if (!isTypewriterMode || !contentRef.current) return

    // Get the cursor position using the DOM selection
    const selection = window.getSelection()
    if (!selection || !selection.rangeCount) return

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const containerRect = contentRef.current.getBoundingClientRect()

    // Calculate the offset to center the cursor
    const containerCenter = containerRect.height / 2
    const cursorOffset = rect.top - containerRect.top + contentRef.current.scrollTop
    const targetScroll = cursorOffset - containerCenter

    contentRef.current.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    })
  }, [isTypewriterMode])

  // Trigger typewriter scroll on selection change
  useEffect(() => {
    if (!editor || !isTypewriterMode) return

    const handleSelectionUpdate = () => {
      // Small delay to ensure DOM is updated
      requestAnimationFrame(scrollToCenter)
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor, isTypewriterMode, scrollToCenter])

  // Toolbar visibility on mouse move - show when near bottom, hide when leave
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const rect = editorContainerRef.current?.getBoundingClientRect()
      if (rect) {
        // 鼠标在底部 200px 范围内时显示
        setShowToolbar(e.clientY > rect.bottom - 200)
      }
    }

    const container = editorContainerRef.current
    container?.addEventListener('mousemove', handleMouseMove)
    return () => {
      container?.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  // 滚动到目标标题或 block
  useEffect(() => {
    if (!scrollTarget || !editor || !contentRef.current) return

    // 延迟执行以确保编辑器内容已渲染
    const scrollToTarget = () => {
      const editorElement = contentRef.current?.querySelector('.ProseMirror')
      if (!editorElement) return

      let targetElement: Element | null = null

      if (scrollTarget.type === 'heading') {
        // 查找匹配的标题
        const headings = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6')
        for (const heading of headings) {
          if (heading.textContent?.trim() === scrollTarget.value) {
            targetElement = heading
            break
          }
        }
      } else if (scrollTarget.type === 'block') {
        // 查找匹配的 block ID
        targetElement = editorElement.querySelector(`[data-block-id="${scrollTarget.value}"]`)
      }

      if (targetElement) {
        // 滚动到目标元素
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })

        // 添加高亮效果
        targetElement.classList.add('scroll-highlight')
        setTimeout(() => {
          targetElement?.classList.remove('scroll-highlight')
        }, 2000)
      }

      // 通知完成滚动
      onScrollComplete?.()
    }

    // 给编辑器一点时间加载内容
    const timer = setTimeout(scrollToTarget, 100)
    return () => clearTimeout(timer)
  }, [scrollTarget, editor, onScrollComplete])

  if (!editor) return null

  return (
    <div
      ref={editorContainerRef}
      className={`zen-editor-container ${resolvedColorMode}`}
    >
      {/* Floating toolbar - appears on hover at bottom */}
      <EditorToolbar
        editor={editor}
        t={t}
        isFocusMode={isFocusMode}
        isTypewriterMode={isTypewriterMode}
        toggleFocusMode={toggleFocusMode}
        toggleTypewriterMode={toggleTypewriterMode}
        showToolbar={showToolbar}
      />

      {/* Scroll wrapper - keeps scrollbar at right edge */}
      <div ref={contentRef} className="zen-scroll-wrapper">
        {/* Editor content area */}
        <div className={`zen-content ${isTypewriterMode ? 'typewriter-mode' : ''}`}>
          {/* Title */}
          <textarea
            ref={titleRef}
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            placeholder={t.editor.titlePlaceholder}
            className="zen-title"
            rows={1}
          />

          {/* Editor */}
          <EditorContent editor={editor} className="zen-editor-content" />

          {/* Word count - subtle */}
          <div className="zen-stats">
            {editor.storage.characterCount?.words() ?? 0} words
          </div>
        </div>
      </div>

      {/* Note link popup */}
      {showLinkPopup && (
        <NoteLinkPopup
          notes={notes.filter(n => n.id !== note.id)}
          query={linkQuery}
          position={linkPopupPosition}
          onSelect={handleSelectNoteLink}
          onCreate={handleCreateNoteLink}
          onClose={handleCloseLinkPopup}
          searchMode={searchMode}
          selectedNote={selectedLinkNote}
          headings={targetHeadings}
          blocks={targetBlocks}
          onSelectNote={handleSelectNoteForSubSearch}
        />
      )}
    </div>
  )
})

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { note, notes, onUpdate, onNoteClick, onCreateNote, scrollTarget, onScrollComplete, onTypewriterModeToggle },
  ref
) {
  const t = useTranslations()

  if (!note) {
    return (
      <div className="zen-empty">
        <div className="zen-empty-content">
          <p className="zen-empty-title">{t.editor.selectNote}</p>
          <p className="zen-empty-subtitle">{t.editor.createNew}</p>
        </div>
      </div>
    )
  }

  // Use key to force re-mount when note changes
  return (
    <ZenEditor
      key={note.id}
      ref={ref}
      note={note}
      notes={notes}
      onUpdate={onUpdate}
      onNoteClick={onNoteClick}
      onCreateNote={onCreateNote}
      scrollTarget={scrollTarget}
      onScrollComplete={onScrollComplete}
      onTypewriterModeToggle={onTypewriterModeToggle}
    />
  )
})

// 响应式工具栏组件
function EditorToolbar({
  editor,
  t,
  isFocusMode,
  isTypewriterMode,
  toggleFocusMode,
  toggleTypewriterMode,
  showToolbar
}: {
  editor: ReturnType<typeof useEditor>
  t: ReturnType<typeof useTranslations>
  isFocusMode: boolean
  isTypewriterMode: boolean
  toggleFocusMode: () => void
  toggleTypewriterMode: () => void
  showToolbar: boolean
}) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isCompact, setIsCompact] = useState(false)

  // 监听容器宽度变化
  useEffect(() => {
    const checkWidth = () => {
      if (toolbarRef.current) {
        const parent = toolbarRef.current.parentElement
        if (parent) {
          // 当编辑器宽度小于 680px 时切换到紧凑模式
          setIsCompact(parent.clientWidth < 680)
        }
      }
    }

    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  if (!editor) return null

  // 判断是否是正文（非标题的段落）
  const isBody = editor.isActive('paragraph') && !editor.isActive('heading')

  // 紧凑模式：分组折叠
  if (isCompact) {
    return (
      <div ref={toolbarRef} className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
        {/* 文本格式下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.bold}
          active={editor.isActive('bold') || editor.isActive('italic') || editor.isActive('strike')}
          items={[
            { label: t.toolbar.bold, icon: ToolbarIcons.bold, active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
            { label: t.toolbar.italic, icon: ToolbarIcons.italic, active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
            { label: t.toolbar.strikethrough, icon: ToolbarIcons.strikethrough, active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
          ]}
        />
        {/* 段落类型下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.heading}
          active={editor.isActive('heading') || isBody}
          items={[
            { label: 'Body', active: isBody, onClick: () => editor.chain().focus().setParagraph().run() },
            { label: 'H1', active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
            { label: 'H2', active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
            { label: 'H3', active: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
            { label: 'H4', active: editor.isActive('heading', { level: 4 }), onClick: () => editor.chain().focus().toggleHeading({ level: 4 }).run() },
          ]}
        />
        {/* 列表下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.list}
          active={editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')}
          items={[
            { label: t.toolbar.bulletList, icon: ToolbarIcons.bulletList, active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() },
            { label: t.toolbar.numberedList, icon: ToolbarIcons.orderedList, active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() },
            { label: t.toolbar.checklist, icon: ToolbarIcons.taskList, active: editor.isActive('taskList'), onClick: () => editor.chain().focus().toggleTaskList().run() },
          ]}
        />
        {/* 块元素下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.block}
          active={editor.isActive('blockquote') || editor.isActive('code')}
          items={[
            { label: t.toolbar.quote, icon: ToolbarIcons.quote, active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run() },
            { label: t.toolbar.code, icon: ToolbarIcons.code, active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run() },
          ]}
        />
        <div className="zen-toolbar-divider" />
        <ToolbarButton active={isTypewriterMode} onClick={toggleTypewriterMode} title={t.typewriter.typewriterMode} icon={ToolbarIcons.typewriter} />
      </div>
    )
  }

  // 展开模式：所有按钮平铺
  return (
    <div ref={toolbarRef} className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
      {/* 文本格式 */}
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t.toolbar.bold} icon={ToolbarIcons.bold} />
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t.toolbar.italic} icon={ToolbarIcons.italic} />
      <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={t.toolbar.strikethrough} icon={ToolbarIcons.strikethrough} />
      <div className="zen-toolbar-divider" />
      {/* 段落类型 */}
      <ToolbarButton active={isBody} onClick={() => editor.chain().focus().setParagraph().run()} title="Body" icon={<span className="zen-toolbar-text">Body</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={t.toolbar.heading1} icon={<span className="zen-toolbar-text">H1</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={t.toolbar.heading2} icon={<span className="zen-toolbar-text">H2</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t.toolbar.heading3} icon={<span className="zen-toolbar-text">H3</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} title="H4" icon={<span className="zen-toolbar-text">H4</span>} />
      <div className="zen-toolbar-divider" />
      {/* 列表 */}
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t.toolbar.bulletList} icon={ToolbarIcons.bulletList} />
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t.toolbar.numberedList} icon={ToolbarIcons.orderedList} />
      <ToolbarButton active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title={t.toolbar.checklist} icon={ToolbarIcons.taskList} />
      <div className="zen-toolbar-divider" />
      {/* 块元素 */}
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t.toolbar.quote} icon={ToolbarIcons.quote} />
      <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title={t.toolbar.code} icon={ToolbarIcons.code} />
      <div className="zen-toolbar-divider" />
      {/* 打字机模式 */}
      <ToolbarButton active={isTypewriterMode} onClick={toggleTypewriterMode} title={t.typewriter.typewriterMode} icon={ToolbarIcons.typewriter} />
    </div>
  )
}

function ToolbarButton({
  icon,
  active,
  onClick,
  title
}: {
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`zen-toolbar-btn ${active ? 'active' : ''}`}
    >
      {icon}
    </button>
  )
}

interface DropdownItem {
  label: string
  icon?: React.ReactNode
  active?: boolean
  onClick: () => void
}

function ToolbarDropdown({
  icon,
  active,
  items
}: {
  icon: React.ReactNode
  active?: boolean
  items: DropdownItem[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="zen-toolbar-dropdown" ref={dropdownRef}>
      <button
        className={`zen-toolbar-btn zen-toolbar-dropdown-trigger ${active ? 'active' : ''} ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {icon}
        {ToolbarIcons.chevronUp}
      </button>
      {isOpen && (
        <div className="zen-toolbar-dropdown-menu">
          {items.map((item, index) => (
            <button
              key={index}
              className={`zen-toolbar-dropdown-item ${item.active ? 'active' : ''}`}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
            >
              {item.icon && <span className="zen-toolbar-dropdown-icon">{item.icon}</span>}
              <span className="zen-toolbar-dropdown-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 从 JSON 内容中提取标题
function extractHeadingsFromJSON(doc: { type: string; content?: unknown[] }): HeadingInfo[] {
  const headings: HeadingInfo[] = []
  let pos = 0

  function traverse(node: unknown) {
    const n = node as { type?: string; attrs?: { level?: number; blockId?: string }; content?: unknown[]; text?: string }
    if (!n || typeof n !== 'object') return

    if (n.type === 'heading') {
      const text = extractTextFromNode(n)
      headings.push({
        level: n.attrs?.level || 1,
        text,
        pos,
        blockId: n.attrs?.blockId,
      })
    }

    if (n.content && Array.isArray(n.content)) {
      for (const child of n.content) {
        traverse(child)
        pos++
      }
    }
  }

  if (doc.content) {
    for (const node of doc.content) {
      traverse(node)
      pos++
    }
  }

  return headings
}

// 从 JSON 内容中提取 blocks
function extractBlocksFromJSON(doc: { type: string; content?: unknown[] }): BlockInfo[] {
  const blocks: BlockInfo[] = []
  let pos = 0

  const blockTypes = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'table', 'horizontalRule']

  function traverse(node: unknown) {
    const n = node as { type?: string; attrs?: { blockId?: string }; content?: unknown[] }
    if (!n || typeof n !== 'object') return

    if (n.type && blockTypes.includes(n.type)) {
      const text = extractTextFromNode(n)
      // 跳过空段落
      if (n.type === 'paragraph' && !text.trim()) {
        pos++
        return
      }

      blocks.push({
        id: n.attrs?.blockId || generateBlockId(),
        type: n.type,
        text: text.slice(0, 100),
        pos,
      })
    }

    if (n.content && Array.isArray(n.content)) {
      for (const child of n.content) {
        traverse(child)
      }
    }
    pos++
  }

  if (doc.content) {
    for (const node of doc.content) {
      traverse(node)
    }
  }

  return blocks
}

// 从节点中提取文本
function extractTextFromNode(node: unknown): string {
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (!n || typeof n !== 'object') return ''

  if (n.text) return n.text

  if (n.content && Array.isArray(n.content)) {
    return n.content.map(child => extractTextFromNode(child)).join('')
  }

  return ''
}
