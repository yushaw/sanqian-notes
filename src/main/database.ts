import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import isoWeek from 'dayjs/plugin/isoWeek'
import { t, getSystemLang, getAppLocale } from './i18n'
import { markdownToTiptapString } from './markdown'

dayjs.extend(weekOfYear)
dayjs.extend(isoWeek)
import {
  RECENT_DAYS,
  type AIAction,
  type AIActionInput,
  type AIActionMode,
  type Note,
  type NoteInput,
  type NoteSearchFilter,
  type Tag,
  type TagWithSource,
  type Notebook,
  type NotebookInput,
  type AgentTaskRecord,
  type AgentTaskInput,
  type Template,
  type TemplateInput
} from '../shared/types'

// Re-export for backward compatibility
export type {
  AIAction,
  AIActionInput,
  AIActionMode,
  Note,
  NoteInput,
  NoteSearchFilter,
  Tag,
  TagWithSource,
  Notebook,
  NotebookInput
}

// Constants
export const TRASH_RETENTION_DAYS = 30

// Database row interfaces (snake_case columns)
interface AIActionRow {
  id: string
  name: string
  description: string | null
  icon: string
  prompt: string
  mode: string
  show_in_context_menu: number
  show_in_slash_command: number
  show_in_shortcut: number
  shortcut_key: string | null
  order_index: number
  is_builtin: number
  enabled: number
  created_at: string
  updated_at: string
}

// 获取系统语言 (alias for backward compatibility)
function getSystemLanguage(): 'zh' | 'en' {
  return getSystemLang()
}

let db: Database.Database


/**
 * Close database connection gracefully
 * Should be called on app quit to ensure WAL checkpoint and prevent data loss
 */
