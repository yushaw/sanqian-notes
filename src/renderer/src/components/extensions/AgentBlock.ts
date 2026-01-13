/**
 * AgentBlock Extension
 *
 * 独立的 Agent Block 节点类型
 * - 预配置 Agent、prompt、输出格式
 * - 支持手动执行、立即执行、定时执行
 * - 块级卡片 UI 显示配置和状态
 */

import { Node, mergeAttributes, CommandProps } from '@tiptap/core'
import { v4 as uuidv4 } from 'uuid'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AgentBlockView } from '../AgentBlockView'
import { withErrorBoundary } from '../NodeViewErrorBoundary'
import type { AgentTaskStatus, AgentTaskOutputFormat, AgentTaskProcessMode } from '../../../../shared/types'

export interface AgentBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

export interface AgentBlockAttrs {
  blockId: string | null
  // Agent 配置
  agentId: string | null
  agentName: string | null
  additionalPrompt: string
  outputFormat: AgentTaskOutputFormat
  processMode: AgentTaskProcessMode
  // 执行状态
  status: AgentTaskStatus
  taskId: string | null
  executedAt: string | null
  durationMs: number | null
  error: string | null
  // 定时配置
  scheduledAt: string | null  // ISO 时间字符串
  // 输出内容展开/折叠
  open: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    agentBlock: {
      insertAgentBlock: (attrs?: Partial<AgentBlockAttrs>) => ReturnType
      updateAgentBlockStatus: (blockId: string, status: AgentTaskStatus, extras?: Partial<AgentBlockAttrs>) => ReturnType
    }
  }
}

export const AgentBlock = Node.create<AgentBlockOptions>({
  name: 'agentBlock',

  group: 'block',

  // 明确指定允许的子节点类型，排除 agentBlock 自身以防止嵌套
  content: '(paragraph | heading | bulletList | orderedList | taskList | codeBlock | blockquote | table | horizontalRule | image)*',

  defining: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => ({ 'data-block-id': attributes.blockId }),
      },
      // Agent 配置
      agentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-agent-id'),
        renderHTML: (attributes) => ({ 'data-agent-id': attributes.agentId || '' }),
      },
      agentName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-agent-name'),
        renderHTML: (attributes) => ({ 'data-agent-name': attributes.agentName || '' }),
      },
      additionalPrompt: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-additional-prompt') || '',
        renderHTML: (attributes) => ({ 'data-additional-prompt': attributes.additionalPrompt }),
      },
      outputFormat: {
        default: 'auto' as AgentTaskOutputFormat,
        parseHTML: (element) => element.getAttribute('data-output-format') || 'auto',
        renderHTML: (attributes) => ({ 'data-output-format': attributes.outputFormat }),
      },
      processMode: {
        default: 'append' as AgentTaskProcessMode,
        parseHTML: (element) => element.getAttribute('data-process-mode') || 'append',
        renderHTML: (attributes) => ({ 'data-process-mode': attributes.processMode }),
      },
      // 执行状态
      status: {
        default: 'idle' as AgentTaskStatus,
        parseHTML: (element) => element.getAttribute('data-status') || 'idle',
        renderHTML: (attributes) => ({ 'data-status': attributes.status }),
      },
      taskId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-task-id'),
        renderHTML: (attributes) => ({ 'data-task-id': attributes.taskId || '' }),
      },
      executedAt: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-executed-at'),
        renderHTML: (attributes) => ({ 'data-executed-at': attributes.executedAt || '' }),
      },
      durationMs: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-duration-ms')
          return val ? parseInt(val, 10) : null
        },
        renderHTML: (attributes) => ({ 'data-duration-ms': attributes.durationMs?.toString() || '' }),
      },
      error: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-error'),
        renderHTML: (attributes) => ({ 'data-error': attributes.error || '' }),
      },
      // 定时配置
      scheduledAt: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-scheduled-at'),
        renderHTML: (attributes) => ({ 'data-scheduled-at': attributes.scheduledAt || '' }),
      },
      // 输出内容展开/折叠
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-open') !== 'false',
        renderHTML: (attributes) => ({ 'data-open': attributes.open ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="agent-block"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'agent-block',
      }),
      0, // Child content placeholder
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(withErrorBoundary(AgentBlockView, 'Failed to render agent block'), {
      // 允许 textarea 等表单元素接收输入事件
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement
        // 如果事件来自 textarea 或 input，不要阻止
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT') {
          return true
        }
        return false
      },
    })
  },

  addCommands() {
    return {
      insertAgentBlock:
        (attrs?: Partial<AgentBlockAttrs>) =>
        ({ commands }: { commands: { insertContent: (content: { type: string; attrs: unknown }) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              blockId: attrs?.blockId ?? uuidv4(),
              agentId: attrs?.agentId ?? null,
              agentName: attrs?.agentName ?? null,
              additionalPrompt: attrs?.additionalPrompt ?? '',
              outputFormat: attrs?.outputFormat ?? 'auto',
              processMode: attrs?.processMode ?? 'append',
              status: 'idle',
              taskId: null,
              executedAt: null,
              durationMs: null,
              error: null,
              scheduledAt: attrs?.scheduledAt ?? null,
              open: true,
            },
          })
        },

      updateAgentBlockStatus:
        (blockId: string, status: AgentTaskStatus, extras?: Partial<AgentBlockAttrs>) =>
        ({ tr, state, dispatch }: CommandProps) => {
          let found = false

          state.doc.descendants((node: ProseMirrorNode, pos: number) => {
            if (node.type.name === 'agentBlock' && node.attrs.blockId === blockId && !found) {
              found = true
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  status,
                  ...extras,
                })
              }
            }
          })

          if (found && dispatch) {
            dispatch(tr)
          }

          return found
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('agentBlockDedup'),
        appendTransaction: (transactions, _oldState, newState) => {
          // 只在文档有变化时处理
          if (!transactions.some(tr => tr.docChanged)) {
            return null
          }

          // 检查新文档中是否有重复的 blockId
          const seenBlockIds = new Set<string>()
          const duplicates: Array<{ pos: number; node: ProseMirrorNode }> = []

          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'agentBlock' && node.attrs.blockId) {
              const blockId = node.attrs.blockId
              // 如果这个 blockId 已经在新文档中出现过，说明是复制粘贴的
              if (seenBlockIds.has(blockId)) {
                duplicates.push({ pos, node })
              }
              seenBlockIds.add(blockId)
            }
          })

          // 如果没有重复，不需要处理
          if (duplicates.length === 0) {
            return null
          }

          // 为重复的 agentBlock 生成新的 blockId，同时重置运行状态
          const tr = newState.tr
          for (const { pos, node } of duplicates) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              blockId: uuidv4(),
              // 重置任务状态，避免复制的块继承运行状态
              status: 'idle',
              taskId: null,
              executedAt: null,
              durationMs: null,
              error: null,
            })
          }

          return tr
        },
      }),
    ]
  },
})

export default AgentBlock
