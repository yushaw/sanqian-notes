import { describe, expect, it, vi } from 'vitest'
import {
  emitLocalFolderIpcWaitAlertAudit,
  emitLocalFolderIpcWaitStatsAudit,
  emitLocalFolderUnmountAudit,
} from '../local-folder-audit'

describe('local-folder-audit', () => {
  it('emits local folder unmount audit with unified envelope fields', () => {
    const logger = {
      info: vi.fn(),
    }
    emitLocalFolderUnmountAudit(logger, {
      notebookId: 'nb-1',
      success: true,
      durationMs: 12,
    }, 999)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toBe('[LocalFolderUnmountAudit]')
    const payload = JSON.parse(String(logger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_folder',
      event: 'unmount',
      at_ms: 999,
      notebookId: 'nb-1',
      success: true,
      durationMs: 12,
    })
  })

  it('emits ipc wait stats audit with unified envelope fields', () => {
    const logger = {
      info: vi.fn(),
    }
    emitLocalFolderIpcWaitStatsAudit(logger, {
      reason: 'interval',
      collected_at_ms: 2000,
      entry_count: 1,
      entries: [{
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 2,
        slowCount: 1,
        totalWaitMs: 42,
        maxWaitMs: 30,
      }],
    }, 2000)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toBe('[LocalFolderIpcWaitStats]')
    const payload = JSON.parse(String(logger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_folder',
      event: 'ipc_wait_stats',
      at_ms: 2000,
      reason: 'interval',
      collected_at_ms: 2000,
      entry_count: 1,
    })
  })

  it('uses warn when available and falls back to info for alert audit', () => {
    const warnLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    }
    emitLocalFolderIpcWaitAlertAudit(warnLogger, {
      collected_at_ms: 3000,
      alert_count: 1,
      thresholds: {
        min_sample_count: 5,
        max_wait_ms: 2000,
        avg_wait_ms: 500,
        slow_ratio: 0.3,
      },
      alerts: [{
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 10,
        slowCount: 5,
        maxWaitMs: 2500,
        averageWaitMs: 700,
        slowRatio: 0.5,
        reasons: ['max_wait_ms'],
      }],
    }, 3000)
    expect(warnLogger.warn).toHaveBeenCalledTimes(1)
    expect(warnLogger.info).not.toHaveBeenCalled()

    const infoLogger = {
      info: vi.fn(),
    }
    emitLocalFolderIpcWaitAlertAudit(infoLogger, {
      collected_at_ms: 3001,
      alert_count: 1,
      thresholds: {
        min_sample_count: 5,
        max_wait_ms: 2000,
        avg_wait_ms: 500,
        slow_ratio: 0.3,
      },
      alerts: [{
        operation: 'consistent_read',
        phase: 'wait_mutation_tails',
        count: 10,
        slowCount: 5,
        maxWaitMs: 2500,
        averageWaitMs: 700,
        slowRatio: 0.5,
        reasons: ['max_wait_ms'],
      }],
    }, 3001)
    expect(infoLogger.info).toHaveBeenCalledTimes(1)
    expect(infoLogger.info.mock.calls[0]?.[0]).toBe('[LocalFolderIpcWaitStatsAlert]')
    const payload = JSON.parse(String(infoLogger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_folder',
      event: 'ipc_wait_alert',
      at_ms: 3001,
      alert_count: 1,
    })
  })
})
