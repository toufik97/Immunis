# 4-Day Grace Period — Future Engine Feature

> Status: deferred / not implemented. Pack stays on calendar-exact validation until this ships.

## 1. Problem

Engine validates `min_age` / `min_interval_from_previous` calendar-exact
(`src/engine/dose-validator.ts`, `src/engine/duration.ts`).
One day early (e.g. PENTA 13-mars vs 2-month threshold 14-mars) = `INVALID_*`,
dose does not count. Clinicians expect WHO/CDC tolerance: a few days early
still protects and should count with a visible warning.

## 2. References

- CDC, Timing and Spacing of Immunobiologics (grace rule + exceptions):
  https://www.cdc.gov/vaccines/hcp/imz-best-practices/timing-spacing-immunobiologics.html
- CDC Pink Book Ch.2, General Best Practice Guidance (includes DTaP-4 12m/4m retrospective rule):
  https://www.cdc.gov/pinkbook/hcp/table-of-contents/chapter-2-general-best-practice-guidance.html
- CHOP explainer (min ages/intervals + grace):
  https://www.chop.edu/vaccine-update-healthcare-professionals/newsletter/technically-speaking-minimum-ages-and-intervals-between-doses-vaccines-series
- Immunize.org, Ask the Experts – Scheduling:
  http://www.immunize.org/ask-experts/topic/scheduling-vaccines

Rule in one line: doses given `≤4 days` before the minimum age or interval
are valid; `≥5 days` early are invalid and must be repeated at the correct
interval from the invalid dose.

## 3. Scope

Apply grace to retrospective **validation only**:

- `dose_validity[].min_age`
- `dose_validity[].min_interval_from_previous` (incl. conditional branches)

Do NOT apply grace to:

- `max_age` / `TOO_LATE` (e.g. Rota 24m hard stop stays hard).
- `DUPLICATE_SAME_DAY` (data error, never waivable).
- Booster **recommended** targets (`booster_1/2 min_age`, `target_min_age`) — those already count with soft warnings.
- Dose-zero windows (`vpo dose_zero max_age: 2m`) — grace must not promote a zero to a dose-1 silently; single-zero rule is separate work.
- Dose caps (`dose_caps`) and planning of **future** visits — planner keeps scheduling on recommended dates; grace never pulls a future appointment earlier.
- The 28-day live-parenteral separation, rabies, accelerated Twinrix HepA/HepB — per CDC, grace excluded.
- State/mandate overrides — local law wins over grace when stricter.

## 4. Implementation sketch

1. **Pack schema** (`src/infra/packs/schema.ts`): add optional
   `grace_days?: number` at program or `dose_validity` level (default 4,
   `0` opts a rule out). Keep `.passthrough()` compat; bump pack minor.
2. **Validator** (`src/engine/dose-validator.ts:146,158`): subtract grace
   days from the threshold date before `isAgeAtLeast` / interval compare.
   Inside-grace but before-threshold → `valid=true` + `EARLY_DOSE_N_COUNTED`
   (or existing early-booster warning), never `INVALID_*`.
3. **Warnings** (`src/engine/warnings.ts`): no new severity; reuse soft
   counted-with-warning codes so UI/record-gate needs no change
   (blocking→soft flip happens only inside grace).
4. **Planner** (`src/engine/visit-planner.ts`): unchanged — still plans on
   recommended dates.
5. **Pack review**: `review_flags` entry per touched program,
   `status: clinician_confirmed`, version bump stays `0.x draft/pending`
   visible per central rules.
6. **Tests**: `tests/engine/` — 1-day-early counts, 5-days-early still
   invalid, interval grace (e.g. 24 vs 28d), no grace on max_age/duplicate,
   no future-pull in planner. `tests/app/` — gate accepts graced CENTRE dose
   without override reason.

## 5. Worked example (this child)

Birth 14-jan, PENTA 13-mars: min 8w (=56d, 11-mars) with 4d grace → valid
with warning; recommended 2m (14-mars) still flags early for planning.
DTP counter 3→4. VPO zeros unchanged (single-zero work separate).

## 6. Rollout risk

Months→weeks + grace shifts all early-2024 histories by ~4 days: full
`npm run typecheck` + `npm test` required; engine tests must not be weakened
to pass.
