/**
 * Read-only tool definitions: search_notes, get_note, get_note_outline, get_notebooks.
 */

import {
  type AppToolDefinition,
  type AppJsonSchemaProperty,
} from '@yushaw/sanqian-chat/main'
import {
  getNotebooks,
  getLocalFolderMounts,
  getLocalNoteMetadata,
} from '../../database'
import { hybridSearch } from '../../embedding/semantic-search'
import { t } from '../../i18n'
import {
  jsonToMarkdownWithMeta,
  countWords,
  getAllHeadingsFromJson,
  type DocumentHeading,
  type ConvertResult,
} from '../../markdown'
import {
  buildInternalEtag,
  resolveNoteResourceAsync,
  buildCanonicalLocalResourceId,
} from '../../note-gateway'
import { parseRequiredNotebookIdInput } from '../../../shared/notebook-id'
import { hasOwnDefinedProperty } from '../../../shared/property-guards'
import { extractLocalTagNamesFromTiptapContent } from '../../local-note-tags'
import { buildLocalEtagFromFile, ToolError } from '../helpers/error-mapping'
import { generateNoteLink } from '../helpers/note-link'
import {
  getLocalSummaryByPath,
  getLocalPinFavoriteByPath,
} from '../helpers/local-note-helpers'
import {
  buildHybridSearchResultItems,
  mergeSearchResultItems,
  buildLocalSearchResultItems,
} from '../helpers/search-helpers'
import {
  getNotebookNoteCountsForAgentAsync,
} from '../helpers/context-overview-helpers'

const SEARCH_NOTES_DEFAULT_LIMIT = 10
const SEARCH_NOTES_MAX_LIMIT = 100

function resolveSearchNotesLimit(limitInput: unknown): number {
  if (typeof limitInput !== 'number' || !Number.isFinite(limitInput)) {
    return SEARCH_NOTES_DEFAULT_LIMIT
  }
  const normalized = Math.floor(limitInput)
  if (normalized <= 0) {
    return SEARCH_NOTES_DEFAULT_LIMIT
  }
  return Math.min(normalized, SEARCH_NOTES_MAX_LIMIT)
}

export function buildSearchNotesTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
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
        folder_relative_path: {
          type: 'string',
          description: tools.searchNotes.folderPathDesc
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
        const query = typeof args.query === 'string' ? args.query : ''
        if (!query.trim()) {
          return []
        }
        const notebookIdInput = args.notebook_id
        const hasNotebookIdArg = hasOwnDefinedProperty(args, 'notebook_id')
        const notebook_id = parseRequiredNotebookIdInput(notebookIdInput) ?? undefined
        const rawFolderRelativePath = args.folder_relative_path as string | undefined
        const folder_relative_path = typeof rawFolderRelativePath === 'string'
          ? (rawFolderRelativePath.trim() ? rawFolderRelativePath : null)
          : null
        const limit = resolveSearchNotesLimit(args.limit)
        const notebooks = getNotebooks()
        const notebookMap = new Map(notebooks.map((n) => [n.id, n]))
        const notebookNameMap = new Map(notebooks.map((n) => [n.id, n.name]))

        if (hasNotebookIdArg && !notebook_id) {
          throw new ToolError(`${tools.searchNotes.notebookNotFound}: ${String(notebookIdInput ?? '')}`)
        }

        if (folder_relative_path && !notebook_id) {
          throw new ToolError(tools.searchNotes.folderScopeRequiresNotebook)
        }

        if (notebook_id) {
          const scopeNotebook = notebookMap.get(notebook_id)
          if (!scopeNotebook) {
            throw new ToolError(`${tools.searchNotes.notebookNotFound}: ${notebook_id}`)
          }
          if (scopeNotebook?.source_type === 'local-folder') {
            if (folder_relative_path) {
              return (await buildLocalSearchResultItems(query, notebookNameMap, notebook_id, folder_relative_path)).slice(0, limit)
            }

            const [hybridLocalResults, localKeywordResults] = await Promise.all([
              hybridSearch(query, {
                limit: Math.max(limit, 20),
                filter: { notebookId: notebook_id },
              }),
              buildLocalSearchResultItems(query, notebookNameMap, notebook_id),
            ])
            const hybridLocalItems = await buildHybridSearchResultItems(hybridLocalResults, notebookNameMap)
            return mergeSearchResultItems([
              ...hybridLocalItems,
              ...localKeywordResults,
            ]).slice(0, limit)
          }
          if (folder_relative_path) {
            throw new ToolError(tools.searchNotes.folderScopeOnlyForLocalNotebook)
          }
          const internalResults = await hybridSearch(query, {
            limit,
            filter: { notebookId: notebook_id }
          })
          const hybridInternalItems = await buildHybridSearchResultItems(internalResults, notebookNameMap)
          return hybridInternalItems.slice(0, limit)
        }

        const [hybridResults, localResults] = await Promise.all([
          hybridSearch(query, { limit: Math.max(limit, 20) }),
          buildLocalSearchResultItems(query, notebookNameMap),
        ])
        const hybridItems = await buildHybridSearchResultItems(hybridResults, notebookNameMap)

        const merged = mergeSearchResultItems([
          ...hybridItems,
          ...localResults,
        ])

        return merged.slice(0, limit)
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.searchNotes.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}

