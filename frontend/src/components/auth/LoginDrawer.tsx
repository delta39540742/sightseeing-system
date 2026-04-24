import { useState } from 'react'
import { X, Mail, Lock } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useLoginActions } from '@/hooks/useAuth'
import { Spinner } from '@/components/ui/Spinner'

export function LoginDrawer() {
  const { loginDrawerOpen, closeLoginDrawer } = useAuthStore()
  const { loginEmail, registerEmail, loginGoogle } = useLoginActions()
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!loginDrawerOpen) return null

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (isLogin) {
        await loginEmail(email, password)
      } else {
        await registerEmail(email, password)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (isLogin ? 'Đăng nhập thất bại' : 'Đăng ký thất bại'))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    setLoading(true)
    try {
      await loginGoogle()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={closeLoginDrawer} />
      <div className="relative bg-white w-full max-w-sm h-full flex flex-col shadow-2xl animate-slideUp md:animate-none md:translate-x-0">
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <h2 className="text-lg font-semibold">{isLogin ? 'Đăng nhập' : 'Đăng ký'}</h2>
          <button onClick={closeLoginDrawer} aria-label="Đóng" className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 p-6 flex flex-col justify-center gap-4">
          <p className="text-sm text-gray-500 text-center">
            {isLogin ? 'Đăng nhập để lưu và đồng bộ kế hoạch của bạn' : 'Tạo tài khoản để bắt đầu lên kế hoạch'}
          </p>

          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleEmail} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                className="input pl-10"
                aria-label="Email"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                required
                className="input pl-10"
                aria-label="Mật khẩu"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? <Spinner size="sm" /> : (isLogin ? 'Đăng nhập' : 'Đăng ký')}
            </button>
          </form>

          <div className="text-center mt-2">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin)
                setError('')
              }}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {isLogin ? 'Chưa có tài khoản? Đăng ký ngay' : 'Đã có tài khoản? Đăng nhập'}
            </button>
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-400 mt-2">
            <div className="flex-1 h-px bg-gray-200" />
            <span>hoặc</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="btn-secondary w-full py-2.5 gap-3"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.85l6.1-6.1C34.46 3.1 29.56 1 24 1 14.82 1 7.07 6.48 3.69 14.22l7.1 5.52C12.44 13.72 17.77 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.1 24.5c0-1.6-.14-3.13-.4-4.62H24v8.75h12.44c-.54 2.9-2.17 5.36-4.63 7.02l7.1 5.52C43.27 37.3 46.1 31.36 46.1 24.5z"/>
              <path fill="#FBBC05" d="M10.79 28.26A14.5 14.5 0 0 1 9.5 24c0-1.48.25-2.91.69-4.26l-7.1-5.52A23 23 0 0 0 1 24c0 3.77.9 7.34 2.49 10.49l7.3-6.23z"/>
              <path fill="#34A853" d="M24 47c5.56 0 10.23-1.84 13.63-5.01l-7.1-5.52c-1.84 1.24-4.19 1.98-6.53 1.98-6.23 0-11.56-4.22-13.21-9.94l-7.3 6.23C7.07 41.52 14.82 47 24 47z"/>
            </svg>
            Đăng nhập bằng Google
          </button>
        </div>
      </div>
    </div>
  )
}
