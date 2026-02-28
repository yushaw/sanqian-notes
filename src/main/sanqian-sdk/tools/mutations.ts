/**
 * Mutation tool definitions: create_note, update_note, delete_note, move_note.
 */

import {
  type AppToolDefinition,
  type AppJsonSchemaProperty,
} from '@yushaw/sanqian-chat/main'
import {
  getNoteById,
  addNote,
  updateNoteSafe,
  deleteNote,
  getNotebooks,
  getLocalNoteMetadata,
  getLocalNoteIdentityByPath,
  updateLocalNoteMetadata,
  moveNote as dbMoveNote,
  type NoteInput,
} from '../../database'
import { t } from '../../i18n'
import {
  markdownToTiptapString,
} from '../../markdown'
import {
  createLocalFolderFile,
  readLocalFolderFile,
  renameLocalFolderEntry,
  saveLocalFolderFile,
} from '../../local-folder'
import {
  rollbackLocalFile,
  trashLocalFile,
} from '../../local-file-compensation'
import {
  createLocalResourceId,
} from '../../../shared/local-resource-id'
import {
  buildInternalEtag,
  buildLocalEtag,
  resolveIfMatchForInternal,
  resolveIfMatchForLocal,
  resolveNoteResource,
  resolveNotebookForCreate,
  buildCanonicalLocalResourceId,
} from '../../note-gateway'
import { buildUpdatedNoteContent } from '../helpers/content-mutation'
import { buildLocalEtagFromFile, mapIfMatchCheckError, mapLocalToolErrorCode, isLocalIfMatchStale, ToolError } from '../helpers/error-mapping'
import {
  getActiveLocalMountByNotebookId,
} from '../helpers/caching'
import {
  migrateLocalNoteMetadataPath,
  ensureLocalNoteIdentityForPath,
  syncLocalNoteDerivedState,
  moveLocalNoteIdentityAcrossNotebooks,
  cleanupLocalNoteMetadata,
} from '../helpers/local-note-helpers'
import {
  notifyDataChange,
  triggerIndexingForNote,
  deleteIndexForNote,
  syncIndexedNotebookForNote,
} from '../state'

export function buildCreateNoteTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
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
        const notebook_id = (args.notebook_id as string | undefined)?.trim() || null
        const notebookTarget = resolveNotebookForCreate(notebook_id)
        if (!notebookTarget.ok) {
          if (notebookTarget.error === 'notebook_not_found') {
            throw new ToolError(`${tools.createNote.notebookNotFound}: ${notebook_id}`)
          }
          throw new ToolError(tools.createNote.localNotebookUnavailable)
        }

        if (notebookTarget.sourceType === 'internal') {
          const tiptapContent = content ? markdownToTiptapString(content) : ''
          const input: NoteInput = {
            title,
            content: tiptapContent,
            notebook_id: notebook_id || null,
          }
          const note = addNote(input)
          triggerIndexingForNote(note.id, note.notebook_id, note.content)
          notifyDataChange()

          return {
            id: note.id,
            title: note.title,
            source_type: 'internal',
            revision: note.revision,
            etag: buildInternalEtag(note),
            message: tools.createNote.success,
          }
        }

        const created = createLocalFolderFile(notebookTarget.mount, null, title)
        if (!created.success) {
          throw new ToolError(mapLocalToolErrorCode(created.errorCode, {
            notFound: tools.createNote.localNotebookUnavailable,
            conflict: tools.createNote.localFileAlreadyExists,
            invalidName: tools.createNote.localInvalidName,
            accessDenied: tools.createNote.localAccessDenied,
            writeFailed: tools.createNote.localWriteFailed,
            alreadyExists: tools.createNote.localFileAlreadyExists,
          }))
        }

        const relativePath = created.result.relative_path
        const rollbackCreatedLocalFile = (): Promise<boolean> => rollbackLocalFile(
          notebookTarget.mount,
          {
            notebookId: notebookTarget.notebook.id,
            relativePath,
          }
        )

        if (content !== undefined) {
          const saveResult = saveLocalFolderFile(
            notebookTarget.mount,
            relativePath,
            markdownToTiptapString(content),
            { force: true }
          )
          if (!saveResult.success) {
            const rollbackOk = await rollbackCreatedLocalFile()
            if (!rollbackOk) {
              throw new ToolError(tools.createNote.localRollbackFailed)
            }
            throw new ToolError(mapLocalToolErrorCode(saveResult.errorCode, {
              notFound: tools.createNote.localNotebookUnavailable,
              conflict: tools.createNote.localConflict,
              invalidName: tools.createNote.localInvalidName,
              accessDenied: tools.createNote.localAccessDenied,
              writeFailed: tools.createNote.localWriteFailed,
              tooLarge: tools.createNote.localTooLarge,
            }))
          }
        }

        const localRead = readLocalFolderFile(notebookTarget.mount, relativePath)
        if (!localRead.success) {
          const rollbackOk = await rollbackCreatedLocalFile()
          if (!rollbackOk) {
            throw new ToolError(tools.createNote.localRollbackFailed)
          }
          throw new ToolError(mapLocalToolErrorCode(localRead.errorCode, {
            notFound: tools.createNote.localNotebookUnavailable,
            conflict: tools.createNote.localConflict,
            invalidName: tools.createNote.localInvalidName,
            accessDenied: tools.createNote.localAccessDenied,
            writeFailed: tools.createNote.localWriteFailed,
            tooLarge: tools.createNote.localTooLarge,
          }))
        }

        const localFile = localRead.result
        ensureLocalNoteIdentityForPath(localFile.notebook_id, localFile.relative_path)
        syncLocalNoteDerivedState(localFile.notebook_id, localFile.relative_path, localFile.tiptap_content)
        const localId = buildCanonicalLocalResourceId({ notebookId: localFile.notebook_id, relativePath: localFile.relative_path })
        const legacyLocalIndexId = createLocalResourceId(localFile.notebook_id, localFile.relative_path)
        deleteIndexForNote(legacyLocalIndexId)
        triggerIndexingForNote(localId, localFile.notebook_id, localFile.tiptap_content)
        notifyDataChange()
        return {
          id: localId,
          title: localFile.name,
          source_type: 'local-folder',
          relative_path: localFile.relative_path,
          etag: buildLocalEtagFromFile(localFile),
          message: tools.createNote.success,
        }
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.createNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}

