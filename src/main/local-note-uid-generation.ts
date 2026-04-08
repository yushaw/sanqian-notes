import { v4 as uuidv4 } from 'uuid'

export const DEFAULT_LOCAL_NOTE_UID_MAX_GENERATION_ATTEMPTS = 128

function normalizeMaxAttempts(maxAttempts?: number): number {
  const candidate = Number(maxAttempts)
  if (!Number.isFinite(candidate)) {
    return DEFAULT_LOCAL_NOTE_UID_MAX_GENERATION_ATTEMPTS
  }
  const normalized = Math.trunc(candidate)
  return normalized > 0 ? normalized : DEFAULT_LOCAL_NOTE_UID_MAX_GENERATION_ATTEMPTS
}

export function shouldRetryLocalNoteUidGenerationError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (
    code === 'SQLITE_CONSTRAINT_UNIQUE'
    || code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  ) {
    return true
  }
  const message = error instanceof Error ? error.message : ''
  return message.includes('local_note_identity.note_uid')
}

export function generateLocalNoteUid(options: {
  hasInternalNoteId: (noteUid: string) => boolean
  isUidUnavailable?: (noteUid: string) => boolean
  maxAttempts?: number
}): string | null {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const generatedUid = uuidv4().toLowerCase()
    if (options.hasInternalNoteId(generatedUid)) continue
    if (options.isUidUnavailable?.(generatedUid)) continue
    return generatedUid
  }
  return null
}

export function tryUseGeneratedLocalNoteUid<T>(options: {
  hasInternalNoteId: (noteUid: string) => boolean
  isUidUnavailable?: (noteUid: string) => boolean
  maxAttempts?: number
  shouldRetryError?: (error: unknown) => boolean
  tryUseUid: (noteUid: string) => T | null
}): T | null {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const generatedUid = uuidv4().toLowerCase()
    if (options.hasInternalNoteId(generatedUid)) continue
    if (options.isUidUnavailable?.(generatedUid)) continue
    try {
      const result = options.tryUseUid(generatedUid)
      if (result !== null) {
        return result
      }
    } catch (error) {
      if (!options.shouldRetryError?.(error)) {
        throw error
      }
    }
  }
  return null
}
