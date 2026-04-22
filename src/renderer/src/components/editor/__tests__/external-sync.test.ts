import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchMinimalExternalUpdate, syncExternalContent } from '../external-sync'

interface JsonNode {
  nodeSize: number
  toJSON(): Record<string, unknown>
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createNode(json: Record<string, unknown>, nodeSize = 2): JsonNode {
  return {
    nodeSize,
    toJSON: () => cloneJson(json),
  }
}

function createDoc(nodes: JsonNode[]) {
  return {
    childCount: nodes.length,
    child: (index: number) => nodes[index],
  }
}

function createTransaction() {
  const tr = {
    replaceWith: vi.fn((_from: number, _to: number, _nodes: unknown[]) => tr),
    delete: vi.fn((_from: number, _to: number) => tr),
    setMeta: vi.fn((_key: string, _value: unknown) => tr),
  }
  return tr
}

function createEditor(params: {
  oldNodes: JsonNode[]
  newNodes?: JsonNode[]
  nodeFromJsonError?: Error
  setContentError?: Error
  setContentResult?: boolean
}) {
  const tr = createTransaction()
  const viewDispatch = vi.fn()
  const setContent = vi.fn(() => params.setContentResult ?? true)
  if (params.setContentError) {
    setContent.mockImplementation(() => {
      throw params.setContentError
    })
  }
  const nodeFromJSON = vi.fn()
  if (params.nodeFromJsonError) {
    nodeFromJSON.mockImplementation(() => {
      throw params.nodeFromJsonError
    })
  } else {
    nodeFromJSON.mockReturnValue(createDoc(params.newNodes ?? params.oldNodes))
  }

  const editor = {
    schema: { nodeFromJSON },
    state: {
      doc: createDoc(params.oldNodes),
      tr,
    },
    view: {
      dispatch: viewDispatch,
    },
    commands: {
      setContent,
    },
  }

  return { editor, tr, viewDispatch, setContent }
}

describe('external-sync', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('dispatchMinimalExternalUpdate should no-op when docs are equivalent ignoring blockId', () => {
    const oldNodes = [
      createNode({ type: 'paragraph', attrs: { blockId: 'old-1' }, content: [{ type: 'text', text: 'A' }] }, 4),
      createNode({ type: 'paragraph', attrs: { blockId: 'old-2' }, content: [{ type: 'text', text: 'B' }] }, 4),
    ]
    const newNodes = [
      createNode({ type: 'paragraph', attrs: { blockId: 'new-1' }, content: [{ type: 'text', text: 'A' }] }, 4),
      createNode({ type: 'paragraph', attrs: { blockId: 'new-2' }, content: [{ type: 'text', text: 'B' }] }, 4),
    ]
    const { editor, tr, viewDispatch } = createEditor({ oldNodes, newNodes })

    const changed = dispatchMinimalExternalUpdate(
      editor as unknown as Parameters<typeof dispatchMinimalExternalUpdate>[0],
      { type: 'doc' }
    )

    expect(changed).toBe(false)
    expect(viewDispatch).not.toHaveBeenCalled()
    expect(tr.replaceWith).not.toHaveBeenCalled()
    expect(tr.delete).not.toHaveBeenCalled()
  })

  it('dispatchMinimalExternalUpdate should replace only changed middle region', () => {
    const oldNodes = [
      createNode({ type: 'paragraph', attrs: { blockId: 'old-a' }, content: [{ type: 'text', text: 'A' }] }, 3),
      createNode({ type: 'paragraph', attrs: { blockId: 'old-b' }, content: [{ type: 'text', text: 'B' }] }, 5),
      createNode({ type: 'paragraph', attrs: { blockId: 'old-c' }, content: [{ type: 'text', text: 'C' }] }, 7),
    ]
    const newNodes = [
      createNode({ type: 'paragraph', attrs: { blockId: 'new-a' }, content: [{ type: 'text', text: 'A' }] }, 3),
      createNode({ type: 'paragraph', attrs: { blockId: 'new-x' }, content: [{ type: 'text', text: 'X' }] }, 6),
      createNode({ type: 'paragraph', attrs: { blockId: 'new-c' }, content: [{ type: 'text', text: 'C' }] }, 7),
    ]
    const { editor, tr, viewDispatch } = createEditor({ oldNodes, newNodes })

    const changed = dispatchMinimalExternalUpdate(
      editor as unknown as Parameters<typeof dispatchMinimalExternalUpdate>[0],
      { type: 'doc' }
    )

    expect(changed).toBe(true)
    expect(tr.replaceWith).toHaveBeenCalledTimes(1)
    expect(tr.replaceWith).toHaveBeenCalledWith(3, 8, [newNodes[1]])
    expect(tr.setMeta).toHaveBeenCalledWith('addToHistory', false)
    expect(viewDispatch).toHaveBeenCalledTimes(1)
  })

  it('syncExternalContent should fallback to setContent when minimal diff throws', () => {
    const { editor, setContent } = createEditor({
      oldNodes: [createNode({ type: 'paragraph' })],
      nodeFromJsonError: new Error('invalid external content'),
    })

    const result = syncExternalContent(
      editor as unknown as Parameters<typeof syncExternalContent>[0],
      { type: 'doc', content: [] }
    )

    expect(result).toEqual({
      changed: true,
      synced: true,
      usedFallback: true,
    })
    expect(setContent).toHaveBeenCalledTimes(1)
    expect(setContent).toHaveBeenCalledWith({ type: 'doc', content: [] }, { emitUpdate: false })
  })

  it('syncExternalContent should report unsynced when minimal diff and fallback both fail', () => {
    const { editor } = createEditor({
      oldNodes: [createNode({ type: 'paragraph' })],
      nodeFromJsonError: new Error('invalid external content'),
      setContentError: new Error('fallback failed'),
    })

    const result = syncExternalContent(
      editor as unknown as Parameters<typeof syncExternalContent>[0],
      { type: 'doc', content: [] }
    )

    expect(result).toEqual({
      changed: false,
      synced: false,
      usedFallback: true,
    })
  })

  it('syncExternalContent should report unsynced when fallback setContent returns false', () => {
    const { editor } = createEditor({
      oldNodes: [createNode({ type: 'paragraph' })],
      nodeFromJsonError: new Error('invalid external content'),
      setContentResult: false,
    })

    const result = syncExternalContent(
      editor as unknown as Parameters<typeof syncExternalContent>[0],
      { type: 'doc', content: [] }
    )

    expect(result).toEqual({
      changed: false,
      synced: false,
      usedFallback: true,
    })
  })
})
