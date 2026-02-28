import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AIPopupMarkView } from '../AIPopupMarkView'
import { deletePopup } from '../../utils/popupStorage'

export interface AIPopupMarkOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiPopupMark: {
      /**
       * Insert an AI popup mark at the current position
       */
      insertAIPopupMark: (attrs: { popupId: string }) => ReturnType
      /**
       * Delete an AI popup mark by popupId
       */
      deleteAIPopupMark: (popupId: string) => ReturnType
    }
  }
}

export const AIPopupMark = Node.create<AIPopupMarkOptions>({
  name: 'aiPopupMark',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'ai-popup-mark',
      },
    }
  },

  addAttributes() {
    return {
      popupId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-popup-id'),
        renderHTML: (attributes) => ({
          'data-popup-id': attributes.popupId,
        }),
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-created-at')
          return val ? parseInt(val, 10) : null
        },
        renderHTML: (attributes) => ({
          'data-created-at': attributes.createdAt?.toString(),
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ai-popup-mark]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-ai-popup-mark': '',
      }),
      // Fallback content for non-React rendering
      '\u2728', // Sparkles emoji as fallback
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AIPopupMarkView)
  },

  addCommands() {
    return {
      insertAIPopupMark:
        (attrs: { popupId: string }) =>
        ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              popupId: attrs.popupId,
              createdAt: Date.now(),
            },
          })
        },
      deleteAIPopupMark:
        (popupId: string) =>
        ({ tr, state }: { tr: import('@tiptap/pm/state').Transaction; state: import('@tiptap/pm/state').EditorState }) => {
          let deleted = false
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.popupId === popupId) {
              tr.delete(pos, pos + node.nodeSize)
              deleted = true
              return false // Stop traversal
            }
          })
          return deleted
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },

  addKeyboardShortcuts() {
    // 共用的删除处理逻辑
    const handleDelete = ({ editor }: { editor: import('@tiptap/core').Editor }) => {
      const { selection } = editor.state
      const node = editor.state.doc.nodeAt(selection.from)
      if (node?.type.name === this.name) {
        const popupId = node.attrs.popupId
        editor.commands.deleteSelection()
        if (popupId) {
          deletePopup(popupId)
        }
        return true
      }
      return false
    }

    return {
      Backspace: handleDelete,
      Delete: handleDelete,
    }
  },
})
