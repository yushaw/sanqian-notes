import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../database', () => ({
  getNoteById: vi.fn(() => null),
  addNote: vi.fn(),
  updateNoteSafe: vi.fn(),
  deleteNote: vi.fn(),
  getNotebooks: vi.fn(() => []),
  getLocalNoteMetadata: vi.fn(() => null),
  getLocalNoteIdentityByPath: vi.fn(() => null),
  updateLocalNoteMetadata: vi.fn(() => null),
  moveNote: vi.fn(),
}))

vi.mock('../../i18n', () => ({
  t: () => ({
    common: {
      unknownError: 'Unknown error',
    },
    tools: {
      createNote: {
        description: 'Create note',
        titleDesc: 'title',
        contentDesc: 'content',
        notebookIdDesc: 'notebook',
        notebookNotFound: 'Notebook not found',
        localNotebookUnavailable: 'Local notebook unavailable',
        success: 'ok',
      },
    },
  }),
}))

vi.mock('../../markdown', () => ({
  markdownToTiptapString: vi.fn((input: string) => `json:${input}`),
}))

vi.mock('../../local-folder', () => ({
  createLocalFolderFile: vi.fn(),
  readLocalFolderFile: vi.fn(),
  renameLocalFolderEntry: vi.fn(),
  saveLocalFolderFile: vi.fn(),
}))

vi.mock('../../local-file-compensation', () => ({
  rollbackLocalFile: vi.fn(),
  trashLocalFile: vi.fn(),
}))

vi.mock('../../../shared/local-resource-id', () => ({
  createLocalResourceId: vi.fn(() => 'local:id'),
}))

vi.mock('../../note-gateway', () => ({
  buildInternalEtag: vi.fn(() => 'etag:internal'),
  buildLocalEtag: vi.fn(() => 'etag:local'),
  resolveIfMatchForInternal: vi.fn(),
  resolveIfMatchForLocal: vi.fn(),
  resolveNoteResourceAsync: vi.fn(),
  resolveNotebookForCreate: vi.fn(),
  buildCanonicalLocalResourceId: vi.fn(),
}))

vi.mock('../helpers/content-mutation', () => ({
  buildUpdatedNoteContent: vi.fn(),
}))

vi.mock('../helpers/error-mapping', () => {
  class ToolError extends Error {}
  return {
    buildLocalEtagFromFile: vi.fn(() => 'etag:file'),
    mapIfMatchCheckError: vi.fn(() => null),
    mapLocalToolErrorCode: vi.fn((value: string) => value),
    isLocalIfMatchStale: vi.fn(() => false),
    ToolError,
  }
})

vi.mock('../helpers/caching', () => ({
  getActiveLocalMountByNotebookId: vi.fn(() => null),
}))

vi.mock('../helpers/local-note-helpers', () => ({
  migrateLocalNoteMetadataPath: vi.fn(),
  ensureLocalNoteIdentityForPath: vi.fn(),
  syncLocalNoteDerivedState: vi.fn(),
  moveLocalNoteIdentityAcrossNotebooks: vi.fn(),
  cleanupLocalNoteMetadata: vi.fn(),
}))

vi.mock('../../local-note-uid', () => ({
  parseRequiredLocalNoteUidInput: vi.fn(() => null),
}))

vi.mock('../state', () => ({
  notifyDataChange: vi.fn(),
  triggerIndexingForNote: vi.fn(),
  deleteIndexForNote: vi.fn(),
  syncIndexedNotebookForNote: vi.fn(),
}))

import { addNote } from '../../database'
import { resolveNotebookForCreate } from '../../note-gateway'
import { notifyDataChange, triggerIndexingForNote } from '../state'
import { buildCreateNoteTool } from './mutations'

describe('buildCreateNoteTool notebook validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveNotebookForCreate).mockReturnValue({
      ok: true,
      sourceType: 'internal',
      notebook: null,
    } as any)
    vi.mocked(addNote).mockReturnValue({
      id: 'note-1',
      title: 'T',
      content: '',
      notebook_id: null,
      revision: 1,
    } as any)
  })

  it('rejects explicit blank notebook_id instead of falling back to default notebook', async () => {
    const tool = buildCreateNoteTool()

    await expect(tool.handler({ title: 'T', notebook_id: '' })).rejects.toThrow('Notebook not found:')
    expect(resolveNotebookForCreate).not.toHaveBeenCalled()
    expect(addNote).not.toHaveBeenCalled()
  })

  it('keeps default internal create behavior when notebook_id is omitted', async () => {
    const tool = buildCreateNoteTool()

    await expect(tool.handler({ title: 'T' })).resolves.toEqual({
      id: 'note-1',
      title: 'T',
      source_type: 'internal',
      revision: 1,
      etag: 'etag:internal',
      message: 'ok',
    })
    expect(resolveNotebookForCreate).toHaveBeenCalledWith(null)
    expect(addNote).toHaveBeenCalledWith({
      title: 'T',
      content: '',
      notebook_id: null,
    })
    expect(triggerIndexingForNote).toHaveBeenCalledWith('note-1', null, '')
    expect(notifyDataChange).toHaveBeenCalledTimes(1)
  })

  it('treats explicit undefined notebook_id as omitted', async () => {
    const tool = buildCreateNoteTool()

    await expect(tool.handler({ title: 'T', notebook_id: undefined })).resolves.toEqual({
      id: 'note-1',
      title: 'T',
      source_type: 'internal',
      revision: 1,
      etag: 'etag:internal',
      message: 'ok',
    })
    expect(resolveNotebookForCreate).toHaveBeenCalledWith(null)
    expect(addNote).toHaveBeenCalledWith({
      title: 'T',
      content: '',
      notebook_id: null,
    })
    expect(triggerIndexingForNote).toHaveBeenCalledWith('note-1', null, '')
    expect(notifyDataChange).toHaveBeenCalledTimes(1)
  })
})
