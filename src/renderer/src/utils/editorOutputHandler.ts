/**
 * Editor Output Handler
 *
 * 处理 Agent 任务的输出插入逻辑
 * 将 output tools 生成的操作转换为 Tiptap 节点并插入到编辑器中
 */

import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { generateBlockId } from '../components/extensions/BlockId'
import type {
  EditorOutputContext,
  OutputOperation,
  InsertOutputData,
} from '../../../shared/types'
import { parseInlineMarkdown, TiptapNode } from '../../../shared/markdown/inline-parser'

// Re-export types for backwards compatibility
export type { EditorOutputContext as OutputContext, OutputOperation, InsertOutputData }

/**
 * Convert paragraph operation to Tiptap nodes
 */
function convertParagraph(content: { paragraphs: string[] }, managerBlockId: string): TiptapNode[] {
  return content.paragraphs.map((text) => ({
    type: 'paragraph',
    attrs: {
      blockId: generateBlockId(),
      managedBy: managerBlockId,
    },
    content: parseInlineMarkdown(text),
  }))
}

/**
 * Convert list operation to Tiptap nodes
 */
function convertList(
  content: {
    type: 'bullet' | 'ordered' | 'task'
    items: Array<{ text: string; checked?: boolean }>
  },
  managerBlockId: string
): TiptapNode[] {
  const listType =
    content.type === 'bullet'
      ? 'bulletList'
      : content.type === 'ordered'
        ? 'orderedList'
        : 'taskList'

  const itemType = content.type === 'task' ? 'taskItem' : 'listItem'

  const items = content.items.map((item) => ({
    type: itemType,
    attrs: {
      blockId: generateBlockId(),
      managedBy: managerBlockId,
      ...(content.type === 'task' ? { checked: item.checked ?? false } : {}),
    },
    content: [
      {
        type: 'paragraph',
        content: parseInlineMarkdown(item.text),
      },
    ],
  }))

  return [
    {
      type: listType,
      attrs: {
        blockId: generateBlockId(),
        managedBy: managerBlockId,
      },
      content: items,
    },
  ]
}

/**
 * Convert heading operation to Tiptap nodes
 */
function convertHeading(
  content: { level: number; text: string },
  managerBlockId: string
): TiptapNode[] {
  return [
    {
      type: 'heading',
      attrs: {
        level: content.level,
        blockId: generateBlockId(),
        managedBy: managerBlockId,
      },
      content: parseInlineMarkdown(content.text),
    },
  ]
}

/**
 * Convert code block operation to Tiptap nodes
 */
function convertCodeBlock(
  content: { language?: string; code: string },
  managerBlockId: string
): TiptapNode[] {
  return [
    {
      type: 'codeBlock',
      attrs: {
        language: content.language || 'text',
        blockId: generateBlockId(),
        managedBy: managerBlockId,
      },
      content: content.code ? [{ type: 'text', text: content.code }] : [],
    },
  ]
}

/**
 * Convert blockquote operation to Tiptap nodes
 */
function convertBlockquote(content: { text: string }, managerBlockId: string): TiptapNode[] {
  return [
    {
      type: 'blockquote',
      attrs: {
        blockId: generateBlockId(),
        managedBy: managerBlockId,
      },
      content: [
        {
          type: 'paragraph',
          content: parseInlineMarkdown(content.text),
        },
      ],
    },
  ]
}

/**
 * Convert table operation to Tiptap nodes
 */
function convertTable(
  content: { headers: string[]; rows: string[][] },
  managerBlockId: string
): TiptapNode[] {
  const headerRow: TiptapNode = {
    type: 'tableRow',
    content: content.headers.map((header) => ({
      type: 'tableHeader',
      content: [
        {
          type: 'paragraph',
          content: parseInlineMarkdown(header),
        },
      ],
    })),
  }

  const dataRows: TiptapNode[] = content.rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cell) => ({
      type: 'tableCell',
      content: [
        {
          type: 'paragraph',
          content: parseInlineMarkdown(cell),
        },
      ],
    })),
  }))

  return [
    {
      type: 'table',
      attrs: {
        blockId: generateBlockId(),
        managedBy: managerBlockId,
      },
      content: [headerRow, ...dataRows],
    },
  ]
}

/**
 * Convert note reference operation to Tiptap nodes
 *
 * 支持两种模式：
 * 1. 有 noteId：生成带 noteLink mark 的实际链接
 * 2. 无 noteId：生成 [[displayText]] 占位符文本
 */
