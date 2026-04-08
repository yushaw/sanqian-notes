import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalResourceId,
  createLocalResourceIdFromUid,
} from '../../shared/local-resource-id'

vi.mock('../database', () => ({
  getLocalNoteIdentityByPath: vi.fn(),
  getLocalNoteIdentityByUid: vi.fn(),
}))

import {
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
} from '../database'
import {
  buildAgentExecutionContext,
  getCurrentNoteContext,
  setUserContext,
} from '../user-context'

const UID_A = '11111111-1111-4111-8111-111111111111'
const UID_B = '22222222-2222-4222-8222-222222222222'

describe('user-context note snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUserContext({
      currentNotebookId: null,
      currentNotebookName: null,
      currentNoteId: null,
      currentNoteTitle: null,
      currentBlockId: null,
      selectedText: null,
      cursorContext: null,
    })
  })

  it('keeps internal note ids unchanged', () => {
    setUserContext({
      currentNoteId: 'note-1',
      currentNoteTitle: 'Internal',
    })

    expect(getCurrentNoteContext()).toEqual({
      noteId: 'note-1',
      noteTitle: 'Internal',
    })
  })

  it('normalizes local path ids to stable local uid ids', () => {
    const localPathId = createLocalResourceId('nb-1', 'docs/plan.md')
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({
      note_uid: UID_A,
    } as ReturnType<typeof getLocalNoteIdentityByPath>)

    setUserContext({
      currentNoteId: localPathId,
      currentNoteTitle: 'Local',
    })

    expect(getCurrentNoteContext()).toEqual({
      noteId: createLocalResourceIdFromUid('nb-1', UID_A),
      noteTitle: 'Local',
    })
  })

  it('keeps uid-form local ids stable', () => {
    const localUidId = createLocalResourceIdFromUid('nb-1', UID_B)
    setUserContext({
      currentNoteId: localUidId,
      currentNoteTitle: 'Local',
    })

    expect(getCurrentNoteContext()).toEqual({
      noteId: localUidId,
      noteTitle: 'Local',
    })
  })

  it('normalizes local path ids to stable legacy uid-form ids', () => {
    const localPathId = createLocalResourceId('nb-1', 'docs/legacy.md')
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({
      note_uid: 'legacy:UID-42',
    } as ReturnType<typeof getLocalNoteIdentityByPath>)

    setUserContext({
      currentNoteId: localPathId,
      currentNoteTitle: 'Legacy Local',
    })

    expect(getCurrentNoteContext()).toEqual({
      noteId: createLocalResourceIdFromUid('nb-1', 'legacy:UID-42'),
      noteTitle: 'Legacy Local',
    })
  })

  it('falls back to original local id when identity lookup misses', () => {
    const localPathId = createLocalResourceId('nb-1', 'docs/missing.md')
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(getLocalNoteIdentityByUid).mockReturnValue(null)

    setUserContext({
      currentNoteId: localPathId,
      currentNoteTitle: 'Local',
    })

    expect(getCurrentNoteContext()).toEqual({
      noteId: localPathId,
      noteTitle: 'Local',
    })
  })

  it('falls back to original local path id when identity uid is invalid trim alias', () => {
    const localPathId = createLocalResourceId('nb-1', 'docs/plan.md')
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({
      note_uid: ' legacy:UID-42 ',
    } as ReturnType<typeof getLocalNoteIdentityByPath>)

    setUserContext({
      currentNoteId: localPathId,
      currentNoteTitle: 'Local',
    })

    expect(getCurrentNoteContext()).toEqual({
      noteId: localPathId,
      noteTitle: 'Local',
    })
  })

  it('buildAgentExecutionContext falls back to localResourceId when identity uid is invalid trim alias', () => {
    const localPathId = createLocalResourceId('nb-1', 'docs/plan.md')
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({
      note_uid: ' legacy:UID-42 ',
    } as ReturnType<typeof getLocalNoteIdentityByPath>)

    const context = buildAgentExecutionContext({
      sourceApp: 'sanqian-notes',
      sourceType: 'local-folder',
      noteId: localPathId,
      localResourceId: localPathId,
      localRelativePath: 'docs/plan.md',
      noteTitle: 'Local Plan',
      notebookId: 'nb-1',
      notebookName: 'Local',
      heading: null,
    })

    expect(context).toContain(`local_resource_id: ${localPathId}`)
    expect(context).not.toContain('legacy:UID-42')
  })
})
