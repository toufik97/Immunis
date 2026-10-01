# Clinical Test Suite — MA Schedule Pack (Specification)

Status: APPROVED BY CLINICAL LEAD
Last updated: 2026-09-11 (three-tier validity addendum; B13/B15/B16/B17 verified in UI)
Purpose: human-readable source of truth for every engine behavior that must be
verified by automated tests. Tests are written FROM this document, not the
other way around. Any engine or YAML change that contradicts a line here is a
defect unless this document is updated first.

Legend: ✅ confirmed · ✏️ corrected during review · 📌 decision ruling ·
🔶 open/pending · 🖥 verified in UI 2026-09-11 · ⏳ pending automated tests

Products shorthand: P = PENTA, D = DTC, H = HB_MONO.

---

## 0. Global rules

| # | Rule | Status |
|---|---|---|
| G1 | Dose validity is evaluated per antigen program, from YAML `dose_validity` | ✅ |
| G2 | Intervals may be conditional on the age at the previous dose (routine vs catch-up pattern) | ✅ |
| G3 | There is no maximum interval: a late dose is never invalid, only early or short-interval doses are (SOMIPEV) | ✅ |
| G4 | Extra doses beyond the required count are harmless extras: valid, counted, never treated as missing | 📌 |
| G5 | Full-plan projection: engine projects ALL future visits (primary + boosters) with statuses DUE_NOW / DUE_FUTURE / PROJECTED; UI toggles "next visit" vs "full plan" | ✅ |
| G6 | PROJECTED dates are earliest-possible and are recalculated at every visit | ✅ |
| G7 | Unknown history = treat as unvaccinated; serology out of MVP scope | ✅ |
| G8 | Duplicate same product same day: UI rejects at entry (stock integrity). Imported duplicates = 1 valid + 1 invalid with reason DUPLICATE_SAME_DAY; clinician override or admin delete; override changes counting only, never stock | 📌 |
| G9 | If Hib is due at a visit and Penta is age-eligible, the visit product is PENTA (not DTC), whether the DTP dose is primary or booster | 📌 |
| G10 | Overrides: engine proposes, professional disposes, system records both (design pending) | 🔶 |
| G11 | Booster equivalence: the 4th valid DTP-containing dose IS booster 1 and the 5th IS booster 2. Card labels ("rappel") are never trusted; roles are derived from sequential valid-dose position | ✅ |
| G12 | Penta-for-Hib is emergent from coverage scoring + same-visit unification, not from a forcing rule. If a monovalent Hib product ever enters the catalog, preference rules must be re-designed then (SOMIPEV prefers monovalent when other antigens are in order) | 📌 |
| G13 | Three-tier validity model: T1 floors (in `dose_validity`) invalidate; T2 targets (in `booster_policies`) produce per-dose WARNINGS on counted doses; T3 planning (booster_policies + catch-up rules) sets future dates. Reasons = invalidating; warnings = counted-but-deviating | 📌 |
| G14 | Routine-window exception: the 4-year booster-to-booster interval applies only when booster 1 was given at ≥ 2 years (catch-up context). When booster 1 was in the routine window (< 2 years), the calendar pattern (booster 2 at 5 years, ~42-month gap) is accepted with no warning | 📌 |

---

## 1. Group A — Dose validity (per-antigen splitting)

| ID | History | Expected result | Ruling |
|---|---|---|---|
| A1 | P @ 6 weeks | DTP invalid (min 2m); HB valid (birth); Hib invalid (min 2m) | ✅ |
| A2 | P @ 2, 3, 4 months | all doses valid for DTP, HB, Hib | ✅ |
| A3 | P @ 2m, then +2 weeks | dose 2 invalid for all three programs (4-week rule) | ✅ |
| A4 | HB_MONO @ birth + P @ 2, 3, 4m | HB: 4 valid doses, 4th = harmless extra, program complete | ✅ |
| A5 | HB_MONO @ birth + P @ 2, 3m | HB: 3 valid doses (dose 3 min age = 3 months), complete. Variant with P @ 4m added → 4th = harmless extra | ✏️ |
| A6 | P @ 6 weeks, override = true | counts valid for DTP, flagged OVERRIDDEN | ✅ |
| A7 | history rows given unsorted | engine sorts by date before validating | ✅ |
| A8 | dose dated after evaluation date | rejected with clear error | ✅ |

---

## 2. Group B — Catch-up matrix (age × history), next-visit view