export function closeDatabase(): void {
  if (db) {
    try {
      // Ensure WAL is checkpointed before close
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (e) {
      console.warn('[Database] WAL checkpoint failed:', e)
    }
    try {
      db.close()
      console.log('[Database] Closed successfully')
    } catch (e) {
      console.error('[Database] Close failed:', e)
    }
  }
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'notes.db')
  db = new Database(dbPath)

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
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Notes table
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      notebook_id TEXT,
      is_daily INTEGER NOT NULL DEFAULT 0,
      daily_date TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
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
      icon TEXT NOT NULL DEFAULT '✨',
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
    CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(is_pinned);
    CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
    CREATE INDEX IF NOT EXISTS idx_note_tags_note_id ON note_tags(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id ON note_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id);
    CREATE INDEX IF NOT EXISTS idx_ai_actions_order ON ai_actions(order_index);
    CREATE INDEX IF NOT EXISTS idx_ai_actions_enabled ON ai_actions(enabled);
    CREATE INDEX IF NOT EXISTS idx_ai_popups_created_at ON ai_popups(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_block_id ON agent_tasks(block_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_page_id ON agent_tasks(page_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
  `)

  // Create demo note for new databases
  if (isNewDb) {
    createDemoNote()
  }

  // Initialize default AI actions
  initDefaultAIActions()


  // Clean up FTS tables if they exist (no longer used, LIKE search is better for CJK)
  cleanupFtsTables()

  // Run migrations
  runMigrations()
}

function cleanupFtsTables(): void {
  // Remove FTS tables and triggers if they exist
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

function runMigrations(): void {
  // Migration: Add is_pinned column to notes table
  const noteColumns = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[]
  const hasIsPinned = noteColumns.some(col => col.name === 'is_pinned')

  if (!hasIsPinned) {
    console.log('Adding is_pinned column to notes table...')
    db.exec('ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0')
    console.log('Migration completed: is_pinned column added.')
  }

  // Migration: Remove color column and add icon column to notebooks table
  const notebookColumns = db.prepare("PRAGMA table_info(notebooks)").all() as { name: string }[]
  const hasIcon = notebookColumns.some(col => col.name === 'icon')

  if (!hasIcon) {
    console.log('Adding icon column to notebooks table...')
    db.exec("ALTER TABLE notebooks ADD COLUMN icon TEXT DEFAULT 'logo:notes'")
    console.log('Migration completed: icon column added.')
  }

  // Migration: Add deleted_at column to notes table (soft delete / trash)
  const hasDeletedAt = noteColumns.some(col => col.name === 'deleted_at')

  if (!hasDeletedAt) {
    console.log('Adding deleted_at column to notes table...')
    db.exec('ALTER TABLE notes ADD COLUMN deleted_at TEXT DEFAULT NULL')
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)')
    console.log('Migration completed: deleted_at column added.')
  }

  // Migration: Add shortcut_key column to ai_actions table
  const aiActionColumns = db.prepare("PRAGMA table_info(ai_actions)").all() as { name: string }[]
  const hasShortcutKey = aiActionColumns.some(col => col.name === 'shortcut_key')

  if (!hasShortcutKey) {
    console.log('Adding shortcut_key column to ai_actions table...')
    db.exec("ALTER TABLE ai_actions ADD COLUMN shortcut_key TEXT DEFAULT ''")
    console.log('Migration completed: shortcut_key column added.')
  }

  // Migration: Add description column to ai_actions table
  const hasDescription = aiActionColumns.some(col => col.name === 'description')

  if (!hasDescription) {
    console.log('Adding description column to ai_actions table...')
    db.exec("ALTER TABLE ai_actions ADD COLUMN description TEXT NOT NULL DEFAULT ''")
    console.log('Migration completed: description column added.')
  }

  // Migration: Add AI summary columns to notes table
  const hasAiSummary = noteColumns.some(col => col.name === 'ai_summary')

  if (!hasAiSummary) {
    console.log('Adding AI summary columns to notes table...')
    db.exec('ALTER TABLE notes ADD COLUMN ai_summary TEXT DEFAULT NULL')
    db.exec('ALTER TABLE notes ADD COLUMN summary_content_hash TEXT DEFAULT NULL')
    console.log('Migration completed: AI summary columns added.')
  }

  // Migration: Add source column to note_tags table (for AI-generated tags)
  const noteTagColumns = db.prepare("PRAGMA table_info(note_tags)").all() as { name: string }[]
  const hasSource = noteTagColumns.some(col => col.name === 'source')

  if (!hasSource) {
    console.log('Adding source column to note_tags table...')
    db.exec("ALTER TABLE note_tags ADD COLUMN source TEXT DEFAULT 'user'")
    console.log('Migration completed: source column added to note_tags.')
  }

  // Migration: Add output columns to agent_tasks table
  const agentTaskColumns = db.prepare("PRAGMA table_info(agent_tasks)").all() as { name: string }[]
  const hasOutputBlockId = agentTaskColumns.some(col => col.name === 'output_block_id')

  if (!hasOutputBlockId) {
    console.log('Adding output columns to agent_tasks table...')
    db.exec("ALTER TABLE agent_tasks ADD COLUMN output_block_id TEXT DEFAULT NULL")
    db.exec("ALTER TABLE agent_tasks ADD COLUMN process_mode TEXT DEFAULT 'append'")
    db.exec("ALTER TABLE agent_tasks ADD COLUMN run_timing TEXT DEFAULT 'manual'")
    db.exec("ALTER TABLE agent_tasks ADD COLUMN schedule_config TEXT DEFAULT NULL")
    console.log('Migration completed: output columns added to agent_tasks.')
  }

  // Migration: Add output_format column to agent_tasks table
  const hasOutputFormat = agentTaskColumns.some(col => col.name === 'output_format')
  if (!hasOutputFormat) {
    console.log('Adding output_format column to agent_tasks table...')
    db.exec("ALTER TABLE agent_tasks ADD COLUMN output_format TEXT DEFAULT 'auto'")
    console.log('Migration completed: output_format column added to agent_tasks.')
  }

  // Migration: Create templates table
  const templatesTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='templates'"
  ).get()

  if (!templatesTableExists) {
    console.log('Creating templates table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        content TEXT NOT NULL,
        icon TEXT DEFAULT '',
        is_daily_default INTEGER DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_templates_order ON templates(order_index);
      CREATE INDEX IF NOT EXISTS idx_templates_daily ON templates(is_daily_default);
    `)
    console.log('Migration completed: templates table created.')
    // Default templates are now created by initDefaultTemplates()
  }

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
  // Update if description is empty string OR NULL
  const updateStmt = db.prepare(`
    UPDATE ai_actions
    SET description = ?, updated_at = ?
    WHERE id = ? AND (description = '' OR description IS NULL)
  `)
  for (const [id, description] of Object.entries(builtinDescriptions)) {
    updateStmt.run(description, now, id)
  }
}

export function createDemoNotes(): void {
  const now = new Date().toISOString()
  const lang = getSystemLanguage()
  const isZh = lang === 'zh'

  // 创建三个互相关联的 demo 笔记
  const note1Id = uuidv4()
  const note2Id = uuidv4()
  const note3Id = uuidv4()

  // 多语言文本
  const t = {
    // 笔记标题
    note1Title: isZh ? '欢迎使用心流' : 'Welcome to Flow',
    note2Title: isZh ? '编辑器功能演示' : 'Editor Features Demo',
    note3Title: isZh ? '快捷键速查表' : 'Keyboard Shortcuts',
    // 笔记1内容
    intro1: isZh ? '这是一款专注于 ' : 'A note-taking app focused on ',
    introHighlight: isZh ? '沉浸式写作' : 'immersive writing',
    intro2: isZh ? ' 的笔记应用。查看 ' : '. Check out ',
    intro3: isZh ? ' 了解高级功能，或阅读 ' : ' for advanced features, or read ',
    intro4: isZh ? ' 提高效率。' : ' to boost productivity.',
    tipText1: isZh ? '输入 ' : 'Type ',
    tipText2: isZh ? ' 可以快速插入各种块元素，试试看！' : ' to quickly insert various blocks. Try it!',
    richFormat: isZh ? '丰富的文本格式' : 'Rich Text Formatting',
    bold: isZh ? '粗体' : 'Bold',
    italic: isZh ? '斜体' : 'Italic',
    underline: isZh ? '下划线' : 'Underline',
    strike: isZh ? '删除线' : 'Strikethrough',
    highlight: isZh ? '高亮' : 'Highlight',
    colorText: isZh ? '彩色文字' : 'Colored text',
    inlineCode: isZh ? '行内代码' : 'Inline code',
    sep: isZh ? '、' : ', ',
    footnoteInput: isZh ? '输入 ' : 'Type ',
    footnoteOr: isZh ? ' 或按 ' : ' or press ',
    footnoteInsert: isZh ? ' 插入脚注' : ' to insert a footnote',
    footnoteContent: isZh ? '脚注可以添加补充说明，鼠标悬停查看，点击可编辑。' : 'Footnotes add supplementary info. Hover to view, click to edit.',
    footnoteEnd: isZh ? '，非常适合学术写作。' : ', perfect for academic writing.',
    bilink: isZh ? '双向链接' : 'Bi-directional Links',
    bilinkIntro1: isZh ? '输入 ' : 'Type ',
    bilinkIntro2: isZh ? ' 可以创建笔记间的链接，构建你的知识网络：' : ' to create links between notes and build your knowledge network:',
    bilinkNote: isZh ? '[[笔记名]]' : '[[Note Name]]',
    bilinkNoteDesc: isZh ? ' — 链接到笔记' : ' — Link to a note',
    bilinkHeading: isZh ? '[[笔记名#标题]]' : '[[Note Name#Heading]]',
    bilinkHeadingDesc: isZh ? ' — 链接到特定标题' : ' — Link to a specific heading',
    bilinkBlock: isZh ? '[[笔记名#^blockId]]' : '[[Note Name#^blockId]]',
    bilinkBlockDesc: isZh ? ' — 链接到特定段落' : ' — Link to a specific paragraph',
    typewriter: isZh ? '打字机模式' : 'Typewriter Mode',
    twIntro1: isZh ? '点击工具栏的打字机图标进入 ' : 'Click the typewriter icon to enter ',
    twIntro2: isZh ? '沉浸式写作模式' : 'immersive writing mode',
    twIntro3: isZh ? '：' : ':',
    twFeature1: isZh ? '光标固定在屏幕中央，内容随输入滚动' : 'Cursor stays centered, content scrolls as you type',
    twFeature2: isZh ? '专注模式让当前段落清晰，周围逐渐淡出' : 'Focus mode keeps current paragraph clear, surroundings fade',
    twFeature3: isZh ? '自动跟随系统深色/浅色主题' : 'Auto-follows system dark/light theme',
    twFeature4: isZh ? '宽屏时右侧显示大纲导航' : 'Outline navigation on the right for wide screens',
    task1: isZh ? '阅读本指南' : 'Read this guide',
    task2: isZh ? '尝试输入 / 插入块' : 'Try typing / to insert blocks',
    task3: isZh ? '体验打字机模式' : 'Try typewriter mode',
    task4: isZh ? '创建你的第一篇笔记' : 'Create your first note',
  }

  // 笔记 1: 欢迎使用三千笔记 - 主入门指南
  const mainContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'intro01' },
        content: [
          { type: 'text', text: t.intro1 },
          { type: 'text', marks: [{ type: 'highlight' }], text: t.introHighlight },
          { type: 'text', text: t.intro2 },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }],
            text: t.note2Title
          },
          { type: 'text', text: t.intro3 },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }],
            text: t.note3Title
          },
          { type: 'text', text: t.intro4 }
        ]
      },
      {
        type: 'callout',
        attrs: { type: 'tip', collapsed: false },
        content: [
          {
            type: 'paragraph', content: [
              { type: 'text', text: t.tipText1 },
              { type: 'text', marks: [{ type: 'code' }], text: '/' },
              { type: 'text', text: t.tipText2 }
            ]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'format1' },
        content: [{ type: 'text', text: t.richFormat }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'format2' },
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: t.bold },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'italic' }], text: t.italic },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'underline' }], text: t.underline },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'strike' }], text: t.strike },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'highlight' }], text: t.highlight },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'textStyle', attrs: { color: '#ef4444' } }], text: t.colorText },
          { type: 'text', text: t.sep },
          { type: 'text', marks: [{ type: 'code' }], text: t.inlineCode }
        ]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'footnote1' },
        content: [
          { type: 'text', text: t.footnoteInput },
          { type: 'text', marks: [{ type: 'code' }], text: isZh ? '/脚注' : '/footnote' },
          { type: 'text', text: t.footnoteOr },
          { type: 'text', marks: [{ type: 'code' }], text: '⌘⇧F' },
          { type: 'text', text: t.footnoteInsert },
          { type: 'footnote', attrs: { id: 1, content: t.footnoteContent } },
          { type: 'text', text: t.footnoteEnd }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'bilink1' },
        content: [{ type: 'text', text: t.bilink }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'bilink2' },
        content: [
          { type: 'text', text: t.bilinkIntro1 },
          { type: 'text', marks: [{ type: 'code' }], text: '[[' },
          { type: 'text', text: t.bilinkIntro2 }
        ]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'bilink3' },
        content: [
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'code' }], text: t.bilinkNote },
                { type: 'text', text: t.bilinkNoteDesc }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'code' }], text: t.bilinkHeading },
                { type: 'text', text: t.bilinkHeadingDesc }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'code' }], text: t.bilinkBlock },
                { type: 'text', text: t.bilinkBlockDesc }
              ]
            }]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'typewriter' },
        content: [{ type: 'text', text: t.typewriter }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'tw1' },
        content: [
          { type: 'text', text: t.twIntro1 },
          { type: 'text', marks: [{ type: 'bold' }], text: t.twIntro2 },
          { type: 'text', text: t.twIntro3 }
        ]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'tw2' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature1 }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature2 }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature3 }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t.twFeature4 }] }] }
        ]
      },
      {
        type: 'taskList',
        attrs: { blockId: 'tasks1' },
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task1 }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task2 }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task3 }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.task4 }] }] }
        ]
      }
    ]
  }

  // 笔记 2: 编辑器功能演示 - 中文版（按常用程度排序）
  const featuresContentZh = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'fback1' }, content: [
          { type: 'text', text: '返回 ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      // 1. 引用块 - 非常常用
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'blockquote' },
        content: [{ type: 'text', text: '引用块' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '> 空格' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/引用' },
          { type: 'text', text: ' 创建引用块：' }
        ]
      },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '好的笔记不是记录一切，而是记录能引发思考的内容。' }] }
        ]
      },
      // 2. 提示块 Callout - 强调信息
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'callouts' },
        content: [{ type: 'text', text: '提示块 Callout' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/callout' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/提示' },
          { type: 'text', text: ' 选择不同类型：' }
        ]
      },
      {
        type: 'callout', attrs: { type: 'note', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Note' }, { type: 'text', text: '：普通提示信息' }] }
        ]
      },
      {
        type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Tip' }, { type: 'text', text: '：实用技巧' }] }
        ]
      },
      {
        type: 'callout', attrs: { type: 'warning', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Warning' }, { type: 'text', text: '：注意事项' }] }
        ]
      },
      {
        type: 'callout', attrs: { type: 'danger', collapsed: false }, content: [
          { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Danger' }, { type: 'text', text: '：危险警告' }] }
        ]
      },
      // 3. 折叠块 Toggle
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'toggle' },
        content: [{ type: 'text', text: '折叠块 Toggle' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/toggle' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/折叠' },
          { type: 'text', text: ' 创建可展开/收起的内容：' }
        ]
      },
      {
        type: 'toggle', attrs: { summary: '点击展开查看详情', collapsed: true }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: '折叠块可以隐藏长内容，保持笔记整洁。' }] },
          {
            type: 'bulletList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '适合详细说明' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '适合 FAQ 常见问题' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '适合代码示例' }] }] }
            ]
          }
        ]
      },
      // 4. 代码块
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'codblk' },
        content: [{ type: 'text', text: '代码块' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '```' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/代码' },
          { type: 'text', text: ' 创建代码块，点击左上角切换语言：' }
        ]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'javascript', blockId: 'codex1' },
        content: [{ type: 'text', text: '// 支持 100+ 种语言语法高亮\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet("心流笔记");' }]
      },
      // 5. 数学公式
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'math' },
        content: [{ type: 'text', text: '数学公式' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '行内公式：输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '$公式$' },
          { type: 'text', text: '，如 ' },
          { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
          { type: 'text', text: '、' },
          { type: 'inlineMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } }
        ]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '块级公式：输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/数学' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/math' },
          { type: 'text', text: ' 插入独立公式块。' }
        ]
      },
      {
        type: 'mathematics',
        attrs: { latex: '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' }
      },
      // 6. 表格
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'tblsec' },
        content: [{ type: 'text', text: '表格' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/表格' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/table' },
          { type: 'text', text: ' 插入表格，支持拖拽调整列宽：' }
        ]
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '功能' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷输入' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '说明' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用块' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> 空格' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用文字' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示块' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4 种类型' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠块' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '展开/收起' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '代码块' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '语法高亮' }] }] }
            ]
          }
        ]
      },
      // 7. 图片
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'imgdemo' },
        content: [{ type: 'text', text: '图片' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '直接粘贴图片或拖拽文件到编辑器，图片会自动保存到本地附件目录，支持调整大小和对齐方式。' }]
      },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '试试粘贴一张图片到这里，或从文件夹拖拽图片进来！' }] }
      ] },
      // 8. Mermaid 图表
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'mermaid' },
        content: [{ type: 'text', text: 'Mermaid 图表' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/mermaid' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/图表' },
          { type: 'text', text: ' 插入流程图，双击编辑：' }
        ]
      },
      {
        type: 'mermaid',
        attrs: { code: 'graph LR\n    A[想法] --> B{值得记录?}\n    B -->|是| C[写入笔记]\n    B -->|否| D[忽略]\n    C --> E[定期回顾]\n    E --> A' }
      },
      // 9. Dataview 数据查询
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'dataview' },
        content: [{ type: 'text', text: 'Dataview 数据查询' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/dataview' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/查询' },
          { type: 'text', text: ' 创建数据查询块，支持 LIST 和 TABLE 两种输出格式：' }
        ]
      },
      { type: 'dataviewBlock', attrs: { code: 'LIST\nFROM ""\nWHERE is_favorite = true\nLIMIT 5', blockId: 'dvblk1' } },
      // 10. 内容引用 Transclusion
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'transclusion' },
        content: [{ type: 'text', text: '内容引用 Transclusion' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/transclusion' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/引用' },
          { type: 'text', text: ' 嵌入其他笔记的内容，支持实时同步更新。' }
        ]
      },
      // 11. 网页嵌入 Embed
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'embed' },
        content: [{ type: 'text', text: '网页嵌入 Embed' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/embed' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/嵌入' },
          { type: 'text', text: ' 嵌入网页、视频等外部内容。' }
        ]
      },
      // 12. 导入导出
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'importexport' },
        content: [{ type: 'text', text: '导入导出' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '点击编辑器右上角的 ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '⋯' },
          { type: 'text', text: ' 菜单：' }
        ]
      },
      {
        type: 'bulletList', content: [
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: '导出' },
                { type: 'text', text: '：支持 PDF 和 Markdown 格式' }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: '导入' },
                { type: 'text', text: '：支持 Markdown、PDF 解析、arXiv 论文导入' }
              ]
            }]
          }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: '查看 ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }], text: t.note3Title },
          { type: 'text', text: ' 了解更多快捷操作。' }
        ]
      }
    ]
  }

  // 笔记 2: 编辑器功能演示 - 英文版
  const featuresContentEn = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'fback1' }, content: [
          { type: 'text', text: 'Back to ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      // 1. Blockquote
      { type: 'heading', attrs: { level: 1, blockId: 'blockquote' }, content: [{ type: 'text', text: 'Blockquotes' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '> space' },
          { type: 'text', text: ' or ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/quote' },
          { type: 'text', text: ' to create a quote block:' }
        ]
      },
      {
        type: 'blockquote', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Good notes are not about recording everything, but capturing what sparks thinking.' }] }
        ]
      },
      // 2. Callouts
      { type: 'heading', attrs: { level: 1, blockId: 'callouts' }, content: [{ type: 'text', text: 'Callout Blocks' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/callout' },
          { type: 'text', text: ' to choose types (note/tip/warning/danger):' }
        ]
      },
      { type: 'callout', attrs: { type: 'note', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Note: Default blue style for general information' }] }
      ] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Tip: Green style for helpful suggestions' }] }
      ] },
      { type: 'callout', attrs: { type: 'warning', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Warning: Yellow style for important notices' }] }
      ] },
      { type: 'callout', attrs: { type: 'danger', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Danger: Red style for critical warnings' }] }
      ] },
      // 3. Toggle
      { type: 'heading', attrs: { level: 1, blockId: 'toggle' }, content: [{ type: 'text', text: 'Toggle Blocks' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/toggle' },
          { type: 'text', text: ' to create collapsible content:' }
        ]
      },
      {
        type: 'toggle', attrs: { summary: 'Click to expand', collapsed: true }, content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Toggle blocks hide long content, keeping notes tidy.' }] },
          {
            type: 'bulletList', content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Great for detailed explanations' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Perfect for FAQ sections' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ideal for code examples' }] }] }
            ]
          }
        ]
      },
      // 4. Code Blocks
      { type: 'heading', attrs: { level: 1, blockId: 'codblk' }, content: [{ type: 'text', text: 'Code Blocks' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '```' },
          { type: 'text', text: ' or ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/code' },
          { type: 'text', text: ' to create a code block:' }
        ]
      },
      { type: 'codeBlock', attrs: { language: 'javascript', blockId: 'codex1' }, content: [{ type: 'text', text: '// Syntax highlighting\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet("Flow");' }] },
      // 5. Math Formulas
      { type: 'heading', attrs: { level: 1, blockId: 'math' }, content: [{ type: 'text', text: 'Math Formulas' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '$formula$' },
          { type: 'text', text: ' for inline math: ' },
          { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
          { type: 'text', text: ', or type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/math' },
          { type: 'text', text: ' to insert.' }
        ]
      },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'More examples: ' },
          { type: 'inlineMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } },
          { type: 'text', text: ', ' },
          { type: 'inlineMath', attrs: { latex: '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' } }
        ]
      },
      // 6. Tables (moved here from later position)
      { type: 'heading', attrs: { level: 1, blockId: 'tblsec' }, content: [{ type: 'text', text: 'Tables' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/table' },
          { type: 'text', text: ' to insert a table:' }
        ]
      },
      {
        type: 'table', content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Description' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4 types' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collapsible' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Diagram' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/mermaid' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Flowcharts' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/footnote' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '⌘⇧F' }] }] }
            ]
          }
        ]
      },
      // 7. Images
      { type: 'heading', attrs: { level: 1, blockId: 'imgdemo' }, content: [{ type: 'text', text: 'Images' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paste images or drag files into the editor. Images are saved locally. Supports resizing and alignment.' }] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Try pasting an image here, or drag one from your file manager!' }] }
      ] },
      // 8. Mermaid Diagrams
      { type: 'heading', attrs: { level: 1, blockId: 'mermaid' }, content: [{ type: 'text', text: 'Mermaid Diagrams' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/mermaid' },
          { type: 'text', text: ' to insert a diagram. Double-click to edit:' }
        ]
      },
      { type: 'mermaid', attrs: { code: 'graph LR\n    A[Idea] --> B{Worth noting?}\n    B -->|Yes| C[Write it down]\n    B -->|No| D[Skip]\n    C --> E[Review regularly]\n    E --> A' } },
      // 9. Dataview Queries
      { type: 'heading', attrs: { level: 1, blockId: 'dataview' }, content: [{ type: 'text', text: 'Dataview Queries' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/dataview' },
          { type: 'text', text: ' to create data query blocks with LIST and TABLE output:' }
        ]
      },
      { type: 'dataviewBlock', attrs: { code: 'LIST\nFROM ""\nWHERE is_favorite = true\nLIMIT 5', blockId: 'dvblk1' } },
      { type: 'heading', attrs: { level: 1, blockId: 'transclusion' }, content: [{ type: 'text', text: 'Transclusion' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/transclusion' },
          { type: 'text', text: ' to embed content from other notes with live sync.' }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'embed' }, content: [{ type: 'text', text: 'Web Embeds' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Type ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/embed' },
          { type: 'text', text: ' to embed web pages, videos, and external content.' }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'importexport' }, content: [{ type: 'text', text: 'Import & Export' }] },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'Click the ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '⋯' },
          { type: 'text', text: ' menu in the top-right corner:' }
        ]
      },
      {
        type: 'bulletList', content: [
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Export' },
                { type: 'text', text: ': PDF and Markdown formats' }
              ]
            }]
          },
          {
            type: 'listItem', content: [{
              type: 'paragraph', content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Import' },
                { type: 'text', text: ': Markdown, PDF parsing, arXiv papers' }
              ]
            }]
          }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'See ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }], text: t.note3Title },
          { type: 'text', text: ' for more shortcuts.' }
        ]
      }
    ]
  }

  const featuresContent = isZh ? featuresContentZh : featuresContentEn

  // 笔记 3: 快捷键速查表 - 中文版
  const shortcutsContentZh = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'scback1' }, content: [
          { type: 'text', text: '返回 ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      {
        type: 'callout', attrs: { type: 'tip', collapsed: false, blockId: 'tip001' }, content: [
          {
            type: 'paragraph', content: [
              { type: 'text', marks: [{ type: 'bold' }], text: '提示：' },
              { type: 'text', text: '这个段落可以被其他笔记引用！语法：' },
              { type: 'text', marks: [{ type: 'code' }], text: `[[${t.note3Title}#^tip001]]` }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'txtfmt' }, content: [{ type: 'text', text: '文字格式' }] },
      {
        type: 'table', attrs: { blockId: 'fmttbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '粗体' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ B' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '斜体' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ I' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '下划线' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ U' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '删除线' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ S' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '高亮' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ H' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '行内代码' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ E' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '脚注' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ F' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'editop' }, content: [{ type: 'text', text: '编辑操作' }] },
      {
        type: 'table', attrs: { blockId: 'edttbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '撤销' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ Z' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '重做' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ Z' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '保存' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ S' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'qkinpt' }, content: [{ type: 'text', text: '快捷输入' }] },
      {
        type: 'table', content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '输入' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '效果' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '打开命令菜单' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[[' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '插入笔记链接' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '# Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一级标题' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '- Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '1. Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序列表' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[] Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '任务列表' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用块' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '代码块' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '---' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '分割线' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'navop' }, content: [{ type: 'text', text: '导航操作' }] },
      {
        type: 'table', attrs: { blockId: 'navtbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新建笔记' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ N' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新建标签页' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ T' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '关闭标签页' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ W' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '搜索笔记' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ P' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '全局搜索' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ F' }] }] }
            ]
          }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: '更多功能见 ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }], text: t.note2Title }
        ]
      }
    ]
  }

  // 笔记 3: 快捷键速查表 - 英文版
  const shortcutsContentEn = {
    type: 'doc',
    content: [
      {
        type: 'paragraph', attrs: { blockId: 'scback1' }, content: [
          { type: 'text', text: 'Back to ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
        ]
      },
      {
        type: 'callout', attrs: { type: 'tip', collapsed: false, blockId: 'tip001' }, content: [
          {
            type: 'paragraph', content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Tip: ' },
              { type: 'text', text: 'This paragraph can be referenced by other notes! Syntax: ' },
              { type: 'text', marks: [{ type: 'code' }], text: `[[${t.note3Title}#^tip001]]` }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'txtfmt' }, content: [{ type: 'text', text: 'Text Formatting' }] },
      {
        type: 'table', attrs: { blockId: 'fmttbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ B' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Italic' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ I' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Underline' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ U' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Strikethrough' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ S' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Highlight' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ H' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inline Code' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ E' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ F' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'editop' }, content: [{ type: 'text', text: 'Editing' }] },
      {
        type: 'table', attrs: { blockId: 'edttbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Undo' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ Z' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Redo' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ Z' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Save' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ S' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'qkinpt' }, content: [{ type: 'text', text: 'Quick Input' }] },
      {
        type: 'table', content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Input' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Result' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open command menu' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[[' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Insert note link' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '# Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heading 1' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '- Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet list' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '1. Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbered list' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[] Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task list' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> Space' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Blockquote' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Code block' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '---' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Divider' }] }] }
            ]
          }
        ]
      },
      { type: 'heading', attrs: { level: 1, blockId: 'navop' }, content: [{ type: 'text', text: 'Navigation' }] },
      {
        type: 'table', attrs: { blockId: 'navtbl' }, content: [
          {
            type: 'tableRow', content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New note' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ N' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New tab' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ T' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Close tab' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ W' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Search notes' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ P' }] }] }
            ]
          },
          {
            type: 'tableRow', content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Global search' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ F' }] }] }
            ]
          }
        ]
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph', content: [
          { type: 'text', text: 'See ' },
          { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }], text: t.note2Title },
          { type: 'text', text: ' for more features.' }
        ]
      }
    ]
  }

  const shortcutsContent = isZh ? shortcutsContentZh : shortcutsContentEn

  // 插入三个笔记
  const insertStmt = db.prepare(`
    INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertStmt.run(note1Id, t.note1Title, JSON.stringify(mainContent), null, 0, null, 0, 1, now, now)
  insertStmt.run(note2Id, t.note2Title, JSON.stringify(featuresContent), null, 0, null, 0, 0, now, now)
  insertStmt.run(note3Id, t.note3Title, JSON.stringify(shortcutsContent), null, 0, null, 0, 0, now, now)
}

// 保留旧函数名作为别名，保持兼容
export function createDemoNote(): void {
  createDemoNotes()
}

// ============ Notes ============

/** Parse tags JSON string from SQL query */
function parseTags(tagsJson: string | null): TagWithSource[] {
  if (!tagsJson) return []
  try {
    const tags = JSON.parse(tagsJson) as Array<{ id: string; name: string; source: string }>
    // Filter out null entries (from LEFT JOIN with no tags)
    return tags.filter(t => t.id !== null).map(t => ({
      id: t.id,
      name: t.name,
      source: t.source === 'ai' ? 'ai' : 'user' // fallback to 'user' for invalid values
    }))
  } catch {
    return []
  }
}

/** SQL subquery for aggregating tags as JSON */
const TAGS_SUBQUERY = `(
  SELECT JSON_GROUP_ARRAY(JSON_OBJECT('id', t.id, 'name', t.name, 'source', COALESCE(nt.source, 'user')))
  FROM note_tags nt
  JOIN tags t ON t.id = nt.tag_id
  WHERE nt.note_id = n.id
) as tags_json`

/** Common SELECT columns for Note queries */
const NOTE_SELECT_COLUMNS = `n.id, n.title, n.content, n.notebook_id, n.is_daily, n.daily_date,
  n.is_favorite, n.is_pinned, n.created_at, n.updated_at, n.deleted_at, n.ai_summary,
  ${TAGS_SUBQUERY}`

/** Convert database row to Note object */
function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    notebook_id: row.notebook_id as string | null,
    is_daily: Boolean(row.is_daily),
    daily_date: row.daily_date as string | null,
    is_favorite: Boolean(row.is_favorite),
    is_pinned: Boolean(row.is_pinned),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: row.deleted_at as string | null,
    ai_summary: row.ai_summary as string | null,
    tags: parseTags(row.tags_json as string | null),
  }
}

export function getNotes(limit = 1000, offset = 0): Note[] {
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NULL
    ORDER BY n.is_pinned DESC, n.updated_at DESC
    LIMIT ? OFFSET ?
  `)
  return stmt.all(limit, offset).map(row => rowToNote(row as Record<string, unknown>))
}

