import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReplanProposal } from './types';

async function fetchPendingProposal(tripId: string): Promise<ReplanProposal | null> {
  const res = await fetch(`/api/trips/${tripId}/replan/pending`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lỗi tải đề xuất: ${res.status}`);
  return res.json() as Promise<ReplanProposal>;
}

async function acceptProposal(tripId: string, proposalId: string): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/replan/${proposalId}/accept`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Lỗi chấp nhận: ${res.status}`);
  }
}

async function rejectProposal(
  tripId: string,
  proposalId: string,
  reason?: string,
): Promise<void> {
  const res = await fetch(`/api/trips/${tripId}/replan/${proposalId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Lỗi từ chối: ${res.status}`);
  }
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
