import { describe, expect, it, vi, afterEach } from 'vitest'
import { mapWithConcurrency } from '../concurrency'

describe('mapWithConcurrency', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves item order while respecting concurrency limit', async () => {
    vi.useFakeTimers()
    const input = [1, 2, 3, 4, 5]
    let active = 0
    let maxActive = 0

    const promise = mapWithConcurrency(input, 2, async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return item * 10
    })

    // Advance timers enough to drain all async work
    for (let i = 0; i < input.length; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    const results = await promise

    expect(maxActive).toBe(2)
    expect(results).toEqual([10, 20, 30, 40, 50])
  })

  it('falls back to single worker for invalid concurrency values', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (item) => item + 1)
    expect(results).toEqual([2, 3, 4])
  })
})
