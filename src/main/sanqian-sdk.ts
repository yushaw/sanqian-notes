/**
 * Sanqian SDK Integration
 *
 * Connects to Sanqian via SDK and registers Notes tools.
 * Also creates private agents for the Notes chat panel.
 */

import { SanqianSDK, type SDKConfig, type ToolDefinition, type AgentConfig } from '@yushaw/sanqian-sdk'
import { app } from 'electron'
import {
  getNoteById,
  addNote,
  updateNote,
  deleteNote,
  getNotebooks,
  type NoteInput
} from './database'
import { hybridSearch } from './embedding/semantic-search'
import { t } from './i18n'

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
  const sdk = t().sdk
  return [
    {
      agent_id: 'assistant',
      name: sdk.assistantName,
      description: sdk.assistantDescription,
      system_prompt: sdk.assistantSystemPrompt,
      tools: [
        'search_notes',
        'get_note',
        'create_note',
        'update_note',
        'delete_note',
        'get_notebooks'
      ]
    },
    {
      agent_id: 'writing',
      name: sdk.writingName,
      description: sdk.writingDescription,
      system_prompt: sdk.writingSystemPrompt,
      tools: []
    }
  ]
}

/**
 * Build tool definitions for Notes
 */
function buildTools(): ToolDefinition[] {
  const tools = t().tools
  const common = t().common
  return [
    {
      name: 'search_notes',
      description: tools.searchNotes.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: tools.searchNotes.queryDesc
          },
          notebook_id: {
            type: 'string',
            description: tools.searchNotes.notebookIdDesc
          },
          limit: {
            type: 'number',
            description: tools.searchNotes.limitDesc
          }
        },
        required: ['query']
      },
      handler: async (args: { query: string; notebook_id?: string; limit?: number }) => {
        try {
          const limit = args.limit || 10
          const results = await hybridSearch(args.query, {
            limit,
            notebookId: args.notebook_id
          })

          // Get note details for each result, filter out deleted/soft-deleted notes
          const notesWithDetails = results
            .map(result => {
              const note = getNoteById(result.noteId)
              if (!note || note.deleted_at) return null // Skip deleted/soft-deleted notes
              return {
                id: result.noteId,
                title: note.title,
                preview: result.matchedChunks[0]?.chunkText
                  ? truncateText(result.matchedChunks[0].chunkText, 200)
                  : '',
                score: result.score,
                updated_at: note.updated_at,
                notebook_id: result.notebookId
              }
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)

          return notesWithDetails
        } catch (error) {
          throw new Error(`${tools.searchNotes.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },
    {
      name: 'get_note',
      description: tools.getNote.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: tools.getNote.idDesc
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string }) => {
        try {
          const note = getNoteById(args.id)
          if (!note) {
            throw new Error(`${tools.getNote.notFound}: ${args.id}`)
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
          throw new Error(`${tools.getNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },
    {
      name: 'create_note',
      description: tools.createNote.description,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: tools.createNote.titleDesc
          },
          content: {
            type: 'string',
            description: tools.createNote.contentDesc
          },
          notebook_id: {
            type: 'string',
            description: tools.createNote.notebookIdDesc
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
            message: tools.createNote.success
          }
        } catch (error) {
          throw new Error(`${tools.createNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },
    {
      name: 'update_note',
      description: tools.updateNote.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: tools.updateNote.idDesc
          },
          title: {
            type: 'string',
            description: tools.updateNote.titleDesc
          },
          content: {
            type: 'string',
            description: tools.updateNote.contentDesc
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
            throw new Error(`${tools.updateNote.notFound}: ${args.id}`)
          }
          notifyDataChange()
          return {
            id: note.id,
            title: note.title,
            message: tools.updateNote.success
          }
        } catch (error) {
          throw new Error(`${tools.updateNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },
    {
      name: 'delete_note',
      description: tools.deleteNote.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: tools.deleteNote.idDesc
          }
        },
        required: ['id']
      },
      handler: async (args: { id: string }) => {
        try {
          const success = deleteNote(args.id)
          if (!success) {
            throw new Error(`${tools.deleteNote.notFound}: ${args.id}`)
          }
          notifyDataChange()
          return {
            message: tools.deleteNote.success
          }
        } catch (error) {
          throw new Error(`${tools.deleteNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },
    {
      name: 'get_notebooks',
      description: tools.getNotebooks.description,
      parameters: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        try {
          const notebooks = getNotebooks()
          return notebooks.map(notebook => ({
            id: notebook.id,
            name: notebook.name
          }))
        } catch (error) {
          throw new Error(`${tools.getNotebooks.error}: ${error instanceof Error ? error.message : common.unknownError}`)
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
    }
  })()

  await syncingPromise
  syncingPromise = null  // Clean up after completion
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
    displayName: 'Flow',
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
 * Cleans up event listeners to prevent memory leaks
 */
export async function stopSanqianSDK(): Promise<void> {
  if (sdk) {
    // Clean up event listeners
    sdk.removeAllListeners?.()

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

/**
 * Fetch embedding configuration from Sanqian
 *
 * This allows Notes to use the same embedding model configured in Sanqian.
 * Returns null if Sanqian is not running or embedding is not configured.
 */
export async function fetchEmbeddingConfigFromSanqian(): Promise<{
  available: boolean
  apiUrl?: string
  apiKey?: string
  modelName?: string
  dimensions?: number
} | null> {
  if (!sdk) {
    console.log('[Notes SDK] SDK not initialized, cannot fetch embedding config')
    return null
  }

  try {
    // Try to connect if not connected
    await sdk.ensureReady()

    // Get embedding config from Sanqian
    const config = await sdk.getEmbeddingConfig()

    if (config.available) {
      console.log(
        `[Notes SDK] Got embedding config from Sanqian: model=${config.modelName}, apiUrl=${config.apiUrl}`
      )
    } else {
      console.log('[Notes SDK] Sanqian has no embedding configured')
    }

    return config
  } catch (error) {
    console.log(
      '[Notes SDK] Failed to fetch embedding config from Sanqian:',
      error instanceof Error ? error.message : error
    )
    return null
  }
}
