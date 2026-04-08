import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../../shared/types'

vi.mock('../../database', () => ({
  getLocalFolderMounts: vi.fn(() => []),
  getLocalNoteIdentityByUid: vi.fn(() => null),
}))

vi.mock('../../local-folder', () => ({
  scanLocalFolderMount: vi.fn(),
  scanLocalFolderMountAsync: vi.fn(),
}))

vi.mock('../../note-gateway', () => ({
  buildCanonicalLocalResourceId: vi.fn(() => 'local:mock'),
}))

vi.mock('../../startup-phase', () => ({
  getStartupPhaseState: vi.fn(() => ({
    bootAtMs: 0,
    nowMs: 60_000,
    elapsedMs: 60_000,
    windowMs: 45_000,
    inStartupPhase: false,
  })),
}))

import { scanLocalFolderMount, scanLocalFolderMountAsync } from '../../local-folder'
import { getStartupPhaseState } from '../../startup-phase'
import {
  buildLocalContextCacheKey,
  clearAllLocalCaches,
  getLocalFolderScanWithCacheAsync,
  getLocalOverviewSummaryForMount,
} from './caching'

type MockMount = {
  notebook: {
    id: string
  }
  mount: {
    root_path: string
    canonical_root_path: string
    updated_at: string
    status: 'active' | 'missing' | 'permission_required'
  }
}

function createMount(input: {
  notebookId: string
  rootPath?: string
  canonicalRootPath: string
  updatedAt: string
  status?: 'active' | 'missing' | 'permission_required'
}): MockMount {
  return {
    notebook: {
      id: input.notebookId,
    },
    mount: {
      root_path: input.rootPath ?? input.canonicalRootPath,
      canonical_root_path: input.canonicalRootPath,
      updated_at: input.updatedAt,
      status: input.status ?? 'active',
    },
  }
}

