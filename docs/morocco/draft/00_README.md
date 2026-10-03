# Morocco Vaccination Engine - Master Rules Document
Status: DRAFT - FOR NURSE REVIEW

## 1. Scope
- Phase 1 (MVP): Birth to < 5 years (Routine + Catch-up)
- Phase 2: 5 to < 7 years (DTC/Td catch-up)
- Phase 3: >= 7 years (Td catch-up)
- Out of scope for now: HPV, Pregnancy, Complex immunodeficiency.

## 2. Vaccine Catalog & Antigen Mapping
The engine will track *Antigens* (the disease), not just the *Product* (the brand).

| Product Name | Antigens Counted by Engine |
|---|---|
| HB monovalent | Hepatitis B |
| BCG | Tuberculosis |
| VPO | Polio (Oral) |
| VPI | Polio (Inactivated) |
| Penta | Diphtheria, Tetanus, Pertussis, Hib, Hepatitis B |
| DTC | Diphtheria, Tetanus, Pertussis |
| Td | Tetanus, Diphtheria (Pertussis NEEDS_VALIDATION) |
| PCV13-TT / PrimoVax13 | Pneumococcal |
| Prevenar 13 | Pneumococcal |
| Rotavirus | Rotavirus |
| RR | Measles, Rubella |
| RRO | Measles, Rubella, Mumps |
| VAR | Measles (Rubella NEEDS_VALIDATION) |

## 3. Routine Schedule
| Vaccine | Dose | Target Age | Min Interval | Notes |
|---|---|---|---|---|
| HB | Birth | Within 24h | None | |
| BCG | 1 | 1st month | None | |
| VPO | 0 | 1st month | None | |
| VPO | 1 | 2 months | 4 weeks | |
| VPO | 2 | 3 months | 4 weeks | |
| VPO | 3 | 4 months | 4 weeks | |
| Penta | 1 | 2 months | None | |
| Penta | 2 | 3 months | 4 weeks | |
| Penta | 3 | 4 months | 4 weeks | |
| PCV (PrimoVax) | 1 | 10 weeks | None | 15 days offset from Penta |
| PCV (PrimoVax) | 2 | 18 weeks | 2 months | 15 days offset from Penta |
| PCV (PrimoVax) | 3 | 6 months | 2 months | |
| Rotavirus | 1 | 2 months | None | Start before 4 months |
| Rotavirus | 2 | 3 months | 4 weeks | |
| Rotavirus | 3 | 4 months | 4 weeks | Finish before 8 months |
| VPI | 1 | 4 months | None | |
| VPI | 2 | 9 months | None | Given with RR1 |
| RR | 1 | 9 months | None | |
| PCV (PrimoVax) | 4 | 12 months | 2 months | |
| VPO | 4 | 18 months | None | |
| RR | 2 | 18 months | 4 weeks | |
| DTC | Booster 1 | 18 months | 6 months after Penta3 | |
| VPO | 5 | 5 years | None | |
| DTC | Booster 2 | 5 years | 4 years after Booster 1 | |

## 4. Catch-up Rules (Rattrapage)

### General Rules
- Never restart from zero. Every valid dose counts.
- If no card/proof exists: Assume unvaccinated and revaccinate.
- Live vaccines can be given same day. If not same day, wait 1 month between live viral vaccines.

### BCG
- < 3 months: Give 1 dose.
- 3 months to < 1 year: Give 1 dose.
- 1 year to < 5 years: Give 1 dose ONLY IF no BCG scar.
- >= 5 years: No recommendation.

### Hepatitis B (if missed at birth)
- Dose 1: Now
- Dose 2: 1 month later
- Dose 3: 5 to 12 months after Dose 2 ( exact timing with Penta) // because each penta dose has hb it count as done dose so if the child has done 2 doses of penta we count 2 doses of hb done

