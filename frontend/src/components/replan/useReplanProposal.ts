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

async function acceptProposal(tripId: string, proposalId: string): Promise<void> {
  await api.post(`/trips/${tripId}/replan/${proposalId}/accept`);
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
    mutate: (proposalId: string) => void;
    isPending: boolean;
    error: Error | null;
  };
  reject: {
    mutate: (args: { proposalId: string; reason?: string }) => void;
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
    refetchInterval: 15_000, // 15 s polling
    staleTime: 5_000,
  });

  const acceptMutation = useMutation<void, Error, string>({
    mutationFn: (proposalId) => acceptProposal(tripId, proposalId),
    onSuccess: () => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
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
      mutate: (proposalId) => acceptMutation.mutate(proposalId),
      isPending: acceptMutation.isPending,
      error: acceptMutation.error,
    },
    reject: {
      mutate: (args) => rejectMutation.mutate(args),
      isPending: rejectMutation.isPending,
      error: rejectMutation.error,
    },
  };
}
