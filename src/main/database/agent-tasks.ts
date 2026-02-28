import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import type { AgentTaskRecord, AgentTaskInput } from '../../shared/types'

interface AgentTaskRow {
  id: string
  block_id: string
  page_id: string
  notebook_id: string | null
  content: string
  additional_prompt: string | null
  agent_mode: string
  agent_id: string | null
  agent_name: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  steps: string | null
  result: string | null
  error: string | null
  output_block_id: string | null
  process_mode: string
  output_format: string
  run_timing: string
  schedule_config: string | null
  created_at: string
  updated_at: string
}

function rowToAgentTask(row: AgentTaskRow): AgentTaskRecord {
  return {
    id: row.id,
    blockId: row.block_id,
    pageId: row.page_id,
    notebookId: row.notebook_id,
    content: row.content,
    additionalPrompt: row.additional_prompt,
    agentMode: row.agent_mode as 'auto' | 'specified',
    agentId: row.agent_id,
    agentName: row.agent_name,
    status: row.status as 'idle' | 'running' | 'completed' | 'failed',
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    steps: row.steps,
    result: row.result,
    error: row.error,
    outputBlockId: row.output_block_id,
    processMode: (row.process_mode || 'append') as 'append' | 'replace',
    outputFormat: (row.output_format || 'auto') as 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote',
    runTiming: (row.run_timing || 'manual') as 'manual' | 'immediate' | 'scheduled',
    scheduleConfig: row.schedule_config,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getAgentTask(id: string): AgentTaskRecord | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as AgentTaskRow | undefined
  if (!row) return null
  return rowToAgentTask(row)
}

export function getAgentTaskByBlockId(blockId: string): AgentTaskRecord | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agent_tasks WHERE block_id = ?').get(blockId) as AgentTaskRow | undefined
  if (!row) return null
  return rowToAgentTask(row)
}

export function createAgentTask(input: AgentTaskInput): AgentTaskRecord {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO agent_tasks (
      id, block_id, page_id, notebook_id, content, additional_prompt,
      agent_mode, agent_id, agent_name, status, process_mode, output_format,
      run_timing, schedule_config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.blockId,
    input.pageId,
    input.notebookId ?? null,
    input.content,
    input.additionalPrompt ?? null,
    input.agentMode ?? 'auto',
    input.agentId ?? null,
    input.agentName ?? null,
    input.processMode ?? 'append',
    input.outputFormat ?? 'auto',
    input.runTiming ?? 'manual',
    input.scheduleConfig ?? null,
    now,
    now
  )

  const task = getAgentTask(id)
  if (!task) {
    throw new Error(`Failed to create agent task: record not found after INSERT (id=${id})`)
  }
  return task
}

export function updateAgentTask(id: string, updates: Partial<AgentTaskRecord>): AgentTaskRecord | null {
  const db = getDb()
  const existing = getAgentTask(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const fields: string[] = []
  const values: unknown[] = []

  const fieldMap: Record<string, string> = {
    blockId: 'block_id',
    pageId: 'page_id',
    notebookId: 'notebook_id',
    additionalPrompt: 'additional_prompt',
    agentMode: 'agent_mode',
    agentId: 'agent_id',
    agentName: 'agent_name',
    startedAt: 'started_at',
    completedAt: 'completed_at',
    durationMs: 'duration_ms',
    outputBlockId: 'output_block_id',
    processMode: 'process_mode',
    outputFormat: 'output_format',
    runTiming: 'run_timing',
    scheduleConfig: 'schedule_config'
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
    const dbField = fieldMap[key]
    if (!dbField) continue // Skip unmapped keys to prevent SQL injection
    fields.push(`${dbField} = ?`)
    values.push(value)
  }

  if (fields.length === 0) return existing

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)

  db.prepare(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getAgentTask(id)
}

export function deleteAgentTask(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(id)
  return result.changes > 0
}

export function deleteAgentTaskByBlockId(blockId: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM agent_tasks WHERE block_id = ?').run(blockId)
  return result.changes > 0
}
