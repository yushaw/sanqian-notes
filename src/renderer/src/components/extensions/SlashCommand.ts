import { Extension } from '@tiptap/core'
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion'
import type { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { getFileCategory } from '../../utils/fileCategory'

export interface SlashCommandItem {
  id: string  // 用于查找翻译的 key
  icon: string
  command: (editor: Editor) => void | boolean | Promise<void | boolean>
  keywords?: string[]
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
        const message = error instanceof Error ? error.message : 'Unknown error'
        alert(`插入图片失败：${message}`)
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
        const message = error instanceof Error ? error.message : 'Unknown error'
        alert(`插入文件失败：${message}`)
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
          // 先删除触发字符和查询文本，再执行命令
          editor.chain().focus().deleteRange(range).run()
          props.command(editor)
        },
      },
    }
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suggestionConfig: any = {
      ...this.options.suggestion,
      items: ({ query }: { query: string }) => {
        const search = query.toLowerCase()
        return slashCommands.filter((item) => {
          const matchId = item.id.toLowerCase().includes(search)
          const matchKeywords = item.keywords?.some((k) => k.includes(search))
          return matchId || matchKeywords
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
