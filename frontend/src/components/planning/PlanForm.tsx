import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { MapPin, Calendar, DollarSign, Navigation } from 'lucide-react'
import type { ParsedNLPResult, PlanRequest } from '@/types'

const STYLES = [
  'Khám phá thiên nhiên', 'Ẩm thực đường phố', 'Văn hóa lịch sử',
  'Nghỉ dưỡng', 'Chụp ảnh', 'Mua sắm',
]

interface PlanFormProps {
  parsed: ParsedNLPResult | null
  onSubmit: (req: PlanRequest) => void
  onGPS: () => void
  onMapClick: () => void
  startPoint?: [number, number]
  isLoading?: boolean
}

export function PlanForm({ parsed, onSubmit, onGPS, onMapClick, startPoint, isLoading }: PlanFormProps) {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<PlanRequest>({
    defaultValues: {
      destinationCity: '',
      startDate: '',
      endDate: '',
      budgetTotal: 3_000_000,
      preferences: [],
      numPeople: 1,
    },
  })

  useEffect(() => {
    if (!parsed) return
    setValue('destinationCity', parsed.destinationCity)
    setValue('startDate', parsed.startDate)
    setValue('endDate', parsed.endDate)
    setValue('budgetTotal', parsed.budget)
    setValue('preferences', parsed.styles)
    setValue('numPeople', parsed.numPeople || 1)
  }, [parsed, setValue])

  useEffect(() => {
    if (startPoint) {
      setValue('startLat', startPoint[0])
      setValue('startLng', startPoint[1])
    }
  }, [startPoint, setValue])

  const prefs = watch('preferences') ?? []

  const toggleStyle = (s: string) => {
    const current = prefs
    setValue('preferences', current.includes(s) ? current.filter((x) => x !== s) : [...current, s])
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-1">
          <MapPin className="w-3.5 h-3.5" /> Điểm đến
        </label>
        <input
          {...register('destinationCity', { required: 'Bắt buộc' })}
          className="input"
          placeholder="Đà Nẵng, Đà Lạt, Hội An…"
        />
        {errors.destinationCity && <p className="text-xs text-red-500 mt-1">{errors.destinationCity.message}</p>}
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-1">
          Số người
        </label>
        <input
          type="number"
          {...register('numPeople', { valueAsNumber: true, min: 1, max: 20 })}
          className="input"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-1">
            <Calendar className="w-3.5 h-3.5" /> Ngày đi
          </label>
          <input type="date" {...register('startDate', { required: 'Bắt buộc' })} className="input" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-1">
            <Calendar className="w-3.5 h-3.5" /> Ngày về
          </label>
          <input type="date" {...register('endDate', { required: 'Bắt buộc' })} className="input" />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-600 flex items-center gap-1 mb-1">
          <DollarSign className="w-3.5 h-3.5" />
          Ngân sách: {(watch('budgetTotal') / 1_000_000).toFixed(1)} triệu
        </label>
        <input
          type="range"
          {...register('budgetTotal', { valueAsNumber: true })}
          min={500_000}
          max={50_000_000}
          step={500_000}
          className="w-full accent-blue-500"
        />
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">Phong cách du lịch</p>
        <div className="flex flex-wrap gap-1.5">
          {STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleStyle(s)}
              className={`chip text-xs ${prefs.includes(s) ? 'chip-active' : 'chip-inactive'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
          <Navigation className="w-3.5 h-3.5" /> Điểm xuất phát
          {startPoint && <span className="text-green-600 ml-1">✓ Đã chọn</span>}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onGPS}
            className="btn-secondary flex-1 text-xs py-1.5"
          >
            📍 Lấy GPS
          </button>
          <button
            type="button"
            onClick={onMapClick}
            className="btn-secondary flex-1 text-xs py-1.5"
          >
            🗺 Chọn trên bản đồ
          </button>
        </div>
      </div>

      <button type="submit" disabled={isLoading} className="btn-primary w-full py-2.5">
        Tiếp theo
      </button>
    </form>
  )
}
