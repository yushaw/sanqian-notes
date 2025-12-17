import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

// Constants
export const TRASH_RETENTION_DAYS = 30

let db: Database.Database


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
  `)

  // Create demo note for new databases
  if (isNewDb) {
    createDemoNote()
  }

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
}

export function createDemoNotes(): void {
  const now = new Date().toISOString()

  // 创建三个互相关联的 demo 笔记
  const note1Id = uuidv4()
  const note2Id = uuidv4()
  const note3Id = uuidv4()

  // 笔记 1: 主演示笔记（包含双向链接到其他笔记，以及标题/Block链接）
  const mainContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'welcome1' },
        content: [{ type: 'text', text: '欢迎使用三千笔记' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'intro01' },
        content: [
          { type: 'text', text: '这是一篇入门指南，帮助你快速了解编辑器的功能。你可以查看 ' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: 'Markdown 语法参考' } }],
            text: 'Markdown 语法参考'
          },
          { type: 'text', text: ' 了解所有支持的格式，或者阅读 ' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: '快捷键速查表' } }],
            text: '快捷键速查表'
          },
          { type: 'text', text: ' 提高效率。' }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'bilink1' },
        content: [{ type: 'text', text: '双向链接' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'bilink2' },
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '[[' },
          { type: 'text', text: ' 可以快速创建笔记间的链接。这是构建知识网络的核心功能。' }
        ]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'bilink3' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '输入 [[ 后会弹出笔记搜索' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '用上下键选择，回车确认' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '如果笔记不存在，可以直接创建' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '点击链接可跳转到对应笔记' }] }] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'blocklk' },
        content: [{ type: 'text', text: 'Block 级链接（新功能）' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'blk001' },
        content: [
          { type: 'text', text: '现在支持链接到笔记中的特定标题或段落！试试点击下面的链接：' }
        ]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'blk002' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', text: '链接到标题：' },
            {
              type: 'text',
              marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: 'Markdown 语法参考', targetType: 'heading', targetValue: '代码块' } }],
              text: 'Markdown 语法参考#代码块'
            }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', text: '链接到 Block：' },
            {
              type: 'text',
              marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: '快捷键速查表', targetType: 'block', targetValue: 'tip001' } }],
              text: '快捷键速查表#^tip001'
            }
          ] }] }
        ]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'blksyn' },
        content: [
          { type: 'text', text: '语法：' },
          { type: 'text', marks: [{ type: 'code' }], text: '[[笔记名#标题]]' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '[[笔记名#^blockId]]' }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'format1' },
        content: [{ type: 'text', text: '基础格式预览' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'format2' },
        content: [
          { type: 'text', marks: [{ type: 'bold' }], text: '粗体' },
          { type: 'text', text: '、' },
          { type: 'text', marks: [{ type: 'italic' }], text: '斜体' },
          { type: 'text', text: '、' },
          { type: 'text', marks: [{ type: 'strike' }], text: '删除线' },
          { type: 'text', text: '、' },
          { type: 'text', marks: [{ type: 'code' }], text: '行内代码' }
        ]
      },
      {
        type: 'blockquote',
        attrs: { blockId: 'quote1' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '引用样式：知识的积累在于持续记录。' }] }
        ]
      },
      {
        type: 'taskList',
        attrs: { blockId: 'tasks1' },
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '阅读本指南' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '尝试双向链接 [[' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '尝试 Block 链接 [[笔记#标题]]' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '创建你的第一篇笔记' }] }] }
        ]
      }
    ]
  }

  // 笔记 2: Markdown 语法参考（包含回链）
  const markdownContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'mdtitle' },
        content: [{ type: 'text', text: 'Markdown 语法参考' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'mdback1' },
        content: [
          { type: 'text', text: '返回 ' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: '欢迎使用三千笔记' } }],
            text: '欢迎使用三千笔记'
          },
          { type: 'text', text: ' | 跳转到 ' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: '欢迎使用三千笔记', targetType: 'heading', targetValue: 'Block 级链接（新功能）' } }],
            text: '欢迎使用三千笔记#Block 级链接'
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'hdlevel' },
        content: [{ type: 'text', text: '标题层级' }]
      },
      {
        type: 'heading',
        attrs: { level: 3, blockId: 'h3demo' },
        content: [{ type: 'text', text: '三级标题' }]
      },
      {
        type: 'heading',
        attrs: { level: 4, blockId: 'h4demo' },
        content: [{ type: 'text', text: '四级标题' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'hdtip1' },
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '# ' },
          { type: 'text', text: ' 到 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '#### ' },
          { type: 'text', text: ' 加空格创建标题。' }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'listdm' },
        content: [{ type: 'text', text: '列表' }]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'uldem1' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表项 1' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表项 2' }] }] }
        ]
      },
      {
        type: 'orderedList',
        attrs: { start: 1, blockId: 'oldem1' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序列表项 1' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序列表项 2' }] }] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'codblk' },
        content: [{ type: 'text', text: '代码块' }]
      },
      {
        type: 'codeBlock',
        attrs: { language: null, blockId: 'codex1' },
        content: [{ type: 'text', text: 'function hello() {\n  console.log("Hello!");\n}' }]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'tblsec' },
        content: [{ type: 'text', text: '表格' }]
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '语法' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '效果' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '**粗体**' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '粗体' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '*斜体*' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: '斜体' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '~~删除~~' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'strike' }], text: '删除' }] }] }
            ]
          }
        ]
      },
      {
        type: 'horizontalRule'
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '相关：' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: '快捷键速查表' } }],
            text: '快捷键速查表'
          }
        ]
      }
    ]
  }

  // 笔记 3: 快捷键速查表（包含回链和被引用的 Block）
  const shortcutsContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'sctitle' },
        content: [{ type: 'text', text: '快捷键速查表' }]
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'scback1' },
        content: [
          { type: 'text', text: '返回 ' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: '欢迎使用三千笔记' } }],
            text: '欢迎使用三千笔记'
          }
        ]
      },
      {
        type: 'blockquote',
        attrs: { blockId: 'tip001' },
        content: [
          { type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'bold' }], text: '提示：' },
            { type: 'text', text: '这是一个被其他笔记引用的段落！你可以通过 ' },
            { type: 'text', marks: [{ type: 'code' }], text: '[[笔记名#^tip001]]' },
            { type: 'text', text: ' 语法来链接到这里。' }
          ] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'txtfmt' },
        content: [{ type: 'text', text: '文字格式' }]
      },
      {
        type: 'table',
        attrs: { blockId: 'fmttbl' },
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '粗体' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ + B' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '斜体' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ + I' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '删除线' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ + Shift + S' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '行内代码' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ + E' }] }] }
            ]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'editop' },
        content: [{ type: 'text', text: '编辑操作' }]
      },
      {
        type: 'table',
        attrs: { blockId: 'edttbl' },
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '撤销' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ + Z' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '重做' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ + Shift + Z' }] }] }
            ]
          }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 2, blockId: 'qkinpt' },
        content: [{ type: 'text', text: '快捷输入' }]
      },
      {
        type: 'bulletList',
        attrs: { blockId: 'qklist' },
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: '[[' },
            { type: 'text', text: ' 双向链接' }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: '# ' },
            { type: 'text', text: ' 标题' }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: '- ' },
            { type: 'text', text: ' 无序列表' }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: '1. ' },
            { type: 'text', text: ' 有序列表' }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: '> ' },
            { type: 'text', text: ' 引用' }
          ] }] }
        ]
      },
      {
        type: 'horizontalRule'
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '更多语法见：' },
          {
            type: 'text',
            marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: 'Markdown 语法参考' } }],
            text: 'Markdown 语法参考'
          }
        ]
      }
    ]
  }

  // 插入三个笔记
  const insertStmt = db.prepare(`
    INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertStmt.run(note1Id, '欢迎使用三千笔记', JSON.stringify(mainContent), null, 0, null, 0, 0, now, now)
  insertStmt.run(note2Id, 'Markdown 语法参考', JSON.stringify(markdownContent), null, 0, null, 0, 0, now, now)
  insertStmt.run(note3Id, '快捷键速查表', JSON.stringify(shortcutsContent), null, 0, null, 0, 0, now, now)
}

