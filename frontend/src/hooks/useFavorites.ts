import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { preferenceService } from '@/services/preferenceService'

// getWeights() returns WeightsResponse:
// { weights: {...}, softConstraints: [...], currentArmId: number, armName: string }
// There is no favoriteIds field in the response.
// We maintain a client-side Set of favorited placeIds via the query cache.

const WEIGHTS_KEY = ['preference-weights'] as const
const FAVORITE_IDS_KEY = ['favorite-ids'] as const

export function useFavorites(): {
  isFavorite: (placeId: number) => boolean
  add: (placeId: number) => void
  remove: (placeId: number) => void
  isAdding: boolean
  isRemoving: boolean
} {
  const queryClient = useQueryClient()

  // Fetch weights so the query key ['preference-weights'] is populated and can be invalidated
  useQuery({
    queryKey: WEIGHTS_KEY,
    queryFn: () => preferenceService.getWeights(),
    staleTime: 5 * 60 * 1000,
  })

  // Client-side Set of favorited placeIds (starts empty; updated optimistically)
  const { data: favoriteIds } = useQuery<Set<number>>({
    queryKey: FAVORITE_IDS_KEY,
    queryFn: () => new Set<number>(),
    staleTime: Infinity,
  })

  const addMutation = useMutation({
    mutationFn: (placeId: number) => preferenceService.addFavorite(placeId),
    onMutate: async (placeId: number) => {
      await queryClient.cancelQueries({ queryKey: FAVORITE_IDS_KEY })
      const previous = queryClient.getQueryData<Set<number>>(FAVORITE_IDS_KEY)
      queryClient.setQueryData<Set<number>>(FAVORITE_IDS_KEY, (old) => {
        const next = new Set(old ?? [])
        next.add(placeId)
        return next
      })
      return { previous }
    },
    onError: (_err, _placeId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(FAVORITE_IDS_KEY, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WEIGHTS_KEY })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (placeId: number) => preferenceService.removeFavorite(placeId),
    onMutate: async (placeId: number) => {
      await queryClient.cancelQueries({ queryKey: FAVORITE_IDS_KEY })
      const previous = queryClient.getQueryData<Set<number>>(FAVORITE_IDS_KEY)
      queryClient.setQueryData<Set<number>>(FAVORITE_IDS_KEY, (old) => {
        const next = new Set(old ?? [])
        next.delete(placeId)
        return next
      })
      return { previous }
    },
    onError: (_err, _placeId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(FAVORITE_IDS_KEY, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: WEIGHTS_KEY })
    },
  })

  const isFavorite = (placeId: number): boolean => {
    return favoriteIds?.has(placeId) ?? false
  }

  return {
    isFavorite,
    add: (placeId: number) => addMutation.mutate(placeId),
    remove: (placeId: number) => removeMutation.mutate(placeId),
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
  }
}
