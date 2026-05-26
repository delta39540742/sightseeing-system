import { create } from 'zustand'

interface NotificationDrawerState {
  open: boolean
  show: () => void
  hide: () => void
  toggle: () => void
}

export const useNotificationDrawer = create<NotificationDrawerState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
