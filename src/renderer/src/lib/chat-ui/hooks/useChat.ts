/**
 * useChat Hook
 *
 * Core hook for managing chat state and interactions
 * Block management logic adapted from Sanqian's useSanqianChat
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, ToolCall, StreamEvent, MessageBlock, HitlInterruptData, HitlResponse } from '../core/types';
import type { ChatAdapter, SendMessage } from '../adapters/types';
import { TIMING } from '@/constants';

export interface UseChatOptions {
  /** Chat adapter for backend communication */
  adapter: ChatAdapter;
  /** Initial conversation ID to load */
  conversationId?: string;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when conversation changes (new ID or title) */
  onConversationChange?: (conversationId: string, title?: string) => void;
}

export interface UseChatReturn {
  // State
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  conversationId: string | null;
  conversationTitle: string | null;

  // HITL State
  pendingInterrupt: HitlInterruptData | null;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;
  setError: (error: string | null) => void;

  // HITL Actions
  approveHitl: (remember?: boolean) => void;
  rejectHitl: (remember?: boolean) => void;
  submitHitlInput: (response: HitlResponse) => void;
  cancelHitl: () => void;

  // Conversation management
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => void;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const { adapter, onError, onConversationChange } = options;

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(options.conversationId ?? null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);

  // HITL State
  const [pendingInterrupt, setPendingInterrupt] = useState<HitlInterruptData | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  // Refs for cleanup
  const cancelRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  // Ref to hold latest messages (avoid closure trap in sendMessage)
  const messagesRef = useRef<ChatMessage[]>(messages);
  const conversationIdRef = useRef<string | null>(conversationId);

  // ============================================================================
  // Block management refs (adapted from Sanqian's useSanqianChat)
  // ============================================================================

  // Track current message blocks for structured rendering
  const currentBlocksRef = useRef<MessageBlock[]>([]);
  // Track current text block index (for appending streamed content)
  const currentTextBlockIndexRef = useRef<number>(-1);
  // Track if next content stream should clear previous content (after tool call)
  const needsContentClearRef = useRef(false);
  // Track accumulated content
  const fullContentRef = useRef<string>('');

  // Typewriter effect refs for text (replaces batched update)
  const tokenQueueRef = useRef<string[]>([]);
  const displayedContentRef = useRef<string>('');
  const typewriterIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentAssistantMessageIdRef = useRef<string | null>(null);

  // Typewriter effect refs for thinking
  const thinkingQueueRef = useRef<string[]>([]);
  const displayedThinkingRef = useRef<string>('');
  const thinkingTypewriterRef = useRef<NodeJS.Timeout | null>(null);
  const fullThinkingRef = useRef<string>(''); // Full thinking content (for blocks)

