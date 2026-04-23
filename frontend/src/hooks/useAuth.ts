import { useEffect } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '@/config/firebase'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/services/api'
import { toast } from '@/store/toastStore'

export function useAuthInit() {
  const { setUser, setLoading } = useAuthStore()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const idToken = await user.getIdToken()
          await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
          setUser(user, idToken)
        } catch {
          setUser(user, await user.getIdToken())
        }
      } else {
        setUser(null, null)
      }
    })
    return unsub
  }, [setUser])
}

export function useLoginActions() {
  const { closeLoginDrawer, setUser } = useAuthStore()

  const loginEmail = async (email: string, password: string) => {
    const { user } = await signInWithEmailAndPassword(auth, email, password)
    const idToken = await user.getIdToken()
    await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
    setUser(user, idToken)
    closeLoginDrawer()
    toast.success('Đăng nhập thành công!')
  }

  const loginGoogle = async () => {
    const { user } = await signInWithPopup(auth, googleProvider)
    const idToken = await user.getIdToken()
    await api.post('/auth/login', {}, { headers: { Authorization: `Bearer ${idToken}` } })
    setUser(user, idToken)
    closeLoginDrawer()
    toast.success('Đăng nhập thành công!')
  }

  const logout = async () => {
    await signOut(auth)
    useAuthStore.getState().logout()
    toast.info('Đã đăng xuất')
  }

  return { loginEmail, loginGoogle, logout }
}
