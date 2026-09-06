import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

import {
  dtpProgramPolicySchema,
  type DtpProgramPolicy
} from "./dtp-policy-schema";

export function loadDtpPolicy(): DtpProgramPolicy {
  const filePath = path.resolve(process.cwd(), "policy", "dtp.yaml");

  if (!fs.existsSync(filePath)) {
    throw new Error(`DTP policy file not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, "utf8");

  const rawPolicy = parse(fileContent);

  const result = dtpProgramPolicySchema.safeParse(rawPolicy);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const issuePath = issue.path.join(".");

        if (issuePath.length === 0) {
          return `(root): ${issue.message}`;
        }

        return `${issuePath}: ${issue.message}`;
      })
      .join("\n");

    throw new Error(`Invalid DTP policy YAML:\n${details}`);
  }

  return result.data;
}