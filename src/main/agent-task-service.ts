/**
 * Agent Task Service
 *
 * 提供 Agent 任务执行服务：
 * - 获取可用 Agent 列表
 * - 流式执行 Agent 任务（支持两步执行流程）
 * - 取消任务
 *
 * 两步执行流程：
 * 1. 内容 Agent：生成原始文本内容
 * 2. Formatter Agent：使用 output tools 格式化并输出到编辑器
 */

import type { WebContents } from 'electron'
import { getClient } from './sanqian-sdk'
import { updateAgentTask } from './database'
import type { AgentCapability } from '@yushaw/sanqian-chat/main'
import {
  FORMATTER_AGENT_ID,
  initTaskOutput,
  commitTaskOutput,
  clearTaskOutput,
  getTaskOutput,
  type EditorOutputContext,
} from './editor-agent'

// ============================================
// 常量定义
// ============================================

/** 构建 Formatter Agent 的输入 prompt */
function buildFormatterPrompt(userRequest: string, content: string): string {
  return `<user_request>
${userRequest || '无具体需求'}
</user_request>

<original_content>
${content}
</original_content>`
}

// ============================================
// 类型定义
// ============================================

export interface AgentTaskEvent {
  type: 'start' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'phase' | 'editor_content'
  content?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
  error?: string
  phase?: 'content' | 'editor'
}

export interface AgentTaskStep {
  type: 'tool_call' | 'tool_result'
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
  timestamp: number
}

export interface AgentTaskOptions {
  /** 是否使用两步执行流程（内容 Agent + Formatter Agent） */
  useTwoStepFlow?: boolean
  /** 输出上下文（两步流程必需） */
  outputContext?: EditorOutputContext
  /** Execution context for the content agent (e.g., note metadata) */
  executionContext?: string
  /** 输出格式偏好 */
  outputFormat?: 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'
  /** WebContents 引用（用于发送输出到渲染器） */
  webContents?: WebContents | null
}

// 存储正在运行的任务，用于取消
const runningTasks = new Map<string, { cancelled: boolean; taskId: string }>()

/**
 * Format pending operations into readable text for display
 */
function formatPendingOperations(operations: Array<{ type: string; content: unknown }>): string {
  const parts: string[] = []

  for (const op of operations) {
    switch (op.type) {
      case 'paragraph': {
        const content = op.content as { paragraphs?: string[] }
        if (content.paragraphs) {
          parts.push(content.paragraphs.join('\n\n'))
        }
        break
      }
      case 'list': {
        const content = op.content as { type?: string; items?: Array<{ text?: string }> }
        if (content.items) {
          const prefix = content.type === 'ordered' ? (i: number) => `${i + 1}. ` : () => '• '
          parts.push(content.items.map((item, i) => `${prefix(i)}${item.text || ''}`).join('\n'))
        }
        break
      }
      case 'heading': {
        const content = op.content as { level?: number; text?: string }
        if (content.text) {
          const level = content.level || 1
          parts.push(`${'#'.repeat(level)} ${content.text}`)
        }
        break
      }
      case 'codeBlock': {
        const content = op.content as { language?: string; code?: string }
        if (content.code) {
          parts.push(`\`\`\`${content.language || ''}\n${content.code}\n\`\`\``)
        }
        break
      }
      case 'blockquote': {
        const content = op.content as { text?: string }
        if (content.text) {
          parts.push(`> ${content.text}`)
        }
        break
      }
      case 'table': {
        const content = op.content as { headers?: string[]; rows?: string[][] }
        if (content.headers && content.rows) {
          const headerLine = `| ${content.headers.join(' | ')} |`
          const separatorLine = `| ${content.headers.map(() => '---').join(' | ')} |`
          const dataLines = content.rows.map(row => `| ${row.join(' | ')} |`).join('\n')
          parts.push(`${headerLine}\n${separatorLine}\n${dataLines}`)
        }
        break
      }
      case 'html': {
        const content = op.content as { html?: string }
        if (content.html) {
          parts.push(content.html)
        }
        break
      }
    }
  }

  return parts.join('\n\n')
}

