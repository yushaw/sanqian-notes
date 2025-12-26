import { Extension } from '@tiptap/core'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { getFileCategory } from '../../utils/fileCategory'
import { translations, getSystemLanguage } from '../../i18n/translations'

// Helper to get current translation
function getT() {
  return translations[getSystemLanguage()]
}

export interface SlashCommandItem {
  id: string  // 用于查找翻译的 key
  icon: string
  command: (editor: Editor) => void | boolean | Promise<void | boolean>
  keywords?: string[]
  // AI action specific fields
  isAIAction?: boolean
  aiActionId?: string
  aiName?: string  // Display name from database
  aiDescription?: string  // Description from database
  aiPrompt?: string
  aiMode?: 'replace' | 'insert' | 'popup'
  // For grouping in the list
  group?: 'format' | 'insert' | 'ai'
}

// Event for triggering AI actions from slash command
export const SLASH_AI_ACTION_EVENT = 'slash-ai-action'

export interface SlashAIActionDetail {
  actionId: string
  prompt: string
  mode: 'replace' | 'insert' | 'popup'
  selectedText: string
}

export function triggerSlashAIAction(detail: SlashAIActionDetail) {
  window.dispatchEvent(new CustomEvent(SLASH_AI_ACTION_EVENT, { detail }))
}

// Cache for AI actions
let cachedAIActions: SlashCommandItem[] = []
let lastFetchTime = 0
const CACHE_DURATION = 5000 // 5 seconds

// Fetch AI actions from electron API
async function fetchAIActions(): Promise<SlashCommandItem[]> {
  const now = Date.now()
  if (cachedAIActions.length > 0 && now - lastFetchTime < CACHE_DURATION) {
    return cachedAIActions
  }

  try {
    const actions = await window.electron.aiAction.getAll()
    cachedAIActions = actions
      .filter((a: AIAction) => a.showInSlashCommand)
      .map((action: AIAction) => ({
        id: `ai-${action.id}`,
        icon: action.icon || '✨',
        keywords: ['ai', action.name.toLowerCase(), ...action.name.split('')],
        isAIAction: true,
        aiActionId: action.id,
        aiName: action.name,
        aiDescription: action.description,
        aiPrompt: action.prompt,
        aiMode: action.mode,
        group: 'ai' as const,
        command: (editor: Editor) => {
          // Get selected text if any
          const { from, to } = editor.state.selection
          const selectedText = from !== to ? editor.state.doc.textBetween(from, to, ' ') : ''

          // Trigger AI action via event
          triggerSlashAIAction({
            actionId: action.id,
            prompt: action.prompt,
            mode: action.mode,
            selectedText
          })
        }
      }))
    lastFetchTime = now
    return cachedAIActions
  } catch (error) {
    console.error('[SlashCommand] Failed to fetch AI actions:', error)
    return cachedAIActions // Return cached even if stale
  }
}

// Notify that AI actions have changed (call from settings)
export function invalidateAIActionsCache() {
  lastFetchTime = 0
  cachedAIActions = []
}

export const slashCommands: SlashCommandItem[] = [
  {
    id: 'paragraph',
    icon: '¶',
    keywords: ['paragraph', 'text', 'body', 'zhengwen'],
    command: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'heading1',
    icon: 'H1',
    keywords: ['h1', 'heading1', 'biaoti'],
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2',
    icon: 'H2',
    keywords: ['h2', 'heading2'],
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3',
    icon: 'H3',
    keywords: ['h3', 'heading3'],
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    icon: '•',
    keywords: ['bullet', 'list', 'ul', 'liebiao'],
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numberedList',
    icon: '1.',
    keywords: ['numbered', 'ordered', 'ol'],
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    icon: '☑',
    keywords: ['todo', 'task', 'checkbox', 'daiban'],
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    icon: '"',
    keywords: ['quote', 'blockquote', 'yinyong'],
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    icon: '</>',
    keywords: ['code', 'codeblock', 'daima'],
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    icon: '—',
    keywords: ['hr', 'divider', 'line', 'fenge'],
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'table',
    icon: '▦',
    keywords: ['table', 'biaoge'],
    command: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'toggle',
    icon: '▶',
    keywords: ['toggle', 'collapse', 'details', 'zhedie'],
    command: (editor) => editor.chain().focus().setToggle().run(),
  },
  {
    id: 'calloutNote',
    icon: 'ℹ',
    keywords: ['callout', 'note', 'info', 'tishi'],
    command: (editor) => editor.chain().focus().setCallout({ type: 'note' }).run(),
  },
  {
    id: 'calloutTip',
    icon: '💡',
    keywords: ['callout', 'tip', 'hint'],
    command: (editor) => editor.chain().focus().setCallout({ type: 'tip' }).run(),
  },
  {
    id: 'calloutWarning',
    icon: '⚠',
    keywords: ['callout', 'warning', 'caution', 'jinggao'],
    command: (editor) => editor.chain().focus().setCallout({ type: 'warning' }).run(),
  },
  {
    id: 'calloutDanger',
    icon: '🚫',
    keywords: ['callout', 'danger', 'error', 'weixian'],
    command: (editor) => editor.chain().focus().setCallout({ type: 'danger' }).run(),
  },
  {
    id: 'math',
    icon: '∑',
    keywords: ['math', 'latex', 'formula', 'gongshi', 'shuxue'],
    command: (editor) => editor.chain().focus().insertContent('$E = mc^2$').run(),
  },
  {
    id: 'mermaid',
    icon: '📊',
    keywords: ['mermaid', 'diagram', 'flowchart', 'chart', 'tubiao', 'liucheng'],
    command: (editor) => editor.chain().focus().setMermaid().run(),
  },
  {
    id: 'footnote',
    icon: '¹',
    keywords: ['footnote', 'note', 'reference', 'jiaozhu'],
    command: (editor) => editor.chain().focus().setFootnote().run(),
  },
  {
    id: 'image',
    icon: '🖼️',
    keywords: ['image', 'picture', 'photo', 'tupian', 'img'],
    command: async (editor) => {
      try {
        const files = await window.electron.attachment.selectImages()
        if (!files?.length) return

        for (const filePath of files) {
          const result = await window.electron.attachment.save(filePath)
          const attachmentUrl = `attachment://${result.relativePath}`
          editor.chain().focus().setImage({
            src: attachmentUrl,
            alt: result.name,
          }).run()
        }
      } catch (error) {
        console.error('Failed to insert image:', error)
        const message = error instanceof Error ? error.message : getT().common.unknownError
        alert(getT().fileError.insertImageFailed.replace('{error}', message))
      }
    },
  },
  {
    id: 'file',
    icon: '📎',
    keywords: ['file', 'attachment', 'fujian', 'wenjian', 'upload'],
    command: async (editor) => {
      try {
        const files = await window.electron.attachment.selectFiles({ multiple: true })
        if (!files?.length) return

        for (const filePath of files) {
          const result = await window.electron.attachment.save(filePath)
          const category = getFileCategory(result.name)
          const attachmentUrl = `attachment://${result.relativePath}`

          switch (category) {
            case 'image':
              editor.chain().focus().setImage({
                src: attachmentUrl,
                alt: result.name,
              }).run()
              break
            case 'video':
              editor.commands.setVideo({ src: attachmentUrl })
              break
            case 'audio':
              editor.commands.setAudio({ src: attachmentUrl, title: result.name })
              break
            default:
              editor.commands.setFileAttachment({
                src: result.relativePath,
                name: result.name,
                size: result.size,
                type: result.type,
              })
          }
        }
      } catch (error) {
        console.error('Failed to insert file:', error)
        const message = error instanceof Error ? error.message : getT().common.unknownError
        alert(getT().fileError.insertFileFailed.replace('{error}', message))
      }
    },
  },
]

