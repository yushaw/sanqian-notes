/**
 * Electron Adapter
 *
 * Connects to Sanqian backend via Electron IPC.
 * The main process handles actual communication with Sanqian SDK.
 */

import type {
  ConnectionStatus,
  ConnectionErrorCode,
  StreamEvent,
  ConversationInfo,
  ConversationDetail,
  ChatMessage,
  ToolCall,
  MessageBlock,
  HitlResponse,
  StreamHitlInterruptPayload,
} from '../core/types';
import type { ChatAdapter, AdapterConfig, SendMessage } from './types';

// =============================================================================
// Message Processing Helpers (copied from sanqian adapter)
// =============================================================================

/**
 * Tool call item from backend - supports both formats:
 * 1. Flat format from history_service (internal): { id, name, args, result }
 * 2. OpenAI format from SDK API: { id, type, function: { name, arguments } }
 */
interface ApiToolCall {
  id?: string;
  // Flat format fields
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  // OpenAI format fields
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Backend message format */
interface ApiMessage {
  role: string;
  content: string;
  created_at?: string;
  // Backend may return either format
  tool_calls?: ApiToolCall[];
  toolCalls?: ApiToolCall[];
  tool_call_id?: string;
  thinking?: string;
}

/**
 * Parse tool_calls from backend format
 * Handles both flat format { id, name, args } and OpenAI format { id, function: { name, arguments } }
 */
function parseToolCalls(toolCalls: unknown): ToolCall[] | undefined {
  if (!toolCalls || !Array.isArray(toolCalls)) return undefined;
  return toolCalls.map((tc: ApiToolCall) => {
    // Check if it's OpenAI format (has function.name)
    const isOpenAIFormat = tc.function && typeof tc.function === 'object';

    let name: string;
    let args: Record<string, unknown>;

    if (isOpenAIFormat) {
      // OpenAI format: { id, type, function: { name, arguments } }
      name = tc.function?.name || '';
      // arguments is a JSON string in OpenAI format
      const argsStr = tc.function?.arguments;
      if (argsStr && typeof argsStr === 'string') {
        try {
          args = JSON.parse(argsStr);
        } catch {
          args = {};
        }
      } else {
        args = {};
      }
    } else {
      // Flat format: { id, name, args }
      name = tc.name || '';
      args = tc.args || {};
    }

    return {
      id: tc.id || '',
      name,
      arguments: args,
      result: tc.result,
      status: 'completed' as const,
    };
  });
}

/**
 * Merge consecutive assistant messages
 * Handles pattern: Assistant → Tool → Assistant → Tool → ...
 */
function mergeConsecutiveAssistantMessages(rawMessages: ApiMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let i = 0;

  while (i < rawMessages.length) {
    const msg = rawMessages[i];
    const messageId = `history-${i}`;

    if (msg.role === 'assistant') {
      const consecutiveAssistantMsgs: ApiMessage[] = [msg];
      const toolMessages: ApiMessage[] = [];
      let j = i + 1;

      // Collect consecutive assistant and tool messages
      while (j < rawMessages.length) {
        if (rawMessages[j].role === 'assistant') {
          consecutiveAssistantMsgs.push(rawMessages[j]);
          j++;
        } else if (rawMessages[j].role === 'tool') {
          toolMessages.push(rawMessages[j]);
          j++;
        } else {
          break;
        }
      }

      // Build blocks array preserving original sequence
      const blocks: MessageBlock[] = [];
      let blockTime = Date.now();

      for (let k = 0; k < consecutiveAssistantMsgs.length; k++) {
        const assistantMsg = consecutiveAssistantMsgs[k];
        const msgToolCalls = parseToolCalls(assistantMsg.toolCalls || assistantMsg.tool_calls);
        const isLastAssistant = k === consecutiveAssistantMsgs.length - 1;
        const hasToolCalls = msgToolCalls && msgToolCalls.length > 0;

        // Add thinking block
        if (assistantMsg.thinking?.trim()) {
          blocks.push({
            type: 'thinking',
            content: assistantMsg.thinking,
            timestamp: blockTime++,
            isIntermediate: true,
          });
        }

        // Add content block
        if (assistantMsg.content?.trim()) {
          blocks.push({
            type: 'text',
            content: assistantMsg.content,
            timestamp: blockTime++,
            isIntermediate: hasToolCalls || !isLastAssistant,
          });
        }

        // Add tool call blocks
        if (msgToolCalls) {
          for (const tc of msgToolCalls) {
            blocks.push({
              type: 'tool_call',
              content: '',
              timestamp: blockTime++,
              toolName: tc.name,
              toolArgs: tc.arguments,
              toolCallId: tc.id,
              toolStatus: 'completed',
              isIntermediate: true,
            });

            // Find matching tool result
            const toolResult = toolMessages.find(tm => tc.id && tm.tool_call_id === tc.id);
            const resultContent = (tc.result as string | undefined) || toolResult?.content;
            if (resultContent) {
              blocks.push({
                type: 'tool_result',
                content: resultContent,
                timestamp: blockTime++,
                toolName: tc.name,
                toolCallId: tc.id,
                isIntermediate: true,
              });
            }
          }
        }
      }

      // Merge content from all assistant messages
      if (consecutiveAssistantMsgs.length > 1) {
        // Prefer messages without tool_calls (final responses)
        let contentMessages = consecutiveAssistantMsgs.filter(m => !m.toolCalls && !m.tool_calls);
        // Fallback: if all have tool_calls, use the last one
        if (contentMessages.length === 0) {
          contentMessages = [consecutiveAssistantMsgs[consecutiveAssistantMsgs.length - 1]];
        }

        const mergedContent = contentMessages
          .map(m => m.content)
          .filter(c => c?.trim())
          .join('\n\n');

        // Merge tool calls
        const mergedToolCalls: ToolCall[] = consecutiveAssistantMsgs.flatMap(
          m => parseToolCalls(m.toolCalls || m.tool_calls) || [],
        );

        // Fill tool results
        for (const toolMsg of toolMessages) {
          const matchingToolCall = mergedToolCalls.find(tc => toolMsg.tool_call_id && tc.id === toolMsg.tool_call_id);
          if (matchingToolCall) {
            matchingToolCall.result = toolMsg.content;
          }
        }

        // Merge thinking
        const thinkingParts = consecutiveAssistantMsgs.map(m => m.thinking).filter(t => t?.trim());
        const mergedThinking = thinkingParts.length > 1 ? thinkingParts.join('\n─────\n') : thinkingParts[0] || '';

        result.push({
          id: messageId,
          role: 'assistant',
          content: mergedContent,
          timestamp: msg.created_at || new Date().toISOString(),
          toolCalls: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
          thinking: mergedThinking || undefined,
          blocks: blocks.length > 0 ? blocks : undefined,
          isComplete: true,
        });

        i = j;
      } else {
        // Single assistant message
        result.push({
          id: messageId,
          role: 'assistant',
          content: msg.content || '',
          timestamp: msg.created_at || new Date().toISOString(),
          toolCalls: parseToolCalls(msg.toolCalls || msg.tool_calls),
          thinking: msg.thinking,
          blocks: blocks.length > 0 ? blocks : undefined,
          isComplete: true,
        });
        i++;
      }
    } else if (msg.role === 'tool') {
      // Skip standalone tool messages (merged with assistant)
      i++;
    } else {
      // User messages
      result.push({
        id: messageId,
        role: msg.role as 'user' | 'assistant',
        content: msg.content || '',
        timestamp: msg.created_at || new Date().toISOString(),
      });
      i++;
    }
  }

  return result;
}

// =============================================================================
// Electron Adapter
// =============================================================================

export interface ElectronAdapterConfig extends AdapterConfig {
  /** Agent type: 'assistant' or 'writing' (default: 'assistant') */
  agentType?: 'assistant' | 'writing';
}

/**
 * Create an Electron adapter that communicates via Electron IPC
 */
export function createElectronAdapter(config: ElectronAdapterConfig = {}): ChatAdapter {
  let connectionStatus: ConnectionStatus = 'disconnected';
  let connectionError: string | undefined;
  let connectionErrorCode: ConnectionErrorCode | undefined;
  const connectionListeners = new Set<
    (status: ConnectionStatus, error?: string, errorCode?: ConnectionErrorCode) => void
  >();
  const streamCallbacks = new Map<string, (event: StreamEvent) => void>();

  // Get chat API (available in preload via contextBridge)
  const chat = (window as any).electron?.chat;
  if (!chat) {
    throw new Error('Electron chat API not available. Make sure preload script is configured correctly.');
  }

  // Update connection status and notify listeners
  const updateConnectionStatus = (status: ConnectionStatus, error?: string, errorCode?: ConnectionErrorCode) => {
    connectionStatus = status;
    connectionError = error;
    connectionErrorCode = errorCode;
    connectionListeners.forEach(cb => cb(status, error, errorCode));
  };

  // Store cleanup functions for IPC listeners
  let statusChangeCleanup: (() => void) | null = null;
  let streamEventCleanup: (() => void) | null = null;

  // Setup IPC listeners
  const setupListeners = () => {
    // Listen for connection status changes
    statusChangeCleanup = chat.onStatusChange((status: string, error?: string, errorCode?: string) => {
      updateConnectionStatus(status as ConnectionStatus, error, errorCode as ConnectionErrorCode);
    });

    // Listen for stream events
    streamEventCleanup = chat.onStreamEvent((streamId: string, event: unknown) => {
      const callback = streamCallbacks.get(streamId);
      if (callback) {
        callback(event as StreamEvent);

        // Clean up on done or error
        const streamEvent = event as StreamEvent;
        if (streamEvent.type === 'done' || streamEvent.type === 'error') {
          streamCallbacks.delete(streamId);
        }
      }
    });
  };

  // Setup listeners immediately
  setupListeners();

  return {
    async connect() {
      updateConnectionStatus('connecting');

      try {
        const result = await chat.connect();
        if (result.success) {
          updateConnectionStatus('connected');
        } else {
          throw new Error(result.error || 'Connection failed');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        updateConnectionStatus('error', errorMessage, 'CONNECTION_FAILED');
        throw error;
      }
    },

    async disconnect() {
      try {
        await chat.disconnect();
        updateConnectionStatus('disconnected');
      } catch (error) {
        console.error('Disconnect failed:', error);
      }
    },

    isConnected() {
      return connectionStatus === 'connected';
    },

    getConnectionStatus() {
      return connectionStatus;
    },

    onConnectionChange(callback) {
      connectionListeners.add(callback);
      // Immediately call with current status
      callback(connectionStatus, connectionError, connectionErrorCode);
      return () => connectionListeners.delete(callback);
    },

    async listConversations(options) {
      try {
        const result = await chat.listConversations({
          limit: options?.limit,
          offset: options?.offset,
          agentId: config.agentType || 'assistant',
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to list conversations');
        }

        // Map SDK fields (snake_case) to chat-ui fields (camelCase)
        const data = result.data as {
          conversations: Array<{
            conversation_id: string;
            title?: string;
            created_at?: string;
            updated_at?: string;
            message_count?: number;
          }>;
          total: number;
        };

        return {
          conversations: data.conversations.map(c => ({
            id: c.conversation_id,
            title: c.title || 'Untitled',
            createdAt: c.created_at || '',
            updatedAt: c.updated_at || '',
            messageCount: c.message_count || 0,
          })),
          total: data.total,
        };
      } catch (error) {
        throw error instanceof Error ? error : new Error('Failed to list conversations');
      }
    },

    async getConversation(conversationId, options) {
      try {
        const result = await chat.getConversation({
          conversationId,
          messageLimit: options?.messageLimit,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to get conversation');
        }

        // Map SDK fields (snake_case) to chat-ui fields (camelCase)
        const data = result.data as {
          conversation_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
          message_count?: number;
          messages?: ApiMessage[];
        };

        // Merge consecutive assistant messages
        const mergedMessages = data.messages ? mergeConsecutiveAssistantMessages(data.messages) : [];

        return {
          id: data.conversation_id,
          title: data.title || 'Untitled',
          createdAt: data.created_at || '',
          updatedAt: data.updated_at || '',
          messageCount: data.message_count || 0,
          messages: mergedMessages,
        };
      } catch (error) {
        throw error instanceof Error ? error : new Error('Failed to get conversation');
      }
    },

    async deleteConversation(conversationId) {
      try {
        const result = await chat.deleteConversation({ conversationId });

        if (!result.success) {
          throw new Error(result.error || 'Failed to delete conversation');
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error('Failed to delete conversation');
      }
    },

    async chatStream(messages: SendMessage[], conversationId: string | undefined, onEvent: (event: StreamEvent) => void) {
      const streamId = crypto.randomUUID();

      // Register callback
      streamCallbacks.set(streamId, onEvent);

      try {
        // Start streaming (fire and forget, events come via IPC listener)
        await chat.stream({
          streamId,
          messages,
          conversationId,
          agentId: config.agentType || 'assistant',
        });

        return {
          cancel: async () => {
            try {
              await chat.cancelStream({ streamId });
              streamCallbacks.delete(streamId);
            } catch (error) {
              console.error('Failed to cancel stream:', error);
            }
          },
        };
      } catch (error) {
        streamCallbacks.delete(streamId);
        throw error instanceof Error ? error : new Error('Failed to start chat stream');
      }
    },

    sendHitlResponse(response: HitlResponse, runId?: string) {
      chat.sendHitlResponse({ response, runId });
    },

    // Cleanup method to remove IPC listeners
    cleanup() {
      if (statusChangeCleanup) {
        statusChangeCleanup();
        statusChangeCleanup = null;
      }
      if (streamEventCleanup) {
        streamEventCleanup();
        streamEventCleanup = null;
      }
      connectionListeners.clear();
      streamCallbacks.clear();
    },
  };
}
