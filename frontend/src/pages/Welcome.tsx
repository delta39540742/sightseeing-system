import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Map, Sparkles, Smartphone, ChevronRight, LogIn } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'

const slides = [
  {
    icon: <Sparkles className="w-12 h-12 text-blue-500" />,
    title: 'Lập kế hoạch bằng ngôn ngữ tự nhiên',
    desc: 'Chỉ cần gõ "3 ngày ở Đà Lạt, thích cà phê và núi rừng, budget 3 triệu" — AI sẽ tạo lịch trình chi tiết cho bạn ngay lập tức.',
  },
  {
    icon: <Map className="w-12 h-12 text-emerald-500" />,
    title: 'Kéo thả, tùy chỉnh tự do',
    desc: 'Kéo địa điểm để thay đổi thứ tự, chuyển sang ngày khác. Hệ thống tự động phát hiện xung đột về thời gian và giờ mở cửa.',
  },
  {
    icon: <Smartphone className="w-12 h-12 text-violet-500" />,
    title: 'Chuyển sang điện thoại ngay lập tức',
    desc: 'Quét mã QR để đồng bộ kế hoạch sang điện thoại, hoặc xuất sang Google Maps với một nút bấm. Không cần đăng nhập.',
  },
]

export default function Welcome() {
  const [slide, setSlide] = useState(0)
  const navigate = useNavigate()
  const { user, openLoginDrawer } = useAuthStore()

  useEffect(() => {
    if (user) {
      navigate('/', { replace: true })
    }
  }, [user, navigate])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col items-center justify-center p-6 relative">
      {/* Nút đăng nhập ở góc */}
      <div className="absolute top-6 right-6">
        <button 
          onClick={openLoginDrawer}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white/80 backdrop-blur rounded-full shadow-sm hover:bg-gray-50 transition-colors"
        >
          <LogIn className="w-4 h-4" />
          Đăng nhập
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">✈️ TravelSystem</h1>
          <p className="text-gray-500 mt-2 text-sm">Gợi ý du lịch thông minh, cá nhân hóa</p>
        </div>

        <div className="card p-8 mb-6 min-h-[280px] flex flex-col items-center justify-center text-center transition-all">
          <div className="mb-4">{slides[slide].icon}</div>
          <h2 className="text-lg font-bold text-gray-900 mb-3">{slides[slide].title}</h2>
          <p className="text-gray-500 text-sm leading-relaxed">{slides[slide].desc}</p>
        </div>

        <div className="flex justify-center gap-2 mb-6">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              aria-label={`Slide ${i + 1}`}
              className={`rounded-full transition-all ${i === slide ? 'w-6 h-2 bg-blue-500' : 'w-2 h-2 bg-gray-300'}`}
            />
          ))}
        </div>

        <div className="space-y-3">
          {slide < slides.length - 1 ? (
            <button onClick={() => setSlide((s) => s + 1)} className="btn-primary w-full py-3">
              Tiếp theo <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={openLoginDrawer} className="btn-primary w-full py-3">
              ✨ Bắt đầu lập kế hoạch
            </button>
          )}
          <button
            onClick={() => setSlide(slides.length - 1)}
            className={`text-sm text-gray-400 hover:text-gray-600 w-full text-center ${slide === slides.length - 1 ? 'invisible' : ''}`}
          >
            Bỏ qua
          </button>
        </div>
      </div>
    </div>
  )
}
