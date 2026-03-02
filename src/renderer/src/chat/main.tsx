/**
 * Chat Window Entry Point
 *
 * Uses sanqian-chat's CompactChat with IPC adapter for floating chat window.
 */

import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import ChatApp from './ChatApp'

class ChatErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChatErrorBoundary] Render error:', error, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          color: '#ef4444',
          fontSize: 14,
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}>
          <div>
            <p style={{ fontWeight: 600 }}>Chat failed to load</p>
            <p style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
              {this.state.error.message}
            </p>
            <button
              onClick={this.handleRetry}
              style={{
                marginTop: 16,
                padding: '6px 16px',
                fontSize: 13,
                color: '#666',
                background: 'transparent',
                border: '1px solid #ddd',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatErrorBoundary>
      <ChatApp />
    </ChatErrorBoundary>
  </StrictMode>
)
