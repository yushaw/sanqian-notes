/**
 * HistoryList Component
 *
 * Displays conversation history with relative time and delete on hover
 * Following sanqian-todolist ChatPanel design pattern
 */

import { memo, useState } from 'react';
import type { ConversationInfo } from '../core/types';

export interface HistoryListProps {
  /** List of conversations */
  conversations: ConversationInfo[];
  /** Currently selected conversation ID */
  selectedId?: string | null;
  /** Whether loading */
  isLoading?: boolean;
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when a conversation is selected */
  onSelect: (id: string) => void;
  /** Called when a conversation should be deleted */
  onDelete: (id: string) => void;
  /** Called when load more is triggered */
  onLoadMore?: () => void;
  /** Dark mode */
  isDarkMode?: boolean;
  /** Localized strings */
  strings?: {
    noHistory?: string;
    loadMore?: string;
    today?: string;
    yesterday?: string;
    delete?: string;
  };
}

// Parse timestamp string to Date
function parseTimestamp(dateStr: string): Date {
  let str = dateStr;

  // Check if timestamp has timezone info
  const hasTimezone = str.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(str) || /[+-]\d{4}$/.test(str);

  if (!hasTimezone) {
    str = str.replace(' ', 'T');
    str += 'Z';
  }

  return new Date(str);
}

// Format relative time
function formatRelativeTime(dateStr: string | undefined, strings: { today?: string; yesterday?: string }): string {
  if (!dateStr) return '';

  const date = parseTimestamp(dateStr);

  if (isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return strings.today ? `${strings.today} ${time}` : time;
  } else if (diffDays === 1) {
    return strings.yesterday || 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  } else {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}

export const HistoryList = memo(function HistoryList({
  conversations,
  selectedId,
  isLoading,
  hasMore,
  onSelect,
  onDelete,
  onLoadMore,
  isDarkMode = false,
  strings = {},
}: HistoryListProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const textMuted = isDarkMode ? 'text-zinc-500' : 'text-zinc-400';
  const textPrimary = isDarkMode ? 'text-zinc-100' : 'text-zinc-900';
  const hoverBg = isDarkMode ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100';
  const selectedBg = isDarkMode ? 'bg-zinc-800' : 'bg-zinc-100';

  if (isLoading && conversations.length === 0) {
    return (
      <div className="flex justify-center py-6">
        <div className="flex gap-1">
          <span
            className={`size-1.5 ${isDarkMode ? 'bg-zinc-600' : 'bg-zinc-300'} animate-bounce rounded-full`}
            style={{ animationDelay: '0ms' }}
          />
          <span
            className={`size-1.5 ${isDarkMode ? 'bg-zinc-600' : 'bg-zinc-300'} animate-bounce rounded-full`}
            style={{ animationDelay: '150ms' }}
          />
          <span
            className={`size-1.5 ${isDarkMode ? 'bg-zinc-600' : 'bg-zinc-300'} animate-bounce rounded-full`}
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return <div className={`text-center ${textMuted} py-6 text-sm`}>{strings.noHistory || 'No conversations yet'}</div>;
  }

  return (
    <div className="pt-1">
      {conversations.map(conv => {
        const isSelected = conv.id === selectedId;
        const isHovered = conv.id === hoveredId;

        return (
          <div
            key={conv.id}
            className={`group relative flex w-full items-center rounded-lg px-3 py-1.5 text-left ${hoverBg} cursor-pointer transition-colors ${
              isSelected ? selectedBg : ''
            }`}
            onClick={() => onSelect(conv.id)}
            onMouseEnter={() => setHoveredId(conv.id)}
            onMouseLeave={() => setHoveredId(null)}>
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${textPrimary} truncate`}>{conv.title || 'Untitled'}</div>
              <div className={`text-xs ${textMuted}`}>{formatRelativeTime(conv.updatedAt, strings)}</div>
            </div>
            {isHovered && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className={`absolute right-2 rounded p-1 transition-all hover:bg-red-500/10 ${textMuted} hover:text-red-500`}
                title={strings.delete || 'Delete'}>
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {/* Load more */}
      {hasMore && (
        <div className="pt-2 text-center">
          {isLoading ? (
            <div className="flex justify-center py-2">
              <div className="flex gap-1">
                <span
                  className={`size-1.5 ${isDarkMode ? 'bg-zinc-600' : 'bg-zinc-300'} animate-bounce rounded-full`}
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className={`size-1.5 ${isDarkMode ? 'bg-zinc-600' : 'bg-zinc-300'} animate-bounce rounded-full`}
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className={`size-1.5 ${isDarkMode ? 'bg-zinc-600' : 'bg-zinc-300'} animate-bounce rounded-full`}
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={onLoadMore}
              className={`text-xs ${textMuted} hover:${textPrimary} px-3 py-1 transition-colors`}>
              {strings.loadMore || 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
