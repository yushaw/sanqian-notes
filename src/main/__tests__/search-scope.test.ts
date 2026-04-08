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

  it('preserves surrounding spaces in notebook id while still requiring non-blank value', () => {
    const result = resolveSearchScope({
      entryId: 'notebook_search',
      notebookId: ' nb-1 ',
    })

    expect(result).toEqual({
      success: true,
      scope: { kind: 'current_notebook', notebookId: ' nb-1 ' },
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

  it('rejects notebook scope when notebook id input is non-string', () => {
    const result = resolveSearchScope({
      entryId: 'notebook_search',
      notebookId: 123,
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

  it('normalizes non-string folder path inputs to null', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: 42,
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

  it('normalizes null-byte folder path input to null', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: 'docs\0design',
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

  it('normalizes oversized folder path input to null', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: 'x'.repeat(4097),
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

  it('canonicalizes folder scope aliases to a stable relative path', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: './docs//design/',
    })
    expect(result).toEqual({
      success: true,
      scope: {
        kind: 'current_folder_subtree',
        notebookId: 'nb-2',
        folderRelativePath: 'docs/design',
      },
    })
  })

  it('preserves surrounding spaces in folder scope paths', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: '  docs//design  ',
    })
    expect(result).toEqual({
      success: true,
      scope: {
        kind: 'current_folder_subtree',
        notebookId: 'nb-2',
        folderRelativePath: '  docs/design  ',
      },
    })
  })

  it('keeps parent-traversal segments instead of collapsing to a different folder', () => {
    const result = resolveSearchScope({
      entryId: 'folder_search',
      notebookId: 'nb-2',
      folderRelativePath: 'docs/../design',
    })
    expect(result).toEqual({
      success: true,
      scope: {
        kind: 'current_folder_subtree',
        notebookId: 'nb-2',
        folderRelativePath: 'docs/../design',
      },
    })
  })
})
