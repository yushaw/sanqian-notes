/**
 * AI Context Utilities
 *
 * Extracts target content and surrounding context from the editor
 * for AI operations.
 */

import type { Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode, Mark } from '@tiptap/pm/model'

const CONTEXT_LENGTH = 200 // Characters before and after

/**
 * Convert Tiptap marks to Markdown wrapper
 * Returns [prefix, suffix] for wrapping text
 *
 * Supported marks:
 * - bold → **text**
 * - italic → *text*
 * - strike → ~~text~~
 * - code → `text`
 * - highlight → ==text==
 * - underline → ++text++
 * - link → [text](url)
 * - noteLink → [[text|noteId]] (preserves noteId for restoration)
 */
function marksToMarkdown(marks: readonly Mark[]): [string, string] {
  let prefix = ''
  let suffix = ''

  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
        prefix = '**' + prefix
        suffix = suffix + '**'
        break
      case 'italic':
        prefix = '*' + prefix
        suffix = suffix + '*'
        break
      case 'strike':
        prefix = '~~' + prefix
        suffix = suffix + '~~'
        break
      case 'code':
        prefix = '`' + prefix
        suffix = suffix + '`'
        break
      case 'highlight':
        prefix = '==' + prefix
        suffix = suffix + '=='
        break
      case 'underline':
        prefix = '++' + prefix
        suffix = suffix + '++'
        break
      case 'link': {
        // Standard markdown link: [text](url)
        const href = mark.attrs.href || ''
        prefix = '[' + prefix
        suffix = suffix + `](${href})`
        break
      }
      case 'noteLink': {
        // Internal note link: [[text|noteId:targetType:targetValue]]
        // This format preserves all link metadata for restoration
        const noteId = mark.attrs.noteId || ''
        const targetType = mark.attrs.targetType || 'note'
        const targetValue = mark.attrs.targetValue || ''
        const linkMeta = targetValue
          ? `${noteId}:${targetType}:${targetValue}`
          : noteId
        prefix = '[[' + prefix
        suffix = suffix + `|${linkMeta}]]`
        break
      }
    }
  }

  return [prefix, suffix]
}

/**
 * Convert a range of Tiptap content to Markdown
 * Preserves marks, math formulas, and other special nodes
 */
