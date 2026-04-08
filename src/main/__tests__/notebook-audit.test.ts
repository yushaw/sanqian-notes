import { describe, expect, it, vi } from 'vitest'
import { emitNotebookDeleteAudit } from '../notebook-audit'

describe('notebook-audit', () => {
  it('emits notebook delete audit with unified operation envelope', () => {
    const logger = {
      info: vi.fn(),
    }

    emitNotebookDeleteAudit(logger, {
      operation: 'internal_delete',
      notebookId: 'nb-1',
      success: true,
      durationMs: 9,
      deletedNoteCount: 2,
    }, 555)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info.mock.calls[0]?.[0]).toBe('[NotebookDeleteAudit]')
    const payload = JSON.parse(String(logger.info.mock.calls[0]?.[1]))
    expect(payload).toMatchObject({
      schema: 'operation_audit',
      version: 1,
      domain: 'notebook',
      event: 'internal_delete',
      at_ms: 555,
      operation: 'internal_delete',
      notebookId: 'nb-1',
      success: true,
      durationMs: 9,
      deletedNoteCount: 2,
    })
  })
})
