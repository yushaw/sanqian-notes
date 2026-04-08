import { describe, it, expect, vi } from 'vitest'
import type { NotebookFolderIpcDeps } from '../ipc/register-notebook-folder-ipc'
import { registerNotebookFolderIpc } from '../ipc/register-notebook-folder-ipc'

vi.mock('../internal-folder-path', () => ({
  normalizeInternalFolderPath: vi.fn((pathValue: string | null | undefined) => {
    if (typeof pathValue !== 'string') return null
    const trimmed = pathValue.trim()
    return trimmed || null
  }),
  getInternalFolderDepth: vi.fn((folderPath: string | null) => (
    folderPath ? folderPath.split('/').filter(Boolean).length : 0
  )),
  isValidInternalFolderName: vi.fn((name: string) => Boolean(name)),
  composeInternalFolderPath: vi.fn((parentFolderPath: string | null, folderName: string) => (
    parentFolderPath ? `${parentFolderPath}/${folderName}` : folderName
  )),
  getInternalFolderParentPath: vi.fn((folderPath: string) => {
    const segments = folderPath.split('/').filter(Boolean)
    if (segments.length <= 1) return null
    return segments.slice(0, -1).join('/')
  }),
  resolveInternalNotebook: vi.fn(() => ({ ok: true as const })),
  INTERNAL_FOLDER_MAX_DEPTH: 3,
}))

type Handler = (...args: unknown[]) => unknown

function createIpcMainLike() {
  const channels = new Map<string, Handler>()
  return {
    channels,
    ipcMainLike: {
      handle: vi.fn((channel: string, listener: Handler) => {
        channels.set(channel, listener)
      }),
    },
  }
}

