import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

const RENDERER_SOURCE_ROOT = path.resolve(process.cwd(), 'src/renderer/src')
const ALLOWED_APP_REGION_FILES = [
  'styles/index.css',
]

function collectFiles(rootDir: string): string[] {
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
      if (entry.isFile()) {
        files.push(absolutePath)
      }
    }
  }

  return files
}

describe('drag region css allowlist', () => {
  it('keeps -webkit-app-region usage constrained to the allowlist', () => {
    const files = collectFiles(RENDERER_SOURCE_ROOT)
    const offenders: string[] = []

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8')
      if (!content.includes('-webkit-app-region')) continue
      offenders.push(path.relative(RENDERER_SOURCE_ROOT, filePath))
    }

    expect(offenders.sort()).toEqual(ALLOWED_APP_REGION_FILES.slice().sort())
  })
})
