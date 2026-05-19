import type { ParsedNLPResult } from '@/types'
import { addDays, format } from 'date-fns'

const cityAliases: Record<string, string> = {
  'đà lạt': 'Đà Lạt', 'dalat': 'Đà Lạt',
  'đà nẵng': 'Đà Nẵng', 'danang': 'Đà Nẵng',
  'hội an': 'Hội An', 'hoian': 'Hội An',
  'hà nội': 'Hà Nội', 'hanoi': 'Hà Nội',
  'hồ chí minh': 'Hồ Chí Minh', 'saigon': 'Hồ Chí Minh', 'sài gòn': 'Hồ Chí Minh',
  'nha trang': 'Nha Trang',
  'phú quốc': 'Phú Quốc', 'phu quoc': 'Phú Quốc',
  'huế': 'Huế', 'hue': 'Huế',
}

const styleKeywords: Record<string, string[]> = {
  'Khám phá thiên nhiên': ['thiên nhiên', 'núi', 'rừng', 'biển', 'trekking', 'leo núi'],
  'Ẩm thực đường phố': ['ẩm thực', 'đồ ăn', 'cà phê', 'cafe', 'food', 'phở', 'bún'],
  'Văn hóa lịch sử': ['văn hóa', 'lịch sử', 'bảo tàng', 'di tích', 'chùa', 'đền'],
  'Nghỉ dưỡng': ['nghỉ', 'thư giãn', 'resort', 'spa', 'relax'],
  'Chụp ảnh': ['chụp ảnh', 'photography', 'check-in', 'checkin'],
  'Mua sắm': ['mua sắm', 'shopping', 'chợ', 'market'],
}

export function parseNLP(input: string): ParsedNLPResult {
  const lower = input.toLowerCase()

  let destinationCity = 'Đà Nẵng'
  for (const [alias, city] of Object.entries(cityAliases)) {
    if (lower.includes(alias)) { destinationCity = city; break }
  }

  // Extract explicit date in DD/MM/YYYY format before falling back to duration
  const explicitDateMatch = lower.match(/(?:ngày\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  const extractedStartDate = explicitDateMatch
    ? `${explicitDateMatch[3]}-${explicitDateMatch[2].padStart(2, '0')}-${explicitDateMatch[1].padStart(2, '0')}`
    : null

  const dayMatch = lower.match(/(\d+)\s*ngày/)
  const days = dayMatch ? parseInt(dayMatch[1]) : 3

  const budgetMatch = lower.match(/(\d+(?:[,.]?\d+)?)\s*(triệu|tr|million|m)/i)
  let budget = 3_000_000
  if (budgetMatch) {
    const raw = parseFloat(budgetMatch[1].replace(',', '.'))
    budget = raw < 1000 ? raw * 1_000_000 : raw
  }

  const styles: string[] = []
  for (const [style, keywords] of Object.entries(styleKeywords)) {
    if (keywords.some((k) => lower.includes(k))) styles.push(style)
  }

  const startDate = extractedStartDate ?? format(new Date(), 'yyyy-MM-dd')
  const endDate = format(addDays(new Date(startDate), days - 1), 'yyyy-MM-dd')

  return { destinationCity, days, budget, styles, startDate, endDate, numPeople: 1 }
}
