import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, Camera, MapPin, Calendar, BellRing, X, ArrowRight,
  PlusCircle, UserCircle,
} from 'lucide-react'
import { BellButton } from '@/components/notifications/BellButton'
import { useAuthStore } from '@/store/authStore'
import { tripService } from '@/services/tripService'
import { format, parseISO, differenceInDays } from 'date-fns'
import { vi } from 'date-fns/locale'

const EVENTS = [
  {
    id: 1,
    tag: 'LỄ HỘI VĂN HÓA',
    title: 'Đêm rằm Hội An',
    desc: 'Trải nghiệm không gian lung linh với hàng ngàn đèn lồng rực rỡ bên dòng sông Hoài thơ mộng.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBpQe4tigI4nF7cfh1bd0mgPicRauuhRGXhFcOciefTgV9FTCm5ahnpqiYs74mI2ILw4T5x5hxE0PMSih4iwK-T7sZpE1y8YWDTr463PQ1_i8EvtY8B8yJsrVHQo6pEpX8_o2uazzYSyeHaktkHkF9wJ7YzVZ-W2APv09D4oaPqMc0mcPbkcVpzSREMzyBMc0UveRcKgS0VwGR8RSjNIhWjd2poFQ3KsHrToVo7-pxsBuTlaiYzbHqylSzjFmQ2209Bu_x62aLHX18',
  },
  {
    id: 2,
    tag: 'LỄ HỘI HOA',
    title: 'Festival Hoa Đà Lạt',
    desc: 'Tận hưởng hương sắc cao nguyên với hàng ngàn loài hoa khoe sắc trong tiết trời se lạnh.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBb4uVTQ1k7x7ZVLWGT2Fojbu-Xi1Ksc3vT5O7JuRelOuiOZRK2sHvJxtswyNYKsTgr_lTA6dpVfr3RcJq1NyAnIoOahbvC2Yh5L3pEdMsvpd6_ne9kcoHTKYJitnDv_V8Bl-oxMQK039B9q2LPBWCN7Kqs46-iTrS79iv80K6315hBIZ25f5np_ypvzqpr5w7vUzofnZNICoAGpOfLqMqndkoXlBfMOq6t1PDYAiEcdHoU6MyXIsmVODCg4mldytIghtb90m7Nujw',
  },
  {
    id: 3,
    tag: 'TRUYỀN THỐNG',
    title: 'Giỗ Tổ Đền Hùng',
    desc: 'Hướng về nguồn cội với nghi lễ trang trọng tại vùng đất tổ linh thiêng Phú Thọ.',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCU5M94vXn0ekXLdLuauYZkBIH7VQfB-36dwdjdQiXQ5sj1esu4Kbze5p0hbOtYI5qPz3sKO7Tmq5g4VeEmbbpbyBcLtJXV7ysz3bBLtbuCvPW98ehTVuNAvEPg3AuJ9wwBSiga52VHd_VGhc1XooQdniYmjf3N8FfdzrMrJUhthCscpdTU-aFOi5uiPRXshKyLKpqzFkNqPpompIPuLR-c3svmIIQplnPOC1srw0yD-RT2gL-AfPaY7_8N2UWEzLaqMprbNlXq4hQ',
  },
]

