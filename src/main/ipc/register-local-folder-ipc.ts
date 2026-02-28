import type { IpcMain } from 'electron'
import { basename, resolve, sep } from 'path'
import { promises as fsPromises } from 'fs'
import { normalizeComparablePathForFileSystem } from '../path-compat'
import { createSafeHandler } from './safe-handler'
import type { IfMatchCheckResult } from '../note-gateway'
import type {
  LocalFolderAffectedMount,
  LocalFolderAnalyzeDeleteResponse,
  LocalFolderCreateFileInput,
  LocalFolderCreateFileResponse,
  LocalFolderCreateFolderInput,
  LocalFolderCreateFolderResponse,
  LocalFolderDeleteEntryInput,
  LocalFolderDeleteEntryResponse,
  LocalFolderNotebookMount,
  LocalFolderReadFileInput,
  LocalFolderReadFileResponse,
  LocalFolderRenameEntryInput,
  LocalFolderRenameEntryResponse,
  LocalFolderListNoteMetadataResponse,
  LocalFolderUpdateNoteMetadataInput,
  LocalFolderUpdateNoteMetadataResponse,
  LocalFolderSaveFileInput,
  LocalFolderSaveFileResponse,
  LocalFolderFileErrorCode,
  LocalFolderMountErrorCode,
  LocalFolderMountInput,
  LocalFolderMountResponse,
  LocalFolderRelinkInput,
  LocalFolderRelinkResponse,
  LocalFolderTreeResult,
  NotebookStatus,
} from '../../shared/types'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

// --- Helper functions (moved from index.ts, only used by local folder IPC) ---

async function canonicalizeLocalFolderPathAsync(rootPath: string): Promise<{ ok: true; canonicalPath: string } | { ok: false; errorCode: LocalFolderMountErrorCode }> {
  const trimmedPath = rootPath.trim()
  if (!trimmedPath) {
    return { ok: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
  }

  try {
    const absolutePath = resolve(trimmedPath)
    const realPath = await fsPromises.realpath(absolutePath)
    const stat = await fsPromises.stat(realPath)
    if (!stat.isDirectory()) {
      return { ok: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }
    const canonicalPath = normalizeComparablePathForFileSystem(realPath, realPath)

    return { ok: true, canonicalPath }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, errorCode: 'LOCAL_MOUNT_PATH_PERMISSION_DENIED' }
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, errorCode: 'LOCAL_MOUNT_PATH_NOT_FOUND' }
    }
    return { ok: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
  }
}

function isSameOrChildPath(targetPath: string, candidatePath: string): boolean {
  if (candidatePath === targetPath) return true
  const prefix = targetPath.endsWith(sep) ? targetPath : `${targetPath}${sep}`
  return candidatePath.startsWith(prefix)
}

