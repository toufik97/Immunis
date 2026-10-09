import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadSchedulePack } from "./loader";
import { evaluatePatient, type EngineResult } from "./engine";
import { parseDate } from "./engine/duration";
import { toStructured } from "./engine/warnings";
import type { ImmunizationRecord, Patient, AvailabilityInput } from "./types";

const COUNTRY = process.env.COUNTRY_PACK ?? "MA";
const PORT = Number(process.env.PORT ?? 5173);
const pack = loadSchedulePack(COUNTRY);

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
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
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

// Pack metadata included in every evaluate response (the pack is draft / pending).
const packMeta = {
  packId: (pack.catalog as any).meta?.pack_id,
  version: (pack.catalog as any).meta?.version,
  status: (pack.catalog as any).meta?.status,
  clinicalApproval: (pack.catalog as any).meta?.clinical_approval
};

// Convert engine string warnings into structured EngineWarning objects for the UI.
function structureResult(result: EngineResult, evaluationDateStr: string): unknown {
  const mapWs = (ws: string[] | undefined) => (ws ?? []).map(toStructured);
  return {
    pack: packMeta,
    patient: result.patient,
    evaluationDate: evaluationDateStr, // YYYY-MM-DD, not a UTC Date
    doseCounts: result.doseCounts,
    doseValidations: Object.fromEntries(
      Object.entries(result.doseValidations).map(([counter, v]: [string, any]) => [
        counter,
        {
          counterId: v.counterId,
          validDoseCount: v.validDoseCount,
          doses: (v.doses ?? []).map((d: any) => ({
            ...d,
            reasons: mapWs(d.reasons),
            warnings: mapWs(d.warnings)
          }))
        }
      ])
    ),
    antigenNeeds: result.antigenNeeds.map((n: any) => ({ ...n, warnings: mapWs(n.warnings) })),
    productSelection: { ...result.productSelection, warnings: mapWs(result.productSelection.warnings) },
    visitPlan: { ...result.visitPlan, warnings: mapWs(result.visitPlan.warnings) },
    assumptions: (result.assumptions ?? []).map((a: string) => ({ ...toStructured(a), severity: "info" })),
    inputWarnings: mapWs(result.inputWarnings)
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && (url === "/" || url === "/index.html")) {
      const htmlPath = path.resolve(process.cwd(), "ui", "index.html");
      if (!fs.existsSync(htmlPath)) {
        return sendJson(res, 500, { error: "ui/index.html not found" });
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(htmlPath).pipe(res);
      return;
    }

    if (method === "GET" && url === "/api/pack") {
      const catalog: any = pack.catalog;
      const counters: any = pack.counters;
      return sendJson(res, 200, {
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
    }

    if (method === "POST" && url === "/api/evaluate") {
      const rawBody = await readBody(req);
      let payload: any;
      try { payload = JSON.parse(rawBody); }
      catch { return sendJson(res, 400, { error: "Invalid JSON request body" }); }

      if (!isValidDateString(payload.birthDate))
        return sendJson(res, 400, { error: "birthDate is required and must use YYYY-MM-DD format" });
      if (!isValidDateString(payload.evaluationDate))
        return sendJson(res, 400, { error: "evaluationDate is required and must use YYYY-MM-DD format" });

      const birthDate = parseDate(payload.birthDate);
      const evaluationDate = parseDate(payload.evaluationDate);
      if (evaluationDate < birthDate)
        return sendJson(res, 400, { error: "evaluationDate cannot be before birthDate" });

      // ---- availability (stock) forwarding ----
      let availability: AvailabilityInput | undefined;
      if (payload.availability !== undefined) {
        const policy = payload.availability?.policy;
        const products = payload.availability?.products;
        if (policy !== undefined && !["TRANSITION", "CONTINUITY_FIRST", "STOCK_DRIVEN"].includes(policy))
          return sendJson(res, 400, { error: "availability.policy must be TRANSITION, CONTINUITY_FIRST or STOCK_DRIVEN" });
        if (products !== undefined && !Array.isArray(products))
          return sendJson(res, 400, { error: "availability.products must be an array of product group ids" });
        if (policy === "STOCK_DRIVEN" && (!Array.isArray(products) || products.length === 0))
          return sendJson(res, 400, { error: "availability.policy STOCK_DRIVEN requires a non-empty availability.products list" });
        availability = { policy, products };
      }

      // ---- history validation → 400 with details (not 500) ----
      const rawHistory = payload.history === undefined ? [] : payload.history;
      if (!Array.isArray(rawHistory))
        return sendJson(res, 400, { error: "history must be an array" });
      const historyErrors: string[] = [];
      const history: ImmunizationRecord[] = [];
      rawHistory.forEach((row: any, index: number) => {
        if (!isValidDateString(row?.administeredOn))
          return historyErrors.push(`history[${index}].administeredOn is required and must use YYYY-MM-DD format`);
        if (typeof row?.productGroupId !== "string" || row.productGroupId === "")
          return historyErrors.push(`history[${index}].productGroupId is required`);
        if (parseDate(row.administeredOn) > evaluationDate)
          return historyErrors.push(`history[${index}] date ${row.administeredOn} is after evaluationDate`);
        history.push({ administeredOn: row.administeredOn, productGroupId: row.productGroupId, overridden: row.overridden === true });
      });
      if (historyErrors.length)
        return sendJson(res, 400, { error: "Invalid history", details: historyErrors });

      const projection = payload.projection === "full" ? "full" : "next";
      const result = evaluatePatient(
        { birthDate: payload.birthDate } as Patient,
        history,
        pack,
        evaluationDate,
        { projection, availability }
      );
      return sendJson(res, 200, structureResult(result, payload.evaluationDate));
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error: any) {
    sendJson(res, 500, { error: error?.message ?? "Unexpected server error" });
  }
});

server.listen(PORT, () => {
  console.log("Immunis UI");
  console.log("--------------------------------");
  console.log(`URL: http://localhost:${PORT}`);
  console.log(`Country pack: ${COUNTRY}`);
  console.log("Press Ctrl+C to stop.");
});