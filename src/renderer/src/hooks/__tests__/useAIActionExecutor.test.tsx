/**
 * useAIActionExecutor regression tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import type { AIAction } from '../../../../shared/types'
import type { AIContext } from '../../utils/aiContext'
import { useAIActionExecutor } from '../useAIActionExecutor'

const mocks = vi.hoisted(() => {
  const state: {
    useAIWritingOptions: {
      onComplete?: () => void
      onError?: (errorCode: string) => void
    } | null
    streamHandler: ((streamId: string, event: unknown) => void) | null
    streamCleanup: ReturnType<typeof vi.fn>
    chat: {
      acquireReconnect: ReturnType<typeof vi.fn>
      releaseReconnect: ReturnType<typeof vi.fn>
      stream: ReturnType<typeof vi.fn>
      onStreamEvent: ReturnType<typeof vi.fn>
    }
  } = {
    useAIWritingOptions: null,
    streamHandler: null,
    streamCleanup: vi.fn(),
    chat: {
      acquireReconnect: vi.fn(async () => undefined),
      releaseReconnect: vi.fn(),
      stream: vi.fn(async () => undefined),
      onStreamEvent: vi.fn(),
    },
  }

  state.chat.onStreamEvent.mockImplementation((handler: (streamId: string, event: unknown) => void) => {
    state.streamHandler = handler
    return state.streamCleanup
  })

  return {
    executeAIAction: vi.fn(),
    cancelAIAction: vi.fn(),
    getAIContext: vi.fn(),
    formatAIPrompt: vi.fn(),
    createPopup: vi.fn(),
    updatePopupContent: vi.fn(),
    updatePopupStreaming: vi.fn(),
    deletePopup: vi.fn(),
    toast: vi.fn(),
    uuidv4: vi.fn(),
    state,
  }
})

vi.mock('../useAIWriting', () => ({
  useAIWriting: (options: {
    onComplete?: () => void
    onError?: (errorCode: string) => void
  }) => {
    mocks.state.useAIWritingOptions = options
    return {
      executeAction: mocks.executeAIAction,
      isProcessing: false,
      cancel: mocks.cancelAIAction,
    }
  },
}))

vi.mock('../../utils/aiContext', () => ({
  getAIContext: mocks.getAIContext,
  formatAIPrompt: mocks.formatAIPrompt,
}))

vi.mock('../../utils/popupStorage', () => ({
  createPopup: mocks.createPopup,
  updatePopupContent: mocks.updatePopupContent,
  updatePopupStreaming: mocks.updatePopupStreaming,
  deletePopup: mocks.deletePopup,
}))

vi.mock('../../utils/toast', () => ({
  toast: mocks.toast,
}))

vi.mock('uuid', () => ({
  v4: mocks.uuidv4,
}))

function createAction(overrides: Partial<AIAction> = {}): AIAction {
  return {
    id: 'action-1',
    name: 'Rewrite',
    description: 'rewrite text',
    icon: 'sparkles',
    prompt: 'Rewrite the text',
    mode: 'replace',
    showInContextMenu: true,
    showInSlashCommand: true,
    showInShortcut: true,
    shortcutKey: '',
    orderIndex: 0,
    isBuiltin: false,
    enabled: true,
    createdAt: '2026-02-26T00:00:00.000Z',
    updatedAt: '2026-02-26T00:00:00.000Z',
    ...overrides,
  }
}

function createContext(): AIContext {
  return {
    target: 'target text',
    targetMarkdown: 'target text',
    targetFrom: 1,
    targetTo: 5,
    before: 'before',
    after: 'after',
    documentTitle: 'Doc',
    hasSelection: true,
    isCrossBlock: false,
    blocks: [],
  }
}

function createEditorMock() {
  const chainFocus = vi.fn()
  const chainSetTextSelection = vi.fn()
  const chainInsertAIPopupMark = vi.fn()
  const chainRun = vi.fn()
  const deleteAIPopupMark = vi.fn()
  const dispatch = vi.fn()
  const trDelete = vi.fn(function (this: unknown) {
    return this
  })
  const descendants = vi.fn()

  const chain = vi.fn(() => ({
    focus: chainFocus.mockReturnThis(),
    setTextSelection: chainSetTextSelection.mockReturnThis(),
    insertAIPopupMark: chainInsertAIPopupMark.mockReturnThis(),
    run: chainRun.mockReturnValue(true),
  }))

  const editor = {
    chain,
    state: {
      doc: { descendants },
      tr: { delete: trDelete },
    },
    view: { dispatch },
    commands: { deleteAIPopupMark },
  } as unknown as import('@tiptap/react').Editor

  return {
    editor,
    chainSetTextSelection,
    chainInsertAIPopupMark,
    trDelete,
    descendants,
    dispatch,
  }
}

describe('useAIActionExecutor', () => {
  beforeEach(() => {
    mocks.executeAIAction.mockReset()
    mocks.cancelAIAction.mockReset()
    mocks.getAIContext.mockReset()
    mocks.formatAIPrompt.mockReset()
    mocks.createPopup.mockReset().mockResolvedValue({
      id: 'popup-1',
      content: '',
      prompt: '',
      actionName: '',
      targetText: '',
      documentTitle: '',
      createdAt: '2026-02-26T00:00:00.000Z',
      updatedAt: '2026-02-26T00:00:00.000Z',
    })
    mocks.updatePopupContent.mockReset()
    mocks.updatePopupStreaming.mockReset()
    mocks.deletePopup.mockReset().mockResolvedValue(true)
    mocks.toast.mockReset()
    mocks.uuidv4.mockReset()
    mocks.state.useAIWritingOptions = null
    mocks.state.streamHandler = null
    mocks.state.streamCleanup.mockReset()
    mocks.state.chat.acquireReconnect.mockReset().mockResolvedValue(undefined)
    mocks.state.chat.releaseReconnect.mockReset()
    mocks.state.chat.stream.mockReset().mockResolvedValue(undefined)
    mocks.state.chat.onStreamEvent.mockClear()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        chat: mocks.state.chat,
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('handles popup mode with streaming events', async () => {
    const { editor, chainSetTextSelection, chainInsertAIPopupMark } = createEditorMock()
    const context = createContext()
    const onComplete = vi.fn()
    mocks.uuidv4.mockReturnValue('popup-1')
    mocks.getAIContext.mockReturnValue(context)
    mocks.formatAIPrompt.mockReturnValue({ prompt: 'FULL_PROMPT' })

    const { result } = renderHook(() => useAIActionExecutor({
      editor,
      onComplete,
      t: { ai: { connectionFailed: 'connection failed', noContentToProcess: 'no content' } },
    }))

    act(() => {
      result.current.executeAction(createAction({ mode: 'popup', name: 'Explain', prompt: 'Explain this' }))
    })

    expect(mocks.createPopup).toHaveBeenCalledWith({
      popupId: 'popup-1',
      prompt: 'Explain this',
      actionName: 'Explain',
      context: {
        targetText: 'target text',
        documentTitle: 'Doc',
      },
    })
    expect(chainSetTextSelection).toHaveBeenCalledWith(5)
    expect(chainInsertAIPopupMark).toHaveBeenCalledWith({ popupId: 'popup-1' })

    await waitFor(() => {
      expect(mocks.state.chat.stream).toHaveBeenCalledWith({
        streamId: 'popup-1',
        agentId: 'writing',
        messages: [{ role: 'user', content: 'FULL_PROMPT' }],
      })
    })

    act(() => {
      mocks.state.streamHandler?.('popup-1', { type: 'text', content: 'hello' })
    })
    expect(mocks.updatePopupContent).toHaveBeenCalledWith('popup-1', 'hello')

    act(() => {
      mocks.state.streamHandler?.('popup-1', { type: 'done' })
    })
    expect(mocks.updatePopupStreaming).toHaveBeenCalledWith('popup-1', false)
    expect(mocks.state.chat.releaseReconnect).toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalled()
  })

  it('maps replace mode to useAIWriting replace', () => {
    const { editor, chainSetTextSelection, chainInsertAIPopupMark } = createEditorMock()
    const context = createContext()
    mocks.uuidv4.mockReturnValue('temp-1')
    mocks.getAIContext.mockReturnValue(context)

    const { result } = renderHook(() => useAIActionExecutor({
      editor,
      t: { ai: { connectionFailed: 'connection failed', noContentToProcess: 'no content' } },
    }))

    act(() => {
      result.current.executeAction(createAction({ mode: 'replace', prompt: 'Rewrite this' }))
    })

    expect(chainSetTextSelection).toHaveBeenCalledWith(5)
    expect(chainInsertAIPopupMark).toHaveBeenCalledWith({ popupId: 'temp-1' })
    expect(mocks.executeAIAction).toHaveBeenCalledWith('Rewrite this', context, 'replace')
  })

  it('maps insert mode to useAIWriting insertAfter', () => {
    const { editor } = createEditorMock()
    const context = createContext()
    mocks.uuidv4.mockReturnValue('temp-2')
    mocks.getAIContext.mockReturnValue(context)

    const { result } = renderHook(() => useAIActionExecutor({
      editor,
      t: { ai: { connectionFailed: 'connection failed', noContentToProcess: 'no content' } },
    }))

    act(() => {
      result.current.executeAction(createAction({ mode: 'insert', prompt: 'Append details' }))
    })

    expect(mocks.executeAIAction).toHaveBeenCalledWith('Append details', context, 'insertAfter')
  })

  it('shows info toast when no AI context is available', () => {
    const { editor } = createEditorMock()
    mocks.getAIContext.mockReturnValue(null)

    const { result } = renderHook(() => useAIActionExecutor({
      editor,
      t: { ai: { connectionFailed: 'connection failed', noContentToProcess: 'no content' } },
    }))

    act(() => {
      result.current.executeAction(createAction())
    })

    expect(mocks.toast).toHaveBeenCalledWith('no content', { type: 'info' })
    expect(mocks.executeAIAction).not.toHaveBeenCalled()
  })

  it('skips action and avoids temp popup when target content is blank', () => {
    const { editor } = createEditorMock()
    mocks.getAIContext.mockReturnValue({
      ...createContext(),
      target: '   ',
      targetMarkdown: '   ',
    })

    const { result } = renderHook(() => useAIActionExecutor({
      editor,
      t: { ai: { connectionFailed: 'connection failed', noContentToProcess: 'no content' } },
    }))

    act(() => {
      result.current.executeAction(createAction({ mode: 'replace' }))
    })

    expect(mocks.toast).toHaveBeenCalledWith('no content', { type: 'info' })
    expect(mocks.createPopup).not.toHaveBeenCalled()
    expect(mocks.executeAIAction).not.toHaveBeenCalled()
  })

  it('cleans up temporary popup marks when replace action completes', () => {
    const { editor, descendants, trDelete, dispatch } = createEditorMock()
    const context = createContext()
    mocks.uuidv4.mockReturnValue('temp-cleanup')
    mocks.getAIContext.mockReturnValue(context)
    descendants.mockImplementation((callback: (node: { type: { name: string }; attrs: { popupId: string } }, pos: number) => void) => {
      callback({ type: { name: 'aiPopupMark' }, attrs: { popupId: 'temp-cleanup' } }, 9)
      return true
    })

    const { result } = renderHook(() => useAIActionExecutor({
      editor,
      t: { ai: { connectionFailed: 'connection failed', noContentToProcess: 'no content' } },
    }))

    act(() => {
      result.current.executeAction(createAction({ mode: 'replace' }))
    })

    act(() => {
      mocks.state.useAIWritingOptions?.onComplete?.()
    })

    expect(trDelete).toHaveBeenCalledWith(9, 10)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(mocks.deletePopup).toHaveBeenCalledWith('temp-cleanup')
  })
})
