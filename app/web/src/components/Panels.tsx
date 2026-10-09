import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Appointment } from "../api";

function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

interface Row {
  id: string;
  localId: string;
  name: string;
  address: string;
  dueDate: string;
  products: string[];
}

function toRow(a: Appointment): Row {
  return {
    id: a.id,
    localId: (a.localIds ?? []).map((l) => l.value).join(" ") || "—",
    name: a.childName ?? a.childId,
    address: a.address ?? "—",
    dueDate: a.dueDate,
    products: a.expectedProducts ?? [],
  };
}

type SortKey = "localId" | "name" | "dueDate";

/** Sortable, searchable, filterable person list shared by sessions and no-shows. */
function PersonTable({ rows, showDue }: { rows: Row[]; showDue: boolean }) {
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
    return (
      <th onClick={() => (sortKey === key ? setAsc(!asc) : (setSortKey(key), setAsc(true)))} style={{ cursor: "pointer" }}>
        {label} {sortKey === key ? (asc ? "▲" : "▼") : ""}
      </th>
    );
  }

  return (
    <div>
      <div className="row">
        <input placeholder={t("table.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="all">{t("table.all")}</option>
          {allProducts.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            {header("localId", t("table.localId"))}
            {header("name", t("table.name"))}
            <th>{t("table.address")}</th>
            {showDue && header("dueDate", t("table.due"))}
            <th>{t("table.doses")}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id}>
              <td>{r.localId}</td>
              <td>{r.name}</td>
              <td>{r.address}</td>
              {showDue && <td>{r.dueDate}</td>}
              <td>{r.products.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SessionPanel() {
  const { t } = useTranslation();
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [err, setErr] = useState("");

  async function load(): Promise<void> {
    setErr("");
    try {
      setData(await api.session(date));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
        <button onClick={load}>{t("session.load")}</button>
      </div>
      {err && <div className="error">{t("common.error", { msg: err })}</div>}
      {data &&
        (data.expected.length === 0 ? (
          <p className="hint">{t("session.empty")}</p>
        ) : (
          <div>
            <p>{t("session.expected", { n: data.counters.children })}</p>
            <PersonTable rows={data.expected.map(toRow)} showDue={false} />
            <p>{JSON.stringify(data.counters.dosesByProduct)}</p>
          </div>
        ))}
    </section>
  );
}

export function NoShowPanel() {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(today());
  const [list, setList] = useState<Awaited<ReturnType<typeof api.noShows>>>([]);
  const [err, setErr] = useState("");

  async function load(): Promise<void> {
    setErr("");
    try {
      setList(await api.noShows(asOf));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
        <button onClick={load}>{t("session.load")}</button>
      </div>
      {err && <div className="error">{t("common.error", { msg: err })}</div>}
      {list.length === 0 ? (
        <p className="hint">{t("noshow.empty")}</p>
      ) : (
        <PersonTable rows={list.map(toRow)} showDue />
      )}
    </section>
  );
}

export function StockPanel({ products }: { products: { id: string; label_fr?: string }[] }) {
  const { t } = useTranslation();
  const [lots, setLots] = useState<Awaited<ReturnType<typeof api.lots>>>([]);
  const [form, setForm] = useState({ productGroupId: "", lotNumber: "", expiryDate: "", qtyOnHand: "10", coldChainOk: true });
  const [err, setErr] = useState("");

  async function load(): Promise<void> {
    setErr("");
    try {
      setLots(await api.lots());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function add(): Promise<void> {
    setErr("");
    try {
      await api.addLot({
        productGroupId: form.productGroupId || products[0]?.id,
        lotNumber: form.lotNumber,
        expiryDate: form.expiryDate,
        coldChainOk: form.coldChainOk,
        qtyOnHand: Number(form.qtyOnHand),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="card">
      <h2>{t("nav.stock")}</h2>
      <div className="toolbar">
        <button className="secondary" onClick={load}>
          {t("session.load")}
        </button>
      </div>
      {lots.length === 0 ? (
        <p className="hint">{t("stock.empty")}</p>
      ) : (
        <ul>
          {lots.map((l) => (
            <li key={l.id}>
              {l.productGroupId} · {l.lotNumber} · {l.expiryDate} · {l.qtyOnHand}
              {!l.coldChainOk && ` · ${t("stock.unusable")}`}
            </li>
          ))}
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
            value={form.qtyOnHand}
            onChange={(e) => setForm((f) => ({ ...f, qtyOnHand: e.target.value }))}
          />
        </label>
      </div>
      <div className="toolbar">
        <button onClick={add}>{t("stock.add")}</button>
      </div>
      {err && <div className="error">{t("common.error", { msg: err })}</div>}
    </section>
  );
}
