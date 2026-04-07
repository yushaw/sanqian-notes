import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { describe, it, expect } from 'vitest'

const RENDERER_SOURCE_ROOT = path.resolve(process.cwd(), 'src/renderer/src')
const ALLOWED_DRAG_REGION_TOKEN_FILES = [
  'components/DragRegionContainer.tsx',
  'components/WindowDragStrip.tsx',
]
const DRAG_REGION_TOKEN_PATTERN = /(^|\s)drag-region($|\s)/

function collectRendererTsxFiles(rootDir: string): string[] {
  const stack = [rootDir]
  const files: string[] = []

  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (!currentDir) continue

    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue
        stack.push(absolutePath)
        continue
      }
      if (entry.isFile() && absolutePath.endsWith('.tsx')) {
        files.push(absolutePath)
      }
    }
  }

  return files
}

function hasStandaloneDragRegionToken(content: string): boolean {
  const sourceFile = ts.createSourceFile(
    'drag-region-token-check.tsx',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let hasToken = false

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (DRAG_REGION_TOKEN_PATTERN.test(node.text)) {
        hasToken = true
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return hasToken
}

describe('drag region token usage allowlist', () => {
  it('limits standalone drag-region tokens in renderer TSX to wrapper components only', () => {
    const files = collectRendererTsxFiles(RENDERER_SOURCE_ROOT)
    const offenders: string[] = []

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      if (!hasStandaloneDragRegionToken(content)) continue
      offenders.push(path.relative(RENDERER_SOURCE_ROOT, filePath))
    }

    expect(offenders.sort()).toEqual(ALLOWED_DRAG_REGION_TOKEN_FILES.slice().sort())
  })
})
