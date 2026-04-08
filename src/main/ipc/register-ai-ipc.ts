import type { IpcMain } from 'electron'
import type {
  AIActionInput,
  AgentExecutionContext,
  AgentTaskInput,
  AgentTaskRecord,
  PopupInput,
  TemplateInput,
} from '../../shared/types'
import type { AgentTaskOptions } from '../agent-task-service'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

const OPAQUE_ID_MAX_LENGTH = 512
const AI_REORDER_MAX_ITEMS = 2000
const AGENT_RUN_MAX_CONTENT_LENGTH = 1_000_000
const AGENT_RUN_MAX_ADDITIONAL_PROMPT_LENGTH = 200_000
const CLEANUP_MAX_AGE_DAYS_LIMIT = 36500
const AI_ACTION_NAME_MAX_LENGTH = 200
const AI_ACTION_ICON_MAX_LENGTH = 64
const AI_ACTION_DESCRIPTION_MAX_LENGTH = 2000
const AI_ACTION_PROMPT_MAX_LENGTH = 200_000
const AI_ACTION_SHORTCUT_KEY_MAX_LENGTH = 64
const POPUP_TEXT_MAX_LENGTH = 200_000
const POPUP_ACTION_NAME_MAX_LENGTH = 200
const POPUP_DOCUMENT_TITLE_MAX_LENGTH = 512
const AGENT_TASK_CONTENT_MAX_LENGTH = AGENT_RUN_MAX_CONTENT_LENGTH
const AGENT_TASK_ADDITIONAL_PROMPT_MAX_LENGTH = AGENT_RUN_MAX_ADDITIONAL_PROMPT_LENGTH
const AGENT_TASK_AGENT_NAME_MAX_LENGTH = 200
const AGENT_TASK_SCHEDULE_CONFIG_MAX_LENGTH = 200_000
const AGENT_TASK_TIMESTAMP_MAX_LENGTH = 64
const TEMPLATE_NAME_MAX_LENGTH = 200
const TEMPLATE_ICON_MAX_LENGTH = 64
const TEMPLATE_DESCRIPTION_MAX_LENGTH = 2000
const TEMPLATE_CONTENT_MAX_LENGTH = 1_000_000
const EXECUTION_CONTEXT_SOURCE_APP_MAX_LENGTH = 128
const EXECUTION_CONTEXT_TITLE_MAX_LENGTH = 1024
const EXECUTION_CONTEXT_NOTEBOOK_NAME_MAX_LENGTH = 512
const EXECUTION_CONTEXT_LOCAL_RESOURCE_ID_MAX_LENGTH = 4096
const EXECUTION_CONTEXT_LOCAL_RELATIVE_PATH_MAX_LENGTH = 4096
const MARKDOWN_TO_TIPTAP_MAX_LENGTH = 1_000_000

interface AgentRunOutputContextInput {
  targetBlockId: string
  pageId: string
  notebookId: string | null
  processMode: 'append' | 'replace'
  outputFormat?: 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'
  executionContext?: AgentExecutionContext | null
}

interface AgentRunParams {
  taskId: string
  agentId: string
  agentName: string
  content: string
  additionalPrompt?: string
  outputContext?: AgentRunOutputContextInput
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBoundedString(value: string, maxLength: number): boolean {
  return !value.includes('\0') && value.length <= maxLength
}

function parseRequiredOpaqueIdInput(idInput: unknown): string | null {
  if (typeof idInput !== 'string') return null
  if (!idInput.trim()) return null
  if (idInput.includes('\0')) return null
  if (idInput.length > OPAQUE_ID_MAX_LENGTH) return null
  return idInput
}

function parseStringArrayInput(
  input: unknown,
  options?: { maxItems?: number }
): string[] | null {
  if (!Array.isArray(input)) return null
  if (typeof options?.maxItems === 'number' && input.length > options.maxItems) return null
  const values: string[] = []
  for (const item of input) {
    const value = parseRequiredOpaqueIdInput(item)
    if (!value) return null
    values.push(value)
  }
  return values
}

function parseUniqueStringArrayInput(input: unknown): string[] | null {
  const values = parseStringArrayInput(input, { maxItems: AI_REORDER_MAX_ITEMS })
  if (!values) return null
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return null
    seen.add(value)
  }
  return values
}

function parseRecordInput(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  return input
}

function parseOptionalStringInput(
  input: unknown,
  options?: { maxLength?: number }
): string | undefined {
  if (typeof input !== 'string') return undefined
  if (input.includes('\0')) return undefined
  if (typeof options?.maxLength === 'number' && input.length > options.maxLength) return undefined
  return input
}

function parseOptionalOpaqueIdInput(input: unknown): string | undefined | null {
  if (input === undefined) return undefined
  return parseRequiredOpaqueIdInput(input)
}

function parseOptionalNullableStringInput(
  input: unknown,
  options?: { maxLength?: number }
): string | null | undefined {
  if (input === null) return null
  return parseOptionalStringInput(input, options)
}

function parseOptionalNullableOpaqueIdInput(input: unknown): string | null | undefined {
  if (input === null) return null
  return parseOptionalOpaqueIdInput(input)
}

