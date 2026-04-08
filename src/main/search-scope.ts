import { posix } from 'path'
import { normalizeRelativeSlashPath } from './path-compat'
import { parseRequiredNotebookIdInput } from './notebook-id'

export type SearchEntryId = 'global_search' | 'notebook_search' | 'folder_search'
export type SearchScopeKind = 'global' | 'current_notebook' | 'current_folder_subtree'

export interface SearchScopeResolverInput {
  entryId: string
  notebookId?: unknown
  folderRelativePath?: unknown
}

export type SearchScope =
  | { kind: 'global' }
  | { kind: 'current_notebook'; notebookId: string }
  | { kind: 'current_folder_subtree'; notebookId: string; folderRelativePath: string | null }

export type SearchScopeResolveErrorCode =
  | 'SEARCH_SCOPE_ENTRY_UNREGISTERED'
  | 'SEARCH_SCOPE_NOTEBOOK_REQUIRED'

export type SearchScopeResolveResult =
  | { success: true; scope: SearchScope }
  | { success: false; errorCode: SearchScopeResolveErrorCode }

const SEARCH_SCOPE_FOLDER_RELATIVE_PATH_MAX_LENGTH = 4096

const ENTRY_SCOPE_KIND: Record<SearchEntryId, SearchScopeKind> = {
  global_search: 'global',
  notebook_search: 'current_notebook',
  folder_search: 'current_folder_subtree',
}

function normalizeFolderRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const rawPath = value
  if (rawPath.includes('\0')) return null
  if (rawPath.length > SEARCH_SCOPE_FOLDER_RELATIVE_PATH_MAX_LENGTH) return null
  if (!rawPath.trim()) return null

  const normalized = normalizeRelativeSlashPath(rawPath)
  if (normalized.length > SEARCH_SCOPE_FOLDER_RELATIVE_PATH_MAX_LENGTH) return null
  if (!normalized) return null

  const normalizedSegments = normalized
    .split('/')
    .filter((segment) => segment.length > 0)
  if (normalizedSegments.includes('..')) {
    return normalized
  }

  const canonicalized = posix.normalize(normalized)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  if (
    !canonicalized
    || canonicalized === '.'
    || canonicalized === '..'
    || canonicalized.startsWith('../')
  ) {
    return null
  }
  return canonicalized
}

export function resolveSearchScope(input: SearchScopeResolverInput): SearchScopeResolveResult {
  const kind = ENTRY_SCOPE_KIND[input.entryId as SearchEntryId]
  if (!kind) {
    return { success: false, errorCode: 'SEARCH_SCOPE_ENTRY_UNREGISTERED' }
  }

  if (kind === 'global') {
    return { success: true, scope: { kind: 'global' } }
  }

  const notebookId = parseRequiredNotebookIdInput(input.notebookId)
  if (!notebookId) {
    return { success: false, errorCode: 'SEARCH_SCOPE_NOTEBOOK_REQUIRED' }
  }

  if (kind === 'current_notebook') {
    return { success: true, scope: { kind: 'current_notebook', notebookId } }
  }

  return {
    success: true,
    scope: {
      kind: 'current_folder_subtree',
      notebookId,
      folderRelativePath: normalizeFolderRelativePath(input.folderRelativePath),
    },
  }
}
