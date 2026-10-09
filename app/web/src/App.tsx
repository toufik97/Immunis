import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./i18n";
import { applyLocale, type Locale } from "./i18n";
import { api, type Child, type DuplicateChild } from "./api";
import VisitPanel from "./components/VisitPanel";
import { SessionPanel, NoShowPanel, StockPanel } from "./components/Panels";
import "./styles.css";

type Tab = "visit" | "session" | "noshows" | "stock";

export default function App() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("visit");
  const [pack, setPack] = useState<{ packId: string; version: string; status: string; clinicalApproval: string; productGroups: { id: string; label_fr?: string }[] } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Child[]>([]);
  const [child, setChild] = useState<Child | null>(null);
  const [reg, setReg] = useState({ familyName: "", givenName: "", birthDate: "", parentNames: "", centreId: "CS01", firstVisitYear: "2026" });
  const [duplicates, setDuplicates] = useState<DuplicateChild[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    applyLocale(i18n.language as Locale);
    api.pack().then(setPack).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [i18n.language]);

  async function search(): Promise<void> {
    setErr("");
    try {
      const r = await api.searchChildren(query);
      setResults(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function register(force = false): Promise<void> {
    setErr("");
    setRegistering(true);
    try {
      const r = await api.registerChildDetailed({ ...reg, ...(force ? { force: true } : {}) });
      if (r.status === "duplicate") {
        setDuplicates(r.duplicates);
      } else {
        setDuplicates(null);
        setChild(r.child);
        setResults([]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div>
      <header>
        <h1>{t("app.title")}</h1>
        <div className="sub">
          {pack ? t("app.pack", { packId: pack.packId, version: pack.version, status: pack.status, approval: pack.clinicalApproval }) : "…"}
        </div>
        <div className="toolbar">
          {(["en", "fr", "ar"] as const).map((l) => (
            <button
              key={l}
              className={i18n.language === l ? "" : "secondary"}
              onClick={() => {
                void i18n.changeLanguage(l);
                applyLocale(l);
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <nav className="toolbar">
          {(["visit", "session", "noshows", "stock"] as const).map((k) => (
            <button key={k} className={tab === k ? "" : "secondary"} onClick={() => setTab(k)}>
              {t(`nav.${k}`)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {err && <div className="error">{t("common.error", { msg: err })}</div>}

        {tab === "visit" && (
          <>
            <section className="card">
              <div className="row">
                <input
                  placeholder={t("search.placeholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button onClick={search}>{t("search.button")}</button>
              </div>
              {results.length === 0 && query && <p className="hint">{t("search.noresults")}</p>}
              <ul>
                {results.map((c) => (
                  <li key={c.id}>
                    {c.givenName} {c.familyName} · {t("child.birthDate", { date: c.birthDate })}{" "}
                    {(c.localIds ?? []).map((l) => t("child.localId", { value: l.value })).join(" ")}{" "}
                    <button className="secondary" onClick={() => setChild(c)}>
                      {t("child.select")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h2>{t("register.title")}</h2>
              <div className="grid">
                <label>
                  {t("register.familyName")}
                  <input value={reg.familyName} onChange={(e) => setReg({ ...reg, familyName: e.target.value })} />
                </label>
                <label>
                  {t("register.givenName")}
                  <input value={reg.givenName} onChange={(e) => setReg({ ...reg, givenName: e.target.value })} />
                </label>
                <label>
                  {t("register.birthDate")}
                  <input type="date" value={reg.birthDate} onChange={(e) => setReg({ ...reg, birthDate: e.target.value })} />
                </label>
                <label>
                  {t("register.parentNames")}
                  <input value={reg.parentNames} onChange={(e) => setReg({ ...reg, parentNames: e.target.value })} />
                </label>
              </div>
              <div className="toolbar">
                <button onClick={() => register(false)} disabled={registering}>
                  {t("register.add")}
                </button>
              </div>
              {duplicates && duplicates.length > 0 && (
                <div className="error">
                  <p>{t("register.duplicate")}</p>
                  <ul>
                    {duplicates.map((c) => (
                      <li key={c.id}>
                        {c.givenName} {c.familyName} · {t("child.birthDate", { date: c.birthDate })}{" "}
                        {(c.localIds ?? []).map((l) => t("child.localId", { value: l.value })).join(" ")}{" "}
                        <button className="secondary" onClick={() => { setChild(c); setDuplicates(null); }}>
                          {t("child.select")}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="toolbar">
                    <button onClick={() => register(true)} disabled={registering}>
                      {t("register.force")}
                    </button>
                    <button className="secondary" onClick={() => setDuplicates(null)}>
                      {t("common.remove")}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {child && pack && (
              <VisitPanel child={child} products={pack.productGroups} onDone={() => setChild({ ...child })} />
            )}
          </>
        )}
        {tab === "session" && <SessionPanel />}
        {tab === "noshows" && <NoShowPanel />}
        {tab === "stock" && <StockPanel products={pack?.productGroups ?? []} />}
      </main>
    </div>
  );
}
