/**
 * Centre time: civil dates are calendar `YYYY-MM-DD` in centre wall-clock
 * time; audit timestamps are UTC ISO strings. Single seam so credibility
 * guards share one clock and tests inject fixed values instead of
 * depending on wall-clock `new Date()`.
 */

/** Server-local calendar date (centre wall-clock) for credibility guards. */
export function todayLocal(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** UTC audit timestamp for overrides/outbox. */
export function nowIso(now = new Date()): string {
  return now.toISOString();
}

/** True when a civil date lies after centre today. */
export function isFutureDate(date: string, today: string): boolean {
  return date > today;
}
