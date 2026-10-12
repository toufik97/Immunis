/**
 * Localized engine sentences for en/fr/ar.
 *
 * The engine is frozen and emits English prose ("CODE: details" or bare
 * codes). This module maps the stable base code back to a template and
 * extracts its values with regexes captured from the real engine formats —
 * no engine change, no invented strings. Unknown codes fall back to the
 * raw English sentence so nothing is ever hidden.
 */
import { formatCivilDate } from "./format";

export type EngineLang = "en" | "fr" | "ar";

function normalize(lang: string): EngineLang {
  return lang === "ar" ? "ar" : lang === "fr" ? "fr" : "en";
}

// Stable base codes: numbered engine variants collapse here.
// (Mirrors src/engine/warnings.ts; duplicated because the web bundle
// cannot import outside app/web/src.)
const NUMBERED: Array<[RegExp, string]> = [
  [/^INVALID_AGE_DOSE_\d+_TOO_EARLY$/, "INVALID_AGE_TOO_EARLY"],
  [/^INVALID_AGE_DOSE_\d+_TOO_LATE$/, "INVALID_AGE_TOO_LATE"],
  [/^INVALID_INTERVAL_BEFORE_DOSE_\d+$/, "INVALID_INTERVAL"],
  [/^EARLY_DOSE_\d+_COUNTED$/, "EARLY_DOSE_COUNTED"],
  [/^EARLY_BOOSTER_\d+_COUNTED$/, "EARLY_BOOSTER_COUNTED"],
  [/^SHORT_BOOSTER_\d+_INTERVAL_COUNTED$/, "SHORT_BOOSTER_INTERVAL_COUNTED"],
  [/^OVERRIDDEN_BY_HEALTHCARE_PROFESSIONAL$/, "OVERRIDDEN_BY_PROFESSIONAL"],
];

function baseCode(raw: string): string {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(":");
  const candidate = (idx === -1 ? trimmed : trimmed.slice(0, idx).trim()).replace(/\s+/g, "_");
  if (!/^[A-Z][A-Z0-9_]*$/.test(candidate)) return "ENGINE_NOTICE";
  for (const [re, base] of NUMBERED) {
    if (re.test(candidate)) return base;
  }
  return candidate;
}

type Fill = (p: Record<string, string>) => { en: string; fr: string; ar: string };

interface Template {
  code: string;
  match: RegExp;
  names: string[];
  text: Fill;
}

function t(en: string, fr: string, ar: string): Fill {
  return () => ({ en, fr, ar });
}

function fill(template: string, p: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? `{${k}}`);
}

