/**
 * Encryption service for API keys
 *
 * Uses AES-256-CBC encryption with key stored in ~/.sanqian/encryption.key
 * Compatible with sanqian's encryption scheme (same key file location)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import crypto from 'crypto'

// Key file location: ~/.sanqian/encryption.key
const KEY_DIR = join(homedir(), '.sanqian')
const KEY_FILE = join(KEY_DIR, 'encryption.key')

// Prefix to distinguish encrypted values from plaintext
const ENCRYPTED_PREFIX = 'enc:'

let cachedKey: Buffer | null = null

/**
 * Get or create encryption key
 * Reuses sanqian's key file if it exists
 */
function getOrCreateKey(): Buffer {
  if (cachedKey) {
    return cachedKey
  }

  try {
    if (existsSync(KEY_FILE)) {
      // Load existing key (base64 encoded)
      const keyStr = readFileSync(KEY_FILE, 'utf-8').trim()
      cachedKey = Buffer.from(keyStr, 'base64')
      return cachedKey
    }

    // First run: generate new key
    if (!existsSync(KEY_DIR)) {
      mkdirSync(KEY_DIR, { mode: 0o700, recursive: true })
    }

    // Generate 32-byte key for AES-256
    const newKey = crypto.randomBytes(32)
    const keyStr = newKey.toString('base64')

    // Write with restricted permissions (owner read/write only)
    writeFileSync(KEY_FILE, keyStr, { mode: 0o600 })

    cachedKey = newKey
    return cachedKey
  } catch (error) {
    console.error('[Encryption] Failed to get/create key:', error)
    throw error
  }
}

/**
 * Encrypt a plaintext string
 * @param plaintext - The string to encrypt
 * @returns Encrypted string with prefix, or empty string if input is empty
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return ''
  }

  try {
    const key = getOrCreateKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

    // Format: enc:IV_base64:ciphertext_base64
    return ENCRYPTED_PREFIX + iv.toString('base64') + ':' + encrypted.toString('base64')
  } catch (error) {
    console.error('[Encryption] Failed to encrypt:', error)
    throw error
  }
}

/**
 * Decrypt an encrypted string
 * @param ciphertext - The encrypted string to decrypt
 * @returns Decrypted string, or original string if not encrypted or decryption fails
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return ''
  }

  // Return as-is if not encrypted
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    return ciphertext
  }

  try {
    const key = getOrCreateKey()
    const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split(':')

    if (parts.length !== 2) {
      console.warn('[Encryption] Invalid encrypted format, returning as-is')
      return ciphertext
    }

    const iv = Buffer.from(parts[0], 'base64')
    const encrypted = Buffer.from(parts[1], 'base64')

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

    return decrypted.toString('utf8')
  } catch (error) {
    console.error('[Encryption] Failed to decrypt:', error)
    // Return empty string if decryption fails (don't leak encrypted value to API)
    return ''
  }
}

/**
 * Check if a string is encrypted
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false
}
