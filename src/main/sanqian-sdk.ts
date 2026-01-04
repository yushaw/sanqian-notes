/**
 * Sanqian SDK Integration
 *
 * Connects to Sanqian via SanqianAppClient (Facade) and registers Notes tools.
 * Also creates private agents for the Notes chat panel.
 *
 * Uses @yushaw/sanqian-chat/main which provides:
 * - SanqianAppClient: Stable facade for SDK
 * - AppToolDefinition, AppAgentConfig: Application-facing types
 */

import {
  SanqianAppClient,
  type AppConfig,
  type AppToolDefinition,
  type AppAgentConfig,
  type AppContextProvider
} from '@yushaw/sanqian-chat/main'
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
 * Extract block content by block ID from note content
 *
 * Notes use TipTap editor with block IDs stored in node attrs.
 * Content format: Tiptap JSON with { type: "paragraph", attrs: { blockId: "xxx" }, content: [...] }
 *
 * @param content - The full note content (Tiptap JSON)
 * @param blockId - The block ID to find
 * @returns Block text content or null if not found
 */
function extractBlockById(content: string, blockId: string): string | null {
  try {
    const doc = JSON.parse(content)
    if (!doc || !doc.content) return null

    // Recursively search for the block with matching blockId
    function findBlock(nodes: unknown[]): unknown | null {
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue
        const n = node as { attrs?: { blockId?: string }; content?: unknown[] }

        if (n.attrs?.blockId === blockId) {
          return node
        }

        if (n.content) {
          const found = findBlock(n.content)
          if (found) return found
        }
      }
      return null
    }

    const block = findBlock(doc.content)
    if (!block) return null

    // Extract text from the found block
    function extractText(node: unknown): string {
      if (!node || typeof node !== 'object') return ''
      const n = node as { type?: string; text?: string; content?: unknown[] }

      if (n.type === 'text' && n.text) return n.text
      if (n.content) return n.content.map(extractText).join('')
      return ''
    }

    return extractText(block).trim() || null
  } catch {
    // Not valid JSON, return null
    return null
  }
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

let client: SanqianAppClient | null = null
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
function buildAgentConfigs(): AppAgentConfig[] {
  const sdk = t().sdk
  return [
    {
      agentId: 'assistant',
      name: sdk.assistantName,
      description: sdk.assistantDescription,
      systemPrompt: sdk.assistantSystemPrompt,
      tools: [
        'search_notes',
        'get_note',
        'create_note',
        'update_note',
        'delete_note',
        'get_notebooks'
      ],
      // Automatically attach editor-state context to know current note/cursor position
      attachedContexts: ['editor-state']
    },
    {
      agentId: 'writing',
      name: sdk.writingName,
      description: sdk.writingDescription,
      systemPrompt: sdk.writingSystemPrompt,
      tools: []
    }
  ]
}

/**
 * Build tool definitions for Notes
 */
