import { Component } from 'react'
import type { ErrorInfo } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', gap: '12px',
          color: '#4a6080', fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{ fontSize: '13px', color: '#ff3b3b' }}>
            {this.props.fallback ?? 'Error al cargar este componente'}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              fontSize: '11px', padding: '6px 14px', borderRadius: '8px',
              background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.2)',
              color: '#ff6b6b', cursor: 'pointer'
            }}
          >
            Reintentar
          </button>
          {import.meta.env.DEV && (
            <pre style={{ fontSize: '10px', color: '#2c4268', maxWidth: '600px', overflow: 'auto' }}>
              {this.state.error.message}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