function parseAIActionModeInput(input: unknown): AIActionInput['mode'] | undefined {
  return input === 'replace' || input === 'insert' || input === 'popup'
    ? input
    : undefined
}

function parseAgentModeInput(input: unknown): AgentTaskInput['agentMode'] | undefined {
  return input === 'auto' || input === 'specified' ? input : undefined
}

function parseProcessModeInput(input: unknown): AgentTaskInput['processMode'] | undefined {
  return input === 'append' || input === 'replace' ? input : undefined
}

function parseOutputFormatInput(input: unknown): AgentTaskInput['outputFormat'] | undefined {
  return input === 'auto'
    || input === 'paragraph'
    || input === 'list'
    || input === 'table'
    || input === 'code'
    || input === 'quote'
    ? input
    : undefined
}

function parseRunTimingInput(input: unknown): AgentTaskInput['runTiming'] | undefined {
  return input === 'manual' || input === 'immediate' || input === 'scheduled'
    ? input
    : undefined
}

function parseNotebookSourceTypeInput(input: unknown): AgentExecutionContext['sourceType'] | undefined {
  return input === 'internal' || input === 'local-folder' ? input : undefined
}

function parseAIActionInput(input: unknown): AIActionInput | null {
  const data = parseRecordInput(input)
  if (!data) return null
  if (
    typeof data.name !== 'string'
    || !isBoundedString(data.name, AI_ACTION_NAME_MAX_LENGTH)
    || typeof data.icon !== 'string'
    || !isBoundedString(data.icon, AI_ACTION_ICON_MAX_LENGTH)
    || typeof data.prompt !== 'string'
    || !isBoundedString(data.prompt, AI_ACTION_PROMPT_MAX_LENGTH)
  ) {
    return null
  }
  const mode = parseAIActionModeInput(data.mode)
  if (!mode) return null
  if (
    data.description !== undefined
    && (
      typeof data.description !== 'string'
      || !isBoundedString(data.description, AI_ACTION_DESCRIPTION_MAX_LENGTH)
    )
  ) return null
  if (data.showInContextMenu !== undefined && typeof data.showInContextMenu !== 'boolean') return null
  if (data.showInSlashCommand !== undefined && typeof data.showInSlashCommand !== 'boolean') return null
  if (data.showInShortcut !== undefined && typeof data.showInShortcut !== 'boolean') return null
  if (
    data.shortcutKey !== undefined
    && (
      typeof data.shortcutKey !== 'string'
      || !isBoundedString(data.shortcutKey, AI_ACTION_SHORTCUT_KEY_MAX_LENGTH)
    )
  ) return null
  return {
    name: data.name,
    icon: data.icon,
    prompt: data.prompt,
    mode,
    description: parseOptionalStringInput(data.description, { maxLength: AI_ACTION_DESCRIPTION_MAX_LENGTH }),
    showInContextMenu: typeof data.showInContextMenu === 'boolean' ? data.showInContextMenu : undefined,
    showInSlashCommand: typeof data.showInSlashCommand === 'boolean' ? data.showInSlashCommand : undefined,
    showInShortcut: typeof data.showInShortcut === 'boolean' ? data.showInShortcut : undefined,
    shortcutKey: parseOptionalStringInput(data.shortcutKey, { maxLength: AI_ACTION_SHORTCUT_KEY_MAX_LENGTH }),
  }
}

function parseAIActionUpdateInput(input: unknown): (Partial<AIActionInput> & { enabled?: boolean }) | null {
  const data = parseRecordInput(input)
  if (!data) return null
  const mode = data.mode === undefined ? undefined : parseAIActionModeInput(data.mode)
  if (data.mode !== undefined && !mode) return null
  if (
    data.name !== undefined
    && (
      typeof data.name !== 'string'
      || !isBoundedString(data.name, AI_ACTION_NAME_MAX_LENGTH)
    )
  ) return null
  if (
    data.description !== undefined
    && (
      typeof data.description !== 'string'
      || !isBoundedString(data.description, AI_ACTION_DESCRIPTION_MAX_LENGTH)
    )
  ) return null
  if (
    data.icon !== undefined
    && (
      typeof data.icon !== 'string'
      || !isBoundedString(data.icon, AI_ACTION_ICON_MAX_LENGTH)
    )
  ) return null
  if (
    data.prompt !== undefined
    && (
      typeof data.prompt !== 'string'
      || !isBoundedString(data.prompt, AI_ACTION_PROMPT_MAX_LENGTH)
    )
  ) return null
  if (data.showInContextMenu !== undefined && typeof data.showInContextMenu !== 'boolean') return null
  if (data.showInSlashCommand !== undefined && typeof data.showInSlashCommand !== 'boolean') return null
  if (data.showInShortcut !== undefined && typeof data.showInShortcut !== 'boolean') return null
  if (
    data.shortcutKey !== undefined
    && (
      typeof data.shortcutKey !== 'string'
      || !isBoundedString(data.shortcutKey, AI_ACTION_SHORTCUT_KEY_MAX_LENGTH)
    )
  ) return null
  if (data.enabled !== undefined && typeof data.enabled !== 'boolean') return null
  return {
    name: parseOptionalStringInput(data.name, { maxLength: AI_ACTION_NAME_MAX_LENGTH }),
    description: parseOptionalStringInput(data.description, { maxLength: AI_ACTION_DESCRIPTION_MAX_LENGTH }),
    icon: parseOptionalStringInput(data.icon, { maxLength: AI_ACTION_ICON_MAX_LENGTH }),
    prompt: parseOptionalStringInput(data.prompt, { maxLength: AI_ACTION_PROMPT_MAX_LENGTH }),
    mode,
    showInContextMenu: typeof data.showInContextMenu === 'boolean' ? data.showInContextMenu : undefined,
    showInSlashCommand: typeof data.showInSlashCommand === 'boolean' ? data.showInSlashCommand : undefined,
    showInShortcut: typeof data.showInShortcut === 'boolean' ? data.showInShortcut : undefined,
    shortcutKey: parseOptionalStringInput(data.shortcutKey, { maxLength: AI_ACTION_SHORTCUT_KEY_MAX_LENGTH }),
    enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
  }
}

