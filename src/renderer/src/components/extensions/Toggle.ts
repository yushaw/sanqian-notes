import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ToggleView } from '../ToggleView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType
    }
  }
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-open') !== 'false',
        renderHTML: (attributes) => ({ 'data-open': attributes.open ? 'true' : 'false' }),
      },
      summary: {
        default: '点击展开',
        parseHTML: (element) => element.getAttribute('data-summary') || '点击展开',
        renderHTML: (attributes) => ({ 'data-summary': attributes.summary }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-toggle]',
      },
      {
        tag: 'details',
        getAttrs: (element) => {
          const el = element as HTMLDetailsElement
          const summary = el.querySelector('summary')?.textContent || '点击展开'
          return {
            open: el.open,
            summary,
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-toggle': '',
        class: 'toggle-block',
      }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }: { commands: { wrapIn: (name: string) => boolean } }) => {
          return commands.wrapIn(this.name)
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-t': () => this.editor.commands.setToggle(),
    }
  },
})
