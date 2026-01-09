/**
 * AgentTask Extension
 *
 * 为任意块级节点添加 agent 任务能力
 * - 使用全局属性 agentTaskId 关联任务
 * - 圆点指示器通过外部 overlay 组件渲染（AgentTaskIndicators）
 * - 点击图标/状态打开任务面板
 */

import { Extension, CommandProps } from '@tiptap/core'
import { Node as ProseMirrorNodeType } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// Declare module augmentation for custom commands
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    agentTask: {
      setAgentTask: (blockId: string, taskId: string) => ReturnType
      removeAgentTask: (blockId: string) => ReturnType
      setManagedBy: (blockId: string, managerBlockId: string) => ReturnType
      clearManagedBy: (blockId: string) => ReturnType
      deleteManagedBlocks: (managerBlockId: string) => ReturnType
      refreshAgentTaskDecorations: () => ReturnType
    }
  }
}

// Extension options
export interface AgentTaskOptions {
  onOpenPanel: (blockId: string, taskId: string | null, blockContent: string) => void
}

// Plugin state - tracks version for triggering re-renders
interface AgentTaskPluginState {
  version: number
}

export const agentTaskPluginKey = new PluginKey<AgentTaskPluginState>('agentTask')

/**
 * AgentTask Extension
 */
export const AgentTask = Extension.create<AgentTaskOptions>({
  name: 'agentTask',

  addOptions() {
    return {
      onOpenPanel: () => {},
    }
  },

  addGlobalAttributes() {
    return [
      {
        // Apply to common block nodes
        types: [
          'paragraph',
          'heading',
          'blockquote',
          'codeBlock',
          'listItem',
          'taskItem',
          'bulletList',
          'orderedList',
          'taskList',
          'table',
        ],
        attributes: {
          agentTaskId: {
            default: null,
            keepOnSplit: false, // Don't copy to new block when pressing Enter
            parseHTML: (element) => element.getAttribute('data-agent-task-id'),
            renderHTML: (attributes) => {
              if (!attributes.agentTaskId) return {}
              return { 'data-agent-task-id': attributes.agentTaskId }
            },
          },
          // managedBy: 标记输出 block 被哪个 agent block 管理
          // 值为 agent block 的 blockId
          // 用户编辑时清除此属性，断开管理关系
          managedBy: {
            default: null,
            keepOnSplit: false, // Don't copy to new block when pressing Enter
            parseHTML: (element) => element.getAttribute('data-managed-by'),
            renderHTML: (attributes) => {
              if (!attributes.managedBy) return {}
              return { 'data-managed-by': attributes.managedBy }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      /**
       * Set agent task ID on a block
       */
      setAgentTask:
        (blockId: string, taskId: string) =>
        ({ tr, state, dispatch }: CommandProps) => {
          let found = false

          state.doc.descendants((node: ProseMirrorNodeType, pos: number) => {
            if (node.attrs.blockId === blockId && !found) {
              found = true
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  agentTaskId: taskId,
                })
              }
            }
          })

          if (found && dispatch) {
            dispatch(tr)
          }

          return found
        },

      /**
       * Remove agent task from a block
       */
      removeAgentTask:
        (blockId: string) =>
        ({ tr, state, dispatch }: CommandProps) => {
          let found = false

          state.doc.descendants((node: ProseMirrorNodeType, pos: number) => {
            if (node.attrs.blockId === blockId && node.attrs.agentTaskId && !found) {
              found = true
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  agentTaskId: null,
                })
              }
            }
          })

          if (found && dispatch) {
            dispatch(tr)
          }

          return found
        },

      /**
       * Set managedBy attribute on a block (mark it as managed by an agent block)
       */
      setManagedBy:
        (blockId: string, managerBlockId: string) =>
        ({ tr, state, dispatch }: CommandProps) => {
          let found = false

          state.doc.descendants((node: ProseMirrorNodeType, pos: number) => {
            if (node.attrs.blockId === blockId && !found) {
              found = true
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  managedBy: managerBlockId,
                })
              }
            }
          })

          if (found && dispatch) {
            dispatch(tr)
          }

          return found
        },

      /**
       * Clear managedBy attribute from a block (disconnect from agent management)
       */
      clearManagedBy:
        (blockId: string) =>
        ({ tr, state, dispatch }: CommandProps) => {
          let found = false

          state.doc.descendants((node: ProseMirrorNodeType, pos: number) => {
            if (node.attrs.blockId === blockId && node.attrs.managedBy && !found) {
              found = true
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  managedBy: null,
                })
              }
            }
          })

          if (found && dispatch) {
            dispatch(tr)
          }

          return found
        },

      /**
       * Delete all blocks managed by a specific agent block
       * Used when agent block is deleted or when retrying to clear old output
       */
      deleteManagedBlocks:
        (managerBlockId: string) =>
        ({ tr, state, dispatch }: CommandProps) => {
          // Collect positions of nodes to delete (in reverse order to avoid position shifts)
          const toDelete: Array<{ from: number; to: number }> = []

          state.doc.descendants((node: ProseMirrorNodeType, pos: number) => {
            if (node.attrs.managedBy === managerBlockId) {
              toDelete.push({ from: pos, to: pos + node.nodeSize })
            }
          })

          if (toDelete.length === 0) {
            return false
          }

          if (dispatch) {
            // Delete in reverse order to maintain correct positions
            toDelete.reverse().forEach(({ from, to }) => {
              tr.delete(from, to)
            })
            dispatch(tr)
          }

          return true
        },

      /**
       * Force refresh (triggers version bump for overlay re-render)
       */
      refreshAgentTaskDecorations:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          if (dispatch) {
            tr.setMeta(agentTaskPluginKey, { refresh: true })
            dispatch(tr)
          }
          return true
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: agentTaskPluginKey,

        state: {
          init() {
            return { version: 0 }
          },

          apply(tr, pluginState) {
            // Bump version if document changed or explicitly requested
            if (tr.docChanged || tr.getMeta(agentTaskPluginKey)) {
              return { version: pluginState.version + 1 }
            }
            return pluginState
          },
        },
      }),
    ]
  },
})

export default AgentTask
