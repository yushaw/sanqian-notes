/**
 * Custom HorizontalRule extension
 *
 * 增强默认的分隔线扩展：
 * 1. 增大可点击区域（通过包装 div）
 * 2. 支持选中状态视觉反馈
 * 3. 点击即可选中
 */

import { Node, mergeAttributes, type InputRule } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

export const CustomHorizontalRule = Node.create({
  name: 'horizontalRule',

  group: 'block',

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  parseHTML() {
    return [{ tag: 'hr' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'hr-wrapper', 'data-type': 'horizontal-rule' },
      ['hr', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)],
    ]
  },

  // @ts-expect-error - TipTap 3.x type mismatch with addCommands return type
  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ chain, state }) => {
          const { selection } = state
          const { $to: $originTo } = selection

          const currentChain = chain()

          if (selection instanceof NodeSelection) {
            currentChain.insertContentAt($originTo.pos, { type: this.name })
          } else {
            currentChain.insertContent({ type: this.name })
          }

          return currentChain
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                const { $to } = tr.selection
                const posAfter = $to.end()

                if ($to.nodeAfter) {
                  if ($to.nodeAfter.isTextblock) {
                    tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1))
                  } else if ($to.nodeAfter.isBlock) {
                    tr.setSelection(NodeSelection.create(tr.doc, $to.pos))
                  }
                } else {
                  // Insert a paragraph after if at end
                  const nodeType = $to.parent.type.contentMatch.defaultType
                  if (nodeType) {
                    const node = nodeType.create()
                    tr.insert(posAfter, node)
                    tr.setSelection(TextSelection.near(tr.doc.resolve(posAfter + 1)))
                  }
                }
                tr.scrollIntoView()
              }
              return true
            })
            .run()
        },
    }
  },

  addInputRules(): InputRule[] {
    return [
      {
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        handler: ({ state, range, match }: { state: { tr: { replaceWith: (from: number, to: number, node: unknown) => unknown } }; range: { from: number; to: number }; match: string[] }) => {
          const { tr } = state
          if (match[0]) {
            tr.replaceWith(range.from - 1, range.to, this.type.create())
          }
          return tr
        },
      } as unknown as InputRule,
    ]
  },

  // 添加点击选中的插件
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('horizontalRuleClick'),
        props: {
          handleClick: (view, pos, event) => {
            const target = event.target as HTMLElement

            // 检查是否点击了 hr 或其包装器
            if (
              target.tagName === 'HR' ||
              target.classList.contains('hr-wrapper') ||
              target.closest('.hr-wrapper')
            ) {
              const { doc } = view.state

              // 找到对应的节点位置
              let hrPos = pos
              const resolved = doc.resolve(pos)

              // 向上查找 horizontalRule 节点
              for (let d = resolved.depth; d >= 0; d--) {
                const node = resolved.node(d)
                if (node.type.name === 'horizontalRule') {
                  hrPos = resolved.before(d)
                  break
                }
              }

              // 尝试在当前位置或附近找到 hr 节点
              const $pos = doc.resolve(hrPos)
              let nodePos = hrPos

              // 检查当前位置
              if ($pos.nodeAfter?.type.name === 'horizontalRule') {
                nodePos = hrPos
              } else if ($pos.nodeBefore?.type.name === 'horizontalRule') {
                nodePos = hrPos - $pos.nodeBefore.nodeSize
              } else {
                // 在父节点中查找
                const parent = $pos.parent
                let offset = 0
                for (let i = 0; i < parent.childCount; i++) {
                  const child = parent.child(i)
                  if (child.type.name === 'horizontalRule') {
                    const childPos = $pos.start() + offset
                    // 检查点击位置是否在这个 hr 范围内
                    if (pos >= childPos && pos <= childPos + child.nodeSize) {
                      nodePos = childPos
                      break
                    }
                  }
                  offset += child.nodeSize
                }
              }

              // 创建 NodeSelection
              try {
                const selection = NodeSelection.create(doc, nodePos)
                const tr = view.state.tr.setSelection(selection)
                view.dispatch(tr)
                return true
              } catch {
                // 如果创建选择失败，忽略
                return false
              }
            }

            return false
          },
        },
      }),
    ]
  },
})
