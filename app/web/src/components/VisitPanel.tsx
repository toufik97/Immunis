import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Child, type Dose, type GateIssue, type Lot } from "../api";

interface Props {
  child: Child;
  products: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
  onDone: () => void;
}

function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export default function VisitPanel({ child, products, programs, onDone }: Props) {
  const { t } = useTranslation();
  const [visitDate, setVisitDate] = useState(today());
  const [screening, setScreening] = useState("VACCINATE");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [history, setHistory] = useState<Dose[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, Lot[]>>({});
  const [nextRdv, setNextRdv] = useState("");
  const [projection, setProjection] = useState<"next" | "full">("next");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.evaluate>> | null>(null);
  const [recording, setRecording] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [gateIssues, setGateIssues] = useState<GateIssue[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const productLabel = (id: string) => products.find((p) => p.id === id)?.label_fr ?? id;
  const programLabel = (id: string) => programs.find((p) => p.id === id)?.label_fr ?? id;

  async function fetchHistory(): Promise<void> {
    try {
      setHistory(await api.childDoses(child.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function evaluate(silent = false): Promise<void> {
    if (!silent) setErr("");
    setEvaluating(true);
    try {
      const r = await api.evaluate({
        childId: child.id,
        evaluationDate: visitDate,
        projection,
      });
      setResult(r);
      // Suggest the next appointment from the planner; the nurse may override.
      if (!nextRdv) {
        const upcoming = r.visitPlan.visits.find((v) => v.date > visitDate) ?? r.visitPlan.visits[0];
        if (upcoming) setNextRdv(upcoming.date);
      }
    } catch (e) {
      if (!silent) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEvaluating(false);
    }
  }

  // Recorded history, shown read-only so the nurse never re-enters it.
  // Auto-evaluate once so the plan and next-appointment suggestion are ready.
  useEffect(() => {
    setHistory([]);
    void fetchHistory();
    void evaluate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id]);

  // Load usable lots for every product used by a CENTRE dose row.
  // Server filters expiry + cold chain + stock (FEFO); the picker shows them as-is.
  useEffect(() => {
    const needed = [...new Set(doses.filter((d) => d.origin === "CENTRE").map((d) => d.productGroupId))].filter(
      (p) => p && !(p in lotsByProduct)
    );
    if (needed.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await Promise.all(needed.map(async (p) => [p, await api.lots(p, visitDate)] as const));
        if (!cancelled) setLotsByProduct((m) => ({ ...m, ...Object.fromEntries(entries) }));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const blockedByScreening = screening !== "VACCINATE" && doses.length > 0;

  function addDose(): void {
    if (screening !== "VACCINATE") return;
    setDoses((d) => [
      ...d,
      {
        productGroupId: products[0]?.id ?? "",
        administeredOn: visitDate,
        origin: "CENTRE",
        overridden: false,
        recordedBy: "nurse",
      },
    ]);
  }

  async function record(withOverride: boolean): Promise<void> {
    setErr("");
    setMsg("");
    const missingLot = doses.some((d) => d.origin === "CENTRE" && !d.lotId);
    if (missingLot) {
      setErr(t("visit.lotRequired"));
      return;
    }
    if (withOverride && !overrideReason.trim()) {
      setErr(t("visit.overrideReasonRequired"));
      return;
    }
    setRecording(true);
    try {
      const payload = doses.map((d, i) => ({
        ...d,
        overridden:
          d.overridden || (withOverride && gateIssues.some((g) => g.doseIndex === i)),
      }));
      const r = await api.recordEncounterDetailed({
        childId: child.id,
        birthDate: child.birthDate,
        date: visitDate,
        screening,
        weightKg: weightKg ? Number(weightKg) : undefined,
        heightCm: heightCm ? Number(heightCm) : undefined,
        doses: payload,
        nextAppointmentDate: nextRdv || undefined,
        ...(withOverride ? { overrideReason } : {}),
      });
      if (r.status === "gated") {
        setGateIssues(r.issues);
      } else {
        setGateIssues([]);
        setOverrideReason("");
        setDoses([]);
        setNextRdv("");
        setMsg(t("visit.recorded"));
        await fetchHistory();
        onDone();
      }
    } catch (e) {
      setGateIssues([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRecording(false);
    }
  }

  const canOverride = gateIssues.some((g) => g.overridable);

  return (
    <section className="card">
      <h2>
        {child.givenName} {child.familyName} · {t("child.birthDate", { date: child.birthDate })}
      </h2>
      <p className="hint">
        {[child.fatherName, child.motherName].filter(Boolean).join(" · ")}
        {child.address ? ` · ${child.address}` : ""}
        {(child.localIds ?? []).map((l) => ` · ${t("child.localId", { value: l.value })}`).join("")}
      </p>
      <p className="hint">{t("visit.howto")}</p>
      <div className="grid">
        <label>
          {t("visit.visitDate")}
          <input type="date" value={visitDate} max={today()} onChange={(e) => setVisitDate(e.target.value)} />
        </label>
        <label>
          {t("visit.screening")}
          <select value={screening} onChange={(e) => setScreening(e.target.value)}>
            {["VACCINATE", "DEFER", "CONTRAINDICATED"].map((s) => (
              <option key={s} value={s}>
                {t(`screening.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("visit.weight")}
          <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} type="number" step="0.1" min="0" />
        </label>
        <label>
          {t("visit.height")}
          <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} type="number" step="0.1" min="0" />
        </label>
        <label>
          {t("visit.nextRdv")}
          <input value={nextRdv} min={visitDate} onChange={(e) => setNextRdv(e.target.value)} type="date" />
        </label>
      </div>

      <h3>{t("visit.recordedDoses")}</h3>
      {history.length === 0 ? (
        <p className="hint">{t("visit.noRecorded")}</p>
      ) : (
        <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{t("visit.date")}</th>
              <th>{t("visit.product")}</th>
              <th>{t("visit.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((d, i) => (
              <tr key={i}>
                <td>{d.administeredOn}</td>
                <td>{productLabel(d.productGroupId)}</td>
                <td>{t(`origin.${d.origin}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <h3>{t("visit.newDoses")}</h3>
      {blockedByScreening && <p className="hint">{t("visit.screeningBlocks")}</p>}
      {doses.map((d, i) => (
        <div key={i} className="dose">
        <div className="row">
          <select
            value={d.productGroupId}
            aria-label={t("visit.product")}
            onChange={(e) =>
              setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, productGroupId: e.target.value, lotId: undefined } : x)))
            }
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label_fr ?? p.id}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={d.administeredOn}
            max={visitDate}
            aria-label={t("visit.date")}
            onChange={(e) =>
              setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, administeredOn: e.target.value } : x)))
            }
          />
          <select
            value={d.origin}
            aria-label={t("visit.origin")}
            onChange={(e) =>
              setDoses((ds) =>
                ds.map((x, j) => (j === i ? { ...x, origin: e.target.value as Dose["origin"], lotId: undefined } : x))
              )
            }
          >
            {(["CENTRE", "EXTERNAL", "CAMPAIGN"] as const).map((o) => (
              <option key={o} value={o}>
                {t(`origin.${o}`)}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={() => setDoses((ds) => ds.filter((_, j) => j !== i))}>
            {t("common.remove")}
          </button>
        </div>
        {d.origin === "CENTRE" && (
          <div className="row">
            <label>
              {t("visit.lot")}
              {(lotsByProduct[d.productGroupId] ?? []).length === 0 ? (
                <span className="hint"> {t("visit.nolot")}</span>
              ) : (
                <select
                  value={d.lotId ?? ""}
                  onChange={(e) =>
                    setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, lotId: e.target.value || undefined } : x)))
                  }
                >
                  <option value="">—</option>
                  {(lotsByProduct[d.productGroupId] ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lotNumber} · {l.expiryDate} · ×{l.qtyOnHand}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
        )}
        </div>
      ))}
      <div className="toolbar">
        <button className="secondary" onClick={addDose} disabled={screening !== "VACCINATE"}>
          {t("visit.addDose")}
        </button>
        <button className="secondary" onClick={() => void evaluate()} disabled={evaluating}>
          {evaluating ? t("common.loading") : t("visit.evaluate")}
        </button>
        <button onClick={() => record(false)} disabled={recording || blockedByScreening}>
          {recording ? t("common.loading") : t("visit.record")}
        </button>
        <select value={projection} aria-label={t("visit.plan")} onChange={(e) => setProjection(e.target.value as "next" | "full")}>
          <option value="next">{t("visit.projNext")}</option>
          <option value="full">{t("visit.projFull")}</option>
        </select>
      </div>

      {gateIssues.length > 0 && (
        <div className="error">
          <p>{t("visit.gateTitle")}</p>
          <ul>
            {gateIssues.map((g, i) => (
              <li key={i}>
                {productLabel(g.productGroupId)} · {g.administeredOn} — {g.message} ({g.code})
              </li>
            ))}
          </ul>
          {!canOverride ? (
            <p>{t("visit.hardBlock")}</p>
          ) : (
            <>
              <label>
                {t("visit.overrideReason")}
                <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </label>
              <div className="toolbar">
                <button onClick={() => record(true)} disabled={recording}>
                  {t("visit.recordOverride")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {err && <div className="error">{t("common.error", { msg: err })}</div>}
      {msg && <div className="ok">{msg}</div>}

      {result && (
        <div>
          <h3>{t("visit.needs")}</h3>
          <ul>
            {result.antigenNeeds.map((n) => (
              <li key={n.programId}>
                {programLabel(n.programId)}: {n.status} ({n.dosesNeeded})
              </li>
            ))}
          </ul>
          <h3>{t("visit.plan")}</h3>
          {result.visitPlan.visits.length === 0 ? (
            <p className="hint">{t("visit.node")}</p>
          ) : (
            <ul>
              {result.visitPlan.visits.map((v, i) => (
                <li key={i}>
                  {v.date} — {v.products.map(productLabel).join(", ")} [{v.status}]
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
