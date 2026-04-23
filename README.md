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
