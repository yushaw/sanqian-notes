/**
 * Formatter Agent - 用于将内容格式化并插入到编辑器中
 *
 * 工作流程：
 * 1. 内容 Agent 生成原始文本结果
 * 2. Formatter Agent 接收文本并使用 output tools 格式化输出
 * 3. Output tools 的 handler 将内容插入到编辑器中
 *
 * Output Tools:
 * - insert_paragraph: 插入段落
 * - insert_list: 插入列表（支持 bullet、ordered、task）
 * - insert_table: 插入表格
 * - insert_html: 插入 HTML（会转换为编辑器格式）
 * - insert_heading: 插入标题
 * - insert_code_block: 插入代码块
 * - insert_blockquote: 插入引用
 * - create_note_ref: 创建笔记引用链接
 */

import type { AppToolDefinition, AppAgentConfig, AppJsonSchemaProperty } from '@yushaw/sanqian-chat/main'
import type { WebContents } from 'electron'
import type {
  EditorOutputContext,
  OutputOperation,
  OutputOperationType,
} from '../shared/types'

// Re-export for backwards compatibility
export type { EditorOutputContext }

/** Pending output operations for a task */
export interface PendingOutputOps {
  context: EditorOutputContext
  operations: OutputOperation[]
}

// Store pending operations per task
const pendingOps = new Map<string, PendingOutputOps>()

// ============================================
// Formatter Agent Definition
// ============================================

export const FORMATTER_AGENT_ID = 'sanqian-notes:formatter'
export const FORMATTER_AGENT_NAME = 'Formatter'

export const formatterAgentConfig: AppAgentConfig = {
  agentId: 'formatter',
  name: 'Formatter',
  description: '精炼内容并格式化输出到笔记编辑器',
  systemPrompt: `你是一个内容精炼助手。你会收到：
- <user_request>：用户原始的问题或指令
- <original_content>：AI 生成的回答

你的任务是精炼内容并输出到编辑器。

## 内容精简（核心）
- 删除废话：开场白（"好的，我来..."）、过渡语（"接下来..."、"首先..."）、客套话（"希望对你有帮助"）
- 删除对用户问题的复述
- 只保留与 <user_request> 直接相关的核心信息
- 跑题或过度延伸的内容，果断删除

## 风格
- 极简：宁缺毋滥，信息密度优先
- 客观：只陈述事实，不用"非常"、"很好"等主观修饰
- 直接：直奔主题，不铺垫

## 格式选择
- 要点用列表（insert_list）
- 对比用表格（insert_table）
- 代码用代码块（insert_code_block），指定语言
- 标题（insert_heading）只在确实有多个独立主题时使用
- 避免不必要的嵌套层级

你必须调用 insert_* 工具输出内容。`,
  tools: [
    'insert_paragraph',
    'insert_list',
    'insert_heading',
    'insert_code_block',
    'insert_blockquote',
    'insert_table',
    'insert_html',
    'create_note_ref',
  ],
}

// ============================================
// Output Tools Definitions
// ============================================

const stringProperty = (description: string): AppJsonSchemaProperty => ({
  type: 'string',
  description,
})

const arrayProperty = (description: string, items: AppJsonSchemaProperty): AppJsonSchemaProperty => ({
  type: 'array',
  description,
  items,
})

