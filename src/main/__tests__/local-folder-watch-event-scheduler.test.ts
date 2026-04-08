import type { WebContentsView } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalFolderWatchEvent } from '../../shared/types'
import {
  clearAllWatchEventSchedules,
  clearAllWatchSequences,
  initWatchEventScheduler,
  scheduleLocalFolderWatchEvent,
} from '../local-folder-watcher/event-scheduler'

const LOCAL_FOLDER_WATCH_DEBOUNCE_MS = 350

describe('local-folder-watch-event-scheduler', () => {
  const send = vi.fn()

  const getMainView = () => ({
    webContents: {
      send,
    },
  }) as unknown as WebContentsView

  function emitAndFlush(events: Array<Omit<LocalFolderWatchEvent, 'sequence' | 'changed_at_ms'>>): LocalFolderWatchEvent {
    for (const event of events) {
      scheduleLocalFolderWatchEvent(event)
    }

    vi.advanceTimersByTime(LOCAL_FOLDER_WATCH_DEBOUNCE_MS)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toBe('localFolder:changed')
    return send.mock.calls[0]?.[1] as LocalFolderWatchEvent
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'))
    send.mockReset()
    clearAllWatchEventSchedules()
    clearAllWatchSequences()
    initWatchEventScheduler({ getMainView })
  })

  afterEach(() => {
    clearAllWatchEventSchedules()
    clearAllWatchSequences()
    vi.useRealTimers()
  })

  it('keeps status_changed status when trailing content event arrives within debounce window', () => {
    const merged = emitAndFlush([
      {
        notebook_id: 'nb-1',
        status: 'missing',
        reason: 'status_changed',
        changed_relative_path: null,
      },
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
    ])

    expect(merged).toMatchObject({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
      changed_relative_path: null,
      sequence: 1,
    })
    expect(typeof merged.changed_at_ms).toBe('number')
  })

  it('keeps latest status_changed status when multiple transitions are merged', () => {
    const merged = emitAndFlush([
      {
        notebook_id: 'nb-1',
        status: 'missing',
        reason: 'status_changed',
        changed_relative_path: null,
      },
      {
        notebook_id: 'nb-1',
        status: 'permission_required',
        reason: 'status_changed',
        changed_relative_path: null,
      },
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
    ])

    expect(merged).toMatchObject({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
      changed_relative_path: null,
    })
  })

  it('retains relative path only when merged content changes point to same file', () => {
    const merged = emitAndFlush([
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
    ])

    expect(merged).toMatchObject({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'content_changed',
      changed_relative_path: 'docs/a.md',
    })
  })

  it('drops relative path when merged content changes include multiple files', () => {
    const merged = emitAndFlush([
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/b.md',
      },
    ])

    expect(merged).toMatchObject({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'content_changed',
      changed_relative_path: null,
    })
  })

  it('tracks sequence independently per notebook', () => {
    let merged = emitAndFlush([
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
    ])
    expect(merged.sequence).toBe(1)

    send.mockReset()
    merged = emitAndFlush([
      {
        notebook_id: 'nb-1',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/b.md',
      },
    ])
    expect(merged.sequence).toBe(2)

    send.mockReset()
    merged = emitAndFlush([
      {
        notebook_id: 'nb-2',
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: 'docs/a.md',
      },
    ])
    expect(merged.sequence).toBe(1)
  })
})
