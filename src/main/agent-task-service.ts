/**
 * Agent Task Service
 *
 * 提供 Agent 任务执行服务：
 * - 获取可用 Agent 列表
 * - 流式执行 Agent 任务
 * - 取消任务
 */

import { getClient } from './sanqian-sdk'
import { updateAgentTask } from './database'
import type { AgentCapability } from '@yushaw/sanqian-chat/main'

// ============================================
// 类型定义
// ============================================

export interface AgentTaskEvent {
  type: 'start' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error'
  content?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
  error?: string
}

export interface AgentTaskStep {
  type: 'tool_call' | 'tool_result'
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
  timestamp: number
}

// 存储正在运行的任务，用于取消
const runningTasks = new Map<string, { cancelled: boolean }>()

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
 */
export async function* runAgentTask(
  taskId: string,
  agentId: string,
  agentName: string,
  content: string,
  additionalPrompt?: string
): AsyncGenerator<AgentTaskEvent> {
  const client = getClient()
  if (!client) {
    throw new Error('SDK not connected')
  }

  await client.ensureReady()

  // 注册任务
  runningTasks.set(taskId, { cancelled: false })

  // 构建 prompt
  const userMessage = additionalPrompt
    ? `${content}\n\n---\n\n${additionalPrompt}`
    : content

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
        break
      }

      switch (event.type) {
        case 'text':
          resultText += event.content || ''
          yield { type: 'text', content: event.content }
          break

        case 'thinking':
          yield { type: 'thinking', content: event.content }
          break

        case 'tool_call':
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

        case 'tool_result':
          const lastStep = steps[steps.length - 1]
          if (lastStep) {
            lastStep.result = event.result
          }
          yield { type: 'tool_result', result: event.result }
          break

        case 'done':
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
          break

        case 'error':
          updateAgentTask(taskId, {
            status: 'failed',
            error: event.error || 'Unknown error'
          })
          yield { type: 'error', error: event.error }
          break
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    updateAgentTask(taskId, {
      status: 'failed',
      error: errorMessage
    })
    yield { type: 'error', error: errorMessage }
  } finally {
    // 清理任务状态
    runningTasks.delete(taskId)
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
