# Sanqian Notes

A modern, AI-powered note-taking app with Obsidian-like features.

## Features

- **AI Chat** - Integrated AI assistant with note context awareness
- **AI Actions** - Quick AI operations on selected text (explain, translate, summarize, etc.)
- **Block Editor** - WYSIWYG editing powered by Tiptap/ProseMirror
- **Bi-directional Links** - `[[note]]`, `[[note#heading]]`, `[[note#^block]]` syntax
- **Split Panes** - View and edit multiple notes side by side
- **Multi-tab Support** - Work with multiple notes in tabs
- **Smart Views** - All Notes, Daily Notes, Recent, Favorites
- **Full-text Search** - Fast search powered by SQLite FTS5
- **Notebooks & Tags** - Organize notes with folders and tags
- **Import/Export** - Markdown, PDF, Obsidian vault, Notion export
- **Templates** - Obsidian-like template system with variable support (`{{date}}`, `{{time}}`, `{{title}}`, etc.)
- **Dark/Light Mode** - Theme follows system or manual toggle
- **Multi-language** - English and Chinese support

## RAG (Retrieval-Augmented Generation)

Knowledge base semantic search with the following improvements (based on [WeKnora](https://github.com/Tencent/WeKnora)):

1. **Structure-Preserving Chunking** - Tables, code blocks, and math blocks are kept intact
2. **Query Expansion** - Removes question words, extracts quoted phrases for better search
3. **Chunk Merge** - Merges overlapping/adjacent chunks for better context
4. **Query Rewrite** - Rewrites queries using conversation history (SDK integration)
5. **Rerank + MMR** - Reranking with external model + Maximal Marginal Relevance for diversity

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Editor**: Tiptap (ProseMirror)
- **Styling**: Tailwind CSS
- **Database**: SQLite (better-sqlite3)
- **Vector DB**: sqlite-vec (for semantic search)
- **AI**: Sanqian SDK

## Development

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron
npx electron-rebuild -f -w better-sqlite3

# Start dev server
npm run dev

# Run tests
npm run test

# Build
npm run build
```

## Utilities

```bash
# Rebuild knowledge base index (CLI)
npm run rebuild-index
```

Environment variables:
- `KB_MIN_CONTENT_LENGTH` - Minimum text length to index a note (default: 100)
- `SANQIAN_USERDATA` - Override userData path for the rebuild script
- `REBUILD_BATCH_SIZE` - Notes per batch during rebuild (default: 1000)
- `REBUILD_SLEEP_MS` - Sleep between batches (default: 0)

## License

MIT

---

## Changelog

### 2026-01-18 - FTS/Embedding Index Split

Decoupled FTS (Full-text Search) and Embedding (Vector) indexing for imports:

- FTS index is now built automatically after import (local computation, no API cost)
- Embedding index requires user opt-in via checkbox in import dialogs
- If embedding is globally disabled, the checkbox is disabled with a hint
- When user enables embedding later and opens/switches to a note, embedding is auto-built
- Applies to all import types: Markdown, PDF, and arXiv

Database schema changes:
- Added `fts_status` column: 'none' | 'indexed'
- Added `embedding_status` column: 'none' | 'indexed' | 'pending' | 'error'

Bug fixes:
- Fixed: Restoring note from trash now rebuilds index (was missing before)
- Fixed: Moving note to another notebook now updates notebook_id in index
- Fixed: `note:checkIndex` had early return blocking FTS updates when embedding disabled

### 2026-01-16 - Floating Table of Contents

Added Notion-style floating TOC to both normal editor and typewriter mode:

- Collapsed state: horizontal lines indicating document structure (line width by heading level)
- Expanded state: full heading list with level indentation
- Hover to expand, leave to collapse (no delay, instant feedback)
- Current position highlighting
- Works in both normal edit mode and typewriter mode
- Responsive: hidden on narrow screens (< 1200px for editor, < 1000px for typewriter)

### 2026-01-16 - Markdown Import Enhancement

Enhanced Markdown importer to support both Markdown and plain text files:

- Support .txt file import (plain text, no Markdown syntax parsing)
- Support folder import that recursively scans both .md and .txt files
- txt files are imported as plain text paragraphs, preserving original formatting
- Support multi-selection of files and folders in import dialog

### 2026-01-14 - Template Variables Enhancement

Enhanced template variable system with Obsidian Templater-compatible features:

**New Variables:**
- `{{yesterday}}` / `{{yesterday:FORMAT}}` - yesterday's date
- `{{tomorrow}}` / `{{tomorrow:FORMAT}}` - tomorrow's date
- `{{daily_date}}` - daily note's target date (for past daily notes)
- `{{daily_yesterday}}` - day before daily note's date
- `{{daily_tomorrow}}` - day after daily note's date

**Daily Note Example:**
```
# {{daily_date:YYYY-MM-DD dddd}}

<< [[{{daily_yesterday}}|Yesterday]] | [[{{daily_tomorrow}}|Tomorrow]] >>

## Today's Notes
```dataview
LIST WHERE created = today
```
```

Files:
- `src/renderer/src/utils/templateVariables.ts` - enhanced variable parser
- `src/main/database.ts` - backend parser with dailyDate support

---

### 2026-01-14 - Dataview Date Expressions

Added Obsidian-compatible date expressions for Dataview queries:

**Date Keywords:**
- `today`, `yesterday`, `tomorrow` - relative days
- `sow`, `eow` - start/end of week
- `som`, `eom` - start/end of month
- `soy`, `eoy` - start/end of year

**Range Keywords (for = operator):**
- `today`, `yesterday`, `tomorrow` - match notes within that day
- `this_week`, `last_week` - match notes within this/last week
- `this_month`, `last_month` - match notes within this/last month
- `this_year` - match notes within this year

**Query Examples:**
```
LIST WHERE created = today        -- 今天的笔记
LIST WHERE created = yesterday    -- 昨天的笔记
LIST WHERE created = this_week    -- 本周的笔记
LIST WHERE created = last_week    -- 上周的笔记
LIST WHERE created = this_month   -- 本月的笔记
LIST WHERE created = last_month   -- 上月的笔记
LIST WHERE created >= date(sow)   -- 本周开始以来的笔记

-- 按周数/年份查询
LIST WHERE week(created) = 2                         -- 第2周的笔记
LIST WHERE week(created) = 5 AND year(created) = 2026  -- 2026年第5周的笔记
```

Files:
- `src/renderer/src/utils/dateExpressions.ts` - shared date utilities module
- `src/renderer/src/utils/dataviewParser.ts` - added DateExpression support
- `src/renderer/src/utils/dataviewExecutor.ts` - date range evaluation

---

### 2026-01-14 - Template & Dataview Block Rendering Fix

Fixed markdown templates not rendering correctly when inserted:

**Issues Fixed:**
- Dataview blocks (`\`\`\`dataview`) were rendering as plain code blocks instead of interactive queries
- Agent blocks (`\`\`\`agent`) were rendering as plain code blocks
- Task lists (`- [ ]`) were rendering as bullet lists with "[ ]" text
- TOC blocks (`\`\`\`toc`) were not rendering

**Changes:**
- `src/main/markdown/markdown-to-tiptap.ts` - Added special handling for dataview, agent, and toc code blocks
- `src/main/database.ts` - createDaily() now converts markdown template to Tiptap JSON
- `src/renderer/src/components/Editor.tsx` - handleInsertContent() uses backend markdown-to-tiptap converter
- Added `markdown:toTiptap` IPC endpoint for frontend markdown conversion

---

### 2026-01-14 - Week/Year Query Functions

Added `week()` and `year()` functions for querying notes by specific week number:

**New Functions:**
- `week(field)` - extract ISO week number (1-53) from date field
- `year(field)` - extract year from date field

**New Range Keywords:**
- `last_week` - notes from the previous week
- `last_month` - notes from the previous month

**Examples:**
```
LIST WHERE week(created) = 2                           -- 第2周的笔记
LIST WHERE week(created) = 5 AND year(created) = 2026  -- 2026年第5周的笔记
LIST WHERE created = last_week                         -- 上周的笔记
```

Files:
- `src/renderer/src/utils/dataviewParser.ts` - added WEEK/YEAR keywords, FieldFunction type
- `src/renderer/src/utils/dataviewExecutor.ts` - implemented week/year extraction
- `src/renderer/src/utils/dateExpressions.ts` - added last_week/last_month range keywords

---

### 2026-01-14 - Template System

Added Obsidian-like template system:
- Template management in Settings with drag-and-drop reordering
- Insert templates from "More" menu in editor toolbar
- Variable support: `{{date}}`, `{{time}}`, `{{title}}`, `{{notebook}}`, `{{cursor}}`
- Custom date/time formats: `{{date:YYYY-MM-DD}}`, `{{time:HH:mm}}`
- Daily default template auto-applied when creating new daily notes
- Delete confirmation dialog for templates
- Preset daily template included

Bug fixes:
- Fixed template content insertion (was treating Tiptap JSON as Markdown)
- `handleInsertContent` now correctly detects and handles JSON format

Files:
- `src/main/database.ts` - templates table, CRUD, variable parsing for daily notes
- `src/shared/types.ts` - Template/TemplateInput types
- `src/renderer/src/utils/templateVariables.ts` - variable parser (frontend)
- `src/renderer/src/components/TemplateSettings.tsx` - settings UI with delete confirmation
- `src/renderer/src/components/TemplateSelector.tsx` - selection modal
- `src/renderer/src/components/Editor.tsx` - fixed `handleInsertContent` for JSON support

---

### 2026-01-14 - Template Reset to Defaults

Added ability to reset templates to defaults (similar to AI Actions):

**Features:**
- Auto-create default daily template if no templates exist
- Reset to defaults button in Template Settings with confirmation dialog
- Default templates include both English and Chinese versions based on system language

**Changes:**
- `src/main/database.ts`:
  - `initDefaultTemplates()` - creates default template if none exist
  - `resetTemplatesToDefaults()` - deletes all templates and recreates defaults
  - Removed duplicate template creation from migration
- `src/main/index.ts` - added `templates:reset` IPC handler
- `src/preload/index.ts` & `src/preload/index.d.ts` - exposed reset function
- `src/renderer/src/env.d.ts` - updated Window.electron.templates type
- `src/renderer/src/components/TemplateSettings.tsx` - added reset UI with confirmation
- `src/renderer/src/i18n/translations.ts` - added resetToDefaults, resetConfirm, reset translations

---

### 2026-01-16 - Inline Title with Scroll-to-Pin

Restored the inline title editing behavior:
- Title displayed as textarea in content area (not always in header bar)
- When scrolled up, title pins to header bar
- Header bar draggable except for buttons and title text
- Split pane drag handle (6-dot icon) remains clickable

Technical:
- CSS variables for layout constants (`--editor-header-height`, `--editor-content-width`, etc.)
- `field-sizing: content` for auto-resize with CSS.supports fallback
- Header bar starts from `left: 36px` to avoid blocking split handle

---

### 2026-01-16 - Fix editor focus on first click

Fixed issue where clicking the editor for the first time would place cursor at the beginning instead of click position.

Root cause:
- `focusedPaneId` could be null on initial load (from persisted data)
- Auto-focus useEffect would call `editor.commands.focus()` moving cursor to start

Fix:
- Added `getEffectiveFocusedPaneId()` helper to fallback to first pane when `focusedPaneId` is null
- Modified auto-focus useEffect to only trigger when `isFocused` changes from false to true (tab/pane switch), not on initial load