function parsePopupInput(input: unknown): PopupInput | null {
  const data = parseRecordInput(input)
  if (!data) return null
  const id = parseRequiredOpaqueIdInput(data.id)
  if (
    !id
    || typeof data.prompt !== 'string'
    || !isBoundedString(data.prompt, POPUP_TEXT_MAX_LENGTH)
    || typeof data.targetText !== 'string'
    || !isBoundedString(data.targetText, POPUP_TEXT_MAX_LENGTH)
  ) return null
  if (
    data.actionName !== undefined
    && (
      typeof data.actionName !== 'string'
      || !isBoundedString(data.actionName, POPUP_ACTION_NAME_MAX_LENGTH)
    )
  ) return null
  if (
    data.documentTitle !== undefined
    && (
      typeof data.documentTitle !== 'string'
      || !isBoundedString(data.documentTitle, POPUP_DOCUMENT_TITLE_MAX_LENGTH)
    )
  ) return null
  return {
    id,
    prompt: data.prompt,
    targetText: data.targetText,
    actionName: parseOptionalStringInput(data.actionName, { maxLength: POPUP_ACTION_NAME_MAX_LENGTH }),
    documentTitle: parseOptionalStringInput(data.documentTitle, { maxLength: POPUP_DOCUMENT_TITLE_MAX_LENGTH }),
  }
}

function parseAgentTaskInput(input: unknown): AgentTaskInput | null {
  const data = parseRecordInput(input)
  if (!data) return null
  const blockId = parseRequiredOpaqueIdInput(data.blockId)
  const pageId = parseRequiredOpaqueIdInput(data.pageId)
  const content = parseOptionalStringInput(data.content, { maxLength: AGENT_TASK_CONTENT_MAX_LENGTH })
  if (!blockId || !pageId || content === undefined) return null
  const agentMode = data.agentMode === undefined ? undefined : parseAgentModeInput(data.agentMode)
  if (data.agentMode !== undefined && !agentMode) return null
  const processMode = data.processMode === undefined ? undefined : parseProcessModeInput(data.processMode)
  if (data.processMode !== undefined && !processMode) return null
  const outputFormat = data.outputFormat === undefined ? undefined : parseOutputFormatInput(data.outputFormat)
  if (data.outputFormat !== undefined && !outputFormat) return null
  const runTiming = data.runTiming === undefined ? undefined : parseRunTimingInput(data.runTiming)
  if (data.runTiming !== undefined && !runTiming) return null

  const notebookId = parseOptionalNullableOpaqueIdInput(data.notebookId)
  if (data.notebookId !== undefined && notebookId === undefined) return null
  if (data.notebookId !== undefined && data.notebookId !== null && notebookId === null) return null
  const additionalPrompt = parseOptionalStringInput(data.additionalPrompt, {
    maxLength: AGENT_TASK_ADDITIONAL_PROMPT_MAX_LENGTH,
  })
  if (data.additionalPrompt !== undefined && additionalPrompt === undefined) return null
  const agentId = parseOptionalOpaqueIdInput(data.agentId)
  if (data.agentId !== undefined && agentId === null) return null
  const agentName = parseOptionalStringInput(data.agentName, { maxLength: AGENT_TASK_AGENT_NAME_MAX_LENGTH })
  if (data.agentName !== undefined && agentName === undefined) return null
  const scheduleConfig = parseOptionalStringInput(data.scheduleConfig, {
    maxLength: AGENT_TASK_SCHEDULE_CONFIG_MAX_LENGTH,
  })
  if (data.scheduleConfig !== undefined && scheduleConfig === undefined) return null

  return {
    blockId,
    pageId,
    content,
    notebookId,
    additionalPrompt,
    agentMode,
    agentId: agentId ?? undefined,
    agentName,
    processMode,
    outputFormat,
    runTiming,
    scheduleConfig,
  }
}

