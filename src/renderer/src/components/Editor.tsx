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
import './Editor.css'

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

interface EditorProps {
  note: Note | null
  notes: Note[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: () => void
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
}

const ZenEditor = forwardRef<EditorHandle, ZenEditorProps>(function ZenEditor({
  note,
  notes,
  onUpdate,
  onNoteClick,
  onCreateNote,
  scrollTarget,
  onScrollComplete,
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

  // Toggle typewriter mode
  const toggleTypewriterMode = useCallback(() => {
    setIsTypewriterMode(prev => !prev)
  }, [])

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

  // Toolbar visibility on mouse move
  useEffect(() => {
    let timeout: NodeJS.Timeout
    const handleMouseMove = (e: MouseEvent) => {
      const rect = editorContainerRef.current?.getBoundingClientRect()
      if (rect && e.clientY < rect.top + 60) {
        setShowToolbar(true)
        clearTimeout(timeout)
        timeout = setTimeout(() => setShowToolbar(false), 2000)
      }
    }

    const container = editorContainerRef.current
    container?.addEventListener('mousemove', handleMouseMove)
    return () => {
      container?.removeEventListener('mousemove', handleMouseMove)
      clearTimeout(timeout)
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
      {/* Floating toolbar - appears on hover at top */}
      <div className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
        <ToolbarButton
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (⌘B)"
        >
          B
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (⌘I)"
        >
          I
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          S
        </ToolbarButton>
        <div className="zen-toolbar-divider" />
        <ToolbarButton
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading 3"
        >
          H3
        </ToolbarButton>
        <div className="zen-toolbar-divider" />
        <ToolbarButton
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          •
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered List"
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title="Task List"
        >
          ☑
        </ToolbarButton>
        <div className="zen-toolbar-divider" />
        <ToolbarButton
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
        >
          "
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Code"
        >
          &lt;/&gt;
        </ToolbarButton>
        <div className="zen-toolbar-spacer" />
        <ToolbarButton
          active={isTypewriterMode}
          onClick={toggleTypewriterMode}
          title="Typewriter Mode"
        >
          ⌨
        </ToolbarButton>
        <ToolbarButton
          active={isFocusMode}
          onClick={toggleFocusMode}
          title="Focus Mode"
        >
          ◉
        </ToolbarButton>
      </div>

      {/* Editor content area */}
      <div ref={contentRef} className={`zen-content ${isTypewriterMode ? 'typewriter-mode' : ''}`}>
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
  { note, notes, onUpdate, onNoteClick, onCreateNote, scrollTarget, onScrollComplete },
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
    />
  )
})

function ToolbarButton({
  children,
  active,
  onClick,
  title
}: {
  children: React.ReactNode
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
      {children}
    </button>
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
