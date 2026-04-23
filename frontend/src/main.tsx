import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App'
import { toast } from '@/store/toastStore'

// Fix leaflet default marker icons
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
// @ts-expect-error – _getIconUrl is internal Leaflet API
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: unknown) => {
      const msg = (error as { message?: string })?.message ?? 'Lỗi tải dữ liệu'
      // Bỏ qua lỗi 401/403 (đã xử lý ở interceptor)
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status !== 401 && status !== 403) {
        toast.error(msg)
      }
    },
  }),
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
