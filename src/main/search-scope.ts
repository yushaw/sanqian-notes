export type SearchEntryId = 'global_search' | 'notebook_search' | 'folder_search'
export type SearchScopeKind = 'global' | 'current_notebook' | 'current_folder_subtree'

export interface SearchScopeResolverInput {
  entryId: string
  notebookId?: string | null
  folderRelativePath?: string | null
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

const ENTRY_SCOPE_KIND: Record<SearchEntryId, SearchScopeKind> = {
  global_search: 'global',
  notebook_search: 'current_notebook',
  folder_search: 'current_folder_subtree',
}

function normalizeNotebookId(value: string | null | undefined): string | null {
  const normalized = value?.trim() || ''
  return normalized || null
}

function normalizeFolderRelativePath(value: string | null | undefined): string | null {
  const normalized = value?.trim() || ''
  return normalized || null
}

export function resolveSearchScope(input: SearchScopeResolverInput): SearchScopeResolveResult {
  const kind = ENTRY_SCOPE_KIND[input.entryId as SearchEntryId]
  if (!kind) {
    return { success: false, errorCode: 'SEARCH_SCOPE_ENTRY_UNREGISTERED' }
  }

  if (kind === 'global') {
    return { success: true, scope: { kind: 'global' } }
  }

  const notebookId = normalizeNotebookId(input.notebookId)
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

