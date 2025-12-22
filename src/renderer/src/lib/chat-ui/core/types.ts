/**
 * @extension/chat-ui Core Types
 *
 * Type definitions aligned with Sanqian SDK API
 */

// =============================================================================
// Stream Events (aligned with Sanqian backend)
// =============================================================================

/** Tool call event during streaming */
export interface ToolCallEvent {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** HITL interrupt payload in stream event */
export interface StreamHitlInterruptPayload {
  interrupt_type: 'approval_request' | 'user_input_request';
  // For approval_request
  tool?: string;
  args?: Record<string, unknown>;
  reason?: string;
  risk_level?: 'low' | 'medium' | 'high';
  // For user_input_request
  question?: string;
  context?: string;
  options?: string[];
  multi_select?: boolean;
  default?: string;
  required?: boolean;
  timeout?: number;
}

/** Stream event types from Sanqian backend */
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool_call: ToolCallEvent }
  | { type: 'tool_result'; tool_call_id: string; result: unknown }
  | { type: 'done'; conversationId: string; title?: string }
  | { type: 'error'; error: string; code?: string }
  | { type: 'interrupt'; interrupt_type: string; interrupt_payload: StreamHitlInterruptPayload; run_id?: string };

// =============================================================================
// Chat Messages
// =============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

/** Tool call attached to a message */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
}

/**
 * Message content block for structured rendering
 * Blocks are ordered by time sequence within a message
 * Used for showing intermediate steps (thinking → text → tool_call → tool_result)
 */
export interface MessageBlock {
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result';
  content: string;
  timestamp: number;
  /** For tool blocks */
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  toolStatus?: ToolCallStatus;
  /** Marks if this is intermediate content (before final response) */
  isIntermediate?: boolean;
}

/** Chat message */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  /** Thinking/reasoning content (for reasoning models like DeepSeek R1, Gemini 3) */
  thinking?: string;
  /** Current round thinking (reset after each tool call) */
  currentThinking?: string;
  /** Whether thinking content is currently streaming */
  isThinkingStreaming?: boolean;
  /** Content blocks for structured rendering (time-ordered sequence) */
  blocks?: MessageBlock[];
  /** Whether the message is complete (all streaming finished) */
  isComplete?: boolean;
}

// =============================================================================
// Conversations
// =============================================================================

/** Conversation summary (for list view) */
export interface ConversationInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Full conversation with messages */
export interface ConversationDetail extends ConversationInfo {
  messages: ChatMessage[];
}

// =============================================================================
// Connection
// =============================================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Connection error codes from backend */
export type ConnectionErrorCode =
  | 'NOT_FOUND' // Sanqian not running or not discoverable
  | 'CONNECTION_FAILED' // Failed to establish connection
  | 'WEBSOCKET_ERROR' // WebSocket connection error
  | 'AUTH_ERROR' // Authentication error
  | 'TIMEOUT' // Connection timeout
  | 'UNKNOWN'; // Unknown error

export interface ConnectionState {
  status: ConnectionStatus;
  error?: string;
  errorCode?: ConnectionErrorCode;
  apiUrl?: string;
}

// =============================================================================
// Chat State
// =============================================================================

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
}

// =============================================================================
// Context Providers (extensibility)
// =============================================================================

/** Context provider for injecting additional data into chat */
export interface ContextProvider {
  name: string;
  getData: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

// =============================================================================
// Tool Renderers (extensibility)
// =============================================================================

/** Custom renderer for tool calls */
export interface ToolRenderer {
  /** Tool name to match */
  name: string;
  /** React component to render the tool call */
  component: React.ComponentType<{ toolCall: ToolCall }>;
}

// =============================================================================
// HITL (Human-in-the-Loop)
// =============================================================================

/** HITL interrupt types */
export type HitlInterruptType = 'approval_request' | 'user_input_request';

/** Risk level for approval requests */
export type HitlRiskLevel = 'low' | 'medium' | 'high';

/** HITL interrupt data from backend */
export interface HitlInterruptData {
  interrupt_type: HitlInterruptType;
  // For approval_request
  tool?: string;
  args?: Record<string, unknown>;
  reason?: string;
  risk_level?: HitlRiskLevel;
  // For user_input_request
  question?: string;
  context?: string;
  options?: string[]; // List of options for single/multi-select
  multi_select?: boolean; // Allow multiple selections
  default?: string;
  required?: boolean;
  timeout?: number; // Timeout in seconds
}

/** HITL response sent back to backend */
export interface HitlResponse {
  // For approval_request
  approved?: boolean;
  remember?: boolean;
  // For user_input_request
  answer?: string;
  selected_indices?: number[];
  // Common
  cancelled?: boolean;
  timed_out?: boolean;
}
