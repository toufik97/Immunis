# Immunis — Agent Guide

Local-first vaccination point-of-service for MA-PNI (Morocco).
App is state + workflow around the existing pure planning engine.
Spec is French; all code, docs, and responses are English. UI supports en/fr/ar.

## Commands

- `npm install` — install deps
- `npm run typecheck` — `tsc --noEmit` (must pass)
- `npm test` — `vitest run` (engine: `tests/engine/`, 23 suites)
- `npm run dev` — `tsx src/index.ts` (engine demo)
- `npm run serve` — `tsx src/server.ts` (serves `app/web/dist` + API, needs `DB_PATH`)
- `npm run web:dev` / `npm run web:build` — Vite dev (proxy `/api → :5173`) / prod build to `app/web/dist`

## Architecture

- `src/engine/` — FROZEN pure stateless engine. No DB, no HTTP, no I/O imports.
  Entry: `evaluatePatient` in `src/engine/index.ts`.
- `schedule-packs/MA/` — versioned clinical rules (0.x only, `draft`/`pending` shown in UI).
- `src/infra/packs/` — `loader.ts`, `schema.ts` (zod), `pack-validation.ts`.
- `src/domain/` — zod schemas: `child.ts` (xx/yy local ids, reserved nationalId),
  `encounter.ts` (visit = screening + growth + doses + RDV), `dose-origin.ts`,
  `stock.ts` (per-lot), `appointment.ts`, `override.ts` (append-only audit).
- `src/app/` — use cases, e.g. `evaluate-child.ts` (north star: evaluate + record fast).
- `src/infra/db/` — SQLite per centre (`schema.sql`, `connection.ts`, WAL mode).
- `src/infra/repos/` — repositories (DB access only here).
- `src/infra/sync/` — outbox + export/backup (central aggregation later).
- `src/api/` — Fastify routes (`registerRoutes`). `server.ts` migrates here.
- `src/i18n/` — `en/fr/ar` templates keyed by engine warning `code + params`; `ar` is RTL.
- `app/web/` — React SPA (desktop-first, tablet-friendly, localhost/LAN offline).
- `tests/engine/` — engine regression net. `tests/app/` — new: origin, ids, audit, no-show.
- `docs/adr/` — decisions (see `001-local-first-sqlite-fastify.md`).

## Central rules (do not break)

1. **Origin (§5.10):** engine reads CENTRE + EXTERNAL (never CAMPAIGN);
   stock/analytics read CENTRE only. Use `isClinicallyCredited` / `isCentreCounted`.
2. **Record gate:** `recordVisit` (src/app/) runs the engine before storing — blocking warnings stop, overridable ones need flag + reason (audited), duplicates rejected. Never bypass it with `recordEncounter` from API.
3. **Audit append-only:** `overrides` table — INSERT only, never UPDATE/DELETE.
4. **Identity:** registry birthDate is read-only; internal id ≠ `xx/yy`.
5. **Pack status:** `draft`/`pending` must stay visible in every result.
6. **Engine invariants:** visit dates `YYYY-MM-DD`, no empty products; full projection
   only shows future boosters as `projected`.

## Conventions

- TypeScript strict, ESM, `zod` for all boundaries, `date-fns` for dates.
- Time rules: civil dates are calendar `YYYY-MM-DD` in centre wall-clock time; visit/dose/evaluation dates can never be in the future (past history doses OK); audit timestamps (`overrides.created_at`, `outbox`) are UTC ISO strings.
- Engine warnings are codes + params, never hardcoded sentences (i18n builds sentences).
- Local-first: everything works offline; sync is export/outbox, not live calls.
- SMS, carnet print, national-ID merge, weekday scheduling: reserved stubs only.

## Verify

1. `npm run typecheck`
2. `npm test` — all green before push; engine tests must never be weakened to pass.
3. New domain/app code needs tests in `tests/app/`.