export function getNoteById(id: string): Note | null {
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.id = ?
  `)
  const row = stmt.get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToNote(row)
}

export function getNotesByIds(ids: string[]): Note[] {
  if (ids.length === 0) return []

  // 使用 IN 查询批量获取，保持传入顺序
  const placeholders = ids.map(() => '?').join(',')
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.id IN (${placeholders})
  `)
  const rows = stmt.all(...ids) as Array<Record<string, unknown>>

  // 按传入的 ids 顺序排序
  const noteMap = new Map(rows.map(row => [row.id as string, row]))
  return ids
    .map(id => noteMap.get(id))
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .map(rowToNote)
}

export function addNote(input: NoteInput): Note {
  const id = uuidv4()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    input.title,
    input.content,
    input.notebook_id ?? null,
    input.is_daily ? 1 : 0,
    input.daily_date ?? null,
    input.is_favorite ? 1 : 0,
    input.is_pinned ? 1 : 0,
    now,
    now
  )

  const note = getNoteById(id)
  if (!note) throw new Error(`Failed to create note with id ${id}`)
  return note
}

export function updateNote(id: string, updates: Partial<NoteInput>): Note | null {
  const existing = getNoteById(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE notes
    SET title = ?, content = ?, notebook_id = ?, is_daily = ?, daily_date = ?, is_favorite = ?, is_pinned = ?, updated_at = ?
    WHERE id = ?
  `)

  stmt.run(
    updates.title ?? existing.title,
    updates.content ?? existing.content,
    updates.notebook_id !== undefined ? updates.notebook_id : existing.notebook_id,
    updates.is_daily !== undefined ? (updates.is_daily ? 1 : 0) : (existing.is_daily ? 1 : 0),
    updates.daily_date !== undefined ? updates.daily_date : existing.daily_date,
    updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (existing.is_favorite ? 1 : 0),
    updates.is_pinned !== undefined ? (updates.is_pinned ? 1 : 0) : (existing.is_pinned ? 1 : 0),
    now,
    id
  )

  return getNoteById(id)
}

// Soft delete - move to trash
export function deleteNote(id: string): boolean {
  const now = new Date().toISOString()
  const stmt = db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
  const result = stmt.run(now, id)
  return result.changes > 0
}

// ============ Trash (回收站) ============

// Get all notes in trash
export function getTrashNotes(): Note[] {
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NOT NULL
    ORDER BY n.deleted_at DESC
  `)
  return stmt.all().map(row => rowToNote(row as Record<string, unknown>))
}

