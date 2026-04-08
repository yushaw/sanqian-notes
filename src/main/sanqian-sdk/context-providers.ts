/**
 * SDK context providers for Notes.
 *
 * Contains buildContextProviders() which assembles the editor-state,
 * notes, and notebooks context providers for the chat panel.
 */

import type { AppContextProvider, AppContextListItem } from '@yushaw/sanqian-chat/main'
import {
  getNoteById,
  getNotebooks,
  getLocalNoteMetadata,
} from '../database'
import { t } from '../i18n'
import { resolveNoteResourceAsync, buildCanonicalLocalResourceId } from '../note-gateway'
import {
  buildNotesOverviewContextAsync,
  buildNotebooksOverviewContextAsync,
} from '../context-overview'
import { getRawUserContext } from '../user-context'
import { sanitizeContextInlineText, generateNoteLink } from './helpers/note-link'
import {
  resolveLocalPathFromAnyId,
} from './helpers/caching'
import {
  buildContextOverviewDataSourceAsync,
  getNotebookNoteCountsForAgentAsync,
  getInternalContextNotes,
} from './helpers/context-overview-helpers'
import { buildLocalContextListItems } from './helpers/search-helpers'

export function buildContextProviders(): AppContextProvider[] {
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
        const localPath = resolveLocalPathFromAnyId(ctx.currentNoteId)
        const canonicalLocalId = localPath
          ? buildCanonicalLocalResourceId({ notebookId: localPath.notebookId, relativePath: localPath.relativePath })
          : null
        const note = localPath ? null : getNoteById(ctx.currentNoteId)
        const localMetadata = localPath
          ? getLocalNoteMetadata({
            notebook_id: localPath.notebookId,
            relative_path: localPath.relativePath,
          })
          : null
        const safeNoteTitle = sanitizeContextInlineText(ctx.currentNoteTitle)
        const noteIdForContext = canonicalLocalId || ctx.currentNoteId
        let noteInfo = `Current note: "${safeNoteTitle}" (ID: ${noteIdForContext})`
        if (localPath) {
          if (ctx.currentNotebookName) {
            noteInfo += ` in local notebook "${sanitizeContextInlineText(ctx.currentNotebookName)}"`
          }
          noteInfo += ` (path: ${sanitizeContextInlineText(localPath.relativePath)})`
        } else if (ctx.currentNotebookName) {
          noteInfo += ` in notebook "${sanitizeContextInlineText(ctx.currentNotebookName)}"`
        }
        parts.push(noteInfo)

        if (localMetadata?.ai_summary) {
          parts.push(`Summary: ${sanitizeContextInlineText(localMetadata.ai_summary)}`)
        } else if (note?.ai_summary) {
          parts.push(`Summary: ${sanitizeContextInlineText(note.ai_summary)}`)
        }

        // Selected text (fallback for when Session Resource is not available)
        // Session Resource is only pushed when Chat is visible + setting enabled
        // This ensures AI can always access selectedText via editor-state context
        if (ctx.selectedText) {
          const truncated = ctx.selectedText.length > 500
            ? ctx.selectedText.slice(0, 500) + '...'
            : ctx.selectedText
          parts.push(`Selected text: "${sanitizeContextInlineText(truncated)}"`)
        }

        // Cursor context (heading + paragraph)
        if (ctx.cursorContext) {
          if (ctx.cursorContext.nearestHeading) {
            parts.push(`Cursor near heading: "${sanitizeContextInlineText(ctx.cursorContext.nearestHeading)}"`)
          }
          if (ctx.cursorContext.currentParagraph) {
            const truncated = ctx.cursorContext.currentParagraph.length > 100
              ? ctx.cursorContext.currentParagraph.slice(0, 100) + '...'
              : ctx.cursorContext.currentParagraph
            parts.push(`Current paragraph: "${sanitizeContextInlineText(truncated)}"`)
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
      getCurrent: async () => {
        return buildNotesOverviewContextAsync(
          getRawUserContext(),
          buildContextOverviewDataSourceAsync(),
          { includeCurrentNote: false }
        )
      },
      getList: async (options) => {
        const query = options?.query?.trim()
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? 20
        const notebooks = getNotebooks()
        const notebookNameMap = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]))

        // Get enough rows from each source and paginate after merge for a stable cross-source list.
        const fetchLimit = offset + limit + 1
        const internalNotes = getInternalContextNotes(query, fetchLimit)
        const internalItems: AppContextListItem[] = internalNotes.map((note) => ({
          id: note.id,
          title: note.title || 'Untitled',
          summary: note.ai_summary || undefined,
          type: 'note',
          updatedAt: note.updated_at,
          icon: note.is_daily ? '\uD83D\uDCC5' : '\uD83D\uDCDD',
          group: note.notebook_id ? (notebookNameMap.get(note.notebook_id) || undefined) : undefined,
          tags: note.tags?.map((tag) => tag.name) || undefined,
        }))

        const localItems = await buildLocalContextListItems(notebookNameMap, query)
        const merged = [...internalItems, ...localItems].sort((a, b) => {
          const leftUpdated = a.updatedAt || ''
          const rightUpdated = b.updatedAt || ''
          if (leftUpdated !== rightUpdated) {
            return rightUpdated.localeCompare(leftUpdated)
          }
          return a.id.localeCompare(b.id, undefined, { sensitivity: 'base', numeric: true })
        })

        const page = merged.slice(offset, offset + limit + 1)
        const hasMore = page.length > limit
        const items = hasMore ? page.slice(0, limit) : page

        return { items, hasMore }
      },
      getById: async (id: string) => {
        const resolved = await resolveNoteResourceAsync(id)
        if (!resolved.ok) {
          return null
        }

        if (resolved.resource.sourceType === 'local-folder') {
          const local = resolved.resource
          const localFile = local.file
          const localMetadata = getLocalNoteMetadata({
            notebook_id: localFile.notebook_id,
            relative_path: localFile.relative_path,
          })
          const notebookName = local.mount.notebook.name
          const updatedAt = new Date(localFile.mtime_ms).toISOString()
          const canonicalLocalId = buildCanonicalLocalResourceId({
            notebookId: localFile.notebook_id,
            relativePath: localFile.relative_path,
          })
          const summary = localMetadata?.ai_summary || `${notebookName} \u00B7 ${localFile.relative_path}`
          const lines = [
            `[Local Note]`,
            `- Title: ${localFile.name}`,
            `- Resource ID: ${canonicalLocalId}`,
            `- Notebook ID: ${localFile.notebook_id}`,
            `- Notebook: ${notebookName}`,
            `- Relative path: ${localFile.relative_path}`,
            `- Last modified: ${updatedAt}`,
          ]

          return {
            id: canonicalLocalId,
            content: lines.join('\n'),
            title: localFile.name,
            summary,
            type: 'note',
            metadata: {
              sourceType: 'local-folder',
              notebookId: localFile.notebook_id,
              notebookName,
              relativePath: localFile.relative_path,
              size: localFile.size,
              updatedAt,
              isPinned: localMetadata?.is_pinned ?? false,
              isFavorite: localMetadata?.is_favorite ?? false,
            }
          }
        }

        const note = resolved.resource.note

        if (note.deleted_at) {
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
      getCurrent: async () => {
        return buildNotebooksOverviewContextAsync(getRawUserContext(), buildContextOverviewDataSourceAsync())
      },
      getList: async () => {
        const notebooks = getNotebooks()
        const noteCounts = await getNotebookNoteCountsForAgentAsync()

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

        const noteCounts = await getNotebookNoteCountsForAgentAsync()
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
