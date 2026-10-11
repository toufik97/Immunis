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
 * Also accepts 2-digit years DD/MM/YY (pivot 00–49 → 2000s, 50–99 → 1900s)
 * and pure digit runs DDMMYYYY / DDMMYY (from auto-slash typing or paste).
 * MM/DD/YYYY is deliberately NOT a separate format: 01/02/2026 is ambiguous,
 * so slashes always mean day-first (Morocco/France convention).
 */
export function parseDateInput(raw: string): ParsedDateInput {
  const v = raw.trim();
  if (v === "") return { status: "empty" };
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const euFull = /^(\d{1,2})[\s/.\-](\d{1,2})[\s/.\-](\d{4})$/.exec(v);
  const euShort = /^(\d{1,2})[\s/.\-](\d{1,2})[\s/.\-](\d{2})$/.exec(v);
  const digitsOnly = /^\d+$/.test(v) ? v : "";
  const bare = /^(\d{6}|\d{8})$/.exec(digitsOnly);
  let y: number;
  let m: number;
  let d: number;
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (euFull) {
    d = Number(euFull[1]);
    m = Number(euFull[2]);
    y = Number(euFull[3]);
  } else if (euShort) {
    d = Number(euShort[1]);
    m = Number(euShort[2]);
    const yy = Number(euShort[3]);
    // shortcut: 2-digit years cluster around today, pivot at 50.
    y = yy <= 49 ? 2000 + yy : 1900 + yy;
  } else if (bare) {
    const digits = bare[1];
    if (digits.length === 6) {
      d = Number(digits.slice(0, 2));
      m = Number(digits.slice(2, 4));
      const yy = Number(digits.slice(4));
      y = yy <= 49 ? 2000 + yy : 1900 + yy;
    } else {
      d = Number(digits.slice(0, 2));
      m = Number(digits.slice(2, 4));
      y = Number(digits.slice(4));
    }
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

/** Auto-insert slashes while typing digits: 12052026 → 12/05/2026, 120526 → 12/05/26. */
export function autoSlashDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) {
    // Keep a just-typed separator so "12/" survives instead of losing the slash.
    if (digits.length === 2 && /[\s/.\-]$/.test(raw)) return `${digits}/`;
    return digits;
  }
  if (digits.length <= 4) {
    const out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    if (digits.length === 4 && /[\s/.\-]$/.test(raw)) return `${out}/`;
    return out;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Bounds check on normalized ISO dates (lexicographic compare is chronological). */
export function checkDateBounds(iso: string, min?: string, max?: string): "tooEarly" | "tooLate" | null {
  if (min && iso < min) return "tooEarly";
  if (max && iso > max) return "tooLate";
  return null;
}
