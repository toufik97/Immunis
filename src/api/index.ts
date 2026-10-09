import type { FastifyInstance } from "fastify";

/** API routes (Fastify). Engine evaluate route migrates here from server.ts. */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ ok: true }));
}
