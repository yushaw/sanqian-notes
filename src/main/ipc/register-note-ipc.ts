import type { IpcMain } from 'electron'
import type {
  Note,
  NoteGetAllOptions,
  NoteInput,
  NoteSearchFilter,
  NoteUpdateSafeResult,
} from '../../shared/types'
import { hasOwnDefinedProperty } from '../../shared/property-guards'
import type { SearchScopeResolveResult } from '../search-scope'
import { parseNoteSearchFilterInput, parseSmartViewIdInput } from './note-search-filter-input'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

const NOTE_GET_BY_IDS_MAX_ITEMS = 2000
const NOTE_GET_ALL_MAX_RECENT_DAYS = 36500
const NOTE_SEARCH_QUERY_MAX_LENGTH = 10000
const OPAQUE_ID_MAX_LENGTH = 4096
const NOTE_NOTEBOOK_ID_MAX_LENGTH = 1024
const NOTE_FOLDER_PATH_MAX_LENGTH = 4096
const NOTE_DAILY_DATE_MAX_LENGTH = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRequiredOpaqueIdInput(idInput: unknown): string | null {
  if (typeof idInput !== 'string') return null
  if (idInput.includes('\0')) return null
  if (idInput.length > OPAQUE_ID_MAX_LENGTH) return null
  return idInput.trim() ? idInput : null
}

function parseSafeStringInput(
  input: unknown,
  options?: { maxLength?: number }
): string | null {
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (typeof options?.maxLength === 'number' && input.length > options.maxLength) return null
  return input
}

function parseRequiredOpaqueIdArrayInput(
  idsInput: unknown,
  options?: { maxItems?: number }
): string[] | null {
  if (!Array.isArray(idsInput)) return null
  if (typeof options?.maxItems === 'number' && idsInput.length > options.maxItems) return null
  const ids: string[] = []
  for (const idInput of idsInput) {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return null
    ids.push(id)
  }
  return ids
}

function parseNoteUpdateInput(input: unknown): Partial<NoteInput> | null {
  if (!isRecord(input) || Array.isArray(input)) return null

  const updates: Partial<NoteInput> = {}

  if (input.title !== undefined) {
    const title = parseSafeStringInput(input.title)
    if (title === null) return null
    updates.title = title
  }
  if (input.content !== undefined) {
    const content = parseSafeStringInput(input.content)
    if (content === null) return null
    updates.content = content
  }

  if (input.notebook_id !== undefined) {
    if (input.notebook_id === null) {
      updates.notebook_id = null
    } else {
      const notebookId = parseSafeStringInput(input.notebook_id, { maxLength: NOTE_NOTEBOOK_ID_MAX_LENGTH })
      if (notebookId === null) return null
      updates.notebook_id = notebookId
    }
  }
  if (input.folder_path !== undefined) {
    if (input.folder_path === null) {
      updates.folder_path = null
    } else {
      const folderPath = parseSafeStringInput(input.folder_path, { maxLength: NOTE_FOLDER_PATH_MAX_LENGTH })
      if (folderPath === null) return null
      updates.folder_path = folderPath
    }
  }
  if (input.daily_date !== undefined) {
    if (input.daily_date === null) {
      updates.daily_date = null
    } else {
      const dailyDate = parseSafeStringInput(input.daily_date, { maxLength: NOTE_DAILY_DATE_MAX_LENGTH })
      if (dailyDate === null) return null
      updates.daily_date = dailyDate
    }
  }

  if (input.is_daily !== undefined) {
    if (typeof input.is_daily !== 'boolean') return null
    updates.is_daily = input.is_daily
  }
  if (input.is_favorite !== undefined) {
    if (typeof input.is_favorite !== 'boolean') return null
    updates.is_favorite = input.is_favorite
  }
  if (input.is_pinned !== undefined) {
    if (typeof input.is_pinned !== 'boolean') return null
    updates.is_pinned = input.is_pinned
  }

  return updates
}

