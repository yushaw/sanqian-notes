import { describe, expect, it } from 'vitest'
import {
  generateLocalNoteUid,
  shouldRetryLocalNoteUidGenerationError,
  tryUseGeneratedLocalNoteUid,
} from '../local-note-uid-generation'

describe('local-note-uid-generation helpers', () => {
  it('detects retriable local uid generation errors', () => {
    expect(shouldRetryLocalNoteUidGenerationError({ code: 'SQLITE_CONSTRAINT' })).toBe(false)
    expect(shouldRetryLocalNoteUidGenerationError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true)
    expect(shouldRetryLocalNoteUidGenerationError({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true)
    expect(shouldRetryLocalNoteUidGenerationError(new Error('invalid local_note_identity.note_uid'))).toBe(true)
    expect(shouldRetryLocalNoteUidGenerationError(new Error('random'))).toBe(false)
  })

  it('returns null when generation cannot find a candidate within max attempts', () => {
    const generated = generateLocalNoteUid({
      maxAttempts: 1,
      hasInternalNoteId: () => true,
    })
    expect(generated).toBeNull()
  })

  it('retries use callback when configured error predicate says retriable', () => {
    let attempts = 0
    const result = tryUseGeneratedLocalNoteUid({
      maxAttempts: 3,
      hasInternalNoteId: () => false,
      shouldRetryError: shouldRetryLocalNoteUidGenerationError,
      tryUseUid: (uid) => {
        attempts += 1
        if (attempts === 1) {
          const error = new Error('invalid local_note_identity.note_uid')
          throw error
        }
        return uid
      },
    })

    expect(attempts).toBe(2)
    expect(result).toBeTruthy()
  })
})
