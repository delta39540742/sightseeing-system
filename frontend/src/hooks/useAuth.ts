import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '@/config/firebase'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { preferenceService } from '@/services/preferenceService'
import { toast } from '@/store/toastStore'

// Pref-service down → bỏ qua redirect, không chặn flow login.
async function redirectIfNoSurvey(navigate: ReturnType<typeof useNavigate>) {
  try {
    const status = await preferenceService.getSurveyStatus()
    if (!status.hasCompleted) {
      navigate('/preferences', { replace: true })
    }
  } catch (e) {
    console.warn('[Auth] survey status check failed (skipping redirect):', e)
  }
}

export function useAuthInit() {
  const setUser = useAuthStore((s) => s.setUser)
  const appUserId = useAuthStore((s) => s.appUserId)
  const navigate = useNavigate()
  const lastCheckedRef = useRef<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const idToken = await user.getIdToken()
          const res = await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
          setUser(user, idToken, res.data?.data?.user_id ?? null)
        } catch {
          setUser(user, await user.getIdToken())
        }
      } else {
        setUser(null, null)
      }
    })
    return unsub
  }, [setUser])

  // Watcher: mỗi lần appUserId thay đổi (login mới, xoá-rồi-login lại, reload trang khi
  // session còn) → check survey và redirect /preferences nếu chưa hoàn thành. Ref để
  // tránh check lặp cho cùng 1 user trong cùng phiên.
  useEffect(() => {
    if (!appUserId) {
      lastCheckedRef.current = null
      return
    }
    if (lastCheckedRef.current === appUserId) return
    lastCheckedRef.current = appUserId
    redirectIfNoSurvey(navigate)
  }, [appUserId, navigate])
}

export function useLoginActions() {
  const closeLoginDrawer = useAuthStore((s) => s.closeLoginDrawer)
  const setUser = useAuthStore((s) => s.setUser)
  const navigate = useNavigate()

  const loginEmail = async (email: string, password: string) => {
    const { user } = await signInWithEmailAndPassword(auth, email, password)
    const idToken = await user.getIdToken()
    const res = await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
    setUser(user, idToken, res.data?.data?.user_id ?? null)
    closeLoginDrawer()
    toast.success('Đăng nhập thành công!')
    // Redirect → /preferences được xử lý bởi watcher trong useAuthInit khi appUserId đổi.
  }

  const registerEmail = async (email: string, password: string) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, password)
    const idToken = await user.getIdToken()
    const res = await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
    setUser(user, idToken, res.data?.data?.user_id ?? null)
    closeLoginDrawer()
    toast.success('Đăng ký thành công!')
    // Tài khoản mới chắc chắn chưa làm survey — redirect thẳng, không cần round-trip kiểm tra.
    navigate('/preferences', { replace: true })
  }

  const loginGoogle = async () => {
    const { user } = await signInWithPopup(auth, googleProvider)
    const idToken = await user.getIdToken()
    const res = await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
    setUser(user, idToken, res.data?.data?.user_id ?? null)
    closeLoginDrawer()
    toast.success('Đăng nhập thành công!')
    // Redirect → /preferences được xử lý bởi watcher trong useAuthInit khi appUserId đổi.
  }

  const logout = async () => {
    await signOut(auth)
    useAuthStore.getState().logout()
    toast.info('Đã đăng xuất')
  }

  return { loginEmail, registerEmail, loginGoogle, logout }
}
