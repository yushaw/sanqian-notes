/**
 * Editor Output Handler 单元测试
 *
 * 测试 Agent 任务输出插入逻辑，特别是：
 * - 重试时删除旧的 managed blocks
 * - 正确插入新内容
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock editor commands
const mockDeleteManagedBlocks = vi.fn().mockReturnValue(true)
const mockChain = vi.fn().mockReturnValue({
  focus: vi.fn().mockReturnValue({
    deleteRange: vi.fn().mockReturnValue({
      insertContentAt: vi.fn().mockReturnValue({
        run: vi.fn(),
      }),
    }),
    insertContentAt: vi.fn().mockReturnValue({
      run: vi.fn(),
    }),
  }),
})
const mockInsertContent = vi.fn()

// Mock editor
const createMockEditor = (nodes: Array<{ blockId: string; managedBy?: string; nodeSize: number }>) => {
  let currentPos = 0
  const nodeData = nodes.map((node) => {
    const pos = currentPos
    currentPos += node.nodeSize
    return { ...node, pos }
  })

  return {
    commands: {
      deleteManagedBlocks: mockDeleteManagedBlocks,
      insertContent: mockInsertContent,
    },
    chain: mockChain,
    state: {
      doc: {
        descendants: (callback: (node: { attrs: { blockId: string; managedBy?: string }; nodeSize: number; type: { name: string } }, pos: number) => void) => {
          nodeData.forEach((node) => {
            callback(
              {
                attrs: { blockId: node.blockId, managedBy: node.managedBy },
                nodeSize: node.nodeSize,
                type: { name: 'paragraph' },
              },
              node.pos
            )
          })
        },
      },
    },
  }
}

// Import after setting up mocks
import { handleOutputInsertion, type InsertOutputData } from '../editorOutputHandler'

describe('editorOutputHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleOutputInsertion', () => {
    it('should delete existing managed blocks before inserting new content (retry scenario)', () => {
      const mockEditor = createMockEditor([
        { blockId: 'agent-block-1', nodeSize: 10 },
        { blockId: 'managed-block-1', managedBy: 'agent-block-1', nodeSize: 15 },
        { blockId: 'managed-block-2', managedBy: 'agent-block-1', nodeSize: 20 },
      ])

      const data: InsertOutputData = {
        taskId: 'task-1',
        context: {
          targetBlockId: 'agent-block-1',
          pageId: 'page-1',
          notebookId: 'notebook-1',
          processMode: 'append',
          outputBlockId: null,
        },
        operations: [
          {
            type: 'paragraph',
            content: { paragraphs: ['New content'] },
          },
        ],
      }

      handleOutputInsertion(mockEditor as unknown as Parameters<typeof handleOutputInsertion>[0], data)

      // Should call deleteManagedBlocks with the target block ID
      expect(mockDeleteManagedBlocks).toHaveBeenCalledWith('agent-block-1')
      expect(mockDeleteManagedBlocks).toHaveBeenCalledTimes(1)
    })

    it('should not fail if no existing managed blocks', () => {
      const mockEditor = createMockEditor([
        { blockId: 'agent-block-1', nodeSize: 10 },
      ])

      const data: InsertOutputData = {
        taskId: 'task-1',
        context: {
          targetBlockId: 'agent-block-1',
          pageId: 'page-1',
          notebookId: 'notebook-1',
          processMode: 'append',
          outputBlockId: null,
        },
        operations: [
          {
            type: 'paragraph',
            content: { paragraphs: ['New content'] },
          },
        ],
      }

      // Should not throw
      expect(() => {
        handleOutputInsertion(mockEditor as unknown as Parameters<typeof handleOutputInsertion>[0], data)
      }).not.toThrow()

      expect(mockDeleteManagedBlocks).toHaveBeenCalledWith('agent-block-1')
    })

    it('should return null if no operations provided', () => {
      const mockEditor = createMockEditor([
        { blockId: 'agent-block-1', nodeSize: 10 },
      ])

      const data: InsertOutputData = {
        taskId: 'task-1',
        context: {
          targetBlockId: 'agent-block-1',
          pageId: 'page-1',
          notebookId: 'notebook-1',
          processMode: 'append',
          outputBlockId: null,
        },
        operations: [],
      }

      const result = handleOutputInsertion(mockEditor as unknown as Parameters<typeof handleOutputInsertion>[0], data)

      expect(result).toBeNull()
      // Should not attempt to delete managed blocks for empty operations
      expect(mockDeleteManagedBlocks).not.toHaveBeenCalled()
    })

    it('should return null if target block not found', () => {
      const mockEditor = createMockEditor([
        { blockId: 'other-block', nodeSize: 10 },
      ])

      const data: InsertOutputData = {
        taskId: 'task-1',
        context: {
          targetBlockId: 'non-existent-block',
          pageId: 'page-1',
          notebookId: 'notebook-1',
          processMode: 'append',
          outputBlockId: null,
        },
        operations: [
          {
            type: 'paragraph',
            content: { paragraphs: ['Content'] },
          },
        ],
      }

      const result = handleOutputInsertion(mockEditor as unknown as Parameters<typeof handleOutputInsertion>[0], data)

      expect(result).toBeNull()
    })
  })
})
