import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTaskOutput,
  createEditorOutputTools,
  getTaskOutput,
  initTaskOutput,
} from '../editor-agent'

const TASK_ID = 'task-editor-agent-test'

function initOutputContext(): void {
  initTaskOutput(TASK_ID, {
    targetBlockId: 'block-1',
    pageId: 'page-1',
    notebookId: null,
    processMode: 'append',
  })
}

describe('editor-agent create_note_ref tool', () => {
  afterEach(() => {
    clearTaskOutput(TASK_ID)
  })

  it('injects resolved noteId when resolver matches', async () => {
    initOutputContext()
    const tools = createEditorOutputTools(
      () => TASK_ID,
      {
        resolveNoteRef: () => ({ noteId: 'note-1', noteTitle: 'Resolved Title' }),
      }
    )
    const tool = tools.find((item) => item.name === 'create_note_ref')
    expect(tool).toBeTruthy()
    if (!tool) return

    await tool.handler({ noteTitle: 'Original Title' })

    const pending = getTaskOutput(TASK_ID)
    expect(pending).toBeTruthy()
    expect(pending?.operations).toHaveLength(1)
    expect(pending?.operations[0]).toEqual({
      type: 'noteRef',
      content: {
        noteTitle: 'Resolved Title',
        noteId: 'note-1',
        displayText: undefined,
      },
    })
  })

  it('falls back to unresolved noteRef when resolver misses', async () => {
    initOutputContext()
    const tools = createEditorOutputTools(
      () => TASK_ID,
      {
        resolveNoteRef: () => null,
      }
    )
    const tool = tools.find((item) => item.name === 'create_note_ref')
    expect(tool).toBeTruthy()
    if (!tool) return

    await tool.handler({ noteTitle: 'Only Title', displayText: 'Display' })

    const pending = getTaskOutput(TASK_ID)
    expect(pending).toBeTruthy()
    expect(pending?.operations).toHaveLength(1)
    expect(pending?.operations[0]).toEqual({
      type: 'noteRef',
      content: {
        noteTitle: 'Only Title',
        displayText: 'Display',
      },
    })
  })
})

