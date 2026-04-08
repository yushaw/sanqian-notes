import {
  emitOperationAuditInfo,
  type OperationAuditLogger,
} from './operation-audit'

export interface NotebookDeleteAuditPayload {
  operation: 'internal_delete'
  notebookId: string
  success: boolean
  durationMs: number
  errorCode?: string
  deletedNoteCount?: number
}

export function emitNotebookDeleteAudit(
  logger: OperationAuditLogger,
  payload: NotebookDeleteAuditPayload,
  nowMs: number = Date.now()
): void {
  emitOperationAuditInfo(
    logger,
    '[NotebookDeleteAudit]',
    'notebook',
    payload.operation,
    payload,
    nowMs
  )
}