function convertNoteRef(
  content: { noteTitle: string; displayText?: string; noteId?: string },
  managerBlockId: string
): TiptapNode[] {
  const displayText = content.displayText || content.noteTitle

  // 如果有 noteId，生成实际的 noteLink mark
  if (content.noteId) {
    return [
      {
        type: 'paragraph',
        attrs: {
          blockId: generateBlockId(),
          managedBy: managerBlockId,
        },
        content: [
          {
            type: 'text',
            text: displayText,
            marks: [
              {
                type: 'noteLink',
                attrs: {
                  noteId: content.noteId,
                  noteTitle: content.noteTitle,
                  targetType: 'note',
                  targetValue: null,
                },
              },
            ],
          },
        ],
      },
    ]
  }

  // 无 noteId 时，生成 [[displayText]] 占位符（用户可手动转换）
  return [
    {
      type: 'paragraph',
      attrs: {
        blockId: generateBlockId(),
        managedBy: managerBlockId,
      },
      content: [
        {
          type: 'text',
          text: `[[${displayText}]]`,
        },
      ],
    },
  ]
}

/**
 * Convert operation to Tiptap nodes
 */
function convertOperation(operation: OutputOperation, managerBlockId: string): TiptapNode[] {
  switch (operation.type) {
    case 'paragraph':
      return convertParagraph(operation.content as { paragraphs: string[] }, managerBlockId)
    case 'list':
      return convertList(
        operation.content as {
          type: 'bullet' | 'ordered' | 'task'
          items: Array<{ text: string; checked?: boolean }>
        },
        managerBlockId
      )
    case 'heading':
      return convertHeading(operation.content as { level: number; text: string }, managerBlockId)
    case 'codeBlock':
      return convertCodeBlock(
        operation.content as { language?: string; code: string },
        managerBlockId
      )
    case 'blockquote':
      return convertBlockquote(operation.content as { text: string }, managerBlockId)
    case 'table':
      return convertTable(
        operation.content as { headers: string[]; rows: string[][] },
        managerBlockId
      )
    case 'noteRef':
      return convertNoteRef(
        operation.content as { noteTitle: string; displayText?: string; noteId?: string },
        managerBlockId
      )
    case 'html':
      // HTML will be handled by insertContent which can parse HTML
      return []
    default:
      console.warn(`[EditorOutput] Unknown operation type: ${operation.type}`)
      return []
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Find an AgentBlock node by its blockId
 */
function findAgentBlock(
  editor: Editor,
  blockId: string
): { node: ProseMirrorNode; pos: number } | null {
  let result: { node: ProseMirrorNode; pos: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.blockId === blockId && node.type.name === 'agentBlock') {
      result = { node, pos }
      return false // Stop traversal
    }
  })
  return result
}

// ============================================
// Main Handler
// ============================================

/**
 * Handle output insertion from Agent task
 *
 * Supports multi-block operations:
 * - For AgentBlock: insert content inside the block (nested)
 * - For other blocks:
 *   - append: insert after the last selected block
 *   - replace: delete all selected blocks and insert at the first position
 *
 * @param editor Tiptap editor instance
 * @param data Output data from main process
 * @returns The block ID of the first inserted output block (for tracking)
 */
