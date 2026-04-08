import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import {
  createFileSystemWatcher,
  createLocalFolderWatchScheduler,
  isRecoverableWatchError,
  resolveMountStatusFromFsError,
} from '../local-folder-watch'

describe('local-folder-watch', () => {
  it('maps fs permission errors to permission_required', () => {
    expect(resolveMountStatusFromFsError({ code: 'EACCES' })).toBe('permission_required')
    expect(resolveMountStatusFromFsError({ code: 'EPERM' })).toBe('permission_required')
  })

  it('maps unknown fs errors to missing', () => {
    expect(resolveMountStatusFromFsError({ code: 'ENOENT' })).toBe('missing')
    expect(resolveMountStatusFromFsError(new Error('x'))).toBe('missing')
  })

  it('identifies recoverable watcher errors', () => {
    expect(isRecoverableWatchError({ code: 'ENOSPC' })).toBe(true)
    expect(isRecoverableWatchError({ code: 'EMFILE' })).toBe(true)
    expect(isRecoverableWatchError({ code: 'ENOENT' })).toBe(false)
  })

  it('debounces watch events per notebook id', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const scheduler = createLocalFolderWatchScheduler(emit, 100)

    scheduler.schedule({ notebook_id: 'nb-1', status: 'active' as const })
    scheduler.schedule({ notebook_id: 'nb-1', status: 'missing' as const })
    vi.advanceTimersByTime(99)
    expect(emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ notebook_id: 'nb-1', status: 'missing' })
    vi.useRealTimers()
  })

  it('clears pending events', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const scheduler = createLocalFolderWatchScheduler(emit, 100)

    scheduler.schedule({ notebook_id: 'nb-1', status: 'active' as const })
    scheduler.clear('nb-1')
    vi.advanceTimersByTime(100)
    expect(emit).not.toHaveBeenCalled()

    scheduler.schedule({ notebook_id: 'nb-2', status: 'missing' as const })
    scheduler.schedule({ notebook_id: 'nb-3', status: 'permission_required' as const })
    scheduler.clearAll()
    vi.advanceTimersByTime(100)
    expect(emit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('keeps queued event when shutdown does not clear pending payload', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const scheduler = createLocalFolderWatchScheduler(emit, 100)

    scheduler.schedule({
      notebook_id: 'nb-1',
      status: 'missing' as const,
      reason: 'status_changed' as const,
    })

    // Simulates stopLocalFolderWatcher(..., { clearPendingEvent: false }):
    // timer remains and queued status event should still emit.
    vi.advanceTimersByTime(100)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
    })
    vi.useRealTimers()
  })

  it('merges pending events when merge handler is provided', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const scheduler = createLocalFolderWatchScheduler(
      emit,
      100,
      (previous, next) => ({
        notebook_id: next.notebook_id,
        status: next.status,
        changed: Array.from(new Set([...(previous.changed || []), ...(next.changed || [])])),
      })
    )

    scheduler.schedule({ notebook_id: 'nb-1', status: 'active' as const, changed: ['a.md'] })
    scheduler.schedule({ notebook_id: 'nb-1', status: 'active' as const, changed: ['b.md'] })
    vi.advanceTimersByTime(100)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'active',
      changed: ['a.md', 'b.md'],
    })
    vi.useRealTimers()
  })

  it('falls back to non-recursive watch when recursive is unsupported', () => {
    const fakeWatcher = new EventEmitter() as unknown as ReturnType<typeof createFileSystemWatcher>
    ;(fakeWatcher as unknown as { close: () => void }).close = vi.fn()
    const watchFactory = vi.fn()
      .mockImplementationOnce(() => {
        const error = new Error('unsupported recursive watch') as NodeJS.ErrnoException
        error.code = 'ENOSYS'
        throw error
      })
      .mockImplementationOnce(() => fakeWatcher)

    const watcher = createFileSystemWatcher('/tmp/sanqian-local-watch-test', () => {}, watchFactory as never)

    expect(typeof watcher.close).toBe('function')
    expect(watchFactory).toHaveBeenCalledTimes(2)
    expect(watchFactory.mock.calls[0]?.[0]).toBe('/tmp/sanqian-local-watch-test')
    expect(watchFactory.mock.calls[0]?.[1]).toEqual({ recursive: true })
    expect(typeof watchFactory.mock.calls[0]?.[2]).toBe('function')
    expect(watchFactory.mock.calls[1]?.[0]).toBe('/tmp/sanqian-local-watch-test')
    expect(typeof watchFactory.mock.calls[1]?.[1]).toBe('function')
  })

  it('falls back when recursive watch unsupported is surfaced as legacy argument-value error', () => {
    const fakeWatcher = new EventEmitter() as unknown as ReturnType<typeof createFileSystemWatcher>
    ;(fakeWatcher as unknown as { close: () => void }).close = vi.fn()
    const watchFactory = vi.fn()
      .mockImplementationOnce(() => {
        const error = new Error('The feature watch recursively is unavailable on this platform') as NodeJS.ErrnoException
        error.code = 'ERR_INVALID_ARG_VALUE'
        throw error
      })
      .mockImplementationOnce(() => fakeWatcher)

    const watcher = createFileSystemWatcher('/tmp/sanqian-local-watch-test', () => {}, watchFactory as never)

    expect(typeof watcher.close).toBe('function')
    expect(watchFactory).toHaveBeenCalledTimes(2)
    expect(watchFactory.mock.calls[0]?.[1]).toEqual({ recursive: true })
    expect(typeof watchFactory.mock.calls[1]?.[1]).toBe('function')
  })

  it('does not fallback for unrelated argument-value errors', () => {
    const watchFactory = vi.fn().mockImplementationOnce(() => {
      const error = new Error('path must be a string') as NodeJS.ErrnoException
      error.code = 'ERR_INVALID_ARG_VALUE'
      throw error
    })

    expect(() => {
      createFileSystemWatcher('/tmp/sanqian-local-watch-test', () => {}, watchFactory as never)
    }).toThrow('path must be a string')
    expect(watchFactory).toHaveBeenCalledTimes(1)
  })

  it('fallback watcher tracks nested directories and picks up newly-created subfolders', () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'sanqian-local-watch-fallback-'))
    const docsPath = join(dir, 'docs')
    const deepPath = join(docsPath, 'deep')
    mkdirSync(deepPath, { recursive: true })

    const onChanged = vi.fn()
    const watchedListeners = new Map<string, (...args: unknown[]) => void>()

    const watchFactory = vi.fn((targetPath: string, optionsOrListener?: unknown, maybeListener?: unknown) => {
      if (typeof optionsOrListener === 'object' && optionsOrListener !== null && 'recursive' in (optionsOrListener as object)) {
        const error = new Error('unsupported recursive watch') as NodeJS.ErrnoException
        error.code = 'ENOSYS'
        throw error
      }

      const listener = (
        typeof optionsOrListener === 'function'
          ? optionsOrListener
          : typeof maybeListener === 'function'
            ? maybeListener
            : undefined
      ) as ((...args: unknown[]) => void) | undefined
      if (listener) {
        watchedListeners.set(targetPath, listener)
      }

      const watcher = new EventEmitter() as unknown as ReturnType<typeof createFileSystemWatcher>
      ;(watcher as unknown as { close: () => void }).close = vi.fn()
      return watcher
    })

    try {
      const watcher = createFileSystemWatcher(dir, onChanged, watchFactory as never)
      expect(watchedListeners.has(dir)).toBe(true)
      expect(watchedListeners.has(docsPath)).toBe(true)
      expect(watchedListeners.has(deepPath)).toBe(true)

      watchedListeners.get(deepPath)?.('change', 'a.md')
      expect(onChanged).toHaveBeenCalledTimes(1)

      const nestedPath = join(docsPath, 'later')
      mkdirSync(nestedPath, { recursive: true })

      watchedListeners.get(docsPath)?.('rename', 'later')
      vi.advanceTimersByTime(80)
      expect(watchedListeners.has(nestedPath)).toBe(true)

      watcher.close()
    } finally {
      vi.useRealTimers()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fallback watcher close is resilient when child watcher close throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanqian-local-watch-close-'))
    const docsPath = join(dir, 'docs')
    mkdirSync(docsPath, { recursive: true })
    const closeCalls: string[] = []

    const watchFactory = vi.fn((targetPath: string, optionsOrListener?: unknown) => {
      if (typeof optionsOrListener === 'object' && optionsOrListener !== null && 'recursive' in (optionsOrListener as object)) {
        const error = new Error('unsupported recursive watch') as NodeJS.ErrnoException
        error.code = 'ENOSYS'
        throw error
      }

      const watcher = new EventEmitter() as unknown as ReturnType<typeof createFileSystemWatcher>
      ;(watcher as unknown as { close: () => void }).close = vi.fn(() => {
        closeCalls.push(targetPath)
        if (targetPath === dir) {
          throw new Error('close failed')
        }
      })
      return watcher
    })

    try {
      const watcher = createFileSystemWatcher(dir, () => {}, watchFactory as never)
      expect(() => watcher.close()).not.toThrow()
      expect(closeCalls).toContain(dir)
      expect(closeCalls).toContain(docsPath)
      expect(() => watcher.close()).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits change callback for real filesystem updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanqian-local-watch-'))
    const filePath = join(dir, 'watch-target.md')
    writeFileSync(filePath, 'before', 'utf-8')

    try {
      let resolved = false
      const triggered = new Promise<void>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | null = null
        let writeTicker: ReturnType<typeof setInterval> | null = null
        const watcher = createFileSystemWatcher(dir, () => {
          if (resolved) return
          resolved = true
          if (timeout) clearTimeout(timeout)
          if (writeTicker) clearInterval(writeTicker)
          watcher.close()
          resolve()
        })

        timeout = setTimeout(() => {
          if (writeTicker) clearInterval(writeTicker)
          watcher.close()
          reject(new Error('watch callback timeout'))
        }, 2500)

        let version = 0
        writeTicker = setInterval(() => {
          version += 1
          writeFileSync(filePath, `after-${version}`, 'utf-8')
        }, 40)
      })

      await triggered
      expect(resolved).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
