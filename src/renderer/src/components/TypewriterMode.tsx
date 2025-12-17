/**
 * TypewriterMode - 打字机模式组件
 *
 * 沉浸式写作体验，核心特性：
 * 1. 光标固定在屏幕 65% 位置，内容滚动而非光标移动
 * 2. 焦点渐变效果：当前段落清晰，相邻段落依次变淡（20 层 CSS 选择器 + 动态透明度）
 * 3. 独立的 TipTap 编辑器实例，与主编辑器完全隔离
 * 4. 支持多种 Mood 主题（墨韵、纸韵、月光）
 * 5. 打字机音效和环境音
 *
 * 焦点渐变实现：
 * - CSS: 20 层 :has() + 兄弟选择器，根据距离 .has-focus 的 block 数设置透明度
 * - JS: 根据可视区域 block 数量动态计算透明度曲线，设置 CSS 变量
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
import { BlockId } from './extensions/BlockId'
import { NoteLink } from './extensions/NoteLink'
import { TypewriterToolbar, MOOD_THEMES, type MoodTheme } from './TypewriterToolbar'
import { getCursorInfo, setCursorByBlockId, type CursorInfo } from '../utils/cursor'
import { countWordsFromEditor, countSelectedWords } from '../utils/wordCount'
import {
  playTypewriterClick,
  playTypewriterReturn,
  playAmbientSound,
  stopAmbientSound,
  cleanupAudio,
  preloadAudio,
  type AmbientSoundType,
} from './TypewriterAudio'
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

// 禅意字体栈 - 兼容 macOS 和 Windows
//
// 中文楷体优先级：
// 1. LXGW WenKai - 开源文艺楷体（需安装）
// 2. 系统楷体 - macOS: Kaiti SC, STKaiti / Windows: KaiTi, FangSong
// 3. 系统宋体 - macOS: Songti SC / Windows: SimSun
// 4. 跨平台衬线 - Georgia, serif
//
const FONT_WENKAI = [
  "'LXGW WenKai'",
  "'LXGW WenKai Screen'",
  // macOS 楷体
  "'Kaiti SC'",
  "'STKaiti'",
  // Windows 楷体
  "'KaiTi'",
  "'FangSong'",
  // 跨平台宋体（需安装）
  "'Source Han Serif SC'",
  "'Noto Serif SC'",
  // macOS 宋体
  "'Songti SC'",
  // Windows 宋体
  "'SimSun'",
  // 通用回退
  "Georgia",
  "serif"
].join(', ')

const FONT_SERIF = [
  "'Source Han Serif SC'",
  "'Noto Serif SC'",
  // macOS
  "'Songti SC'",
  // Windows
  "'SimSun'",
  "'NSimSun'",
  "Georgia",
  "serif"
].join(', ')

const FONT_MONO = [
  "'SF Mono'",           // macOS
  "'Cascadia Code'",     // Windows 11
  "'Consolas'",          // Windows
  "'JetBrains Mono'",    // 跨平台（需安装）
  "'Fira Code'",         // 跨平台（需安装）
  "Menlo",               // macOS
  "monospace"
].join(', ')

/**
 * 禅意配色参考 - 灵感来自水墨、宣纸、茶色
 * 实际主题配置已移至 TypewriterToolbar.tsx 中的 MOOD_THEMES
 *
 * 深色 - 墨韵:
 *   ink: '#1a1a1a'           浓墨背景
 *   textDark: '#e6e1db'      温暖的白（主文字）
 *   textDarkFocus: '#f5f2ed' 焦点文字
 *   textDarkDim: '#6b6560'   暗淡文字
 *
 * 浅色 - 纸韵:
 *   paper: '#f8f6f2'         宣纸背景
 *   textLight: '#2c2825'     温暖的黑（主文字）
 *   textLightFocus: '#1a1715' 焦点文字
 *   textLightDim: '#a09890'  暗淡文字
 *
 * 点缀色:
 *   vermilion: '#c45c3e'     朱砂红（与 logo 呼应）
 */

// 导出字体常量供其他地方使用
export { FONT_WENKAI, FONT_SERIF, FONT_MONO }

interface TypewriterModeProps {
  note: Note
  notes: Note[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  onExit: (cursorInfo?: CursorInfo) => void
  initialCursorInfo?: CursorInfo
}

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
  const contentRef = useRef<HTMLDivElement>(null)      // 滚动容器
  const titleRef = useRef<HTMLTextAreaElement>(null)   // 标题输入框

  // 防止循环触发的标志位
  // 问题：光标变化 → 触发滚动 → 滚动触发光标变化 → 死循环
  // 解决：用标志位区分"程序触发"和"用户触发"
  const isProgrammaticScroll = useRef(false)      // 程序触发的滚动
  const isProgrammaticSelection = useRef(false)   // 程序触发的选区变化
  const lastCursorX = useRef<number | null>(null) // 上次光标的 X 坐标（滚动时保持水平位置）
  const isInitializing = useRef(true)             // 初始化阶段标记，阻止滚动监听器修改光标