export interface LocalFolderIpcDeps {
  // Mount queries
  getLocalFolderMounts: () => LocalFolderNotebookMount[]
  getLocalFolderMountByCanonicalPath: (
    canonicalPath: string,
    options: { activeOnly?: boolean; excludeNotebookId?: string }
  ) => { notebook_id: string } | null
  getLocalFolderMountByNotebookId: (notebookId: string) => { root_path: string } | null
  // Mount mutations
  createLocalFolderNotebookMount: (input: {
    name: string
    icon?: string
    root_path: string
    canonical_root_path: string
    status?: NotebookStatus
  }) => LocalFolderNotebookMount
  updateLocalFolderMountRoot: (input: {
    notebook_id: string
    root_path: string
    canonical_root_path: string
    status?: NotebookStatus
  }) => unknown
  updateLocalFolderMountStatus: (notebookId: string, status: NotebookStatus) => void
  // File operations (async versions -- avoid blocking main process)
  readLocalFolderFileAsync: (mount: LocalFolderNotebookMount, relativePath: string) => Promise<LocalFolderReadFileResponse>
  saveLocalFolderFileAsync: (
    mount: LocalFolderNotebookMount,
    relativePath: string,
    tiptapContent: string,
    options?: {
      expectedMtimeMs?: number
      expectedSize?: number
      expectedContentHash?: string
      force?: boolean
    }
  ) => Promise<LocalFolderSaveFileResponse>
  createLocalFolderFileAsync: (mount: LocalFolderNotebookMount, parentRelativePath: string | null, fileName: string) => Promise<LocalFolderCreateFileResponse>
  createLocalFolderAsync: (mount: LocalFolderNotebookMount, parentRelativePath: string | null, folderName: string) => Promise<LocalFolderCreateFolderResponse>
  renameLocalFolderEntryAsync: (mount: LocalFolderNotebookMount, input: LocalFolderRenameEntryInput) => Promise<LocalFolderRenameEntryResponse>
  resolveLocalFolderDeleteTargetAsync: (mount: LocalFolderNotebookMount, input: LocalFolderDeleteEntryInput) => Promise<{
    success: true
    result: { absolute_path: string; relative_path: string }
  } | { success: false; errorCode: LocalFolderFileErrorCode }>
  resolveLocalFolderFilePathAsync: (mount: LocalFolderNotebookMount, relativePath: string) => Promise<{
    success: true
    relative_path: string
  } | { success: false; errorCode: LocalFolderFileErrorCode }>
  // File operations (sync versions -- for non-IPC callers that need sync)
  readLocalFolderFile: (mount: LocalFolderNotebookMount, relativePath: string) => LocalFolderReadFileResponse
  // Note identity
  ensureLocalNoteIdentity: (input: { notebook_id: string; relative_path: string }) => void
  renameLocalNoteIdentityPath: (input: { notebook_id: string; from_relative_path: string; to_relative_path: string }) => void
  renameLocalNoteIdentityFolderPath: (input: { notebook_id: string; from_relative_folder_path: string; to_relative_folder_path: string }) => void
  deleteLocalNoteIdentityByPath: (input: { notebook_id: string; relative_path: string; kind: 'file' | 'folder' }) => void
  getLocalNoteIdentityByPath: (input: { notebook_id: string; relative_path: string }) => { note_uid: string } | null
  // Note metadata
  listLocalNoteMetadata: (options: { notebookIds?: string[] }) => unknown
  updateLocalNoteMetadata: (input: {
    notebook_id: string
    relative_path: string
    is_favorite?: boolean
    is_pinned?: boolean
    ai_summary?: string | null
    summary_content_hash?: string | null
    tags?: string[] | null
    ai_tags?: string[] | null
  }) => unknown
  renameLocalNoteMetadataPath: (input: { notebook_id: string; from_relative_path: string; to_relative_path: string }) => void
  renameLocalNoteMetadataFolderPath: (input: { notebook_id: string; from_relative_folder_path: string; to_relative_folder_path: string }) => void
  deleteLocalNoteMetadataByPath: (input: { notebook_id: string; relative_path: string; kind: 'file' | 'folder' }) => void
  // Etag
  buildLocalEtag: (input: { notebookId: string; relativePath: string; mtimeMs: number; size: number; contentHash?: string }) => string
  resolveIfMatchForLocal: (
    current: { notebookId: string; relativePath: string; mtimeMs: number; size: number; contentHash?: string },
    ifMatch: unknown
  ) => IfMatchCheckResult
  normalizeLocalRelativePathForEtag: (relativePath: string) => string
  // Index
  resolveLocalIndexNoteId: (notebookId: string, relativePath: string) => string
  deleteLegacyLocalIndexByPath: (notebookId: string, relativePath: string) => void
  deleteIndexedLocalNotesByNotebook: (notebookId: string) => void
  deleteIndexForLocalPath: (notebookId: string, relativePath: string, options?: { noteUid?: string | null }) => void
  syncLocalNoteTagsMetadata: (notebookId: string, relativePath: string, tiptapContent: string) => void
  syncLocalNotePopupRefs: (notebookId: string, relativePath: string, tiptapContent: string) => void
  enqueueLocalNotebookIndexSync: (notebookId: string, options: { full?: boolean; immediate?: boolean; changedRelativePath?: string }) => void
  clearLocalNotebookIndexSyncForNotebook: (notebookId: string) => void
  checkAndIndex: (noteId: string, notebookId: string, tiptapContent: string, options?: { ftsOnly?: boolean; fileMtimeMs?: number }) => Promise<unknown>
  // Tree cache
  scanAndCacheLocalFolderTree: (mount: LocalFolderNotebookMount) => LocalFolderTreeResult
  scanAndCacheLocalFolderTreeAsync: (mount: LocalFolderNotebookMount) => Promise<LocalFolderTreeResult>
  invalidateLocalFolderTreeCache: (notebookId: string) => void
  // Watcher
  ensureLocalFolderWatcher: (notebookId: string, rootPath: string) => void
  stopLocalFolderWatcher: (notebookId: string, options?: { clearPendingEvent?: boolean }) => void
  syncLocalFolderWatchers: () => void
  scheduleLocalFolderWatchEvent: (event: {
    notebook_id: string
    status: NotebookStatus
    reason?: 'status_changed' | 'content_changed' | 'rescan_required'
    changed_relative_path: string | null
  }) => void
  resolveMountStatusFromFsError: (error: unknown) => NotebookStatus
  // Shell
  trashItem: (path: string) => Promise<void>
  openPath: (path: string) => Promise<string>
  // Notebook
  deleteNotebook: (notebookId: string) => boolean
}

