export {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  deleteLegacyLocalIndexByPath,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNoteTagsMetadataBatch,
  syncLocalNotePopupRefs,
  syncLocalNotePopupRefsBatch,
} from './helpers'

export {
  cancelPendingLocalNotebookIndexSync,
  enqueueLocalNotebookIndexSync,
  flushQueuedLocalNotebookIndexSync,
  rebuildLocalNotebookIndexesAfterInternalRebuild,
  hasPendingIndexSync,
  hasPendingFullIndexSyncForNotebook,
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
