import type { IpcMain } from 'electron'
import type {
  Note,
  NoteGetAllOptions,
  NoteInput,
  NoteSearchFilter,
  NoteUpdateSafeResult,
} from '../../shared/types'
import type { SearchScopeResolveResult } from '../search-scope'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export interface NoteIpcDependencies {
  getAllNotesForRendererAsync: (options?: NoteGetAllOptions) => Promise<Note[]>
  getNoteByIdForRenderer: (id: string) => Note | null
  getNotesByIdsForRenderer: (ids: string[]) => Note[]
  addNote: (note: NoteInput) => Note
  getNoteById: (id: string) => Note | null
  updateNote: (id: string, updates: Partial<NoteInput>) => Note | null
  updateNoteSafe: (id: string, updates: Partial<NoteInput>, expectedRevision: number) => NoteUpdateSafeResult
  updateNoteNotebookId: (id: string, notebookId: string) => void
  checkAndIndex: (noteId: string, notebookId: string, content: string) => Promise<unknown>
  deleteNote: (id: string) => boolean
  deleteNoteIndex: (id: string) => void
  searchNotes: (query: string, filter?: NoteSearchFilter) => Note[]
  resolveSearchScope: (input: {
    entryId: string
    notebookId?: string | null
    folderRelativePath?: string | null
  }) => SearchScopeResolveResult
  createDemoNote: () => void
  getDailyByDate: (date: string) => Note | null
  createDaily: (date: string, title?: string) => Note
  getTrashNotes: () => Note[]
  restoreNote: (id: string) => boolean
  getEmbeddingConfig: () => { enabled: boolean }
  indexNoteFull: (noteId: string, notebookId: string, content: string) => Promise<unknown>
  indexNoteFtsOnly: (noteId: string, notebookId: string, content: string) => Promise<unknown>
  permanentlyDeleteNote: (id: string) => boolean
  emptyTrash: () => number
  cleanupOldTrash: () => number
}

export function registerNoteIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: NoteIpcDependencies
): void {
  ipcMainLike.handle('note:getAll', createSafeHandler('note:getAll', async (_, options?: NoteGetAllOptions) => deps.getAllNotesForRendererAsync(options)))
  ipcMainLike.handle('note:getById', createSafeHandler('note:getById', (_, id: string) => deps.getNoteByIdForRenderer(id)))
  ipcMainLike.handle('note:getByIds', createSafeHandler('note:getByIds', (_, ids: string[]) => deps.getNotesByIdsForRenderer(ids)))
  ipcMainLike.handle('note:add', createSafeHandler('note:add', (_, note: NoteInput) => {
    return deps.addNote(note)
  }))
  ipcMainLike.handle('note:update', createSafeHandler('note:update', (_, id: string, updates: Partial<NoteInput>) => {
    const oldNote = deps.getNoteById(id)
    const result = deps.updateNote(id, updates)
    if (result && oldNote && updates.notebook_id !== undefined && updates.notebook_id !== oldNote.notebook_id) {
      deps.updateNoteNotebookId(id, updates.notebook_id || '')
    }
    return result
  }))
  ipcMainLike.handle('note:updateSafe', createSafeHandler('note:updateSafe', (_, id: string, updates: Partial<NoteInput>, expectedRevision: number) => {
    const oldNote = deps.getNoteById(id)
    const result = deps.updateNoteSafe(id, updates, expectedRevision)
    if (
      result.status === 'updated' &&
      oldNote &&
      updates?.notebook_id !== undefined &&
      updates.notebook_id !== oldNote.notebook_id
    ) {
      deps.updateNoteNotebookId(id, updates.notebook_id || '')
    }
    return result
  }))
  ipcMainLike.handle('note:checkIndex', createSafeHandler('note:checkIndex', async (_, noteId: string, notebookId: string, content: string) => {
    return deps.checkAndIndex(noteId, notebookId, content)
  }))
  ipcMainLike.handle('note:delete', createSafeHandler('note:delete', (_, id: string) => {
    const result = deps.deleteNote(id)
    if (result) {
      deps.deleteNoteIndex(id)
    }
    return result
  }))
  ipcMainLike.handle('note:search', createSafeHandler('note:search', (_, query: string, filter?: NoteSearchFilter) => {
    const scope = deps.resolveSearchScope({
      entryId: filter?.notebookId ? 'notebook_search' : 'global_search',
      notebookId: filter?.notebookId ?? null,
    })
    if (!scope.success) {
      console.warn('[note:search] failed to resolve scope:', scope.errorCode)
      return []
    }

    if (scope.scope.kind === 'current_notebook') {
      return deps.searchNotes(query, { notebookId: scope.scope.notebookId })
    }
    return deps.searchNotes(query, filter)
  }))
  ipcMainLike.handle('note:createDemo', createSafeHandler('note:createDemo', () => deps.createDemoNote()))

  ipcMainLike.handle('daily:getByDate', createSafeHandler('daily:getByDate', (_, date: string) => deps.getDailyByDate(date)))
  ipcMainLike.handle('daily:create', createSafeHandler('daily:create', (_, date: string, title?: string) => deps.createDaily(date, title)))

  ipcMainLike.handle('trash:getAll', createSafeHandler('trash:getAll', () => deps.getTrashNotes()))
  ipcMainLike.handle('trash:restore', createSafeHandler('trash:restore', async (_, id: string) => {
    const result = deps.restoreNote(id)
    if (result) {
      const note = deps.getNoteById(id)
      if (note && note.content) {
        const config = deps.getEmbeddingConfig()
        if (config.enabled) {
          void deps.indexNoteFull(note.id, note.notebook_id || '', note.content).catch(console.error)
        } else {
          void deps.indexNoteFtsOnly(note.id, note.notebook_id || '', note.content).catch(console.error)
        }
      }
    }
    return result
  }))
  ipcMainLike.handle('trash:permanentDelete', createSafeHandler('trash:permanentDelete', (_, id: string) => deps.permanentlyDeleteNote(id)))
  ipcMainLike.handle('trash:empty', createSafeHandler('trash:empty', () => deps.emptyTrash()))
  ipcMainLike.handle('trash:cleanup', createSafeHandler('trash:cleanup', () => deps.cleanupOldTrash()))
}
