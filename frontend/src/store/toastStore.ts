import { create } from 'zustand'
import type { Toast } from '@/types'

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

let counter = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = String(++counter)
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = {
  success: (message: string, action?: Toast['action']) =>
    useToastStore.getState().push({ type: 'success', message, action }),
  error: (message: string, action?: Toast['action']) =>
    useToastStore.getState().push({ type: 'error', message, action }),
  warning: (message: string, action?: Toast['action']) =>
    useToastStore.getState().push({ type: 'warning', message, action }),
  info: (message: string, action?: Toast['action']) =>
    useToastStore.getState().push({ type: 'info', message, action }),
}
