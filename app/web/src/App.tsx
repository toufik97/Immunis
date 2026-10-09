import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./i18n";
import { applyLocale, type Locale } from "./i18n";
import { api, type Child, type DuplicateChild } from "./api";
import VisitPanel from "./components/VisitPanel";
import { SessionPanel, NoShowPanel, StockPanel } from "./components/Panels";
import "./styles.css";

type Tab = "visit" | "session" | "noshows" | "stock";

interface PackInfo {
  packId: string;
  version: string;
  status: string;
  clinicalApproval: string;
  productGroups: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("visit");
  const [pack, setPack] = useState<PackInfo | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Child[]>([]);
  const [child, setChild] = useState<Child | null>(null);
  const [reg, setReg] = useState({ familyName: "", givenName: "", birthDate: "", fatherName: "", motherName: "", address: "", centreId: "CS01", firstVisitYear: "2026" });
  const [duplicates, setDuplicates] = useState<DuplicateChild[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [net, setNet] = useState<{ state: "checking" | "online" | "offline"; pending: number }>({
    state: "checking",
    pending: 0,
  });

  useEffect(() => {
    applyLocale(i18n.language as Locale);
    api.pack().then(setPack).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [i18n.language]);

  async function refreshNet(): Promise<void> {
    try {
      await api.health();
      const pending = await api.outbox();
      setNet({ state: "online", pending: pending.length });
    } catch {
      setNet({ state: "offline", pending: 0 });
    }
  }

  useEffect(() => {
    void refreshNet();
  }, [tab]);

  async function search(): Promise<void> {
    if (!query.trim() || searching) return;
    setErr("");
    setSearching(true);
    try {
      setResults(await api.searchChildren(query.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  const regValid =
    reg.familyName.trim() !== "" && reg.givenName.trim() !== "" && reg.birthDate !== "";

  async function register(force = false): Promise<void> {
    setErr("");
    if (!regValid) {
      setErr(t("register.required"));
      return;
    }
    setRegistering(true);
    try {
      const r = await api.registerChildDetailed({ ...reg, ...(force ? { force: true } : {}) });
      if (r.status === "duplicate") {
        setDuplicates(r.duplicates);
      } else {
        setDuplicates(null);
        setChild(r.child);
        setResults([]);
        void refreshNet();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  async function openChildById(id: string): Promise<void> {
    setErr("");
    try {
      const c = await api.child(id);
      setChild(c);
      setTab("visit");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const products = pack?.productGroups ?? [];

  return (
    <div>
      <header>
        <h1>{t("app.title")}</h1>
        <div className="sub">
          {pack ? t("app.pack", { packId: pack.packId, version: pack.version, status: pack.status, approval: pack.clinicalApproval }) : "…"}
          {" · "}
          {net.state === "checking" ? (
            <span>{t("common.loading")}</span>
          ) : net.state === "online" ? (
            <span>
              {t("net.online")}
              {net.pending > 0 ? ` · ${t("net.pending", { n: net.pending })}` : ""}
            </span>
          ) : (
            <span>{t("net.offline")}</span>
          )}
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
        <nav className="toolbar" aria-label="tabs">
          {(["visit", "session", "noshows", "stock"] as const).map((k) => (
            <button
              key={k}
              className={tab === k ? "" : "secondary"}
              aria-current={tab === k ? "page" : undefined}
              onClick={() => setTab(k)}
            >
              {t(`nav.${k}`)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {err && <div className="error">{t("common.error", { msg: err })}</div>}

        <div hidden={tab !== "visit"}>
          <section className="card">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <input
                placeholder={t("search.placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t("search.placeholder")}
              />
              <button type="submit" disabled={searching || !query.trim()}>
                {searching ? t("common.loading") : t("search.button")}
              </button>
            </form>
            {results.length === 0 && query && !searching && <p className="hint">{t("search.noresults")}</p>}
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
                <input value={reg.familyName} onChange={(e) => setReg({ ...reg, familyName: e.target.value })} required />
              </label>
              <label>
                {t("register.givenName")}
                <input value={reg.givenName} onChange={(e) => setReg({ ...reg, givenName: e.target.value })} required />
              </label>
              <label>
                {t("register.birthDate")}
                <input type="date" value={reg.birthDate} onChange={(e) => setReg({ ...reg, birthDate: e.target.value })} required />
              </label>
              <label>
                {t("register.fatherName")}
                <input value={reg.fatherName} onChange={(e) => setReg({ ...reg, fatherName: e.target.value })} />
              </label>
              <label>
                {t("register.motherName")}
                <input value={reg.motherName} onChange={(e) => setReg({ ...reg, motherName: e.target.value })} />
              </label>
              <label>
                {t("register.address")}
                <input value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} />
              </label>
              <label>
                {t("register.centre")}
                <input value={reg.centreId} onChange={(e) => setReg({ ...reg, centreId: e.target.value })} />
              </label>
              <label>
                {t("register.firstVisitYear")}
                <input
                  value={reg.firstVisitYear}
                  inputMode="numeric"
                  pattern="\d{4}"
                  onChange={(e) => setReg({ ...reg, firstVisitYear: e.target.value })}
                />
              </label>
            </div>
            <div className="toolbar">
              <button onClick={() => register(false)} disabled={registering || !regValid}>
                {registering ? t("common.loading") : t("register.add")}
              </button>
            </div>
            {!regValid && <p className="hint">{t("register.required")}</p>}
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
                    {t("common.dismiss")}
                  </button>
                </div>
              </div>
            )}
          </section>

          {child && pack && (
            <VisitPanel
              key={child.id}
              child={child}
              products={pack.productGroups}
              programs={pack.programs}
              onDone={() => {
                setChild({ ...child });
                void refreshNet();
              }}
            />
          )}
        </div>
        <div hidden={tab !== "session"}>
          <SessionPanel products={products} onOpen={(id) => void openChildById(id)} />
        </div>
        <div hidden={tab !== "noshows"}>
          <NoShowPanel products={products} onOpen={(id) => void openChildById(id)} />
        </div>
        <div hidden={tab !== "stock"}>
          <StockPanel products={products} />
        </div>
      </main>
    </div>
  );
}
