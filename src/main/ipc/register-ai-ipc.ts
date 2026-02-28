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
  ipcMainLike.handle('context:sync', createSafeHandler('context:sync', (_, context: Record<string, unknown>) => {
    deps.setUserContext(context)
    if ('selectedText' in context) {
      deps.handleSelectionChange((context.selectedText as string) ?? null)
    }
  }))
  ipcMainLike.handle('context:get', createSafeHandler('context:get', () => deps.getUserContext()))

  // Tags
  ipcMainLike.handle('tag:getAll', createSafeHandler('tag:getAll', () => deps.getTags()))
  ipcMainLike.handle('tag:getByNote', createSafeHandler('tag:getByNote', (_, noteId) => deps.getTagsByNote(noteId)))

  // AI Actions
  ipcMainLike.handle('aiAction:getAll', createSafeHandler('aiAction:getAll', () => deps.getAIActions()))
  ipcMainLike.handle('aiAction:getAllIncludingDisabled', createSafeHandler('aiAction:getAllIncludingDisabled', () => deps.getAllAIActions()))
  ipcMainLike.handle('aiAction:getById', createSafeHandler('aiAction:getById', (_, id: string) => deps.getAIAction(id)))
  ipcMainLike.handle('aiAction:create', createSafeHandler('aiAction:create', (_, input: AIActionInput) => deps.createAIAction(input)))
  ipcMainLike.handle('aiAction:update', createSafeHandler('aiAction:update', (_, id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) =>
    deps.updateAIAction(id, updates)
  ))
  ipcMainLike.handle('aiAction:delete', createSafeHandler('aiAction:delete', (_, id: string) => deps.deleteAIAction(id)))
  ipcMainLike.handle('aiAction:reorder', createSafeHandler('aiAction:reorder', (_, orderedIds: string[]) => deps.reorderAIActions(orderedIds)))
  ipcMainLike.handle('aiAction:reset', createSafeHandler('aiAction:reset', () => deps.resetAIActionsToDefaults()))

  // Popups
  ipcMainLike.handle('popup:get', createSafeHandler('popup:get', (_, id: string) => deps.getPopup(id)))
  ipcMainLike.handle('popup:create', createSafeHandler('popup:create', (_, input: PopupInput) => deps.createPopup(input)))
  ipcMainLike.handle('popup:updateContent', createSafeHandler('popup:updateContent', (_, id: string, content: string) => deps.updatePopupContent(id, content)))
  ipcMainLike.handle('popup:delete', createSafeHandler('popup:delete', (_, id: string) => deps.deletePopup(id)))
  ipcMainLike.handle('popup:cleanup', createSafeHandler('popup:cleanup', (_, maxAgeDays?: number) => deps.cleanupPopups(maxAgeDays)))

  // Agent Tasks
  ipcMainLike.handle('agentTask:get', createSafeHandler('agentTask:get', (_, id: string) => deps.getAgentTask(id)))
  ipcMainLike.handle('agentTask:getByBlockId', createSafeHandler('agentTask:getByBlockId', (_, blockId: string) => deps.getAgentTaskByBlockId(blockId)))
  ipcMainLike.handle('agentTask:create', createSafeHandler('agentTask:create', (_, input: AgentTaskInput) => deps.createAgentTask(input)))
  ipcMainLike.handle('agentTask:update', createSafeHandler('agentTask:update', (_, id: string, updates: Partial<AgentTaskRecord>) => deps.updateAgentTask(id, updates)))
  ipcMainLike.handle('agentTask:delete', createSafeHandler('agentTask:delete', (_, id: string) => deps.deleteAgentTask(id)))
  ipcMainLike.handle('agentTask:deleteByBlockId', createSafeHandler('agentTask:deleteByBlockId', (_, blockId: string) => deps.deleteAgentTaskByBlockId(blockId)))

  // Templates
  ipcMainLike.handle('templates:getAll', createSafeHandler('templates:getAll', () => deps.getAllTemplates()))
  ipcMainLike.handle('templates:get', createSafeHandler('templates:get', (_, id: string) => deps.getTemplate(id)))
  ipcMainLike.handle('templates:getDailyDefault', createSafeHandler('templates:getDailyDefault', () => deps.getDailyDefaultTemplate()))
  ipcMainLike.handle('templates:create', createSafeHandler('templates:create', (_, input: TemplateInput) => deps.createTemplate(input)))
  ipcMainLike.handle('templates:update', createSafeHandler('templates:update', (_, id: string, updates: Partial<TemplateInput>) => deps.updateTemplate(id, updates)))
  ipcMainLike.handle('templates:delete', createSafeHandler('templates:delete', (_, id: string) => deps.deleteTemplate(id)))
  ipcMainLike.handle('templates:reorder', createSafeHandler('templates:reorder', (_, orderedIds: string[]) => deps.reorderTemplates(orderedIds)))
  ipcMainLike.handle('templates:setDailyDefault', createSafeHandler('templates:setDailyDefault', (_, id: string | null) => deps.setDailyDefaultTemplate(id)))
  ipcMainLike.handle('templates:reset', createSafeHandler('templates:reset', () => deps.resetTemplatesToDefaults()))

  // Markdown
  ipcMainLike.handle('markdown:toTiptap', createSafeHandler('markdown:toTiptap', (_, markdown: string) => deps.markdownToTiptapString(markdown)))

  // Agent execution
  ipcMainLike.handle('agent:list', createSafeHandler('agent:list', async () => {
    return deps.listAgents()
  }))

  ipcMainLike.handle('agent:run', async (
    event,
    taskId: string,
    agentId: string,
    agentName: string,
    content: string,
    additionalPrompt?: string,
    outputContext?: {
      targetBlockId: string
      pageId: string
      notebookId: string | null
      processMode: 'append' | 'replace'
      outputFormat?: 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'
      executionContext?: AgentExecutionContext
    }
  ) => {
    const webContents = event.sender

    try {
      const executionContext = deps.buildAgentExecutionContext(outputContext?.executionContext ?? null)
      const executionContextBlock = executionContext
        ? `<execution_context>\n${executionContext}\n</execution_context>`
        : undefined

      const options = outputContext ? {
        useTwoStepFlow: true,
        outputContext: {
          targetBlockId: outputContext.targetBlockId,
          pageId: outputContext.pageId,
          notebookId: outputContext.notebookId,
          processMode: outputContext.processMode,
          outputBlockId: null
        },
        outputFormat: outputContext.outputFormat,
        executionContext: executionContextBlock,
        webContents
      } : executionContextBlock ? {
        executionContext: executionContextBlock
      } : undefined

      for await (const taskEvent of deps.runAgentTask(
        taskId,
        agentId,
        agentName,
        content,
        additionalPrompt,
        options
      )) {
        if (!webContents.isDestroyed()) {
          webContents.send('agent:event', taskId, taskEvent)
        }
      }
    } catch (error) {
      if (!webContents.isDestroyed()) {
        webContents.send('agent:event', taskId, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  })

  ipcMainLike.handle('agent:cancel', createSafeHandler('agent:cancel', (_, taskId: string) => {
    return deps.cancelAgentTask(taskId)
  }))
}
