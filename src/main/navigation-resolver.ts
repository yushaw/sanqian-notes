import {
  createLocalResourceId,
  isLocalResourceUidRef,
  parseLocalResourceId,
} from '../shared/local-resource-id'

export interface NavigationResolverDeps {
  getNoteById: (noteId: string) => unknown | null
  getLocalNoteIdentityByUid: (input: { note_uid: string; notebook_id?: string | null }) => {
    notebook_id: string
    relative_path: string
  } | null
}

export function resolveRendererNoteIdForNavigation(
  noteId: string,
  deps: NavigationResolverDeps
): string {
  const parsedLocalRef = parseLocalResourceId(noteId)
  if (parsedLocalRef) {
    if (isLocalResourceUidRef(parsedLocalRef) && parsedLocalRef.noteUid) {
      const identity = deps.getLocalNoteIdentityByUid({
        note_uid: parsedLocalRef.noteUid,
        notebook_id: parsedLocalRef.notebookId,
      })
      if (identity) {
        return createLocalResourceId(identity.notebook_id, identity.relative_path)
      }
      return noteId
    }
    if (parsedLocalRef.relativePath) {
      return createLocalResourceId(parsedLocalRef.notebookId, parsedLocalRef.relativePath)
    }
    return noteId
  }

  if (deps.getNoteById(noteId)) {
    return noteId
  }

  const localIdentity = deps.getLocalNoteIdentityByUid({ note_uid: noteId })
  if (localIdentity) {
    return createLocalResourceId(localIdentity.notebook_id, localIdentity.relative_path)
  }

  return noteId
}
