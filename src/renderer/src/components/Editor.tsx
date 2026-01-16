import { useEffect, useCallback, useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { useEditor, EditorContent, Editor as TiptapEditor } from '@tiptap/react'
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
// 移除默认 Image，使用 ResizableImage
import { textblockTypeInputRule } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Note } from '../types/note'
import type { AgentExecutionContext } from '../../../shared/types'
import { useTranslations } from '../i18n'
import { useTheme } from '../theme'
import { NoteLink } from './extensions/NoteLink'
import { BlockId } from './extensions/BlockId'
import { NoteLinkPopup, type SearchMode, type HeadingInfo, type BlockInfo } from './NoteLinkPopup'
import { getCursorInfo, getCursorContext, type CursorInfo, type CursorContext } from '../utils/cursor'
import { countWordsFromEditor, countSelectedWords } from '../utils/wordCount'
// 新增扩展
import { CustomHighlight } from './extensions/Highlight'
import { CustomUnderline } from './extensions/Underline'
import { TextStyle, Color } from './extensions/TextColor'
import { SlashCommand } from './extensions/SlashCommand'
import { slashCommandSuggestion } from './extensions/slashCommandSuggestion'
import { ColorPicker } from './ColorPicker'
// 新增 v0.3 扩展
import { Callout } from './extensions/Callout'
import { Toggle } from './extensions/Toggle'
import { ResizableImage } from './extensions/ResizableImage'
import { Mathematics, BlockMath } from './extensions/Mathematics'
import { Mermaid } from './extensions/Mermaid'
import { Video } from './extensions/Video'
import { Audio } from './extensions/Audio'
import { FileAttachment } from './extensions/FileAttachment'
import { Footnote } from './extensions/Footnote'
import { CustomCodeBlock } from './extensions/CodeBlock'
import { MarkdownPaste, looksLikeMarkdown, markdownToHtml } from './extensions/MarkdownPaste'
import { CustomKeyboardShortcuts } from './extensions/CustomKeyboardShortcuts'
import { CustomHorizontalRule } from './extensions/HorizontalRule'
import { AIPreview } from './extensions/AIPreview'
import { AIPopupMark } from './extensions/AIPopupMark'
import { AgentTask } from './extensions/AgentTask'
import { HtmlComment } from './extensions/HtmlComment'
import { TransclusionBlock } from './extensions/TransclusionBlock'
import { EmbedBlock } from './extensions/EmbedBlock'
import { DataviewBlock } from './extensions/DataviewBlock'
import { TocBlock } from './extensions/TocBlock'
import { AgentBlock } from './extensions/AgentBlock'
import { EditorSearch, editorSearchPluginKey } from './extensions/EditorSearch'
import { SearchBar } from './SearchBar'
import { FileHandler } from '@tiptap/extension-file-handler'
import { EditorContextMenu } from './EditorContextMenu'
import { ExportMenu } from './ExportMenu'
import { isWindows } from '../utils/platform'
import { AgentTaskPanel } from './AgentTaskPanel'
import { AgentTaskIndicators } from './AgentTaskIndicators'
import { initTaskCache, refreshTaskCache, deleteTaskByBlockId, preloadTasksByBlockIds, updateTask } from '../utils/agentTaskStorage'
import { setupOutputListener } from '../utils/editorOutputHandler'
import { useAIActions } from '../hooks/useAIActions'
import { useAIWriting } from '../hooks/useAIWriting'
import { getAIContext, getMarkdownContent, getNearestHeadingForBlock } from '../utils/aiContext'
import { getFileCategory, getExtensionFromMime } from '../utils/fileCategory'
import { shortcuts } from '../utils/shortcuts'
import { convertToEmbedUrl } from '../utils/embedUrl'
import { ScrollText } from 'lucide-react'
import 'katex/dist/katex.min.css'
import './Editor.css'

// 光标占位符常量 (Invisible Separator)
const CURSOR_PLACEHOLDER = '\u2063'

// Editor layout constants (keep in sync with Editor.css)
const HEADER_HEIGHT = 42

/**
 * 处理模板中的光标占位符
 * 找到 \u2063 字符，将光标移动到该位置，然后删除占位符
 */
function handleCursorPlaceholder(editor: TiptapEditor) {
  if (editor.isDestroyed) return

  const doc = editor.state.doc
  let cursorPos: number | null = null

  // 遍历文档查找光标占位符
  doc.descendants((node, pos) => {
    if (cursorPos !== null) return false // 已找到，停止遍历

    if (node.isText && node.text) {
      const index = node.text.indexOf(CURSOR_PLACEHOLDER)
      if (index !== -1) {
        cursorPos = pos + index
        return false
      }
    }
    return true
  })

  if (cursorPos !== null) {
    // 延迟执行，确保 DOM 已更新
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return

      // 删除占位符并设置光标位置
      editor
        .chain()
        .focus()
        .deleteRange({ from: cursorPos!, to: cursorPos! + 1 })
        .setTextSelection(cursorPos!)
        .run()
    })
  }
}

// 关闭分屏按钮组件
function PaneCloseButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-tertiary)] opacity-50 hover:opacity-100 hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-all"
      title={title}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 2L10 10M10 2L2 10" />
      </svg>
    </button>
  )
}

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
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
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
  typewriter: <ScrollText size={16} />,
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
  highlight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  ),
  underline: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  ),
  textColor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16" />
      <path d="m6 16 6-12 6 12" />
      <path d="M8 12h8" />
    </svg>
  ),
  sparkles: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
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

  addKeyboardShortcuts() {
    return {
      // 空 heading 按 Backspace 时删除当前节点，光标移到上一个节点末尾
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        const { $from } = selection

        // 只处理光标在 heading 开头的情况
        if ($from.parentOffset !== 0) return false

        const node = $from.parent
        if (node.type.name !== 'heading') return false

        // 只处理空 heading
        if (node.textContent !== '') return false

        // 删除当前 heading 节点，光标移到前一个位置
        const pos = $from.before()
        if (pos > 0) {
          editor.chain()
            .deleteRange({ from: pos, to: pos + node.nodeSize })
            .setTextSelection(Math.max(0, pos - 1))
            .focus()
            .run()
          return true
        }

        return false
      },
    }
  },
})

// 重新导出 CursorInfo 和 CursorContext 供外部使用
export type { CursorInfo, CursorContext } from '../utils/cursor'

