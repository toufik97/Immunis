# Conflict Register — Combination Vaccine Conflicts (MA Pack)

Status: LIVING DOCUMENT
Owner: clinical lead (nurse) + engine maintainer
Last updated: 2026-09-09
Related review flags: HIB-REVIEW-002, HIB-REVIEW-003, DTP-REVIEW-005, HB-REVIEW-001

## Purpose

This document records clinical/engineering conflicts that arise because
**combination vaccines carry several antigens at once**, while each antigen
program follows its own age bands and intervals.

These conflicts are NOT engine bugs. They are policy gaps where official
resources are silent, contradictory, or assume ideal stock conditions.

Rule of thumb recorded here:

> The engine proposes. The professional disposes. The system records both.

Any scenario added to this register must include:
1. The concrete case (dates and products)
2. A step-by-step simulation of current engine behavior
3. Root cause
4. Candidate solutions with trade-offs
5. The decision taken (or the open question)
6. Acceptance tests to verify the future fix

---

## CONF-001 — Hib catch-up booster drags Penta (and DTP/HB) with it

Status: OPEN — highest priority conflict
Severity: schedule corruption (high), clinical harm (low), waste (medium)

### Rules involved

| Source | Rule |
|---|---|
| Hib program | 6–12 months with 1 prior dose → 1 dose now + booster later |
| Hib booster policy | product = PENTA, min age 12 months, min 6 months after dose 2 |
| DTP program | <18 months with 1 prior dose → 2 more doses (now, +4 weeks) |
| HB program | complete_remaining to 3 doses |
| Catalog | The ONLY product carrying HIB is PENTA |
| Product selection | Penta penalized when it covers unneeded programs |

### Concrete scenario

```text
Birth:            2025-08-01
History:          PENTA on 2025-10-01 (age 2 months)
Evaluation date:  2026-04-01 (age 8 months)
```

### Step 1 — engine plan at 8 months

Counts: DTP 1, HB 1, Hib 1.

```text
Visit 1 (2026-04-01): PENTA          → DTP2 + HB2 + Hib2
Visit 2 (2026-04-29): DTC + HB_MONO  → DTP3 + HB3
```

Only 2 Pentas so far. The Hib booster is NOT shown yet (engine shows only
the next actionable step; Hib still has a primary dose pending).

### Step 2 — re-evaluation after visit 2 (child ~9 months)

```text
DTP: 3 valid → booster 1 at max(18m, dose3+6m) = 2027-02-01 (DTC)
HB : 3 valid → complete
Hib: 2 valid → rule 6M-12M-2D → schedule booster
     booster date = max(12m age = 2026-08-01, Hib dose2 + 6m = 2026-10-01)
                  = 2026-10-01 (age 14 months)
     booster product = PENTA
```

### Step 3 — the hidden damage

If the nurse follows the engine and gives PENTA on 2026-10-01:

| Antigen | Effect of that single injection |
|---|---|
| Hib | booster — valid, intended |
| HB | dose 4 — valid, harmless extra |
| DTP | dose 4 — **counted VALID because dose 4 has no validity rule** |

Consequences at the next evaluation:

```text
DTP count = 4 → engine believes booster 1 is already done
→ the 18-month DTC booster (2027-02-01) DISAPPEARS from the plan
→ booster 2 scheduled at max(5y, dose4+4y) = 2030-10-01
```

Final damaged timeline:

```text
DTP doses at 2, 8, 9, 14 months
No 18-month booster
Booster 2 at ~5y 2m
Penta total = 3
```

Note: the 14-month dose is only ~5 months after primary completion
(minimum is 6 months), so as a DTP booster it is immunologically marginal.

### Root cause

1. HIB has only one carrier product (PENTA) in the active catalog.
2. Penta always drags DTP and HB antigens with it.
3. DTP dose 4 / dose 5 have NO validity rules, so an off-purpose Penta
   silently counts as a DTP booster and rewires the booster timeline.
4. The Hib booster date (14 months) and the DTP booster date (18 months)
   do not align, so they cannot share one injection under current rules.

### Why official resources do not resolve it

