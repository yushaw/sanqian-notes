import { normalize } from 'path'
import { getNotebooks } from './database'
import { normalizeRelativeSlashPath, toSlashPath } from './path-compat'

export const INTERNAL_FOLDER_MAX_DEPTH = 3

export function normalizeInternalFolderPath(pathValue: string | null | undefined): string | null {
  const trimmed = (pathValue || '').trim()
  if (!trimmed) return null
  const normalized = toSlashPath(normalize(trimmed)).replace(/^\/+|\/+$/g, '')
  if (!normalized) return null
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }
  return segments.join('/')
}

export function normalizeLocalRelativePathForEtag(pathValue: string): string {
  return normalizeRelativeSlashPath(pathValue)
}

export function getInternalFolderDepth(folderPath: string | null): number {
  if (!folderPath) return 0
  return folderPath.split('/').filter(Boolean).length
}

export function isValidInternalFolderName(name: string): boolean {
  if (!name) return false
  if (name === '.' || name === '..') return false
  if (name.startsWith('.')) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.includes('\0')) return false
  return true
}

export function composeInternalFolderPath(parentFolderPath: string | null, folderName: string): string {
  return parentFolderPath ? `${parentFolderPath}/${folderName}` : folderName
}

export function getInternalFolderParentPath(folderPath: string): string | null {
  const segments = folderPath.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  return segments.slice(0, -1).join('/')
}

export function resolveInternalNotebook(
  notebookId: string
): { ok: true } | { ok: false; errorCode: 'NOTEBOOK_NOT_FOUND' | 'NOTEBOOK_NOT_INTERNAL' } {
  const notebook = getNotebooks().find((item) => item.id === notebookId)
  if (!notebook) {
    return { ok: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
  }
  if (notebook.source_type === 'local-folder') {
    return { ok: false, errorCode: 'NOTEBOOK_NOT_INTERNAL' }
  }
  return { ok: true }
}