export function registerLocalFolderIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: LocalFolderIpcDeps
): void {
  async function analyzeLocalFolderDeleteImpact(
    sourceNotebookId: string,
    targetAbsolutePath: string,
    kind: 'file' | 'folder'
  ): Promise<LocalFolderAffectedMount[]> {
    if (kind !== 'folder') return []

    const canonicalTarget = await canonicalizeLocalFolderPathAsync(targetAbsolutePath)
    if (!canonicalTarget.ok) return []
    const targetPath = normalizeComparablePathForFileSystem(
      canonicalTarget.canonicalPath,
      canonicalTarget.canonicalPath
    )

    const affected: LocalFolderAffectedMount[] = []
    for (const mount of deps.getLocalFolderMounts()) {
      if (mount.notebook.id === sourceNotebookId) continue
      if (mount.mount.status !== 'active') continue
      const mountCanonical = mount.mount.canonical_root_path
        ? normalizeComparablePathForFileSystem(mount.mount.canonical_root_path, mount.mount.canonical_root_path)
        : null
      if (mountCanonical && isSameOrChildPath(targetPath, mountCanonical)) {
        affected.push({
          notebook_id: mount.notebook.id,
          notebook_name: mount.notebook.name,
          root_path: mount.mount.root_path,
        })
      }
    }
    return affected
  }

  ipcMainLike.handle('localFolder:list', createSafeHandler('localFolder:list', () => deps.getLocalFolderMounts()))

  ipcMainLike.handle('localFolder:getTree', async (_, notebookId: string): Promise<LocalFolderTreeResult | null> => {
    const mounts = deps.getLocalFolderMounts()
    const mount = mounts.find((item) => item.notebook.id === notebookId)
    if (!mount) return null
    try {
      const tree = await deps.scanAndCacheLocalFolderTreeAsync(mount)
      if (mount.mount.status !== 'active') {
        deps.updateLocalFolderMountStatus(notebookId, 'active')
        deps.enqueueLocalNotebookIndexSync(notebookId, { full: true, immediate: true })
        deps.scheduleLocalFolderWatchEvent({
          notebook_id: notebookId,
          status: 'active',
          reason: 'status_changed',
          changed_relative_path: null,
        })
      }
      deps.ensureLocalFolderWatcher(notebookId, mount.mount.root_path)
      return tree
    } catch (error) {
      const nextStatus = deps.resolveMountStatusFromFsError(error)
      if (mount.mount.status !== nextStatus) {
        deps.updateLocalFolderMountStatus(notebookId, nextStatus)
        deps.enqueueLocalNotebookIndexSync(notebookId, { full: true, immediate: true })
        deps.scheduleLocalFolderWatchEvent({
          notebook_id: notebookId,
          status: nextStatus,
          reason: 'status_changed',
          changed_relative_path: null,
        })
      }
      deps.invalidateLocalFolderTreeCache(notebookId)
      deps.stopLocalFolderWatcher(notebookId, { clearPendingEvent: false })
      console.error('[localFolder:getTree] failed:', error)
      return null
    }
  })

  ipcMainLike.handle('localFolder:readFile', createSafeHandler('localFolder:readFile', async (_, input: LocalFolderReadFileInput): Promise<LocalFolderReadFileResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    const result = await deps.readLocalFolderFileAsync(mount, input.relative_path)
    if (!result.success) {
      return result as LocalFolderReadFileResponse
    }
    return {
      success: true,
      result: {
        ...result.result,
        etag: deps.buildLocalEtag({
          notebookId: result.result.notebook_id,
          relativePath: result.result.relative_path,
          mtimeMs: result.result.mtime_ms,
          size: result.result.size,
          contentHash: result.result.content_hash,
        }),
      },
    } as LocalFolderReadFileResponse
  }))

  ipcMainLike.handle('localFolder:saveFile', createSafeHandler('localFolder:saveFile', async (_, input: LocalFolderSaveFileInput): Promise<LocalFolderSaveFileResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    const normalizedRelativePath = deps.normalizeLocalRelativePathForEtag(input.relative_path)

    let expectedMtimeMs = input.expected_mtime_ms
    let expectedSize = input.expected_size
    let expectedContentHash = typeof input.expected_content_hash === 'string'
      ? input.expected_content_hash.toLowerCase()
      : undefined

    if (!input.force && input.if_match !== undefined && input.if_match !== null) {
      const current = await deps.readLocalFolderFileAsync(mount, input.relative_path)
      if (!current.success) {
        return current as LocalFolderSaveFileResponse
      }

      const ifMatchCheck = deps.resolveIfMatchForLocal(
        {
          notebookId: current.result.notebook_id,
          relativePath: current.result.relative_path,
          mtimeMs: current.result.mtime_ms,
          size: current.result.size,
          contentHash: current.result.content_hash,
        },
        input.if_match
      )
      if (!ifMatchCheck.ok) {
        if (ifMatchCheck.error === 'invalid_if_match') {
          return { success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
        }
        return {
          success: false,
          errorCode: 'LOCAL_FILE_CONFLICT',
          conflict: {
            size: current.result.size,
            mtime_ms: current.result.mtime_ms,
            content_hash: current.result.content_hash,
            etag: deps.buildLocalEtag({
              notebookId: current.result.notebook_id,
              relativePath: current.result.relative_path,
              mtimeMs: current.result.mtime_ms,
              size: current.result.size,
              contentHash: current.result.content_hash,
            }),
          },
        } as LocalFolderSaveFileResponse
      }

      expectedMtimeMs = ifMatchCheck.expectedMtimeMs
      expectedSize = ifMatchCheck.expectedSize
      expectedContentHash = ifMatchCheck.expectedContentHash || expectedContentHash
    }

    const result = await deps.saveLocalFolderFileAsync(mount, input.relative_path, input.tiptap_content, {
      expectedMtimeMs,
      expectedSize,
      expectedContentHash,
      force: input.force,
    })
    if (result.success) {
      deps.invalidateLocalFolderTreeCache(input.notebook_id)
      deps.ensureLocalNoteIdentity({
        notebook_id: input.notebook_id,
        relative_path: normalizedRelativePath,
      })
      try {
        deps.syncLocalNoteTagsMetadata(input.notebook_id, normalizedRelativePath, input.tiptap_content)
      } catch (error) {
        console.warn('[localFolder:saveFile] failed to sync local tags metadata:', normalizedRelativePath, error)
      }
      try {
        deps.syncLocalNotePopupRefs(input.notebook_id, normalizedRelativePath, input.tiptap_content)
      } catch (error) {
        console.warn('[localFolder:saveFile] failed to sync local popup refs:', normalizedRelativePath, error)
      }
      const localId = deps.resolveLocalIndexNoteId(input.notebook_id, normalizedRelativePath)
      deps.deleteLegacyLocalIndexByPath(input.notebook_id, normalizedRelativePath)
      deps.checkAndIndex(localId, input.notebook_id, input.tiptap_content, { ftsOnly: true, fileMtimeMs: result.result.mtime_ms }).catch((error) => {
        console.warn('[localFolder:saveFile] failed to index local note:', localId, error)
      })
      return {
        success: true,
        result: {
          ...result.result,
          etag: deps.buildLocalEtag({
            notebookId: input.notebook_id,
            relativePath: normalizedRelativePath,
            mtimeMs: result.result.mtime_ms,
            size: result.result.size,
            contentHash: result.result.content_hash,
          }),
        },
      } as LocalFolderSaveFileResponse
    }
    if (result.errorCode === 'LOCAL_FILE_CONFLICT' && result.conflict) {
      return {
        success: false,
        errorCode: 'LOCAL_FILE_CONFLICT',
        conflict: {
          ...result.conflict,
          etag: deps.buildLocalEtag({
            notebookId: input.notebook_id,
            relativePath: normalizedRelativePath,
            mtimeMs: result.conflict.mtime_ms,
            size: result.conflict.size,
            contentHash: result.conflict.content_hash,
          }),
        },
      } as LocalFolderSaveFileResponse
    }
    return result as LocalFolderSaveFileResponse
  }))

  ipcMainLike.handle('localFolder:createFile', createSafeHandler('localFolder:createFile', async (_, input: LocalFolderCreateFileInput): Promise<LocalFolderCreateFileResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    const result = await deps.createLocalFolderFileAsync(mount, input.parent_relative_path, input.file_name)
    if (result.success) {
      deps.invalidateLocalFolderTreeCache(input.notebook_id)
      deps.ensureLocalNoteIdentity({
        notebook_id: input.notebook_id,
        relative_path: result.result.relative_path,
      })
      deps.enqueueLocalNotebookIndexSync(input.notebook_id, {
        changedRelativePath: result.result.relative_path,
        immediate: true,
      })
    }
    return result
  }))

  ipcMainLike.handle('localFolder:createFolder', createSafeHandler('localFolder:createFolder', async (_, input: LocalFolderCreateFolderInput): Promise<LocalFolderCreateFolderResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }
    const result = await deps.createLocalFolderAsync(mount, input.parent_relative_path, input.folder_name)
    if (result.success) {
      deps.invalidateLocalFolderTreeCache(input.notebook_id)
    }
    return result
  }))

  ipcMainLike.handle('localFolder:renameEntry', createSafeHandler('localFolder:renameEntry', async (_, input: LocalFolderRenameEntryInput): Promise<LocalFolderRenameEntryResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }
    const result = await deps.renameLocalFolderEntryAsync(mount, input)
    if (result.success) {
      let metadataWarning: string | undefined
      try {
        if (input.kind === 'file') {
          deps.renameLocalNoteMetadataPath({
            notebook_id: input.notebook_id,
            from_relative_path: input.relative_path,
            to_relative_path: result.result.relative_path,
          })
          deps.renameLocalNoteIdentityPath({
            notebook_id: input.notebook_id,
            from_relative_path: input.relative_path,
            to_relative_path: result.result.relative_path,
          })
        } else {
          deps.renameLocalNoteMetadataFolderPath({
            notebook_id: input.notebook_id,
            from_relative_folder_path: input.relative_path,
            to_relative_folder_path: result.result.relative_path,
          })
          deps.renameLocalNoteIdentityFolderPath({
            notebook_id: input.notebook_id,
            from_relative_folder_path: input.relative_path,
            to_relative_folder_path: result.result.relative_path,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        metadataWarning = `metadata/identity migration failed: ${message}`
        console.warn('[localFolder:renameEntry]', metadataWarning)
      }
      if (metadataWarning) {
        result.metadataWarning = metadataWarning
      }
      deps.invalidateLocalFolderTreeCache(input.notebook_id)
      if (input.kind === 'file') {
        deps.deleteIndexForLocalPath(input.notebook_id, input.relative_path)
        deps.enqueueLocalNotebookIndexSync(input.notebook_id, {
          changedRelativePath: result.result.relative_path,
          immediate: true,
        })
      } else {
        deps.enqueueLocalNotebookIndexSync(input.notebook_id, {
          full: true,
          immediate: true,
        })
      }
    }
    return result
  }))

  ipcMainLike.handle(
    'localFolder:listNoteMetadata',
    (_, input?: { notebook_ids?: string[] }): LocalFolderListNoteMetadataResponse => {
      try {
        const notebookIds = Array.isArray(input?.notebook_ids)
          ? input.notebook_ids.map((id) => id.trim()).filter(Boolean)
          : undefined
        const items = deps.listLocalNoteMetadata({ notebookIds })
        return { success: true, result: { items } } as LocalFolderListNoteMetadataResponse
      } catch (error) {
        console.error('[localFolder:listNoteMetadata] failed:', error)
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
    }
  )

  ipcMainLike.handle(
    'localFolder:updateNoteMetadata',
    async (_, input: LocalFolderUpdateNoteMetadataInput): Promise<LocalFolderUpdateNoteMetadataResponse> => {
      const notebookId = input?.notebook_id?.trim() || ''
      const relativePath = input?.relative_path?.trim() || ''
      if (!notebookId || !relativePath) {
        return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
      }
      if (
        input.is_favorite === undefined
        && input.is_pinned === undefined
        && input.ai_summary === undefined
        && input.summary_content_hash === undefined
        && input.tags === undefined
        && input.ai_tags === undefined
      ) {
        return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      }

      const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === notebookId)
      if (!mount) {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      if (mount.mount.status === 'missing') {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      if (mount.mount.status === 'permission_required') {
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }

      const resolved = await deps.resolveLocalFolderFilePathAsync(mount, relativePath)
      if (!resolved.success) {
        return { success: false, errorCode: resolved.errorCode }
      }

      const updated = deps.updateLocalNoteMetadata({
        notebook_id: notebookId,
        relative_path: resolved.relative_path,
        is_favorite: input.is_favorite,
        is_pinned: input.is_pinned,
        ai_summary: input.ai_summary,
        summary_content_hash: input.summary_content_hash,
        tags: input.tags,
        ai_tags: input.ai_tags,
      })
      if (!updated) {
        return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      }
      return { success: true, result: updated } as LocalFolderUpdateNoteMetadataResponse
    }
  )

  ipcMainLike.handle('localFolder:analyzeDelete', createSafeHandler('localFolder:analyzeDelete', async (_, input: LocalFolderDeleteEntryInput): Promise<LocalFolderAnalyzeDeleteResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }

    const target = await deps.resolveLocalFolderDeleteTargetAsync(mount, input)
    if (!target.success) {
      return { success: false, errorCode: target.errorCode }
    }

    return {
      success: true,
      result: {
        affected_mounts: await analyzeLocalFolderDeleteImpact(input.notebook_id, target.result.absolute_path, input.kind),
      },
    }
  }))

  ipcMainLike.handle('localFolder:deleteEntry', async (_, input: LocalFolderDeleteEntryInput): Promise<LocalFolderDeleteEntryResponse> => {
    const mount = deps.getLocalFolderMounts().find((item) => item.notebook.id === input.notebook_id)
    if (!mount) {
      return {
        success: false,
        errorCode: input.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }

    const target = await deps.resolveLocalFolderDeleteTargetAsync(mount, input)
    if (!target.success) {
      return { success: false, errorCode: target.errorCode }
    }

    const deletedNoteUid = input.kind === 'file'
      ? (deps.getLocalNoteIdentityByPath({
        notebook_id: input.notebook_id,
        relative_path: target.result.relative_path,
      })?.note_uid || null)
      : null

    const affectedMounts = await analyzeLocalFolderDeleteImpact(input.notebook_id, target.result.absolute_path, input.kind)

    try {
      await deps.trashItem(target.result.absolute_path)
      if (input.kind === 'folder') {
        deps.deleteIndexedLocalNotesByNotebook(input.notebook_id)
      }
      try {
        deps.deleteLocalNoteMetadataByPath({
          notebook_id: input.notebook_id,
          relative_path: target.result.relative_path,
          kind: input.kind,
        })
        deps.deleteLocalNoteIdentityByPath({
          notebook_id: input.notebook_id,
          relative_path: target.result.relative_path,
          kind: input.kind,
        })
      } catch (error) {
        console.warn('[localFolder:deleteEntry] local note metadata/identity cleanup failed:', error)
      }
      deps.invalidateLocalFolderTreeCache(input.notebook_id)
      if (input.kind === 'file') {
        deps.deleteIndexForLocalPath(input.notebook_id, target.result.relative_path, {
          noteUid: deletedNoteUid,
        })
      } else {
        deps.enqueueLocalNotebookIndexSync(input.notebook_id, {
          full: true,
          immediate: true,
        })
      }
      if (affectedMounts.length > 0) {
        for (const affectedMount of affectedMounts) {
          deps.updateLocalFolderMountStatus(affectedMount.notebook_id, 'missing')
          deps.stopLocalFolderWatcher(affectedMount.notebook_id)
          deps.invalidateLocalFolderTreeCache(affectedMount.notebook_id)
          deps.enqueueLocalNotebookIndexSync(affectedMount.notebook_id, {
            full: true,
            immediate: true,
          })
          deps.scheduleLocalFolderWatchEvent({
            notebook_id: affectedMount.notebook_id,
            status: 'missing',
            reason: 'status_changed',
            changed_relative_path: null,
          })
        }
      }
      return {
        success: true,
        result: {
          affected_mounts: affectedMounts,
        },
      }
    } catch (error) {
      console.error('[localFolder:deleteEntry] failed:', error)
      return {
        success: false,
        errorCode: 'LOCAL_FILE_DELETE_FAILED',
      }
    }
  })

  ipcMainLike.handle('localFolder:selectRoot', createSafeHandler('localFolder:selectRoot', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  }))

  ipcMainLike.handle('localFolder:mount', async (_, input: LocalFolderMountInput): Promise<LocalFolderMountResponse> => {
    if (!input?.root_path || typeof input.root_path !== 'string') {
      return { success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }

    const canonical = await canonicalizeLocalFolderPathAsync(input.root_path)
    if (!canonical.ok) {
      return { success: false, errorCode: canonical.errorCode }
    }

    const existing = deps.getLocalFolderMountByCanonicalPath(canonical.canonicalPath, { activeOnly: true })
    if (existing) {
      return { success: false, errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' }
    }

    const rootPath = resolve(input.root_path.trim())
    const name = input.name?.trim() || basename(rootPath)

    try {
      const result = deps.createLocalFolderNotebookMount({
        name: name || 'Local Folder',
        icon: input.icon,
        root_path: rootPath,
        canonical_root_path: canonical.canonicalPath,
        status: 'active',
      })
      deps.syncLocalFolderWatchers()
      deps.enqueueLocalNotebookIndexSync(result.notebook.id, { full: true, immediate: true })
      return { success: true, result } as LocalFolderMountResponse
    } catch (error) {
      console.error('[localFolder:mount] failed:', error)
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return { success: false, errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' }
      }
      return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
    }
  })

  ipcMainLike.handle('localFolder:relink', async (_, input: LocalFolderRelinkInput): Promise<LocalFolderRelinkResponse> => {
    const notebookId = input?.notebook_id
    const nextRootPathInput = input?.root_path
    if (!notebookId) {
      return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
    }
    if (!nextRootPathInput || typeof nextRootPathInput !== 'string') {
      return { success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }

    const currentMount = deps.getLocalFolderMountByNotebookId(notebookId)
    if (!currentMount) {
      return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
    }

    const canonical = await canonicalizeLocalFolderPathAsync(nextRootPathInput)
    if (!canonical.ok) {
      return { success: false, errorCode: canonical.errorCode }
    }

    const duplicated = deps.getLocalFolderMountByCanonicalPath(canonical.canonicalPath, {
      excludeNotebookId: notebookId,
      activeOnly: true,
    })
    if (duplicated && duplicated.notebook_id !== notebookId) {
      return { success: false, errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' }
    }

    const nextRootPath = resolve(nextRootPathInput.trim())
    try {
      const updated = deps.updateLocalFolderMountRoot({
        notebook_id: notebookId,
        root_path: nextRootPath,
        canonical_root_path: canonical.canonicalPath,
        status: 'active',
      })
      if (!updated) {
        return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
      }
      deps.invalidateLocalFolderTreeCache(notebookId)
      deps.stopLocalFolderWatcher(notebookId)
      deps.syncLocalFolderWatchers()
      deps.enqueueLocalNotebookIndexSync(notebookId, { full: true, immediate: true })
      deps.scheduleLocalFolderWatchEvent({
        notebook_id: notebookId,
        status: 'active',
        reason: 'status_changed',
        changed_relative_path: null,
      })
      return { success: true, result: updated } as LocalFolderRelinkResponse
    } catch (error) {
      console.error('[localFolder:relink] failed:', error)
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return { success: false, errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' }
      }
      return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
    }
  })

  ipcMainLike.handle('localFolder:openInFileManager', async (_, notebookId: string): Promise<boolean> => {
    const mount = deps.getLocalFolderMountByNotebookId(notebookId)
    if (!mount) return false

    try {
      const result = await deps.openPath(mount.root_path)
      return result === ''
    } catch (error) {
      console.error('[localFolder:openInFileManager] failed:', error)
      return false
    }
  })

  ipcMainLike.handle('localFolder:unmount', createSafeHandler('localFolder:unmount', (_, notebookId: string) => {
    const mount = deps.getLocalFolderMountByNotebookId(notebookId)
    if (!mount) return false
    const deleted = deps.deleteNotebook(notebookId)
    if (deleted) {
      deps.clearLocalNotebookIndexSyncForNotebook(notebookId)
      deps.deleteIndexedLocalNotesByNotebook(notebookId)
      deps.invalidateLocalFolderTreeCache(notebookId)
      deps.syncLocalFolderWatchers()
    }
    return deleted
  }))
}
