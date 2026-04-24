import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScanLine, AlertCircle } from 'lucide-react'
import { CameraCapture } from './CameraCapture'
import { LandmarkResult } from './LandmarkResult'
import { landmarkService } from '@/services/landmarkService'
import { tripService } from '@/services/tripService'
import type { LandmarkRecognitionResult } from '@/types'

type State = 'idle' | 'uploading' | 'result' | 'adding' | 'done' | 'error'

interface LandmarkRecognizerProps {
  tripId?: string
  onProposalCreated?: (proposalId: string) => void
}

export function LandmarkRecognizer({ tripId, onProposalCreated }: LandmarkRecognizerProps) {
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState<LandmarkRecognitionResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedTripId, setSelectedTripId] = useState<string | null>(tripId || null)
  const { data: trips } = useQuery({
    queryKey: ['active-trips'],
    queryFn: () => tripService.list(),
    enabled: !tripId
  })

  const handleCapture = async (file: File) => {
    setState('uploading')
    setErrorMsg('')
    try {
      const recognition = await landmarkService.recognize(file)
      setResult(recognition)
      setState('result')
    } catch {
      setErrorMsg('Không thể nhận diện ảnh. Hãy thử lại với ảnh rõ hơn.')
      setState('error')
    }
  }

  const handleAddToTrip = async () => {
    if (!result) return
    const targetTripId = tripId || selectedTripId
    if (!targetTripId) {
      setErrorMsg('Vui lòng chọn chuyến đi')
      setState('error')
      return
    }
    setState('adding')
    try {
      const { proposalId } = await landmarkService.addToTrip(result.recognitionId, targetTripId)
      setState('done')
      onProposalCreated?.(proposalId)
    } catch {
      setErrorMsg('Không thể thêm địa điểm. Thử lại sau.')
      setState('error')
    }
  }

  const reset = () => {
    setState('idle')
    setResult(null)
    setErrorMsg('')
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ScanLine className="w-5 h-5 text-blue-600" />
        <h2 className="font-semibold text-gray-900">Nhận diện địa điểm</h2>
      </div>

      {(state === 'idle' || state === 'uploading') && (
        <>
          <p className="text-sm text-gray-500">Chụp ảnh hoặc upload ảnh địa điểm để nhận diện.</p>
          <CameraCapture onCapture={(file) => void handleCapture(file)} />
          {state === 'uploading' && (
            <div className="flex items-center justify-center gap-2 text-sm text-blue-600 py-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Đang nhận diện…
            </div>
          )}
        </>
      )}

      {(state === 'result' || state === 'adding' || state === 'done') && result && (
        <div className="space-y-4">
          <LandmarkResult
            result={result}
            onAddToTrip={() => void handleAddToTrip()}
            isAdding={state === 'adding'}
            added={state === 'done'}
          />
          
          {!tripId && state !== 'done' && state !== 'adding' && (
            <div className="mt-4 p-4 border border-gray-200 rounded-xl">
              <label className="block text-sm font-medium text-gray-700 mb-2">Chọn chuyến đi để thêm</label>
              <select 
                className="w-full border-gray-300 rounded-lg p-2.5 text-sm focus:ring-blue-500 focus:border-blue-500"
                value={selectedTripId || ''}
                onChange={e => setSelectedTripId(e.target.value)}
              >
                <option value="">-- Chọn chuyến đi --</option>
                {trips?.filter((t) => t.status === 'active' || t.status === 'draft').map((t) => (
                  <option key={t.tripId} value={t.tripId}>{t.title || t.destinationCity}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-xl px-4 py-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">{errorMsg}</p>
          </div>
          <button onClick={reset} className="btn-secondary w-full">
            Thử lại
          </button>
        </div>
      )}
    </div>
  )
}
