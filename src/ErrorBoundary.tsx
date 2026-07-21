import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null; info: ErrorInfo | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error) {
    return { error, info: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
  }

  render() {
    const { error, info } = this.state
    if (error) {
      return (
        <pre style={{ whiteSpace: 'pre-wrap', padding: 16, color: 'crimson' }}>
          {error.stack ?? error.message}
          {'\n\n'}
          {info?.componentStack}
        </pre>
      )
    }
    return this.props.children
  }
}
