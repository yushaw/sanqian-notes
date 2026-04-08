import {
  emitOperationAuditInfo,
  emitOperationAuditWarn,
  type OperationAuditLogger,
} from './operation-audit'

export type LocalNoteIdentityUidRepairStage = 'runtime' | 'migration'
export type LocalNoteIdentityUidRepairStrategy = 'normalize' | 'regenerate'

export interface LocalNoteIdentityUidRepairRowAuditPayload {
  stage: LocalNoteIdentityUidRepairStage
  strategy: LocalNoteIdentityUidRepairStrategy
  notebookId: string
  relativePath: string
  fromNoteUid: string
  toNoteUid: string
  remappedPopupRefs: number
}

export interface LocalNoteIdentityUidRepairRowSamplingAuditPayload {
  stage: 'runtime'
  trigger: 'window_rollover' | 'flush'
  windowMs: number
  maxPerWindow: number
  emittedCount: number
  suppressedCount: number
  suppressedNormalizeCount: number
  suppressedRegenerateCount: number
}

export interface LocalNoteIdentityUidRepairRuntimeWindowSummaryAuditPayload {
  stage: 'runtime'
  trigger: 'window_rollover' | 'flush'
  windowMs: number
  trackedNotebookLimit: number
  rowCount: number
  normalizeRows: number
  regenerateRows: number
  remappedPopupRefs: number
  affectedNotebookCount: number
  affectedNotebookOverflowRows: number
  emittedRowCount: number
  suppressedRowCount: number
  suppressedNormalizeCount: number
  suppressedRegenerateCount: number
}

export interface LocalNoteIdentityUidRepairSummaryAuditPayload {
  stage: LocalNoteIdentityUidRepairStage
  normalizedUidRows: number
  regeneratedUidRows: number
  mergedAliasRows: number
  removedInvalidUidRows: number
  remappedPopupRefs: number
  skippedPopupRefRemapRows: number
  removedPopupRefs: number
  unresolvedRows: number
}

export interface LocalNoteIdentityUidRepairFailureAuditPayload {
  stage: LocalNoteIdentityUidRepairStage
  notebookId: string
  relativePath: string
  noteUid: string
  errorMessage: string
}

const LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_WINDOW_MS = 60_000
const LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_MAX_PER_WINDOW = 20
const LOCAL_NOTE_IDENTITY_UID_REPAIR_WINDOW_MAX_TRACKED_NOTEBOOKS = 1_024

interface RuntimeUidRepairRowAuditSamplingState {
  windowStartMs: number
  emittedCount: number
  suppressedCount: number
  suppressedNormalizeCount: number
  suppressedRegenerateCount: number
}

interface RuntimeUidRepairWindowSummaryState {
  windowStartMs: number
  rowCount: number
  normalizeRows: number
  regenerateRows: number
  remappedPopupRefs: number
  affectedNotebookIds: Set<string>
  affectedNotebookOverflowRows: number
}

let runtimeUidRepairRowAuditSamplingState: RuntimeUidRepairRowAuditSamplingState = {
  windowStartMs: 0,
  emittedCount: 0,
  suppressedCount: 0,
  suppressedNormalizeCount: 0,
  suppressedRegenerateCount: 0,
}

let runtimeUidRepairWindowSummaryState: RuntimeUidRepairWindowSummaryState = {
  windowStartMs: 0,
  rowCount: 0,
  normalizeRows: 0,
  regenerateRows: 0,
  remappedPopupRefs: 0,
  affectedNotebookIds: new Set<string>(),
  affectedNotebookOverflowRows: 0,
}

function resetRuntimeUidRepairRowAuditWindow(): void {
  runtimeUidRepairRowAuditSamplingState = {
    windowStartMs: 0,
    emittedCount: 0,
    suppressedCount: 0,
    suppressedNormalizeCount: 0,
    suppressedRegenerateCount: 0,
  }
  runtimeUidRepairWindowSummaryState = {
    windowStartMs: 0,
    rowCount: 0,
    normalizeRows: 0,
    regenerateRows: 0,
    remappedPopupRefs: 0,
    affectedNotebookIds: new Set<string>(),
    affectedNotebookOverflowRows: 0,
  }
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  const truncated = Math.trunc(value)
  return truncated > 0 ? truncated : 0
}