const DESTINATIONS = [
  {
    id: 1, name: 'Vịnh Hạ Long', sub: 'Di sản Thiên nhiên Thế giới',
    desc: 'Kỳ quan thiên nhiên thế giới với hàng ngàn đảo đá vôi kỳ vĩ.', tag: 'DI SẢN THẾ GIỚI',
    big: true,
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA_MiHf3tXxadAdvXOW5sxH3HIvM4VV-k1hEYLtozGQyFSmIfBbdmPX0-UUraGO7a5Yn1jo0-4UFz2bQKV5oFFM5aSkn4ycmzAci9IwrXCpZLOeXd5HFpFHFC2TdtiQmf42BdUkvf9d00FYinqthBb_pbTX85gEElmvhgel8jT3g7Npcbl4tJviXzcYNrBjDOj9LQgrDs8qD1dZIiRLWbQA_b537WQVu6NPv_Voje1fr-Z_H2jDylUWohaF-lkPeZwbDlmPTzNeb4k',
  },
  {
    id: 2, name: 'Phú Quốc', sub: 'Đảo Ngọc thiên đường',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB4iyn5dlKlOavsVjzi6rzFdpXyuPCHx0ga6sXtveKjW2DSANqDpplnxfiymhLBukfoJNnVZmr2HKprGNepsQpiBsNPWKMSzXLOtCmvBpJploBHSvnIXF6GvyZFngOnyhmAKYVuwlhJiSHJahEgbnil2byMpfgzk5kiqqlpxcpThb4UMuE2Fmsg622qsiy43oqVjrvlU6vjRJQmshaDn1dEf3ZsdUvs1vRDU5gyn9ogdoZUs2ZOzM-SDUvj44qV5YKpWB1vpiuXRPc',
  },
  {
    id: 3, name: 'Sa Pa', sub: 'Thành phố trong sương',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxXIie7LQ-372AUk50Qjp8vVUxXAqW_WSgsWnhJFSzBysT4fOrfMKy-AyceuXCcIh9jUdjd57FIH0o7abWaL2TeGMCvI5gyj7faWzJeJNmbCksUsRoPSx5TIczaIpr8kvMlaadOUTcNrRCuv7gxHWEbRwHHY7uX0dpkot8XW3oGVnZAkg7vnYSlMO8rtmRdQsYiZUCW9Oak1NFyTXchNNnBZDqObozsOIFPMq5AFLi6WOkzn3T2uVWbNDJ5HxkZpFqMWMYdJbuu98',
  },
  {
    id: 4, name: 'Đà Nẵng', sub: 'Thành phố của những cây cầu', wide: true,
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAGKOaVfXOpqS_ebQpgsplVmH6bsVqoDUAZtuOmobDk6lL7iX-qkILpQdO2B0xZgi4txJWiv67yzxGNdFN4kATSdsrp3mWmrcLikiLolqqiVhd124zDUaN8-pcmH1MRaV2nWkZN0FVHvHLmQFh5bgxV83jJsez6R_zpn_XoGVmvc2HViUMhO31ZxNkWBckfyjgDi8r53XaRPLNLPqB6e5s_Y5nNyfP9E9kWIYmaG6hXrrG3OnOCf-iNyUM4EZrB5HZYJURcjbxtyHE',
  },
]

