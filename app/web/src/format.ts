const LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  fr: "fr-FR",
  ar: "ar-MA",
};

function localeTag(lang: string): string {
  if (LOCALE_MAP[lang]) return LOCALE_MAP[lang];
  try {
    return new Intl.Locale(lang).toString();
  } catch {
    return "fr-FR";
  }
}

/** Display an ISO YYYY-MM-DD civil date in the UI locale. Falls back to raw on bad input. */
export function formatCivilDate(isoDate: string, lang: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  try {
    return new Intl.DateTimeFormat(localeTag(lang), {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(dt);
  } catch {
    return isoDate;
  }
}

export function formatCount(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(localeTag(lang)).format(n);
  } catch {
    return String(n);
  }
}

/** Centre wall-clock calendar date (YYYY-MM-DD) for civil-date defaults/bounds. */
export function todayCivilDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
