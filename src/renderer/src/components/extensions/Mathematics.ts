import { Node, mergeAttributes, type InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state'
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

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state
        const { $from } = selection

        // 检查是否在 block math 后面的位置（下一个节点的开头）
        // 对于 block 节点，需要检查父节点的前一个兄弟节点
        const { $anchor } = selection
        const parentOffset = $anchor.parentOffset

        // 如果光标在段落开头，检查前面的兄弟节点
        if (parentOffset === 0) {
          const resolvedPos = editor.state.doc.resolve($from.before())
          const nodeBefore = resolvedPos.nodeBefore
          if (nodeBefore?.type.name === 'mathematics') {
            const from = resolvedPos.pos - nodeBefore.nodeSize
            const to = resolvedPos.pos
            editor.commands.deleteRange({ from, to })
            return true
          }
        }

        return false
      },
    }
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('inlineMathArrowHandler'),
        props: {
          handleKeyDown: (view, event) => {
            // 只处理上下左右箭头键
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
              return false
            }

            const { state } = view
            const { selection } = state
            const { $from, $to } = selection

            // 如果已经选中了 math 节点，让默认行为处理
            if (selection instanceof NodeSelection && selection.node.type.name === 'inlineMath') {
              return false
            }

            // 检查当前位置的左右是否有 inlineMath 节点
            const checkAdjacentMath = (pos: number, direction: 'before' | 'after') => {
              const resolved = state.doc.resolve(pos)
              if (direction === 'before') {
                const nodeBefore = resolved.nodeBefore
                if (nodeBefore?.type.name === 'inlineMath') {
                  return { node: nodeBefore, pos: pos - nodeBefore.nodeSize }
                }
              } else {
                const nodeAfter = resolved.nodeAfter
                if (nodeAfter?.type.name === 'inlineMath') {
                  return { node: nodeAfter, pos: pos }
                }
              }
              return null
            }

            // 左箭头：检查光标左边是否有 math
            if (event.key === 'ArrowLeft' && !event.shiftKey) {
              const mathInfo = checkAdjacentMath($from.pos, 'before')
              if (mathInfo) {
                const tr = state.tr.setSelection(NodeSelection.create(state.doc, mathInfo.pos))
                view.dispatch(tr)
                return true
              }
            }

            // 右箭头：检查光标右边是否有 math
            if (event.key === 'ArrowRight' && !event.shiftKey) {
              const mathInfo = checkAdjacentMath($to.pos, 'after')
              if (mathInfo) {
                const tr = state.tr.setSelection(NodeSelection.create(state.doc, mathInfo.pos))
                view.dispatch(tr)
                return true
              }
            }

            // 上下箭头：检查移动后是否会跳过 math 节点
            if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) {
              // 找到当前段落的位置范围
              const currentBlockStart = $from.start()
              const currentBlockEnd = $from.end()

              // 查找相邻的段落
              const doc = state.doc
              let targetBlock: { start: number; end: number; node: unknown } | null = null

              if (event.key === 'ArrowDown') {
                // 向下：找下一个段落
                const afterCurrentBlock = currentBlockEnd + 1
                if (afterCurrentBlock < doc.content.size) {
                  const resolved = doc.resolve(afterCurrentBlock)
                  if (resolved.parent.type.name === 'paragraph' || resolved.nodeAfter?.type.name === 'paragraph') {
                    const nextNode = resolved.nodeAfter || resolved.parent
                    if (nextNode.type.name === 'paragraph') {
                      targetBlock = {
                        start: afterCurrentBlock + 1,
                        end: afterCurrentBlock + nextNode.nodeSize - 1,
                        node: nextNode
                      }
                    }
                  }
                }
              } else {
                // 向上：找上一个段落
                const beforeCurrentBlock = currentBlockStart - 2
                if (beforeCurrentBlock > 0) {
                  const resolved = doc.resolve(beforeCurrentBlock)
                  if (resolved.parent.type.name === 'paragraph') {
                    targetBlock = {
                      start: resolved.start(),
                      end: resolved.end(),
                      node: resolved.parent
                    }
                  }
                }
              }

              // 检查目标段落是否有 math 节点
              if (targetBlock) {
                const targetNode = targetBlock.node as { forEach: (fn: (node: { type: { name: string }; nodeSize: number }, offset: number) => void) => void }
                let foundMath: { pos: number; size: number } | null = null

                targetNode.forEach((node, offset) => {
                  if (node.type.name === 'inlineMath' && !foundMath) {
                    foundMath = { pos: targetBlock!.start + offset, size: node.nodeSize }
                  }
                })

                if (foundMath) {
                  const tr = state.tr.setSelection(NodeSelection.create(state.doc, foundMath.pos))
                  view.dispatch(tr)
                  return true
                }
              }
            }

            return false
          },
        },
      }),
    ]
  },
})
