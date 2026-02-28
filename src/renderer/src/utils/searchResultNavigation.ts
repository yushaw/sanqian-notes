import { parseLocalResourceId } from './localResourceId'

export type SearchResultNavigationTarget =
  | { type: 'internal'; noteId: string }
  | { type: 'local'; notebookId: string; relativePath: string }

export function resolveSearchResultNavigationTarget(noteId: string): SearchResultNavigationTarget {
  const localRef = parseLocalResourceId(noteId)
  if (localRef && localRef.relativePath) {
    return {
      type: 'local',
      notebookId: localRef.notebookId,
      relativePath: localRef.relativePath,
    }
  }

  return { type: 'internal', noteId }
}
