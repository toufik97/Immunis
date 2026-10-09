import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Appointment } from "../api";

function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

interface Row {
  apptId: string;
  childId: string;
  localId: string;
  name: string;
  address: string;
  dueDate: string;
  products: string[];
}

function toRow(a: Appointment): Row {
  return {
    apptId: a.id,
    childId: a.childId,
    localId: (a.localIds ?? []).map((l) => l.value).join(" ") || "—",
    name: a.childName ?? a.childId,
    address: a.address ?? "—",
    dueDate: a.dueDate,
    products: a.expectedProducts ?? [],
  };
}

type SortKey = "localId" | "name" | "dueDate";

interface TableActions {
  onOpen?: (childId: string) => void;
  onPresent?: (apptId: string) => void;
  onAbsent?: (apptId: string) => void;
  busyId?: string | null;
}

/** Sortable, searchable, filterable person list shared by sessions and no-shows. */
function PersonTable({
  rows,
  showDue,
  productLabel,
  actions,
}: {
  rows: Row[];
  showDue: boolean;
  productLabel: (id: string) => string;
  actions?: TableActions;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [asc, setAsc] = useState(true);
  const [product, setProduct] = useState("all");

  const allProducts = [...new Set(rows.flatMap((r) => r.products))].sort();
  const q = query.trim().toLowerCase();
  const filtered = rows
    .filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q) || r.localId.toLowerCase().includes(q) || r.address.toLowerCase().includes(q)) &&
        (product === "all" || r.products.includes(product))
    )
    .sort((a, b) => {
      const cmp = a[sortKey].localeCompare(b[sortKey]);
      return asc ? cmp : -cmp;
    });

  function header(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <th aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
        <button
          className="thbtn"
          onClick={() => (active ? setAsc(!asc) : (setSortKey(key), setAsc(true)))}
          aria-label={label}
        >
          {label} {active ? (asc ? "▲" : "▼") : ""}
        </button>
      </th>
    );
  }

  const showActions = actions && (actions.onOpen || actions.onPresent || actions.onAbsent);

  return (
    <div>
      <div className="row">
        <input placeholder={t("table.search")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("table.search")} />
        <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label={t("table.doses")}>
          <option value="all">{t("table.all")}</option>
          {allProducts.map((p) => (
            <option key={p} value={p}>
              {productLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {header("localId", t("table.localId"))}
            {header("name", t("table.name"))}
            <th>{t("table.address")}</th>
            {showDue && header("dueDate", t("table.due"))}
            <th>{t("table.doses")}</th>
            {showActions && <th aria-label="actions" />}
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.apptId}>
              <td>{r.localId}</td>
              <td>{r.name}</td>
              <td>{r.address}</td>
              {showDue && <td>{r.dueDate}</td>}
              <td>{r.products.map(productLabel).join(", ") || "—"}</td>
              {showActions && (
                <td>
                  <span className="actions">
                    {actions?.onOpen && (
                      <button className="secondary small" onClick={() => actions.onOpen?.(r.childId)}>
                        {t("session.open")}
                      </button>
                    )}
                    {actions?.onPresent && (
                      <button
                        className="small"
                        disabled={actions.busyId === r.apptId}
                        onClick={() => actions.onPresent?.(r.apptId)}
                      >
                        {t("session.present")}
                      </button>
                    )}
                    {actions?.onAbsent && (
                      <button
                        className="secondary small"
                        disabled={actions.busyId === r.apptId}
                        onClick={() => actions.onAbsent?.(r.apptId)}
                      >
                        {t("session.absent")}
                      </button>
                    )}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

interface PanelProps {
  products: { id: string; label_fr?: string }[];
  onOpen: (childId: string) => void;
}

function labelOf(products: { id: string; label_fr?: string }[], id: string): string {
  return products.find((p) => p.id === id)?.label_fr ?? id;
}

export function SessionPanel({ products, onOpen }: PanelProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const productLabel = (id: string) => labelOf(products, id);

  async function load(forDate = date): Promise<void> {
    setErr("");
    setLoading(true);
    try {
      setData(await api.session(forDate));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(today());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mark(id: string, kept: boolean): Promise<void> {
    setErr("");
    setBusyId(id);
    try {
      await api.markAppointment(id, kept);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h2>{t("nav.session")}</h2>
      <div className="row">
        <label>
          {t("session.date")}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? t("common.loading") : t("session.load")}
        </button>
      </div>
      {err && <div className="error">{t("common.error", { msg: err })}</div>}
      {data &&
        (data.expected.length === 0 ? (
          <p className="hint">{t("session.empty")}</p>
        ) : (
          <div>
            <p>{t("session.expected", { n: data.counters.children })}</p>
            <p className="chips">
              {Object.entries(data.counters.dosesByProduct).map(([p, n]) => (
                <span key={p} className="chip">
                  {productLabel(p)} ×{n}
                </span>
              ))}
            </p>
            <PersonTable
              rows={data.expected.map(toRow)}
              showDue={false}
              productLabel={productLabel}
              actions={{ onOpen, onPresent: (id) => void mark(id, true), onAbsent: (id) => void mark(id, false), busyId }}
            />
          </div>
        ))}
    </section>
  );
}

export function NoShowPanel({ products, onOpen }: PanelProps) {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(today());
  const [list, setList] = useState<Awaited<ReturnType<typeof api.noShows>>>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const productLabel = (id: string) => labelOf(products, id);

  async function load(forDate = asOf): Promise<void> {
    setErr("");
    setLoading(true);
    try {
      setList(await api.noShows(forDate));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(today());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mark(id: string, kept: boolean): Promise<void> {
    setErr("");
    setBusyId(id);
    try {
      await api.markAppointment(id, kept);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h2>{t("nav.noshows")}</h2>
      <div className="row">
        <label>
          {t("noshow.asOf")}
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? t("common.loading") : t("session.load")}
        </button>
      </div>
      {err && <div className="error">{t("common.error", { msg: err })}</div>}
      {list.length === 0 && !loading ? (
        <p className="hint">{t("noshow.empty")}</p>
      ) : (
        <PersonTable
          rows={list.map(toRow)}
          showDue
          productLabel={productLabel}
          actions={{ onOpen, onPresent: (id) => void mark(id, true), onAbsent: (id) => void mark(id, false), busyId }}
        />
      )}
    </section>
  );
}

export function StockPanel({ products }: { products: { id: string; label_fr?: string }[] }) {
  const { t } = useTranslation();
  const [lots, setLots] = useState<Awaited<ReturnType<typeof api.lots>>>([]);
  const [form, setForm] = useState({ productGroupId: "", lotNumber: "", expiryDate: "", qtyOnHand: "10", coldChainOk: true });
  const [usableOnly, setUsableOnly] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  async function load(): Promise<void> {
    setErr("");
    setLoading(true);
    try {
      setLots(await api.lots());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lotValid =
    (form.productGroupId || products[0]?.id) !== undefined &&
    form.productGroupId !== "" &&
    form.lotNumber.trim() !== "" &&
    form.expiryDate !== "";

  function statusOf(l: { expiryDate: string; coldChainOk: boolean; qtyOnHand: number }): {
    key: "usable" | "expired" | "unusable" | "empty";
    label: string;
  } {
    if (l.expiryDate < today()) return { key: "expired", label: t("stock.expired") };
    if (!l.coldChainOk) return { key: "unusable", label: t("stock.unusable") };
    if (l.qtyOnHand <= 0) return { key: "empty", label: t("stock.emptyQty") };
    return { key: "usable", label: t("stock.usable") };
  }

  const shown = usableOnly ? lots.filter((l) => statusOf(l).key === "usable") : lots;

  async function add(): Promise<void> {
    setErr("");
    if (!lotValid) {
      setErr(t("stock.requireLot"));
      return;
    }
    setAdding(true);
    try {
      await api.addLot({
        productGroupId: form.productGroupId || products[0]?.id,
        lotNumber: form.lotNumber.trim(),
        expiryDate: form.expiryDate,
        coldChainOk: form.coldChainOk,
        qtyOnHand: Number(form.qtyOnHand),
      });
      setForm((f) => ({ ...f, lotNumber: "", expiryDate: "" }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="card">
      <h2>{t("nav.stock")}</h2>
      <div className="toolbar">
        <button className="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? t("common.loading") : t("session.load")}
        </button>
        <label className="check">
          <input type="checkbox" checked={usableOnly} onChange={(e) => setUsableOnly(e.target.checked)} />
          {t("stock.usable")}
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="hint">{t("stock.empty")}</p>
      ) : (
        <ul className="lots">
          {shown.map((l) => {
            const s = statusOf(l);
            return (
              <li key={l.id}>
                <span>
                  {l.productGroupId} · {l.lotNumber} · {l.expiryDate} · {l.qtyOnHand}
                </span>{" "}
                <span className={`badge ${s.key}`}>{s.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      <h3>{t("stock.add")}</h3>
      <div className="grid">
        <label>
          {t("stock.product")}
          <select
            value={form.productGroupId}
            onChange={(e) => setForm((f) => ({ ...f, productGroupId: e.target.value }))}
          >
            <option value="">—</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label_fr ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("stock.lotNumber")}
          <input value={form.lotNumber} onChange={(e) => setForm((f) => ({ ...f, lotNumber: e.target.value }))} />
        </label>
        <label>
          {t("stock.expiry")}
          <input
            type="date"
            value={form.expiryDate}
            onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
          />
        </label>
        <label>
          {t("stock.qty")}
          <input
            type="number"
            min="0"
            value={form.qtyOnHand}
            onChange={(e) => setForm((f) => ({ ...f, qtyOnHand: e.target.value }))}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.coldChainOk}
            onChange={(e) => setForm((f) => ({ ...f, coldChainOk: e.target.checked }))}
          />
          {t("stock.coldchain")}
        </label>
      </div>
      <div className="toolbar">
        <button onClick={() => void add()} disabled={adding || !lotValid}>
          {adding ? t("common.loading") : t("stock.add")}
        </button>
      </div>
      {!lotValid && <p className="hint">{t("stock.requireLot")}</p>}
      {err && <div className="error">{t("common.error", { msg: err })}</div>}
    </section>
  );
}