function parseNoteCreateInput(input: unknown): NoteInput | null {
  const parsed = parseNoteUpdateInput(input)
  if (!parsed || typeof parsed.title !== 'string' || typeof parsed.content !== 'string') {
    return null
  }
  return {
    title: parsed.title,
    content: parsed.content,
    notebook_id: parsed.notebook_id,
    folder_path: parsed.folder_path,
    is_daily: parsed.is_daily,
    daily_date: parsed.daily_date,
    is_favorite: parsed.is_favorite,
    is_pinned: parsed.is_pinned,
  }
}

function parseExpectedRevisionInput(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) return null
  return input
}

function parseOptionalBooleanInput(input: unknown): boolean | undefined | null {
  if (input === undefined) return undefined
  if (typeof input !== 'boolean') return null
  return input
}

function parsePositiveIntegerInput(
  input: unknown,
  options?: { max?: number }
): number | undefined | null {
  if (input === undefined) return undefined
  if (typeof input !== 'number' || !Number.isInteger(input) || !Number.isFinite(input) || input <= 0) return null
  if (typeof options?.max === 'number' && input > options.max) return options.max
  return input
}

function parseNoteGetAllOptionsInput(input: unknown): NoteGetAllOptions | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null

  const includeLocal = parseOptionalBooleanInput(input.includeLocal)
  if (input.includeLocal !== undefined && includeLocal === null) return null

  const includeLocalContent = parseOptionalBooleanInput(input.includeLocalContent)
  if (input.includeLocalContent !== undefined && includeLocalContent === null) return null

  const viewType = input.viewType === undefined ? undefined : parseSmartViewIdInput(input.viewType)
  if (input.viewType !== undefined && !viewType) return null

  const recentDaysInput = parsePositiveIntegerInput(input.recentDays, { max: NOTE_GET_ALL_MAX_RECENT_DAYS })
  if (input.recentDays !== undefined && recentDaysInput === null) return null
  const recentDays = recentDaysInput ?? undefined

  const options: NoteGetAllOptions = {}
  if (Object.prototype.hasOwnProperty.call(input, 'includeLocal')) {
    options.includeLocal = includeLocal ?? undefined
  }
  if (Object.prototype.hasOwnProperty.call(input, 'includeLocalContent')) {
    options.includeLocalContent = includeLocalContent ?? undefined
  }
  if (viewType !== undefined) {
    options.viewType = viewType
  }
  if (recentDays !== undefined) {
    options.recentDays = recentDays
  }
  return options
}

