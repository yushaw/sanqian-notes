/**
 * @extension/chat-ui
 *
 * Modular Chat UI SDK for Sanqian integration
 *
 * @example Basic usage with CompactChat
 * ```tsx
 * import { CompactChat, createSanqianAdapter } from '@extension/chat-ui';
 *
 * const adapter = createSanqianAdapter();
 *
 * function App() {
 *   return <CompactChat adapter={adapter} />;
 * }
 * ```
 *
 * @example Custom composition with primitives
 * ```tsx
 * import {
 *   useChat,
 *   useConnection,
 *   MessageList,
 *   MessageBubble,
 *   ChatInput,
 *   createSanqianAdapter
 * } from '@extension/chat-ui';
 *
 * const adapter = createSanqianAdapter();
 *
 * function CustomChat() {
 *   const connection = useConnection({ adapter });
 *   const chat = useChat({ adapter });
 *
 *   return (
 *     <div>
 *       <MessageList
 *         messages={chat.messages}
 *         renderMessage={(msg) => <MessageBubble message={msg} />}
 *       />
 *       <ChatInput onSend={chat.sendMessage} />
 *     </div>
 *   );
 * }
 * ```
 */

// Core types
export * from './core';

// Adapters
export * from './adapters';

// Hooks
export * from './hooks';

// Primitives (unstyled components)
// Note: ConnectionStatus component renamed to avoid conflict with ConnectionStatus type
export {
  MessageList,
  type MessageListProps,
  MessageBubble,
  type MessageBubbleProps,
  ChatInput,
  type ChatInputProps,
  ToolCallBadge,
  type ToolCallBadgeProps,
  ConnectionStatus as ConnectionStatusBar,
  type ConnectionStatusProps,
  AlertBanner,
  type AlertBannerProps,
  type AlertType,
  type AlertAction,
} from './primitives';

// Renderers (content display)
export * from './renderers';

// Components (pre-styled)
export * from './components';
