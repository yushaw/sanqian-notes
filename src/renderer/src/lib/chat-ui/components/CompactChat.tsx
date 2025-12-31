/**
 * CompactChat Component
 *
 * Pre-styled compact chat panel for sidebars and popups
 * Based on docs/compact-chat-design.md specification
 *
 * Display strategy (aligned with Sanqian):
 * - No tool calls → ThinkingSection + bubble
 * - Streaming with tool calls → StreamingTimeline + bubble
 * - Complete with tool calls → IntermediateSteps (collapsible) + bubble
 */

import { memo, useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../hooks/useChat';
import { useConnection } from '../hooks/useConnection';
import { useConversations } from '../hooks/useConversations';
import { MessageList } from '../primitives/MessageList';
import { MessageBubble } from '../primitives/MessageBubble';
import { ChatInput } from '../primitives/ChatInput';
import { AlertBanner, type AlertType, type AlertAction } from '../primitives/AlertBanner';
import { MarkdownRenderer } from '../renderers/MarkdownRenderer';
import { IntermediateSteps, StreamingTimeline, ThinkingSection } from './IntermediateSteps';
import { HistoryList } from './HistoryList';
import { HitlCard } from './HitlCard';
import type { ChatAdapter } from '../adapters/types';
import type { ChatMessage, ToolCall } from '../core/types';
import { SYSTEM_REMINDER_TAG } from '@/constants';

/** Alert configuration for displaying warnings/errors above input */
export interface AlertConfig {
  type: AlertType;
  message: string;
  action?: AlertAction;
  dismissible?: boolean;
}

export interface CompactChatProps {
  /** Chat adapter for backend communication */
  adapter: ChatAdapter;
  /** Input placeholder */
  placeholder?: string;
  /** Whether to auto-connect on mount */
  autoConnect?: boolean;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when a message is received (for session tracking) */
  onMessageReceived?: (message: ChatMessage) => void;
  /** Called when loading state changes */
  onLoadingChange?: (isLoading: boolean) => void;
  /** Called when chat state changes (messages, conversationId) */
  onStateChange?: (state: { messages: ChatMessage[]; conversationId: string | null }) => void;
  /** Header content (left side) */
  headerLeft?: ReactNode;
  /** Header content (right side) */
  headerRight?: ReactNode;
  /** Whether to hide header */
  hideHeader?: boolean;
  /** Whether to hide connection status bar */
  hideConnectionStatus?: boolean;
  /**
   * Whether to hide input area (for custom external input)
   * @deprecated Use `inputPortalContainer` instead for external input rendering
   */
  hideInput?: boolean;
  /**
   * Container element for rendering input via Portal.
   * When provided, input is rendered into this container, enabling separated layout.
   */
  inputPortalContainer?: HTMLElement | null;
  /** Ref to expose sendMessage function for external input */
  sendMessageRef?: React.MutableRefObject<((message: string) => void) | null>;
  /** Ref to expose newConversation function */
  newConversationRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref to expose focusInput function */
  focusInputRef?: React.MutableRefObject<(() => void) | null>;
  /** Ref to expose setText function (for filling input externally) */
  setTextRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** Custom message renderer */
  renderMessage?: (message: ChatMessage) => ReactNode;
  /** Custom tool call renderer (for future use) */
  _renderToolCall?: (toolCall: ToolCall) => ReactNode;
  /** Empty state content (when no messages) */
  emptyState?: ReactNode;
  /** Additional class name */
  className?: string;
  /** Dark mode */
  isDarkMode?: boolean;
  /** Localized strings */
  strings?: {
    steps?: string;
    executing?: string;
    thinking?: string;
    // History related
    chat?: string;
    selectConversation?: string;
    recentChats?: string;
    newChat?: string;
    noHistory?: string;
    loadMore?: string;
    today?: string;
    yesterday?: string;
    delete?: string;
    // Alert related
    dismiss?: string;
    // HITL related
    hitlApprove?: string;
    hitlReject?: string;
    hitlSubmit?: string;
    hitlCancel?: string;
    hitlRememberChoice?: string;
    hitlRequiredField?: string;
    hitlTimeoutIn?: string;
    hitlSeconds?: string;
  };
  /** Custom alert to display above input (overrides default connection/error alerts) */
  alert?: AlertConfig | null;
  /** Callback when alert is dismissed */
  onAlertDismiss?: () => void;
  /** Function to get error message from error code (for i18n) */
  getErrorMessage?: (errorCode: string) => string;
}

export const CompactChat = memo(function CompactChat({
  adapter,
  placeholder = 'Message...',
  autoConnect = true,
  onError,
  onMessageReceived,
  onLoadingChange,
  onStateChange,
  headerLeft,
  headerRight,
  hideHeader = false,
  hideConnectionStatus: _hideConnectionStatus = false,
  hideInput = false,
  inputPortalContainer,
  sendMessageRef,
  newConversationRef,
  focusInputRef: parentFocusInputRef,
  setTextRef: parentSetTextRef,
  renderMessage,
  // _renderToolCall - reserved for future custom tool call rendering
  emptyState,
  className = '',
  isDarkMode = false,
  strings = {},
  alert,
  onAlertDismiss,
  getErrorMessage,
}: CompactChatProps) {
  const setTextRef = useRef<((text: string) => void) | null>(null);
  const focusInputRef = useRef<(() => void) | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Internal connection error alert (auto-managed by SDK)
  const [connectionAlert, setConnectionAlert] = useState<AlertConfig | null>(null);

  // Determine if input should be rendered externally via portal
  // Use a ref to store this to avoid re-rendering when container changes
  const portalContainerRef = useRef<HTMLElement | null>(inputPortalContainer ?? null);
  portalContainerRef.current = inputPortalContainer ?? null;
  const shouldRenderInputExternally = !!inputPortalContainer;

  // Connection state
  const connection = useConnection({
    adapter,
    autoConnect,
    onStatusChange: (status, error, errorCode) => {
      if (status === 'connected') {
        // Auto-dismiss connection alert when reconnected
        setConnectionAlert(null);
        // Focus input when connected (especially important for side panels)
        setTimeout(() => {
          focusInputRef.current?.();
        }, 150);
      } else if (status === 'error' && errorCode) {
        // Use error code to get localized message if available
        const message = getErrorMessage?.(errorCode) || error || 'Connection error';
        setConnectionAlert({
          type: 'warning',
          message,
          dismissible: true,
        });
        // Also notify parent for logging/tracking purposes
        onError?.(new Error(message));
      }
    },
  });

  // Chat state
  const chat = useChat({
    adapter,
    onError,
  });

  // Conversations (history) state
  const conversations = useConversations({
    adapter,
    onError,
  });

  // Expose sendMessage to parent via ref
  useEffect(() => {
    if (sendMessageRef) {
      sendMessageRef.current = chat.sendMessage;
    }
  }, [sendMessageRef, chat.sendMessage]);

  // Expose newConversation to parent via ref
  useEffect(() => {
    if (newConversationRef) {
      newConversationRef.current = chat.newConversation;
    }
  }, [newConversationRef, chat.newConversation]);

  // Expose focusInput to parent via ref
  useEffect(() => {
    if (parentFocusInputRef) {
      parentFocusInputRef.current = () => focusInputRef.current?.();
    }
  }, [parentFocusInputRef]);

  // Expose setText to parent via ref
  useEffect(() => {
    if (parentSetTextRef) {
      parentSetTextRef.current = (text: string) => setTextRef.current?.(text);
    }
  }, [parentSetTextRef]);

  // Notify parent when messages change (for session tracking)
  useEffect(() => {
    if (onMessageReceived && chat.messages.length > 0) {
      const lastMessage = chat.messages[chat.messages.length - 1];
      if (lastMessage.role === 'assistant' && !lastMessage.isStreaming) {
        onMessageReceived(lastMessage);
      }
    }
  }, [chat.messages, onMessageReceived]);

  // Notify parent when loading state changes
  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(chat.isLoading);
    }
  }, [chat.isLoading, onLoadingChange]);

  // Notify parent when chat state changes (messages or conversationId)
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        messages: chat.messages,
        conversationId: chat.conversationId,
      });
    }
  }, [chat.messages, chat.conversationId, onStateChange]);

  // Load conversations when showing history
  useEffect(() => {
    if (showHistory && connection.isConnected) {
      conversations.loadConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, connection.isConnected]);

  // Handle selecting a conversation from history
  const handleSelectConversation = useCallback(
    async (id: string) => {
      await chat.loadConversation(id);
      setShowHistory(false);
    },
    [chat],
  );

  // Handle deleting a conversation
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await conversations.deleteConversation(id);
      // If deleted the current conversation, start new
      if (id === chat.conversationId) {
        chat.newConversation();
      }
    },
    [conversations, chat],
  );

  // Handle new chat
  const handleNewChat = useCallback(() => {
    chat.newConversation();
    setShowHistory(false);
    // Focus input after creating new conversation
    setTimeout(() => {
      focusInputRef.current?.();
    }, 0);
  }, [chat]);

  // Base classes - use theme variables
  const baseClasses = 'bg-app-bg text-app-text';
  const borderClasses = 'border-app-border';

  // Default message renderer with Sanqian-style display strategy
  const defaultRenderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';
    const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

    // Determine display strategy
    const hasIntermediateBlocks = message.blocks && message.blocks.some(b => b.isIntermediate);
    const showIntermediateSteps = message.isComplete && hasIntermediateBlocks && hasToolCalls;
    const showStreamingTimeline = !isUser && !showIntermediateSteps && hasToolCalls && !message.isComplete;
    const hasThinking = message.thinking || message.isThinkingStreaming;
    const showThinkingSection = !isUser && !hasToolCalls && !showIntermediateSteps && hasThinking;

    // Check if there's any tool currently running
    const isToolCallsStreaming = message.toolCalls?.some(tc => tc.status === 'running') ?? false;

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
        <div className={`${isUser ? 'max-w-[85%] text-right' : 'w-full text-left'}`}>
          {/* IntermediateSteps: for completed messages with tool calls */}
          {!isUser && showIntermediateSteps && message.blocks && (
            <IntermediateSteps blocks={message.blocks} strings={strings} />
          )}

          {/* ThinkingSection: for simple conversations without tool calls */}
          {showThinkingSection && (
            <ThinkingSection
              thinking={message.thinking || ''}
              currentThinking={message.currentThinking}
              isStreaming={message.isThinkingStreaming}
              isComplete={message.isComplete}
              strings={strings}
            />
          )}

          {/* StreamingTimeline: for streaming with tool calls */}
          {showStreamingTimeline && message.blocks && (
            <StreamingTimeline
              blocks={message.blocks}
              currentThinking={message.currentThinking}
              isThinkingStreaming={message.isThinkingStreaming}
              isToolCallsStreaming={isToolCallsStreaming}
              isComplete={message.isComplete}
              strings={strings}
            />
          )}

          {/* Message bubble */}
          <div
            className={`rounded-2xl px-3.5 py-2 ${isUser
              ? 'bg-chat-bubble-user text-chat-bubble-user'
              : 'bg-chat-bubble-assistant text-chat-bubble-assistant'
              }`}>
            <MessageBubble
              message={message}
              className="text-sm leading-relaxed"
              renderContent={(content, streaming) =>
                isUser ? (
                  // User messages: plain text (strip injected system reminders)
                  <span className="whitespace-pre-wrap">{stripSystemReminder(content)}</span>
                ) : (
                  // Assistant messages: markdown with streaming support
                  <MarkdownRenderer content={content} isStreaming={streaming} className="text-sm" />
                )
              }
            />

            {/* Timestamp */}
            <div className={`text-chat-muted mt-1 text-[10px] opacity-40 ${isUser ? 'text-right' : 'text-left'}`}>
              {formatTime(message.timestamp)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`flex h-full flex-col ${baseClasses} ${className}`}>
      {/* Header */}
      {!hideHeader && (
        <header className="flex h-10 items-center justify-between px-3">
          <div className="flex items-center gap-1">
            {showHistory && (
              <button
                onClick={() => setShowHistory(false)}
                className="rounded-lg p-1.5 hover:bg-app-surface text-app-muted hover:text-app-text transition-colors"
                title="Back">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {headerLeft || (
              <span className="text-sm font-medium text-app-text">
                {showHistory ? strings.recentChats || 'Recent Chats' : strings.chat || 'Chat'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {/* New chat button */}
            <button
              onClick={handleNewChat}
              className="rounded-lg p-1.5 hover:bg-app-surface text-app-muted hover:text-app-text transition-colors"
              title={strings.newChat || 'New Chat'}>
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* History button - only show when not in history view */}
            {!showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="rounded-lg p-1.5 hover:bg-app-surface text-app-muted hover:text-app-text transition-colors"
                title={strings.recentChats || 'Recent Chats'}>
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {headerRight}
          </div>
        </header>
      )}

      {/* Connection status bar - Hidden to avoid duplication with AlertBanner below */}

      {/* Content: History or Message list */}
      {showHistory ? (
        <div className="flex-1 overflow-y-auto px-3 pt-3">
          <HistoryList
            conversations={conversations.conversations}
            selectedId={chat.conversationId}
            isLoading={conversations.isLoading}
            hasMore={conversations.hasMore}
            onSelect={handleSelectConversation}
            onDelete={handleDeleteConversation}
            onLoadMore={conversations.loadMore}
            isDarkMode={isDarkMode}
            strings={{
              noHistory: strings.noHistory,
              loadMore: strings.loadMore,
              today: strings.today,
              yesterday: strings.yesterday,
              delete: strings.delete,
            }}
          />
        </div>
      ) : chat.messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">{emptyState}</div>
      ) : (
        <MessageList
          messages={chat.messages}
          className="flex-1 overflow-y-auto p-3"
          renderMessage={renderMessage || defaultRenderMessage}
        />
      )}

      {/* Input area - render via portal if inputPortalContainer provided, otherwise inline */}
      {(() => {
        // Don't render if explicitly hidden and no portal container
        if (hideInput && !shouldRenderInputExternally) return null;

        // For portal mode: only render ChatInput (no alerts/HITL in external container)
        const inputElement = (
          <ChatInput
            onSend={chat.sendMessage}
            onStop={chat.stopStreaming}
            placeholder={showHistory ? (strings.selectConversation || 'Select a conversation to continue...') : placeholder}
            disabled={showHistory || chat.isLoading}
            isStreaming={chat.isStreaming}
            isLoading={chat.isLoading}
            setTextRef={setTextRef}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={!showHistory}
            focusRef={focusInputRef}
            className={`flex ${shouldRenderInputExternally ? 'items-center h-10' : 'items-end py-2'} gap-2 ${shouldRenderInputExternally ? '' : `rounded-2xl border ${borderClasses}`} bg-app-bg px-3 ${showHistory ? 'opacity-50' : ''}`}
            textareaClassName={`flex-1 resize-none bg-transparent text-sm leading-normal focus:outline-none ${shouldRenderInputExternally ? 'py-2.5' : 'py-2'} max-h-[120px] text-app-text placeholder:text-app-muted overflow-hidden`}
            sendButtonClassName="w-6 h-6 rounded-full flex items-center justify-center bg-app-accent text-white disabled:bg-app-border disabled:text-app-muted disabled:cursor-not-allowed text-xs"
            stopButtonClassName={`w-6 h-6 rounded-full flex items-center justify-center bg-red-500 text-white text-xs`}
            sendButtonContent={<span>↑</span>}
            stopButtonContent={<span>■</span>}
          />
        );

        // Portal mode: render only input into external container
        if (shouldRenderInputExternally && portalContainerRef.current) {
          return createPortal(inputElement, portalContainerRef.current);
        }

        // Normal mode: render with alerts and HITL
        return (
          <div className="flex flex-col gap-2 p-2">
            {/* Alert banner above input - only show when not in history view
                Priority: external alert > internal connectionAlert > chat.error */}
            {!showHistory && (
              <>
                {alert ? (
                  <AlertBanner
                    type={alert.type}
                    message={alert.message}
                    action={alert.action}
                    onDismiss={alert.dismissible ? onAlertDismiss : undefined}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${alert.type === 'error'
                      ? isDarkMode
                        ? 'bg-red-900/60 text-red-200'
                        : 'bg-red-100 text-red-800'
                      : isDarkMode
                        ? 'bg-amber-900/60 text-amber-200'
                        : 'bg-amber-100 text-amber-800'
                      }`}
                  />
                ) : connectionAlert ? (
                  /* Internal connection alert (auto-dismissed on reconnect) */
                  <AlertBanner
                    type={connectionAlert.type}
                    message={connectionAlert.message}
                    action={connectionAlert.action}
                    onDismiss={connectionAlert.dismissible ? () => setConnectionAlert(null) : undefined}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${connectionAlert.type === 'error'
                      ? isDarkMode
                        ? 'bg-red-900/60 text-red-200'
                        : 'bg-red-100 text-red-800'
                      : isDarkMode
                        ? 'bg-amber-900/60 text-amber-200'
                        : 'bg-amber-100 text-amber-800'
                      }`}
                  />
                ) : (
                  /* Default: show chat error if exists */
                  chat.error && (
                    <AlertBanner
                      type="error"
                      message={chat.error}
                      onDismiss={() => chat.setError(null)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${isDarkMode ? 'bg-red-900/60 text-red-200' : 'bg-red-100 text-red-800'
                        }`}
                    />
                  )
                )}

                {/* HITL Card - show when there's a pending interrupt */}
                {chat.pendingInterrupt && (
                  <HitlCard
                    interrupt={chat.pendingInterrupt}
                    onApprove={chat.approveHitl}
                    onReject={chat.rejectHitl}
                    onSubmit={chat.submitHitlInput}
                    onCancel={chat.cancelHitl}
                    isDarkMode={isDarkMode}
                    strings={{
                      approve: strings.hitlApprove,
                      reject: strings.hitlReject,
                      submit: strings.hitlSubmit,
                      cancel: strings.hitlCancel,
                      rememberChoice: strings.hitlRememberChoice,
                      requiredField: strings.hitlRequiredField,
                      timeoutIn: strings.hitlTimeoutIn,
                      seconds: strings.hitlSeconds,
                    }}
                  />
                )}
              </>
            )}

            {inputElement}
          </div>
        );
      })()}
    </div>
  );
});

// Helper to format timestamp
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Helper to strip system reminder tags from message content
function stripSystemReminder(content: string): string {
  const pattern = new RegExp(`<${SYSTEM_REMINDER_TAG}>[\\s\\S]*?</${SYSTEM_REMINDER_TAG}>`, 'gi');
  return content.replace(pattern, '').trim();
}
