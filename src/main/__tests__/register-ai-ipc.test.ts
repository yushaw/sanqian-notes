import { describe, expect, it, vi } from 'vitest'
import type { AIIpcDeps } from '../ipc/register-ai-ipc'
import { registerAIIpc } from '../ipc/register-ai-ipc'

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

async function* createTaskEventStream(): AsyncIterable<unknown> {
  yield { type: 'done' }
}

function createDeps(overrides: Partial<AIIpcDeps> = {}): AIIpcDeps {
  return {
    setUserContext: vi.fn(),
    getUserContext: vi.fn(() => ({ context: 'ok' })),
    handleSelectionChange: vi.fn(),
    getTags: vi.fn(() => []),
    getTagsByNote: vi.fn(() => []),
    getAIActions: vi.fn(() => []),
    getAllAIActions: vi.fn(() => []),
    getAIAction: vi.fn(() => null),
    createAIAction: vi.fn(() => ({ id: 'a1' })),
    updateAIAction: vi.fn(() => null),
    deleteAIAction: vi.fn(() => true),
    reorderAIActions: vi.fn(),
    resetAIActionsToDefaults: vi.fn(),
    getPopup: vi.fn(() => null),
    createPopup: vi.fn(() => ({ id: 'p1' })),
    updatePopupContent: vi.fn(() => true),
    deletePopup: vi.fn(() => true),
    cleanupPopups: vi.fn(() => 0),
    getAgentTask: vi.fn(() => null),
    getAgentTaskByBlockId: vi.fn(() => null),
    createAgentTask: vi.fn(() => ({ id: 'task-1' })),
    updateAgentTask: vi.fn(() => null),
    deleteAgentTask: vi.fn(() => true),
    deleteAgentTaskByBlockId: vi.fn(() => true),
    getAllTemplates: vi.fn(() => []),
    getTemplate: vi.fn(() => null),
    getDailyDefaultTemplate: vi.fn(() => null),
    createTemplate: vi.fn(() => ({ id: 'tpl-1' })),
    updateTemplate: vi.fn(() => null),
    deleteTemplate: vi.fn(() => true),
    reorderTemplates: vi.fn(),
    setDailyDefaultTemplate: vi.fn(),
    resetTemplatesToDefaults: vi.fn(),
    markdownToTiptapString: vi.fn((markdown: string) => JSON.stringify({ markdown })),
    listAgents: vi.fn(async () => []),
    runAgentTask: vi.fn(() => createTaskEventStream()),
    cancelAgentTask: vi.fn(() => true),
    buildAgentExecutionContext: vi.fn(() => null),
    ...overrides,
  }
}