// Restore note from trash
export function restoreNote(id: string): boolean {
  const stmt = db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
  const result = stmt.run(id)
  return result.changes > 0
}

// Permanently delete note
export function permanentlyDeleteNote(id: string): boolean {
  const stmt = db.prepare('DELETE FROM notes WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// Empty trash (delete all notes in trash)
export function emptyTrash(): number {
  const stmt = db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL')
  const result = stmt.run()
  return result.changes
}

// Auto cleanup: delete notes that have been in trash for more than TRASH_RETENTION_DAYS
export function cleanupOldTrash(): number {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - TRASH_RETENTION_DAYS)

  const stmt = db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?')
  const result = stmt.run(cutoffDate.toISOString())
  return result.changes
}

export function searchNotes(
  query: string,
  filter?: NoteSearchFilter,
  limit = 100,
  offset = 0
): Note[] {
  if (!query.trim()) return []

  // Use LIKE search for better CJK support
  // FTS5's built-in tokenizers don't handle Chinese well
  const escaped = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const likeQuery = `%${escaped}%`

  // Enforce maximum limit to prevent performance issues with large datasets
  const actualLimit = Math.min(limit, 100)

  // Build WHERE conditions based on filter
  const conditions: string[] = [
    'n.deleted_at IS NULL',
    `(n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\' OR n.ai_summary LIKE ? ESCAPE '\\')`
  ]
  const params: (string | number)[] = [likeQuery, likeQuery, likeQuery]

  // Apply filter conditions
  if (filter?.notebookId) {
    // Notebook filter: only notes from this notebook (excluding daily notes)
    conditions.push('n.notebook_id = ?')
    conditions.push('n.is_daily = 0')
    params.push(filter.notebookId)
  } else if (filter?.viewType) {
    switch (filter.viewType) {
      case 'daily':
        conditions.push('n.is_daily = 1')
        break
      case 'favorites':
        conditions.push('n.is_favorite = 1')
        break
      case 'recent': {
        const recentThreshold = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
        conditions.push('n.is_daily = 0')
        conditions.push('n.updated_at > ?')
        params.push(recentThreshold)
        break
      }
      case 'all':
      default:
        // All notes excludes daily notes
        conditions.push('n.is_daily = 0')
        break
    }
  }

  const sql = `
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE ${conditions.join(' AND ')}
    ORDER BY n.is_pinned DESC, n.updated_at DESC
    LIMIT ? OFFSET ?
  `
  params.push(actualLimit, offset)

  const stmt = db.prepare(sql)
  return stmt.all(...params).map(row =>
    rowToNote(row as Record<string, unknown>)
  )
}

// ============ Daily Notes ============

export function getDailyByDate(date: string): Note | null {
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NULL AND n.is_daily = 1 AND n.daily_date = ?
  `)
  const row = stmt.get(date)
  if (!row) return null
  return rowToNote(row as Record<string, unknown>)
}

/**
 * Parse template variables in text (simplified version for backend)
 * Supports:
 * - Basic: {{title}}, {{notebook}}, {{cursor}}
 * - Date/Time: {{date}}, {{time}}, {{datetime}}, {{week}}
 * - Date with offset: {{date-7}}, {{date+3}}
 * - Relative: {{yesterday}}, {{tomorrow}}
 * - Daily note specific: {{daily_date}}, {{daily_date-1}}, {{daily_week}}
 */
function parseTemplateVariables(
  text: string,
  context: { title: string; dailyDate?: string }
): string {
  const now = dayjs()
  // For daily notes, use the target date; otherwise use today
  const dailyDate = context.dailyDate ? dayjs(context.dailyDate) : now

  // Match {{variable}}, {{variable±N}}, or {{variable±N:format}}
  return text.replace(/\{\{(\w+)([+-]\d+)?(?::([^}]+))?\}\}/g, (match, variable, offset, format) => {
    const varLower = variable.toLowerCase()
    const offsetDays = offset ? parseInt(offset, 10) : 0

    switch (varLower) {
      // Note Info
      case 'title':
        return context.title || ''
      case 'notebook':
        return '' // 后端模板解析仅用于日记创建，不传入笔记本信息

      // Current Date/Time (with optional offset)
      case 'date': {
        const targetDate = offsetDays !== 0 ? now.add(offsetDays, 'day') : now
        return targetDate.format(format || 'YYYY-MM-DD')
      }
      case 'time':
        return now.format(format || 'HH:mm')
      case 'datetime':
        return now.format(format || 'YYYY-MM-DD HH:mm')

      // Week Number
      case 'week':
        return now.format(format || 'WW')

      // Relative Dates
      case 'yesterday':
        return now.subtract(1, 'day').format(format || 'YYYY-MM-DD')
      case 'tomorrow':
        return now.add(1, 'day').format(format || 'YYYY-MM-DD')

      // Daily Note Specific (with optional offset)
      case 'daily_date': {
        const targetDate = offsetDays !== 0 ? dailyDate.add(offsetDays, 'day') : dailyDate
        return targetDate.format(format || 'YYYY-MM-DD')
      }
      case 'daily_yesterday':
        return dailyDate.subtract(1, 'day').format(format || 'YYYY-MM-DD')
      case 'daily_tomorrow':
        return dailyDate.add(1, 'day').format(format || 'YYYY-MM-DD')
      case 'daily_week':
        return dailyDate.format(format || 'WW')

      // Cursor: use invisible separator as placeholder, frontend will handle it
      case 'cursor':
        return '\u2063'

      default:
        return match
    }
  })
}

/**
 * Parse template content (Markdown) with variables
 */
function parseTemplateContent(
  markdownContent: string,
  context: { title: string; dailyDate?: string }
): string {
  return parseTemplateVariables(markdownContent, context)
}

export function createDaily(date: string, title?: string): Note {
  // Check if already exists
  const existing = getDailyByDate(date)
  if (existing) return existing

  // Get daily default template
  const dailyTemplate = getDailyDefaultTemplate()
  let content = '[]'

  if (dailyTemplate) {
    // Parse template variables with title and dailyDate context
    // dailyDate is the target date for this daily note (may differ from today)
    const markdown = parseTemplateContent(dailyTemplate.content, {
      title: title || '',
      dailyDate: date,
    })
    // Convert markdown to Tiptap JSON
    content = markdownToTiptapString(markdown)
  }

  return addNote({
    title: title || '',
    content,
    is_daily: true,
    daily_date: date,
    is_favorite: false
  })
}

// ============ Notebooks ============

export function getNotebooks(): Notebook[] {
  const stmt = db.prepare('SELECT * FROM notebooks ORDER BY order_index')
  return stmt.all() as Notebook[]
}

export function addNotebook(input: NotebookInput): Notebook {
  const id = uuidv4()
  const now = new Date().toISOString()

  // Get next order_index
  const maxStmt = db.prepare('SELECT MAX(order_index) as max FROM notebooks')
  const maxResult = maxStmt.get() as { max: number | null }
  const orderIndex = (maxResult.max ?? -1) + 1

  const icon = input.icon ?? 'logo:notes'

  const stmt = db.prepare(`
    INSERT INTO notebooks (id, name, icon, order_index, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  stmt.run(id, input.name, icon, orderIndex, now)

  return {
    id,
    name: input.name,
    icon,
    order_index: orderIndex,
    created_at: now,
  }
}

export function updateNotebook(id: string, updates: Partial<NotebookInput>): Notebook | null {
  const stmt = db.prepare('SELECT * FROM notebooks WHERE id = ?')
  const existing = stmt.get(id) as Notebook | undefined
  if (!existing) return null

  const updateStmt = db.prepare(`
    UPDATE notebooks SET name = ?, icon = ? WHERE id = ?
  `)

  updateStmt.run(
    updates.name ?? existing.name,
    updates.icon ?? existing.icon,
    id
  )

  const result = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as Notebook
  return result
}

export function deleteNotebook(id: string): boolean {
  const stmt = db.prepare('DELETE FROM notebooks WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// ============ Notebook Helpers ============

/**
 * Get note count for each notebook
 */
export function getNoteCountByNotebook(): Record<string, number> {
  const stmt = db.prepare(`
    SELECT notebook_id, COUNT(*) as count
    FROM notes
    WHERE deleted_at IS NULL AND notebook_id IS NOT NULL
    GROUP BY notebook_id
  `)
  const rows = stmt.all() as { notebook_id: string; count: number }[]
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.notebook_id] = row.count
  }
  return result
}

/**
 * Move a note to a different notebook
 */
export function moveNote(noteId: string, notebookId: string | null): boolean {
  const stmt = db.prepare('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL')
  const note = stmt.get(noteId) as { id: string } | undefined
  if (!note) return false

  // 检查目标笔记本是否存在
  if (notebookId !== null) {
    const nbStmt = db.prepare('SELECT id FROM notebooks WHERE id = ?')
    const notebook = nbStmt.get(notebookId)
    if (!notebook) return false
  }

  const updateStmt = db.prepare('UPDATE notes SET notebook_id = ?, updated_at = ? WHERE id = ?')
  updateStmt.run(notebookId, new Date().toISOString(), noteId)
  return true
}

// ============ Tags ============

export function getTags(): Tag[] {
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name')
  return stmt.all() as Tag[]
}

export function getTagsByNote(noteId: string): TagWithSource[] {
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
  // Get or create tag
  let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName) as Tag | undefined

  if (!tag) {
    const id = uuidv4()
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, tagName)
    tag = { id, name: tagName }
  }

  // Link tag to note
  db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tag.id)

  return tag
}

