import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getClientMock,
  updateAgentTaskMock,
  initTaskOutputMock,
  clearTaskOutputMock,
  commitTaskOutputMock,
  getTaskOutputMock,
} = vi.hoisted(() => ({
  getClientMock: vi.fn(),
  updateAgentTaskMock: vi.fn(),
  initTaskOutputMock: vi.fn(),
  clearTaskOutputMock: vi.fn(),
  commitTaskOutputMock: vi.fn(),
  getTaskOutputMock: vi.fn(),
}))

vi.mock('../sanqian-sdk', () => ({
  getClient: getClientMock,
}))

vi.mock('../database', () => ({
  updateAgentTask: updateAgentTaskMock,
}))

vi.mock('../editor-agent', () => ({
  FORMATTER_AGENT_ID: 'sanqian-notes:formatter',
  initTaskOutput: initTaskOutputMock,
  commitTaskOutput: commitTaskOutputMock,
  clearTaskOutput: clearTaskOutputMock,
  getTaskOutput: getTaskOutputMock,
}))

import { cancelAgentTask, getCurrentTaskId, runAgentTask } from '../agent-task-service'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('agent-task-service formatter concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commitTaskOutputMock.mockReturnValue(true)
    getTaskOutputMock.mockReturnValue(null)
  })

  it('serializes formatter phase across concurrent tasks', async () => {
    let formatterActiveCount = 0
    let formatterMaxConcurrent = 0
    let formatterCallIndex = 0

    const createContentStream = async function* () {
      yield { type: 'text', content: 'content-result' }
    }

    const createFormatterStream = (callIndex: number) => async function* () {
      formatterActiveCount += 1
      formatterMaxConcurrent = Math.max(formatterMaxConcurrent, formatterActiveCount)
      const delayMs = callIndex === 1 ? 80 : 8
      try {
        await sleep(delayMs)
        yield {
          type: 'tool_call',
          tool_call: {
            function: {
              name: 'insert_paragraph',
              arguments: JSON.stringify({ paragraphs: ['ok'] }),
            },
          },
        }
        await sleep(delayMs)
        yield {
          type: 'tool_result',
          result: { success: true },
        }
      } finally {
        formatterActiveCount -= 1
      }
    }

    getClientMock.mockReturnValue({
      ensureReady: vi.fn(async () => undefined),
      chatStream: vi.fn((agentId: string) => {
        if (agentId === 'sanqian-notes:formatter') {
          formatterCallIndex += 1
          return createFormatterStream(formatterCallIndex)()
        }
        return createContentStream()
      }),
    })

    const options = {
      useTwoStepFlow: true,
      outputContext: {
        targetBlockId: 'block-1',
        pageId: 'page-1',
        notebookId: null,
        processMode: 'append' as const,
      },
      webContents: null,
    }

    const task1CurrentIds: Array<string | null> = []

    const drain = async (taskId: string) => {
      for await (const event of runAgentTask(taskId, 'assistant', 'assistant', 'run', undefined, options)) {
        if (taskId === 'task-1' && (event.type === 'tool_call' || event.type === 'tool_result')) {
          task1CurrentIds.push(getCurrentTaskId())
        }
      }
    }

    await Promise.all([
      drain('task-1'),
      drain('task-2'),
    ])

    expect(formatterMaxConcurrent).toBe(1)
    expect(task1CurrentIds.length).toBeGreaterThan(0)
    expect(task1CurrentIds.every((value) => value === 'task-1')).toBe(true)
    expect(getCurrentTaskId()).toBeNull()
  })

  it('does not clear active formatter task id when another non-formatter task finishes', async () => {
    let formatterCallIndex = 0

    const createContentStream = async function* () {
      yield { type: 'text', content: 'content-result' }
    }

    const createFormatterStream = (callIndex: number) => async function* () {
      const delayMs = callIndex === 1 ? 60 : 8
      await sleep(delayMs)
      yield {
        type: 'tool_call',
        tool_call: {
          function: {
            name: 'insert_paragraph',
            arguments: JSON.stringify({ paragraphs: ['ok'] }),
          },
        },
      }
      await sleep(delayMs)
      yield {
        type: 'tool_result',
        result: { success: true },
      }
    }

    getClientMock.mockReturnValue({
      ensureReady: vi.fn(async () => undefined),
      chatStream: vi.fn((agentId: string) => {
        if (agentId === 'sanqian-notes:formatter') {
          formatterCallIndex += 1
          return createFormatterStream(formatterCallIndex)()
        }
        return createContentStream()
      }),
    })

    const formatterTaskOptions = {
      useTwoStepFlow: true,
      outputContext: {
        targetBlockId: 'block-1',
        pageId: 'page-1',
        notebookId: null,
        processMode: 'append' as const,
      },
      webContents: null,
    }

    const formatterTaskCurrentIds: Array<string | null> = []

    const drainFormatterTask = async () => {
      for await (const event of runAgentTask('task-formatter', 'assistant', 'assistant', 'run', undefined, formatterTaskOptions)) {
        if (event.type === 'tool_call' || event.type === 'tool_result') {
          formatterTaskCurrentIds.push(getCurrentTaskId())
        }
      }
    }

    const drainRegularTask = async () => {
      for await (const event of runAgentTask('task-regular', 'assistant', 'assistant', 'run')) {
        void event
      }
    }

    await Promise.all([
      drainFormatterTask(),
      drainRegularTask(),
    ])

    expect(formatterTaskCurrentIds.length).toBeGreaterThan(0)
    expect(formatterTaskCurrentIds.every((value) => value === 'task-formatter')).toBe(true)
    expect(getCurrentTaskId()).toBeNull()
  })

  it('cancels a queued formatter task before output context initialization', async () => {
    let formatterCallIndex = 0

    const createContentStream = async function* () {
      yield { type: 'text', content: 'content-result' }
    }

    const createFormatterStream = (callIndex: number) => async function* () {
      const delayMs = callIndex === 1 ? 80 : 8
      await sleep(delayMs)
      yield {
        type: 'tool_call',
        tool_call: {
          function: {
            name: 'insert_paragraph',
            arguments: JSON.stringify({ paragraphs: ['ok'] }),
          },
        },
      }
      await sleep(delayMs)
      yield {
        type: 'tool_result',
        result: { success: true },
      }
    }

    getClientMock.mockReturnValue({
      ensureReady: vi.fn(async () => undefined),
      chatStream: vi.fn((agentId: string) => {
        if (agentId === 'sanqian-notes:formatter') {
          formatterCallIndex += 1
          return createFormatterStream(formatterCallIndex)()
        }
        return createContentStream()
      }),
    })

    const options = {
      useTwoStepFlow: true,
      outputContext: {
        targetBlockId: 'block-1',
        pageId: 'page-1',
        notebookId: null,
        processMode: 'append' as const,
      },
      webContents: null,
    }

    const task2Events: Array<{ type: string; error?: string }> = []

    const drainTask1 = async () => {
      for await (const event of runAgentTask('task-1', 'assistant', 'assistant', 'run', undefined, options)) {
        void event
      }
    }

    const drainTask2 = async () => {
      for await (const event of runAgentTask('task-2', 'assistant', 'assistant', 'run', undefined, options)) {
        task2Events.push({ type: event.type, error: event.error })
        if (event.type === 'phase' && event.phase === 'editor') {
          cancelAgentTask('task-2')
        }
      }
    }

    await Promise.all([
      drainTask1(),
      drainTask2(),
    ])

    expect(formatterCallIndex).toBe(1)
    expect(initTaskOutputMock.mock.calls.some(([id]) => id === 'task-2')).toBe(false)
    expect(
      task2Events.some((event) => event.type === 'error' && event.error === 'Task cancelled by user')
    ).toBe(true)
    expect(getCurrentTaskId()).toBeNull()
  })

  it('caps persisted tool step logs to avoid unbounded growth', async () => {
    const toolCallCount = 620
    const contentOnlyStream = async function* () {
      for (let index = 0; index < toolCallCount; index += 1) {
        yield {
          type: 'tool_call',
          tool_call: {
            function: {
              name: 'noop_tool',
              arguments: JSON.stringify({ index }),
            },
          },
        }
      }
      yield { type: 'text', content: 'done' }
    }

    getClientMock.mockReturnValue({
      ensureReady: vi.fn(async () => undefined),
      chatStream: vi.fn(() => contentOnlyStream()),
    })

    for await (const event of runAgentTask('task-step-cap', 'assistant', 'assistant', 'run')) {
      void event
    }

    const completedCall = [...updateAgentTaskMock.mock.calls]
      .reverse()
      .find((call) => call[0] === 'task-step-cap' && call[1]?.status === 'completed')
    expect(completedCall).toBeDefined()

    const completedPayload = completedCall?.[1] as { steps?: string } | undefined
    expect(typeof completedPayload?.steps).toBe('string')
    const storedSteps = JSON.parse(completedPayload?.steps || '[]') as Array<{ type: string }>
    expect(storedSteps.length).toBe(500)
    expect(storedSteps.every((step) => step.type === 'tool_call')).toBe(true)
  })

  it('does not overwrite last kept step result after step log truncation', async () => {
    const pairCount = 620
    const contentOnlyStream = async function* () {
      for (let index = 0; index < pairCount; index += 1) {
        yield {
          type: 'tool_call',
          tool_call: {
            function: {
              name: 'noop_tool',
              arguments: JSON.stringify({ index }),
            },
          },
        }
        yield {
          type: 'tool_result',
          result: { index },
        }
      }
      yield { type: 'text', content: 'done' }
    }

    getClientMock.mockReturnValue({
      ensureReady: vi.fn(async () => undefined),
      chatStream: vi.fn(() => contentOnlyStream()),
    })

    for await (const event of runAgentTask('task-step-cap-result', 'assistant', 'assistant', 'run')) {
      void event
    }

    const completedCall = [...updateAgentTaskMock.mock.calls]
      .reverse()
      .find((call) => call[0] === 'task-step-cap-result' && call[1]?.status === 'completed')
    expect(completedCall).toBeDefined()

    const completedPayload = completedCall?.[1] as { steps?: string } | undefined
    const storedSteps = JSON.parse(completedPayload?.steps || '[]') as Array<{
      type: string
      toolArgs?: { index?: number }
      result?: { index?: number }
    }>

    expect(storedSteps.length).toBe(500)
    const last = storedSteps[storedSteps.length - 1]
    expect(last.toolArgs?.index).toBe(499)
    expect(last.result?.index).toBe(499)
  })

  it('matches tool_result to tool_call by tool_call_id when results arrive out of order', async () => {
    const contentOnlyStream = async function* () {
      yield {
        type: 'tool_call',
        tool_call: {
          id: 'call-a',
          function: {
            name: 'noop_tool',
            arguments: JSON.stringify({ index: 1 }),
          },
        },
      }
      yield {
        type: 'tool_call',
        tool_call: {
          id: 'call-b',
          function: {
            name: 'noop_tool',
            arguments: JSON.stringify({ index: 2 }),
          },
        },
      }
      yield {
        type: 'tool_result',
        tool_call_id: 'call-a',
        result: { index: 1 },
      }
      yield {
        type: 'tool_result',
        tool_call_id: 'call-b',
        result: { index: 2 },
      }
      yield { type: 'text', content: 'done' }
    }

    getClientMock.mockReturnValue({
      ensureReady: vi.fn(async () => undefined),
      chatStream: vi.fn(() => contentOnlyStream()),
    })

    for await (const event of runAgentTask('task-tool-id-match', 'assistant', 'assistant', 'run')) {
      void event
    }

    const completedCall = [...updateAgentTaskMock.mock.calls]
      .reverse()
      .find((call) => call[0] === 'task-tool-id-match' && call[1]?.status === 'completed')
    expect(completedCall).toBeDefined()

    const completedPayload = completedCall?.[1] as { steps?: string } | undefined
    const storedSteps = JSON.parse(completedPayload?.steps || '[]') as Array<{
      type: string
      toolArgs?: { index?: number }
      result?: { index?: number }
    }>

    expect(storedSteps.length).toBe(2)
    expect(storedSteps[0].toolArgs?.index).toBe(1)
    expect(storedSteps[0].result?.index).toBe(1)
    expect(storedSteps[1].toolArgs?.index).toBe(2)
    expect(storedSteps[1].result?.index).toBe(2)
  })
})
