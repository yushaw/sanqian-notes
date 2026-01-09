/**
 * Editor Output Handler
 *
 * 处理 Agent 任务的输出插入逻辑
 * 将 output tools 生成的操作转换为 Tiptap 节点并插入到编辑器中
 */

import type { Editor } from '@tiptap/react'
import { generateBlockId } from '../components/extensions/BlockId'
import type {
  EditorOutputContext,
  OutputOperation,
  InsertOutputData,
} from '../../../shared/types'

// Re-export types for backwards compatibility
export type { EditorOutputContext as OutputContext, OutputOperation, InsertOutputData }

// ============================================
// Operation Converters
// ============================================

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
}

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
    content: text ? [{ type: 'text', text }] : [],
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
        content: item.text ? [{ type: 'text', text: item.text }] : [],
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
      content: content.text ? [{ type: 'text', text: content.text }] : [],
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
          content: content.text ? [{ type: 'text', text: content.text }] : [],
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
          content: header ? [{ type: 'text', text: header }] : [],
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
          content: cell ? [{ type: 'text', text: cell }] : [],
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
 */
function convertNoteRef(
  content: { noteTitle: string; displayText?: string },
  managerBlockId: string
): TiptapNode[] {
  // Note: This creates a placeholder paragraph with the note reference
  // The actual note linking would require looking up the note ID
  const displayText = content.displayText || content.noteTitle
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
          // TODO: Convert to actual noteLink mark when note lookup is available
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
        operation.content as { noteTitle: string; displayText?: string },
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
// Main Handler
// ============================================

/**
 * Handle output insertion from Agent task
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

  // First, delete any existing managed blocks (for retry scenarios)
  // This ensures old output is replaced with new output
  editor.commands.deleteManagedBlocks(context.targetBlockId)

  // Find the target block position (after deletion, positions may have changed)
  let targetPos: number | null = null
  let targetNodeSize = 0

  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.blockId === context.targetBlockId && targetPos === null) {
      targetPos = pos
      targetNodeSize = node.nodeSize
    }
  })

  if (targetPos === null) {
    console.error(`[EditorOutput] Target block not found: ${context.targetBlockId}`)
    return null
  }

  // Calculate insert position
  const insertPos =
    context.processMode === 'replace' ? targetPos : targetPos + targetNodeSize

  // Convert operations to Tiptap nodes
  const nodes: TiptapNode[] = []
  let firstOutputBlockId: string | null = null

  for (const operation of operations) {
    if (operation.type === 'html') {
      // HTML operations will be handled separately
      continue
    }

    const converted = convertOperation(operation, context.targetBlockId)
    if (converted.length > 0) {
      // Track first output block ID
      if (firstOutputBlockId === null && converted[0].attrs?.blockId) {
        firstOutputBlockId = converted[0].attrs.blockId as string
      }
      nodes.push(...converted)
    }
  }

  // Insert nodes
  if (nodes.length > 0) {
    if (context.processMode === 'replace') {
      // Replace mode: delete target block and insert new content
      editor
        .chain()
        .focus()
        .deleteRange({ from: targetPos, to: targetPos + targetNodeSize })
        .insertContentAt(targetPos, nodes)
        .run()
    } else {
      // Append mode: insert after target block
      editor.chain().focus().insertContentAt(insertPos, nodes).run()
    }
  }

  // Handle HTML operations (insert after other content)
  // Use document end position to ensure correct placement after previous insertions
  const htmlOperations = operations.filter((op) => op.type === 'html')
  for (const htmlOp of htmlOperations) {
    const htmlContent = (htmlOp.content as { html: string }).html
    if (htmlContent) {
      const docEndPos = editor.state.doc.content.size
      editor.chain().focus().insertContentAt(docEndPos, htmlContent).run()
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