export function removeTagFromNote(noteId: string, tagId: string): void {
  db.prepare('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?').run(noteId, tagId)
}

/**
 * Add AI-generated tag to note
 * Creates tag if not exists, links with source='ai'
 */
export function addAITagToNote(noteId: string, tagName: string): Tag | null {
  // Get or create tag
  let tag = db.prepare('SELECT * FROM tags WHERE name = ?').get(tagName) as Tag | undefined

  if (!tag) {
    const id = uuidv4()
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, tagName)
    tag = { id, name: tagName }
  }

  // Check if user already has this tag (don't override user tags)
  const existing = db.prepare(
    'SELECT source FROM note_tags WHERE note_id = ? AND tag_id = ?'
  ).get(noteId, tag.id) as { source: string } | undefined

  if (existing?.source === 'user') {
    // User tag takes precedence, skip AI tag
    return null
  }

  // Link tag to note with source='ai'
  db.prepare("INSERT OR REPLACE INTO note_tags (note_id, tag_id, source) VALUES (?, ?, 'ai')").run(noteId, tag.id)

  return tag
}

/**
 * Remove all AI-generated tags from a note
 * Called before regenerating AI tags
 */
export function removeAITagsFromNote(noteId: string): void {
  db.prepare("DELETE FROM note_tags WHERE note_id = ? AND source = 'ai'").run(noteId)
}