  // Keep refs in sync with state (avoid closure trap)
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelRef.current?.();
      // Clear text typewriter timer
      if (typewriterIntervalRef.current) {
        clearTimeout(typewriterIntervalRef.current);
        typewriterIntervalRef.current = null;
      }
      tokenQueueRef.current = [];
      displayedContentRef.current = '';
      // Clear thinking typewriter timer
      if (thinkingTypewriterRef.current) {
        clearTimeout(thinkingTypewriterRef.current);
        thinkingTypewriterRef.current = null;
      }
      thinkingQueueRef.current = [];
      displayedThinkingRef.current = '';
    };
  }, []);

  // Load initial conversation if provided
  useEffect(() => {
    if (options.conversationId) {
      loadConversation(options.conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.conversationId]);

  // Flush text typewriter - stop animation and show all content immediately
  const flushTypewriter = useCallback(() => {
    // Stop typewriter timer
    if (typewriterIntervalRef.current) {
      clearTimeout(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }

    // If there's queued content, display it all immediately
    if (tokenQueueRef.current.length > 0 && currentAssistantMessageIdRef.current) {
      displayedContentRef.current += tokenQueueRef.current.join('');
      tokenQueueRef.current = [];

      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === currentAssistantMessageIdRef.current);
        if (idx === -1) return prev;

        const msg = prev[idx];
        const updated = [...prev];
        updated[idx] = {
          ...msg,
          content: displayedContentRef.current,
          isStreaming: true,
          blocks: [...currentBlocksRef.current],
        };
        return updated;
      });
    }
  }, []);

  // Flush thinking typewriter - stop animation and show all thinking content immediately
  const flushThinkingTypewriter = useCallback(() => {
    // Stop thinking typewriter timer
    if (thinkingTypewriterRef.current) {
      clearTimeout(thinkingTypewriterRef.current);
      thinkingTypewriterRef.current = null;
    }

    // If there's queued thinking content, display it all immediately
    if (thinkingQueueRef.current.length > 0 && currentAssistantMessageIdRef.current) {
      displayedThinkingRef.current += thinkingQueueRef.current.join('');
      thinkingQueueRef.current = [];

      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === currentAssistantMessageIdRef.current);
        if (idx === -1) return prev;

        const msg = prev[idx];
        const updated = [...prev];
        updated[idx] = {
          ...msg,
          currentThinking: displayedThinkingRef.current,
          isThinkingStreaming: true,
          blocks: [...currentBlocksRef.current],
        };
        return updated;
      });
    }
  }, []);

  // Handle stream events - builds blocks array using refs (like Sanqian)
  const handleStreamEvent = useCallback(
    (event: StreamEvent, assistantMessageId: string) => {
      if (!isMountedRef.current) return;

      // Store current assistant message ID for batched updates
      currentAssistantMessageIdRef.current = assistantMessageId;

      switch (event.type) {
        case 'text': {
          const content = event.content;
          if (!content) break;

          // Check if we need to clear content (after tool execution)
          const shouldClearContent = needsContentClearRef.current || fullContentRef.current === '';

          if (shouldClearContent) {
            // Flush any pending typewriter first
            flushTypewriter();

            needsContentClearRef.current = false;
            fullContentRef.current = '';
            displayedContentRef.current = '';

            // Mark previous text blocks as intermediate
            currentBlocksRef.current.forEach(block => {
              if (block.type === 'text') block.isIntermediate = true;
            });

            // Create new text block
            currentBlocksRef.current.push({
              type: 'text',
              content: '',
              timestamp: Date.now(),
              isIntermediate: false,
            });
            currentTextBlockIndexRef.current = currentBlocksRef.current.length - 1;
          }

          // Accumulate full content in refs (for final message)
          // Only trimStart on first chunk (when fullContentRef is empty)
          const textToAdd = fullContentRef.current === '' ? content.trimStart() : content;
          fullContentRef.current += textToAdd;
          if (
            currentTextBlockIndexRef.current >= 0 &&
            currentTextBlockIndexRef.current < currentBlocksRef.current.length
          ) {
            currentBlocksRef.current[currentTextBlockIndexRef.current].content += textToAdd;
          }

          // Queue characters for typewriter effect (use trimmed content)
          const chars = textToAdd.split('');
          tokenQueueRef.current.push(...chars);

          // Start typewriter interval if not already running
          if (!typewriterIntervalRef.current) {
            const typewriterTick = () => {
              const char = tokenQueueRef.current.shift();
              if (char !== undefined) {
                displayedContentRef.current += char;

                // Update the assistant message with displayed content
                setMessages(prev => {
                  const idx = prev.findIndex(m => m.id === assistantMessageId);
                  if (idx === -1) return prev;

                  const msg = prev[idx];
                  const updated = [...prev];
                  updated[idx] = {
                    ...msg,
                    content: displayedContentRef.current,
                    isStreaming: true,
                    blocks: [...currentBlocksRef.current],
                  };
                  return updated;
                });

                // Adaptive speed based on queue length
                const queueLength = tokenQueueRef.current.length;
                let delay: number;
                if (queueLength > TIMING.TYPEWRITER_THRESHOLDS.VERY_FAST) {
                  delay = TIMING.TYPEWRITER_DELAYS.VERY_FAST;
                } else if (queueLength > TIMING.TYPEWRITER_THRESHOLDS.FAST) {
                  delay = TIMING.TYPEWRITER_DELAYS.FAST;
                } else if (queueLength > TIMING.TYPEWRITER_THRESHOLDS.NORMAL) {
                  delay = TIMING.TYPEWRITER_DELAYS.NORMAL;
                } else {
                  delay = TIMING.TYPEWRITER_DELAYS.SLOW;
                }

                // Schedule next character with adaptive delay
                if (typewriterIntervalRef.current !== null) {
                  typewriterIntervalRef.current = setTimeout(typewriterTick, delay);
                }
              } else {
                // Queue empty, stop the timer
                typewriterIntervalRef.current = null;
              }
            };

            // Start the typewriter loop
            typewriterIntervalRef.current = setTimeout(typewriterTick, TIMING.TYPEWRITER_DELAYS.SLOW);
          }

          break;
        }

        case 'thinking': {
          // Flush text typewriter before processing thinking (text and thinking don't mix)
          flushTypewriter();

          const thinkingContent = event.content;
          if (!thinkingContent) break;

          // Check if we should start a new thinking block or append
          const lastBlock = currentBlocksRef.current[currentBlocksRef.current.length - 1];
          const isNewThinkingBlock = !lastBlock || lastBlock.type !== 'thinking';

          if (isNewThinkingBlock) {
            // Reset thinking refs for new block
            fullThinkingRef.current = '';
            displayedThinkingRef.current = '';
            thinkingQueueRef.current = [];
            if (thinkingTypewriterRef.current) {
              clearTimeout(thinkingTypewriterRef.current);
              thinkingTypewriterRef.current = null;
            }

            // Start new thinking block
            currentBlocksRef.current.push({
              type: 'thinking',
              content: '',
              timestamp: Date.now(),
              isIntermediate: true,
            });
            // Reset text block index since we're starting a new round
            currentTextBlockIndexRef.current = -1;
          }

          // Accumulate full thinking content
          // Only trimStart on first chunk (when fullThinkingRef is empty)
          const contentToAdd = fullThinkingRef.current === '' ? thinkingContent.trimStart() : thinkingContent;
          fullThinkingRef.current += contentToAdd;

          // Update the thinking block with full content (for blocks array)
          // The thinking block is always the last one (either just pushed or existing)
          const thinkingBlockIdx = currentBlocksRef.current.length - 1;
          if (thinkingBlockIdx >= 0 && currentBlocksRef.current[thinkingBlockIdx].type === 'thinking') {
            currentBlocksRef.current[thinkingBlockIdx].content = fullThinkingRef.current;
          }

          // Queue characters for typewriter effect (use trimmed content)
          const chars = contentToAdd.split('');
          thinkingQueueRef.current.push(...chars);

          // Start thinking typewriter if not already running
          if (!thinkingTypewriterRef.current) {
            const thinkingTick = () => {
              const char = thinkingQueueRef.current.shift();
              if (char !== undefined) {
                displayedThinkingRef.current += char;

                // Update message with displayed thinking
                setMessages(prev => {
                  const idx = prev.findIndex(m => m.id === assistantMessageId);
                  if (idx === -1) return prev;

                  const msg = prev[idx];
                  const updated = [...prev];
                  updated[idx] = {
                    ...msg,
                    thinking: fullThinkingRef.current, // Full thinking for storage
                    currentThinking: displayedThinkingRef.current, // Displayed for UI
                    isThinkingStreaming: true,
                    blocks: [...currentBlocksRef.current],
                  };
                  return updated;
                });

                // Adaptive speed (same as text)
                const queueLength = thinkingQueueRef.current.length;
                let delay: number;
                if (queueLength > TIMING.TYPEWRITER_THRESHOLDS.VERY_FAST) {
                  delay = TIMING.TYPEWRITER_DELAYS.VERY_FAST;
                } else if (queueLength > TIMING.TYPEWRITER_THRESHOLDS.FAST) {
                  delay = TIMING.TYPEWRITER_DELAYS.FAST;
                } else if (queueLength > TIMING.TYPEWRITER_THRESHOLDS.NORMAL) {
                  delay = TIMING.TYPEWRITER_DELAYS.NORMAL;
                } else {
                  delay = TIMING.TYPEWRITER_DELAYS.SLOW;
                }

                if (thinkingTypewriterRef.current !== null) {
                  thinkingTypewriterRef.current = setTimeout(thinkingTick, delay);
                }
              } else {
                // Queue empty
                thinkingTypewriterRef.current = null;
              }
            };

            thinkingTypewriterRef.current = setTimeout(thinkingTick, TIMING.TYPEWRITER_DELAYS.SLOW);
          }

          break;
        }

        case 'tool_call': {
          // Flush both typewriters before processing tool call
          flushTypewriter();
          flushThinkingTypewriter();

          const toolCall = event.tool_call;
          if (!toolCall) break;

          const toolId = toolCall.id;
          const toolName = toolCall.function?.name || '';
          const toolArgs = safeJsonParse(toolCall.function?.arguments || '{}');

          // Mark that next content stream should clear previous content
          needsContentClearRef.current = true;

          // Add tool_call block
          currentBlocksRef.current.push({
            type: 'tool_call',
            content: '',
            timestamp: Date.now(),
            toolName,
            toolArgs,
            toolCallId: toolId,
            toolStatus: 'running',
            isIntermediate: true, // Tool calls are always intermediate
          });

          // Preserve current content
          const currentContent = fullContentRef.current;

          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantMessageId);
            if (idx === -1) return prev;

            const msg = prev[idx];
            const existingTools = msg.toolCalls || [];
            const newToolCall: ToolCall = {
              id: toolId,
              name: toolName,
              arguments: toolArgs,
              status: 'running',
            };

            const updated = [...prev];
            updated[idx] = {
              ...msg,
              content: currentContent || msg.content,
              toolCalls: [...existingTools, newToolCall],
              currentThinking: '',
              isThinkingStreaming: false,
              blocks: [...currentBlocksRef.current],
            };
            return updated;
          });
          break;
        }

        case 'tool_result': {
          // Flush pending updates before processing tool result
          flushTypewriter();
          flushThinkingTypewriter();

          const toolId = event.tool_call_id;
          const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);

          // Update corresponding tool_call block status
          const toolCallBlockIndex = currentBlocksRef.current.findIndex(
            b => b.type === 'tool_call' && b.toolCallId === toolId,
          );
          if (toolCallBlockIndex !== -1) {
            currentBlocksRef.current[toolCallBlockIndex].toolStatus = 'completed';
          }

          // Add tool_result block
          currentBlocksRef.current.push({
            type: 'tool_result',
            content: result,
            timestamp: Date.now(),
            toolCallId: toolId,
            isIntermediate: true, // Tool results are always intermediate
          });

          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantMessageId);
            if (idx === -1) return prev;

            const msg = prev[idx];
            const toolCalls = msg.toolCalls?.map(tc =>
              tc.id === toolId ? { ...tc, status: 'completed' as const, result: event.result } : tc,
            );

            const updated = [...prev];
            updated[idx] = {
              ...msg,
              toolCalls,
              blocks: [...currentBlocksRef.current],
            };
            return updated;
          });
          break;
        }

        case 'done': {
          // Flush any pending updates before finalizing
          flushTypewriter();
          flushThinkingTypewriter();

          // Finalize message
          const finalContent = fullContentRef.current;

          // Update the last text block with final content and mark as non-intermediate
          if (
            currentTextBlockIndexRef.current >= 0 &&
            currentTextBlockIndexRef.current < currentBlocksRef.current.length
          ) {
            currentBlocksRef.current[currentTextBlockIndexRef.current].content = finalContent;
            currentBlocksRef.current[currentTextBlockIndexRef.current].isIntermediate = false;
          }

          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantMessageId);
            if (idx === -1) return prev;

            const msg = prev[idx];

            // Use currentBlocksRef if it has content, otherwise keep existing blocks
            const finalBlocks = currentBlocksRef.current.length > 0
              ? [...currentBlocksRef.current]
              : msg.blocks || [];

            const updated = [...prev];
            updated[idx] = {
              ...msg,
              content: finalContent || msg.content,
              isStreaming: false,
              isThinkingStreaming: false,
              isComplete: true,
              blocks: finalBlocks,
            };

            return updated;
          });

          // Reset refs for next message
          currentBlocksRef.current = [];
          currentTextBlockIndexRef.current = -1;
          fullContentRef.current = '';
          needsContentClearRef.current = false;
          // Reset text typewriter state
          tokenQueueRef.current = [];
          displayedContentRef.current = '';
          // Reset thinking typewriter state
          thinkingQueueRef.current = [];
          displayedThinkingRef.current = '';
          fullThinkingRef.current = '';

          setConversationId(event.conversationId);
          if (event.title) {
            setConversationTitle(event.title);
          }
          onConversationChange?.(event.conversationId, event.title);

          setIsStreaming(false);
          setIsLoading(false);
          break;
        }

        case 'error': {
          // Flush pending updates before handling error
          flushTypewriter();
          flushThinkingTypewriter();

          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === assistantMessageId);
            if (idx === -1) return prev;

            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              isStreaming: false,
              isThinkingStreaming: false,
              isComplete: true,
              content: updated[idx].content || `Error: ${event.error}`,
            };
            return updated;
          });

          // Reset refs
          currentBlocksRef.current = [];
          currentTextBlockIndexRef.current = -1;
          fullContentRef.current = '';
          needsContentClearRef.current = false;
          // Reset text typewriter state
          tokenQueueRef.current = [];
          displayedContentRef.current = '';
          // Reset thinking typewriter state
          thinkingQueueRef.current = [];
          displayedThinkingRef.current = '';
          fullThinkingRef.current = '';

          setError(event.error);
          onError?.(new Error(event.error));
          setIsStreaming(false);
          setIsLoading(false);
          break;
        }

        case 'interrupt': {
          // Flush pending updates before handling interrupt
          flushTypewriter();
          flushThinkingTypewriter();

          // HITL interrupt received - pause for user input
          const interruptPayload = event.interrupt_payload;
          if (interruptPayload) {
            // Save run_id for HITL response
            currentRunIdRef.current = event.run_id ?? null;
            setPendingInterrupt({
              ...interruptPayload,
              interrupt_type: event.interrupt_type as 'approval_request' | 'user_input_request',
            });
          }
          break;
        }
      }
    },
    [onError, onConversationChange, flushTypewriter, flushThinkingTypewriter],
  );

  // Send a message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Clear any previous error
      setError(null);

      // Stop any running typewriters from previous message
      if (typewriterIntervalRef.current) {
        clearTimeout(typewriterIntervalRef.current);
        typewriterIntervalRef.current = null;
      }
      if (thinkingTypewriterRef.current) {
        clearTimeout(thinkingTypewriterRef.current);
        thinkingTypewriterRef.current = null;
      }

      // Reset refs for new message
      currentBlocksRef.current = [];
      currentTextBlockIndexRef.current = -1;
      fullContentRef.current = '';
      needsContentClearRef.current = false;
      tokenQueueRef.current = [];
      displayedContentRef.current = '';
      thinkingQueueRef.current = [];
      displayedThinkingRef.current = '';
      fullThinkingRef.current = '';

      // Create user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date().toISOString(),
      };

      // Create placeholder for assistant message
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
        toolCalls: [],
        blocks: [],
      };

      // Add messages to state
      setMessages(prev => [...prev, userMessage, assistantMessage]);
      setIsLoading(true);
      setIsStreaming(true);

      try {
        // Auto-connect if not connected
        // This allows users to type at any time and triggers connection on send
        if (!adapter.isConnected()) {
          await adapter.connect();
        }

        // Prepare messages for API (use ref to avoid closure trap)
        const apiMessages: SendMessage[] = messagesRef.current
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          .concat({ role: 'user', content: content.trim() });

        // Start streaming (use ref for conversationId)
        const { cancel } = await adapter.chatStream(
          apiMessages,
          conversationIdRef.current ?? undefined,
          event => handleStreamEvent(event, assistantMessage.id),
        );

        cancelRef.current = cancel;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));

        // Update assistant message to show error
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === assistantMessage.id);
          if (idx === -1) return prev;

          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            isStreaming: false,
            content: `Error: ${errorMessage}`,
          };
          return updated;
        });

        setIsLoading(false);
        setIsStreaming(false);
      }
    },
    [adapter, handleStreamEvent, onError],  // Removed messages & conversationId (use refs)
  );

  // Stop streaming
  const stopStreaming = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;

    // Flush remaining content before stopping (don't discard queued content)
    flushTypewriter();
    flushThinkingTypewriter();

    // Mark the last assistant message as not streaming, use full content
    setMessages(prev => {
      const lastAssistant = [...prev].reverse().find(m => m.role === 'assistant');
      if (!lastAssistant?.isStreaming) return prev;

      return prev.map(m => (m.id === lastAssistant.id ? {
        ...m,
        content: fullContentRef.current || m.content,
        thinking: fullThinkingRef.current || m.thinking,
        isStreaming: false,
        isThinkingStreaming: false,
        isComplete: true
      } : m));
    });

    // Reset refs
    currentBlocksRef.current = [];
    currentTextBlockIndexRef.current = -1;
    fullContentRef.current = '';
    needsContentClearRef.current = false;
    tokenQueueRef.current = [];
    displayedContentRef.current = '';
    thinkingQueueRef.current = [];
    displayedThinkingRef.current = '';
    fullThinkingRef.current = '';

    setIsStreaming(false);
    setIsLoading(false);
  }, [flushTypewriter, flushThinkingTypewriter]);

  // Clear all messages
  const clearMessages = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;

    // Stop text typewriter
    if (typewriterIntervalRef.current) {
      clearTimeout(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
    // Stop thinking typewriter
    if (thinkingTypewriterRef.current) {
      clearTimeout(thinkingTypewriterRef.current);
      thinkingTypewriterRef.current = null;
    }

    setMessages([]);
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);

    // Reset refs
    currentBlocksRef.current = [];
    currentTextBlockIndexRef.current = -1;
    fullContentRef.current = '';
    needsContentClearRef.current = false;
    tokenQueueRef.current = [];
    displayedContentRef.current = '';
    thinkingQueueRef.current = [];
    displayedThinkingRef.current = '';
    fullThinkingRef.current = '';
  }, []);

  // Load a conversation
  const loadConversation = useCallback(
    async (id: string) => {
      try {
        setIsLoading(true);
        setError(null);

        const detail = await adapter.getConversation(id);

        if (!isMountedRef.current) return;

        setMessages(detail.messages);
        setConversationId(detail.id);
        setConversationTitle(detail.title);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load conversation';
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [adapter, onError],
  );

  // Start a new conversation
  const newConversation = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;

    // Stop text typewriter
    if (typewriterIntervalRef.current) {
      clearTimeout(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
    // Stop thinking typewriter
    if (thinkingTypewriterRef.current) {
      clearTimeout(thinkingTypewriterRef.current);
      thinkingTypewriterRef.current = null;
    }

    setMessages([]);
    setConversationId(null);
    setConversationTitle(null);
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
    setPendingInterrupt(null);

    // Reset refs
    currentBlocksRef.current = [];
    currentTextBlockIndexRef.current = -1;
    fullContentRef.current = '';
    needsContentClearRef.current = false;
    tokenQueueRef.current = [];
    displayedContentRef.current = '';
    thinkingQueueRef.current = [];
    displayedThinkingRef.current = '';
    fullThinkingRef.current = '';
  }, []);

  // ============================================================================
  // HITL Handlers
  // ============================================================================

  // Send HITL response to backend
  const sendHitlResponse = useCallback(
    (response: HitlResponse) => {
      if (!adapter.sendHitlResponse) {
        return;
      }
      adapter.sendHitlResponse(response, currentRunIdRef.current ?? undefined);
    },
    [adapter],
  );

  // Approve HITL request
  const approveHitl = useCallback(
    (remember = false) => {
      sendHitlResponse({ approved: true, remember });
      setPendingInterrupt(null);
    },
    [sendHitlResponse],
  );

  // Reject HITL request
  const rejectHitl = useCallback(
    (remember = false) => {
      sendHitlResponse({ approved: false, remember });
      setPendingInterrupt(null);
      setIsLoading(false);
    },
    [sendHitlResponse],
  );

  // Submit HITL input (for user_input_request)
  const submitHitlInput = useCallback(
    (response: HitlResponse) => {
      sendHitlResponse(response);
      setPendingInterrupt(null);
      // If cancelled or timed_out, stop loading
      if (response.cancelled || response.timed_out) {
        setIsLoading(false);
      }
    },
    [sendHitlResponse],
  );

  // Cancel HITL (same as stop streaming)
  const cancelHitl = useCallback(() => {
    stopStreaming();
    setPendingInterrupt(null);
  }, [stopStreaming]);

  return {
    messages,
    isLoading,
    isStreaming,
    error,
    conversationId,
    conversationTitle,
    pendingInterrupt,
    sendMessage,
    stopStreaming,
    clearMessages,
    setError,
    approveHitl,
    rejectHitl,
    submitHitlInput,
    cancelHitl,
    loadConversation,
    newConversation,
  };
}

// Helper to safely parse JSON
function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
