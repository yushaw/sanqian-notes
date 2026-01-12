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
- **Dark/Light Mode** - Theme follows system or manual toggle
- **Multi-language** - English and Chinese support

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Editor**: Tiptap (ProseMirror)
- **Styling**: Tailwind CSS
- **Database**: SQLite (better-sqlite3)
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

## License

MIT
