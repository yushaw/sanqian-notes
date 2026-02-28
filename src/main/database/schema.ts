import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { getDb, setDb, getIsDatabaseOpen, setIsDatabaseOpen } from './connection'
import { createDemoNote } from './demo-notes'
import { runMigrations } from './migrations'
import { initDefaultAIActions } from './ai-actions'
import { initDefaultTemplates } from './templates'
import { t } from '../i18n'

/**
 * Close database connection gracefully
 * Should be called on app quit to ensure WAL checkpoint and prevent data loss
 */
export function closeDatabase(): void {
  if (!getIsDatabaseOpen()) {
    return
  }

  const db = getDb()
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (e) {
    console.warn('[Database] WAL checkpoint failed:', e)
  }
  try {
    db.close()
    console.log('[Database] Closed successfully')
  } catch (e) {
    console.error('[Database] Close failed:', e)
  } finally {
    setIsDatabaseOpen(false)
  }
}

function cleanupFtsTables(): void {
  const db = getDb()
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'"
  ).get()

  if (ftsExists) {
    console.log('Removing unused FTS tables...')
    db.exec(`
      DROP TRIGGER IF EXISTS notes_ai;
      DROP TRIGGER IF EXISTS notes_ad;
      DROP TRIGGER IF EXISTS notes_au;
      DROP TABLE IF EXISTS notes_fts;
    `)
    console.log('FTS cleanup completed.')
  }
}

export function initDatabase(): void {
  if (getIsDatabaseOpen()) {
    closeDatabase()
  }

  const dbPath = join(app.getPath('userData'), 'notes.db')
  const db = new Database(dbPath)
  setDb(db)
  setIsDatabaseOpen(true)

  // Enable foreign keys and WAL mode
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // Check if database is new
  const isNewDb = !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get()

  // Create tables
  db.exec(`
    -- Notebooks table
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'logo:notes',
      source_type TEXT NOT NULL DEFAULT 'internal',
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Local folder mounts table
    CREATE TABLE IF NOT EXISTS local_folder_mounts (
      notebook_id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      canonical_root_path TEXT NOT NULL,
      canonical_compare_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    -- Local note business metadata (favorites/pinned/summary for local-folder files)
    CREATE TABLE IF NOT EXISTS local_note_metadata (
      notebook_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      ai_summary TEXT DEFAULT NULL,
      summary_content_hash TEXT DEFAULT NULL,
      tags_json TEXT DEFAULT NULL,
      ai_tags_json TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (notebook_id, relative_path),
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    -- Stable local note identity map (path <-> persistent uid)
    CREATE TABLE IF NOT EXISTS local_note_identity (
      note_uid TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(notebook_id, relative_path),
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    -- Notes table
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      notebook_id TEXT,
      folder_path TEXT DEFAULT NULL,
      is_daily INTEGER NOT NULL DEFAULT 0,
      daily_date TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
    );

    -- Internal notebook folders table
    CREATE TABLE IF NOT EXISTS notebook_folders (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      depth INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(notebook_id, folder_path),
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    -- Tags table
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    -- Note-Tag junction table
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- Note links (for [[]] backlinks)
    CREATE TABLE IF NOT EXISTS note_links (
      source_note_id TEXT NOT NULL,
      target_note_id TEXT NOT NULL,
      PRIMARY KEY (source_note_id, target_note_id),
      FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    -- AI Actions table (user-customizable AI operations)
    CREATE TABLE IF NOT EXISTS ai_actions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '\u2728',
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'replace',
      show_in_context_menu INTEGER NOT NULL DEFAULT 1,
      show_in_slash_command INTEGER NOT NULL DEFAULT 1,
      show_in_shortcut INTEGER NOT NULL DEFAULT 1,
      shortcut_key TEXT DEFAULT '',
      order_index INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- AI Popups table (stores AI-generated popup content, separate from notes)
    CREATE TABLE IF NOT EXISTS ai_popups (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      action_name TEXT NOT NULL DEFAULT '',
      target_text TEXT NOT NULL,
      document_title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- AI popup references table (tracks popup anchors used by notes/local files)
    CREATE TABLE IF NOT EXISTS ai_popup_refs (
      popup_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'internal',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (popup_id, note_id)
    );

    -- App Settings table (general key-value settings storage)
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Agent Tasks table (stores agent task execution records, separate from notes)
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      notebook_id TEXT,
      content TEXT NOT NULL,
      additional_prompt TEXT,
      agent_mode TEXT NOT NULL DEFAULT 'auto',
      agent_id TEXT,
      agent_name TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      steps TEXT,
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_notes_is_daily ON notes(is_daily);
    CREATE INDEX IF NOT EXISTS idx_notes_daily_date ON notes(daily_date);
    CREATE INDEX IF NOT EXISTS idx_notes_is_favorite ON notes(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_note_tags_note_id ON note_tags(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id);
    CREATE INDEX IF NOT EXISTS idx_ai_actions_order ON ai_actions(order_index);
    CREATE INDEX IF NOT EXISTS idx_ai_actions_enabled ON ai_actions(enabled);
    CREATE INDEX IF NOT EXISTS idx_ai_popups_created_at ON ai_popups(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_popup_refs_note_id ON ai_popup_refs(note_id);
    CREATE INDEX IF NOT EXISTS idx_ai_popup_refs_popup_id ON ai_popup_refs(popup_id);
    CREATE INDEX IF NOT EXISTS idx_ai_popup_refs_source_note_id ON ai_popup_refs(source_type, note_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_block_id ON agent_tasks(block_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_page_id ON agent_tasks(page_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_notebook_folders_notebook_id ON notebook_folders(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_notebook_folders_path ON notebook_folders(folder_path);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_notebook_id ON local_note_metadata(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_favorite ON local_note_metadata(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_pinned ON local_note_metadata(is_pinned);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_updated_at ON local_note_metadata(updated_at);
    CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);

    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_cleanup_internal_note_delete
    AFTER DELETE ON notes
    BEGIN
      DELETE FROM ai_popup_refs
      WHERE source_type = 'internal' AND note_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_cleanup_local_identity_delete
    AFTER DELETE ON local_note_identity
    BEGIN
      DELETE FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = OLD.note_uid;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_cleanup_popup_delete
    AFTER DELETE ON ai_popups
    BEGIN
      DELETE FROM ai_popup_refs
      WHERE popup_id = OLD.id;
    END;
  `)

  // Create demo note for new databases
  if (isNewDb) {
    createDemoNote()
  }

  // Clean up FTS tables if they exist (no longer used, LIKE search is better for CJK)
  cleanupFtsTables()

  // Run migrations
  runMigrations()

  // Initialize default AI actions after migrations
  // so legacy ai_actions schema won't break startup inserts.
  initDefaultAIActions()

  // Initialize default templates after templates table exists
  initDefaultTemplates()

  // Always update builtin actions with latest descriptions (ensures updates after code changes)
  const aiActions = t().aiActions
  const builtinDescriptions: Record<string, string> = {
    'builtin-improve': aiActions.improve.description,
    'builtin-simplify': aiActions.simplify.description,
    'builtin-expand': aiActions.expand.description,
    'builtin-translate': aiActions.translate.description,
    'builtin-summarize': aiActions.summarize.description,
    'builtin-explain': aiActions.explain.description
  }
  const now = new Date().toISOString()
  const updateStmt = db.prepare(`
    UPDATE ai_actions
    SET description = ?, updated_at = ?
    WHERE id = ? AND (description = '' OR description IS NULL)
  `)
  for (const [id, description] of Object.entries(builtinDescriptions)) {
    updateStmt.run(description, now, id)
  }
}
