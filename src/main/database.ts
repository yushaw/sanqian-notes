import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

// Constants
export const TRASH_RETENTION_DAYS = 30

// 获取系统语言
function getSystemLanguage(): 'zh' | 'en' {
  const locale = app.getLocale().toLowerCase()
  if (locale.startsWith('zh')) return 'zh'
  return 'en'
}

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
  const lang = getSystemLanguage()
  const isZh = lang === 'zh'

  // 创建三个互相关联的 demo 笔记
  const note1Id = uuidv4()
  const note2Id = uuidv4()
  const note3Id = uuidv4()

  // 多语言文本
  const t = {
    // 笔记标题
    note1Title: isZh ? '欢迎使用三千笔记' : 'Welcome to Sanqian Notes',
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
    twFeature1: isZh ? '📍 光标固定在屏幕中央，内容随输入滚动' : '📍 Cursor stays centered, content scrolls as you type',
    twFeature2: isZh ? '👁️ 专注模式（当前段落清晰，周围逐渐淡出）' : '👁️ Focus mode (current paragraph clear, surroundings fade)',
    twFeature3: isZh ? '🌓 自动跟随系统深色/浅色主题' : '🌓 Auto-follows system dark/light theme',
    twFeature4: isZh ? '📑 宽屏时右侧显示大纲导航' : '📑 Outline navigation on the right for wide screens',
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
          { type: 'paragraph', content: [
            { type: 'text', text: t.tipText1 },
            { type: 'text', marks: [{ type: 'code' }], text: '/' },
            { type: 'text', text: t.tipText2 }
          ] }
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
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: t.bilinkNote },
            { type: 'text', text: t.bilinkNoteDesc }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: t.bilinkHeading },
            { type: 'text', text: t.bilinkHeadingDesc }
          ] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [
            { type: 'text', marks: [{ type: 'code' }], text: t.bilinkBlock },
            { type: 'text', text: t.bilinkBlockDesc }
          ] }] }
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

  // 笔记 2: 编辑器功能演示 - 中文版
  const featuresContentZh = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: 'fback1' }, content: [
        { type: 'text', text: '返回 ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'callouts' }, content: [{ type: 'text', text: '提示块 Callout' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: '在行首输入 ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/提示' },
        { type: 'text', text: ' 或 ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/callout' },
        { type: 'text', text: ' 选择不同类型：' }
      ] },
      { type: 'callout', attrs: { type: 'note', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '📝 这是一个 Note 提示块，适合记录普通信息。' }] }
      ] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '💡 这是一个 Tip 提示块，适合分享小技巧。' }] }
      ] },
      {
        type: 'callout',
        attrs: { type: 'warning', collapsed: false },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '⚠️ 这是一个 Warning 提示块，提醒注意事项。' }] }
        ]
      },
      {
        type: 'callout',
        attrs: { type: 'danger', collapsed: false },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '🚨 这是一个 Danger 提示块，警示危险操作。' }] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'toggle' },
        content: [{ type: 'text', text: '折叠块 Toggle' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '在行首输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/折叠' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/toggle' },
          { type: 'text', text: ' 创建可折叠内容：' }
        ]
      },
      {
        type: 'toggle',
        attrs: { summary: '点击展开查看更多内容', collapsed: true },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '折叠块可以隐藏长内容，让笔记更加整洁。' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '适合存放详细说明' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '适合组织 FAQ 问答' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '适合折叠代码示例' }] }] }
          ] }
        ]
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'mermaid' },
        content: [{ type: 'text', text: 'Mermaid 图表' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '在行首输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/mermaid' },
          { type: 'text', text: ' 或 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/图表' },
          { type: 'text', text: ' 插入图表，双击可编辑：' }
        ]
      },
      {
        type: 'mermaid',
        attrs: { code: 'graph LR\n    A[想法] --> B{值得记录?}\n    B -->|是| C[写入笔记]\n    B -->|否| D[忽略]\n    C --> E[定期回顾]\n    E --> A' }
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'imgdemo' },
        content: [{ type: 'text', text: '图片' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '支持拖拽调整图片大小，点击选中后显示尺寸信息：' }]
      },
      {
        type: 'image',
        attrs: {
          src: 'data:image/png;base64,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',
          alt: '三千笔记 Logo',
          width: 64,
          height: 64,
          align: 'center'
        }
      },
      {
        type: 'heading',
        attrs: { level: 1, blockId: 'math' },
        content: [{ type: 'text', text: '数学公式' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '$公式$' },
          { type: 'text', text: ' 创建行内公式：' },
          { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
          { type: 'text', text: '，或输入 ' },
          { type: 'text', marks: [{ type: 'code' }], text: '/数学' },
          { type: 'text', text: ' 插入示例公式。' }
        ]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '更多示例：' },
          { type: 'inlineMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } },
          { type: 'text', text: '，' },
          { type: 'inlineMath', attrs: { latex: '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' } }
        ]
      },
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
          { type: 'text', text: ' 创建代码块，点击左上角可切换语言：' }
        ]
      },
      {
        type: 'codeBlock',
        attrs: { language: 'javascript', blockId: 'codex1' },
        content: [{ type: 'text', text: '// 支持语法高亮\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet("三千笔记");' }]
      },
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
          { type: 'text', text: ' 插入表格：' }
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
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示块' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/callout' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4 种类型可选' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠块' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/toggle' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '可展开/收起' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '图表' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/mermaid' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '流程图等' }] }] }
            ]
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '脚注' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/footnote' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '⌘⇧F' }] }] }
            ]
          }
        ]
      },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [
        { type: 'text', text: '查看 ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }], text: t.note3Title },
        { type: 'text', text: ' 了解更多快捷操作。' }
      ] }
    ]
  }

  // 笔记 2: 编辑器功能演示 - 英文版
  const featuresContentEn = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: 'fback1' }, content: [
        { type: 'text', text: 'Back to ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'callouts' }, content: [{ type: 'text', text: 'Callout Blocks' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/callout' },
        { type: 'text', text: ' to choose different types:' }
      ] },
      { type: 'callout', attrs: { type: 'note', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '📝 This is a Note callout, great for general information.' }] }
      ] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '💡 This is a Tip callout, perfect for sharing tips.' }] }
      ] },
      { type: 'callout', attrs: { type: 'warning', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '⚠️ This is a Warning callout for important notices.' }] }
      ] },
      { type: 'callout', attrs: { type: 'danger', collapsed: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '🚨 This is a Danger callout for critical warnings.' }] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'toggle' }, content: [{ type: 'text', text: 'Toggle Blocks' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/toggle' },
        { type: 'text', text: ' to create collapsible content:' }
      ] },
      { type: 'toggle', attrs: { summary: 'Click to expand', collapsed: true }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Toggle blocks hide long content, keeping notes tidy.' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Great for detailed explanations' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Perfect for FAQ sections' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ideal for code examples' }] }] }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'mermaid' }, content: [{ type: 'text', text: 'Mermaid Diagrams' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/mermaid' },
        { type: 'text', text: ' to insert a diagram. Double-click to edit:' }
      ] },
      { type: 'mermaid', attrs: { code: 'graph LR\n    A[Idea] --> B{Worth noting?}\n    B -->|Yes| C[Write it down]\n    B -->|No| D[Skip]\n    C --> E[Review regularly]\n    E --> A' } },
      { type: 'heading', attrs: { level: 1, blockId: 'imgdemo' }, content: [{ type: 'text', text: 'Images' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Drag to resize images. Click to select and view dimensions:' }] },
      { type: 'image', attrs: { src: 'data:image/png;base64,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', alt: 'Sanqian Notes Logo', width: 64, height: 64, align: 'center' } },
      { type: 'heading', attrs: { level: 1, blockId: 'math' }, content: [{ type: 'text', text: 'Math Formulas' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '$formula$' },
        { type: 'text', text: ' for inline math: ' },
        { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
        { type: 'text', text: ', or type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/math' },
        { type: 'text', text: ' to insert.' }
      ] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'More examples: ' },
        { type: 'inlineMath', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } },
        { type: 'text', text: ', ' },
        { type: 'inlineMath', attrs: { latex: '\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' } }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'codblk' }, content: [{ type: 'text', text: 'Code Blocks' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '```' },
        { type: 'text', text: ' or ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/code' },
        { type: 'text', text: ' to create a code block:' }
      ] },
      { type: 'codeBlock', attrs: { language: 'javascript', blockId: 'codex1' }, content: [{ type: 'text', text: '// Syntax highlighting\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet("Sanqian Notes");' }] },
      { type: 'heading', attrs: { level: 1, blockId: 'tblsec' }, content: [{ type: 'text', text: 'Tables' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Type ' },
        { type: 'text', marks: [{ type: 'code' }], text: '/table' },
        { type: 'text', text: ' to insert a table:' }
      ] },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Description' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/callout' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '4 types' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Toggle' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/toggle' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collapsible' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Diagram' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/mermaid' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Flowcharts' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/footnote' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '⌘⇧F' }] }] }
        ] }
      ] },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [
        { type: 'text', text: 'See ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note3Id, noteTitle: t.note3Title } }], text: t.note3Title },
        { type: 'text', text: ' for more shortcuts.' }
      ] }
    ]
  }

  const featuresContent = isZh ? featuresContentZh : featuresContentEn

  // 笔记 3: 快捷键速查表 - 中文版
  const shortcutsContentZh = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: 'scback1' }, content: [
        { type: 'text', text: '返回 ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
      ] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false, blockId: 'tip001' }, content: [
        { type: 'paragraph', content: [
          { type: 'text', marks: [{ type: 'bold' }], text: '提示：' },
          { type: 'text', text: '这个段落可以被其他笔记引用！语法：' },
          { type: 'text', marks: [{ type: 'code' }], text: `[[${t.note3Title}#^tip001]]` }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'txtfmt' }, content: [{ type: 'text', text: '文字格式' }] },
      { type: 'table', attrs: { blockId: 'fmttbl' }, content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '粗体' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ B' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '斜体' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ I' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '下划线' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ U' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '删除线' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ S' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '高亮' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ H' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '行内代码' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ E' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '脚注' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ F' }] }] }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'editop' }, content: [{ type: 'text', text: '编辑操作' }] },
      { type: 'table', attrs: { blockId: 'edttbl' }, content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '操作' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '快捷键' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '撤销' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ Z' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '重做' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ Z' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '保存' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ S' }] }] }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'qkinpt' }, content: [{ type: 'text', text: '快捷输入' }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '输入' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '效果' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '打开命令菜单' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[[' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '插入笔记链接' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '# Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一级标题' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '- Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '无序列表' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '1. Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '有序列表' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[] Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '任务列表' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用块' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '代码块' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '---' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '分割线' }] }] }
        ] }
      ] },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [
        { type: 'text', text: '更多功能见 ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }], text: t.note2Title }
      ] }
    ]
  }

  // 笔记 3: 快捷键速查表 - 英文版
  const shortcutsContentEn = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: 'scback1' }, content: [
        { type: 'text', text: 'Back to ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note1Id, noteTitle: t.note1Title } }], text: t.note1Title }
      ] },
      { type: 'callout', attrs: { type: 'tip', collapsed: false, blockId: 'tip001' }, content: [
        { type: 'paragraph', content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'Tip: ' },
          { type: 'text', text: 'This paragraph can be referenced by other notes! Syntax: ' },
          { type: 'text', marks: [{ type: 'code' }], text: `[[${t.note3Title}#^tip001]]` }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'txtfmt' }, content: [{ type: 'text', text: 'Text Formatting' }] },
      { type: 'table', attrs: { blockId: 'fmttbl' }, content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ B' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Italic' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ I' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Underline' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ U' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Strikethrough' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ S' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Highlight' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ H' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inline Code' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ E' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ F' }] }] }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'editop' }, content: [{ type: 'text', text: 'Editing' }] },
      { type: 'table', attrs: { blockId: 'edttbl' }, content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Action' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shortcut' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Undo' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ Z' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Redo' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ ⇧ Z' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Save' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '⌘ S' }] }] }
        ] }
      ] },
      { type: 'heading', attrs: { level: 1, blockId: 'qkinpt' }, content: [{ type: 'text', text: 'Quick Input' }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Input' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Result' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '/' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open command menu' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[[' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Insert note link' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '# Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heading 1' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '- Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet list' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '1. Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numbered list' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '[] Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task list' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '> Space' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Blockquote' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '```' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Code block' }] }] }
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: '---' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Divider' }] }] }
        ] }
      ] },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [
        { type: 'text', text: 'See ' },
        { type: 'text', marks: [{ type: 'noteLink', attrs: { noteId: note2Id, noteTitle: t.note2Title } }], text: t.note2Title },
        { type: 'text', text: ' for more features.' }
      ] }
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