  // ==================== State ====================
  const [title, setTitle] = useState(note.title)
  const [wordCount, setWordCount] = useState(0)
  const [selectedWordCount, setSelectedWordCount] = useState<number | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(true)  // 进入动画状态

  // Mood 主题状态（默认根据系统主题选择）
  const { resolvedColorMode } = useTheme()
  const defaultMood = resolvedColorMode === 'light' ? 'paper' : 'ink'
  const [currentMood, setCurrentMood] = useState(defaultMood)

  // 音效状态
  const [typewriterSoundEnabled, setTypewriterSoundEnabled] = useState(false)
  const [ambientSound, setAmbientSound] = useState('none')

  // 全屏状态
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ==================== Hooks ====================
  const t = useTranslations()

  // 根据 Mood 主题生成完整的主题配置
  const currentMoodTheme = MOOD_THEMES.find(m => m.id === currentMood) || MOOD_THEMES[0]
  const resolvedTheme: TypewriterTheme = {
    backgroundColor: currentMoodTheme.backgroundColor,
    textColor: currentMoodTheme.textColor,
    focusTextColor: currentMoodTheme.focusTextColor,
    dimmedTextColor: currentMoodTheme.dimmedTextColor,
    accentColor: currentMoodTheme.accentColor,
    fontFamily: FONT_WENKAI,
    fontSize: '19px',
    lineHeight: 2.2,
    letterSpacing: '0.05em',
    maxWidth: '640px',
    cursorOffset: 0.65,
    paddingHorizontal: '4rem',
    focusMode: 'paragraph',
    dimOpacity: 0.35,
    showCursorLine: false,
    cursorLineColor: 'rgba(0, 0, 0, 0.02)',
    showWordCount: true,
  }

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
      setWordCount(countWordsFromEditor(editor))
    },
  })

  // ==================== 滚动动画 ====================
  // 使用 requestAnimationFrame 实现 60fps 流畅滚动动画
  const animationFrameId = useRef<number | null>(null)
  const scrollAnimationStart = useRef<number | null>(null)
  const scrollAnimationFrom = useRef<number>(0)
  const scrollAnimationTo = useRef<number>(0)

  /**
   * 滚动动画帧回调
   * 使用 easeOutCubic 缓动函数实现自然的减速效果
   */
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

  /**
   * 滚动内容使光标回到固定位置（屏幕 65%）
   *
   * 调用时机：
   * - 光标位置变化时（打字、方向键、点击）
   * - 进入打字机模式时
   */
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

  // ==================== 事件监听 ====================

  const scrollDebounceTimer = useRef<NodeJS.Timeout | null>(null)

  /**
   * 根据可视区域动态计算透明度 CSS 变量
   * CSS 选择器固定 20 层，透明度值动态计算
   */
  const updateOpacityVariables = useCallback(() => {
    if (!contentRef.current) return

    const container = contentRef.current
    const proseMirror = container.querySelector('.ProseMirror')
    if (!proseMirror) return

    const blocks = Array.from(proseMirror.children) as HTMLElement[]
    if (blocks.length === 0) return

    // 估算可视区域能显示多少 block
    const viewportHeight = window.innerHeight
    let totalHeight = 0
    let sampleCount = 0
    for (let i = 0; i < Math.min(blocks.length, 10); i++) {
      const rect = blocks[i].getBoundingClientRect()
      if (rect.height > 0) {
        totalHeight += rect.height
        sampleCount++
      }
    }
    const avgBlockHeight = sampleCount > 0 ? totalHeight / sampleCount : 60
    const visibleBlockCount = Math.max(6, Math.floor(viewportHeight / avgBlockHeight))
    const halfVisible = visibleBlockCount / 2

    // 动态计算每层透明度
    const minOpacity = 0.03
    const containerEl = contentRef.current.closest('.typewriter-container') as HTMLElement
    if (!containerEl) return

    for (let dist = 1; dist <= 20; dist++) {
      // 平缓曲线：在 halfVisible 处到达最低透明度
      const ratio = Math.min(dist / halfVisible, 1)
      const opacity = 1 - (1 - minOpacity) * Math.pow(ratio, 1.5)
      containerEl.style.setProperty(`--tw-opacity-${dist}`, opacity.toFixed(2))
    }
    containerEl.style.setProperty('--tw-opacity-far', minOpacity.toFixed(2))
  }, [])

  /**
   * 监听光标变化 → 滚动内容使光标回到固定位置 + 更新选中字数
   */
  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      // 更新选中字数
      setSelectedWordCount(countSelectedWords(editor))

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

  /**
   * 监听滚动 → 移动光标到屏幕中心对应位置
   *
   * 当用户手动滚动时，光标会跟随到屏幕固定位置对应的文档位置
   * 保持上次光标的 X 坐标，避免水平跳动
   */
  useEffect(() => {
    if (!editor || !contentRef.current) return

    let scrollTimeout: NodeJS.Timeout | null = null
    const container = contentRef.current

    const handleScroll = () => {
      // 初始化阶段或程序触发的滚动，不修改光标
      if (isInitializing.current || isProgrammaticScroll.current) return

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

  /**
   * 监听点击事件，触发滚动动画
   *
   * 点击不直接定位光标，而是触发平滑滚动动画
   * 让点击位置来到屏幕固定位置
   */
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

  /**
   * 进入打字机模式时的初始化
   * - 播放进入动画
   * - 如果有初始光标位置，使用它；否则聚焦到编辑器末尾
   * - 滚动到光标位置
   * - 初始化字数统计
   */
  useEffect(() => {
    if (!editor) return

    // 初始化字数统计
    setWordCount(countWordsFromEditor(editor))

    const hasInitialCursor = initialCursorInfo && initialCursorInfo.blockId && initialCursorInfo.blockId !== ''

    setIsTransitioning(true)
    const timer = setTimeout(() => {
      setIsTransitioning(false)

      if (!hasInitialCursor) {
        // 没有初始光标，focus 到末尾
        editor.commands.focus('end')
        setTimeout(() => {
          scrollToCursor()
          updateOpacityVariables()
          // 初始化完成
          setTimeout(() => {
            isInitializing.current = false
          }, 300)
        }, 50)
      } else {
        // 有初始光标，设置光标位置
        const success = setCursorByBlockId(editor, initialCursorInfo)

        // 等待 ProseMirror 完成 DOM 更新
        setTimeout(() => {
          updateOpacityVariables()
          // 滚动到光标位置
          if (success) {
            scrollToCursor()
          }
          // 初始化完成，允许滚动监听器修改光标
          setTimeout(() => {
            isInitializing.current = false
          }, 300)
        }, 150)
      }
    }, 150)

    return () => clearTimeout(timer)
  }, [editor, scrollToCursor, updateOpacityVariables, initialCursorInfo])

  /** 窗口大小变化时重新计算（带防抖） */
  useEffect(() => {
    let resizeTimer: NodeJS.Timeout | null = null
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        updateOpacityVariables()
      }, 150)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [updateOpacityVariables])

  /** 退出并传递光标位置 */
  const handleExit = useCallback(() => {
    const cursorInfo = getCursorInfo(editor)
    onExit(cursorInfo || undefined)
  }, [editor, onExit])

  /** ESC 键退出打字机模式 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  // ==================== 标题处理 ====================

  /** 标题内容变化 */
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newTitle = e.target.value
      setTitle(newTitle)
      onUpdate(note.id, { title: newTitle })
    },
    [note.id, onUpdate]
  )

  /** 标题按 Enter 跳到编辑器正文 */
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        editor?.commands.focus('start')
      }
    },
    [editor]
  )

  // ==================== 工具栏处理 ====================

  /** 切换 Mood 主题 */
  const handleMoodChange = useCallback((mood: MoodTheme) => {
    setCurrentMood(mood.id)
  }, [])

  /** 切换全屏 */
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

  /** 监听全屏状态变化 */
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  /** 切换打字机音效 */
  const handleToggleTypewriterSound = useCallback(() => {
    setTypewriterSoundEnabled(prev => !prev)
  }, [])

  /** 切换背景音乐 */
  const handleAmbientSoundChange = useCallback((soundId: string) => {
    setAmbientSound(soundId)
    // 立即播放/停止背景音乐
    if (soundId === 'none') {
      stopAmbientSound()
    } else {
      playAmbientSound(soundId as AmbientSoundType, 0.3)
    }
  }, [])

  /**
   * 监听按键 → 播放打字机音效
   */
  useEffect(() => {
    if (!editor || !typewriterSoundEnabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略修饰键和功能键
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length > 1 && e.key !== 'Enter' && e.key !== 'Backspace') return

      if (e.key === 'Enter') {
        playTypewriterReturn()
      } else {
        playTypewriterClick()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editor, typewriterSoundEnabled])

  /**
   * 预加载打字音效 & 清理音频资源
   */
  useEffect(() => {
    preloadAudio()
    return () => {
      cleanupAudio()
    }
  }, [])

  /** 自动调整标题输入框高度 */
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto'
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
    }
  }, [title])

  // ==================== 渲染 ====================

  /**
   * CSS 变量 - 主题配置通过 CSS 变量传递给样式
   * 这样可以在 CSS 中使用 var(--tw-xxx) 引用主题值
   */
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

      {/* 底部工具栏 */}
      <TypewriterToolbar
        wordCount={wordCount}
        selectedWordCount={selectedWordCount}
        currentMood={currentMood}
        onMoodChange={handleMoodChange}
        onToggleFullscreen={handleToggleFullscreen}
        onExit={handleExit}
        isFullscreen={isFullscreen}
        typewriterSoundEnabled={typewriterSoundEnabled}
        onToggleTypewriterSound={handleToggleTypewriterSound}
        ambientSound={ambientSound}
        onAmbientSoundChange={handleAmbientSoundChange}
      />
    </div>
  )
}
