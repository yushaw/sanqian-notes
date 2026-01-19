/**
 * TipTap Document Merge
 *
 * Provides intelligent merging of TipTap documents while preserving
 * node identities (blockId) for unchanged content.
 *
 * Core algorithm: Diff + Merge
 * 1. Compare old and new documents, ignoring blockId
 * 2. Identify unchanged nodes using head-tail matching + content matching
 * 3. Preserve blockId from old nodes for unchanged content
 * 4. Use new nodes for changed/added content
 */

// TipTap node types (consistent with markdown-to-tiptap.ts)
interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

interface TiptapDoc {
  type: 'doc'
  content: TiptapNode[]
}

/**
 * Attributes to ignore when comparing nodes
 * These are metadata that don't affect the actual content
 */
const IGNORED_ATTRIBUTES = ['blockId']

/**
 * Compare two attribute objects, ignoring specified attributes
 */
function attrsEqual(
  attrs1?: Record<string, unknown>,
  attrs2?: Record<string, unknown>,
  ignoreAttrs: string[] = IGNORED_ATTRIBUTES
): boolean {
  // Both undefined or null
  if (!attrs1 && !attrs2) return true

  // Create copies without ignored attributes
  const a1 = attrs1 ? { ...attrs1 } : {}
  const a2 = attrs2 ? { ...attrs2 } : {}

  for (const attr of ignoreAttrs) {
    delete a1[attr]
    delete a2[attr]
  }

  // Compare remaining attributes
  const keys1 = Object.keys(a1)
  const keys2 = Object.keys(a2)

  if (keys1.length !== keys2.length) return false

  for (const key of keys1) {
    if (JSON.stringify(a1[key]) !== JSON.stringify(a2[key])) {
      return false
    }
  }

  return true
}

/**
 * Compare two mark arrays
 */
function marksEqual(
  marks1?: TiptapMark[],
  marks2?: TiptapMark[]
): boolean {
  if (!marks1 && !marks2) return true
  if (!marks1 || !marks2) return false
  if (marks1.length !== marks2.length) return false

  // Sort marks by type for consistent comparison
  const sorted1 = [...marks1].sort((a, b) => a.type.localeCompare(b.type))
  const sorted2 = [...marks2].sort((a, b) => a.type.localeCompare(b.type))

  for (let i = 0; i < sorted1.length; i++) {
    if (sorted1[i].type !== sorted2[i].type) return false
    if (!attrsEqual(sorted1[i].attrs, sorted2[i].attrs, [])) return false
  }

  return true
}

/**
 * Compare two nodes for content equality, ignoring blockId
 *
 * This is the core comparison function that determines if two nodes
 * represent the same content (and thus the old node's blockId should be preserved)
 */
export function nodesContentEqual(node1: TiptapNode, node2: TiptapNode): boolean {
  // Type must match
  if (node1.type !== node2.type) return false

  // Text content must match
  if (node1.text !== node2.text) return false

  // Marks must match
  if (!marksEqual(node1.marks, node2.marks)) return false

  // Attributes must match (ignoring blockId)
  if (!attrsEqual(node1.attrs, node2.attrs)) return false

  // Recursively compare content
  const content1 = node1.content || []
  const content2 = node2.content || []

  if (content1.length !== content2.length) return false

  for (let i = 0; i < content1.length; i++) {
    if (!nodesContentEqual(content1[i], content2[i])) {
      return false
    }
  }

  return true
}

/**
 * Merge a single node, preserving blockId from old node
 */
function mergeNode(oldNode: TiptapNode, newNode: TiptapNode): TiptapNode {
  const merged: TiptapNode = {
    type: newNode.type
  }

  // Preserve blockId from old node, use other attrs from new node
  // Only add attrs if newNode has attrs (avoid creating attrs on nodes that shouldn't have them)
  if (newNode.attrs) {
    merged.attrs = { ...newNode.attrs }
    // Preserve blockId from old node if it exists
    if (oldNode.attrs?.blockId) {
      merged.attrs.blockId = oldNode.attrs.blockId
    }
  }

  // Copy text if present
  if (newNode.text !== undefined) {
    merged.text = newNode.text
  }

  // Copy marks if present
  if (newNode.marks) {
    merged.marks = newNode.marks
  }

  // Recursively merge content
  if (oldNode.content && newNode.content) {
    merged.content = mergeNodeArrays(oldNode.content, newNode.content)
  } else if (newNode.content) {
    merged.content = newNode.content
  }

  return merged
}

/**
 * Compute a content hash for a node (for quick comparison in middle region)
 * Ignores blockId in the hash
 */
function computeNodeHash(node: TiptapNode): string {
  const normalized: Record<string, unknown> = {
    type: node.type
  }

  if (node.text !== undefined) {
    normalized.text = node.text
  }

  if (node.marks) {
    // Sort marks by type for consistent hashing (same as marksEqual)
    normalized.marks = [...node.marks].sort((a, b) => a.type.localeCompare(b.type))
  }

  if (node.attrs) {
    const attrsWithoutBlockId = { ...node.attrs }
    delete attrsWithoutBlockId.blockId
    if (Object.keys(attrsWithoutBlockId).length > 0) {
      normalized.attrs = attrsWithoutBlockId
    }
  }

  if (node.content) {
    normalized.content = node.content.map(computeNodeHash)
  }

  return JSON.stringify(normalized)
}

