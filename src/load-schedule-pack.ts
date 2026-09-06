import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { ZodError } from "zod";

import {
  CatalogSchema,
  CountersSchema,
  DtpProgramPolicySchema,
  type Catalog,
  type Counters,
  type DtpProgramPolicy
} from "./schedule-pack-schema";

export interface SchedulePack {
  catalog: Catalog;
  counters: Counters;
  programs: {
    dtp: DtpProgramPolicy;
  };
}

function readYaml(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");

  return parse(content);
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.join(".");

      if (issuePath.length === 0) {
        return `(root): ${issue.message}`;
      }

      return `${issuePath}: ${issue.message}`;
    })
    .join("\n");
}

export function loadSchedulePack(country = "MA"): SchedulePack {
  const packRoot = path.resolve(
    process.cwd(),
    "schedule-packs",
    country
  );

  const catalogPath = path.join(packRoot, "catalog.yaml");
  const countersPath = path.join(packRoot, "counters.yaml");
  const dtpPath = path.join(packRoot, "programs", "dtp.yaml");

  const rawCatalog = readYaml(catalogPath);
  const rawCounters = readYaml(countersPath);
  const rawDtp = readYaml(dtpPath);

  const catalogResult = CatalogSchema.safeParse(rawCatalog);

  if (!catalogResult.success) {
    throw new Error(
      `Invalid catalog.yaml:\n${formatZodError(catalogResult.error)}`
    );
  }

  const countersResult = CountersSchema.safeParse(rawCounters);

  if (!countersResult.success) {
    throw new Error(
      `Invalid counters.yaml:\n${formatZodError(countersResult.error)}`
    );
  }

  const dtpResult = DtpProgramPolicySchema.safeParse(rawDtp);

  if (!dtpResult.success) {
    throw new Error(
      `Invalid programs/dtp.yaml:\n${formatZodError(dtpResult.error)}`
    );
  }

  return {
    catalog: catalogResult.data,
    counters: countersResult.data,
    programs: {
      dtp: dtpResult.data
    }
  };
}