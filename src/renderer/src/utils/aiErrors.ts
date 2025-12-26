/**
 * AI Error Handling Utilities
 *
 * Shared error code detection and message mapping for all AI components.
 */

// Error codes for AI operations
export type AIErrorCode = 'connectionFailed' | 'disconnected' | 'timeout' | 'unauthorized' | 'generic'

/**
 * Detect error code from raw error
 */
export function getAIErrorCode(err: unknown): AIErrorCode {
  const msg = err instanceof Error ? err.message : String(err)

  if (msg.includes('Failed to sync') || msg.includes('SDK not initialized')) {
    return 'connectionFailed'
  }
  if (msg.includes('not connected') || msg.includes('connection')) {
    return 'disconnected'
  }
  if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
    return 'timeout'
  }
  if (msg.includes('unauthorized') || msg.includes('UNAUTHORIZED') || msg.includes('401')) {
    return 'unauthorized'
  }
  return 'generic'
}

/**
 * Map legacy error codes (from SDK) to our error codes
 */
export function mapLegacyErrorCode(code: string): AIErrorCode {
  switch (code) {
    case 'CONNECTION_FAILED':
      return 'connectionFailed'
    case 'TIMEOUT':
      return 'timeout'
    case 'UNAUTHORIZED':
      return 'unauthorized'
    default:
      return 'generic'
  }
}

/**
 * Get translated error message
 * @param code - Error code
 * @param t - Translations object with ai.errorXxx keys
 */
export function getAIErrorMessage(
  code: AIErrorCode,
  t: { ai: { errorConnectionFailed: string; errorDisconnected: string; errorTimeout: string; errorAuthFailed: string; errorGeneric: string } }
): string {
  switch (code) {
    case 'connectionFailed':
      return t.ai.errorConnectionFailed
    case 'disconnected':
      return t.ai.errorDisconnected
    case 'timeout':
      return t.ai.errorTimeout
    case 'unauthorized':
      return t.ai.errorAuthFailed
    default:
      return t.ai.errorGeneric
  }
}
