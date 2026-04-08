/**
 * useLocalFolderSearch regression tests
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { useLocalFolderSearch } from '../useLocalFolderSearch'
import type { LocalFolderFileErrorCode } from '../../types/note'
import {
  buildLocalSearchRefreshToastKey,
  buildLocalSearchStatusToastKey,
  parseLocalStatusToastKey,
} from '../localNotebookScopedState'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}))

vi.mock('../../utils/toast', () => ({
  toast: mocks.toast,
}))

type SearchResponse =
  | { success: true; result: { hits: Array<{ relative_path: string }> } }
  | { success: false; errorCode: LocalFolderFileErrorCode }

function createOptions(overrides?: Partial<Parameters<typeof useLocalFolderSearch>[0]>) {
  return {
    selectedNotebookId: 'nb-local-1',
    selectedLocalSearchSourceType: 'local-folder',
    selectedLocalSearchStatus: 'active' as const,
    selectedLocalFolderPath: null,
    localFolderTreeScannedAt: '2026-03-01T00:00:00.000Z',
    localStatusToastAtRef: {
      current: new Map<string, number>(),
    } as MutableRefObject<Map<string, number>>,
    resolveLocalFileErrorMessage: vi.fn(() => 'search failed'),
    onMountStatusSearchError: vi.fn(),
    ...overrides,
  }
}

async function runSearch(query: string, handleQueryChange: (value: string) => void) {
  await act(async () => {
    handleQueryChange(query)
  })

  await act(async () => {
    vi.advanceTimersByTime(160)
    await Promise.resolve()
  })
}

describe('useLocalFolderSearch', () => {
  const searchMock = vi.fn<(input: { query: string }) => Promise<SearchResponse>>()

  beforeEach(() => {
    mocks.toast.mockReset()
    searchMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))

    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        localFolder: {
          search: searchMock,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('triggers mount status callback on mount errors and throttles within 1.5s', async () => {
    searchMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_FOLDER_NOT_FOUND',
    })
    const onMountStatusSearchError = vi.fn()
    const options = createOptions({ onMountStatusSearchError })
    const { result } = renderHook(() => useLocalFolderSearch(options))

    await runSearch('first', result.current.handleLocalSearchQueryChange)
    await runSearch('second', result.current.handleLocalSearchQueryChange)

    expect(onMountStatusSearchError).toHaveBeenCalledTimes(1)
    expect(onMountStatusSearchError).toHaveBeenCalledWith('LOCAL_FOLDER_NOT_FOUND')

    await act(async () => {
      vi.advanceTimersByTime(1600)
    })

    await runSearch('third', result.current.handleLocalSearchQueryChange)

    expect(onMountStatusSearchError).toHaveBeenCalledTimes(2)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('does not trigger mount status callback for non-mount search errors', async () => {
    searchMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_FILE_TOO_LARGE',
    })
    const onMountStatusSearchError = vi.fn()
    const options = createOptions({ onMountStatusSearchError })
    const { result } = renderHook(() => useLocalFolderSearch(options))

    await runSearch('oversized', result.current.handleLocalSearchQueryChange)

    expect(onMountStatusSearchError).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('deduplicates relative paths in successful search hits', async () => {
    searchMock.mockResolvedValue({
      success: true,
      result: {
        hits: [
          { relative_path: 'docs/alpha.md' },
          { relative_path: 'docs/alpha.md' },
          { relative_path: 'docs/beta.md' },
        ],
      },
    })
    const options = createOptions()
    const { result } = renderHook(() => useLocalFolderSearch(options))

    await runSearch('docs', result.current.handleLocalSearchQueryChange)

    expect(result.current.localSearchMatchedPathSet).toEqual(new Set(['docs/alpha.md', 'docs/beta.md']))
    expect(searchMock).toHaveBeenCalledWith({
      query: 'docs',
      notebook_id: 'nb-local-1',
      folder_relative_path: null,
    })
  })

  it('normalizes folder scope path before local search request', async () => {
    searchMock.mockResolvedValue({
      success: true,
      result: { hits: [] },
    })
    const options = createOptions({ selectedLocalFolderPath: './docs//' })
    const { result } = renderHook(() => useLocalFolderSearch(options))

    await runSearch('docs', result.current.handleLocalSearchQueryChange)

    expect(searchMock).toHaveBeenCalledWith({
      query: 'docs',
      notebook_id: 'nb-local-1',
      folder_relative_path: 'docs',
    })
  })

  it('normalizes search hit aliases but keeps traversal expressions distinct', async () => {
    searchMock.mockResolvedValue({
      success: true,
      result: {
        hits: [
          { relative_path: 'docs/alpha.md' },
          { relative_path: './docs//alpha.md' },
          { relative_path: 'docs/../alpha.md' },
          { relative_path: 'alpha.md' },
        ],
      },
    })
    const options = createOptions()
    const { result } = renderHook(() => useLocalFolderSearch(options))

    await runSearch('docs', result.current.handleLocalSearchQueryChange)

    expect(result.current.localSearchMatchedPathSet).toEqual(
      new Set(['docs/alpha.md', 'docs/../alpha.md', 'alpha.md'])
    )
  })

  it('scopes search error toast throttling by notebook id', async () => {
    searchMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_FILE_UNREADABLE',
    })
    const sharedToastRef = {
      current: new Map<string, number>(),
    } as MutableRefObject<Map<string, number>>

    const first = renderHook(() => useLocalFolderSearch(createOptions({
      selectedNotebookId: 'nb-local-1',
      localStatusToastAtRef: sharedToastRef,
    })))
    await runSearch('docs', first.result.current.handleLocalSearchQueryChange)

    const second = renderHook(() => useLocalFolderSearch(createOptions({
      selectedNotebookId: 'nb-local-2',
      localStatusToastAtRef: sharedToastRef,
    })))
    await runSearch('docs', second.result.current.handleLocalSearchQueryChange)

    expect(mocks.toast).toHaveBeenCalledTimes(2)
    expect(Array.from(sharedToastRef.current.keys())).toEqual(
      expect.arrayContaining([
        buildLocalSearchStatusToastKey('nb-local-1', '2026-03-01T00:00:00.000Z', 'LOCAL_FILE_UNREADABLE'),
        buildLocalSearchStatusToastKey('nb-local-2', '2026-03-01T00:00:00.000Z', 'LOCAL_FILE_UNREADABLE'),
      ])
    )
  })

  it('prunes old notebook-scoped search toast history entries', async () => {
    searchMock.mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_FILE_UNREADABLE',
    })
    const sharedToastRef = {
      current: new Map<string, number>(),
    } as MutableRefObject<Map<string, number>>

    for (let index = 0; index < 20; index += 1) {
      sharedToastRef.current.set(
        buildLocalSearchStatusToastKey(
          'nb-local-1',
          `scan-${String(index).padStart(2, '0')}`,
          'LOCAL_FILE_UNREADABLE'
        ),
        index + 1
      )
    }
    sharedToastRef.current.set(buildLocalSearchRefreshToastKey('nb-local-1', 'LOCAL_FILE_UNREADABLE'), 1234)
    sharedToastRef.current.set(
      buildLocalSearchStatusToastKey('nb-local-2', 'scan-00', 'LOCAL_FILE_UNREADABLE'),
      5678
    )

    const options = createOptions({
      localStatusToastAtRef: sharedToastRef,
    })
    const { result } = renderHook(() => useLocalFolderSearch(options))

    await runSearch('docs', result.current.handleLocalSearchQueryChange)

    const nb1SearchHistoryKeys = Array.from(sharedToastRef.current.keys()).filter((key) => {
      const parsed = parseLocalStatusToastKey(key)
      return parsed?.notebookId === 'nb-local-1' && parsed.type === 'search'
    })
    expect(nb1SearchHistoryKeys.length).toBeLessThanOrEqual(12)
    expect(
      sharedToastRef.current.has(
        buildLocalSearchStatusToastKey('nb-local-1', 'scan-00', 'LOCAL_FILE_UNREADABLE')
      )
    ).toBe(false)
    expect(sharedToastRef.current.has(buildLocalSearchRefreshToastKey('nb-local-1', 'LOCAL_FILE_UNREADABLE'))).toBe(true)
    expect(
      sharedToastRef.current.has(
        buildLocalSearchStatusToastKey('nb-local-2', 'scan-00', 'LOCAL_FILE_UNREADABLE')
      )
    ).toBe(true)
    expect(
      sharedToastRef.current.has(
        buildLocalSearchStatusToastKey('nb-local-1', '2026-03-01T00:00:00.000Z', 'LOCAL_FILE_UNREADABLE')
      )
    ).toBe(true)
  })
})