- Webinar 2020 tables assume the other antigens happen to align.
- SOMIPEV says monovalent Hib is "rarely used, but to be preferred when the
  other vaccines are in order" — exactly this case — but this sentence is
  not executable without monovalent stock or an override mechanism.
- No source discusses a child with 1 prior Penta dose at 6–12 months whose
  Hib booster falls between primary completion and the 18-month DTC booster.

### Candidate solutions

| # | Solution | Pros | Cons | Status |
|---|---|---|---|---|
| 1 | Add dose_validity for DTP dose 4 (min 6 months after dose 3, min age) and dose 5 (min 4 years after dose 4) | YAML-only; stops timeline corruption; generic | Child still receives a wasteful 3rd Penta; invalid-DTP dose visible in record | OPEN — recommended first |
| 2 | Add HIB_MONO to catalog + counter; selector prefers it when DTP/HB complete | Cleanest clinical answer; matches SOMIPEV preference | Depends on real stock; may recommend unavailable product | OPEN — awaiting stock answer |
| 3 | Align Hib booster to 18 months and allow Penta as DTP booster 1 (one injection covers both) | On-calendar; no wasted visit | Needs co-administration/conflict layer (never 2 DTP-carrying products same day) and product-choice-aware booster policies | OPEN — later |
| 4 | Clinician override layer (substitute / defer / skip with reason + audit) | Covers ALL undocumented cases; creates audit data | Needs UI + storage; does not fix policy gap | OPEN — required anyway |
| 5 | Accept 3 Pentas and document | Simple | Engine keeps disagreeing with staff; erodes trust | REJECTED as end state |

Recommended combination: **1 now, 4 next, 2 if stock allows, 3 later.**

### Open questions

1. Is Hib monovalent (Hiberix / Act-Hib) realistically available, even occasionally?
2. When professionals deviate today, do they change the product, the date, or skip/add doses?
3. Is a documented fallback of "3 Pentas acceptable" tolerable until monovalent exists?

### Acceptance tests once resolved

```text
Scenario: birth 2025-08-01, Penta 2025-10-01, evaluate 2026-04-01,
then simulate visits 1 and 2 and the Hib booster visit.
Expected after fix:
  - DTP count never reaches 4 before the true 18-month booster
  - 18-month DTC booster remains in the plan
  - Hib booster is covered without unneeded DTP/HB doses,
    or is explicitly flagged as a clinician decision
```

---

## CONF-002 — Routine vs catch-up intervals for the same antigen

Status: RESOLVED with conditional intervals (review flags remain)

The same antigen has two valid interval regimes:

```text
Routine infant pattern (Penta at 2, 3, 4 months): 4-week intervals
Catch-up pattern (late starter): longer intervals
```

Resolved by conditioning the interval on the age at the previous dose:

| Program | Dose | Previous dose before | Previous dose at/after |
|---|---|---|---|
| DTP | 3 | 12 months → 4 weeks | 12 months → 6 months |
| HB  | 3 | 12 months → 4 weeks | 12 months → 5 months |
| Hib | 3 | 6 months → 4 weeks  | 6 months → 6 months |

Residual known looseness: an HB dose 2 given at 8 months still allows a
4-week dose 3 (national webinar category A accepts Penta at 1-month
intervals up to 1 year; SOMIPEV would prefer 5–12 months). Accepted
deliberately; see HB-REVIEW-001.

Lesson recorded: **whenever a new antigen is added, ask immediately
"what is the routine pattern vs the catch-up pattern, and at which age
does the switch happen?"** Encode it as a conditional interval.

---

## CONF-003 — Booster doses have no validity rules

Status: OPEN (part of CONF-001 solution 1)

`dose_validity` currently covers only primary doses (1–3). Doses 4 and 5
(booster positions) accept anything, which is what allowed the 14-month
Penta to count as DTP dose 4.

Proposed YAML addition (generic, no engine change):

```yaml
- dose: 4
  min_age: { months: 12 }
  min_interval_from_previous: { months: 6 }
- dose: 5
  min_age: { years: 4 }
  min_interval_from_previous: { years: 4 }
```

