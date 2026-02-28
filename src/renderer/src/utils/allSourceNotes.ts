import type { LocalFolderTreeResult, LocalNoteMetadata, Note, Notebook, NotebookStatus } from '../types/note'
import { createLocalResourceId, getLocalSearchFileTitle } from './localResourceId'
import { mergeLocalMetadataTags } from './localFolderNavigation'

interface BuildAllSourceLocalNotesInput {
  notebooks: Notebook[]
  localFolderTreeCache: Record<string, LocalFolderTreeResult>
  localFolderStatuses: Record<string, NotebookStatus>
  localNoteMetadataById?: Record<string, LocalNoteMetadata>
}

interface BuildAllSourceNotesInput extends BuildAllSourceLocalNotesInput {
  notes: Note[]
}

function compareAllSourceNotes(left: Note, right: Note): number {
  if (left.is_pinned !== right.is_pinned) {
    return left.is_pinned ? -1 : 1
  }

  const leftTime = new Date(left.updated_at).getTime()
  const rightTime = new Date(right.updated_at).getTime()
  if (leftTime !== rightTime) {
    return rightTime - leftTime
  }

  return left.id.localeCompare(right.id, undefined, { sensitivity: 'base', numeric: true })
}

function buildLocalAllSourceNote(
  notebookId: string,
  notebookName: string,
  file: LocalFolderTreeResult['files'][number],
  metadata: LocalNoteMetadata | null
): Note {
  const updatedAt = new Date(file.mtime_ms).toISOString()
  const pathSummary = notebookName ? `${notebookName} · ${file.relative_path}` : file.relative_path
  const summary = metadata?.ai_summary || pathSummary

  return {
    id: createLocalResourceId(notebookId, file.relative_path),
    title: getLocalSearchFileTitle(file.relative_path),
    content: pathSummary,
    notebook_id: notebookId,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: metadata?.is_favorite ?? false,
    is_pinned: metadata?.is_pinned ?? false,
    revision: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
    ai_summary: summary,
    tags: mergeLocalMetadataTags(metadata?.tags, metadata?.ai_tags),
  }
}

export function buildAllSourceLocalNotes(input: BuildAllSourceLocalNotesInput): Note[] {
  const localNotes: Note[] = []
  const metadataById = input.localNoteMetadataById || {}

  for (const notebook of input.notebooks) {
    if (notebook.source_type !== 'local-folder') continue
    const status = input.localFolderStatuses[notebook.id]
    if (status && status !== 'active') continue

    const tree = input.localFolderTreeCache[notebook.id]
    if (!tree) continue

    for (const file of tree.files) {
      const localId = createLocalResourceId(notebook.id, file.relative_path)
      localNotes.push(
        buildLocalAllSourceNote(
          notebook.id,
          notebook.name,
          file,
          metadataById[localId] || null
        )
      )
    }
  }

  return localNotes
}

export function mergeAllSourceNotes(internalRegularNotes: Note[], localNotes: Note[]): Note[] {
  return [...internalRegularNotes, ...localNotes].sort(compareAllSourceNotes)
}

export function buildAllSourceNotes(input: BuildAllSourceNotesInput): Note[] {
  const internalRegularNotes = input.notes.filter((note) => !note.is_daily)
  const localNotes = buildAllSourceLocalNotes(input)
  return mergeAllSourceNotes(internalRegularNotes, localNotes)
}
