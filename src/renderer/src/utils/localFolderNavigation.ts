import {
  createLocalResourceId,
  normalizeLocalResourceRelativePath,
  parseLocalResourceId,
} from './localResourceId'
import type {
  LocalFolderNotebookMount,
  LocalFolderTreeNode,
  LocalNoteMetadata,
  Note,
  Notebook,
  NotebookFolder,
  NotebookFolderTreeNode,
  NotebookStatus,
  TagWithSource,
} from '../types/note'

export function normalizeLocalRelativePath(pathValue: string | null | undefined): string | null {
  if (typeof pathValue !== 'string') return null
  const normalized = normalizeLocalResourceRelativePath(pathValue)
  return normalized || null
}

export function getRelativePathDepth(relativePath: string | null): number {
  if (!relativePath) return 1
  return relativePath.split('/').filter(Boolean).length + 1
}

export function getRelativePathDisplayName(relativePath: string): string {
  const segments = relativePath.split('/').filter(Boolean)
  return segments[segments.length - 1] || relativePath
}

export function stripLocalFileExtension(fileName: string): string {
  if (fileName.toLowerCase().endsWith('.md')) {
    return fileName.slice(0, -3)
  }
  if (fileName.toLowerCase().endsWith('.txt')) {
    return fileName.slice(0, -4)
  }
  return fileName
}

function normalizeLocalFileBaseName(rawName: string): string {
  const sanitized = rawName
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  return sanitized
}

export function normalizeLocalPreferredFileName(rawName: string): string {
  const normalized = normalizeLocalFileBaseName(rawName)
  if (!normalized) return ''
  const lastDotIndex = normalized.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex >= normalized.length - 1) {
    return normalized
  }
  const extension = normalized.slice(lastDotIndex + 1).toLowerCase()
  if (extension === 'md' || extension === 'txt') {
    return normalized.slice(0, lastDotIndex)
  }
  return normalizeLocalFileBaseName(
    `${normalized.slice(0, lastDotIndex)} ${normalized.slice(lastDotIndex + 1)}`
  )
}

export function replaceRelativePathPrefix(pathValue: string, oldPrefix: string, newPrefix: string): string | null {
  if (pathValue === oldPrefix) return newPrefix
  const prefix = `${oldPrefix}/`
  if (!pathValue.startsWith(prefix)) return null
  return `${newPrefix}/${pathValue.slice(prefix.length)}`
}

export function findFolderNodeByPath(nodes: LocalFolderTreeNode[], relativePath: string): LocalFolderTreeNode | null {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    if (node.relative_path === relativePath) return node
    if (node.children?.length) {
      const found = findFolderNodeByPath(node.children, relativePath)
      if (found) return found
    }
  }
  return null
}

export function hasLocalFolderNodes(nodes: LocalFolderTreeNode[]): boolean {
  return nodes.some((node) => node.kind === 'folder')
}

export const MAX_INTERNAL_FOLDER_DEPTH = 3

export function normalizeInternalFolderPath(folderPath: string | null | undefined): string | null {
  const raw = (folderPath || '').trim()
  if (!raw) return null
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return null
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }
  return segments.join('/')
}

export function getInternalFolderDepth(folderPath: string | null): number {
  if (!folderPath) return 0
  return folderPath.split('/').filter(Boolean).length
}

export function isInternalPathInSubtree(pathValue: string | null, parentPath: string | null): boolean {
  if (!parentPath) return true
  if (!pathValue) return false
  return pathValue === parentPath || pathValue.startsWith(`${parentPath}/`)
}

export function replaceInternalFolderPrefix(pathValue: string, oldPrefix: string, newPrefix: string): string | null {
  if (pathValue === oldPrefix) return newPrefix
  const prefix = `${oldPrefix}/`
  if (!pathValue.startsWith(prefix)) return null
  return `${newPrefix}/${pathValue.slice(prefix.length)}`
}

export function getInternalFolderDisplayName(folderPath: string): string {
  const segments = folderPath.split('/').filter(Boolean)
  return segments[segments.length - 1] || folderPath
}

export function buildInternalFolderTree(
  folders: NotebookFolder[],
  notesInNotebook: Note[],
): NotebookFolderTreeNode[] {
  const folderPaths = new Set<string>()
  for (const folder of folders) {
    const normalizedPath = normalizeInternalFolderPath(folder.folder_path)
    if (!normalizedPath) continue
    if (getInternalFolderDepth(normalizedPath) <= MAX_INTERNAL_FOLDER_DEPTH) {
      folderPaths.add(normalizedPath)
    }
  }
  for (const note of notesInNotebook) {
    const normalizedPath = normalizeInternalFolderPath(note.folder_path)
    if (!normalizedPath) continue
    if (getInternalFolderDepth(normalizedPath) <= MAX_INTERNAL_FOLDER_DEPTH) {
      folderPaths.add(normalizedPath)
    }
  }

  const rootNodes: NotebookFolderTreeNode[] = []
  const nodeMap = new Map<string, NotebookFolderTreeNode>()
  const sortedPaths = Array.from(folderPaths).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))

  for (const folderPath of sortedPaths) {
    const segments = folderPath.split('/').filter(Boolean)
    if (segments.length === 0 || segments.length > MAX_INTERNAL_FOLDER_DEPTH) continue

    let currentPath = ''
    let parentNode: NotebookFolderTreeNode | null = null
    for (let index = 0; index < segments.length; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index]
      const currentDepth = index + 1
      if (currentDepth > MAX_INTERNAL_FOLDER_DEPTH) break

      let node = nodeMap.get(currentPath)
      if (!node) {
        node = {
          id: `internal-folder:${currentPath}`,
          name: segments[index],
          folder_path: currentPath,
          depth: currentDepth,
          children: [],
        }
        nodeMap.set(currentPath, node)
        if (parentNode) {
          parentNode.children = [...(parentNode.children || []), node]
          parentNode.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
        } else {
          rootNodes.push(node)
          rootNodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
        }
      }
      parentNode = node
    }
  }

  return rootNodes
}

