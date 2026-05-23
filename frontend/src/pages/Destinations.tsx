import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, MapPin, TrendingUp, Star, Users, Flame,
  RefreshCw, Search,
} from 'lucide-react'
import { destinationService } from '@/services/destinationService'
import type { TrendingDestination } from '@/services/destinationService'

const REGIONS = [
  { id: 'all',   label: 'Toàn quốc' },
  { id: 'bac',   label: 'Miền Bắc' },
  { id: 'trung', label: 'Miền Trung' },
  { id: 'nam',   label: 'Miền Nam' },
] as const

function TrendingBadge({ score }: { score: number }) {
  if (score >= 90) return (
    <span className="flex items-center gap-1 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
      <Flame className="w-3 h-3" /> HOT
    </span>
  )
  if (score >= 75) return (
    <span className="flex items-center gap-1 bg-orange-400 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
      <TrendingUp className="w-3 h-3" /> TRENDING
    </span>
  )
  return (
    <span className="flex items-center gap-1 bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
      <TrendingUp className="w-3 h-3" /> NỔI BẬT
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-red-500' : score >= 75 ? 'bg-orange-400' : 'bg-blue-500'
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${score}%` }} />
    </div>
  )
}

export default function Destinations() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeRegion = searchParams.get('region') ?? 'all'
  const search = searchParams.get('q') ?? ''

  function setActiveRegion(region: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      region === 'all' ? p.delete('region') : p.set('region', region)
      return p
    }, { replace: true })
  }
  function setSearch(q: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      q ? p.set('q', q) : p.delete('q')
      return p
    }, { replace: true })
  }

  const { data: destinations = [], isFetching, refetch } = useQuery({
    queryKey: ['trending-destinations'],
    queryFn: () => destinationService.getTrending(12),
    staleTime: 5 * 60_000,
  })

  const filtered = destinations.filter((d: TrendingDestination) => {
    const matchRegion = activeRegion === 'all' || d.region === activeRegion
    const matchSearch =
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.province.toLowerCase().includes(search.toLowerCase())
    return matchRegion && matchSearch
  })

  const top3 = filtered.slice(0, 3)
  const rest = filtered.slice(3)

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
          <span className="text-blue-600 font-bold">Điểm đến</span>
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
        <section className="bg-gradient-to-br from-slate-900 to-blue-900 text-white py-14 px-8">
          <div className="max-w-[1280px] mx-auto">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-orange-400" />
              <span className="text-orange-400 text-sm font-bold uppercase tracking-widest">
                Cập nhật theo thời gian thực
              </span>
            </div>
            <h1 className="text-4xl font-extrabold mb-3 leading-tight">
              Điểm đến đang thịnh hành
            </h1>
            <p className="text-slate-300 text-lg max-w-xl mb-8">
              Những điểm đến được hệ thống ghi nhận là hot nhất hiện tại — dựa trên lượt tìm kiếm, đặt chuyến và chia sẻ trong tuần.
            </p>

            {/* Search + refresh */}
            <div className="flex gap-3 max-w-lg">
              <div className="flex-1 flex items-center gap-3 bg-white/10 backdrop-blur border border-white/20 rounded-xl px-4 py-2.5">
                <Search className="w-4 h-4 text-slate-300 shrink-0" />
                <input
                  className="flex-1 bg-transparent text-white placeholder-slate-400 text-sm outline-none"
                  placeholder="Tìm theo tên hoặc tỉnh thành..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                onClick={() => void refetch()}
                className="p-2.5 bg-white/10 border border-white/20 rounded-xl hover:bg-white/20 transition-colors"
                title="Làm mới dữ liệu"
              >
                <RefreshCw className={`w-4 h-4 text-white ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </section>

        {/* Region filter */}
        <div className="sticky top-16 z-40 bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-[1280px] mx-auto px-8 py-3 flex items-center gap-2">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRegion(r.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                  activeRegion === r.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-slate-400">
              {filtered.length} điểm đến
            </span>
          </div>
        </div>

        <div className="max-w-[1280px] mx-auto px-8 py-12 space-y-14">
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <MapPin className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="font-semibold text-lg">Không tìm thấy điểm đến</p>
              <button
                onClick={() => setSearchParams({}, { replace: true })}
                className="mt-4 text-blue-600 font-semibold hover:underline text-sm"
              >
                Xem tất cả
              </button>
            </div>
          ) : (
            <>
              {/* Top 3 — featured cards */}
              {top3.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-6">
                    <Flame className="w-5 h-5 text-red-500" />
                    <h2 className="text-xl font-bold text-slate-900">Top nổi bật nhất tuần</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {top3.map((dest, idx) => (
                      <div
                        key={dest.id}
                        className="group relative bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => navigate(`/plan?q=${encodeURIComponent(dest.name)}`)}
                      >
                        {/* Rank badge */}
                        <div className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-white/90 backdrop-blur flex items-center justify-center font-black text-slate-900 text-sm shadow">
                          #{idx + 1}
                        </div>
                        <div className="absolute top-3 right-3 z-10">
                          <TrendingBadge score={dest.trendingScore} />
                        </div>

                        {/* Image */}
                        <div className="relative h-52 overflow-hidden">
                          <img
                            src={dest.imageUrl}
                            alt={dest.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop'
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <div className="absolute bottom-3 left-4 right-4">
                            <h3 className="text-white text-xl font-bold">{dest.name}</h3>
                            <div className="flex items-center gap-1 text-white/80 text-xs mt-0.5">
                              <MapPin className="w-3 h-3" />
                              <span>{dest.province}</span>
                            </div>
                          </div>
                        </div>

                        {/* Body */}
                        <div className="p-4">
                          <p className="text-slate-500 text-sm line-clamp-2 mb-3">{dest.description}</p>

                          {/* Trending reason */}
                          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700 mb-3">
                            📊 {dest.trendingReason}
                          </div>

                          {/* Stats */}
                          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                            <div className="flex items-center gap-1">
                              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                              <span className="font-semibold text-slate-700">{dest.rating}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Users className="w-3.5 h-3.5 text-blue-400" />
                              <span>{dest.visitCountThisWeek.toLocaleString()} lượt/tuần</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                              <span className="font-bold text-slate-700">{dest.trendingScore}</span>
                            </div>
                          </div>
                          <ScoreBar score={dest.trendingScore} />

                          <div className="flex flex-wrap gap-1 mt-3">
                            {dest.tags.map((tag) => (
                              <span key={tag} className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-full font-medium">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rest — compact list */}
              {rest.length > 0 && (
                <div>
                  <h2 className="text-xl font-bold text-slate-900 mb-6">Đáng khám phá</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {rest.map((dest) => (
                      <div
                        key={dest.id}
                        className="group bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex"
                        onClick={() => navigate(`/plan?q=${encodeURIComponent(dest.name)}`)}
                      >
                        {/* Thumb */}
                        <div className="w-28 shrink-0 relative overflow-hidden">
                          <img
                            src={dest.imageUrl}
                            alt={dest.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop'
                            }}
                          />
                        </div>

                        {/* Content */}
                        <div className="flex-1 p-3 min-w-0">
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <h3 className="font-bold text-slate-900 text-sm leading-tight">{dest.name}</h3>
                            <TrendingBadge score={dest.trendingScore} />
                          </div>
                          <div className="flex items-center gap-1 text-xs text-slate-400 mb-1.5">
                            <MapPin className="w-3 h-3" />
                            <span>{dest.province}</span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2 mb-2">{dest.trendingReason}</p>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <div className="flex items-center gap-0.5">
                              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                              <span className="font-semibold text-slate-700">{dest.rating}</span>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <Users className="w-3 h-3 text-blue-400" />
                              <span>{(dest.visitCountThisWeek / 1000).toFixed(1)}k/tuần</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8 px-8 text-center text-sm text-slate-400">
        © 2026 Horizon Travel — Dữ liệu trending được cập nhật mỗi giờ
      </footer>
    </div>
  )
}
