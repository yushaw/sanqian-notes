/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

import { Editor } from '../Editor'
import type { Note } from '../../types/note'
import { expectHeaderOnlyDragRegion, expectNoDragControl } from './dragRegionContract'

const mockIsWindows = vi.fn(() => false)

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    editor: {
      selectNote: 'Select a note to start editing',
      or: 'or',
      createNewNote: 'Create New Note',
    },
    paneControls: {
      close: 'Close Pane',
    },
  }),
}))

vi.mock('../../utils/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/platform')>()
  return {
    ...actual,
    isWindows: () => mockIsWindows(),
  }
})

function renderEmptyEditor(options?: {
  showPaneControls?: boolean
  onClosePane?: () => void
}) {
  return render(
    <Editor
      note={null}
      paneId={null}
      notes={[]}
      notebooks={[]}
      titleEditable
      editable
      onUpdate={vi.fn()}
      onNoteClick={vi.fn()}
      onCreateNote={vi.fn(async () => ({ id: 'new-note-id' } as Note))}
      onSelectNote={vi.fn()}
      showPaneControls={options?.showPaneControls}
      onClosePane={options?.onClosePane}
    />
  )
}

describe('Editor empty-state drag contract', () => {
  beforeEach(() => {
    mockIsWindows.mockReturnValue(false)
  })

  it('keeps drag-region on the empty-state header strip only', () => {
    const { container } = renderEmptyEditor()
    expectHeaderOnlyDragRegion({
      container,
      rootSelector: '[data-editor-empty-state]',
    })

    const dragStrip = container.querySelector('[data-testid="editor-empty-drag-strip"]')
    expect(dragStrip).toBeTruthy()
    expect(dragStrip).toHaveClass('drag-region')
  })

  it('keeps Windows empty-state floating controls no-drag', () => {
    mockIsWindows.mockReturnValue(true)
    const onClosePane = vi.fn()

    const { container } = renderEmptyEditor({
      showPaneControls: true,
      onClosePane,
    })

    const controls = container.querySelector('[data-editor-empty-windows-controls]')
    expectNoDragControl(controls)

    const closeButton = controls?.querySelector('button') ?? null
    expectNoDragControl(closeButton)
  })
})