function createDeps(overrides: Partial<NotebookFolderIpcDeps> = {}): NotebookFolderIpcDeps {
  return {
    getNotebookFolders: vi.fn(() => []),
    hasNotebookFolderPathReference: vi.fn(() => true),
    createNotebookFolderEntry: vi.fn(() => ({
      ok: true as const,
      value: {
        id: 'folder-1',
        notebook_id: 'nb-1',
        folder_path: 'docs',
        depth: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    })),
    renameNotebookFolderEntry: vi.fn(() => ({ ok: true as const })),
    deleteNotebookFolderEntry: vi.fn(() => ({
      ok: true as const,
      value: { deletedNoteIds: [] },
    })),
    deleteNoteIndex: vi.fn(),
    ...overrides,
  }
}

function setupHandlers(overrides: Partial<NotebookFolderIpcDeps> = {}) {
  const deps = createDeps(overrides)
  const { channels, ipcMainLike } = createIpcMainLike()
  registerNotebookFolderIpc(ipcMainLike, deps)
  return { channels, deps }
}

function getHandler(channels: Map<string, Handler>, channel: string): Handler {
  const handler = channels.get(channel)
  if (!handler) throw new Error(`Handler not registered for channel: ${channel}`)
  return handler
}

describe('register-notebook-folder-ipc notebook id semantics', () => {
  it('keeps global list behavior when notebook id is omitted', async () => {
    const folders = [{ folder_path: 'docs' }]
    const { channels, deps } = setupHandlers({
      getNotebookFolders: vi.fn(() => folders as any),
    })
    const handler = getHandler(channels, 'notebookFolder:list')
    const result = await handler({})
    expect(result).toBe(folders)
    expect(deps.getNotebookFolders).toHaveBeenCalledWith(undefined)
  })

  it('preserves surrounding spaces for notebookFolder:list input', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:list')
    await handler({}, notebookId)
    expect(deps.getNotebookFolders).toHaveBeenCalledWith(notebookId)
  })

  it('returns empty list for explicit invalid notebookFolder:list input', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:list')
    const result = await handler({}, 123 as any)
    expect(result).toEqual([])
    expect(deps.getNotebookFolders).not.toHaveBeenCalled()
  })

  it('returns empty list for notebookFolder:list input containing null byte or oversized id', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:list')

    const nullByteResult = await handler({}, 'nb-1\0bad')
    expect(nullByteResult).toEqual([])
    const oversizedResult = await handler({}, 'x'.repeat(1025))
    expect(oversizedResult).toEqual([])
    expect(deps.getNotebookFolders).not.toHaveBeenCalled()
  })

  it('preserves surrounding spaces for notebookFolder:create input', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:create')
    const result = await handler({}, {
      notebook_id: notebookId,
      parent_folder_path: null,
      folder_name: 'docs',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.createNotebookFolderEntry).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: notebookId,
    }))
  })

  it('preserves surrounding spaces for notebookFolder:rename input', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:rename')
    const result = await handler({}, {
      notebook_id: notebookId,
      folder_path: 'docs',
      new_name: 'archive',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.renameNotebookFolderEntry).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: notebookId,
    }))
  })

  it('preserves surrounding spaces for notebookFolder:delete input', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:delete')
    const result = await handler({}, {
      notebook_id: notebookId,
      folder_path: 'docs',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.deleteNotebookFolderEntry).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: notebookId,
    }))
  })

  it('fails closed for malformed notebookFolder:create payload without throwing', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:create')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      folder_name: { value: 'docs' },
      parent_folder_path: null,
    } as any)
    expect(result).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' })
    expect(deps.createNotebookFolderEntry).not.toHaveBeenCalled()
  })

  it('fails closed for oversized or null-byte notebookFolder:create inputs', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:create')

    const oversizedName = await handler({}, {
      notebook_id: 'nb-1',
      folder_name: 'x'.repeat(256),
      parent_folder_path: null,
    })
    expect(oversizedName).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' })

    const nullByteName = await handler({}, {
      notebook_id: 'nb-1',
      folder_name: 'docs\0bad',
      parent_folder_path: null,
    })
    expect(nullByteName).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' })

    const nullByteParent = await handler({}, {
      notebook_id: 'nb-1',
      folder_name: 'docs',
      parent_folder_path: 'team\0root',
    })
    expect(nullByteParent).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })

    const oversizedParent = await handler({}, {
      notebook_id: 'nb-1',
      folder_name: 'docs',
      parent_folder_path: 'x'.repeat(4097),
    })
    expect(oversizedParent).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })
    expect(deps.createNotebookFolderEntry).not.toHaveBeenCalled()
  })

  it('fails closed for malformed notebookFolder:rename payload without throwing', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:rename')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: { value: 'docs' },
      new_name: 'archive',
    } as any)
    expect(result).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })
    expect(deps.renameNotebookFolderEntry).not.toHaveBeenCalled()
  })

  it('fails closed for oversized or null-byte notebookFolder:rename inputs', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:rename')

    const nullBytePath = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: 'docs\0bad',
      new_name: 'archive',
    })
    expect(nullBytePath).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })

    const oversizedPath = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: 'x'.repeat(4097),
      new_name: 'archive',
    })
    expect(oversizedPath).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })

    const nullByteName = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: 'docs',
      new_name: 'archive\0bad',
    })
    expect(nullByteName).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' })

    const oversizedName = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: 'docs',
      new_name: 'x'.repeat(256),
    })
    expect(oversizedName).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' })
    expect(deps.renameNotebookFolderEntry).not.toHaveBeenCalled()
  })

  it('fails closed for malformed notebookFolder:delete payload without throwing', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:delete')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: { value: 'docs' },
    } as any)
    expect(result).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })
    expect(deps.deleteNotebookFolderEntry).not.toHaveBeenCalled()
  })

  it('fails closed for oversized or null-byte notebookFolder:delete folder path', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'notebookFolder:delete')

    const nullBytePath = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: 'docs\0bad',
    })
    expect(nullBytePath).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })

    const oversizedPath = await handler({}, {
      notebook_id: 'nb-1',
      folder_path: 'x'.repeat(4097),
    })
    expect(oversizedPath).toEqual({ success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' })
    expect(deps.deleteNotebookFolderEntry).not.toHaveBeenCalled()
  })
})
