import { markdownToTiptapString } from '../../markdown'

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

interface TiptapDoc {
  type: 'doc'
  content: TiptapNode[]
}

function parseTiptapDoc(json: string, source: 'prefix' | 'body'): TiptapDoc {
  try {
    const parsed = JSON.parse(json) as Partial<TiptapDoc>
    if (parsed.type !== 'doc' || !Array.isArray(parsed.content)) {
      throw new Error(`Invalid TipTap ${source} content shape`)
    }
    return {
      type: 'doc',
      content: parsed.content as TiptapNode[],
    }
  } catch {
    throw new Error(`Invalid TipTap ${source} JSON`)
  }
}

/**
 * Prepend markdown content to an existing TipTap JSON document.
 * Used for adding arXiv metadata header before parsed PDF/HTML body content.
 */
export function prependMarkdownToTiptapContent(
  markdownPrefix: string,
  tiptapContentJson: string
): string {
  const prefixDoc = parseTiptapDoc(markdownToTiptapString(markdownPrefix), 'prefix')
  const bodyDoc = parseTiptapDoc(tiptapContentJson, 'body')

  const mergedContent: TiptapNode[] = [...prefixDoc.content]
  if (prefixDoc.content.length > 0 && bodyDoc.content.length > 0) {
    mergedContent.push({ type: 'paragraph', content: [] })
  }
  mergedContent.push(...bodyDoc.content)

  return JSON.stringify({
    type: 'doc',
    content: mergedContent,
  } satisfies TiptapDoc)
}
