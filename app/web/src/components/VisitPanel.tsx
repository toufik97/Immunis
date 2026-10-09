import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Child, type Dose, type Lot } from "../api";

interface Props {
  child: Child;
  products: { id: string; label_fr?: string }[];
  onDone: () => void;
}

function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export default function VisitPanel({ child, products, onDone }: Props) {
  const { t } = useTranslation();
  // Registry birth date is read-only: identity is confirmed, never edited here.
  const [confirmed, setConfirmed] = useState(false);
  const [screening, setScreening] = useState("VACCINATE");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [history, setHistory] = useState<Dose[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, Lot[]>>({});
  const [nextRdv, setNextRdv] = useState("");
  const [projection, setProjection] = useState<"next" | "full">("next");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.evaluate>> | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Recorded history, shown read-only so the nurse never re-enters it.
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    void api
      .childDoses(child.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [child.id]);

  // Load usable lots for every product used by a CENTRE dose row.
  useEffect(() => {
    const needed = [...new Set(doses.filter((d) => d.origin === "CENTRE").map((d) => d.productGroupId))].filter(
      (p) => p && !(p in lotsByProduct)
    );
    if (needed.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(needed.map(async (p) => [p, await api.lots(p)] as const));
      if (!cancelled) setLotsByProduct((m) => ({ ...m, ...Object.fromEntries(entries) }));
    })();
    return () => {
      cancelled = true;
    };
  });

  function addDose(): void {
    setDoses((d) => [
      ...d,
      {
        productGroupId: products[0]?.id ?? "",
        administeredOn: today(),
        origin: "CENTRE",
        overridden: false,
        recordedBy: "nurse",
      },
    ]);
  }

  async function evaluate(): Promise<void> {
    setErr("");
    try {
      const r = await api.evaluate({
        childId: child.id,
        evaluationDate: today(),
        projection,
      });
      setResult(r);
      // Suggest the next appointment from the planner; the nurse may override.
      if (!nextRdv) {
        const upcoming = r.visitPlan.visits.find((v) => v.date > today()) ?? r.visitPlan.visits[0];
        if (upcoming) setNextRdv(upcoming.date);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function record(): Promise<void> {
    setErr("");
    setMsg("");
    const missingLot = doses.some((d) => d.origin === "CENTRE" && !d.lotId);
    if (missingLot) {
      setErr(t("visit.lotRequired"));
      return;
    }
    try {
      await api.recordEncounter({
        childId: child.id,
        birthDate: child.birthDate,
        date: today(),
        screening,
        weightKg: weightKg ? Number(weightKg) : undefined,
        heightCm: heightCm ? Number(heightCm) : undefined,
        doses,
        nextAppointmentDate: nextRdv || undefined,
      });
      setMsg(t("visit.recorded"));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="card">
      <h2>
        {child.givenName} {child.familyName} · {t("child.birthDate", { date: child.birthDate })}
      </h2>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t("visit.identityVerified")}
      </label>
      <div className="grid">
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
          <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} type="number" step="0.1" />
        </label>
        <label>
          {t("visit.height")}
          <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} type="number" step="0.1" />
        </label>
        <label>
          {t("visit.nextRdv")}
          <input value={nextRdv} onChange={(e) => setNextRdv(e.target.value)} type="date" />
        </label>
      </div>

      <h3>{t("visit.recordedDoses")}</h3>
      {history.length === 0 ? (
        <p className="hint">{t("visit.noRecorded")}</p>
      ) : (
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
                <td>{d.productGroupId}</td>
                <td>{t(`origin.${d.origin}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{t("visit.newDoses")}</h3>
      {doses.map((d, i) => (
        <div key={i}>
        <div className="row">
          <select
            value={d.productGroupId}
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
            max={today()}
            onChange={(e) =>
              setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, administeredOn: e.target.value } : x)))
            }
          />
          <select
            value={d.origin}
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
              {(lotsByProduct[d.productGroupId] ?? []).filter((l) => l.qtyOnHand > 0).length === 0 ? (
                <span className="hint"> {t("visit.nolot")}</span>
              ) : (
                <select
                  value={d.lotId ?? ""}
                  onChange={(e) =>
                    setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, lotId: e.target.value || undefined } : x)))
                  }
                >
                  <option value="">—</option>
                  {(lotsByProduct[d.productGroupId] ?? [])
                    .filter((l) => l.qtyOnHand > 0)
                    .map((l) => (
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
        <button className="secondary" onClick={addDose}>
          {t("visit.addDose")}
        </button>
        <button onClick={evaluate} disabled={!confirmed}>
          {t("visit.evaluate")}
        </button>
        <button onClick={record} disabled={!confirmed || (screening !== "VACCINATE" && doses.length > 0)}>
          {t("visit.record")}
        </button>
        <select value={projection} onChange={(e) => setProjection(e.target.value as "next" | "full")}>
          <option value="next">{t("visit.projNext")}</option>
          <option value="full">{t("visit.projFull")}</option>
        </select>
      </div>

      {err && <div className="error">{t("common.error", { msg: err })}</div>}
      {msg && <div className="ok">{msg}</div>}

      {result && (
        <div>
          <h3>{t("visit.needs")}</h3>
          <ul>
            {result.antigenNeeds.map((n) => (
              <li key={n.programId}>
                {n.programId}: {n.status} ({n.dosesNeeded})
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
                  {v.date} — {v.products.join(", ")} [{v.status}]
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
