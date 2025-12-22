/**
 * Sanqian SDK Integration
 *
 * Connects to Sanqian via SDK and registers Notes tools.
 * Also creates private agents for the Notes chat panel.
 */

import { SanqianSDK, type SDKConfig, type ToolDefinition, type AgentConfig } from '@yushaw/sanqian-sdk'
import { app } from 'electron'
import {
  searchNotes,
  getNoteById,
  addNote,
  updateNote,
  deleteNote,
  getTags,
  type NoteInput
} from './database'

/**
 * Safely truncate text without breaking multi-byte characters (emoji, CJK, etc.)
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  // Truncate to max length first
  let truncated = text.slice(0, maxLength)

  // Check if we cut in the middle of a surrogate pair (emoji, some CJK characters)
  const lastCharCode = truncated.charCodeAt(truncated.length - 1)

  // High surrogate (0xD800-0xDBFF) - first part of emoji or rare CJK
  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    // Remove the orphaned high surrogate
    truncated = truncated.slice(0, -1)
  }

  return truncated
}

/**
 * Get the launch command for this app based on platform
 * Uses app.getPath('exe') to get the actual executable path
 */
function getLaunchCommand(): string | undefined {
  // In development mode, don't provide launch command
  if (!app.isPackaged) {
    return undefined
  }

  // Get the actual executable path (works on all platforms)
  const exePath = app.getPath('exe')
  return `"${exePath}" --silent`
}

let sdk: SanqianSDK | null = null
let assistantAgentId: string | null = null // notes:assistant
let writingAgentId: string | null = null // notes:writing
let syncingPromise: Promise<void> | null = null
let onDataChangeCallback: (() => void) | null = null

// Set callback for data changes (to notify renderer)
export function setOnSdkDataChange(callback: () => void): void {
  onDataChangeCallback = callback
}

// Notify data change
function notifyDataChange(): void {
  if (onDataChangeCallback) {
    onDataChangeCallback()
  }
}

/**
 * Build Agent configs for Notes
 */
function buildAgentConfigs(): AgentConfig[] {
  return [
    {
      agent_id: 'assistant',
      name: 'Notes Assistant',
      description: '帮你管理笔记的智能助手，可以搜索、创建、编辑笔记',
      system_prompt: `你是一个专业的笔记助手，帮助用户管理他们的笔记。你可以：
1. 搜索笔记 - 使用 search_notes 工具
2. 查看笔记详情 - 使用 get_note 工具
3. 创建新笔记 - 使用 create_note 工具
4. 更新现有笔记 - 使用 update_note 工具
5. 删除笔记 - 使用 delete_note 工具（需要用户确认）
6. 查看所有标签 - 使用 get_tags 工具

注意事项：
- 删除笔记是危险操作，必须先询问用户确认
- 创建或更新笔记时，content 使用 Markdown 格式
- 搜索时，如果结果太多，建议用户提供更具体的关键词
- 始终以用户的需求为中心，提供清晰、准确的帮助`,
      tools: [
        'search_notes',
        'get_note',
        'create_note',
        'update_note',
        'delete_note',
        'get_tags'
      ]
    },
    {
      agent_id: 'writing',
      name: 'Writing Assistant',
      description: '专注于文本处理的写作助手，可以改进、翻译、总结文本等',
      system_prompt: `你是一个专业的写作助手，专注于文本处理和内容优化。你可以帮助用户：
- 改进文本：提升表达清晰度和流畅度
- 翻译文本：在中英文之间翻译
- 扩展内容：添加更多细节和深度
- 简化内容：使文本更简洁易懂
- 总结内容：提取关键要点
- 解释概念：用简单的语言说明复杂概念
- 续写内容：基于上下文继续写作
- 生成大纲：创建结构化的内容大纲
- 头脑风暴：生成创意和想法

注意事项：
- 保持用户原文的风格和语气
- 如果是翻译，确保准确传达原意
- 如果用户的指令不清楚，主动询问澄清`,
      tools: []
    }
  ]
}

/**
 * Build tool definitions for Notes
 */