// 保留旧函数名作为别名，保持兼容
export function createDemoNote(): void {
  createDemoNotes()
}

// ============ Notes ============

export interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
  is_pinned?: boolean
}

export interface Note {
  id: string
  title: string
  content: string
  notebook_id: string | null
  is_daily: boolean
  daily_date: string | null
  is_favorite: boolean
  is_pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function getNotes(): Note[] {
  const stmt = db.prepare(`
    SELECT id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at, deleted_at
    FROM notes
    WHERE deleted_at IS NULL
    ORDER BY is_pinned DESC, updated_at DESC
  `)
  return stmt.all().map(row => {
    const r = row as Record<string, unknown>
    return {
      ...r,
      is_daily: Boolean(r.is_daily),
      is_favorite: Boolean(r.is_favorite),
      is_pinned: Boolean(r.is_pinned),
    } as Note
  })
}

export function getNoteById(id: string): Note | null {
  const stmt = db.prepare(`
    SELECT id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at, deleted_at
    FROM notes
    WHERE id = ?
  `)
  const row = stmt.get(id) as Note | undefined
  if (!row) return null
  return {
    ...row,
    is_daily: Boolean(row.is_daily),
    is_favorite: Boolean(row.is_favorite),
    is_pinned: Boolean(row.is_pinned),
  }
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

  return getNoteById(id)!
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
    SELECT id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at, deleted_at
    FROM notes
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `)
  return stmt.all().map(row => {
    const r = row as Record<string, unknown>
    return {
      ...r,
      is_daily: Boolean(r.is_daily),
      is_favorite: Boolean(r.is_favorite),
      is_pinned: Boolean(r.is_pinned),
    } as Note
  })
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

export function searchNotes(query: string): Note[] {
  if (!query.trim()) return []

  // Use LIKE search for better CJK support
  // FTS5's built-in tokenizers don't handle Chinese well
  const escaped = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const likeQuery = `%${escaped}%`

  const stmt = db.prepare(`
    SELECT id, title, content, notebook_id, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at, deleted_at
    FROM notes
    WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
    ORDER BY is_pinned DESC, updated_at DESC
  `)

  return stmt.all(likeQuery, likeQuery).map(row => {
    const r = row as Record<string, unknown>
    return {
      ...r,
      is_daily: Boolean(r.is_daily),
      is_favorite: Boolean(r.is_favorite),
      is_pinned: Boolean(r.is_pinned),
    } as Note
  })
}

// ============ Notebooks ============

export interface NotebookInput {
  name: string
  icon?: string
}

export interface Notebook {
  id: string
  name: string
  icon?: string
  order_index: number
  created_at: string
}

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

// ============ Tags ============

export interface Tag {
  id: string
  name: string
}

export function getTags(): Tag[] {
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name')
  return stmt.all() as Tag[]
}

export function getTagsByNote(noteId: string): Tag[] {
  const stmt = db.prepare(`
    SELECT t.* FROM tags t
    JOIN note_tags nt ON nt.tag_id = t.id
    WHERE nt.note_id = ?
    ORDER BY t.name
  `)
  return stmt.all(noteId) as Tag[]
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
    SELECT n.* FROM notes n
    JOIN note_links nl ON nl.source_note_id = n.id
    WHERE nl.target_note_id = ? AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
  `)
  return stmt.all(noteId).map(row => {
    const r = row as Record<string, unknown>
    return {
      ...r,
      is_daily: Boolean(r.is_daily),
      is_favorite: Boolean(r.is_favorite),
      is_pinned: Boolean(r.is_pinned),
    } as Note
  })
}

export function getOutgoingLinks(noteId: string): Note[] {
  const stmt = db.prepare(`
    SELECT n.* FROM notes n
    JOIN note_links nl ON nl.target_note_id = n.id
    WHERE nl.source_note_id = ? AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
  `)
  return stmt.all(noteId).map(row => {
    const r = row as Record<string, unknown>
    return {
      ...r,
      is_daily: Boolean(r.is_daily),
      is_favorite: Boolean(r.is_favorite),
      is_pinned: Boolean(r.is_pinned),
    } as Note
  })
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