/**
 * Merge two node arrays using head-tail matching + content matching
 *
 * Algorithm:
 * 1. Find matching nodes from the head (nodes that haven't changed at the beginning)
 * 2. Find matching nodes from the tail (nodes that haven't changed at the end)
 * 3. For the middle region, use content-based matching to find moved nodes
 * 4. Preserve blockId for all matched nodes
 */
export function mergeNodeArrays(
  oldNodes: TiptapNode[],
  newNodes: TiptapNode[]
): TiptapNode[] {
  // Edge cases
  if (oldNodes.length === 0) return newNodes.map(n => deepClone(n))
  if (newNodes.length === 0) return []

  // Step 1: Find head matches (from start)
  let headMatch = 0
  while (headMatch < oldNodes.length && headMatch < newNodes.length) {
    if (nodesContentEqual(oldNodes[headMatch], newNodes[headMatch])) {
      headMatch++
    } else {
      break
    }
  }

  // Step 2: Find tail matches (from end)
  let tailMatch = 0
  const maxTailMatch = Math.min(
    oldNodes.length - headMatch,
    newNodes.length - headMatch
  )
  while (tailMatch < maxTailMatch) {
    const oldIdx = oldNodes.length - 1 - tailMatch
    const newIdx = newNodes.length - 1 - tailMatch
    if (nodesContentEqual(oldNodes[oldIdx], newNodes[newIdx])) {
      tailMatch++
    } else {
      break
    }
  }

  // Step 3: Build result
  const result: TiptapNode[] = []

  // Head matched nodes: preserve blockId
  for (let i = 0; i < headMatch; i++) {
    result.push(mergeNode(oldNodes[i], newNodes[i]))
  }

  // Middle region: use content-based matching
  const oldMiddleStart = headMatch
  const oldMiddleEnd = oldNodes.length - tailMatch
  const newMiddleStart = headMatch
  const newMiddleEnd = newNodes.length - tailMatch

  const oldMiddle = oldNodes.slice(oldMiddleStart, oldMiddleEnd)
  const newMiddle = newNodes.slice(newMiddleStart, newMiddleEnd)

  if (newMiddle.length > 0) {
    // Build hash map for old middle nodes
    const oldHashMap = new Map<string, { node: TiptapNode; used: boolean }[]>()
    for (const node of oldMiddle) {
      const hash = computeNodeHash(node)
      if (!oldHashMap.has(hash)) {
        oldHashMap.set(hash, [])
      }
      oldHashMap.get(hash)!.push({ node, used: false })
    }

    // Match new middle nodes with old ones
    for (const newNode of newMiddle) {
      const hash = computeNodeHash(newNode)
      const candidates = oldHashMap.get(hash)

      if (candidates) {
        // Find first unused candidate
        const match = candidates.find(c => !c.used)
        if (match) {
          match.used = true
          result.push(mergeNode(match.node, newNode))
          continue
        }
      }

      // No match found: this is a new node
      result.push(deepClone(newNode))
    }
  }

  // Tail matched nodes: preserve blockId
  for (let i = 0; i < tailMatch; i++) {
    const oldIdx = oldNodes.length - tailMatch + i
    const newIdx = newNodes.length - tailMatch + i
    result.push(mergeNode(oldNodes[oldIdx], newNodes[newIdx]))
  }

  return result
}

/**
 * Deep clone a TipTap node
 */
function deepClone(node: TiptapNode): TiptapNode {
  const cloned: TiptapNode = { type: node.type }

  if (node.attrs) {
    cloned.attrs = { ...node.attrs }
  }

  if (node.text !== undefined) {
    cloned.text = node.text
  }

  if (node.marks) {
    cloned.marks = node.marks.map(m => ({
      type: m.type,
      ...(m.attrs ? { attrs: { ...m.attrs } } : {})
    }))
  }

  if (node.content) {
    cloned.content = node.content.map(deepClone)
  }

  return cloned
}

/**
 * Merge two TipTap documents, preserving blockId for unchanged nodes
 *
 * @param oldDoc - Original document (with blockId)
 * @param newDoc - New document (without blockId or with new blockId)
 * @returns Merged document with preserved blockId for unchanged nodes
 */
export function mergePreservingBlockIds(
  oldDoc: TiptapDoc,
  newDoc: TiptapDoc
): TiptapDoc {
  return {
    type: 'doc',
    content: mergeNodeArrays(oldDoc.content || [], newDoc.content || [])
  }
}

/**
 * Merge TipTap documents from JSON strings
 *
 * @param oldDocJson - Original document JSON string
 * @param newDocJson - New document JSON string
 * @returns Merged document JSON string
 */
export function mergeDocumentsJson(
  oldDocJson: string,
  newDocJson: string
): string {
  try {
    const oldDoc = JSON.parse(oldDocJson) as TiptapDoc
    const newDoc = JSON.parse(newDocJson) as TiptapDoc

    // Validate doc type
    if (oldDoc.type !== 'doc' || newDoc.type !== 'doc') {
      // If not valid TipTap doc, return new as-is
      return newDocJson
    }

    const merged = mergePreservingBlockIds(oldDoc, newDoc)
    return JSON.stringify(merged)
  } catch {
    // If parsing fails, return new as-is
    return newDocJson
  }
}