export function createEditorOutputTools(
  currentTaskId: () => string | null
): AppToolDefinition[] {
  // Helper to queue operation
  const queueOp = (type: OutputOperationType, content: unknown) => {
    const taskId = currentTaskId()
    if (!taskId) {
      return { success: false, error: 'No active task' }
    }
    const pending = pendingOps.get(taskId)
    if (!pending) {
      return { success: false, error: 'No pending context for task' }
    }
    pending.operations.push({ type, content })
    return { success: true }
  }

  return [
    {
      name: 'insert_paragraph',
      description: '插入一个或多个段落到编辑器中',
      parameters: {
        type: 'object',
        properties: {
          paragraphs: arrayProperty(
            '要插入的段落内容数组，每个元素是一个段落的文本',
            stringProperty('段落文本')
          ),
        },
        required: ['paragraphs'],
      },
      handler: async (args) => {
        const paragraphs = args.paragraphs as string[]
        return queueOp('paragraph', { paragraphs })
      },
    },
    {
      name: 'insert_list',
      description: '插入列表到编辑器中',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '列表类型',
            enum: ['bullet', 'ordered', 'task'],
          },
          items: arrayProperty(
            '列表项内容',
            {
              type: 'object',
              properties: {
                text: stringProperty('列表项文本'),
                checked: {
                  type: 'boolean',
                  description: '是否已完成（仅 task 列表有效）',
                },
              },
              required: ['text'],
            }
          ),
        },
        required: ['type', 'items'],
      },
      handler: async (args) => {
        return queueOp('list', args)
      },
    },
    {
      name: 'insert_heading',
      description: '插入标题到编辑器中',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'number',
            description: '标题级别 (1-4)',
            enum: [1, 2, 3, 4],
          },
          text: stringProperty('标题文本'),
        },
        required: ['level', 'text'],
      },
      handler: async (args) => {
        return queueOp('heading', args)
      },
    },
    {
      name: 'insert_code_block',
      description: '插入代码块到编辑器中',
      parameters: {
        type: 'object',
        properties: {
          language: stringProperty('代码语言（如 javascript, python, typescript 等）'),
          code: stringProperty('代码内容'),
        },
        required: ['code'],
      },
      handler: async (args) => {
        return queueOp('codeBlock', args)
      },
    },
    {
      name: 'insert_blockquote',
      description: '插入引用块到编辑器中',
      parameters: {
        type: 'object',
        properties: {
          text: stringProperty('引用内容'),
        },
        required: ['text'],
      },
      handler: async (args) => {
        return queueOp('blockquote', args)
      },
    },
    {
      name: 'insert_table',
      description: '插入表格到编辑器中',
      parameters: {
        type: 'object',
        properties: {
          headers: arrayProperty('表头列', stringProperty('列标题')),
          rows: arrayProperty(
            '数据行',
            arrayProperty('单元格', stringProperty('单元格内容'))
          ),
        },
        required: ['headers', 'rows'],
      },
      handler: async (args) => {
        return queueOp('table', args)
      },
    },
    {
      name: 'insert_html',
      description: '插入 HTML 内容（会自动转换为编辑器格式）',
      parameters: {
        type: 'object',
        properties: {
          html: stringProperty('HTML 内容'),
        },
        required: ['html'],
      },
      handler: async (args) => {
        return queueOp('html', args)
      },
    },
    {
      name: 'create_note_ref',
      description: '创建笔记引用链接',
      parameters: {
        type: 'object',
        properties: {
          noteTitle: stringProperty('笔记标题（用于搜索匹配）'),
          displayText: stringProperty('显示文本（可选，默认使用笔记标题）'),
        },
        required: ['noteTitle'],
      },
      handler: async (args) => {
        return queueOp('noteRef', args)
      },
    },
  ]
}

// ============================================
// Task Context Management
// ============================================

/**
 * Initialize pending operations for a task
 */
export function initTaskOutput(taskId: string, context: EditorOutputContext): void {
  pendingOps.set(taskId, {
    context,
    operations: [],
  })
}

/**
 * Get pending operations for a task
 */
export function getTaskOutput(taskId: string): PendingOutputOps | null {
  return pendingOps.get(taskId) ?? null
}

/**
 * Clear pending operations for a task
 */
export function clearTaskOutput(taskId: string): void {
  pendingOps.delete(taskId)
}

/**
 * Finalize and commit pending operations to the editor
 * Called after Formatter Agent completes
 */
export function commitTaskOutput(
  taskId: string,
  webContents: WebContents | null
): boolean {
  const pending = pendingOps.get(taskId)
  if (!pending) {
    return false
  }

  if (pending.operations.length === 0) {
    pendingOps.delete(taskId)
    return false
  }

  // Send to renderer to execute
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('editor:insert-output', {
      taskId,
      context: pending.context,
      operations: pending.operations,
    })
  }

  pendingOps.delete(taskId)
  return true
}
