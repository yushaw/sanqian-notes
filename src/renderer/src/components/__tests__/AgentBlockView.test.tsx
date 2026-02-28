/**
 * AgentBlockView regression tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AgentBlockView } from '../AgentBlockView'

const listMock = vi.fn()

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  NodeViewContent: () => <div data-testid="node-content" />,
}))

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    agentBlock: {
      unknownError: 'Unknown error',
      promptPlaceholder: 'Enter task description...',
      selectAgent: 'Agent',
      formatAuto: 'Auto',
      formatParagraph: 'Paragraph',
      formatList: 'List',
      formatTable: 'Table',
      formatCode: 'Code',
      formatQuote: 'Quote',
      run: 'Run',
      rerun: 'Re-run',
      cancel: 'Cancel',
      collapse: 'Collapse',
      expand: 'Expand',
      cancelFailed: 'Cancel failed',
    },
  }),
  useI18n: () => ({ isZh: false }),
}))

vi.mock('../Select', () => ({
  Select: ({ value }: { value?: string }) => <div data-testid="select-stub">{value || ''}</div>,
}))

vi.mock('../utils/agentTaskStorage', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getTaskAsync: vi.fn(),
}))

vi.mock('../utils/toast', () => ({
  toast: vi.fn(),
}))

vi.mock('../utils/aiContext', () => ({
  getNearestHeadingForBlock: vi.fn(() => null),
}))

vi.mock('../utils/localResourceId', () => ({
  parseLocalResourceId: vi.fn(() => null),
}))

describe('AgentBlockView open behavior', () => {
  beforeEach(() => {
    listMock.mockReset()
    listMock.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Agent One',
        sourceId: 'sanqian-notes',
        display: { en: 'Agent One', zh: 'Agent One' },
        shortDesc: { en: 'desc', zh: 'desc' },
      },
    ])

    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        agent: {
          list: listMock,
          onEvent: vi.fn(() => () => {}),
          run: vi.fn(),
          cancel: vi.fn(),
        },
      },
    })
  })

  it('does not persist default agent selection during initial load', async () => {
    const updateAttributes = vi.fn()

    render(
      <AgentBlockView
        node={{
          attrs: {
            blockId: 'block-1',
            agentId: null,
            agentName: null,
            additionalPrompt: '',
            outputFormat: 'auto',
            processMode: 'append',
            status: 'idle',
            taskId: null,
            executedAt: null,
            durationMs: null,
            error: null,
            scheduledAt: null,
            open: true,
            shouldFocus: false,
          },
          content: { size: 0 },
        } as never}
        updateAttributes={updateAttributes}
        selected={false}
        editor={{ commands: { focus: vi.fn() }, view: { dom: document.createElement('div') } } as never}
        deleteNode={vi.fn() as never}
        getPos={(() => 0) as never}
        extension={null as never}
        decorations={[] as never}
        innerDecorations={null as never}
        view={null as never}
        HTMLAttributes={{}}
      />
    )

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1)
    })

    expect(updateAttributes).not.toHaveBeenCalled()
  })
})