| ID | Age | History | Expected next visits | Ruling |
|---|---|---|---|---|
| B1 | 4m | none | P, P+4w, P+4w | ✅ |
| B2 | 10m | none | P, P+4w, P+4w — the 3rd Penta's Hib component IS the Hib rappel for 6–12m starters (no separate Hib booster visit) | ✏️ |
| B3 | 24m | none | P now; D+H +4w; D+H +6m after 2nd | ✅ |
| B4 | 4y | none | D+H ×3 (4w then 6m); Hib unmet WARNING (no monovalent in catalog); booster 1 = last primary +6m; booster 2 would fall after DTC max age → CONF-006 | ✏️ |
| B5 | 6y | none | D+H ×3; Hib not needed | ✅ |
| B6 | 7y6m | none | out of DTP scope → warning/needs review; Td path to be built (CONF-006) | ✅ |
| B7 | 10m | P @ 2m | P now; P+4w | ✏️ |
| B8 | 24m | P @ 2m | D+H; D+H (Hib complete: ≥1 dose suffices after 12m) | ✏️ |
| B9 | 4y | P @ 2m | D+H ×2; Hib unmet warning | ✅ |
| B10 | 24m | P @ 2, 3m | D+H ×1; Hib COMPLETE (1–5y: 1 dose suffices, child has 2); no Hib booster, no same-day collision | ✏️ |
| B11 | 15m | P @ 2, 3, 4m | nothing due now; DTP booster 1 DUE_FUTURE at 18m | ✅ |
| B12 | 24m | P @ 2, 3, 4m | DTC booster 1 DUE_NOW | ✅ |
| B13 | 5y2m | P @ 2, 3, 4m + D @ 18m | booster 2 DUE_NOW at 5y (routine-window exception, G14) | ✏️  |
| B14 | 6y | 5 valid doses | complete | ✅ |
| B15 | 24m | P @ 2, 3, 4m + P @ 14m | dose 4 VALID + warning EARLY_BOOSTER_1_COUNTED (T1 floor met: 12m + 6m after dose 3; below T2 target 18m); count 4; booster 2 at max(5y, 14m+4y) = 5y2m | ✏️ 🖥 |
| B16 | 24m | P @ 2, 3, 4m + DTC @ 8m | dose 4 INVALID (INVALID_INTERVAL_BEFORE_DOSE_4, below T1 6-month floor); booster 1 still due at 18m | 🖥 |
| B17 | 5y+ | P @ 2, 3, 4m + D @ 18m + D @ 5y | routine child: 5 valid doses, zero warnings, COMPLETE | 🖥 |
| B18 | 5y+ | P @ 2, 3, 4m + D @ 18m + D @ 4y6m | dose 5 VALID + warning EARLY_BOOSTER_2_COUNTED (T1 min age 4y met; below T2 target 5y) | ⏳ |
| B19 | 6y | P @ 2, 3, 4m + D @ 4y + D @ 5y | dose 5 INVALID (4-year catch-up floor applies: booster 1 at ≥ 2y) | ⏳ |

---

## 3. Group C — Conditional intervals

| ID | Case | Expected | Ruling |
|---|---|---|---|
| C1 | DTP dose 2 given at 11m | dose 3 interval 4 weeks (primary) | ✅ |
| C2 | DTP dose 2 given at 13m | dose 3 interval 6 months (primary) | ✅ |
| C3 | HB dose 2 given at 25m | dose 3 interval 5 months | ✅ |
| C4 | Hib dose 2 given at 4m | dose 3 interval 4 weeks | ✅ |
| C5 | Hib dose 2 given at 8m | dose 3 (the rappel) interval 4 weeks in this age band | ✏️ |

Note: C1–C4 apply to primary doses; booster intervals come from booster policies
with the G14 routine-window exception.

---

## 4. Group D — Full projection (toggle: next visit / full plan)

| ID | Age | History | Expected FULL plan | Ruling |
|---|---|---|---|---|
| D1 | 4m | none | P, P, P → DTP B1 at max(18m, P3+6m) → DTP B2 at max(5y, B1+4y); HB complete; Hib complete (no separate booster for <6m starters) | ✅ |
| D2 | 10m | none | P, P, P (3rd = Hib rappel @4w) → DTP B1, B2 projected; HB complete; Hib complete | ✏️ |
| D3 | 24m | P @ 2, 3, 4m | DTC B1 now → DTC B2 PROJECTED at max(5y, B1+4y); with B1 given now (≥2y) this resolves to B1+4y | ✅ |
| D4 | any | any | PROJECTED rows recompute after each recorded visit | ✅ |

---

## 5. Group E — Data quality and policy edges

