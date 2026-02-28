/**
 * DataviewView regression tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DataviewView } from '../DataviewView'

const parseDataviewQueryMock = vi.fn()
const executeDataviewQueryMock = vi.fn()

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
}))

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    dataview: {
      totalResults: '{count} results',
      titleColumn: 'Title',
      run: 'Run',
      placeholder: 'LIST FROM #tag',
      lastUpdated: 'Updated',
    },
    ai: {
      dataviewPlaceholder: 'Describe query',
    },
  }),
}))

vi.mock('../../utils/platform', () => ({
  isMacOS: () => false,
}))

vi.mock('../../utils/dataviewParser', () => ({
  parseDataviewQuery: (...args: unknown[]) => parseDataviewQueryMock(...args),
}))

vi.mock('../../utils/dataviewExecutor', () => ({
  executeDataviewQuery: (...args: unknown[]) => executeDataviewQueryMock(...args),
  formatFieldValue: (value: unknown) => String(value ?? ''),
}))

vi.mock('../NotePreviewPopover', () => ({
  NotePreviewPopover: () => null,
}))

vi.mock('../BlockAIGenerateButton', () => ({
  BlockAIGenerateButton: () => null,
}))

function createNodeAttrs(overrides?: Partial<{ query: string; isEditing: boolean; lastExecuted: string | null }>) {
  return {
    query: 'LIST FROM #project',
    isEditing: false,
    lastExecuted: null,
    ...overrides,
  }
}

function createParseSuccess() {
  return {
    success: true,
    query: {
      type: 'LIST' as const,
      fields: [],
      from: { type: 'all' as const, value: '' },
      where: [],
      sort: [],
    },
  }
}

type UpdateAttributes = (attributes: Record<string, unknown>) => void

function renderView(
  attrs: ReturnType<typeof createNodeAttrs>,
  updateAttributes: UpdateAttributes
) {
  return render(
    <DataviewView
      node={{ attrs } as never}
      updateAttributes={updateAttributes as unknown as UpdateAttributes}
      selected={false}
      editor={null as never}
      getPos={(() => 0) as never}
      deleteNode={vi.fn() as never}
      extension={null as never}
      decorations={[] as never}
      innerDecorations={null as never}
      view={null as never}
      HTMLAttributes={{}}
    />
  )
}

describe('DataviewView lastExecuted persistence', () => {
  beforeEach(() => {
    parseDataviewQueryMock.mockReset()
    executeDataviewQueryMock.mockReset()

    parseDataviewQueryMock.mockReturnValue(createParseSuccess())
    executeDataviewQueryMock.mockResolvedValue({
      columns: [],
      rows: [],
      total: 0,
    })
  })

  it('does not persist lastExecuted when auto-running after opening in result mode', async () => {
    const updateAttributes = vi.fn<UpdateAttributes>()
    renderView(createNodeAttrs({ isEditing: false }), updateAttributes)

    await waitFor(() => {
      expect(executeDataviewQueryMock).toHaveBeenCalledTimes(1)
    })

    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('persists lastExecuted when transitioning from edit mode to result mode', async () => {
    const updateAttributes = vi.fn<UpdateAttributes>()
    const { rerender } = renderView(createNodeAttrs({ isEditing: true }), updateAttributes)

    await waitFor(() => {
      expect(executeDataviewQueryMock).toHaveBeenCalledTimes(0)
    })

    rerender(
      <DataviewView
        node={{ attrs: createNodeAttrs({ isEditing: false }) } as never}
        updateAttributes={updateAttributes as unknown as UpdateAttributes}
        selected={false}
        editor={null as never}
        getPos={(() => 0) as never}
        deleteNode={vi.fn() as never}
        extension={null as never}
        decorations={[] as never}
        innerDecorations={null as never}
        view={null as never}
        HTMLAttributes={{}}
      />
    )

    await waitFor(() => {
      expect(executeDataviewQueryMock).toHaveBeenCalledTimes(1)
    })

    expect(updateAttributes).toHaveBeenCalledWith({
      lastExecuted: expect.any(String),
    })
  })
})
