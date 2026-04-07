import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

const FORBIDDEN_PATTERNS = ['WebkitAppRegion', '-webkit-app-region']
const RENDERER_SOURCE_ROOT = path.resolve(process.cwd(), 'src/renderer/src')

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

describe('drag region static guard', () => {
  it('does not allow WebkitAppRegion or -webkit-app-region in renderer TSX files', () => {
    const offenders: string[] = []
    const tsxFiles = collectRendererTsxFiles(RENDERER_SOURCE_ROOT)

    for (const filePath of tsxFiles) {
      const content = fs.readFileSync(filePath, 'utf8')
      const hasForbiddenPattern = FORBIDDEN_PATTERNS.some((pattern) => content.includes(pattern))
      if (hasForbiddenPattern) {
        offenders.push(path.relative(RENDERER_SOURCE_ROOT, filePath))
      }
    }

    expect(offenders).toEqual([])
  })
})
