import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { getAppLocale } from '../i18n'
import type { Template, TemplateInput } from '../../shared/types'

interface TemplateRow {
  id: string
  name: string
  description: string | null
  content: string
  icon: string | null
  is_daily_default: number
  order_index: number
  created_at: string
  updated_at: string
}

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    content: row.content,
    icon: row.icon || '',
    isDailyDefault: row.is_daily_default === 1,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getAllTemplates(): Template[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM templates ORDER BY order_index').all() as TemplateRow[]
  return rows.map(rowToTemplate)
}

export function getTemplate(id: string): Template | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined
  return row ? rowToTemplate(row) : null
}

export function getDailyDefaultTemplate(): Template | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM templates WHERE is_daily_default = 1').get() as TemplateRow | undefined
  return row ? rowToTemplate(row) : null
}

export function createTemplate(input: TemplateInput): Template {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  const maxOrder = db.prepare('SELECT MAX(order_index) as max FROM templates').get() as { max: number | null }
  const orderIndex = (maxOrder?.max ?? -1) + 1

  if (input.isDailyDefault) {
    db.prepare('UPDATE templates SET is_daily_default = 0').run()
  }

  db.prepare(`
    INSERT INTO templates (id, name, description, content, icon, is_daily_default, order_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description || '',
    input.content,
    input.icon || '',
    input.isDailyDefault ? 1 : 0,
    orderIndex,
    now,
    now
  )

  return getTemplate(id)!
}

export function updateTemplate(id: string, updates: Partial<TemplateInput>): Template | null {
  const db = getDb()
  const existing = getTemplate(id)
  if (!existing) return null

  const now = new Date().toISOString()

  if (updates.isDailyDefault) {
    db.prepare('UPDATE templates SET is_daily_default = 0 WHERE id != ?').run(id)
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    fields.push('description = ?')
    values.push(updates.description)
  }
  if (updates.content !== undefined) {
    fields.push('content = ?')
    values.push(updates.content)
  }
  if (updates.icon !== undefined) {
    fields.push('icon = ?')
    values.push(updates.icon)
  }
  if (updates.isDailyDefault !== undefined) {
    fields.push('is_daily_default = ?')
    values.push(updates.isDailyDefault ? 1 : 0)
  }

  if (fields.length === 0) return existing

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)

  db.prepare(`UPDATE templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getTemplate(id)
}

export function deleteTemplate(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  return result.changes > 0
}

export function reorderTemplates(orderedIds: string[]): void {
  if (orderedIds.length === 0) return

  const db = getDb()
  const existingIds = (
    db.prepare('SELECT id FROM templates ORDER BY order_index ASC').all() as Array<{ id: string }>
  ).map((row) => row.id)
  const existingIdSet = new Set(existingIds)
  const seenIds = new Set<string>()
  for (const id of orderedIds) {
    if (!existingIdSet.has(id)) {
      throw new Error(`reorderTemplates: unknown id ${id}`)
    }
    if (seenIds.has(id)) {
      throw new Error(`reorderTemplates: duplicate id ${id}`)
    }
    seenIds.add(id)
  }

  const finalOrderIds = [
    ...orderedIds,
    ...existingIds.filter((id) => !seenIds.has(id)),
  ]

  const stmt = db.prepare('UPDATE templates SET order_index = ? WHERE id = ?')
  const updateMany = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      stmt.run(index, id)
    })
  })
  updateMany(finalOrderIds)
}

export function setDailyDefaultTemplate(id: string | null): void {
  const db = getDb()
  db.prepare('UPDATE templates SET is_daily_default = 0').run()
  if (id) {
    db.prepare('UPDATE templates SET is_daily_default = 1 WHERE id = ?').run(id)
  }
}

/**
 * Get default template content based on language
 */
function getDefaultTemplateContent(): { content: string; name: string; description: string } {
  const lang = getAppLocale()
  const isZh = lang === 'zh'

  const content = isZh
    ? `## \u65E5\u8BB0 & \u968F\u60F3
-


## \u4ECA\u65E5\u4EFB\u52A1
**\u91CD\u8981**:
[ ]


**\u5F85\u529E**:
[ ] {{cursor}}


## \u6742\u9879 & \u65E5\u5E38
[ ]

___

## \u4ECA\u65E5\u7B14\u8BB0

\`\`\`dataview
LIST WHERE created = today
SORT updated ASC
\`\`\`
`
    : `## Journals & Thoughts
-


## Today's Tasks
**High Priority**:
[ ]


**Tasks**:
[ ] {{cursor}}


## Miscellanies & Routines
[ ]

___

## Today's Notes

\`\`\`dataview
LIST WHERE created = today
SORT updated ASC
\`\`\`
`

  return {
    content,
    name: isZh ? '\u65E5\u8BB0' : 'Daily',
    description: isZh ? '\u6BCF\u65E5\u65E5\u8BB0\u6A21\u677F' : 'Daily journal template'
  }
}

/**
 * Initialize default templates if none exist
 */
export function initDefaultTemplates(): void {
  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as count FROM templates').get() as { count: number }

  if (count.count === 0) {
    const now = new Date().toISOString()
    const { content, name, description } = getDefaultTemplateContent()

    db.prepare(`
      INSERT INTO templates (id, name, description, content, icon, is_daily_default, order_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(
      uuidv4(),
      name,
      description,
      content,
      '',
      now,
      now
    )

    console.log('[Database] Initialized default templates')
  }
}

export function resetTemplatesToDefaults(): void {
  const db = getDb()
  db.prepare('DELETE FROM templates').run()
  initDefaultTemplates()
}