function parseTemplateInput(input: unknown): TemplateInput | null {
  const data = parseRecordInput(input)
  if (!data) return null
  if (
    typeof data.name !== 'string'
    || !isBoundedString(data.name, TEMPLATE_NAME_MAX_LENGTH)
    || typeof data.content !== 'string'
    || !isBoundedString(data.content, TEMPLATE_CONTENT_MAX_LENGTH)
  ) return null
  if (
    data.description !== undefined
    && (
      typeof data.description !== 'string'
      || !isBoundedString(data.description, TEMPLATE_DESCRIPTION_MAX_LENGTH)
    )
  ) return null
  if (
    data.icon !== undefined
    && (
      typeof data.icon !== 'string'
      || !isBoundedString(data.icon, TEMPLATE_ICON_MAX_LENGTH)
    )
  ) return null
  if (data.isDailyDefault !== undefined && typeof data.isDailyDefault !== 'boolean') return null
  return {
    name: data.name,
    content: data.content,
    description: parseOptionalStringInput(data.description, { maxLength: TEMPLATE_DESCRIPTION_MAX_LENGTH }),
    icon: parseOptionalStringInput(data.icon, { maxLength: TEMPLATE_ICON_MAX_LENGTH }),
    isDailyDefault: typeof data.isDailyDefault === 'boolean' ? data.isDailyDefault : undefined,
  }
}

function parseTemplateUpdateInput(input: unknown): Partial<TemplateInput> | null {
  const data = parseRecordInput(input)
  if (!data) return null
  if (
    data.name !== undefined
    && (
      typeof data.name !== 'string'
      || !isBoundedString(data.name, TEMPLATE_NAME_MAX_LENGTH)
    )
  ) return null
  if (
    data.description !== undefined
    && (
      typeof data.description !== 'string'
      || !isBoundedString(data.description, TEMPLATE_DESCRIPTION_MAX_LENGTH)
    )
  ) return null
  if (
    data.content !== undefined
    && (
      typeof data.content !== 'string'
      || !isBoundedString(data.content, TEMPLATE_CONTENT_MAX_LENGTH)
    )
  ) return null
  if (
    data.icon !== undefined
    && (
      typeof data.icon !== 'string'
      || !isBoundedString(data.icon, TEMPLATE_ICON_MAX_LENGTH)
    )
  ) return null
  if (data.isDailyDefault !== undefined && typeof data.isDailyDefault !== 'boolean') return null
  return {
    name: parseOptionalStringInput(data.name, { maxLength: TEMPLATE_NAME_MAX_LENGTH }),
    description: parseOptionalStringInput(data.description, { maxLength: TEMPLATE_DESCRIPTION_MAX_LENGTH }),
    content: parseOptionalStringInput(data.content, { maxLength: TEMPLATE_CONTENT_MAX_LENGTH }),
    icon: parseOptionalStringInput(data.icon, { maxLength: TEMPLATE_ICON_MAX_LENGTH }),
    isDailyDefault: typeof data.isDailyDefault === 'boolean' ? data.isDailyDefault : undefined,
  }
}

function parseCleanupMaxAgeDaysInput(input: unknown): number | undefined | null {
  if (input === undefined) return undefined
  if (typeof input !== 'number') return null
  if (!Number.isInteger(input)) return null
  if (input < 0 || input > CLEANUP_MAX_AGE_DAYS_LIMIT) {
    return null
  }
  return input
}

