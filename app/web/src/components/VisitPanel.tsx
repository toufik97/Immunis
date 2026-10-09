import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Child, type Dose } from "../api";

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
  const [birthDate, setBirthDate] = useState(child.birthDate);
  const [screening, setScreening] = useState("VACCINATE");
  const [weightKg, setWeightKg] = useState("");
  const [doses, setDoses] = useState<Dose[]>([]);
  const [nextRdv, setNextRdv] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.evaluate>> | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

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
        projection: "next",
      });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function record(): Promise<void> {
    setErr("");
    setMsg("");
    try {
      await api.recordEncounter({
        childId: child.id,
        birthDate,
        date: today(),
        screening,
        weightKg: weightKg ? Number(weightKg) : undefined,
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
      <p className="hint">{t("visit.confirm")}</p>
      <div className="grid">
        <label>
          {t("register.birthDate")}
          <input value={birthDate} onChange={(e) => setBirthDate(e.target.value)} type="date" />
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
          <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} type="number" step="0.1" />
        </label>
        <label>
          {t("visit.nextRdv")}
          <input value={nextRdv} onChange={(e) => setNextRdv(e.target.value)} type="date" />
        </label>
      </div>

      <h3>{t("visit.history")}</h3>
      {doses.map((d, i) => (
        <div className="row" key={i}>
          <select
            value={d.productGroupId}
            onChange={(e) =>
              setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, productGroupId: e.target.value } : x)))
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
            onChange={(e) =>
              setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, administeredOn: e.target.value } : x)))
            }
          />
          <select
            value={d.origin}
            onChange={(e) =>
              setDoses((ds) =>
                ds.map((x, j) => (j === i ? { ...x, origin: e.target.value as Dose["origin"] } : x))
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
      ))}
      <div className="toolbar">
        <button className="secondary" onClick={addDose}>
          {t("visit.addDose")}
        </button>
        <button onClick={evaluate}>{t("visit.evaluate")}</button>
        <button onClick={record} disabled={screening !== "VACCINATE" && doses.length > 0}>
          {t("visit.record")}
        </button>
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