interface EditorProps {
  note: Note | null
  notes: Note[]
  notebooks?: import('../types/note').Notebook[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  onSelectNote?: (noteId: string) => void
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: (found: boolean) => void
  onTypewriterModeToggle?: (cursorInfo: CursorInfo) => void
  onSelectionChange?: (blockId: string | null, selectedText: string | null, cursorContext: CursorContext | null) => void
  // 分屏控制
  onSplitHorizontal?: () => void
  onSplitVertical?: () => void
  onClosePane?: () => void
  showPaneControls?: boolean
  // 是否是焦点 pane（用于自动聚焦）
  isFocused?: boolean
}

// 暴露给外部的 Editor 实例接口
export interface EditorHandle {
  getEditor: () => ReturnType<typeof useEditor> | null
}

// Zen Editor component
interface ZenEditorProps {
  note: Note
  notes: Note[]
  notebooks?: import('../types/note').Notebook[]
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: (found: boolean) => void
  onTypewriterModeToggle?: (cursorInfo: CursorInfo) => void
  onSelectionChange?: (blockId: string | null, selectedText: string | null, cursorContext: CursorContext | null) => void
  // 分屏控制
  onSplitHorizontal?: () => void
  onSplitVertical?: () => void
  onClosePane?: () => void
  showPaneControls?: boolean
  // 是否是焦点 pane（用于自动聚焦）
  isFocused?: boolean
}

const ZenEditor = forwardRef<EditorHandle, ZenEditorProps>(function ZenEditor({
  note,
  notes,
  notebooks = [],
  onUpdate,
  onNoteClick,
  onCreateNote,
  scrollTarget,
  onScrollComplete,
  onTypewriterModeToggle,
  onSelectionChange,
  onSplitHorizontal,
  onSplitVertical,
  onClosePane,
  showPaneControls,
  isFocused,
}, ref) {
  const [title, setTitle] = useState(note.title)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isTypewriterMode, setIsTypewriterMode] = useState(false)
  const [showToolbar, setShowToolbar] = useState(false)
  const [selectedWordCount, setSelectedWordCount] = useState<number | null>(null)
  const [isEditingHeaderTitle, setIsEditingHeaderTitle] = useState(false)
  const [isTitleHidden, setIsTitleHidden] = useState(false)

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

  // 右键菜单状态
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [contextMenuHasSelection, setContextMenuHasSelection] = useState(false)

  // Agent Task Panel 状态
  const [agentTaskPanelOpen, setAgentTaskPanelOpen] = useState(false)
  const [agentTaskBlockIds, setAgentTaskBlockIds] = useState<string[]>([])
  const [agentTaskId, setAgentTaskId] = useState<string | null>(null)
  const [agentTaskBlockContent, setAgentTaskBlockContent] = useState<string>('')
  const [agentTaskExecutionContext, setAgentTaskExecutionContext] = useState<AgentExecutionContext | null>(null)

  // Transclusion 选择弹窗状态
  const [showTransclusionPopup, setShowTransclusionPopup] = useState(false)
  const [transclusionSearchMode, setTransclusionSearchMode] = useState<SearchMode>('note')
  const [selectedTransclusionNote, setSelectedTransclusionNote] = useState<Note | null>(null)
  const [transclusionHeadings, setTransclusionHeadings] = useState<HeadingInfo[]>([])
  const [transclusionBlocks, setTransclusionBlocks] = useState<BlockInfo[]>([])
  const [transclusionQuery, setTransclusionQuery] = useState('')
  const [transclusionEditCallback, setTransclusionEditCallback] = useState<((attrs: Record<string, unknown>) => void) | null>(null)

  // Embed 弹窗状态
  const [showEmbedPopup, setShowEmbedPopup] = useState(false)
  const [embedUrl, setEmbedUrl] = useState('')

  // 搜索栏状态
  const [showSearchBar, setShowSearchBar] = useState(false)

  const t = useTranslations()
  const { resolvedColorMode } = useTheme()
  const resolvedNoteTitle = note.title || t.editor?.untitled || 'Untitled'
  const currentNotebookName = notebooks.find(nb => nb.id === note.notebook_id)?.name || ''
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const headerTitleRef = useRef<HTMLInputElement>(null)
  const headerTitleClickPosRef = useRef<number | null>(null)

  // Ref for AgentTask panel callback (to avoid circular dependency with useEditor)
  const openAgentTaskRef = useRef<(blockIds: string[], taskId: string | null, blockContent: string) => void>(() => {})

  // 处理文件插入（粘贴或拖拽）
  const handleFileInsert = async (
    editorInstance: TiptapEditor,
    file: File,
    pos?: number
  ) => {
    if (!editorInstance) return

    // 确定插入位置
    // - 如果 pos 有效且在文档范围内，使用 pos（拖拽到具体位置）
    // - 如果 pos 无效或超出范围，插入到文档末尾（拖拽到空白区域）
    // - 如果 pos 是 undefined，在当前光标位置插入（粘贴）
    const docSize = editorInstance.state.doc.content.size
    let insertPos: number | undefined = pos
    if (pos !== undefined && (pos < 0 || pos > docSize)) {
      // 拖拽位置无效，插入到文档末尾
      insertPos = docSize
    }

    // 前端文件大小检查（100MB），避免读取超大文件到内存
    const MAX_FILE_SIZE = 100 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      const sizeInMB = (file.size / 1024 / 1024).toFixed(1)
      alert(`${t.fileError.tooLarge}: ${file.name}\n${t.fileError.tooLargeDetail.replace('{size}', sizeInMB)}`)
      return
    }

    try {
      // 读取文件为 ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)

      // 获取扩展名
      const ext = file.name.includes('.')
        ? file.name.split('.').pop()!.toLowerCase()
        : getExtensionFromMime(file.type)

      // 保存到附件目录
      const result = await window.electron.attachment.saveBuffer(buffer, ext, file.name)
      const category = getFileCategory(file.name) || getFileCategory(`.${ext}`)

      // 构建 attachment:// URL
      const attachmentUrl = `attachment://${result.relativePath}`

      // 根据类型插入不同节点
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
          // 其他文件类型使用 FileAttachment
          if (insertPos !== undefined) {
            editorInstance.chain().focus().insertContentAt(insertPos, {
              type: 'fileAttachment',
              attrs: {
                src: result.relativePath,
                name: result.name,
                size: result.size,
                type: result.type,
              },
            }).run()
          } else {
            editorInstance.commands.setFileAttachment({
              src: result.relativePath,
              name: result.name,
              size: result.size,
              type: result.type,
            })
          }
      }
    } catch (error) {
      console.error('Failed to insert file:', error)
      // 显示用户友好的错误提示
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('too large')) {
        alert(`${t.fileError.tooLarge}: ${file.name}\n${message}`)
      } else {
        alert(`${t.fileError.insertFailed}: ${file.name}\n${message}`)
      }
    }
  }

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
        codeBlock: false, // Disable default codeBlock, use custom
        link: false, // Disable default link, use custom Link below
        underline: false, // Disable default underline, use CustomUnderline
        horizontalRule: false, // Disable default, use CustomHorizontalRule
      }),
      CustomHorizontalRule,
      CustomCodeBlock,
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
      ResizableImage,
      BlockId,
      // v0.3 扩展
      Callout,
      Toggle,
      Mathematics,
      BlockMath,
      Mermaid,
      Video,
      Audio,
      FileAttachment,
      Footnote,
      HtmlComment,
      // 新增扩展
      CustomHighlight,
      CustomUnderline,
      TextStyle,
      Color,
      SlashCommand.configure({
        suggestion: slashCommandSuggestion,
      }),
      MarkdownPaste,
      CustomKeyboardShortcuts,
      AIPreview.configure({
        labels: {
          accept: t.ai.previewAccept,
          reject: t.ai.previewReject,
          regenerate: t.ai.previewRegenerate
        }
      }),
      AIPopupMark,
      AgentTask.configure({
        onOpenPanel: (blockId: string, taskId: string | null, blockContent: string) => {
          openAgentTaskRef.current([blockId], taskId, blockContent)
        },
      }),
      NoteLink.configure({
        onNoteClick: (noteId: string, _noteTitle: string, target?: { type: 'heading' | 'block'; value: string }) => {
          onNoteClick(noteId, target)
        },
      }),
      TransclusionBlock.configure({
        onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => {
          onNoteClick(noteId, target)
        },
      }),
      EmbedBlock,
      DataviewBlock,
      TocBlock,
      AgentBlock,
      EditorSearch.configure({
        skipNodeTypes: ['mathematics', 'mermaid', 'codeBlock', 'embed'],
      }),
      FileHandler.configure({
        // 不限制 MIME 类型，允许所有文件类型
        // 类型检查在 handleFileInsert 中通过 getFileCategory 处理
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
      attributes: {
        class: `zen-editor ${isFocusMode ? 'focus-mode' : ''}`,
        spellcheck: 'false',
        'data-note-id': note.id,
        'data-note-title': resolvedNoteTitle,
        'data-notebook-id': note.notebook_id || '',
        'data-notebook-name': currentNotebookName,
      },
      // 自定义剪贴板纯文本序列化，正确处理列表格式
      clipboardTextSerializer: (slice) => {
        const lines: string[] = []

        const serializeNode = (node: PMNode, indent: number = 0, listType?: 'bullet' | 'ordered' | 'task', listIndex?: number) => {
          const indentStr = '  '.repeat(indent)

          if (node.type.name === 'bulletList') {
            node.content.forEach((child) => {
              serializeNode(child, indent, 'bullet')
            })
          } else if (node.type.name === 'orderedList') {
            let idx = 1
            node.content.forEach((child) => {
              serializeNode(child, indent, 'ordered', idx++)
            })
          } else if (node.type.name === 'taskList') {
            node.content.forEach((child) => {
              serializeNode(child, indent, 'task')
            })
          } else if (node.type.name === 'listItem') {
            const prefix = listType === 'ordered' ? `${listIndex}. ` : '• '
            // Only get text from non-list children (paragraphs etc.), exclude nested lists
            const textParts: string[] = []
            node.content.forEach((child) => {
              if (!['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
                const childText = child.textContent
                if (childText) textParts.push(childText)
              }
            })
            const text = textParts.join(' ')
            if (text) {
              lines.push(indentStr + prefix + text)
            }
            // Handle nested lists
            node.content.forEach((child) => {
              if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
                serializeNode(child, indent + 1)
              }
            })
          } else if (node.type.name === 'taskItem') {
            const checked = node.attrs?.checked ? '☑' : '☐'
            // Only get text from non-list children (paragraphs etc.), exclude nested lists
            const textParts: string[] = []
            node.content.forEach((child) => {
              if (!['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
                const childText = child.textContent
                if (childText) textParts.push(childText)
              }
            })
            const text = textParts.join(' ')
            if (text) {
              lines.push(indentStr + checked + ' ' + text)
            }
            // Handle nested lists
            node.content.forEach((child) => {
              if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
                serializeNode(child, indent + 1)
              }
            })
          } else if (node.isBlock) {
            const text = node.textContent
            if (text) {
              lines.push(text)
            } else if (node.type.name === 'paragraph' && lines.length > 0) {
              // Empty paragraph = blank line, but not at start
              lines.push('')
            }
          }
        }

        slice.content.forEach((node) => {
          serializeNode(node)
        })

        return lines.join('\n')
      },
      // 处理外部链接点击
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement
        const link = target.closest('a.zen-link')
        if (link) {
          const href = link.getAttribute('href')
          if (href) {
            event.preventDefault()
            window.electron.shell.openExternal(href)
            return true
          }
        }
        return false
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
        if (coords) {
          setLinkPopupPosition({
            top: coords.bottom + 8,
            left: coords.left,
          })
          setShowLinkPopup(true)
        }
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

  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    const attrs: Record<string, string> = {
      'data-note-id': note.id,
      'data-note-title': resolvedNoteTitle,
      'data-notebook-id': note.notebook_id || '',
      'data-notebook-name': currentNotebookName,
    }
    Object.entries(attrs).forEach(([key, value]) => {
      if (value) {
        root.setAttribute(key, value)
      } else {
        root.removeAttribute(key)
      }
    })
  }, [editor, note.id, note.notebook_id, resolvedNoteTitle, currentNotebookName])

  // AI actions hook
  const { getContextMenuActions } = useAIActions()
  const aiActions = getContextMenuActions()

  // AI Writing hook for executing actions
  const { executeAction: executeAIAction, isProcessing: isAIProcessing } = useAIWriting({
    editor,
    onComplete: () => {
      editor?.commands.focus()
    },
    onError: (errorCode) => {
      console.error('[AI Writing] Error:', errorCode)
    }
  })

  const handleAIActionClick = useCallback((action: AIAction) => {
    if (!editor) return
    const context = getAIContext(editor)
    if (!context) return

    const insertMode = action.mode === 'insert' ? 'insertAfter' : 'replace'
    executeAIAction(action.prompt, context, insertMode)
  }, [editor, executeAIAction])

  // 跟踪编辑器自身的内容版本，用于区分外部更新和内部更新
  const editorContentRef = useRef<string | null>(null)
  // 用于取消过时的 queueMicrotask（防止快速切换笔记时竞态条件）
  const syncVersionRef = useRef(0)
  // 跟踪上次的 note.id，用于检测切换笔记
  const prevSyncNoteIdRef = useRef<string | null>(null)

  // 处理导入内容插入（用于 ExportMenu 的 Import 功能和模板插入）
  const handleInsertContent = useCallback(async (content: string) => {
    if (!editor) return

    // 检测是否是 Tiptap JSON 格式（模板内容）
    try {
      const parsed = JSON.parse(content)
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
        // 直接插入 JSON 文档的 content 数组
        editor.commands.insertContent(parsed.content)
        return
      }
    } catch {
      // 不是 JSON，继续作为 Markdown 处理
    }

    // 使用后端的 markdownToTiptap 进行完整转换（支持 dataview、agent、toc 等特殊 block）
    try {
      const tiptapJson = await window.electron.markdown.toTiptap(content)
      const parsed = JSON.parse(tiptapJson)
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
        editor.commands.insertContent(parsed.content)
        return
      }
    } catch (error) {
      console.error('Failed to convert markdown to Tiptap:', error)
    }

    // 降级：使用简单的 HTML 转换
    const html = markdownToHtml(content)
    editor.commands.insertContent(html, {
      parseOptions: { preserveWhitespace: false },
    })
  }, [editor])

  // 打开编辑器内搜索
  const handleOpenSearch = useCallback(() => {
    if (!editor) return
    editor.commands.openSearch()
  }, [editor])

  // 同步外部内容变化到编辑器（长期主义方案：避免重建编辑器）
  // 场景：从打字机模式退出后，note.content 已更新，需要同步到编辑器
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    // 递增版本号，使之前的 microtask 失效
    const version = ++syncVersionRef.current

    // 检测是否是切换笔记（排除首次渲染）
    const isNoteSwitch = prevSyncNoteIdRef.current !== null && prevSyncNoteIdRef.current !== note.id
    prevSyncNoteIdRef.current = note.id

    // 如果这是编辑器自己刚刚产生的更新，跳过同步
    if (editorContentRef.current === note.content) {
      return
    }

    // 如果编辑器有焦点且不是切换笔记，说明用户正在输入，跳过同步
    // 这避免了异步数据库更新导致的竞态条件
    if (editor.isFocused && !isNoteSwitch) {
      return
    }

    // 解析外部传入的内容
    const parseContent = () => {
      if (!note.content || note.content === '[]' || note.content === '') {
        return { type: 'doc', content: [] }
      }
      try {
        const parsed = JSON.parse(note.content)
        if (parsed.type === 'doc') return parsed
        return { type: 'doc', content: [] }
      } catch {
        // JSON 解析失败，可能是纯文本或 Markdown
        // 检测是否是 Markdown，如果是则转换
        if (looksLikeMarkdown(note.content)) {
          // 使用 insertContent 而不是 setContent，触发 Markdown 转换
          // 需要返回 null 作为标记
          return null
        }
        // 纯文本，包装成 paragraph
        return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: note.content }] }] }
      }
    }

    const externalContent = parseContent()

    // 如果是 Markdown，使用 insertContent 转换
    if (externalContent === null) {
      const html = markdownToHtml(note.content)
      // 使用 queueMicrotask 避免 flushSync 警告
      queueMicrotask(() => {
        // 版本检查：如果已有新的同步请求，跳过此次（防止快速切换笔记时竞态）
        if (syncVersionRef.current !== version || editor.isDestroyed) return
        editor.commands.setContent('', { emitUpdate: false }) // 先清空
        editor.commands.insertContent(html, {
          parseOptions: {
            preserveWhitespace: false,
          },
        })
        editorContentRef.current = JSON.stringify(editor.getJSON())
      })
      return
    }

    // 切换笔记时直接 setContent，跳过内容比较（性能优化）
    if (isNoteSwitch) {
      const contentToSync = note.content
      queueMicrotask(() => {
        if (syncVersionRef.current !== version || editor.isDestroyed) return
        editor.commands.setContent(externalContent, { emitUpdate: false })
        editorContentRef.current = contentToSync
        // 处理模板中的光标占位符 \u2063
        handleCursorPlaceholder(editor)
      })
      return
    }

    // 同一笔记的外部更新，需要比较内容避免不必要的 setContent
    const currentContent = JSON.stringify(editor.getJSON())
    const externalContentStr = JSON.stringify(externalContent)

    if (currentContent !== externalContentStr) {
      const contentToSync = note.content
      // 使用 queueMicrotask 避免 flushSync 警告
      queueMicrotask(() => {
        // 版本检查：如果已有新的同步请求，跳过此次（防止快速切换笔记时竞态）
        if (syncVersionRef.current !== version || editor.isDestroyed) return
        // 使用 setContent 同步，emitUpdate: false 避免触发 onUpdate 回调造成循环
        editor.commands.setContent(externalContent, { emitUpdate: false })
        editorContentRef.current = contentToSync
      })
    }
  }, [editor, note.content, note.id])

  // 在 onUpdate 中记录编辑器产生的内容
  useEffect(() => {
    if (!editor) return

    const updateHandler = () => {
      editorContentRef.current = JSON.stringify(editor.getJSON())
    }

    editor.on('update', updateHandler)
    return () => {
      editor.off('update', updateHandler)
    }
  }, [editor])

  // 首次加载时处理光标占位符（模板中的 {{cursor}}）
  useEffect(() => {
    if (!editor) return
    // 延迟执行，确保编辑器内容已完全加载
    const timer = setTimeout(() => {
      handleCursorPlaceholder(editor)
    }, 100)
    return () => clearTimeout(timer)
  }, [editor, note.id])

  // 监听搜索状态变化
  useEffect(() => {
    if (!editor) return

    const handleTransaction = () => {
      const state = editorSearchPluginKey.getState(editor.state)
      if (state) {
        setShowSearchBar(state.isOpen)
      }
    }

    // 初始检查
    handleTransaction()

    editor.on('transaction', handleTransaction)
    return () => {
      editor.off('transaction', handleTransaction)
    }
  }, [editor])

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

  // Track blocks for cleanup, edit detection, and agent task caching
  const previousAgentBlocksRef = useRef<Set<string>>(new Set())
  // Store both textContent and nodeSize to detect text changes and structure changes (e.g., adding rows)
  const managedBlockContentRef = useRef<Map<string, { text: string; size: number }>>(new Map())
  const blockScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialScanRef = useRef(true)

  // Combined: Agent task cache init, managed blocks edit detection, and deleted blocks cleanup
  // Uses single document traversal for better performance on large documents
  useEffect(() => {
    if (!editor) return

    // Reset state when note changes
    previousAgentBlocksRef.current = new Set()
    managedBlockContentRef.current = new Map()
    isInitialScanRef.current = true
    initTaskCache() // Clear old cache for new note

    const scanBlocks = async () => {
      // Skip if editor was destroyed (e.g., quick note switch)
      if (editor.isDestroyed) return

      const currentAgentBlocks = new Set<string>()
      const currentManagedContent = new Map<string, { text: string; size: number }>()
      const agentBlockIds: string[] = []

      // Single traversal for all purposes
      editor.state.doc.descendants((node) => {
        const blockId = node.attrs.blockId
        if (!blockId) return

        // Collect agent task blocks
        if (node.attrs.agentTaskId) {
          currentAgentBlocks.add(blockId)
          agentBlockIds.push(blockId)
        }

        // Collect managed blocks and check for edits
        if (node.attrs.managedBy) {
          const textContent = node.textContent
          const nodeSize = node.nodeSize
          currentManagedContent.set(blockId, { text: textContent, size: nodeSize })

          // Check if content or structure changed from previous snapshot (skip on initial scan)
          if (!isInitialScanRef.current) {
            const previous = managedBlockContentRef.current.get(blockId)
            // Detect text changes OR structure changes (e.g., adding table rows)
            if (previous !== undefined && (previous.text !== textContent || previous.size !== nodeSize)) {
              // Content/structure changed, user edited the block - clear managedBy
              setTimeout(() => {
                editor.commands.clearManagedBy(blockId)
              }, 0)
            }
          }
        }
      })

      // On initial scan: preload agent tasks and refresh decorations
      if (isInitialScanRef.current) {
        isInitialScanRef.current = false
        if (agentBlockIds.length > 0) {
          await preloadTasksByBlockIds(agentBlockIds)
        }
        if (!editor.isDestroyed) {
          editor.commands.refreshAgentTaskDecorations()
        }
      } else {
        // On subsequent scans: check for deleted agent blocks
        const deletedBlocks = Array.from(previousAgentBlocksRef.current).filter(
          (blockId) => !currentAgentBlocks.has(blockId)
        )
        for (const blockId of deletedBlocks) {
          editor.commands.deleteManagedBlocks(blockId)
          deleteTaskByBlockId(blockId).catch((err) => {
            console.error('Failed to clean up agent task for deleted block:', blockId, err)
          })
        }
      }

      // Update refs
      previousAgentBlocksRef.current = currentAgentBlocks
      managedBlockContentRef.current = currentManagedContent
    }

    // Debounced version for edit events
    const debouncedScanBlocks = () => {
      if (blockScanTimeoutRef.current) {
        clearTimeout(blockScanTimeoutRef.current)
      }
      blockScanTimeoutRef.current = setTimeout(scanBlocks, 200)
    }

    // Initial scan - delayed to let UI render first
    blockScanTimeoutRef.current = setTimeout(scanBlocks, 100)

    editor.on('update', debouncedScanBlocks)
    return () => {
      editor.off('update', debouncedScanBlocks)
      if (blockScanTimeoutRef.current) {
        clearTimeout(blockScanTimeoutRef.current)
      }
    }
  }, [editor, note.id])

  // Set up listener for agent output insertion
  useEffect(() => {
    if (!editor) return

    const cleanup = setupOutputListener(
      () => editor,
      async (taskId, outputBlockId) => {
        // Update task with outputBlockId
        if (outputBlockId) {
          await updateTask(taskId, { outputBlockId })
          // Refresh decorations after output is inserted
          editor.commands.refreshAgentTaskDecorations()
        }
      }
    )

    return cleanup
  }, [editor])

  // Listen for transclusion:select event from SlashCommand
  useEffect(() => {
    const handleTransclusionSelect = () => {
      // 获取编辑器容器位置作为弹窗位置参考
      setShowTransclusionPopup(true)
      setTransclusionSearchMode('note')
      setSelectedTransclusionNote(null)
      setTransclusionQuery('')
      setTransclusionEditCallback(null) // 新建模式
    }

    window.addEventListener('transclusion:select', handleTransclusionSelect)
    return () => {
      window.removeEventListener('transclusion:select', handleTransclusionSelect)
    }
  }, [])

  // Listen for transclusion:edit event from TransclusionView
  useEffect(() => {
    const handleTransclusionEdit = (e: CustomEvent<{ updateAttributes: (attrs: Record<string, unknown>) => void }>) => {
      setShowTransclusionPopup(true)
      setTransclusionSearchMode('note')
      setSelectedTransclusionNote(null)
      setTransclusionQuery('')
      setTransclusionEditCallback(() => e.detail.updateAttributes) // 编辑模式
    }

    window.addEventListener('transclusion:edit', handleTransclusionEdit as EventListener)
    return () => {
      window.removeEventListener('transclusion:edit', handleTransclusionEdit as EventListener)
    }
  }, [])

  // Listen for embed:select event from SlashCommand
  useEffect(() => {
    const handleEmbedSelect = () => {
      setShowEmbedPopup(true)
      setEmbedUrl('')
    }

    window.addEventListener('embed:select', handleEmbedSelect)
    return () => {
      window.removeEventListener('embed:select', handleEmbedSelect)
    }
  }, [])

  // Auto-focus title for new (empty) notes
  const prevNoteIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Only trigger when note.id changes
    if (prevNoteIdRef.current === note.id) return
    prevNoteIdRef.current = note.id

    // Check if this is a new empty note - focus the inline title
    const isEmptyTitle = !note.title || note.title.trim() === ''
    const isEmptyContent = !note.content || note.content === '[]' || note.content === ''
    if (isEmptyTitle && isEmptyContent && titleRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        titleRef.current?.focus()
      }, 50)
    }
    // note.title/content are read but don't need to trigger re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  // Handle title change
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const newTitle = e.target.value
    setTitle(newTitle)
    onUpdate(note.id, { title: newTitle })
  }, [note.id, onUpdate])

  // Handle title keydown - Enter moves to editor, Escape blurs
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Skip if IME is composing (e.g., Chinese/Japanese input)
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      editor?.commands.focus('start')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      editor?.commands.focus()
    }
  }, [editor])

  // Auto-resize title textarea (fallback for browsers without field-sizing support)
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    // Check if field-sizing is supported (no need for JS resize)
    if (CSS.supports('field-sizing', 'content')) return
    // Fallback: manually resize
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [title])

  // Handle note link selection (支持标题和 block)
  const handleSelectNoteLink = useCallback((
    selectedNote: Note,
    target?: { type: 'heading' | 'block'; value: string; displayText: string }
  ) => {
    if (!editor || linkStartPos === null) return

    const { from } = editor.state.selection
    const displayText = target?.displayText || selectedNote.title || t.noteList.untitled

    // block 链接的 targetValue 来自 extractBlocksFromJSON，
    // 该函数只返回有 blockId 的 block，所以 targetValue 必定有值
    const targetValue = target?.value

    // Delete the [[ and query text
    editor
      .chain()
      .focus()
      .deleteRange({ from: linkStartPos, to: from })
      .setNoteLink({
        noteId: selectedNote.id,
        noteTitle: selectedNote.title || t.noteList.untitled,
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
  }, [editor, linkStartPos, t.noteList.untitled])

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

    try {
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
    } catch (error) {
      console.error('Failed to create note from link:', error)
      // 创建失败时恢复焦点
      editor.commands.focus()
    } finally {
      setShowLinkPopup(false)
      setLinkQuery('')
      setLinkStartPos(null)
      setSearchMode('note')
      setSelectedLinkNote(null)
    }
  }, [editor, linkStartPos, onCreateNote])

  // Close popup on escape
  const handleCloseLinkPopup = useCallback(() => {
    setShowLinkPopup(false)
    setLinkQuery('')
    setLinkStartPos(null)
    setSearchMode('note')
    setSelectedLinkNote(null)
  }, [])

  // 返回上一级（从 heading/block 模式回到 note 模式）
  const handleBackToNoteSearch = useCallback(() => {
    setSearchMode('note')
    setSelectedLinkNote(null)
    setLinkQuery('')
    setTargetHeadings([])
    setTargetBlocks([])
  }, [])

  // Transclusion handlers
  const handleSelectTransclusion = useCallback((
    selectedNote: Note,
    target?: { type: 'heading' | 'block'; value: string; displayText: string }
  ) => {
    const attrs = {
      noteId: selectedNote.id,
      noteName: selectedNote.title || t.noteList.untitled,
      targetType: (target?.type || 'note') as 'note' | 'heading' | 'block',
      targetValue: target?.value,
    }

    if (transclusionEditCallback) {
      // 编辑模式：更新现有 block
      transclusionEditCallback(attrs)
    } else if (editor) {
      // 新建模式：插入新 block
      editor.chain().focus().setTransclusion(attrs).run()
    }

    setShowTransclusionPopup(false)
    setTransclusionQuery('')
    setTransclusionSearchMode('note')
    setSelectedTransclusionNote(null)
    setTransclusionEditCallback(null)
  }, [editor, t.noteList.untitled, transclusionEditCallback])

  const handleSelectTransclusionNoteForSubSearch = useCallback((selectedNote: Note) => {
    setSelectedTransclusionNote(selectedNote)
    setTransclusionSearchMode('heading')
    setTransclusionQuery('')

    // 获取目标笔记的标题和 block 列表
    try {
      const content = selectedNote.content
      if (content) {
        const parsed = JSON.parse(content)
        const headings = extractHeadingsFromJSON(parsed)
        setTransclusionHeadings(headings)
        const blocks = extractBlocksFromJSON(parsed)
        setTransclusionBlocks(blocks)
      }
    } catch {
      setTransclusionHeadings([])
      setTransclusionBlocks([])
    }
  }, [])

  const handleCloseTransclusionPopup = useCallback(() => {
    setShowTransclusionPopup(false)
    setTransclusionQuery('')
    setTransclusionSearchMode('note')
    setSelectedTransclusionNote(null)
    setTransclusionHeadings([])
    setTransclusionBlocks([])
    setTransclusionEditCallback(null)
  }, [])

  // 返回上一级（Transclusion 的 heading/block 模式回到 note 模式）
  const handleBackToTransclusionNoteSearch = useCallback(() => {
    setTransclusionSearchMode('note')
    setSelectedTransclusionNote(null)
    setTransclusionQuery('')
    setTransclusionHeadings([])
    setTransclusionBlocks([])
  }, [])

  // Embed handlers
  const handleInsertEmbed = useCallback(() => {
    if (!editor || !embedUrl.trim()) return

    // 自动补全协议
    let urlToUse = embedUrl.trim()
    if (!/^https?:\/\//i.test(urlToUse)) {
      urlToUse = 'https://' + urlToUse
    }

    // 验证 URL 格式
    try {
      new URL(urlToUse)
    } catch {
      alert(t.embed?.invalidUrl || 'Invalid URL')
      return
    }

    // 自动转换为 embed 格式
    const convertedUrl = convertToEmbedUrl(urlToUse)

    editor.chain().focus().setEmbed({
      mode: 'url',
      url: convertedUrl,
      title: '',
      height: 400,
    }).run()

    setShowEmbedPopup(false)
    setEmbedUrl('')
  }, [editor, embedUrl, t])

  const handleCloseEmbedPopup = useCallback(() => {
    setShowEmbedPopup(false)
    setEmbedUrl('')
  }, [])

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(prev => !prev)
  }, [])

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!editor) return

    // 检查是否有选中文本
    const { from, to } = editor.state.selection
    const hasSelection = from !== to

    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setContextMenuHasSelection(hasSelection)
  }, [editor])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuPosition(null)
  }, [])

  // Agent Task Panel handlers
  const handleOpenAgentTask = useCallback((blockIds: string[], taskId: string | null, blockContent: string) => {
    setAgentTaskBlockIds(blockIds)
    setAgentTaskId(taskId)
    setAgentTaskBlockContent(blockContent)
    const primaryBlockId = blockIds[0] || ''
    const heading = editor && primaryBlockId
      ? getNearestHeadingForBlock(editor, primaryBlockId)
      : null
    setAgentTaskExecutionContext({
      sourceApp: 'sanqian-notes',
      noteId: note.id,
      noteTitle: resolvedNoteTitle || null,
      notebookId: note.notebook_id ?? null,
      notebookName: currentNotebookName || null,
      heading,
    })
    setAgentTaskPanelOpen(true)
  }, [editor, note.id, note.notebook_id, resolvedNoteTitle, currentNotebookName])

  // Update the ref so the extension can access the latest handler
  openAgentTaskRef.current = handleOpenAgentTask

  const handleCloseAgentTaskPanel = useCallback(() => {
    setAgentTaskPanelOpen(false)
  }, [])

  // 第一个 blockId 用于关联任务
  const primaryBlockId = agentTaskBlockIds[0] || ''

  const handleAgentTaskCreated = useCallback((taskId: string) => {
    if (!editor || !primaryBlockId) return
    // 设置 block 的 agentTaskId 属性（只设置第一个 block）
    editor.commands.setAgentTask(primaryBlockId, taskId)
    setAgentTaskId(taskId)
    // 刷新缓存和装饰
    refreshTaskCache().then(() => {
      editor.commands.refreshAgentTaskDecorations()
    })
  }, [editor, primaryBlockId])

  const handleAgentTaskRemoved = useCallback(() => {
    if (!editor || !primaryBlockId) return
    // 先删除被此 agent block 管理的所有输出 blocks
    editor.commands.deleteManagedBlocks(primaryBlockId)
    // 移除 block 的 agentTaskId 属性
    editor.commands.removeAgentTask(primaryBlockId)
    setAgentTaskId(null)
    // 刷新装饰
    editor.commands.refreshAgentTaskDecorations()
  }, [editor, primaryBlockId])

  const handleAgentTaskUpdated = useCallback(() => {
    if (!editor) return
    // 刷新缓存和装饰
    refreshTaskCache().then(() => {
      editor.commands.refreshAgentTaskDecorations()
    })
  }, [editor])

  // 持续追踪最后的光标位置（即使焦点离开编辑器也能记住）
  const lastCursorInfo = useRef<CursorInfo | null>(null)
  // Track last synced selection to avoid redundant callbacks
  const lastSyncedSelection = useRef<{ blockId: string | null; selectedText: string | null }>({
    blockId: null,
    selectedText: null,
  })
  // Debounce timer for selection sync
  const selectionSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 监听编辑器选区变化，持续更新 lastCursorInfo 和选中字数
  useEffect(() => {
    if (!editor) return

    const updateSelection = () => {
      // 更新光标位置
      const info = getCursorInfo(editor)
      if (info) {
        lastCursorInfo.current = info
      }
      // 更新选中字数
      setSelectedWordCount(countSelectedWords(editor))

      // Debounced sync of selection to parent (for context provider)
      if (onSelectionChange) {
        if (selectionSyncTimer.current) {
          clearTimeout(selectionSyncTimer.current)
        }
        selectionSyncTimer.current = setTimeout(() => {
          // Re-fetch current state inside timeout to avoid stale closure
          const currentInfo = getCursorInfo(editor)
          const { from, to } = editor.state.selection
          // Use getMarkdownContent to properly handle math, images and other special nodes
          const selectedText = from !== to ? getMarkdownContent(editor, from, to) : null
          const blockId = currentInfo?.blockId || null

          // Only call if something changed
          if (
            blockId !== lastSyncedSelection.current.blockId ||
            selectedText !== lastSyncedSelection.current.selectedText
          ) {
            lastSyncedSelection.current = { blockId, selectedText }
            const cursorContext = getCursorContext(editor)
            onSelectionChange(blockId, selectedText, cursorContext)
          }
        }, 300)
      }
    }

    // 初始化
    updateSelection()

    // 监听选区变化
    editor.on('selectionUpdate', updateSelection)
    return () => {
      editor.off('selectionUpdate', updateSelection)
      if (selectionSyncTimer.current) {
        clearTimeout(selectionSyncTimer.current)
      }
    }
  }, [editor, onSelectionChange])

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
      // 检查鼠标是否在工具栏区域内（包括弹出框）
      const toolbar = document.querySelector('.zen-toolbar')
      if (toolbar?.contains(e.target as Node)) {
        // 鼠标在工具栏内，保持显示
        setShowToolbar(true)
        return
      }

      const rect = editorContainerRef.current?.getBoundingClientRect()
      if (rect) {
        // 鼠标在底部 200px 范围内时显示
        setShowToolbar(e.clientY > rect.bottom - 200)
      }
    }

    const handleMouseLeave = () => {
      // 鼠标离开编辑器容器时隐藏工具栏
      setShowToolbar(false)
    }

    const container = editorContainerRef.current
    container?.addEventListener('mousemove', handleMouseMove)
    container?.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      container?.removeEventListener('mousemove', handleMouseMove)
      container?.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  // Detect if inline title is scrolled out of view (for showing/hiding header title)
  useEffect(() => {
    const container = contentRef.current
    const titleEl = titleRef.current
    if (!container || !titleEl) return

    const checkTitleVisibility = () => {
      const titleRect = titleEl.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      // Title is hidden when its bottom is above the header bar
      const isHidden = titleRect.bottom < containerRect.top + HEADER_HEIGHT
      setIsTitleHidden(isHidden)
    }

    container.addEventListener('scroll', checkTitleVisibility, { passive: true })
    checkTitleVisibility() // Initial check

    return () => container.removeEventListener('scroll', checkTitleVisibility)
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

      // 通知完成滚动，传递是否找到目标
      onScrollComplete?.(!!targetElement)
    }

    // 给编辑器一点时间加载内容
    const timer = setTimeout(scrollToTarget, 100)
    return () => clearTimeout(timer)
  }, [scrollTarget, editor, onScrollComplete])

  // 当 isFocused 从 false 变为 true 时自动聚焦编辑器（切换 pane/tab 时）
  // 首次加载时不触发，让用户点击自然聚焦到点击位置
  const prevIsFocusedRef = useRef(isFocused)
  useEffect(() => {
    const prevIsFocused = prevIsFocusedRef.current
    prevIsFocusedRef.current = isFocused

    // 只在 isFocused 从 false 变为 true 时触发
    if (isFocused && !prevIsFocused && editor && !editor.isDestroyed) {
      requestAnimationFrame(() => {
        if (!editor.isDestroyed && !editor.isFocused) {
          editor.commands.focus()
        }
      })
    }
  }, [isFocused, editor])

  if (!editor) return null

  return (
    <div
      ref={editorContainerRef}
      className={`zen-editor-container ${resolvedColorMode}`}
    >
      {/* Windows: 左侧竖向控件栏 */}
      {isWindows() && showPaneControls && (
        <div
          className="absolute left-[10px] top-[42px] z-20 flex flex-col gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {note && (
            <div style={{ marginLeft: -2 }}>
              <ExportMenu
                noteId={note.id}
                noteTitle={note.title}
                notebookName={notebooks.find(nb => nb.id === note.notebook_id)?.name}
                onSplitHorizontal={onSplitHorizontal}
                onSplitVertical={onSplitVertical}
                onInsertContent={handleInsertContent}
                onOpenSearch={handleOpenSearch}
              />
            </div>
          )}
          {onClosePane && (
            <PaneCloseButton onClick={onClosePane} title={t.paneControls?.close || 'Close Pane'} />
          )}
        </div>
      )}

      {/* Top header bar - shows title when scrolled (title hidden) */}
      <div
        className={`zen-header-bar ${isTitleHidden ? 'with-title scrolled' : ''}`}
        style={showSearchBar ? { pointerEvents: 'none' } : undefined}
      >
        {/* Left spacing area */}
        <div className="zen-header-drag-area" />

        {/* Title area - shows title only when pinned, otherwise empty draggable area */}
        <div
          className="flex-1 min-w-0 overflow-hidden"
          style={{
            cursor: isTitleHidden ? 'text' : 'default',
            pointerEvents: showSearchBar ? 'none' : undefined
          }}
          onClick={(e) => {
            if (isTitleHidden && !isEditingHeaderTitle) {
              // Get character offset at click position
              const range = document.caretRangeFromPoint(e.clientX, e.clientY)
              if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
                headerTitleClickPosRef.current = range.startOffset
              } else {
                headerTitleClickPosRef.current = null
              }
              setIsEditingHeaderTitle(true)
            }
          }}
        >
          {isTitleHidden && (
            isEditingHeaderTitle ? (
              <input
                ref={headerTitleRef}
                type="text"
                className="zen-header-title"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                value={title}
                onChange={handleTitleChange}
                placeholder={t.editor.titlePlaceholder}
                autoFocus
                onFocus={(e) => {
                  const input = e.target as HTMLInputElement
                  const pos = headerTitleClickPosRef.current
                  if (pos !== null) {
                    input.setSelectionRange(pos, pos)
                  }
                  headerTitleClickPosRef.current = null
                }}
                onBlur={() => setIsEditingHeaderTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    setIsEditingHeaderTitle(false)
                    editor?.commands.focus('start')
                  } else if (e.key === 'Escape') {
                    setIsEditingHeaderTitle(false)
                    editor?.commands.focus()
                  }
                }}
              />
            ) : (
              <span
                className="zen-header-title"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                {title || t.editor.titlePlaceholder}
              </span>
            )
          )}
        </div>

        {/* macOS: More Menu + Close Pane - 更多菜单（含导出、分屏）+ 关闭按钮 */}
        {!isWindows() && (
          <div
            className="flex items-center gap-0.5 ml-2 flex-shrink-0"
            style={{
              WebkitAppRegion: 'no-drag',
              pointerEvents: showSearchBar ? 'none' : undefined
            } as React.CSSProperties}
          >
            {note && (
              <ExportMenu
                noteId={note.id}
                noteTitle={note.title}
                notebookName={notebooks.find(nb => nb.id === note.notebook_id)?.name}
                onSplitHorizontal={onSplitHorizontal}
                onSplitVertical={onSplitVertical}
                onInsertContent={handleInsertContent}
                onOpenSearch={handleOpenSearch}
              />
            )}
            {showPaneControls && onClosePane && (
              <PaneCloseButton onClick={onClosePane} title={t.paneControls?.close || 'Close Pane'} />
            )}
          </div>
        )}
      </div>

      {/* Floating toolbar - appears on hover at bottom */}
      <EditorToolbar
        editor={editor}
        t={t}
        isFocusMode={isFocusMode}
        isTypewriterMode={isTypewriterMode}
        toggleFocusMode={toggleFocusMode}
        toggleTypewriterMode={toggleTypewriterMode}
        showToolbar={showToolbar}
        aiActions={aiActions}
        onAIActionClick={handleAIActionClick}
        isAIProcessing={isAIProcessing}
      />

      {/* Search bar - floating at top */}
      {showSearchBar && editor && (
        <SearchBar
          editor={editor}
          onClose={() => {
            editor.commands.closeSearch()
            setShowSearchBar(false)
            editor.commands.focus()
          }}
        />
      )}

      {/* Scroll wrapper - keeps scrollbar at right edge, click to focus editor */}
      <div
        ref={contentRef}
        className="zen-scroll-wrapper"
        style={{ position: 'relative' }}
        onClick={(e) => {
          // 点击空白区域时聚焦编辑器
          // 水平 padding 已移到 .zen-editor，ProseMirror 会自然处理点击定位
          const target = e.target as HTMLElement
          // 如果点击的是 ProseMirror 或标题，让它们自己处理
          if (target.closest('.zen-editor') || target.closest('.zen-title')) {
            return
          }
          // 如果有文本选中，不改变焦点
          const selection = window.getSelection()
          if (selection && selection.toString().length > 0) {
            return
          }
          // 点击内容区域下方空白（zen-content 或 zen-editor-content）时跳到末尾继续输入
          // 点击其他空白区域只聚焦
          if (target.classList.contains('zen-content') || target.classList.contains('zen-editor-content')) {
            editor?.commands.focus('end')
          } else {
            editor?.commands.focus()
          }
        }}
      >
        {/* Agent Task Indicators - overlay layer for dots */}
        <AgentTaskIndicators
          editor={editor}
          containerRef={contentRef as React.RefObject<HTMLElement>}
          onOpenPanel={handleOpenAgentTask}
        />

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
          <div onContextMenu={handleContextMenu}>
            <EditorContent editor={editor} className="zen-editor-content" />
          </div>
        </div>

      </div>

      {/* Word count - outside scroll wrapper to stay fixed during scroll */}
      <div className="zen-stats">
        {selectedWordCount !== null
          ? `${selectedWordCount} / ${countWordsFromEditor(editor)} ${t.typewriter.wordCount}`
          : `${countWordsFromEditor(editor)} ${t.typewriter.wordCount}`
        }
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
          notebooks={notebooks}
          onQueryChange={setLinkQuery}
          onBack={handleBackToNoteSearch}
        />
      )}

      {/* Transclusion popup - 居中显示 */}
      {showTransclusionPopup && (
        <div className="transclusion-popup-overlay" onClick={handleCloseTransclusionPopup}>
          <div className="transclusion-popup-container" onClick={(e) => e.stopPropagation()}>
            <NoteLinkPopup
              notes={notes.filter(n => n.id !== note.id)}
              query={transclusionQuery}
              position={{ top: 0, left: 0 }} // 位置由 overlay 控制
              onSelect={handleSelectTransclusion}
              onClose={handleCloseTransclusionPopup}
              searchMode={transclusionSearchMode}
              selectedNote={selectedTransclusionNote}
              headings={transclusionHeadings}
              blocks={transclusionBlocks}
              onSelectNote={handleSelectTransclusionNoteForSubSearch}
              isTransclusionMode={true}
              notebooks={notebooks}
              onQueryChange={setTransclusionQuery}
              onBack={handleBackToTransclusionNoteSearch}
            />
          </div>
        </div>
      )}

      {/* Embed popup - URL 输入弹窗 */}
      {showEmbedPopup && (
        <div className="embed-popup-overlay" onClick={handleCloseEmbedPopup}>
          <div className="embed-popup-container" onClick={(e) => e.stopPropagation()}>
            <div className="embed-popup">
              <div className="embed-popup-header">
                <span>{t.embed?.insertEmbed || 'Embed Web Page'}</span>
              </div>
              <div className="embed-popup-content">
                <input
                  type="text"
                  className="embed-popup-input"
                  placeholder={t.embed?.urlPlaceholder || 'Enter URL (e.g., youtube.com/watch?v=xxx)'}
                  value={embedUrl}
                  onChange={(e) => setEmbedUrl(e.target.value)}
                  onKeyDown={(e) => {
                    // IME 输入法组合状态时不响应
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter') {
                      handleInsertEmbed()
                    } else if (e.key === 'Escape') {
                      handleCloseEmbedPopup()
                    }
                  }}
                  autoFocus
                />
                <p className="embed-popup-hint">
                  {t.embed?.securityHint || 'Note: Most websites block iframe embedding for security reasons. Works best with YouTube, Bilibili, Google Maps, etc.'}
                </p>
              </div>
              <div className="embed-popup-footer">
                <button className="embed-popup-cancel" onClick={handleCloseEmbedPopup}>
                  {t.common?.cancel || 'Cancel'}
                </button>
                <button
                  className="embed-popup-confirm"
                  onClick={handleInsertEmbed}
                  disabled={!embedUrl.trim()}
                >
                  {t.embed?.insert || 'Insert'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      <EditorContextMenu
        editor={editor}
        position={contextMenuPosition}
        onClose={handleCloseContextMenu}
        hasSelection={contextMenuHasSelection}
      />

      {/* Agent Task Panel */}
      <AgentTaskPanel
        isOpen={agentTaskPanelOpen}
        onClose={handleCloseAgentTaskPanel}
        blockIds={agentTaskBlockIds}
        taskId={agentTaskId}
        blockContent={agentTaskBlockContent}
        pageId={note.id}
        notebookId={note.notebook_id ?? null}
        executionContext={agentTaskExecutionContext}
        onTaskCreated={handleAgentTaskCreated}
        onTaskRemoved={handleAgentTaskRemoved}
        onTaskUpdated={handleAgentTaskUpdated}
      />
    </div>
  )
})

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { note, notes, notebooks, onUpdate, onNoteClick, onCreateNote, onSelectNote, scrollTarget, onScrollComplete, onTypewriterModeToggle, onSelectionChange, onSplitHorizontal, onSplitVertical, onClosePane, showPaneControls, isFocused },
  ref
) {
  const t = useTranslations()

  return (
    <div className="flex-1 min-w-0 overflow-hidden flex flex-col bg-[var(--color-card-solid)] relative">
      {!note ? (
        <div className="flex-1 flex flex-col">
          {/* 空白页的标题栏 */}
          <div
            className="h-[42px] flex items-center justify-between px-3 flex-shrink-0 relative"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            {/* macOS: 左边留空，控件在右边 */}
            {!isWindows() && showPaneControls && (
              <div
                className="w-8 h-8"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              />
            )}
            {/* 中间占位 */}
            <div className="flex-1" />
            {/* macOS: 控件在右边 */}
            {!isWindows() && showPaneControls && (
              <div
                className="flex items-center gap-0.5"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <ExportMenu
                  onSplitHorizontal={onSplitHorizontal}
                  onSplitVertical={onSplitVertical}
                />
                {onClosePane && (
                  <PaneCloseButton onClick={onClosePane} title={t.paneControls?.close || 'Close Pane'} />
                )}
              </div>
            )}
          </div>
          {/* Windows: 左侧竖向控件栏 */}
          {isWindows() && showPaneControls && (
            <div
              className="absolute left-[10px] top-[42px] z-20 flex flex-col gap-0.5"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <div style={{ marginLeft: -2 }}>
                <ExportMenu
                  onSplitHorizontal={onSplitHorizontal}
                  onSplitVertical={onSplitVertical}
                />
              </div>
              {onClosePane && (
                <PaneCloseButton onClick={onClosePane} title={t.paneControls?.close || 'Close Pane'} />
              )}
            </div>
          )}
          {/* 空白页内容 */}
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-lg font-medium text-[var(--color-muted)] mb-2">{t.editor.selectNote}</p>
            <p className="text-sm text-[var(--color-muted)] opacity-50 mb-2">{t.editor.or}</p>
            <button
              onClick={async () => {
                const newNote = await onCreateNote('')
                // 直接选中笔记，不经过 onNoteClick 的验证逻辑，避免闭包问题
                if (onSelectNote) {
                  onSelectNote(newNote.id)
                } else {
                  onNoteClick(newNote.id)
                }
              }}
              className="text-sm text-[var(--color-muted)] opacity-60 hover:opacity-100 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] px-4 py-2 rounded-md transition-all"
            >
              {t.editor.createNewNote}
            </button>
          </div>
        </div>
      ) : (
        <ZenEditor
          key={note.id}
          ref={ref}
          note={note}
          notes={notes}
          notebooks={notebooks}
          onUpdate={onUpdate}
          onNoteClick={onNoteClick}
          onCreateNote={onCreateNote}
          scrollTarget={scrollTarget}
          onScrollComplete={onScrollComplete}
          onTypewriterModeToggle={onTypewriterModeToggle}
          onSelectionChange={onSelectionChange}
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
          onClosePane={onClosePane}
          showPaneControls={showPaneControls}
          isFocused={isFocused}
        />
      )}
    </div>
  )
})

