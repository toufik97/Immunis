import { api } from "./api";
import { todayCivilDate } from "./format";

let cached: { zone: string; today: string } | null = null;
let inflight: Promise<{ zone: string; today: string }> | null = null;

/**
 * Centre clock from the server (zone + today). One fetch, then cached.
 * Falls back to the device date when offline — the server gate stays the
 * real protection, this only keeps defaults and bounds honest.
 */
export function centreTime(): Promise<{ zone: string; today: string }> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .time()
      .then((t) => ({ zone: t.zone, today: t.today }))
      .catch(() => ({ zone: "UTC", today: todayCivilDate() }))
      .then((t) => {
        cached = t;
        inflight = null;
        return t;
      });
  }
  return inflight;
}
