import { useEffect, useLayoutEffect, useCallback, useState, useRef, useImperativeHandle, forwardRef } from 'react'
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
import type { Note } from '../types/note'
import { useTranslations } from '../i18n'
import { useTheme } from '../theme'
import { NoteLink } from './extensions/NoteLink'
import { BlockId } from './extensions/BlockId'
import { NoteLinkPopup } from './NoteLinkPopup'
import { getCursorInfo, setCursorByBlockId, getCursorContext, type CursorInfo, type CursorContext } from '../utils/cursor'
import { countWordsFromEditor, countSelectedWords } from '../utils/wordCount'
// 新增扩展
import { CustomHighlight } from './extensions/Highlight'
import { CustomUnderline } from './extensions/Underline'
import { TextStyle, Color } from './extensions/TextColor'
import { SlashCommand } from './extensions/SlashCommand'
import { slashCommandSuggestion } from './extensions/slashCommandSuggestion'
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
import { Frontmatter } from './extensions/Frontmatter'
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
import { LinkPopover } from './editor/LinkPopover'
import { EditorColumnShell } from './EditorColumnShell'
import { ExportMenu } from './ExportMenu'
import { isWindows } from '../utils/platform'
import { AgentTaskPanel } from './AgentTaskPanel'
import { AgentTaskIndicators } from './AgentTaskIndicators'
import { initTaskCache, deleteTaskByBlockId, preloadTasksByBlockIds, updateTask } from '../utils/agentTaskStorage'
import { setupOutputListener } from '../utils/editorOutputHandler'
import { useAIActions } from '../hooks/useAIActions'
import { useAIActionExecutor } from '../hooks/useAIActionExecutor'
import { useNoteScrollPersistence } from '../hooks/useNoteScrollPersistence'
import { getMarkdownContent } from '../utils/aiContext'
import { handleEditorFileInsert, type FileInsertErrorMessages } from './editor/editor-file-insert'
import { FloatingToc } from './FloatingToc'
import { EditorToolbar } from './editor/EditorToolbar'
import { useEditorLinkPopup } from './editor/useEditorLinkPopup'
import { useEditorTransclusionPopup } from './editor/useEditorTransclusionPopup'
import { useEditorAgentTaskPanel } from './editor/useEditorAgentTaskPanel'
import { useEditorEmbedPopup } from './editor/useEditorEmbedPopup'
import {
  resolveTextSelectionRange,
  selectionHasNonCodeText,
  toTextSelectionRange,
  type TextSelectionRange,
} from './editor/link-selection'
import {
  tryParseImportedTiptapDoc,
  handleCursorPlaceholder,
} from './editor/editor-doc-utils'
import { serializeClipboardText } from './editor/clipboard-serializer'
import './Editor.css'

// Editor layout constants (keep in sync with Editor.css)
const HEADER_HEIGHT = 42

/**
 * Parse note content string into a format suitable for editor.commands.setContent().
 * Returns null if the content is Markdown (needs special insertContent handling).
 */
function parseNoteContent(content: string | undefined): ReturnType<typeof JSON.parse> | null {
  if (!content || content === '[]' || content === '') {
    return { type: 'doc', content: [] }
  }
  try {
    const parsed = JSON.parse(content)
    if (parsed.type === 'doc') return parsed
    return { type: 'doc', content: [] }
  } catch {
    if (looksLikeMarkdown(content)) {
      return null // Markdown: caller must use insertContent with markdownToHtml
    }
    return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }
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
  paneId?: string | null
  notes: Note[]
  notebooks?: import('../types/note').Notebook[]
  titleEditable?: boolean
  editable?: boolean
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  onSelectNote?: (noteId: string) => void
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: (found: boolean) => void
  onTitleCommit?: (id: string, title: string) => void
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
  getScrollContainer: () => HTMLDivElement | null
  flushPendingSave: () => void
}

// Zen Editor component
interface ZenEditorProps {
  note: Note
  paneId?: string | null
  notes: Note[]
  notebooks?: import('../types/note').Notebook[]
  titleEditable?: boolean
  editable?: boolean
  onUpdate: (id: string, updates: { title?: string; content?: string }) => void
  onNoteClick: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
  onCreateNote: (title: string) => Promise<Note>
  scrollTarget?: { type: 'heading' | 'block'; value: string } | null
  onScrollComplete?: (found: boolean) => void
  onTitleCommit?: (id: string, title: string) => void
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
  paneId,
  notes,
  notebooks = [],
  titleEditable = true,
  editable = true,
  onUpdate,
  onNoteClick,
  onCreateNote,
  onTitleCommit,
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

