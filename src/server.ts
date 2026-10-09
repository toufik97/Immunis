import fs from "node:fs";
import path from "node:path";
import { loadSchedulePack } from "./infra/packs/loader";
import { openDb } from "./infra/db/connection";
import { buildApp } from "./api/app";

const COUNTRY = process.env.COUNTRY_PACK ?? "MA";
const PORT = Number(process.env.PORT ?? 5173);
const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data", "immunis.db");

const pack = loadSchedulePack(COUNTRY);
const db = openDb(DB_PATH);
const app = buildApp(db, pack);

// Static playground page (React SPA mounts here in Phase 3).
app.get("/", async (_req, reply) => {
  const htmlPath = path.resolve(process.cwd(), "app", "web", "index.html");
  if (!fs.existsSync(htmlPath)) {
    reply.code(500).send({ error: "app/web/index.html not found" });
    return;
  }
  reply.header("Content-Type", "text/html; charset=utf-8").send(fs.readFileSync(htmlPath, "utf8"));
});

app.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("Immunis");
  console.log("--------------------------------");
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Country pack: ${COUNTRY}`);
  console.log(`DB: ${DB_PATH}`);
  console.log("Press Ctrl+C to stop.");
});
