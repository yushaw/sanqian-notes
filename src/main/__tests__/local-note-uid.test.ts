import { describe, expect, it } from 'vitest'
import {
  normalizeStoredLocalNoteUidForRepair,
  parseRequiredLocalNoteUidInput,
} from '../local-note-uid'

describe('local-note-uid helpers', () => {
  it('rejects blank or non-string values', () => {
    expect(parseRequiredLocalNoteUidInput('')).toBeNull()
    expect(parseRequiredLocalNoteUidInput('   ')).toBeNull()
    expect(parseRequiredLocalNoteUidInput(null)).toBeNull()
    expect(parseRequiredLocalNoteUidInput(undefined)).toBeNull()
    expect(parseRequiredLocalNoteUidInput(123)).toBeNull()
  })

  it('rejects trim-alias values with surrounding spaces', () => {
    expect(parseRequiredLocalNoteUidInput(' uid-1 ')).toBeNull()
  })

  it('canonicalizes UUID v4 to lowercase', () => {
    expect(parseRequiredLocalNoteUidInput('EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53'))
      .toBe('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
  })

  it('preserves legacy opaque non-UUID uids as-is', () => {
    expect(parseRequiredLocalNoteUidInput('uid:Foo')).toBe('uid:Foo')
  })

  it('normalizes persisted trim-alias values only in repair mode', () => {
    expect(normalizeStoredLocalNoteUidForRepair(' uid:Foo ')).toBe('uid:Foo')
    expect(normalizeStoredLocalNoteUidForRepair(' EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53 '))
      .toBe('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
  })
})
