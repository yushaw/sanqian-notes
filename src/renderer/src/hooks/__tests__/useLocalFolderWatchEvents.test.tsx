/**
 * useLocalFolderWatchEvents regression tests
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLocalFolderWatchEvents } from '../useLocalFolderWatchEvents'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}))

vi.mock('../../utils/toast', () => ({
  toast: mocks.toast,
}))

type WatchEvent = {
  notebook_id: string
  status: 'active' | 'missing' | 'permission_required'
  reason?: 'status_changed' | 'content_changed' | 'rescan_required'
  sequence?: number
  changed_relative_path?: string | null
}

function createOptions(overrides?: Partial<Parameters<typeof useLocalFolderWatchEvents>[0]>) {
  return {
    allViewLocalEditorTarget: null,
    localNotebookIdsRef: { current: new Set<string>(['nb-1', 'nb-2']) },
    selectedNotebookId: 'nb-1',
    isLocalFolderNotebookSelected: true,
    localFolderMissingText: 'missing',
    localFolderPermissionRequiredText: 'permission required',
    refreshLocalFolderTree: vi.fn(async () => null),
    refreshOpenLocalFileFromDisk: vi.fn(async () => undefined),
    onLocalMountUnavailable: vi.fn(),
    localWatchRefreshTimersRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
    localWatchRefreshSuppressUntilRef: { current: new Map<string, number>() },
    localStatusToastAtRef: { current: new Map<string, number>() },
    localWatchSequenceRef: { current: new Map<string, number>() },
    setLocalFolderStatuses: vi.fn(),
    setLocalFolderTreeDirty: vi.fn(),
    setLocalFolderTreeCache: vi.fn(),
    setLocalNotebookNoteCounts: vi.fn(),
    setLocalNotebookHasChildFolders: vi.fn(),
    ...overrides,
  }
}

describe('useLocalFolderWatchEvents', () => {
  let changedHandler: ((event: WatchEvent) => void | Promise<void>) | null = null
  const unsubscribe = vi.fn()

  beforeEach(() => {
    changedHandler = null
    unsubscribe.mockReset()
    mocks.toast.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-26T00:00:00.000Z'))

    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        localFolder: {
          onChanged: vi.fn((callback: (event: WatchEvent) => void | Promise<void>) => {
            changedHandler = callback
            return unsubscribe
          }),
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces active watch refresh and ignores stale sequence events', async () => {
    const options = createOptions()
    renderHook(() => useLocalFolderWatchEvents(options))

    expect(changedHandler).toBeTypeOf('function')
    if (!changedHandler) return

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 2,
        changed_relative_path: 'docs/a.md',
      })
    })
    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 1,
        changed_relative_path: 'docs/b.md',
      })
    })

    expect(options.refreshLocalFolderTree).not.toHaveBeenCalled()
    expect(options.refreshOpenLocalFileFromDisk).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(180)
    })

    expect(options.refreshLocalFolderTree).toHaveBeenCalledWith('nb-1', { showLoading: false })
    expect(options.refreshOpenLocalFileFromDisk).toHaveBeenCalledWith({
      changedRelativePath: 'docs/a.md',
    })
  })

  it('degrades state and throttles status toast when mount becomes unavailable', async () => {
    const setLocalFolderTreeCache = vi.fn()
    const options = createOptions({
      setLocalFolderTreeCache,
    })
    renderHook(() => useLocalFolderWatchEvents(options))

    expect(changedHandler).toBeTypeOf('function')
    if (!changedHandler) return

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-1',
        status: 'permission_required',
        reason: 'status_changed',
        sequence: 1,
      })
    })
    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-1',
        status: 'permission_required',
        reason: 'status_changed',
        sequence: 2,
      })
    })

    expect(options.onLocalMountUnavailable).toHaveBeenCalledTimes(2)
    expect(options.onLocalMountUnavailable).toHaveBeenCalledWith('nb-1')
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('permission required', { type: 'error' })

    const cacheUpdater = setLocalFolderTreeCache.mock.calls[0]?.[0] as ((prev: Record<string, unknown>) => Record<string, unknown>) | undefined
    expect(cacheUpdater).toBeTypeOf('function')
    if (cacheUpdater) {
      expect(cacheUpdater({ 'nb-1': { tree: [] }, keep: { tree: [] } })).toEqual({ keep: { tree: [] } })
    }
  })

  it('cancels pending refresh timer when active mount becomes unavailable', async () => {
    const options = createOptions()
    renderHook(() => useLocalFolderWatchEvents(options))

    expect(changedHandler).toBeTypeOf('function')
    if (!changedHandler) return

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        sequence: 1,
        changed_relative_path: 'docs/a.md',
      })
    })
    expect(options.localWatchRefreshTimersRef.current.has('nb-1')).toBe(true)

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-1',
        status: 'missing',
        reason: 'status_changed',
        sequence: 2,
      })
    })

    expect(options.onLocalMountUnavailable).toHaveBeenCalledWith('nb-1')
    expect(options.localWatchRefreshTimersRef.current.has('nb-1')).toBe(false)

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    expect(options.refreshLocalFolderTree).not.toHaveBeenCalled()
    expect(options.refreshOpenLocalFileFromDisk).not.toHaveBeenCalled()
  })

  it('cancels pending refresh timer for non-active notebook unavailable status', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const timer = setTimeout(() => undefined, 10000)
    const options = createOptions({
      selectedNotebookId: 'nb-1',
      localWatchRefreshTimersRef: {
        current: new Map<string, ReturnType<typeof setTimeout>>([['nb-2', timer]]),
      },
      localWatchRefreshSuppressUntilRef: {
        current: new Map<string, number>([['nb-2', Date.now() + 1000]]),
      },
    })
    renderHook(() => useLocalFolderWatchEvents(options))

    expect(changedHandler).toBeTypeOf('function')
    if (!changedHandler) return

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-2',
        status: 'permission_required',
        reason: 'status_changed',
        sequence: 1,
      })
    })

    expect(options.onLocalMountUnavailable).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
    expect(options.localWatchRefreshTimersRef.current.has('nb-2')).toBe(false)
    expect(options.localWatchRefreshSuppressUntilRef.current.has('nb-2')).toBe(false)
  })

  it('ignores events from unknown local notebook and clears stale runtime markers', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const timer = setTimeout(() => undefined, 10000)
    const options = createOptions({
      localNotebookIdsRef: { current: new Set<string>(['nb-1']) },
      localWatchRefreshTimersRef: {
        current: new Map<string, ReturnType<typeof setTimeout>>([['ghost', timer]]),
      },
      localWatchRefreshSuppressUntilRef: {
        current: new Map<string, number>([['ghost', Date.now() + 1000]]),
      },
      localStatusToastAtRef: {
        current: new Map<string, number>([['ghost:missing', 100]]),
      },
      localWatchSequenceRef: {
        current: new Map<string, number>([['ghost', 7]]),
      },
      setLocalFolderStatuses: vi.fn(),
    })
    renderHook(() => useLocalFolderWatchEvents(options))

    expect(changedHandler).toBeTypeOf('function')
    if (!changedHandler) return

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'ghost',
        status: 'active',
        reason: 'content_changed',
        sequence: 8,
        changed_relative_path: 'docs/a.md',
      })
    })

    expect(options.setLocalFolderStatuses).not.toHaveBeenCalled()
    expect(options.refreshLocalFolderTree).not.toHaveBeenCalled()
    expect(options.refreshOpenLocalFileFromDisk).not.toHaveBeenCalled()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer)
    expect(options.localWatchRefreshTimersRef.current.has('ghost')).toBe(false)
    expect(options.localWatchRefreshSuppressUntilRef.current.has('ghost')).toBe(false)
    expect(options.localWatchSequenceRef.current.has('ghost')).toBe(false)
    expect(options.localStatusToastAtRef.current.has('ghost:missing')).toBe(false)
  })

  it('ignores unavailable status updates for non-active notebook context', async () => {
    const options = createOptions({
      selectedNotebookId: 'nb-1',
      allViewLocalEditorTarget: null,
    })
    renderHook(() => useLocalFolderWatchEvents(options))

    expect(changedHandler).toBeTypeOf('function')
    if (!changedHandler) return

    await act(async () => {
      await changedHandler?.({
        notebook_id: 'nb-2',
        status: 'missing',
        reason: 'status_changed',
        sequence: 1,
      })
    })

    expect(options.onLocalMountUnavailable).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('cleanup clears timer snapshot instead of mutable ref current', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const timerA = setTimeout(() => undefined, 10000)
    const timerB = setTimeout(() => undefined, 10000)
    const timersRef = {
      current: new Map<string, ReturnType<typeof setTimeout>>([['nb-1', timerA]]),
    }
    const options = createOptions({
      localWatchRefreshTimersRef: timersRef,
    })

    const { unmount } = renderHook(() => useLocalFolderWatchEvents(options))
    timersRef.current = new Map<string, ReturnType<typeof setTimeout>>([['nb-2', timerB]])

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerA)
    expect(clearTimeoutSpy).not.toHaveBeenCalledWith(timerB)
  })
})
