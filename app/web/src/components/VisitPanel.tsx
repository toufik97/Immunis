import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Grid,
  Group,
  List,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { api, type Child, type Dose, type GateIssue, type Lot } from "../api";
import { formatCivilDate, todayCivilDate } from "../format";
import { formatEngineWarning } from "../engineWarnings";
import ChildCard from "./ChildCard";
import DateField from "./DateField";
import EvalRail from "./EvalRail";

interface Props {
  child: Child;
  products: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
  /** Appointment products the child was opened from: prefilled as pending rows. */
  expectedProducts?: string[];
  onDone: () => void;
}

export default function VisitPanel({ child, products, programs, expectedProducts, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [visitDate, setVisitDate] = useState(todayCivilDate());
  const [screening, setScreening] = useState("VACCINATE");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [history, setHistory] = useState<Dose[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, Lot[]>>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.evaluate>> | null>(null);
  const [historyAsc, setHistoryAsc] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [rdv, setRdv] = useState<{ date: string; products: string[] } | null>(null);
  const [rdvDate, setRdvDate] = useState("");
  const [rdvSaving, setRdvSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [gateIssues, setGateIssues] = useState<GateIssue[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [batch, setBatch] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const rdvRef = useRef<HTMLDivElement>(null);

  const productLabel = (id: string) => products.find((p) => p.id === id)?.label_fr ?? id;
  // Lots usability depends on the visit date, so the cache key includes it.
  const lotsFor = (p: string): Lot[] => lotsByProduct[`${p}|${visitDate}`] ?? [];

  async function fetchHistory(): Promise<void> {
    try {
      setHistory(await api.childDoses(child.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function evaluate(silent = false): Promise<void> {
    if (!silent) setErr("");
    try {
      // The rail always shows the full projection; no manual refresh needed.
      const r = await api.evaluate({
        childId: child.id,
        evaluationDate: visitDate,
        projection: "full",
      });
      setResult(r);
    } catch (e) {
      if (!silent) setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    setHistory([]);
    void fetchHistory();
    // Scheduled opening: prefill one pending CENTRE row per expected product.
    if (expectedProducts && expectedProducts.length > 0) {
      const today = todayCivilDate();
      const rows: Dose[] = expectedProducts.map((productGroupId) => ({
        productGroupId,
        administeredOn: today,
        origin: "CENTRE" as const,
        overridden: false,
        recordedBy: "nurse",
      }));
      setDoses(rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id]);

  // Plan follows the visit date: re-evaluate silently whenever it changes.
  useEffect(() => {
    void evaluate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id, visitDate]);

  function onVisitDateChange(v: string): void {
    const prev = visitDate;
    setVisitDate(v);
    // Rows still on the old default follow the visit date; edited dates are respected.
    if (v !== prev) {
      setDoses((ds) => ds.map((x) => (x.administeredOn === prev ? { ...x, administeredOn: v } : x)));
    }
  }

  useEffect(() => {
    const needed = [...new Set(doses.filter((d) => d.origin === "CENTRE").map((d) => d.productGroupId))]
      .map((p) => `${p}|${visitDate}`)
      .filter((k) => {
        const [p] = k.split("|");
        return p && !(k in lotsByProduct);
      });
    if (needed.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await Promise.all(
          needed.map(async (k) => {
            const [p] = k.split("|");
            return [k, await api.lots(p, visitDate)] as const;
          })
        );
        if (!cancelled) setLotsByProduct((m) => ({ ...m, ...Object.fromEntries(entries) }));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Guard against losing unsaved doses on navigation.
  useEffect(() => {
    if (doses.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [doses.length]);

  // The post-record RDV step must be impossible to miss.
  useEffect(() => {
    if (rdv) rdvRef.current?.scrollIntoView({ block: "nearest" });
  }, [rdv]);

  async function confirmRdv(): Promise<void> {
    if (!rdv || !rdvDate) return;
    setErr("");
    setRdvSaving(true);
    try {
      await api.createAppointment({ childId: child.id, dueDate: rdvDate, expectedProducts: rdv.products });
      setRdv(null);
      setMsg(t("visit.rdvRecorded"));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRdvSaving(false);
    }
  }

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

  /** Append one CENTRE row per product id, skipping ids already listed. */
  function addProducts(ids: string[]): void {
    if (screening !== "VACCINATE" || ids.length === 0) return;
    setDoses((ds) => {
      const seen = new Set(ds.map((x) => x.productGroupId));
      const rows: Dose[] = ids
        .filter((id) => id && !seen.has(id))
        .map((productGroupId) => {
          seen.add(productGroupId);
          return {
            productGroupId,
            administeredOn: visitDate,
            origin: "CENTRE" as const,
            overridden: false,
            recordedBy: "nurse",
          };
        });
      return rows.length > 0 ? [...ds, ...rows] : ds;
    });
  }

  /** Next planned visit due today or overdue, minus products already recorded that day. */
  function dueProducts(): string[] {
    const visits = result?.visitPlan.visits ?? [];
    const due = visits.find((v) => v.date <= visitDate);
    if (!due) return [];
    const given = new Set(history.filter((h) => h.administeredOn === visitDate).map((h) => h.productGroupId));
    return due.products.filter((p) => !given.has(p));
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
        overridden: d.overridden || (withOverride && gateIssues.some((g) => g.doseIndex === i)),
      }));
      const r = await api.recordEncounterDetailed({
        childId: child.id,
        birthDate: child.birthDate,
        date: visitDate,
        screening,
        weightKg: weightKg ? Number(weightKg) : undefined,
        heightCm: heightCm ? Number(heightCm) : undefined,
        doses: payload,
        ...(withOverride ? { overrideReason } : {}),
      });
      if (r.status === "gated") {
        setGateIssues(r.issues);
      } else {
        setGateIssues([]);
        setOverrideReason("");
        setDoses([]);
        const done = t("visit.recorded");
        setMsg(done);
        notifications.show({ title: done, message: `${child.givenName} ${child.familyName}`, color: "teal", icon: <IconCheck size={16} aria-hidden="true" /> });
        await fetchHistory();
        // Engine recommends the next appointment only after the doses exist.
        try {
          const fresh = await api.evaluate({ childId: child.id, evaluationDate: visitDate, projection: "full" });
          setResult(fresh);
          const rec = fresh.visitPlan.visits.find((v) => v.date > visitDate);
          if (rec) {
            setRdv({ date: rec.date, products: rec.products });
            setRdvDate(rec.date);
          } else {
            setRdv(null);
          }
        } catch {
          setRdv(null);
        }
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
  const todayStr = todayCivilDate();
  const originColor = (o: string): string => (o === "CENTRE" ? "teal" : o === "CAMPAIGN" ? "orange" : "gray");

  // History grouped by day (carnet order: oldest first, toggleable).
  const historyByDate = [...history]
    .sort((a, b) => {
      const cmp = a.administeredOn < b.administeredOn ? -1 : a.administeredOn > b.administeredOn ? 1 : 0;
      return historyAsc ? cmp : -cmp;
    })
    .reduce<{ date: string; doses: Dose[] }[]>((groups, d) => {
      const last = groups[groups.length - 1];
      if (last && last.date === d.administeredOn) last.doses.push(d);
      else groups.push({ date: d.administeredOn, doses: [d] });
      return groups;
    }, []);

  // Recorded doses that did not count (or counted with a warning), keyed for the ledger.
  const doseFlags = new Map<string, string[]>();
  for (const v of Object.values(result?.doseValidations ?? {})) {
    for (const d of v.doses) {
      if (d.valid && d.warnings.length === 0) continue;
      const key = `${d.productGroupId}|${d.administeredOn}`;
      doseFlags.set(key, [...(doseFlags.get(key) ?? []), ...d.reasons, ...d.warnings]);
    }
  }

  return (
    <Grid>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Stack gap="sm">
          <ChildCard child={child} />
          <Card>
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {t("visit.howto")}
              </Text>

              <Group justify="space-between" wrap="wrap">
                <Title order={3} size="h5">
                  {t("visit.recordedDoses")}
                </Title>
                {history.length > 0 && (
                  <Button size="compact-xs" variant="subtle" onClick={() => setHistoryAsc((a) => !a)}>
                    {historyAsc ? t("history.newest") : t("history.oldest")}
                  </Button>
                )}
              </Group>
        {history.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("visit.noRecorded")}
          </Text>
        ) : (
          <Stack gap="xs">
            {historyByDate.map((g) => (
              <Group key={g.date} gap="sm" wrap="wrap" align="center">
                <Text size="sm" fw={600} className="tabular" style={{ minWidth: 110 }}>
                  {formatCivilDate(g.date, lang)}
                </Text>
                <Group gap={6} wrap="wrap" style={{ flex: 1 }}>
                  {g.doses.map((d, i) => (
                    <Badge key={i} variant="light" color={originColor(d.origin)}>
                      {productLabel(d.productGroupId)}
                    </Badge>
                  ))}
                </Group>
                <Text size="xs" c="dimmed">
                  {[...new Set(g.doses.map((d) => t(`origin.${d.origin}`)))].join(" · ")}
                </Text>
                {g.doses.some((d) => doseFlags.has(`${d.productGroupId}|${d.administeredOn}`)) && (
                  <IconAlertTriangle
                    size={14}
                    color="orange"
                    title={[...new Set(g.doses.flatMap((d) => doseFlags.get(`${d.productGroupId}|${d.administeredOn}`) ?? []))]
                      .map((w) => formatEngineWarning(w, lang))
                      .join("\n")}
                    aria-label={t("visit.notCounted")}
                  />
                )}
              </Group>
            ))}
          </Stack>
        )}

        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <DateField
              label={t("visit.visitDate")}
              name="visitDate"
              value={visitDate}
              max={todayStr}
              onChange={onVisitDateChange}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <Select
              label={t("visit.screening")}
              name="screening"
              value={screening}
              onChange={(v) => v && setScreening(v)}
              data={["VACCINATE", "DEFER", "CONTRAINDICATED"].map((s) => ({
                value: s,
                label: t(`screening.${s}`),
              }))}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput
              label={t("visit.weight")}
              name="weightKg"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min={0}
              step="0.1"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput
              label={t("visit.height")}
              name="heightCm"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min={0}
              step="0.1"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </Grid.Col>
        </Grid>

        <Title order={3} size="h5">
          {t("visit.newDoses")}
        </Title>
        {blockedByScreening && (
          <Alert color="yellow" title={t("visit.screeningBlocks")} />
        )}
        {doses.map((d, i) => (
          <Paper key={i} withBorder p="xs" radius="md">
            <Grid gutter="xs" align="end">
              <Grid.Col span={7}>
                <Select
                  label={t("visit.product")}
                  name={`dose-product-${i}`}
                  aria-label={t("visit.product")}
                  searchable
                  limit={20}
                  value={d.productGroupId}
                  onChange={(v) =>
                    v && setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, productGroupId: v, lotId: undefined } : x)))
                  }
                  data={products.map((p) => ({ value: p.id, label: p.label_fr ?? p.id }))}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <DateField
                  label={t("visit.date")}
                  name={`dose-date-${i}`}
                  value={d.administeredOn}
                  max={visitDate}
                  onChange={(v) =>
                    setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, administeredOn: v } : x)))
                  }
                />
              </Grid.Col>
              <Grid.Col span={1}>
                <ActionIcon
                  color="red"
                  variant="light"
                  aria-label={`${t("common.remove")} — ${productLabel(d.productGroupId)}`}
                  onClick={() => setDoses((ds) => ds.filter((_, j) => j !== i))}
                >
                  <IconTrash size={16} aria-hidden="true" />
                </ActionIcon>
              </Grid.Col>
              <Grid.Col span={7}>
                {d.origin === "CENTRE" ? (
                  lotsFor(d.productGroupId).length === 0 ? (
                    <Text size="sm" c="dimmed">
                      {t("visit.lot")}: {t("visit.nolot")}
                    </Text>
                  ) : (
                    <Select
                      label={t("visit.lot")}
                      name={`dose-lot-${i}`}
                      searchable
                      limit={20}
                      value={d.lotId ?? ""}
                      onChange={(v) =>
                        setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, lotId: v || undefined } : x)))
                      }
                      data={lotsFor(d.productGroupId).map((l) => ({
                        value: l.id,
                        label: `${l.lotNumber} · ${formatCivilDate(l.expiryDate, lang)} · ×${l.qtyOnHand}`,
                      }))}
                      placeholder="—"
                    />
                  )
                ) : (
                  <Text size="sm" c="dimmed">
                    {t("visit.lot")}: —
                  </Text>
                )}
              </Grid.Col>
              <Grid.Col span={5}>
                <Select
                  label={t("visit.origin")}
                  name={`dose-origin-${i}`}
                  aria-label={t("visit.origin")}
                  value={d.origin}
                  onChange={(v) =>
                    v &&
                    setDoses((ds) =>
                      ds.map((x, j) => (j === i ? { ...x, origin: v as Dose["origin"], lotId: undefined } : x))
                    )
                  }
                  data={(["CENTRE", "EXTERNAL", "CAMPAIGN"] as const).map((o) => ({
                    value: o,
                    label: t(`origin.${o}`),
                  }))}
                />
              </Grid.Col>
            </Grid>
          </Paper>
        ))}
        <Group align="end" wrap="wrap">
          <MultiSelect
            label={t("visit.batchProducts")}
            name="dose-batch"
            aria-label={t("visit.batchProducts")}
            searchable
            limit={20}
            disabled={screening !== "VACCINATE"}
            value={batch}
            onChange={setBatch}
            data={products.map((p) => ({ value: p.id, label: p.label_fr ?? p.id }))}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button
            variant="light"
            leftSection={<IconPlus size={15} aria-hidden="true" />}
            onClick={() => {
              addProducts(batch);
              setBatch([]);
            }}
            disabled={screening !== "VACCINATE" || batch.length === 0}
          >
            {t("visit.addSelected", { n: batch.length })}
          </Button>
          <Button
            variant="default"
            onClick={() => addProducts(dueProducts())}
            disabled={screening !== "VACCINATE" || dueProducts().length === 0}
          >
            {t("visit.addDue", { n: dueProducts().length })}
          </Button>
        </Group>
        <Group wrap="wrap">
          <Button
            variant="light"
            leftSection={<IconPlus size={15} aria-hidden="true" />}
            onClick={addDose}
            disabled={screening !== "VACCINATE"}
          >
            {t("visit.addDose")}
          </Button>
          <Button onClick={() => record(false)} loading={recording} disabled={blockedByScreening}>
            {t("visit.record")}
          </Button>
        </Group>

        {rdv && (
          <Paper withBorder p="sm" radius="md" ref={rdvRef}>
            <Stack gap="xs">
              <Title order={3} size="h5">
                {t("visit.rdvTitle")}
              </Title>
              <Text size="sm" className="tabular">
                {t("visit.rdvRecommended", {
                  date: formatCivilDate(rdv.date, lang),
                  products: rdv.products.map(productLabel).join(", "),
                })}
              </Text>
              <Group align="end" wrap="wrap">
                <DateField
                  label={t("visit.nextRdv")}
                  name="rdvDate"
                  value={rdvDate}
                  min={visitDate}
                  onChange={setRdvDate}
                />
                <Button onClick={() => void confirmRdv()} loading={rdvSaving}>
                  {t("visit.rdvConfirm")}
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    setRdv(null);
                    onDone();
                  }}
                >
                  {t("visit.rdvSkip")}
                </Button>
              </Group>
            </Stack>
          </Paper>
        )}

        <div aria-live="polite">
          {gateIssues.length > 0 && (
            <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={t("visit.gateTitle")}>
              <List size="sm" mt="xs">
                {gateIssues.map((g, idx) => (
                  <List.Item key={idx} className="tabular">
                    {productLabel(g.productGroupId)} · {formatCivilDate(g.administeredOn, lang)} —{" "}
                    {formatEngineWarning(g.message, lang)}{" "}
                    <Text span size="xs" c="dimmed" translate="no">
                      {g.code}
                    </Text>
                  </List.Item>
                ))}
              </List>
              {!canOverride ? (
                <Text size="sm" mt="xs">
                  {t("visit.hardBlock")}
                </Text>
              ) : (
                <Stack gap="xs" mt="sm">
                  <TextInput
                    label={t("visit.overrideReason")}
                    name="overrideReason"
                    autoComplete="off"
                    required
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                  />
                  <div>
                    <Button size="sm" color="red" onClick={() => record(true)} loading={recording}>
                      {t("visit.recordOverride")}
                    </Button>
                  </div>
                </Stack>
              )}
            </Alert>
          )}
          {err && (
            <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} mt={gateIssues.length ? "sm" : undefined} />
          )}
          {msg && (
            <Alert color="teal" icon={<IconCheck size={16} aria-hidden="true" />} title={msg} mt="sm" />
          )}
        </div>
            </Stack>
          </Card>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Card>
          <Stack gap="sm">
            <Group justify="space-between" wrap="wrap">
              <Title order={3} size="h5">
                {t("rail.title")}
              </Title>
              <ActionIcon
                variant="subtle"
                aria-label={railOpen ? t("rail.hide") : t("rail.show")}
                onClick={() => setRailOpen((o) => !o)}
              >
                {railOpen ? <IconChevronUp size={16} aria-hidden="true" /> : <IconChevronDown size={16} aria-hidden="true" />}
              </ActionIcon>
            </Group>
            <Collapse in={railOpen}>
              {result ? (
                <EvalRail result={result} products={products} programs={programs} />
              ) : (
                <Text size="sm" c="dimmed">
                  {t("visit.evaluate")}…
                </Text>
              )}
            </Collapse>
          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
