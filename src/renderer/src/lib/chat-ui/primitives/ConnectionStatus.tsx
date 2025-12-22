/**
 * ConnectionStatus Primitive
 *
 * Displays backend connection status
 */

import { memo, type ReactNode } from 'react';
import type { ConnectionStatus as ConnectionStatusType } from '../core/types';

export interface ConnectionStatusProps {
  /** Current connection status */
  status: ConnectionStatusType;
  /** Error message (if status is 'error') */
  error?: string;
  /** Additional class names */
  className?: string;
  /** Custom status messages */
  messages?: Partial<Record<ConnectionStatusType, string>>;
  /** Custom icons for each status */
  icons?: Partial<Record<ConnectionStatusType, ReactNode>>;
  /** Called when connect button is clicked (shown when disconnected) */
  onConnect?: () => void;
  /** Connect button content */
  connectButtonContent?: ReactNode;
  /** Whether to show connect button when disconnected */
  showConnectButton?: boolean;
}

const DEFAULT_MESSAGES: Record<ConnectionStatusType, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  error: 'Connection error',
};

export const ConnectionStatus = memo(function ConnectionStatus({
  status,
  error,
  className = '',
  messages = {},
  icons = {},
  onConnect,
  connectButtonContent = 'Connect',
  showConnectButton = true,
}: ConnectionStatusProps) {
  const displayMessage = messages[status] ?? DEFAULT_MESSAGES[status];
  const displayIcon = icons[status];

  // Don't render if connected (optional - you can remove this if you want to show connected state)
  // if (status === 'connected') return null;

  return (
    <div className={className} data-status={status} role="status" aria-live="polite">
      {displayIcon && (
        <span className="status-icon" aria-hidden="true">
          {displayIcon}
        </span>
      )}

      <span className="status-message">{status === 'error' && error ? error : displayMessage}</span>

      {status === 'disconnected' && showConnectButton && onConnect && (
        <button type="button" onClick={onConnect} className="connect-button" aria-label="Connect to server">
          {connectButtonContent}
        </button>
      )}
    </div>
  );
});
