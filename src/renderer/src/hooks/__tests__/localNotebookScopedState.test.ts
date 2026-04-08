import { describe, expect, it, vi } from 'vitest'
import {
  buildLocalSearchRefreshToastKey,
  buildLocalSearchStatusToastKey,
  buildNotebookStatusToastKey,
  clearStatusToastEntriesByNotebookId,
  parseLocalStatusToastKey,
  pruneNotebookScopedMap,
  pruneNotebookScopedRecord,
  removeNotebookScopedRecordKey,
  resolveNotebookIdFromStatusToastKey,
} from '../localNotebookScopedState'

describe('localNotebookScopedState helpers', () => {
  it('pruneNotebookScopedRecord keeps reference when nothing is pruned', () => {
    const prev = {
      'nb-1': 1,
      'nb-2': 2,
    }
    const next = pruneNotebookScopedRecord(prev, new Set(['nb-1', 'nb-2']))
    expect(next).toBe(prev)
  })

  it('pruneNotebookScopedRecord removes stale notebook entries', () => {
    const prev = {
      'nb-1': 1,
      stale: 99,
    }
    const next = pruneNotebookScopedRecord(prev, new Set(['nb-1']))
    expect(next).toEqual({ 'nb-1': 1 })
  })

  it('resolveNotebookIdFromStatusToastKey parses notebook id safely', () => {
    expect(resolveNotebookIdFromStatusToastKey('nb-1:missing')).toBe('nb-1')
    expect(resolveNotebookIdFromStatusToastKey('nb:with:colon:permission_required')).toBe('nb:with:colon')
    expect(resolveNotebookIdFromStatusToastKey('malformed')).toBeNull()
  })

  it('builds and parses structured status toast keys', () => {
    const statusKey = buildNotebookStatusToastKey('nb:with:colon', 'missing')
    const searchKey = buildLocalSearchStatusToastKey(
      'nb:with:colon',
      '2026-03-01T00:00:00.000Z',
      'LOCAL_FILE_UNREADABLE'
    )
    const refreshKey = buildLocalSearchRefreshToastKey('nb:with:colon', 'LOCAL_FILE_UNREADABLE')

    expect(parseLocalStatusToastKey(statusKey)).toEqual({
      notebookId: 'nb:with:colon',
      type: 'status',
    })
    expect(parseLocalStatusToastKey(searchKey)).toEqual({
      notebookId: 'nb:with:colon',
      type: 'search',
    })
    expect(parseLocalStatusToastKey(refreshKey)).toEqual({
      notebookId: 'nb:with:colon',
      type: 'search_refresh',
    })
  })

  it('removeNotebookScopedRecordKey removes only target key and preserves no-op reference', () => {
    const prev = {
      'nb-1': true,
      'nb-2': false,
    }
    const removed = removeNotebookScopedRecordKey(prev, 'nb-2')
    expect(removed).toEqual({ 'nb-1': true })
    expect(removeNotebookScopedRecordKey(prev, 'missing')).toBe(prev)
  })

  it('pruneNotebookScopedMap removes stale entries and invokes onPrune', () => {
    const map = new Map<string, number>([
      ['nb-1', 1],
      ['nb-stale', 2],
    ])
    const onPrune = vi.fn()

    pruneNotebookScopedMap(map, new Set(['nb-1']), { onPrune })

    expect(Array.from(map.entries())).toEqual([['nb-1', 1]])
    expect(onPrune).toHaveBeenCalledWith(2, 'nb-stale')
  })

  it('pruneNotebookScopedMap can prune composite keys via resolver', () => {
    const map = new Map<string, number>([
      ['nb-1:missing', 100],
      ['nb-stale:missing', 200],
      ['malformed', 300],
    ])

    pruneNotebookScopedMap(map, new Set(['nb-1']), {
      resolveNotebookId: resolveNotebookIdFromStatusToastKey,
    })

    expect(Array.from(map.entries())).toEqual([['nb-1:missing', 100]])
  })

  it('clearStatusToastEntriesByNotebookId removes all status keys for notebook', () => {
    const map = new Map<string, number>([
      ['nb-1:missing', 10],
      ['nb-1:permission_required', 11],
      ['nb-2:missing', 20],
      ['malformed', 99],
    ])

    clearStatusToastEntriesByNotebookId(map, 'nb-1')

    expect(Array.from(map.entries())).toEqual([
      ['nb-2:missing', 20],
      ['malformed', 99],
    ])
  })

  it('clearStatusToastEntriesByNotebookId also removes notebook-scoped local-search keys', () => {
    const map = new Map<string, number>([
      [buildLocalSearchStatusToastKey('nb-1', '2026-03-01T00:00:00.000Z', 'LOCAL_FILE_UNREADABLE'), 10],
      [buildLocalSearchRefreshToastKey('nb-1', 'LOCAL_FILE_UNREADABLE'), 11],
      [buildLocalSearchStatusToastKey('nb-2', '2026-03-01T00:00:00.000Z', 'LOCAL_FILE_UNREADABLE'), 20],
    ])

    clearStatusToastEntriesByNotebookId(map, 'nb-1')

    expect(Array.from(map.entries())).toEqual([
      [buildLocalSearchStatusToastKey('nb-2', '2026-03-01T00:00:00.000Z', 'LOCAL_FILE_UNREADABLE'), 20],
    ])
  })
})
