import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitLocalNoteIdentityUidRepairFailureAudit,
  emitLocalNoteIdentityUidRepairRowAudit,
  emitLocalNoteIdentityUidRepairSummaryAudit,
  flushLocalNoteIdentityUidRepairAuditSampling,
  resetLocalNoteIdentityUidRepairAuditSamplingForTests,
} from '../local-note-identity-audit'

describe('local-note-identity-audit', () => {
  beforeEach(() => {
    resetLocalNoteIdentityUidRepairAuditSamplingForTests()
  })

  it('emits uid_repair_row with unified envelope fields', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'normalize',
      notebookId: 'nb-1',
      relativePath: 'docs/a.md',
      fromNoteUid: ' UID-A ',
      toNoteUid: 'uid-a',
      remappedPopupRefs: 2,
    }, 1001)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[0]).toBe('[LocalNoteIdentityUidRepair]')
    const payload = JSON.parse(String(logger.warn.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_row',
      at_ms: 1001,
      stage: 'runtime',
      strategy: 'normalize',
      notebookId: 'nb-1',
      relativePath: 'docs/a.md',
      fromNoteUid: ' UID-A ',
      toNoteUid: 'uid-a',
      remappedPopupRefs: 2,
    })
  })

  it('emits uid_repair_summary with unified envelope fields', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    emitLocalNoteIdentityUidRepairSummaryAudit(logger, {
      stage: 'migration',
      normalizedUidRows: 3,
      regeneratedUidRows: 1,
      mergedAliasRows: 2,
      removedInvalidUidRows: 0,
      remappedPopupRefs: 4,
      skippedPopupRefRemapRows: 2,
      removedPopupRefs: 0,
      unresolvedRows: 0,
    }, 1002)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(logger.warn.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_summary',
      at_ms: 1002,
      stage: 'migration',
      normalizedUidRows: 3,
      regeneratedUidRows: 1,
      mergedAliasRows: 2,
      removedInvalidUidRows: 0,
      remappedPopupRefs: 4,
      skippedPopupRefRemapRows: 2,
      removedPopupRefs: 0,
      unresolvedRows: 0,
    })
  })

  it('falls back to info when warn is unavailable for uid_repair_failure', () => {
    const logger = { info: vi.fn() }
    emitLocalNoteIdentityUidRepairFailureAudit(logger, {
      stage: 'runtime',
      notebookId: 'nb-2',
      relativePath: 'docs/b.md',
      noteUid: 'uid-b',
      errorMessage: 'boom',
    }, 1003)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toBe('[LocalNoteIdentityUidRepair]')
    const payload = JSON.parse(String(logger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_failure',
      at_ms: 1003,
      stage: 'runtime',
      notebookId: 'nb-2',
      relativePath: 'docs/b.md',
      noteUid: 'uid-b',
      errorMessage: 'boom',
    })
  })

  it('limits runtime uid_repair_row audit volume and emits sampling summary on window rollover', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const basePayload = {
      stage: 'runtime' as const,
      strategy: 'normalize' as const,
      notebookId: 'nb-1',
      relativePath: 'docs/a.md',
      fromNoteUid: 'uid-a-old',
      toNoteUid: 'uid-a-new',
      remappedPopupRefs: 0,
    }

    for (let i = 0; i < 25; i += 1) {
      emitLocalNoteIdentityUidRepairRowAudit(logger, {
        ...basePayload,
        fromNoteUid: `uid-old-${i}`,
        toNoteUid: `uid-new-${i}`,
      }, 1000 + i)
    }

    // Trigger window rollover, which flushes suppressed-count summary before next row event.
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      ...basePayload,
      strategy: 'regenerate',
      fromNoteUid: 'uid-old-rollover',
      toNoteUid: 'uid-new-rollover',
    }, 61_001)

    const payloads = logger.warn.mock.calls.map((call) => JSON.parse(String(call[1])))
    const rowEvents = payloads.filter((payload) => payload.event === 'uid_repair_row')
    const samplingEvents = payloads.filter((payload) => payload.event === 'uid_repair_row_sampling')
    const runtimeWindowSummaryEvents = logger.info.mock.calls
      .map((call) => JSON.parse(String(call[1])))
      .filter((payload) => payload.event === 'uid_repair_runtime_window_summary')

    expect(rowEvents).toHaveLength(21)
    expect(samplingEvents).toHaveLength(1)
    expect(samplingEvents[0]).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_row_sampling',
      stage: 'runtime',
      trigger: 'window_rollover',
      windowMs: 60000,
      maxPerWindow: 20,
      emittedCount: 20,
      suppressedCount: 5,
      suppressedNormalizeCount: 5,
      suppressedRegenerateCount: 0,
    })
    expect(runtimeWindowSummaryEvents).toHaveLength(1)
    expect(runtimeWindowSummaryEvents[0]).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_runtime_window_summary',
      stage: 'runtime',
      trigger: 'window_rollover',
      windowMs: 60000,
      trackedNotebookLimit: 1024,
      rowCount: 25,
      normalizeRows: 25,
      regenerateRows: 0,
      remappedPopupRefs: 0,
      affectedNotebookCount: 1,
      affectedNotebookOverflowRows: 0,
      emittedRowCount: 20,
      suppressedRowCount: 5,
      suppressedNormalizeCount: 5,
      suppressedRegenerateCount: 0,
    })
  })

  it('flushes suppressed runtime row sampling summary on demand and avoids duplicate flush emission', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const basePayload = {
      stage: 'runtime' as const,
      strategy: 'normalize' as const,
      notebookId: 'nb-1',
      relativePath: 'docs/a.md',
      fromNoteUid: 'uid-a-old',
      toNoteUid: 'uid-a-new',
      remappedPopupRefs: 0,
    }

    for (let i = 0; i < 25; i += 1) {
      emitLocalNoteIdentityUidRepairRowAudit(logger, {
        ...basePayload,
        fromNoteUid: `uid-old-${i}`,
        toNoteUid: `uid-new-${i}`,
      }, 1000 + i)
    }

    flushLocalNoteIdentityUidRepairAuditSampling(logger, 2000)
    flushLocalNoteIdentityUidRepairAuditSampling(logger, 2001)

    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      ...basePayload,
      strategy: 'regenerate',
      fromNoteUid: 'uid-old-after-flush',
      toNoteUid: 'uid-new-after-flush',
    }, 2002)

    const payloads = logger.warn.mock.calls.map((call) => JSON.parse(String(call[1])))
    const rowEvents = payloads.filter((payload) => payload.event === 'uid_repair_row')
    const samplingEvents = payloads.filter((payload) => payload.event === 'uid_repair_row_sampling')
    const runtimeWindowSummaryEvents = logger.info.mock.calls
      .map((call) => JSON.parse(String(call[1])))
      .filter((payload) => payload.event === 'uid_repair_runtime_window_summary')

    expect(rowEvents).toHaveLength(21)
    expect(samplingEvents).toHaveLength(1)
    expect(samplingEvents[0]).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_row_sampling',
      stage: 'runtime',
      trigger: 'flush',
      windowMs: 60000,
      maxPerWindow: 20,
      emittedCount: 20,
      suppressedCount: 5,
      suppressedNormalizeCount: 5,
      suppressedRegenerateCount: 0,
    })
    expect(runtimeWindowSummaryEvents).toHaveLength(1)
    expect(runtimeWindowSummaryEvents[0]).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_runtime_window_summary',
      stage: 'runtime',
      trigger: 'flush',
      windowMs: 60000,
      trackedNotebookLimit: 1024,
      rowCount: 25,
      normalizeRows: 25,
      regenerateRows: 0,
      remappedPopupRefs: 0,
      affectedNotebookCount: 1,
      affectedNotebookOverflowRows: 0,
      emittedRowCount: 20,
      suppressedRowCount: 5,
      suppressedNormalizeCount: 5,
      suppressedRegenerateCount: 0,
    })
  })

  it('returns to idle after flush so post-flush rows start a fresh sampling window', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'normalize',
      notebookId: 'nb-a',
      relativePath: 'docs/a.md',
      fromNoteUid: 'uid-old-a',
      toNoteUid: 'uid-new-a',
      remappedPopupRefs: 0,
    }, 1000)

    flushLocalNoteIdentityUidRepairAuditSampling(logger, 2000)

    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'normalize',
      notebookId: 'nb-b',
      relativePath: 'docs/b.md',
      fromNoteUid: 'uid-old-b',
      toNoteUid: 'uid-new-b',
      remappedPopupRefs: 0,
    }, 2500)
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'regenerate',
      notebookId: 'nb-c',
      relativePath: 'docs/c.md',
      fromNoteUid: 'uid-old-c',
      toNoteUid: 'uid-new-c',
      remappedPopupRefs: 0,
    }, 62_001)

    const summariesBeforeFinalFlush = logger.info.mock.calls
      .map((call) => JSON.parse(String(call[1])))
      .filter((payload) => payload.event === 'uid_repair_runtime_window_summary')
    expect(summariesBeforeFinalFlush).toHaveLength(1)
    expect(summariesBeforeFinalFlush[0]).toMatchObject({
      trigger: 'flush',
      rowCount: 1,
      normalizeRows: 1,
      regenerateRows: 0,
    })

    flushLocalNoteIdentityUidRepairAuditSampling(logger, 62_002)

    const runtimeWindowSummaryEvents = logger.info.mock.calls
      .map((call) => JSON.parse(String(call[1])))
      .filter((payload) => payload.event === 'uid_repair_runtime_window_summary')
    expect(runtimeWindowSummaryEvents).toHaveLength(2)
    expect(runtimeWindowSummaryEvents[1]).toMatchObject({
      trigger: 'flush',
      rowCount: 2,
      normalizeRows: 1,
      regenerateRows: 1,
    })
  })

  it('emits runtime window summary without sampling event for low-volume mixed repairs', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'normalize',
      notebookId: 'nb-a',
      relativePath: 'docs/a.md',
      fromNoteUid: 'uid-old-a1',
      toNoteUid: 'uid-new-a1',
      remappedPopupRefs: 2,
    }, 1000)
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'regenerate',
      notebookId: 'nb-b',
      relativePath: 'docs/b.md',
      fromNoteUid: 'uid-old-b1',
      toNoteUid: 'uid-new-b1',
      remappedPopupRefs: 3,
    }, 1001)
    emitLocalNoteIdentityUidRepairRowAudit(logger, {
      stage: 'runtime',
      strategy: 'normalize',
      notebookId: 'nb-a',
      relativePath: 'docs/a2.md',
      fromNoteUid: 'uid-old-a2',
      toNoteUid: 'uid-new-a2',
      remappedPopupRefs: -1,
    }, 1002)

    flushLocalNoteIdentityUidRepairAuditSampling(logger, 1500)

    const warnPayloads = logger.warn.mock.calls.map((call) => JSON.parse(String(call[1])))
    const infoPayloads = logger.info.mock.calls.map((call) => JSON.parse(String(call[1])))
    const rowEvents = warnPayloads.filter((payload) => payload.event === 'uid_repair_row')
    const samplingEvents = warnPayloads.filter((payload) => payload.event === 'uid_repair_row_sampling')
    const runtimeWindowSummaryEvents = infoPayloads.filter(
      (payload) => payload.event === 'uid_repair_runtime_window_summary'
    )

    expect(rowEvents).toHaveLength(3)
    expect(samplingEvents).toHaveLength(0)
    expect(runtimeWindowSummaryEvents).toHaveLength(1)
    expect(runtimeWindowSummaryEvents[0]).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_runtime_window_summary',
      stage: 'runtime',
      trigger: 'flush',
      windowMs: 60000,
      trackedNotebookLimit: 1024,
      rowCount: 3,
      normalizeRows: 2,
      regenerateRows: 1,
      remappedPopupRefs: 5,
      affectedNotebookCount: 2,
      affectedNotebookOverflowRows: 0,
      emittedRowCount: 3,
      suppressedRowCount: 0,
      suppressedNormalizeCount: 0,
      suppressedRegenerateCount: 0,
    })
  })

  it('caps tracked notebook cardinality and reports overflow rows in runtime summary', () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const trackedNotebookLimit = 1024
    const totalRows = trackedNotebookLimit + 6

    for (let i = 0; i < totalRows; i += 1) {
      emitLocalNoteIdentityUidRepairRowAudit(logger, {
        stage: 'runtime',
        strategy: 'normalize',
        notebookId: `nb-${i}`,
        relativePath: `docs/${i}.md`,
        fromNoteUid: `uid-old-${i}`,
        toNoteUid: `uid-new-${i}`,
        remappedPopupRefs: 0,
      }, 1000 + i)
    }

    flushLocalNoteIdentityUidRepairAuditSampling(logger, 5000)

    const warnPayloads = logger.warn.mock.calls.map((call) => JSON.parse(String(call[1])))
    const infoPayloads = logger.info.mock.calls.map((call) => JSON.parse(String(call[1])))
    const samplingEvents = warnPayloads.filter((payload) => payload.event === 'uid_repair_row_sampling')
    const runtimeWindowSummaryEvents = infoPayloads.filter(
      (payload) => payload.event === 'uid_repair_runtime_window_summary'
    )

    expect(samplingEvents).toHaveLength(1)
    expect(samplingEvents[0]).toMatchObject({
      emittedCount: 20,
      suppressedCount: totalRows - 20,
      suppressedNormalizeCount: totalRows - 20,
      suppressedRegenerateCount: 0,
    })
    expect(runtimeWindowSummaryEvents).toHaveLength(1)
    expect(runtimeWindowSummaryEvents[0]).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'local_note_identity',
      event: 'uid_repair_runtime_window_summary',
      stage: 'runtime',
      trigger: 'flush',
      windowMs: 60000,
      trackedNotebookLimit,
      rowCount: totalRows,
      normalizeRows: totalRows,
      regenerateRows: 0,
      remappedPopupRefs: 0,
      affectedNotebookCount: trackedNotebookLimit,
      affectedNotebookOverflowRows: totalRows - trackedNotebookLimit,
      emittedRowCount: 20,
      suppressedRowCount: totalRows - 20,
      suppressedNormalizeCount: totalRows - 20,
      suppressedRegenerateCount: 0,
    })
  })
})
