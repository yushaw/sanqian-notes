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

# Verify full quality gate (lint + typecheck + tests)
npm run verify:quality

# Verify desktop window drag contract (lint + tests)
npm run verify:drag-contract

# Build
npm run build
```

## Utilities

```bash
# Rebuild knowledge base index (CLI)
npm run rebuild-index

# Benchmark local-folder scan (2k/10k synthetic files by default)
npm run bench:local-folder-scan
```

Bench report (2026-04-07): `docs/local-folder-performance-bench-2026-04-07.md`

Environment variables:
- `KB_MIN_CONTENT_LENGTH` - Minimum text length to index a note (default: 100)
- `KB_INDEXING_VERBOSE` - Enable per-note indexing verbose logs (`1` = enabled, default off; keep off for large local-folder sync/import)
- `KB_INDEXING_VERBOSE_SAMPLE_EVERY` - When `KB_INDEXING_VERBOSE=1`, sample high-frequency skip logs every N events (default: 200, `1` = no sampling)
- `SANQIAN_USERDATA` - Override userData path for the rebuild script
- `REBUILD_BATCH_SIZE` - Notes per batch during rebuild (default: 1000)
- `REBUILD_SLEEP_MS` - Sleep between batches (default: 0)
- `IMPORT_EXPORT_YIELD_INTERVAL` - Yield interval for import/export hot loops (default: 32)
- `IMPORT_DB_BATCH_SIZE` - Notes per DB batch insert during import (default: 64)
- `IMPORT_INDEX_CONCURRENCY` - Concurrent indexing workers during import final phase (default: 2)
- `IMPORT_EXEC_PROFILE` - Enable import execution profiling summary logs (`1` = enabled)
- `IMPORT_EXEC_SLOW_LOG_MS` - Always log import summary when duration exceeds this threshold (default: 3000ms)
- `LOCAL_NOTE_INDEX_SYNC_YIELD_INTERVAL` - Yield interval for local-folder index sync loops (default: 32)
- `LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN` - Max files processed in one local-folder index sync run (applies to full sync and force-index incremental requeue batches) before immediate requeue (default: 256, `0` = unlimited)
- `LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED` - Enable stricter per-run cap for cold full-sync runs (first full rebuild/relink pass) (`0` = disabled, default enabled)
- `LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN` - Cold full-sync max files indexed in one run (default: 64, automatically bounded by `LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN` when it is non-zero)
- `LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED` - Enable stricter full-sync per-run cap during startup window (`0` = disabled, default enabled)
- `LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN` - Startup-window max files indexed in one full-sync run (default: 64, automatically bounded by `LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN` when it is non-zero)
- `LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE` - Batch size for local-folder metadata/popup DB sync during full indexing (default: 64)
- `LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS` - Delay before running an immediate cold full-sync request (default: 180ms in app, 0ms in tests)
- `LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS` - Delay between capped local-folder index requeue batches (default: 120ms in app, 0ms in tests)
- `LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS` - Max wall-clock time budget per local-folder index sync run before requeueing remaining paths (default: 120ms in app, 0ms in tests)
- `LOCAL_NOTE_INDEX_SYNC_PROFILE` - Enable local-folder index sync summary logs (`1` = enabled)
- `LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS` - Always log local-folder sync summary when duration exceeds this threshold (default: 3000ms)
- `LOCAL_FOLDER_WATCHER_SYNC_DEBOUNCE_MS` - Debounce for background local-folder watcher reconciliation on startup/mount flows (default: 120ms in app, 0ms in tests)
- `LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN` - Max uncached preview head reads per local-folder tree scan (`0` = unlimited, default: 768)
- `LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED` - Enable stricter preview read budget on first tree scan of a mounted root (`0` = disabled, default enabled)
- `LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN` - Cold-scan max uncached preview reads per scan (default: 128, automatically bounded by `LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN` when it is non-zero)
- `LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED` - Enable stricter preview read budget during startup window (`0` = disabled, default enabled)
- `LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN` - Startup-window max uncached preview reads per scan (default: 192, automatically bounded by `LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN` when it is non-zero)
- `LOCAL_CONTEXT_OVERVIEW_SYNC_SCAN_STARTUP_GUARD_ENABLED` - Skip sync context-overview filesystem scans during startup window and serve cached/partial local overview first (`0` = disabled, default enabled)
- `LOCAL_FOLDER_SCAN_PROFILE` - Enable local-folder scan profiling summary logs (`1` = enabled)
- `LOCAL_FOLDER_SCAN_SLOW_LOG_MS` - Always log local-folder scan summary when duration exceeds this threshold (default: 1200ms)
- `LOCAL_PERF_STARTUP_WINDOW_MS` - Startup window for adaptive local scan/index throttling (default: 45000ms in app, 0ms in tests)

## License

MIT

---

## Changelog

### 2026-03-07 - Feature: External Link Management

Added complete external link management to the TipTap editor:
- **Link Hover Popover**: Hovering over a `.zen-link` shows a floating popover with URL preview, edit/open/remove actions. Uses `@floating-ui/react`.
- **Context Menu**: Insert Link (when text selected), Edit Link / Remove Link (when cursor on link).
- **Bottom Toolbar Link Button**: Link icon in `zen-stats` area opens URL input popover.
- **Paste URL on Selection**: Selecting text and pasting a URL auto-wraps the selection as a link.

Files: `LinkPopover.tsx` (new), `Editor.tsx`, `EditorContextMenu.tsx`, `MarkdownPaste.ts`, `Editor.css`, `translations.ts`.

### 2026-03-02 - Fix: Chat window white screen crash

**Root cause:** `@yushaw/sanqian-chat` v0.2.36 referenced `defaultRemarkPlugins.math` and `defaultRehypePlugins.katex` from streamdown, but streamdown v2.x removed these exports (breaking change). The `undefined` values were passed to `unified().use()`, throwing "Expected usable value, not `undefined`", which crashed the entire React component tree and caused a blank white screen.

**Fix (in sanqian-chat v0.2.37):**
- `packages/chat/src/renderer/renderers/MarkdownRenderer.tsx` - Removed references to `defaultRemarkPlugins.math` and `defaultRehypePlugins.katex`; math/KaTeX is handled internally by Streamdown v2
- Added ErrorBoundary with retry in `src/renderer/src/chat/main.tsx` so future render errors show a message instead of white screen
- Added e2e test (`markdownRenderer.e2e.test.tsx`) with real streamdown to guard against plugin API breakage

### 2026-03-02 - Fix: TOC and indicators not updating on note switch

**Root cause:** Commit `51134f2` reused the editor instance across note switches with `setContent(content, { emitUpdate: false })`. This suppresses the `update` event, breaking components that relied on `editor.on('update')`.

**Fix:** Changed `FloatingToc`, `TableOfContents`, `AgentTaskIndicators` to use `editor.on('transaction')` which fires regardless of `emitUpdate`. `AgentTaskIndicators` consolidated three redundant listeners into one.

### 2026-03-02 - chore: macOS code signing and notarization

Configured complete macOS code signing + notarization pipeline for local builds.

- Added `resources/entitlements.mac.plist` and `resources/entitlements.mac.inherit.plist`
- Updated `electron-builder.yml`: explicit `hardenedRuntime`, `entitlements`, `entitlementsInherit` paths
- Added `scripts/notarize-dmg.sh` to notarize and staple the DMG after electron-builder
- Updated `build:mac` script to chain DMG notarization automatically

---

### 2026-01-19 - v0.4.1 Dependencies Update

Upgraded dependencies to latest compatible versions:

**Core:**
- @tiptap/* (all packages): 3.13.x/3.14.x -> 3.15.3
- better-sqlite3: 12.5.0 -> 12.6.2
- electron-updater: 6.6.2 -> 6.7.3
- framer-motion: 12.0.0 -> 12.27.1

**Dev:**
- @typescript-eslint/*: 8.52.0 -> 8.53.0
- vitest + coverage: 4.0.16 -> 4.0.17

---

### 2026-01-19 - SDK update_note Enhancements

**Position-based Insert for append/prepend:**
- Added `after` parameter for `append` mode: insert content after specified anchor text
- Added `before` parameter for `prepend` mode: insert content before specified anchor text
- Uses normalized text matching (handles Chinese/English punctuation differences)
- Falls back to default behavior (end/start) if anchor not found

**Editor Cursor Preservation:**
- External content updates now preserve cursor position when editor has focus
- Uses blockId + offset + absolutePos strategy for accurate cursor restoration
- Cursor is saved before setContent and restored after
- Falls back to original absolute position if blockId not found (not last block position)

**Empty Paragraph Round-trip Fix:**
- Fixed: Empty paragraphs were being duplicated during Markdown conversion round-trip
- Root cause: `\n\n` was incorrectly treated as creating empty paragraphs
- Fix: Empty paragraphs now output `\u200B` (zero-width space) in Markdown
- Fix: Space token handler now correctly calculates empty paragraph count (`newlineCount - 2`)
- Fix: `\u200B`-only paragraphs are converted back to truly empty paragraphs on import
- Fix: Markdown exporter cleans up `\u200B` for clean external output
- UX: Users can delete empty lines with single backspace (not two)

**Code Quality Fixes (from review):**
- Fixed: `mergeNode` no longer creates attrs on nodes that shouldn't have them
- Fixed: `setCursorByBlockId` now has proper boundary protection with try-catch
- Fixed: Parameter combination validation (`after` requires `append`, `before` requires `prepend`)

Files modified:
- `src/main/sanqian-sdk.ts` - Added after/before parameters
- `src/main/i18n.ts` - Added i18n strings
- `src/renderer/src/components/Editor.tsx` - Added cursor preservation
- `src/renderer/src/utils/cursor.ts` - Added absolutePos fallback, boundary protection
- `src/main/markdown/tiptap-to-markdown.ts` - Empty paragraph outputs `\u200B`
- `src/main/markdown/markdown-to-tiptap.ts` - Fixed space token handling, convert `\u200B` to empty
- `src/main/markdown/tiptap-merge.ts` - Fixed attrs handling in mergeNode
- `src/main/import-export/exporters/markdown-exporter.ts` - Clean `\u200B` on export
- `src/main/markdown/__tests__/*.test.ts` - Updated tests

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

---

### 2026-01-19 - Notebook drag-and-drop reordering

Added ability to reorder notebooks in the sidebar via drag-and-drop.

Features:
- Drag notebooks to reorder in expanded sidebar
- Blue indicator line shows drop position
- Dragged notebook appears semi-transparent
- Existing note-to-notebook drag still works (distinguished by dataTransfer type)

Technical:
- `reorderNotebooks()` in database.ts with transaction and validation
- Optimistic UI update with error recovery (reload from DB on failure)
- `setDropTargetIndex(prev => ...)` to avoid unnecessary re-renders during drag

---

### 2026-01-19 - arXiv import improvements

Fixed multiple issues with arXiv HTML import:

1. **Missing Figure 1**: Process top-level figures (outside sections) before processing sections
2. **Empty h2 heading**: Skip sections with empty titles in importer
3. **Equation extra newlines**: Remove redundant `\n` wrapping from equation blocks
4. **List extra newlines**: Unified list processing to use dedicated `processListElement` instead of duplicate code with extra newlines

---

### 2026-01-19 - Mermaid & Math editor UI refinement

Redesigned Mermaid diagram editor and Math formula editor with minimalist zen aesthetic:

**Mermaid editor:**
- Removed all borders (wrapper and textarea)
- Edit area uses subtle 3% background tint for visual separation
- Buttons changed from solid to text-link style
- Added fade effect: action buttons default 50% opacity, full opacity on hover/focus

**Math editor:**
- Removed border, using subtle 4% background tint instead
- Increased padding for better breathing room
- Updated both Editor.css and Typewriter.css for consistency

### 2026-02-27

**fix: local notes AI tags not persisted from summary generation**
- `summary-service.ts` local branch was extracting keywords from AI response but never storing them
- Added `updateLocalAITags` call after `updateLocalNoteSummary` so local notes get AI tags just like native notes
- The `updateLocalAITags` database function already existed but was dead code (never imported/called anywhere)

**perf: optimize ai_popup_refs rebuild to avoid full table scan**
- `rebuildAIPopupRefsForInternalNotes` was doing `SELECT id, content FROM notes` loading ALL note content into memory
- Changed to only load notes containing AI popup marks (`WHERE content LIKE '%aiPopupMark%'`), which is a small fraction for most libraries
- Added batch processing (200 notes per batch) as safety belt for large libraries

**fix: complete local notes AI tags IPC and rendering chain**
- IPC handler `localFolder:updateNoteMetadata` guard condition and data pass-through were missing `ai_tags` field, breaking the IPC contract
- Added `resolveLocalFolderFilePath` lightweight path resolver -- metadata-only updates (favorite/pinned/summary) no longer do full file read + markdown-to-tiptap conversion
- Renderer-side tag mapping (`localFolderNavigation.ts`, `allSourceNotes.ts`, `globalSearch.ts`) was ignoring `ai_tags` entirely, making AI-generated tags invisible in UI
- Added `mergeLocalMetadataTags` renderer utility to merge user/AI tags consistently with `source` field
- Fixed `buildLocalNoteMetadataMap` filter to retain metadata rows that only carry `ai_tags`

**fix: preload type declaration drift**
- Added missing `notebook.reorder` to `preload/index.d.ts` to match runtime API

**fix: long-term code health -- batch 1 (2026-02-27)**

Full codebase review of all uncommitted changes, 47 issues identified across 7 priority levels. Created `docs/long-term-code-health.md` as tracking checklist. First batch of verified fixes:

- fix(database): SQL string interpolation in `rebuildLocalFolderMountsWithoutHardUniqueConstraint` replaced with parameterized query
- fix(database): frontmatter migration changed from full-table load to batched LIMIT/OFFSET (200 per batch)
- fix(database): `rebuildAIPopupRefsForInternalNotes` DELETE+INSERT wrapped in single transaction, added ORDER BY for pagination stability
- fix(database): LIKE prefix patterns in 5 folder functions (12 locations) now escape `%`, `_`, `\` via `escapeLikePrefix()` + `ESCAPE '\'`
- fix(App.tsx): `localSaveTimerRef` cleanup added to unmount effect
- fix(sanqian-sdk): `syncPrivateAgents` race condition -- errors now propagate, second caller retries on failure, syncingPromise cleared in finally
- fix(sanqian-sdk): hardcoded array indices replaced with `agentMap.get()` name-based lookup
- fix(sanqian-sdk): removed redundant duplicate variables (`localIndexId`, `nextCanonicalLocalIndexId`)
- fix(inline-parser): `pendingLegacyAIPopupCloseSpan` state leak -- added safety counter to auto-reset after 5 tokens
- fix(index.ts): `collectLocalNotesForGetAll` catch block now logs warning with mount info
- fix(tiptap-to-markdown): added `case 'tableOfContents':` fallthrough for backward compatibility with old TOC nodes

**fix: long-term code health -- batch 2+3 (2026-02-27)**

Continued processing all verified items from the checklist. 20 additional fixes:

- refactor(indexing-service): removed dead `canTriggerSummary()` stub and inlined logic at 4 call sites
- fix(sanqian-sdk): `t` variable shadowing i18n function renamed to `tag` in `.map()` callback
- fix(App.tsx): `while(true)` loops in `getDefaultLocalCreateName` replaced with bounded `for` loops (max 10000)
- fix(local-folder-watch): added `ref()`/`unref()` stubs to `createFallbackDirectoryTreeWatcher` composite emitter
- refactor(sanqian-sdk): removed unnecessary `Promise.resolve()` wrapping of sync `buildLocalSearchResultItems`
- fix(database): `createNotebookFolderEntry` catch block now logs warning instead of silently returning null
- fix(path-compat): `CASE_SENSITIVITY_CACHE` capped at 256 entries with `clear()` on overflow
- fix(database): `deleteNotebookFolderEntry` IN clause chunked at 500 items to stay within SQLite parameter limits
- perf(index.ts): `collectIndexedLocalNoteIdsByNotebook` O(N*DB) to O(N) via batch `getLocalNoteIdentityUidsByNotebook` query
- fix(sanqian-sdk): `localFolderScanCache` and `localOverviewSummaryCache` now enforce max 64 entries with LRU eviction
- perf(database): `collectAIPopupRefsFromContent` fast-path `includes('aiPopupMark')` check skips JSON parse when content has no popup marks
- fix(arxiv-fetcher): `parseArxivInput` strips trailing annotations like `[cs.AI]` before regex matching
- fix(index.ts): `localFolder:renameEntry` propagates `metadataWarning` field on metadata migration failure
- fix(database): `addNote`, `updateNote`, `updateNoteSafe` wrap INSERT/UPDATE + popup ref replacement in single transaction
- refactor(sanqian-sdk): unified all log prefixes to `[SanqianSDK]` (was mixed: `[Notes SDK]`, `[Sanqian SDK]`, `[sanqian-sdk]`, `[move_note]`)
- refactor(sanqian-sdk): extracted `buildLocalEtagFromFile()` helper, replaced 4 duplicate call sites
- fix(local-folder): exported `clearLocalFolderCaches()` for cache lifecycle management
- fix(shared/types): `LocalFolderRenameEntryResponse` success type gains optional `metadataWarning` field

**refactor: split database.ts into database/ directory (2026-02-27)**

Split monolithic `src/main/database.ts` (5,646 lines, 130+ exports, 16 responsibility domains) into `src/main/database/` directory with 19 focused module files. External consumers unchanged via barrel `index.ts` re-export.

- `connection.ts` -- db handle singleton (getDb/setDb)
- `helpers.ts` -- shared utilities (escapeLikePrefix, row interfaces, identity predicates)
- `schema.ts` -- initDatabase, closeDatabase, DDL schema, cleanupFtsTables
- `migrations.ts` -- runMigrations + 7 exported migration functions
- `demo-notes.ts` -- createDemoNotes (hardcoded demo content)
- `notes.ts` -- Notes CRUD, daily, trash, search, links, attachments (16 functions)
- `notebooks.ts` -- Notebooks + notebook folders (10 functions)
- `local-note-identity.ts` -- LocalNoteIdentity type + 9 functions
- `local-note-metadata.ts` -- 6 functions
- `local-folder-mounts.ts` -- 6 functions
- `note-helpers.ts` -- getNoteCountByNotebook, moveNote
- `tags.ts` -- 7 tag functions
- `summary-links.ts` -- NoteSummaryInfo + 5 summary/tag functions
- `ai-actions.ts` -- 9 AI action functions + default actions
- `ai-popups.ts` -- PopupData/PopupInput types + 8 popup functions
- `agent-tasks.ts` -- 6 agent task functions
- `app-settings.ts` -- getAppSetting, setAppSetting, deleteAppSetting
- `templates.ts` -- 10 template functions + default content
- `index.ts` -- barrel re-export (all 130+ original exports)

### Phase 1: index.ts business logic extraction (4,548 -> 2,838 lines)

Extracted 6 groups of business logic from `src/main/index.ts` into independent modules:

1. **`internal-folder-path.ts`** (~60 lines) - Pure functions for internal folder path normalization and validation
2. **`note-synthesis.ts`** (~200 lines) - Note synthesis layer merging internal DB notes + local folder files; uses DI for tree cache
3. **`user-context.ts`** (~190 lines) - User/cursor context state + accessors; **resolves circular dependency** between `index.ts` and `sanqian-sdk.ts` (replaced `require('./index')` with static import)
4. **`local-folder-tree-cache.ts`** + **`local-notebook-index/`** directory (~500 lines) - Tree cache Map + local note index sync chain (debounce, queue, generation-based cancellation), knowledge base rebuild, AI popup cleanup
5. **`local-folder-watcher/`** directory + **`session-resources.ts`** (~510 lines) - File system watcher lifecycle (ensure/stop/sync) + watch event scheduling/merging; session resource push/remove for chat context
6. **`app/`** directory (~250 lines) - Window state persistence, language settings, theme settings, auto-updater with DI for mainView/mainWindow

All modules use barrel re-export pattern (external consumers zero import changes). Module state exposed via accessor functions. Verification: `npx tsc --noEmit` passes (only pre-existing sanqian-sdk.ts unused var), all 973 tests pass.

### Phase 4: Split `local-folder.ts` into `local-folder/` directory (2026-02-27)

Split `src/main/local-folder.ts` (1,905 lines) into 6 domain modules under `src/main/local-folder/`:

1. **`errors.ts`** (~45 lines) - Path guard errors, FS error code mapping, scan error filtering, Windows validation constants
2. **`path.ts`** (~240 lines) - Path normalization/resolution, entry name validation, mount root assertion, shared constants (`ALLOWED_EXTENSIONS`, `MAX_SCAN_FOLDER_LEVEL`, `MAX_EDITABLE_FILE_SIZE_BYTES`)
3. **`cache.ts`** (~210 lines) - Three LRU-style caches (scan tree, search content, list preview) with TTL expiration, enforce/get/set/prune/clear operations
4. **`scan.ts`** (~300 lines) - Recursive directory scanning (sync + async), file preview generation, hidden entry filtering
5. **`search.ts`** (~280 lines) - Full-text search (sync + async with concurrency), term matching/scoring, snippet building, hit deduplication
6. **`io.ts`** (~480 lines) - File CRUD (read/save/create/rename/delete), atomic writes with fsync, text format detection/preservation, conflict detection

Dependency order: errors -> path -> cache -> scan -> search / io. Barrel re-export preserves all external import paths. Verification: tsc passes, 973 tests pass.

### Phase 2: Extract IPC handlers from index.ts (2,528 -> 1,249 lines)

Extracted all remaining IPC handlers from `src/main/index.ts` into domain-specific `src/main/ipc/register-*-ipc.ts` modules using dependency injection (deps interface) pattern:

| File | Handlers | Lines |
|------|----------|-------|
| `register-notebook-folder-ipc.ts` | 4 notebook folder handlers | 201 |
| `register-attachment-ipc.ts` | 11 attachment handlers | 42 |
| `register-knowledge-base-ipc.ts` | 11 embedding/search handlers | 108 |
| `register-ai-ipc.ts` | 23 AI action/popup/agent handlers | 198 |
| `register-import-export-ipc.ts` | 23 import/export/PDF/arXiv handlers | 370 |
| `register-local-folder-ipc.ts` | 16 local folder handlers + 3 helpers | 794 |
| `register-chat-ipc.ts` | 11 chat/theme/streaming handlers | 277 |
| `register-app-ipc.ts` | 17 app/window/updater handlers | 204 |

Key patterns:
- Each register function takes `ipcMainLike: Pick<IpcMain, 'handle'>` + typed `deps` interface
- Module-scoped state (e.g. `pdfImportAbortController`, `activeStreams` Map) enclosed within register functions
- Accessor getters (`getMainView`, `getChatPanel`) for mutable references
- Helper functions (`canonicalizeLocalFolderPath`, `isSameOrChildPath`, `analyzeLocalFolderDeleteImpact`) relocated from index.ts into register-local-folder-ipc.ts

Previously extracted (Phase 2.1-2.3): `register-note-ipc.ts`, `register-notebook-ipc.ts`, `register-local-folder-search-ipc.ts`

Total: 11 IPC modules, 2,363 lines. index.ts reduced to 1,249 lines (pure orchestration + app lifecycle). Verification: tsc passes, 973 tests pass.

### Phase 3: sanqian-sdk.ts split (2026-02-27)

Split `sanqian-sdk.ts` (3,621 lines) into `sanqian-sdk/` directory with 12 modules (3,869 total lines).

```
src/main/sanqian-sdk/
  index.ts                 (28)   barrel re-export
  state.ts                 (86)   module state + shared utilities (breaks circular dep)
  client.ts                (371)  lifecycle, agent management, exported API
  context-providers.ts     (293)  buildContextProviders() for chat panel
  tools.ts                 (1488) buildTools() with all 10 tool handlers + editor output
  helpers/
    caching.ts             (373)  3 caches + local resource ID helpers
    content-mutation.ts    (260)  fuzzy matching + buildUpdatedNoteContent
    context-overview-helpers.ts (283)  overview data source + note counts + ref resolution
    error-mapping.ts       (95)   etag building + error code mapping
    local-note-helpers.ts  (193)  metadata, identity, derived state, cross-notebook moves
    note-link.ts           (35)   deep links + text sanitization
    search-helpers.ts      (364)  hybrid search, local search, merge, context lists
```

Key design decisions:
- `state.ts` breaks the circular dependency between `tools.ts` (needs `notifyDataChange`) and `client.ts` (calls `buildTools()`)
- `clearAllLocalCaches()` centralized in `caching.ts`, called by `state.ts` on data change
- Pre-existing `normalizeLocalTagNames` unused import error resolved (not carried into new modules)
- All external consumers unchanged: `import { ... } from './sanqian-sdk'` resolves to `sanqian-sdk/index.ts`

Verification: tsc passes (0 errors, down from 1 pre-existing), 973 tests pass.

### Phase 5: Editor.tsx split (2026-02-27)

Split `Editor.tsx` (2,926 lines) into `editor/` directory with 6 modules. Editor.tsx reduced to 1,806 lines (38% reduction).

```
src/renderer/src/components/editor/
  editor-doc-utils.ts           (191)  pure utilities: tryParseImportedTiptapDoc, handleCursorPlaceholder, extractHeadingsFromJSON, extractBlocksFromJSON
  EditorToolbar.tsx             (473)  ToolbarIcons, ToolbarButton, ToolbarDropdown, EditorToolbar (compact + expanded)
  useEditorLinkPopup.ts         (274)  [[ note link popup: 8 states + detectLinkTrigger + handlers
  useEditorTransclusionPopup.ts (140)  transclusion popup: 7 states + event listeners + handlers
  useEditorAgentTaskPanel.ts    (100)  agent task panel: 5 states + open/close/CRUD handlers
  useEditorEmbedPopup.ts        (76)   embed popup: 2 states + event listener + insert/close handlers
```

Key design decisions:
- Ref bridge pattern for `useEditorLinkPopup`: `linkPopupDetectRef` allows `useEditor`'s `onUpdate` to call `detectLinkTrigger` without circular dependency (hook needs `editor`, `useEditor` needs the hook's function)
- Event listeners for `transclusion:select/edit` and `embed:select` moved into their respective hooks
- Each hook returns a structured object (e.g., `linkPopup.showLinkPopup`, `agentTask.handleOpenAgentTask`)
- Unused imports cleaned up after each extraction step (SearchMode, HeadingInfo, BlockInfo, extractHeadingsFromJSON, etc.)

Verification: tsc passes (0 errors), 973 tests pass.

### Phase 6: App.tsx Hook Extraction (2026-02-27)

App.tsx: 5,821 -> 4,725 lines (reduced 1,096 lines, 18.8%).

Extracted 4 components/hooks into `src/renderer/src/components/app/` and `hooks/`:

| Step | File | Lines | What moved |
|------|------|-------|------------|
| 6.1 | `app/InternalFolderDialogs.tsx` | 529 | 9 dialog states, 6 handlers, 3 portal dialogs for internal folder CRUD |
| 6.4 | `hooks/useEditorContextState.ts` | 21 | 3 editor selection states (blockId, selectedText, cursorContext) + handler |
| 6.2 | `app/LocalFolderDialogs.tsx` | 769 | 8 dialog states, 6 handlers, 3 portal dialogs for local file/folder CRUD |
| 6.3 | `app/NotebookDeleteDialog.tsx` | 86 | 1 state, JSX portal for notebook delete confirmation |

Key design decisions:
- Same pattern as Phase 5: hook owns dialog state + handlers, returns `renderDialogs()` for JSX and named handler functions for callers
- Cross-domain side effects abstracted as callback deps (e.g., `onSelectionChange`, `onMetadataMigrate`, `onLocalEditorClear`)
- Save conflict dialog state NOT extracted (too deeply entangled with file save queue, set from 8+ locations)
- `handleConfirmDeleteNotebook` refactored to take `notebook: Notebook` parameter (eliminates state read)
- `resetDialogs()` exposed for notebook/smart-view switch cleanup

Verification: tsc passes (0 errors), 973 tests pass.

### Phase 7: Main Process Responsiveness & Unicode Safety (2026-02-27)

Two categories of improvements: main process sync I/O blocking UI, and missing Unicode NFC normalization.

**7.1 Unicode NFC Normalization**
- Added `toNFC()` to `path-compat.ts`, applied to `normalizeComparablePath` and `normalizeComparablePathForFileSystem`
- `scan.ts`: all `entry.name` references normalized via `toNFC()` in both sync and async scan functions (filter, sort, loop body)
- `local-folder-watch.ts`: `normalizeWatchFileName` and `collectWatchDirectories` now return NFC-normalized names
- Prevents silent match failures for CJK filenames on macOS (which returns NFD-encoded paths)

**7.2 Async `canonicalizeLocalFolderPath`**
- Replaced sync `realpathSync.native` + `statSync` with async `fsPromises.realpath` + `fsPromises.stat`
- `localFolder:mount`, `localFolder:relink`, `localFolder:analyzeDelete`, `localFolder:deleteEntry` handlers updated to async
- Sync version removed (no remaining callers)

**7.3 Async `localFolder:getTree`**
- New `scanLocalFolderMountAsync()` in `scan.ts`: stack-based iterative async scan that builds full tree nodes (unlike search-only variant which returns `tree: []`)
- Uses shared `parentChildren` array references for parent-child wiring during stack-based iteration
- Yields to event loop every 80 entries, applies NFC normalization, preserves preview cache
- `scanAndCacheLocalFolderTreeAsync()` added to `local-folder-tree-cache.ts`
- `localFolder:getTree` handler updated to `async` + `await`
- Equivalence test verifies async scan produces identical tree structure and file list as sync version

**7.4 Async `note:getAll`**
- New `collectLocalNotesForGetAllAsync()` and `getAllNotesForRendererAsync()` in `note-synthesis.ts`
- Cache hit path remains sync; cache miss awaits `scanAndCacheLocalFolderTreeAsync`
- `note:getAll` IPC handler updated to async

Verification: tsc passes (0 errors), 974 tests pass (973 + 1 new equivalence test).

### Long-term code health -- batch 4 (2026-02-27)

Systematic review focused on security, race conditions, type safety, and resource management.

**fix(sanqian-sdk): syncPrivateAgents race condition and unhandled rejection**
- `await syncingPromise` at waiter path had no try-catch -- sync failure propagated as unhandled rejection to callers
- Multiple waiters could both fall through to start parallel syncs after failure (now re-checks `syncingPromise` before starting new sync)
- `registered` event handler `await syncPrivateAgents()` had no try-catch -- network error caused unhandled promise rejection

**fix(agent-task-service): formatter queue deadlock prevention**
- `acquireFormatterExecutionSlot` could wait forever if previous formatter hung (SDK stream never ends)
- Added 5-minute timeout via `Promise.race` -- forces slot release with warning log on timeout

**fix(preload): replace `unknown` with shared types in IPC bridge**
- `note.add/update/updateSafe` now typed as `NoteInput` / `Partial<NoteInput>` (was `unknown`)
- `notebook.add/update` now typed as `InternalNotebookInput` / `InternalNotebookUpdateInput` (was `unknown`)
- `aiAction.create/update` now typed as `AIActionInput` / `Partial<AIActionInput>` (was `unknown`)
- Both `preload/index.ts` (implementation) and `preload/index.d.ts` (declaration) updated

**fix(editor-agent): validate output operation content before queueing**
- `queueOp` accepted `unknown` content and pushed without validation
- Added `validateOutputContent()` checking required fields per operation type (e.g., `paragraph.paragraphs` must be array, `heading.text` must be string)
- Malformed AI model output now returns `{ success: false, error }` instead of silently corrupting the queue

**perf(session-resources): use Buffer.byteLength in truncateText**
- Binary search used `textEncoder.encode(text.slice(...)).length` creating Uint8Array per iteration
- Replaced with `Buffer.byteLength(text, 'utf8')` (zero-allocation byte counting)

**fix(index.ts): save attachment cleanup timer handle**
- `setTimeout` for orphan attachment cleanup had no saved handle
- Added `attachmentCleanupTimer` variable, cleared in `before-quit` handler

Verified false positives (no fix needed):
- P0-1 attachment:// symlink: `getFullPath()` already blocks `..`/absolute paths; symlink requires prior FS access (non-issue for desktop app)
- P0-2 closeDatabase timing: better-sqlite3 is synchronous, `will-quit` handler completes before exit; moving to `before-quit` would break window close handlers
- P4-11 markdown placeholders: `\x00` cannot appear in legitimate text content
- P4-12 Editor error boundary: `EditorErrorBoundary` already exists and wraps both Editor usages
- P3-9 SDK init notification: lazy error reporting is correct UX; SDK auto-reconnects

Verification: tsc passes (0 errors), 974 tests pass.

### Long-term Code Health -- Batch 6 (2026-02-27)

Full codebase review with 5 parallel agents covering security, performance, architecture, type safety, and correctness. Verified each finding against source code before fixing.

**P0 Security & Correctness:**

**fix(preload/index.d.ts): complete rewrite to match actual implementation**
- Type declarations were severely out of date: popup API had old window-based methods instead of data storage API, chat exposed full ChatAPI instead of narrowed 5-method subset, theme fields incorrectly optional, knowledgeBase missing methods, agent.onEvent missing types
- Rewrote entire file to match `preload/index.ts` exactly

**fix(local-folder/path.ts): fail-closed in isPathWithinCanonicalRoot catch**
- catch block returned `true` (fail-open) on error -- changed to `return false` with warning log

**fix(sanqian-sdk/client.ts): syncPrivateAgents guard missing formatterAgentId**
- Added `&& formatterAgentId` to the sync guard to prevent premature sync

**fix(database/connection.ts): getDb() throws if database not initialized**
- Added explicit guard: `if (!db) throw new Error('Database is not open')`

**P1 Performance & Data Integrity:**

**fix(database/notes.ts): getUsedAttachmentPaths streaming + filter deleted**
- Changed from `stmt.all()` (loads all into memory) to `stmt.iterate()` (streaming)
- Added `WHERE deleted_at IS NULL` to skip soft-deleted notes

**fix(database/notes.ts): getNotes/getNotesByUpdated default limit -1**
- Default limit was 1000, silently truncating for users with >1000 notes
- Changed to -1 (SQLite no-limit)

**fix(sanqian-sdk/helpers/search-helpers.ts): defer metadata map to after cache check**
- `buildLocalNoteMetadataByIdMap` was called before cache check, wasting DB queries on cache hit

**P2 Architecture & Maintainability:**

**fix(inline-parser, markdown-to-tiptap, MarkdownPaste): isolated marked instances**
- All 3 files used `marked.setOptions()` which mutates global state
- Changed to `new Marked({...})` isolated instances to prevent cross-contamination

**fix(markdown-to-tiptap.ts): highlight/underline regex consistency**
- Changed `[^=]+` to `.+?` and `[^+]+` to `.+?` to match inline-parser behavior

**fix(markdown-to-tiptap.ts): postProcessMath handles headings too**
- Added `INLINE_CONTAINER_TYPES` Set with 'paragraph' and 'heading'
- Inline math in headings was previously ignored

**P3 Minor Robustness:**

**fix(concurrency.ts): mapWithConcurrency error isolation**
- Changed from `Promise.all` to `Promise.allSettled` with early-stop error tracking
- Prevents unhandled rejections from sibling workers on failure

**fix(local-folder/search.ts): NFC normalization for search queries**
- Added `.normalize('NFC')` to handle macOS filesystem decomposed unicode

**fix(tiptap-to-markdown.ts): escape pipe characters in table cells**
- Added `.replace(/\|/g, '\\|')` to prevent cell content from breaking table structure

**fix(summary-service.ts): clearTimeout in Promise.race timeout pattern**
- Timer was not cleared on success, leaking until natural expiry
- Added try/finally with `clearTimeout(timeoutId)`

Deferred items (assessed as low risk or design tradeoffs):
- IPC input validation with zod (large scope, low desktop risk)
- Migration version system (current column-existence checks are idempotent)
- Renderer optimizations (popup stream cleanup, NoteList re-render, cache granularity)
- TOCTOU in saveLocalFolderFile (inherent filesystem limitation)

Verification: tsc passes (0 errors), 974 tests pass.

### Long-term Code Health -- Batch 7 (2026-02-27)

Full codebase review with 5 parallel agents covering IPC/gateway, local folder subsystem, renderer components/hooks, database/SDK, and test quality. Verified all findings against source code; most were false positives (common miss: assuming race conditions in Node.js single-threaded synchronous code).

**P0 Security:**

**fix(database/agent-tasks.ts): prevent SQL injection in updateAgentTask()**
- `fieldMap[key] || key` fallback used raw property name directly in SQL template
- Changed to `fieldMap[key]` with `if (!dbField) continue` to skip unmapped keys

**fix(database/local-note-identity.ts): escape LIKE pattern in deleteLocalNoteIdentityByPath()**
- Folder-kind deletion used raw `${relativePath}/%` without escaping LIKE wildcards (`%`, `_`)
- Changed to use `escapeLikePrefix()` + `LIKE_ESCAPE`, matching the pattern already used in `renameLocalNoteIdentityFolderPath()`

**P1 Robustness:**

**fix(database/agent-tasks.ts): replace non-null assertion in createAgentTask()**
- `getAgentTask(id)!` masked potential null with `!` operator
- Changed to explicit null check with descriptive error message

Verified false positives (no fix needed):
- Chat streaming resource leak: IIFE finally block always runs cleanup; cancelStream double-delete is harmless for Map
- Session resource timer never called: clearSessionResourceTimers IS called in index.ts:1249
- Agent sync double-check race: Node.js single-threaded; no interleaving between await points
- Cache refresh race (delete+set): synchronous code, no race possible
- Deleted note returned as active: if-block at line 304 handles deleted notes correctly; fallthrough only reached for active notes
- Error code mapping too broad: unmapped LocalFolderFileErrorCode values are all "not found" variants
- EditorToolbar missing AIAction import: type is globally declared in env.d.ts

Verification: tsc passes (0 errors), 974 tests pass.

### Long-term Code Health -- Batch 8: Quick Wins + Type Dedup (2026-02-27)

6 targeted improvements across dependency hygiene, test coverage, rendering performance, bundle size, error resilience, and type safety.

**A1: Remove dead react-dnd dependencies**
- Removed `react-dnd` and `react-dnd-html5-backend` from package.json (zero imports; DnD handled by @dnd-kit)

**A2: Expand vitest coverage config**
- `coverage.include` expanded from `src/main/embedding/**/*.ts` to all `src/**/*.{ts,tsx}`
- Added `*.d.ts`, `src/__mocks__/**`, `src/preload/**` to exclude list

**A3: NoteListItem React.memo**
- Wrapped `NoteListItem` export with `memo()` to skip re-renders when value-type props unchanged in `.map()` loops

**A4: Mermaid lazy loading**
- Replaced static `import mermaid from 'mermaid'` + module-level `mermaid.initialize()` with `getMermaid()` async loader
- Uses cached promise to ensure single `import('mermaid')` + `initialize()` call
- ~500KB mermaid bundle now only loaded when first mermaid block is rendered

**B1: App & Sidebar ErrorBoundary**
- `<Sidebar>` wrapped with `<ErrorBoundary>` in AppContent
- `<AppContent />` wrapped with `<ErrorBoundary>` inside providers (ThemeProvider/I18nProvider/TabProvider)
- Prevents single component crash from white-screening the entire app

**B2: Preload/env.d.ts type deduplication**
- `preload/index.d.ts`: all `unknown` return types replaced with concrete types (Note, Notebook, AIAction, Template, AgentTaskRecord, AgentCapability, etc.)
- `env.d.ts`: removed ~530 lines of duplicate `Window.electron` declaration, replaced with `/// <reference path="../../preload/index.d.ts" />`
- `shared/types.ts`: added `AgentCapability` and `AgentTaskEvent` interfaces
- `env.d.ts` retains only Vite reference + ambient type aliases for renderer code

Verification: tsc passes (0 errors), 1010 tests pass, build succeeds.

### Phase 8: Integrate useLocalFolderState hook into App.tsx (2026-02-27)

Integrated the pre-written `useLocalFolderState` hook (`src/renderer/src/hooks/useLocalFolderState.ts`, 2,323 lines) into App.tsx. App.tsx reduced from 4,394 lines to 2,633 lines (40% reduction).

**What was removed from App.tsx:**
- All local folder useState declarations (14 states)
- All local folder useRef declarations (22 refs)
- All local folder useCallback/useMemo definitions (~40 callbacks)
- All local folder useEffect blocks (~15 effects)
- Helper functions: `toLocalNoteTags()`, constants (`STORAGE_KEY_LOCAL_NOTE_COUNTS`, `LOCAL_FILE_CREATE_RETRY_LIMIT`, `LOCAL_WATCH_SUPPRESS_MS`)
- Interfaces: `LocalSaveConflictDialogState`, `LocalAutoDraftState`
- Hook calls: `useLocalFolderDialogs`, `useVersionedDebouncedSearch`, `useLocalFolderWatchEvents`
- Unused imports: `LocalFolderFileContent`, `LocalFolderFileErrorCode`, `LocalFolderTreeResult`, `LocalFolderFileEntry`, `NotebookStatus`, `LocalNoteMetadata`, `applyLocalNoteMetadataToNote`, `findFolderNodeByPath`, `normalizeLocalPreferredFileName`

**What was added:**
- `useLocalFolderState` hook call with 22 options (state, setters, refs, i18n)
- Destructuring of only the values actually used in remaining App.tsx code
- `handleConfirmDeleteNotebook` refactored to use `cleanupUnmountedLocalNotebook()` instead of inline cleanup code
- `hasFreshLocalTreeSnapshot` updated to use hook state values instead of refs

Verification: tsc passes (0 errors).

### Phase 4 - Extract useNoteCRUD hook (2026-02-28)

Extracted 19 note CRUD callbacks and helpers from App.tsx into `/src/renderer/src/hooks/useNoteCRUD.ts`.

**New file:** `useNoteCRUD.ts` (~580 lines)
- Top-level helpers moved from App.tsx: `BULK_NOTE_PATCH_CONCURRENCY`, `ConcurrencyTaskResult<T>`, `runWithConcurrency()`
- Hook options interface: `UseNoteCRUDOptions` (accepts state, setters, editor queue API, local folder API, navigation refs)
- Return interface: `NoteCRUDAPI` (19 callbacks + `emptyNoteDeleteInFlightRef`)
- Circular dependency between `selectSingleNote` <-> `deleteEmptyNoteIfNeeded` resolved via `selectSingleNoteRef` pattern

**Callbacks extracted:**
- `refreshInternalNotebookData`, `isNoteEmpty`, `deleteEmptyNoteIfNeeded`
- `handleCreateNote`, `handleOpenInNewTab`, `handleCreateDaily`, `handleUpdateNote`
- `handleCreateNoteFromLink`, `handleTogglePinned`, `handleToggleFavorite`
- `handleMoveToNotebook`, `handleDeleteNote`, `handleDuplicateNote`, `handleSearch`
- `handleRestoreNote`, `handlePermanentDelete`, `handleEmptyTrash`
- `handleBulkDelete`, `handleBulkToggleFavorite`

**App.tsx cleanup:**
- Removed ~400 lines of callback code
- Removed unused imports: `EditorNoteUpdate`, `createLocalResourceId`, `runUnifiedSearch`, `stripLocalFileExtension`, `getRelativePathDisplayName`
- Added `selectSingleNoteRef` with `.current` updated after `selectSingleNote` definition

Verification: tsc passes (0 errors), vitest passes (81 files, 974 tests).

### Phase 5: Extract useNotebookManagement hook (2026-02-28)

Created `/src/renderer/src/hooks/useNotebookManagement.ts` - extracts all notebook CRUD, modal state, internal folder management, and derived notebook values from App.tsx.

**Extracted into hook:**
- State: `showNotebookModal`, `editingNotebook`
- Callbacks: `refreshNotebookFolders`, `handleSelectInternalFolder`, `isSelectedNotebookInternal`, `handleReorderNotebooks`, `handleAddNotebook`, `handleEditNotebook`, `handleSaveNotebook`, `handleConfirmDeleteNotebook`, `handleDeleteNotebook`
- Hook calls: `useInternalFolderDialogs`, `useNotebookDeleteDialog`
- Derived values (useMemo): `contextNotebook`, `notebookHasChildFolders`, `isInternalNotebookSelected`, `selectedNotebookInternalFolders`, `selectedNotebookInternalNotes`, `internalFolderTreeNodes`
- useEffect: internal folder path cleanup

**Circular dependency resolution:**
- `useLocalFolderState` accepts `internalFolderDialogsResetDialogs` callback, but `internalFolderDialogs` now lives inside `useNotebookManagement` (which depends on localFolder outputs)
- Resolved with a ref pattern: `internalFolderDialogsResetRef` created before localFolder, wired up after notebookManagement hook call

**App.tsx cleanup:**
- Removed ~200 lines of notebook management code
- Removed unused imports: `useInternalFolderDialogs`, `useNotebookDeleteDialog`, `DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS`, `buildInternalFolderTree`, `hasInternalFolderPath`, `hasLocalFolderNodes`, `normalizeInternalFolderPath`
- NotebookModal onClose now uses `closeNotebookModal` from hook

Verification: tsc passes (0 errors), vitest passes (81 files, 974 tests).

### Phase 6: Extract useNoteNavigation hook (2026-02-28)

Created `/src/renderer/src/hooks/useNoteNavigation.ts` (1,080 lines) - the final and largest extraction from App.tsx.

**What moved:**
- Refs: `noteSelectionVersionRef`, `initialLocalSelectionRestoreRef`, `prevTabFocusedNoteIdRef`
- Callbacks: `invalidateNoteSelectionVersion`, `hasFreshLocalTreeSnapshot`, `captureNoteScrollPosition`, `selectSingleNote`, `handleSelectNote` (~165 lines), `handleSelectNotebook`, `handleSelectSmartView`, `handleNoteClick`, `handleScrollComplete`
- State: `scrollTarget` (useState)
- Effects: initial local selection restore, persist view/notebook to localStorage, persist selected note to localStorage, context sync to main process, tab focus sync / selection sync, `note:navigate` DOM event listener, `note:navigate` IPC listener
- Memos: `editorCandidateNotes`, `selectedNoteId`, `contextNoteId`, `contextNote`, `filteredNotes`, `noteCounts`, `effectiveNoteId`, `selectedNote`, `listTitle`

**STORAGE_KEY_* constants** exported from the hook file and imported into App.tsx (shared with `loadData` effect).

**Type fixes:**
- Exported `SmartViewNoteCounts` from `utils/noteCounts.ts` for proper return type
- Used `CursorContext` type from `utils/cursor.ts` for context sync
- Made `openLocalFile` and `refreshLocalFolderTree` option types use `Promise<unknown>` to accommodate differing return types

**App.tsx reduction:** 1,833 -> 1,122 lines (-711 lines, -39%).

**Removed imports from App.tsx:** `flushSync`, `formatDailyDate`, `toast`, `setAndPersistNoteScrollPosition`, `buildSmartViewNoteCounts`, `mergeAllSourceNotes`, `isInternalPathInSubtree`, `resolveSearchResultNavigationTarget`, `RECENT_DAYS`, `useMemo`.

Verification: tsc passes (0 errors), vitest passes (81 files, 974 tests).

### Async local folder I/O (2026-02-28)

All 7 local-folder IPC file operation handlers converted from sync to async `fs/promises` to prevent blocking the main process thread. This is critical for users with network-mounted folders or slow storage.

**New async functions in `src/main/local-folder/io.ts`:**
- `atomicWriteUtf8FileAsync` - async atomic write (open+write+sync+rename via FileHandle)
- `readLocalFolderFileAsync` - async file read with lstat+readFile
- `saveLocalFolderFileAsync` - async file save with conflict detection (the hot path on every editor save)
- `createLocalFolderFileAsync` - async file creation
- `createLocalFolderAsync` - async directory creation
- `renameLocalFolderEntryAsync` - async rename
- `resolveLocalFolderDeleteTargetAsync` - async delete target validation
- `resolveLocalFolderFilePathAsync` - async path validation

**New in `src/main/local-folder/path.ts`:**
- `resolveExistingDirectoryAsync` - async parent directory validation

**Updated IPC handlers** in `register-local-folder-ipc.ts`:
- `localFolder:readFile`, `localFolder:saveFile`, `localFolder:createFile`, `localFolder:createFolder`, `localFolder:renameEntry`, `localFolder:analyzeDelete`, `localFolder:deleteEntry`, `localFolder:updateNoteMetadata` -- all now async

Sync versions kept for non-IPC callers (sanqian-sdk tools, note-synthesis, etc.) to convert later.

Verification: tsc passes (0 errors), vitest passes (81 files, 974 tests).

### NoteList callback stabilization + React.memo fix (2026-02-28)

NoteListItem was already wrapped in `React.memo` but the parent NoteList passed inline arrow closures in the `.map()` loop, defeating memo entirely (every render created new function identities).

**NoteListItem.tsx** - Changed callback interface from pre-bound closures to id-based delegation:
- `onClick(event)` -> `onClickNote(noteId, event)` - NoteListItem internally wraps with `useCallback` + noteId
- `onContextMenu(event)` -> `onContextMenuNote(noteId, event)`
- `onMouseEnter(event)` -> `onMouseEnterNote(noteId, element)`
- `onDragStart(event)` -> `onDragStartNote(noteId, event)`
- `onDragEnd(event)` -> `onDragEndNote(event)` (no noteId needed)

**NoteList.tsx** - All 6 callbacks are now stable `useCallback(fn, [])` references using refs for mutable state:
- `handleClickNote` - delegates to `onSelectNoteRef.current`
- `handleContextMenuNote` - looks up note data from `displayNotesRef`, reads selection state from `selectedIdSetRef`
- `handleMouseEnterNote` - looks up note from `displayNotesRef`, reads hover state from `hoveredNoteRef` (was unstable due to `[hoveredNote]` dep)
- `handleDragStartNote` - reads selection state from refs
- `handleDragEndNote` - pure cleanup
- `handleNoteMouseLeave` - already stable (unchanged)

Result: When a user types in the editor, NoteList re-renders but only the items where `isSelected`/`isDragging`/`hideDivider`/`note` actually changed will re-render. Previously all items re-rendered on every parent render.

### Editor / TypewriterMode shared code extraction (2026-02-28)

Extracted 3 categories of duplicated code from Editor.tsx and TypewriterMode.tsx into shared modules:

**New shared modules:**
- `editor/clipboard-serializer.ts` - `serializeClipboardText()`: clipboard plain-text serialization with proper list indentation formatting. Was byte-for-byte identical in both files (~77 lines each).
- `editor/editor-file-insert.ts` - `handleEditorFileInsert()`: file insert logic (paste/drag) with size validation, attachment saving, and node insertion by file category. Was 95% identical (~110 lines each), parameterized error messages via `FileInsertErrorMessages` interface.

**Removed duplicate code from TypewriterMode.tsx:**
- `extractHeadingsFromJSON`, `extractBlocksFromJSON`, `extractTextFromNode` (~95 lines) - now imported from `editor/editor-doc-utils.ts` where identical functions already existed.

**Bug fix:** Editor.tsx file attachment default case used `result.relativePath` (missing `attachment://` prefix) while TypewriterMode used `attachmentUrl`. Now both use the shared function which consistently uses `attachment://` URLs.

Net code reduction: ~241 lines (Editor.tsx: 1806->1628, TypewriterMode.tsx: 1382->1122, new shared: +197).

### Unified Result type + notebook folder migration (2026-02-28)

Defined a generic `Result<T, E>` discriminated union type in `shared/types.ts` to standardize fallible operations. Migrated notebook folder and note move operations as proof of concept.

**New type in shared/types.ts:**
```typescript
type Result<T = void, E extends string = string> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: E }
```

**Migrated functions:**
- `createNotebookFolderEntry`: `NotebookFolder | null` -> `Result<NotebookFolder, 'already_exists'>` (no longer loses error info)
- `renameNotebookFolderEntry`: `{ ok; reason }` -> `Result<void, 'not_found' | 'conflict'>`
- `deleteNotebookFolderEntry`: `{ ok; deletedNoteIds }` -> `Result<{ deletedNoteIds: string[] }, 'not_found'>`
- `moveNote` / `MoveNoteResult`: `{ ok; reason }` -> `Result<void, 'note_not_found' | 'notebook_not_found' | 'target_not_allowed'>`

**Updated callers:** `register-notebook-folder-ipc.ts` (IPC handlers), `sanqian-sdk/tools.ts` (moveNote tool).

Design note: IPC responses keep the existing `{ success, errorCode }` pattern (80+ functions already consistent). The `Result` type is for internal/database layer operations. The IPC handler maps between the two at the boundary.

### Long-term Code Health - Round 2 (2026-02-28)

**T1: Mermaid XSS fix (P0)**
- Changed `securityLevel: 'loose'` to `'strict'` in MermaidView.tsx
- Added DOMPurify.sanitize() on SVG output before `dangerouslySetInnerHTML` as defense-in-depth
- Prevents stored XSS via crafted diagram labels (e.g. `<img onerror=...>`)

**T2: Result type migration - note-gateway/notes.ts (P2)**
- Renamed `reason` to `error` in `IfMatchCheckResult`, `ResolveNotebookForCreateResult`, `resolveNoteNotebookAssignment` return types
- Consistent with the `Result<T, E>` pattern established in Round 1
- Updated callers: error-mapping.ts, register-local-folder-ipc.ts, tools.ts, notes.ts
- Updated 11 test assertions in note-gateway.test.ts

**T3: Editor save debounce (P3)**
- Added 300ms debounce to `onUpdate` handler in Editor.tsx and TypewriterMode.tsx
- `editor.getJSON()` + `JSON.stringify()` now only fires after 300ms idle, not on every keystroke
- Flush-on-unmount via useEffect cleanup registered before useEditor (ensures editor is still alive)
- Uses ref-based pattern to avoid stale closures

**T4: LocalFolderNoteList memo optimization (P4)**
- Extracted `LocalFolderFileItem` component wrapped in `React.memo()`
- Converted inline onClick/onContextMenu to id-based callbacks via stable `useCallback` + refs
- Wrapped `renderFolderTree` in `useCallback`
- Same pattern as NoteList/NoteListItem from Round 1

---

### 2026-02-28 - Long-term Code Health Round 3

**F1: Image downloader race condition fix**
- `downloadImage()` in `image-downloader.ts` had multiple code paths calling `resolve()` on the same Promise (data size exceeded -> request.destroy() triggers error handler -> second resolve + redundant unlinkSync)
- Added `settled` flag via `settle()` wrapper -- only the first resolution path executes, subsequent calls are no-ops

**F2: Path normalization deduplication**
- `attachment.ts` had 5 inline `.replace(/\\/g, '/')` calls; replaced with centralized `toSlashPath()` from `path-compat.ts`
- `internal-folder-path.ts` had 1 inline duplication; replaced with `toSlashPath()`

**F3: Security & lifecycle hardening (incremental review)**
- **Electron security**: Added `contextIsolation: true, nodeIntegration: false` to main window WebContentsView (export window already had these)
- **Attachment symlink bypass**: `getFullPath()` now uses `realpathSync()` to resolve symlinks before `startsWith()` check, preventing symlink-based directory traversal
- **SDK cleanup on quit**: Moved `stopSanqianSDK()` from fire-and-forget `will-quit` to `before-quit` with `preventDefault()` + 2s timeout, ensuring SDK resources are released
- **Unicode NFC**: `normalizeRelativeSlashPath()` now calls `toNFC()`, matching `normalizeComparablePath()` behavior. Prevents NFD/NFC path mismatch on macOS
- **npm audit**: Fixed 15/24 vulnerabilities via `npm audit fix`. Remaining 9 high in electron-builder dep chain (requires major upgrade to 26.8.1)
- Updated `docs/long-term-code-health.md`: marked LocalFolderNoteList memo as fixed, circular require as resolved, App.tsx line count corrected, added P8 section for new findings

**F4: Code dedup & quality (checklist round 2 verification + fix)**
- **useReconnectHold hook**: Extracted shared `useReconnectHold()` hook from 3 duplicated acquire/release/cleanup patterns in useBlockAIGenerate, useAIWriting, AIExplainPopup
- **Export transclusion cache**: Added `exportNoteCache` (Map) to `resolveExportNote()` -- avoids re-resolving the same note during a single export with multiple transclusions
- **Accessibility quick wins**: Added `aria-label` to NoteList search input, `role="dialog" aria-modal` to ImageLightbox, `aria-live="polite"` to ExportMenu arXiv validation
- **Checklist corrections**: "noteId 3x duplication" as [!] already fixed (all call resolveLocalNoteRef), "Unicode NFC" as [!] fixed

---

### 2026-02-28 - Long-term Code Health Round 4

**A: noteId resolution DRY**
- Extracted `resolveLocalNoteRef()` in `note-gateway.ts`: shared function for parsing noteId -> { notebookId, relativePath } with uid resolution and bare UUID fallback
- Replaced duplicated logic in `indexing-service.ts` (35 -> 12 lines) and `semantic-search.ts` (inline alias to shared function)
- Removed now-unused `isLocalResourceUidRef` import from note-gateway.ts

**B: KaTeX lazy loading**
- Converted `katex` from static import to dynamic `import()` in `MathView.tsx`, following the existing Mermaid lazy-load pattern (~270KB JS + 23KB CSS deferred to first math block render)
- Removed redundant static `import 'katex/dist/katex.min.css'` from `Editor.tsx` and `TypewriterMode.tsx`

**C: Error double-wrapping fix (ToolError class)**
- Added `ToolError` class in `sanqian-sdk/helpers/error-mapping.ts` -- user-facing errors that should not be wrapped
- Converted 40+ inner `throw new Error(tools.xxx.yyy)` to `throw new ToolError(...)` in `tools.ts` (mapLocalToolErrorCode, notFound, conflict, ifMatch, etc.)
- Added `if (error instanceof ToolError) throw error` guard in all 8 outer catch blocks
- Before: "Failed to update note: Note not found: abc123" -> After: "Note not found: abc123"

**D: Sidebar folder tree dedup + memo**
- Extracted shared `FolderTreeItem` memo component from duplicated `renderLocalFolderTree` / `renderInternalFolderTree` (~70 lines each -> ~20 lines each)
- Id-based callbacks (`onToggleExpand(path)`, `onSelect(path)`, `onContextMenu(event, path)`) for stable references
- Wrapper callbacks (`handleLocalFolderCtxMenu`, `handleSelectLocalFolder`, etc.) adapt generic signature to context-specific shapes

**E: arXiv code detection false positive fix**
- Removed `/i` flag from `looksLikeCodeLine` and `inferCodeLanguage` regexes in `arxiv-importer.ts`
- Python/shell keywords are always lowercase; English sentence starts are capitalized. Case-sensitive matching eliminates false positives like "From the results...", "For each experiment..."

**F5: React.memo -- Sidebar NotebookRow + TabBar SortableTabItem (2026-02-28)**
- Extracted 150+ line IIFE notebook rendering block into `NotebookRow` memo component with id-based callbacks; drag callbacks use refs for stability
- Wrapped `SortableTabItem` with memo; changed from 4 inline closure props to id-based interface (onSelect/onClose/onContextMenu accept tabId); parent passes stable context references directly

**F6: ARIA accessibility -- Folder tree roles + shared Dialog component (2026-02-28)**
- Added ARIA tree roles to Sidebar: `role="tree"` on containers, `role="treeitem"` + `aria-expanded` + `aria-selected` on FolderTreeItem, `role="group"` on child containers
- Created shared `Dialog.tsx` component with `role="dialog"`, `aria-modal`, `aria-label`, Escape key close, focus trapping (Tab/Shift+Tab cycling)
- Migrated 4 dialog sites to use shared Dialog: NotebookDeleteDialog, InternalFolderDialogs (3 dialogs), LocalFolderDialogs (3 dialogs), App.tsx localSaveConflictDialog

**F7: PDF export async dataview pre-fetch (2026-02-28)**
- Added `collectDataviewAllSourceNotesAsync()` using `scanLocalFolderMountAsync` to avoid sync filesystem scan blocking main process during PDF export
- `exportNoteAsPDF` pre-populates `renderContext.dataviewAllSourceNotes` before `tiptapToHTML`, sync render pipeline never triggers sync scan

**P3.1: Semantic search "recent" filter -- use file mtime instead of indexedAt (2026-02-28)**
- Added `file_mtime` TEXT column to `note_index_status` table (migration via PRAGMA table_info detection)
- `NoteIndexStatus` type gains optional `fileMtime?: string` (ISO string)
- Indexing callers (local-notebook-index/sync.ts, register-local-folder-ipc.ts) pass `fileMtimeMs` from file read/save results
- `indexNoteIncremental`, `indexNoteFtsOnly`, `indexNoteFull` propagate fileMtime to success status; error branches inherit from existing status
- `buildEmbeddingForNote` inherits fileMtime from existing status (no file re-read)
- `filterByViewType` "recent" case uses `status.fileMtime || status.indexedAt` for local notes, preventing false positives from schema migration/embedding rebuild

**P2.1: NoteUpdateSafeResult error field naming alignment (2026-02-28)**
- Renamed `reason` to `error` in `NoteUpdateSafeResult` failed branch, aligning with `Result<T, E>` error field convention
- Kept 3-way `status` discriminant (updated/conflict/failed) -- CAS operations need conflict as a recoverable retry signal, not a binary error
- Fixed latent bug in `database-move-and-folder.test.ts`: `moveNote` toEqual assertion used `reason` instead of `error` (hidden by better-sqlite3 skip)
- Updated health doc: App.tsx Zustand assessment (not needed), file size table with current line counts, `resolveNoteNotebookAssignment` already correct

### Extract useLocalFolderSearch hook (2026-02-28)

Extracted local folder search logic from `useLocalFolderState.ts` (2,268 lines) into a dedicated `useLocalFolderSearch` hook (112 lines). Encapsulates `executeLocalSearch`, error handling, debounced search via `useVersionedDebouncedSearch`, and derived `localSearchMatchedPathSet`/`localSearchListLoading` values. Clean interface: 7 params in, 8 values out. `useLocalFolderState` reduced to 2,206 lines.

ConflictResolution and AutoDraft domains were evaluated for extraction but found too tightly coupled (11+ shared refs each) -- extraction would just move complexity without reducing it.

### Split embedding/database.ts into 3 modules (2026-02-28)

Split the 1,482-line `src/main/embedding/database.ts` into three files for maintainability:

- **`database-core.ts`** (~580 lines): Init, schema, FTS, config management, `clearAllIndexData`. Exports shared FTS state as mutable `fts` object, plus `getDb`, `embeddingsTableExists`, `getScaledThreshold` for ops module.
- **`database-ops.ts`** (~540 lines): All CRUD operations (chunks, index status, embeddings), search (vector + keyword), statistics. Imports core internals from `database-core`.
- **`database.ts`** (~42 lines): Barrel re-export file. All existing consumers (`embedding/index.ts`, `semantic-search.ts`, `indexing-service.ts`, tests) continue importing from `./database` unchanged.

Key design: replaced 4 module-level `let` variables (`ftsEnabled`, `ftsNeedsRebuild`, `ftsRebuildRunning`, `ftsRebuildDirty`) with a single exported mutable state object `fts` so both core and ops modules share the same state.

Verification: tsc passes (0 errors), vitest passes (81 files, 974 tests).

### Fix full FTS re-index on every local file edit on macOS (2026-03-02)

macOS's `fs.watch` reports nearly all file events as `'rename'` (Node.js #7420, wontfix). The watcher condition `change.eventType === 'rename' || !changedRelativePath` was effectively always true on macOS, triggering a full directory tree scan + re-read of every file on each single-file edit. Fixed by changing to `full: !changedRelativePath` -- only full-scan when the changed path is genuinely unknown. The incremental path correctly handles create/delete/modify/rename. Changed 1 line in `local-folder-watcher/manager.ts`.

### Enable on-demand embedding for local folder notes (2026-03-01)

Local folder notes were hardcoded to `ftsOnly: true` in all indexing paths, so they never generated embedding vectors. Now when a user switches away from a local note (blur), `triggerIndexCheck` passes the local note as a fallback, allowing it to go through the standard `checkAndIndex` path and build embeddings on demand. Startup sync remains FTS-only to avoid bulk embedding on app launch. Changed 2 files: `useEditorUpdateQueue.ts` (fallback param), `useNoteNavigation.ts` (ref + call sites).

### Split sanqian-sdk/tools.ts into domain files (2026-02-28)

Split the ~1,496-line `src/main/sanqian-sdk/tools.ts` into four domain files under `src/main/sanqian-sdk/tools/`:

- **`tools/web.ts`** (~55 lines): `web_search` and `fetch_web` tool builders.
- **`tools/read.ts`** (~350 lines): `search_notes`, `get_note`, `get_note_outline`, `get_notebooks` tool builders.
- **`tools/mutations.ts`** (~600 lines): `create_note`, `update_note`, `delete_note`, `move_note` tool builders.
- **`tools/index.ts`** (~55 lines): Imports all builders, assembles `buildTools()` in original tool registration order, includes editor output tools.

Each domain file exports individual builder functions (e.g., `buildSearchNotesTool()`, `buildCreateNoteTool()`) that return `AppToolDefinition`. Imports are distributed so each file only pulls what it needs. The original `tools.ts` becomes a one-line barrel re-export for backward compatibility.

Verification: tsc passes (0 errors), vitest passes (81 files, 974 tests).

### Long-term Code Health Review - Round 3 (2026-02-28)

Fresh comprehensive review across 4 dimensions (security, performance, error handling, architecture). Of ~20 agent-reported findings, independent verification confirmed 3 real issues and 1 deferred. 5 findings were false positives.

**Security fixes:**
- `setWindowOpenHandler` protocol bypass: IPC handler had http/https/mailto whitelist, but `setWindowOpenHandler` passed URLs directly to `shell.openExternal`. Added same protocol validation.
- TransclusionView XSS defense-in-depth: `tiptapToHtml()` codeBlock `language` attr not escaped (exploitable via Markdown import with crafted info string). Added `escapeHtml()` on attrs + `DOMPurify.sanitize()` on final output.

**Performance fix:**
- katex + highlight.js lazy import: These ~300KB libraries were statically imported at app startup via `note-exporter.ts` import chain. Changed to dynamic `import()` with `ensureExportLibs()` called only when PDF export is triggered.

**Deferred:**
- `collectWatchDirectories` sync I/O in fallback watcher: Only affects Linux (macOS/Windows use native recursive watcher). Async conversion would require refactoring syncWatchers timing semantics; low ROI.

### P10 Long-term Code Health - Batch 1+3 Implementation (2026-02-28)

Executed items A1-A4, B2, C1, C4 from the deep verification checklist.

**A1: IPC handler error boundary** - Created `createSafeHandler` factory in `src/main/ipc/safe-handler.ts`. Wrapped ~141 previously unprotected handlers across all 11 `register-*.ts` files. Handlers with existing domain-specific try/catch (e.g. localFolder:mount, chat:stream) kept their own handling; the wrapper catches unexpected throws with channel-name logging.

**A2: Dead code removal** - Deleted `collectLocalNotesForGetAll` and `getAllNotesForRenderer` (sync versions, ~83 lines) from `note-synthesis.ts`. Only the async versions were used by the IPC layer. Cleaned up deps interface, index.ts imports, and test mocks.

**A3: Redundant wrapper removal** - Replaced all `createLocalResourceIdWithIdentity` calls (6 files, ~20 call sites) with direct `buildCanonicalLocalResourceId` from `note-gateway.ts`. Deleted the one-line wrapper from `caching.ts`.

**A4: Architecture boundary doc** - Added module-level comment to `note-gateway.ts` documenting why sourceType branching is intentional design (different transaction models, etag semantics, field subsets per source type).

**B2: Extract useGlobalKeyboardShortcuts** - Extracted 8 refs + 95-line useEffect from App.tsx into `src/renderer/src/hooks/useGlobalKeyboardShortcuts.ts`. App.tsx reduced by ~100 lines.

**C1: Content Security Policy** - Added CSP meta tag to `src/renderer/index.html`. Policy: `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, img/font/media sources for attachment: and katex-resource: protocols.

**C4: Timing-dependent tests** - Converted `database-update-safe.test.ts` (1.1s real wait) and `concurrency.test.ts` (10ms real wait) to use `vi.useFakeTimers()`. Test execution time dropped from ~1.2s to ~13ms.

**Local file inline title rename** - Enabled inline title editing for local folder notes. Editing the title in the editor (inline textarea or header input) triggers a file rename on blur. Escape cancels and reverts to the original filename. Changes span 4 files: `Editor.tsx` (onTitleCommit prop, blur/escape handling, focus-guarded title sync), `useLocalFolderState.ts` (commitLocalFileTitleRename with flush-before-rename, in-place state swap, error rollback), `App.tsx` (wiring), `LocalFolderDialogs.tsx` (fixed pre-existing bug where allViewLocalEditorTarget was not updated after right-click rename).

**Fix: Inline math regex greedy matching** - Fixed `$...$` inline math regex across all 7 locations to follow KaTeX/Obsidian convention: opening `$` must be followed by non-space, closing `$` must be preceded by non-space. Previously `"$50 and formula is $E=mc^2$"` would incorrectly match `"$50 and formula is $"` as math. Extracted shared pattern to `src/shared/markdown/math-patterns.ts` (`INLINE_MATH_RE`, `INLINE_MATH_GUARDED_RE`, `INLINE_MATH_DETECT_RE`, `INLINE_MATH_CONTENT`) to eliminate regex duplication across `inline-parser.ts`, `markdown-to-tiptap.ts`, and `MarkdownPaste.ts`.

**Fix: Database init error handling** - Wrapped `initDatabase()` and `initVectorDatabase()` in try-catch in `index.ts`. Main DB failure shows `dialog.showErrorBox` and quits gracefully instead of crashing. Vector DB failure is non-fatal (logged, app continues without search/embedding).

**Fix: "No notes yet" flash on All Notes view switch** - Converted `allSourceLocalNotes` and `globalSmartViewNotes` from async IPC-fetched `useState` to synchronous `useMemo` derivations in App.tsx. Root cause was `setGlobalSmartViewNotes([])` clearing state before async IPC fetch completed. The renderer already had all data needed to compute these values (`notes`, `localFolderTreeCache`, `localNoteMetadataById`). Extracted `applyViewTypeFilter` and `resolveRecentThresholdMs` to `src/shared/note-filters.ts` for reuse by both main and renderer. Removed ~100 lines of async reload scheduling code (4 useCallbacks, 4 refs, 3 useEffects) from `useLocalFolderState.ts` and eliminated 3 redundant `getAll({ includeLocal: true })` IPC calls across `loadData`, `useNoteDataChangedReload`, and `useNoteCRUD`. Used `useDeferredValue(notes)` for `globalSmartViewNotes` to prevent O(n log n) merge+sort on every keystroke (replaces old 280ms debounce with React-level scheduling). Used module-level `EMPTY_NOTES` constant for referential stability when globalSmartViewNotes returns empty.

**Fix: Click in title-editor gap scrolls to document bottom** - Moved `padding-bottom: 160px` from `.zen-content` (wrapper) to `.zen-editor` (ProseMirror element) so ProseMirror natively handles clicks in the bottom padding area via `posAtCoords`. Removed `focus('end')` from the scroll-wrapper onClick handler -- now just calls `focus()` for clicks outside the editor (side margins, title-editor gap). Updated typewriter mode padding target accordingly. Added `stopPropagation` to CalloutView and ToggleView toggle handlers for consistency.

### Fix: Local folder note save race condition (2026-03-01)

Switching between local folder notes would overwrite the target note with the previously edited note's content. Root cause: Editor.tsx has a 300ms debounce before calling `handleUpdateLocalFile`, and `useLocalFolderState` has a separate 1000ms save debounce. When `openLocalFile(B)` called `flushLocalFileSave()`, the editor debounce hadn't fired yet (nothing to flush). During the async IPC read of file B, the 300ms timer fired and queued file A's content into `localPendingContentRef`. By the time `processLocalFileSaveQueue` ran, `localOpenFileRef.current` had already switched to B, so A's content was written to B's path.

Fix: Changed `localPendingContentRef` from `string | null` to `{ content, notebookId, relativePath } | null`, binding the target file at queue-time. `processLocalFileSaveQueue` validates the pending target matches `localOpenFileRef.current` before saving; stale content for a different file is discarded.

Codebase-wide review confirmed no similar issues elsewhere: internal notes use per-noteId Map keying (no ref-based target lookup), TypewriterMode only handles internal notes, conflict state is properly cleared on file switch.

### Perf: Eliminate note-switch UI flicker (2026-03-01)

Removed `key={note.id}` from ZenEditor to reuse the Tiptap editor instance across note switches instead of destroying and rebuilding ~45 extensions and ~60 ProseMirror plugins each time. Core changes:

- **Editor.tsx**: Added `noteIdRef` for closure-safe `onUpdate` callback. Added note-switch reset effect that synchronously replaces content, resets per-note state (title, selection, composing refs, search bar), closes all popups/panels, cancels in-progress AI actions, and clears undo/redo history. Simplified content sync effect to skip note-switch handling (now delegated to reset effect). Extracted `parseNoteContent()` utility. Removed `key={note.id}` from ZenEditor.
- **App.tsx**: Added 150ms fade-in animation-delay on local editor loading overlay to avoid flash on fast loads.
- **useLocalFolderState.ts**: Skip `setLocalEditorNote(null)` when `keepNextSelection=true` (switching files), preventing blank editor flash.
- **Editor.css**: Added `@keyframes editorLoadingFadeIn` for loading overlay delay.

### Safety: Local folder file operation hardening (2026-03-01)

Comprehensive safety review of local folder code identified and fixed three race conditions:

1. **Rename meta null -> conflict detection bypass**: After renaming a file via inline title edit, `localOpenFileMetaRef` was set to null, disabling conflict detection for the next save. Fix: `renameLocalFolderEntry` (both sync/async in io.ts) now stats the renamed file and returns `mtime_ms`/`size`. Renderer uses these to populate `localOpenFileMetaRef` instead of nulling it.

2. **Delete-save race -> file resurrection**: When deleting the currently open file, `onLocalEditorClear()` was called AFTER the delete IPC. Editor's 300ms debounce could fire during the async delete, re-queuing content and resurrecting the deleted file. Fix: moved `onLocalEditorClear()` to before the delete IPC (right after flush), disarming the save mechanism before the file is removed.

3. **Watch suppression gap -> missed external changes**: The 1200ms watch suppression window silently dropped all incoming file-change events. External edits arriving during suppression were permanently lost until the next event. Fix: suppressed events now schedule a compensating refresh for after the suppression window expires, using the existing `localWatchRefreshTimers` map.

4. **Two-level debounce race -> file switch content corruption** (root cause of the original "all notes overwritten" bug): Editor.tsx has a 300ms internal debounce, and `flushLocalFileSave()` could not flush it. When switching from file A to B: `openLocalFile` called `flushLocalFileSave()` (nothing to flush - Editor debounce hadn't fired), then IPC read B, updated `localOpenFileRef` to B. Later the Editor debounce fired with A's content, but `localOpenFileRef` already pointed to B, so A's content was queued targeting B. Three-layer fix:
   - **Layer 1 (flush bridge)**: Exposed `flushPendingSave()` via `EditorHandle`, wired into `flushLocalFileSave()` via `localEditorFlushRef`. Flushes the Editor's 300ms debounce while `localOpenFileRef` still points to A.
   - **Layer 2 (useLayoutEffect)**: Changed Editor's save-flush cleanup effect from `useEffect` to `useLayoutEffect`. The cleanup now fires synchronously during React's commit phase, BEFORE any pending setTimeout (the 300ms debounce) can sneak in between the render and the async cleanup.
   - **Layer 3 (ID guard)**: Added note ID mismatch guard in `handleUpdateLocalFile`: rejects any update where `_id` (from the editor's `noteIdRef` or closure) doesn't match `localEditorNoteRef.current.id`. When the cleanup fires with A's note.id but `localEditorNoteRef` has already been updated to B, the stale update is discarded.

5. **Conflict resolution broken in all-source view**: `LocalSaveConflictDialogState` did not store `notebookId`. The three conflict resolution handlers (`Overwrite`/`Reload`/`SaveAsCopy`) all used `selectedNotebookId`, which is `null` in all-source view. This caused the handlers to silently bail (`if (!selectedNotebookId) return`), leaving the conflict dialog unresolvable. Fix: added `notebookId` to `LocalSaveConflictDialogState` (captured from the pending save's target), all three handlers now use `localSaveConflictDialog.notebookId` instead of `selectedNotebookId`.

### 2026-03-02: Align local folder note FTS indexing with native note behavior

Local folder notes were triggering FTS re-index on every file save (via watcher incremental sync AND `localFolder:saveFile` handler), while the user was actively editing. Native notes only index on blur (note switch). Changes:

1. **`sync.ts` incremental path**: Removed `checkAndIndex` and `deleteLegacyLocalIndexByPath` from watcher-triggered sync. Tag/ref sync still runs (lightweight).
2. **`register-local-folder-ipc.ts` saveFile handler**: Removed `checkAndIndex` and `deleteLegacyLocalIndexByPath` calls after save.
3. **Dead code cleanup**: Removed `checkAndIndex`, `resolveLocalIndexNoteId`, `deleteLegacyLocalIndexByPath` from `LocalFolderIpcDeps` interface and `index.ts` injection (no longer used by IPC handlers). Legacy index cleanup is now only performed during full sync path, preventing "delete-without-rebuild" orphan risk.

FTS indexing now only happens on: app startup (full sync), note switch (blur trigger), and AI agent edits (SDK mutations). This matches native note behavior and eliminates unnecessary I/O during editing.

4. **Fix: local note index ID format mismatch**: The renderer uses `"local:notebookId:encodedPath"` format for note IDs, but the full sync path indexes under the stable UUID from `local_note_identity`. This mismatch caused: (a) content hash comparison always failing on blur (re-indexing every time even when content unchanged), (b) duplicate FTS/embedding entries under two keys, (c) potential duplicate search results. Fix: added ID normalization at the top of `IndexingService.checkAndIndex()` -- local path-format IDs are resolved to their canonical UUID via `buildCanonicalLocalResourceId` before any index operations.

### Fix: watcher non-note paths leaking into IndexingService (2026-03-02)

Two categories of non-note filesystem events were leaking into the index sync pipeline, causing spurious "index deleted" log entries:

1. **Atomic-write temp files**: `atomicWriteUtf8File` creates `.{name}.tmp-{pid}-{timestamp}-{random}` temp files. Watcher reported these, incremental sync tried to read them (already renamed), failed, and `deleteLegacyLocalIndexByPath` unconditionally called `indexingService.deleteNoteIndex` with a path-format ID.
2. **Directory-level events**: macOS `fs.watch(recursive: true)` reports directory change events alongside file events. E.g. modifying `Ideas/note.md` also fires an event for `Ideas` itself. The incremental sync tried `readLocalFolderFile(mount, "Ideas")` which failed (`extname("Ideas")` = `""`, not in `ALLOWED_EXTENSIONS`), then `deleteLegacyLocalIndexByPath` constructed `local:notebookId:Ideas` and called delete.

Fix (two layers):
- **Watcher handler filter** (`manager.ts`): Added `isHiddenRelativePath` check. Hidden paths (any segment starting with `.`) skip watch event and index sync entirely. Tree cache invalidation still fires so the subsequent rename event triggers the real sync.
- **`normalizeLocalIndexSyncPath`** (`helpers.ts`): Now rejects (a) paths with hidden segments and (b) paths without allowed note extensions (`.md`/`.txt`). This filters directory names, non-note files, and temp files at the index sync entry point. When the path normalizes to null in `enqueueLocalNotebookIndexSync`, it's not added to `request.paths`, and `{ full: false, paths: Set() }` early-returns at sync.ts line 65-67.

### Test: comprehensive coverage for local folder indexing (2026-03-02)

Added 96 unit/integration tests across 3 new test files for the local folder indexing system that previously had zero test coverage:

- `src/main/local-notebook-index/__tests__/helpers.test.ts` (23 tests) -- all 8 exported helper functions: path normalization, ID resolution, legacy index deletion, indexed ID collection, tag sync, popup ref sync
- `src/main/local-notebook-index/__tests__/sync.test.ts` (28 tests) -- sync engine: incremental/full sync paths, debounce scheduling (900ms default, immediate mode), path merging, request upgrade (incremental -> full), cancellation/generation invalidation, re-scheduling after completion, flush, rebuild
- `src/main/__tests__/register-local-folder-ipc.test.ts` (45 tests) -- all 11+ IPC handlers: saveFile (etag, if_match conflict, force), createFile, renameEntry (file/folder, metadata warning), deleteEntry (file/folder, trash failure, affected mounts), mount (canonicalize, duplicate, permissions), relink, unmount, getTree (status recovery, scan error), readFile, listNoteMetadata, updateNoteMetadata (validation, mount status checks)

### feat: hover preview popover for local folder notes (2026-03-02)

Aligned local folder note list hover behavior with native notes. Local notes now show a preview popover (1.5s hover delay) displaying AI summary and tags, matching the NoteList experience.

Key changes:
- `NotePreviewPopover`: added `preloadedTags` prop to bypass IPC tag loading (local note IDs don't exist in `note_tags` table). Narrowed `note` prop type to `Pick<Note, 'id' | 'ai_summary'>` for reuse.
- `NoteList`: passes `preloadedTags` when `hoveredNote.tags` is non-empty, fixing a pre-existing bug where local notes in the all-source view never showed tags in the hover popover.
- `LocalFolderNoteList`: full hover state management (1.5s delay, instant switch, 100ms close grace, metadata sync, search/folder change cleanup), hover CSS fix (always show hover bg), popover rendering.
- `App.tsx`: passes `notebookId` and `localNoteMetadataById` to `LocalFolderNoteList`.

Files: `NotePreviewPopover.tsx`, `NoteList.tsx`, `LocalFolderNoteList.tsx`, `App.tsx`

---

### v0.5.2 (2026-03-29)

**New Features / 新功能**

- **Separate single file import / 单文件导入分离**: Single file import is now separated from folder import for a clearer workflow.
- **Editor link management / 编辑器链接管理**: Robust bi-directional link tracking and management in the editor.

**Improvements / 改进**

- Shrink app icon logo to 70% with more padding / 缩小应用图标至 70% 并增加内边距
- Unify markdown export layout and harden attachment extension handling / 统一 Markdown 导出布局，加固附件扩展名处理

**Bug Fixes / 修复**

- Fix PDF/Markdown export losing text color and highlight color / 修复 PDF/Markdown 导出时文字颜色和高亮颜色丢失
- Fix context menu submenu misalignment / 修复右键菜单子菜单位置偏移
- Fix notebook folder move interactions / 修复笔记本文件夹移动交互问题
- Fix local folder notes undo history corruption caused by Markdown round-trip (skip refresh when file metadata unchanged; use block-level minimal diff with addToHistory:false for genuine external changes to preserve ProseMirror position mappings) / 修复本地文件夹笔记因 Markdown 转换往返导致的撤回历史被破坏问题（元数据未变时跳过刷新；外部变更时使用 block 级最小 diff + addToHistory:false 保护 undo 位置映射）
