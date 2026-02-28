import type { LocalFolderTreeResult, Note, Notebook, NotebookStatus } from '../types/note'

interface LocalNotebookCountSources {
  localFolderTree: LocalFolderTreeResult | null
  localFolderTreeCache: Record<string, LocalFolderTreeResult>
  localNotebookNoteCounts: Record<string, number>
  localFolderStatuses?: Record<string, NotebookStatus>
}

interface BuildSmartViewNoteCountsInput extends LocalNotebookCountSources {
  notes: Note[]
  localNotes?: Note[]
  localFavoriteCount?: number
  notebooks: Notebook[]
  trashCount: number
  recentThresholdMs: number
}

export interface SmartViewNoteCounts {
  all: number
  daily: number
  recent: number
  favorites: number
  trash: number
  notebooks: Record<string, number>
}

function resolveLocalNotebookNoteCount(
  notebookId: string,
  sources: LocalNotebookCountSources
): number {
  if (sources.localFolderStatuses) {
    if (sources.localFolderStatuses[notebookId] !== 'active') {
      return 0
    }

    if (sources.localFolderTree?.notebook_id === notebookId) {
      return sources.localFolderTree.files.length
    }

    const cachedTreeCount = sources.localFolderTreeCache[notebookId]?.files.length
    if (typeof cachedTreeCount === 'number') {
      return cachedTreeCount
    }

    // Avoid stale persisted counts when active notebooks have no fresh tree snapshot yet.
    return 0
  }

  if (sources.localFolderTree?.notebook_id === notebookId) {
    return sources.localFolderTree.files.length
  }

  const cachedTreeCount = sources.localFolderTreeCache[notebookId]?.files.length
  if (typeof cachedTreeCount === 'number') {
    return cachedTreeCount
  }

  return sources.localNotebookNoteCounts[notebookId] ?? 0
}

export function buildNotebookNoteCounts(
  notebooks: Notebook[],
  regularNotes: Note[],
  sources: LocalNotebookCountSources
): Record<string, number> {
  const internalNotebookCounts: Record<string, number> = {}

  for (const note of regularNotes) {
    if (!note.notebook_id) continue
    internalNotebookCounts[note.notebook_id] = (internalNotebookCounts[note.notebook_id] ?? 0) + 1
  }

  return notebooks.reduce((acc, notebook) => {
    if (notebook.source_type === 'local-folder') {
      acc[notebook.id] = resolveLocalNotebookNoteCount(notebook.id, sources)
      return acc
    }

    acc[notebook.id] = internalNotebookCounts[notebook.id] ?? 0
    return acc
  }, {} as Record<string, number>)
}

export function sumLocalNotebookCounts(
  notebooks: Notebook[],
  notebookCounts: Record<string, number>
): number {
  return notebooks.reduce((sum, notebook) => {
    if (notebook.source_type !== 'local-folder') return sum
    return sum + (notebookCounts[notebook.id] ?? 0)
  }, 0)
}

export function buildSmartViewNoteCounts(input: BuildSmartViewNoteCountsInput): SmartViewNoteCounts {
  const {
    notes,
    localNotes = [],
    localFavoriteCount,
    notebooks,
    trashCount,
    recentThresholdMs,
    ...localSources
  } = input
  const regularNotes = notes.filter((note) => !note.is_daily)
  const notebookCounts = buildNotebookNoteCounts(notebooks, regularNotes, localSources)
  const localNotesTotal = sumLocalNotebookCounts(notebooks, notebookCounts)
  const localRegularNotes = localNotes.filter((note) => !note.is_daily)

  return {
    all: regularNotes.length + localNotesTotal,
    daily: notes.filter((note) => note.is_daily).length,
    recent: regularNotes.filter((note) => new Date(note.updated_at).getTime() > recentThresholdMs).length
      + localRegularNotes.filter((note) => new Date(note.updated_at).getTime() > recentThresholdMs).length,
    favorites: notes.filter((note) => note.is_favorite).length
      + (localFavoriteCount ?? localNotes.filter((note) => note.is_favorite).length),
    trash: trashCount,
    notebooks: notebookCounts,
  }
}
