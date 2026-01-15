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
  type AppContextProvider,
  type AppJsonSchemaProperty
} from '@yushaw/sanqian-chat/main'
import { app } from 'electron'
import {
  getFormatterAgentConfig,
  createEditorOutputTools,
} from './editor-agent'
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
import { jsonToMarkdown, jsonToMarkdownWithMeta, markdownToTiptapString, countWords, getAllHeadingsFromJson, type DocumentHeading, type ConvertResult } from './markdown'

/**
 * Normalize quotes and punctuation for fuzzy matching
 * Converts Chinese quotes to English quotes, etc.
 */
function normalizeForMatching(str: string): string {
  return str
    .replace(/[\u201C\u201D]/g, '"')  // Chinese double quotes "" → "
    .replace(/[\u2018\u2019]/g, "'")  // Chinese single quotes '' → '
    .replace(/\uFF1A/g, ':')          // Chinese colon ： → :
    .replace(/\uFF1B/g, ';')          // Chinese semicolon ； → ;
    .replace(/\uFF0C/g, ',')          // Chinese comma ， → ,
}

/**
 * Find the original string in content that matches the normalized search string
 */
function findOriginalMatch(content: string, normalizedContent: string, normalizedSearch: string): string {
  const index = normalizedContent.indexOf(normalizedSearch)
  if (index === -1) return ''

  // We need to find the corresponding position in the original content
  // Since normalization is char-to-char (same length), index maps directly
  return content.slice(index, index + normalizedSearch.length)
}

/**
 * Multi-layer string matching for edit operations
 * Layer 1: Exact match
 * Layer 2: Normalized match (quotes, punctuation)
 */
function findWithNormalization(
  content: string,
  search: string
): {
  found: boolean
  matchedString: string
  normalizedMatch: boolean
  occurrences: number
} {
  // Layer 1: Exact match
  if (content.includes(search)) {
    const occurrences = content.split(search).length - 1
    return { found: true, matchedString: search, normalizedMatch: false, occurrences }
  }

  // Layer 2: Normalized match
  const normalizedContent = normalizeForMatching(content)
  const normalizedSearch = normalizeForMatching(search)

  if (normalizedContent.includes(normalizedSearch)) {
    const occurrences = normalizedContent.split(normalizedSearch).length - 1
    const matchedString = findOriginalMatch(content, normalizedContent, normalizedSearch)
    return { found: true, matchedString, normalizedMatch: true, occurrences }
  }

  return { found: false, matchedString: '', normalizedMatch: false, occurrences: 0 }
}

/**
 * Find similar content for better error messages
 */
function findSimilarContent(content: string, search: string, maxLength: number = 80): string | null {
  // Try to find a line that contains the beginning of the search string
  const searchStart = normalizeForMatching(search.slice(0, 30))
  const lines = content.split('\n')

  for (const line of lines) {
    if (normalizeForMatching(line).includes(searchStart)) {
      return line.length > maxLength ? line.slice(0, maxLength) + '...' : line
    }
  }

  // Fallback: try even shorter prefix
  const shortPrefix = normalizeForMatching(search.slice(0, 15))
  for (const line of lines) {
    if (normalizeForMatching(line).includes(shortPrefix)) {
      return line.length > maxLength ? line.slice(0, maxLength) + '...' : line
    }
  }

  return null
}

/**
 * Generate sanqian-notes:// link for a note
 */
function generateNoteLink(noteId: string, heading?: string): string {
  const base = `sanqian-notes://note/${noteId}`
  if (heading) {
    return `${base}?heading=${encodeURIComponent(heading)}`
  }
  return base
}

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
let formatterAgentId: string | null = null
let syncingPromise: Promise<void> | null = null
let onDataChangeCallback: (() => void) | null = null
let currentTaskIdGetter: (() => string | null) | null = null

/**
 * Set current task ID getter for output tools
 */
