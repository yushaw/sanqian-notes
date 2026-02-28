import type { TagWithSource } from '../shared/types'

interface TiptapLikeNode {
  type?: string
  text?: string
  marks?: Array<{ type?: string }>
  content?: TiptapLikeNode[]
}

const HASH_TAG_RE = /(^|[^\p{L}\p{N}_/])#([\p{L}\p{N}_\-/]{1,64})/gu
const TAG_TEXT_EXCLUDED_NODE_TYPES = new Set([
  'frontmatter',
  'codeBlock',
  'inlineMath',
  'mathematics',
  'mermaid',
  'htmlComment',
])

function normalizeTagName(input: string): string {
  const trimmed = input.trim().replace(/^#+/, '').replace(/[.,!?;:]+$/g, '')
  if (!trimmed) return ''
  return trimmed.slice(0, 64)
}

function normalizeAndDedupeTagNames(tags: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(tags) || tags.length === 0) return []
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const normalized = normalizeTagName(raw)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }

  return deduped
}

export function normalizeLocalTagNames(tags: readonly string[] | null | undefined): string[] {
  return normalizeAndDedupeTagNames(tags)
}

function parseInlineYamlList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return []
  }
  const inner = trimmed.slice(1, -1)
  if (!inner.trim()) return []
  return inner
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function parseYamlTagValue(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseInlineYamlList(trimmed)
  }
  return [trimmed.replace(/^['"]|['"]$/g, '')]
}

function extractTagsFromFrontmatter(yamlText: string): string[] {
  if (!yamlText.trim()) return []

  const lines = yamlText.replace(/\r\n?/g, '\n').split('\n')
  const result: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^(\s*)(tags?|Tags?)\s*:\s*(.*)$/)
    if (!match) continue

    const baseIndent = match[1].length
    const value = match[3] || ''
    if (value.trim()) {
      result.push(...parseYamlTagValue(value))
      continue
    }

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = lines[cursor]
      if (!nextLine.trim()) continue
      const indent = nextLine.match(/^\s*/)?.[0].length || 0
      if (indent <= baseIndent) {
        index = cursor - 1
        break
      }

      const itemMatch = nextLine.match(/^\s*-\s*(.+)$/)
      if (itemMatch) {
        result.push(...parseYamlTagValue(itemMatch[1]))
      }

      if (cursor === lines.length - 1) {
        index = cursor
      }
    }
  }

  return normalizeAndDedupeTagNames(result)
}

function extractTextNodes(
  nodes: TiptapLikeNode[] | undefined,
  collector: string[],
  excludedContext = false
): void {
  if (!Array.isArray(nodes) || nodes.length === 0) return

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    const nodeType = typeof node.type === 'string' ? node.type : ''
    const nextExcludedContext = excludedContext || TAG_TEXT_EXCLUDED_NODE_TYPES.has(nodeType)

    const hasCodeMark = Array.isArray(node.marks)
      && node.marks.some((mark) => mark?.type === 'code')

    if (
      !nextExcludedContext
      && !hasCodeMark
      && node.type === 'text'
      && typeof node.text === 'string'
      && node.text
    ) {
      collector.push(node.text)
    }
    if (Array.isArray(node.content) && node.content.length > 0) {
      extractTextNodes(node.content, collector, nextExcludedContext)
    }
  }
}

function extractHashtagsFromText(text: string): string[] {
  const tags: string[] = []
  HASH_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = HASH_TAG_RE.exec(text)) !== null) {
    const tag = normalizeTagName(match[2])
    if (tag) {
      tags.push(tag)
    }
  }

  return tags
}

export function extractLocalTagNamesFromTiptapContent(tiptapContent: string): string[] {
  if (!tiptapContent || typeof tiptapContent !== 'string') {
    return []
  }

  let doc: { content?: TiptapLikeNode[] } | null = null
  try {
    doc = JSON.parse(tiptapContent) as { content?: TiptapLikeNode[] }
  } catch {
    return []
  }

  const rootContent = Array.isArray(doc?.content) ? doc.content : []
  const tags: string[] = []

  const frontmatterNode = rootContent.find((node) => node?.type === 'frontmatter')
  if (frontmatterNode?.content) {
    const frontmatterText = frontmatterNode.content
      .map((child) => (child?.type === 'text' && typeof child.text === 'string') ? child.text : '')
      .join('')
    if (frontmatterText) {
      tags.push(...extractTagsFromFrontmatter(frontmatterText))
    }
  }

  const textSegments: string[] = []
  extractTextNodes(rootContent, textSegments)
  for (const segment of textSegments) {
    tags.push(...extractHashtagsFromText(segment))
  }

  return normalizeAndDedupeTagNames(tags)
}

function mapLocalTagNamesToTagWithSourceBySource(
  tagNames: readonly string[] | null | undefined,
  source: TagWithSource['source']
): TagWithSource[] {
  return normalizeAndDedupeTagNames(tagNames).map((name) => ({
    id: `local-tag:${source}:${encodeURIComponent(name.toLowerCase())}`,
    name,
    source,
  }))
}

export function mapLocalTagNamesToTagWithSource(
  tagNames: readonly string[] | null | undefined,
  source: TagWithSource['source'] = 'user'
): TagWithSource[] {
  return mapLocalTagNamesToTagWithSourceBySource(tagNames, source)
}

export function mergeLocalUserAndAITagNames(
  userTagNames: readonly string[] | null | undefined,
  aiTagNames: readonly string[] | null | undefined
): TagWithSource[] {
  const mergedByName = new Map<string, TagWithSource>()
  for (const tag of mapLocalTagNamesToTagWithSourceBySource(aiTagNames, 'ai')) {
    mergedByName.set(tag.name.toLowerCase(), tag)
  }
  // Keep native behavior parity: user tags keep precedence when same-name tags exist.
  for (const tag of mapLocalTagNamesToTagWithSourceBySource(userTagNames, 'user')) {
    mergedByName.set(tag.name.toLowerCase(), tag)
  }
  return Array.from(mergedByName.values())
}

export function areLocalTagNameListsEqual(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null | undefined
): boolean {
  const normalizedLeft = normalizeAndDedupeTagNames(left)
    .map((item) => item.toLowerCase())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  const normalizedRight = normalizeAndDedupeTagNames(right)
    .map((item) => item.toLowerCase())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  if (normalizedLeft.length !== normalizedRight.length) return false

  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== normalizedRight[index]) {
      return false
    }
  }

  return true
}