export function buildGetNoteTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
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

        const notebooks = getNotebooks()
        const notebookMap = new Map(notebooks.map(n => [n.id, n.name]))

        const NOT_FOUND = Symbol('not_found')
        type HeadingNotFoundResult = { marker: 'heading_not_found'; availableHeadings: DocumentHeading[] }

        const results = await Promise.all(ids.map(async (id) => {
          const resolved = await resolveNoteResourceAsync(id)
          if (!resolved.ok) {
            if (isBatch) {
              return { id, error: `${tools.getNote.notFound}: ${id}` }
            }
            return NOT_FOUND
          }

          if (resolved.resource.sourceType === 'local-folder') {
            const local = resolved.resource
            const canonicalLocalId = buildCanonicalLocalResourceId({
              notebookId: local.file.notebook_id,
              relativePath: local.file.relative_path,
            })
            const localSummary = getLocalSummaryByPath(local.file.notebook_id, local.file.relative_path)
            const localPinFavorite = getLocalPinFavoriteByPath(local.file.notebook_id, local.file.relative_path)
            const localMetadata = getLocalNoteMetadata({
              notebook_id: local.file.notebook_id,
              relative_path: local.file.relative_path,
            })
            const convertOptions = (!isBatch && heading)
              ? { heading, headingMatch, offset, limit }
              : { offset, limit }
            const convertResult = jsonToMarkdownWithMeta(local.file.tiptap_content, convertOptions)

            if (!isBatch && heading && !convertResult.content) {
              const availableHeadings = getAllHeadingsFromJson(local.file.tiptap_content)
              return { marker: 'heading_not_found', availableHeadings } as HeadingNotFoundResult
            }

            const updatedAt = new Date(local.file.mtime_ms).toISOString()
            return {
              id: canonicalLocalId,
              title: local.file.name,
              link: null,
              content: convertResult.content,
              totalLines: convertResult.totalLines,
              ...(convertResult.returnedLines && { returnedLines: convertResult.returnedLines }),
              ...(convertResult.hasMore !== undefined && { hasMore: convertResult.hasMore }),
              summary: localSummary || undefined,
              tags: localMetadata?.tags?.length
                ? localMetadata.tags
                : extractLocalTagNamesFromTiptapContent(local.file.tiptap_content),
              notebook_id: local.file.notebook_id,
              notebook_name: notebookMap.get(local.file.notebook_id) || local.mount.notebook.name || null,
              created_at: updatedAt,
              updated_at: updatedAt,
              is_pinned: localPinFavorite.isPinned,
              is_favorite: localPinFavorite.isFavorite,
              word_count: countWords(convertResult.content || ''),
              source_type: 'local-folder' as const,
              relative_path: local.file.relative_path,
              etag: local.etag,
            }
          }

          const note = resolved.resource.note
          let convertResult: ConvertResult = { content: '', totalLines: 0 }
          if (note.content) {
            const convertOptions = (!isBatch && heading)
              ? { heading, headingMatch, offset, limit }
              : { offset, limit }
            convertResult = jsonToMarkdownWithMeta(note.content, convertOptions)
            if (!isBatch && heading && !convertResult.content) {
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
            tags: note.tags?.map((tag) => tag.name) || [],
            notebook_id: note.notebook_id,
            notebook_name: notebookMap.get(note.notebook_id || '') || null,
            created_at: note.created_at,
            updated_at: note.updated_at,
            is_pinned: note.is_pinned,
            is_favorite: note.is_favorite,
            word_count: countWords(note.content || ''),
            source_type: 'internal' as const,
            revision: note.revision,
            etag: buildInternalEtag(note),
          }
        }))

        if (!isBatch) {
          const result = results[0]
          if (result === NOT_FOUND) {
            throw new ToolError(`${tools.getNote.notFound}: ${ids[0]}`)
          }
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

        if (heading) {
          return {
            warning: tools.getNote.headingIgnoredInBatch,
            notes: results
          }
        }
        return results
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.getNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}

export function buildGetNoteOutlineTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
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
        const resolved = await resolveNoteResourceAsync(id)
        if (!resolved.ok) {
          throw new ToolError(`${tools.getNoteOutline.notFound}: ${id}`)
        }

        if (resolved.resource.sourceType === 'local-folder') {
          const localFile = resolved.resource.file
          const headings = localFile.tiptap_content ? getAllHeadingsFromJson(localFile.tiptap_content) : []
          const canonicalLocalId = buildCanonicalLocalResourceId({
            notebookId: localFile.notebook_id,
            relativePath: localFile.relative_path,
          })

          return {
            id: canonicalLocalId,
            title: localFile.name,
            link: null,
            source_type: 'local-folder',
            relative_path: localFile.relative_path,
            etag: buildLocalEtagFromFile(localFile),
            headings: headings.map(h => ({
              level: h.level,
              text: h.text,
              formatted: `${'#'.repeat(h.level)} ${h.text}`,
              link: null,
              line: h.line
            }))
          }
        }

        const note = resolved.resource.note

        if (!note || note.deleted_at) {
          throw new ToolError(`${tools.getNoteOutline.notFound}: ${id}`)
        }

        const headings = note.content ? getAllHeadingsFromJson(note.content) : []

        return {
          id: note.id,
          title: note.title,
          link: generateNoteLink(note.id),
          revision: note.revision,
          etag: buildInternalEtag(note),
          headings: headings.map(h => ({
            level: h.level,
            text: h.text,
            formatted: `${'#'.repeat(h.level)} ${h.text}`,
            link: generateNoteLink(note.id, h.text),
            line: h.line
          }))
        }
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.getNoteOutline.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}

export function buildGetNotebooksTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
    name: 'get_notebooks',
    description: tools.getNotebooks.description,
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      try {
        const notebooks = getNotebooks()
        const noteCounts = await getNotebookNoteCountsForAgentAsync()
        const localMountStatusByNotebook = new Map(
          getLocalFolderMounts().map((mount) => [mount.notebook.id, mount.mount.status] as const)
        )

        return notebooks.map((notebook) => {
          const sourceType = notebook.source_type
          const status = sourceType === 'local-folder'
            ? (localMountStatusByNotebook.get(notebook.id) || 'missing')
            : 'active'
          const writable = sourceType === 'internal' || status === 'active'

          return {
            source_type: sourceType,
            status,
            writable,
            id: notebook.id,
            name: notebook.name,
            note_count: noteCounts[notebook.id] || 0,
            created_at: notebook.created_at,
          }
        })
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.getNotebooks.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}
