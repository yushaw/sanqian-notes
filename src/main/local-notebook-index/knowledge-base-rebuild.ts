import { getNotes } from '../database'
import { getEmbeddingConfig, indexingService } from '../embedding'
import {
  cancelPendingLocalNotebookIndexSync,
  rebuildLocalNotebookIndexesAfterInternalRebuild,
  flushQueuedLocalNotebookIndexSync,
} from './sync'

let knowledgeBaseRebuildPromise: Promise<void> | null = null
let knowledgeBaseRebuildRunning = false

export function isKnowledgeBaseRebuilding(): boolean {
  return knowledgeBaseRebuildRunning
}

export function triggerFullKnowledgeBaseRebuild(reason: string): { scheduled: boolean; total: number } {
  const notes = getNotes()
  const total = notes.length
  const embeddingEnabled = getEmbeddingConfig().enabled

  if (knowledgeBaseRebuildPromise) {
    console.log(`[Main] Full knowledge base rebuild already running, skip duplicate trigger (${reason})`)
    return { scheduled: false, total }
  }

  knowledgeBaseRebuildPromise = (async () => {
    knowledgeBaseRebuildRunning = true
    try {
      console.log(`[Main] Starting full knowledge base rebuild (${reason})`)
      cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
      await indexingService.rebuildAllNotes(notes)
      if (embeddingEnabled) {
        await rebuildLocalNotebookIndexesAfterInternalRebuild()
      }
      console.log(`[Main] Full knowledge base rebuild complete (${reason})`)
    } catch (error) {
      console.error(`[Main] Full knowledge base rebuild failed (${reason}):`, error)
    } finally {
      knowledgeBaseRebuildRunning = false
      knowledgeBaseRebuildPromise = null
      flushQueuedLocalNotebookIndexSync()
    }
  })()

  return { scheduled: true, total }
}
