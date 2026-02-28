/**
 * Shared module state for SDK client, tools, and context providers.
 *
 * This module breaks the circular dependency between client.ts and tools.ts
 * by centralizing state and small utility functions that both need.
 */

import type { SanqianAppClient } from '@yushaw/sanqian-chat/main'
import { indexingService, updateNoteNotebookId } from '../embedding'
import { clearAllLocalCaches } from './helpers/caching'

// --- Module state ---

export let client: SanqianAppClient | null = null
export let assistantAgentId: string | null = null
export let writingAgentId: string | null = null
export let generatorAgentId: string | null = null
export let formatterAgentId: string | null = null
export let syncingPromise: Promise<void> | null = null
let onDataChangeCallback: (() => void) | null = null
export let currentTaskIdGetter: (() => string | null) | null = null

// --- State setters ---

export function setClient(value: SanqianAppClient | null): void {
  client = value
}

export function setAssistantAgentId(value: string | null): void {
  assistantAgentId = value
}

export function setWritingAgentId(value: string | null): void {
  writingAgentId = value
}

export function setGeneratorAgentId(value: string | null): void {
  generatorAgentId = value
}

export function setFormatterAgentId(value: string | null): void {
  formatterAgentId = value
}

export function setSyncingPromise(value: Promise<void> | null): void {
  syncingPromise = value
}

export function setCurrentTaskIdGetter(getter: () => string | null): void {
  currentTaskIdGetter = getter
}

export function setOnSdkDataChange(callback: () => void): void {
  onDataChangeCallback = callback
}

// --- Shared utilities used by both tools and client ---

export function notifyDataChange(): void {
  clearAllLocalCaches()
  if (onDataChangeCallback) {
    onDataChangeCallback()
  }
}

export function triggerIndexingForNote(noteId: string, notebookId: string | null | undefined, content: string): void {
  indexingService.checkAndIndex(noteId, notebookId || '', content).catch((error) => {
    console.warn('[SanqianSDK] Failed to check index for note:', noteId, error)
  })
}

export function deleteIndexForNote(noteId: string): void {
  try {
    indexingService.deleteNoteIndex(noteId)
  } catch (error) {
    console.warn('[SanqianSDK] Failed to delete note index:', noteId, error)
  }
}

export function syncIndexedNotebookForNote(noteId: string, notebookId: string | null | undefined): void {
  try {
    updateNoteNotebookId(noteId, notebookId || '')
  } catch (error) {
    console.warn('[SanqianSDK] Failed to sync indexed notebook id:', noteId, notebookId, error)
  }
}
