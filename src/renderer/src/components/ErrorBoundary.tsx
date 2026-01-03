/**
 * ErrorBoundary - Catches React rendering errors
 *
 * Prevents entire app from crashing when a component throws.
 * Shows a fallback UI and logs errors for debugging.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <div className="text-4xl mb-4">😵</div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm bg-accent text-accent-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * EditorErrorBoundary - Specialized error boundary for editor components
 * Shows a more specific error message for editor failures
 */
export class EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[EditorErrorBoundary] Editor crashed:', error)
    console.error('[EditorErrorBoundary] Component stack:', errorInfo.componentStack)
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-background">
          <div className="text-4xl mb-4">📝</div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Editor failed to load
          </h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            There was an error loading the editor. Your note content is safe.
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm bg-accent text-accent-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Reload editor
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