/**
 * Update AI tags for a note (removes old AI tags, adds new ones)
 */
export function updateAITags(noteId: string, tagNames: string[]): void {
  db.transaction(() => {
    removeAITagsFromNote(noteId)
    for (const name of tagNames) {
      if (name.trim()) {
        addAITagToNote(noteId, name.trim())
      }
    }
  })()
}

// ============ AI Summary ============

export interface NoteSummaryInfo {
  ai_summary: string | null
  summary_content_hash: string | null
}

/**
 * Get note summary info (for checking if regeneration needed)
 */
export function getNoteSummaryInfo(noteId: string): NoteSummaryInfo | null {
  const stmt = db.prepare('SELECT ai_summary, summary_content_hash FROM notes WHERE id = ?')
  const row = stmt.get(noteId) as NoteSummaryInfo | undefined
  return row || null
}

/**
 * Update note AI summary
 */
export function updateNoteSummary(
  noteId: string,
  summary: string,
  contentHash: string
): boolean {
  const stmt = db.prepare(`
    UPDATE notes
    SET ai_summary = ?, summary_content_hash = ?
    WHERE id = ?
  `)
  const result = stmt.run(summary, contentHash, noteId)
  return result.changes > 0
}

// ============ Note Links (Backlinks) ============

export function addNoteLink(sourceNoteId: string, targetNoteId: string): void {
  db.prepare('INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?, ?)')
    .run(sourceNoteId, targetNoteId)
}

