import { useAuthStore } from '@/store/authStore'
import { PageSpinner } from '@/components/ui/Spinner'

interface Props { children: React.ReactNode; fallback?: React.ReactNode }

export function ProtectedRoute({ children, fallback }: Props) {
  const { user, isLoading } = useAuthStore()
  if (isLoading) return <PageSpinner />
  if (!user) return fallback ? <>{fallback}</> : null
  return <>{children}</>
}
