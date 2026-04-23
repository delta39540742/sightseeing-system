import { api } from './api'
import type { NluParseResponse } from '@/types'

export const nluService = {
  parse: (prompt: string) =>
    api.post<NluParseResponse>('/nlu/parse', { prompt }).then((r) => r.data),
}
