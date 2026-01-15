/**
 * AgentTaskPanel 组件测试
 *
 * 测试新增功能：
 * 1. 执行阶段显示 (content/editor phase)
 * 2. 处理模式选择 (append/replace)
 * 3. 输出块关联显示 (outputBlockId)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { AgentTaskPanel } from '../AgentTaskPanel'
import type { AgentTaskRecord } from '../../../../shared/types'

// Mock translations
vi.mock('../../i18n', () => ({
  useI18n: () => ({
    language: 'zh',
    isZh: true,
    t: {
      agentTask: {
        phaseContent: '生成内容',
        phaseEditor: '格式化输出',
        modeAppend: '追加',
        modeReplace: '替换',
        outputLinked: '已输出',
        outputPending: '待输出',
        formatLabel: '格式',
        formatAuto: '自动',
        formatParagraph: '段落',
        formatList: '列表',
        formatTable: '表格',
        formatCode: '代码',
        formatQuote: '引用',
        execute: '运行',
        cancel: '取消',
        copy: '复制',
        remove: '移除',
        retry: '重试',
        configure: '配置',
        collapse: '收起',
        insertBelow: '插入',
        additionalPromptPlaceholder: '可选指令...',
        emptyContent: '(空)',
        useAgent: '使用',
        noAgents: '无可用 Agent',
        executingMessage: '处理中...',
        thinking: '思考',
        unknownError: '未知错误',
        interrupted: '任务被中断',
        reconfigure: '重新配置',
        reExecute: '重试',
      },
    },
  }),
  useTranslations: () => ({
    agentTask: {
      phaseContent: '生成内容',
      phaseEditor: '格式化输出',
      modeAppend: '追加',
      modeReplace: '替换',
      outputLinked: '已输出',
      outputPending: '待输出',
      formatLabel: '格式',
      formatAuto: '自动',
      formatParagraph: '段落',
      formatList: '列表',
      formatTable: '表格',
      formatCode: '代码',
      formatQuote: '引用',
      execute: '运行',
      cancel: '取消',
      copy: '复制',
      remove: '移除',
      retry: '重试',
      configure: '配置',
      collapse: '收起',
      insertBelow: '插入',
      additionalPromptPlaceholder: '可选指令...',
      emptyContent: '(空)',
      useAgent: '使用',
      noAgents: '无可用 Agent',
      executingMessage: '处理中...',
      thinking: '思考',
      unknownError: '未知错误',
      interrupted: '任务被中断',
      reconfigure: '重新配置',
      reExecute: '重试',
    },
  }),
}))

// Mock agentTaskStorage
const mockGetTaskAsync = vi.fn()
const mockCreateTask = vi.fn()
const mockUpdateTask = vi.fn()
const mockDeleteTask = vi.fn()

vi.mock('../../utils/agentTaskStorage', () => ({
  getTaskAsync: (...args: unknown[]) => mockGetTaskAsync(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
}))

// Mock window.electron - extend existing window instead of replacing
const mockAgentList = vi.fn()
const mockAgentRun = vi.fn()
const mockAgentCancel = vi.fn()
const mockAgentOnEvent = vi.fn()

// Use Object.defineProperty to add electron to window without replacing it
beforeAll(() => {
  Object.defineProperty(window, 'electron', {
    value: {
      agent: {
        list: mockAgentList,
        run: mockAgentRun,
        cancel: mockAgentCancel,
        onEvent: mockAgentOnEvent,
      },
    },
    writable: true,
    configurable: true,
  })
})

// Mock createPortal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

// Sample data
const mockAgents: AgentCapability[] = [
  { type: 'agent', id: 'agent-1', name: 'Test Agent', source: 'builtin' },
  { type: 'agent', id: 'agent-2', name: 'Another Agent', source: 'builtin' },
]

const mockTaskIdle: AgentTaskRecord = {
  id: 'task-1',
  blockId: 'block-1',
  pageId: 'page-1',
  notebookId: 'notebook-1',
  content: 'Test content',
  additionalPrompt: null,
  agentMode: 'specified',
  agentId: 'agent-1',
  agentName: 'Test Agent',
  status: 'idle',
  startedAt: null,
  completedAt: null,
  durationMs: null,
  steps: null,
  result: null,
  error: null,
  outputBlockId: null,
  processMode: 'append',
  outputFormat: 'auto',
  runTiming: 'manual',
  scheduleConfig: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const mockTaskCompleted: AgentTaskRecord = {
  ...mockTaskIdle,
  status: 'completed',
  result: 'This is the result',
  durationMs: 1500,
  completedAt: '2026-01-01T00:01:00.000Z',
}

const mockTaskRunning: AgentTaskRecord = {
  ...mockTaskIdle,
  status: 'running',
  startedAt: '2026-01-01T00:00:30.000Z',
}

const mockTaskFailed: AgentTaskRecord = {
  ...mockTaskIdle,
  status: 'failed',
  error: 'Something went wrong',
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  blockIds: ['block-1'],
  taskId: null,
  blockContent: 'Test block content',
  pageId: 'page-1',
  notebookId: 'notebook-1',
}

describe('AgentTaskPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentList.mockResolvedValue(mockAgents)
    mockAgentOnEvent.mockReturnValue(() => {})
  })

  afterEach(() => {
    cleanup()
  })

  describe('渲染状态', () => {
    it('isOpen=false 时不渲染', () => {
      const { container } = render(<AgentTaskPanel {...defaultProps} isOpen={false} />)
      expect(container.firstChild).toBeNull()
    })

    it('isOpen=true 时渲染面板', async () => {
      render(<AgentTaskPanel {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Test block content')).toBeInTheDocument()
      })
    })
  })

  describe('格式选择与处理模式 (Idle State)', () => {
    it('默认显示格式选择器和处理模式按钮', async () => {
      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        // 格式选择器存在
        expect(screen.getByText('格式')).toBeInTheDocument()
        // 处理模式按钮始终可见
        expect(screen.getByText('追加')).toBeInTheDocument()
        expect(screen.getByText('替换')).toBeInTheDocument()
        // 默认选中追加
        expect(screen.getByText('追加')).toHaveClass('bg-white')
      })
    })

    it('点击切换到替换模式', async () => {
      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        const replaceButton = screen.getByText('替换')
        fireEvent.click(replaceButton)
        expect(replaceButton).toHaveClass('bg-white')
      })
    })

    it('创建任务时传递 processMode', async () => {
      mockCreateTask.mockResolvedValue(mockTaskIdle)
      mockAgentRun.mockResolvedValue(undefined)

      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Test Agent')).toBeInTheDocument()
      })

      // 切换到替换模式
      fireEvent.click(screen.getByText('替换'))

      // 点击运行
      fireEvent.click(screen.getByText('运行'))

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith(
          expect.objectContaining({
            processMode: 'replace',
          })
        )
      })
    })

    it('默认格式为 auto 时传递 outputContext', async () => {
      mockCreateTask.mockResolvedValue(mockTaskIdle)
      mockAgentRun.mockResolvedValue(undefined)

      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Test Agent')).toBeInTheDocument()
      })

      // 默认格式为 auto，直接运行
      fireEvent.click(screen.getByText('运行'))

      await waitFor(() => {
        // 检查 agent.run 传递了 outputContext
        expect(mockAgentRun).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          undefined,
          expect.objectContaining({
            targetBlockId: 'block-1',
            processMode: 'append',
            outputFormat: 'auto',
          })
        )
      })
    })

    it('选择格式后传递 outputContext', async () => {
      mockCreateTask.mockResolvedValue(mockTaskIdle)
      mockAgentRun.mockResolvedValue(undefined)

      render(<AgentTaskPanel {...defaultProps} />)

      // 等待组件完全渲染
      await waitFor(() => {
        expect(screen.getByText('Test Agent')).toBeInTheDocument()
        // 确保格式选择器也已渲染（中文环境下显示 "自动"）
        const buttons = screen.getAllByRole('button')
        expect(buttons.some(btn => btn.textContent?.includes('自动'))).toBe(true)
      })

      // 找到格式选择器按钮（包含 "自动" 文本的按钮）
      const buttons = screen.getAllByRole('button')
      const formatButton = buttons.find(btn => btn.textContent?.includes('自动'))
      expect(formatButton).toBeDefined()

      // 点击打开格式下拉菜单
      fireEvent.click(formatButton!)

      // 等待下拉菜单出现
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument()
      })

      // 选择 "列表" 格式（中文）
      const listOption = screen.getAllByRole('option').find(opt => opt.textContent?.includes('列表'))
      expect(listOption).toBeDefined()
      fireEvent.click(listOption!)

      // 点击运行
      fireEvent.click(screen.getByText('运行'))

      await waitFor(() => {
        // 检查 agent.run 传递了 outputContext 和 outputFormat
        expect(mockAgentRun).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          undefined,
          expect.objectContaining({
            targetBlockId: 'block-1',
            processMode: 'append',
            outputFormat: 'list',
          })
        )
      })
    })
  })

  describe('执行阶段显示 (Running State)', () => {
    it('显示阶段指示器', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskIdle)
      mockCreateTask.mockResolvedValue(mockTaskRunning)
      mockAgentRun.mockResolvedValue(undefined)

      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('运行')).toBeInTheDocument()
      })

      // 格式默认就是 "Auto"，不需要改变

      // 点击运行
      fireEvent.click(screen.getByText('运行'))

      await waitFor(() => {
        expect(screen.getByText('生成内容')).toBeInTheDocument()
        expect(screen.getByText('格式化输出')).toBeInTheDocument()
      })
    })

    it('phase 事件更新当前阶段', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskIdle)
      mockCreateTask.mockResolvedValue(mockTaskRunning)
      mockAgentRun.mockResolvedValue(undefined)

      let eventCallback: ((taskId: string, event: unknown) => void) | null = null
      mockAgentOnEvent.mockImplementation((cb) => {
        eventCallback = cb
        return () => {}
      })

      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('运行')).toBeInTheDocument()
      })

      // 找到格式选择器按钮（中文环境下显示 "自动"）
      const buttons = screen.getAllByRole('button')
      const formatButton = buttons.find(btn => btn.textContent?.includes('自动'))
      if (formatButton) {
        fireEvent.click(formatButton)
        // 选择 "列表" 格式（中文）
        const listOption = screen.getAllByRole('option').find(opt => opt.textContent?.includes('列表'))
        if (listOption) fireEvent.click(listOption)
      }

      // 点击运行
      fireEvent.click(screen.getByText('运行'))

      await waitFor(() => {
        expect(mockAgentRun).toHaveBeenCalled()
      })

      // 模拟 phase 事件 - wrap in act() to handle state updates
      await act(async () => {
        if (eventCallback !== null) {
          (eventCallback as (taskId: string, event: unknown) => void)('task-1', { type: 'phase', phase: 'content' })
        }
      })

      // 验证 content 阶段高亮（通过 class 检查）
      await waitFor(() => {
        const contentLabel = screen.getByText('生成内容')
        expect(contentLabel).toHaveClass('text-[var(--color-text)]')
      })
    })
  })

  describe('任务状态转换', () => {
    it('completed 状态显示结果和元信息', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskCompleted)

      render(<AgentTaskPanel {...defaultProps} taskId="task-1" />)

      await waitFor(() => {
        expect(screen.getByText('This is the result')).toBeInTheDocument()
        expect(screen.getByText('Test Agent')).toBeInTheDocument()
        // Duration is shown with separator: "· 1.5s"
        expect(screen.getByText(/1\.5s/)).toBeInTheDocument()
      })
    })

    it('failed 状态显示错误信息', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskFailed)

      render(<AgentTaskPanel {...defaultProps} taskId="task-1" />)

      await waitFor(() => {
        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
        expect(screen.getByText('重试')).toBeInTheDocument()
      })
    })

    it('running 状态显示取消按钮', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskRunning)

      render(<AgentTaskPanel {...defaultProps} taskId="task-1" />)

      await waitFor(() => {
        expect(screen.getByText('取消')).toBeInTheDocument()
      })
    })
  })

  describe('Agent 选择', () => {
    it('加载 agent 列表', async () => {
      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        expect(mockAgentList).toHaveBeenCalled()
      })
    })

    it('自动选择第一个 agent', async () => {
      render(<AgentTaskPanel {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Test Agent')).toBeInTheDocument()
      })
    })

    it('更新任务时传递新的 agentId', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskIdle)
      mockUpdateTask.mockResolvedValue({ ...mockTaskIdle, agentId: 'agent-2' })
      mockAgentRun.mockResolvedValue(undefined)

      render(<AgentTaskPanel {...defaultProps} taskId="task-1" />)

      await waitFor(() => {
        // AgentSelect 显示选中的 agent 名称
        expect(screen.getByRole('button', { name: /Test Agent/i })).toBeInTheDocument()
      })

      // 点击打开 agent 下拉菜单
      fireEvent.click(screen.getByRole('button', { name: /Test Agent/i }))

      // 选择另一个 agent
      const options = screen.getAllByRole('option')
      const anotherAgentOption = options.find(opt => opt.textContent?.includes('Another Agent'))
      if (anotherAgentOption) fireEvent.click(anotherAgentOption)

      // 运行
      fireEvent.click(screen.getByText('运行'))

      await waitFor(() => {
        expect(mockUpdateTask).toHaveBeenCalledWith(
          'task-1',
          expect.objectContaining({
            agentId: 'agent-2',
            agentName: 'Another Agent',
          })
        )
      })
    })
  })

  describe('用户交互', () => {
    it('ESC 键关闭面板', async () => {
      const onClose = vi.fn()
      render(<AgentTaskPanel {...defaultProps} onClose={onClose} />)

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('点击背景关闭面板', async () => {
      const onClose = vi.fn()
      render(<AgentTaskPanel {...defaultProps} onClose={onClose} />)

      await waitFor(() => {
        const backdrop = document.querySelector('.backdrop-blur-\\[2px\\]')
        if (backdrop) {
          fireEvent.click(backdrop)
          expect(onClose).toHaveBeenCalled()
        }
      })
    })

    it('completed 状态可以复制结果', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskCompleted)
      const writeText = vi.fn()
      Object.assign(navigator, { clipboard: { writeText } })

      render(<AgentTaskPanel {...defaultProps} taskId="task-1" />)

      await waitFor(() => {
        fireEvent.click(screen.getByText('复制'))
        expect(writeText).toHaveBeenCalledWith('This is the result')
      })
    })

    it('删除任务', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskCompleted)
      mockDeleteTask.mockResolvedValue(true)
      const onTaskRemoved = vi.fn()
      const onClose = vi.fn()

      render(
        <AgentTaskPanel
          {...defaultProps}
          taskId="task-1"
          onTaskRemoved={onTaskRemoved}
          onClose={onClose}
        />
      )

      await waitFor(() => {
        fireEvent.click(screen.getByText('移除'))
      })

      await waitFor(() => {
        expect(mockDeleteTask).toHaveBeenCalledWith('task-1')
        expect(onTaskRemoved).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('中断恢复', () => {
    it('running 状态的任务重新打开时标记为 failed', async () => {
      mockGetTaskAsync.mockResolvedValue(mockTaskRunning)
      mockUpdateTask.mockResolvedValue({ ...mockTaskRunning, status: 'failed' })

      render(<AgentTaskPanel {...defaultProps} taskId="task-1" />)

      await waitFor(() => {
        expect(mockUpdateTask).toHaveBeenCalledWith('task-1', {
          status: 'failed',
          error: '任务被中断',
        })
      })
    })
  })
})