export function buildUpdateNoteTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
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
        after: {
          type: 'string',
          description: tools.updateNote.afterDesc
        },
        before: {
          type: 'string',
          description: tools.updateNote.beforeDesc
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
        },
        if_match: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: tools.updateNote.ifMatchDesc
        } as unknown as AppJsonSchemaProperty
      },
      required: ['id']
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const id = args.id as string
        const ifMatch = args.if_match
        const title = args.title as string | undefined
        const content = args.content as string | undefined
        const append = args.append as string | undefined
        const prepend = args.prepend as string | undefined
        const after = args.after as string | undefined
        const before = args.before as string | undefined
        const edit = args.edit as { old_string: string; new_string: string; replace_all?: boolean } | undefined

        const resolved = resolveNoteResource(id)
        if (!resolved.ok) {
          throw new ToolError(`${tools.updateNote.notFound}: ${id}`)
        }

        if (after && !append) {
          throw new ToolError(tools.updateNote.afterRequiresAppend)
        }
        if (before && !prepend) {
          throw new ToolError(tools.updateNote.beforeRequiresPrepend)
        }

        const mutationResult = buildUpdatedNoteContent(
          resolved.resource.sourceType === 'internal'
            ? resolved.resource.note.content
            : resolved.resource.file.tiptap_content,
          { content, append, prepend, after, before, edit },
          {
            anchorNotFound: tools.updateNote.anchorNotFound,
            editNotFound: tools.updateNote.editNotFound,
            editSimilarFound: tools.updateNote.editSimilarFound,
            editEmptyString: tools.updateNote.editEmptyString,
            editMultipleFound: tools.updateNote.editMultipleFound,
          }
        )

        if (resolved.resource.sourceType === 'internal') {
          const note = resolved.resource.note
          const ifMatchCheck = resolveIfMatchForInternal(note, ifMatch)
          const ifMatchError = mapIfMatchCheckError(
            ifMatchCheck,
            tools.updateNote.invalidIfMatch,
            tools.updateNote.ifMatchMismatch
          )
          if (ifMatchError) {
            throw new ToolError(ifMatchError)
          }

          const updates: Partial<NoteInput> = {}
          if (title !== undefined) updates.title = title
          if (mutationResult.changed && mutationResult.content !== undefined) {
            updates.content = mutationResult.content
          }

          if (Object.keys(updates).length === 0) {
            return {
              id: note.id,
              title: note.title,
              source_type: 'internal',
              revision: note.revision,
              etag: buildInternalEtag(note),
              message: tools.updateNote.noChanges,
            }
          }

          const expectedRevision = ifMatchCheck.ok && ifMatchCheck.expectedRevision !== undefined
            ? ifMatchCheck.expectedRevision
            : note.revision
          const updateResult = updateNoteSafe(note.id, updates, expectedRevision)
          if (updateResult.status === 'failed') {
            throw new ToolError(`${tools.updateNote.notFound}: ${id}`)
          }
          if (updateResult.status === 'conflict') {
            throw new ToolError(`${tools.updateNote.conflict} (${buildInternalEtag(updateResult.current)})`)
          }

          if (mutationResult.usedNormalizedEditMatch) {
            console.log('[update_note] Used normalized matching for edit operation')
          }

          if (updates.content !== undefined) {
            triggerIndexingForNote(updateResult.note.id, updateResult.note.notebook_id, updateResult.note.content)
          }
          notifyDataChange()
          return {
            id: updateResult.note.id,
            title: updateResult.note.title,
            source_type: 'internal',
            revision: updateResult.note.revision,
            etag: buildInternalEtag(updateResult.note),
            message: mutationResult.replacements
              ? tools.updateNote.editSuccess.replace('{count}', String(mutationResult.replacements))
              : tools.updateNote.success,
            ...(mutationResult.replacements !== undefined && { replacements: mutationResult.replacements }),
          }
        }

        const local = resolved.resource
        const previousCanonicalLocalIndexId = local.id
        const localIfMatchCheck = resolveIfMatchForLocal(
          {
            notebookId: local.file.notebook_id,
            relativePath: local.file.relative_path,
            mtimeMs: local.file.mtime_ms,
            size: local.file.size,
            contentHash: local.file.content_hash,
          },
          ifMatch
        )
        const localIfMatchError = mapIfMatchCheckError(
          localIfMatchCheck,
          tools.updateNote.invalidIfMatch,
          tools.updateNote.ifMatchMismatch
        )
        if (localIfMatchError) {
          throw new ToolError(localIfMatchError)
        }
        if (
          localIfMatchCheck.ok
          && isLocalIfMatchStale(
            {
              size: local.file.size,
              mtimeMs: local.file.mtime_ms,
              contentHash: local.file.content_hash,
            },
            localIfMatchCheck
          )
        ) {
          throw new ToolError(tools.updateNote.conflict)
        }

        let nextRelativePath = local.file.relative_path
        if (title !== undefined) {
          const renameResult = renameLocalFolderEntry(local.mount, {
            notebook_id: local.file.notebook_id,
            relative_path: local.file.relative_path,
            kind: 'file',
            new_name: title,
          })
          if (!renameResult.success) {
            throw new ToolError(mapLocalToolErrorCode(renameResult.errorCode, {
              notFound: `${tools.updateNote.notFound}: ${id}`,
              conflict: tools.updateNote.conflict,
              invalidName: tools.updateNote.localInvalidName,
              accessDenied: tools.updateNote.localAccessDenied,
              writeFailed: tools.updateNote.localWriteFailed,
              alreadyExists: tools.updateNote.localFileAlreadyExists,
            }))
          }
          nextRelativePath = renameResult.result.relative_path
          if (nextRelativePath !== local.file.relative_path) {
            migrateLocalNoteMetadataPath(local.file.notebook_id, local.file.relative_path, nextRelativePath)
          }
        }

        const rollbackLocalRenameIfNeeded = (): boolean => {
          if (!(title !== undefined && nextRelativePath !== local.file.relative_path)) {
            return true
          }
          const rollbackResult = renameLocalFolderEntry(local.mount, {
            notebook_id: local.file.notebook_id,
            relative_path: nextRelativePath,
            kind: 'file',
            new_name: `${local.file.name}.${local.file.extension}`,
          })
          if (!rollbackResult.success) {
            return false
          }
          migrateLocalNoteMetadataPath(local.file.notebook_id, nextRelativePath, local.file.relative_path)
          nextRelativePath = rollbackResult.result.relative_path
          return true
        }

        if (mutationResult.changed && mutationResult.content !== undefined) {
          const expectedMtimeMs = localIfMatchCheck.ok && localIfMatchCheck.expectedMtimeMs !== undefined
            ? localIfMatchCheck.expectedMtimeMs
            : local.file.mtime_ms
          const expectedSize = localIfMatchCheck.ok && localIfMatchCheck.expectedSize !== undefined
            ? localIfMatchCheck.expectedSize
            : local.file.size
          const expectedContentHash = localIfMatchCheck.ok && localIfMatchCheck.expectedContentHash !== undefined
            ? localIfMatchCheck.expectedContentHash
            : local.file.content_hash
          const saveResult = saveLocalFolderFile(local.mount, nextRelativePath, mutationResult.content, {
            expectedMtimeMs,
            expectedSize,
            expectedContentHash,
          })
          if (!saveResult.success) {
            if (!rollbackLocalRenameIfNeeded()) {
              throw new ToolError(tools.updateNote.localRollbackFailed)
            }
            if (saveResult.errorCode === 'LOCAL_FILE_CONFLICT') {
              const conflictEtag = buildLocalEtag({
                notebookId: local.file.notebook_id,
                relativePath: nextRelativePath,
                mtimeMs: saveResult.conflict.mtime_ms,
                size: saveResult.conflict.size,
                contentHash: saveResult.conflict.content_hash,
              })
              throw new ToolError(`${tools.updateNote.conflict} (${conflictEtag})`)
            }
            throw new ToolError(mapLocalToolErrorCode(saveResult.errorCode, {
              notFound: `${tools.updateNote.notFound}: ${id}`,
              conflict: tools.updateNote.conflict,
              invalidName: tools.updateNote.localInvalidName,
              accessDenied: tools.updateNote.localAccessDenied,
              writeFailed: tools.updateNote.localWriteFailed,
              alreadyExists: tools.updateNote.localFileAlreadyExists,
              tooLarge: tools.updateNote.localTooLarge,
            }))
          }
        }

        const titleChanged = title !== undefined && nextRelativePath !== local.file.relative_path
        const contentChanged = mutationResult.changed && mutationResult.content !== undefined
        if (!titleChanged && !contentChanged) {
          return {
            id: buildCanonicalLocalResourceId({ notebookId: local.file.notebook_id, relativePath: local.file.relative_path }),
            title: local.file.name,
            source_type: 'local-folder',
            relative_path: local.file.relative_path,
            etag: local.etag,
            message: tools.updateNote.noChanges,
          }
        }

        if (mutationResult.usedNormalizedEditMatch) {
          console.log('[update_note] Used normalized matching for edit operation')
        }

        const finalRead = readLocalFolderFile(local.mount, nextRelativePath)
        if (!finalRead.success) {
          throw new ToolError(mapLocalToolErrorCode(finalRead.errorCode, {
            notFound: `${tools.updateNote.notFound}: ${id}`,
            conflict: tools.updateNote.conflict,
            invalidName: tools.updateNote.localInvalidName,
            accessDenied: tools.updateNote.localAccessDenied,
            writeFailed: tools.updateNote.localWriteFailed,
            alreadyExists: tools.updateNote.localFileAlreadyExists,
            tooLarge: tools.updateNote.localTooLarge,
          }))
        }

        const nextFile = finalRead.result
        ensureLocalNoteIdentityForPath(nextFile.notebook_id, nextFile.relative_path)
        syncLocalNoteDerivedState(nextFile.notebook_id, nextFile.relative_path, nextFile.tiptap_content)
        const nextLocalId = buildCanonicalLocalResourceId({ notebookId: nextFile.notebook_id, relativePath: nextFile.relative_path })
        const nextCanonicalLocalIndexId = nextLocalId
        const previousLegacyLocalIndexId = createLocalResourceId(local.file.notebook_id, local.file.relative_path)
        const nextLegacyLocalIndexId = createLocalResourceId(nextFile.notebook_id, nextFile.relative_path)
        deleteIndexForNote(previousLegacyLocalIndexId)
        if (nextLegacyLocalIndexId !== previousLegacyLocalIndexId) {
          deleteIndexForNote(nextLegacyLocalIndexId)
        }
        if (previousCanonicalLocalIndexId !== nextCanonicalLocalIndexId) {
          deleteIndexForNote(previousCanonicalLocalIndexId)
        }
        if (contentChanged || titleChanged || nextCanonicalLocalIndexId !== previousCanonicalLocalIndexId) {
          triggerIndexingForNote(nextCanonicalLocalIndexId, nextFile.notebook_id, nextFile.tiptap_content)
        }
        notifyDataChange()
        return {
          id: nextLocalId,
          title: nextFile.name,
          source_type: 'local-folder',
          relative_path: nextFile.relative_path,
          etag: buildLocalEtagFromFile(nextFile),
          message: mutationResult.replacements
            ? tools.updateNote.editSuccess.replace('{count}', String(mutationResult.replacements))
            : tools.updateNote.success,
          ...(mutationResult.replacements !== undefined && { replacements: mutationResult.replacements }),
        }
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.updateNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}

