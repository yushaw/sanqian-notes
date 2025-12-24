/**
 * ChatInput Primitive
 *
 * Composable input component for chat
 */

import { memo, useState, useRef, useCallback, useEffect, type KeyboardEvent, type FormEvent } from 'react';

export interface ChatInputProps {
  /** Called when user submits a message */
  onSend: (content: string) => void;
  /** Called when user wants to stop streaming */
  onStop?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether input is disabled */
  disabled?: boolean;
  /** Whether currently streaming (show stop button) */
  isStreaming?: boolean;
  /** Whether currently loading */
  isLoading?: boolean;
  /** Additional class names for the container */
  className?: string;
  /** Additional class names for the textarea */
  textareaClassName?: string;
  /** Additional class names for the send button */
  sendButtonClassName?: string;
  /** Additional class names for the stop button */
  stopButtonClassName?: string;
  /** Custom send button content */
  sendButtonContent?: React.ReactNode;
  /** Custom stop button content */
  stopButtonContent?: React.ReactNode;
  /** Max rows for textarea */
  maxRows?: number;
  /** Ref to set text externally */
  setTextRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** Whether to auto-focus the input on mount */
  autoFocus?: boolean;
  /** Ref to expose focus method for external control */
  focusRef?: React.MutableRefObject<(() => void) | null>;
}

export const ChatInput = memo(function ChatInput({
  onSend,
  onStop,
  placeholder = 'Type a message...',
  disabled = false,
  isStreaming = false,
  isLoading = false,
  className = '',
  textareaClassName = '',
  sendButtonClassName = '',
  stopButtonClassName = '',
  sendButtonContent = 'Send',
  stopButtonContent = 'Stop',
  maxRows: _maxRows = 5,
  setTextRef,
  autoFocus = false,
  focusRef,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 && !disabled && !isLoading;

  // Expose setText for external control
  useEffect(() => {
    if (setTextRef) {
      setTextRef.current = setText;
    }
  }, [setTextRef]);

  // Expose focus method for external control
  useEffect(() => {
    if (focusRef) {
      focusRef.current = () => {
        textareaRef.current?.focus();
      };
    }
  }, [focusRef]);

  // Auto-focus on mount
  useEffect(() => {
    if (!autoFocus || !textareaRef.current) {
      return;
    }

    // Multi-layered focus strategy for Chrome extension side panels
    // Refs: https://github.com/remusris/sidepanel-textarea-autofocus

    // Strategy 1: Initial focus with 100ms delay
    const timer1 = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);

    // Strategy 2: Retry with longer delay for slow renders
    const timer2 = setTimeout(() => {
      if (document.activeElement !== textareaRef.current) {
        textareaRef.current?.focus();
      }
    }, 300);

    // Strategy 3: Listen for visibility change (side panel becoming visible)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && textareaRef.current) {
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoFocus]);

  // Auto-resize textarea - only grow when needed
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const maxHeight = 120;

    // Reset to auto to measure content
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;

    // Apply height with max limit
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [text]);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (!canSend) return;

      onSend(text.trim());
      setText('');

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
    [text, canSend, onSend],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (without Shift), ignore if composing (IME)
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  return (
    <form onSubmit={handleSubmit} className={className}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={textareaClassName}
        aria-label="Message input"
      />

      {isStreaming ? (
        <button type="button" onClick={handleStop} className={stopButtonClassName} aria-label="Stop generating">
          {stopButtonContent}
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          className={sendButtonClassName}
          aria-label="Send message"
          aria-disabled={!canSend}>
          {sendButtonContent}
        </button>
      )}
    </form>
  );
});