function parseAgentTaskUpdateInput(input: unknown): Partial<AgentTaskRecord> | null {
  const data = parseRecordInput(input)
  if (!data) return null

  const updates: Partial<AgentTaskRecord> = {}

  if (data.blockId !== undefined) {
    const blockId = parseRequiredOpaqueIdInput(data.blockId)
    if (!blockId) return null
    updates.blockId = blockId
  }
  if (data.pageId !== undefined) {
    const pageId = parseRequiredOpaqueIdInput(data.pageId)
    if (!pageId) return null
    updates.pageId = pageId
  }

  if (data.notebookId !== undefined) {
    const notebookId = parseOptionalNullableOpaqueIdInput(data.notebookId)
    if (notebookId === undefined && data.notebookId !== undefined) return null
    if (data.notebookId !== null && notebookId === null) return null
    updates.notebookId = notebookId
  }
  if (data.additionalPrompt !== undefined) {
    const additionalPrompt = parseOptionalNullableStringInput(data.additionalPrompt, {
      maxLength: AGENT_TASK_ADDITIONAL_PROMPT_MAX_LENGTH,
    })
    if (additionalPrompt === undefined && data.additionalPrompt !== undefined) return null
    updates.additionalPrompt = additionalPrompt
  }

  if (data.agentMode !== undefined) {
    const agentMode = parseAgentModeInput(data.agentMode)
    if (!agentMode) return null
    updates.agentMode = agentMode
  }
  if (data.agentId !== undefined) {
    const agentId = parseOptionalNullableOpaqueIdInput(data.agentId)
    if (agentId === undefined && data.agentId !== undefined) return null
    if (data.agentId !== null && agentId === null) return null
    updates.agentId = agentId
  }
  if (data.agentName !== undefined) {
    const agentName = parseOptionalNullableStringInput(data.agentName, { maxLength: AGENT_TASK_AGENT_NAME_MAX_LENGTH })
    if (agentName === undefined && data.agentName !== undefined) return null
    updates.agentName = agentName
  }

  if (data.startedAt !== undefined) {
    const startedAt = parseOptionalNullableStringInput(data.startedAt, { maxLength: AGENT_TASK_TIMESTAMP_MAX_LENGTH })
    if (startedAt === undefined && data.startedAt !== undefined) return null
    updates.startedAt = startedAt
  }
  if (data.completedAt !== undefined) {
    const completedAt = parseOptionalNullableStringInput(data.completedAt, { maxLength: AGENT_TASK_TIMESTAMP_MAX_LENGTH })
    if (completedAt === undefined && data.completedAt !== undefined) return null
    updates.completedAt = completedAt
  }
  if (data.durationMs !== undefined) {
    if (data.durationMs !== null && (typeof data.durationMs !== 'number' || !Number.isFinite(data.durationMs) || data.durationMs < 0)) {
      return null
    }
    updates.durationMs = data.durationMs
  }

  if (data.outputBlockId !== undefined) {
    const outputBlockId = parseOptionalNullableOpaqueIdInput(data.outputBlockId)
    if (outputBlockId === undefined && data.outputBlockId !== undefined) return null
    if (data.outputBlockId !== null && outputBlockId === null) return null
    updates.outputBlockId = outputBlockId
  }
  if (data.processMode !== undefined) {
    const processMode = parseProcessModeInput(data.processMode)
    if (!processMode) return null
    updates.processMode = processMode
  }
  if (data.outputFormat !== undefined) {
    const outputFormat = parseOutputFormatInput(data.outputFormat)
    if (!outputFormat) return null
    updates.outputFormat = outputFormat
  }
  if (data.runTiming !== undefined) {
    const runTiming = parseRunTimingInput(data.runTiming)
    if (!runTiming) return null
    updates.runTiming = runTiming
  }
  if (data.scheduleConfig !== undefined) {
    const scheduleConfig = parseOptionalNullableStringInput(data.scheduleConfig, {
      maxLength: AGENT_TASK_SCHEDULE_CONFIG_MAX_LENGTH,
    })
    if (scheduleConfig === undefined && data.scheduleConfig !== undefined) return null
    updates.scheduleConfig = scheduleConfig
  }

  return updates
}

function parseExecutionContextInput(input: unknown): AgentExecutionContext | null | undefined {
  if (input === undefined) return undefined
  if (input === null) return null
  const data = parseRecordInput(input)
  if (!data) return undefined

  const sourceApp = parseOptionalStringInput(data.sourceApp, { maxLength: EXECUTION_CONTEXT_SOURCE_APP_MAX_LENGTH })
  if (data.sourceApp !== undefined && sourceApp === undefined) return undefined
  const noteId = parseOptionalNullableOpaqueIdInput(data.noteId)
  if (noteId === undefined && data.noteId !== undefined) return undefined
  if (data.noteId !== undefined && data.noteId !== null && noteId === null) return undefined
  const noteTitle = parseOptionalNullableStringInput(data.noteTitle, { maxLength: EXECUTION_CONTEXT_TITLE_MAX_LENGTH })
  if (noteTitle === undefined && data.noteTitle !== undefined) return undefined
  const notebookId = parseOptionalNullableOpaqueIdInput(data.notebookId)
  if (notebookId === undefined && data.notebookId !== undefined) return undefined
  if (data.notebookId !== undefined && data.notebookId !== null && notebookId === null) return undefined
  const notebookName = parseOptionalNullableStringInput(data.notebookName, {
    maxLength: EXECUTION_CONTEXT_NOTEBOOK_NAME_MAX_LENGTH,
  })
  if (notebookName === undefined && data.notebookName !== undefined) return undefined
  const localResourceId = parseOptionalNullableStringInput(data.localResourceId, {
    maxLength: EXECUTION_CONTEXT_LOCAL_RESOURCE_ID_MAX_LENGTH,
  })
  if (localResourceId === undefined && data.localResourceId !== undefined) return undefined
  const localRelativePath = parseOptionalNullableStringInput(data.localRelativePath, {
    maxLength: EXECUTION_CONTEXT_LOCAL_RELATIVE_PATH_MAX_LENGTH,
  })
  if (localRelativePath === undefined && data.localRelativePath !== undefined) return undefined
  const heading = parseOptionalNullableStringInput(data.heading, { maxLength: EXECUTION_CONTEXT_TITLE_MAX_LENGTH })
  if (heading === undefined && data.heading !== undefined) return undefined

  const sourceType = data.sourceType === undefined ? undefined : parseNotebookSourceTypeInput(data.sourceType)
  if (data.sourceType !== undefined && !sourceType) return undefined

  return {
    sourceApp,
    noteId,
    noteTitle,
    notebookId,
    notebookName,
    sourceType,
    localResourceId,
    localRelativePath,
    heading,
  }
}

