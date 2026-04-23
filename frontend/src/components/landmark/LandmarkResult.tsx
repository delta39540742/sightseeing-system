import { MapPin, Star, CheckCircle } from 'lucide-react'
import type { LandmarkRecognitionResult } from '@/types'

interface LandmarkResultProps {
  result: LandmarkRecognitionResult
  onAddToTrip: () => void
  isAdding: boolean
  added: boolean
}

export function LandmarkResult({ result, onAddToTrip, isAdding, added }: LandmarkResultProps) {
  const confidencePct = Math.round(result.confidence * 100)
  const confidenceColor = confidencePct >= 80 ? 'text-green-600' : confidencePct >= 50 ? 'text-amber-500' : 'text-red-500'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 text-lg">{result.place.name}</h3>
          <p className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
            <MapPin className="w-3.5 h-3.5" />
            {result.place.address}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold ${confidenceColor}`}>{confidencePct}%</p>
          <p className="text-xs text-gray-400">độ tin cậy</p>
        </div>
      </div>

      {result.place.rating > 0 && (
        <div className="flex items-center gap-1 text-sm text-amber-500">
          <Star className="w-4 h-4 fill-current" />
          <span className="font-medium">{result.place.rating.toFixed(1)}</span>
        </div>
      )}

      {result.isMock && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-1.5">
          Kết quả mô phỏng (dev mode)
        </p>
      )}

      {added ? (
        <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-xl px-4 py-3">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">Đã thêm vào lịch trình — đề xuất mới đang được tạo…</span>
        </div>
      ) : (
        <button
          onClick={onAddToTrip}
          disabled={isAdding}
          className="btn-primary w-full py-3 text-base"
        >
          {isAdding ? 'Đang thêm…' : '+ Thêm vào lịch trình'}
        </button>
      )}
    </div>
  )
}
