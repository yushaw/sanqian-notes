/**
 * TypewriterMode - 打字机模式组件
 *
 * 沉浸式写作体验，核心特性：
 * 1. 光标固定在屏幕 65% 位置，内容滚动而非光标移动
 * 2. 焦点渐变效果：当前段落清晰，相邻段落依次变淡
 * 3. 主题跟随系统：深色用墨韵配色，浅色用纸韵配色
 * 4. 右侧大纲（宽屏时显示）
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CharacterCount from '@tiptap/extension-character-count'
// 使用自定义的 ResizableImage 而非默认 Image
import { ResizableImage } from './extensions/ResizableImage'
import { Video } from './extensions/Video'
import { Audio } from './extensions/Audio'
import { FileAttachment } from './extensions/FileAttachment'
import { getFileCategory, getExtensionFromMime } from '../utils/fileCategory'
import Focus from '@tiptap/extension-focus'
import { FileHandler } from '@tiptap/extension-file-handler'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import type { Note } from '../types/note'
import { useTranslations } from '../i18n'
import { useTheme } from '../theme'
import { BlockId } from './extensions/BlockId'
import { NoteLink } from './extensions/NoteLink'
import { CustomHighlight } from './extensions/Highlight'
import { CustomUnderline } from './extensions/Underline'
import { TextStyle, Color } from './extensions/TextColor'
import { Callout } from './extensions/Callout'
import { Toggle } from './extensions/Toggle'
import { Mathematics } from './extensions/Mathematics'
import { Mermaid } from './extensions/Mermaid'
import { CustomCodeBlock } from './extensions/CodeBlock'
import { Footnote } from './extensions/Footnote'
import { MarkdownPaste } from './extensions/MarkdownPaste'
import type { Editor as TiptapEditor } from '@tiptap/core'
import 'katex/dist/katex.min.css'
import { TypewriterToolbar } from './TypewriterToolbar'
import { TypewriterToc } from './TypewriterToc'
import { getCursorInfo, setCursorByBlockId, type CursorInfo } from '../utils/cursor'
import { countWordsFromEditor, countSelectedWords } from '../utils/wordCount'
import './Typewriter.css'

// ==================== 类型定义 ====================

export interface TypewriterTheme {
  backgroundColor: string
  textColor: string
  focusTextColor: string
  dimmedTextColor: string
  accentColor: string
  fontFamily: string
  fontSize: string
  lineHeight: number
  letterSpacing: string
  maxWidth: string
  cursorOffset: number
  paddingHorizontal: string
  focusMode: 'line' | 'sentence' | 'paragraph' | 'none'
  dimOpacity: number
  showCursorLine: boolean
  cursorLineColor: string
  showWordCount: boolean
}

interface TypewriterModeProps {
  note: Note
  notes: Note[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  onExit: (cursorInfo?: CursorInfo) => void
  initialCursorInfo?: CursorInfo
}

// ==================== 字体配置 ====================

// 楷体字体栈（中文优先）
const FONT_WENKAI = [
  "'LXGW WenKai'",
  "'LXGW WenKai Screen'",
  "'Kaiti SC'",
  "'STKaiti'",
  "'KaiTi'",
  "'FangSong'",
  "'Source Han Serif SC'",
  "'Noto Serif SC'",
  "'Songti SC'",
  "'SimSun'",
  "Georgia",
  "serif"
].join(', ')

// ==================== 主组件 ====================

export function TypewriterMode({
  note,
  notes: _notes,
  onUpdate,
  onNoteClick,
  onCreateNote: _onCreateNote,
  onExit,
  initialCursorInfo,
}: TypewriterModeProps) {
  // ==================== Refs ====================
  const contentRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  // 防止循环触发的标志位
  const isProgrammaticScroll = useRef(false)
  const isProgrammaticSelection = useRef(false)
  const lastCursorX = useRef<number | null>(null)
  const isInitializing = useRef(true)

  // 滚动动画相关
  const animationFrameId = useRef<number | null>(null)
  const scrollAnimationStart = useRef<number | null>(null)
  const scrollAnimationFrom = useRef<number>(0)
  const scrollAnimationTo = useRef<number>(0)
  const scrollDebounceTimer = useRef<NodeJS.Timeout | null>(null)

  // ==================== State ====================
  const [title, setTitle] = useState(note.title)
  const [wordCount, setWordCount] = useState(0)
  const [selectedWordCount, setSelectedWordCount] = useState<number | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ==================== Hooks ====================
  const { resolvedColorMode } = useTheme()
  const t = useTranslations()

  // 主题配置（跟随系统深色/浅色）
  const isDark = resolvedColorMode === 'dark'
  const resolvedTheme: TypewriterTheme = {
    backgroundColor: isDark ? '#1a1a1a' : '#f8f6f2',
    textColor: isDark ? '#e6e1db' : '#2c2825',
    focusTextColor: isDark ? '#f5f2ed' : '#1a1715',
    dimmedTextColor: isDark ? '#6b6560' : '#a09890',
    accentColor: '#c45c3e',
    fontFamily: FONT_WENKAI,
    fontSize: '1.1rem',
    lineHeight: 1.4,
    letterSpacing: '0.05em',
    maxWidth: '720px',
    cursorOffset: 0.65,
    paddingHorizontal: '4rem',
    focusMode: 'paragraph',
    dimOpacity: 0.35,
    showCursorLine: false,
    cursorLineColor: 'rgba(0, 0, 0, 0.02)',
    showWordCount: true,
  }

  // ==================== 文件处理 ====================

  // 处理文件插入（粘贴或拖拽）
  const handleFileInsert = async (
    editorInstance: TiptapEditor,
    file: File,
    pos?: number
  ) => {
    if (!editorInstance) return

    const docSize = editorInstance.state.doc.content.size
    let insertPos: number | undefined = pos
    if (pos !== undefined && (pos < 0 || pos > docSize)) {
      insertPos = docSize
    }

    // 前端文件大小检查（100MB）
    const MAX_FILE_SIZE = 100 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      alert(`文件过大：${file.name}\n文件大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 100MB 限制`)
      return
    }

    try {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)

      const ext = file.name.includes('.')
        ? file.name.split('.').pop()!.toLowerCase()
        : getExtensionFromMime(file.type)

      const result = await window.electron.attachment.saveBuffer(buffer, ext, file.name)
      const category = getFileCategory(file.name) || getFileCategory(`.${ext}`)

      const attachmentUrl = `attachment://${result.relativePath}`

      switch (category) {
        case 'image':
          if (insertPos !== undefined) {
            editorInstance.chain().focus().insertContentAt(insertPos, {
              type: 'resizableImage',
              attrs: { src: attachmentUrl, alt: result.name },
            }).run()
          } else {
            editorInstance.chain().focus().setImage({
              src: attachmentUrl,
              alt: result.name,
            }).run()
          }
          break

        case 'video':
          if (insertPos !== undefined) {
            editorInstance.chain().focus().insertContentAt(insertPos, {
              type: 'video',
              attrs: { src: attachmentUrl },
            }).run()
          } else {
            editorInstance.commands.setVideo({ src: attachmentUrl })
          }
          break

        case 'audio':
          if (insertPos !== undefined) {
            editorInstance.chain().focus().insertContentAt(insertPos, {
              type: 'audio',
              attrs: { src: attachmentUrl, title: result.name },
            }).run()
          } else {
            editorInstance.commands.setAudio({ src: attachmentUrl, title: result.name })
          }
          break

        default:
          // 其他文件类型作为附件
          if (insertPos !== undefined) {
            editorInstance.chain().focus().insertContentAt(insertPos, {
              type: 'fileAttachment',
              attrs: {
                src: attachmentUrl,
                name: result.name,
                size: result.size,
                type: result.type,
              },
            }).run()
          } else {
            editorInstance.commands.setFileAttachment({
              src: attachmentUrl,
              name: result.name,
              size: result.size,
              type: result.type,
            })
          }
      }
    } catch (error) {
      console.error('Failed to insert file:', error)
      alert(`文件插入失败：${file.name}`)
    }
  }

  // ==================== 编辑器初始化 ====================

  const getInitialContent = () => {
    if (!note.content || note.content === '[]' || note.content === '') {
      return ''
    }
    try {
      const parsed = JSON.parse(note.content)
      if (parsed.type === 'doc') return parsed
      if (Array.isArray(parsed)) return { type: 'doc', content: parsed }
      return ''
    } catch {
      return note.content
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder: t.editor.contentPlaceholder || 'Start writing...',
        emptyEditorClass: 'is-editor-empty',
      }),
      Typography,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'zen-link' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CharacterCount,
      ResizableImage,
      Video,
      Audio,
      FileAttachment,
      Focus.configure({ className: 'has-focus', mode: 'shallowest' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      BlockId,
      NoteLink.configure({
        onNoteClick: (noteId: string, _noteTitle: string, target?: { type: 'heading' | 'block'; value: string }) => {
          onNoteClick(noteId, target)
        },
      }),
      CustomHighlight,
      CustomUnderline,
      TextStyle,
      Color,
      Callout,
      Toggle,
      Mathematics,
      Mermaid,
      CustomCodeBlock,
      Footnote,
      MarkdownPaste,
      FileHandler.configure({
        onPaste: async (currentEditor, files) => {
          for (const file of files) {
            await handleFileInsert(currentEditor, file)
          }
        },
        onDrop: async (currentEditor, files, pos) => {
          for (const file of files) {
            await handleFileInsert(currentEditor, file, pos)
          }
        },
      }),
    ],
    content: getInitialContent(),
    editorProps: {
      attributes: { class: 'typewriter-editor' },
      handleClick: (_view, _pos, _event) => {
        setTimeout(() => {
          if (contentRef.current && !isProgrammaticScroll.current) {
            contentRef.current.dispatchEvent(new CustomEvent('typewriter-click'))
          }
        }, 10)
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      onUpdate(note.id, { content: JSON.stringify(json) })
      setWordCount(countWordsFromEditor(editor))
    },
  })

  // ==================== 滚动动画 ====================

  const animateScroll = useCallback((timestamp: number) => {
    if (!contentRef.current) return

    if (scrollAnimationStart.current === null) {
      scrollAnimationStart.current = timestamp
    }

    const elapsed = timestamp - scrollAnimationStart.current
    const duration = 200
    const progress = Math.min(elapsed / duration, 1)
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
    const easedProgress = easeOutCubic(progress)

    contentRef.current.scrollTop = scrollAnimationFrom.current +
      (scrollAnimationTo.current - scrollAnimationFrom.current) * easedProgress

    if (progress < 1) {
      animationFrameId.current = requestAnimationFrame(animateScroll)
    } else {
      animationFrameId.current = null
      scrollAnimationStart.current = null
      setTimeout(() => { isProgrammaticScroll.current = false }, 50)
    }
  }, [])

  /** 滚动内容使光标回到固定位置（屏幕 65%） */
  const scrollToCursor = useCallback(() => {
    if (!editor || !contentRef.current) return

    const { from } = editor.state.selection
    const coords = editor.view.coordsAtPos(from)
    const container = contentRef.current
    const containerRect = container.getBoundingClientRect()
    const targetY = containerRect.height * resolvedTheme.cursorOffset

    lastCursorX.current = coords.left

    const currentCursorY = coords.top - containerRect.top
    const scrollOffset = currentCursorY - targetY

    if (Math.abs(scrollOffset) > 15) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }

      isProgrammaticScroll.current = true
      scrollAnimationStart.current = null
      scrollAnimationFrom.current = container.scrollTop
      scrollAnimationTo.current = container.scrollTop + scrollOffset

      animationFrameId.current = requestAnimationFrame(animateScroll)
    }
  }, [editor, resolvedTheme.cursorOffset, animateScroll])

  // ==================== 透明度渐变 ====================

  /** 动态计算透明度渐变（根据可视区域 block 数量） */
  const updateBlockOpacity = useCallback(() => {
    const containerEl = contentRef.current?.closest('.typewriter-container') as HTMLElement
    if (!containerEl || !editor) return

    const viewportHeight = window.innerHeight
    const proseMirror = containerEl.querySelector('.ProseMirror')
    if (!proseMirror) return

    const blocks = proseMirror.querySelectorAll(':scope > *')
    if (blocks.length === 0) return

    let totalHeight = 0
    blocks.forEach(block => {
      totalHeight += (block as HTMLElement).offsetHeight
    })
    const avgBlockHeight = totalHeight / blocks.length
    const visibleBlocks = Math.max(4, Math.ceil(viewportHeight / avgBlockHeight))
    const halfVisible = Math.max(3, Math.floor(visibleBlocks / 2))

    const minOpacity = 0.06
    for (let dist = 1; dist <= 8; dist++) {
      const ratio = dist / halfVisible
      const opacity = Math.max(minOpacity, 1 - (1 - minOpacity) * Math.pow(Math.min(ratio, 1), 1.8))
      containerEl.style.setProperty(`--tw-opacity-${dist}`, opacity.toFixed(2))
    }
    containerEl.style.setProperty('--tw-opacity-far', minOpacity.toFixed(2))
  }, [editor])

  // ==================== 事件监听 ====================

  /** 光标变化 → 滚动 + 更新字数 */
  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setSelectedWordCount(countSelectedWords(editor))
      updateBlockOpacity()

      if (isProgrammaticSelection.current) return

      if (scrollDebounceTimer.current) {
        clearTimeout(scrollDebounceTimer.current)
      }
      scrollDebounceTimer.current = setTimeout(() => {
        scrollToCursor()
      }, 50)
    }

    editor.on('selectionUpdate', handleSelectionUpdate)

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
      if (scrollDebounceTimer.current) {
        clearTimeout(scrollDebounceTimer.current)
      }
    }
  }, [editor, scrollToCursor, updateBlockOpacity])

  /** 滚动 → 移动光标到屏幕中心位置 */
  useEffect(() => {
    if (!editor || !contentRef.current) return

    let scrollTimeout: NodeJS.Timeout | null = null
    const container = contentRef.current

    const handleScroll = () => {
      if (isInitializing.current || isProgrammaticScroll.current) return
      if (scrollTimeout) return

      scrollTimeout = setTimeout(() => {
        scrollTimeout = null

        if (!editor.view.hasFocus()) {
          editor.commands.focus()
        }

        const containerRect = container.getBoundingClientRect()
        const targetY = containerRect.top + containerRect.height * resolvedTheme.cursorOffset
        const targetX = lastCursorX.current ?? containerRect.left + containerRect.width / 2

        try {
          const pos = editor.view.posAtCoords({ left: targetX, top: targetY })
          if (pos && pos.pos !== undefined && pos.inside >= 0) {
            const $pos = editor.state.doc.resolve(pos.pos)
            if ($pos.parent.isTextblock || $pos.parent.type.name === 'paragraph') {
              const savedX = lastCursorX.current

              isProgrammaticSelection.current = true
              editor.commands.setTextSelection(pos.pos)
              lastCursorX.current = savedX

              setTimeout(() => {
                isProgrammaticSelection.current = false
              }, 50)
            }
          }
        } catch {
          // 忽略位置解析错误
        }
      }, 16)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [editor, resolvedTheme.cursorOffset])

  /** 点击事件 → 滚动动画 */
  useEffect(() => {
    if (!contentRef.current) return

    const container = contentRef.current
    const handleTypewriterClick = () => scrollToCursor()

    container.addEventListener('typewriter-click', handleTypewriterClick)
    return () => container.removeEventListener('typewriter-click', handleTypewriterClick)
  }, [scrollToCursor])

  /** 初始化 */
  useEffect(() => {
    if (!editor) return

    setWordCount(countWordsFromEditor(editor))

    const hasInitialCursor = initialCursorInfo?.blockId && initialCursorInfo.blockId !== ''

    setIsTransitioning(true)
    const timer = setTimeout(() => {
      setIsTransitioning(false)

      if (!hasInitialCursor) {
        editor.commands.focus('end')
        setTimeout(() => {
          scrollToCursor()
          updateBlockOpacity()
          setTimeout(() => { isInitializing.current = false }, 300)
        }, 50)
      } else {
        const success = setCursorByBlockId(editor, initialCursorInfo)
        if (!success) editor.commands.focus('end')

        setTimeout(() => {
          updateBlockOpacity()
          scrollToCursor()
          setTimeout(() => { isInitializing.current = false }, 300)
        }, 150)
      }
    }, 150)

    return () => clearTimeout(timer)
  }, [editor, scrollToCursor, updateBlockOpacity, initialCursorInfo])

  /** 窗口大小变化 → 重新计算透明度 */
  useEffect(() => {
    let resizeTimer: NodeJS.Timeout | null = null
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => updateBlockOpacity(), 150)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [updateBlockOpacity])

  // ==================== 事件处理 ====================

  const handleExit = useCallback(() => {
    const cursorInfo = getCursorInfo(editor)
    onExit(cursorInfo || undefined)
  }, [editor, onExit])

  /** ESC 键退出 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleExit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  /** 全屏状态监听 */
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  /** 标题高度自适应 */
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto'
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
    }
  }, [title])

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newTitle = e.target.value
    setTitle(newTitle)
    onUpdate(note.id, { title: newTitle })
  }, [note.id, onUpdate])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      editor?.commands.focus('start')
    }
  }, [editor])

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (err) {
      console.error('Fullscreen error:', err)
    }
  }, [])

  // ==================== 渲染 ====================

  const cssVariables = {
    '--tw-bg': resolvedTheme.backgroundColor,
    '--tw-text': resolvedTheme.textColor,
    '--tw-focus-text': resolvedTheme.focusTextColor,
    '--tw-dimmed-text': resolvedTheme.dimmedTextColor,
    '--tw-accent': resolvedTheme.accentColor,
    '--tw-font-family': resolvedTheme.fontFamily,
    '--tw-font-size': resolvedTheme.fontSize,
    '--tw-line-height': resolvedTheme.lineHeight,
    '--tw-letter-spacing': resolvedTheme.letterSpacing,
    '--tw-max-width': resolvedTheme.maxWidth,
    '--tw-cursor-offset': `${resolvedTheme.cursorOffset * 100}%`,
    '--tw-cursor-offset-vh': `${resolvedTheme.cursorOffset * 100}vh`,
    '--tw-padding-h': resolvedTheme.paddingHorizontal,
    '--tw-dim-opacity': resolvedTheme.dimOpacity,
    '--tw-cursor-line-color': resolvedTheme.cursorLineColor,
  } as React.CSSProperties

  if (!editor) return null

  return (
    <div
      className={`typewriter-container ${isTransitioning ? 'transitioning' : ''}`}
      style={cssVariables}
    >
      <div className="typewriter-drag-region" onMouseDown={(e) => e.preventDefault()} />

      {resolvedTheme.showCursorLine && <div className="typewriter-cursor-line" />}

      <div ref={contentRef} className={`typewriter-content focus-${resolvedTheme.focusMode}`}>
        <div className="typewriter-inner">
          <textarea
            ref={titleRef}
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            placeholder={t.editor.titlePlaceholder}
            className="typewriter-title"
            rows={1}
          />
          <EditorContent editor={editor} className="typewriter-editor-content" />
        </div>
      </div>

      <TypewriterToc editor={editor} />

      <TypewriterToolbar
        wordCount={wordCount}
        selectedWordCount={selectedWordCount}
        onToggleFullscreen={handleToggleFullscreen}
        onExit={handleExit}
        isFullscreen={isFullscreen}
      />
    </div>
  )
}
