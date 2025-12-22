/**
 * ExpandableToolCall Component
 *
 * A styled, interactive tool call display with expandable details.
 * Combines ToolCallBadge primitive with ToolArgumentsDisplay renderer.
 *
 * Features:
 * - Click to expand/collapse
 * - Shows tool name with status indicator
 * - Expandable arguments display (Python kwargs style)
 * - Expandable result preview
 * - Theme-aware using CSS variables
 */

import { memo, useState, type ReactNode } from 'react';
import type { ToolCall } from '../core/types';
import { ToolArgumentsDisplay } from '../renderers/ToolArgumentsDisplay';

export interface ExpandableToolCallProps {
  /** The tool call to display */
  toolCall: ToolCall;
  /** Additional CSS classes */
  className?: string;
  /** Whether to start expanded */
  defaultExpanded?: boolean;
  /** Custom icon for running state */
  runningIcon?: ReactNode;
  /** Custom icon for completed state */
  completedIcon?: ReactNode;
  /** Custom icon for error state */
  errorIcon?: ReactNode;
  /** Custom icon for pending state */
  pendingIcon?: ReactNode;
  /** Maximum length for result preview */
  resultPreviewLength?: number;
  /** Callback when expansion state changes */
  onExpandChange?: (expanded: boolean) => void;
}

/**
 * Status indicator dot with appropriate color.
 */
function StatusDot({ status }: { status: ToolCall['status'] }) {
  const colorClass = {
    pending: 'bg-chat-muted',
    running: 'bg-amber-500 animate-pulse',
    completed: 'bg-chat-success',
    error: 'bg-chat-error',
    cancelled: 'bg-chat-muted',
  }[status];

  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${colorClass}`} />;
}

/**
 * Default status icons (Unicode characters).
 */
const DEFAULT_ICONS = {
  pending: '○',
  running: '◐',
  completed: '✓',
  error: '✗',
} as const;

export const ExpandableToolCall = memo(function ExpandableToolCall({
  toolCall,
  className = '',
  defaultExpanded = false,
  runningIcon,
  completedIcon,
  errorIcon,
  pendingIcon,
  resultPreviewLength = 200,
  onExpandChange,
}: ExpandableToolCallProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { name, status, arguments: args, result, error } = toolCall;
  const hasArgs = args && Object.keys(args).length > 0;
  const hasResult = result !== undefined && result !== null;

  const toggleExpanded = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    onExpandChange?.(newExpanded);
  };

  // Get status icon
  const getIcon = () => {
    switch (status) {
      case 'running':
        return runningIcon ?? DEFAULT_ICONS.running;
      case 'completed':
        return completedIcon ?? DEFAULT_ICONS.completed;
      case 'error':
        return errorIcon ?? DEFAULT_ICONS.error;
      case 'pending':
      default:
        return pendingIcon ?? DEFAULT_ICONS.pending;
    }
  };

  // Format result for preview
  const formatResult = (value: unknown): string => {
    if (typeof value === 'string') {
      return value.length > resultPreviewLength ? value.slice(0, resultPreviewLength) + '…' : value;
    }
    const json = JSON.stringify(value);
    return json.length > resultPreviewLength ? json.slice(0, resultPreviewLength) + '…' : json;
  };

  // Get preview text for collapsed state
  const getArgPreview = () => {
    if (!hasArgs) return null;
    const entries = Object.entries(args);
    const first = entries[0];
    if (!first) return null;
    const [, value] = first;
    if (typeof value === 'string') {
      return value.length > 20 ? value.slice(0, 20) + '…' : value;
    }
    return '…';
  };

  return (
    <div className={`${className}`}>
      {/* Clickable header */}
      <span
        onClick={toggleExpanded}
        className="text-chat-muted hover:text-chat-accent inline-flex cursor-pointer items-center gap-1.5 transition-colors"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Tool: ${name}, Status: ${status}`}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleExpanded();
          }
        }}>
        {/* Status dot */}
        <StatusDot status={status} />

        {/* Tool name */}
        <span className="font-mono text-sm">{name}</span>

        {/* Status icon (for completed/error) */}
        {status === 'completed' && (
          <span className="text-chat-success" aria-hidden="true">
            {getIcon()}
          </span>
        )}
        {status === 'error' && (
          <span className="text-chat-error" aria-hidden="true">
            {getIcon()}
          </span>
        )}
        {status === 'running' && (
          <span className="text-amber-500" aria-hidden="true">
            {getIcon()}
          </span>
        )}

        {/* Collapsed preview */}
        {!expanded && hasArgs && <span className="text-chat-muted/60 text-xs">({getArgPreview()})</span>}
      </span>

      {/* Expanded content */}
      {expanded && (
        <div className="border-chat-border/30 ml-1 mt-1 space-y-2 border-l pl-3" style={{ fontSize: '0.9em' }}>
          {/* Arguments */}
          {hasArgs && (
            <div>
              <div className="text-chat-muted/60 mb-1 text-xs">Arguments:</div>
              <ToolArgumentsDisplay args={args} />
            </div>
          )}

          {/* Result */}
          {hasResult && status === 'completed' && (
            <div>
              <div className="text-chat-muted/60 mb-1 text-xs">Result:</div>
              <pre className="text-chat-text/70 m-0 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono text-xs">
                {formatResult(result)}
              </pre>
            </div>
          )}

          {/* Error */}
          {status === 'error' && error && (
            <div className="bg-chat-error/10 text-chat-error rounded p-2 text-xs">{error}</div>
          )}
        </div>
      )}
    </div>
  );
});

export default ExpandableToolCall;