function createActiveMount(
  notebookId: string,
  rootPath: string,
  canonicalRootPath: string = rootPath
): LocalFolderNotebookMount {
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
      root_path: rootPath,
      canonical_root_path: canonicalRootPath,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

function createEmptyScan(notebookId: string, rootPath: string): LocalFolderTreeResult {
  return {
    notebook_id: notebookId,
    root_path: rootPath,
    scanned_at: '2026-01-01T00:00:00.000Z',
    tree: [],
    files: [],
  }
}

function buildLegacyContextCacheKey(
  mounts: MockMount[],
  query: string
): string {
  const signature = mounts
    .map((mount) => [
      mount.notebook.id,
      mount.mount.canonical_root_path,
      mount.mount.updated_at,
      mount.mount.status,
    ].join('|'))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .join('\n')
  return `${query}\n${signature}`
}

describe('buildLocalContextCacheKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearAllLocalCaches()
  })

  it('is stable across mount order', () => {
    const mountA = createMount({
      notebookId: 'nb-1',
      canonicalRootPath: '/tmp/a',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const mountB = createMount({
      notebookId: 'nb-2',
      canonicalRootPath: '/tmp/b',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    const keyAB = buildLocalContextCacheKey(
      [mountA, mountB] as unknown as LocalFolderNotebookMount[],
      'alpha'
    )
    const keyBA = buildLocalContextCacheKey(
      [mountB, mountA] as unknown as LocalFolderNotebookMount[],
      'alpha'
    )
    expect(keyAB).toBe(keyBA)
  })

  it('avoids delimiter-collision scenarios possible with legacy key concatenation', () => {
    const mountA = createMount({
      notebookId: 'a',
      canonicalRootPath: 'b',
      updatedAt: 'c',
      status: 'active',
    })
    const mountB = createMount({
      notebookId: 'e',
      canonicalRootPath: 'f',
      updatedAt: 'g',
      status: 'active',
    })

    const mounts1 = [mountA, mountB]
    const query1 = 'x'

    const mounts2 = [mountB]
    const query2 = 'x\na|b|c|active'

    const legacyKey1 = buildLegacyContextCacheKey(mounts1, query1)
    const legacyKey2 = buildLegacyContextCacheKey(mounts2, query2)
    expect(legacyKey1).toBe(legacyKey2)

    const key1 = buildLocalContextCacheKey(
      mounts1 as unknown as LocalFolderNotebookMount[],
      query1
    )
    const key2 = buildLocalContextCacheKey(
      mounts2 as unknown as LocalFolderNotebookMount[],
      query2
    )
    expect(key1).not.toBe(key2)
  })

  it('falls back to root path in signature when canonical root is blank', () => {
    const mountA = createMount({
      notebookId: 'nb-1',
      rootPath: '/tmp/root-a',
      canonicalRootPath: '   ',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
    const mountB = createMount({
      notebookId: 'nb-1',
      rootPath: '/tmp/root-b',
      canonicalRootPath: '   ',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })

    const keyA = buildLocalContextCacheKey([mountA] as unknown as LocalFolderNotebookMount[], 'alpha')
    const keyB = buildLocalContextCacheKey([mountB] as unknown as LocalFolderNotebookMount[], 'alpha')
    expect(keyA).not.toBe(keyB)
  })
})

describe('getLocalFolderScanWithCacheAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearAllLocalCaches()
  })

  it('reuses cached scan within ttl', async () => {
    const mount = createActiveMount('nb-1', '/tmp/nb-1')
    const scanned = createEmptyScan('nb-1', '/tmp/nb-1')
    vi.mocked(scanLocalFolderMountAsync).mockResolvedValue(scanned)

    const first = await getLocalFolderScanWithCacheAsync(mount)
    const second = await getLocalFolderScanWithCacheAsync(mount)

    expect(first).toEqual(scanned)
    expect(second).toEqual(scanned)
    expect(scanLocalFolderMountAsync).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent scan requests for the same mount', async () => {
    const mount = createActiveMount('nb-2', '/tmp/nb-2')
    const scanned = createEmptyScan('nb-2', '/tmp/nb-2')

    let resolveScan!: (value: LocalFolderTreeResult) => void
    const scanPromise = new Promise<LocalFolderTreeResult>((resolve) => {
      resolveScan = resolve
    })
    vi.mocked(scanLocalFolderMountAsync).mockReturnValue(scanPromise)

    const first = getLocalFolderScanWithCacheAsync(mount)
    const second = getLocalFolderScanWithCacheAsync(mount)
    expect(scanLocalFolderMountAsync).toHaveBeenCalledTimes(1)

    resolveScan(scanned)
    await expect(Promise.all([first, second])).resolves.toEqual([scanned, scanned])
  })

  it('reuses scan cache when root alias changes but canonical root stays the same', async () => {
    const firstMount = createActiveMount('nb-5', '/Volumes/alias-a', '/data/notes')
    const secondMount = createActiveMount('nb-5', '/Volumes/alias-b', '/data/notes')
    const scanned = createEmptyScan('nb-5', '/Volumes/alias-a')
    vi.mocked(scanLocalFolderMountAsync).mockResolvedValue(scanned)

    const first = await getLocalFolderScanWithCacheAsync(firstMount)
    const second = await getLocalFolderScanWithCacheAsync(secondMount)

    expect(first).toEqual(scanned)
    expect(second).toEqual(scanned)
    expect(scanLocalFolderMountAsync).toHaveBeenCalledTimes(1)
  })

  it('does not reuse scan cache when canonical root is blank and root path changes', async () => {
    const firstMount = createActiveMount('nb-7', '/tmp/root-a', '   ')
    const secondMount = createActiveMount('nb-7', '/tmp/root-b', '   ')
    const firstScan = createEmptyScan('nb-7', '/tmp/root-a')
    const secondScan = createEmptyScan('nb-7', '/tmp/root-b')
    vi.mocked(scanLocalFolderMountAsync)
      .mockResolvedValueOnce(firstScan)
      .mockResolvedValueOnce(secondScan)

    const first = await getLocalFolderScanWithCacheAsync(firstMount)
    const second = await getLocalFolderScanWithCacheAsync(secondMount)

    expect(first).toEqual(firstScan)
    expect(second).toEqual(secondScan)
    expect(scanLocalFolderMountAsync).toHaveBeenCalledTimes(2)
  })
})

describe('getLocalOverviewSummaryForMount startup guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearAllLocalCaches()
  })

  it('skips sync scan during startup window when no cached overview exists', () => {
    vi.mocked(getStartupPhaseState).mockReturnValue({
      bootAtMs: 0,
      nowMs: 1_000,
      elapsedMs: 1_000,
      windowMs: 45_000,
      inStartupPhase: true,
    })
    const mount = createActiveMount('nb-3', '/tmp/nb-3')

    const result = getLocalOverviewSummaryForMount(mount, 3)
    expect(result).toBeNull()
    expect(scanLocalFolderMount).not.toHaveBeenCalled()
  })

  it('performs sync scan after startup window', () => {
    vi.mocked(getStartupPhaseState).mockReturnValue({
      bootAtMs: 0,
      nowMs: 60_000,
      elapsedMs: 60_000,
      windowMs: 45_000,
      inStartupPhase: false,
    })
    const mount = createActiveMount('nb-4', '/tmp/nb-4')
    const scanned = createEmptyScan('nb-4', '/tmp/nb-4')
    vi.mocked(scanLocalFolderMount).mockReturnValue(scanned)

    const result = getLocalOverviewSummaryForMount(mount, 3)
    expect(result).toMatchObject({ fileCount: 0, recentItems: [] })
    expect(scanLocalFolderMount).toHaveBeenCalledTimes(1)
  })

  it('reuses overview cache when root alias changes but canonical root stays the same', () => {
    const firstMount = createActiveMount('nb-6', '/Volumes/alias-a', '/data/notes')
    const secondMount = createActiveMount('nb-6', '/Volumes/alias-b', '/data/notes')
    const scanned = createEmptyScan('nb-6', '/Volumes/alias-a')
    vi.mocked(scanLocalFolderMount).mockReturnValue(scanned)

    const first = getLocalOverviewSummaryForMount(firstMount, 3)
    const second = getLocalOverviewSummaryForMount(secondMount, 3)

    expect(first).toMatchObject({ fileCount: 0, recentItems: [] })
    expect(second).toMatchObject({ fileCount: 0, recentItems: [] })
    expect(scanLocalFolderMount).toHaveBeenCalledTimes(1)
  })
})
