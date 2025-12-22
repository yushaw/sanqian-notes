/**
 * useConversations Hook
 *
 * Manages conversation history list with loading and delete operations
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatAdapter } from '../adapters/types';
import type { ConversationInfo } from '../core/types';

export interface UseConversationsOptions {
  /** Chat adapter for backend communication */
  adapter: ChatAdapter;
  /** Number of conversations per page */
  pageSize?: number;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseConversationsReturn {
  // State
  conversations: ConversationInfo[];
  isLoading: boolean;
  hasMore: boolean;
  total: number;
  error: string | null;

  // Actions
  loadConversations: () => Promise<void>;
  loadMore: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useConversations(options: UseConversationsOptions): UseConversationsReturn {
  const { adapter, pageSize = 20, onError } = options;

  // State
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const offsetRef = useRef(0);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load conversations (initial or refresh)
  const loadConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const result = await adapter.listConversations({ limit: pageSize, offset: 0 });

      if (!isMountedRef.current) return;

      setConversations(result.conversations);
      setTotal(result.total);
      offsetRef.current = result.conversations.length;
    } catch (err) {
      if (!isMountedRef.current) return;
      const errorMessage = err instanceof Error ? err.message : 'Failed to load conversations';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [adapter, pageSize, onError]);

  // Load more conversations
  const loadMore = useCallback(async () => {
    if (isLoading || offsetRef.current >= total) return;

    try {
      setIsLoading(true);

      const result = await adapter.listConversations({
        limit: pageSize,
        offset: offsetRef.current,
      });

      if (!isMountedRef.current) return;

      setConversations(prev => [...prev, ...result.conversations]);
      offsetRef.current += result.conversations.length;
    } catch (err) {
      if (!isMountedRef.current) return;
      const errorMessage = err instanceof Error ? err.message : 'Failed to load more';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [adapter, pageSize, isLoading, total, onError]);

  // Delete a conversation
  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await adapter.deleteConversation(id);

        if (!isMountedRef.current) return;

        // Remove from list
        setConversations(prev => prev.filter(c => c.id !== id));
        setTotal(prev => prev - 1);
        offsetRef.current = Math.max(0, offsetRef.current - 1);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete';
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      }
    },
    [adapter, onError],
  );

  // Refresh (reload from beginning)
  const refresh = useCallback(async () => {
    offsetRef.current = 0;
    await loadConversations();
  }, [loadConversations]);

  return {
    conversations,
    isLoading,
    hasMore: offsetRef.current < total,
    total,
    error,
    loadConversations,
    loadMore,
    deleteConversation,
    refresh,
  };
}