// 当前正在执行的任务 ID（用于 output tools）
let currentExecutingTaskId: string | null = null

/**
 * 获取当前执行的任务 ID
 */
export function getCurrentTaskId(): string | null {
  return currentExecutingTaskId
}

// ============================================
// API
// ============================================

/**
 * 获取可用 Agent 列表
 */
export async function listAgents(): Promise<AgentCapability[]> {
  const client = getClient()
  if (!client) {
    throw new Error('SDK not connected')
  }

  await client.ensureReady()
  return client.listAvailableAgents()
}

/**
 * 运行 Agent 任务（流式）
 *
 * @param taskId 任务 ID
 * @param agentId Agent ID
 * @param agentName Agent 名称
 * @param content 任务内容
 * @param additionalPrompt 附加提示
 * @param options 任务选项（包括两步流程配置）
 */
export async function* runAgentTask(
  taskId: string,
  agentId: string,
  agentName: string,
  content: string,
  additionalPrompt?: string,
  options?: AgentTaskOptions
): AsyncGenerator<AgentTaskEvent> {
  const client = getClient()
  if (!client) {
    throw new Error('SDK not connected')
  }

  await client.ensureReady()

  // 注册任务
  runningTasks.set(taskId, { cancelled: false, taskId })

  // 构建 prompt
  let userMessage = additionalPrompt
    ? `${content}\n\n---\n\n${additionalPrompt}`
    : content
  if (options?.executionContext) {
    userMessage += `\n\n${options.executionContext}`
  }

  // 更新状态为 running
  const startedAt = new Date().toISOString()
  updateAgentTask(taskId, {
    status: 'running',
    startedAt,
    agentId,
    agentName
  })

  yield { type: 'start' }

  try {
    // ========== Step 1: Content Agent ==========
    yield { type: 'phase', phase: 'content' }

    const stream = client.chatStream(agentId, [
      { role: 'user', content: userMessage }
    ])

    let resultText = ''
    const steps: AgentTaskStep[] = []

    for await (const event of stream) {
      // 检查是否已取消
      const taskState = runningTasks.get(taskId)
      if (taskState?.cancelled) {
        updateAgentTask(taskId, {
          status: 'failed',
          error: 'Task cancelled by user'
        })
        yield { type: 'error', error: 'Task cancelled by user' }
        return
      }

      switch (event.type) {
        case 'text':
          resultText += event.content || ''
          yield { type: 'text', content: event.content }
          break

        case 'thinking':
          yield { type: 'thinking', content: event.content }
          break

        case 'tool_call': {
          const toolName = event.tool_call?.function.name
          let toolArgs: Record<string, unknown> | undefined
          try {
            toolArgs = event.tool_call?.function.arguments
              ? JSON.parse(event.tool_call.function.arguments)
              : undefined
          } catch {
            // ignore parse error
          }
          steps.push({
            type: 'tool_call',
            toolName,
            toolArgs,
            timestamp: Date.now()
          })
          yield { type: 'tool_call', toolName, toolArgs }
          break
        }

        case 'tool_result': {
          const lastStep = steps[steps.length - 1]
          if (lastStep) {
            lastStep.result = event.result
          }
          yield { type: 'tool_result', result: event.result }
          break
        }

        case 'error':
          updateAgentTask(taskId, {
            status: 'failed',
            error: event.error || 'Unknown error'
          })
          yield { type: 'error', error: event.error }
          return
      }
    }

    // ========== Step 2: Formatter Agent (if two-step flow enabled) ==========
    if (options?.useTwoStepFlow && options.outputContext && resultText) {
      yield { type: 'phase', phase: 'editor' }

      // Initialize output context
      initTaskOutput(taskId, options.outputContext)
      currentExecutingTaskId = taskId

      try {
        // Build Formatter Agent prompt with user request context
        let editorPrompt: string
        const format = options.outputFormat
        const userRequest = additionalPrompt || ''

        if (format && format !== 'auto') {
          // Specific format requested - add format hint to user request
          const formatMap: Record<string, string> = {
            paragraph: '段落格式',
            list: '列表格式',
            table: '表格格式',
            code: '代码块格式',
            quote: '引用块格式'
          }
          const formatHint = formatMap[format] || format
          const requestWithFormat = userRequest
            ? `${userRequest}（要求使用${formatHint}输出）`
            : `使用${formatHint}输出`
          editorPrompt = buildFormatterPrompt(requestWithFormat, resultText)
        } else {
          // Auto format
          editorPrompt = buildFormatterPrompt(userRequest, resultText)
        }

        const editorStream = client.chatStream(FORMATTER_AGENT_ID, [
          { role: 'user', content: editorPrompt }
        ])

        for await (const event of editorStream) {
          // 检查是否已取消
          const taskState = runningTasks.get(taskId)
          if (taskState?.cancelled) {
            clearTaskOutput(taskId)
            updateAgentTask(taskId, {
              status: 'failed',
              error: 'Task cancelled by user'
            })
            yield { type: 'error', error: 'Task cancelled by user' }
            return
          }

          // Formatter Agent events (mainly tool calls for output)
          switch (event.type) {
            case 'tool_call': {
              const toolName = event.tool_call?.function.name
              let toolArgs: Record<string, unknown> | undefined
              const rawArgs = event.tool_call?.function.arguments
              try {
                // Arguments might be a string (needs parsing) or already an object
                if (typeof rawArgs === 'string' && rawArgs) {
                  toolArgs = JSON.parse(rawArgs)
                } else if (typeof rawArgs === 'object' && rawArgs) {
                  toolArgs = rawArgs as Record<string, unknown>
                }
              } catch {
                // ignore parse error
              }
              steps.push({
                type: 'tool_call',
                toolName,
                toolArgs,
                timestamp: Date.now()
              })
              yield { type: 'tool_call', toolName, toolArgs }
              break
            }

            case 'tool_result': {
              const lastStep = steps[steps.length - 1]
              if (lastStep) {
                lastStep.result = event.result
              }
              yield { type: 'tool_result', result: event.result }

              // Send real-time editor_content update after each tool call
              const currentOutput = getTaskOutput(taskId)
              if (currentOutput && currentOutput.operations.length > 0) {
                const formattedContent = formatPendingOperations(currentOutput.operations)
                if (formattedContent) {
                  yield { type: 'editor_content', content: formattedContent }
                }
              }
              break
            }

            case 'error':
              clearTaskOutput(taskId)
              updateAgentTask(taskId, {
                status: 'failed',
                error: event.error || 'Unknown error'
              })
              yield { type: 'error', error: event.error }
              return
          }
        }

        // Get pending operations and send formatted content to frontend
        const pendingOutput = getTaskOutput(taskId)
        if (pendingOutput && pendingOutput.operations.length > 0) {
          const formattedContent = formatPendingOperations(pendingOutput.operations)
          if (formattedContent) {
            yield { type: 'editor_content', content: formattedContent }
          }
        }

        // Commit output operations to the editor
        commitTaskOutput(taskId, options.webContents ?? null)
      } finally {
        currentExecutingTaskId = null
      }
    }

    // Update task as completed
    const completedAt = new Date().toISOString()
    const durationMs = Date.now() - new Date(startedAt).getTime()
    updateAgentTask(taskId, {
      status: 'completed',
      completedAt,
      durationMs,
      result: resultText,
      steps: JSON.stringify(steps)
    })
    yield { type: 'done', result: resultText }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    clearTaskOutput(taskId)
    updateAgentTask(taskId, {
      status: 'failed',
      error: errorMessage
    })
    yield { type: 'error', error: errorMessage }
  } finally {
    // 清理任务状态
    runningTasks.delete(taskId)
    currentExecutingTaskId = null
  }
}

/**
 * 取消任务
 */
export function cancelAgentTask(taskId: string): boolean {
  const taskState = runningTasks.get(taskId)
  if (taskState) {
    taskState.cancelled = true
    return true
  }
  return false
}

/**
 * 检查任务是否正在运行
 */
export function isTaskRunning(taskId: string): boolean {
  return runningTasks.has(taskId)
}
