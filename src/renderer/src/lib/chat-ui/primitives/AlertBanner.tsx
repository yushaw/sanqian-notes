/**
 * AlertBanner Primitive
 *
 * Displays warning/error alerts above the chat input
 * Styled similar to Claude for Chrome's alert banners
 */

import { memo, useState, type ReactNode } from 'react';

export type AlertType = 'warning' | 'error';

export interface AlertAction {
  /** Action label */
  label: string;
  /** Action handler */
  onClick: () => void;
}

export interface AlertBannerProps {
  /** Alert type - determines styling */
  type: AlertType;
  /** Alert message content */
  message: string | ReactNode;
  /** Optional action button */
  action?: AlertAction;
  /** Optional dismiss handler - shows dismiss button when provided */
  onDismiss?: () => void;
  /** Additional class names */
  className?: string;
  /** Custom icon */
  icon?: ReactNode;
  /** Max lines before truncating (default: 3) */
  maxLines?: number;
}

export const AlertBanner = memo(function AlertBanner({
  type,
  message,
  action,
  onDismiss,
  className = '',
  icon,
  maxLines = 3,
}: AlertBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Default icons
  const defaultIcon =
    type === 'error' ? (
      // Error icon (circle with X)
      <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
      </svg>
    ) : (
      // Warning icon (triangle with !)
      <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round" />
        <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" />
      </svg>
    );

  // Check if message is a string and needs truncation
  const isStringMessage = typeof message === 'string';
  const messageText = isStringMessage ? message : '';
  const lines = messageText.split('\n');
  const needsTruncation = isStringMessage && lines.length > maxLines;
  const truncatedMessage = needsTruncation && !isExpanded ? lines.slice(0, maxLines).join('\n') + '…' : messageText;

  return (
    <div className={className} role="alert" aria-live="polite" data-alert-type={type}>
      {/* Icon */}
      <div className="self-start pt-0.5">{icon || defaultIcon}</div>

      {/* Message */}
      <span
        className={`flex-1 whitespace-pre-wrap break-words ${needsTruncation ? 'cursor-pointer' : ''}`}
        onClick={needsTruncation ? () => setIsExpanded(!isExpanded) : undefined}>
        {isStringMessage ? truncatedMessage : message}
        {needsTruncation && (
          <span className="ml-1 text-xs opacity-60 hover:opacity-100">{isExpanded ? '(收起)' : '(展开)'}</span>
        )}
      </span>

      {/* Actions */}
      <div className="flex items-center self-start">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-2 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium underline transition-opacity hover:opacity-80">
            {action.label}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-1 rounded p-0.5 transition-opacity hover:opacity-80"
            aria-label="Dismiss">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
