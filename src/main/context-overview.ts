import type { AppContextData } from '@yushaw/sanqian-chat/main'
import {
  type Notebook,
  getNoteById,
  getNotesByUpdated,
  getNotebooks,
  getNoteCountByNotebook,
} from './database'

export interface UserContextSnapshot {
  currentNotebookId: string | null
  currentNotebookName: string | null
  currentNoteId: string | null
  currentNoteTitle: string | null
}

export interface ContextOverviewNote {
  id: string
  title: string
  notebook_id: string | null
  updated_at: string
  deleted_at: string | null
  ai_summary: string | null
  source_type?: 'internal' | 'local-folder'
  relative_path?: string | null
}

export interface ContextOverviewDataSource {
  getNotebooks: () => Notebook[]
  getNoteCountByNotebook: () => Record<string, number>
  getNoteCountByNotebookId?: (notebookId: string) => number
  getNoteById: (id: string) => ContextOverviewNote | null
  getNotes: (limit: number, offset: number) => ContextOverviewNote[]
}

const defaultDataSource: ContextOverviewDataSource = {
  getNotebooks,
  getNoteCountByNotebook,
  getNoteCountByNotebookId: (notebookId: string) => getNoteCountByNotebook()[notebookId] || 0,
  getNoteById: (id: string) => {
    const note = getNoteById(id)
    if (!note) return null
    return {
      id: note.id,
      title: note.title,
      notebook_id: note.notebook_id,
      updated_at: note.updated_at,
      deleted_at: note.deleted_at,
      ai_summary: note.ai_summary,
      source_type: 'internal',
    }
  },
  getNotes: (limit: number, offset: number) => {
    return getNotesByUpdated(limit, offset).map((note) => ({
      id: note.id,
      title: note.title,
      notebook_id: note.notebook_id,
      updated_at: note.updated_at,
      deleted_at: note.deleted_at,
      ai_summary: note.ai_summary,
      source_type: 'internal',
    }))
  },
}

function generateNoteLink(noteId: string): string {
  return `sanqian-notes://note/${noteId}`
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  let truncated = text.slice(0, maxLength)
  const lastCharCode = truncated.charCodeAt(truncated.length - 1)
  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    truncated = truncated.slice(0, -1)
  }
  return truncated
}

function sanitizeContextInlineText(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/[<>]/g, (char) => (char === '<' ? '＜' : '＞'))
    .replace(/\s+/g, ' ')
    .trim()
}

function displayTitle(title: string): string {
  const normalized = sanitizeContextInlineText(title)
  return normalized ? normalized : 'Untitled'
}

function displayNotebookName(notebookId: string | null, notebookMap: Map<string, string>): string {
  if (!notebookId) return 'Unfiled'
  return displayTitle(notebookMap.get(notebookId) || 'Unknown notebook')
}

function isLocalOverviewNote(note: ContextOverviewNote): boolean {
  return note.source_type === 'local-folder'
}

const RECENT_NOTES_LIMIT = 3

interface NotesOverviewOptions {
  includeCurrentNote?: boolean
}

