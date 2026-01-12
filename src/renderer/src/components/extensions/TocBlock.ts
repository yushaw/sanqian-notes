import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TocView } from './TocView'
import { withErrorBoundary } from '../NodeViewErrorBoundary'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tocBlock: {
      setTocBlock: () => ReturnType
    }
  }
}

export const TocBlock = Node.create({
  name: 'tocBlock',
  group: 'block',
  atom: true, // 不可编辑内部内容
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.collapsed) return {}
          return { 'data-collapsed': 'true' }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-toc-block]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-toc-block': '',
        class: 'toc-block',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(withErrorBoundary(TocView, 'Failed to render table of contents'))
  },

  addCommands() {
    return {
      setTocBlock:
        () =>
        ({ commands }: { commands: { insertContent: (content: { type: string }) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
          })
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },
})
