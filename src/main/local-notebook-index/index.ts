export {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  deleteLegacyLocalIndexByPath,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNotePopupRefs,
} from './helpers'

export {
  cancelPendingLocalNotebookIndexSync,
  enqueueLocalNotebookIndexSync,
  flushQueuedLocalNotebookIndexSync,
  rebuildLocalNotebookIndexesAfterInternalRebuild,
  hasPendingIndexSync,
  clearLocalNotebookIndexSyncForNotebook,
  resetLocalNotebookIndexSyncState,
} from './sync'

export {
  isKnowledgeBaseRebuilding,
  triggerFullKnowledgeBaseRebuild,
} from './knowledge-base-rebuild'

export {
  scheduleAIPopupCleanup,
  clearAIPopupCleanupTimers,
} from './popup-cleanup'