export function hasInternalFolderPath(nodes: NotebookFolderTreeNode[], folderPath: string): boolean {
  for (const node of nodes) {
    if (node.folder_path === folderPath) return true
    if (node.children?.length && hasInternalFolderPath(node.children, folderPath)) {
      return true
    }
  }
  return false
}

export function findInternalFolderNodeByPath(
  nodes: NotebookFolderTreeNode[],
  folderPath: string
): NotebookFolderTreeNode | null {
  for (const node of nodes) {
    if (node.folder_path === folderPath) return node
    if (node.children?.length) {
      const found = findInternalFolderNodeByPath(node.children, folderPath)
      if (found) return found
    }
  }
  return null
}

export function mergeNotebooksWithLocalMounts(
  notebooks: Notebook[],
  localMounts: LocalFolderNotebookMount[],
): Notebook[] {
  const merged = new Map<string, Notebook>()

  for (const notebook of notebooks) {
    merged.set(notebook.id, notebook)
  }

  for (const mount of localMounts) {
    const localNotebook = mount.notebook
    if (!localNotebook?.id) continue

    const existing = merged.get(localNotebook.id)
    if (existing) {
      merged.set(localNotebook.id, {
        ...existing,
        source_type: 'local-folder',
      })
      continue
    }

    merged.set(localNotebook.id, {
      ...localNotebook,
      source_type: 'local-folder',
    })
  }

  return Array.from(merged.values()).sort((left, right) => (
    (left.order_index ?? 0) - (right.order_index ?? 0)
  ))
}

export function mergeLocalNotebookStatuses(
  previous: Record<string, NotebookStatus>,
  notebooks: Notebook[],
  localMounts: LocalFolderNotebookMount[],
): Record<string, NotebookStatus> {
  const next: Record<string, NotebookStatus> = {}

  for (const notebook of notebooks) {
    if (notebook.source_type !== 'local-folder') continue
    next[notebook.id] = previous[notebook.id] || 'active'
  }

  for (const mount of localMounts) {
    next[mount.notebook.id] = mount.mount.status
  }

  return next
}

export function mergeLocalMetadataTags(
  userTags: readonly string[] | null | undefined,
  aiTags: readonly string[] | null | undefined,
): TagWithSource[] {
  const merged = new Map<string, TagWithSource>()
  if (Array.isArray(aiTags)) {
    for (const name of aiTags) {
      if (!name) continue
      const key = name.toLowerCase()
      merged.set(key, {
        id: `local-tag:ai:${encodeURIComponent(key)}`,
        name,
        source: 'ai',
      })
    }
  }
  if (Array.isArray(userTags)) {
    for (const name of userTags) {
      if (!name) continue
      const key = name.toLowerCase()
      merged.set(key, {
        id: `local-tag:user:${encodeURIComponent(key)}`,
        name,
        source: 'user',
      })
    }
  }
  return Array.from(merged.values())
}

export function buildLocalNoteMetadataMap(items: LocalNoteMetadata[]): Record<string, LocalNoteMetadata> {
  const next: Record<string, LocalNoteMetadata> = {}
  for (const item of items) {
    if (
      !item.is_favorite
      && !item.is_pinned
      && !item.ai_summary
      && (!item.tags || item.tags.length === 0)
      && (!item.ai_tags || item.ai_tags.length === 0)
    ) {
      continue
    }
    const localId = createLocalResourceId(item.notebook_id, item.relative_path)
    next[localId] = item
  }
  return next
}

export function applyLocalNoteMetadataToNote(
  note: Note,
  metadataById: Record<string, LocalNoteMetadata>
): Note {
  const localRef = parseLocalResourceId(note.id)
  if (!localRef || !localRef.relativePath) return note
  const localId = createLocalResourceId(localRef.notebookId, localRef.relativePath)
  const metadata = metadataById[localId]
  if (!metadata) return note

  const hasUserTags = Array.isArray(metadata.tags) && metadata.tags.length > 0
  const hasAiTags = Array.isArray(metadata.ai_tags) && metadata.ai_tags.length > 0
  const metadataTags = hasUserTags || hasAiTags
    ? mergeLocalMetadataTags(metadata.tags, metadata.ai_tags)
    : note.tags

  return {
    ...note,
    is_favorite: metadata.is_favorite,
    is_pinned: metadata.is_pinned,
    ai_summary: metadata.ai_summary ?? note.ai_summary,
    tags: metadataTags,
  }
}