function buildTools(): AppToolDefinition[] {
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
      handler: async (args: Record<string, unknown>) => {
        try {
          const query = args.query as string
          const notebook_id = args.notebook_id as string | undefined
          const limit = (args.limit as number) || 10
          const results = await hybridSearch(query, {
            limit,
            notebookId: notebook_id
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
          },
          block_id: {
            type: 'string',
            description: tools.getNote.blockIdDesc
          }
        },
        required: ['id']
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          const blockId = args.block_id as string | undefined
          const note = getNoteById(id)
          if (!note) {
            throw new Error(`${tools.getNote.notFound}: ${id}`)
          }

          let content = note.content || ''

          // If block_id is specified, extract only that block
          if (blockId && content) {
            const blockContent = extractBlockById(content, blockId)
            if (blockContent === null) {
              throw new Error(`${tools.getNote.blockNotFound}: ${blockId}`)
            }
            content = blockContent
          }

          return {
            id: note.id,
            title: note.title,
            content,
            created_at: note.created_at,
            updated_at: note.updated_at,
            notebook_id: note.notebook_id,
            ...(blockId && { block_id: blockId })
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
      handler: async (args: Record<string, unknown>) => {
        try {
          const title = args.title as string
          const content = args.content as string | undefined
          const notebook_id = args.notebook_id as string | undefined
          const input: NoteInput = {
            title,
            content: content || '',
            notebook_id: notebook_id || null
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
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          const title = args.title as string | undefined
          const content = args.content as string | undefined
          const updates: Partial<NoteInput> = {}
          if (title !== undefined) updates.title = title
          if (content !== undefined) updates.content = content

          const note = updateNote(id, updates)
          if (!note) {
            throw new Error(`${tools.updateNote.notFound}: ${id}`)
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
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          const success = deleteNote(id)
          if (!success) {
            throw new Error(`${tools.deleteNote.notFound}: ${id}`)
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
 * Build context providers for Notes
 *
 * Provides editor-state context that includes:
 * - Current notebook and note info
 * - Current block (where cursor is)
 * - Selected text (if any)
 */
function buildContextProviders(): AppContextProvider[] {
  // Import lazily to avoid circular dependency
  const { getRawUserContext } = require('./index')

  return [
    {
      id: 'editor-state',
      name: 'Editor State',
      description: 'Current note, cursor position, and selection',
      getCurrent: async () => {
        const ctx = getRawUserContext()

        // Must have note info for context to be meaningful
        if (!ctx.currentNoteId || !ctx.currentNoteTitle) {
          return null
        }

        // Build lightweight context - essential info only
        const parts: string[] = []

        // Current note info (with notebook if applicable)
        const note = getNoteById(ctx.currentNoteId)
        let noteInfo = `Current note: "${ctx.currentNoteTitle}" (ID: ${ctx.currentNoteId})`
        // Add notebook info if note belongs to one
        if (ctx.currentNotebookName) {
          noteInfo += ` in notebook "${ctx.currentNotebookName}"`
        }
        parts.push(noteInfo)

        // Include AI summary if available (better than full content)
        if (note?.ai_summary) {
          parts.push(`Summary: ${note.ai_summary}`)
        }

        // Selected text (most important for context-aware actions)
        if (ctx.selectedText) {
          const truncated = ctx.selectedText.length > 300
            ? ctx.selectedText.slice(0, 300) + '...'
            : ctx.selectedText
          parts.push(`Selected text:\n"${truncated}"`)
        }

        // Cursor position for insertion context (only meaningful with note info)
        // Skip fallback position IDs (like __pos__230) - they're not real block IDs
        if (ctx.currentBlockId && !ctx.currentBlockId.startsWith('__pos__')) {
          parts.push(`Cursor at block ID: ${ctx.currentBlockId}`)
        }

        return {
          content: parts.join('\n')
          // No version field - backend will auto-compute hash from content
          // This way, injection only happens when actual content changes
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
  if (!client) {
    throw new Error('Client not initialized')
  }

  // Avoid concurrent syncing
  if (syncingPromise) {
    await syncingPromise
    return
  }

  syncingPromise = (async () => {
    try {
      const agents = buildAgentConfigs()
      console.log('[Notes SDK] Syncing agents:', agents.map(a => a.agentId))

      // Sync assistant agent (with tools)
      const assistantAgent = agents[0]
      const assistantInfo = await client!.createAgent(assistantAgent)
      assistantAgentId = assistantInfo.agentId
      console.log('[Notes SDK] Assistant agent synced:', assistantAgentId)

      // Sync writing agent (without tools)
      const writingAgent = agents[1]
      const writingInfo = await client!.createAgent(writingAgent)
      writingAgentId = writingInfo.agentId
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
  if (client) {
    console.log('[Notes SDK] Already initialized')
    return
  }

  const launchCommand = getLaunchCommand()

  if (launchCommand) {
    console.log(`[Notes SDK] Launch command: ${launchCommand}`)
  }
  console.log('[Notes SDK] Initializing...')

  const config: AppConfig = {
    appName: 'sanqian-notes',
    appVersion: app.getVersion(),
    displayName: 'Flow',
    launchCommand,
    tools: buildTools(),
    contexts: buildContextProviders()
    // autoLaunchSanqian defaults to true in SDK - will auto-launch Sanqian when needed
  }

  client = new SanqianAppClient(config)

  // Listen to client events
  client.on('connected', () => {
    console.log('[Notes SDK] Connected to Sanqian')
  })

  client.on('registered', async () => {
    console.log('[Notes SDK] Registered with Sanqian')
    // Sync agents after registration (not on connected)
    await syncPrivateAgents()
  })

  client.on('disconnected', () => {
    console.log('[Notes SDK] Disconnected from Sanqian')
    // Reset agent IDs - they will be re-synced on next connection
    assistantAgentId = null
    writingAgentId = null
  })

  client.on('error', (error) => {
    console.error('[Notes SDK] Error:', error)
  })

  client.on('tool_call', ({ name, arguments: args }) => {
    console.log(`[Notes SDK] Tool call: ${name}`, args)
  })

  console.log('[Notes SDK] Initialized')

  // Try to connect once on startup (non-blocking)
  // This registers our tools with Sanqian if it's running
  // No auto-reconnect is enabled (refCount=0), so if disconnected later it won't reconnect
  // ChatPanel will call acquireReconnect() when activated to enable auto-reconnect
  try {
    await client.connect()
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
  if (client) {
    // Clean up event listeners
    client.removeAllListeners()

    await client.disconnect()
    // Don't set client to null - keep instance for reconnection
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
  return client?.isConnected() ?? false
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
  client?.acquireReconnect()
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
  client?.releaseReconnect()
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
 * Get client instance for advanced operations
 */
export function getClient(): SanqianAppClient | null {
  return client
}

/**
 * Ensure client is connected and agents are ready.
 * This handles auto-reconnection and agent sync.
 *
 * @param agentType - Which agent to ensure ('assistant' or 'writing'), defaults to 'assistant'
 * @throws Error if client not initialized, connection fails, or agent sync fails
 */
export async function ensureAgentReady(
  agentType: 'assistant' | 'writing' = 'assistant'
): Promise<{ client: SanqianAppClient; agentId: string }> {
  if (!client) {
    throw new Error('Client not initialized')
  }

  // Ensure client is connected (handles auto-launch and reconnection)
  await client.ensureReady()

  // Get the appropriate agent ID
  const agentId = agentType === 'assistant' ? assistantAgentId : writingAgentId

  // If agent is already registered, return immediately
  if (agentId) {
    return { client, agentId }
  }

  // Agent not registered yet (happens after reconnection)
  // Sync the agents now
  await syncPrivateAgents()

  const finalAgentId = agentType === 'assistant' ? assistantAgentId : writingAgentId

  if (!finalAgentId) {
    throw new Error(`Failed to sync ${agentType} agent`)
  }

  return { client, agentId: finalAgentId }
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
  if (!client) {
    console.log('[Notes SDK] Client not initialized, cannot fetch embedding config')
    return null
  }

  try {
    // Try to connect if not connected
    await client.ensureReady()

    // Get embedding config from Sanqian
    const config = await client.getEmbeddingConfig()

    if (config?.available) {
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
