import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationService, type NotificationListResponse } from '@/services/notificationService'
import { useAuthStore } from '@/store/authStore'

const NOTIFICATIONS_KEY = ['notifications'] as const

export function useNotifications() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)

  const { data, isLoading, refetch } = useQuery<NotificationListResponse>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => notificationService.list({ limit: 50 }),
    enabled: !!user,
    // Poll mỗi 30s để bell badge cập nhật mà không cần WebSocket
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
      const previous = queryClient.getQueryData<NotificationListResponse>(NOTIFICATIONS_KEY)
      if (previous) {
        const now = new Date().toISOString()
        queryClient.setQueryData<NotificationListResponse>(NOTIFICATIONS_KEY, {
          items: previous.items.map((n) =>
            n.notificationId === id && !n.readAt ? { ...n, readAt: now } : n,
          ),
          unreadCount: Math.max(0, previous.unreadCount - (previous.items.find((n) => n.notificationId === id && !n.readAt) ? 1 : 0)),
        })
      }
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(NOTIFICATIONS_KEY, ctx.previous)
    },
  })

  const markAllRead = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
      const previous = queryClient.getQueryData<NotificationListResponse>(NOTIFICATIONS_KEY)
      if (previous) {
        const now = new Date().toISOString()
        queryClient.setQueryData<NotificationListResponse>(NOTIFICATIONS_KEY, {
          items: previous.items.map((n) => (n.readAt ? n : { ...n, readAt: now })),
          unreadCount: 0,
        })
      }
      return { previous }
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(NOTIFICATIONS_KEY, ctx.previous)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => notificationService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })

  const clear = useMutation({
    mutationFn: () => notificationService.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })

  return {
    items: data?.items ?? [],
    unreadCount: data?.unreadCount ?? 0,
    isLoading,
    refetch,
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
    remove: remove.mutate,
    clear: clear.mutate,
  }
}
