import { describe, expect, it } from 'vitest'
import { resolveSearchScope } from '../search-scope'

describe('resolveSearchScope', () => {
  it('resolves global entry', () => {
    const result = resolveSearchScope({ entryId: 'global_search' })
    expect(result).toEqual({
      success: true,
      scope: { kind: 'global' },
    })
  })

  it('rejects unregistered entry', () => {
    const result = resolveSearchScope({ entryId: 'unknown_search' })
    expect(result).toEqual({
      success: false,
      errorCode: 'SEARCH_SCOPE_ENTRY_UNREGISTERED',
    })
  })

  it('resolves notebook scope with notebook id', () => {
    const result = resolveSearchScope({
      entryId: 'notebook_search',
      notebookId: 'nb-1',
    })

    expect(result).toEqual({
      success: true,
      scope: { kind: 'current_notebook', notebookId: 'nb-1' },
    })
  })

  it('rejects notebook scope without notebook id', () => {
    const result = resolveSearchScope({
      entryId: 'notebook_search',
      notebookId: '   ',
    })
    expect(result).toEqual({
      success: false,
      errorCode: 'SEARCH_SCOPE_NOTEBOOK_REQUIRED',
    })
  })

  it('resolves folder scope and normalizes empty folder path to null', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: '   ',
    })
    expect(result).toEqual({
      success: true,
      scope: {
        kind: 'current_folder_subtree',
        notebookId: 'nb-2',
        folderRelativePath: null,
      },
    })
  })
})

