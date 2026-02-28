import { getDb } from './connection'

/**
 * Get a setting value by key
 */
export function getAppSetting(key: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

/**
 * Set a setting value
 */
export function setAppSetting(key: string, value: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
  ).run(key, value, now)
}

/**
 * Delete a setting
 */
export function deleteAppSetting(key: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  return result.changes > 0
}