export function getMarkdownContent(editor: Editor, from: number, to: number): string {
  const parts: string[] = []

  editor.state.doc.nodesBetween(from, to, (node: ProseMirrorNode, pos: number) => {
    // Handle text nodes
    if (node.isText && node.text) {
      // Calculate the actual text range within this node
      const nodeStart = pos
      const nodeEnd = pos + node.nodeSize

      // Clip to selection range
      const textStart = Math.max(from, nodeStart) - nodeStart
      const textEnd = Math.min(to, nodeEnd) - nodeStart

      const text = node.text.slice(textStart, textEnd)
      if (text) {
        const [prefix, suffix] = marksToMarkdown(node.marks)
        parts.push(prefix + text + suffix)
      }
    }
    // Handle inline math nodes
    else if (node.type.name === 'inlineMath') {
      const latex = node.attrs.latex || ''
      const isBlock = node.attrs.display === 'yes'
      if (latex) {
        parts.push(isBlock ? `$$${latex}$$` : `$${latex}$`)
      }
    }
    // Handle block math nodes (legacy)
    else if (node.type.name === 'mathematics') {
      const latex = node.attrs.latex || ''
      if (latex) {
        parts.push(`$$${latex}$$`)
      }
    }
    // Handle footnotes
    else if (node.type.name === 'footnote') {
      const id = node.attrs.id || '?'
      parts.push(`[^${id}]`)
    }
    // Handle mermaid diagrams
    else if (node.type.name === 'mermaid') {
      const code = node.attrs.code || ''
      if (code) {
        parts.push(`\n\`\`\`mermaid\n${code}\n\`\`\`\n`)
      }
    }
    // Handle file attachments
    else if (node.type.name === 'fileAttachment') {
      const name = node.attrs.name || 'attachment'
      parts.push(`[📎 ${name}]`)
    }
    // Handle images - use markdown format for external URLs, placeholder for base64
    else if (node.type.name === 'image') {
      const alt = node.attrs.alt || ''
      const src = node.attrs.src || ''
      if (src.startsWith('data:')) {
        // Base64 image - just use placeholder (too long)
        parts.push(`[图片${alt ? `: ${alt}` : ''}]`)
      } else {
        // External URL or local path - use markdown format
        parts.push(`![${alt}](${src})`)
      }
    }
    // Handle HTML comments
    else if (node.type.name === 'htmlComment') {
      const content = node.attrs.content || ''
      parts.push(`<!-- ${content} -->`)
    }
    // Handle code blocks
    else if (node.type.name === 'codeBlock') {
      const language = node.attrs.language || ''
      const code = node.textContent || ''
      parts.push(`\n\`\`\`${language}\n${code}\n\`\`\`\n`)
    }
    // Handle embed blocks - show URL for external, filename for local
    else if (node.type.name === 'embedBlock') {
      const url = node.attrs.url || ''
      const localFile = node.attrs.localFile || ''
      if (url) {
        parts.push(`[嵌入: ${url}]`)
      } else if (localFile) {
        const filename = localFile.split('/').pop() || 'embed'
        parts.push(`[嵌入: ${filename}]`)
      }
    }
    // Handle audio - show URL or filename
    else if (node.type.name === 'audio') {
      const title = node.attrs.title || ''
      const src = node.attrs.src || ''
      if (src && !src.startsWith('data:')) {
        parts.push(`[🔊 ${title || src}]`)
      } else {
        parts.push(`[🔊 ${title || '音频'}]`)
      }
    }
    // Handle video - show URL or filename
    else if (node.type.name === 'video') {
      const src = node.attrs.src || ''
      if (src && !src.startsWith('data:')) {
        parts.push(`[🎬 ${src}]`)
      } else {
        parts.push(`[🎬 视频]`)
      }
    }
    // Handle transclusion blocks
    else if (node.type.name === 'transclusionBlock') {
      const noteId = node.attrs.noteId || ''
      const heading = node.attrs.headingPattern || ''
      if (noteId) {
        parts.push(heading ? `![[${noteId}#${heading}]]` : `![[${noteId}]]`)
      }
    }
    // Handle dataview blocks
    else if (node.type.name === 'dataviewBlock') {
      const query = node.attrs.query || ''
      if (query) {
        parts.push(`\n\`\`\`dataview\n${query}\n\`\`\`\n`)
      }
    }
    // Skip AI popup marks - not relevant for context
    else if (node.type.name === 'aiPopupMark') {
      // Skip
    }
    return true
  })

  return parts.join('')
}

/**
 * Information about a block node within the selection
 */
export interface BlockInfo {
  blockId: string          // Unique block ID for finding node after position changes
  nodeType: string         // e.g., 'paragraph', 'listItem', 'heading'
  from: number             // Position before the block node
  to: number               // Position after the block node
  textFrom: number         // Text content start position
  textTo: number           // Text content end position
  text: string             // Text content of this block (plain text)
  markdown: string         // Text content with Markdown formatting
}

export interface AIContext {
  target: string           // The content to be processed (plain text)
  targetMarkdown: string   // The content with Markdown formatting
  targetFrom: number       // Start position of target in document (text range)
  targetTo: number         // End position of target in document (text range)
  // Block node boundaries (for node-level operations when no selection)
  blockFrom?: number       // Position before block node
  blockTo?: number         // Position after block node
  before: string           // Context before target (~200 chars)
  after: string            // Context after target (~200 chars)
  documentTitle?: string   // Document title if available
  hasSelection: boolean    // Whether user has selected text
  // Cross-block selection info
  isCrossBlock: boolean    // Whether selection spans multiple blocks
  blocks: BlockInfo[]      // All blocks within the selection (for cross-block replacement)
}

/**
 * Get the current block's content and position
 */
function getCurrentBlock(editor: Editor): {
  text: string
  from: number      // Text content start
  to: number        // Text content end
  blockFrom: number // Node boundary start (for deleting whole node)
  blockTo: number   // Node boundary end
} | null {
  const { selection } = editor.state
  const { $from } = selection

  // Find the parent block node
  const blockNode = $from.parent

  if (!blockNode || !blockNode.isBlock) {
    return null
  }

  // Get the start and end positions of the text content
  const textStart = $from.start()
  const textEnd = $from.end()

  // Get the node boundaries (for deleting entire block)
  const blockFrom = $from.before()
  const blockTo = $from.after()

  // Get the text content of the block
  const text = editor.state.doc.textBetween(textStart, textEnd, '\n')

  return { text, from: textStart, to: textEnd, blockFrom, blockTo }
}

