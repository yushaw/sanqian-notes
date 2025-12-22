/**
 * ToolCallBadge Primitive
 *
 * Displays tool call status
 */

import { memo, type ReactNode } from 'react';
import type { ToolCall } from '../core/types';

export interface ToolCallBadgeProps {
  /** The tool call to display */
  toolCall: ToolCall;
  /** Additional class names */
  className?: string;
  /** Custom icon for running state */
  runningIcon?: ReactNode;
  /** Custom icon for completed state */
  completedIcon?: ReactNode;
  /** Custom icon for error state */
  errorIcon?: ReactNode;
  /** Custom icon for pending state */
  pendingIcon?: ReactNode;
  /** Whether to show tool arguments */
  showArguments?: boolean;
  /** Whether to show tool result */
  showResult?: boolean;
}

export const ToolCallBadge = memo(function ToolCallBadge({
  toolCall,
  className = '',
  runningIcon = '◐',
  completedIcon = '✓',
  errorIcon = '✗',
  pendingIcon = '○',
  showArguments = false,
  showResult = false,
}: ToolCallBadgeProps) {
  const { name, status, arguments: args, result, error } = toolCall;

  const getIcon = () => {
    switch (status) {
      case 'running':
        return runningIcon;
      case 'completed':
        return completedIcon;
      case 'error':
        return errorIcon;
      case 'pending':
      default:
        return pendingIcon;
    }
  };

  return (
    <div className={className} data-status={status} aria-label={`Tool: ${name}, Status: ${status}`}>
      <span className="tool-icon" aria-hidden="true">
        {getIcon()}
      </span>
      <span className="tool-name">{name}</span>

      {showArguments && args && Object.keys(args).length > 0 && (
        <details className="tool-arguments">
          <summary>Arguments</summary>
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </details>
      )}

      {showResult && status === 'completed' && result !== undefined && (
        <details className="tool-result">
          <summary>Result</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}

      {status === 'error' && error && <span className="tool-error">{error}</span>}
    </div>
  );
});
