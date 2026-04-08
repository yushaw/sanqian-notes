import { describe, expect, it, vi } from 'vitest'
import { resolvePersistedUnavailableMountStatus } from '../local-folder-mount-convergence'

describe('local-folder-mount-convergence', () => {
  it('returns fallback when mount lookup dependency is missing', () => {
    const resolved = resolvePersistedUnavailableMountStatus({
      notebookId: 'nb-1',
      fallback: 'missing',
      context: 'test',
    })
    expect(resolved).toBe('missing')
  })

  it('returns persisted unavailable status when available', () => {
    const getMount = vi.fn(() => ({
      root_path: '/tmp/nb-1',
      status: 'permission_required' as const,
    }))

    const resolved = resolvePersistedUnavailableMountStatus({
      getLocalFolderMountByNotebookId: getMount,
      notebookId: 'nb-1',
      fallback: 'missing',
      context: 'test',
    })

    expect(resolved).toBe('permission_required')
    expect(getMount).toHaveBeenCalledWith('nb-1')
  })

  it('falls back when mount lookup throws', () => {
    const log = vi.fn()
    const getMount = vi.fn(() => {
      throw new Error('storage unavailable')
    })

    const resolved = resolvePersistedUnavailableMountStatus({
      getLocalFolderMountByNotebookId: getMount,
      notebookId: 'nb-1',
      fallback: 'missing',
      context: 'test',
      log,
    })

    expect(resolved).toBe('missing')
    expect(log).toHaveBeenCalledTimes(1)
  })
})
