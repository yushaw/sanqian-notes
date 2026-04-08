import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalFolderIpcWaitStatsSampler,
  type LocalFolderIpcWaitStatsRuntime,
} from '../local-folder-ipc-wait-stats-sampler'

function createRuntimeWithEntries(
  entries: Array<{
    operation: 'global_mutation' | 'notebook_mutation' | 'save_scope' | 'topology_read' | 'consistent_read'
    phase: string
    count: number
    slowCount: number
    totalWaitMs: number
    maxWaitMs: number
  }>
): LocalFolderIpcWaitStatsRuntime {
  return {
    getWaitStatsSnapshot: vi.fn(() => ({
      collectedAt: 1234,
      entries,
    })),
    resetWaitStats: vi.fn(),
  }
}

function createRuntimeWithSnapshots(
  snapshots: Array<{
    collectedAt: number
    entries: Array<{
      operation: 'global_mutation' | 'notebook_mutation' | 'save_scope' | 'topology_read' | 'consistent_read'
      phase: string
      count: number
      slowCount: number
      totalWaitMs: number
      maxWaitMs: number
    }>
  }>
): LocalFolderIpcWaitStatsRuntime {
  let index = 0
  return {
    getWaitStatsSnapshot: vi.fn(() => {
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)]
      index += 1
      return snapshot
    }),
    resetWaitStats: vi.fn(),
  }
}

