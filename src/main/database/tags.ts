import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import type { Tag, TagWithSource } from '../../shared/types'

export function getTags(): Tag[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name')
  return stmt.all() as Tag[]
}

export function getTagsByNote(noteId: string): TagWithSource[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT t.id, t.name, COALESCE(nt.source, 'user') as source
    FROM tags t
    JOIN note_tags nt ON nt.tag_id = t.id
    WHERE nt.note_id = ?
    ORDER BY nt.source DESC, t.name
  `)
  return stmt.all(noteId) as TagWithSource[]
}

export function addTagToNote(noteId: string, tagName: string): Tag {
  const db = getDb()
  let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName) as Tag | undefined

  if (!tag) {
    const id = uuidv4()
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, tagName)
    tag = { id, name: tagName }
  }

  db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tag.id)

  return tag
}

export function removeTagFromNote(noteId: string, tagId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(noteId, tagId)
}

/**
 * Add AI-generated tag to note
 * Creates tag if not exists, links with source='ai'
 */
export function addAITagToNote(noteId: string, tagName: string): Tag | null {
  const db = getDb()
  let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName) as Tag | undefined

  if (!tag) {
    const id = uuidv4()
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, tagName)
    tag = { id, name: tagName }
  }

  const existing = db.prepare(
    'SELECT source FROM note_tags WHERE note_id = ? AND tag_id = ?'
  ).get(noteId, tag.id) as { source: string } | undefined

  if (existing?.source === 'user') {
    return null
  }

  db.prepare("INSERT OR REPLACE INTO note_tags (note_id, tag_id, source) VALUES (?, ?, 'ai')").run(noteId, tag.id)

  return tag
}

/**
 * Remove all AI-generated tags from a note
 */
export function removeAITagsFromNote(noteId: string): void {
  const db = getDb()
  db.prepare("DELETE FROM note_tags WHERE note_id = ? AND source = 'ai'").run(noteId)
}

/**
 * Update AI tags for a note (removes old AI tags, adds new ones)
 */
export function updateAITags(noteId: string, tagNames: string[]): void {
  const db = getDb()
  db.transaction(() => {
    removeAITagsFromNote(noteId)
    for (const name of tagNames) {
      if (name.trim()) {
        addAITagToNote(noteId, name.trim())
      }
    }
  })()
}