export function buildDeleteNoteTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
    name: 'delete_note',
    description: tools.deleteNote.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: tools.deleteNote.idDesc
        },
        if_match: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: tools.deleteNote.ifMatchDesc
        } as unknown as AppJsonSchemaProperty
      },
      required: ['id']
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const id = args.id as string
        const ifMatch = args.if_match
        const resolved = resolveNoteResource(id)
        if (!resolved.ok) {
          throw new ToolError(`${tools.deleteNote.notFound}: ${id}`)
        }

        if (resolved.resource.sourceType === 'internal') {
          const note = resolved.resource.note
          const ifMatchCheck = resolveIfMatchForInternal(note, ifMatch)
          const ifMatchError = mapIfMatchCheckError(
            ifMatchCheck,
            tools.deleteNote.invalidIfMatch,
            tools.deleteNote.ifMatchMismatch
          )
          if (ifMatchError) {
            throw new ToolError(ifMatchError)
          }
          if (ifMatchCheck.ok && ifMatchCheck.expectedRevision !== undefined && ifMatchCheck.expectedRevision !== note.revision) {
            throw new ToolError(tools.deleteNote.ifMatchMismatch)
          }

          const success = deleteNote(note.id)
          if (!success) {
            throw new ToolError(`${tools.deleteNote.notFound}: ${id}`)
          }
          deleteIndexForNote(note.id)
          notifyDataChange()
          return {
            id: note.id,
            source_type: 'internal',
            message: tools.deleteNote.success,
          }
        }

        const local = resolved.resource
        const localIdentity = getLocalNoteIdentityByPath({
          notebook_id: local.file.notebook_id,
          relative_path: local.file.relative_path,
        })
        const canonicalLocalId = localIdentity?.note_uid || local.id
        const indexIdsToDelete = new Set<string>([
          id,
          local.id,
          canonicalLocalId,
          createLocalResourceId(local.file.notebook_id, local.file.relative_path),
        ])
        if (localIdentity?.note_uid) {
          indexIdsToDelete.add(localIdentity.note_uid)
        }
        const localIfMatch = resolveIfMatchForLocal(
          {
            notebookId: local.file.notebook_id,
            relativePath: local.file.relative_path,
            mtimeMs: local.file.mtime_ms,
            size: local.file.size,
            contentHash: local.file.content_hash,
          },
          ifMatch
        )
        const localIfMatchError = mapIfMatchCheckError(
          localIfMatch,
          tools.deleteNote.invalidIfMatch,
          tools.deleteNote.ifMatchMismatch
        )
        if (localIfMatchError) {
          throw new ToolError(localIfMatchError)
        }
        if (
          localIfMatch.ok
          && isLocalIfMatchStale(
            {
              size: local.file.size,
              mtimeMs: local.file.mtime_ms,
              contentHash: local.file.content_hash,
            },
            localIfMatch
          )
        ) {
          throw new ToolError(tools.deleteNote.ifMatchMismatch)
        }

        const deleteResult = await trashLocalFile(local.mount, {
          notebookId: local.file.notebook_id,
          relativePath: local.file.relative_path,
        })
        if (!deleteResult.ok) {
          if (deleteResult.reason === 'resolve_failed') {
            throw new ToolError(mapLocalToolErrorCode(deleteResult.errorCode, {
              notFound: `${tools.deleteNote.notFound}: ${id}`,
              conflict: tools.deleteNote.localDeleteFailed,
              invalidName: tools.deleteNote.localDeleteFailed,
              accessDenied: tools.deleteNote.localAccessDenied,
              writeFailed: tools.deleteNote.localDeleteFailed,
            }))
          }
          throw new ToolError(tools.deleteNote.localDeleteFailed)
        }

        cleanupLocalNoteMetadata(local.file.notebook_id, local.file.relative_path, 'file')
        for (const indexId of indexIdsToDelete) {
          if (!indexId) continue
          deleteIndexForNote(indexId)
        }
        notifyDataChange()
        return {
          id: canonicalLocalId,
          source_type: 'local-folder',
          message: tools.deleteNote.success
        }
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.deleteNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}

