import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { FootnoteView } from '../FootnoteView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      setFootnote: (content?: string) => ReturnType
    }
  }
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
      },
      content: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-footnote]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-footnote': '', class: 'footnote-ref' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView)
  },

  addCommands() {
    return {
      setFootnote:
        (content = '') =>
        ({ commands, state }) => {
          // 找到最大的脚注 ID，生成新 ID
          let maxId = 0
          state.doc.descendants((node) => {
            if (node.type.name === 'footnote' && node.attrs.id) {
              maxId = Math.max(maxId, node.attrs.id as number)
            }
          })

          return commands.insertContent({
            type: this.name,
            attrs: {
              id: maxId + 1,
              content,
            },
          })
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-f': () => this.editor.commands.setFootnote(),
    }
  },
})
