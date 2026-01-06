/**
 * Sanqian SDK Integration
 *
 * Connects to Sanqian via SanqianAppClient (Facade) and registers Notes tools.
 * Also creates private agents for the Notes chat panel.
 *
 * Uses @yushaw/sanqian-chat/main which provides:
 * - SanqianAppClient: Stable facade for SDK
 * - AppToolDefinition, AppAgentConfig: Application-facing types
 *
 * Tool API Design:
 * - All content uses Markdown format (not TipTap JSON)
 * - Supports heading-based section extraction
 * - Supports append/prepend/edit modes for updates
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
  getNotes,
  searchNotes,
  addNote,
  updateNote,
  deleteNote,
  getNotebooks,
  getNoteCountByNotebook,
  moveNote as dbMoveNote,
  type NoteInput
} from './database'
import { hybridSearch } from './embedding/semantic-search'
import { t } from './i18n'
import { jsonToMarkdown, markdownToTiptapString, countWords } from './markdown'

/**
 * Safely truncate text without breaking multi-byte characters (emoji, CJK, etc.)
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  let truncated = text.slice(0, maxLength)
  const lastCharCode = truncated.charCodeAt(truncated.length - 1)

  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    truncated = truncated.slice(0, -1)
  }

  return truncated
}

/**
 * Get the launch command for this app based on platform
 */
function getLaunchCommand(): string | undefined {
  if (!app.isPackaged) {
    return undefined
  }
  const exePath = app.getPath('exe')
  return `"${exePath}" --silent`
}

let client: SanqianAppClient | null = null
let assistantAgentId: string | null = null
let writingAgentId: string | null = null
let syncingPromise: Promise<void> | null = null
let onDataChangeCallback: (() => void) | null = null

