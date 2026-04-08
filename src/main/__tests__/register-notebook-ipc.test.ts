import { describe, expect, it, vi } from 'vitest'
import type {
  InternalNotebookInput,
  InternalNotebookUpdateInput,
  Notebook,
  NotebookDeleteInternalResponse,
} from '../../shared/types'
import { registerNotebookIpc, type NotebookIpcDependencies } from '../ipc/register-notebook-ipc'

const NOW = '2026-02-26T00:00:00.000Z'

function createNotebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: 'nb-1',
    name: 'Notebook',
    icon: 'logo:notes',
    source_type: 'internal',
    order_index: 0,
    created_at: NOW,
    ...overrides,
  }
}

function createDeps(overrides: Partial<NotebookIpcDependencies> = {}): NotebookIpcDependencies {
  return {
    getNotebooks: vi.fn(() => [createNotebook()]),
    addNotebook: vi.fn((input: InternalNotebookInput) => createNotebook({ name: input.name, icon: input.icon })),
    updateNotebook: vi.fn((id: string, updates: InternalNotebookUpdateInput) => createNotebook({ id, ...updates })),
    deleteInternalNotebookWithNotes: vi.fn(
      (input: { notebook_id: string }): NotebookDeleteInternalResponse => ({
        success: true,
        result: {
          deleted_note_ids: [input.notebook_id],
          deleted_at: NOW,
        },
      })
    ),
    reorderNotebooks: vi.fn(() => undefined),
    ...overrides,
  }
}

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

