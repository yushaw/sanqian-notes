/**
 * Chat Adapter Interface
 *
 * Adapters bridge the chat UI with different backends (Sanqian, OpenAI, etc.)
 */

import type {
  ConversationInfo,
  ConversationDetail,
  StreamEvent,
  ConnectionStatus,
  ConnectionErrorCode,
  HitlResponse,
} from '../core/types';

/** Message to send (simplified for API) */
export interface SendMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Adapter interface for chat backends */
export interface ChatAdapter {
  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /** Connect to the backend */
  connect(): Promise<void>;

  /** Disconnect from the backend */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Get current connection status */
  getConnectionStatus(): ConnectionStatus;

  /** Subscribe to connection status changes */
  onConnectionChange(
    callback: (status: ConnectionStatus, error?: string, errorCode?: ConnectionErrorCode) => void,
  ): () => void;

  // ===========================================================================
  // Conversation Management
  // ===========================================================================

  /** List conversations */
  listConversations(options?: {
    limit?: number;
    offset?: number;
  }): Promise<{ conversations: ConversationInfo[]; total: number }>;

  /** Get conversation with messages */
  getConversation(conversationId: string, options?: { messageLimit?: number }): Promise<ConversationDetail>;

  /** Delete a conversation */
  deleteConversation(conversationId: string): Promise<void>;

  // ===========================================================================
  // Chat
  // ===========================================================================

  /**
   * Send messages and stream the response
   *
   * @param messages - Messages to send (including history for context)
   * @param conversationId - Optional conversation ID to continue
   * @param onEvent - Callback for stream events
   * @returns Cancel function to abort the stream
   */
  chatStream(
    messages: SendMessage[],
    conversationId: string | undefined,
    onEvent: (event: StreamEvent) => void,
  ): Promise<{ cancel: () => void }>;

  /**
   * Send messages and get a complete response (non-streaming)
   * Optional - adapters may not implement this
   */
  chat?(
    messages: SendMessage[],
    conversationId?: string,
  ): Promise<{ content: string; conversationId: string; title?: string }>;

  // ===========================================================================
  // HITL (Human-in-the-Loop)
  // ===========================================================================

  /**
   * Send HITL response to backend
   * Optional - only needed for adapters that support HITL
   */
  sendHitlResponse?(response: HitlResponse, runId?: string): void;

  // ===========================================================================
  // Lifecycle Management
  // ===========================================================================

  /**
   * Cleanup adapter resources (event listeners, connections, etc.)
   * Optional - should be called when adapter is no longer needed
   */
  cleanup?(): void;
}

/** Configuration for creating an adapter */
export interface AdapterConfig {
  /** API base URL */
  baseUrl?: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in milliseconds */
  reconnectInterval?: number;
}
