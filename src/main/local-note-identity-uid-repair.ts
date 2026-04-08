import { normalizeStoredLocalNoteUidForRepair } from './local-note-uid'

export type LocalNoteIdentityUidRepairPlan = {
  strategy: 'none'
} | {
  strategy: 'normalize'
  candidateUid: string
} | {
  strategy: 'regenerate'
}

export function resolveLocalNoteIdentityUidRepairPlan(
  noteUid: string,
  hasInternalNoteId: (noteUid: string) => boolean
): LocalNoteIdentityUidRepairPlan {
  const normalizedUid = normalizeStoredLocalNoteUidForRepair(noteUid)
  if (!normalizedUid) {
    return { strategy: 'regenerate' }
  }
  if (hasInternalNoteId(normalizedUid)) {
    return { strategy: 'regenerate' }
  }
  if (normalizedUid !== noteUid) {
    return {
      strategy: 'normalize',
      candidateUid: normalizedUid,
    }
  }
  return { strategy: 'none' }
}

export function needsLocalNoteIdentityUidRepair(
  noteUid: string,
  hasInternalNoteId: (noteUid: string) => boolean
): boolean {
  return resolveLocalNoteIdentityUidRepairPlan(noteUid, hasInternalNoteId).strategy !== 'none'
}
