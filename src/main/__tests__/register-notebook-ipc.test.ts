import { describe, expect, it, vi } from 'vitest'
import type { Notebook, NotebookInput } from '../../shared/types'
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
    addNotebook: vi.fn((input: NotebookInput) => createNotebook({ name: input.name, icon: input.icon })),
    updateNotebook: vi.fn((id: string, updates: Partial<NotebookInput>) => createNotebook({ id, ...updates })),
    deleteNotebook: vi.fn(() => true),
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
    expect(channels.has('notebook:reorder')).toBe(true)

    const getAll = channels.get('notebook:getAll')
    const reorder = channels.get('notebook:reorder')
    expect(getAll).toBeDefined()
    expect(reorder).toBeDefined()
    if (!getAll || !reorder) return

    getAll({})
    reorder({}, ['nb-2', 'nb-1'])

    expect(deps.getNotebooks).toHaveBeenCalledTimes(1)
    expect(deps.reorderNotebooks).toHaveBeenCalledWith(['nb-2', 'nb-1'])
  })
})