function parseAgentRunOutputContextInput(input: unknown): AgentRunOutputContextInput | undefined | null {
  if (input === undefined) return undefined
  const data = parseRecordInput(input)
  if (!data) return null
  const targetBlockId = parseRequiredOpaqueIdInput(data.targetBlockId)
  const pageId = parseRequiredOpaqueIdInput(data.pageId)
  if (!targetBlockId || !pageId) return null
  const notebookId = parseOptionalNullableOpaqueIdInput(data.notebookId)
  if (notebookId === undefined && data.notebookId !== undefined) return null
  if (data.notebookId !== undefined && data.notebookId !== null && notebookId === null) return null
  const processMode = parseProcessModeInput(data.processMode)
  if (!processMode) return null
  const outputFormat = data.outputFormat === undefined ? undefined : parseOutputFormatInput(data.outputFormat)
  if (data.outputFormat !== undefined && !outputFormat) return null
  const executionContext = parseExecutionContextInput(data.executionContext)
  if (executionContext === undefined && data.executionContext !== undefined) return null
  return {
    targetBlockId,
    pageId,
    notebookId: notebookId ?? null,
    processMode,
    outputFormat,
    executionContext,
  }
}

function parseAgentRunParams(input: {
  taskIdInput: unknown
  agentIdInput: unknown
  agentNameInput: unknown
  contentInput: unknown
  additionalPromptInput: unknown
  outputContextInput: unknown
}): AgentRunParams | null {
  const taskId = parseRequiredOpaqueIdInput(input.taskIdInput)
  const agentId = parseRequiredOpaqueIdInput(input.agentIdInput)
  const agentName = parseRequiredOpaqueIdInput(input.agentNameInput)
  const content = parseOptionalStringInput(input.contentInput, { maxLength: AGENT_RUN_MAX_CONTENT_LENGTH })
  if (!taskId || !agentId || !agentName || content === undefined) return null
  const additionalPrompt = parseOptionalStringInput(input.additionalPromptInput, {
    maxLength: AGENT_RUN_MAX_ADDITIONAL_PROMPT_LENGTH,
  })
  if (input.additionalPromptInput !== undefined && additionalPrompt === undefined) return null
  const outputContext = parseAgentRunOutputContextInput(input.outputContextInput)
  if (input.outputContextInput !== undefined && outputContext === null) return null
  return {
    taskId,
    agentId,
    agentName,
    content,
    additionalPrompt,
    outputContext: outputContext ?? undefined,
  }
}

export interface AIIpcDeps {
  // Context
  setUserContext: (context: Record<string, unknown>) => void
  getUserContext: () => unknown
  handleSelectionChange: (selectedText: string | null) => void
  // Tags
  getTags: () => unknown
  getTagsByNote: (noteId: string) => unknown
  // AI Actions
  getAIActions: () => unknown
  getAllAIActions: () => unknown
  getAIAction: (id: string) => unknown
  createAIAction: (input: AIActionInput) => unknown
  updateAIAction: (id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) => unknown
  deleteAIAction: (id: string) => unknown
  reorderAIActions: (orderedIds: string[]) => void
  resetAIActionsToDefaults: () => unknown
  // Popups
  getPopup: (id: string) => unknown
  createPopup: (input: PopupInput) => unknown
  updatePopupContent: (id: string, content: string) => unknown
  deletePopup: (id: string) => unknown
  cleanupPopups: (maxAgeDays?: number) => unknown
  // Agent Tasks
  getAgentTask: (id: string) => unknown
  getAgentTaskByBlockId: (blockId: string) => unknown
  createAgentTask: (input: AgentTaskInput) => unknown
  updateAgentTask: (id: string, updates: Partial<AgentTaskRecord>) => unknown
  deleteAgentTask: (id: string) => unknown
  deleteAgentTaskByBlockId: (blockId: string) => unknown
  // Templates
  getAllTemplates: () => unknown
  getTemplate: (id: string) => unknown
  getDailyDefaultTemplate: () => unknown
  createTemplate: (input: TemplateInput) => unknown
  updateTemplate: (id: string, updates: Partial<TemplateInput>) => unknown
  deleteTemplate: (id: string) => unknown
  reorderTemplates: (orderedIds: string[]) => void
  setDailyDefaultTemplate: (id: string | null) => unknown
  resetTemplatesToDefaults: () => unknown
  // Markdown
  markdownToTiptapString: (markdown: string) => string
  // Agent execution
  listAgents: () => Promise<unknown>
  runAgentTask: (
    taskId: string,
    agentId: string,
    agentName: string,
    content: string,
    additionalPrompt?: string,
    options?: AgentTaskOptions
  ) => AsyncIterable<unknown>
  cancelAgentTask: (taskId: string) => unknown
  buildAgentExecutionContext: (context: AgentExecutionContext | null) => string | null
}