/**
 * Generate a simple 6-char block ID
 */
function generateBlockId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Get all blocks within a selection range
 * Returns array of BlockInfo with FULL block content (not just selected portion)
 * This simplifies cross-block replacement: we replace entire blocks
 *
 * Also ensures each block has a blockId (generates one if missing)
 */
function getBlocksInSelection(editor: Editor, from: number, to: number): BlockInfo[] {
  const blocks: BlockInfo[] = []
  const { doc, tr } = editor.state
  let needsDispatch = false

  // Traverse the document to find all blocks that overlap with the selection
  doc.nodesBetween(from, to, (node, pos) => {
    // We're interested in block-level nodes that contain text
    if (node.isBlock && node.isTextblock) {
      const textFrom = pos + 1  // Skip the opening of the node
      const textTo = pos + node.nodeSize - 1  // Before the closing

      // Check if this block overlaps with selection
      const overlaps = !(textTo <= from || textFrom >= to)

      if (overlaps) {
        // Ensure block has an ID
        let blockId = node.attrs.blockId
        if (!blockId) {
          blockId = generateBlockId()
          // Set the blockId attribute
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId })
          needsDispatch = true
        }

        // Return FULL block content, not just selected portion
        const text = doc.textBetween(textFrom, textTo, '\n')
        const markdown = getMarkdownContent(editor, textFrom, textTo)
        blocks.push({
          blockId,
          nodeType: node.type.name,
          from: pos,
          to: pos + node.nodeSize,
          textFrom,  // Full block text start
          textTo,    // Full block text end
          text,      // Full block text (plain)
          markdown   // Full block text with Markdown formatting
        })
      }
    }
    // Continue traversing (return true to go into children)
    return true
  })

  // Apply blockId changes if any
  if (needsDispatch) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }

  return blocks
}

/**
 * Get surrounding context (before and after the target)
 */
function getSurroundingContext(
  editor: Editor,
  targetFrom: number,
  targetTo: number
): { before: string; after: string } {
  const docSize = editor.state.doc.content.size

  // Get text before target
  const beforeStart = Math.max(0, targetFrom - CONTEXT_LENGTH)
  const before = editor.state.doc.textBetween(beforeStart, targetFrom, '\n').trim()

  // Get text after target
  const afterEnd = Math.min(docSize, targetTo + CONTEXT_LENGTH)
  const after = editor.state.doc.textBetween(targetTo, afterEnd, '\n').trim()

  return { before, after }
}

/**
 * Get AI context from the editor
 *
 * - If user has selected text, use selection as target
 * - If no selection, use current block as target
 * - Always include surrounding context (~200 chars before and after)
 */
export function getAIContext(editor: Editor, documentTitle?: string): AIContext | null {
  const { selection } = editor.state
  const { from, to } = selection

  const hasSelection = from !== to

  let target: string
  let targetMarkdown: string
  let targetFrom: number
  let targetTo: number
  let blockFrom: number | undefined
  let blockTo: number | undefined

  let blocks: BlockInfo[] = []
  let isCrossBlock = false

  if (hasSelection) {
    // User has selected text - check if it spans multiple blocks
    blocks = getBlocksInSelection(editor, from, to)
    isCrossBlock = blocks.length > 1

    if (isCrossBlock) {
      // Cross-block: use full content of all involved blocks
      target = blocks.map(b => b.text).join('\n')
      targetMarkdown = blocks.map(b => b.markdown).join('\n')
      targetFrom = blocks[0].textFrom
      targetTo = blocks[blocks.length - 1].textTo
    } else {
      // Single block selection: use exact selection
      target = editor.state.doc.textBetween(from, to, '\n')
      targetMarkdown = getMarkdownContent(editor, from, to)
      targetFrom = from
      targetTo = to
    }
  } else {
    // No selection, use current block
    const block = getCurrentBlock(editor)
    if (!block || !block.text.trim()) {
      return null
    }
    target = block.text
    targetMarkdown = getMarkdownContent(editor, block.from, block.to)
    targetFrom = block.from
    targetTo = block.to
    blockFrom = block.blockFrom
    blockTo = block.blockTo
  }

  if (!target.trim()) {
    return null
  }

  const { before, after } = getSurroundingContext(editor, targetFrom, targetTo)

  return {
    target,
    targetMarkdown,
    targetFrom,
    targetTo,
    blockFrom,
    blockTo,
    before,
    after,
    documentTitle,
    hasSelection,
    isCrossBlock,
    blocks
  }
}

