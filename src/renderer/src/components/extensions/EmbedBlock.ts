import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EmbedView } from '../EmbedView'
import { withErrorBoundary } from '../NodeViewErrorBoundary'

export type EmbedMode = 'url' | 'local'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EmbedBlockOptions {
  // 可扩展的选项
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedBlock: {
      setEmbed: (attrs: {
        mode: EmbedMode
        url?: string
        localPath?: string
        title?: string
        height?: number
      }) => ReturnType
    }
  }
}

export const EmbedBlock = Node.create<EmbedBlockOptions>({
  name: 'embedBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return {}
  },

  addAttributes() {
    return {
      // 模式：url 或 local
      mode: {
        default: 'url',
        parseHTML: (element) => element.getAttribute('data-mode') || 'url',
        renderHTML: (attributes) => ({ 'data-mode': attributes.mode }),
      },
      // URL 模式的地址
      url: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-url'),
        renderHTML: (attributes) => {
          if (!attributes.url) return {}
          return { 'data-url': attributes.url }
        },
      },
      // Local 模式的路径
      localPath: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-local-path'),
        renderHTML: (attributes) => {
          if (!attributes.localPath) return {}
          return { 'data-local-path': attributes.localPath }
        },
      },
      // 标题
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attributes) => {
          if (!attributes.title) return {}
          return { 'data-title': attributes.title }
        },
      },
      // 高度（px）
      height: {
        default: 300,
        parseHTML: (element) => {
          const val = element.getAttribute('data-height')
          return val ? parseInt(val, 10) : 300
        },
        renderHTML: (attributes) => ({ 'data-height': String(attributes.height) }),
      },
      // 加载状态
      loading: {
        default: true,
        parseHTML: () => true,
        renderHTML: () => ({}),
      },
      // 错误信息
      error: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-embed]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-embed': '',
        class: 'embed-block',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(withErrorBoundary(EmbedView, 'Failed to render embed'))
  },

  addCommands() {
    return {
      setEmbed:
        (attrs: {
          mode: EmbedMode
          url?: string
          localPath?: string
          title?: string
          height?: number
        }) =>
        ({ commands }: { commands: { insertContent: (content: { type: string; attrs: unknown }) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },
})
