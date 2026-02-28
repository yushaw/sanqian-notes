/**
 * SDK tool definitions -- barrel module.
 *
 * Re-assembles all domain-specific tool builders into the single
 * buildTools() array that the SDK client expects.
 */

import { type AppToolDefinition } from '@yushaw/sanqian-chat/main'
import {
  createEditorOutputTools,
} from '../../editor-agent'
import {
  resolveEditorNoteRefByTitle,
} from '../helpers/context-overview-helpers'
import {
  currentTaskIdGetter,
} from '../state'

import { buildWebSearchTool, buildFetchWebTool } from './web'
import {
  buildSearchNotesTool,
  buildGetNoteTool,
  buildGetNoteOutlineTool,
  buildGetNotebooksTool,
} from './read'
import {
  buildCreateNoteTool,
  buildUpdateNoteTool,
  buildDeleteNoteTool,
  buildMoveNoteTool,
} from './mutations'

export function buildTools(): AppToolDefinition[] {
  return [
    // ==================== read ====================
    buildSearchNotesTool(),
    buildGetNoteTool(),
    buildGetNoteOutlineTool(),

    // ==================== mutations ====================
    buildCreateNoteTool(),
    buildUpdateNoteTool(),
    buildDeleteNoteTool(),
    buildGetNotebooksTool(),
    buildMoveNoteTool(),

    // ==================== web ====================
    buildWebSearchTool(),
    buildFetchWebTool(),

    // ==================== editor output ====================
    ...createEditorOutputTools(
      () => currentTaskIdGetter?.() ?? null,
      {
        resolveNoteRef: resolveEditorNoteRefByTitle,
      }
    )
  ]
}
