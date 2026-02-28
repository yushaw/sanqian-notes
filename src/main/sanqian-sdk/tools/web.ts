/**
 * Web tool definitions: web_search and fetch_web.
 */

import { type AppToolDefinition } from '@yushaw/sanqian-chat/main'
import { t } from '../../i18n'

export function buildWebSearchTool(): AppToolDefinition {
  const tools = t().tools
  return {
    name: 'web_search',
    description: tools.webSearch.description,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: tools.webSearch.queryDesc
        }
      },
      required: ['query']
    },
    handler: async (args: Record<string, unknown>) => {
      const query = args.query as string
      return { query, message: 'Web search executed by SDK' }
    }
  }
}

export function buildFetchWebTool(): AppToolDefinition {
  const tools = t().tools
  return {
    name: 'fetch_web',
    description: tools.fetchWeb.description,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: tools.fetchWeb.urlDesc
        },
        prompt: {
          type: 'string',
          description: tools.fetchWeb.promptDesc
        }
      },
      required: ['url']
    },
    handler: async (args: Record<string, unknown>) => {
      const url = args.url as string
      const prompt = args.prompt as string | undefined
      return { url, prompt, message: 'Web fetch executed by SDK' }
    }
  }
}
