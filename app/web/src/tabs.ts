/** Tab memory: reopen where the nurse left off, but each new day starts on Today. */

export type Tab = "today" | "registry" | "noshows" | "stock";

const TABS: Tab[] = ["today", "registry", "noshows", "stock"];

export function isTab(v: string | null): v is Tab {
  return !!v && (TABS as string[]).includes(v);
}

/** Legacy tab names from before the registry/today split. */
export function migrateTab(v: string | null): Tab | null {
  if (v === "visit") return "registry";
  if (v === "session") return "today";
  return isTab(v) ? v : null;
}

export function resolveInitialTab(
  urlTab: string | null,
  storedTab: string | null,
  storedDate: string | null,
  today: string
): Tab {
  const fromUrl = migrateTab(urlTab);
  if (fromUrl) return fromUrl;
  if (storedDate === today) {
    const fromStored = migrateTab(storedTab);
    if (fromStored) return fromStored;
  }
  return "today";
}