export function handleOutputInsertion(editor: Editor, data: InsertOutputData): string | null {
  const { context, operations } = data

  if (operations.length === 0) {
    return null
  }

  // Get all block IDs to process (use blockIds if available, otherwise fall back to targetBlockId)
  const blockIds = context.blockIds?.length ? context.blockIds : [context.targetBlockId]
  const primaryBlockId = blockIds[0]

  // First, delete any existing managed blocks (for retry scenarios)
  // This ensures old output is replaced with new output
  editor.commands.deleteManagedBlocks(primaryBlockId)

  // Find positions of all target blocks
  const blockPositions: Array<{ blockId: string; pos: number; nodeSize: number; nodeType: string }> = []

  editor.state.doc.descendants((node, pos) => {
    const nodeBlockId = node.attrs.blockId
    if (nodeBlockId && blockIds.includes(nodeBlockId)) {
      blockPositions.push({ blockId: nodeBlockId, pos, nodeSize: node.nodeSize, nodeType: node.type.name })
    }
  })

  // Sort by position to maintain document order
  blockPositions.sort((a, b) => a.pos - b.pos)

  if (blockPositions.length === 0) {
    console.error(`[EditorOutput] No target blocks found for: ${blockIds.join(', ')}`)
    return null
  }

  // Convert operations to Tiptap nodes
  const nodes: TiptapNode[] = []
  let firstOutputBlockId: string | null = null

  for (const operation of operations) {
    if (operation.type === 'html') {
      // HTML operations will be handled separately
      continue
    }

    const converted = convertOperation(operation, primaryBlockId)
    if (converted.length > 0) {
      // Track first output block ID
      if (firstOutputBlockId === null && converted[0].attrs?.blockId) {
        firstOutputBlockId = converted[0].attrs.blockId as string
      }
      nodes.push(...converted)
    }
  }

  // Check if primary target is an AgentBlock
  const primaryBlock = blockPositions.find(b => b.blockId === primaryBlockId)
  const isAgentBlock = primaryBlock?.nodeType === 'agentBlock'

  // Insert nodes based on target type and process mode
  if (nodes.length > 0) {
    if (isAgentBlock && primaryBlock) {
      // AgentBlock: insert content inside the block
      const agentBlockInfo = findAgentBlock(editor, primaryBlockId)

      if (agentBlockInfo) {
        const { node: agentBlockNode, pos: agentBlockPos } = agentBlockInfo
        // Clear existing content if in replace mode
        const contentStart = agentBlockPos + 1 // After opening tag
        const contentEnd = agentBlockPos + agentBlockNode.nodeSize - 1 // Before closing tag

        if (context.processMode === 'replace' && agentBlockNode.content.size > 0) {
          // Delete existing content and insert new
          editor.chain()
            .focus()
            .deleteRange({ from: contentStart, to: contentEnd })
            .insertContentAt(contentStart, nodes)
            .run()
        } else {
          // Append: insert at the end of existing content
          editor.chain()
            .focus()
            .insertContentAt(contentEnd, nodes)
            .run()
        }
      }
    } else if (context.processMode === 'replace') {
      // Replace mode: delete selected blocks and insert at the first position
      // Check if blocks are contiguous to avoid deleting unselected content
      const firstBlock = blockPositions[0]
      const lastBlock = blockPositions[blockPositions.length - 1]
      const totalRange = lastBlock.pos + lastBlock.nodeSize - firstBlock.pos
      const selectedSize = blockPositions.reduce((sum, b) => sum + b.nodeSize, 0)

      if (blockPositions.length > 1 && totalRange !== selectedSize) {
        // Blocks are not contiguous - delete each block individually (from end to start)
        // This preserves unselected content between selected blocks
        console.warn('[EditorOutput] Selected blocks are not contiguous, deleting individually')
        const chain = editor.chain().focus()
        // Delete from end to start to maintain correct positions
        for (let i = blockPositions.length - 1; i >= 0; i--) {
          const block = blockPositions[i]
          chain.deleteRange({ from: block.pos, to: block.pos + block.nodeSize })
        }
        // Insert at first block position
        chain.insertContentAt(firstBlock.pos, nodes).run()
      } else {
        // Blocks are contiguous - delete entire range
        const deleteFrom = firstBlock.pos
        const deleteTo = lastBlock.pos + lastBlock.nodeSize
        editor.chain().focus().deleteRange({ from: deleteFrom, to: deleteTo }).insertContentAt(deleteFrom, nodes).run()
      }
    } else {
      // Append mode: insert after the last target block
      const lastBlock = blockPositions[blockPositions.length - 1]
      const insertPos = lastBlock.pos + lastBlock.nodeSize
      editor.chain().focus().insertContentAt(insertPos, nodes).run()
    }
  }

  // Handle HTML operations (insert after other content for non-AgentBlock, or inside for AgentBlock)
  const htmlOperations = operations.filter((op) => op.type === 'html')
  for (const htmlOp of htmlOperations) {
    const htmlContent = (htmlOp.content as { html: string }).html
    if (htmlContent) {
      if (isAgentBlock && primaryBlock) {
        // For AgentBlock, need to re-find position as it may have changed
        const agentBlockInfo = findAgentBlock(editor, primaryBlockId)

        if (agentBlockInfo) {
          const { node: agentBlockNode, pos: agentBlockPos } = agentBlockInfo
          const contentEnd = agentBlockPos + agentBlockNode.nodeSize - 1
          editor.chain().focus().insertContentAt(contentEnd, htmlContent).run()
        }
      } else {
        const docEndPos = editor.state.doc.content.size
        editor.chain().focus().insertContentAt(docEndPos, htmlContent).run()
      }
    }
  }

  return firstOutputBlockId
}

/**
 * Setup listener for output insertion events
 *
 * @param getEditor Function to get current editor instance
 * @param onOutputInserted Callback when output is inserted (receives first block ID)
 * @returns Cleanup function
 */
export function setupOutputListener(
  getEditor: () => Editor | null,
  onOutputInserted?: (taskId: string, outputBlockId: string | null) => void
): () => void {
  return window.electron.agent.onInsertOutput((data) => {
    const editor = getEditor()
    if (!editor) {
      console.warn('[EditorOutput] No editor instance available')
      return
    }

    const outputBlockId = handleOutputInsertion(editor, data)
    onOutputInserted?.(data.taskId, outputBlockId)
  })
}