export function setOnSdkDataChange(callback: () => void): void {
  onDataChangeCallback = callback
}

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
        'get_notebooks',
        'move_note'
      ],
      attachedContexts: ['sanqian-notes:editor-state', 'sanqian-notes:notes']
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
    // ==================== search_notes ====================
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

          // Get notebooks map for names
          const notebooks = getNotebooks()
          const notebookMap = new Map(notebooks.map(n => [n.id, n.name]))

          const notesWithDetails = results
            .map(result => {
              const note = getNoteById(result.noteId)
              if (!note || note.deleted_at) return null

              return {
                id: result.noteId,
                title: note.title,
                preview: result.matchedChunks[0]?.chunkText
                  ? truncateText(result.matchedChunks[0].chunkText, 200)
                  : '',
                score: result.score,
                updated_at: note.updated_at,
                notebook_id: result.notebookId,
                notebook_name: notebookMap.get(result.notebookId || '') || null,
                tags: note.tags?.map(t => t.name) || [],
                has_summary: !!note.ai_summary,
                is_pinned: note.is_pinned,
                is_favorite: note.is_favorite
              }
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)

          return notesWithDetails
        } catch (error) {
          throw new Error(`${tools.searchNotes.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },

    // ==================== get_note ====================
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
          heading: {
            type: 'string',
            description: tools.getNote.headingDesc
          }
        },
        required: ['id']
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          const heading = args.heading as string | undefined
          const note = getNoteById(id)

          if (!note) {
            throw new Error(`${tools.getNote.notFound}: ${id}`)
          }

          // Convert TipTap JSON to Markdown
          let content = ''
          if (note.content) {
            content = jsonToMarkdown(note.content, heading ? { heading } : undefined)
            if (heading && !content) {
              throw new Error(`${tools.getNote.headingNotFound}: ${heading}`)
            }
          }

          // Get notebook name
          const notebooks = getNotebooks()
          const notebook = notebooks.find(n => n.id === note.notebook_id)

          return {
            id: note.id,
            title: note.title,
            content,
            summary: note.ai_summary || undefined,
            tags: note.tags?.map(t => t.name) || [],
            notebook_id: note.notebook_id,
            notebook_name: notebook?.name || null,
            created_at: note.created_at,
            updated_at: note.updated_at,
            is_pinned: note.is_pinned,
            is_favorite: note.is_favorite,
            word_count: countWords(note.content || '')
          }
        } catch (error) {
          throw new Error(`${tools.getNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },

    // ==================== create_note ====================
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

          // Convert Markdown to TipTap JSON
          const tiptapContent = content ? markdownToTiptapString(content) : ''

          const input: NoteInput = {
            title,
            content: tiptapContent,
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

    // ==================== update_note ====================
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
          },
          append: {
            type: 'string',
            description: tools.updateNote.appendDesc
          },
          prepend: {
            type: 'string',
            description: tools.updateNote.prependDesc
          },
          edit: {
            type: 'object',
            description: tools.updateNote.editDesc,
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              replace_all: { type: 'boolean' }
            },
            required: ['old_string', 'new_string']
          }
        },
        required: ['id']
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          const title = args.title as string | undefined
          const content = args.content as string | undefined
          const append = args.append as string | undefined
          const prepend = args.prepend as string | undefined
          const edit = args.edit as { old_string: string; new_string: string; replace_all?: boolean } | undefined

          const note = getNoteById(id)
          if (!note) {
            throw new Error(`${tools.updateNote.notFound}: ${id}`)
          }

          const updates: Partial<NoteInput> = {}
          if (title !== undefined) updates.title = title

          // Handle different content update modes
          let replacements: number | undefined

          if (content !== undefined) {
            // Mode 1: Full replacement
            updates.content = markdownToTiptapString(content)
          } else if (append !== undefined) {
            // Mode 2: Append
            const currentMarkdown = jsonToMarkdown(note.content || '').trim()
            const newMarkdown = currentMarkdown ? currentMarkdown + '\n\n' + append : append
            updates.content = markdownToTiptapString(newMarkdown)
          } else if (prepend !== undefined) {
            // Mode 2: Prepend
            const currentMarkdown = jsonToMarkdown(note.content || '').trim()
            const newMarkdown = currentMarkdown ? prepend + '\n\n' + currentMarkdown : prepend
            updates.content = markdownToTiptapString(newMarkdown)
          } else if (edit !== undefined) {
            // Mode 3: Edit (old_string/new_string replacement)
            const currentMarkdown = jsonToMarkdown(note.content || '')
            const { old_string, new_string, replace_all } = edit

            // 空字符串检查：避免 ''.includes('') 永远为 true 的问题
            if (!old_string) {
              throw new Error(tools.updateNote.editEmptyString)
            }

            if (!currentMarkdown.includes(old_string)) {
              throw new Error(tools.updateNote.editNotFound)
            }

            const occurrences = currentMarkdown.split(old_string).length - 1

            if (occurrences > 1 && !replace_all) {
              throw new Error(tools.updateNote.editMultipleFound.replace('{count}', String(occurrences)))
            }

            const newMarkdown = replace_all
              ? currentMarkdown.split(old_string).join(new_string)
              : currentMarkdown.replace(old_string, new_string)

            updates.content = markdownToTiptapString(newMarkdown)
            replacements = replace_all ? occurrences : 1
          }

          if (Object.keys(updates).length === 0) {
            return {
              id: note.id,
              title: note.title,
              message: tools.updateNote.noChanges
            }
          }

          const updatedNote = updateNote(id, updates)
          if (!updatedNote) {
            throw new Error(`${tools.updateNote.notFound}: ${id}`)
          }
          notifyDataChange()

          return {
            id: updatedNote.id,
            title: updatedNote.title,
            message: replacements
              ? tools.updateNote.editSuccess.replace('{count}', String(replacements))
              : tools.updateNote.success,
            ...(replacements !== undefined && { replacements })
          }
        } catch (error) {
          throw new Error(`${tools.updateNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },

    // ==================== delete_note ====================
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

    // ==================== get_notebooks ====================
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
          const noteCounts = getNoteCountByNotebook()

          return notebooks.map(notebook => ({
            id: notebook.id,
            name: notebook.name,
            note_count: noteCounts[notebook.id] || 0,
            created_at: notebook.created_at
          }))
        } catch (error) {
          throw new Error(`${tools.getNotebooks.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },

    // ==================== move_note ====================
    {
      name: 'move_note',
      description: tools.moveNote.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: tools.moveNote.idDesc
          },
          notebook_id: {
            type: 'string',
            description: tools.moveNote.notebookIdDesc
          }
        },
        required: ['id']
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          // undefined means remove from notebook (same as null)
          const notebook_id = (args.notebook_id as string | undefined) ?? null

          // 先检查笔记是否存在
          const note = getNoteById(id)
          if (!note) {
            throw new Error(`${tools.moveNote.notFound}: ${id}`)
          }

          const success = dbMoveNote(id, notebook_id)
          if (!success) {
            // 笔记存在但移动失败，说明是目标笔记本不存在
            throw new Error(`${tools.moveNote.notebookNotFound}: ${notebook_id}`)
          }
          notifyDataChange()

          return {
            id,
            message: tools.moveNote.success
          }
        } catch (error) {
          throw new Error(`${tools.moveNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    }
  ]
}

/**
 * Build context providers for Notes
 */
function buildContextProviders(): AppContextProvider[] {
  const { getRawUserContext } = require('./index')

  return [
    {
      id: 'editor-state',
      name: 'Editor State',
      description: 'Current note, cursor position, and selection',
      getCurrent: async () => {
        const ctx = getRawUserContext()

        if (!ctx.currentNoteId || !ctx.currentNoteTitle) {
          return null
        }

        const parts: string[] = []
        const note = getNoteById(ctx.currentNoteId)

        let noteInfo = `Current note: "${ctx.currentNoteTitle}" (ID: ${ctx.currentNoteId})`
        if (ctx.currentNotebookName) {
          noteInfo += ` in notebook "${ctx.currentNotebookName}"`
        }
        parts.push(noteInfo)

        if (note?.ai_summary) {
          parts.push(`Summary: ${note.ai_summary}`)
        }

        if (ctx.selectedText) {
          const truncated = ctx.selectedText.length > 300
            ? ctx.selectedText.slice(0, 300) + '...'
            : ctx.selectedText
          parts.push(`Selected text:\n"${truncated}"`)
        }

        // Cursor context (heading + paragraph) instead of block ID
        if (ctx.cursorContext) {
          if (ctx.cursorContext.nearestHeading) {
            parts.push(`Cursor near heading: "${ctx.cursorContext.nearestHeading}"`)
          }
          if (ctx.cursorContext.currentParagraph) {
            const truncated = ctx.cursorContext.currentParagraph.length > 100
              ? ctx.cursorContext.currentParagraph.slice(0, 100) + '...'
              : ctx.cursorContext.currentParagraph
            parts.push(`Current paragraph: "${truncated}"`)
          }
        }

        return {
          content: parts.join('\n')
        }
      }
    },
    // Notes resource provider - allows users to reference notes in conversations
    {
      id: 'notes',
      name: 'Notes',
      description: 'Search and reference your notes',
      getList: async (options) => {
        const query = options?.query?.trim()
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? 20

        // Get notes with database-level pagination
        // Fetch limit + 1 to check if there are more results
        const notes = query
          ? searchNotes(query, limit + 1, offset)
          : getNotes(limit + 1, offset)

        // Check hasMore and trim to limit
        const hasMore = notes.length > limit
        const paginatedNotes = hasMore ? notes.slice(0, limit) : notes

        // Convert to list items
        const items = paginatedNotes.map(note => ({
          id: note.id,
          title: note.title || 'Untitled',
          summary: note.ai_summary || undefined,
          type: 'note' as const,
          updatedAt: note.updated_at,
          icon: note.is_daily ? '📅' : '📝',
        }))

        return { items, hasMore }
      },
      getById: async (id: string) => {
        const note = getNoteById(id)
        if (!note || note.deleted_at) {
          return null
        }

        // Build reference content with metadata only (not full content)
        const title = note.title || 'Untitled'
        const summary = note.ai_summary || ''
        const lines = [
          `- Title: ${title}`,
          `- Note ID: ${note.id}`,
        ]
        if (summary) {
          lines.push(`- Summary: ${summary}`)
        }
        const content = lines.join('\n')

        return {
          id: note.id,
          content,
          title,
          summary: note.ai_summary || undefined,
          type: 'note' as const,
          metadata: {
            notebookId: note.notebook_id,
            isDaily: note.is_daily,
            dailyDate: note.daily_date,
            createdAt: note.created_at,
            updatedAt: note.updated_at,
          }
        }
      }
    }
  ]
}

/**
 * Sync private agents with Sanqian
 */
async function syncPrivateAgents(): Promise<void> {
  if (!client) {
    throw new Error('Client not initialized')
  }

  if (syncingPromise) {
    await syncingPromise
    return
  }

  syncingPromise = (async () => {
    try {
      const agents = buildAgentConfigs()
      console.log('[Notes SDK] Syncing agents:', agents.map(a => a.agentId))

      const assistantAgent = agents[0]
      const assistantInfo = await client!.createAgent(assistantAgent)
      assistantAgentId = assistantInfo.agentId
      console.log('[Notes SDK] Assistant agent synced:', assistantAgentId)

      const writingAgent = agents[1]
      const writingInfo = await client!.createAgent(writingAgent)
      writingAgentId = writingInfo.agentId
      console.log('[Notes SDK] Writing agent synced:', writingAgentId)
    } catch (e) {
      console.error('[Notes SDK] Failed to sync agents:', e)
    }
  })()

  await syncingPromise
  syncingPromise = null
}

/**
 * Initialize and connect to Sanqian SDK
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
  }

  client = new SanqianAppClient(config)

  client.on('connected', () => {
    console.log('[Notes SDK] Connected to Sanqian')
  })

  client.on('registered', async () => {
    console.log('[Notes SDK] Registered with Sanqian')
    await syncPrivateAgents()
  })

  client.on('disconnected', () => {
    console.log('[Notes SDK] Disconnected from Sanqian')
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

  try {
    await client.connect()
    console.log('[Notes SDK] Initial connection successful')
  } catch (err) {
    console.log('[Notes SDK] Initial connection failed (Sanqian may not be running):', err instanceof Error ? err.message : err)
  }
}

/**
 * Disconnect from Sanqian SDK
 */
export async function stopSanqianSDK(): Promise<void> {
  if (client) {
    client.removeAllListeners()
    await client.disconnect()
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
 * Request persistent connection
 */
export function acquireReconnect(): void {
  client?.acquireReconnect()
}

/**
 * Release persistent connection request
 */
export function releaseReconnect(): void {
  client?.releaseReconnect()
}

/**
 * Get the assistant agent ID
 */
export function getAssistantAgentId(): string | null {
  return assistantAgentId
}

/**
 * Get the writing agent ID
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
 * Ensure client is connected and agents are ready
 */
export async function ensureAgentReady(
  agentType: 'assistant' | 'writing' = 'assistant'
): Promise<{ client: SanqianAppClient; agentId: string }> {
  if (!client) {
    throw new Error('Client not initialized')
  }

  await client.ensureReady()

  const agentId = agentType === 'assistant' ? assistantAgentId : writingAgentId

  if (agentId) {
    return { client, agentId }
  }

  await syncPrivateAgents()

  const finalAgentId = agentType === 'assistant' ? assistantAgentId : writingAgentId

  if (!finalAgentId) {
    throw new Error(`Failed to sync ${agentType} agent`)
  }

  return { client, agentId: finalAgentId }
}

/**
 * Fetch embedding configuration from Sanqian
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
    await client.ensureReady()
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
