/** Outbox for local → central sync (v1: file export + backup, aggregation later). */
export interface OutboxEntry {
  id: string;
  kind: string;
  payload: string;
  createdAt: string;
  syncedAt: string | null;
}
