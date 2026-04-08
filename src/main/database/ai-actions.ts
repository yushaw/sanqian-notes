import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { t } from '../i18n'
import type { AIActionRow } from './helpers'
import type { AIAction, AIActionInput } from '../../shared/types'

// Get default builtin AI actions (localized based on system language)
function getDefaultAIActions() {
  const actions = t().aiActions
  return [
    {
      id: 'builtin-improve',
      name: actions.improve.name,
      description: actions.improve.description,
      icon: '\u270F\uFE0F',
      prompt: actions.improve.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-simplify',
      name: actions.simplify.name,
      description: actions.simplify.description,
      icon: '\uD83D\uDCD0',
      prompt: actions.simplify.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-expand',
      name: actions.expand.name,
      description: actions.expand.description,
      icon: '\uD83D\uDCD6',
      prompt: actions.expand.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-translate',
      name: actions.translate.name,
      description: actions.translate.description,
      icon: '\uD83C\uDF10',
      prompt: actions.translate.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-summarize',
      name: actions.summarize.name,
      description: actions.summarize.description,
      icon: '\uD83D\uDCCB',
      prompt: actions.summarize.prompt,
      mode: 'popup' as const
    },
    {
      id: 'builtin-explain',
      name: actions.explain.name,
      description: actions.explain.description,
      icon: '\uD83D\uDCA1',
      prompt: actions.explain.prompt,
      mode: 'popup' as const
    }
  ]
}

function rowToAIAction(row: AIActionRow): AIAction {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    icon: row.icon,
    prompt: row.prompt,
    mode: row.mode as 'replace' | 'insert' | 'popup',
    showInContextMenu: row.show_in_context_menu === 1,
    showInSlashCommand: row.show_in_slash_command === 1,
    showInShortcut: row.show_in_shortcut === 1,
    shortcutKey: row.shortcut_key || '',
    orderIndex: row.order_index,
    isBuiltin: row.is_builtin === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Initialize default AI actions if none exist
 */
export function initDefaultAIActions(): void {
  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as count FROM ai_actions').get() as { count: number }

  if (count.count === 0) {
    const now = new Date().toISOString()
    const stmt = db.prepare(`
      INSERT INTO ai_actions (id, name, description, icon, prompt, mode, show_in_context_menu, show_in_slash_command, show_in_shortcut, order_index, is_builtin, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, ?, 1, 1, ?, ?)
    `)

    getDefaultAIActions().forEach((action, index) => {
      stmt.run(action.id, action.name, action.description, action.icon, action.prompt, action.mode, index, now, now)
    })

    console.log('[Database] Initialized default AI actions')
  }
}

export function getAIActions(): AIAction[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_actions WHERE enabled = 1 ORDER BY order_index ASC')
  const rows = stmt.all() as AIActionRow[]
  return rows.map(rowToAIAction)
}

export function getAllAIActions(): AIAction[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_actions ORDER BY order_index ASC')
  const rows = stmt.all() as AIActionRow[]
  return rows.map(rowToAIAction)
}

export function getAIAction(id: string): AIAction | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM ai_actions WHERE id = ?')
  const row = stmt.get(id) as AIActionRow | undefined
  if (!row) return null
  return rowToAIAction(row)
}

export function createAIAction(input: AIActionInput): AIAction {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  const maxOrder = db.prepare('SELECT MAX(order_index) as max FROM ai_actions').get() as { max: number | null }
  const orderIndex = (maxOrder.max ?? -1) + 1

  db.prepare(`
    INSERT INTO ai_actions (id, name, description, icon, prompt, mode, show_in_context_menu, show_in_slash_command, show_in_shortcut, shortcut_key, order_index, is_builtin, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `).run(
    id,
    input.name,
    input.description || '',
    input.icon,
    input.prompt,
    input.mode,
    input.showInContextMenu !== false ? 1 : 0,
    input.showInSlashCommand !== false ? 1 : 0,
    input.showInShortcut !== false ? 1 : 0,
    input.shortcutKey || '',
    orderIndex,
    now,
    now
  )

  return getAIAction(id)!
}

export function updateAIAction(id: string, updates: Partial<AIActionInput> & { enabled?: boolean }): AIAction | null {
  const db = getDb()
  const existing = getAIAction(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const fields: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.name !== undefined) {
    fields.push('name = ?')
    values.push(updates.name)
  }
  if (updates.description !== undefined) {
    fields.push('description = ?')
    values.push(updates.description)
  }
  if (updates.icon !== undefined) {
    fields.push('icon = ?')
    values.push(updates.icon)
  }
  if (updates.prompt !== undefined) {
    fields.push('prompt = ?')
    values.push(updates.prompt)
  }
  if (updates.mode !== undefined) {
    fields.push('mode = ?')
    values.push(updates.mode)
  }
  if (updates.showInContextMenu !== undefined) {
    fields.push('show_in_context_menu = ?')
    values.push(updates.showInContextMenu ? 1 : 0)
  }
  if (updates.showInSlashCommand !== undefined) {
    fields.push('show_in_slash_command = ?')
    values.push(updates.showInSlashCommand ? 1 : 0)
  }
  if (updates.showInShortcut !== undefined) {
    fields.push('show_in_shortcut = ?')
    values.push(updates.showInShortcut ? 1 : 0)
  }
  if (updates.shortcutKey !== undefined) {
    fields.push('shortcut_key = ?')
    values.push(updates.shortcutKey)
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(updates.enabled ? 1 : 0)
  }

  values.push(id)
  db.prepare(`UPDATE ai_actions SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getAIAction(id)
}

export function deleteAIAction(id: string): boolean {
  const db = getDb()
  const existing = getAIAction(id)
  if (!existing || existing.isBuiltin) return false

  db.prepare('DELETE FROM ai_actions WHERE id = ? AND is_builtin = 0').run(id)
  return true
}

export function reorderAIActions(orderedIds: string[]): void {
  if (orderedIds.length === 0) return

  const db = getDb()
  const existingIds = (
    db.prepare('SELECT id FROM ai_actions ORDER BY order_index ASC').all() as Array<{ id: string }>
  ).map((row) => row.id)
  const existingIdSet = new Set(existingIds)
  const seenIds = new Set<string>()
  for (const id of orderedIds) {
    if (!existingIdSet.has(id)) {
      throw new Error(`reorderAIActions: unknown id ${id}`)
    }
    if (seenIds.has(id)) {
      throw new Error(`reorderAIActions: duplicate id ${id}`)
    }
    seenIds.add(id)
  }

  const finalOrderIds = [
    ...orderedIds,
    ...existingIds.filter((id) => !seenIds.has(id)),
  ]

  const stmt = db.prepare('UPDATE ai_actions SET order_index = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  const reorder = db.transaction((ids: readonly string[]) => {
    ids.forEach((id, index) => {
      stmt.run(index, now, id)
    })
  })

  reorder(finalOrderIds)
}

export function resetAIActionsToDefaults(): void {
  const db = getDb()
  db.prepare('DELETE FROM ai_actions').run()
  initDefaultAIActions()
}