function emitRuntimeUidRepairRowSamplingSummaryIfNeeded(
  logger: OperationAuditLogger,
  nowMs: number,
  trigger: LocalNoteIdentityUidRepairRowSamplingAuditPayload['trigger']
): void {
  if (runtimeUidRepairRowAuditSamplingState.suppressedCount <= 0) return
  const payload: LocalNoteIdentityUidRepairRowSamplingAuditPayload = {
    stage: 'runtime',
    trigger,
    windowMs: LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_WINDOW_MS,
    maxPerWindow: LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_MAX_PER_WINDOW,
    emittedCount: runtimeUidRepairRowAuditSamplingState.emittedCount,
    suppressedCount: runtimeUidRepairRowAuditSamplingState.suppressedCount,
    suppressedNormalizeCount: runtimeUidRepairRowAuditSamplingState.suppressedNormalizeCount,
    suppressedRegenerateCount: runtimeUidRepairRowAuditSamplingState.suppressedRegenerateCount,
  }
  emitOperationAuditWarn(
    logger,
    '[LocalNoteIdentityUidRepair]',
    'local_note_identity',
    'uid_repair_row_sampling',
    payload,
    nowMs
  )
}

function emitRuntimeUidRepairWindowSummaryIfNeeded(
  logger: OperationAuditLogger,
  nowMs: number,
  trigger: LocalNoteIdentityUidRepairRuntimeWindowSummaryAuditPayload['trigger']
): void {
  if (runtimeUidRepairWindowSummaryState.rowCount <= 0) return
  const payload: LocalNoteIdentityUidRepairRuntimeWindowSummaryAuditPayload = {
    stage: 'runtime',
    trigger,
    windowMs: LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_WINDOW_MS,
    trackedNotebookLimit: LOCAL_NOTE_IDENTITY_UID_REPAIR_WINDOW_MAX_TRACKED_NOTEBOOKS,
    rowCount: runtimeUidRepairWindowSummaryState.rowCount,
    normalizeRows: runtimeUidRepairWindowSummaryState.normalizeRows,
    regenerateRows: runtimeUidRepairWindowSummaryState.regenerateRows,
    remappedPopupRefs: runtimeUidRepairWindowSummaryState.remappedPopupRefs,
    affectedNotebookCount: runtimeUidRepairWindowSummaryState.affectedNotebookIds.size,
    affectedNotebookOverflowRows: runtimeUidRepairWindowSummaryState.affectedNotebookOverflowRows,
    emittedRowCount: runtimeUidRepairRowAuditSamplingState.emittedCount,
    suppressedRowCount: runtimeUidRepairRowAuditSamplingState.suppressedCount,
    suppressedNormalizeCount: runtimeUidRepairRowAuditSamplingState.suppressedNormalizeCount,
    suppressedRegenerateCount: runtimeUidRepairRowAuditSamplingState.suppressedRegenerateCount,
  }
  emitOperationAuditInfo(
    logger,
    '[LocalNoteIdentityUidRepair]',
    'local_note_identity',
    'uid_repair_runtime_window_summary',
    payload,
    nowMs
  )
}

function emitRuntimeUidRepairWindowAuditSummariesIfNeeded(
  logger: OperationAuditLogger,
  nowMs: number,
  trigger: LocalNoteIdentityUidRepairRowSamplingAuditPayload['trigger']
): void {
  emitRuntimeUidRepairRowSamplingSummaryIfNeeded(logger, nowMs, trigger)
  emitRuntimeUidRepairWindowSummaryIfNeeded(logger, nowMs, trigger)
}

function beginRuntimeUidRepairRowAuditWindow(nowMs: number): void {
  resetRuntimeUidRepairRowAuditWindow()
  runtimeUidRepairRowAuditSamplingState.windowStartMs = nowMs
  runtimeUidRepairWindowSummaryState.windowStartMs = nowMs
}

