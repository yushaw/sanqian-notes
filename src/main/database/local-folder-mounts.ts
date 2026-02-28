import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { buildCanonicalComparePath } from './helpers'
import type { Notebook, NotebookStatus, LocalFolderMount, LocalFolderNotebookMount } from '../../shared/types'

function getNextNotebookOrderIndex(): number {
  const db = getDb()
  const maxStmt = db.prepare('SELECT MAX(order_index) as max FROM notebooks')
  const maxResult = maxStmt.get() as { max: number | null }
  return (maxResult.max ?? -1) + 1
}

export function getLocalFolderMounts(): LocalFolderNotebookMount[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT
      n.id as notebook_id,
      n.name as notebook_name,
      n.icon as notebook_icon,
      n.source_type as notebook_source_type,
      n.order_index as notebook_order_index,
      n.created_at as notebook_created_at,
      m.root_path as mount_root_path,
      m.canonical_root_path as mount_canonical_root_path,
      m.status as mount_status,
      m.created_at as mount_created_at,
      m.updated_at as mount_updated_at
    FROM local_folder_mounts m
    JOIN notebooks n ON n.id = m.notebook_id
    WHERE n.source_type = 'local-folder'
    ORDER BY n.order_index
  `).all() as Array<{
    notebook_id: string
    notebook_name: string
    notebook_icon: string
    notebook_source_type: string
    notebook_order_index: number
    notebook_created_at: string
    mount_root_path: string
    mount_canonical_root_path: string
    mount_status: NotebookStatus
    mount_created_at: string
    mount_updated_at: string
  }>

  return rows.map((row) => ({
    notebook: {
      id: row.notebook_id,
      name: row.notebook_name,
      icon: row.notebook_icon,
      source_type: (row.notebook_source_type as Notebook['source_type']) || 'internal',
      order_index: row.notebook_order_index,
      created_at: row.notebook_created_at,
    },
    mount: {
      notebook_id: row.notebook_id,
      root_path: row.mount_root_path,
      canonical_root_path: row.mount_canonical_root_path,
      status: row.mount_status,
      created_at: row.mount_created_at,
      updated_at: row.mount_updated_at,
    },
  }))
}

export function getLocalFolderMountByCanonicalPath(
  canonicalRootPath: string,
  options?: { excludeNotebookId?: string; activeOnly?: boolean }
): LocalFolderMount | null {
  const db = getDb()
  const targetComparePath = buildCanonicalComparePath(canonicalRootPath, canonicalRootPath)
  const indexedRows = db.prepare(`
    SELECT notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
    FROM local_folder_mounts
    WHERE canonical_compare_path = ?
  `).all(targetComparePath) as Array<LocalFolderMount & { canonical_compare_path?: string | null }>
  const rows = indexedRows.length > 0
    ? indexedRows
    : (db.prepare(`
      SELECT notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      FROM local_folder_mounts
    `).all() as Array<LocalFolderMount & { canonical_compare_path?: string | null }>)

  let matched: LocalFolderMount | null = null
  for (const row of rows) {
    if (options?.excludeNotebookId && row.notebook_id === options.excludeNotebookId) {
      continue
    }
    if (options?.activeOnly && row.status !== 'active') {
      continue
    }

    const comparablePath = row.canonical_compare_path
      || buildCanonicalComparePath(row.canonical_root_path || row.root_path, row.root_path)
    if (comparablePath !== targetComparePath) {
      continue
    }

    if (!matched) {
      matched = row
      continue
    }

    const matchedUpdatedAt = Date.parse(matched.updated_at || '')
    const rowUpdatedAt = Date.parse(row.updated_at || '')
    if (Number.isFinite(rowUpdatedAt) && (!Number.isFinite(matchedUpdatedAt) || rowUpdatedAt > matchedUpdatedAt)) {
      matched = row
      continue
    }

    if (matched.notebook_id.localeCompare(row.notebook_id, undefined, { sensitivity: 'base', numeric: true }) > 0) {
      matched = row
    }
  }

  return matched
}

export function getLocalFolderMountByNotebookId(notebookId: string): LocalFolderMount | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM local_folder_mounts WHERE notebook_id = ?').get(notebookId) as LocalFolderMount | undefined
  return row || null
}

export function createLocalFolderNotebookMount(input: {
  name: string
  icon?: string
  root_path: string
  canonical_root_path: string
  status?: NotebookStatus
}): LocalFolderNotebookMount {
  const db = getDb()
  const notebookId = uuidv4()
  const now = new Date().toISOString()
  const orderIndex = getNextNotebookOrderIndex()
  const icon = input.icon ?? 'logo:notes'
  const status = input.status ?? 'active'
  const canonicalComparePath = buildCanonicalComparePath(input.canonical_root_path, input.root_path)

  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(notebookId, input.name, icon, 'local-folder', orderIndex, now)

    db.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(notebookId, input.root_path, input.canonical_root_path, canonicalComparePath, status, now, now)
  })

  create()

  return {
    notebook: {
      id: notebookId,
      name: input.name,
      icon,
      source_type: 'local-folder',
      order_index: orderIndex,
      created_at: now,
    },
    mount: {
      notebook_id: notebookId,
      root_path: input.root_path,
      canonical_root_path: input.canonical_root_path,
      status,
      created_at: now,
      updated_at: now,
    },
  }
}

export function updateLocalFolderMountStatus(notebookId: string, status: NotebookStatus): boolean {
  const db = getDb()
  const result = db.prepare(`
    UPDATE local_folder_mounts
    SET status = ?, updated_at = ?
    WHERE notebook_id = ?
  `).run(status, new Date().toISOString(), notebookId)

  return result.changes > 0
}

export function updateLocalFolderMountRoot(input: {
  notebook_id: string
  root_path: string
  canonical_root_path: string
  status?: NotebookStatus
}): LocalFolderMount | null {
  const db = getDb()
  const nextStatus = input.status ?? 'active'
  const now = new Date().toISOString()
  const canonicalComparePath = buildCanonicalComparePath(input.canonical_root_path, input.root_path)
  const result = db.prepare(`
    UPDATE local_folder_mounts
    SET root_path = ?, canonical_root_path = ?, canonical_compare_path = ?, status = ?, updated_at = ?
    WHERE notebook_id = ?
  `).run(input.root_path, input.canonical_root_path, canonicalComparePath, nextStatus, now, input.notebook_id)

  if (result.changes === 0) return null

  const row = db.prepare('SELECT * FROM local_folder_mounts WHERE notebook_id = ?').get(input.notebook_id) as LocalFolderMount | undefined
  return row || null
}
