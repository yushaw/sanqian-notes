import { Component, ErrorInfo, ReactNode } from 'react'
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackMessage?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Error Boundary for TipTap NodeView components
 * Catches render errors and displays a fallback UI instead of crashing the editor
 */
export class NodeViewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[NodeView Error]', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <NodeViewWrapper className="node-view-error-wrapper">
          <div className="node-view-error">
            <AlertTriangle size={16} />
            <span>{this.props.fallbackMessage || 'Failed to render block'}</span>
          </div>
        </NodeViewWrapper>
      )
    }

    return this.props.children
  }
}

/**
 * HOC to wrap a NodeView component with error boundary
 * Uses explicit cast to maintain type compatibility with ReactNodeViewRenderer
 */
export function withErrorBoundary(
  WrappedComponent: (props: NodeViewProps) => JSX.Element,
  fallbackMessage?: string
): (props: NodeViewProps) => JSX.Element {
  return function WithErrorBoundary(props: NodeViewProps) {
    return (
      <NodeViewErrorBoundary fallbackMessage={fallbackMessage}>
        <WrappedComponent {...props} />
      </NodeViewErrorBoundary>
    )
  }
}
