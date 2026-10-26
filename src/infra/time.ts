/**
 * Centre time: civil dates are calendar `YYYY-MM-DD` in the configured
 * centre zone (CENTRE_TZ, default Africa/Casablanca); audit timestamps are
 * UTC ISO strings. Single seam so credibility guards share one clock and
 * tests inject fixed values instead of depending on wall-clock `new Date()`.
 * The machine's own local zone is never trusted: server and client boxes may
 * run UTC (or stale DST rules) while the centre observes its own calendar.
 */

/** IANA zone of the centre. Explicit setting beats machine-local every time. */
export function centreTimeZone(): string {
  return process.env.CENTRE_TZ ?? "Africa/Casablanca";
}

/** Centre calendar date (YYYY-MM-DD) for credibility guards. */
export function todayLocal(now = new Date()): string {
  // formatToParts + manual assembly: locale output order is not stable across ICU versions.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: centreTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** UTC audit timestamp for overrides/outbox. */
export function nowIso(now = new Date()): string {
  return now.toISOString();
}

/** Centre offset label for logs/displays, e.g. "GMT" or "GMT+1" (resolves DST). */
export function centreOffsetLabel(now = new Date()): string {
  const minutes = centreOffsetMinutes(now);
  if (minutes === 0) return "GMT";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

function centreOffsetMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: centreTimeZone(),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "0";
  const asUTC = Date.UTC(+get("year"), +get("month") - 1, +get("day"), +get("hour"), +get("minute"), +get("second"));
  return Math.round((asUTC - now.getTime()) / 60000);
}

/** True when a civil date lies after centre today. */
export function isFutureDate(date: string, today: string): boolean {
  return date > today;
}
