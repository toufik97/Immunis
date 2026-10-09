import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  CatalogSchema,
  CountersSchema,
  ProgramSchema,
  ProductSelectionSchema,
  SpacingSchema,
  type Catalog,
  type Counters,
  type Program,
  type ProductSelection,
  type Spacing
} from "./schema";
import { validatePack } from "./pack-validation";

export interface SchedulePack {
  catalog: Catalog;
  counters: Counters;
  programs: Record<string, Program>;
  productSelection: ProductSelection;
  spacing: Spacing;
  /** Non-fatal pack inconsistencies found at load time. */
  warnings: string[];
}

function loadYaml(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content);
}

export function loadSchedulePack(
  country = "MA",
  packsRoot = path.resolve(process.cwd(), "schedule-packs")
): SchedulePack {
  const root = path.join(packsRoot, country);
  const catalog = CatalogSchema.parse(
    loadYaml(path.join(root, "catalog.yaml"))
  );
  const counters = CountersSchema.parse(
    loadYaml(path.join(root, "counters.yaml"))
  );
  const productSelection = ProductSelectionSchema.parse(
    loadYaml(path.join(root, "product-selection.yaml"))
  );
  
  const spacingPath = path.join(root, "spacing.yaml");
  const spacing: Spacing = SpacingSchema.parse(
    fs.existsSync(spacingPath)
      ? loadYaml(spacingPath)
      : { spacing_rules: [] }
  );

  const programsDir = path.join(root, "programs");
  const programs: Record<string, Program> = {};
  for (const file of fs.readdirSync(programsDir).sort()) {
    if (!file.endsWith(".yaml")) {
      continue;
    }
    const raw = loadYaml(path.join(programsDir, file));
    const parsed = ProgramSchema.parse(raw);
    programs[parsed.program.id] = parsed;
  }
  
  const pack: SchedulePack = {
    catalog,
    counters,
    programs,
    productSelection,
    spacing,
    warnings: []
  };

  const { errors, warnings } = validatePack(pack);
  if (errors.length > 0) {
    throw new Error(
      `Schedule pack ${country} is inconsistent:\n - ${errors.join("\n - ")}`
    );
  }
  pack.warnings = warnings;
  return pack;
}