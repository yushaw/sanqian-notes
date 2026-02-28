/**
 * SDK client lifecycle and agent management.
 *
 * Contains initializeSanqianSDK, stopSanqianSDK, and all exported
 * client accessor/lifecycle functions.
 */

import {
  SanqianAppClient,
  type AppConfig,
  type AppAgentConfig,
} from '@yushaw/sanqian-chat/main'
import { app } from 'electron'
import { getFormatterAgentConfig } from '../editor-agent'
import { t } from '../i18n'
import { buildTools } from './tools'
import { buildContextProviders } from './context-providers'
import {
  client,
  assistantAgentId,
  writingAgentId,
  generatorAgentId,
  formatterAgentId,
  syncingPromise,
  setClient,
  setAssistantAgentId,
  setWritingAgentId,
  setGeneratorAgentId,
  setFormatterAgentId,
  setSyncingPromise,
} from './state'

// --- Launch command ---

function getLaunchCommand(): string | undefined {
  if (!app.isPackaged) {
    return undefined
  }
  const exePath = app.getPath('exe')
  return `"${exePath}" --silent`
}

// --- Agent configs ---

function buildAgentConfigs(): AppAgentConfig[] {
  const sdk = t().sdk
  return [
    {
      agentId: 'assistant',
      name: sdk.assistantName,
      description: sdk.assistantDescription,
      systemPrompt: sdk.assistantSystemPrompt,
      tools: [
        'search_notes',
        'get_note',
        'get_note_outline',
        'create_note',
        'update_note',
        'delete_note',
        'get_notebooks',
        'move_note',
        'web_search',
        'fetch_web'
      ],
      attachedContexts: ['sanqian-notes:editor-state', 'sanqian-notes:notes']
    },
    {
      agentId: 'writing',
      name: sdk.writingName,
      description: sdk.writingDescription,
      systemPrompt: sdk.writingSystemPrompt,
      tools: []
    },
    {
      agentId: 'generator',
      name: sdk.generatorName,
      description: sdk.generatorDescription,
      systemPrompt: sdk.generatorSystemPrompt,
      tools: []
    },
    // Formatter Agent for formatting output
    getFormatterAgentConfig()
  ]
}

// --- Agent syncing ---

async function syncPrivateAgents(): Promise<void> {
  if (!client) {
    throw new Error('Client not initialized')
  }

  // If another sync is in progress, wait for it
  if (syncingPromise) {
    try {
      await syncingPromise
    } catch {
      // Previous sync failed -- fall through to retry below
    }
    // Previous sync succeeded -- agents are ready
    if (assistantAgentId && writingAgentId && generatorAgentId && formatterAgentId) {
      return
    }
    // Another waiter may have already started a retry -- piggyback on it
    if (syncingPromise) {
      await syncingPromise
      return
    }
  }

  const promise = (async () => {
    const agents = buildAgentConfigs()
    console.log('[SanqianSDK] Syncing agents:', agents.map(a => a.agentId))

    const agentMap = new Map(agents.map(a => [a.agentId, a]))

    const assistantAgent = agentMap.get('assistant') ?? agents[0]
    const assistantInfo = await client!.createAgent(assistantAgent)
    setAssistantAgentId(assistantInfo.agentId)
    console.log('[SanqianSDK] Assistant agent synced:', assistantAgentId)

    const writingAgent = agentMap.get('writing') ?? agents[1]
    const writingInfo = await client!.createAgent(writingAgent)
    setWritingAgentId(writingInfo.agentId)
    console.log('[SanqianSDK] Writing agent synced:', writingAgentId)

    const generatorAgent = agentMap.get('generator') ?? agents[2]
    const generatorInfo = await client!.createAgent(generatorAgent)
    setGeneratorAgentId(generatorInfo.agentId)
    console.log('[SanqianSDK] Generator agent synced:', generatorAgentId)

    // Sync Formatter Agent for output formatting
    const formatterAgent = agentMap.get('formatter') ?? agents[3]
    if (formatterAgent) {
      const formatterInfo = await client!.createAgent(formatterAgent)
      setFormatterAgentId(formatterInfo.agentId)
      console.log('[SanqianSDK] Formatter agent synced:', formatterAgentId)
    }
  })()

  setSyncingPromise(promise)

  try {
    await promise
  } catch (e) {
    console.error('[SanqianSDK] Failed to sync agents:', e)
    throw e
  } finally {
    setSyncingPromise(null)
  }
}

// --- Exported lifecycle functions ---