export function removeNoteLink(sourceNoteId: string, targetNoteId: string): void {
  db.prepare('DELETE FROM note_links WHERE source_note_id = ? AND target_note_id = ?')
    .run(sourceNoteId, targetNoteId)
}

export function getBacklinks(noteId: string): Note[] {
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    JOIN note_links nl ON nl.source_note_id = n.id
    WHERE nl.target_note_id = ? AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
  `)
  return stmt.all(noteId).map(row => rowToNote(row as Record<string, unknown>))
}

export function getOutgoingLinks(noteId: string): Note[] {
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    JOIN note_links nl ON nl.target_note_id = n.id
    WHERE nl.source_note_id = ? AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
  `)
  return stmt.all(noteId).map(row => rowToNote(row as Record<string, unknown>))
}

// Update all links for a note (called when note content changes)
export function updateNoteLinks(noteId: string, targetNoteIds: string[]): void {
  const deleteStmt = db.prepare('DELETE FROM note_links WHERE source_note_id = ?')
  const insertStmt = db.prepare('INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?, ?)')

  db.transaction(() => {
    deleteStmt.run(noteId)
    for (const targetId of targetNoteIds) {
      insertStmt.run(noteId, targetId)
    }
  })()
}

// ============ Attachment References ============

/**
 * 从所有笔记中提取附件引用路径
 * 扫描 attachment:// 协议和 fileAttachment 节点中的路径
 */
export function getUsedAttachmentPaths(): string[] {
  const paths = new Set<string>()

  // 获取所有笔记内容（包括回收站中的，因为恢复后仍需要附件）
  const stmt = db.prepare('SELECT content FROM notes')
  const notes = stmt.all() as { content: string }[]

  for (const note of notes) {
    if (!note.content) continue

    // 匹配 attachment:// 协议 URL
    // 格式: attachment://attachments/2024/12/xxx.png
    const attachmentUrlRegex = /attachment:\/\/([^"'\s)]+)/g
    let match
    while ((match = attachmentUrlRegex.exec(note.content)) !== null) {
      paths.add(match[1])
    }

    // 匹配 fileAttachment 节点的 src 属性
    // 格式: "src":"attachments/2024/12/xxx.pdf"
    const srcRegex = /"src"\s*:\s*"(attachments\/[^"]+)"/g
    while ((match = srcRegex.exec(note.content)) !== null) {
      paths.add(match[1])
    }
  }

  return Array.from(paths)
}

// ============================================
// AI Actions
// ============================================

// Get default builtin AI actions (localized based on system language)
function getDefaultAIActions() {
  const actions = t().aiActions
  return [
    {
      id: 'builtin-improve',
      name: actions.improve.name,
      description: actions.improve.description,
      icon: '✏️',
      prompt: actions.improve.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-simplify',
      name: actions.simplify.name,
      description: actions.simplify.description,
      icon: '📐',
      prompt: actions.simplify.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-expand',
      name: actions.expand.name,
      description: actions.expand.description,
      icon: '📖',
      prompt: actions.expand.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-translate',
      name: actions.translate.name,
      description: actions.translate.description,
      icon: '🌐',
      prompt: actions.translate.prompt,
      mode: 'replace' as const
    },
    {
      id: 'builtin-summarize',
      name: actions.summarize.name,
      description: actions.summarize.description,
      icon: '📋',
      prompt: actions.summarize.prompt,
      mode: 'popup' as const
    },
    {
      id: 'builtin-explain',
      name: actions.explain.name,
      description: actions.explain.description,
      icon: '💡',
      prompt: actions.explain.prompt,
      mode: 'popup' as const
    }
  ]
}

/**
 * Initialize default AI actions if none exist
 */
