interface TiptapNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

function normalizePopupId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > 512) return null
  return normalized
}

function collectPopupIds(nodes: TiptapNode[] | undefined, collector: Set<string>): void {
  if (!Array.isArray(nodes) || nodes.length === 0) return

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue

    if (node.type === 'aiPopupMark') {
      const popupId = normalizePopupId(node.attrs?.popupId)
      if (popupId) {
        collector.add(popupId)
      }
    }

    if (Array.isArray(node.content) && node.content.length > 0) {
      collectPopupIds(node.content, collector)
    }
  }
}

export function extractAIPopupIdsFromTiptapContent(content: string | null | undefined): string[] {
  if (!content || typeof content !== 'string') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }

  let rootNodes: TiptapNode[] = []
  if (Array.isArray(parsed)) {
    rootNodes = parsed as TiptapNode[]
  } else if (parsed && typeof parsed === 'object') {
    const doc = parsed as { type?: string; content?: TiptapNode[] }
    if (doc.type === 'doc' && Array.isArray(doc.content)) {
      rootNodes = doc.content
    } else if (Array.isArray(doc.content)) {
      rootNodes = doc.content
    }
  }

  if (rootNodes.length === 0) return []

  const popupIds = new Set<string>()
  collectPopupIds(rootNodes, popupIds)
  return Array.from(popupIds)
}