export function registerAIIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: AIIpcDeps
): void {
  // Context
  ipcMainLike.handle('context:sync', createSafeHandler('context:sync', (_, contextInput: unknown) => {
    const context = parseRecordInput(contextInput)
    if (!context) return
    deps.setUserContext(context)
    if ('selectedText' in context) {
      const selectedText = context.selectedText
      deps.handleSelectionChange(typeof selectedText === 'string' ? selectedText : null)
    }
  }))
  ipcMainLike.handle('context:get', createSafeHandler('context:get', () => deps.getUserContext()))

  // Tags
  ipcMainLike.handle('tag:getAll', createSafeHandler('tag:getAll', () => deps.getTags()))
  ipcMainLike.handle('tag:getByNote', createSafeHandler('tag:getByNote', (_, noteIdInput: unknown) => {
    const noteId = parseRequiredOpaqueIdInput(noteIdInput)
    if (!noteId) return []
    return deps.getTagsByNote(noteId)
  }))

  // AI Actions
  ipcMainLike.handle('aiAction:getAll', createSafeHandler('aiAction:getAll', () => deps.getAIActions()))
  ipcMainLike.handle('aiAction:getAllIncludingDisabled', createSafeHandler('aiAction:getAllIncludingDisabled', () => deps.getAllAIActions()))
  ipcMainLike.handle('aiAction:getById', createSafeHandler('aiAction:getById', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return null
    return deps.getAIAction(id)
  }))
  ipcMainLike.handle('aiAction:create', createSafeHandler('aiAction:create', (_, inputData: unknown) => {
    const input = parseAIActionInput(inputData)
    if (!input) {
      throw new Error('aiAction:create payload is invalid')
    }
    return deps.createAIAction(input)
  }))
  ipcMainLike.handle('aiAction:update', createSafeHandler('aiAction:update', (_, idInput: unknown, updatesInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    const updates = parseAIActionUpdateInput(updatesInput)
    if (!id || !updates) return null
    return deps.updateAIAction(id, updates)
  }))
  ipcMainLike.handle('aiAction:delete', createSafeHandler('aiAction:delete', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return false
    return deps.deleteAIAction(id)
  }))
  ipcMainLike.handle('aiAction:reorder', createSafeHandler('aiAction:reorder', (_, orderedIdsInput: unknown) => {
    const orderedIds = parseUniqueStringArrayInput(orderedIdsInput)
    if (!orderedIds) return
    deps.reorderAIActions(orderedIds)
  }))
  ipcMainLike.handle('aiAction:reset', createSafeHandler('aiAction:reset', () => deps.resetAIActionsToDefaults()))

  // Popups
  ipcMainLike.handle('popup:get', createSafeHandler('popup:get', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return null
    return deps.getPopup(id)
  }))
  ipcMainLike.handle('popup:create', createSafeHandler('popup:create', (_, inputData: unknown) => {
    const input = parsePopupInput(inputData)
    if (!input) {
      throw new Error('popup:create payload is invalid')
    }
    return deps.createPopup(input)
  }))
  ipcMainLike.handle('popup:updateContent', createSafeHandler('popup:updateContent', (_, idInput: unknown, contentInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    const content = parseOptionalStringInput(contentInput, { maxLength: POPUP_TEXT_MAX_LENGTH })
    if (!id || content === undefined) return false
    return deps.updatePopupContent(id, content)
  }))
  ipcMainLike.handle('popup:delete', createSafeHandler('popup:delete', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return false
    return deps.deletePopup(id)
  }))
  ipcMainLike.handle('popup:cleanup', createSafeHandler('popup:cleanup', (_, maxAgeDaysInput?: unknown) => {
    const maxAgeDays = parseCleanupMaxAgeDaysInput(maxAgeDaysInput)
    if (maxAgeDaysInput !== undefined && maxAgeDays === null) {
      throw new Error(`popup:cleanup maxAgeDays must be an integer between 0 and ${CLEANUP_MAX_AGE_DAYS_LIMIT}`)
    }
    return deps.cleanupPopups(maxAgeDaysInput === undefined ? undefined : maxAgeDays ?? undefined)
  }))

  // Agent Tasks
  ipcMainLike.handle('agentTask:get', createSafeHandler('agentTask:get', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return null
    return deps.getAgentTask(id)
  }))
  ipcMainLike.handle('agentTask:getByBlockId', createSafeHandler('agentTask:getByBlockId', (_, blockIdInput: unknown) => {
    const blockId = parseRequiredOpaqueIdInput(blockIdInput)
    if (!blockId) return null
    return deps.getAgentTaskByBlockId(blockId)
  }))
  ipcMainLike.handle('agentTask:create', createSafeHandler('agentTask:create', (_, inputData: unknown) => {
    const input = parseAgentTaskInput(inputData)
    if (!input) {
      throw new Error('agentTask:create payload is invalid')
    }
    return deps.createAgentTask(input)
  }))
  ipcMainLike.handle('agentTask:update', createSafeHandler('agentTask:update', (_, idInput: unknown, updatesInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    const updates = parseAgentTaskUpdateInput(updatesInput)
    if (!id || !updates) return null
    return deps.updateAgentTask(id, updates)
  }))
  ipcMainLike.handle('agentTask:delete', createSafeHandler('agentTask:delete', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return false
    return deps.deleteAgentTask(id)
  }))
  ipcMainLike.handle('agentTask:deleteByBlockId', createSafeHandler('agentTask:deleteByBlockId', (_, blockIdInput: unknown) => {
    const blockId = parseRequiredOpaqueIdInput(blockIdInput)
    if (!blockId) return false
    return deps.deleteAgentTaskByBlockId(blockId)
  }))

  // Templates
  ipcMainLike.handle('templates:getAll', createSafeHandler('templates:getAll', () => deps.getAllTemplates()))
  ipcMainLike.handle('templates:get', createSafeHandler('templates:get', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return null
    return deps.getTemplate(id)
  }))
  ipcMainLike.handle('templates:getDailyDefault', createSafeHandler('templates:getDailyDefault', () => deps.getDailyDefaultTemplate()))
  ipcMainLike.handle('templates:create', createSafeHandler('templates:create', (_, inputData: unknown) => {
    const input = parseTemplateInput(inputData)
    if (!input) {
      throw new Error('templates:create payload is invalid')
    }
    return deps.createTemplate(input)
  }))
  ipcMainLike.handle('templates:update', createSafeHandler('templates:update', (_, idInput: unknown, updatesInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    const updates = parseTemplateUpdateInput(updatesInput)
    if (!id || !updates) return null
    return deps.updateTemplate(id, updates)
  }))
  ipcMainLike.handle('templates:delete', createSafeHandler('templates:delete', (_, idInput: unknown) => {
    const id = parseRequiredOpaqueIdInput(idInput)
    if (!id) return false
    return deps.deleteTemplate(id)
  }))
  ipcMainLike.handle('templates:reorder', createSafeHandler('templates:reorder', (_, orderedIdsInput: unknown) => {
    const orderedIds = parseUniqueStringArrayInput(orderedIdsInput)
    if (!orderedIds) return
    deps.reorderTemplates(orderedIds)
  }))
  ipcMainLike.handle('templates:setDailyDefault', createSafeHandler('templates:setDailyDefault', (_, idInput: unknown) => {
    if (idInput !== null) {
      const id = parseRequiredOpaqueIdInput(idInput)
      if (!id) return
      return deps.setDailyDefaultTemplate(id)
    }
    return deps.setDailyDefaultTemplate(null)
  }))
  ipcMainLike.handle('templates:reset', createSafeHandler('templates:reset', () => deps.resetTemplatesToDefaults()))

  // Markdown
  ipcMainLike.handle('markdown:toTiptap', createSafeHandler('markdown:toTiptap', (_, markdownInput: unknown) => {
    const markdown = parseOptionalStringInput(markdownInput, { maxLength: MARKDOWN_TO_TIPTAP_MAX_LENGTH })
    if (markdown === undefined) return ''
    return deps.markdownToTiptapString(markdown)
  }))

  // Agent execution
  ipcMainLike.handle('agent:list', createSafeHandler('agent:list', async () => {
    return deps.listAgents()
  }))

  ipcMainLike.handle('agent:run', async (
    event,
    taskIdInput: unknown,
    agentIdInput: unknown,
    agentNameInput: unknown,
    contentInput: unknown,
    additionalPromptInput?: unknown,
    outputContextInput?: unknown
  ) => {
    const webContents = event.sender

    const sendAgentEvent = (taskId: string, taskEvent: unknown): boolean => {
      if (webContents.isDestroyed()) {
        return false
      }
      try {
        webContents.send('agent:event', taskId, taskEvent)
        return true
      } catch (sendError) {
        console.error('[agent:run] failed to send agent event:', sendError)
        return false
      }
    }

    try {
      const parsed = parseAgentRunParams({
        taskIdInput,
        agentIdInput,
        agentNameInput,
        contentInput,
        additionalPromptInput,
        outputContextInput,
      })
      if (!parsed) {
        throw new Error('Invalid agent:run payload')
      }

      const executionContext = deps.buildAgentExecutionContext(parsed.outputContext?.executionContext ?? null)
      const executionContextBlock = executionContext
        ? `<execution_context>\n${executionContext}\n</execution_context>`
        : undefined

      const options = parsed.outputContext ? {
        useTwoStepFlow: true,
        outputContext: {
          targetBlockId: parsed.outputContext.targetBlockId,
          pageId: parsed.outputContext.pageId,
          notebookId: parsed.outputContext.notebookId,
          processMode: parsed.outputContext.processMode,
          outputBlockId: null
        },
        outputFormat: parsed.outputContext.outputFormat,
        executionContext: executionContextBlock,
        webContents
      } : executionContextBlock ? {
        executionContext: executionContextBlock
      } : undefined

      for await (const taskEvent of deps.runAgentTask(
        parsed.taskId,
        parsed.agentId,
        parsed.agentName,
        parsed.content,
        parsed.additionalPrompt,
        options
      )) {
        if (!sendAgentEvent(parsed.taskId, taskEvent)) {
          break
        }
      }
    } catch (error) {
      const taskId = parseRequiredOpaqueIdInput(taskIdInput) || '__invalid_task_id__'
      sendAgentEvent(taskId, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  ipcMainLike.handle('agent:cancel', createSafeHandler('agent:cancel', (_, taskIdInput: unknown) => {
    const taskId = parseRequiredOpaqueIdInput(taskIdInput)
    if (!taskId) return false
    return deps.cancelAgentTask(taskId)
  }))
}
