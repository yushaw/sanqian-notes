import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

const RENDERER_SOURCE_ROOT = path.resolve(process.cwd(), 'src/renderer/src')
const ALLOWED_DRAG_REGION_CLASS_FILES: string[] = []
const CLASS_NAME_LITERAL_PATTERNS = [
  /className\s*=\s*"([^"]*)"/g,
  /className\s*=\s*'([^']*)'/g,
  /className\s*=\s*\{`([\s\S]*?)`\}/g,
]

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

describe('drag region class usage allowlist', () => {
  it('limits direct className drag-region usage to explicit exceptions', () => {
    const files = collectRendererTsxFiles(RENDERER_SOURCE_ROOT)
    const offenders: string[] = []

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      const hasDragRegionClass = hasDirectDragRegionClassToken(content)
      if (hasDragRegionClass) {
        offenders.push(path.relative(RENDERER_SOURCE_ROOT, filePath))
      }
    }

    expect(offenders.sort()).toEqual(ALLOWED_DRAG_REGION_CLASS_FILES.slice().sort())
  })
})

function hasDirectDragRegionClassToken(content: string): boolean {
  for (const pattern of CLASS_NAME_LITERAL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const classValue = match[1]
      if (!classValue) continue
      const normalizedClassValue = classValue.replace(/\$\{[^}]*\}/g, ' ')
      if (/(?:^|[\s"'`])drag-region(?:$|[\s"'`])/.test(normalizedClassValue)) {
        return true
      }
    }
  }

  return false
}