export function setCurrentTaskIdGetter(getter: () => string | null): void {
  currentTaskIdGetter = getter
}

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
        'get_note_outline',
        'create_note',
        'update_note',
        'delete_note',
        'get_notebooks',
        'move_note',
        'web_search',
        'fetch_web'
      ],
      attachedContexts: ['sanqian-notes:editor-state', 'sanqian-notes:notes', 'sanqian-notes:notebooks']
    },
    {
      agentId: 'writing',
      name: sdk.writingName,
      description: sdk.writingDescription,
      systemPrompt: sdk.writingSystemPrompt,
      tools: []
    },
    // Formatter Agent for formatting output
    getFormatterAgentConfig()
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
            filter: notebook_id ? { notebookId: notebook_id } : undefined
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
                link: generateNoteLink(result.noteId),
                preview: result.matchedChunks[0]?.chunkText
                  ? truncateText(result.matchedChunks[0].chunkText, 300)
                  : '',
                score: result.score,
                updated_at: note.updated_at,
                notebook_id: result.notebookId,
                notebook_name: notebookMap.get(result.notebookId || '') || null,
                tags: note.tags?.map(t => t.name) || [],
                summary: note.ai_summary || null,
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
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: tools.getNote.idDesc
          } as unknown as AppJsonSchemaProperty,
          heading: {
            type: 'string',
            description: tools.getNote.headingDesc
          },
          headingMatch: {
            type: 'string',
            enum: ['exact', 'contains', 'startsWith'],
            description: tools.getNote.headingMatchDesc
          },
          offset: {
            type: 'number',
            description: tools.getNote.offsetDesc
          },
          limit: {
            type: 'number',
            description: tools.getNote.limitDesc
          }
        },
        required: ['id']
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const idArg = args.id as string | string[]
          const heading = args.heading as string | undefined
          const headingMatch = (args.headingMatch as 'exact' | 'contains' | 'startsWith') || 'contains'
          const offset = args.offset as number | undefined
          const limit = args.limit as number | undefined
          const isBatch = Array.isArray(idArg)
          const ids = isBatch ? idArg : [idArg]

          // Get notebooks map for names
          const notebooks = getNotebooks()
          const notebookMap = new Map(notebooks.map(n => [n.id, n.name]))

          // Error markers for single mode (avoid re-querying)
          const NOT_FOUND = Symbol('not_found')
          type HeadingNotFoundResult = { marker: 'heading_not_found'; availableHeadings: DocumentHeading[] }

          const results = ids.map(id => {
            const note = getNoteById(id)

            // 排除不存在或已删除的笔记（与 search_notes 行为一致）
            if (!note || note.deleted_at) {
              // Batch mode: return error object; Single mode: return marker
              if (isBatch) {
                return { id, error: `${tools.getNote.notFound}: ${id}` }
              }
              return NOT_FOUND
            }

            // Convert TipTap JSON to Markdown with pagination info
            // heading only applies to single note
            let convertResult: ConvertResult = { content: '', totalLines: 0 }
            if (note.content) {
              const convertOptions = (!isBatch && heading)
                ? { heading, headingMatch, offset, limit }
                : { offset, limit }
              convertResult = jsonToMarkdownWithMeta(note.content, convertOptions)
              if (!isBatch && heading && !convertResult.content) {
                // Single mode with heading not found: return marker with available headings
                const availableHeadings = getAllHeadingsFromJson(note.content)
                return { marker: 'heading_not_found', availableHeadings } as HeadingNotFoundResult
              }
            }

            return {
              id: note.id,
              title: note.title,
              link: generateNoteLink(note.id),
              content: convertResult.content,
              totalLines: convertResult.totalLines,
              ...(convertResult.returnedLines && { returnedLines: convertResult.returnedLines }),
              ...(convertResult.hasMore !== undefined && { hasMore: convertResult.hasMore }),
              summary: note.ai_summary || undefined,
              tags: note.tags?.map(t => t.name) || [],
              notebook_id: note.notebook_id,
              notebook_name: notebookMap.get(note.notebook_id || '') || null,
              created_at: note.created_at,
              updated_at: note.updated_at,
              is_pinned: note.is_pinned,
              is_favorite: note.is_favorite,
              word_count: countWords(note.content || '')
            }
          })

          // Single id mode: throw based on error marker
          if (!isBatch) {
            const result = results[0]
            if (result === NOT_FOUND) {
              throw new Error(`${tools.getNote.notFound}: ${ids[0]}`)
            }
            // Return structured error with available headings
            if (result && typeof result === 'object' && 'marker' in result && result.marker === 'heading_not_found') {
              const headingResult = result as HeadingNotFoundResult
              const formattedHeadings = headingResult.availableHeadings.map(
                h => `${'#'.repeat(h.level)} ${h.text}`
              )
              return {
                error: `${tools.getNote.headingNotFound}: ${heading}`,
                hint: 'Available headings in this note:',
                availableHeadings: formattedHeadings
              }
            }
            return result
          }

          // Batch mode: return array (may contain error objects)
          // Warn if heading was provided but ignored
          if (heading) {
            return {
              warning: tools.getNote.headingIgnoredInBatch,
              notes: results
            }
          }
          return results
        } catch (error) {
          throw new Error(`${tools.getNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
        }
      }
    },

    // ==================== get_note_outline ====================
    {
      name: 'get_note_outline',
      description: tools.getNoteOutline.description,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: tools.getNoteOutline.idDesc
          }
        },
        required: ['id']
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = args.id as string
          const note = getNoteById(id)

          if (!note || note.deleted_at) {
            throw new Error(`${tools.getNoteOutline.notFound}: ${id}`)
          }

          const headings = note.content ? getAllHeadingsFromJson(note.content) : []

          return {
            id: note.id,
            title: note.title,
            link: generateNoteLink(note.id),
            headings: headings.map(h => ({
              level: h.level,
              text: h.text,
              formatted: `${'#'.repeat(h.level)} ${h.text}`,
              link: generateNoteLink(note.id, h.text),
              line: h.line
            }))
          }
        } catch (error) {
          throw new Error(`${tools.getNoteOutline.error}: ${error instanceof Error ? error.message : common.unknownError}`)
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
          if (!note || note.deleted_at) {
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

            // Multi-layer matching: exact → normalized (quotes, punctuation)
            const matchResult = findWithNormalization(currentMarkdown, old_string)

            if (!matchResult.found) {
              // Try to find similar content for better error message
              const similar = findSimilarContent(currentMarkdown, old_string)
              if (similar) {
                throw new Error(`${tools.updateNote.editNotFound} ${tools.updateNote.editSimilarFound}: "${similar}"`)
              }
              throw new Error(tools.updateNote.editNotFound)
            }

            const { matchedString, normalizedMatch, occurrences } = matchResult

            if (occurrences > 1 && !replace_all) {
              throw new Error(tools.updateNote.editMultipleFound.replace('{count}', String(occurrences)))
            }

            // Use the actual matched string for replacement
            const newMarkdown = replace_all
              ? currentMarkdown.split(matchedString).join(new_string)
              : currentMarkdown.replace(matchedString, new_string)

            updates.content = markdownToTiptapString(newMarkdown)
            replacements = replace_all ? occurrences : 1

            // Log if normalized match was used (for debugging)
            if (normalizedMatch) {
              console.log(`[update_note] Used normalized matching for edit operation`)
            }
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

          // 先检查笔记是否存在（排除已删除的笔记）
          const note = getNoteById(id)
          if (!note || note.deleted_at) {
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
    },

    // ==================== web_search ====================
    {
      name: 'web_search',
      description: tools.webSearch.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: tools.webSearch.queryDesc
          }
        },
        required: ['query']
      },
      handler: async (args: Record<string, unknown>) => {
        const query = args.query as string
        // 实际搜索由 SDK 内置实现，这里只是声明工具
        return { query, message: 'Web search executed by SDK' }
      }
    },

    // ==================== fetch_web ====================
    {
      name: 'fetch_web',
      description: tools.fetchWeb.description,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: tools.fetchWeb.urlDesc
          },
          prompt: {
            type: 'string',
            description: tools.fetchWeb.promptDesc
          }
        },
        required: ['url']
      },
      handler: async (args: Record<string, unknown>) => {
        const url = args.url as string
        const prompt = args.prompt as string | undefined
        // 实际抓取由 SDK 内置实现，这里只是声明工具
        return { url, prompt, message: 'Web fetch executed by SDK' }
      }
    },

    // ==================== Formatter Output Tools ====================
    // These tools are used by the Formatter Agent to format and insert content
    ...createEditorOutputTools(
      () => currentTaskIdGetter?.() ?? null
    )
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

        // Selected text (fallback for when Session Resource is not available)
        // Session Resource is only pushed when Chat is visible + setting enabled
        // This ensures AI can always access selectedText via editor-state context
        if (ctx.selectedText) {
          const truncated = ctx.selectedText.length > 500
            ? ctx.selectedText.slice(0, 500) + '...'
            : ctx.selectedText
          parts.push(`Selected text: "${truncated}"`)
        }

        // Cursor context (heading + paragraph)
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
      name: t().contexts.notes.name,
      description: t().contexts.notes.description,
      getList: async (options) => {
        const query = options?.query?.trim()
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? 20

        // Get notes with database-level pagination
        // Fetch limit + 1 to check if there are more results
        const notes = query
          ? searchNotes(query, undefined, limit + 1, offset)
          : getNotes(limit + 1, offset)

        // Check hasMore and trim to limit
        const hasMore = notes.length > limit
        const paginatedNotes = hasMore ? notes.slice(0, limit) : notes

        // Convert to list items
        const items = paginatedNotes.map(note => ({
          id: note.id,
          title: note.title || 'Untitled',
          link: generateNoteLink(note.id),
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
        const link = generateNoteLink(note.id)
        const lines = [
          `[Note]`,
          `- Title: ${title}`,
          `- Note ID: ${note.id}`,
          `- Link: ${link}`,
        ]
        if (summary) {
          lines.push(`- Summary: ${summary}`)
        }
        const content = lines.join('\n')

        return {
          id: note.id,
          content,
          title,
          link,
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
    },
    // Notebooks resource provider
    {
      id: 'notebooks',
      name: t().contexts.notebooks.name,
      description: t().contexts.notebooks.description,
      getList: async () => {
        const notebooks = getNotebooks()
        const noteCounts = getNoteCountByNotebook()

        const items = notebooks.map(notebook => ({
          id: notebook.id,
          title: notebook.name,
          summary: `${noteCounts[notebook.id] || 0} notes`,
        }))

        return { items, hasMore: false }
      },
      getById: async (id: string) => {
        const notebooks = getNotebooks()
        const notebook = notebooks.find(n => n.id === id)
        if (!notebook) {
          return null
        }

        const noteCounts = getNoteCountByNotebook()
        const noteCount = noteCounts[notebook.id] || 0

        const lines = [
          `[Notebook]`,
          `- Title: ${notebook.name}`,
          `- Notebook ID: ${notebook.id}`,
          `- Note count: ${noteCount}`,
        ]
        const content = lines.join('\n')

        return {
          id: notebook.id,
          content,
          title: notebook.name,
          summary: `${noteCount} notes`,
          type: 'notebook',
          metadata: {
            noteCount,
            createdAt: notebook.created_at,
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

      // Sync Formatter Agent for output formatting
      const formatterAgent = agents[2]
      if (formatterAgent) {
        const formatterInfo = await client!.createAgent(formatterAgent)
        formatterAgentId = formatterInfo.agentId
        console.log('[Notes SDK] Formatter agent synced:', formatterAgentId)
      }
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
    formatterAgentId = null
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
    formatterAgentId = null
    syncingPromise = null
  }
}

/**
 * Update SDK i18n (contexts and agents) when locale changes
 */
export async function updateSdkContexts(): Promise<void> {
  if (!client || !client.isConnected()) {
    return
  }

  try {
    // Update context providers
    const contexts = buildContextProviders()
    await client.updateContexts(contexts)

    // Update agents (name, description, systemPrompt)
    await syncPrivateAgents()

    console.log('[Notes SDK] Contexts and agents updated for new locale')
  } catch (error) {
    console.error('[Notes SDK] Failed to update SDK i18n:', error)
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
 * Get the formatter agent ID (for output formatting)
 */
export function getFormatterAgentId(): string | null {
  return formatterAgentId
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

/**
 * Fetch rerank configuration from Sanqian
 */
export async function fetchRerankConfigFromSanqian(): Promise<{
  available: boolean
  apiUrl?: string
  apiKey?: string
  modelName?: string
} | null> {
  if (!client) {
    console.log('[Notes SDK] Client not initialized, cannot fetch rerank config')
    return null
  }

  try {
    await client.ensureReady()
    const config = await client.getRerankConfig()

    if (config?.available) {
      console.log(
        `[Notes SDK] Got rerank config from Sanqian: model=${config.modelName}, apiUrl=${config.apiUrl}`
      )
    } else {
      console.log('[Notes SDK] Sanqian has no rerank configured')
    }

    return config
  } catch (error) {
    console.log(
      '[Notes SDK] Failed to fetch rerank config from Sanqian:',
      error instanceof Error ? error.message : error
    )
    return null
  }
}