function recordRuntimeUidRepairRowForWindowSummary(
  payload: LocalNoteIdentityUidRepairRowAuditPayload
): void {
  runtimeUidRepairWindowSummaryState.rowCount += 1
  if (payload.strategy === 'normalize') {
    runtimeUidRepairWindowSummaryState.normalizeRows += 1
  } else {
    runtimeUidRepairWindowSummaryState.regenerateRows += 1
  }
  runtimeUidRepairWindowSummaryState.remappedPopupRefs += normalizeNonNegativeInteger(payload.remappedPopupRefs)
  const notebookId = payload.notebookId
  if (runtimeUidRepairWindowSummaryState.affectedNotebookIds.has(notebookId)) {
    return
  }
  if (
    runtimeUidRepairWindowSummaryState.affectedNotebookIds.size
    < LOCAL_NOTE_IDENTITY_UID_REPAIR_WINDOW_MAX_TRACKED_NOTEBOOKS
  ) {
    runtimeUidRepairWindowSummaryState.affectedNotebookIds.add(notebookId)
    return
  }
  runtimeUidRepairWindowSummaryState.affectedNotebookOverflowRows += 1
}

function shouldSuppressRuntimeUidRepairRowAudit(
  logger: OperationAuditLogger,
  payload: LocalNoteIdentityUidRepairRowAuditPayload,
  nowMs: number
): boolean {
  if (payload.stage !== 'runtime') return false

  if (!runtimeUidRepairRowAuditSamplingState.windowStartMs) {
    beginRuntimeUidRepairRowAuditWindow(nowMs)
  } else if (
    nowMs - runtimeUidRepairRowAuditSamplingState.windowStartMs
    >= LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_WINDOW_MS
  ) {
    emitRuntimeUidRepairWindowAuditSummariesIfNeeded(logger, nowMs, 'window_rollover')
    beginRuntimeUidRepairRowAuditWindow(nowMs)
  }

  recordRuntimeUidRepairRowForWindowSummary(payload)

  if (
    runtimeUidRepairRowAuditSamplingState.emittedCount
    < LOCAL_NOTE_IDENTITY_UID_REPAIR_ROW_AUDIT_MAX_PER_WINDOW
  ) {
    return false
  }

  runtimeUidRepairRowAuditSamplingState.suppressedCount += 1
  if (payload.strategy === 'normalize') {
    runtimeUidRepairRowAuditSamplingState.suppressedNormalizeCount += 1
  } else {
    runtimeUidRepairRowAuditSamplingState.suppressedRegenerateCount += 1
  }
  return true
}

export function resetLocalNoteIdentityUidRepairAuditSamplingForTests(): void {
  resetRuntimeUidRepairRowAuditWindow()
}

export function flushLocalNoteIdentityUidRepairAuditSampling(
  logger: OperationAuditLogger,
  nowMs: number = Date.now()
): void {
  if (!runtimeUidRepairRowAuditSamplingState.windowStartMs) return
  emitRuntimeUidRepairWindowAuditSummariesIfNeeded(logger, nowMs, 'flush')
  // Reset to idle so a future runtime row starts a fresh window from that row timestamp.
  resetRuntimeUidRepairRowAuditWindow()
}

export function emitLocalNoteIdentityUidRepairRowAudit(
  logger: OperationAuditLogger,
  payload: LocalNoteIdentityUidRepairRowAuditPayload,
  nowMs: number = Date.now()
): void {
  if (shouldSuppressRuntimeUidRepairRowAudit(logger, payload, nowMs)) {
    return
  }
  emitOperationAuditWarn(
    logger,
    '[LocalNoteIdentityUidRepair]',
    'local_note_identity',
    'uid_repair_row',
    payload,
    nowMs
  )
  if (payload.stage === 'runtime') {
    runtimeUidRepairRowAuditSamplingState.emittedCount += 1
  }
}

export function emitLocalNoteIdentityUidRepairSummaryAudit(
  logger: OperationAuditLogger,
  payload: LocalNoteIdentityUidRepairSummaryAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditWarn(
    logger,
    '[LocalNoteIdentityUidRepair]',
    'local_note_identity',
    'uid_repair_summary',
    payload,
    nowMs
  )
}

export function emitLocalNoteIdentityUidRepairFailureAudit(
  logger: OperationAuditLogger,
  payload: LocalNoteIdentityUidRepairFailureAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditWarn(
    logger,
    '[LocalNoteIdentityUidRepair]',
    'local_note_identity',
    'uid_repair_failure',
    payload,
    nowMs
  )
}
