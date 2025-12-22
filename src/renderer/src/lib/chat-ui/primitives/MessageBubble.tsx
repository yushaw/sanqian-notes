/**
 * MessageBubble Primitive
 *
 * Unstyled message bubble component - style with className or wrapper
 */

import { memo, type ReactNode } from 'react';
import type { ChatMessage } from '../core/types';

export interface MessageBubbleProps {
  /** The message to display */
  message: ChatMessage;
  /** Additional class names */
  className?: string;
  /** Children (for tool calls, actions, etc.) */
  children?: ReactNode;
  /** Custom content renderer */
  renderContent?: (content: string, isStreaming: boolean) => ReactNode;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  className = '',
  children,
  renderContent,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming ?? false;

  return (
    <div
      className={className}
      data-role={message.role}
      data-streaming={isStreaming}
      aria-label={`Message from ${message.role}`}>
      {/* Content */}
      <div className="message-content">
        {renderContent ? (
          renderContent(message.content, isStreaming)
        ) : (
          <>
            {message.content}
            {isStreaming && <span className="streaming-cursor">▌</span>}
          </>
        )}
      </div>

      {/* Children (tool calls, etc.) */}
      {children}
    </div>
  );
});

// Re-export for convenience
export type { ChatMessage };