export interface SlashCommandOptions {
  suggestion: Partial<Omit<SuggestionOptions<SlashCommandItem>, 'allowedPrefixes'>> & {
    allowedPrefixes?: (string | null)[]
  }
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        // 只在行首或空格后触发 slash 命令
        // null = 行首, ' ' = 空格后
        allowedPrefixes: [' ', null] as (string | null)[],
        // 自定义触发条件：光标后面如果有非空格内容则不触发
        allow: ({ state, range }: { state: any; range: { from: number; to: number } }) => {
          const $from = state.doc.resolve(range.from)
          const textAfter = $from.parent.textBetween(
            range.to - $from.start(),
            $from.parent.content.size,
            '\0',
            '\0'
          )
          // 如果光标后有非空格内容，不触发
          if (textAfter && textAfter.length > 0 && !/^\s*$/.test(textAfter)) {
            return false
          }
          return true
        },
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashCommandItem }) => {
          // 删除触发字符和查询文本（不加入撤销历史）
          const { tr } = editor.state
          tr.delete(range.from, range.to)
          tr.setMeta('addToHistory', false)
          editor.view.dispatch(tr)
          // 执行命令
          props.command(editor)
        },
      },
    }
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suggestionConfig: any = {
      ...this.options.suggestion,
      items: async ({ query }: { query: string }) => {
        const search = query.toLowerCase()

        // Get AI actions dynamically
        const aiActions = await fetchAIActions()
        const allItems = [...slashCommands, ...aiActions]

        return allItems.filter((item) => {
          const matchId = item.id.toLowerCase().includes(search)
          const matchKeywords = item.keywords?.some((k) => k.includes(search))

          // For AI actions, match aiName and aiDescription
          const matchAIName = item.aiName?.toLowerCase().includes(search)
          const matchAIDesc = item.aiDescription?.toLowerCase().includes(search)

          // For built-in commands, match translated title and description (both zh and en)
          let matchTitle = false
          let matchDesc = false
          if (!item.isAIAction) {
            const zhTitle = translations.zh.slashCommand[item.id as keyof typeof translations.zh.slashCommand]
            const enTitle = translations.en.slashCommand[item.id as keyof typeof translations.en.slashCommand]
            const zhDesc = translations.zh.slashCommand[`${item.id}Desc` as keyof typeof translations.zh.slashCommand]
            const enDesc = translations.en.slashCommand[`${item.id}Desc` as keyof typeof translations.en.slashCommand]
            matchTitle = zhTitle?.toLowerCase().includes(search) || enTitle?.toLowerCase().includes(search)
            matchDesc = zhDesc?.toLowerCase().includes(search) || enDesc?.toLowerCase().includes(search)
          }

          return matchId || matchKeywords || matchAIName || matchAIDesc || matchTitle || matchDesc
        })
      },
    }

    // 支持多个触发字符：/ (半角), ／ (全角), 、(顿号)
    return [
      // 半角 /
      Suggestion({
        editor: this.editor,
        ...suggestionConfig,
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
      }),
      // 全角 ／
      Suggestion({
        editor: this.editor,
        ...suggestionConfig,
        char: '／',
        pluginKey: new PluginKey('slashCommandFullwidth'),
      }),
      // 中文顿号 、
      Suggestion({
        editor: this.editor,
        ...suggestionConfig,
        char: '、',
        pluginKey: new PluginKey('slashCommandDunhao'),
      }),
    ]
  },
})