function buildTools(): ToolDefinition[] {
  return [
    {
      name: 'search_notes',
      description: '搜索笔记。可以根据标题和内容进行全文搜索。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，会在笔记标题和内容中搜索'
          },
          limit: {
            type: 'number',
            description: '返回结果的最大数量，默认 10'
          }
        },
        required: ['query']
      },
      handler: async (args: { query: string; limit?: number }) => {
        try {
          const limit = args.limit || 10
          const results = searchNotes(args.query, limit)
          return results.map(note => ({
            id: note.id,
            title: note.title,
            preview: note.content ? truncateText(note.content, 200) : '',
            updated_at: note.updated_at,
            notebook_id: note.notebook_id
          }))
        } catch (error) {
          throw new Error(`搜索笔记失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    },
    {
      name: 'get_note',
      description: '获取笔记的完整内容。用于查看笔记详情或在编辑前读取笔记。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '笔记 ID'
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string }) => {
        try {
          const note = getNoteById(args.id)
          if (!note) {
            throw new Error(`笔记不存在: ${args.id}`)
          }
          return {
            id: note.id,
            title: note.title,
            content: note.content || '',
            created_at: note.created_at,
            updated_at: note.updated_at,
            notebook_id: note.notebook_id
          }
        } catch (error) {
          throw new Error(`获取笔记失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    },
    {
      name: 'create_note',
      description: '创建新笔记。content 使用 Markdown 格式。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '笔记标题'
          },
          content: {
            type: 'string',
            description: '笔记内容，使用 Markdown 格式'
          },
          notebook_id: {
            type: 'string',
            description: '笔记本 ID（可选），如果不指定则创建在默认笔记本'
          }
        },
        required: ['title']
      },
      handler: async (args: { title: string; content?: string; notebook_id?: string }) => {
        try {
          const input: NoteInput = {
            title: args.title,
            content: args.content || '',
            notebook_id: args.notebook_id || null
          }
          const note = addNote(input)
          notifyDataChange()
          return {
            id: note.id,
            title: note.title,
            message: '笔记创建成功'
          }
        } catch (error) {
          throw new Error(`创建笔记失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    },
    {
      name: 'update_note',
      description: '更新现有笔记的标题或内容。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '笔记 ID'
          },
          title: {
            type: 'string',
            description: '新标题（可选）'
          },
          content: {
            type: 'string',
            description: '新内容，使用 Markdown 格式（可选）'
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string; title?: string; content?: string }) => {
        try {
          const updates: Partial<NoteInput> = {}
          if (args.title !== undefined) updates.title = args.title
          if (args.content !== undefined) updates.content = args.content

          const note = updateNote(args.id, updates)
          if (!note) {
            throw new Error(`笔记不存在: ${args.id}`)
          }
          notifyDataChange()
          return {
            id: note.id,
            title: note.title,
            message: '笔记更新成功'
          }
        } catch (error) {
          throw new Error(`更新笔记失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    },
    {
      name: 'delete_note',
      description: '删除笔记（移动到回收站）。这是危险操作，必须先获得用户确认。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '笔记 ID'
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string }) => {
        try {
          const success = deleteNote(args.id)
          if (!success) {
            throw new Error(`笔记不存在: ${args.id}`)
          }
          notifyDataChange()
          return {
            message: '笔记已移动到回收站'
          }
        } catch (error) {
          throw new Error(`删除笔记失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    },
    {
      name: 'get_tags',
      description: '获取所有标签列表。',
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        try {
          const tags = getTags()
          return tags.map(tag => ({
            id: tag.id,
            name: tag.name
          }))
        } catch (error) {
          throw new Error(`获取标签失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
    }
  ]
}

/**
 * Sync private agents with Sanqian
 * This registers our agents and gets their full IDs (app_name:agent_id)
 */
async function syncPrivateAgents(): Promise<void> {
  if (!sdk) {
    throw new Error('SDK not initialized')
  }

  // Avoid concurrent syncing
  if (syncingPromise) {
    await syncingPromise
    return
  }

  syncingPromise = (async () => {
    try {
      const agents = buildAgentConfigs()
      console.log('[Notes SDK] Syncing agents:', agents.map(a => a.agent_id))

      // Sync assistant agent (with tools)
      const assistantAgent = agents[0]
      const assistantInfo = await sdk!.createAgent(assistantAgent)
      assistantAgentId = assistantInfo.agent_id
      console.log('[Notes SDK] Assistant agent synced:', assistantAgentId)

      // Sync writing agent (without tools)
      const writingAgent = agents[1]
      const writingInfo = await sdk!.createAgent(writingAgent)
      writingAgentId = writingInfo.agent_id
      console.log('[Notes SDK] Writing agent synced:', writingAgentId)
    } catch (e) {
      console.error('[Notes SDK] Failed to sync agents:', e)
    } finally {
      syncingPromise = null
    }
  })()

  await syncingPromise
}

/**
 * Initialize and connect to Sanqian SDK
 *
 * On startup:
 * - Attempts to connect once to register Agents and tools
 * - Does NOT enable auto-reconnect (reconnectRefCount stays at 0)
 * - If connection fails, logs the error but doesn't block app startup
 *
 * When ChatPanel is activated:
 * - Calls acquireReconnect() to enable auto-reconnect
 * - Calls releaseReconnect() when closed to disable it
 *
 * SDK Configuration:
 * - launchCommand: Command for Sanqian to auto-start this app (production only)
 * - autoLaunchSanqian: Defaults to true in SDK - will auto-launch Sanqian when needed
 */
export async function initializeSanqianSDK(): Promise<void> {
  if (sdk) {
    console.log('[Notes SDK] Already initialized')
    return
  }

  const launchCommand = getLaunchCommand()

  if (launchCommand) {
    console.log(`[Notes SDK] Launch command: ${launchCommand}`)
  }
  console.log('[Notes SDK] Initializing...')

  const config: SDKConfig = {
    appName: 'sanqian-notes',
    appVersion: app.getVersion(),
    displayName: 'Sanqian Notes',
    launchCommand,
    tools: buildTools()
    // autoLaunchSanqian defaults to true in SDK - will auto-launch Sanqian when needed
  }

  sdk = new SanqianSDK(config)

  // Listen to SDK events
  sdk.on('connected', () => {
    console.log('[Notes SDK] Connected to Sanqian')
  })

  sdk.on('registered', async () => {
    console.log('[Notes SDK] Registered with Sanqian')
    // Sync agents after registration (not on connected)
    await syncPrivateAgents()
  })

  sdk.on('disconnected', () => {
    console.log('[Notes SDK] Disconnected from Sanqian')
    // Reset agent IDs - they will be re-synced on next connection
    assistantAgentId = null
    writingAgentId = null
  })

  sdk.on('error', (error) => {
    console.error('[Notes SDK] Error:', error)
  })

  sdk.on('tool_call', ({ name, arguments: args }) => {
    console.log(`[Notes SDK] Tool call: ${name}`, args)
  })

  console.log('[Notes SDK] Initialized')

  // Try to connect once on startup (non-blocking)
  // This registers our tools with Sanqian if it's running
  // No auto-reconnect is enabled (refCount=0), so if disconnected later it won't reconnect
  // ChatPanel will call acquireReconnect() when activated to enable auto-reconnect
  try {
    await sdk.connect()
    console.log('[Notes SDK] Initial connection successful')
  } catch (err) {
    // Connection failed - Sanqian might not be running, that's OK
    console.log('[Notes SDK] Initial connection failed (Sanqian may not be running):', err instanceof Error ? err.message : err)
  }
}

/**
 * Disconnect from Sanqian SDK (keeps instance for reconnection)
 */
export async function stopSanqianSDK(): Promise<void> {
  if (sdk) {
    await sdk.disconnect()
    // Don't set sdk to null - keep instance for reconnection
    // Reset agent IDs so they will be re-synced on next connection
    assistantAgentId = null
    writingAgentId = null
    syncingPromise = null
  }
}

/**
 * Check if connected to Sanqian
 */
export function isSanqianConnected(): boolean {
  return sdk?.isConnected() ?? false
}

/**
 * Request persistent connection (enables auto-reconnect)
 * Call this when a component needs the connection to stay alive (e.g., chat panel opens)
 *
 * Uses reference counting:
 * - Multiple components can call acquireReconnect()
 * - Connection stays active until all components call releaseReconnect()
 * - When refCount > 0, SDK will auto-reconnect if disconnected
 */
export function acquireReconnect(): void {
  sdk?.acquireReconnect()
}

/**
 * Release persistent connection request
 * Call this when a component no longer needs the connection (e.g., chat panel closes)
 *
 * Uses reference counting:
 * - Decrements the reconnect reference count
 * - When refCount reaches 0, auto-reconnect is disabled
 * - Connection may be closed if no other components need it
 */
export function releaseReconnect(): void {
  sdk?.releaseReconnect()
}

/**
 * Get the assistant agent ID (full format: app_name:agent_id)
 */
export function getAssistantAgentId(): string | null {
  return assistantAgentId
}

/**
 * Get the writing agent ID (full format: app_name:agent_id)
 */
export function getWritingAgentId(): string | null {
  return writingAgentId
}

/**
 * Get SDK instance for advanced operations
 */
export function getSdk(): SanqianSDK | null {
  return sdk
}

/**
 * Ensure SDK is connected and agents are ready.
 * This handles auto-reconnection and agent sync.
 *
 * @param agentType - Which agent to ensure ('assistant' or 'writing'), defaults to 'assistant'
 * @throws Error if SDK not initialized, connection fails, or agent sync fails
 */
export async function ensureAgentReady(
  agentType: 'assistant' | 'writing' = 'assistant'
): Promise<{ sdk: SanqianSDK; agentId: string }> {
  if (!sdk) {
    throw new Error('SDK not initialized')
  }

  // Ensure SDK is connected (handles auto-launch and reconnection)
  await sdk.ensureReady()

  // Get the appropriate agent ID
  const agentId = agentType === 'assistant' ? assistantAgentId : writingAgentId

  // If agent is already registered, return immediately
  if (agentId) {
    return { sdk, agentId }
  }

  // Agent not registered yet (happens after reconnection)
  // Sync the agents now
  await syncPrivateAgents()

  const finalAgentId = agentType === 'assistant' ? assistantAgentId : writingAgentId

  if (!finalAgentId) {
    throw new Error(`Failed to sync ${agentType} agent`)
  }

  return { sdk, agentId: finalAgentId }
}