  // 右键菜单状态
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [contextMenuHasSelection, setContextMenuHasSelection] = useState(false)
  const [contextMenuSavedSelection, setContextMenuSavedSelection] = useState<{ from: number; to: number } | null>(null)

  // 链接浮窗状态
  const [linkPopoverAnchor, setLinkPopoverAnchor] = useState<HTMLElement | null>(null)
  const [linkPopoverHref, setLinkPopoverHref] = useState('')
  const [linkPopoverEditMode, setLinkPopoverEditMode] = useState(false)
  const linkHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preservedTextSelectionRef = useRef<TextSelectionRange | null>(null)

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
  const isEditorComposingRef = useRef(false)
  const isTitleComposingRef = useRef(false)
  const skipNextTitleCommitRef = useRef(false)

  // Stable ref for note.id - used in useEditor's onUpdate callback to avoid
  // stale closure after removing key={note.id} (which would save to wrong note)
  const noteIdRef = useRef(note.id)
  noteIdRef.current = note.id

  // Ref for AgentTask panel callback (to avoid circular dependency with useEditor)
  const openAgentTaskRef = useRef<(blockIds: string[], taskId: string | null, blockContent: string) => void>(() => {})

  // Ref bridge: link popup detection is called from useEditor's onUpdate,
  // but the hook is initialized after useEditor. The ref ensures the latest
  // detectLinkTrigger is always called.
  const linkPopupDetectRef = useRef<(editor: NonNullable<ReturnType<typeof useEditor>>) => void>(() => {})

