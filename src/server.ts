import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { loadSchedulePack } from "./loader";
import { evaluatePatient } from "./engine";
import { parseDate } from "./engine/duration";

import type { ImmunizationRecord, Patient } from "./types";

const COUNTRY = process.env.COUNTRY_PACK ?? "MA";
const PORT = Number(process.env.PORT ?? 5173);

const pack = loadSchedulePack(COUNTRY);

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  const body = JSON.stringify(data, null, 2);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);

  return !Number.isNaN(date.getTime());
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && (url === "/" || url === "/index.html")) {
      const htmlPath = path.resolve(process.cwd(), "ui", "index.html");

      if (!fs.existsSync(htmlPath)) {
        sendJson(res, 500, {
          error: "ui/index.html not found"
        });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });

      fs.createReadStream(htmlPath).pipe(res);
      return;
    }

    if (method === "GET" && url === "/api/pack") {
      const catalog: any = pack.catalog;
      const counters: any = pack.counters;

      sendJson(res, 200, {
        country: catalog.meta?.country,
        packId: catalog.meta?.pack_id,
        version: catalog.meta?.version,
        status: catalog.meta?.status,
        clinicalApproval: catalog.meta?.clinical_approval,

        productGroups: (catalog.product_groups ?? []).map((product: any) => ({
          id: product.id,
          label_fr: product.label_fr,
          satisfies_antigens: product.satisfies_antigens ?? []
        })),

        counters: (counters.counters ?? []).map((counter: any) => ({
          id: counter.id,
          label_fr: counter.label_fr,
          counts_product_groups: counter.counts_product_groups ?? []
        })),

        programs: (Object.values(pack.programs) as any[]).map((program: any) => ({
          id: program.program?.id,
          label_fr: program.program?.label_fr,
          antigen_targets: program.program?.antigen_targets ?? [],
          counter: program.program?.counter
        }))
      });

      return;
    }

    if (method === "POST" && url === "/api/evaluate") {
      const rawBody = await readBody(req);

      let payload: any;

      try {
        payload = JSON.parse(rawBody);
      } catch {
        sendJson(res, 400, {
          error: "Invalid JSON request body"
        });
        return;
      }

      if (!isValidDateString(payload.birthDate)) {
        sendJson(res, 400, {
          error: "birthDate is required and must use YYYY-MM-DD format"
        });
        return;
      }

      if (!isValidDateString(payload.evaluationDate)) {
        sendJson(res, 400, {
          error: "evaluationDate is required and must use YYYY-MM-DD format"
        });
        return;
      }

      const birthDate = parseDate(payload.birthDate);
      const evaluationDate = parseDate(payload.evaluationDate);

      if (evaluationDate < birthDate) {
        sendJson(res, 400, {
          error: "evaluationDate cannot be before birthDate"
        });
        return;
      }

      const history: ImmunizationRecord[] = Array.isArray(payload.history)
        ? payload.history.map((row: any, index: number) => {
            if (!isValidDateString(row?.administeredOn)) {
              throw new Error(
                `history[${index}].administeredOn is required and must use YYYY-MM-DD format`
              );
            }

            if (typeof row?.productGroupId !== "string" || row.productGroupId === "") {
              throw new Error(`history[${index}].productGroupId is required`);
            }

            const administeredOn = parseDate(row.administeredOn);

            if (administeredOn > evaluationDate) {
              throw new Error(
                `history[${index}] date ${row.administeredOn} is after evaluationDate`
              );
            }

            return {
              administeredOn: row.administeredOn,
              productGroupId: row.productGroupId,
              overridden: row.overridden === true
            };
          })
        : [];

      const patient: Patient = {
        birthDate: payload.birthDate
      };

      const projection =
        payload.projection === "full" ? "full" : "next";

      const result = evaluatePatient(patient, history, pack, parseDate(payload.evaluationDate), {
        projection
      });

      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, {
      error: "Not found"
    });
  } catch (error: any) {
    sendJson(res, 500, {
      error: error?.message ?? "Unexpected server error"
    });
  }
});

server.listen(PORT, () => {
  console.log("Temporary vaccination engine UI");
  console.log("--------------------------------");
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Country pack: ${COUNTRY}`);
  console.log("Press Ctrl+C to stop.");
});