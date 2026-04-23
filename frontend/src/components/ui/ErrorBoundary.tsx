import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-gray-50">
          <p className="text-gray-600 text-center">Đã xảy ra lỗi không mong muốn</p>
          <p className="text-xs text-gray-400 text-center max-w-sm">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Tải lại trang
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
