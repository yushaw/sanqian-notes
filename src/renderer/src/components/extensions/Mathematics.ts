import { Node, mergeAttributes, type InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { MathView } from '../MathView'

export interface MathOptions {
  katexOptions?: Record<string, unknown>
}

// 共享的数学公式属性配置
const mathAttributes = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex'),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-latex': attributes.latex,
    }),
  },
  display: {
    default: 'no',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-display'),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-display': attributes.display,
    }),
  },
}

// 块级数学公式扩展 - 仅用于兼容旧数据
// 新数据统一使用 inlineMath + display: 'yes'（包裹在 paragraph 中）
// 保留此扩展确保旧笔记中的 'mathematics' 类型能正常渲染
export const BlockMath = Node.create<MathOptions>({
  name: 'mathematics',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return mathAttributes
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="blockMath"]' },
      { tag: 'div[data-type="mathematics"]' },  // 兼容旧数据
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'blockMath' }),
      `$$${HTMLAttributes['data-latex'] || ''}$$`,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathView)
  },
})

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
    return mathAttributes
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