  // Debounced save: avoid JSON.stringify on every keystroke (300ms)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorForFlushRef = useRef<TiptapEditor | null>(null)
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  // Flush pending debounced save on unmount or note switch.
  // useLayoutEffect so cleanup fires synchronously during commit, BEFORE any
  // pending setTimeout (the 300ms editor debounce) can sneak in between the
  // React render and the async useEffect cleanup.
  // Registered BEFORE useEditor so cleanup runs while the editor is still alive.
  useLayoutEffect(() => {
    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current)
        saveDebounceRef.current = null
        const ed = editorForFlushRef.current
        if (ed && !ed.isDestroyed) {
          onUpdateRef.current(note.id, { content: JSON.stringify(ed.getJSON()) })
        }
      }
    }
  }, [note.id])

  const fileInsertErrors: FileInsertErrorMessages = {
    fileTooLarge: (name, size) => `${t.fileError.tooLarge}: ${name}\n${t.fileError.tooLargeDetail.replace('{size}', size)}`,
    insertFailed: (name, error) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message.includes('too large')) {
        return `${t.fileError.tooLarge}: ${name}\n${message}`
      }
      return `${t.fileError.insertFailed}: ${name}\n${message}`
    },
  }
  const handleFileInsert = (editorInstance: TiptapEditor, file: File, pos?: number) =>
    handleEditorFileInsert(editorInstance, file, fileInsertErrors, pos)

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
      Frontmatter,
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
    editable,
    editorProps: {
      attributes: {
        class: `zen-editor ${isFocusMode ? 'focus-mode' : ''}`,
        spellcheck: 'false',
        'data-note-id': note.id,
        'data-note-title': resolvedNoteTitle,
        'data-notebook-id': note.notebook_id || '',
        'data-notebook-name': currentNotebookName,
      },
      handleDOMEvents: {
        compositionstart: () => {
          isEditorComposingRef.current = true
          return false
        },
        compositionend: () => {
          isEditorComposingRef.current = false
          return false
        },
      },
      clipboardTextSerializer: serializeClipboardText,
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
      editorForFlushRef.current = editor
      // Avoid persisting IME intermediate text (e.g., pinyin composition)
      if (!isEditorComposingRef.current && !editor.view.composing) {
        if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
        saveDebounceRef.current = setTimeout(() => {
          saveDebounceRef.current = null
          if (!editor.isDestroyed) {
            onUpdateRef.current(noteIdRef.current, { content: JSON.stringify(editor.getJSON()) })
          }
        }, 300)
      }

      // Detect [[ link trigger via extracted hook
      linkPopupDetectRef.current(editor)
    },
  })

  // Initialize link popup hook (after useEditor, so editor instance is available)
  const linkPopup = useEditorLinkPopup({
    editor,
    notes,
    untitledLabel: t.noteList.untitled,
    onCreateNote,
  })
  linkPopupDetectRef.current = linkPopup.detectLinkTrigger

  // Initialize transclusion popup hook
  const transclusionPopup = useEditorTransclusionPopup({
    editor,
    untitledLabel: t.noteList.untitled,
  })

  // Initialize agent task panel hook
  const agentTask = useEditorAgentTaskPanel({
    editor,
    noteId: note.id,
    noteTitle: resolvedNoteTitle,
    notebookId: note.notebook_id ?? null,
    notebookName: currentNotebookName,
  })
  openAgentTaskRef.current = agentTask.handleOpenAgentTask

  // Initialize embed popup hook
  const embedPopup = useEditorEmbedPopup({ editor, t })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(editable)
    if (!editable && editor.isFocused) {
      editor.commands.blur()
    }
  }, [editable, editor])

  // 暴露 editor 实例给外部
  useImperativeHandle(ref, () => ({
    getEditor: () => editor,
    getScrollContainer: () => contentRef.current,
    flushPendingSave: () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current)
        saveDebounceRef.current = null
        const ed = editorForFlushRef.current
        if (ed && !ed.isDestroyed) {
          onUpdateRef.current(noteIdRef.current, { content: JSON.stringify(ed.getJSON()) })
        }
      }
    },
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

  // AI actions hook - 底栏使用 showInShortcut 过滤的 actions
  const { getShortcutActions } = useAIActions()
  const aiActions = getShortcutActions()

  // AI action executor with unified loading indicators
  const { executeAction: handleAIActionClick, isProcessing: isAIProcessing, cancel: cancelAIAction, cleanupTempIcons: cleanupAITempIcons } = useAIActionExecutor({
    editor,
    t,
    onComplete: () => {
      editor?.commands.focus()
    },
    onError: (errorCode) => {
      console.error('[AI Writing] Error:', errorCode)
    }
  })

  // 跟踪编辑器自身的内容版本，用于区分外部更新和内部更新
  const editorContentRef = useRef<string | null>(null)
  // 用于取消过时的 queueMicrotask（防止快速切换笔记时竞态条件）
  const syncVersionRef = useRef(0)
  // 跟踪上次的 note.id，用于检测切换笔记
  const prevSyncNoteIdRef = useRef<string | null>(null)

  // 处理导入内容插入（用于 ExportMenu 的 Import 功能和模板插入）
  const handleInsertContent = useCallback(async (content: string): Promise<boolean> => {
    if (!editor) return false

    // 优先按 TipTap JSON 解析（支持双重编码、BOM、NUL）
    const parsedDoc = tryParseImportedTiptapDoc(content)
    if (parsedDoc) {
      const inserted = editor.chain().focus().insertContent(parsedDoc.content).run()
      if (!inserted) {
        console.error('[Editor] Failed to insert imported TipTap content.')
      }
      return inserted
    }

    // Long-term rule: if TipTap JSON parsing fails, keep markdown/fallback path available.
    // This avoids false negatives for valid markdown/code snippets that happen to contain
    // JSON-like content such as {"type": "...", "content": ...}.

    // 使用后端的 markdownToTiptap 进行完整转换（支持 dataview、agent、toc 等特殊 block）
    try {
      const tiptapJson = await window.electron.markdown.toTiptap(content)
      const parsed = JSON.parse(tiptapJson)
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
        const inserted = editor.chain().focus().insertContent(parsed.content).run()
        if (!inserted) {
          console.error('[Editor] Failed to insert markdown-converted TipTap content.')
        }
        return inserted
      }
    } catch (error) {
      console.error('Failed to convert markdown to Tiptap:', error)
    }

    // 降级：使用简单的 HTML 转换
    const html = markdownToHtml(content)
    const inserted = editor.chain().focus().insertContent(html, {
      parseOptions: { preserveWhitespace: false },
    }).run()
    if (!inserted) {
      console.error('[Editor] Failed to insert fallback HTML content.')
    }
    return inserted
  }, [editor])

  // 打开编辑器内搜索
  const handleOpenSearch = useCallback(() => {
    if (!editor) return
    editor.commands.openSearch()
  }, [editor])

  // Note-switch reset: replace editor content and reset per-note state when switching notes.
  // This enables editor instance reuse (no key={note.id} remount) for zero-flicker switching.
  const noteSwitchIdRef = useRef(note.id)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const prevId = noteSwitchIdRef.current
    noteSwitchIdRef.current = note.id
    if (prevId === note.id) return // Initial mount, not a switch

    // --- 1. Title handling ---
    const isTitleFocused = document.activeElement === titleRef.current
      || document.activeElement === headerTitleRef.current
    if (isTitleFocused) {
      skipNextTitleCommitRef.current = true
      ;(document.activeElement as HTMLElement)?.blur?.()
    }

    // --- 2. Cancel in-progress AI actions and close all popups/panels ---
    cancelAIAction()
    cleanupAITempIcons()
    editor.commands.hideAIPreview()

    linkPopup.handleCloseLinkPopup()
    transclusionPopup.handleCloseTransclusionPopup()
    embedPopup.handleCloseEmbedPopup()
    agentTask.handleCloseAgentTaskPanel()
    if (showSearchBar) {
      editor.commands.closeSearch()
      setShowSearchBar(false)
    }
    setContextMenuPosition(null)
    setContextMenuHasSelection(false)
    preservedTextSelectionRef.current = null
    handleCloseLinkPopover()

    // --- 3. Reset per-note state ---
    setTitle(note.title)
    setSelectedWordCount(null)
    setIsEditingHeaderTitle(false)
    setIsTitleHidden(false)
    isEditorComposingRef.current = false
    isTitleComposingRef.current = false
    skipNextTitleCommitRef.current = false
    lastCursorInfo.current = null
    lastSyncedSelection.current = { blockId: null, selectedText: null }
    if (selectionSyncTimer.current) {
      clearTimeout(selectionSyncTimer.current)
      selectionSyncTimer.current = null
    }

    // --- 4. Replace editor content ---
    const parsedContent = parseNoteContent(note.content)
    if (parsedContent === null) {
      // Markdown content: clear first then insertContent to trigger Markdown conversion
      editor.commands.setContent('', { emitUpdate: false })
      editor.commands.insertContent(markdownToHtml(note.content), {
        parseOptions: { preserveWhitespace: false },
      })
      editorContentRef.current = JSON.stringify(editor.getJSON())
    } else {
      // JSON content: setContent handles all edge cases (empty doc, plain text, etc.)
      editor.commands.setContent(parsedContent, { emitUpdate: false })
      editorContentRef.current = note.content
    }

    // Clear debounce timer that insertContent may have triggered (freshly loaded, don't save)
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = null
    }

    // --- 5. Clear undo/redo history ---
    const historyPlugin = editor.state.plugins.find(
      (p) => (p as any).key === 'history$'
    )
    if (historyPlugin && historyPlugin.spec.state) {
      const freshState = historyPlugin.spec.state.init({} as any, editor.state)
      const htr = editor.state.tr
      htr.setMeta(historyPlugin, { historyState: freshState })
      editor.view.dispatch(htr)
    }

    // --- 6. Handle cursor placeholder ---
    handleCursorPlaceholder(editor)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, note.id])

  // 同步外部内容变化到编辑器（同一笔记的外部更新，如打字机模式退出后同步）
  // 切换笔记由上面的 note-switch reset effect 处理
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    // 递增版本号，使之前的 microtask 失效
    const version = ++syncVersionRef.current

    // 检测是否是切换笔记（排除首次渲染）
    const isNoteSwitch = prevSyncNoteIdRef.current !== null && prevSyncNoteIdRef.current !== note.id
    prevSyncNoteIdRef.current = note.id
    if (isNoteSwitch) return // Handled by note-switch reset effect above

    // 如果这是编辑器自己刚刚产生的更新，跳过同步
    if (editorContentRef.current === note.content) {
      return
    }

    // 检测是否需要保留光标位置（编辑器有焦点）
    // 使用 blockId + offset 方案保存光标，内容更新后恢复
    const shouldPreserveCursor = editor.isFocused
    const savedCursorInfo = shouldPreserveCursor ? getCursorInfo(editor) : null

    const externalContent = parseNoteContent(note.content)

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
        // 恢复光标位置
        if (savedCursorInfo) {
          setCursorByBlockId(editor, savedCursorInfo)
        }
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
        // 恢复光标位置（使用 blockId + offset 方案）
        if (savedCursorInfo) {
          setCursorByBlockId(editor, savedCursorInfo)
        }
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

  // Sync title when note changes (skip if user is editing the title field)
  useEffect(() => {
    const isTitleFocused = (
      document.activeElement === titleRef.current
      || document.activeElement === headerTitleRef.current
    )
    if (!isTitleFocused) {
      setTitle(note.title)
    }
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
    if (!titleEditable) return
    const newTitle = e.target.value
    setTitle(newTitle)
    if (!isTitleComposingRef.current) {
      onUpdate(note.id, { title: newTitle })
    }
  }, [note.id, onUpdate, titleEditable])

  const handleTitleCompositionStart = useCallback(() => {
    isTitleComposingRef.current = true
  }, [])

  const handleTitleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!titleEditable) return
    isTitleComposingRef.current = false
    const committedTitle = e.currentTarget.value
    setTitle(committedTitle)
    onUpdate(note.id, { title: committedTitle })
  }, [note.id, onUpdate, titleEditable])

  // Handle title keydown - Enter moves to editor, Escape blurs (cancels for local files)
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Skip if IME is composing (e.g., Chinese/Japanese input)
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      editor?.commands.focus('start')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (onTitleCommit) {
        setTitle(note.title)
        skipNextTitleCommitRef.current = true
      }
      editor?.commands.focus()
    }
  }, [editor, note.title, onTitleCommit])

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

  // Toggle focus mode
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(prev => !prev)
  }, [])

  const clearLinkHoverTimer = useCallback(() => {
    if (linkHoverTimeoutRef.current) {
      clearTimeout(linkHoverTimeoutRef.current)
      linkHoverTimeoutRef.current = null
    }
  }, [])

  const getCurrentTextSelection = useCallback((): TextSelectionRange | null => {
    if (!editor) return null
    return toTextSelectionRange(editor.state.selection)
  }, [editor])

  const captureTextSelectionForLinkAction = useCallback(() => {
    preservedTextSelectionRef.current = getCurrentTextSelection()
  }, [getCurrentTextSelection])

  const clearPreservedTextSelection = useCallback(() => {
    preservedTextSelectionRef.current = null
  }, [])

  const resolveTextSelectionForLinkAction = useCallback((): TextSelectionRange | null => {
    return resolveTextSelectionRange(getCurrentTextSelection(), preservedTextSelectionRef.current)
  }, [getCurrentTextSelection])

  const handleEditorMouseDownCapture = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      captureTextSelectionForLinkAction()
    }
  }, [captureTextSelectionForLinkAction])

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (!editor) return

    // 右键按下可能会先让编辑器失焦；优先使用按下阶段缓存的选区
    const savedSelection = resolveTextSelectionForLinkAction()
    const hasSelection = savedSelection !== null

    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setContextMenuHasSelection(hasSelection)
    setContextMenuSavedSelection(savedSelection)
  }, [editor, resolveTextSelectionForLinkAction])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuPosition(null)
    setContextMenuSavedSelection(null)
    clearPreservedTextSelection()
  }, [clearPreservedTextSelection])

  // Whether current popover was triggered by hover (vs explicit click/context-menu)
  const [linkPopoverIsHover, setLinkPopoverIsHover] = useState(false)

  const handleCloseLinkPopover = useCallback(() => {
    setLinkPopoverAnchor(null)
    setLinkPopoverHref('')
    setLinkPopoverEditMode(false)
    setLinkPopoverIsHover(false)
    setLinkPopoverSavedSelection(null)
    clearPreservedTextSelection()
    clearLinkHoverTimer()
  }, [clearLinkHoverTimer, clearPreservedTextSelection])

  const scheduleLinkPopoverHoverClose = useCallback(() => {
    clearLinkHoverTimer()
    linkHoverTimeoutRef.current = setTimeout(() => {
      handleCloseLinkPopover()
    }, 300)
  }, [clearLinkHoverTimer, handleCloseLinkPopover])

  // Link hover detection
  const handleEditorMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const linkEl = target.closest('a.zen-link') as HTMLElement | null
    if (!linkEl) return

    // Don't show hover popover when already in edit mode
    if (linkPopoverEditMode) return

    clearLinkHoverTimer()
    linkHoverTimeoutRef.current = setTimeout(() => {
      const href = linkEl.getAttribute('href') || ''
      setLinkPopoverAnchor(linkEl)
      setLinkPopoverHref(href)
      setLinkPopoverEditMode(false)
      setLinkPopoverIsHover(true)
    }, 300)
  }, [clearLinkHoverTimer, linkPopoverEditMode])

  const handleEditorMouseOut = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const linkEl = target.closest('a.zen-link')
    if (!linkEl) return

    clearLinkHoverTimer()

    if (linkPopoverIsHover && !linkPopoverEditMode) {
      scheduleLinkPopoverHoverClose()
    }
  }, [clearLinkHoverTimer, linkPopoverEditMode, linkPopoverIsHover, scheduleLinkPopoverHoverClose])

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      clearLinkHoverTimer()
    }
  }, [clearLinkHoverTimer])

  // Saved selection range for insert-link flow (captured before focus is lost)
  const [linkPopoverSavedSelection, setLinkPopoverSavedSelection] = useState<{ from: number; to: number } | null>(null)

  // Show link popover in edit mode (for context menu / toolbar button)
  const showLinkEditPopover = useCallback((anchor: HTMLElement, href: string, savedSelection?: { from: number; to: number }) => {
    clearLinkHoverTimer()
    setLinkPopoverAnchor(anchor)
    setLinkPopoverHref(href)
    setLinkPopoverEditMode(true)
    setLinkPopoverIsHover(false)
    setLinkPopoverSavedSelection(savedSelection || null)
  }, [clearLinkHoverTimer])

  // Bottom toolbar link button handler
  const handleLinkButtonMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    captureTextSelectionForLinkAction()
  }, [captureTextSelectionForLinkAction])

  const handleLinkButtonClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!editor) return
    const textSelection = resolveTextSelectionForLinkAction()
    const hasTextSelected = textSelection !== null
    const isOnLink = editor.isActive('link')

    // Need either selected text or cursor on an existing link
    if (!hasTextSelected && !isOnLink) return

    const existingHref = isOnLink ? (editor.getAttributes('link')?.href || '') : ''
    const savedSel = textSelection ?? undefined
    showLinkEditPopover(e.currentTarget as HTMLElement, existingHref, savedSel)
  }, [editor, resolveTextSelectionForLinkAction, showLinkEditPopover])

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
      onTypewriterModeToggle(cursorInfo || { blockId: '', offsetInBlock: 0, absolutePos: 0 })
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

  useNoteScrollPersistence({
    editor,
    noteId: note.id,
    paneId,
    scrollTarget,
    contentRef,
  })

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

  const currentLinkButtonSelection = getCurrentTextSelection()
  const canInsertLinkFromSelection = selectionHasNonCodeText(editor.state.doc, currentLinkButtonSelection)
  const canOpenLinkPopover = editor.isActive('link') || canInsertLinkFromSelection
  const linkButtonTitle = currentLinkButtonSelection && !canInsertLinkFromSelection
    ? t.contextMenu.markUnavailableInCode
    : t.contextMenu.insertLink

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

        {/* Title area - shows title only when scrolled out, otherwise pure drag area */}
        <div className="flex-1 min-w-0 flex items-center overflow-hidden">
          {isTitleHidden && (
            isEditingHeaderTitle ? (
              <input
                ref={headerTitleRef}
                type="text"
                className="zen-header-title"
                style={{ WebkitAppRegion: 'no-drag', pointerEvents: showSearchBar ? 'none' : undefined } as React.CSSProperties}
                value={title}
                onChange={handleTitleChange}
                onCompositionStart={handleTitleCompositionStart}
                onCompositionEnd={handleTitleCompositionEnd}
                placeholder={t.editor.titlePlaceholder}
                readOnly={!titleEditable}
                autoFocus
                onFocus={(e) => {
                  const input = e.target as HTMLInputElement
                  const pos = headerTitleClickPosRef.current
                  if (pos !== null) {
                    input.setSelectionRange(pos, pos)
                  }
                  headerTitleClickPosRef.current = null
                }}
                onBlur={() => {
                  if (skipNextTitleCommitRef.current) {
                    skipNextTitleCommitRef.current = false
                  } else {
                    onTitleCommit?.(note.id, title)
                  }
                  setIsEditingHeaderTitle(false)
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    setIsEditingHeaderTitle(false)
                    editor?.commands.focus('start')
                  } else if (e.key === 'Escape') {
                    if (onTitleCommit) {
                      setTitle(note.title)
                      skipNextTitleCommitRef.current = true
                    }
                    setIsEditingHeaderTitle(false)
                    editor?.commands.focus()
                  }
                }}
              />
            ) : (
              <span
                className="zen-header-title"
                style={{ WebkitAppRegion: 'no-drag', pointerEvents: showSearchBar ? 'none' : undefined } as React.CSSProperties}
                onClick={(e) => {
                  if (titleEditable && !isEditingHeaderTitle) {
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
          editor?.commands.focus()
        }}
      >
        {/* Agent Task Indicators - overlay layer for dots */}
        <AgentTaskIndicators
          editor={editor}
          containerRef={contentRef as React.RefObject<HTMLElement>}
          onOpenPanel={agentTask.handleOpenAgentTask}
        />

        {/* Editor content area */}
        <div className={`zen-content ${isTypewriterMode ? 'typewriter-mode' : ''}`}>
          {/* Title */}
          <textarea
            ref={titleRef}
            value={title}
            onChange={handleTitleChange}
            onCompositionStart={handleTitleCompositionStart}
            onCompositionEnd={handleTitleCompositionEnd}
            onKeyDown={handleTitleKeyDown}
            onBlur={() => {
              if (skipNextTitleCommitRef.current) {
                skipNextTitleCommitRef.current = false
                return
              }
              onTitleCommit?.(note.id, title)
            }}
            placeholder={t.editor.titlePlaceholder}
            className="zen-title"
            rows={1}
            readOnly={!titleEditable}
          />
          {/* Editor */}
          <div
            onMouseDownCapture={handleEditorMouseDownCapture}
            onContextMenu={handleContextMenu}
            onMouseOver={handleEditorMouseOver}
            onMouseOut={handleEditorMouseOut}
          >
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
        <button
          className="zen-stats-link-btn"
          onMouseDown={handleLinkButtonMouseDown}
          onClick={handleLinkButtonClick}
          title={linkButtonTitle}
          disabled={!canOpenLinkPopover}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
      </div>

      {/* Note link popup */}
      {linkPopup.showLinkPopup && (
        <NoteLinkPopup
          notes={notes.filter(n => n.id !== note.id)}
          query={linkPopup.linkQuery}
          position={linkPopup.linkPopupPosition}
          onSelect={linkPopup.handleSelectNoteLink}
          onCreate={linkPopup.handleCreateNoteLink}
          onClose={linkPopup.handleCloseLinkPopup}
          searchMode={linkPopup.searchMode}
          selectedNote={linkPopup.selectedLinkNote}
          headings={linkPopup.targetHeadings}
          blocks={linkPopup.targetBlocks}
          onSelectNote={linkPopup.handleSelectNoteForSubSearch}
          notebooks={notebooks}
          onQueryChange={linkPopup.setLinkQuery}
          onBack={linkPopup.handleBackToNoteSearch}
        />
      )}

      {/* Transclusion popup - 居中显示 */}
      {transclusionPopup.showTransclusionPopup && (
        <div className="transclusion-popup-overlay" onClick={transclusionPopup.handleCloseTransclusionPopup}>
          <div className="transclusion-popup-container" onClick={(e) => e.stopPropagation()}>
            <NoteLinkPopup
              notes={notes.filter(n => n.id !== note.id)}
              query={transclusionPopup.transclusionQuery}
              position={{ top: 0, left: 0 }} // 位置由 overlay 控制
              onSelect={transclusionPopup.handleSelectTransclusion}
              onClose={transclusionPopup.handleCloseTransclusionPopup}
              searchMode={transclusionPopup.transclusionSearchMode}
              selectedNote={transclusionPopup.selectedTransclusionNote}
              headings={transclusionPopup.transclusionHeadings}
              blocks={transclusionPopup.transclusionBlocks}
              onSelectNote={transclusionPopup.handleSelectNoteForSubSearch}
              isTransclusionMode={true}
              notebooks={notebooks}
              onQueryChange={transclusionPopup.setTransclusionQuery}
              onBack={transclusionPopup.handleBackToNoteSearch}
            />
          </div>
        </div>
      )}

      {/* Embed popup - URL 输入弹窗 */}
      {embedPopup.showEmbedPopup && (
        <div className="embed-popup-overlay" onClick={embedPopup.handleCloseEmbedPopup}>
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
                  value={embedPopup.embedUrl}
                  onChange={(e) => embedPopup.setEmbedUrl(e.target.value)}
                  onKeyDown={(e) => {
                    // IME 输入法组合状态时不响应
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter') {
                      embedPopup.handleInsertEmbed()
                    } else if (e.key === 'Escape') {
                      embedPopup.handleCloseEmbedPopup()
                    }
                  }}
                  autoFocus
                />
                <p className="embed-popup-hint">
                  {t.embed?.securityHint || 'Note: Most websites block iframe embedding for security reasons. Works best with YouTube, Bilibili, Google Maps, etc.'}
                </p>
              </div>
              <div className="embed-popup-footer">
                <button className="embed-popup-cancel" onClick={embedPopup.handleCloseEmbedPopup}>
                  {t.common?.cancel || 'Cancel'}
                </button>
                <button
                  className="embed-popup-confirm"
                  onClick={embedPopup.handleInsertEmbed}
                  disabled={!embedPopup.embedUrl.trim()}
                >
                  {t.embed?.insert || 'Insert'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Link popover */}
      {linkPopoverAnchor && editor && (
        <LinkPopover
          editor={editor}
          anchorEl={linkPopoverAnchor}
          href={linkPopoverHref}
          editMode={linkPopoverEditMode}
          isHover={linkPopoverIsHover}
          savedSelection={linkPopoverSavedSelection}
          onHoverEnter={clearLinkHoverTimer}
          onHoverLeave={scheduleLinkPopoverHoverClose}
          onClose={handleCloseLinkPopover}
        />
      )}

      {/* 右键菜单 */}
      <EditorContextMenu
        editor={editor}
        position={contextMenuPosition}
        onClose={handleCloseContextMenu}
        hasSelection={contextMenuHasSelection}
        savedSelection={contextMenuSavedSelection}
        onShowLinkPopover={showLinkEditPopover}
      />

      {/* Floating Table of Contents */}
      <FloatingToc editor={editor} variant="editor" />

      {/* Agent Task Panel */}
      <AgentTaskPanel
        isOpen={agentTask.agentTaskPanelOpen}
        onClose={agentTask.handleCloseAgentTaskPanel}
        blockIds={agentTask.agentTaskBlockIds}
        taskId={agentTask.agentTaskId}
        blockContent={agentTask.agentTaskBlockContent}
        pageId={note.id}
        notebookId={note.notebook_id ?? null}
        executionContext={agentTask.agentTaskExecutionContext}
        onTaskCreated={agentTask.handleAgentTaskCreated}
        onTaskRemoved={agentTask.handleAgentTaskRemoved}
        onTaskUpdated={agentTask.handleAgentTaskUpdated}
      />
    </div>
  )
})

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { note, paneId, notes, notebooks, titleEditable, editable, onUpdate, onNoteClick, onCreateNote, onTitleCommit, onSelectNote, scrollTarget, onScrollComplete, onTypewriterModeToggle, onSelectionChange, onSplitHorizontal, onSplitVertical, onClosePane, showPaneControls, isFocused },
  ref
) {
  const t = useTranslations()

  return (
    <EditorColumnShell className="bg-[var(--color-card-solid)] relative">
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
          ref={ref}
          note={note}
          paneId={paneId}
          notes={notes}
          notebooks={notebooks}
          titleEditable={titleEditable}
          editable={editable}
          onUpdate={onUpdate}
          onNoteClick={onNoteClick}
          onCreateNote={onCreateNote}
          onTitleCommit={onTitleCommit}
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
    </EditorColumnShell>
  )
})
