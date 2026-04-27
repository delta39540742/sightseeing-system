import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Search, Tag } from 'lucide-react'

interface Event {
  id: number
  tag: string
  category: 'le-hoi' | 'am-nhac' | 'am-thuc' | 'the-thao' | 'van-hoa' | 'du-lich'
  title: string
  desc: string
  date: string
  location: string
  img: string
}

const MOCK_EVENTS: Event[] = [
  {
    id: 1,
    tag: 'LỄ HỘI VĂN HÓA',
    category: 'le-hoi',
    title: 'Đêm rằm Hội An',
    desc: 'Trải nghiệm không gian lung linh với hàng ngàn đèn lồng rực rỡ bên dòng sông Hoài thơ mộng. Phố cổ trở nên huyền ảo trong ánh đèn màu sắc.',
    date: '12/05/2026',
    location: 'Phố cổ Hội An, Quảng Nam',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBpQe4tigI4nF7cfh1bd0mgPicRauuhRGXhFcOciefTgV9FTCm5ahnpqiYs74mI2ILw4T5x5hxE0PMSih4iwK-T7sZpE1y8YWDTr463PQ1_i8EvtY8B8yJsrVHQo6pEpX8_o2uazzYSyeHaktkHkF9wJ7YzVZ-W2APv09D4oaPqMc0mcPbkcVpzSREMzyBMc0UveRcKgS0VwGR8RSjNIhWjd2poFQ3KsHrToVo7-pxsBuTlaiYzbHqylSzjFmQ2209Bu_x62aLHX18',
  },
  {
    id: 2,
    tag: 'LỄ HỘI HOA',
    category: 'le-hoi',
    title: 'Festival Hoa Đà Lạt',
    desc: 'Tận hưởng hương sắc cao nguyên với hàng ngàn loài hoa khoe sắc trong tiết trời se lạnh. Sự kiện thường niên thu hút hàng triệu du khách.',
    date: '20/05/2026',
    location: 'Quảng trường Lâm Viên, Đà Lạt',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBb4uVTQ1k7x7ZVLWGT2Fojbu-Xi1Ksc3vT5O7JuRelOuiOZRK2sHvJxtswyNYKsTgr_lTA6dpVfr3RcJq1NyAnIoOahbvC2Yh5L3pEdMsvpd6_ne9kcoHTKYJitnDv_V8Bl-oxMQK039B9q2LPBWCN7Kqs46-iTrS79iv80K6315hBIZ25f5np_ypvzqpr5w7vUzofnZNICoAGpOfLqMqndkoXlBfMOq6t1PDYAiEcdHoU6MyXIsmVODCg4mldytIghtb90m7Nujw',
  },
  {
    id: 3,
    tag: 'TRUYỀN THỐNG',
    category: 'van-hoa',
    title: 'Giỗ Tổ Đền Hùng',
    desc: 'Hướng về nguồn cội với nghi lễ trang trọng tại vùng đất tổ linh thiêng Phú Thọ. Đây là ngày lễ quốc gia quan trọng của dân tộc Việt Nam.',
    date: '18/04/2026',
    location: 'Đền Hùng, Phú Thọ',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCU5M94vXn0ekXLdLuauYZkBIH7VQfB-36dwdjdQiXQ5sj1esu4Kbze5p0hbOtYI5qPz3sKO7Tmq5g4VeEmbbpbyBcLtJXV7ysz3bBLtbuCvPW98ehTVuNAvEPg3AuJ9wwBSiga52VHd_VGhc1XooQdniYmjf3N8FfdzrMrJUhthCscpdTU-aFOi5uiPRXshKyLKpqzFkNqPpompIPuLR-c3svmIIQplnPOC1srw0yD-RT2gL-AfPaY7_8N2UWEzLaqMprbNlXq4hQ',
  },
  {
    id: 4,
    tag: 'ÂM NHẠC',
    category: 'am-nhac',
    title: 'Monsoon Music Festival',
    desc: 'Liên hoan âm nhạc quốc tế lớn nhất Việt Nam với sự tham gia của các nghệ sĩ trong và ngoài nước. Sân khấu ngoài trời hoành tráng giữa lòng Hà Nội.',
    date: '05/09/2026',
    location: 'Hoàng Thành Thăng Long, Hà Nội',
    img: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&auto=format&fit=crop',
  },
  {
    id: 5,
    tag: 'ẨM THỰC',
    category: 'am-thuc',
    title: 'Lễ hội Ẩm thực Đường phố Hà Nội',
    desc: 'Hội tụ hàng trăm món ăn đường phố nổi tiếng của Hà Nội và cả nước. Cơ hội trải nghiệm văn hóa ẩm thực phong phú của người Việt.',
    date: '15/06/2026',
    location: 'Hồ Hoàn Kiếm, Hà Nội',
    img: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop',
  },
  {
    id: 6,
    tag: 'THỂ THAO',
    category: 'the-thao',
    title: 'Giải Marathon Quốc tế TP.HCM',
    desc: 'Giải chạy marathon quốc tế với các cự ly 5km, 10km, 21km và 42km qua các con đường đẹp nhất Sài Gòn. Hơn 10.000 vận động viên tham dự.',
    date: '26/10/2026',
    location: 'Dinh Thống Nhất, TP.HCM',
    img: 'https://images.unsplash.com/photo-1513593771513-7b58b6c4af38?w=800&auto=format&fit=crop',
  },
  {
    id: 7,
    tag: 'VĂN HÓA BIỂN',
    category: 'du-lich',
    title: 'Lễ hội Cầu Ngư Đà Nẵng',
    desc: 'Lễ hội dân gian của ngư dân miền Trung cầu mong mưa thuận gió hòa, biển lặng tôm đầy. Diễu hành thuyền rồng và các hoạt động văn nghệ truyền thống.',
    date: '08/07/2026',
    location: 'Bãi biển Mỹ Khê, Đà Nẵng',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAGKOaVfXOpqS_ebQpgsplVmH6bsVqoDUAZtuOmobDk6lL7iX-qkILpQdO2B0xZgi4txJWiv67yzxGNdFN4kATSdsrp3mWmrcLikiLolqqiVhd124zDUaN8-pcmH1MRaV2nWkZN0FVHvHLmQFh5bgxV83jJsez6R_zpn_XoGVmvc2HViUMhO31ZxNkWBckfyjgDi8r53XaRPLNLPqB6e5s_Y5nNyfP9E9kWIYmaG6hXrrG3OnOCf-iNyUM4EZrB5HZYJURcjbxtyHE',
  },
  {
    id: 8,
    tag: 'NGHỆ THUẬT',
    category: 'van-hoa',
    title: 'Vietnam International Film Festival',
    desc: 'Liên hoan phim quốc tế với hàng trăm tác phẩm điện ảnh từ khắp nơi trên thế giới. Gặp gỡ các đạo diễn, diễn viên và nhà làm phim nổi tiếng.',
    date: '10/11/2026',
    location: 'Trung tâm Hội nghị Quốc gia, Hà Nội',
    img: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800&auto=format&fit=crop',
  },
  {
    id: 9,
    tag: 'ÂM NHẠC',
    category: 'am-nhac',
    title: 'Festival Dân ca Quan họ Bắc Ninh',
    desc: 'Di sản văn hóa phi vật thể UNESCO sống động với những làn điệu quan họ truyền thống. Hội tụ hàng trăm nghệ nhân từ các làng quan họ.',
    date: '14/02/2026',
    location: 'Chùa Bút Tháp, Bắc Ninh',
    img: 'https://images.unsplash.com/photo-1466428996289-fb355538da1b?w=800&auto=format&fit=crop',
  },
  {
    id: 10,
    tag: 'DU LỊCH KHÁM PHÁ',
    category: 'du-lich',
    title: 'Trekking Fansipan mùa hoa tuyết',
    desc: 'Chinh phục đỉnh Fansipan - nóc nhà Đông Dương giữa mùa hoa tuyết nở trắng. Hành trình 3 ngày 2 đêm qua các cung đường đẹp nhất Sa Pa.',
    date: '01/12/2026',
    location: 'Fansipan, Sa Pa, Lào Cai',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxXIie7LQ-372AUk50Qjp8vVUxXAqW_WSgsWnhJFSzBysT4fOrfMKy-AyceuXCcIh9jUdjd57FIH0o7abWaL2TeGMCvI5gyj7faWzJeJNmbCksUsRoPSx5TIczaIpr8kvMlaadOUTcNrRCuv7gxHWEbRwHHY7uX0dpkot8XW3oGVnZAkg7vnYSlMO8rtmRdQsYiZUCW9Oak1NFyTXchNNnBZDqObozsOIFPMq5AFLi6WOkzn3T2uVWbNDJ5HxkZpFqMWMYdJbuu98',
  },
  {
    id: 11,
    tag: 'ẨM THỰC',
    category: 'am-thuc',
    title: 'Ngày hội Bánh mì Việt Nam',
    desc: 'Tôn vinh di sản ẩm thực thế giới - chiếc bánh mì Việt Nam với hàng trăm biến thể độc đáo từ khắp ba miền Bắc Trung Nam.',
    date: '24/03/2026',
    location: 'Phố đi bộ Nguyễn Huệ, TP.HCM',
    img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop',
  },
  {
    id: 12,
    tag: 'THỂ THAO NƯỚC',
    category: 'the-thao',
    title: 'VinFast VinPearl Cup Kiteboarding',
    desc: 'Giải lướt ván diều quốc tế tại vùng biển xanh Phú Quốc. Hàng chục vận động viên từ 20 quốc gia tranh tài trên những con sóng.',
    date: '16/08/2026',
    location: 'Bãi Dài, Phú Quốc',
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB4iyn5dlKlOavsVjzi6rzFdpXyuPCHx0ga6sXtveKjW2DSANqDpplnxfiymhLBukfoJNnVZmr2HKprGNepsQpiBsNPWKMSzXLOtCmvBpJploBHSvnIXF6GvyZFngOnyhmAKYVuwlhJiSHJahEgbnil2byMpfgzk5kiqqlpxcpThb4UMuE2Fmsg622qsiy43oqVjrvlU6vjRJQmshaDn1dEf3ZsdUvs1vRDU5gyn9ogdoZUs2ZOzM-SDUvj44qV5YKpWB1vpiuXRPc',
  },
]