export function buildMoveNoteTool(): AppToolDefinition {
  const tools = t().tools
  const common = t().common
  return {
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
        },
        if_match: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: tools.moveNote.ifMatchDesc
        } as unknown as AppJsonSchemaProperty
      },
      required: ['id']
    },
    handler: async (args: Record<string, unknown>) => {
      try {
        const id = args.id as string
        const ifMatch = args.if_match
        const notebook_id = (args.notebook_id as string | undefined) ?? null
        const resolved = resolveNoteResource(id)
        if (!resolved.ok) {
          throw new ToolError(`${tools.moveNote.notFound}: ${id}`)
        }

        if (resolved.resource.sourceType === 'internal') {
          const note = resolved.resource.note
          const ifMatchCheck = resolveIfMatchForInternal(note, ifMatch)
          const ifMatchError = mapIfMatchCheckError(
            ifMatchCheck,
            tools.moveNote.invalidIfMatch,
            tools.moveNote.ifMatchMismatch
          )
          if (ifMatchError) {
            throw new ToolError(ifMatchError)
          }

          if (ifMatchCheck.ok && ifMatchCheck.expectedRevision !== undefined && ifMatchCheck.expectedRevision !== note.revision) {
            throw new ToolError(tools.moveNote.ifMatchMismatch)
          }

          const result = dbMoveNote(note.id, notebook_id)
          if (!result.ok) {
            if (result.error === 'target_not_allowed') {
              throw new ToolError(tools.moveNote.targetNotAllowed)
            }
            if (result.error === 'notebook_not_found') {
              throw new ToolError(`${tools.moveNote.notebookNotFound}: ${notebook_id}`)
            }
            throw new ToolError(`${tools.moveNote.notFound}: ${id}`)
          }
          const moved = getNoteById(note.id)
          syncIndexedNotebookForNote(note.id, notebook_id)
          notifyDataChange()

          return {
            id: note.id,
            source_type: 'internal',
            revision: moved?.revision,
            etag: moved ? buildInternalEtag(moved) : undefined,
            message: tools.moveNote.success
          }
        }

        const local = resolved.resource
        const previousCanonicalLocalId = local.id
        const localIfMatchCheck = resolveIfMatchForLocal(
          {
            notebookId: local.file.notebook_id,
            relativePath: local.file.relative_path,
            mtimeMs: local.file.mtime_ms,
            size: local.file.size,
            contentHash: local.file.content_hash,
          },
          ifMatch
        )
        const localIfMatchError = mapIfMatchCheckError(
          localIfMatchCheck,
          tools.moveNote.invalidIfMatch,
          tools.moveNote.ifMatchMismatch
        )
        if (localIfMatchError) {
          throw new ToolError(localIfMatchError)
        }
        if (
          localIfMatchCheck.ok
          && isLocalIfMatchStale(
            {
              size: local.file.size,
              mtimeMs: local.file.mtime_ms,
              contentHash: local.file.content_hash,
            },
            localIfMatchCheck
          )
        ) {
          throw new ToolError(tools.moveNote.ifMatchMismatch)
        }

        if (notebook_id === null || notebook_id === undefined) {
          throw new ToolError(tools.moveNote.targetNotAllowed)
        }

        const targetNotebook = getNotebooks().find((item) => item.id === notebook_id)
        if (!targetNotebook) {
          throw new ToolError(`${tools.moveNote.notebookNotFound}: ${notebook_id}`)
        }
        if ((targetNotebook.source_type || 'internal') !== 'local-folder') {
          throw new ToolError(tools.moveNote.targetNotAllowed)
        }

        if (targetNotebook.id === local.file.notebook_id) {
          return {
            id: buildCanonicalLocalResourceId({ notebookId: local.file.notebook_id, relativePath: local.file.relative_path }),
            source_type: 'local-folder',
            relative_path: local.file.relative_path,
            etag: local.etag,
            message: tools.moveNote.success,
          }
        }

        const targetMount = getActiveLocalMountByNotebookId(targetNotebook.id)
        if (!targetMount) {
          throw new ToolError(tools.moveNote.localNotebookUnavailable)
        }

        const sourceCurrent = readLocalFolderFile(local.mount, local.file.relative_path)
        if (!sourceCurrent.success) {
          throw new ToolError(mapLocalToolErrorCode(sourceCurrent.errorCode, {
            notFound: `${tools.moveNote.notFound}: ${id}`,
            conflict: tools.moveNote.ifMatchMismatch,
            invalidName: tools.moveNote.ifMatchMismatch,
            accessDenied: tools.moveNote.localAccessDenied,
            writeFailed: tools.moveNote.localWriteFailed,
            tooLarge: tools.moveNote.localTooLarge,
          }))
        }

        const sourceFile = sourceCurrent.result
        const sourceIfMatchCheck = resolveIfMatchForLocal(
          {
            notebookId: sourceFile.notebook_id,
            relativePath: sourceFile.relative_path,
            mtimeMs: sourceFile.mtime_ms,
            size: sourceFile.size,
            contentHash: sourceFile.content_hash,
          },
          ifMatch
        )
        const sourceIfMatchError = mapIfMatchCheckError(
          sourceIfMatchCheck,
          tools.moveNote.invalidIfMatch,
          tools.moveNote.ifMatchMismatch
        )
        if (sourceIfMatchError) {
          throw new ToolError(sourceIfMatchError)
        }
        if (
          sourceIfMatchCheck.ok
          && isLocalIfMatchStale(
            {
              size: sourceFile.size,
              mtimeMs: sourceFile.mtime_ms,
              contentHash: sourceFile.content_hash,
            },
            sourceIfMatchCheck
          )
        ) {
          throw new ToolError(tools.moveNote.ifMatchMismatch)
        }

        const fileName = `${sourceFile.name}.${sourceFile.extension}`
        const created = createLocalFolderFile(targetMount, null, fileName)
        if (!created.success) {
          throw new ToolError(mapLocalToolErrorCode(created.errorCode, {
            notFound: tools.moveNote.localNotebookUnavailable,
            conflict: tools.moveNote.localFileAlreadyExists,
            invalidName: tools.moveNote.localInvalidName,
            accessDenied: tools.moveNote.localAccessDenied,
            writeFailed: tools.moveNote.localWriteFailed,
            alreadyExists: tools.moveNote.localFileAlreadyExists,
          }))
        }

        const targetRelativePath = created.result.relative_path
        const rollbackCopiedTarget = (): Promise<boolean> => rollbackLocalFile(
          targetMount,
          {
            notebookId: targetNotebook.id,
            relativePath: targetRelativePath,
          }
        )

        const saveCopied = saveLocalFolderFile(targetMount, targetRelativePath, sourceFile.tiptap_content, { force: true })
        if (!saveCopied.success) {
          const rollbackOk = await rollbackCopiedTarget()
          if (!rollbackOk) {
            throw new ToolError(tools.moveNote.localRollbackFailed)
          }
          throw new ToolError(mapLocalToolErrorCode(saveCopied.errorCode, {
            notFound: tools.moveNote.localNotebookUnavailable,
            conflict: tools.moveNote.localConflict,
            invalidName: tools.moveNote.localInvalidName,
            accessDenied: tools.moveNote.localAccessDenied,
            writeFailed: tools.moveNote.localWriteFailed,
            alreadyExists: tools.moveNote.localFileAlreadyExists,
            tooLarge: tools.moveNote.localTooLarge,
          }))
        }

        const sourceBeforeDelete = readLocalFolderFile(local.mount, sourceFile.relative_path)
        if (!sourceBeforeDelete.success) {
          const rollbackOk = await rollbackCopiedTarget()
          if (!rollbackOk) {
            throw new ToolError(tools.moveNote.localRollbackFailed)
          }
          if (sourceBeforeDelete.errorCode === 'LOCAL_FILE_UNREADABLE' || sourceBeforeDelete.errorCode === 'LOCAL_FILE_OUT_OF_ROOT') {
            throw new ToolError(tools.moveNote.localAccessDenied)
          }
          throw new ToolError(tools.moveNote.ifMatchMismatch)
        }
        if (isLocalIfMatchStale(
          {
            size: sourceBeforeDelete.result.size,
            mtimeMs: sourceBeforeDelete.result.mtime_ms,
            contentHash: sourceBeforeDelete.result.content_hash,
          },
          {
            expectedSize: sourceFile.size,
            expectedMtimeMs: sourceFile.mtime_ms,
            expectedContentHash: sourceFile.content_hash,
          }
        )) {
          const rollbackOk = await rollbackCopiedTarget()
          if (!rollbackOk) {
            throw new ToolError(tools.moveNote.localRollbackFailed)
          }
          throw new ToolError(tools.moveNote.ifMatchMismatch)
        }

        const deleteSourceResult = await trashLocalFile(local.mount, {
          notebookId: sourceBeforeDelete.result.notebook_id,
          relativePath: sourceBeforeDelete.result.relative_path,
        })
        if (!deleteSourceResult.ok) {
          const rollbackOk = await rollbackCopiedTarget()
          if (!rollbackOk) {
            throw new ToolError(tools.moveNote.localRollbackFailed)
          }
          if (deleteSourceResult.reason === 'resolve_failed') {
            if (deleteSourceResult.errorCode === 'LOCAL_FILE_NOT_FOUND' || deleteSourceResult.errorCode === 'LOCAL_FILE_NOT_A_FILE') {
              throw new ToolError(tools.moveNote.ifMatchMismatch)
            }
            throw new ToolError(mapLocalToolErrorCode(deleteSourceResult.errorCode, {
              notFound: tools.moveNote.ifMatchMismatch,
              conflict: tools.moveNote.localDeleteFailed,
              invalidName: tools.moveNote.localDeleteFailed,
              accessDenied: tools.moveNote.localAccessDenied,
              writeFailed: tools.moveNote.localDeleteFailed,
            }))
          }
          throw new ToolError(tools.moveNote.localDeleteFailed)
        }

        try {
          const sourceMetadata = getLocalNoteMetadata({
            notebook_id: sourceBeforeDelete.result.notebook_id,
            relative_path: sourceBeforeDelete.result.relative_path,
          })
          if (sourceMetadata) {
            const preserved = updateLocalNoteMetadata({
              notebook_id: targetNotebook.id,
              relative_path: targetRelativePath,
              is_favorite: sourceMetadata.is_favorite,
              is_pinned: sourceMetadata.is_pinned,
              ai_summary: sourceMetadata.ai_summary,
              tags: sourceMetadata.tags || null,
            })
            if (!preserved) {
              console.warn(
                '[SanqianSDK] failed to preserve local note metadata on target:',
                targetNotebook.id,
                targetRelativePath
              )
            }
          }
          moveLocalNoteIdentityAcrossNotebooks(
            sourceBeforeDelete.result.notebook_id,
            sourceBeforeDelete.result.relative_path,
            targetNotebook.id,
            targetRelativePath
          )
          cleanupLocalNoteMetadata(
            sourceBeforeDelete.result.notebook_id,
            sourceBeforeDelete.result.relative_path,
            'file'
          )
        } catch (error) {
          console.warn('[SanqianSDK] local note metadata migration failed:', error)
        }

        const copied = readLocalFolderFile(targetMount, targetRelativePath)
        if (!copied.success) {
          throw new ToolError(mapLocalToolErrorCode(copied.errorCode, {
            notFound: tools.moveNote.localWriteFailed,
            conflict: tools.moveNote.localConflict,
            invalidName: tools.moveNote.localInvalidName,
            accessDenied: tools.moveNote.localAccessDenied,
            writeFailed: tools.moveNote.localWriteFailed,
            tooLarge: tools.moveNote.localTooLarge,
          }))
        }

        ensureLocalNoteIdentityForPath(copied.result.notebook_id, copied.result.relative_path)
        syncLocalNoteDerivedState(copied.result.notebook_id, copied.result.relative_path, copied.result.tiptap_content)
        const copiedLocalId = buildCanonicalLocalResourceId({ notebookId: copied.result.notebook_id, relativePath: copied.result.relative_path })
        const previousLegacyLocalId = createLocalResourceId(local.file.notebook_id, local.file.relative_path)
        const copiedLegacyLocalId = createLocalResourceId(copied.result.notebook_id, copied.result.relative_path)
        if (previousCanonicalLocalId !== copiedLocalId) {
          deleteIndexForNote(previousCanonicalLocalId)
        }
        deleteIndexForNote(previousLegacyLocalId)
        if (copiedLegacyLocalId !== previousLegacyLocalId) {
          deleteIndexForNote(copiedLegacyLocalId)
        }
        syncIndexedNotebookForNote(copiedLocalId, copied.result.notebook_id)
        triggerIndexingForNote(
          copiedLocalId,
          copied.result.notebook_id,
          copied.result.tiptap_content
        )
        notifyDataChange()

        return {
          id: copiedLocalId,
          source_type: 'local-folder',
          relative_path: copied.result.relative_path,
          etag: buildLocalEtagFromFile(copied.result),
          message: tools.moveNote.success
        }
      } catch (error) {
        if (error instanceof ToolError) throw error
        throw new Error(`${tools.moveNote.error}: ${error instanceof Error ? error.message : common.unknownError}`)
      }
    }
  }
}