export default function Home() {
  const navigate = useNavigate()
  const { user, openLoginDrawer } = useAuthStore()
  const [notifDismissed, setNotifDismissed] = useState(false)
  const [destination, setDestination] = useState('')

  const { data: trips } = useQuery({
    queryKey: ['trips'],
    queryFn: tripService.list,
    enabled: !!user,
  })

  const upcomingTrip = trips?.find((t) => {
    const daysUntil = differenceInDays(parseISO(t.startDate), new Date())
    return (t.status === 'confirmed' || t.status === 'active') && daysUntil >= 0 && daysUntil <= 7
  })

  const handleSearch = () => {
    navigate(`/plan${destination ? `?q=${encodeURIComponent(destination)}` : ''}`)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b-2 border-slate-100 bg-white">
        <nav className="flex justify-between items-center h-20 px-8 max-w-[1280px] mx-auto">
          <div className="text-2xl font-black tracking-tight text-slate-900">Horizon</div>

          <div className="hidden md:flex items-center gap-8">
            <span className="text-blue-600 border-b-2 border-blue-600 font-bold pb-1">Home</span>
            <button onClick={() => navigate('/destinations')} className="text-slate-700 font-semibold hover:text-blue-600 transition-colors">Điểm đến</button>
            <button onClick={() => navigate('/events')} className="text-slate-700 font-semibold hover:text-blue-600 transition-colors">Sự kiện</button>
            <button onClick={() => navigate('/about')} className="text-slate-700 font-semibold hover:text-blue-600 transition-colors">Giới thiệu</button>
            <Link to="/trips" className="text-slate-700 font-semibold hover:text-blue-600 transition-colors">
              Chuyến đi của tôi
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {user && <BellButton />}
            {user ? (
              <button
                onClick={() => navigate('/profile')}
                className="p-1 rounded-full hover:bg-slate-100 transition-colors"
                aria-label="Trang cá nhân"
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full border-2 border-blue-200" />
                ) : (
                  <UserCircle className="w-9 h-9 text-slate-500" />
                )}
              </button>
            ) : (
              <button
                onClick={openLoginDrawer}
                className="flex items-center gap-2 bg-white text-slate-700 border-2 border-slate-200 px-5 py-2.5 rounded-lg font-bold hover:bg-slate-50 hover:border-slate-300 active:scale-95 transition-all"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Đăng nhập
              </button>
            )}
            <button
              onClick={() => navigate('/plan')}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-blue-700 active:scale-95 transition-all"
            >
              Tạo chuyến đi
            </button>
          </div>
        </nav>
      </header>

      <main className="pt-20">
        {/* Notification Banner */}
        {user && upcomingTrip && !notifDismissed && (
          <section className="max-w-[1280px] mx-auto px-8 pt-6 pb-2">
            <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-lg shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-blue-600/10 p-2 rounded-full">
                  <BellRing className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 leading-tight">Bạn có một chuyến đi sắp tới!</h4>
                  <p className="text-slate-600 text-sm">
                    Chuyến đi {upcomingTrip.destinationCity} khởi hành{' '}
                    {format(parseISO(upcomingTrip.startDate), 'dd/MM/yyyy', { locale: vi })}.
                    Đừng quên chuẩn bị hành lý nhé!
                  </p>
                </div>
              </div>
              <div className="flex gap-3 shrink-0">
                <button
                  onClick={() => navigate(`/trip/${upcomingTrip.tripId}`)}
                  className="text-blue-600 font-bold text-sm hover:underline"
                >
                  Xem chi tiết
                </button>
                <button
                  onClick={() => setNotifDismissed(true)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Hero */}
        <section className="relative h-[870px] flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img
              alt="Vietnam Landscape"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCVwnFLNRKkJaXBdYGtLTMjB6R3KfOF_y1rfbD3B-NzlL_SAtierH0gB0-RhaoRwXYoPEMYCR7-wQYK_iLLTHS2BE5qc2VEQE0QV2vh1RdnWcqz8zIAI9_duBq6jrfk7-5Zxp7rpMLWXbzWBY88T3PHBnK3hbymgTfqmV7oUTpYB9q2HUYeGZGS5GO8hGvrKRM9fDrDbkhO3caffyrVFmCO9fPlqd7UgmdXGe-MAgFq_67uqe4wX27hqrWoNIiozL_qihVmIzoaw5s"
            />
            <div className="absolute inset-0 bg-black/20" />
          </div>
          <div className="relative z-10 w-full max-w-4xl px-8 text-center">
            <h1 className="text-5xl font-extrabold text-white mb-8 drop-shadow-lg leading-tight tracking-tight">
              Khám phá vẻ đẹp bất tận của Việt Nam
            </h1>
            <div className="bg-white p-4 rounded-xl shadow-2xl flex flex-col md:flex-row items-center gap-4 border-2 border-blue-600">
              <div className="flex-1 flex items-center gap-3 px-4 w-full border-b md:border-b-0 md:border-r border-slate-200 py-2">
                <MapPin className="w-5 h-5 text-blue-600 shrink-0" />
                <input
                  className="w-full border-none focus:ring-0 font-semibold text-slate-800 placeholder:text-slate-400 outline-none bg-transparent"
                  placeholder="Bạn muốn đi đâu?"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div className="flex-1 flex items-center gap-3 px-4 w-full border-b md:border-b-0 md:border-r border-slate-200 py-2">
                <Calendar className="w-5 h-5 text-blue-600 shrink-0" />
                <input
                  className="w-full border-none focus:ring-0 font-semibold text-slate-800 placeholder:text-slate-400 outline-none bg-transparent"
                  placeholder="Thời gian"
                  type="text"
                />
              </div>
              <button
                onClick={() => navigate('/landmark')}
                className="w-full md:w-auto border-2 border-blue-600 text-blue-600 px-6 py-4 rounded-lg font-bold text-base flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors whitespace-nowrap"
              >
                <Camera className="w-5 h-5" />
                Nhận diện danh lam
              </button>
              <button
                onClick={handleSearch}
                className="w-full md:w-auto bg-blue-600 text-white px-10 py-4 rounded-lg font-bold text-base flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
              >
                <Search className="w-5 h-5" />
                Tìm kiếm
              </button>
            </div>
          </div>
        </section>

        {/* Events */}
        <section className="max-w-[1280px] mx-auto px-8 py-16">
          <div className="flex justify-between items-end mb-10">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-2">Sự kiện nổi bật</h2>
              <p className="text-slate-500 text-lg">Hòa mình vào không gian văn hóa truyền thống</p>
            </div>
            <button onClick={() => navigate('/events')} className="text-blue-600 font-bold flex items-center gap-1 hover:underline">
              Xem tất cả <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {EVENTS.map((ev) => (
              <div key={ev.id} className="group cursor-pointer">
                <div className="relative overflow-hidden rounded-xl aspect-[4/5] mb-4 border border-slate-200 shadow-sm transition-transform group-hover:scale-[1.02]">
                  <img className="w-full h-full object-cover" src={ev.img} alt={ev.title} />
                  <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full font-bold text-xs text-blue-600">
                    {ev.tag}
                  </div>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{ev.title}</h3>
                <p className="text-slate-500 line-clamp-2">{ev.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Popular Destinations */}
        <section className="bg-slate-100 py-16">
          <div className="max-w-[1280px] mx-auto px-8">
            <div className="mb-10">
              <h2 className="text-3xl font-bold text-slate-900 mb-2">Điểm đến phổ biến</h2>
              <p className="text-slate-500 text-lg">Những địa danh không thể bỏ qua tại Việt Nam</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* Ha Long - big card */}
              <div className="md:col-span-2 md:row-span-2 relative group overflow-hidden rounded-xl h-[600px] border-2 border-white shadow-lg">
                <img className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" src={DESTINATIONS[0].img} alt={DESTINATIONS[0].name} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 p-8">
                  <span className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold mb-2 inline-block">{DESTINATIONS[0].tag}</span>
                  <h3 className="text-white text-3xl font-bold mb-2">{DESTINATIONS[0].name}</h3>
                  <p className="text-white/80 text-base mb-4">{DESTINATIONS[0].desc}</p>
                  <button
                    onClick={() => navigate('/plan')}
                    className="bg-white text-slate-900 px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-slate-100"
                  >
                    Khám phá ngay
                  </button>
                </div>
              </div>
              {/* Phu Quoc */}
              <div className="relative group overflow-hidden rounded-xl h-[288px] border-2 border-white shadow-lg">
                <img className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" src={DESTINATIONS[1].img} alt={DESTINATIONS[1].name} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-0 left-0 p-6">
                  <h3 className="text-white text-xl font-bold">{DESTINATIONS[1].name}</h3>
                  <p className="text-white/80 text-sm">{DESTINATIONS[1].sub}</p>
                </div>
              </div>
              {/* Sa Pa */}
              <div className="relative group overflow-hidden rounded-xl h-[288px] border-2 border-white shadow-lg">
                <img className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" src={DESTINATIONS[2].img} alt={DESTINATIONS[2].name} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-0 left-0 p-6">
                  <h3 className="text-white text-xl font-bold">{DESTINATIONS[2].name}</h3>
                  <p className="text-white/80 text-sm">{DESTINATIONS[2].sub}</p>
                </div>
              </div>
              {/* Da Nang - wide */}
              <div className="md:col-span-2 relative group overflow-hidden rounded-xl h-[288px] border-2 border-white shadow-lg">
                <img className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" src={DESTINATIONS[3].img} alt={DESTINATIONS[3].name} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-0 left-0 p-6">
                  <h3 className="text-white text-xl font-bold">{DESTINATIONS[3].name}</h3>
                  <p className="text-white/80 text-sm">{DESTINATIONS[3].sub}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-[1280px] mx-auto px-8 py-16">
          <div className="bg-blue-600 rounded-2xl p-10 flex flex-col md:flex-row items-center justify-between gap-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24 pointer-events-none" />
            <div className="relative z-10 text-center md:text-left">
              <h2 className="text-white text-3xl font-bold mb-4">Sẵn sàng cho chuyến đi của riêng bạn?</h2>
              <p className="text-white/90 text-lg max-w-xl">
                Lên kế hoạch chi tiết, đặt chỗ và tận hưởng kỳ nghỉ mơ ước chỉ trong vài phút.
              </p>
            </div>
            <div className="relative z-10 shrink-0">
              <button
                onClick={() => navigate('/plan')}
                className="bg-white text-blue-600 px-10 py-5 rounded-xl font-extrabold text-xl shadow-xl hover:scale-105 transition-transform flex items-center gap-3"
              >
                <PlusCircle className="w-7 h-7" />
                Tạo chuyến đi mới
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200 bg-slate-50">
        <div className="py-12 px-8 flex flex-col md:flex-row justify-between items-start md:items-center max-w-[1280px] mx-auto text-sm">
          <div className="mb-8 md:mb-0">
            <div className="text-xl font-bold text-slate-900 mb-4">Horizon</div>
            <p className="text-slate-600 max-w-xs mb-4">Khám phá Việt Nam theo cách của bạn. Dependable travel companion for every explorer.</p>
            <p className="text-slate-600">© 2024 Horizon Travel. Built for the adventurous.</p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-4">
            <a href="#" className="text-slate-600 hover:text-slate-900 underline">Privacy Policy</a>
            <a href="#" className="text-slate-600 hover:text-slate-900 underline">Terms of Service</a>
            <a href="#" className="text-slate-600 hover:text-slate-900 underline">Support</a>
            <a href="#" className="text-slate-600 hover:text-slate-900 underline">Careers</a>
          </div>
        </div>
      </footer>

      {/* FAB - mobile */}
      <button
        onClick={() => navigate('/plan')}
        className="fixed bottom-8 right-8 bg-blue-600 text-white w-16 h-16 rounded-full shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-40 md:hidden"
        aria-label="Tạo chuyến đi"
      >
        <PlusCircle className="w-6 h-6" />
      </button>
    </div>
  )
}
