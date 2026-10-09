# Immunis Glossary

Clinical and registry language. Implementation-free: for tables and code, see `AGENTS.md` and `src/domain/`.

- **Child**: the vaccinated person. Identified internally by a stable id that never changes.
- **Birth date**: the identity confirmation key. Entered once at registration, never edited afterwards. Every clinical action re-verifies it.
- **Local id (`xx/YYYY`)**: a centre's own registry number. `xx` counts up from 1 each year, reset on 1 January; `YYYY` is the year of the child's first visit at that centre. One per child per centre, fixed at first visit. Different centres may each hold their own number for the same child.
- **National id**: reserved placeholder for a future unified identifier and id merge. Not used in v1.
- **Encounter (visit)**: one page of the carnet — screening result, growth measures, doses given or transcribed, and the next appointment.
- **Dose origin**: `CENTRE` (given here — consumes stock, counts in analytics), `EXTERNAL` (given elsewhere, transcribed from the carnet — clinically credited, never counted), `CAMPAIGN` (reserved, not counted clinically in v1).
- **Lot**: a traceable stock batch (product, lot number, expiry, cold-chain status, quantity). Every `CENTRE` dose names its lot.
- **Screening**: the nurse's pre-vaccination checklist outcome — vaccinate, defer, or contraindicated with a reason.
- **No-show**: a child with a past-due appointment that was never honoured.
- **Override**: a justified deviation from the planner (who, what, why, when). Append-only: never edited or deleted.
- **Outbox**: local changes queued for the future central sync. Backup is a file copy of the centre database.
