import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, MapPin, Star, ArrowRight, PlusCircle, BookmarkIcon, Map, User } from 'lucide-react'
import { BellButton } from '@/components/notifications/BellButton'
import { landmarkService } from '@/services/landmarkService'
import type { LandmarkRecognitionResult } from '@/types'

type State = 'idle' | 'scanning' | 'result' | 'error'

export default function LandmarkPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>('idle')
  const [result, setResult] = useState<LandmarkRecognitionResult | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPreviewUrl(URL.createObjectURL(file))
    setState('scanning')
    try {
      const recognition = await landmarkService.recognize(file)
      setResult(recognition)
      setState('result')
    } catch {
      setState('error')
    }
  }

  const handleCapture = () => fileRef.current?.click()

  const handleReset = () => {
    setState('idle')
    setResult(null)
    setPreviewUrl(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="bg-slate-50 text-slate-900 font-sans min-h-screen">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

      {/* Header */}
      <header className="fixed top-0 w-full border-b-2 border-slate-100 bg-white z-50">
        <div className="flex justify-between items-center px-8 py-4 max-w-7xl mx-auto">
          <button onClick={() => navigate('/')} className="text-2xl font-bold tracking-tighter text-blue-600">
            Horizon
          </button>
          <nav className="hidden md:flex space-x-8">
            <button onClick={() => navigate('/')} className="text-slate-600 font-semibold hover:text-blue-500">Khám phá</button>
            <button onClick={() => navigate('/trips')} className="text-slate-600 font-semibold hover:text-blue-500">Chuyến đi</button>
          </nav>
          <div className="flex items-center space-x-4">
            <BellButton className="hover:text-blue-500 transition-colors relative" iconClassName="w-5 h-5 text-blue-600" />
            <button onClick={() => navigate('/profile')} className="hover:text-blue-500 transition-colors"><User className="w-5 h-5 text-blue-600" /></button>
          </div>
        </div>
      </header>

      {/* Camera / Scanner View */}
      <main className="relative h-screen w-full overflow-hidden flex flex-col items-center justify-center pt-16 pb-20">
        {/* Background */}
        <div className="absolute inset-0 z-0">
          {previewUrl ? (
            <img className="w-full h-full object-cover" src={previewUrl} alt="Captured" />
          ) : (
            <img
              className="w-full h-full object-cover grayscale-[0.2] contrast-125"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBvYzEP6vo77tfHPxRhOEdzGASF1-mLDcAER2eMWKRUIgcLmeiQDrKunT5ouYsVAkWmEodsB8BYkjmqwKf-9SX1waTSrmf0NP6NHzmSbaDH0POdByEhxDIJZH-Bdci_1dWUmWn_FeXYJeU9FuVyRSSWqQSRSLe8Qg8-2kcSWCXG9tKwil1UXQVgprz7lESBIXur1-fqIhkGpPXnelLK-IyC8EV59JaxXIghb3DBc6ZbT5IYhUzVk7zBX39XX-1FXsTCXIn-HopZWgg"
              alt="Camera background"
            />
          )}
          <div className="absolute inset-0 bg-black/20" />
        </div>

        {/* Scanner Frame */}
        {state !== 'result' && (
          <div className="relative z-10 w-72 h-72 md:w-96 md:h-96">
            {/* Corners */}
            <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-blue-500 rounded-tl-xl" />
            <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-blue-500 rounded-tr-xl" />
            <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-blue-500 rounded-bl-xl" />
            <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-blue-500 rounded-br-xl" />

            {/* Scanning line */}
            {state === 'scanning' && (
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent shadow-[0_0_15px_#0066ff] animate-bounce" style={{ animation: 'scanLine 2s linear infinite' }} />
            )}

            <Camera className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 text-white/40" />
          </div>
        )}

        {/* Status Badge */}
        {state === 'scanning' && (
          <div className="relative z-20 mt-6 bg-blue-600 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="font-bold text-sm">Đang phân tích ảnh...</span>
          </div>
        )}

        {state === 'idle' && (
          <div className="relative z-20 mt-8 flex flex-col items-center gap-4">
            <p className="text-white font-semibold text-lg drop-shadow">Hướng camera vào một danh lam thắng cảnh</p>
            <button
              onClick={handleCapture}
              className="bg-blue-600 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-xl hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
            >
              <Camera className="w-6 h-6" />
              Chụp ảnh nhận diện
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="relative z-20 mt-6 bg-red-600 text-white px-4 py-2 rounded-full shadow-lg">
            <span className="font-bold text-sm">Không nhận diện được. Thử lại với ảnh rõ hơn.</span>
          </div>
        )}

        {/* Result */}
        {state === 'result' && result && (
          <>
            <div className="relative z-20 mt-6 bg-blue-600 text-white px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
              <div className="w-4 h-4 flex items-center justify-center bg-white/20 rounded-full">✓</div>
              <span className="font-bold text-sm">Đã nhận diện: {result.place.name}</span>
            </div>

            <div className="relative z-30 w-full max-w-lg px-6 mt-4">
              <div className="bg-white rounded-xl shadow-2xl p-6 border-2 border-blue-100">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">{result.place.name}</h1>
                    <p className="text-blue-600 font-semibold text-sm mt-0.5">Danh lam thắng cảnh</p>
                  </div>
                  <div className="bg-slate-50 px-3 py-2 rounded-lg text-center">
                    <p className="text-xs text-slate-500">Độ chính xác</p>
                    <p className="font-bold text-blue-600 text-lg">{Math.round(result.confidence * 100)}%</p>
                  </div>
                </div>

                {result.place.rating > 0 && (
                  <div className="flex items-center gap-1 mb-3">
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-bold text-yellow-700">{result.place.rating.toFixed(1)}</span>
                  </div>
                )}

                {result.place.address && (
                  <div className="flex items-center text-xs text-slate-400 mb-4">
                    <MapPin className="w-4 h-4 mr-1 shrink-0" />
                    <span>{result.place.address}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => navigate('/plan')}
                    className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-bold text-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Thêm vào chuyến đi
                  </button>
                  <button
                    onClick={handleReset}
                    className="px-4 border-2 border-blue-200 text-blue-600 rounded-lg font-bold text-sm hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
                  >
                    Xem chi tiết <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {state === 'error' && (
          <button
            onClick={handleReset}
            className="relative z-20 mt-4 bg-white/90 text-slate-800 px-6 py-3 rounded-xl font-bold hover:bg-white transition-colors"
          >
            Thử lại
          </button>
        )}
      </main>

      {/* Bottom Navigation - Mobile */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 py-2 md:hidden bg-white border-t-2 border-slate-100 shadow-lg">
        <button onClick={() => navigate('/')} className="flex flex-col items-center text-slate-400">
          <Map className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Trang chủ</span>
        </button>
        <button onClick={() => navigate('/trips')} className="flex flex-col items-center text-slate-400">
          <BookmarkIcon className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Chuyến đi</span>
        </button>
        <div className="flex flex-col items-center text-blue-600 bg-blue-50 rounded-lg px-3 py-1">
          <Camera className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Nhận diện</span>
        </div>
        <button onClick={() => navigate('/profile')} className="flex flex-col items-center text-slate-400">
          <User className="w-5 h-5" />
          <span className="text-[10px] font-bold mt-0.5">Cá nhân</span>
        </button>
      </nav>

      <style>{`
        @keyframes scanLine {
          0% { top: 0%; }
          50% { top: calc(100% - 2px); }
          100% { top: 0%; }
        }
      `}</style>
    </div>
  )
}
