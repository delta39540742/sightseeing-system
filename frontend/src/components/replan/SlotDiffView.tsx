import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TripSlot, Place } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlotDiffViewProps {
  oldPlan: TripSlot[];
  newPlan: TripSlot[];
  placesMap: Map<number, Place>;
}

type DiffKind = 'SAME' | 'CHANGED' | 'TIME_SHIFT_UP' | 'TIME_SHIFT_DOWN' | 'DROPPED' | 'ADDED';

interface SlotDiff {
  kind: DiffKind;
  oldSlot?: TripSlot;
  newSlot?: TripSlot;
  oldPlace?: Place;
  newPlace?: Place;
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

function computeDiffs(
  oldPlan: TripSlot[],
  newPlan: TripSlot[],
  placesMap: Map<number, Place>,
): Map<number, SlotDiff[]> {
  const byDay = new Map<number, SlotDiff[]>();

  const oldBySlotId = new Map(oldPlan.map((s) => [s.slotId, s]));
  const newBySlotId = new Map(newPlan.map((s) => [s.slotId, s]));

  const allDayIndices = new Set([
    ...oldPlan.map((s) => s.dayIndex),
    ...newPlan.map((s) => s.dayIndex),
  ]);

  for (const day of [...allDayIndices].sort((a, b) => a - b)) {
    const dayOld = oldPlan.filter((s) => s.dayIndex === day).sort((a, b) => a.slotOrder - b.slotOrder);
    const dayNew = newPlan.filter((s) => s.dayIndex === day).sort((a, b) => a.slotOrder - b.slotOrder);
    const diffs: SlotDiff[] = [];

    // Slots that existed in old plan
    for (const oldSlot of dayOld) {
      const newSlot = newBySlotId.get(oldSlot.slotId);
      const oldPlace = placesMap.get(oldSlot.placeId);

      if (!newSlot) {
        diffs.push({ kind: 'DROPPED', oldSlot, oldPlace });
        continue;
      }

      const newPlace = placesMap.get(newSlot.placeId);

      if (oldSlot.placeId !== newSlot.placeId) {
        diffs.push({ kind: 'CHANGED', oldSlot, newSlot, oldPlace, newPlace });
      } else if (oldSlot.plannedStart !== newSlot.plannedStart) {
        const kind =
          newSlot.plannedStart > oldSlot.plannedStart ? 'TIME_SHIFT_DOWN' : 'TIME_SHIFT_UP';
        diffs.push({ kind, oldSlot, newSlot, oldPlace, newPlace });
      } else {
        diffs.push({ kind: 'SAME', oldSlot, newSlot, oldPlace, newPlace });
      }
    }

    // Slots added in new plan (not in old)
    for (const newSlot of dayNew) {
      if (!oldBySlotId.has(newSlot.slotId)) {
        diffs.push({ kind: 'ADDED', newSlot, newPlace: placesMap.get(newSlot.placeId) });
      }
    }

    byDay.set(day, diffs);
  }

  return byDay;
}

// ---------------------------------------------------------------------------
// Badge styling
// ---------------------------------------------------------------------------

const BADGE_STYLES: Record<DiffKind, string> = {
  SAME: 'bg-gray-100 text-gray-500 border-gray-200',
  CHANGED: 'bg-orange-100 text-orange-700 border-orange-200',
  TIME_SHIFT_UP: 'bg-blue-100 text-blue-700 border-blue-200',
  TIME_SHIFT_DOWN: 'bg-blue-100 text-blue-700 border-blue-200',
  DROPPED: 'bg-red-100 text-red-700 border-red-200',
  ADDED: 'bg-green-100 text-green-700 border-green-200',
};

const BADGE_LABELS: Record<DiffKind, string> = {
  SAME: 'SAME',
  CHANGED: 'CHANGED',
  TIME_SHIFT_UP: 'TIME ↑',
  TIME_SHIFT_DOWN: 'TIME ↓',
  DROPPED: 'DROPPED',
  ADDED: 'ADDED',
};

const ROW_BG: Record<DiffKind, string> = {
  SAME: 'bg-gray-50',
  CHANGED: 'bg-orange-50',
  TIME_SHIFT_UP: 'bg-blue-50',
  TIME_SHIFT_DOWN: 'bg-blue-50',
  DROPPED: 'bg-red-50 line-through opacity-60',
  ADDED: 'bg-green-50',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlaceName({ place, slot }: { place?: Place; slot?: TripSlot }) {
  return (
    <span className="font-medium">
      {place?.name ?? `Địa điểm #${slot?.placeId ?? '?'}`}
    </span>
  );
}

function TimeRange({ slot }: { slot?: TripSlot }) {
  if (!slot) return null;
  return (
    <span className="text-xs text-gray-500 ml-1">
      {slot.plannedStart}–{slot.plannedEnd}
    </span>
  );
}

function DiffRow({ diff }: { diff: SlotDiff }) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-3 py-2 ${ROW_BG[diff.kind]}`}>
      {/* Badge */}
      <Badge
        variant="outline"
        className={`shrink-0 text-[10px] font-bold px-1.5 py-0 ${BADGE_STYLES[diff.kind]}`}
      >
        {BADGE_LABELS[diff.kind]}
      </Badge>

      {/* Content */}
      {diff.kind === 'CHANGED' ? (
        <span className="flex items-center gap-1.5 flex-wrap text-sm">
          <PlaceName place={diff.oldPlace} slot={diff.oldSlot} />
          <TimeRange slot={diff.oldSlot} />
          <ArrowRight className="h-3 w-3 text-orange-500 shrink-0" />
          <PlaceName place={diff.newPlace} slot={diff.newSlot} />
          <TimeRange slot={diff.newSlot} />
        </span>
      ) : diff.kind === 'TIME_SHIFT_UP' || diff.kind === 'TIME_SHIFT_DOWN' ? (
        <span className="flex items-center gap-1.5 flex-wrap text-sm">
          <PlaceName place={diff.oldPlace} slot={diff.oldSlot} />
          <span className="text-xs text-gray-400 line-through">{diff.oldSlot?.plannedStart}</span>
          <ArrowRight className="h-3 w-3 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-600 font-medium">{diff.newSlot?.plannedStart}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm">
          <PlaceName
            place={diff.kind === 'DROPPED' ? diff.oldPlace : diff.newPlace}
            slot={diff.kind === 'DROPPED' ? diff.oldSlot : diff.newSlot}
          />
          <TimeRange slot={diff.kind === 'DROPPED' ? diff.oldSlot : diff.newSlot} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SlotDiffView({ oldPlan, newPlan, placesMap }: SlotDiffViewProps) {
  const diffsByDay = computeDiffs(oldPlan, newPlan, placesMap);

  if (diffsByDay.size === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-4">
        Không có thay đổi nào.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {[...diffsByDay.entries()].map(([day, diffs]) => (
        <Card key={day} className="shadow-none border">
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm font-semibold text-gray-600">
              Ngày {day + 1}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-1.5">
            {diffs.map((diff, i) => (
              <DiffRow key={i} diff={diff} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default SlotDiffView;
