import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSchedulePack } from "../../src/infra/packs/loader";
import { validatePack } from "../../src/infra/packs/pack-validation";

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

  function packWithAnchor(id: string, anchor: unknown) {
    const pack = structuredClone(loadSchedulePack("MA"));
    const group = (pack.catalog.product_groups as { id: string }[]).find((g) => g.id === id);
    (group as Record<string, unknown>)["anchor_to"] = anchor;
    return pack;
  }

  describe("co-administration anchors", () => {
    it("accepts the shipped VPO/VPI/ROTA/Prevenar → PENTA anchors", () => {
      expect(validatePack(loadSchedulePack("MA")).errors).toEqual([]);
    });

    it("rejects unknown targets, self-anchors and chains", () => {
      expect(validatePack(packWithAnchor("VPO", "NOPE")).errors.join()).toMatch(/anchor_to/);
      expect(validatePack(packWithAnchor("VPO", "VPO")).errors.join()).toMatch(/itself/);
      expect(validatePack(packWithAnchor("PENTA", "VPO")).errors.join()).toMatch(/chains/);
    });

    it("rejects anchors against same-day-forbidden spacing pairs", () => {
      // PrimoVax must stay unanchored: the 14d fiche rule would fight the pull.
      expect(validatePack(packWithAnchor("PCV_PRIMOVAX", "PENTA")).errors.join()).toMatch(/PCV13TT_DTP_OFFSET_14D/);
    });
  });
});