export function initDefaultAIActions(): void {
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

/**
 * Get all AI actions sorted by order
 */
export function getAIActions(): AIAction[] {
  const stmt = db.prepare('SELECT * FROM ai_actions WHERE enabled = 1 ORDER BY order_index ASC')
  const rows = stmt.all() as AIActionRow[]

  return rows.map(row => ({
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
  }))
}

/**
 * Get all AI actions including disabled ones (for settings)
 */
export function getAllAIActions(): AIAction[] {
  const stmt = db.prepare('SELECT * FROM ai_actions ORDER BY order_index ASC')
  const rows = stmt.all() as AIActionRow[]

  return rows.map(row => ({
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
  }))
}

/**
 * Get a single AI action by ID
 */
export function getAIAction(id: string): AIAction | null {
  const stmt = db.prepare('SELECT * FROM ai_actions WHERE id = ?')
  const row = stmt.get(id) as AIActionRow | undefined

  if (!row) return null

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
 * Create a new AI action
 */
export function createAIAction(input: AIActionInput): AIAction {
  const id = uuidv4()
  const now = new Date().toISOString()

  // Get max order index
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

/**
 * Update an AI action
 */
export function updateAIAction(id: string, updates: Partial<AIActionInput> & { enabled?: boolean }): AIAction | null {
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

/**
 * Delete an AI action (only non-builtin)
 */
export function deleteAIAction(id: string): boolean {
  const existing = getAIAction(id)
  if (!existing || existing.isBuiltin) return false

  db.prepare('DELETE FROM ai_actions WHERE id = ? AND is_builtin = 0').run(id)
  return true
}

/**
 * Reorder AI actions
 */
export function reorderAIActions(orderedIds: string[]): void {
  const stmt = db.prepare('UPDATE ai_actions SET order_index = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()

  orderedIds.forEach((id, index) => {
    stmt.run(index, now, id)
  })
}

/**
 * Reset AI actions to defaults
 */
export function resetAIActionsToDefaults(): void {
  db.prepare('DELETE FROM ai_actions').run()
  initDefaultAIActions()
}

// ============================================================================
// AI Popup CRUD Operations
// ============================================================================

export interface PopupData {
  id: string
  content: string
  prompt: string
  actionName: string
  targetText: string
  documentTitle: string
  createdAt: string
  updatedAt: string
}

export interface PopupInput {
  id: string
  prompt: string
  actionName?: string
  targetText: string
  documentTitle?: string
}

/**
 * Get a popup by ID
 */
export function getPopup(id: string): PopupData | null {
  const row = db.prepare('SELECT * FROM ai_popups WHERE id = ?').get(id) as {
    id: string
    content: string
    prompt: string
    action_name: string
    target_text: string
    document_title: string
    created_at: string
    updated_at: string
  } | undefined

  if (!row) return null

  return {
    id: row.id,
    content: row.content,
    prompt: row.prompt,
    actionName: row.action_name,
    targetText: row.target_text,
    documentTitle: row.document_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Create a new popup
 */
export function createPopup(input: PopupInput): PopupData {
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
    VALUES (?, '', ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.prompt,
    input.actionName || '',
    input.targetText,
    input.documentTitle || '',
    now,
    now
  )

  return getPopup(input.id)!
}

/**
 * Update popup content (used during streaming)
 */
export function updatePopupContent(id: string, content: string): boolean {
  const now = new Date().toISOString()
  const result = db.prepare('UPDATE ai_popups SET content = ?, updated_at = ? WHERE id = ?').run(content, now, id)
  return result.changes > 0
}

/**
 * Delete a popup
 */
export function deletePopup(id: string): boolean {
  const result = db.prepare('DELETE FROM ai_popups WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Cleanup old popups (default: 30 days)
 */
export function cleanupPopups(maxAgeDays = 30): number {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays)
  const cutoffStr = cutoffDate.toISOString()

  const result = db.prepare('DELETE FROM ai_popups WHERE created_at < ?').run(cutoffStr)
  return result.changes
}

// ============ Agent Task Functions ============

interface AgentTaskRow {
  id: string
  block_id: string
  page_id: string
  notebook_id: string | null
  content: string
  additional_prompt: string | null
  agent_mode: string
  agent_id: string | null
  agent_name: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  steps: string | null
  result: string | null
  error: string | null
  output_block_id: string | null
  process_mode: string
  output_format: string
  run_timing: string
  schedule_config: string | null
  created_at: string
  updated_at: string
}

function rowToAgentTask(row: AgentTaskRow): AgentTaskRecord {
  return {
    id: row.id,
    blockId: row.block_id,
    pageId: row.page_id,
    notebookId: row.notebook_id,
    content: row.content,
    additionalPrompt: row.additional_prompt,
    agentMode: row.agent_mode as 'auto' | 'specified',
    agentId: row.agent_id,
    agentName: row.agent_name,
    status: row.status as 'idle' | 'running' | 'completed' | 'failed',
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    steps: row.steps,
    result: row.result,
    error: row.error,
    outputBlockId: row.output_block_id,
    processMode: (row.process_mode || 'append') as 'append' | 'replace',
    outputFormat: (row.output_format || 'auto') as 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote',
    runTiming: (row.run_timing || 'manual') as 'manual' | 'immediate' | 'scheduled',
    scheduleConfig: row.schedule_config,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Get an agent task by ID
 */
export function getAgentTask(id: string): AgentTaskRecord | null {
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as AgentTaskRow | undefined
  if (!row) return null
  return rowToAgentTask(row)
}

/**
 * Get an agent task by block ID
 */
export function getAgentTaskByBlockId(blockId: string): AgentTaskRecord | null {
  const row = db.prepare('SELECT * FROM agent_tasks WHERE block_id = ?').get(blockId) as AgentTaskRow | undefined
  if (!row) return null
  return rowToAgentTask(row)
}

/**
 * Create a new agent task
 */
export function createAgentTask(input: AgentTaskInput): AgentTaskRecord {
  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO agent_tasks (
      id, block_id, page_id, notebook_id, content, additional_prompt,
      agent_mode, agent_id, agent_name, status, process_mode, output_format,
      run_timing, schedule_config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.blockId,
    input.pageId,
    input.notebookId ?? null,
    input.content,
    input.additionalPrompt ?? null,
    input.agentMode ?? 'auto',
    input.agentId ?? null,
    input.agentName ?? null,
    input.processMode ?? 'append',
    input.outputFormat ?? 'auto',
    input.runTiming ?? 'manual',
    input.scheduleConfig ?? null,
    now,
    now
  )

  return getAgentTask(id)!
}

/**
 * Update an agent task
 */
export function updateAgentTask(id: string, updates: Partial<AgentTaskRecord>): AgentTaskRecord | null {
  const existing = getAgentTask(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const fields: string[] = []
  const values: unknown[] = []

  // Map camelCase to snake_case
  const fieldMap: Record<string, string> = {
    blockId: 'block_id',
    pageId: 'page_id',
    notebookId: 'notebook_id',
    additionalPrompt: 'additional_prompt',
    agentMode: 'agent_mode',
    agentId: 'agent_id',
    agentName: 'agent_name',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    durationMs: 'duration_ms',
    outputBlockId: 'output_block_id',
    processMode: 'process_mode',
    outputFormat: 'output_format',
    runTiming: 'run_timing',
    scheduleConfig: 'schedule_config'
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
    const dbField = fieldMap[key] || key
    fields.push(`${dbField} = ?`)
    values.push(value)
  }

  if (fields.length === 0) return existing

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)

  db.prepare(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getAgentTask(id)
}

/**
 * Delete an agent task by ID
 */
export function deleteAgentTask(id: string): boolean {
  const result = db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Delete an agent task by block ID
 */
export function deleteAgentTaskByBlockId(blockId: string): boolean {
  const result = db.prepare('DELETE FROM agent_tasks WHERE block_id = ?').run(blockId)
  return result.changes > 0
}

// ============================================
// App Settings (General key-value storage)
// ============================================

/**
 * Get a setting value by key
 */
export function getAppSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

/**
 * Set a setting value
 */
export function setAppSetting(key: string, value: string): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
  ).run(key, value, now)
}

/**
 * Delete a setting
 */
export function deleteAppSetting(key: string): boolean {
  const result = db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
  return result.changes > 0
}

// ============================================
// Templates
// ============================================

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

/**
 * Get all templates ordered by order_index
 */
export function getAllTemplates(): Template[] {
  const rows = db.prepare('SELECT * FROM templates ORDER BY order_index').all() as TemplateRow[]
  return rows.map(rowToTemplate)
}

/**
 * Get a template by ID
 */
export function getTemplate(id: string): Template | null {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined
  return row ? rowToTemplate(row) : null
}

/**
 * Get the daily default template
 */
export function getDailyDefaultTemplate(): Template | null {
  const row = db.prepare('SELECT * FROM templates WHERE is_daily_default = 1').get() as TemplateRow | undefined
  return row ? rowToTemplate(row) : null
}

/**
 * Create a new template
 */
export function createTemplate(input: TemplateInput): Template {
  const id = uuidv4()
  const now = new Date().toISOString()
  const maxOrder = db.prepare('SELECT MAX(order_index) as max FROM templates').get() as { max: number | null }
  const orderIndex = (maxOrder?.max ?? -1) + 1

  // If setting as daily default, clear others first
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

/**
 * Update an existing template
 */
export function updateTemplate(id: string, updates: Partial<TemplateInput>): Template | null {
  const existing = getTemplate(id)
  if (!existing) return null

  const now = new Date().toISOString()

  // If setting as daily default, clear others first
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

/**
 * Delete a template
 */
export function deleteTemplate(id: string): boolean {
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Reorder templates
 */
export function reorderTemplates(orderedIds: string[]): void {
  const stmt = db.prepare('UPDATE templates SET order_index = ? WHERE id = ?')
  const updateMany = db.transaction((ids: string[]) => {
    ids.forEach((id, index) => {
      stmt.run(index, id)
    })
  })
  updateMany(orderedIds)
}

/**
 * Set daily default template (pass null to clear)
 */
export function setDailyDefaultTemplate(id: string | null): void {
  db.prepare('UPDATE templates SET is_daily_default = 0').run()
  if (id) {
    db.prepare('UPDATE templates SET is_daily_default = 1 WHERE id = ?').run(id)
  }
}

/**
 * Get default template content based on language
 */
function getDefaultTemplateContent(): { content: string; name: string; description: string } {
  // Use user's app locale instead of system locale
  const lang = getAppLocale()
  const isZh = lang === 'zh'

  const content = isZh
    ? `## 日记 & 随想
-


## 今日任务
**重要**:
[ ]


**待办**:
[ ] {{cursor}}


## 杂项 & 日常
[ ]

___

## 今日笔记

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
    name: isZh ? '日记' : 'Daily',
    description: isZh ? '每日日记模板' : 'Daily journal template'
  }
}

/**
 * Initialize default templates if none exist
 */
export function initDefaultTemplates(): void {
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

/**
 * Reset templates to defaults
 */
export function resetTemplatesToDefaults(): void {
  db.prepare('DELETE FROM templates').run()
  initDefaultTemplates()
}
