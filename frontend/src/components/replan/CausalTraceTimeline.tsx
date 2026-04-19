import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CausalTraceStep } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CausalTraceTimelineProps {
  trace: CausalTraceStep[];
}

// ---------------------------------------------------------------------------
// Single step
// ---------------------------------------------------------------------------

function TraceStep({ step, isLast }: { step: CausalTraceStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const hasDetail =
    step.alternativeChosen !== null || step.downstreamImpact !== null;

  return (
    <div className="flex gap-3">
      {/* Vertical line + dot */}
      <div className="flex flex-col items-center">
        <div className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-white ring-2 ring-indigo-400 shrink-0 mt-0.5" />
        {!isLast && <div className="w-0.5 flex-1 bg-indigo-200 mt-1" />}
      </div>

      {/* Content */}
      <div className={`pb-4 flex-1 min-w-0 ${isLast ? '' : ''}`}>
        {/* Step header */}
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((p) => !p)}
          className={`flex items-start gap-1 w-full text-left group ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <span className="text-xs font-bold text-indigo-600 shrink-0 mt-0.5">
            Bước {step.stepIndex}
          </span>
          <span className="text-sm text-gray-800 flex-1 leading-snug">
            {step.reason}
          </span>
          {hasDetail && (
            <span className="shrink-0 text-gray-400 group-hover:text-gray-600 mt-0.5">
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          )}
        </button>

        {/* Affected slot */}
        {step.affectedSlotId && (
          <p className="mt-1 text-xs text-gray-500 pl-0.5">
            └─ Ảnh hưởng slot:{' '}
            <code className="text-gray-600">{step.affectedSlotId.slice(0, 8)}…</code>
          </p>
        )}

        {/* Expandable details */}
        {expanded && (
          <div className="mt-2 space-y-1 pl-0.5">
            {step.alternativeChosen && (
              <p className="text-xs text-gray-600">
                └─ Thay thế bằng địa điểm{' '}
                <span className="font-medium text-indigo-600">
                  #{step.alternativeChosen.placeId}
                </span>
                : {step.alternativeChosen.reason}
              </p>
            )}
            {step.downstreamImpact && (
              <p className="text-xs text-gray-600">
                └─ Tác động tiếp theo: {step.downstreamImpact}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CausalTraceTimeline({ trace }: CausalTraceTimelineProps) {
  if (trace.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic py-2">
        Không có dấu vết nhân quả.
      </p>
    );
  }

  const sorted = [...trace].sort((a, b) => a.stepIndex - b.stepIndex);

  return (
    <div className="pl-1 pt-1">
      {sorted.map((step, i) => (
        <TraceStep key={step.stepIndex} step={step} isLast={i === sorted.length - 1} />
      ))}
    </div>
  );
}

export default CausalTraceTimeline;
