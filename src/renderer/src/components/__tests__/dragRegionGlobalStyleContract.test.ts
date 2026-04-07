import fs from 'node:fs'
import path from 'node:path'

import { describe, it, expect } from 'vitest'

const GLOBAL_STYLE_PATH = path.resolve(process.cwd(), 'src/renderer/src/styles/index.css')

describe('drag region global style contract', () => {
  it('keeps .drag-region mapped to -webkit-app-region: drag in global styles', () => {
    const css = fs.readFileSync(GLOBAL_STYLE_PATH, 'utf8')
    const hasMapping = /\.drag-region\s*\{[\s\S]*?-webkit-app-region:\s*drag;[\s\S]*?\}/m.test(css)
    expect(hasMapping).toBe(true)
  })

  it('keeps .drag-region text selection disabled in global styles', () => {
    const css = fs.readFileSync(GLOBAL_STYLE_PATH, 'utf8')
    const hasUserSelectNone = /\.drag-region\s*\{[\s\S]*?user-select:\s*none;[\s\S]*?\}/m.test(css)
    expect(hasUserSelectNone).toBe(true)
  })

  it('keeps .no-drag mapped to -webkit-app-region: no-drag in global styles', () => {
    const css = fs.readFileSync(GLOBAL_STYLE_PATH, 'utf8')
    const hasMapping = /\.no-drag\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;[\s\S]*?\}/m.test(css)
    expect(hasMapping).toBe(true)
  })
})
