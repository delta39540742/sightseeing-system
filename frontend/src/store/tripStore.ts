import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'
import type { Trip, TripSlot, TripVersion, SortMode, PlanRequest } from '@/types'
import { detectConflicts, repairTimestamps } from '@/utils/conflictDetector'

const MAX_HISTORY = 50

interface TripStore {
  trip: Trip | null
  pendingSlots: TripSlot[] | null   // slots waiting for "Cập nhật"
  hasPending: boolean
  focusedSlotId: string | null
  sortMode: SortMode
  versions: TripVersion[]

  // Planning Steps
  planRequest: PlanRequest | null
  step: number

  // undo/redo
  past: TripSlot[][]
  future: TripSlot[][]

  setTrip: (t: Trip) => void
  setSlots: (slots: TripSlot[]) => void
  movePendingSlot: (activeId: string, overId: string) => void
  movePendingToDay: (slotId: string, targetDay: number) => void
  commitPending: () => void
  discardPending: () => void
  undo: () => void
  redo: () => void
  setFocus: (id: string | null) => void
  setSortMode: (m: SortMode) => void
  saveVersion: () => void
  restoreVersion: (idx: number) => void
  clear: () => void

  setPlanRequest: (req: PlanRequest | null) => void
  setStep: (step: number) => void
}

export const useTripStore = create<TripStore>((set, get) => ({
  trip: null,
  pendingSlots: null,
  hasPending: false,
  focusedSlotId: null,
  sortMode: 'fastest',
  versions: [],
  past: [],
  future: [],
  planRequest: null,
  step: 1,

  setTrip: (trip) => set({ trip, pendingSlots: null, hasPending: false, past: [], future: [] }),

  setSlots: (slots) => {
    const { trip, past } = get()
    if (!trip) return
    const withConflicts = detectConflicts(slots)
    const newPast = [...past, trip.slots].slice(-MAX_HISTORY)
    set({
      trip: { ...trip, slots: withConflicts },
      past: newPast,
      future: [],
      pendingSlots: null,
      hasPending: false,
    })
  },

  movePendingSlot: (activeId, overId) => {
    const { trip, pendingSlots } = get()
    const base = pendingSlots ?? trip?.slots ?? []
    const oldIdx = base.findIndex((s) => s.slotId === activeId)
    const newIdx = base.findIndex((s) => s.slotId === overId)
    if (oldIdx === -1 || newIdx === -1) return
    const moved = arrayMove(base, oldIdx, newIdx).map((s, i) => ({ ...s, slotOrder: i, pending: true }))
    set({ pendingSlots: moved, hasPending: true })
  },

  movePendingToDay: (slotId, targetDay) => {
    const { trip, pendingSlots } = get()
    const base = pendingSlots ?? trip?.slots ?? []
    const updated = base.map((s) => s.slotId === slotId ? { ...s, dayIndex: targetDay, pending: true } : s)
    set({ pendingSlots: updated, hasPending: true })
  },

  commitPending: () => {
    const { trip, pendingSlots, past } = get()
    if (!trip || !pendingSlots) return
    const cleaned = pendingSlots.map(s => ({ ...s, pending: false }))
    const repaired = repairTimestamps(cleaned)
    const withConflicts = detectConflicts(repaired)
    const newPast = [...past, trip.slots].slice(-MAX_HISTORY)
    set({
      trip: { ...trip, slots: withConflicts },
      pendingSlots: null,
      hasPending: false,
      past: newPast,
      future: [],
    })
  },

  discardPending: () => set({ pendingSlots: null, hasPending: false }),

  undo: () => {
    const { trip, past, future } = get()
    if (!trip || past.length === 0) return
    const prev = past[past.length - 1]
    set({
      trip: { ...trip, slots: prev },
      past: past.slice(0, -1),
      future: [trip.slots, ...future].slice(0, MAX_HISTORY),
      pendingSlots: null,
      hasPending: false,
    })
  },

  redo: () => {
    const { trip, past, future } = get()
    if (!trip || future.length === 0) return
    const next = future[0]
    set({
      trip: { ...trip, slots: next },
      past: [...past, trip.slots].slice(-MAX_HISTORY),
      future: future.slice(1),
    })
  },

  setFocus: (focusedSlotId) => set({ focusedSlotId }),

  setSortMode: (sortMode) => set({ sortMode }),

  saveVersion: () => {
    const { trip, versions } = get()
    if (!trip) return
    const label = `Lưu lúc ${new Date().toLocaleTimeString('vi-VN')}`
    set({ versions: [...versions, { slots: trip.slots, savedAt: Date.now(), label }].slice(-20) })
  },

  restoreVersion: (idx) => {
    const { trip, versions } = get()
    if (!trip || !versions[idx]) return
    const withConflicts = detectConflicts(versions[idx].slots)
    set({ trip: { ...trip, slots: withConflicts }, pendingSlots: null, hasPending: false })
  },

  clear: () => set({ trip: null, pendingSlots: null, hasPending: false, past: [], future: [], versions: [], planRequest: null, step: 1 }),

  setPlanRequest: (planRequest) => set({ planRequest }),
  setStep: (step) => set({ step }),
}))
