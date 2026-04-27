import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from 'firebase/auth'

interface AuthState {
  user: User | null
  idToken: string | null
  appUserId: string | null
  isLoading: boolean
  loginDrawerOpen: boolean
  setUser: (user: User | null, idToken: string | null, appUserId?: string | null) => void
  setLoading: (v: boolean) => void
  openLoginDrawer: () => void
  closeLoginDrawer: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      idToken: null,
      appUserId: null,
      isLoading: true,
      loginDrawerOpen: false,
      setUser: (user, idToken, appUserId) => set({
        user, idToken, isLoading: false,
        ...(appUserId !== undefined ? { appUserId } : {}),
      }),
      setLoading: (isLoading) => set({ isLoading }),
      openLoginDrawer: () => set({ loginDrawerOpen: true }),
      closeLoginDrawer: () => set({ loginDrawerOpen: false }),
      logout: () => set({ user: null, idToken: null, appUserId: null }),
    }),
    {
      name: 'auth-store',
      partialize: (s) => ({ idToken: s.idToken }),
    },
  ),
)
