import { Component, type ReactNode } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional custom fallback UI */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Could send to Sentry / logging service here
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5 p-8 bg-gray-50">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-center space-y-1.5 max-w-xs">
            <p className="font-semibold text-gray-800">Đã xảy ra lỗi</p>
            <p className="text-sm text-gray-500">
              {this.state.error?.message ?? 'Lỗi không xác định'}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={this.reset}
              className="btn-secondary text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Thử lại
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary text-sm"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
