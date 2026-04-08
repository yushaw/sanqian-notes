import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../database', () => ({
  getNotebooks: vi.fn(() => []),
  getLocalFolderMounts: vi.fn(() => []),
  getLocalNoteMetadata: vi.fn(() => null),
}))

vi.mock('../../embedding/semantic-search', () => ({
  hybridSearch: vi.fn(async () => []),
}))

vi.mock('../../i18n', () => ({
  t: () => ({
    common: {
      unknownError: 'Unknown error',
    },
    tools: {
      searchNotes: {
        description: 'Search notes',
        queryDesc: 'query',
        notebookIdDesc: 'notebook',
        folderPathDesc: 'folder',
        limitDesc: 'limit',
        folderScopeRequiresNotebook: 'folder scope requires notebook_id',
        folderScopeOnlyForLocalNotebook: 'folder scope only for local notebook',
        notebookNotFound: 'Notebook not found',
        error: 'Search failed',
      },
      getNotebooks: {
        description: 'Get notebooks',
        error: 'Get notebooks failed',
      },
    },
  }),
}))

vi.mock('../../markdown', () => ({
  jsonToMarkdownWithMeta: vi.fn(() => ({ markdown: '', metadata: {} })),
  countWords: vi.fn(() => 0),
  getAllHeadingsFromJson: vi.fn(() => []),
}))

vi.mock('../../note-gateway', () => ({
  buildInternalEtag: vi.fn(() => 'etag'),
  resolveNoteResourceAsync: vi.fn(async () => ({ ok: false as const })),
  buildCanonicalLocalResourceId: vi.fn((input: { notebookId: string; relativePath: string }) => `local:${input.notebookId}:${input.relativePath}`),
}))

vi.mock('../../local-note-tags', () => ({
  extractLocalTagNamesFromTiptapContent: vi.fn(() => []),
}))

vi.mock('../helpers/error-mapping', () => {
  class ToolError extends Error {}
  return {
    buildLocalEtagFromFile: vi.fn(() => 'etag'),
    ToolError,
  }
})

vi.mock('../helpers/note-link', () => ({
  generateNoteLink: vi.fn(() => '#'),
}))

vi.mock('../helpers/local-note-helpers', () => ({
  getLocalSummaryByPath: vi.fn(() => null),
  getLocalPinFavoriteByPath: vi.fn(() => ({ isPinned: false, isFavorite: false })),
}))

vi.mock('../helpers/search-helpers', () => ({
  buildHybridSearchResultItems: vi.fn(() => []),
  mergeSearchResultItems: vi.fn((items: unknown[]) => items),
  buildLocalSearchResultItems: vi.fn(async () => []),
}))

vi.mock('../helpers/context-overview-helpers', () => ({
  getNotebookNoteCountsForAgent: vi.fn(() => []),
  getNotebookNoteCountsForAgentAsync: vi.fn(async () => []),
}))

import { getNotebooks } from '../../database'
import { getLocalFolderMounts } from '../../database'
import { hybridSearch } from '../../embedding/semantic-search'
import { buildLocalSearchResultItems } from '../helpers/search-helpers'
import { getNotebookNoteCountsForAgentAsync } from '../helpers/context-overview-helpers'
import { buildGetNotebooksTool, buildSearchNotesTool } from './read'

describe('buildSearchNotesTool notebook scope validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getNotebooks).mockReturnValue([])
    vi.mocked(hybridSearch).mockResolvedValue([])
    vi.mocked(buildLocalSearchResultItems).mockResolvedValue([])
  })

  it('rejects explicit blank notebook_id instead of broadening to global search', async () => {
    const tool = buildSearchNotesTool()

    await expect(tool.handler({ query: 'alpha', notebook_id: '' })).rejects.toThrow('Notebook not found:')
    expect(hybridSearch).not.toHaveBeenCalled()
    expect(buildLocalSearchResultItems).not.toHaveBeenCalled()
  })

  it('keeps global search behavior when notebook_id is omitted', async () => {
    const tool = buildSearchNotesTool()

    await expect(tool.handler({ query: 'alpha' })).resolves.toEqual([])
    expect(hybridSearch).toHaveBeenCalledWith('alpha', { limit: 20 })
    expect(buildLocalSearchResultItems).toHaveBeenCalledTimes(1)
  })

  it('treats explicit undefined notebook_id as omitted (global search)', async () => {
    const tool = buildSearchNotesTool()

    await expect(tool.handler({ query: 'alpha', notebook_id: undefined })).resolves.toEqual([])
    expect(hybridSearch).toHaveBeenCalledWith('alpha', { limit: 20 })
    expect(buildLocalSearchResultItems).toHaveBeenCalledTimes(1)
  })

  it('fails closed when query is not a string', async () => {
    const tool = buildSearchNotesTool()

    await expect(tool.handler({ query: 123 as unknown as string })).resolves.toEqual([])
    expect(hybridSearch).not.toHaveBeenCalled()
    expect(buildLocalSearchResultItems).not.toHaveBeenCalled()
  })

  it('normalizes invalid limit values to bounded positive limits', async () => {
    const tool = buildSearchNotesTool()

    await expect(tool.handler({ query: 'alpha', limit: -1 })).resolves.toEqual([])
    expect(hybridSearch).toHaveBeenLastCalledWith('alpha', { limit: 20 })

    await expect(tool.handler({ query: 'alpha', limit: 500 })).resolves.toEqual([])
    expect(hybridSearch).toHaveBeenLastCalledWith('alpha', { limit: 100 })
  })
})

describe('buildGetNotebooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads note counts via async helper and maps local mount status', async () => {
    vi.mocked(getNotebooks).mockReturnValue([
      {
        id: 'nb-internal',
        name: 'Internal',
        icon: 'logo:notes',
        source_type: 'internal',
        order_index: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      } as any,
      {
        id: 'nb-local',
        name: 'Local',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-02T00:00:00.000Z',
      } as any,
    ])
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: {
          id: 'nb-local',
          name: 'Local',
          icon: 'logo:notes',
          source_type: 'local-folder',
          order_index: 1,
          created_at: '2026-01-02T00:00:00.000Z',
        },
        mount: {
          notebook_id: 'nb-local',
          root_path: '/tmp/local',
          canonical_root_path: '/tmp/local',
          status: 'permission_required',
          created_at: '2026-01-02T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      } as any,
    ])
    vi.mocked(getNotebookNoteCountsForAgentAsync).mockResolvedValue({
      'nb-internal': 3,
      'nb-local': 8,
    })

    const tool = buildGetNotebooksTool()
    const result = await tool.handler({})

    expect(getNotebookNoteCountsForAgentAsync).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      {
        source_type: 'internal',
        status: 'active',
        writable: true,
        id: 'nb-internal',
        name: 'Internal',
        note_count: 3,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        source_type: 'local-folder',
        status: 'permission_required',
        writable: false,
        id: 'nb-local',
        name: 'Local',
        note_count: 8,
        created_at: '2026-01-02T00:00:00.000Z',
      },
    ])
  })
})
