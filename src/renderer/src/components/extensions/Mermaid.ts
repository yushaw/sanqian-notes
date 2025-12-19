import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MermaidView } from '../MermaidView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      setMermaid: () => ReturnType
    }
  }
}

export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: 'graph TD\n    A[开始] --> B[结束]',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid]',
      },
      {
        tag: 'pre.mermaid',
        getAttrs: (element) => ({
          code: (element as HTMLPreElement).textContent || '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-mermaid': '' }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView)
  },

  addCommands() {
    return {
      setMermaid:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              code: 'graph TD\n    A[开始] --> B[结束]',
            },
          })
        },
    }
  },
})