const CATEGORIES = [
  { id: 'all', label: 'Tất cả' },
  { id: 'le-hoi', label: 'Lễ hội' },
  { id: 'am-nhac', label: 'Âm nhạc' },
  { id: 'am-thuc', label: 'Ẩm thực' },
  { id: 'the-thao', label: 'Thể thao' },
  { id: 'van-hoa', label: 'Văn hóa' },
  { id: 'du-lich', label: 'Du lịch' },
] as const

export default function Events() {
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [search, setSearch] = useState('')

  const filtered = MOCK_EVENTS.filter((ev) => {
    const matchCat = activeCategory === 'all' || ev.category === activeCategory
    const matchSearch =
      !search ||
      ev.title.toLowerCase().includes(search.toLowerCase()) ||
      ev.location.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b-2 border-slate-100 bg-white">
        <div className="flex items-center h-16 px-6 max-w-[1280px] mx-auto gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-xl font-black tracking-tight text-slate-900">Horizon</span>
          <span className="text-slate-300 mx-1">|</span>
          <span className="text-blue-600 font-bold">Sự kiện</span>
          <div className="ml-auto flex items-center gap-3">
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
        {/* Hero banner */}
        <section className="bg-gradient-to-br from-blue-700 to-indigo-800 text-white py-16 px-8">
          <div className="max-w-[1280px] mx-auto">
            <p className="text-blue-200 text-sm font-bold uppercase tracking-widest mb-3">Đang diễn ra & Sắp tới</p>
            <h1 className="text-4xl font-extrabold mb-3 leading-tight">Sự kiện & Lễ hội Việt Nam</h1>
            <p className="text-blue-100 text-lg max-w-xl mb-8">
              Hòa mình vào những trải nghiệm văn hóa, âm nhạc và ẩm thực đặc sắc nhất tại các điểm đến trên khắp đất nước.
            </p>

            {/* Search bar */}
            <div className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 max-w-lg shadow-lg">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <input
                className="flex-1 bg-transparent text-slate-900 placeholder-slate-400 text-sm font-medium outline-none"
                placeholder="Tìm sự kiện theo tên hoặc địa điểm..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Category filter */}
        <div className="sticky top-16 z-40 bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-[1280px] mx-auto px-8">
            <div className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-hide">
              <Tag className="w-4 h-4 text-slate-400 shrink-0" />
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Events grid */}
        <section className="max-w-[1280px] mx-auto px-8 py-12">
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-semibold text-lg">Không tìm thấy sự kiện phù hợp</p>
              <button
                onClick={() => { setActiveCategory('all'); setSearch('') }}
                className="mt-4 text-blue-600 font-semibold hover:underline text-sm"
              >
                Xem tất cả sự kiện
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-6">
                {filtered.length} sự kiện
                {activeCategory !== 'all' && ` trong danh mục "${CATEGORIES.find(c => c.id === activeCategory)?.label}"`}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filtered.map((ev) => (
                  <div
                    key={ev.id}
                    className="group bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  >
                    {/* Image */}
                    <div className="relative overflow-hidden aspect-[4/3]">
                      <img
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        src={ev.img}
                        alt={ev.title}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop'
                        }}
                      />
                      <div className="absolute top-4 left-4">
                        <span className="bg-white/90 backdrop-blur px-3 py-1 rounded-full font-bold text-xs text-blue-600">
                          {ev.tag}
                        </span>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="p-5">
                      <h3 className="text-lg font-bold text-slate-900 mb-2 leading-snug group-hover:text-blue-600 transition-colors">
                        {ev.title}
                      </h3>
                      <p className="text-slate-500 text-sm line-clamp-2 mb-4 leading-relaxed">
                        {ev.desc}
                      </p>
                      <div className="flex flex-col gap-1.5 text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>{ev.date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="line-clamp-1">{ev.location}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => navigate('/plan')}
                        className="mt-4 w-full bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-slate-700 hover:text-blue-600 py-2 rounded-lg text-sm font-semibold transition-colors"
                      >
                        Lên kế hoạch chuyến đi
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200 bg-white py-8 px-8 text-center text-sm text-slate-400">
        © 2026 Horizon Travel — Dữ liệu sự kiện mang tính minh họa
      </footer>
    </div>
  )
}
