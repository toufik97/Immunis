import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSchedulePack } from "../../src/infra/packs/loader";

describe("pack loader", () => {
  it("refuses two program files with the same id instead of last-wins", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "immunis-pack-"));
    fs.cpSync(path.resolve(process.cwd(), "schedule-packs", "MA"), path.join(dir, "MA"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(dir, "MA", "programs", "bcg.yaml"),
      path.join(dir, "MA", "programs", "zz-dup.yaml")
    );
    expect(() => loadSchedulePack("MA", dir)).toThrow(/duplicate program id/);
  });
});
