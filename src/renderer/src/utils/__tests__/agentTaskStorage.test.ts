/**
 * Agent Task Storage 单元测试
 *
 * 测试内存缓存逻辑和 API 调用
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.electron API
const mockAgentTaskAPI = {
  get: vi.fn(),
  getByBlockId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteByBlockId: vi.fn(),
}

// Setup global mock before importing the module
vi.stubGlobal('window', {
  electron: {
    agentTask: mockAgentTaskAPI,
  },
})

// Import after mocking
import {
  getTask,
  getTaskAsync,
  getTaskByBlockId,
  getTaskByBlockIdAsync,
  createTask,
  updateTask,
  updateTaskStatus,
  updateTaskCache,
  deleteTask,
  deleteTaskByBlockId,
  clearCache,
  hasTask,
  getAllCachedTasks,
  initTaskCache,
  refreshTaskCache,
} from '../agentTaskStorage'

import type { AgentTaskRecord } from '../../../../shared/types'

// Sample test data
const mockTaskRecord: AgentTaskRecord = {
  id: 'task-123',
  blockId: 'block-456',
  pageId: 'page-789',
  notebookId: 'notebook-001',
  content: 'Test content',
  additionalPrompt: null,
  agentMode: 'auto',
  agentId: null,
  agentName: null,
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

describe('agentTaskStorage', () => {
  beforeEach(() => {
    // Clear cache and reset mocks before each test
    clearCache()
    vi.clearAllMocks()
  })

  describe('getTaskAsync', () => {
    it('从数据库获取任务并缓存', async () => {
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)

      const result = await getTaskAsync('task-123')

      expect(mockAgentTaskAPI.get).toHaveBeenCalledWith('task-123')
      expect(result).toEqual(mockTaskRecord)

      // 验证已缓存
      const cached = getTask('task-123')
      expect(cached).toBeTruthy()
      expect(cached?.id).toBe('task-123')
    })

    it('任务不存在时返回 null', async () => {
      mockAgentTaskAPI.get.mockResolvedValue(null)

      const result = await getTaskAsync('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getTask (sync)', () => {
    it('从缓存获取已加载的任务', async () => {
      // 先通过 async 方法加载
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)
      await getTaskAsync('task-123')

      // 同步获取应该命中缓存
      const cached = getTask('task-123')

      expect(cached).toBeTruthy()
      expect(cached?.id).toBe('task-123')
      expect(cached?.blockId).toBe('block-456')
      expect(cached?.status).toBe('idle')
    })

    it('缓存未命中时返回 null 并触发异步加载', () => {
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)

      // 首次同步获取返回 null
      const result = getTask('task-123')
      expect(result).toBeNull()

      // 应该触发了异步加载
      expect(mockAgentTaskAPI.get).toHaveBeenCalledWith('task-123')
    })
  })

  describe('getTaskByBlockIdAsync', () => {
    it('通过 blockId 获取任务', async () => {
      mockAgentTaskAPI.getByBlockId.mockResolvedValue(mockTaskRecord)

      const result = await getTaskByBlockIdAsync('block-456')

      expect(mockAgentTaskAPI.getByBlockId).toHaveBeenCalledWith('block-456')
      expect(result).toEqual(mockTaskRecord)
    })
  })

  describe('getTaskByBlockId (sync)', () => {
    it('从缓存获取 blockId 关联的任务', async () => {
      // 先加载
      mockAgentTaskAPI.getByBlockId.mockResolvedValue(mockTaskRecord)
      await getTaskByBlockIdAsync('block-456')

      // 同步获取
      const cached = getTaskByBlockId('block-456')

      expect(cached).toBeTruthy()
      expect(cached?.blockId).toBe('block-456')
    })
  })

  describe('createTask', () => {
    it('创建新任务并缓存', async () => {
      mockAgentTaskAPI.create.mockResolvedValue(mockTaskRecord)

      const result = await createTask({
        blockId: 'block-456',
        pageId: 'page-789',
        notebookId: 'notebook-001',
        content: 'Test content',
      })

      expect(mockAgentTaskAPI.create).toHaveBeenCalledWith({
        blockId: 'block-456',
        pageId: 'page-789',
        notebookId: 'notebook-001',
        content: 'Test content',
      })
      expect(result).toEqual(mockTaskRecord)

      // 验证已缓存
      const cached = getTask('task-123')
      expect(cached).toBeTruthy()
    })
  })

  describe('updateTask', () => {
    it('更新任务并刷新缓存', async () => {
      const updatedRecord = { ...mockTaskRecord, status: 'running' as const }
      mockAgentTaskAPI.update.mockResolvedValue(updatedRecord)

      const result = await updateTask('task-123', { status: 'running' })

      expect(mockAgentTaskAPI.update).toHaveBeenCalledWith('task-123', { status: 'running' })
      expect(result?.status).toBe('running')
    })

    it('更新不存在的任务返回 null', async () => {
      mockAgentTaskAPI.update.mockResolvedValue(null)

      const result = await updateTask('non-existent', { status: 'running' })

      expect(result).toBeNull()
    })
  })

  describe('updateTaskStatus', () => {
    it('便捷方法更新状态', async () => {
      const updatedRecord = {
        ...mockTaskRecord,
        status: 'completed' as const,
        completedAt: '2026-01-01T01:00:00.000Z',
      }
      mockAgentTaskAPI.update.mockResolvedValue(updatedRecord)

      const result = await updateTaskStatus('task-123', 'completed', {
        completedAt: '2026-01-01T01:00:00.000Z',
      })

      expect(result?.status).toBe('completed')
      expect(result?.completedAt).toBe('2026-01-01T01:00:00.000Z')
    })
  })

  describe('updateTaskCache', () => {
    it('仅更新缓存不调用 API', async () => {
      // 先加载到缓存
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)
      await getTaskAsync('task-123')

      // 更新缓存
      updateTaskCache('task-123', { currentStep: 'Processing...' })

      // 验证缓存已更新
      const cached = getTask('task-123')
      expect(cached?.currentStep).toBe('Processing...')

      // 不应该调用 update API
      expect(mockAgentTaskAPI.update).not.toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('删除任务并清理缓存', async () => {
      // 先加载
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)
      await getTaskAsync('task-123')

      mockAgentTaskAPI.delete.mockResolvedValue(true)

      const result = await deleteTask('task-123')

      expect(mockAgentTaskAPI.delete).toHaveBeenCalledWith('task-123')
      expect(result).toBe(true)

      // 缓存应该被清理
      // 由于删除后再次调用 getTask 会触发异步加载，我们检查 hasTask
      expect(hasTask('block-456')).toBe(false)
    })
  })

  describe('deleteTaskByBlockId', () => {
    it('通过 blockId 删除任务', async () => {
      // 先加载
      mockAgentTaskAPI.getByBlockId.mockResolvedValue(mockTaskRecord)
      await getTaskByBlockIdAsync('block-456')

      mockAgentTaskAPI.deleteByBlockId.mockResolvedValue(true)

      const result = await deleteTaskByBlockId('block-456')

      expect(mockAgentTaskAPI.deleteByBlockId).toHaveBeenCalledWith('block-456')
      expect(result).toBe(true)
    })
  })

  describe('clearCache', () => {
    it('清空所有缓存', async () => {
      // 加载一些任务
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)
      await getTaskAsync('task-123')

      expect(getAllCachedTasks().length).toBe(1)

      // 清空
      clearCache()

      expect(getAllCachedTasks().length).toBe(0)
    })
  })

  describe('hasTask', () => {
    it('检查 blockId 是否有关联任务', async () => {
      expect(hasTask('block-456')).toBe(false)

      mockAgentTaskAPI.getByBlockId.mockResolvedValue(mockTaskRecord)
      await getTaskByBlockIdAsync('block-456')

      expect(hasTask('block-456')).toBe(true)
    })
  })

  describe('getAllCachedTasks', () => {
    it('获取所有缓存的任务', async () => {
      const task2 = { ...mockTaskRecord, id: 'task-456', blockId: 'block-789' }

      mockAgentTaskAPI.get.mockResolvedValueOnce(mockTaskRecord)
      mockAgentTaskAPI.get.mockResolvedValueOnce(task2)

      await getTaskAsync('task-123')
      await getTaskAsync('task-456')

      const all = getAllCachedTasks()
      expect(all.length).toBe(2)
    })
  })

  describe('initTaskCache', () => {
    it('初始化时清空缓存', async () => {
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)
      await getTaskAsync('task-123')

      expect(getAllCachedTasks().length).toBe(1)

      await initTaskCache()

      expect(getAllCachedTasks().length).toBe(0)
    })
  })

  describe('refreshTaskCache', () => {
    it('刷新所有缓存的任务', async () => {
      mockAgentTaskAPI.get.mockResolvedValue(mockTaskRecord)
      await getTaskAsync('task-123')

      const updatedRecord = { ...mockTaskRecord, status: 'completed' as const }
      mockAgentTaskAPI.get.mockResolvedValue(updatedRecord)

      await refreshTaskCache()

      const cached = getTask('task-123')
      expect(cached?.status).toBe('completed')
    })
  })

  describe('缓存大小限制', () => {
    it('超过限制时移除旧条目', async () => {
      // 创建超过 MAX_CACHE_SIZE (50) 的任务
      for (let i = 0; i < 55; i++) {
        const task = {
          ...mockTaskRecord,
          id: `task-${i}`,
          blockId: `block-${i}`,
        }
        mockAgentTaskAPI.get.mockResolvedValueOnce(task)
        await getTaskAsync(`task-${i}`)
      }

      const all = getAllCachedTasks()
      // 应该只保留最近的 50 个
      expect(all.length).toBeLessThanOrEqual(50)
    })
  })
})