### DTC / Penta (Child < 7 years)
- 0 doses, < 12m: 3 Penta (4 weeks apart), then boosters.
- 0 doses, 12m - < 3y: 2 Penta + 1 DTC (4 weeks apart), then boosters.
- 0 doses, 3y - < 7y: 3 DTC (4 weeks between 1&2, 6 months between 2&3).
- 1 dose, < 18m: 2 Penta (4 weeks apart).
- 1 dose, 18m - < 3y: 1 Penta, then 1 DTC (1 month later).
- 1 dose, 3y - < 7y: 2 DTC (1 month apart).
- 2 doses, < 18m: 1 Penta.
- 2 doses, 18m - < 3y: 1 Penta, then 1 DTC (6 months later).
- 2 doses, 3y - < 7y: 2 DTC (6 months apart).
- 3 doses, >= 18m: Give DTC booster.
- Boosters: 1st booster 6 months after primary series. 2nd booster 4 years after 1st booster.

### Hib
- 6m - < 12m: 2 doses + booster (NEEDS_VALIDATION intervals).
- 1y - < 5y: 1 dose.
- >= 5y: 0 doses.

### VPO
- <= 12 months: Needs 4 doses (including dose 0). 4 weeks apart.
- > 12 months: Needs 5 doses (including dose 0). 4 weeks apart.
- If no history: Give 4 VPO + 1 VPI with the first VPO (if < 9 years old).

### VPI
- Routine: Dose 1 at 4m, Dose 2 at 9m.
- Catch-up: NEEDS_VALIDATION (How many doses if started late?)

### RR (Measles/Rubella)
- 0 doses: Give RR1 now, RR2 after 1 month. (Must be >= 9 months old).
- 1 dose: Give RR2 (min 4 weeks after Dose 1).

### Pneumococcal (PCV13-TT / PrimoVax13)
- < 7 months: 3 doses (2 months apart) + booster at 12m.
- 7m - 11m: 2 doses (2 months apart) + booster after 1st birthday (min 2 months later).
- 12m - 23m: 2 doses (2 months apart). (Booster needed? NEEDS_VALIDATION).
- 24m - 5y: 1 dose.

### Rotavirus
- >= 4 months and never started: DO NOT GIVE (Useless).
- Started before 4m but incomplete: Complete series, but MUST finish before 8 months.

### DTC / Td (>= 7 years)
- Needs 5 total doses of DTC/Td.
- Use Td vaccine.
- Intervals: Dose 1->2 (4 weeks), 2->3 (4 weeks), 3->4 (6 months), 4->5 (1 year).

## 5. Product Transition & Spacing
### PCV Transition (Prevenar 13 vs PrimoVax13)
- Never vaccinated: Start PrimoVax13 (4 doses).
- Started Prevenar 13 (1 dose): If Prevenar available -> 2 more Prevenar. If not -> 3 PrimoVax13.
- Started Prevenar 13 (2 doses): If Prevenar available -> 1 more Prevenar at 12m. If not -> 1 PrimoVax13 at 12m.
- Spacing: PCV must be offset by at least 15 days from Pentavalent.

### VPI & RR at 9 months
- Given same day.
- Do not mix in same syringe.
- RR = Subcutaneous (Left deltoid).
- VPI = Intramuscular (Left thigh).

## 6. Policy & Dose Validity
### Valid Dose Rules
- Must be >= minimum age.
- Must respect minimum interval from previous valid dose.
- If given too early: NEEDS_VALIDATION (Does it count or must it be repeated?).

### Contraindications
- Anaphylaxis to previous dose or component: Absolute contraindication.
- Severe acute febrile illness: Defer until recovered.
- PCV: Hypersensitivity to tetanus toxoid or components.

### Engine Output Statuses
- UP_TO_DATE
- DUE_NOW
- DUE_FUTUR
- OVERDUE
- COMPLETE
- INVALID_DOSE
- AGED_OUT
- CONTRAINDICATED
- DEFERRED
- NEEDS_REVIEW (Used when rule is NEEDS_VALIDATION or case is too complex)

## Architecture & decisions

- [ADR-0001 — Product identity: three classes of product differences](../../adr/0001-product-identity-three-classes.md)
- [Clinical test suite (living document)](../../morocco/draft/TEST-SUITE-CLINICAL.md)
- [Conflict register](../../morocco/draft/conflict-register-combination-vaccines.md)