import { describe, expect, it } from 'vitest'
import {
  isMountAvailabilityFsError,
  resolveUnavailableMountStatusFromFsError,
} from '../local-folder-mount-fs-error'

describe('local-folder-mount-fs-error', () => {
  it('returns false for non-fs errors', () => {
    expect(isMountAvailabilityFsError(new Error('boom'))).toBe(false)
    expect(isMountAvailabilityFsError({ code: 'PARSER_ERROR' })).toBe(false)
  })

  it('recognizes mount-availability fs errno codes', () => {
    expect(isMountAvailabilityFsError({ code: 'ENOENT' })).toBe(true)
    expect(isMountAvailabilityFsError({ code: 'EACCES' })).toBe(true)
  })

  it('maps permission-related fs errors to permission_required', () => {
    const result = resolveUnavailableMountStatusFromFsError(
      { code: 'EACCES' },
      () => 'permission_required'
    )
    expect(result).toBe('permission_required')
  })

  it('maps other fs errors to missing', () => {
    const result = resolveUnavailableMountStatusFromFsError(
      { code: 'ENOENT' },
      () => 'active'
    )
    expect(result).toBe('missing')
  })

  it('returns null for unknown error codes', () => {
    const result = resolveUnavailableMountStatusFromFsError(
      { code: 'PARSER_ERROR' },
      () => 'missing'
    )
    expect(result).toBeNull()
  })
})
