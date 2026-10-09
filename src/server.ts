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

// Static SPA: serve app/web/dist when built, else the Vite dev entry.
const DIST = path.resolve(process.cwd(), "app", "web", "dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

app.get("/", async (_req, reply) => {
  const index = path.join(DIST, "index.html");
  if (fs.existsSync(index)) {
    reply.header("Content-Type", MIME[".html"]).send(fs.readFileSync(index, "utf8"));
    return;
  }
  const devEntry = path.resolve(process.cwd(), "app", "web", "index.html");
  if (!fs.existsSync(devEntry)) {
    reply.code(500).send({ error: "web UI not built: run npm --prefix app/web run build" });
    return;
  }
  reply.header("Content-Type", MIME[".html"]).send(fs.readFileSync(devEntry, "utf8"));
});

app.get("/assets/:file", async (req, reply) => {
  const file = (req.params as Record<string, string>).file.replace(/[/\\.]{2,}/g, "");
  const full = path.join(DIST, "assets", path.basename(file));
  if (!full.startsWith(DIST) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    reply.code(404).send({ error: "Not found" });
    return;
  }
  reply.header("Content-Type", MIME[path.extname(full)] ?? "application/octet-stream").send(fs.readFileSync(full));
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
