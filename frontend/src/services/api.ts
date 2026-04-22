import axios from 'axios'
import { useAuthStore } from '@/store/authStore'

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
  (err) => {
    if (err.response?.status === 401) useAuthStore.getState().logout()
    return Promise.reject(err)
  },
)
