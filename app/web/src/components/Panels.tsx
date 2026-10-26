import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCalendarCheck, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { api, type Appointment } from "../api";
import { formatCivilDate, formatCount, todayCivilDate } from "../format";
import DateField from "./DateField";
import Pager, { PAGE_SIZE } from "./Pager";

interface Row {
  apptId: string;
  childId: string;
  localId: string;
  name: string;
  address: string;
  dueDate: string;
  products: string[];
  lastVisitDate: string | null;
  daysOverdue: number | null;
  status?: "booked" | "walkin" | "pending" | "moved";
  expected?: string[];
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
    lastVisitDate: a.lastVisitDate ?? null,
    daysOverdue: typeof a.daysOverdue === "number" ? a.daysOverdue : null,
  };
}

type SortKey = "localId" | "name" | "dueDate" | "daysOverdue" | "lastVisit";

interface TableActions {
  onOpen?: (childId: string, products: string[]) => void;
}

/** Sortable, searchable, filterable person list shared by sessions and no-shows. */
function PersonTable({
  rows,
  showDue,
  showNoShow,
  productLabel,
  actions,
  dosesHeader,
}: {
  rows: Row[];
  showDue: boolean;
  showNoShow?: boolean;
  productLabel: (id: string) => string;
  actions?: TableActions;
  dosesHeader?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [asc, setAsc] = useState(true);
  const [product, setProduct] = useState("all");
  const [page, setPage] = useState(0);

  const allProducts = [...new Set(rows.flatMap((r) => r.products))].sort();
  const q = debouncedQuery.trim().toLowerCase();
  const filtered = rows
    .filter(
      (r) =>
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.localId.toLowerCase().includes(q) ||
          r.address.toLowerCase().includes(q) ||
          r.products.map(productLabel).join(" ").toLowerCase().includes(q)) &&
        (product === "all" || r.products.includes(product))
    )
    .sort((a, b) => {
      if (sortKey === "daysOverdue") {
        const cmp = (a.daysOverdue ?? -1) - (b.daysOverdue ?? -1);
        return asc ? cmp : -cmp;
      }
      const av = sortKey === "lastVisit" ? (a.lastVisitDate ?? "") : String(a[sortKey] ?? "");
      const bv = sortKey === "lastVisit" ? (b.lastVisitDate ?? "") : String(b[sortKey] ?? "");
      const cmp = av.localeCompare(bv);
      return asc ? cmp : -cmp;
    });

  // New filter, sort, or data: back to the first page.
  useEffect(() => {
    setPage(0);
  }, [q, product, sortKey, asc, rows.length]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function header(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <Table.Th aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
        <Button
          variant="transparent"
          size="compact-xs"
          px={0}
          aria-label={label}
          onClick={() => (active ? setAsc(!asc) : (setSortKey(key), setAsc(true)))}
        >
          {label} {active ? (asc ? "▲" : "▼") : ""}
        </Button>
      </Table.Th>
    );
  }

  const showActions = actions?.onOpen !== undefined;
  const showStatus = rows.some((r) => r.status !== undefined);
  function statusBadge(s: NonNullable<Row["status"]>) {
    if (s === "booked") return <Badge color="teal" variant="light">{t("session.booked")}</Badge>;
    if (s === "walkin") return <Badge color="yellow" variant="light">{t("session.walkin")}</Badge>;
    if (s === "moved") return <Badge color="blue" variant="light">{t("session.movedVisit")}</Badge>;
    return <Badge color="gray" variant="light">{t("session.pendingVisit")}</Badge>;
  }

  return (
    <Stack gap="sm">
      <Group align="end" wrap="wrap">
        <TextInput
          label={t("table.search")}
          placeholder={t("table.search")}
          aria-label={t("table.search")}
          name="tableSearch"
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <Select
          label={dosesHeader ?? t("table.doses")}
          aria-label={dosesHeader ?? t("table.doses")}
          name="tableProduct"
          searchable
          limit={20}
          value={product}
          onChange={(v) => v && setProduct(v)}
          data={[{ value: "all", label: t("table.all") }, ...allProducts.map((p) => ({ value: p, label: productLabel(p) }))]}
          style={{ minWidth: 180 }}
        />
      </Group>
      <Table.ScrollContainer minWidth={640}>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              {header("localId", t("table.localId"))}
              {header("name", t("table.name"))}
              <Table.Th>{t("table.address")}</Table.Th>
              {showDue && header("dueDate", t("table.due"))}
              {showNoShow && header("daysOverdue", t("noshow.overdue"))}
              {showNoShow && header("lastVisit", t("noshow.lastVisit"))}
              {showStatus && <Table.Th>{t("session.status")}</Table.Th>
              }
              <Table.Th>{dosesHeader ?? t("table.doses")}</Table.Th>
              {showActions && <Table.Th aria-label="actions" />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="tabular">
            {paged.map((r) => (
              <Table.Tr key={r.apptId}>
                <Table.Td className="break-words">{r.localId}</Table.Td>
                <Table.Td className="break-words">{r.name}</Table.Td>
                <Table.Td className="break-words">{r.address}</Table.Td>
                {showDue && <Table.Td>{formatCivilDate(r.dueDate, lang)}</Table.Td>}
                {showNoShow && <Table.Td>{r.daysOverdue ?? "—"}</Table.Td>}
                {showNoShow && <Table.Td>{r.lastVisitDate ? formatCivilDate(r.lastVisitDate, lang) : "—"}</Table.Td>}
                {showStatus && <Table.Td>{r.status ? statusBadge(r.status) : "—"}</Table.Td>}
                <Table.Td>
                  {r.products.map(productLabel).join(", ") || "—"}
                  {r.expected !== undefined && (
                    <Text size="xs" c="dimmed">
                      {r.expected.length > 0
                        ? t("session.bookedLine", { list: r.expected.map(productLabel).join(", ") })
                        : t("session.walkin")}
                    </Text>
                  )}
                </Table.Td>
                {showActions && (
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      {actions?.onOpen && (
                        <Button size="compact-xs" variant="light" onClick={() => actions.onOpen?.(r.childId, r.products)}>
                          {t("session.open")}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Pager page={safePage} total={filtered.length} onPage={setPage} />
    </Stack>
  );
}

interface PanelProps {
  products: { id: string; label_fr?: string }[];
  onOpen: (childId: string, expectedProducts: string[]) => void;
  /** True while the tab is visible; panels reload stale data on return. */
  active?: boolean;
}

function labelOf(products: { id: string; label_fr?: string }[], id: string): string {
  return products.find((p) => p.id === id)?.label_fr ?? id;
}

/** Civil-date helpers (YYYY-MM-DD calendar arithmetic, UTC). */
function shiftDays(iso: string, n: number): string {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function monthFirstDay(month: string): string {
  return `${month}-01`;
}

function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function weekdayNames(lang: string): string[] {
  try {
    const fmt = new Intl.DateTimeFormat(lang === "ar" ? "ar-MA" : lang === "fr" ? "fr-FR" : "en-GB", {
      weekday: "short",
      timeZone: "UTC",
    });
    // 2026-01-05 is a Monday: Monday-first headers (MA practice).
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 0, 5 + i))));
  } catch {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
}

export function SessionPanel({ products, onOpen, active }: PanelProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [date, setDate] = useState(todayCivilDate());
  const [month, setMonth] = useState(date.slice(0, 7));
  const [data, setData] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [monthAgenda, setMonthAgenda] = useState<Awaited<ReturnType<typeof api.agenda>>>([]);
  const [lots, setLots] = useState<Awaited<ReturnType<typeof api.lots>>>([]);
  const [next, setNext] = useState<{ date: string; children: number } | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const productLabel = (id: string) => labelOf(products, id);

  async function load(forDate = date, silent = false): Promise<void> {
    if (!silent) setErr("");
    if (!silent) setLoading(true);
    try {
      const [session, usable] = await Promise.all([api.session(forDate), api.lots(undefined, forDate)]);
      setData(session);
      setLots(usable);
      const total =
        session.expected.length + (session.probable ?? []).length + (session.possible ?? []).length;
      if (total === 0) {
        // Empty day: look ahead so the empty state can jump to the next session.
        try {
          const ahead = await api.agenda(shiftDays(forDate, 1), shiftDays(forDate, 60));
          setNext(ahead.length > 0 ? { date: ahead[0].date, children: ahead[0].children } : null);
        } catch {
          setNext(null);
        }
      } else {
        setNext(null);
      }
      // Calendar counts go stale otherwise: bookings, recordings and external
      // changes all land after the month agenda was fetched. Silent refresh —
      // the day view must never wait on it (offline-friendly).
      void loadMonth(forDate.slice(0, 7));
    } catch (e) {
      if (!silent) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadMonth(forMonth: string): Promise<void> {
    try {
      setMonthAgenda(await api.agenda(monthFirstDay(forMonth), monthLastDay(forMonth)));
    } catch {
      /* calendar stays usable without counts; session load reports errors */
    }
  }

  useEffect(() => {
    const today = todayCivilDate();
    setMonth(today.slice(0, 7));
    void load(today);
    void loadMonth(today.slice(0, 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visits are recorded from the Today tab while this panel sits hidden:
  // reload on return so Seen counts never go stale.
  const wasActive = useRef(active ?? true);
  useEffect(() => {
    if (active && !wasActive.current) void load();
    wasActive.current = active ?? true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Same-browser second tab (or Alt-Tab away and back): the data may have
  // changed with no tab switch here. Silent: an offline focus must never
  // raise an error banner.
  useEffect(() => {
    if (active === false) return;
    const onFocus = () => void load(undefined, true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function pick(d: string): void {
    setDate(d);
    if (d.slice(0, 7) !== month) {
      const m = d.slice(0, 7);
      setMonth(m);
      void loadMonth(m);
    }
    void load(d);
  }

  function moveMonth(delta: number): void {
    const m = addMonths(month, delta);
    setMonth(m);
    void loadMonth(m);
  }

  const due = data?.expected ?? [];
  const probable = data?.probable ?? [];
  const possible = data?.possible ?? [];
  const tiers = data?.tiers;
  const backlog = data?.backlog;
  const isPast = date < todayCivilDate();
  const isToday = date === todayCivilDate();

  // Doses to prepare: firm + both catch-up tiers vs usable stock on that day.
  const needByProduct: Record<string, number> = {};
  for (const src of [tiers?.due.dosesByProduct, tiers?.probable.dosesByProduct, tiers?.possible.dosesByProduct]) {
    for (const [p, n] of Object.entries(src ?? {})) needByProduct[p] = (needByProduct[p] ?? 0) + n;
  }
  if (!tiers) {
    for (const r of due) for (const p of r.expectedProducts ?? []) needByProduct[p] = (needByProduct[p] ?? 0) + 1;
  }
  const usableByProduct: Record<string, number> = {};
  for (const l of lots) usableByProduct[l.productGroupId] = (usableByProduct[l.productGroupId] ?? 0) + l.qtyOnHand;

  const agendaByDate = new Map(monthAgenda.map((d) => [d.date, d]));
  const [my, mm] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(my, mm, 0)).getUTCDate();
  const leadBlanks = (new Date(Date.UTC(my, mm - 1, 1)).getUTCDay() + 6) % 7;
  const today = todayCivilDate();

  // Seen/vaccinated section shared by past days and today (past: alone;
  // today: below the plan). Plain function, not a component, so the inner
  // PersonTable state survives parent re-renders.
  function resultsSection(hideEmpty: boolean) {
    const results = data?.results;
    if (!results) return null;
    return (
      <Stack gap="sm" aria-live="polite">
        <Text size="sm" fw={600}>
          {t("session.results")}
        </Text>
        <Group gap="xs" wrap="wrap">
          <Badge color="teal" variant="filled" className="tabular" title={t("session.seenHint")}>
            {t("session.seen", { n: formatCount(results.childrenSeen, lang) })}
          </Badge>
          <Badge color="gray" variant="light" className="tabular" title={t("session.plannedTip")}>
            {t("session.planned", { n: formatCount(results.plannedChildren, lang) })}
          </Badge>
          <Badge color="teal" variant="light" className="tabular" title={t("session.keptTip")}>
            {t("session.kept", { n: formatCount(results.kept, lang) })}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {t("session.plannedHint")}
        </Text>
        {(() => {
          const plannedDoses = results.plannedDoses ?? {};
          const givenDoses = results.dosesByProduct ?? {};
          const products = [...new Set([...Object.keys(plannedDoses), ...Object.keys(givenDoses)])].sort();
          if (products.length === 0) return null;
          return (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {t("session.given")}
              </Text>
              <Group gap="xs" wrap="wrap">
                {products.map((p) => {
                  const planned = plannedDoses[p] ?? 0;
                  const given = givenDoses[p] ?? 0;
                  return (
                    <Badge
                      key={p}
                      variant="light"
                      color={given >= planned ? "teal" : "yellow"}
                      className="tabular"
                      title={t("session.plannedHint")}
                    >
                      {productLabel(p)}{" "}
                      {t("session.doseCount", {
                        given: formatCount(given, lang),
                        planned: formatCount(planned, lang),
                      })}
                    </Badge>
                  );
                })}
              </Group>
            </Stack>
          );
        })()}
        {results.planned === 0 && results.childrenSeen === 0 && !hideEmpty && (
          <Text size="sm" c="dimmed">
            {t("session.empty")}
          </Text>
        )}
        {(results.seen ?? []).length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={600} className="tabular">
              {t("session.seenList", { n: formatCount(results.seen?.length ?? 0, lang) })}
            </Text>
            <PersonTable
              rows={(results.seen ?? []).map((s) => ({
                apptId: `seen-${s.childId}`,
                childId: s.childId,
                localId: (s.localIds ?? []).map((l) => l.value).join(" ") || "—",
                name: s.childName,
                address: s.address ?? "—",
                dueDate: date,
                products: s.dosesGiven,
                lastVisitDate: null,
                daysOverdue: null,
                status: (s.bookedToday ? "booked" : "walkin") as "booked" | "walkin",
                expected: s.expectedToday ?? [],
              }))}
              showDue={false}
              productLabel={productLabel}
              dosesHeader={t("session.dosesGivenCol")}
              actions={{ onOpen: (id) => onOpen(id, []) }}
            />
          </Stack>
        )}
        {(results.missed ?? []).length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={600} className="tabular">
              {t("session.missedList", { n: formatCount(results.missed?.length ?? 0, lang) })}
            </Text>
            <PersonTable
              rows={(results.missed ?? []).map((a) => ({
                ...toRow(a),
                status: (a.kept === false ? "moved" : "pending") as "moved" | "pending",
              }))}
              showDue={false}
              productLabel={productLabel}
              actions={{ onOpen }}
            />
          </Stack>
        )}
      </Stack>
    );
  }

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={2} size="h4">
            {t("nav.session")}
          </Title>
          <Group align="end" wrap="wrap">
            <DateField label={t("session.date")} name="sessionDate" value={date} onChange={pick} />
            <Button onClick={() => void load()} loading={loading} leftSection={<IconCalendarCheck size={15} aria-hidden="true" />}>
              {t("session.load")}
            </Button>
          </Group>
        </Group>
        <div aria-live="polite">
          {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        </div>

        {/* Month calendar: representative planning view, replaces the chip list. */}
        <Stack gap="xs">
          <Group justify="space-between" wrap="wrap">
            <Group gap="xs">
              <Button size="compact-sm" variant="light" aria-label={t("session.monthPrev")} onClick={() => moveMonth(-1)}>
                <IconChevronLeft size={15} aria-hidden="true" />
              </Button>
              <Text size="sm" fw={600} className="tabular">
                {formatCivilDate(monthFirstDay(month), lang).replace(/^\d+\s*/, "").trim() || month}
              </Text>
              <Button size="compact-sm" variant="light" aria-label={t("session.monthNext")} onClick={() => moveMonth(1)}>
                <IconChevronRight size={15} aria-hidden="true" />
              </Button>
            </Group>
            <Button
              size="compact-sm"
              variant="subtle"
              onClick={() => {
                const m = today.slice(0, 7);
                setMonth(m);
                void loadMonth(m);
                pick(today);
              }}
            >
              {t("session.monthToday")}
            </Button>
          </Group>
          <div
            role="grid"
            aria-label={t("session.upcoming")}
            style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}
          >
            {weekdayNames(lang).map((w) => (
              <Text key={w} size="xs" c="dimmed" ta="center">
                {w}
              </Text>
            ))}
            {Array.from({ length: leadBlanks }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = `${month}-${String(i + 1).padStart(2, "0")}`;
              const info = agendaByDate.get(day);
              const selected = day === date;
              const isToday = day === today;
              return (
                <Button
                  key={day}
                  role="gridcell"
                  size="compact-sm"
                  variant={selected ? "filled" : info ? "light" : "subtle"}
                  color={selected ? undefined : info ? "teal" : undefined}
                  aria-label={
                    info
                      ? `${formatCivilDate(day, lang)} — ${t("session.pending", { n: formatCount(info.children, lang) })}`
                      : formatCivilDate(day, lang)
                  }
                  title={
                    info
                      ? `${formatCivilDate(day, lang)} — ${t("session.pending", { n: formatCount(info.children, lang) })}`
                      : formatCivilDate(day, lang)
                  }
                  aria-pressed={selected}
                  onClick={() => pick(day)}
                  style={isToday && !selected ? { outline: "2px solid var(--mantine-color-teal-5)", outlineOffset: -2 } : undefined}
                >
                  <span className="tabular" style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{i + 1}</span>
                    {info ? (
                      <span style={{ fontSize: "0.72em", fontWeight: 400, opacity: selected ? 0.85 : 0.65 }}>
                        ×{formatCount(info.children, lang)}
                      </span>
                    ) : null}
                  </span>
                </Button>
              );
            })}
          </div>
        </Stack>

        {data && (
          <Stack gap="md">
            {!isPast && (
              <Stack gap="sm">
            <Group gap="xs" wrap="wrap" aria-live="polite">
              <Badge color="teal" variant="filled" className="tabular">
                {t("session.due", { n: formatCount(due.length, lang) })}
              </Badge>
              <Badge color="yellow" variant="light" className="tabular">
                {t("session.probable", { n: formatCount(probable.length, lang) })}
              </Badge>
              <Badge color="gray" variant="light" className="tabular">
                {t("session.possible", { n: formatCount(possible.length, lang) })}
              </Badge>
            </Group>
            {Object.keys(needByProduct).length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  {t("session.prep")}
                </Text>
                <Group gap="xs" wrap="wrap">
                  {Object.entries(needByProduct).map(([p, need]) => {
                    const usable = usableByProduct[p] ?? 0;
                    const short = usable - need;
                    return (
                      <Badge key={p} variant="light" color={short < 0 ? "red" : "teal"} className="tabular">
                        {productLabel(p)} ×{formatCount(need, lang)}
                        {short < 0 ? ` · ${t("session.short", { n: formatCount(-short, lang) })}` : ""}
                      </Badge>
                    );
                  })}
                </Group>
              </Stack>
            )}
            {backlog && backlog.children > 0 && (
              <Text size="sm" c="dimmed" className="tabular">
                {t("session.backlog", { n: formatCount(backlog.children, lang) })}
              </Text>
            )}
            {due.length + probable.length + possible.length === 0 ? (
              <Stack gap="xs">
                {(data?.results?.childrenSeen ?? 0) === 0 && (
                  <Text size="sm" c="dimmed">
                    {t("session.empty")}
                  </Text>
                )}
                {next && (
                  <div>
                    <Button size="compact-sm" variant="subtle" onClick={() => pick(next.date)}>
                      {t("session.next", { date: formatCivilDate(next.date, lang), n: formatCount(next.children, lang) })}
                    </Button>
                  </div>
                )}
              </Stack>
            ) : (
              <Stack gap="md">
                {due.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={600} className="tabular">
                      {t("session.due", { n: formatCount(due.length, lang) })}
                    </Text>
                    <PersonTable rows={due.map(toRow)} showDue={false} productLabel={productLabel} actions={{ onOpen }} />
                  </Stack>
                )}
                {probable.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={600} className="tabular">
                      {t("session.probable", { n: formatCount(probable.length, lang) })}
                    </Text>
                    <PersonTable rows={probable.map(toRow)} showDue showNoShow productLabel={productLabel} actions={{ onOpen }} />
                  </Stack>
                )}
                {possible.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={600} className="tabular">
                      {t("session.possible", { n: formatCount(possible.length, lang) })}
                    </Text>
                    <PersonTable rows={possible.map(toRow)} showDue showNoShow productLabel={productLabel} actions={{ onOpen }} />
                  </Stack>
                )}
              </Stack>
            )}
            </Stack>
            )}
            {(isPast || isToday) && resultsSection(isToday)}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

export function NoShowPanel({ products, onOpen, active }: PanelProps) {
  const { t } = useTranslation();
  const [asOf, setAsOf] = useState(todayCivilDate());
  const [list, setList] = useState<Awaited<ReturnType<typeof api.noShows>>>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
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
    void load(todayCivilDate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same staleness as sessions: reload when the tab becomes visible again.
  const wasActive = useRef(active ?? true);
  useEffect(() => {
    if (active && !wasActive.current) void load();
    wasActive.current = active ?? true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={2} size="h4">
            {t("nav.noshows")}
          </Title>
          <Group align="end" wrap="wrap">
            <DateField
              label={t("noshow.asOf")}
              name="noShowAsOf"
              value={asOf}
              onChange={setAsOf}
            />
            <Button onClick={() => void load()} loading={loading}>
              {t("session.load")}
            </Button>
          </Group>
        </Group>
        <div aria-live="polite">
          {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        </div>
        {list.length === 0 && !loading ? (
          <Text size="sm" c="dimmed">
            {t("noshow.empty")}
          </Text>
        ) : (
          <PersonTable
            rows={list.map(toRow)}
            showDue
            showNoShow
            productLabel={productLabel}
            actions={{ onOpen }}
          />
        )}
      </Stack>
    </Card>
  );
}

export function StockPanel({ products }: { products: { id: string; label_fr?: string }[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [lots, setLots] = useState<Awaited<ReturnType<typeof api.lots>>>([]);
  const [form, setForm] = useState({ productGroupId: "", lotNumber: "", expiryDate: "", qtyOnHand: "10", coldChainOk: true });
  const [submitAttempted, setSubmitAttempted] = useState(false);
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

  const productMissing = submitAttempted && form.productGroupId === "";
  const lotMissing = submitAttempted && form.lotNumber.trim() === "";
  const expiryMissing = submitAttempted && form.expiryDate === "";
  const lotValid =
    form.productGroupId !== "" && form.lotNumber.trim() !== "" && form.expiryDate !== "";

  function statusOf(l: { expiryDate: string; coldChainOk: boolean; qtyOnHand: number }): {
    key: "usable" | "expired" | "unusable" | "empty";
    label: string;
    color: string;
  } {
    if (l.expiryDate < todayCivilDate()) return { key: "expired", label: t("stock.expired"), color: "red" };
    if (!l.coldChainOk) return { key: "unusable", label: t("stock.unusable"), color: "orange" };
    if (l.qtyOnHand <= 0) return { key: "empty", label: t("stock.emptyQty"), color: "gray" };
    return { key: "usable", label: t("stock.usable"), color: "teal" };
  }

  const shown = usableOnly ? lots.filter((l) => statusOf(l).key === "usable") : lots;

  async function add(): Promise<void> {
    setErr("");
    setSubmitAttempted(true);
    if (!lotValid) {
      setErr(t("stock.requireLot"));
      return;
    }
    setAdding(true);
    try {
      await api.addLot({
        productGroupId: form.productGroupId,
        lotNumber: form.lotNumber.trim(),
        expiryDate: form.expiryDate,
        coldChainOk: form.coldChainOk,
        qtyOnHand: Number(form.qtyOnHand),
      });
      setForm((f) => ({ ...f, lotNumber: "", expiryDate: "" }));
      setSubmitAttempted(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={2} size="h4">
            {t("nav.stock")}
          </Title>
          <Group wrap="wrap" align="center">
            <Button variant="light" onClick={() => void load()} loading={loading}>
              {t("session.load")}
            </Button>
            <Checkbox
              label={t("stock.usable")}
              name="usableOnly"
              checked={usableOnly}
              onChange={(e) => setUsableOnly(e.target.checked)}
            />
          </Group>
        </Group>
        {shown.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("stock.empty")}
          </Text>
        ) : (
          <Stack gap="xs">
            {shown.map((l) => {
              const s = statusOf(l);
              return (
                <Card key={l.id} withBorder shadow="none" padding="sm" radius="md">
                  <Group justify="space-between" wrap="wrap">
                    <Text size="sm" className="tabular break-words" style={{ flex: 1, minWidth: 0 }}>
                      <span translate="no">{l.productGroupId}</span> ·{" "}
                      <span translate="no">{l.lotNumber}</span> · {formatCivilDate(l.expiryDate, lang)} · ×
                      {formatCount(l.qtyOnHand, lang)}
                    </Text>
                    <Badge color={s.color} variant="light">
                      {s.label}
                    </Badge>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        )}
        <Title order={3} size="h5">
          {t("stock.add")}
        </Title>
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <Select
              label={t("stock.product")}
              name="lotProduct"
              required
              searchable
              limit={20}
              value={form.productGroupId}
              onChange={(v) => v && setForm((f) => ({ ...f, productGroupId: v }))}
              data={[
                { value: "", label: "—" },
                ...products.map((p) => ({ value: p.id, label: p.label_fr ?? p.id })),
              ]}
              error={productMissing ? t("stock.requireLot") : undefined}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <TextInput
              label={t("stock.lotNumber")}
              name="lotNumber"
              autoComplete="off"
              required
              value={form.lotNumber}
              onChange={(e) => setForm((f) => ({ ...f, lotNumber: e.target.value }))}
              error={lotMissing ? t("stock.requireLot") : undefined}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 4 }}>
            <DateField
              label={t("stock.expiry")}
              name="lotExpiry"
              required
              value={form.expiryDate}
              onChange={(v) => setForm((f) => ({ ...f, expiryDate: v }))}
              error={expiryMissing ? t("stock.requireLot") : undefined}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 4 }}>
            <TextInput
              label={t("stock.qty")}
              name="lotQty"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={0}
              value={form.qtyOnHand}
              onChange={(e) => setForm((f) => ({ ...f, qtyOnHand: e.target.value }))}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Checkbox
              label={t("stock.coldchain")}
              name="coldChainOk"
              checked={form.coldChainOk}
              onChange={(e) => setForm((f) => ({ ...f, coldChainOk: e.target.checked }))}
              mt="xl"
            />
          </Grid.Col>
        </Grid>
        <Group>
          <Button onClick={() => void add()} loading={adding}>
            {t("stock.add")}
          </Button>
        </Group>
        {submitAttempted && !lotValid && (
          <Text size="sm" c="red" role="alert">
            {t("stock.requireLot")}
          </Text>
        )}
        <div aria-live="polite">
          {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        </div>
      </Stack>
    </Card>
  );
}
