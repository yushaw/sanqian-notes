import { describe, expect, it } from 'vitest'
import {
  needsLocalNoteIdentityUidRepair,
  resolveLocalNoteIdentityUidRepairPlan,
} from '../local-note-identity-uid-repair'

describe('local-note-identity uid repair plan', () => {
  it('returns none for canonical uid values without conflicts', () => {
    const plan = resolveLocalNoteIdentityUidRepairPlan(
      'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
      () => false
    )
    expect(plan).toEqual({ strategy: 'none' })
    expect(needsLocalNoteIdentityUidRepair('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53', () => false)).toBe(false)
  })

  it('returns normalize for trim/case aliases when not colliding with internal notes', () => {
    const uuidAliasPlan = resolveLocalNoteIdentityUidRepairPlan(
      'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53',
      () => false
    )
    expect(uuidAliasPlan).toEqual({
      strategy: 'normalize',
      candidateUid: 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
    })

    const trimAliasPlan = resolveLocalNoteIdentityUidRepairPlan(' uid:Foo ', () => false)
    expect(trimAliasPlan).toEqual({
      strategy: 'normalize',
      candidateUid: 'uid:Foo',
    })
  })

  it('returns regenerate for unparseable or colliding values', () => {
    expect(resolveLocalNoteIdentityUidRepairPlan('   ', () => false)).toEqual({
      strategy: 'regenerate',
    })
    expect(resolveLocalNoteIdentityUidRepairPlan('note-collision', (uid) => uid === 'note-collision')).toEqual({
      strategy: 'regenerate',
    })
  })
})