// 响应式工具栏组件
function EditorToolbar({
  editor,
  t,
  isFocusMode: _isFocusMode,
  isTypewriterMode,
  toggleFocusMode: _toggleFocusMode,
  toggleTypewriterMode,
  showToolbar,
  aiActions,
  onAIActionClick,
  isAIProcessing
}: {
  editor: ReturnType<typeof useEditor>
  t: ReturnType<typeof useTranslations>
  isFocusMode: boolean
  isTypewriterMode: boolean
  toggleFocusMode: () => void
  toggleTypewriterMode: () => void
  showToolbar: boolean
  aiActions: AIAction[]
  onAIActionClick: (action: AIAction) => void
  isAIProcessing: boolean
}) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isCompact, setIsCompact] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showAIMenu, setShowAIMenu] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const aiMenuRef = useRef<HTMLDivElement>(null)

  // 监听容器宽度变化
  useEffect(() => {
    const checkWidth = () => {
      if (toolbarRef.current) {
        const parent = toolbarRef.current.parentElement
        if (parent) {
          // 当编辑器宽度小于 760px 时切换到紧凑模式
          setIsCompact(parent.clientWidth < 760)
        }
      }
    }

    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // 点击外部关闭弹出框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setShowAIMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 工具栏隐藏时关闭弹出框
  useEffect(() => {
    if (!showToolbar) {
      setShowColorPicker(false)
      setShowAIMenu(false)
    }
  }, [showToolbar])

  if (!editor) return null

  // 判断是否是正文（非标题的段落）
  const isBody = editor.isActive('paragraph') && !editor.isActive('heading')

  // 紧凑模式：分组折叠
  if (isCompact) {
    return (
      <div ref={toolbarRef} className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
        {/* AI - 放在最左边 */}
        <div className="zen-toolbar-dropdown" ref={aiMenuRef}>
          <button
            className={`zen-toolbar-btn zen-toolbar-dropdown-trigger ${isAIProcessing ? 'active' : ''} ${showAIMenu ? 'open' : ''}`}
            onClick={() => setShowAIMenu(!showAIMenu)}
          >
            {ToolbarIcons.sparkles}
            {ToolbarIcons.chevronUp}
          </button>
          {showAIMenu && aiActions.length > 0 && (
            <div className="zen-toolbar-dropdown-menu zen-toolbar-ai-menu">
              {aiActions.map((action) => (
                <button
                  key={action.id}
                  className="zen-toolbar-ai-menu-item"
                  onClick={() => {
                    onAIActionClick(action)
                    setShowAIMenu(false)
                  }}
                >
                  <span className="zen-toolbar-ai-menu-icon">{action.icon}</span>
                  <span className="zen-toolbar-ai-menu-label">{action.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="zen-toolbar-divider" />
        {/* 文本格式下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.bold}
          active={editor.isActive('bold') || editor.isActive('italic') || editor.isActive('strike') || editor.isActive('highlight') || editor.isActive('underline')}
          forceClose={!showToolbar}
          items={[
            { label: t.toolbar.bold, icon: ToolbarIcons.bold, active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run(), shortcut: shortcuts.bold },
            { label: t.toolbar.italic, icon: ToolbarIcons.italic, active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run(), shortcut: shortcuts.italic },
            { label: t.toolbar.strikethrough, icon: ToolbarIcons.strikethrough, active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run(), shortcut: shortcuts.strike },
            { label: t.toolbar.underline, icon: ToolbarIcons.underline, active: editor.isActive('underline'), onClick: () => editor.chain().focus().toggleUnderline().run(), shortcut: shortcuts.underline },
            { label: t.toolbar.highlight, icon: ToolbarIcons.highlight, active: editor.isActive('highlight'), onClick: () => editor.chain().focus().toggleHighlight().run(), shortcut: shortcuts.highlight },
          ]}
        />
        {/* 段落类型下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.heading}
          active={editor.isActive('heading')}
          forceClose={!showToolbar}
          items={[
            { label: 'Body', active: isBody, onClick: () => editor.chain().focus().setParagraph().run(), shortcut: shortcuts.body },
            { label: 'H1', active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), shortcut: shortcuts.h1 },
            { label: 'H2', active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), shortcut: shortcuts.h2 },
            { label: 'H3', active: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), shortcut: shortcuts.h3 },
            { label: 'H4', active: editor.isActive('heading', { level: 4 }), onClick: () => editor.chain().focus().toggleHeading({ level: 4 }).run(), shortcut: shortcuts.h4 },
          ]}
        />
        {/* 列表下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.list}
          active={editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')}
          forceClose={!showToolbar}
          items={[
            { label: t.toolbar.bulletList, icon: ToolbarIcons.bulletList, active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run(), shortcut: shortcuts.bulletList },
            { label: t.toolbar.numberedList, icon: ToolbarIcons.orderedList, active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run(), shortcut: shortcuts.orderedList },
            { label: t.toolbar.checklist, icon: ToolbarIcons.taskList, active: editor.isActive('taskList'), onClick: () => editor.chain().focus().toggleTaskList().run(), shortcut: shortcuts.taskList },
          ]}
        />
        {/* 块元素下拉 */}
        <ToolbarDropdown
          icon={ToolbarIcons.block}
          active={editor.isActive('blockquote') || editor.isActive('code')}
          forceClose={!showToolbar}
          items={[
            { label: t.toolbar.quote, icon: ToolbarIcons.quote, active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run(), shortcut: shortcuts.quote },
            { label: t.toolbar.code, icon: ToolbarIcons.code, active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run(), shortcut: shortcuts.code },
          ]}
        />
        <div className="zen-toolbar-divider" />
        {/* 颜色选择器 */}
        <div className="zen-toolbar-color-wrapper" ref={colorPickerRef}>
          <ToolbarButton
            active={showColorPicker}
            onClick={() => setShowColorPicker(!showColorPicker)}
            title={t.toolbar.color}
            icon={ToolbarIcons.textColor}
          />
          {showColorPicker && (
            <div className="zen-toolbar-color-popup">
              <ColorPicker editor={editor} onClose={() => setShowColorPicker(false)} />
            </div>
          )}
        </div>
        <div className="zen-toolbar-divider" />
        <ToolbarButton active={isTypewriterMode} onClick={toggleTypewriterMode} title={t.typewriter.typewriterMode} icon={ToolbarIcons.typewriter} />
      </div>
    )
  }

  // 展开模式：所有按钮平铺
  return (
    <div ref={toolbarRef} className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
      {/* AI - 放在最左边 */}
      <div className="zen-toolbar-dropdown" ref={aiMenuRef}>
        <button
          className={`zen-toolbar-btn zen-toolbar-dropdown-trigger ${isAIProcessing ? 'active' : ''} ${showAIMenu ? 'open' : ''}`}
          onClick={() => setShowAIMenu(!showAIMenu)}
        >
          {ToolbarIcons.sparkles}
          {ToolbarIcons.chevronUp}
        </button>
        {showAIMenu && aiActions.length > 0 && (
          <div className="zen-toolbar-dropdown-menu zen-toolbar-ai-menu">
            {aiActions.map((action) => (
              <button
                key={action.id}
                className="zen-toolbar-ai-menu-item"
                onClick={() => {
                  onAIActionClick(action)
                  setShowAIMenu(false)
                }}
              >
                <span className="zen-toolbar-ai-menu-icon">{action.icon}</span>
                <span className="zen-toolbar-ai-menu-label">{action.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="zen-toolbar-divider" />
      {/* 文本格式 */}
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={`${t.toolbar.bold} (${shortcuts.bold})`} icon={ToolbarIcons.bold} />
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={`${t.toolbar.italic} (${shortcuts.italic})`} icon={ToolbarIcons.italic} />
      <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title={`${t.toolbar.underline} (${shortcuts.underline})`} icon={ToolbarIcons.underline} />
      <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={`${t.toolbar.strikethrough} (${shortcuts.strike})`} icon={ToolbarIcons.strikethrough} />
      <ToolbarButton active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} title={`${t.toolbar.highlight} (${shortcuts.highlight})`} icon={ToolbarIcons.highlight} />
      {/* 颜色选择器 */}
      <div className="zen-toolbar-color-wrapper" ref={colorPickerRef}>
        <ToolbarButton
          active={showColorPicker}
          onClick={() => setShowColorPicker(!showColorPicker)}
          title={t.toolbar.color}
          icon={ToolbarIcons.textColor}
        />
        {showColorPicker && (
          <div className="zen-toolbar-color-popup">
            <ColorPicker editor={editor} onClose={() => setShowColorPicker(false)} />
          </div>
        )}
      </div>
      <div className="zen-toolbar-divider" />
      {/* 段落类型 */}
      <ToolbarButton active={isBody} onClick={() => editor.chain().focus().setParagraph().run()} title={`${t.slashCommand.paragraph} (${shortcuts.body})`} icon={<span className="zen-toolbar-text">Body</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={`${t.toolbar.heading1} (${shortcuts.h1})`} icon={<span className="zen-toolbar-text">H1</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={`${t.toolbar.heading2} (${shortcuts.h2})`} icon={<span className="zen-toolbar-text">H2</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={`${t.toolbar.heading3} (${shortcuts.h3})`} icon={<span className="zen-toolbar-text">H3</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} title={`${t.toolbar.heading4} (${shortcuts.h4})`} icon={<span className="zen-toolbar-text">H4</span>} />
      <div className="zen-toolbar-divider" />
      {/* 列表 */}
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={`${t.toolbar.bulletList} (${shortcuts.bulletList})`} icon={ToolbarIcons.bulletList} />
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={`${t.toolbar.numberedList} (${shortcuts.orderedList})`} icon={ToolbarIcons.orderedList} />
      <ToolbarButton active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title={`${t.toolbar.checklist} (${shortcuts.taskList})`} icon={ToolbarIcons.taskList} />
      <div className="zen-toolbar-divider" />
      {/* 块元素 */}
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={`${t.toolbar.quote} (${shortcuts.quote})`} icon={ToolbarIcons.quote} />
      <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title={`${t.toolbar.code} (${shortcuts.code})`} icon={ToolbarIcons.code} />
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
      data-tooltip={title}
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
  shortcut?: string
}

function ToolbarDropdown({
  icon,
  active,
  items,
  forceClose
}: {
  icon: React.ReactNode
  active?: boolean
  items: DropdownItem[]
  forceClose?: boolean
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

  // 强制关闭下拉菜单
  useEffect(() => {
    if (forceClose) {
      setIsOpen(false)
    }
  }, [forceClose])

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
              {item.shortcut && <span className="zen-toolbar-dropdown-shortcut">{item.shortcut}</span>}
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

      // 只显示有 blockId 的 block，避免生成临时 ID 导致链接无法跳转
      if (n.attrs?.blockId) {
        blocks.push({
          id: n.attrs.blockId,
          type: n.type,
          text: text.slice(0, 100),
          pos,
        })
      }
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
