/**
 * TypewriterMode - 打字机模式组件
 *
 * 沉浸式写作体验，核心特性：
 * 1. 光标固定在屏幕 70% 位置，内容滚动而非光标移动
 * 2. 焦点渐变效果：当前段落清晰，相邻段落依次变淡
 * 3. 独立的 TipTap 编辑器实例，与主编辑器完全隔离
 * 4. 支持深色/浅色主题自动切换
 *
 * 实现原理详见：docs/typewriter-mode.md
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
import Image from '@tiptap/extension-image'
import Focus from '@tiptap/extension-focus'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import type { Note } from '../types/note'
import { useTranslations } from '../i18n'
import { useTheme } from '../theme'
import { ACCENT_COLOR } from '../theme/config'
import { BlockId } from './extensions/BlockId'
import { NoteLink } from './extensions/NoteLink'
import './Typewriter.css'

// 打字机模式主题配置
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

// 中英文混排的字体栈
// 优先使用 Source Han Sans/Serif (思源黑体/宋体), Noto Sans/Serif CJK
// 英文使用 iA Writer 风格的等宽字体
const FONT_SANS = "'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif"
const FONT_SERIF = "'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif"
const FONT_MONO = "'SF Mono', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', Menlo, monospace"

// 预设主题 - 深色和浅色（禅意风格）
const themes: Record<string, TypewriterTheme> = {
  dark: {
    // 深色：温暖的墨色背景，减少蓝光
    backgroundColor: '#1c1c1e',
    textColor: '#c7c7cc',
    focusTextColor: '#f5f5f7',
    dimmedTextColor: '#636366',
    accentColor: ACCENT_COLOR,
    // 正文使用无衬线，更现代的阅读体验
    fontFamily: FONT_SANS,
    fontSize: '18px',
    lineHeight: 2,           // 更宽松的行高，禅意感
    letterSpacing: '0.02em', // 略微增加字间距
    maxWidth: '680px',       // 适中的行宽，每行约 35-40 中文字符
    cursorOffset: 0.7,       // 光标位置在页面 70%
    paddingHorizontal: '3rem',
    focusMode: 'paragraph',
    dimOpacity: 0.35,
    showCursorLine: false,
    cursorLineColor: 'rgba(255, 255, 255, 0.06)',
    showWordCount: true,
  },
  light: {
    // 浅色：温暖的米白色背景，减少刺眼感
    backgroundColor: '#faf9f7',
    textColor: '#3c3c43',
    focusTextColor: '#1c1c1e',
    dimmedTextColor: '#aeaeb2',
    accentColor: ACCENT_COLOR,
    fontFamily: FONT_SANS,
    fontSize: '18px',
    lineHeight: 2,
    letterSpacing: '0.02em',
    maxWidth: '680px',
    cursorOffset: 0.7,       // 光标位置在页面 70%
    paddingHorizontal: '3rem',
    focusMode: 'paragraph',
    dimOpacity: 0.45,
    showCursorLine: false,
    cursorLineColor: 'rgba(0, 0, 0, 0.04)',
    showWordCount: true,
  },
}

// 导出字体常量供其他地方使用
export { FONT_SANS, FONT_SERIF, FONT_MONO }

interface TypewriterModeProps {
  note: Note
  notes: Note[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  onExit: () => void
}

export function TypewriterMode({
  note,
  notes: _notes,
  onUpdate,
  onNoteClick,
  onCreateNote: _onCreateNote,
  onExit,
}: TypewriterModeProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(note.title)
  const [wordCount, setWordCount] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(true)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const t = useTranslations()
  const { resolvedColorMode } = useTheme()

  // 防止循环触发的标志
  const isProgrammaticScroll = useRef(false)
  const isProgrammaticSelection = useRef(false)
  const lastCursorX = useRef<number | null>(null)

  // 根据系统主题自动选择打字机主题
  const resolvedTheme: TypewriterTheme = themes[resolvedColorMode] || themes.dark

  // 解析初始内容
  const getInitialContent = () => {
    if (!note.content || note.content === '[]' || note.content === '') {
      return ''
    }
    try {
      const parsed = JSON.parse(note.content)
      if (parsed.type === 'doc') {
        return parsed
      }
      if (Array.isArray(parsed)) {
        return { type: 'doc', content: parsed }
      }
      return ''
    } catch {
      return note.content
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
        },
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
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      // Focus 扩展：给当前焦点所在的段落添加 .has-focus 类
      Focus.configure({
        className: 'has-focus',
        mode: 'shallowest', // 只给最外层的块级元素添加类
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
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
        class: 'typewriter-editor',
      },
      // 拦截点击事件，实现点击后滚动动画
      handleClick: (_view, _pos, _event) => {
        // 点击后，等待默认的光标定位完成，然后滚动
        // 返回 false 让默认行为继续执行
        setTimeout(() => {
          if (contentRef.current && !isProgrammaticScroll.current) {
            // 触发滚动到光标位置
            const customEvent = new CustomEvent('typewriter-click')
            contentRef.current.dispatchEvent(customEvent)
          }
        }, 10)
        return false
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      onUpdate(note.id, { content: JSON.stringify(json) })
      setWordCount(editor.storage.characterCount?.words() || 0)
    },
  })

  // 动画帧 ID，用于取消正在进行的动画
  const animationFrameId = useRef<number | null>(null)
  const scrollAnimationStart = useRef<number | null>(null)
  const scrollAnimationFrom = useRef<number>(0)
  const scrollAnimationTo = useRef<number>(0)

  // 使用 requestAnimationFrame 实现更流畅的滚动动画
  const animateScroll = useCallback((timestamp: number) => {
    if (!contentRef.current) return

    if (scrollAnimationStart.current === null) {
      scrollAnimationStart.current = timestamp
    }

    const elapsed = timestamp - scrollAnimationStart.current
    const duration = 200 // 动画持续时间 ms
    const progress = Math.min(elapsed / duration, 1)

    // 使用 easeOutCubic 缓动函数
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
    const easedProgress = easeOutCubic(progress)

    const currentScroll = scrollAnimationFrom.current +
      (scrollAnimationTo.current - scrollAnimationFrom.current) * easedProgress

    contentRef.current.scrollTop = currentScroll

    if (progress < 1) {
      animationFrameId.current = requestAnimationFrame(animateScroll)
    } else {
      // 动画完成
      animationFrameId.current = null
      scrollAnimationStart.current = null
      setTimeout(() => {
        isProgrammaticScroll.current = false
      }, 50)
    }
  }, [])

  // 滚动到指定位置使光标居中
  const scrollToCursor = useCallback(() => {
    if (!editor || !contentRef.current) return

    const { from } = editor.state.selection
    const coords = editor.view.coordsAtPos(from)
    const container = contentRef.current
    const containerRect = container.getBoundingClientRect()
    const targetY = containerRect.height * resolvedTheme.cursorOffset

    // 保存光标水平位置
    lastCursorX.current = coords.left

    // 计算需要滚动的距离
    const currentCursorY = coords.top - containerRect.top
    const scrollOffset = currentCursorY - targetY

    // 提高阈值，避免微小滚动
    if (Math.abs(scrollOffset) > 15) {
      // 取消正在进行的动画
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

  // 防抖的滚动触发器
  const scrollDebounceTimer = useRef<NodeJS.Timeout | null>(null)

  // 监听光标变化 → 滚动内容使光标回到固定位置
  // 焦点效果由 TipTap Focus 扩展 + CSS 自动处理
  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      if (isProgrammaticSelection.current) return

      // 防抖处理滚动，避免快速输入时频繁滚动
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
  }, [editor, scrollToCursor])

  // 监听滚动 → 移动光标到屏幕中心对应位置
  useEffect(() => {
    if (!editor || !contentRef.current) return

    let scrollTimeout: NodeJS.Timeout | null = null
    const container = contentRef.current

    const handleScroll = () => {
      if (isProgrammaticScroll.current) return

      if (scrollTimeout) return
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null

        const containerRect = container.getBoundingClientRect()
        const targetY = containerRect.top + containerRect.height * resolvedTheme.cursorOffset
        const targetX = lastCursorX.current ?? containerRect.left + containerRect.width / 2

        try {
          const pos = editor.view.posAtCoords({ left: targetX, top: targetY })
          // 验证位置是否有效：必须在文档内部且指向有效的文本节点
          if (pos && pos.pos !== undefined && pos.inside >= 0) {
            const $pos = editor.state.doc.resolve(pos.pos)
            // 确保位置在文本块内
            if ($pos.parent.isTextblock || $pos.parent.type.name === 'paragraph') {
              isProgrammaticSelection.current = true
              editor.commands.setTextSelection(pos.pos)
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

  // 监听点击事件，触发滚动动画
  useEffect(() => {
    if (!contentRef.current) return

    const container = contentRef.current
    const handleTypewriterClick = () => {
      scrollToCursor()
    }

    container.addEventListener('typewriter-click', handleTypewriterClick)
    return () => {
      container.removeEventListener('typewriter-click', handleTypewriterClick)
    }
  }, [scrollToCursor])

  // 进入时自动 focus 并滚动
  useEffect(() => {
    if (!editor) return

    setIsTransitioning(true)
    const timer = setTimeout(() => {
      setIsTransitioning(false)
      // focus 编辑器
      editor.commands.focus('end')
      // 滚动到光标位置
      setTimeout(() => {
        scrollToCursor()
      }, 50)
    }, 100)
    return () => clearTimeout(timer)
  }, [editor, scrollToCursor])

  // ESC 键退出
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  // 标题变化
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newTitle = e.target.value
      setTitle(newTitle)
      onUpdate(note.id, { title: newTitle })
    },
    [note.id, onUpdate]
  )

  // 标题按 Enter 跳到编辑器
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        editor?.commands.focus('start')
      }
    },
    [editor]
  )

  // 自动调整标题高度
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto'
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
    }
  }, [title])

  // CSS 变量
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
      {/* 光标位置指示线 */}
      {resolvedTheme.showCursorLine && <div className="typewriter-cursor-line" />}

      {/* 内容区域 */}
      <div
        ref={contentRef}
        className={`typewriter-content focus-${resolvedTheme.focusMode}`}
      >
        <div className="typewriter-inner">
          {/* 标题 */}
          <textarea
            ref={titleRef}
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            placeholder={t.editor.titlePlaceholder}
            className="typewriter-title"
            rows={1}
          />

          {/* 编辑器 */}
          <EditorContent editor={editor} className="typewriter-editor-content" />
        </div>
      </div>

      {/* 字数统计 */}
      {resolvedTheme.showWordCount && (
        <div className="typewriter-stats">{wordCount} words</div>
      )}

      {/* 退出按钮 */}
      <button className="typewriter-exit" onClick={onExit} title="Exit (ESC)">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