export interface NoteIpcDependencies {
  getAllNotesForRendererAsync: (options?: NoteGetAllOptions) => Promise<Note[]>
  getNoteByIdForRenderer: (id: string) => Note | null | Promise<Note | null>
  getNotesByIdsForRenderer: (ids: string[]) => Note[] | Promise<Note[]>
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
    notebookId?: unknown
    folderRelativePath?: unknown
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
  ipcMainLike.handle('note:getAll', createSafeHandler('note:getAll', async (_, optionsInput?: unknown) => {
    const options = parseNoteGetAllOptionsInput(optionsInput)
    if (optionsInput !== undefined && options === null) {
      return []
    }
    return deps.getAllNotesForRendererAsync(options ?? undefined)
  }))
  ipcMainLike.handle('note:getById', createSafeHandler('note:getById', async (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return null
    return await deps.getNoteByIdForRenderer(id)
  }))
  ipcMainLike.handle('note:getByIds', createSafeHandler('note:getByIds', async (_, idsInput: unknown) => {
    const ids = parseRequiredOpaqueIdArrayInput(idsInput, { maxItems: NOTE_GET_BY_IDS_MAX_ITEMS })
    if (!ids || ids.length === 0) return []
    return await deps.getNotesByIdsForRenderer(ids)
  }))
  ipcMainLike.handle('note:add', createSafeHandler('note:add', (_, noteInput: unknown) => {
    const note = parseNoteCreateInput(noteInput)
    if (!note) {
      throw new Error('note:add payload must be an object with string title/content')
    }
    return deps.addNote(note)
  }))
  ipcMainLike.handle('note:update', createSafeHandler('note:update', (_, idInput: unknown, updatesInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    const updates = parseNoteUpdateInput(updatesInput)
    if (!id || !updates) {
      return null
    }
    const oldNote = deps.getNoteById(id)
    const result = deps.updateNote(id, updates)
    if (result && oldNote && updates.notebook_id !== undefined && updates.notebook_id !== oldNote.notebook_id) {
      deps.updateNoteNotebookId(id, updates.notebook_id || '')
    }
    return result
  }))
  ipcMainLike.handle('note:updateSafe', createSafeHandler('note:updateSafe', (_, idInput: unknown, updatesInput: unknown, expectedRevisionInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    const updates = parseNoteUpdateInput(updatesInput)
    const expectedRevision = parseExpectedRevisionInput(expectedRevisionInput)
    if (!id || !updates || expectedRevision === null) {
      return { status: 'failed', error: 'note_not_found' }
    }
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
  ipcMainLike.handle('note:checkIndex', createSafeHandler('note:checkIndex', async (_, noteIdInput: unknown, notebookIdInput: unknown, contentInput: unknown) => {
    const noteId = parseRequiredOpaqueIdInput(noteIdInput)
    const notebookId = parseSafeStringInput(notebookIdInput, { maxLength: NOTE_NOTEBOOK_ID_MAX_LENGTH })
    const content = parseSafeStringInput(contentInput)
    if (!noteId || !notebookId || !content) {
      return false
    }
    return deps.checkAndIndex(noteId, notebookId, content)
  }))
  ipcMainLike.handle('note:delete', createSafeHandler('note:delete', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) {
      return false
    }
    const result = deps.deleteNote(id)
    if (result) {
      deps.deleteNoteIndex(id)
    }
    return result
  }))
  ipcMainLike.handle('note:search', createSafeHandler('note:search', (_, query: unknown, filterInput?: unknown) => {
    const searchQuery = typeof query === 'string' ? query : ''
    const normalizedQuery = searchQuery.trim()
    if (!normalizedQuery || normalizedQuery.includes('\0') || normalizedQuery.length > NOTE_SEARCH_QUERY_MAX_LENGTH) {
      return []
    }

    const filter = parseNoteSearchFilterInput(filterInput)
    if (filterInput !== undefined && filter === null) {
      return []
    }

    const hasNotebookFilter = hasOwnDefinedProperty(filter, 'notebookId')
    const scope = deps.resolveSearchScope({
      entryId: hasNotebookFilter ? 'notebook_search' : 'global_search',
      notebookId: hasNotebookFilter ? filter?.notebookId : null,
    })
    if (!scope.success) {
      console.warn('[note:search] failed to resolve scope:', scope.errorCode)
      return []
    }

    if (scope.scope.kind === 'current_notebook') {
      return deps.searchNotes(normalizedQuery, { notebookId: scope.scope.notebookId })
    }
    return deps.searchNotes(normalizedQuery, filter ?? undefined)
  }))
  ipcMainLike.handle('note:createDemo', createSafeHandler('note:createDemo', () => deps.createDemoNote()))

  ipcMainLike.handle('daily:getByDate', createSafeHandler('daily:getByDate', (_, dateInput: unknown) => {
    const date = parseRequiredOpaqueIdInput(dateInput)
    if (!date) return null
    return deps.getDailyByDate(date)
  }))
  ipcMainLike.handle('daily:create', createSafeHandler('daily:create', (_, dateInput: unknown, titleInput?: unknown) => {
    const date = parseRequiredOpaqueIdInput(dateInput)
    if (!date) {
      throw new Error('daily:create date must be a non-empty string')
    }
    const title = typeof titleInput === 'string' ? titleInput : undefined
    return deps.createDaily(date, title)
  }))

  ipcMainLike.handle('trash:getAll', createSafeHandler('trash:getAll', () => deps.getTrashNotes()))
  ipcMainLike.handle('trash:restore', createSafeHandler('trash:restore', async (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) {
      return false
    }
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
  ipcMainLike.handle('trash:permanentDelete', createSafeHandler('trash:permanentDelete', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) {
      return false
    }
    return deps.permanentlyDeleteNote(id)
  }))
  ipcMainLike.handle('trash:empty', createSafeHandler('trash:empty', () => deps.emptyTrash()))
  ipcMainLike.handle('trash:cleanup', createSafeHandler('trash:cleanup', () => deps.cleanupOldTrash()))
}
