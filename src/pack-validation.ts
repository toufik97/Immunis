import type { SchedulePack } from "./loader";

export interface PackValidation {
  errors: string[];
  warnings: string[];
}

/**
 * Cross-reference checks that zod cannot do on its own: every id a rule or
 * config mentions must exist. Errors make the pack unsafe to load (a rule would
 * silently never match, or point at nothing); warnings are inconsistencies that
 * do not change engine behavior today.
 */
export function validatePack(pack: SchedulePack): PackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const catalog = pack.catalog;
  const counters = pack.counters.counters ?? [];
  const productIds = new Set<string>((catalog.product_groups ?? []).map((g) => g.id));
  const antigenIds = new Set<string>((catalog.antigens ?? []).map((a) => a.id));
  const counterIds = new Set<string>(counters.map((c) => c.id));
  const programs = Object.values(pack.programs);

  const needProduct = (id: unknown, where: string) => {
    if (typeof id === "string" && !productIds.has(id)) {
      errors.push(`${where}: unknown product group "${id}"`);
    }
  };

  // --- catalog and counters
  const seenAlias = new Map<string, string>();
  for (const g of catalog.product_groups ?? []) {
    if (g.category !== undefined && g.category !== "vaccine" && g.category !== "supplement") {
      errors.push(`catalog product ${g.id}: category must be "vaccine" or "supplement", got "${g.category}"`);
    }
    for (const alias of g.aliases ?? []) {
      if (productIds.has(alias)) {
        errors.push(`catalog product ${g.id}: alias "${alias}" is also a product id`);
      } else if (seenAlias.has(alias)) {
        errors.push(`catalog product ${g.id}: alias "${alias}" already belongs to ${seenAlias.get(alias)}`);
      } else {
        seenAlias.set(alias, g.id);
      }
    }
  }
  for (const g of catalog.product_groups ?? []) {
    for (const ag of g.satisfies_antigens ?? []) {
      if (!antigenIds.has(ag)) {
        warnings.push(`catalog product ${g.id}: antigen "${ag}" is not listed in catalog.antigens`);
      }
    }
  }
  for (const c of counters) {
    for (const pg of c.counts_product_groups ?? []) needProduct(pg, `counter ${c.id}`);
  }
  const ownedCounters = new Set<string>(programs.map(p => p.program?.counter));
  for (const c of counters) {
    if (!ownedCounters.has(c.id)) {
      warnings.push(`counter ${c.id} is not used by any program`);
    }
  }
  // Shared counters: only the first program's validity rules are used.
  // Fail the pack so the future system never gets silent wrong intervals.
  const ownersByCounter = new Map<string, string[]>();
  for (const p of programs) {
    const cid = p.program?.counter;
    const pid = p.program?.id;
    if (!cid || !pid) continue;
    ownersByCounter.set(cid, [...(ownersByCounter.get(cid) ?? []), pid]);
  }
  for (const [cid, owners] of ownersByCounter) {
    if (owners.length > 1) {
      errors.push(`counter "${cid}" is shared by ${owners.join(", ")}; only the first program's validity rules apply — give each program its own counter`);
    }
  }

  // --- programs
  for (const program of programs) {
    const pid: string = program.program?.id;
    const at = (x: string) => `${pid}: ${x}`;

    if (!counterIds.has(program.program?.counter)) {
      errors.push(at(`counter "${program.program?.counter}" is not defined in counters.yaml`));
    }
    for (const ag of program.program?.antigen_targets ?? []) {
      if (!antigenIds.has(ag)) {
        warnings.push(at(`antigen target "${ag}" is not listed in catalog.antigens`));
      }
    }

    const policies = program.booster_policies ?? [];
    const policyIds = new Set<string>(policies.map(p => p.id));
    const needPolicy = (id: unknown, where: string) => {
      if (typeof id === "string" && !policyIds.has(id)) {
        errors.push(`${where}: unknown booster policy "${id}"`);
      }
    };

    const primary = program.primary_series ?? {};
    needPolicy(primary.booster_policy, at("primary_series.booster_policy"));
    needProduct(primary.birth_dose?.product_group, at("primary_series.birth_dose.product_group"));
    for (const pg of primary.dose_zero?.product_groups ?? []) {
      needProduct(pg, at("primary_series.dose_zero.product_groups"));
    }
    for (const rule of primary.dose_validity ?? []) {
      needProduct(rule.product_group, at(`primary_series.dose_validity dose ${rule.dose}`));
      const amt = rule.dose_amount;
      if (amt !== undefined) {
        const okValue = typeof amt?.value === "number" && amt.value > 0;
        const okUnit = typeof amt?.unit === "string" && amt.unit.length > 0;
        if (!okValue || !okUnit) {
          errors.push(at(`primary_series.dose_validity dose ${rule.dose}: dose_amount needs a positive number "value" and a "unit"`));
        }
      }
    }

    for (const pol of policies) {
      for (const [key, cfg] of Object.entries<any>(pol)) {
        if (!/^booster_\d+$/.test(key)) continue;
        const where = at(`booster policy ${pol.id}.${key}`);
        const pg = cfg?.product_group;
        if (typeof pg === "string") needProduct(pg, where);
        else if (pg?.conditional) {
          for (const branch of pg.conditional) needProduct(branch.product, where);
        } else {
          errors.push(`${where}: product_group is missing`);
        }
      }
    }

    for (const cap of program.dose_caps ?? []) {
      if (!counterIds.has(cap.counter)) {
        errors.push(at(`dose cap refers to unknown counter "${cap.counter}"`));
      }
    }

    for (const rule of program.catchup_rules ?? []) {
      const where = at(`rule ${rule.id}`);
      const when = rule.when ?? {};
      const then = rule.then ?? {};
      if (when.counter?.id && when.counter.id !== program.program?.counter) {
        errors.push(`${where}: counter "${when.counter.id}" is not this program's counter ("${program.program?.counter}"), so the rule can never match`);
      }
      for (const pg of Object.keys(when.product_history ?? {})) {
        if (pg !== "_TOTAL") needProduct(pg, `${where} (product_history)`);
      }
      needProduct(when.availability?.includes, `${where} (availability.includes)`);
      needProduct(when.availability?.excludes, `${where} (availability.excludes)`);
      needProduct(then.target_product, `${where} (target_product)`);
      needPolicy(then.booster_policy, where);
    }
  }

  // --- product selection and spacing
  const ps = pack.productSelection?.product_selection ?? {};
  for (const e of (ps as { eligibility?: Array<{ product_group?: string }> }).eligibility ?? []) needProduct(e.product_group, "product-selection eligibility");
  for (const id of (ps as { product_ranking?: string[] }).product_ranking ?? []) needProduct(id, "product-selection product_ranking");
  for (const pol of (ps as { availability_policies?: Array<{ id?: string; reserved?: Array<{ product_group?: string }> }> }).availability_policies ?? []) {
    for (const r of pol.reserved ?? []) needProduct(r.product_group, `availability policy ${pol.id}`);
  }
  for (const r of pack.spacing?.spacing_rules ?? []) {
    for (const p of r.applies_when?.pairs ?? []) {
      needProduct(p.product_a, `spacing rule ${r.id}`);
      needProduct(p.product_b, `spacing rule ${r.id}`);
    }
    for (const ex of r.exemptions ?? []) {
      needProduct(ex.product_a, `spacing rule ${r.id} exemption`);
      needProduct(ex.product_b, `spacing rule ${r.id} exemption`);
    }
    needProduct(r.move_on_tie, `spacing rule ${r.id} move_on_tie`);
    needProduct(r.move, `spacing rule ${r.id} move`);
  }

  return { errors, warnings };
}
