import { describe, expect, it, vi } from 'vitest'
import { safeUpdateLocalFolderMountStatus } from '../local-folder-mount-status'

describe('local-folder-mount-status', () => {
  it('returns normalized update result when no exception is thrown', () => {
    const updateLocalFolderMountStatus = vi.fn(() => 'updated' as const)

    const result = safeUpdateLocalFolderMountStatus({
      updateLocalFolderMountStatus,
      notebookId: 'nb-1',
      status: 'active',
      context: 'test',
    })

    expect(result).toBe('updated')
    expect(updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'active')
  })

  it('returns explicit not_found result when row is missing', () => {
    const updateLocalFolderMountStatus = vi.fn(() => 'not_found' as const)

    const result = safeUpdateLocalFolderMountStatus({
      updateLocalFolderMountStatus,
      notebookId: 'nb-1',
      status: 'missing',
      context: 'test',
    })

    expect(result).toBe('not_found')
  })

  it('swallows exception and returns error', () => {
    const log = vi.fn()
    const updateLocalFolderMountStatus = vi.fn(() => {
      throw new Error('db unavailable')
    })

    const result = safeUpdateLocalFolderMountStatus({
      updateLocalFolderMountStatus,
      notebookId: 'nb-1',
      status: 'permission_required',
      context: 'test',
      log,
    })

    expect(result).toBe('error')
    expect(log).toHaveBeenCalledTimes(1)
  })
})