Cross-check with Annex 2 (SOMIPEV): DTP4 min age 12 months, 6 months after
DTP3; DTP5 min age 4 years, 2 years after DTP4. National policy uses
4 years between boosters (temporary strict rule, DTP-REVIEW-005).

---

## CONF-004 — No plan-level override exists

Status: OPEN — design agreed in principle

Today only historical-dose validity can be overridden (override checkbox).
There is no way to override a recommendation (substitute product, defer,
skip) with a recorded reason, and no way to record a product absent from
the catalog.

Draft override model (country-agnostic):

```text
Every plan item can be: accepted / substituted / deferred / skipped
Every override stores: who, when, reason code, free text,
                       engine's original recommendation,
                       recalculated downstream plan
Hard safety limits (min age, min interval, max 6 tetanus/diphtheria
doses before 7 years) → blocked or senior approval only
Soft policy deviations → freely overridable with reason
```

Supporting principle from SOMIPEV: "chaque dose donnée compte, on ne
recommence pas tout" and "adapter le schéma selon les vaccins déjà reçus" —
the engine already respects this by being history-driven; the override
layer makes the professional's deviations visible and auditable.

---

## CONF-005 — Hib monovalent absent from the active catalog

Status: OPEN — awaiting stock answer

SOMIPEV: monovalent Hib "rarement utilisé, mais à privilégier si les autres
vaccins sont en ordre". Annex 4 lists Hiberix / Act-Hib as marketed in Morocco.

If added to catalog + HIB_DOSES counter, the existing generic scoring will
prefer it automatically for isolated Hib needs (Penta scores badly because
it adds unneeded DTP/HB). No engine change needed.

Risk: recommending a product that facilities never stock. Must be confirmed
with real supply data before activation.

---

## General class: "combination drag" conflicts

Definition:

> A plan item uses product P to satisfy antigen A, but P also satisfies
> antigens B and C whose programs are COMPLETE or NOT_YET_DUE.
> The injection then forces extra or mistimed doses of B and C.

Detection heuristic for the future engine:

```text
For every planned product dose:
  for every antigen the product satisfies:
    if that program's status is COMPLETE or NOT_NEEDED:
      flag the dose as DRAG_DOSE and log it
```

Known and foreseeable instances:

| Instance | Products involved | Status |
|---|---|---|
| Hib booster via Penta when DTP/HB complete | PENTA | CONF-001 |
| Penta for DTP when Hib over age | PENTA | mitigated by penalty + age eligibility |
| Penta for HB gap when DTP complete | PENTA | mitigated by age eligibility (<3y) + HB_MONO |
| Td vs DTC after 7 years | TD, DTC | DTP-REVIEW-002 |
| RR vs RRO vs VAR measles counting | RR, RRO, VAR | MEASLES counter needs_validation |
| Live viral spacing (RR + varicella: same day or 4 weeks) | RR, RRO, VAR | spacing layer not built |
| Future hexavalent / PCV combinations | TBD | watch when added |

Rule for every new antigen or product added to the pack:

```text
1. List which products carry it.
2. For each carrier, list the OTHER antigens it drags.
3. Ask: in which scenarios would those dragged antigens be complete
   or not yet due? Those scenarios are candidate conflicts → register them.
```

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09 | HB dose 3 conditional interval (12-month switch) | Keep routine Penta valid; enforce catch-up 5–12 months for late starters |
| 2026-09 | Hib bands: <6m 3 doses 4w; 6–12m 2 doses 4w + booster 6m; >12m 1 dose; >5y none | Clinician-confirmed national practice |
| 2026-09 | Booster 2 strict 4-year interval kept temporarily | Routine-vs-catch-up conflict deferred (DTP-REVIEW-005) |
| 2026-09 | No engine change for CONF-001 yet; register first | Conflicts must be decided clinically before coding |

---

## How to use this register in practice

1. Before implementing any fix, search this register for the scenario.
2. If the scenario is not here and official sources are silent or
   contradictory → add it here FIRST, with a simulation.
3. Never hardcode a vaccine-specific exception in engine code to silence
   a conflict. Conflicts are resolved in YAML policy or by override.
4. Every resolved conflict must leave: a YAML change (or override design),
   a decision log entry, and passing acceptance tests.