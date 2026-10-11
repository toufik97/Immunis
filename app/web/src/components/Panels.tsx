import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { IconAlertCircle, IconCalendarCheck } from "@tabler/icons-react";
import { api, type Appointment } from "../api";
import { formatCivilDate, formatCount, todayCivilDate } from "../format";
import DateField from "./DateField";

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
}: {
  rows: Row[];
  showDue: boolean;
  showNoShow?: boolean;
  productLabel: (id: string) => string;
  actions?: TableActions;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [asc, setAsc] = useState(true);
  const [product, setProduct] = useState("all");

  const allProducts = [...new Set(rows.flatMap((r) => r.products))].sort();
  const q = query.trim().toLowerCase();
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
          label={t("table.doses")}
          aria-label={t("table.doses")}
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
              <Table.Th>{t("table.doses")}</Table.Th>
              {showActions && <Table.Th aria-label="actions" />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="tabular">
            {filtered.map((r) => (
              <Table.Tr key={r.apptId}>
                <Table.Td className="break-words">{r.localId}</Table.Td>
                <Table.Td className="break-words">{r.name}</Table.Td>
                <Table.Td className="break-words">{r.address}</Table.Td>
                {showDue && <Table.Td>{formatCivilDate(r.dueDate, lang)}</Table.Td>}
                {showNoShow && <Table.Td>{r.daysOverdue ?? "—"}</Table.Td>}
                {showNoShow && <Table.Td>{r.lastVisitDate ? formatCivilDate(r.lastVisitDate, lang) : "—"}</Table.Td>}
                <Table.Td>{r.products.map(productLabel).join(", ") || "—"}</Table.Td>
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
    </Stack>
  );
}

interface PanelProps {
  products: { id: string; label_fr?: string }[];
  onOpen: (childId: string, expectedProducts: string[]) => void;
}

function labelOf(products: { id: string; label_fr?: string }[], id: string): string {
  return products.find((p) => p.id === id)?.label_fr ?? id;
}

export function SessionPanel({ products, onOpen }: PanelProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [date, setDate] = useState(todayCivilDate());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [agenda, setAgenda] = useState<Awaited<ReturnType<typeof api.agenda>>>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const productLabel = (id: string) => labelOf(products, id);

  async function load(forDate = date): Promise<void> {
    setErr("");
    setLoading(true);
    try {
      setData(await api.session(forDate));
      // Agenda is a hint: refresh silently so new RDVs appear without extra clicks.
      try {
        setAgenda(await api.agenda());
      } catch {
        /* session load already succeeded; stale agenda is harmless */
      }
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

  const nextSession = agenda.find((d) => d.date > date) ?? (agenda[0]?.date === date ? undefined : agenda[0]);

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={2} size="h4">
            {t("nav.session")}
          </Title>
          <Group align="end" wrap="wrap">
            <DateField
              label={t("session.date")}
              name="sessionDate"
              value={date}
              onChange={setDate}
            />
            <Button
              onClick={() => void load()}
              loading={loading}
              leftSection={<IconCalendarCheck size={15} aria-hidden="true" />}
            >
              {t("session.load")}
            </Button>
          </Group>
        </Group>
        <div aria-live="polite">
          {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        </div>
        {agenda.length > 0 && (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {t("session.upcoming")}
            </Text>
            <Group gap="xs" wrap="wrap">
              {agenda.map((d) => (
                <Button
                  key={d.date}
                  size="compact-sm"
                  variant={d.date === date ? "filled" : "light"}
                  onClick={() => {
                    setDate(d.date);
                    void load(d.date);
                  }}
                >
                  <span className="tabular">
                    {formatCivilDate(d.date, lang)} · ×{formatCount(d.children, lang)}
                  </span>
                </Button>
              ))}
            </Group>
          </Stack>
        )}
        {data &&
          (data.expected.length === 0 ? (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                {t("session.empty")}
              </Text>
              {nextSession && (
                <div>
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    onClick={() => {
                      setDate(nextSession.date);
                      void load(nextSession.date);
                    }}
                  >
                    {t("session.next", {
                      date: formatCivilDate(nextSession.date, lang),
                      n: formatCount(nextSession.children, lang),
                    })}
                  </Button>
                </div>
              )}
            </Stack>
          ) : (
            <Stack gap="sm">
              <Text size="sm" fw={600} className="tabular">
                {t("session.expected", { n: formatCount(data.counters.children, lang) })}
              </Text>
              <Group gap="xs">
                {Object.entries(data.counters.dosesByProduct).map(([p, n]) => (
                  <Badge key={p} variant="light" color="teal" className="tabular">
                    {productLabel(p)} ×{formatCount(n, lang)}
                  </Badge>
                ))}
              </Group>
              <PersonTable
                rows={data.expected.map(toRow)}
                showDue={false}
                productLabel={productLabel}
                actions={{ onOpen }}
              />
            </Stack>
          ))}
      </Stack>
    </Card>
  );
}

export function NoShowPanel({ products, onOpen }: PanelProps) {
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
