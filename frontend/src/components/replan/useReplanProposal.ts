import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ReplanProposal } from './types';

async function fetchPendingProposal(tripId: string): Promise<ReplanProposal | null> {
  try {
    const res = await api.get<ReplanProposal>(`/trips/${tripId}/replan/pending`);
    return res.data;
  } catch (err: unknown) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
    throw err;
  }
}

async function acceptProposal(
  tripId: string,
  proposalId: string,
  partialNewSlotIds?: string[],
): Promise<void> {
  await api.post(
    `/trips/${tripId}/replan/${proposalId}/accept`,
    partialNewSlotIds ? { partialNewSlotIds } : {},
  );
}

async function rejectProposal(
  tripId: string,
  proposalId: string,
  reason?: string,
): Promise<void> {
  await api.post(`/trips/${tripId}/replan/${proposalId}/reject`, { reason });
}

// ---------------------------------------------------------------------------

export interface UseReplanProposalReturn {
  proposal: ReplanProposal | null | undefined;
  isLoading: boolean;
  refetch: () => void;
  accept: {
    mutate: (args: { proposalId: string; partialNewSlotIds?: string[] }) => void;
    mutateAsync: (args: { proposalId: string; partialNewSlotIds?: string[] }) => Promise<void>;
    isPending: boolean;
    error: Error | null;
  };
  reject: {
    mutate: (args: { proposalId: string; reason?: string }) => void;
    mutateAsync: (args: { proposalId: string; reason?: string }) => Promise<void>;
    isPending: boolean;
    error: Error | null;
  };
}

export function useReplanProposal(tripId: string): UseReplanProposalReturn {
  const queryClient = useQueryClient();

  const {
    data: proposal,
    isLoading,
    refetch,
  } = useQuery<ReplanProposal | null>({
    queryKey: ['replan-pending', tripId],
    queryFn: () => fetchPendingProposal(tripId),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const acceptMutation = useMutation<
    void,
    Error,
    { proposalId: string; partialNewSlotIds?: string[] }
  >({
    mutationFn: ({ proposalId, partialNewSlotIds }) =>
      acceptProposal(tripId, proposalId, partialNewSlotIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trip', tripId] }),
        queryClient.invalidateQueries({ queryKey: ['check-incident', tripId] }),
      ]);
      void refetch();
    },
  });

  const rejectMutation = useMutation<void, Error, { proposalId: string; reason?: string }>({
    mutationFn: ({ proposalId, reason }) => rejectProposal(tripId, proposalId, reason),
    onSuccess: () => {
      void refetch();
    },
  });

  return {
    proposal,
    isLoading,
    refetch: () => void refetch(),
    accept: {
      mutate: (args) => acceptMutation.mutate(args),
      mutateAsync: (args) => acceptMutation.mutateAsync(args),
      isPending: acceptMutation.isPending,
      error: acceptMutation.error,
    },
    reject: {
      mutate: (args) => rejectMutation.mutate(args),
      mutateAsync: (args) => rejectMutation.mutateAsync(args),
      isPending: rejectMutation.isPending,
      error: rejectMutation.error,
    },
  };
}