export function buildNotesOverviewContext(
  ctx: UserContextSnapshot,
  dataSource: ContextOverviewDataSource = defaultDataSource,
  options?: NotesOverviewOptions
): AppContextData {
  const includeCurrentNote = options?.includeCurrentNote !== false
  const notebooks = dataSource.getNotebooks()
  const notebookMap = new Map(notebooks.map(notebook => [notebook.id, notebook.name]))
  const currentNote = ctx.currentNoteId ? dataSource.getNoteById(ctx.currentNoteId) : null
  const recentNotes = dataSource.getNotes(RECENT_NOTES_LIMIT, 0)
  const lines: string[] = ['[Notes Overview]']

  if (includeCurrentNote) {
    if (currentNote && !currentNote.deleted_at) {
      const currentTitle = displayTitle(currentNote.title)
      const notebookName = displayNotebookName(currentNote.notebook_id, notebookMap)
      lines.push(`- Current note: "${currentTitle}" (ID: ${currentNote.id})`)
      lines.push(`- Notebook: ${notebookName}`)
      if (isLocalOverviewNote(currentNote) && currentNote.relative_path) {
        lines.push(`- Path: ${sanitizeContextInlineText(currentNote.relative_path)}`)
      } else {
        lines.push(`- Link: ${generateNoteLink(currentNote.id)}`)
      }
      if (currentNote.ai_summary) {
        const summary = truncateText(sanitizeContextInlineText(currentNote.ai_summary), 300)
        lines.push(`- Summary: ${summary}`)
      }
    } else if (ctx.currentNoteTitle) {
      lines.push(`- Current note: "${displayTitle(ctx.currentNoteTitle)}" (not found in database)`)
    } else {
      lines.push('- Current note: none')
    }
  }

  if (recentNotes.length > 0) {
    lines.push('', 'Recently updated notes:')
    recentNotes.forEach((note, index) => {
      const title = displayTitle(note.title)
      const notebookName = displayNotebookName(note.notebook_id, notebookMap)
      const localPathSuffix = isLocalOverviewNote(note) && note.relative_path
        ? `, path: ${sanitizeContextInlineText(note.relative_path)}`
        : ''
      lines.push(
        `${index + 1}. "${title}" (ID: ${note.id}, notebook: ${notebookName}${localPathSuffix}, updated: ${note.updated_at})`
      )
    })
  } else {
    lines.push('', 'No notes found.')
  }

  lines.push('', 'Tip: Attach specific notes from the Notes resource picker when full note details are needed.')

  return {
    title: 'Notes Overview',
    summary: currentNote && !currentNote.deleted_at
      ? `Current note: ${displayTitle(currentNote.title)}`
      : `${recentNotes.length} recent notes`,
    content: lines.join('\n'),
    type: 'notes-overview',
    metadata: {
      currentNoteId: currentNote?.id || null,
      recentNoteIds: recentNotes.map(note => note.id),
    }
  }
}

export function buildNotebooksOverviewContext(
  ctx: UserContextSnapshot,
  dataSource: ContextOverviewDataSource = defaultDataSource
): AppContextData {
  const notebooks = dataSource.getNotebooks()
  const currentNotebook = ctx.currentNotebookId
    ? notebooks.find(notebook => notebook.id === ctx.currentNotebookId)
    : null
  const currentNotebookNoteCount = currentNotebook
    ? (dataSource.getNoteCountByNotebookId
      ? dataSource.getNoteCountByNotebookId(currentNotebook.id)
      : (dataSource.getNoteCountByNotebook()[currentNotebook.id] || 0))
    : null
  const lines: string[] = ['[Notebook Overview]']

  if (currentNotebook) {
    lines.push(`- Current notebook: "${displayTitle(currentNotebook.name)}" (ID: ${currentNotebook.id})`)
    lines.push(`- Notes in current notebook: ${currentNotebookNoteCount || 0}`)
  } else if (ctx.currentNotebookName) {
    lines.push(`- Current notebook: "${displayTitle(ctx.currentNotebookName)}" (not found in database)`)
  } else {
    lines.push('- Current notebook: all notes view')
  }

  lines.push(`- Total notebooks: ${notebooks.length}`)

  if (notebooks.length === 0) {
    lines.push('', 'No notebooks found.')
  }

  lines.push('', 'Tip: Attach a notebook resource to include notebook-level details in the conversation.')

  return {
    title: 'Notebook Overview',
    summary: currentNotebook
      ? `Current notebook: ${displayTitle(currentNotebook.name)}`
      : `${notebooks.length} notebooks`,
    content: lines.join('\n'),
    type: 'notebook-overview',
    metadata: {
      currentNotebookId: currentNotebook?.id || null,
      notebookCount: notebooks.length,
    }
  }
}
