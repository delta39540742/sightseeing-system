import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/authStore'

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean }

export const api = axios.create({ baseURL: '/api' })
export const prefApi = axios.create({ baseURL: '/pref/api' })

api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().idToken
  const user = useAuthStore.getState().user
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  if (user?.uid) cfg.headers['x-user-id'] = user.uid
  return cfg
})

prefApi.interceptors.request.use((cfg) => {
  const user = useAuthStore.getState().user
  if (user?.uid) cfg.headers['x-user-id'] = user.uid
  return cfg
})

api.interceptors.response.use(
  (r) => r,
  async (err: unknown) => {
    const axiosErr = err as import('axios').AxiosError
    const config = axiosErr.config as RetryConfig | undefined

    if (axiosErr.response?.status === 401 && config && !config._retried) {
      config._retried = true
      try {
        // Dynamic import tránh circular dependency
        const { auth } = await import('@/config/firebase')
        const firebaseUser = auth.currentUser
        if (firebaseUser) {
          const fresh = await firebaseUser.getIdToken(true)
          // Cập nhật store với token mới — setUser nhận (user, idToken)
          useAuthStore.getState().setUser(firebaseUser, fresh)
          config.headers = config.headers ?? {}
          config.headers.Authorization = `Bearer ${fresh}`
          config.headers['x-user-id'] = firebaseUser.uid
          return api.request(config)
        }
      } catch {
        // Token refresh thất bại → logout
      }
      useAuthStore.getState().logout()
    }
    return Promise.reject(err)
  },
)
