/** Keyboard-first civil-date helpers (DD/MM/YYYY display, ISO YYYY-MM-DD storage). */

export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export type ParsedDateInput =
  | { status: "empty" }
  | { status: "partial" }
  | { status: "invalid" }
  | { status: "valid"; iso: string };

/**
 * Accept DD/MM/YYYY (1–2 digit day/month), DD-MM-YYYY, DD.MM.YYYY and ISO.
 * MM/DD/YYYY is deliberately NOT a separate format: 01/02/2026 is ambiguous,
 * so slashes always mean day-first (Morocco/France convention).
 */
export function parseDateInput(raw: string): ParsedDateInput {
  const v = raw.trim();
  if (v === "") return { status: "empty" };
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const eu = /^(\d{1,2})[\s/.\-](\d{1,2})[\s/.\-](\d{4})$/.exec(v);
  let y: number;
  let m: number;
  let d: number;
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (eu) {
    d = Number(eu[1]);
    m = Number(eu[2]);
    y = Number(eu[3]);
  } else {
    const partial = /^(\d{0,2})[\s/.\-]?(\d{0,2})[\s/.\-]?(\d{0,4})$/.exec(v);
    return partial && v.length < 10 ? { status: "partial" } : { status: "invalid" };
  }
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return { status: "invalid" };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { status: "invalid" };
  }
  return { status: "valid", iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

/** Auto-insert slashes while typing digits: 12052026 → 12/05/2026. */
export function autoSlashDate(raw: string): string {
  if (/[.\-/\s]/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Bounds check on normalized ISO dates (lexicographic compare is chronological). */
export function checkDateBounds(iso: string, min?: string, max?: string): "tooEarly" | "tooLate" | null {
  if (min && iso < min) return "tooEarly";
  if (max && iso > max) return "tooLate";
  return null;
}
