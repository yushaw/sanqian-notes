/**
 * Sanqian Adapter
 *
 * Connects to Sanqian backend via Chrome extension messaging.
 * The background script handles actual HTTP/WebSocket communication.
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
import type { ChatAdapter, AdapterConfig } from './types';

// =============================================================================
// Message Processing Helpers
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

export interface SanqianAdapterConfig extends AdapterConfig {
  /** Chrome runtime port for messaging */
  port?: chrome.runtime.Port;
  /** Get or create port (for reconnection) */
  getPort?: () => chrome.runtime.Port;
  /** Agent ID for filtering conversations (default: 'browser') */
  agentId?: string;
}

/**
 * Create a Sanqian adapter that communicates via Chrome extension messaging
 */
export function createSanqianAdapter(config: SanqianAdapterConfig = {}): ChatAdapter {
  let port: chrome.runtime.Port | null = config.port || null;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let connectionError: string | undefined;
  let connectionErrorCode: ConnectionErrorCode | undefined;
  const connectionListeners = new Set<
    (status: ConnectionStatus, error?: string, errorCode?: ConnectionErrorCode) => void
  >();
  const streamCallbacks = new Map<string, (event: StreamEvent) => void>();

  // Update connection status and notify listeners
  const updateConnectionStatus = (status: ConnectionStatus, error?: string, errorCode?: ConnectionErrorCode) => {
    connectionStatus = status;
    connectionError = error;
    connectionErrorCode = errorCode;
    connectionListeners.forEach(cb => cb(status, error, errorCode));
  };

  // Setup message listener on port
  const setupPortListener = (p: chrome.runtime.Port) => {
    p.onMessage.addListener((message: Record<string, unknown>) => {
      // Handle Sanqian connection status updates
      if (message.type === 'sanqian_status') {
        const status = message.status as ConnectionStatus;
        const error = message.error as string | undefined;
        const errorCode = message.errorCode as ConnectionErrorCode | undefined;
        updateConnectionStatus(status, error, errorCode);
      }

      // Handle chat stream events
      if (message.type === 'sanqian_chat_stream') {
        const streamId = message.streamId as string;
        const callback = streamCallbacks.get(streamId);
        if (callback && message.event) {
          callback(message.event as StreamEvent);

          // Clean up on done or error
          const event = message.event as StreamEvent;
          if (event.type === 'done' || event.type === 'error') {
            streamCallbacks.delete(streamId);
          }
        }
      }

      // Handle chat done
      if (message.type === 'sanqian_chat_done') {
        const streamId = message.streamId as string;
        const callback = streamCallbacks.get(streamId);
        if (callback) {
          callback({
            type: 'done',
            conversationId: message.conversationId as string,
            title: message.title as string | undefined,
          });
          streamCallbacks.delete(streamId);
        }
      }

      // Handle chat error
      if (message.type === 'sanqian_chat_error') {
        const streamId = message.streamId as string;
        const callback = streamCallbacks.get(streamId);
        if (callback) {
          callback({
            type: 'error',
            error: message.error as string,
          });
          streamCallbacks.delete(streamId);
        }
      }

      // Handle HITL interrupt
      if (message.type === 'sanqian_chat_interrupt') {
        const streamId = message.streamId as string;
        const callback = streamCallbacks.get(streamId);
        if (callback) {
          const interruptPayload = message.interrupt_payload as StreamHitlInterruptPayload;
          callback({
            type: 'interrupt',
            interrupt_type: message.interrupt_type as string,
            interrupt_payload: interruptPayload,
            run_id: message.run_id as string | undefined,
          });
          // Don't delete callback - we still need it for the response
        }
      }

      // Handle conversation list response
      if (message.type === 'sanqian_conversations_list') {
        // Handled via promise resolution
      }

      // Handle conversation detail response
      if (message.type === 'sanqian_conversation_detail') {
        // Handled via promise resolution
      }
    });

    p.onDisconnect.addListener(() => {
      port = null;
      updateConnectionStatus('disconnected');

      // Notify all pending stream callbacks of disconnection
      streamCallbacks.forEach(callback => {
        callback({ type: 'error', error: 'Connection lost' });
      });
      streamCallbacks.clear();
    });
  };

  // Get or create port
  const ensurePort = (): chrome.runtime.Port => {
    if (port) return port;

    if (config.getPort) {
      port = config.getPort();
    } else {
      port = chrome.runtime.connect({ name: 'chat-ui-connection' });
    }

    setupPortListener(port);
    return port;
  };

  return {
    async connect() {
      updateConnectionStatus('connecting');

      try {
        const p = ensurePort();

        // Request Sanqian connection from background
        p.postMessage({ type: 'sanqian_connect' });

        // Wait for connection status (with timeout)
        // Increased timeout to 30s for latest Sanqian which may take longer to start
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, config.timeout || 30000);

          const unsubscribe = this.onConnectionChange(status => {
            if (status === 'connected') {
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            } else if (status === 'error') {
              clearTimeout(timeout);
              unsubscribe();
              reject(new Error(connectionError || 'Connection failed'));
            }
          });
        });
      } catch (error) {
        updateConnectionStatus('error', error instanceof Error ? error.message : 'Unknown error');
        throw error;
      }
    },

    async disconnect() {
      if (port) {
        port.postMessage({ type: 'sanqian_disconnect' });
        port.disconnect();
        port = null;
      }
      updateConnectionStatus('disconnected');
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
      const p = ensurePort();

      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const handler = (message: Record<string, unknown>) => {
          if (message.type === 'sanqian_conversations_list' && message.requestId === requestId) {
            p.onMessage.removeListener(handler);
            if (message.error) {
              reject(new Error(message.error as string));
            } else {
              // Map SDK fields (snake_case) to chat-ui fields (camelCase)
              const data = message.data as {
                conversations: Array<{
                  conversation_id: string;
                  title?: string;
                  created_at?: string;
                  updated_at?: string;
                  message_count?: number;
                }>;
                total: number;
              };
              const mapped: { conversations: ConversationInfo[]; total: number } = {
                conversations: data.conversations.map(c => ({
                  id: c.conversation_id,
                  title: c.title || 'Untitled',
                  createdAt: c.created_at || '',
                  updatedAt: c.updated_at || '',
                  messageCount: c.message_count || 0,
                })),
                total: data.total,
              };
              resolve(mapped);
            }
          }
        };

        p.onMessage.addListener(handler);
        p.postMessage({
          type: 'sanqian_list_conversations',
          requestId,
          limit: options?.limit,
          offset: options?.offset,
          agentId: config.agentId || 'browser',
        });

        // Timeout
        setTimeout(() => {
          p.onMessage.removeListener(handler);
          reject(new Error('Request timeout'));
        }, 10000);
      });
    },

    async getConversation(conversationId, options) {
      const p = ensurePort();

      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const handler = (message: Record<string, unknown>) => {
          if (message.type === 'sanqian_conversation_detail' && message.requestId === requestId) {
            p.onMessage.removeListener(handler);
            if (message.error) {
              reject(new Error(message.error as string));
            } else {
              // Map SDK fields (snake_case) to chat-ui fields (camelCase)
              const data = message.data as {
                conversation_id: string;
                title?: string;
                created_at?: string;
                updated_at?: string;
                message_count?: number;
                messages?: ApiMessage[];
              };

              // Merge consecutive assistant messages
              const mergedMessages = data.messages ? mergeConsecutiveAssistantMessages(data.messages) : [];

              const mapped: ConversationDetail = {
                id: data.conversation_id,
                title: data.title || 'Untitled',
                createdAt: data.created_at || '',
                updatedAt: data.updated_at || '',
                messageCount: data.message_count || 0,
                messages: mergedMessages,
              };
              resolve(mapped);
            }
          }
        };

        p.onMessage.addListener(handler);
        p.postMessage({
          type: 'sanqian_get_conversation',
          requestId,
          conversationId,
          messageLimit: options?.messageLimit,
        });

        // Timeout
        setTimeout(() => {
          p.onMessage.removeListener(handler);
          reject(new Error('Request timeout'));
        }, 10000);
      });
    },

    async deleteConversation(conversationId) {
      const p = ensurePort();

      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const handler = (message: Record<string, unknown>) => {
          if (message.type === 'sanqian_conversation_deleted' && message.requestId === requestId) {
            p.onMessage.removeListener(handler);
            if (message.error) {
              reject(new Error(message.error as string));
            } else {
              resolve();
            }
          }
        };

        p.onMessage.addListener(handler);
        p.postMessage({
          type: 'sanqian_delete_conversation',
          requestId,
          conversationId,
        });

        // Timeout
        setTimeout(() => {
          p.onMessage.removeListener(handler);
          reject(new Error('Request timeout'));
        }, 10000);
      });
    },

    async chatStream(messages, conversationId, onEvent) {
      const p = ensurePort();
      const streamId = crypto.randomUUID();

      // Register callback
      streamCallbacks.set(streamId, onEvent);

      // Send chat request
      p.postMessage({
        type: 'sanqian_chat',
        streamId,
        messages,
        conversationId,
      });

      return {
        cancel: () => {
          p.postMessage({
            type: 'sanqian_chat_cancel',
            streamId,
          });
          streamCallbacks.delete(streamId);
        },
      };
    },

    sendHitlResponse(response: HitlResponse, runId?: string) {
      const p = ensurePort();
      p.postMessage({
        type: 'sanqian_hitl_response',
        response,
        runId,
      });
    },
  };
}
