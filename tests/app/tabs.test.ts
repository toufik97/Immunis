import { describe, it, expect } from "vitest";
import { migrateTab, resolveInitialTab } from "../../app/web/src/tabs";

describe("tab memory", () => {
  it("maps legacy tabs to the split pages", () => {
    expect(migrateTab("visit")).toBe("registry");
    expect(migrateTab("session")).toBe("session");
    expect(migrateTab("today")).toBe("today");
    expect(migrateTab("nope")).toBe(null);
    expect(migrateTab(null)).toBe(null);
  });

  it("prefers the URL, then today's stored tab, else today", () => {
    expect(resolveInitialTab("noshows", "registry", "2026-10-10", "2026-10-10")).toBe("noshows");
    expect(resolveInitialTab(null, "registry", "2026-10-10", "2026-10-10")).toBe("registry");
    expect(resolveInitialTab(null, "registry", "2026-10-09", "2026-10-10")).toBe("today");
    expect(resolveInitialTab(null, null, null, "2026-10-10")).toBe("today");
  });
});
