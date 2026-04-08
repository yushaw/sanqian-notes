import { describe, expect, it, vi } from 'vitest'
import type { AttachmentIpcDeps } from '../ipc/register-attachment-ipc'
import { registerAttachmentIpc } from '../ipc/register-attachment-ipc'

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

function createDeps(overrides: Partial<AttachmentIpcDeps> = {}): AttachmentIpcDeps {
  return {
    saveAttachment: vi.fn(async () => ({ relativePath: 'attachments/a.png' })),
    saveAttachmentBuffer: vi.fn(async () => ({ relativePath: 'attachments/b.png' })),
    deleteAttachment: vi.fn(async () => true),
    openAttachment: vi.fn(async () => undefined),
    showInFolder: vi.fn(),
    selectFiles: vi.fn(async () => []),
    selectImages: vi.fn(async () => []),
    getFullPath: vi.fn(() => '/tmp/attachment.png'),
    attachmentExists: vi.fn(async () => true),
    getAllAttachments: vi.fn(async () => []),
    getUsedAttachmentPaths: vi.fn(() => ['attachments/a.png']),
    cleanupOrphanAttachments: vi.fn(async () => 1),
    ...overrides,
  }
}

describe('register-attachment-ipc', () => {
  it('registers attachment channels', () => {
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, createDeps())

    expect(ipcMainLike.handle).toHaveBeenCalledTimes(11)
    expect(channels.has('attachment:save')).toBe(true)
    expect(channels.has('attachment:saveBuffer')).toBe(true)
    expect(channels.has('attachment:selectFiles')).toBe(true)
    expect(channels.has('attachment:cleanup')).toBe(true)
  })

  it('rejects invalid attachment:save payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const handler = channels.get('attachment:save')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, '')).rejects.toThrow('attachment:save filePath is invalid')
    expect(deps.saveAttachment).not.toHaveBeenCalled()
  })

  it('rejects invalid attachment:saveBuffer payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const handler = channels.get('attachment:saveBuffer')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { foo: 'bar' }, '.png')).rejects.toThrow('attachment:saveBuffer payload is invalid')
    await expect(handler({}, Buffer.from('x'), '', 'file')).rejects.toThrow('attachment:saveBuffer payload is invalid')
    await expect(handler({}, Buffer.from('x'), '../png', 'file')).rejects.toThrow('attachment:saveBuffer payload is invalid')
    await expect(handler({}, Buffer.from('x'), '.')).rejects.toThrow('attachment:saveBuffer payload is invalid')
    await expect(handler({}, Buffer.from('x'), '.png', 'a'.repeat(256))).rejects.toThrow('attachment:saveBuffer payload is invalid')
    expect(deps.saveAttachmentBuffer).not.toHaveBeenCalled()
  })

  it('normalizes extension for attachment:saveBuffer', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const handler = channels.get('attachment:saveBuffer')
    expect(handler).toBeDefined()
    if (!handler) return

    const buffer = Buffer.from('x')
    await expect(handler({}, buffer, '.PNG', 'file')).resolves.toEqual({ relativePath: 'attachments/b.png' })
    expect(deps.saveAttachmentBuffer).toHaveBeenCalledWith(buffer, 'png', 'file')
  })

  it('fails closed for invalid attachment path payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const deleteHandler = channels.get('attachment:delete')
    const openHandler = channels.get('attachment:open')
    const showHandler = channels.get('attachment:showInFolder')
    const fullPathHandler = channels.get('attachment:getFullPath')
    const existsHandler = channels.get('attachment:exists')
    expect(deleteHandler).toBeDefined()
    expect(openHandler).toBeDefined()
    expect(showHandler).toBeDefined()
    expect(fullPathHandler).toBeDefined()
    expect(existsHandler).toBeDefined()
    if (!deleteHandler || !openHandler || !showHandler || !fullPathHandler || !existsHandler) return

    await expect(deleteHandler({}, null)).resolves.toBe(false)
    await expect(openHandler({}, 123)).resolves.toBeUndefined()
    await expect(showHandler({}, '')).resolves.toBeUndefined()
    await expect(fullPathHandler({}, '')).resolves.toBe('')
    await expect(existsHandler({}, '   ')).resolves.toBe(false)
    expect(deps.deleteAttachment).not.toHaveBeenCalled()
    expect(deps.openAttachment).not.toHaveBeenCalled()
    expect(deps.showInFolder).not.toHaveBeenCalled()
    expect(deps.getFullPath).not.toHaveBeenCalled()
    expect(deps.attachmentExists).not.toHaveBeenCalled()
  })

  it('fails closed for oversized attachment path payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const deleteHandler = channels.get('attachment:delete')
    const openHandler = channels.get('attachment:open')
    const fullPathHandler = channels.get('attachment:getFullPath')
    const existsHandler = channels.get('attachment:exists')
    expect(deleteHandler).toBeDefined()
    expect(openHandler).toBeDefined()
    expect(fullPathHandler).toBeDefined()
    expect(existsHandler).toBeDefined()
    if (!deleteHandler || !openHandler || !fullPathHandler || !existsHandler) return

    const oversizedPath = 'a'.repeat(5000)
    await expect(deleteHandler({}, oversizedPath)).resolves.toBe(false)
    await expect(openHandler({}, oversizedPath)).resolves.toBeUndefined()
    await expect(fullPathHandler({}, oversizedPath)).resolves.toBe('')
    await expect(existsHandler({}, oversizedPath)).resolves.toBe(false)
    expect(deps.deleteAttachment).not.toHaveBeenCalled()
    expect(deps.openAttachment).not.toHaveBeenCalled()
    expect(deps.getFullPath).not.toHaveBeenCalled()
    expect(deps.attachmentExists).not.toHaveBeenCalled()
  })

  it('rejects invalid attachment:selectFiles options payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const handler = channels.get('attachment:selectFiles')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { filters: [{ name: 'Images', extensions: [1] }] })).rejects.toThrow('attachment:selectFiles options are invalid')
    await expect(handler({}, { filters: [{ name: 'Images', extensions: ['../png'] }] })).rejects.toThrow('attachment:selectFiles options are invalid')
    await expect(handler({}, { filters: new Array(33).fill({ name: 'Images', extensions: ['png'] }) })).rejects.toThrow('attachment:selectFiles options are invalid')
    expect(deps.selectFiles).not.toHaveBeenCalled()
  })

  it('passes used paths into attachment cleanup', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAttachmentIpc(ipcMainLike, deps)

    const handler = channels.get('attachment:cleanup')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({})).resolves.toBe(1)
    expect(deps.cleanupOrphanAttachments).toHaveBeenCalledWith(['attachments/a.png'])
  })
})
