import { describe, expect, it, vi } from 'vitest'
import { emitLocalPerformanceSummaryAudit } from '../local-performance-audit'

describe('local-performance-audit', () => {
  it('emits local performance summary with unified audit envelope', () => {
    const logger = {
      info: vi.fn(),
    }

    emitLocalPerformanceSummaryAudit(logger, '[LocalPerf]', {
      operation: 'local_folder_scan',
      notebook_id: 'nb-1',
      duration_ms: 320,
      slow_threshold_ms: 1200,
      profile_enabled: false,
      startup_phase: true,
      startup_elapsed_ms: 1000,
      startup_window_ms: 45000,
      mode: 'tree-sync',
      scanned_entry_count: 20,
    }, 1234)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toBe('[LocalPerf]')

    const payload = JSON.parse(String(logger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_performance',
      event: 'summary',
      at_ms: 1234,
      operation: 'local_folder_scan',
      notebook_id: 'nb-1',
      duration_ms: 320,
      startup_phase: true,
      mode: 'tree-sync',
      scanned_entry_count: 20,
    })
  })
})
