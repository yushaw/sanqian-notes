export interface OperationAuditLogger {
  info: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

export interface OperationAuditEventEnvelope<TDomain extends string, TEvent extends string> {
  schema: 'operation_audit'
  version: 1
  domain: TDomain
  event: TEvent
  at_ms: number
}

function buildOperationAuditEvent<
  TDomain extends string,
  TEvent extends string,
  TPayload extends object,
>(
  domain: TDomain,
  event: TEvent,
  payload: TPayload,
  nowMs: number
): OperationAuditEventEnvelope<TDomain, TEvent> & TPayload {
  return {
    schema: 'operation_audit',
    version: 1,
    domain,
    event,
    at_ms: nowMs,
    ...payload,
  }
}

export function emitOperationAuditInfo<
  TDomain extends string,
  TEvent extends string,
  TPayload extends object,
>(
  logger: OperationAuditLogger,
  label: string,
  domain: TDomain,
  event: TEvent,
  payload: TPayload,
  nowMs: number = Date.now()
): void {
  logger.info(label, JSON.stringify(buildOperationAuditEvent(domain, event, payload, nowMs)))
}

export function emitOperationAuditWarn<
  TDomain extends string,
  TEvent extends string,
  TPayload extends object,
>(
  logger: OperationAuditLogger,
  label: string,
  domain: TDomain,
  event: TEvent,
  payload: TPayload,
  nowMs: number = Date.now()
): void {
  const warn = logger.warn ?? logger.info
  warn(label, JSON.stringify(buildOperationAuditEvent(domain, event, payload, nowMs)))
}
