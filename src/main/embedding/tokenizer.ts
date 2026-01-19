/**
 * Tokenizer utilities for keyword search (Chinese + English).
 *
 * Primary: jieba-wasm (cut_for_search)
 * Fallback: simple ASCII tokens + CJK bigrams
 */

import fs from 'fs'
import path from 'path'
import { cut_for_search, with_dict } from 'jieba-wasm'
import { normalizeCjkAscii } from './utils'

const MAX_FTS_TOKENS = 256
const MIN_ASCII_LEN = 2
const MIN_CJK_LEN = 2

let jiebaReady = false
let jiebaInitError: string | null = null

function getDefaultDictPath(): string | null {
  try {
    // Lazy require to avoid issues in non-Electron contexts (scripts/tests).
    const { app } = require('electron')
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'jieba.dict.txt')
    }
  } catch {
    // Ignore; fallback to env-only usage.
  }
  return null
}

function initJieba(): void {
  if (jiebaReady || jiebaInitError) return

  try {
    const dictPath = process.env.JIEBA_DICT_PATH || getDefaultDictPath()
    if (dictPath && fs.existsSync(dictPath)) {
      try {
        const dictText = fs.readFileSync(dictPath, 'utf-8')
        with_dict(dictText)
        console.log(`[Tokenizer] Loaded custom dictionary: ${dictPath}`)
      } catch (error) {
        console.warn('[Tokenizer] user dict load failed, continue without it:', error)
      }
    }
    jiebaReady = true
  } catch (error) {
    jiebaInitError = error instanceof Error ? error.message : String(error)
    console.warn('[Tokenizer] jieba-wasm init failed, fallback to n-gram:', jiebaInitError)
  }
}

function fallbackTokenize(text: string): string[] {
  const tokens: string[] = []
  const asciiTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= MIN_ASCII_LEN)
  tokens.push(...asciiTokens)

  const cjkMatches = text.match(/[\u4e00-\u9fff]+/g) || []
  for (const seq of cjkMatches) {
    if (seq.length <= MIN_CJK_LEN) {
      tokens.push(seq)
      continue
    }
    for (let i = 0; i < seq.length - 1; i++) {
      tokens.push(seq.slice(i, i + 2))
    }
  }

  return tokens
}

function normalizeTokens(tokens: string[], sourceText: string): string[] {
  const cleaned = tokens
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => (/[a-z0-9]/i.test(token) ? token.toLowerCase() : token))

  const filtered = cleaned.filter((token) => {
    if (/^[a-z0-9]+$/i.test(token)) return token.length >= MIN_ASCII_LEN
    return token.length >= MIN_CJK_LEN
  })

  if (filtered.length > 0) {
    return filtered
  }

  const fallback = sourceText.replace(/\s+/g, '')
  return fallback ? [fallback] : []
}

export function tokenizeForSearch(text: string): string[] {
  if (!text || !text.trim()) return []
  const normalized = normalizeCjkAscii(text)

  initJieba()

  let tokens: string[] = []
  if (jiebaReady) {
    try {
      tokens = cut_for_search(normalized, true)
    } catch (error) {
      console.warn('[Tokenizer] jieba-wasm cut failed, fallback to n-gram:', error)
      tokens = []
    }
  }

  if (tokens.length === 0) {
    tokens = fallbackTokenize(normalized)
  }

  return normalizeTokens(tokens, normalized)
}

export function buildSearchTokens(text: string, maxTokens: number = MAX_FTS_TOKENS): string {
  const tokens = tokenizeForSearch(text)
  if (tokens.length === 0) return ''
  return tokens.slice(0, maxTokens).join(' ')
}

export function warmupTokenizer(): void {
  initJieba()
  if (jiebaReady) {
    try {
      cut_for_search('warmup', true)
    } catch (error) {
      console.warn('[Tokenizer] warmup cut failed:', error)
    }
  }
}
