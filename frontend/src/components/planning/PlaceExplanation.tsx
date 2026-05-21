import { useMemo } from 'react'
import type { PlaceCandidate } from '@/types'

export interface ExplanationLine {
  icon: string
  label: string
  percentage: number
  description: string
}

// Min-max within the batch, floored at 20% (all candidates passed hard constraints,
// so "0% match" would be misleading — 20% = "relevant at baseline").
// noSignal=true when max===0 && min===0: range is 0 because there is no signal at all,
// not because all places scored equally well. Callers use this to suppress the row.
function normalizeGroup(
  places: PlaceCandidate[],
  extract: (p: PlaceCandidate) => number,
): { map: Map<number, number>; noSignal: boolean } {
  const scores = places.map((p) => ({ id: p.placeId, raw: extract(p) }))
  const max = Math.max(...scores.map((s) => s.raw))
  const min = Math.min(...scores.map((s) => s.raw))
  const range = max - min
  const noSignal = max === 0 && min === 0
  const map = new Map<number, number>()
  for (const s of scores) {
    map.set(s.id, range === 0 ? 100 : Math.round(((s.raw - min) / range) * 80 + 20))
  }
  return { map, noSignal }
}

function describeInterest(pct: number): string {
  if (pct >= 85) return 'Rất phù hợp với sở thích của bạn'
  if (pct >= 60) return 'Khá phù hợp với sở thích của bạn'
  if (pct >= 40) return 'Có một số điểm chung với sở thích của bạn'
  return 'Ít liên quan đến sở thích hiện tại'
}

function describePopularity(pct: number): string {
  if (pct >= 85) return 'Rất được yêu thích bởi những người có gu tương tự'
  if (pct >= 60) return 'Được nhiều người có gu tương tự đánh giá cao'
  if (pct >= 40) return 'Một số người có gu tương tự thích nơi này'
  return 'Ít được biết đến trong nhóm có gu tương tự'
}

function describeStyle(pct: number): string {
  if (pct >= 85) return 'Rất phù hợp phong cách du lịch của bạn'
  if (pct >= 60) return 'Khá phù hợp phong cách du lịch của bạn'
  if (pct >= 40) return 'Phần nào phù hợp phong cách du lịch'
  return 'Không hoàn toàn đúng phong cách thường thấy'
}

export function useExplanations(places: PlaceCandidate[]): Map<number, ExplanationLine[]> {
  return useMemo(() => {
    const withScore = places.filter((p) => p.scoreBreakdown)
    if (withScore.length === 0) return new Map()

    const { map: interestNorm } = normalizeGroup(
      withScore,
      (p) => p.scoreBreakdown!.interest * 10 + p.scoreBreakdown!.semBoost + p.scoreBreakdown!.expBoost,
    )
    const { map: popularityNorm } = normalizeGroup(
      withScore,
      (p) => p.scoreBreakdown!.popularity * 0.3 + p.scoreBreakdown!.cfBoost,
    )
    const { map: styleMap, noSignal: styleNoSignal } = normalizeGroup(
      withScore,
      (p) => p.scoreBreakdown!.softAdj,
    )

    const result = new Map<number, ExplanationLine[]>()
    for (const p of withScore) {
      const iPct = interestNorm.get(p.placeId)!
      const pPct = popularityNorm.get(p.placeId)!
      const lines: ExplanationLine[] = [
        { icon: '❤️', label: 'Sở thích', percentage: iPct, description: describeInterest(iPct) },
        { icon: '🔥', label: 'Phổ biến', percentage: pPct, description: describePopularity(pPct) },
      ]
      if (!styleNoSignal) {
        const sPct = styleMap.get(p.placeId)!
        lines.push({ icon: '🎯', label: 'Phong cách', percentage: sPct, description: describeStyle(sPct) })
      }
      result.set(p.placeId, lines)
    }
    return result
  }, [places])
}

interface PlaceExplanationProps {
  lines: ExplanationLine[]
  isOpen: boolean
  onToggle: () => void
}

export function PlaceExplanation({ lines, isOpen, onToggle }: PlaceExplanationProps) {
  return (
    <div className="px-3 pb-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        <span>{isOpen ? '▾' : '▸'}</span>
        <span>{isOpen ? 'Lí do được gợi ý' : 'Xem lí do được gợi ý'}</span>
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isOpen ? 'max-h-[320px] opacity-100 mt-2' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
          {lines.map((line) => (
            <div key={line.label}>
              <div className="flex justify-between text-xs font-medium text-slate-700">
                <span>
                  {line.icon} {line.label}
                </span>
                <span>{line.percentage}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${line.percentage}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">{line.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
