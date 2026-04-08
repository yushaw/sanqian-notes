import type { LocalFolderIpcRuntimeWaitStatsEntry } from './local-folder-ipc-runtime'
import {
  emitOperationAuditInfo,
  emitOperationAuditWarn,
  type OperationAuditLogger,
} from './operation-audit'

export type LocalFolderAuditEventName =
  | 'unmount'
  | 'ipc_wait_stats'
  | 'ipc_wait_alert'

export type LocalFolderAuditLogger = OperationAuditLogger

export interface LocalFolderUnmountAuditPayload {
  notebookId: string
  success: boolean
  durationMs: number
  errorCode?: string
}

export interface LocalFolderIpcWaitStatsAuditPayload {
  reason: 'interval' | 'before_quit' | 'will_quit'
  collected_at_ms: number
  entry_count: number
  entries: LocalFolderIpcRuntimeWaitStatsEntry[]
}

export interface LocalFolderIpcWaitAlertThresholds {
  min_sample_count: number
  max_wait_ms: number
  avg_wait_ms: number
  slow_ratio: number
}

export interface LocalFolderIpcWaitAlertItem {
  operation: LocalFolderIpcRuntimeWaitStatsEntry['operation']
  phase: string
  count: number
  slowCount: number
  maxWaitMs: number
  averageWaitMs: number
  slowRatio: number
  reasons: string[]
  suppressedCount?: number
}

export interface LocalFolderIpcWaitAlertAuditPayload {
  collected_at_ms: number
  alert_count: number
  thresholds: LocalFolderIpcWaitAlertThresholds
  alerts: LocalFolderIpcWaitAlertItem[]
}

export function emitLocalFolderUnmountAudit(
  logger: LocalFolderAuditLogger,
  payload: LocalFolderUnmountAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditInfo(logger, '[LocalFolderUnmountAudit]', 'local_folder', 'unmount', payload, nowMs)
}

export function emitLocalFolderIpcWaitStatsAudit(
  logger: LocalFolderAuditLogger,
  payload: LocalFolderIpcWaitStatsAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditInfo(
    logger,
    '[LocalFolderIpcWaitStats]',
    'local_folder',
    'ipc_wait_stats',
    payload,
    nowMs
  )
}

export function emitLocalFolderIpcWaitAlertAudit(
  logger: LocalFolderAuditLogger,
  payload: LocalFolderIpcWaitAlertAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditWarn(
    logger,
    '[LocalFolderIpcWaitStatsAlert]',
    'local_folder',
    'ipc_wait_alert',
    payload,
    nowMs
  )
}
