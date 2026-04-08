import {
  emitOperationAuditInfo,
  type OperationAuditLogger,
} from './operation-audit'

export type LocalPerformanceAuditOperation =
  | 'local_folder_scan'
  | 'local_notebook_index_sync'

export interface LocalPerformanceSummaryAuditPayload {
  operation: LocalPerformanceAuditOperation
  notebook_id: string
  duration_ms: number
  slow_threshold_ms: number
  profile_enabled: boolean
  startup_phase: boolean
  startup_elapsed_ms: number
  startup_window_ms: number
  [key: string]: unknown
}

export function emitLocalPerformanceSummaryAudit(
  logger: OperationAuditLogger,
  label: string,
  payload: LocalPerformanceSummaryAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditInfo(
    logger,
    label,
    'local_performance',
    'summary',
    payload,
    nowMs
  )
}

