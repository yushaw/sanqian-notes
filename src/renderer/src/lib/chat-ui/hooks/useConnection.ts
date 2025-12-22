/**
 * useConnection Hook
 *
 * Manages connection state with the backend
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ConnectionStatus, ConnectionErrorCode } from '../core/types';
import type { ChatAdapter } from '../adapters/types';

export interface UseConnectionOptions {
  /** Chat adapter */
  adapter: ChatAdapter;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Called when connection status changes */
  onStatusChange?: (status: ConnectionStatus, error?: string, errorCode?: ConnectionErrorCode) => void;
}

export interface UseConnectionReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Connection error message (if any) */
  error: string | undefined;
  /** Connection error code (if any) */
  errorCode: ConnectionErrorCode | undefined;
  /** Whether currently connected */
  isConnected: boolean;
  /** Whether currently connecting/reconnecting */
  isConnecting: boolean;
  /** Connect to the backend */
  connect: () => Promise<void>;
  /** Disconnect from the backend */
  disconnect: () => Promise<void>;
}

export function useConnection(options: UseConnectionOptions): UseConnectionReturn {
  const { adapter, autoConnect = true, onStatusChange } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | undefined>();
  const [errorCode, setErrorCode] = useState<ConnectionErrorCode | undefined>();
  const isMountedRef = useRef(true);

  // Subscribe to connection changes
  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribe = adapter.onConnectionChange((newStatus, newError, newErrorCode) => {
      if (!isMountedRef.current) return;

      setStatus(newStatus);
      setError(newError);
      setErrorCode(newErrorCode);
      onStatusChange?.(newStatus, newError, newErrorCode);
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [adapter, onStatusChange]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && status === 'disconnected') {
      adapter.connect().catch(err => {
        console.error('Auto-connect failed:', err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    try {
      await adapter.connect();
    } catch (err) {
      console.error('Connect failed:', err);
      throw err;
    }
  }, [adapter]);

  const disconnect = useCallback(async () => {
    try {
      await adapter.disconnect();
    } catch (err) {
      console.error('Disconnect failed:', err);
      throw err;
    }
  }, [adapter]);

  return {
    status,
    error,
    errorCode,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting' || status === 'reconnecting',
    connect,
    disconnect,
  };
}
