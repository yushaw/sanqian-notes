import { describe, expect, it, vi } from 'vitest'
import { convergeRecoveredLocalFolder } from '../localFolderRecovery'

describe('localFolderRecovery', () => {
  it('returns false and does not force active when tree refresh misses after relink', async () => {
    const refreshLocalFolderTree = vi.fn(async () => null)
    const refreshLocalFolderStatuses = vi.fn(async () => {})
    const setLocalFolderStatuses = vi.fn()
    const refreshOpenLocalFileFromDisk = vi.fn(async () => {})
    const notifyRecovered = vi.fn()
    const notifyRecoverFailed = vi.fn()

    const result = await convergeRecoveredLocalFolder({
      notebookId: 'nb-1',
      refreshLocalFolderTree,
      refreshLocalFolderStatuses,
      setLocalFolderStatuses,
      refreshOpenLocalFileFromDisk,
      notifyRecovered,
      notifyRecoverFailed,
    })

    expect(result).toBe(false)
    expect(refreshLocalFolderTree).toHaveBeenCalledWith('nb-1')
    expect(refreshLocalFolderStatuses).toHaveBeenCalledTimes(1)
    expect(setLocalFolderStatuses).not.toHaveBeenCalled()
    expect(refreshOpenLocalFileFromDisk).not.toHaveBeenCalled()
    expect(notifyRecoverFailed).toHaveBeenCalledTimes(1)
    expect(notifyRecovered).not.toHaveBeenCalled()
  })

  it('returns true and promotes status to active only after successful tree refresh', async () => {
    const refreshLocalFolderTree = vi.fn(async () => ({
      notebook_id: 'nb-1',
      root_path: '/root',
      scanned_at: '2025-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    }))
    const refreshLocalFolderStatuses = vi.fn(async () => {})
    let statuses: Record<string, 'active' | 'missing' | 'permission_required'> = { 'nb-1': 'missing' }
    const setLocalFolderStatuses = vi.fn((updater: (prev: typeof statuses) => typeof statuses) => {
      statuses = updater(statuses)
    })
    const refreshOpenLocalFileFromDisk = vi.fn(async () => {})
    const notifyRecovered = vi.fn()
    const notifyRecoverFailed = vi.fn()

    const result = await convergeRecoveredLocalFolder({
      notebookId: 'nb-1',
      refreshLocalFolderTree,
      refreshLocalFolderStatuses,
      setLocalFolderStatuses,
      refreshOpenLocalFileFromDisk,
      notifyRecovered,
      notifyRecoverFailed,
    })

    expect(result).toBe(true)
    expect(statuses['nb-1']).toBe('active')
    expect(refreshOpenLocalFileFromDisk).toHaveBeenCalledTimes(1)
    expect(notifyRecovered).toHaveBeenCalledTimes(1)
    expect(notifyRecoverFailed).not.toHaveBeenCalled()
    expect(refreshLocalFolderStatuses).not.toHaveBeenCalled()
  })

  it('swallows open-file refresh errors after successful recovery convergence', async () => {
    const refreshLocalFolderTree = vi.fn(async () => ({
      notebook_id: 'nb-1',
      root_path: '/root',
      scanned_at: '2025-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    }))
    const refreshLocalFolderStatuses = vi.fn(async () => {})
    const setLocalFolderStatuses = vi.fn((updater: (prev: Record<string, 'active' | 'missing' | 'permission_required'>) => Record<string, 'active' | 'missing' | 'permission_required'>) => {
      updater({ 'nb-1': 'missing' })
    })
    const refreshOpenLocalFileFromDisk = vi.fn(async () => {
      throw new Error('open file refresh failed')
    })
    const notifyRecovered = vi.fn()
    const notifyRecoverFailed = vi.fn()
    const log = vi.fn()

    const result = await convergeRecoveredLocalFolder({
      notebookId: 'nb-1',
      refreshLocalFolderTree,
      refreshLocalFolderStatuses,
      setLocalFolderStatuses,
      refreshOpenLocalFileFromDisk,
      notifyRecovered,
      notifyRecoverFailed,
      log,
    })

    expect(result).toBe(true)
    expect(log).toHaveBeenCalledWith(
      '[local-folder] failed to refresh open local file from disk after relink:',
      expect.any(Error)
    )
    expect(notifyRecovered).toHaveBeenCalledTimes(1)
    expect(notifyRecoverFailed).not.toHaveBeenCalled()
  })

  it('treats tree refresh exception as recover-failed convergence', async () => {
    const refreshLocalFolderTree = vi.fn(async () => {
      throw new Error('tree refresh failed')
    })
    const refreshLocalFolderStatuses = vi.fn(async () => {})
    const setLocalFolderStatuses = vi.fn()
    const refreshOpenLocalFileFromDisk = vi.fn(async () => {})
    const notifyRecovered = vi.fn()
    const notifyRecoverFailed = vi.fn()
    const log = vi.fn()

    const result = await convergeRecoveredLocalFolder({
      notebookId: 'nb-1',
      refreshLocalFolderTree,
      refreshLocalFolderStatuses,
      setLocalFolderStatuses,
      refreshOpenLocalFileFromDisk,
      notifyRecovered,
      notifyRecoverFailed,
      log,
    })

    expect(result).toBe(false)
    expect(log).toHaveBeenCalledWith(
      '[local-folder] failed to refresh tree during relink convergence:',
      expect.any(Error)
    )
    expect(refreshLocalFolderStatuses).toHaveBeenCalledTimes(1)
    expect(setLocalFolderStatuses).not.toHaveBeenCalled()
    expect(refreshOpenLocalFileFromDisk).not.toHaveBeenCalled()
    expect(notifyRecoverFailed).toHaveBeenCalledTimes(1)
    expect(notifyRecovered).not.toHaveBeenCalled()
  })
})
