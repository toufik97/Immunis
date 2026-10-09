/**
 * i18n foundation for en/fr/ar (spec: trilingual UI now).
 * Engine emits stable codes + params (EngineWarning); this module maps
 * codes to localized templates. Arabic requires RTL layout (dir="rtl").
 */
export const SUPPORTED_LOCALES = ["en", "fr", "ar"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function isRtl(locale: Locale): boolean {
  return locale === "ar";
}

/** Minimal template table — extend per warning code as UI is built. */
export const warningTemplates: Record<string, Record<Locale, string>> = {
  // Example shape: INVALID_AGE_TOO_EARLY: { en: "...", fr: "...", ar: "..." }
};

export function formatWarning(
  code: string,
  locale: Locale,
  params: Record<string, string | number> = {},
  fallbackEn: string
): string {
  const template = warningTemplates[code]?.[locale] ?? fallbackEn;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