| ID | Case | Expected | Ruling |
|---|---|---|---|
| E1 | no card, unknown history | treat as unvaccinated | ✅ |
| E2 | same product recorded twice same day | UI rejects at entry (one accidental double entry must not deduct 2 doses from stock). Imported duplicates: 1 valid + 1 invalid with reason DUPLICATE_SAME_DAY; clinician may override as accidental input or request admin deletion; override changes counting only, never stock | 📌 |
| E3 | product not in catalog | rejected for now. Future: privately purchased vaccines (outside health system) recordable as history-only, no stock impact | ✅/🔶 |
| E4 | foreign written proof | accepted and evaluated against MA policy to show which doses are still needed to be considered fully vaccinated in Morocco | ✅ |

---

## 6. Group F — Product selection

| ID | Case | Expected | Ruling |
|---|---|---|---|
| F1 | Hib due at a visit where a DTP dose (primary or booster) is also due, Penta age-eligible | ONE PENTA injection covering both (same-visit unification); never DTC + Penta on the same day | 📌  |
| F2 | Hib needed but Penta ineligible (≥3y) and no monovalent Hib | emit unmet-need warning, do not silently skip | 📌 |
| F3 | DTP+HB needed, Hib not needed | DTC + HB_MONO (Penta penalized for unneeded Hib) | ✅ |

---

## 7. YAML amendments record (implemented 2026-09-11)

| # | File | Change | Status |
|---|---|---|---|
| Y1 | hb.yaml | dose 3 min_age = 3 months; conditional interval kept (previous <12m → 4w, ≥12m → 5m); dose 4 = no rule (harmless extra) | done |
| Y2 | hib.yaml | bands: starter <12m → 3 doses @4w (3rd = rappel for 6–12m starters, no separate booster visit); 12m–5y → 0 doses = 1 dose, ≥1 = complete; ≥5y = none. Hib schedule_booster rules and booster policy removed; dose 3 interval = 4 weeks flat | done |
| Y3 | dtp.yaml | dose_validity T1 floors added: dose 4 = min age 12m + 6m after dose 3; dose 5 = min age 4y + 4y after dose 4 ONLY when dose 4 given at ≥2y (conditional) | done |
| Y4 | product-selection.yaml | preferences block SKIPPED; engine functionality kept dormant for future use | done |
| Y5 | dtp.yaml | booster_2.min_interval_after_booster_1 → conditional (4y only when previous ≥2y) for calendar-faithful planning (G14) | done |

---

## 8. Conflict register

| ID | Topic | Status |
|---|---|---|
| CONF-001 | Hib booster drags Penta into a DTC day | SUPERSEDED by Hib rule revision (Y2): no separate Hib booster visit for <12m starters; ≥12m with ≥1 dose = complete. Drag-dose warning concept retained |
| CONF-002 | Routine vs catch-up intervals for same antigen | RESOLVED with conditional intervals (G2); Hib row: 4 weeks per national practice, SOMIPEV 6-month preference recorded as overridden review flag |
| CONF-003 | Booster-position validity (14-month Penta case) | RESOLVED by three-tier model (G13) + T1 floors (Y3) + per-dose warnings channel |
| CONF-004 | Plan-level override layer with reasons + audit | OPEN — design agreed in principle (G10) |
| CONF-005 | Hib monovalent absent from active catalog | OPEN — unmet-need warning until stock exists; revisit preferences then (G12) |
| CONF-006 | Td pathway after 7 years; booster product age switch (DTC <7y, Td ≥7y). Webinar Category C spaces catch-up boosters ≥1 year for 5–7y starters vs ≥4y elsewhere | OPEN |
| CONF-007 | Duplicate dose entry policy + stock integrity | RULED (G8/E2), implementation pending in UI/admin |
| CONF-008 | Privately purchased and foreign vaccines | OPEN — history-only recording + MA-policy evaluation (E3/E4) |
| CONF-009 | Should primary catch-up intervals (6-month dose 2→3) become T2 warnings with a 4-week T1 floor per SOMIPEV §C? | DEFERRED by decision; primary validity stays as confirmed (stricter, national tables) |

---

## 9. Open items (not tested yet)

- Td pathway after 7 years (CONF-006), including the 6-dose cap: no more than
  6 tetanus/diphtheria doses before 7 years (SOMIPEV).
- Monovalent Hib (CONF-005).
- Override layer with reasons + audit (CONF-004).
- Privately purchased / foreign vaccines (CONF-008).
- Spacing / live-vaccine co-administration layer (needed when RR/varicelle added).
- B18/B19 and Groups A, C, E, F automated verification.

---

## Appendix A — Final validity tables as ruled

### DTP (counter DTP_CONTAINING_DOSES)