describe('local-folder-ipc-wait-stats-sampler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes wait stats and resets runtime when snapshot has entries', () => {
    const runtime = createRuntimeWithEntries([
      {
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 2,
        slowCount: 1,
        totalWaitMs: 42,
        maxWaitMs: 30,
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    }

    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
    })

    sampler.flush('before_quit')

    expect(runtime.getWaitStatsSnapshot).toHaveBeenCalledTimes(1)
    expect(runtime.resetWaitStats).toHaveBeenCalledTimes(1)
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toBe('[LocalFolderIpcWaitStats]')
    const payload = JSON.parse(String(logger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_folder',
      event: 'ipc_wait_stats',
      at_ms: 1234,
      reason: 'before_quit',
      collected_at_ms: 1234,
      entry_count: 1,
    })
  })

  it('skips logging and reset when snapshot is empty', () => {
    const runtime = createRuntimeWithEntries([])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
    })

    sampler.flush('will_quit')

    expect(runtime.getWaitStatsSnapshot).toHaveBeenCalledTimes(1)
    expect(runtime.resetWaitStats).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs snapshot collection errors and continues safely', () => {
    const runtime: LocalFolderIpcWaitStatsRuntime = {
      getWaitStatsSnapshot: vi.fn(() => {
        throw new Error('snapshot failed')
      }),
      resetWaitStats: vi.fn(),
    }
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
    })

    sampler.flush('before_quit')

    expect(runtime.resetWaitStats).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('failed to collect wait stats snapshot')
  })

  it('logs reset errors after emitting wait stats', () => {
    const runtime: LocalFolderIpcWaitStatsRuntime = {
      getWaitStatsSnapshot: vi.fn(() => ({
        collectedAt: 2222,
        entries: [{
          operation: 'topology_read' as const,
          phase: 'wait_mutation_tails',
          count: 1,
          slowCount: 1,
          totalWaitMs: 12,
          maxWaitMs: 12,
        }],
      })),
      resetWaitStats: vi.fn(() => {
        throw new Error('reset failed')
      }),
    }
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
    })

    sampler.flush('will_quit')

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('failed to reset wait stats')
  })

  it('swallows wait-stats audit emission failures and still resets runtime', () => {
    const runtime = createRuntimeWithEntries([
      {
        operation: 'save_scope',
        phase: 'wait_notebook_save_drain',
        count: 1,
        slowCount: 0,
        totalWaitMs: 5,
        maxWaitMs: 5,
      },
    ])
    const logger = {
      info: vi.fn(() => {
        throw new Error('info sink unavailable')
      }),
      error: vi.fn(),
      warn: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        enabled: false,
      },
    })

    sampler.flush('interval')

    expect(runtime.resetWaitStats).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('failed to emit wait stats audit')
  })

  it('swallows wait-alert audit emission failures and still resets runtime', () => {
    const runtime = createRuntimeWithEntries([
      {
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 10,
        slowCount: 5,
        totalWaitMs: 7_000,
        maxWaitMs: 2_500,
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(() => {
        throw new Error('warn sink unavailable')
      }),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        minSampleCount: 5,
        maxWaitMs: 2_000,
        avgWaitMs: 600,
        slowRatio: 0.4,
      },
    })

    sampler.flush('interval')

    expect(runtime.resetWaitStats).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('failed to emit wait alert audit')
  })

  it('samples periodically and stop is idempotent', () => {
    vi.useFakeTimers()
    const runtime = createRuntimeWithEntries([
      {
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 1,
        slowCount: 0,
        totalWaitMs: 5,
        maxWaitMs: 5,
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 500,
      getRuntime: () => runtime,
      logger,
    })

    sampler.start()
    sampler.start()
    vi.advanceTimersByTime(500)
    vi.advanceTimersByTime(500)
    expect(runtime.getWaitStatsSnapshot).toHaveBeenCalledTimes(2)

    sampler.stop()
    sampler.stop()
    vi.advanceTimersByTime(1000)
    expect(runtime.getWaitStatsSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not start sampling when disabled', () => {
    vi.useFakeTimers()
    const runtime = createRuntimeWithEntries([
      {
        operation: 'save_scope',
        phase: 'wait_notebook_save_drain',
        count: 1,
        slowCount: 1,
        totalWaitMs: 8,
        maxWaitMs: 8,
      },
    ])
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: false,
      intervalMs: 100,
      getRuntime: () => runtime,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
    })

    sampler.start()
    vi.advanceTimersByTime(500)
    expect(runtime.getWaitStatsSnapshot).not.toHaveBeenCalled()
  })

  it('supports runtime appearing after sampler start', () => {
    vi.useFakeTimers()
    let runtime: LocalFolderIpcWaitStatsRuntime | null = null
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 200,
      getRuntime: () => runtime,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
    })
    sampler.start()
    vi.advanceTimersByTime(200)

    runtime = createRuntimeWithEntries([
      {
        operation: 'global_mutation',
        phase: 'wait_all_topology_read_drain',
        count: 1,
        slowCount: 1,
        totalWaitMs: 11,
        maxWaitMs: 11,
      },
    ])
    vi.advanceTimersByTime(200)

    expect(runtime.getWaitStatsSnapshot).toHaveBeenCalledTimes(1)
    sampler.stop()
  })

  it('emits alert logs when wait metrics cross configured thresholds', () => {
    const runtime = createRuntimeWithEntries([
      {
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 10,
        slowCount: 5,
        totalWaitMs: 7_000,
        maxWaitMs: 2_500,
      },
      {
        operation: 'save_scope',
        phase: 'wait_notebook_save_drain',
        count: 10,
        slowCount: 0,
        totalWaitMs: 50,
        maxWaitMs: 10,
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        minSampleCount: 5,
        maxWaitMs: 2_000,
        avgWaitMs: 600,
        slowRatio: 0.4,
      },
    })

    sampler.flush('interval')

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[0]).toBe('[LocalFolderIpcWaitStatsAlert]')
    const payload = JSON.parse(String(logger.warn.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_folder',
      event: 'ipc_wait_alert',
      at_ms: 1234,
      alert_count: 1,
      thresholds: {
        min_sample_count: 5,
        max_wait_ms: 2000,
        avg_wait_ms: 600,
        slow_ratio: 0.4,
      },
    })
    expect(payload.alerts[0]).toMatchObject({
      operation: 'consistent_read',
      phase: 'wait_mutation_tails',
      count: 10,
      slowCount: 5,
      maxWaitMs: 2500,
      reasons: ['max_wait_ms', 'avg_wait_ms', 'slow_ratio'],
    })
  })

  it('does not emit alert when sample count is below threshold', () => {
    const runtime = createRuntimeWithEntries([
      {
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 2,
        slowCount: 2,
        totalWaitMs: 4_000,
        maxWaitMs: 3_000,
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        minSampleCount: 5,
        maxWaitMs: 1_000,
        avgWaitMs: 300,
        slowRatio: 0.2,
      },
    })

    sampler.flush('interval')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('coalesces duplicate alerts within log window and emits suppressedCount later', () => {
    const runtime = createRuntimeWithSnapshots([
      {
        collectedAt: 1000,
        entries: [{
          operation: 'consistent_read',
          phase: 'wait_mutation_tails',
          count: 10,
          slowCount: 5,
          totalWaitMs: 7000,
          maxWaitMs: 2500,
        }],
      },
      {
        collectedAt: 1200,
        entries: [{
          operation: 'consistent_read',
          phase: 'wait_mutation_tails',
          count: 10,
          slowCount: 6,
          totalWaitMs: 8000,
          maxWaitMs: 3000,
        }],
      },
      {
        collectedAt: 2600,
        entries: [{
          operation: 'consistent_read',
          phase: 'wait_mutation_tails',
          count: 10,
          slowCount: 4,
          totalWaitMs: 6500,
          maxWaitMs: 2400,
        }],
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        minSampleCount: 5,
        maxWaitMs: 2000,
        avgWaitMs: 600,
        slowRatio: 0.4,
        logWindowMs: 1000,
      },
    })

    sampler.flush('interval')
    sampler.flush('interval')
    sampler.flush('interval')

    expect(logger.warn).toHaveBeenCalledTimes(2)
    const firstPayload = JSON.parse(String(logger.warn.mock.calls[0]?.[1]))
    expect(firstPayload.alerts[0].suppressedCount).toBeUndefined()
    const secondPayload = JSON.parse(String(logger.warn.mock.calls[1]?.[1]))
    expect(secondPayload.alerts[0]).toMatchObject({
      operation: 'consistent_read',
      phase: 'wait_mutation_tails',
      suppressedCount: 1,
      maxWaitMs: 3000,
      averageWaitMs: 800,
      slowRatio: 0.6,
    })
  })

  it('evicts stale alert signatures when maxSignatures is exceeded', () => {
    const runtime = createRuntimeWithSnapshots([
      {
        collectedAt: 1000,
        entries: [{
          operation: 'consistent_read',
          phase: 'wait_mutation_tails',
          count: 10,
          slowCount: 5,
          totalWaitMs: 7000,
          maxWaitMs: 2500,
        }],
      },
      {
        collectedAt: 1100,
        entries: [{
          operation: 'save_scope',
          phase: 'wait_notebook_save_drain',
          count: 10,
          slowCount: 5,
          totalWaitMs: 7000,
          maxWaitMs: 2500,
        }],
      },
      {
        collectedAt: 1200,
        entries: [{
          operation: 'consistent_read',
          phase: 'wait_mutation_tails',
          count: 10,
          slowCount: 5,
          totalWaitMs: 7000,
          maxWaitMs: 2500,
        }],
      },
    ])
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        minSampleCount: 5,
        maxWaitMs: 2000,
        avgWaitMs: 600,
        slowRatio: 0.4,
        logWindowMs: 10_000,
        maxSignatures: 1,
      },
    })

    sampler.flush('interval')
    sampler.flush('interval')
    sampler.flush('interval')

    expect(logger.warn).toHaveBeenCalledTimes(3)
  })

  it('does not coalesce alerts when operation/phase delimiters could collide in legacy signature format', () => {
    const snapshots = [
      {
        collectedAt: 1000,
        entries: [{
          operation: 'consistent_read|scope',
          phase: 'alpha',
          count: 10,
          slowCount: 5,
          totalWaitMs: 7000,
          maxWaitMs: 2500,
        }],
      },
      {
        collectedAt: 1100,
        entries: [{
          operation: 'consistent_read',
          phase: 'scope|alpha',
          count: 10,
          slowCount: 5,
          totalWaitMs: 7000,
          maxWaitMs: 2500,
        }],
      },
    ]
    let index = 0
    const runtime: LocalFolderIpcWaitStatsRuntime = {
      getWaitStatsSnapshot: vi.fn(() => snapshots[Math.min(index++, snapshots.length - 1)] as any),
      resetWaitStats: vi.fn(),
    }
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }
    const sampler = createLocalFolderIpcWaitStatsSampler({
      enabled: true,
      intervalMs: 1000,
      getRuntime: () => runtime,
      logger,
      alert: {
        minSampleCount: 5,
        maxWaitMs: 2000,
        avgWaitMs: 600,
        slowRatio: 0.4,
        logWindowMs: 10_000,
      },
    })

    sampler.flush('interval')
    sampler.flush('interval')

    expect(logger.warn).toHaveBeenCalledTimes(2)
  })
})