const TEMPLATES: Template[] = [
  // ---- blocking gate reasons (bare codes, no values to extract)
  { code: "INVALID_AGE_TOO_EARLY", match: /^INVALID_AGE_(DOSE_\d+_)?TOO_EARLY$/, names: [], text: t("Dose given before the minimum age.", "Dose administrée avant l’âge minimal.", "أُعطيت الجرعة قبل السن الأدنى.") },
  { code: "INVALID_AGE_TOO_LATE", match: /^INVALID_AGE_(DOSE_\d+_)?TOO_LATE$/, names: [], text: t("Dose given after the maximum age.", "Dose administrée après l’âge maximal.", "أُعطيت الجرعة بعد السن الأقصى.") },
  { code: "INVALID_INTERVAL", match: /^INVALID_INTERVAL(_BEFORE_DOSE_\d+)?$/, names: [], text: t("Interval since the previous dose is too short.", "Intervalle trop court depuis la dose précédente.", "الفاصل منذ الجرعة السابقة قصير جداً.") },
  { code: "DUPLICATE_SAME_DAY", match: /^DUPLICATE_SAME_DAY$/, names: [], text: t("Same product recorded twice on one day (data error).", "Même produit enregistré deux fois le même jour (erreur de saisie).", "نفس اللقاح مُسجَّل مرتين في نفس اليوم (خطأ إدخال).") },
  { code: "OVERRIDDEN_BY_PROFESSIONAL", match: /^OVERRIDDEN_BY_(HEALTHCARE_)?PROFESSIONAL$/, names: [], text: t("Waived by a healthcare professional with justification.", "Dérogé par un professionnel de santé avec justification.", "تم التجاوز من طرف مهني الصحة مع تبرير.") },
  // ---- counted-with-warning
  {
    code: "EARLY_DOSE_COUNTED",
    match: /^EARLY_DOSE_(\d+)_COUNTED: administered at ([\d.]+) months, recommended target ([\d.]+) months/,
    names: ["n", "at", "target"],
    text: (p) => ({
      en: fill("Dose {n} given at {at} months (target {target} months). Counted, no restart.", p),
      fr: fill("Dose {n} à {at} mois (cible {target} mois). Comptée, pas de reprise.", p),
      ar: fill("الجرعة {n} أُعطيت في عمر {at} أشهر (المستهدف {target} أشهر). مُحتسبة، دون إعادة.", p),
    }),
  },
  {
    code: "EARLY_BOOSTER_COUNTED",
    match: /^EARLY_BOOSTER_(\d+)_COUNTED: administered at ([\d.]+) months, policy target ([\d.]+) months/,
    names: ["n", "at", "target"],
    text: (p) => ({
      en: fill("Booster {n} given at {at} months (policy target {target} months). Counted.", p),
      fr: fill("Rappel {n} à {at} mois (cible {target} mois). Compté.", p),
      ar: fill("الجرعة المعززة {n} أُعطيت في عمر {at} أشهر (المستهدف {target} أشهر). مُحتسبة.", p),
    }),
  },
  {
    code: "SHORT_BOOSTER_INTERVAL_COUNTED",
    match: /^SHORT_BOOSTER_(\d+)_INTERVAL_COUNTED:/,
    names: ["n"],
    text: (p) => ({
      en: fill("Booster {n} interval shorter than the policy target. Counted.", p),
      fr: fill("Intervalle du rappel {n} plus court que la cible. Compté.", p),
      ar: fill("الفاصل قبل الجرعة المعززة {n} أقصر من المستهدف. مُحتسبة.", p),
    }),
  },
  {
    code: "EXTRA_DOSE_COUNTED",
    match: /^EXTRA_DOSE_COUNTED: dose (\d+) has no schedule rule/,
    names: ["n"],
    text: (p) => ({
      en: fill("Dose {n} is beyond the schedule. Counted as a harmless extra.", p),
      fr: fill("Dose {n} hors calendrier. Comptée comme dose supplémentaire sans risque.", p),
      ar: fill("الجرعة {n} خارج الجدول. مُحتسبة كجرعة زائدة دون خطر.", p),
    }),
  },
  {
    code: "DOSE_CAP_EXCEEDED_COUNTED",
    match: /^DOSE_CAP_EXCEEDED_COUNTED: dose (\d+) exceeds the recommended maximum of (\d+) doses/,
    names: ["n", "max"],
    text: (p) => ({
      en: fill("Dose {n} exceeds the recommended maximum of {max} doses. Counted.", p),
      fr: fill("Dose {n} au-delà du maximum recommandé de {max} doses. Comptée.", p),
      ar: fill("الجرعة {n} تتجاوز الحد الأقصى الموصى به ({max} جرعات). مُحتسبة.", p),
    }),
  },
  // ---- program / planning
  {
    code: "DOSE_CAP_REACHED_PLANNING_STOPPED",
    match: /(\d+) doses already given before (.+?);/,
    names: ["max", "before"],
    text: (p) => ({
      en: fill("Maximum reached ({max} doses before {before}): no further dose planned.", p),
      fr: fill("Maximum atteint ({max} doses avant {before}) : aucune dose planifiée.", p),
      ar: fill("تم بلوغ الحد الأقصى ({max} جرعات قبل {before}): لا جرعة مبرمجة.", p),
    }),
  },
  {
    code: "NO_MATCHING_RULE",
    match: /for age ([\d.]+) months and (\d+) valid doses/,
    names: ["age", "valid"],
    text: (p) => ({
      en: fill("No catch-up rule for age {age} months with {valid} valid doses.", p),
      fr: fill("Aucune règle de rattrapage pour {age} mois avec {valid} doses valides.", p),
      ar: fill("لا توجد قاعدة استدراك لعمر {age} أشهر مع {valid} جرعات صالحة.", p),
    }),
  },
  {
    code: "UNKNOWN_ACTION",
    match: /Unknown action: (.+)$/,
    names: ["action"],
    text: (p) => ({
      en: fill("Unknown schedule action: {action}.", p),
      fr: fill("Action inconnue du calendrier : {action}.", p),
      ar: fill("إجراء غير معروف في الجدول: {action}.", p),
    }),
  },
  {
    code: "AGE_LIMIT_PREVENTS_DOSE",
    match: /^AGE_LIMIT_PREVENTS_DOSE: (\S+) dose (\d+) would fall at ([\d.]+) months \(limit ([\d.]+) months\)/,
    names: ["program", "n", "at", "limit"],
    text: (p) => ({
      en: fill("Dose {n} would fall at {at} months, past the {limit}-month limit. Not planned.", p),
      fr: fill("La dose {n} tomberait à {at} mois, après la limite de {limit} mois. Non planifiée.", p),
      ar: fill("الجرعة {n} ستقع في عمر {at} أشهر، بعد حد {limit} أشهر. غير مبرمجة.", p),
    }),
  },
  {
    code: "NO_ELIGIBLE_PRODUCT_AT_DATE",
    match: /^NO_ELIGIBLE_PRODUCT_AT_DATE: (\S+) is not eligible on (\d{4}-\d{2}-\d{2}); (.+?) not planned\.$/,
    names: ["product", "date", "detail"],
    text: (p) => ({
      en: fill("{product} not usable on {date}: {detail} not planned.", p),
      fr: fill("{product} inutilisable le {date} : {detail} non planifié.", p),
      ar: fill("{product} غير صالح بتاريخ {date}: {detail} غير مبرمج.", p),
    }),
  },
  {
    code: "PRODUCT_SUBSTITUTED_BY_AGE",
    match: /^PRODUCT_SUBSTITUTED_BY_AGE: (\S+) is not eligible on (\d{4}-\d{2}-\d{2}); using (.+?) for (.+?)\.$/,
    names: ["product", "date", "using", "programs"],
    text: (p) => ({
      en: fill("{product} not usable on {date}: replaced by {using}.", p),
      fr: fill("{product} inutilisable le {date} : remplacé par {using}.", p),
      ar: fill("{product} غير صالح بتاريخ {date}: عُوِّض بـ {using}.", p),
    }),
  },
  {
    code: "DUPLICATE_DOSE_SAME_DAY",
    match: /(\d{4}-\d{2}-\d{2}) has two doses of the same product for the same program/,
    names: ["date"],
    text: (p) => ({
      en: fill("{date} has two doses of the same product for one program. Check the plan.", p),
      fr: fill("Deux doses du même produit pour un programme le {date}. Vérifiez le plan.", p),
      ar: fill("جرعتان من نفس اللقاح لبرنامج واحد بتاريخ {date}. تحقق من الخطة.", p),
    }),
  },
  {
    code: "UNKNOWN_PRODUCT_IN_HISTORY",
    match: /^UNKNOWN_PRODUCT_IN_HISTORY: "(.+?)" \(given (\d{4}-\d{2}-\d{2})\)/,
    names: ["product", "date"],
    text: (p) => ({
      en: fill("{product} given on {date} is not in the catalog. Record ignored.", p),
      fr: fill("{product} du {date} inconnu au catalogue. Ligne ignorée.", p),
      ar: fill("{product} بتاريخ {date} غير موجود في الدليل. تم تجاهل السطر.", p),
    }),
  },
  {
    code: "SPACING_NOT_CONVERGED",
    match: /after (\d+) passes/,
    names: ["passes"],
    text: (p) => ({
      en: fill("Visit spacing did not settle. Check the plan manually.", p),
      fr: fill("L’espacement des visites n’a pas convergé. Vérifiez le plan manuellement.", p),
      ar: fill("لم يستقر تباعد الزيارات. تحقق من الخطة يدوياً.", p),
    }),
  },
  {
    code: "CONDITIONAL_BOOSTER_UNRESOLVED",
    match: /for (\S+) booster (\d+) at evaluation age; using (.+?) \(needs review\)/,
    names: ["program", "n", "fallback"],
    text: (p) => ({
      en: fill("Booster {n} product unclear at this age: using {fallback}. Needs review.", p),
      fr: fill("Produit du rappel {n} incertain à cet âge : {fallback} retenu. À revoir.", p),
      ar: fill("لقاح الجرعة المعززة {n} غير مؤكد في هذا العمر: تم اعتماد {fallback}. يحتاج مراجعة.", p),
    }),
  },
  {
    code: "SPACING_SHIFT",
    match: /(\S+) moved from (.+?) to (.+?) \((.+?)\)\.$/,
    names: ["product", "from", "to", "rule"],
    text: (p) => ({
      en: fill("{product} moved from {from} to {to} to respect spacing.", p),
      fr: fill("{product} déplacé du {from} au {to} pour respecter l’espacement.", p),
      ar: fill("نُقل {product} من {from} إلى {to} لاحترام التباعد.", p),
    }),
  },
  {
    code: "LIVE_SPACING_SHIFT",
    match: /(\S+) moved from (.+?) to (.+?) \((.+?)\)\.$/,
    names: ["product", "from", "to", "rule"],
    text: (p) => ({
      en: fill("{product} moved from {from} to {to} to respect live-vaccine spacing.", p),
      fr: fill("{product} déplacé du {from} au {to} (espacement vaccins vivants).", p),
      ar: fill("نُقل {product} من {from} إلى {to} لاحترام تباعد اللقاحات الحية.", p),
    }),
  },
  {
    code: "CASCADE_REPLAN",
    match: /(\S+) moved from (.+?) to (.+?) \(interval from previous dose\)/,
    names: ["product", "from", "to"],
    text: (p) => ({
      en: fill("{product} moved from {from} to {to} (interval from previous dose).", p),
      fr: fill("{product} déplacé du {from} au {to} (intervalle depuis la dose précédente).", p),
      ar: fill("نُقل {product} من {from} إلى {to} (الفاصل منذ الجرعة السابقة).", p),
    }),
  },
  // ---- clinician-facing sentences without a machine code
  {
    code: "ENGINE_NOTICE",
    match: /^Same-visit antigen overlap: no single eligible product covers (.+?)\. Clinician decision required\.$/,
    names: ["programs"],
    text: (p) => ({
      en: fill("One visit cannot cover {programs} with a single product. Clinician decision required.", p),
      fr: fill("Une visite ne peut pas couvrir {programs} avec un seul produit. Décision du clinicien requise.", p),
      ar: fill("لا يمكن لزيارة واحدة تغطية {programs} بلقاح واحد. يلزم قرار الطبيب.", p),
    }),
  },
  {
    code: "ENGINE_NOTICE",
    match: /^PCV availability assumed by policy (\S+) \(stock not connected\)\.$/,
    names: ["policy"],
    text: (p) => ({
      en: fill("Pneumo brand assumed by policy {policy} (stock not connected).", p),
      fr: fill("Marque pneumo supposée par la politique {policy} (stock non relié).", p),
      ar: fill("نوع لقاح المكورات الرئوية مفترض حسب سياسة {policy} (المخزون غير مربوط).", p),
    }),
  },
];

/** Localize one engine sentence. Falls back to the raw English string. */
export function formatEngineWarning(raw: string, lang: string): string {
  const locale = normalize(lang);
  const code = baseCode(raw);
  for (const t of TEMPLATES) {
    if (t.code !== code) continue;
    const m = t.match.exec(raw.trim());
    if (!m) continue;
    const params: Record<string, string> = {};
    t.names.forEach((name, i) => {
      params[name] = m[i + 1] ?? "";
    });
    const sentence = t.text(params)[locale];
    return localizeDates(sentence, locale);
  }
  return localizeDates(raw.trim(), locale);
}

function localizeDates(sentence: string, locale: EngineLang): string {
  return sentence.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => formatCivilDate(iso, locale));
}
