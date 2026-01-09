import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TransclusionView } from '../TransclusionView'
import { withErrorBoundary } from '../NodeViewErrorBoundary'

export interface TransclusionBlockOptions {
  onNoteClick?: (noteId: string, target?: { type: 'heading' | 'block'; value: string }) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    transclusionBlock: {
      setTransclusion: (attrs: {
        noteId: string
        noteName: string
        targetType?: 'note' | 'heading' | 'block'
        targetValue?: string
      }) => ReturnType
    }
  }
}

export const TransclusionBlock = Node.create<TransclusionBlockOptions>({
  name: 'transclusionBlock',
  group: 'block',
  atom: true, // 不可编辑内部内容
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      onNoteClick: undefined,
    }
  },

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-id'),
        renderHTML: (attributes) => {
          if (!attributes.noteId) return {}
          return { 'data-note-id': attributes.noteId }
        },
      },
      noteName: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-note-name'),
        renderHTML: (attributes) => {
          if (!attributes.noteName) return {}
          return { 'data-note-name': attributes.noteName }
        },
      },
      // 目标类型: note | heading | block
      targetType: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-target-type') || 'note',
        renderHTML: (attributes) => {
          if (!attributes.targetType || attributes.targetType === 'note') return {}
          return { 'data-target-type': attributes.targetType }
        },
      },
      // 目标值: 标题文本 或 blockId
      targetValue: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-target-value'),
        renderHTML: (attributes) => {
          if (!attributes.targetValue) return {}
          return { 'data-target-value': attributes.targetValue }
        },
      },
      // 是否折叠
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => {
          return { 'data-collapsed': attributes.collapsed ? 'true' : 'false' }
        },
      },
      // 最大高度
      maxHeight: {
        default: 300,
        parseHTML: (element) => {
          const val = element.getAttribute('data-max-height')
          return val ? parseInt(val, 10) : 300
        },
        renderHTML: (attributes) => {
          return { 'data-max-height': String(attributes.maxHeight) }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-transclusion]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-transclusion': '',
        class: 'transclusion-block',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(withErrorBoundary(TransclusionView, 'Failed to render transclusion'))
  },

  addCommands() {
    return {
      setTransclusion:
        (attrs: {
          noteId: string
          noteName: string
          targetType?: 'note' | 'heading' | 'block'
          targetValue?: string
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
