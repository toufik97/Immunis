import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  List,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { api, type Child, type Dose, type GateIssue, type Lot } from "../api";
import { formatCivilDate, todayCivilDate } from "../format";
import DateField from "./DateField";

interface Props {
  child: Child;
  products: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
  onDone: () => void;
}

export default function VisitPanel({ child, products, programs, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [visitDate, setVisitDate] = useState(todayCivilDate());
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

  useEffect(() => {
    setHistory([]);
    void fetchHistory();
    void evaluate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.id]);

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

  // Guard against losing unsaved doses on navigation.
  useEffect(() => {
    if (doses.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [doses.length]);

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
        const done = t("visit.recorded");
        setMsg(done);
        notifications.show({ title: done, message: `${child.givenName} ${child.familyName}`, color: "teal", icon: <IconCheck size={16} aria-hidden="true" /> });
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
  const todayStr = todayCivilDate();

  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Title order={2} size="h4" className="break-words">
            {child.givenName} {child.familyName} ·{" "}
            {t("child.birthDate", { date: formatCivilDate(child.birthDate, lang) })}
          </Title>
          <Badge variant="light" color="gray" className="tabular">
            {(child.localIds ?? []).map((l) => t("child.localId", { value: l.value })).join(" · ") || child.id}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {[child.fatherName, child.motherName].filter(Boolean).join(" · ")}
          {child.address ? ` · ${child.address}` : ""}
        </Text>
        <Text size="sm" c="dimmed">
          {t("visit.howto")}
        </Text>

        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <DateField
              label={t("visit.visitDate")}
              name="visitDate"
              value={visitDate}
              max={todayStr}
              onChange={setVisitDate}
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
          <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
            <DateField
              label={t("visit.nextRdv")}
              name="nextRdv"
              value={nextRdv}
              min={visitDate}
              onChange={setNextRdv}
            />
          </Grid.Col>
        </Grid>

        <Title order={3} size="h5">
          {t("visit.recordedDoses")}
        </Title>
        {history.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("visit.noRecorded")}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={420}>
            <Table striped highlightOnHover withTableBorder withColumnBorders={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("visit.date")}</Table.Th>
                  <Table.Th>{t("visit.product")}</Table.Th>
                  <Table.Th>{t("visit.origin")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="tabular">
                {history.map((d, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>{formatCivilDate(d.administeredOn, lang)}</Table.Td>
                    <Table.Td>{productLabel(d.productGroupId)}</Table.Td>
                    <Table.Td>{t(`origin.${d.origin}`)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        <Title order={3} size="h5">
          {t("visit.newDoses")}
        </Title>
        {blockedByScreening && (
          <Alert color="yellow" title={t("visit.screeningBlocks")} />
        )}
        {doses.map((d, i) => (
          <Paper key={i} withBorder p="sm" radius="md">
            <Stack gap="sm">
              <Group align="end" wrap="wrap">
                <Select
                  label={t("visit.product")}
                  name={`dose-product-${i}`}
                  aria-label={t("visit.product")}
                  value={d.productGroupId}
                  onChange={(v) =>
                    v && setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, productGroupId: v, lotId: undefined } : x)))
                  }
                  data={products.map((p) => ({ value: p.id, label: p.label_fr ?? p.id }))}
                  style={{ flex: 1, minWidth: 160 }}
                />
                <DateField
                  label={t("visit.date")}
                  name={`dose-date-${i}`}
                  value={d.administeredOn}
                  max={visitDate}
                  onChange={(v) =>
                    setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, administeredOn: v } : x)))
                  }
                />
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
                <ActionIcon
                  color="red"
                  variant="light"
                  aria-label={`${t("common.remove")} — ${productLabel(d.productGroupId)}`}
                  onClick={() => setDoses((ds) => ds.filter((_, j) => j !== i))}
                >
                  <IconTrash size={16} aria-hidden="true" />
                </ActionIcon>
              </Group>
              {d.origin === "CENTRE" && (
                <div>
                  {(lotsByProduct[d.productGroupId] ?? []).length === 0 ? (
                    <Text size="sm" c="dimmed">
                      {t("visit.lot")}: {t("visit.nolot")}
                    </Text>
                  ) : (
                    <Select
                      label={t("visit.lot")}
                      name={`dose-lot-${i}`}
                      value={d.lotId ?? ""}
                      onChange={(v) =>
                        setDoses((ds) => ds.map((x, j) => (j === i ? { ...x, lotId: v || undefined } : x)))
                      }
                      data={(lotsByProduct[d.productGroupId] ?? []).map((l) => ({
                        value: l.id,
                        label: `${l.lotNumber} · ${formatCivilDate(l.expiryDate, lang)} · ×${l.qtyOnHand}`,
                      }))}
                      placeholder="—"
                    />
                  )}
                </div>
              )}
            </Stack>
          </Paper>
        ))}
        <Group wrap="wrap">
          <Button
            variant="light"
            leftSection={<IconPlus size={15} aria-hidden="true" />}
            onClick={addDose}
            disabled={screening !== "VACCINATE"}
          >
            {t("visit.addDose")}
          </Button>
          <Button
            variant="default"
            leftSection={<IconSearch size={15} aria-hidden="true" />}
            onClick={() => void evaluate()}
            loading={evaluating}
          >
            {t("visit.evaluate")}
          </Button>
          <Button onClick={() => record(false)} loading={recording} disabled={blockedByScreening}>
            {t("visit.record")}
          </Button>
          <Select
            aria-label={t("visit.plan")}
            name="projection"
            value={projection}
            onChange={(v) => v && setProjection(v as "next" | "full")}
            data={[
              { value: "next", label: t("visit.projNext") },
              { value: "full", label: t("visit.projFull") },
            ]}
            style={{ maxWidth: 200 }}
          />
        </Group>

        <div aria-live="polite">
          {gateIssues.length > 0 && (
            <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={t("visit.gateTitle")}>
              <List size="sm" mt="xs">
                {gateIssues.map((g, idx) => (
                  <List.Item key={idx} className="tabular">
                    {productLabel(g.productGroupId)} · {formatCivilDate(g.administeredOn, lang)} — {g.message} (
                    <span translate="no">{g.code}</span>)
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

        {result && (
          <Stack gap="xs">
            <Title order={3} size="h5">
              {t("visit.needs")}
            </Title>
            <List size="sm">
              {result.antigenNeeds.map((n) => (
                <List.Item key={n.programId}>
                  {programLabel(n.programId)}: <span translate="no">{n.status}</span> ({n.dosesNeeded})
                </List.Item>
              ))}
            </List>
            <Title order={3} size="h5">
              {t("visit.plan")}
            </Title>
            {result.visitPlan.visits.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("visit.node")}
              </Text>
            ) : (
              <List size="sm" className="tabular">
                {result.visitPlan.visits.map((v, i) => (
                  <List.Item key={i}>
                    {formatCivilDate(v.date, lang)} — {v.products.map(productLabel).join(", ")} [
                    <span translate="no">{v.status}</span>]
                  </List.Item>
                ))}
              </List>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
