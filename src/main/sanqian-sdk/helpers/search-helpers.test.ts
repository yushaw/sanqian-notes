import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  LocalFolderTreeResult,
} from '../../../shared/types'
import { getLocalFolderMounts } from '../../database'
import { searchLocalFolderMountAsync } from '../../local-folder'
import { getLocalFolderScanWithCacheAsync } from './caching'
import { buildLocalSearchResultItems } from './search-helpers'

vi.mock('../../database', () => ({
  getLocalFolderMounts: vi.fn(),
}))

vi.mock('../../note-gateway', () => ({
  resolveNoteResourceAsync: vi.fn(async () => ({ ok: false as const })),
  buildCanonicalLocalResourceId: vi.fn((input: { notebookId: string; relativePath: string }) =>
    `local:${input.notebookId}:${input.relativePath}`
  ),
}))

vi.mock('../../local-folder', () => ({
  searchLocalFolderMountAsync: vi.fn(),
  dedupeLocalFolderSearchHits: vi.fn((hits: LocalFolderSearchHit[]) => hits),
}))

vi.mock('./local-note-helpers', () => ({
  buildLocalNoteMetadataByIdMap: vi.fn(() => new Map()),
  getLocalNoteMetadataFromMap: vi.fn(() => null),
}))

vi.mock('./caching', () => ({
  resolveLocalNotebookIdFromAnyId: vi.fn(() => null),
  getLocalFolderScanWithCacheAsync: vi.fn(),
  pruneLocalFolderScanCache: vi.fn(),
  pruneLocalOverviewSummaryCache: vi.fn(),
  buildLocalCanonicalPath: vi.fn((base: string, relativePath: string) => `${base}/${relativePath}`),
  buildLocalContextCacheKey: vi.fn(() => 'cache-key'),
  getCachedLocalContextSourceItems: vi.fn(() => null),
  setCachedLocalContextSourceItems: vi.fn(),
  normalizeContextQuery: vi.fn((query: string | undefined) => (query || '').trim()),
  LOCAL_CONTEXT_QUERY_CACHE_TTL_MS: 30_000,
  LOCAL_CONTEXT_BROWSE_CACHE_TTL_MS: 30_000,
}))

function createMount(notebookId: string): LocalFolderNotebookMount {
  return {
    notebook: {
      id: notebookId,
      name: `Notebook ${notebookId}`,
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    mount: {
      notebook_id: notebookId,
      root_path: `/tmp/${notebookId}`,
      canonical_root_path: `/tmp/${notebookId}`,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function createScan(notebookId: string): LocalFolderTreeResult {
  return {
    notebook_id: notebookId,
    root_path: `/tmp/${notebookId}`,
    scanned_at: '2026-01-01T00:00:00.000Z',
    tree: [],
    files: [],
  }
}

describe('buildLocalSearchResultItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount('nb-1')])
    vi.mocked(getLocalFolderScanWithCacheAsync).mockResolvedValue(createScan('nb-1'))
    vi.mocked(searchLocalFolderMountAsync).mockResolvedValue([
      {
        notebook_id: 'nb-1',
        relative_path: ' docs/plan.md',
        canonical_path: '/tmp/nb-1/ docs/plan.md',
        score: 1,
        mtime_ms: 1,
        snippet: 'match',
      },
    ])
  })

  it('preserves surrounding spaces in folder scope when collecting local hits', async () => {
    await buildLocalSearchResultItems(
      'alpha',
      new Map([['nb-1', 'Notebook nb-1']]),
      'nb-1',
      ' docs'
    )

    expect(searchLocalFolderMountAsync).toHaveBeenCalledWith(
      expect.objectContaining({ notebook: expect.objectContaining({ id: 'nb-1' }) }),
      'alpha',
      ' docs',
      expect.any(Object)
    )
  })

  it('normalizes blank folder scope to null while keeping non-blank raw value unchanged', async () => {
    await buildLocalSearchResultItems(
      'alpha',
      new Map([['nb-1', 'Notebook nb-1']]),
      'nb-1',
      '   '
    )

    expect(searchLocalFolderMountAsync).toHaveBeenCalledWith(
      expect.objectContaining({ notebook: expect.objectContaining({ id: 'nb-1' }) }),
      'alpha',
      null,
      expect.any(Object)
    )
  })
})
