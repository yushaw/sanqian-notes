/**
 * MessageList Primitive
 *
 * Container for message bubbles with bottom-aligned layout.
 * Uses flex-col-reverse to align messages to bottom (like chat apps).
 * Auto-scrolls to bottom only when user is already near bottom.
 */

import { memo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { ChatMessage } from '../core/types';

/** Threshold in pixels - if user is within this distance from bottom, auto-scroll */
const SCROLL_THRESHOLD = 100;

export interface MessageListProps {
  /** Messages to display */
  messages: ChatMessage[];
  /** Additional class names */
  className?: string;
  /** Render function for each message */
  renderMessage: (message: ChatMessage, index: number) => ReactNode;
  /** Enable auto-scroll to bottom on new messages (only when near bottom) */
  autoScroll?: boolean;
  /** Scroll behavior */
  scrollBehavior?: ScrollBehavior;
}

export const MessageList = memo(function MessageList({
  messages,
  className = '',
  renderMessage,
  autoScroll = true,
  scrollBehavior = 'smooth',
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Track if user is near bottom of the scroll container
  const isNearBottomRef = useRef(true);

  // With flex-col-reverse, "bottom" of messages is at scrollTop = 0
  // Check if scroll position is near bottom (scrollTop near 0)
  const checkIfNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    // In flex-col-reverse, scrollTop = 0 means we're at the bottom (newest messages)
    // scrollTop increases as we scroll up (to older messages)
    return container.scrollTop <= SCROLL_THRESHOLD;
  }, []);

  // Update isNearBottom on scroll
  const handleScroll = useCallback(() => {
    isNearBottomRef.current = checkIfNearBottom();
  }, [checkIfNearBottom]);

  // Scroll to bottom (scrollTop = 0 in flex-col-reverse)
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = scrollBehavior) => {
      const container = containerRef.current;
      if (!container) return;

      container.scrollTo({
        top: 0,
        behavior,
      });
    },
    [scrollBehavior],
  );

  // Auto-scroll when messages change, but only if user is near bottom
  useEffect(() => {
    if (autoScroll && isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, autoScroll, scrollToBottom]);

  // Scroll to bottom on initial mount
  useEffect(() => {
    // Initial scroll should be instant
    scrollToBottom('instant');
    // Mark as near bottom after initial scroll
    isNearBottomRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={`${className} flex flex-col-reverse`}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      onScroll={handleScroll}>
      {/* Wrapper div to maintain correct visual order within flex-col-reverse */}
      <div className="flex flex-col">{messages.map((message, index) => renderMessage(message, index))}</div>
    </div>
  );
});
