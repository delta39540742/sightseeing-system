import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Brain, RefreshCw, Camera, BarChart2, ShieldCheck } from 'lucide-react'

const FEATURES = [
  {
    Icon: Brain,
    title: 'Lên lịch thông minh',
    desc: 'Nhập yêu cầu bằng ngôn ngữ tự nhiên — hệ thống phân tích và tự động xây dựng hành trình tối ưu theo ngân sách, sở thích và thời gian.',
  },
  {
    Icon: MapPin,
    title: 'Gợi ý địa điểm phù hợp',
    desc: 'Kết hợp dữ liệu địa điểm, đánh giá cộng đồng và lịch sử cá nhân để đề xuất những nơi thực sự phù hợp với bạn.',
  },
  {
    Icon: RefreshCw,
    title: 'Điều chỉnh linh hoạt khi có thay đổi',
    desc: 'Nếu thời tiết xấu, địa điểm đóng cửa hay hành trình bị chậm — hệ thống tự động tính lại kế hoạch và đề xuất phương án thay thế.',
  },
  {
    Icon: Camera,
    title: 'Nhận diện danh lam tức thì',
    desc: 'Chụp ảnh bất kỳ công trình hay cảnh quan nào — ứng dụng nhận diện và tra cứu thông tin ngay lập tức.',
  },
  {
    Icon: BarChart2,
    title: 'Theo dõi chuyến đi trực tiếp',
    desc: 'Cập nhật tiến độ theo thời gian thực, theo dõi ngân sách đã dùng và nhận thông báo khi cần điều chỉnh lịch trình.',
  },
  {
    Icon: ShieldCheck,
    title: 'Cá nhân hóa theo từng người',
    desc: 'Hệ thống học từ sở thích và phản hồi của bạn qua từng chuyến đi, ngày càng hiểu bạn hơn.',
  },
]

export default function About() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b border-slate-200 bg-white">
        <div className="flex items-center h-16 px-6 max-w-[1280px] mx-auto gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-xl font-black tracking-tight text-slate-900">Horizon</span>
          <span className="text-slate-300 mx-1">|</span>
          <span className="font-bold text-slate-600">Giới thiệu</span>
          <div className="ml-auto">
            <button
              onClick={() => navigate('/plan')}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold hover:bg-blue-700 text-sm transition-colors"
            >
              Tạo chuyến đi
            </button>
          </div>
        </div>
      </header>

      <main className="pt-16">
        {/* Hero */}
        <section className="max-w-[760px] mx-auto px-8 py-20 text-center">
          <span className="inline-block bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-6">
            Trợ lý du lịch thông minh
          </span>
          <h1 className="text-5xl font-extrabold text-slate-900 leading-tight mb-6">
            Du lịch thông minh hơn,<br />không phải khó hơn
          </h1>
          <p className="text-lg text-slate-500 leading-relaxed max-w-xl mx-auto">
            Horizon giúp bạn lên kế hoạch chuyến đi hoàn chỉnh chỉ bằng vài câu mô tả — từ chọn điểm đến, sắp xếp lịch trình đến theo dõi và điều chỉnh khi có sự cố.
          </p>
        </section>

        {/* Divider */}
        <div className="max-w-[1280px] mx-auto px-8">
          <div className="border-t border-slate-100" />
        </div>

        {/* What we do */}
        <section className="max-w-[1280px] mx-auto px-8 py-16">
          <div className="max-w-[580px] mb-12">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Horizon làm được gì?</h2>
            <p className="text-slate-500">
              Một nền tảng kết hợp AI lên lịch trình, nhận diện địa danh và theo dõi chuyến đi — tất cả trong một ứng dụng.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div key={title} className="flex gap-4">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Divider */}
        <div className="max-w-[1280px] mx-auto px-8">
          <div className="border-t border-slate-100" />
        </div>

        {/* How it works */}
        <section className="max-w-[1280px] mx-auto px-8 py-16">
          <h2 className="text-2xl font-bold text-slate-900 mb-10">Cách hoạt động</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: '01', title: 'Mô tả chuyến đi', desc: 'Nhập yêu cầu bằng tiếng Việt tự nhiên: điểm đến, thời gian, ngân sách, sở thích.' },
              { step: '02', title: 'AI xây dựng hành trình', desc: 'Hệ thống chọn địa điểm, sắp xếp lịch theo giờ và tính toán chi phí tự động.' },
              { step: '03', title: 'Xác nhận và điều chỉnh', desc: 'Xem lịch trình trên bản đồ, thêm bớt địa điểm hoặc thay đổi thứ tự theo ý muốn.' },
              { step: '04', title: 'Theo dõi khi đi thực tế', desc: 'Cập nhật tiến độ, nhận thông báo điều chỉnh nếu có thay đổi trong hành trình.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="relative">
                <div className="text-5xl font-black text-slate-100 mb-3 select-none">{step}</div>
                <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="bg-slate-900 py-16 px-8">
          <div className="max-w-[640px] mx-auto text-center">
            <h2 className="text-3xl font-extrabold text-white mb-4">Bắt đầu chuyến đi đầu tiên</h2>
            <p className="text-slate-400 mb-8">
              Chỉ cần một câu mô tả — Horizon lo phần còn lại.
            </p>
            <button
              onClick={() => navigate('/plan')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-10 py-4 rounded-xl font-bold text-base transition-colors"
            >
              Tạo chuyến đi ngay
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 px-8 text-center text-sm text-slate-400">
        © 2026 Horizon Travel
      </footer>
    </div>
  )
}