/**
 * Result of formatting AI prompt for cross-block operations
 */
export interface FormattedPrompt {
  prompt: string
  // Mapping from simple ID ("1", "2") to actual blockId for cross-block mode
  blockMapping?: Record<string, string>
}

/**
 * Format AI context for LLM prompt
 *
 * Best practices applied:
 * 1. XML tags for structure (widely recommended by OpenAI/Anthropic)
 * 2. Explicit constraints at both start and end (primacy + recency effects)
 * 3. Clear separation between context (read-only) and target (to process)
 * 4. Specific negative constraints listing what NOT to output
 *
 * For cross-block operations, uses <block id="N"> format and returns a mapping.
 */
export function formatAIPrompt(context: AIContext, instruction: string): FormattedPrompt {
  const parts: string[] = []
  let blockMapping: Record<string, string> | undefined

  // Check if this is a cross-block operation
  const isCrossBlock = context.isCrossBlock && context.blocks.length > 1

  if (isCrossBlock) {
    // Build mapping: simple ID -> actual blockId
    blockMapping = {}
    context.blocks.forEach((block, index) => {
      const simpleId = String(index + 1)
      blockMapping![simpleId] = block.blockId
    })

    // 1. 任务指令 + 核心约束（开头强调）
    parts.push(`<task>
${instruction}
</task>

<rules>
- 处理每个 <block> 中的内容
- 保持 <block id="N">...</block> 格式输出
- 保持所有格式标记不变：
  - **加粗**、*斜体*、~~删除线~~、\`代码\`
  - ==高亮==、++下划线++
  - [链接文字](URL)
  - [[文档链接|noteId]] - 保持整个结构不变
- 直接输出结果，禁止任何额外内容
- 禁止输出：解释、说明、前言、总结
</rules>`)

    // 2. 上下文（仅供参考，不处理）
    if (context.before || context.after) {
      let contextContent = ''
      if (context.before) {
        contextContent += `<preceding_text>${context.before}</preceding_text>\n`
      }
      if (context.after) {
        contextContent += `<following_text>${context.after}</following_text>`
      }
      parts.push(`<surrounding_context description="仅供理解语境">
${contextContent.trim()}
</surrounding_context>`)
    }

    // 3. 待处理内容 - 使用 block 格式 + Markdown
    const blocksContent = context.blocks
      .map((block, index) => `<block id="${index + 1}">${block.markdown}</block>`)
      .join('\n')
    parts.push(`<target description="处理每个 block，保持 Markdown 格式">
${blocksContent}
</target>`)

    // 4. 再次强调输出格式
    parts.push(`按相同格式输出处理后的内容:`)

  } else {
    // Single block mode - original format
    parts.push(`<task>
${instruction}
</task>

<rules>
- 只处理 <target> 中的内容
- 保持所有格式标记不变：
  - **加粗**、*斜体*、~~删除线~~、\`代码\`
  - ==高亮==、++下划线++
  - [链接文字](URL)
  - [[文档链接|noteId]] - 保持整个结构不变
- 直接输出结果，禁止任何额外内容
- 禁止输出：解释、说明、前言、总结、标签、代码块标记
</rules>`)

    if (context.before || context.after) {
      let contextContent = ''
      if (context.before) {
        contextContent += `<preceding_text>${context.before}</preceding_text>\n`
      }
      if (context.after) {
        contextContent += `<following_text>${context.after}</following_text>`
      }
      parts.push(`<surrounding_context description="target 前后的文字，仅供理解语境，不要处理或输出">
${contextContent.trim()}
</surrounding_context>`)
    }

    parts.push(`<target description="只处理这部分内容，保持 Markdown 格式">
${context.targetMarkdown}
</target>`)

    parts.push(`直接输出处理后的 <target> 内容:`)
  }

  return {
    prompt: parts.join('\n\n'),
    blockMapping
  }
}
