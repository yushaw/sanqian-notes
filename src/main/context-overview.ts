import type { AppContextData } from '@yushaw/sanqian-chat/main'
import {
  type Note,
  type Notebook,
  getNoteById,
  getNotes,
  getNotebooks,
  getNoteCountByNotebook,
} from './database'

export interface UserContextSnapshot {
  currentNotebookId: string | null
  currentNotebookName: string | null
  currentNoteId: string | null
  currentNoteTitle: string | null
}

export interface ContextOverviewDataSource {
  getNotebooks: () => Notebook[]
  getNoteCountByNotebook: () => Record<string, number>
  getNoteById: (id: string) => Note | null
  getNotes: (limit: number, offset: number) => Note[]
}

const defaultDataSource: ContextOverviewDataSource = {
  getNotebooks,
  getNoteCountByNotebook,
  getNoteById,
  getNotes,
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

function displayTitle(title: string): string {
  return title.trim() ? title : 'Untitled'
}

function displayNotebookName(notebookId: string | null, notebookMap: Map<string, string>): string {
  if (!notebookId) return 'Unfiled'
  return notebookMap.get(notebookId) || 'Unknown notebook'
}

export function buildNotesOverviewContext(
  ctx: UserContextSnapshot,
  dataSource: ContextOverviewDataSource = defaultDataSource
): AppContextData {
  const notebooks = dataSource.getNotebooks()
  const notebookMap = new Map(notebooks.map(notebook => [notebook.id, notebook.name]))
  const currentNote = ctx.currentNoteId ? dataSource.getNoteById(ctx.currentNoteId) : null
  const recentNotes = dataSource.getNotes(5, 0)
  const lines: string[] = ['[Notes Overview]']

  if (currentNote && !currentNote.deleted_at) {
    const currentTitle = displayTitle(currentNote.title)
    const notebookName = displayNotebookName(currentNote.notebook_id, notebookMap)
    lines.push(`- Current note: "${currentTitle}" (ID: ${currentNote.id})`)
    lines.push(`- Notebook: ${notebookName}`)
    lines.push(`- Link: ${generateNoteLink(currentNote.id)}`)
    if (currentNote.ai_summary) {
      const summary = truncateText(currentNote.ai_summary, 300)
      lines.push(`- Summary: ${summary}`)
    }
  } else if (ctx.currentNoteTitle) {
    lines.push(`- Current note: "${ctx.currentNoteTitle}" (not found in database)`)
  } else {
    lines.push('- Current note: none')
  }

  if (recentNotes.length > 0) {
    lines.push('', 'Recently updated notes:')
    recentNotes.forEach((note, index) => {
      const title = displayTitle(note.title)
      const notebookName = displayNotebookName(note.notebook_id, notebookMap)
      lines.push(
        `${index + 1}. "${title}" (ID: ${note.id}, notebook: ${notebookName}, updated: ${note.updated_at})`
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
  const noteCounts = dataSource.getNoteCountByNotebook()
  const currentNotebook = ctx.currentNotebookId
    ? notebooks.find(notebook => notebook.id === ctx.currentNotebookId)
    : null
  const topNotebooks = [...notebooks]
    .sort((a, b) => {
      const diff = (noteCounts[b.id] || 0) - (noteCounts[a.id] || 0)
      if (diff !== 0) return diff
      return a.name.localeCompare(b.name)
    })
    .slice(0, 8)
  const lines: string[] = ['[Notebook Overview]']

  if (currentNotebook) {
    lines.push(`- Current notebook: "${currentNotebook.name}" (ID: ${currentNotebook.id})`)
    lines.push(`- Notes in current notebook: ${noteCounts[currentNotebook.id] || 0}`)
  } else if (ctx.currentNotebookName) {
    lines.push(`- Current notebook: "${ctx.currentNotebookName}" (not found in database)`)
  } else {
    lines.push('- Current notebook: all notes view')
  }

  lines.push(`- Total notebooks: ${notebooks.length}`)

  if (topNotebooks.length > 0) {
    lines.push('', 'Notebooks by note count:')
    topNotebooks.forEach((notebook, index) => {
      lines.push(
        `${index + 1}. "${notebook.name}" (ID: ${notebook.id}, notes: ${noteCounts[notebook.id] || 0})`
      )
    })
  } else {
    lines.push('', 'No notebooks found.')
  }

  lines.push('', 'Tip: Attach a notebook resource to include notebook-level details in the conversation.')

  return {
    title: 'Notebook Overview',
    summary: currentNotebook
      ? `Current notebook: ${currentNotebook.name}`
      : `${notebooks.length} notebooks`,
    content: lines.join('\n'),
    type: 'notebook-overview',
    metadata: {
      currentNotebookId: currentNotebook?.id || null,
      notebookCount: notebooks.length,
    }
  }
}