export async function initializeSanqianSDK(): Promise<void> {
  if (client) {
    console.log('[SanqianSDK] Already initialized')
    return
  }

  const launchCommand = getLaunchCommand()

  if (launchCommand) {
    console.log(`[SanqianSDK] Launch command: ${launchCommand}`)
  }
  console.log('[SanqianSDK] Initializing...')

  const config: AppConfig = {
    appName: 'sanqian-notes',
    appVersion: app.getVersion(),
    displayName: 'Flow',
    launchCommand,
    tools: buildTools(),
    contexts: buildContextProviders()
  }

  const newClient = new SanqianAppClient(config)
  setClient(newClient)

  newClient.on('connected', () => {
    console.log('[SanqianSDK] Connected to Sanqian')
  })

  newClient.on('registered', async () => {
    console.log('[SanqianSDK] Registered with Sanqian')
    try {
      await syncPrivateAgents()
    } catch (err) {
      console.error('[SanqianSDK] Agent sync failed after registration:', err)
    }
  })

  newClient.on('disconnected', () => {
    console.log('[SanqianSDK] Disconnected from Sanqian')
    setAssistantAgentId(null)
    setWritingAgentId(null)
    setGeneratorAgentId(null)
    setFormatterAgentId(null)
  })

  newClient.on('error', (error) => {
    console.error('[SanqianSDK] Error:', error)
  })

  newClient.on('tool_call', ({ name, arguments: args }) => {
    console.log(`[SanqianSDK] Tool call: ${name}`, args)
  })

  console.log('[SanqianSDK] Initialized')

  try {
    await newClient.connect()
    console.log('[SanqianSDK] Initial connection successful')
  } catch (err) {
    console.log('[SanqianSDK] Initial connection failed (Sanqian may not be running):', err instanceof Error ? err.message : err)
  }
}

export async function stopSanqianSDK(): Promise<void> {
  if (client) {
    client.removeAllListeners()
    await client.disconnect()
    setClient(null)
    setAssistantAgentId(null)
    setWritingAgentId(null)
    setGeneratorAgentId(null)
    setFormatterAgentId(null)
    setSyncingPromise(null)
  }
}

export async function updateSdkContexts(): Promise<void> {
  if (!client || !client.isConnected()) {
    return
  }

  try {
    // Update context providers
    const contexts = buildContextProviders()
    await client.updateContexts(contexts)

    // Update agents (name, description, systemPrompt)
    await syncPrivateAgents()

    console.log('[SanqianSDK] Contexts and agents updated for new locale')
  } catch (error) {
    console.error('[SanqianSDK] Failed to update SDK i18n:', error)
  }
}

export function isSanqianConnected(): boolean {
  return client?.isConnected() ?? false
}

export function acquireReconnect(): void {
  client?.acquireReconnect()
}

export function releaseReconnect(): void {
  client?.releaseReconnect()
}

export function getAssistantAgentId(): string | null {
  return assistantAgentId
}

export function getWritingAgentId(): string | null {
  return writingAgentId
}

export function getGeneratorAgentId(): string | null {
  return generatorAgentId
}

export function getFormatterAgentId(): string | null {
  return formatterAgentId
}

export function getClient(): SanqianAppClient | null {
  return client
}

export async function ensureAgentReady(
  agentType: 'assistant' | 'writing' | 'generator' = 'assistant'
): Promise<{ client: SanqianAppClient; agentId: string }> {
  if (!client) {
    throw new Error('Client not initialized')
  }

  await client.ensureReady()

  const agentIdMap = {
    assistant: assistantAgentId,
    writing: writingAgentId,
    generator: generatorAgentId
  }
  const agentId = agentIdMap[agentType]

  if (agentId) {
    return { client, agentId }
  }

  await syncPrivateAgents()

  // Re-read global variables after sync (agentIdMap captured old null values)
  const finalAgentId =
    agentType === 'assistant' ? assistantAgentId :
    agentType === 'writing' ? writingAgentId :
    generatorAgentId

  if (!finalAgentId) {
    throw new Error(`Failed to sync ${agentType} agent`)
  }

  return { client, agentId: finalAgentId }
}

export async function fetchEmbeddingConfigFromSanqian(): Promise<{
  available: boolean
  apiUrl?: string
  apiKey?: string
  modelName?: string
  dimensions?: number
} | null> {
  if (!client) {
    console.log('[SanqianSDK] Client not initialized, cannot fetch embedding config')
    return null
  }

  try {
    await client.ensureReady()
    const config = await client.getEmbeddingConfig()

    if (config?.available) {
      console.log(
        `[SanqianSDK] Got embedding config from Sanqian: model=${config.modelName}, apiUrl=${config.apiUrl}`
      )
    } else {
      console.log('[SanqianSDK] Sanqian has no embedding configured')
    }

    return config
  } catch (error) {
    console.log(
      '[SanqianSDK] Failed to fetch embedding config from Sanqian:',
      error instanceof Error ? error.message : error
    )
    return null
  }
}

export async function fetchRerankConfigFromSanqian(): Promise<{
  available: boolean
  apiUrl?: string
  apiKey?: string
  modelName?: string
} | null> {
  if (!client) {
    console.log('[SanqianSDK] Client not initialized, cannot fetch rerank config')
    return null
  }

  try {
    await client.ensureReady()
    const config = await client.getRerankConfig()

    if (config?.available) {
      console.log(
        `[SanqianSDK] Got rerank config from Sanqian: model=${config.modelName}, apiUrl=${config.apiUrl}`
      )
    } else {
      console.log('[SanqianSDK] Sanqian has no rerank configured')
    }

    return config
  } catch (error) {
    console.log(
      '[SanqianSDK] Failed to fetch rerank config from Sanqian:',
      error instanceof Error ? error.message : error
    )
    return null
  }
}