| Position | T1 floor (invalidating) | T2 target (warning if counted below) |
|---|---|---|
| 1 | min age 2 months | — |
| 2 | min age 3 months + 4 weeks | — |
| 3 | min age 4 months + (previous <12m → 4 weeks; previous ≥12m → 6 months) | — |
| 4 = booster 1 | min age 12 months + 6 months after dose 3 | 18 months (+6 months after primary) |
| 5 = booster 2 | min age 4 years + 4 years after dose 4 only when dose 4 at ≥2 years | 5 years (+4 years when applicable, G14) |

### HB (counter HB_DOSES)

| Position | T1 floor | Notes |
|---|---|---|
| 1 | birth | |
| 2 | min age 1 month + 1 month | |
| 3 | min age 3 months + (previous <12m → 4 weeks; previous ≥12m → 5 months) | |
| 4+ | no rule | harmless extra |

### Hib (counter HIB_DOSES)

| Position | T1 floor | Notes |
|---|---|---|
| 1 | min age 2 months | |
| 2 | min age 3 months + 4 weeks | |
| 3 | min age 4 months + 4 weeks | = rappel for 6–12m starters |

## Appendix B — Hib dose needs by age at evaluation

| Age | Valid doses | Need |
|---|---|---|
| <12m starter | 0 / 1 / 2 | 3 / 2 / 1 (all at 4-week intervals) |
| <12m | 3 | complete |
| 12m–5y | 0 | 1 dose |
| 12m–5y | ≥1 | complete |
| ≥5y | any | none |

## Appendix C — Three-tier model worked examples

- Penta @ 14m (primary 2,3,4m): T1 met (12m + 10m interval) → COUNTS as
  booster 1; T2: 14m < 18m → warning EARLY_BOOSTER_1_COUNTED; booster 2 at
  max(5y, 14m+4y). No extra injection, no silent timeline rewrite.
- DTC @ 8m (primary 2,3,4m): T1 interval floor 6m violated → INVALID, not
  counted; booster 1 still planned at 18m.
- Routine child (booster 1 @ 18m, booster 2 @ 5y): T1 met; T2 met; no
  warnings; 42-month gap accepted per G14.

---

## Next step

Encode Groups A–F plus G11–G14 as automated Vitest tests directly from this
document. Any future engine or YAML change must update this document first.
## Addendum — Td pathway & engine invariants (2026-09)

### New global rules
| G15 | No upper age limit (D1). DT_PROGRAM owns DIPHTHERIA+TETANUS from 7y;
      DTP hands off at 7y via MA-DTP-CU-GE7Y (action: none, no warning).
      Pertussis dropped above 7y (D4); product override allowed. |
| G16 | Soft cap: max 6 DT-containing doses before 7y (SOMIPEV). Recorded
      excess counts with DOSE_CAP_EXCEEDED_COUNTED; planning stops with
      DOSE_CAP_REACHED_PLANNING_STOPPED. 7th/8th lifetime dose not harmful;
      recommended max 6 (D7). |
| G17 | HB bands: <11y 3 doses; 11–15y 2 doses (0, 6m); ≥16y 3 doses (0,1,6m) (D6). |
| G18 | Engine invariant: conditional branches evaluate `from` AND `to_before`
      together. Branch matches iff age ≥ from AND age < to_before.
      Booster 2 floors: previous dose <24m → none (calendar 5y);
      24–60m → 4y; ≥60m → 1y (Category C). |

### Group T (Td pathway) — implemented as tests T1–T8
| T1 | 7y6m, 0 doses | DT needs 5, HB needs 3, visit 1 = TD + HB_MONO, DTP silent |
| T2 | 26y, 0 doses | DT 5-dose schema with projected boosters; HB 3 doses |
| T3 | primed at 6y | DTP booster 1 before 7y; after 4th dose DT completes primary with TD |
| T4 | 7 doses before 7y | 7th counts with DOSE_CAP_EXCEEDED_COUNTED |
| T5 | 11y10m, 0 doses | HB needs 2 |
| T6 | 16y+, 0 doses | HB needs 3 |
| T7 | 8y, 2 infant Penta | DT completes to 5 (3 missing) |
| T8 | 6 doses before 7y | planning stopped with DOSE_CAP_REACHED_PLANNING_STOPPED |

### Updated expectations
- B6: ≥7y → NOT_NEEDED, zero warnings, matched rule MA-DTP-CU-GE7Y.
- B13/B15/D1: routine-window booster 2 = 5y (no interval floor when previous <24m).

### Conflict register
- CONF-006 → RESOLVED (DT program + handoff + Category C + cap).
- CONF-010 NEW: pregnancy-specific Td rules deferred to maternal module.
- CONF-011 NEW: pertussis above 7y dropped; override allowed if product exists.