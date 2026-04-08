// Barrel re-exports for database module.
// All external consumers import from './database' which resolves to this file.

// Re-export shared types for backward compatibility
export type {
  AIAction,
  AIActionInput,
  AIActionMode,
  Note,
  NoteInput,
  NoteSearchFilter,
  Tag,
  TagWithSource,
  Notebook,
  InternalNotebookInput,
  InternalNotebookUpdateInput,
  NotebookStatus,
  NotebookFolder,
  LocalFolderMount,
  LocalFolderNotebookMount
} from '../../shared/types'

// Constants & helpers
export { TRASH_RETENTION_DAYS } from './helpers'

// Schema / lifecycle
export { initDatabase, closeDatabase } from './schema'

// Migrations (exported for testability)
export {
  migrateNotebooksSourceType,
  migrateNotesIsPinned,
  migrateNotesDeletedAt,
  migrateNotesFolderPath,
  migrateNotesDetachedFolderPath,
  migrateLegacyFrontmatterDocContent,
  collectLegacyFrontmatterContentUpdates
} from './migrations'

// Demo notes
export { createDemoNotes, createDemoNote } from './demo-notes'

// Notes CRUD, daily, trash, search, links, attachments
export {
  getNotes,
  getNotesByUpdated,
  getNotesByNotebookIds,
  getLiveNoteTitleEntries,
  getLiveNotesForDataviewProjection,
  getNoteById,
  getNotesByIds,
  addNote,
  addNotesBatch,
  updateNote,
  updateNoteSafe,
  deleteNote,
  getTrashNotes,
  restoreNote,
  permanentlyDeleteNote,
  emptyTrash,
  cleanupOldTrash,
  searchNotes,
  getDailyByDate,
  createDaily,
  addNoteLink,
  removeNoteLink,
  getBacklinks,
  getOutgoingLinks,
  updateNoteLinks,
  getUsedAttachmentPaths
} from './notes'

// Notebooks + notebook folders
export {
  getNotebooks,
  addNotebook,
  updateNotebook,
  deleteLocalFolderNotebook,
  deleteInternalNotebookWithNotes,
  reorderNotebooks,
  getNotebookFolders,
  hasNotebookFolderPathReference,
  createNotebookFolderEntry,
  renameNotebookFolderEntry,
  deleteNotebookFolderEntry
} from './notebooks'

// Local note identity
export type { LocalNoteIdentity } from './local-note-identity'
export {
  getLocalNoteIdentityUidsByNotebook,
  listLocalNoteIdentity,
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
  ensureLocalNoteIdentity,
  ensureLocalNoteIdentitiesBatch,
  renameLocalNoteIdentityPath,
  moveLocalNoteIdentity,
  renameLocalNoteIdentityFolderPath,
  deleteLocalNoteIdentityByPath
} from './local-note-identity'

// Local note metadata
export {
  listLocalNoteMetadata,
  getLocalNoteMetadata,
  updateLocalNoteMetadata,
  updateLocalNoteTagsBatch,
  renameLocalNoteMetadataPath,
  renameLocalNoteMetadataFolderPath,
  deleteLocalNoteMetadataByPath
} from './local-note-metadata'

// Local folder mounts
export {
  getLocalFolderMounts,
  getLocalFolderMountByCanonicalPath,
  getLocalFolderMountByNotebookId,
  createLocalFolderNotebookMount,
  createLocalFolderNotebookMountSafe,
  updateLocalFolderMountStatus,
  updateLocalFolderMountRoot
} from './local-folder-mounts'

// Note helpers
export { getNoteCountByNotebook, moveNote } from './note-helpers'
export type { MoveNoteResult } from './note-helpers'

// Tags
export {
  getTags,
  getTagsByNote,
  addTagToNote,
  removeTagFromNote,
  addAITagToNote,
  removeAITagsFromNote,
  updateAITags
} from './tags'

// Summary & links
export type { NoteSummaryInfo } from './summary-links'
export {
  getLocalNoteSummaryInfo,
  updateLocalNoteSummary,
  updateLocalAITags,
  getNoteSummaryInfo,
  updateNoteSummary
} from './summary-links'

// AI Actions
export {
  initDefaultAIActions,
  getAIActions,
  getAllAIActions,
  getAIAction,
  createAIAction,
  updateAIAction,
  deleteAIAction,
  reorderAIActions,
  resetAIActionsToDefaults
} from './ai-actions'

// AI Popups
export type { PopupData, PopupInput } from './ai-popups'
export {
  replaceAIPopupRefsForNote,
  replaceAIPopupRefsForNotesBatch,
  deleteAIPopupRefsForNote,
  rebuildAIPopupRefsForInternalNotes,
  getPopup,
  createPopup,
  updatePopupContent,
  deletePopup,
  cleanupPopups
} from './ai-popups'

// Agent tasks
export {
  getAgentTask,
  getAgentTaskByBlockId,
  createAgentTask,
  updateAgentTask,
  deleteAgentTask,
  deleteAgentTaskByBlockId
} from './agent-tasks'

// App settings
export { getAppSetting, setAppSetting, deleteAppSetting } from './app-settings'

// Templates
export {
  getAllTemplates,
  getTemplate,
  getDailyDefaultTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  reorderTemplates,
  setDailyDefaultTemplate,
  initDefaultTemplates,
  resetTemplatesToDefaults
} from './templates'
