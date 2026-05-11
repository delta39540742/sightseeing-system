# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (`cd backend`)
```bash
npm run dev              # Start dev server with nodemon (port 3000)
npm run build            # Compile TypeScript → dist/
npm test                 # Run all tests with Vitest
npm run test:watch       # Watch mode
npm run test -- __tests__/BeamSearch.test.ts  # Run a single test file
npm run seed             # Seed dev user
npm run seed:places      # Seed 94 Da Nang landmarks
npm run seed:fake        # Seed mock trips/slots/interactions
npm run backfill:embeddings  # Backfill place embeddings
```

### Frontend (`cd frontend`)
```bash
npm run dev              # Start Vite dev server (port 5173)
npm run build            # Production build
npm run preview          # Preview production build
```

### Preference Service (`cd preference-service`)
```bash
npm run dev              # Start with ts-node-dev (port 3001)
npm run db:migrate       # Run Prisma migrations
npm run db:push          # Sync schema without migrations
```

### Infrastructure
- PostgreSQL + PostGIS runs in Docker Compose on **port 5433** (not 5432, to avoid conflicts)

---

## Architecture Overview

Three independent services sharing one PostgreSQL database:

| Service | Port | Role |
|---------|------|------|
| Backend | 3000 | Core API, trip planning engine, replanning |
| Frontend | 5173 | React 18 + Vite SPA (Leaflet maps, Zustand, React Query) |
| Preference Service | 3001 | UCB1 multi-armed bandit preference learning |

**Database:** PostgreSQL 15 + PostGIS, accessed via Prisma ORM. Backend uses Prisma 7.x; preference-service uses Prisma 5.x (isolated schemas, same DB).

**Auth:** Firebase — tokens verified server-side in `backend/src/middlewares/authMiddleware.ts`.

**NLU:** External Google Colab endpoint (`COLAB_NLU_URL` env var) for natural language trip parsing.

**Routing:** OSRM public API called from the frontend; Haversine fallback if unavailable.

---

## Key Backend Modules

### Trip Planning (`backend/src/api/plan/`)
Greedy planner + 2-opt TSP solver that turns user constraints and NLU output into ordered day-slots.

### Replanning Engine (`backend/src/replanner/`)
Triggered when incidents (weather, traffic) disrupt an active trip. Core files:
- **BeamSearch.ts** — Explores candidate replans using configurable beam width
- **StateEvolver.ts** — Applies mutations to trip states
- **MutationOperators.ts** — Swap, insert, remove, and `insertAlt` slot operations
- **ObjectiveScorer.ts** — Multi-objective scoring (time, cost, preference fit)
- **CausalTraceBuilder.ts** — Generates human-readable explanations for proposed changes
- **ProposalStore.ts** — Persists proposals for user approval/rejection

### Routes (`backend/src/routes/`)
Fastify plugins for auth, trips, places, landmark recognition, NLU, and monitoring.

### Service Communication
Backend emits HTTP POST to `PREFERENCE_SERVICE_URL/api/preferences/internal/reward` on user interactions (favorites, ratings). This is intentional HTTP isolation — not a shared in-process bus.

---

## Key Frontend Modules

**Vite proxy** (`frontend/vite.config.ts`): `/api/*` → `http://localhost:3000`, `/pref/*` → `http://localhost:3001`. No CORS issues in dev.

- `pages/` — 15+ pages including `PlanTrip`, `TripTracking`, `ReplanPage`, `Dashboard`
- `components/planning/` — NLP input, trip form, filter bar, `PlanRoute.tsx` (OSRM integration, detour detection, rest-stop suggestions)
- `services/` — Axios API clients (trip, place, routing, preference, landmark)
- `store/` — Zustand stores for auth, trip state, and toasts
- `hooks/` — React Query hooks

---

## Preference Learning (UCB1 Bandit)

The preference service maintains 6 arms: `balanced`, `interest`, `pace`, `budget`, `exploration`, `safe`. Weights update from user interaction events. A nightly cron (03:00 `Asia/Ho_Chi_Minh`) runs cosine similarity to find similar users (`preference-service/src/jobs/similarity.job.ts`).

---

## Environment Variables

**Backend `.env`**
- `DATABASE_URL`, `DB_HOST/PORT/USER/PASSWORD/NAME`
- `PORT=3000`
- `COLAB_NLU_URL` — tunnel to external NLU service
- `PREFERENCE_SERVICE_URL=http://localhost:3001`
- Firebase Admin SDK credentials (6 fields)

**Preference Service `.env`**
- `DATABASE_URL` (same PostgreSQL)
- `PORT=3001`

**Frontend `.env`**
- 6 Firebase client config vars (`VITE_FIREBASE_*`)

---

## Testing

Backend: Vitest, tests in `backend/__tests__/`. Run all with `npm test`; run one file by passing its path. No test configuration exists for frontend or preference-service.
