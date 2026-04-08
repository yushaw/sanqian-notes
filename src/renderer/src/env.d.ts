/// <reference types="vite/client" />
import type {} from '../../preload/index'

// Ambient type aliases for renderer code that uses these without explicit imports.
// The canonical definitions live in shared/types.ts; these aliases make them
// available as globals so existing renderer files don't need to add imports.
declare global {
  type AIAction = import('../../shared/types').AIAction
  type AIActionInput = import('../../shared/types').AIActionInput
  type AIActionAPI = import('../../shared/types').AIActionAPI
  type ThemeSettings = import('../../shared/types').ThemeSettings
  type Template = import('../../shared/types').Template
  type TemplateInput = import('../../shared/types').TemplateInput
  type AgentCapability = import('../../shared/types').AgentCapability
  type AgentTaskEvent = import('../../shared/types').AgentTaskEvent
  type Note = import('../../shared/types').Note
  type NoteInput = import('../../shared/types').NoteInput
  type Notebook = import('../../shared/types').Notebook
  type InternalNotebookInput = import('../../shared/types').InternalNotebookInput
  type InternalNotebookUpdateInput = import('../../shared/types').InternalNotebookUpdateInput
  type Tag = import('../../shared/types').Tag
  type TagWithSource = import('../../shared/types').TagWithSource
}

export {}
