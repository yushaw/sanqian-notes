import { Node, mergeAttributes, type InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathView } from '../MathView'

export interface MathOptions {
  katexOptions?: Record<string, unknown>
}

// Custom inline math node with click-to-edit behavior
export const Mathematics = Node.create<MathOptions>({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      katexOptions: {
        throwOnError: false,
        strict: false,
      },
    }
  },

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex'),
        renderHTML: (attributes) => ({
          'data-latex': attributes.latex,
        }),
      },
      display: {
        default: 'no',
        parseHTML: (element) => element.getAttribute('data-display'),
        renderHTML: (attributes) => ({
          'data-display': attributes.display,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="inlineMath"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'inlineMath' }),
      `$${HTMLAttributes['data-latex'] || ''}$`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView)
  },

  addInputRules(): InputRule[] {
    type InputRuleHandler = { state: { tr: { replaceWith: (from: number, to: number, node: unknown) => unknown } }; range: { from: number; to: number }; match: string[] }
    return [
      // Inline math: $...$
      {
        find: /(?<!\$)\$([^$\s][^$]*[^$\s]|[^$\s])\$$/,
        handler: ({ state, range, match }: InputRuleHandler) => {
          const latex = match[1]
          if (!latex) return null

          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ latex, display: 'no' }))
          return tr
        },
      } as unknown as InputRule,
      // Block math: $$...$$
      {
        find: /\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }: InputRuleHandler) => {
          const latex = match[1]
          if (!latex) return null

          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ latex, display: 'yes' }))
          return tr
        },
      } as unknown as InputRule,
    ]
  },
})
