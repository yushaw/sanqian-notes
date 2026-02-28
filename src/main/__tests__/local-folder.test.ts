import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import type { LocalFolderNotebookMount } from '../../shared/types'
import {
  createLocalFolder,
  createLocalFolderFile,
  dedupeLocalFolderSearchHits,
  readLocalFolderFile,
  renameLocalFolderEntry,
  saveLocalFolderFile,
  scanLocalFolderMount,
  scanLocalFolderMountAsync,
  scanLocalFolderMountForSearchAsync,
  searchLocalFolderMount,
  searchLocalFolderMountAsync,
} from '../local-folder'

function createMount(rootPath: string): LocalFolderNotebookMount {
  const now = new Date().toISOString()
  return {
    notebook: {
      id: 'nb-test',
      name: 'Test Mount',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: 'nb-test',
      root_path: rootPath,
      canonical_root_path: rootPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sanqian-local-folder-'))
  tempDirs.push(dir)
  return dir
}

function withMockedPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor || !descriptor.configurable) {
    return run()
  }

  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('local-folder operations', () => {
  it('createLocalFolderFile should append .md extension by default', () => {
    const root = createTempDir()
    const mount = createMount(root)

    const created = createLocalFolderFile(mount, null, 'draft')
    expect(created.success).toBe(true)
    if (!created.success) return
    expect(created.result.relative_path).toBe('draft.md')
  })

  it('scanLocalFolderMount should include deep files beyond level 3', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const deepDir = join(root, 'lvl1', 'lvl2', 'lvl3', 'lvl4', 'lvl5')
    mkdirSync(deepDir, { recursive: true })
    writeFileSync(join(deepDir, 'deep.md'), '# deep\n', 'utf-8')

    const scanned = scanLocalFolderMount(mount)
    expect(scanned.files.some((file) => file.relative_path === 'lvl1/lvl2/lvl3/lvl4/lvl5/deep.md')).toBe(true)
  })

  it('createLocalFolder should still enforce UI depth limit for new folders', () => {
    const root = createTempDir()
    const mount = createMount(root)

    const lvl1 = createLocalFolder(mount, null, 'lvl1')
    expect(lvl1.success).toBe(true)
    const lvl2 = createLocalFolder(mount, 'lvl1', 'lvl2')
    expect(lvl2.success).toBe(true)
    const lvl3 = createLocalFolder(mount, 'lvl1/lvl2', 'lvl3')
    expect(lvl3.success).toBe(false)
    if (!lvl3.success) {
      expect(lvl3.errorCode).toBe('LOCAL_FOLDER_DEPTH_LIMIT')
    }
  })

  it('renameLocalFolderEntry should keep original extension when extension is omitted', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'note.md')
    writeFileSync(filePath, '# note\n', 'utf-8')

    const renamed = renameLocalFolderEntry(mount, {
      notebook_id: mount.notebook.id,
      relative_path: 'note.md',
      kind: 'file',
      new_name: 'renamed',
    })

    expect(renamed.success).toBe(true)
    if (!renamed.success) return
    expect(renamed.result.relative_path).toBe('renamed.md')
  })

  it('renameLocalFolderEntry should allow case-only rename on case-insensitive platforms', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'note.md')
    writeFileSync(filePath, '# note\n', 'utf-8')

    withMockedPlatform('win32', () => {
      const renamed = renameLocalFolderEntry(mount, {
        notebook_id: mount.notebook.id,
        relative_path: 'note.md',
        kind: 'file',
        new_name: 'Note',
      })

      expect(renamed.success).toBe(true)
      if (!renamed.success) return
      expect(renamed.result.relative_path).toBe('Note.md')
      expect(existsSync(join(root, 'Note.md'))).toBe(true)
    })
  })

  it('rejects Windows-incompatible file and folder names for cross-platform safety', () => {
    const root = createTempDir()
    const mount = createMount(root)

    const reservedFile = createLocalFolderFile(mount, null, 'CON')
    expect(reservedFile.success).toBe(false)
    if (!reservedFile.success) {
      expect(reservedFile.errorCode).toBe('LOCAL_FILE_INVALID_NAME')
    }

    const invalidCharFile = createLocalFolderFile(mount, null, 'bad:name.md')
    expect(invalidCharFile.success).toBe(false)
    if (!invalidCharFile.success) {
      expect(invalidCharFile.errorCode).toBe('LOCAL_FILE_INVALID_NAME')
    }

    const trailingDotFolder = createLocalFolder(mount, null, 'folder.')
    expect(trailingDotFolder.success).toBe(false)
    if (!trailingDotFolder.success) {
      expect(trailingDotFolder.errorCode).toBe('LOCAL_FILE_INVALID_NAME')
    }
  })

  it('rejects Windows-incompatible rename targets', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'note.md')
    writeFileSync(filePath, '# note\n', 'utf-8')

    const reservedRename = renameLocalFolderEntry(mount, {
      notebook_id: mount.notebook.id,
      relative_path: 'note.md',
      kind: 'file',
      new_name: 'AUX',
    })
    expect(reservedRename.success).toBe(false)
    if (!reservedRename.success) {
      expect(reservedRename.errorCode).toBe('LOCAL_FILE_INVALID_NAME')
    }
  })

  it('saveLocalFolderFile should detect conflicts based on mtime/size', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'note.md')
    writeFileSync(filePath, '# old\n', 'utf-8')

    const before = statSync(filePath)
    writeFileSync(filePath, '# updated outside\n', 'utf-8')

    const tiptapContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'inside app change' }],
        },
      ],
    })

    const saved = saveLocalFolderFile(mount, 'note.md', tiptapContent, {
      expectedMtimeMs: before.mtimeMs,
      expectedSize: before.size,
    })

    expect(saved.success).toBe(false)
    if (saved.success) return
    expect(saved.errorCode).toBe('LOCAL_FILE_CONFLICT')
  })

  it('saveLocalFolderFile should detect same-mtime same-size conflicts via content hash', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'note.md')
    writeFileSync(filePath, 'alpha old', 'utf-8')

    const before = statSync(filePath)
    const baseline = readLocalFolderFile(mount, 'note.md')
    expect(baseline.success).toBe(true)
    if (!baseline.success) return

    writeFileSync(filePath, 'alpha new', 'utf-8') // same byte length as "alpha old"
    utimesSync(filePath, before.atime, new Date(before.mtimeMs))

    const tiptapContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'inside app change' }],
        },
      ],
    })

    const saved = saveLocalFolderFile(mount, 'note.md', tiptapContent, {
      expectedMtimeMs: before.mtimeMs,
      expectedSize: before.size,
      expectedContentHash: baseline.result.content_hash,
    })

    expect(saved.success).toBe(false)
    if (saved.success) return
    expect(saved.errorCode).toBe('LOCAL_FILE_CONFLICT')
    if (saved.errorCode !== 'LOCAL_FILE_CONFLICT') return
    expect(saved.conflict.content_hash).toBeDefined()
    expect(saved.conflict.content_hash).not.toBe(baseline.result.content_hash)
  })

  it('searchLocalFolderMount should find content matches and return stable sorted hits', () => {
    const root = createTempDir()
    const mount = createMount(root)
    writeFileSync(join(root, 'a.md'), 'alpha beta alpha', 'utf-8')
    writeFileSync(join(root, 'b.md'), 'alpha', 'utf-8')

    const hits = searchLocalFolderMount(mount, 'alpha', null)
    expect(hits.length).toBe(2)
    expect(hits[0].relative_path).toBe('a.md')
    expect(hits[1].relative_path).toBe('b.md')
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('searchLocalFolderMountAsync should return the same ranking as sync search', async () => {
    const root = createTempDir()
    const mount = createMount(root)
    writeFileSync(join(root, 'a.md'), 'alpha beta alpha', 'utf-8')
    writeFileSync(join(root, 'b.md'), 'alpha', 'utf-8')

    const asyncHits = await searchLocalFolderMountAsync(mount, 'alpha', null)
    const syncScannedTree = scanLocalFolderMount(mount)
    const syncHits = searchLocalFolderMount(mount, 'alpha', null, syncScannedTree)

    expect(asyncHits).toEqual(syncHits)
  })

  it('scanLocalFolderMountForSearchAsync should collect the same searchable file paths as sync scan', async () => {
    const root = createTempDir()
    const mount = createMount(root)
    mkdirSync(join(root, 'docs', 'sub'), { recursive: true })
    writeFileSync(join(root, 'root.md'), 'alpha root', 'utf-8')
    writeFileSync(join(root, 'docs', 'note.txt'), 'alpha txt', 'utf-8')
    writeFileSync(join(root, 'docs', 'sub', 'nested.md'), 'alpha nested', 'utf-8')

    const syncScanned = scanLocalFolderMount(mount)
    const asyncScanned = await scanLocalFolderMountForSearchAsync(mount)

    const syncPaths = syncScanned.files.map((file) => file.relative_path).sort()
    const asyncPaths = asyncScanned.files.map((file) => file.relative_path).sort()
    expect(asyncPaths).toEqual(syncPaths)
  })

  it('searchLocalFolderMount should apply folder scope recursively', () => {
    const root = createTempDir()
    const mount = createMount(root)
    writeFileSync(join(root, 'root.md'), 'alpha root', 'utf-8')
    const subDir = join(root, 'docs')
    mkdirSync(join(subDir, 'deep'), { recursive: true })
    writeFileSync(join(subDir, 'doc.md'), 'alpha doc', 'utf-8')
    writeFileSync(join(subDir, 'deep', 'deep.md'), 'alpha deep', 'utf-8')

    const hits = searchLocalFolderMount(mount, 'alpha', 'docs')
    expect(hits.map((hit) => hit.relative_path).sort()).toEqual(['docs/deep/deep.md', 'docs/doc.md'])
  })

  it('searchLocalFolderMount should invalidate cached content when same-size edits restore mtime', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'cache.md')

    writeFileSync(filePath, 'alpha old', 'utf-8')
    expect(searchLocalFolderMount(mount, 'alpha', null).length).toBe(1)

    const before = statSync(filePath)
    writeFileSync(filePath, 'alpha new', 'utf-8') // same byte length as "alpha old"
    utimesSync(filePath, before.atime, new Date(before.mtimeMs))

    const hits = searchLocalFolderMount(mount, 'new', null)
    expect(hits.length).toBe(1)
    expect(hits[0].relative_path).toBe('cache.md')
  })

  it('dedupeLocalFolderSearchHits should dedupe by canonical path and keep best score', () => {
    const hits = dedupeLocalFolderSearchHits([
      {
        notebook_id: 'a',
        relative_path: 'x.md',
        canonical_path: '/same/x.md',
        score: 3,
        mtime_ms: 1,
        snippet: 'a',
      },
      {
        notebook_id: 'b',
        relative_path: 'x.md',
        canonical_path: '/same/x.md',
        score: 8,
        mtime_ms: 2,
        snippet: 'b',
      },
      {
        notebook_id: 'c',
        relative_path: 'y.md',
        canonical_path: '/same/y.md',
        score: 6,
        mtime_ms: 3,
        snippet: 'c',
      },
    ])

    expect(hits.length).toBe(2)
    expect(hits[0].canonical_path).toBe('/same/x.md')
    expect(hits[0].score).toBe(8)
    expect(hits[1].canonical_path).toBe('/same/y.md')
  })

  it('readLocalFolderFile should recover after file permissions are restored', () => {
    if (process.platform === 'win32') {
      return
    }

    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'locked.md')
    writeFileSync(filePath, '# locked\n', 'utf-8')

    const originalMode = statSync(filePath).mode & 0o777
    try {
      chmodSync(filePath, 0o000)
      const blocked = readLocalFolderFile(mount, 'locked.md')
      expect(blocked.success).toBe(false)
      if (!blocked.success) {
        expect(blocked.errorCode).toBe('LOCAL_FILE_UNREADABLE')
      }
    } finally {
      chmodSync(filePath, originalMode)
    }

    const recovered = readLocalFolderFile(mount, 'locked.md')
    expect(recovered.success).toBe(true)
  })

  it('readLocalFolderFile should map toc markdown to tocBlock node', () => {
    const root = createTempDir()
    const mount = createMount(root)
    writeFileSync(join(root, 'toc.md'), '# Title\n\n```toc\n```\n', 'utf-8')

    const result = readLocalFolderFile(mount, 'toc.md')
    expect(result.success).toBe(true)
    if (!result.success) return

    const content = JSON.parse(result.result.tiptap_content) as { content?: Array<{ type?: string }> }
    const nodeTypes = (content.content || []).map((node) => node.type)
    expect(nodeTypes).toContain('tocBlock')
    expect(nodeTypes).not.toContain('tableOfContents')
  })

  it('readLocalFolderFile should parse leading front matter as frontmatter node', () => {
    const root = createTempDir()
    const mount = createMount(root)
    writeFileSync(
      join(root, 'frontmatter.md'),
      `---
tags:
  - AI
aliases:
  - Dataset Guide
---

# Body Title

正文内容
`,
      'utf-8'
    )

    const result = readLocalFolderFile(mount, 'frontmatter.md')
    expect(result.success).toBe(true)
    if (!result.success) return

    const content = JSON.parse(result.result.tiptap_content) as {
      content?: Array<{ type?: string; attrs?: { language?: string }; content?: Array<{ text?: string }> }>
    }
    const nodes = content.content || []
    expect(nodes[0]?.type).toBe('frontmatter')
    expect(nodes[0]?.content?.[0]?.text).toContain('tags:')
    expect(nodes[0]?.content?.[0]?.text).toContain('aliases:')
    expect(nodes[1]?.type).toBe('heading')
    expect(nodes[1]?.content?.[0]?.text).toBe('Body Title')
  })

  it('saveLocalFolderFile should keep front matter when editor content contains frontmatter node', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'keep-frontmatter.md')
    writeFileSync(
      filePath,
      `---
tags:
  - AI
aliases:
  - Keep Me
---

old body
`,
      'utf-8'
    )

    const tiptapContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'frontmatter',
          content: [{ type: 'text', text: 'tags:\n  - AI\naliases:\n  - Keep Me' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'new body' }],
        },
      ],
    })

    const saved = saveLocalFolderFile(mount, 'keep-frontmatter.md', tiptapContent, { force: true })
    expect(saved.success).toBe(true)

    const nextRawContent = readFileSync(filePath, 'utf-8')
    expect(nextRawContent).toContain('new body')
    expect(nextRawContent).not.toContain('old body')
    expect(nextRawContent).toContain('---\ntags:')
    expect(nextRawContent).toContain('aliases:')
    expect(nextRawContent).toContain('\n---\n\nnew body')
  })

  it('saveLocalFolderFile should keep front matter for legacy yaml-frontmatter code block', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'legacy-frontmatter.md')
    writeFileSync(
      filePath,
      `---
tags:
  - AI
---

old body
`,
      'utf-8'
    )

    const tiptapContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'yaml-frontmatter' },
          content: [{ type: 'text', text: 'tags:\n  - AI' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'legacy body' }],
        },
      ],
    })

    const saved = saveLocalFolderFile(mount, 'legacy-frontmatter.md', tiptapContent, { force: true })
    expect(saved.success).toBe(true)

    const nextRawContent = readFileSync(filePath, 'utf-8')
    expect(nextRawContent).toContain('---\ntags:\n  - AI\n---')
    expect(nextRawContent).toContain('legacy body')
    expect(nextRawContent).not.toContain('```yaml-frontmatter')
  })

  it('saveLocalFolderFile should preserve CRLF and UTF-8 BOM format', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'format.md')
    writeFileSync(filePath, '\uFEFFline 1\r\n\r\nline 2\r\n', 'utf-8')

    const tiptapContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'next line 1' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'next line 2' }],
        },
      ],
    })

    const saved = saveLocalFolderFile(mount, 'format.md', tiptapContent, { force: true })
    expect(saved.success).toBe(true)

    const nextRawContent = readFileSync(filePath, 'utf-8')
    expect(nextRawContent.startsWith('\uFEFF')).toBe(true)
    expect(nextRawContent).toContain('\r\n\r\n')
    expect(nextRawContent.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('saveLocalFolderFile should skip no-op writes when content is unchanged', () => {
    const root = createTempDir()
    const mount = createMount(root)
    const filePath = join(root, 'stable.md')
    writeFileSync(filePath, 'stable line\n', 'utf-8')

    const baseline = readLocalFolderFile(mount, 'stable.md')
    expect(baseline.success).toBe(true)
    if (!baseline.success) return

    const firstSave = saveLocalFolderFile(mount, 'stable.md', baseline.result.tiptap_content, { force: true })
    expect(firstSave.success).toBe(true)
    if (!firstSave.success) return

    const canonicalAfterFirstSave = readLocalFolderFile(mount, 'stable.md')
    expect(canonicalAfterFirstSave.success).toBe(true)
    if (!canonicalAfterFirstSave.success) return

    const secondSave = saveLocalFolderFile(
      mount,
      'stable.md',
      canonicalAfterFirstSave.result.tiptap_content,
      { force: true }
    )
    expect(secondSave.success).toBe(true)
    if (!secondSave.success) return

    expect(secondSave.result.mtime_ms).toBe(firstSave.result.mtime_ms)
    expect(secondSave.result.size).toBe(firstSave.result.size)
    expect(secondSave.result.content_hash).toBe(canonicalAfterFirstSave.result.content_hash)
  })

  it('scanLocalFolderMount should reject root path when canonical root no longer matches', () => {
    if (process.platform === 'win32') {
      return
    }

    const symlinkContainer = createTempDir()
    const canonicalRoot = createTempDir()
    const retargetRoot = createTempDir()
    const linkedRootPath = join(symlinkContainer, 'mount-root')

    symlinkSync(canonicalRoot, linkedRootPath)
    writeFileSync(join(canonicalRoot, 'first.md'), '# first\n', 'utf-8')
    writeFileSync(join(retargetRoot, 'second.md'), '# second\n', 'utf-8')

    const mount = {
      ...createMount(linkedRootPath),
      mount: {
        ...createMount(linkedRootPath).mount,
        canonical_root_path: canonicalRoot,
      },
    }

    const initialTree = scanLocalFolderMount(mount)
    expect(initialTree.files.some((file) => file.relative_path === 'first.md')).toBe(true)

    rmSync(linkedRootPath, { force: true })
    symlinkSync(retargetRoot, linkedRootPath)

    expect(() => scanLocalFolderMount(mount)).toThrowError(
      expect.objectContaining({ code: 'ENOENT' })
    )
  })

  it('scanLocalFolderMountAsync should produce equivalent tree and file results as sync scan', async () => {
    const root = createTempDir()
    const mount = createMount(root)
    mkdirSync(join(root, 'docs', 'sub'), { recursive: true })
    writeFileSync(join(root, 'root.md'), '# root\n', 'utf-8')
    writeFileSync(join(root, 'docs', 'note.txt'), '# txt note\n', 'utf-8')
    writeFileSync(join(root, 'docs', 'sub', 'nested.md'), '# nested\n', 'utf-8')

    const syncResult = scanLocalFolderMount(mount)
    const asyncResult = await scanLocalFolderMountAsync(mount)

    // Compare file lists
    const syncFilePaths = syncResult.files.map((f) => f.relative_path).sort()
    const asyncFilePaths = asyncResult.files.map((f) => f.relative_path).sort()
    expect(asyncFilePaths).toEqual(syncFilePaths)

    // Compare tree node names and structure
    function flattenTreeNames(nodes: typeof syncResult.tree): string[] {
      const names: string[] = []
      for (const node of nodes) {
        names.push(`${node.kind}:${node.name}:${node.relative_path}`)
        if (node.children) {
          names.push(...flattenTreeNames(node.children))
        }
      }
      return names
    }

    expect(flattenTreeNames(asyncResult.tree)).toEqual(flattenTreeNames(syncResult.tree))
    expect(asyncResult.tree.length).toBeGreaterThan(0)
  })

  it('read/save should reject paths that escape root through symlinked parent directories', () => {
    if (process.platform === 'win32') {
      return
    }

    const root = createTempDir()
    const outsideDir = createTempDir()
    const mount = createMount(root)

    writeFileSync(join(outsideDir, 'escaped.md'), '# escaped\n', 'utf-8')
    symlinkSync(outsideDir, join(root, 'jump'))

    const readResult = readLocalFolderFile(mount, 'jump/escaped.md')
    expect(readResult.success).toBe(false)
    if (!readResult.success) {
      expect(readResult.errorCode).toBe('LOCAL_FILE_OUT_OF_ROOT')
    }

    const tiptapContent = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'overwrite attempt' }] }],
    })
    const saveResult = saveLocalFolderFile(mount, 'jump/escaped.md', tiptapContent, { force: true })
    expect(saveResult.success).toBe(false)
    if (!saveResult.success) {
      expect(saveResult.errorCode).toBe('LOCAL_FILE_OUT_OF_ROOT')
    }
  })
})
