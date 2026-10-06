import type { SchedulePack } from "../loader";
import type { ImmunizationRecord } from "../types";

/**
 * Map old product ids (catalog `aliases`) to the current product group and flag
 * ids the catalog does not know. Without this, a mistyped or retired product id
 * is silently ignored by every counter and the child looks unvaccinated.
 */
export function normalizeHistory(
  history: ImmunizationRecord[],
  pack: SchedulePack
): { history: ImmunizationRecord[]; warnings: string[] } {
  const groups: any[] = (pack.catalog as any).product_groups ?? [];
  const known = new Set<string>(groups.map(g => g.id));
  const aliasToId = new Map<string, string>();
  for (const g of groups) {
    for (const alias of g.aliases ?? []) aliasToId.set(alias, g.id);
  }

  const warnings: string[] = [];
  const out: ImmunizationRecord[] = [];
  for (const record of history) {
    const id = record.productGroupId;
    if (known.has(id)) {
      out.push(record);
    } else if (aliasToId.has(id)) {
      out.push({ ...record, productGroupId: aliasToId.get(id)! });
    } else {
      warnings.push(
        `UNKNOWN_PRODUCT_IN_HISTORY: "${id}" (given ${record.administeredOn}) is not in the catalog; record ignored.`
      );
    }
  }
  return { history: out, warnings };
}
