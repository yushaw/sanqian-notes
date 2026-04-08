import { describe, expect, it, vi } from 'vitest'
import { applyLocalFolderMountStatusTransition } from '../local-folder-mount-transition'

describe('local-folder-mount-transition', () => {
  it('updates status and emits default status_changed + full index sync', () => {
    const update = vi.fn(() => 'updated' as const)
    const enqueue = vi.fn()
    const schedule = vi.fn()

    const result = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus: update,
      enqueueLocalNotebookIndexSync: enqueue,
      scheduleLocalFolderWatchEvent: schedule,
      notebookId: 'nb-1',
      status: 'missing',
      context: 'test',
    })

    expect(result).toEqual({
      ok: true,
      changed: true,
      updateResult: 'updated',
    })
    expect(update).toHaveBeenCalledWith('nb-1', 'missing')
    expect(enqueue).toHaveBeenCalledWith('nb-1', { full: true })
    expect(schedule).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
      changed_relative_path: null,
    })
  })

  it('supports disabling enqueue/event for status-only transitions', () => {
    const update = vi.fn(() => 'updated' as const)
    const enqueue = vi.fn()
    const schedule = vi.fn()

    const result = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus: update,
      enqueueLocalNotebookIndexSync: enqueue,
      scheduleLocalFolderWatchEvent: schedule,
      notebookId: 'nb-1',
      status: 'active',
      context: 'test',
      enqueue: false,
      event: false,
    })

    expect(result).toEqual({
      ok: true,
      changed: true,
      updateResult: 'updated',
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('treats no_change as successful transition without duplicate side-effects', () => {
    const update = vi.fn(() => 'no_change' as const)
    const enqueue = vi.fn()
    const schedule = vi.fn()

    const result = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus: update,
      enqueueLocalNotebookIndexSync: enqueue,
      scheduleLocalFolderWatchEvent: schedule,
      notebookId: 'nb-1',
      status: 'active',
      context: 'test',
    })

    expect(result).toEqual({
      ok: true,
      changed: false,
      updateResult: 'no_change',
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('skips enqueue/event when status update fails', () => {
    const update = vi.fn(() => 'not_found' as const)
    const enqueue = vi.fn()
    const schedule = vi.fn()

    const result = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus: update,
      enqueueLocalNotebookIndexSync: enqueue,
      scheduleLocalFolderWatchEvent: schedule,
      notebookId: 'nb-1',
      status: 'permission_required',
      context: 'test',
      enqueue: { full: true, immediate: true },
    })

    expect(result).toEqual({
      ok: false,
      changed: false,
      updateResult: 'not_found',
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('swallows enqueue/event side-effect failures and still returns true', () => {
    const update = vi.fn(() => 'updated' as const)
    const enqueue = vi.fn(() => { throw new Error('enqueue failed') })
    const schedule = vi.fn(() => { throw new Error('event failed') })
    const log = vi.fn()

    const result = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus: update,
      enqueueLocalNotebookIndexSync: enqueue,
      scheduleLocalFolderWatchEvent: schedule,
      notebookId: 'nb-1',
      status: 'missing',
      context: 'test',
      log,
    })

    expect(result).toEqual({
      ok: true,
      changed: true,
      updateResult: 'updated',
    })
    expect(update).toHaveBeenCalledWith('nb-1', 'missing')
    expect(enqueue).toHaveBeenCalledWith('nb-1', { full: true })
    expect(schedule).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
      changed_relative_path: null,
    })
    expect(log).toHaveBeenCalledTimes(2)
  })
})