describe('register-ai-ipc', () => {
  it('registers key IPC channels', () => {
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, createDeps())

    expect(channels.has('context:sync')).toBe(true)
    expect(channels.has('aiAction:create')).toBe(true)
    expect(channels.has('popup:updateContent')).toBe(true)
    expect(channels.has('agentTask:create')).toBe(true)
    expect(channels.has('templates:setDailyDefault')).toBe(true)
    expect(channels.has('agent:run')).toBe(true)
  })

  it('fails closed for invalid context sync payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('context:sync')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'invalid')).resolves.toBeUndefined()
    expect(deps.setUserContext).not.toHaveBeenCalled()
    expect(deps.handleSelectionChange).not.toHaveBeenCalled()
  })

  it('fails closed for invalid tag:getByNote payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('tag:getByNote')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 123)).resolves.toEqual([])
    expect(deps.getTagsByNote).not.toHaveBeenCalled()
  })

  it('rejects invalid aiAction:create payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:create')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { name: 'x' })).rejects.toThrow('aiAction:create payload is invalid')
    expect(deps.createAIAction).not.toHaveBeenCalled()
  })

  it('rejects oversized aiAction:create payload fields', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:create')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, {
      name: 'n'.repeat(201),
      icon: 'sparkles',
      prompt: 'hello',
      mode: 'insert',
    })).rejects.toThrow('aiAction:create payload is invalid')

    await expect(handler({}, {
      name: 'Action',
      icon: 'i'.repeat(65),
      prompt: 'hello',
      mode: 'insert',
    })).rejects.toThrow('aiAction:create payload is invalid')

    expect(deps.createAIAction).not.toHaveBeenCalled()
  })

  it('fails closed for invalid aiAction:update payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:update')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'action-1', { mode: 'invalid' })).resolves.toBeNull()
    await expect(handler({}, 'action-1', { name: 123 })).resolves.toBeNull()
    expect(deps.updateAIAction).not.toHaveBeenCalled()
  })

  it('fails closed for aiAction:update payload with throwing toString object', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:update')
    expect(handler).toBeDefined()
    if (!handler) return

    const throwingValue = {
      toString() {
        throw new Error('should not be called')
      },
    }

    await expect(handler({}, 'action-1', { name: throwingValue })).resolves.toBeNull()
    await expect(handler({}, 'action-1', { icon: throwingValue })).resolves.toBeNull()
    await expect(handler({}, 'action-1', { prompt: throwingValue })).resolves.toBeNull()
    expect(deps.updateAIAction).not.toHaveBeenCalled()
  })

  it('fails closed for invalid aiAction:reorder payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:reorder')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, ['a1', null])).resolves.toBeUndefined()
    expect(deps.reorderAIActions).not.toHaveBeenCalled()
  })

  it('fails closed for duplicate aiAction:reorder ids', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:reorder')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, ['a1', 'a1'])).resolves.toBeUndefined()
    expect(deps.reorderAIActions).not.toHaveBeenCalled()
  })

  it('fails closed for oversized aiAction:reorder payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('aiAction:reorder')
    expect(handler).toBeDefined()
    if (!handler) return

    const oversizedIds = Array.from({ length: 2001 }, (_, index) => `action-${index}`)
    await expect(handler({}, oversizedIds)).resolves.toBeUndefined()
    expect(deps.reorderAIActions).not.toHaveBeenCalled()
  })

  it('fails closed for invalid popup:updateContent payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('popup:updateContent')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'popup-1', 456)).resolves.toBe(false)
    expect(deps.updatePopupContent).not.toHaveBeenCalled()
  })

  it('fails closed for oversized popup:updateContent payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('popup:updateContent')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'popup-1', 'x'.repeat(200_001))).resolves.toBe(false)
    expect(deps.updatePopupContent).not.toHaveBeenCalled()
  })

  it('rejects invalid popup:cleanup maxAgeDays payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('popup:cleanup')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 1.5)).rejects.toThrow('popup:cleanup maxAgeDays must be an integer between 0 and 36500')
    await expect(handler({}, 36501)).rejects.toThrow('popup:cleanup maxAgeDays must be an integer between 0 and 36500')
    expect(deps.cleanupPopups).not.toHaveBeenCalled()
  })

  it('rejects invalid agentTask:create payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agentTask:create')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { blockId: 'b1' })).rejects.toThrow('agentTask:create payload is invalid')
    await expect(handler({}, {
      blockId: 'b1',
      pageId: 'p1',
      content: 'x'.repeat(1_000_001),
    })).rejects.toThrow('agentTask:create payload is invalid')
    await expect(handler({}, {
      blockId: 'b1',
      pageId: 'p1',
      content: 'ok',
      additionalPrompt: 'x'.repeat(200_001),
    })).rejects.toThrow('agentTask:create payload is invalid')
    expect(deps.createAgentTask).not.toHaveBeenCalled()
  })

  it('fails closed for invalid agentTask:update payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agentTask:update')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'task-1', { durationMs: -1 })).resolves.toBeNull()
    await expect(handler({}, 'task-1', { processMode: 'invalid' })).resolves.toBeNull()
    await expect(handler({}, 'task-1', { blockId: '   ' })).resolves.toBeNull()
    expect(deps.updateAgentTask).not.toHaveBeenCalled()
  })

  it('accepts valid nullable fields for agentTask:update', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agentTask:update')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'task-1', {
      notebookId: null,
      additionalPrompt: null,
      outputBlockId: null,
      processMode: 'append',
      outputFormat: 'quote',
      runTiming: 'manual',
      durationMs: 0,
    })).resolves.toBeNull()
    expect(deps.updateAgentTask).toHaveBeenCalledWith('task-1', {
      notebookId: null,
      additionalPrompt: null,
      outputBlockId: null,
      processMode: 'append',
      outputFormat: 'quote',
      runTiming: 'manual',
      durationMs: 0,
    })
  })

  it('fails closed for invalid templates:setDailyDefault payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('templates:setDailyDefault')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, '   ')).resolves.toBeUndefined()
    expect(deps.setDailyDefaultTemplate).not.toHaveBeenCalled()
  })

  it('fails closed for duplicate templates:reorder ids', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('templates:reorder')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, ['tpl-1', 'tpl-1'])).resolves.toBeUndefined()
    expect(deps.reorderTemplates).not.toHaveBeenCalled()
  })

  it('fails closed for invalid markdown:toTiptap payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('markdown:toTiptap')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { markdown: 'x' })).resolves.toBe('')
    await expect(handler({}, 'x'.repeat(1_000_001))).resolves.toBe('')
    expect(deps.markdownToTiptapString).not.toHaveBeenCalled()
  })

  it('rejects oversized templates:create payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('templates:create')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, {
      name: 'n'.repeat(201),
      content: 'hello',
    })).rejects.toThrow('templates:create payload is invalid')
    await expect(handler({}, {
      name: 'Template',
      content: 'x'.repeat(1_000_001),
    })).rejects.toThrow('templates:create payload is invalid')
    expect(deps.createTemplate).not.toHaveBeenCalled()
  })

  it('does not run agent task on invalid agent:run payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }

    await expect(handler({ sender }, 'task-1', 42, 'Assistant', 'hello')).resolves.toBeUndefined()
    expect(deps.runAgentTask).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('agent:event', 'task-1', {
      type: 'error',
      error: 'Invalid agent:run payload'
    })
  })

  it('does not run agent task on oversized content payload in agent:run', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }

    const oversizedContent = 'a'.repeat(1_000_001)
    await expect(handler({ sender }, 'task-1', 'agent-1', 'Assistant', oversizedContent)).resolves.toBeUndefined()
    expect(deps.runAgentTask).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('agent:event', 'task-1', {
      type: 'error',
      error: 'Invalid agent:run payload',
    })
  })

  it('agent:run swallows renderer send errors for invalid payload error event', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(() => {
        throw new Error('send failed')
      }),
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ sender }, 'task-1', 42, 'Assistant', 'hello')).resolves.toBeUndefined()
    expect(deps.runAgentTask).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('[agent:run] failed to send agent event:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('stops consuming agent stream when sender is destroyed', async () => {
    const nextMock = vi.fn()
      .mockResolvedValueOnce({ done: false, value: { type: 'progress-1' } })
      .mockResolvedValueOnce({ done: false, value: { type: 'progress-2' } })
      .mockResolvedValueOnce({ done: true, value: undefined })
    const returnMock = vi.fn(async () => ({ done: true, value: undefined }))

    const stream = {
      next: nextMock,
      return: returnMock,
      throw: vi.fn(async () => ({ done: true, value: undefined })),
      [Symbol.asyncIterator]() {
        return this
      },
    } as unknown as AsyncIterable<unknown>

    const deps = createDeps({
      runAgentTask: vi.fn(() => stream),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => true),
      send: vi.fn(),
    }

    await expect(handler({ sender }, 'task-1', 'agent-1', 'Assistant', 'hello')).resolves.toBeUndefined()
    expect(nextMock).toHaveBeenCalledTimes(1)
    expect(returnMock).toHaveBeenCalledTimes(1)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('agent:run stops stream when progress event cannot be sent', async () => {
    const nextMock = vi.fn()
      .mockResolvedValueOnce({ done: false, value: { type: 'progress-1' } })
      .mockResolvedValueOnce({ done: false, value: { type: 'progress-2' } })
      .mockResolvedValueOnce({ done: true, value: undefined })
    const returnMock = vi.fn(async () => ({ done: true, value: undefined }))

    const stream = {
      next: nextMock,
      return: returnMock,
      throw: vi.fn(async () => ({ done: true, value: undefined })),
      [Symbol.asyncIterator]() {
        return this
      },
    } as unknown as AsyncIterable<unknown>

    const deps = createDeps({
      runAgentTask: vi.fn(() => stream),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(() => {
        throw new Error('send failed')
      }),
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handler({ sender }, 'task-1', 'agent-1', 'Assistant', 'hello')).resolves.toBeUndefined()
    expect(nextMock).toHaveBeenCalledTimes(1)
    expect(returnMock).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[agent:run] failed to send agent event:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('does not run agent task on invalid executionContext payload in agent:run output context', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }

    await expect(handler(
      { sender },
      'task-1',
      'agent-1',
      'Assistant',
      'hello',
      undefined,
      {
        targetBlockId: 'block-1',
        pageId: 'page-1',
        notebookId: 'nb-1',
        processMode: 'append',
        executionContext: {
          sourceType: 'external',
        },
      }
    )).resolves.toBeUndefined()

    expect(deps.runAgentTask).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('agent:event', 'task-1', {
      type: 'error',
      error: 'Invalid agent:run payload',
    })
  })

  it('does not run agent task on oversized executionContext id in agent:run output context', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }

    await expect(handler(
      { sender },
      'task-1',
      'agent-1',
      'Assistant',
      'hello',
      undefined,
      {
        targetBlockId: 'block-1',
        pageId: 'page-1',
        notebookId: 'nb-1',
        processMode: 'append',
        executionContext: {
          noteId: 'n'.repeat(513),
        },
      }
    )).resolves.toBeUndefined()

    expect(deps.runAgentTask).not.toHaveBeenCalled()
    expect(sender.send).toHaveBeenCalledWith('agent:event', 'task-1', {
      type: 'error',
      error: 'Invalid agent:run payload',
    })
  })

  it('passes validated executionContext through agent:run output context', async () => {
    const deps = createDeps({
      buildAgentExecutionContext: vi.fn(() => 'ctx'),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:run')
    expect(handler).toBeDefined()
    if (!handler) return

    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    }

    const executionContext = {
      sourceApp: 'sanqian-notes',
      noteId: null,
      noteTitle: 'Title',
      notebookId: 'nb-1',
      notebookName: 'Notebook',
      sourceType: 'local-folder',
      localResourceId: 'local:nb-1:test.md',
      localRelativePath: 'test.md',
      heading: null,
    }

    await expect(handler(
      { sender },
      'task-1',
      'agent-1',
      'Assistant',
      'hello',
      undefined,
      {
        targetBlockId: 'block-1',
        pageId: 'page-1',
        notebookId: 'nb-1',
        processMode: 'append',
        outputFormat: 'quote',
        executionContext,
      }
    )).resolves.toBeUndefined()

    expect(deps.buildAgentExecutionContext).toHaveBeenCalledWith(executionContext)
    expect(deps.runAgentTask).toHaveBeenCalledWith(
      'task-1',
      'agent-1',
      'Assistant',
      'hello',
      undefined,
      expect.objectContaining({
        executionContext: '<execution_context>\nctx\n</execution_context>',
        outputFormat: 'quote',
        outputContext: expect.objectContaining({
          targetBlockId: 'block-1',
          pageId: 'page-1',
          notebookId: 'nb-1',
          processMode: 'append',
        }),
      })
    )
  })

  it('fails closed for invalid agent:cancel payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAIIpc(ipcMainLike, deps)

    const handler = channels.get('agent:cancel')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, '')).resolves.toBe(false)
    expect(deps.cancelAgentTask).not.toHaveBeenCalled()
  })
})
