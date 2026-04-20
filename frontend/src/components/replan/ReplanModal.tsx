import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SlotDiffView } from './SlotDiffView';
import { CausalTraceTimeline } from './CausalTraceTimeline';
import { useReplanProposal } from './useReplanProposal';
import type { Place, ReplanProposal } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplanModalProps {
  tripId: string;
  placesMap: Map<number, Place>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted?: () => void;
  onRejected?: () => void;
}

// ---------------------------------------------------------------------------
// Score delta badge
// ---------------------------------------------------------------------------

function ScoreDeltaBadge({ before, after }: { before: number; after: number }) {
  const delta = after - before;
  const formatted = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
  return (
    <Badge
      variant="outline"
      className={
        delta >= 0
          ? 'bg-green-50 text-green-700 border-green-200'
          : 'bg-red-50 text-red-600 border-red-200'
      }
    >
      Điểm: {before.toFixed(2)} → {after.toFixed(2)} ({formatted})
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Expiry countdown
// ---------------------------------------------------------------------------

function useExpiryCountdown(expiresAt: string): { label: string; expired: boolean } {
  const [now, setNow] = React.useState(Date.now);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return { label: 'Đã hết hạn', expired: true };

  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  return { label: `Hết hạn sau ${mins}:${String(secs).padStart(2, '0')}`, expired: false };
}

// ---------------------------------------------------------------------------
// Inner modal content (when a proposal exists)
// ---------------------------------------------------------------------------

interface ProposalContentProps {
  proposal: ReplanProposal;
  placesMap: Map<number, Place>;
  onAccepted: () => void;
  onRejected: () => void;
  refetch: () => void;
  accept: { mutate: (id: string) => void; isPending: boolean; error: Error | null };
  reject: {
    mutate: (args: { proposalId: string; reason?: string }) => void;
    isPending: boolean;
    error: Error | null;
  };
}

function ProposalContent({
  proposal,
  placesMap,
  onAccepted,
  onRejected,
  refetch,
  accept,
  reject,
}: ProposalContentProps) {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [activeTab, setActiveTab] = useState<'diff' | 'trace'>('diff');

  const { label: expiryLabel, expired } = useExpiryCountdown(proposal.expiresAt);

  function handleAccept() {
    accept.mutate(proposal.proposalId);
    // onAccepted called after mutation resolves via parent
    onAccepted();
  }

  function handleReject() {
    reject.mutate({
      proposalId: proposal.proposalId,
      reason: rejectReason.trim() || undefined,
    });
    onRejected();
  }

  if (expired) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <p className="text-sm text-gray-600">Đề xuất này đã hết hạn.</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Tạo đề xuất mới
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 mt-1 mb-4">
        <ScoreDeltaBadge before={proposal.scoreBefore} after={proposal.scoreAfter} />
        <Badge variant="outline" className="text-gray-500 border-gray-200 text-xs">
          {expiryLabel}
        </Badge>
        {proposal.isTimeout && (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Giữ lộ trình cũ (tìm kiếm timeout)
          </Badge>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b mb-3">
        {(['diff', 'trace'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'diff' ? 'So sánh lộ trình' : 'Lý do thay đổi'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-y-auto max-h-64 pr-1">
        {activeTab === 'diff' ? (
          <SlotDiffView
            oldPlan={proposal.oldPlanSnapshot}
            newPlan={proposal.newPlanSnapshot}
            placesMap={placesMap}
          />
        ) : (
          <CausalTraceTimeline trace={proposal.causalTrace} />
        )}
      </div>

      {/* Error */}
      {(accept.error ?? reject.error) && (
        <Card className="mt-3 border-red-200 bg-red-50">
          <CardContent className="py-2 px-3 text-xs text-red-600">
            {accept.error?.message ?? reject.error?.message}
          </CardContent>
        </Card>
      )}

      {/* Reject form */}
      {showRejectForm && (
        <div className="mt-3">
          <textarea
            className="w-full rounded-md border border-gray-200 p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            rows={3}
            maxLength={500}
            placeholder="Lý do (tùy chọn)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      )}

      {/* Footer actions */}
      <DialogFooter className="mt-4 flex-wrap gap-2">
        {!showRejectForm ? (
          <>
            <Button
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setShowRejectForm(true)}
              disabled={accept.isPending}
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Giữ lộ trình cũ
            </Button>
            <Button
              onClick={handleAccept}
              disabled={accept.isPending || reject.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <CheckCircle className="h-4 w-4 mr-1.5" />
              {accept.isPending ? 'Đang xử lý…' : 'Đồng ý thay đổi'}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRejectForm(false)}
              disabled={reject.isPending}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReject}
              disabled={reject.isPending}
            >
              {reject.isPending ? 'Đang gửi…' : 'Xác nhận từ chối'}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function ReplanModal({
  tripId,
  placesMap,
  open,
  onOpenChange,
  onAccepted = () => {},
  onRejected = () => {},
}: ReplanModalProps) {
  const { proposal, isLoading, refetch, accept, reject } = useReplanProposal(tripId);

  function handleAccepted() {
    onOpenChange(false);
    onAccepted();
  }

  function handleRejected() {
    onOpenChange(false);
    onRejected();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Đề xuất điều chỉnh lộ trình
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : proposal == null ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500 mb-3">Không có đề xuất nào đang chờ.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Tạo đề xuất mới
            </Button>
          </div>
        ) : (
          <ProposalContent
            proposal={proposal}
            placesMap={placesMap}
            onAccepted={handleAccepted}
            onRejected={handleRejected}
            refetch={refetch}
            accept={accept}
            reject={reject}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ReplanModal;
