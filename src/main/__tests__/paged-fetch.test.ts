import { describe, expect, it, vi } from 'vitest'
import { collectOffsetPagedRows } from '../paged-fetch'

describe('collectOffsetPagedRows', () => {
  it('returns empty result without calling fetch when targetCount <= 0', () => {
    const fetchPage = vi.fn(() => [1, 2, 3])
    const rows = collectOffsetPagedRows(0, 100, fetchPage)

    expect(rows).toEqual([])
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('fetches multiple pages until target count is reached', () => {
    const fetchPage = vi
      .fn<(limit: number, offset: number) => number[]>()
      .mockImplementation((limit, offset) => {
        return Array.from({ length: limit }, (_, index) => offset + index + 1)
      })

    const rows = collectOffsetPagedRows(205, 100, fetchPage)

    expect(rows).toHaveLength(205)
    expect(rows[0]).toBe(1)
    expect(rows[204]).toBe(205)
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage.mock.calls).toEqual([
      [100, 0],
      [100, 100],
      [5, 200],
    ])
  })

  it('stops early when a partial page is returned', () => {
    const fetchPage = vi
      .fn<(limit: number, offset: number) => number[]>()
      .mockImplementation((limit, offset) => {
        if (offset === 0) return [1, 2, 3, 4]
        return Array.from({ length: limit }, (_, index) => offset + index + 1)
      })

    const rows = collectOffsetPagedRows(50, 10, fetchPage)

    expect(rows).toEqual([1, 2, 3, 4])
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(10, 0)
  })

  it('throws when pageSize is invalid', () => {
    expect(() => collectOffsetPagedRows(10, 0, () => [])).toThrow('pageSize must be greater than 0')
  })
})