describe('register-notebook-ipc', () => {
  it('registers notebook IPC handlers and routes calls', () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()

    registerNotebookIpc(ipcMainLike, deps)

    expect(ipcMainLike.handle).toHaveBeenCalledTimes(5)
    expect(channels.has('notebook:getAll')).toBe(true)
    expect(channels.has('notebook:add')).toBe(true)
    expect(channels.has('notebook:update')).toBe(true)
    expect(channels.has('notebook:reorder')).toBe(true)
    expect(channels.has('notebook:deleteInternalWithNotes')).toBe(true)

    const getAll = channels.get('notebook:getAll')
    const add = channels.get('notebook:add')
    const update = channels.get('notebook:update')
    const deleteInternal = channels.get('notebook:deleteInternalWithNotes')
    const reorder = channels.get('notebook:reorder')
    expect(getAll).toBeDefined()
    expect(add).toBeDefined()
    expect(update).toBeDefined()
    expect(deleteInternal).toBeDefined()
    expect(reorder).toBeDefined()
    if (!getAll || !add || !update || !deleteInternal || !reorder) return

    getAll({})
    add({}, { name: '  Created  ', icon: 'logo:notes' })
    update({}, 'nb-1', { name: '  Updated  ', icon: 'logo:todolist' })
    deleteInternal({}, { notebook_id: 'nb-1' })
    reorder({}, ['nb-2', 'nb-1'])

    expect(deps.getNotebooks).toHaveBeenCalledTimes(1)
    expect(deps.addNotebook).toHaveBeenCalledWith({ name: 'Created', icon: 'logo:notes' })
    expect(deps.updateNotebook).toHaveBeenCalledWith('nb-1', { name: 'Updated', icon: 'logo:todolist' })
    expect(deps.deleteInternalNotebookWithNotes).toHaveBeenCalledWith({ notebook_id: 'nb-1' })
    expect(deps.reorderNotebooks).toHaveBeenCalledWith(['nb-2', 'nb-1'])
  })

  it('notebook:add rejects non-internal source_type input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const add = channels.get('notebook:add')
    expect(add).toBeDefined()
    if (!add) return

    await expect(
      add({}, { name: 'Unsafe', icon: 'logo:notes', source_type: 'local-folder' })
    ).rejects.toThrow('notebook:add does not support source_type=local-folder')
    expect(deps.addNotebook).not.toHaveBeenCalled()
  })

  it('notebook:add rejects falsy non-internal source_type input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const add = channels.get('notebook:add')
    expect(add).toBeDefined()
    if (!add) return

    await expect(
      add({}, { name: 'Unsafe', source_type: '' })
    ).rejects.toThrow('notebook:add does not support source_type=')
    await expect(
      add({}, { name: 'Unsafe', source_type: false })
    ).rejects.toThrow('notebook:add does not support source_type=false')
    expect(deps.addNotebook).not.toHaveBeenCalled()
  })

  it('notebook:update rejects non-internal source_type input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const update = channels.get('notebook:update')
    expect(update).toBeDefined()
    if (!update) return

    await expect(
      update({}, 'nb-1', { source_type: 'local-folder' })
    ).rejects.toThrow('notebook:update does not support source_type=local-folder')
    expect(deps.updateNotebook).not.toHaveBeenCalled()
  })

  it('notebook:update rejects falsy non-internal source_type input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const update = channels.get('notebook:update')
    expect(update).toBeDefined()
    if (!update) return

    await expect(
      update({}, 'nb-1', { source_type: '' })
    ).rejects.toThrow('notebook:update does not support source_type=')
    await expect(
      update({}, 'nb-1', { source_type: 0 })
    ).rejects.toThrow('notebook:update does not support source_type=0')
    expect(deps.updateNotebook).not.toHaveBeenCalled()
  })

  it('notebook:add rejects invalid payload shape', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const add = channels.get('notebook:add')
    expect(add).toBeDefined()
    if (!add) return

    await expect(add({}, null)).rejects.toThrow('notebook:add payload must be an object')
    await expect(add({}, { name: 1 })).rejects.toThrow('notebook:add name must be a string')
    await expect(add({}, { name: '   ' })).rejects.toThrow('notebook:add name must not be empty')
    await expect(add({}, { name: 'Valid', icon: 1 })).rejects.toThrow('notebook:add icon must be a string')
    await expect(add({}, { name: 'Valid\0Name' })).rejects.toThrow('notebook:add name must not be empty')
    await expect(add({}, { name: 'Valid', icon: 'logo\0notes' })).rejects.toThrow(
      'notebook:add icon exceeds max length 64'
    )
    expect(deps.addNotebook).not.toHaveBeenCalled()
  })

  it('notebook:update rejects invalid payload shape', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const update = channels.get('notebook:update')
    expect(update).toBeDefined()
    if (!update) return

    await expect(update({}, 'nb-1', null)).rejects.toThrow('notebook:update payload must be an object')
    await expect(update({}, 'nb-1', { name: 1 })).rejects.toThrow('notebook:update name must be a string')
    await expect(update({}, 'nb-1', { name: '   ' })).rejects.toThrow('notebook:update name must not be empty')
    await expect(update({}, 'nb-1', { icon: 1 })).rejects.toThrow('notebook:update icon must be a string')
    await expect(update({}, 'nb-1', { name: 'Updated\0Name' })).rejects.toThrow(
      'notebook:update name must not be empty'
    )
    await expect(update({}, 'nb-1', { icon: 'logo\0notes' })).rejects.toThrow(
      'notebook:update icon exceeds max length 64'
    )
    expect(deps.updateNotebook).not.toHaveBeenCalled()
  })

  it('notebook:update fails closed for invalid id payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const update = channels.get('notebook:update')
    expect(update).toBeDefined()
    if (!update) return

    await expect(update({}, 123, { name: 'Updated' })).resolves.toBeNull()
    await expect(update({}, '   ', { name: 'Updated' })).resolves.toBeNull()
    await expect(update({}, 'nb-1\0bad', { name: 'Updated' })).resolves.toBeNull()
    await expect(update({}, 'x'.repeat(1025), { name: 'Updated' })).resolves.toBeNull()
    expect(deps.updateNotebook).not.toHaveBeenCalled()
  })

  it('notebook:update keeps opaque id input without trimming', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const update = channels.get('notebook:update')
    expect(update).toBeDefined()
    if (!update) return

    await update({}, '  nb-1  ', { name: 'Updated' })
    expect(deps.updateNotebook).toHaveBeenCalledWith('  nb-1  ', { name: 'Updated', icon: undefined })
  })

  it('notebook:deleteInternalWithNotes rejects invalid payload shape', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const deleteInternal = channels.get('notebook:deleteInternalWithNotes')
    expect(deleteInternal).toBeDefined()
    if (!deleteInternal) return

    await expect(deleteInternal({}, null)).rejects.toThrow(
      'notebook:deleteInternalWithNotes payload must be an object'
    )
    await expect(deleteInternal({}, { notebook_id: 1 })).rejects.toThrow(
      'notebook:deleteInternalWithNotes notebook_id must be a non-empty string'
    )
    await expect(deleteInternal({}, { notebook_id: '   ' })).rejects.toThrow(
      'notebook:deleteInternalWithNotes notebook_id must be a non-empty string'
    )
    await expect(deleteInternal({}, { notebook_id: 'nb-1\0bad' })).rejects.toThrow(
      'notebook:deleteInternalWithNotes notebook_id must be a non-empty string'
    )
    await expect(deleteInternal({}, { notebook_id: 'x'.repeat(1025) })).rejects.toThrow(
      'notebook:deleteInternalWithNotes notebook_id must be a non-empty string'
    )
    expect(deps.deleteInternalNotebookWithNotes).not.toHaveBeenCalled()
  })

  it('notebook:deleteInternalWithNotes keeps opaque notebook ids without trimming', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const deleteInternal = channels.get('notebook:deleteInternalWithNotes')
    expect(deleteInternal).toBeDefined()
    if (!deleteInternal) return

    await deleteInternal({}, { notebook_id: '  nb-1  ' })
    expect(deps.deleteInternalNotebookWithNotes).toHaveBeenCalledWith({ notebook_id: '  nb-1  ' })
  })

  it('notebook:reorder rejects invalid payload shape', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const reorder = channels.get('notebook:reorder')
    expect(reorder).toBeDefined()
    if (!reorder) return

    await expect(reorder({}, null)).rejects.toThrow('notebook:reorder payload must be an array')
    await expect(reorder({}, ['nb-1', 2])).rejects.toThrow(
      'notebook:reorder notebook ids must be non-empty strings'
    )
    await expect(reorder({}, ['nb-1', '   '])).rejects.toThrow(
      'notebook:reorder notebook ids must be non-empty strings'
    )
    await expect(reorder({}, ['nb-1', 'nb-2\0bad'])).rejects.toThrow(
      'notebook:reorder notebook ids must be non-empty strings'
    )
    await expect(reorder({}, ['nb-1', 'x'.repeat(1025)])).rejects.toThrow(
      'notebook:reorder notebook ids must be non-empty strings'
    )
    expect(deps.reorderNotebooks).not.toHaveBeenCalled()
  })

  it('notebook:reorder rejects duplicate notebook ids', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const reorder = channels.get('notebook:reorder')
    expect(reorder).toBeDefined()
    if (!reorder) return

    await expect(reorder({}, ['nb-1', 'nb-1'])).rejects.toThrow(
      'notebook:reorder notebook ids must be unique'
    )
    expect(deps.reorderNotebooks).not.toHaveBeenCalled()
  })

  it('notebook:reorder keeps opaque notebook ids without trimming', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNotebookIpc(ipcMainLike, deps)

    const reorder = channels.get('notebook:reorder')
    expect(reorder).toBeDefined()
    if (!reorder) return

    await reorder({}, ['nb-1', '  nb-2  '])
    expect(deps.reorderNotebooks).toHaveBeenCalledWith(['nb-1', '  nb-2  '])
  })
})
