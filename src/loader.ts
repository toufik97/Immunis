import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  CatalogSchema,
  CountersSchema,
  ProgramSchema,
  ProductSelectionSchema,
  type Catalog,
  type Counters,
  type Program,
  type ProductSelection
} from "./schema";

export interface SchedulePack {
  catalog: Catalog;
  counters: Counters;
  programs: Record<string, Program>;
  productSelection: ProductSelection;
  spacing: any;
}

function loadYaml(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content);
}

export function loadSchedulePack(country = "MA"): SchedulePack {
  const root = path.resolve(process.cwd(), "schedule-packs", country);
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
  const spacing: any = fs.existsSync(spacingPath)
    ? loadYaml(spacingPath)
    : { spacing_rules: [] };

  const programsDir = path.join(root, "programs");
  const programs: Record<string, Program> = {};
  for (const file of fs.readdirSync(programsDir)) {
    if (!file.endsWith(".yaml")) {
      continue;
    }
    const raw = loadYaml(path.join(programsDir, file));
    const parsed = ProgramSchema.parse(raw);
    programs[parsed.program.id] = parsed;
  }
  
  return {
    catalog,
    counters,
    programs,
    productSelection,
    spacing
  };
}