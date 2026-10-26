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
  Menu,
  Modal,
  MultiSelect,
  Paper,
  Radio,
  SegmentedControl,
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
  IconDots,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { api, type Appointment, type Child, type Dose, type EncounterHistory, type GateIssue, type Lot, type SchedulingIssue } from "../api";
import { ageParts, formatCivilDate, todayCivilDate } from "../format";
import { centreTime } from "../centreTime";
import { formatEngineWarning } from "../engineWarnings";
import ChildCard from "./ChildCard";
import AppointmentForm from "./AppointmentForm";
import DateField from "./DateField";
import EvalRail from "./EvalRail";
import GrowthPanel from "./GrowthPanel";
import { bandColor, interpKey, scoreLive, type Indicator } from "../growthLive";

interface Props {
  child: Child;
  products: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
  /** Logged-in user: flag button shows for the recorder or an admin; void/invalidate are admin-only. */
  user: { username: string; role: string };
  /** Appointment products the child was opened from: prefilled as pending rows. */
  expectedProducts?: string[];
  onDone: () => void;
  /** Visit fully handled (RDV confirmed or skipped): back to search. */
  onFinished: () => void;
  /** Leave without recording: back to search. */
  onClose: () => void;
}

type CorrectionModal =
  | { action: "flag"; encounterId: string }
  | { action: "void"; encounterId: string; injected: "yes" | "no" }
  | { action: "reinstate"; encounterId: string }
  | { action: "invalidate" | "revalidate"; doseId: string };

export default function VisitPanel({ child, products, programs, user, expectedProducts, onDone, onFinished, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [visitDate, setVisitDate] = useState(todayCivilDate());
  // Device date at mount: adopted only while the field still holds this default.
  const localTodayAtMount = useRef(todayCivilDate());
  // Centre today from the server: the only "today" the form trusts for defaults/bounds.
  const [serverToday, setServerToday] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void centreTime().then((t) => {
      if (cancelled) return;
      setServerToday(t.today);
      setVisitDate((v) => (v === localTodayAtMount.current ? t.today : v));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [screening, setScreening] = useState("VACCINATE");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [history, setHistory] = useState<Dose[]>([]);
  const [encounters, setEncounters] = useState<EncounterHistory[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editSlot, setEditSlot] = useState<"AM" | "PM">("AM");
  const [editProducts, setEditProducts] = useState<string[]>([]);
  const [editIssues, setEditIssues] = useState<SchedulingIssue[]>([]);
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [correction, setCorrection] = useState<CorrectionModal | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [lotsByProduct, setLotsByProduct] = useState<Record<string, Lot[]>>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.evaluate>> | null>(null);
  const [historyAsc, setHistoryAsc] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [rdv, setRdv] = useState<{ date: string; products: string[] } | null>(null);
  /** Due-now products left out of the just-recorded visit: they get their own appointment first. */
  const [skipped, setSkipped] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [gateIssues, setGateIssues] = useState<GateIssue[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [batch, setBatch] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [dateAck, setDateAck] = useState<string | null>(null);
  const rdvRef = useRef<HTMLDivElement>(null);

  const productLabel = (id: string) => products.find((p) => p.id === id)?.label_fr ?? id;
  // Lots usability depends on the visit date, so the cache key includes it.
  const lotsFor = (p: string): Lot[] => lotsByProduct[`${p}|${visitDate}`] ?? [];

  async function fetchHistory(): Promise<void> {
    try {
      const [doses, encs, appts] = await Promise.all([api.childDoses(child.id), api.childEncounters(child.id), api.childAppointments(child.id)]);
      setHistory(doses);
      setEncounters(encs);
      setAppointments(appts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function startEdit(a: Appointment): void {
    setEditIssues([]);
    setEditReason("");
    setEditDate(a.dueDate);
    setEditSlot(a.slot ?? "AM");
    setEditProducts(a.expectedProducts);
    setEditingId(a.id);
  }

  /** Scheduling-gate sentence (codes + params, never hardcoded). */
  function schedText(i: SchedulingIssue): string {
    const product = i.productGroupId ? ` · ${productLabel(i.productGroupId)}` : "";
    switch (i.code) {
      case "closed_day":
        return t("sched.closedDay", { product });
      case "slot_full":
        return t("sched.slotFull", { booked: i.booked ?? 0, cap: i.cap ?? 0, product });
      case "closure_day":
        return t("sched.closureDay", { label: i.limit ?? "" });
      case "beyond_horizon":
        return t("sched.beyondHorizon", { days: i.limit ?? "" });
    }
  }

  async function saveEdit(id: string, override = false): Promise<void> {
    if (!editDate) return;
    setErr("");
    setSavingEdit(true);
    try {
      const updated = await api.updateAppointment(id, {
        dueDate: editDate,
        slot: editSlot,
        expectedProducts: editProducts,
        overrideReason: override ? editReason || undefined : undefined,
      });
      setAppointments((as) => as.map((a) => (a.id === id ? updated : a)));
      setEditingId(null);
      setEditIssues([]);
      setEditReason("");
      setMsg(t("visit.apptUpdated"));
      onDone();
    } catch (e) {
      const iss = (e as Error & { issues?: SchedulingIssue[] }).issues;
      if (iss && iss.length > 0 && !override) setEditIssues(iss);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
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

  const showRdvCard = rdv !== null || skipped.length > 0;

  // The post-record RDV step must be impossible to miss.
  useEffect(() => {
    if (showRdvCard) rdvRef.current?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRdvCard]);

  /** Catch-up and next visit coincide: book once with everything. */
  function combineAppointments(): void {
    if (!rdv) return;
    setRdv({ date: rdv.date, products: [...rdv.products, ...skipped.filter((p) => !rdv.products.includes(p))] });
    setSkipped([]);
  }

  /** Catch-up booked on its own day: the next visit is still pending. */
  function catchupBooked(): void {
    setSkipped([]);
    const done = t("visit.rdvRecorded");
    setMsg(done);
    notifications.show({ title: done, message: `${child.givenName} ${child.familyName}`, color: "teal", icon: <IconCheck size={16} aria-hidden="true" /> });
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
    // Visit date vs dose dates: back-dating doses but leaving the visit at
    // today misfiles the whole visit (wrong session day, appointment missed).
    const doseDates = [...new Set(doses.map((d) => d.administeredOn))].sort();
    const sig = `${visitDate}|${doseDates.join(",")}`;
    if (doseDates.length > 0 && doseDates.some((d) => d !== visitDate)) {
      if (dateAck !== sig) {
        setDateAck(sig);
        setErr(
          t("visit.dateMismatch", {
            visit: formatCivilDate(visitDate, lang),
            doses: doseDates.map((d) => formatCivilDate(d, lang)).join(", "),
          })
        );
        return;
      }
    }
    setDateAck(null);
    const missingLot = doses.some((d) => d.origin === "CENTRE" && !d.lotId);
    if (missingLot && !transitionReason.trim()) {
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
        ...(transitionReason.trim() ? { transitionReason: transitionReason.trim() } : {}),
      });
      if (r.status === "gated") {
        setGateIssues(r.issues);
        setSkipped([]);
      } else {
        setGateIssues([]);
        setOverrideReason("");
        setTransitionReason("");
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
            // Memory refresh: due-now products left out of this visit get their own appointment first.
            if (screening === "VACCINATE") {
              const dueNow = [
                ...new Set(
                  (result?.visitPlan.visits ?? [])
                    .filter((v) => v.status === "DUE_NOW")
                    .flatMap((v) => v.products)
                ),
              ];
              const recorded = new Set(payload.map((d) => d.productGroupId));
              const planned = new Set(rec.products);
              setSkipped(dueNow.filter((p) => !recorded.has(p) && !planned.has(p)));
            } else {
              setSkipped([]);
            }
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
  const todayStr = serverToday ?? todayCivilDate();
  const originColor = (o: string): string => (o === "CENTRE" ? "teal" : o === "CAMPAIGN" ? "orange" : "gray");

  // History grouped per encounter (voided visits stay visible via the encounter ledger).
  const isAdmin = user.role === "admin";
  const canManageAppt = user.role === "nurse" || user.role === "admin";
  // Kept/missed is written by visit recording, never by hand: pending rows past
  // their date read as missed (no visit that day), future pending rows are editable.
  const upcomingAppts = appointments.filter((a) => a.kept === null && a.dueDate >= todayStr);
  const pastAppts = appointments.filter((a) => a.kept !== null || a.dueDate < todayStr).slice(-5).reverse();
  const encById = new Map(encounters.map((e) => [e.id, e]));
  const legacyByDate = new Map<string, Dose[]>();
  for (const d of history) {
    if (d.encounterId && encById.has(d.encounterId)) continue;
    legacyByDate.set(d.administeredOn, [...(legacyByDate.get(d.administeredOn) ?? []), d]);
  }
  const orderedEncounters = [...encounters].sort((a, b) =>
    historyAsc ? (a.date < b.date ? -1 : 1) : a.date > b.date ? -1 : 1
  );
  // Legacy data may hold two rows for one day (growth saved apart from doses
  // before the write-path merge): display stays one row per date.
  const encountersByDate = new Map<string, typeof encounters>();
  for (const enc of orderedEncounters) {
    encountersByDate.set(enc.date, [...(encountersByDate.get(enc.date) ?? []), enc]);
  }
  const orderedDates = [...encountersByDate.keys()];
  const canFlag = (enc: EncounterHistory, doses: Dose[]): boolean => {
    if (enc.voidedAt || enc.voidRequestedBy) return false;
    if (isAdmin) return true;
    if (doses.length === 0) return false;
    return doses.every((d) => d.recordedBy === user.username);
  };

  // Recorded doses that did not count (or counted with a warning), keyed for the ledger.
  const doseFlags = new Map<string, string[]>();
  for (const v of Object.values(result?.doseValidations ?? {})) {
    for (const d of v.doses) {
      if (d.valid && d.warnings.length === 0) continue;
      const key = `${d.productGroupId}|${d.administeredOn}`;
      doseFlags.set(key, [...(doseFlags.get(key) ?? []), ...d.reasons, ...d.warnings]);
    }
  }

  // Age at a past date in the child's own words (same as the header card).
  const ageWord = (atIso: string): string => {
    const { y, m, d } = ageParts(child.birthDate, atIso);
    if (y > 0) return t("child.ageYMD", { y, m, d });
    if (m > 0) return t("child.ageMD", { m, d });
    return t("child.ageD", { d });
  };

  // Live growth words while typing (same math as the saved result).
  const liveWeight = weightKg.trim() === "" ? null : Number(weightKg);
  const liveHeight = heightCm.trim() === "" ? null : Number(heightCm);
  const live = scoreLive(child.sex, child.birthDate, visitDate, liveWeight, liveHeight);
  const liveReady = live !== null && (liveWeight !== null || liveHeight !== null);

  async function submitCorrection(): Promise<void> {
    const c = correction;
    if (!c) return;
    if (!correctionReason.trim()) {
      setErr(t("correction.needReason"));
      return;
    }
    setCorrecting(true);
    try {
      const reason = correctionReason.trim();
      switch (c.action) {
        case "flag":
          await api.flagVoid(c.encounterId, reason);
          break;
        case "void":
          await api.voidEncounter(c.encounterId, reason);
          break;
        case "reinstate":
          await api.reinstateEncounter(c.encounterId, reason);
          break;
        case "invalidate":
          await api.invalidateDose(c.doseId, reason);
          break;
        case "revalidate":
          await api.revalidateDose(c.doseId, reason);
          break;
      }
      setCorrection(null);
      setCorrectionReason("");
      setMsg(t(c.action === "flag" ? "correction.sent" : "correction.done"));
      await fetchHistory();
      await evaluate(true);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCorrecting(false);
    }
  }

  function correctionTitle(): string {
    if (!correction) return "";
    if (correction.action === "flag") return t("correction.report");
    if (correction.action === "void") return t("correction.confirmVoid");
    if (correction.action === "reinstate") return t("correction.confirmReinstate");
    if (correction.action === "invalidate") return t("correction.confirmInvalidate");
    return t("correction.confirmRevalidate");
  }

  return (
    <Grid>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Stack gap="sm">
          <ChildCard child={child} onClose={onClose} />
          <Card>
            <Stack gap="xs">
              <Title order={3} size="h5">
                {t("visit.apptTitle")}
              </Title>
              {appointments.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t("visit.apptNone")}
                </Text>
              ) : (
                <Stack gap="xs">
                  {upcomingAppts.map((a) => (
                    <Stack key={a.id} gap="xs">
                      <Group gap="sm" wrap="wrap" align="center">
                        <Text size="sm" fw={600} className="tabular">
                          {formatCivilDate(a.dueDate, lang)}{a.slot ? ` · ${a.slot}` : ""}
                        </Text>
                        <Group gap={6} wrap="wrap" style={{ flex: 1 }}>
                          {a.expectedProducts.map((p) => (
                            <Badge key={p} size="sm" variant="light" color="teal">
                              {productLabel(p)}
                            </Badge>
                          ))}
                        </Group>
                        {canManageAppt && editingId !== a.id && (
                          <Button size="compact-xs" variant="default" onClick={() => startEdit(a)}>
                            {t("visit.apptEdit")}
                          </Button>
                        )}
                      </Group>
                      {editingId === a.id && (
                        <Stack gap="xs">
                          <Group align="end" wrap="wrap">
                            <DateField
                              label={t("visit.nextRdv")}
                              name={`apptDate-${a.id}`}
                              value={editDate}
                              min={todayStr}
                              onChange={(v) => {
                                setEditDate(v);
                                setEditIssues([]);
                              }}
                            />
                            <SegmentedControl
                              size="xs"
                              aria-label={t("visit.rdvSlot")}
                              value={editSlot}
                              onChange={(v) => {
                                setEditSlot(v as "AM" | "PM");
                                setEditIssues([]);
                              }}
                              data={[
                                { label: "AM", value: "AM" },
                                { label: "PM", value: "PM" },
                              ]}
                            />
                            <Button size="compact-sm" onClick={() => void saveEdit(a.id)} loading={savingEdit}>
                              {t("visit.apptSave")}
                            </Button>
                            <Button size="compact-sm" variant="default" onClick={() => setEditingId(null)}>
                              {t("visit.apptCancel")}
                            </Button>
                          </Group>
                          <MultiSelect
                            label={t("visit.apptProducts")}
                            name={`apptProducts-${a.id}`}
                            aria-label={t("visit.apptProducts")}
                            searchable
                            limit={20}
                            value={editProducts}
                            onChange={(v) => {
                              setEditProducts(v);
                              setEditIssues([]);
                            }}
                            data={products.map((p) => ({ value: p.id, label: p.label_fr ?? p.id }))}
                          />
                          {editIssues.length > 0 && (
                            <Alert color="yellow" title={t("visit.gateTitle")}>
                              <List size="sm" mt="xs">
                                {editIssues.map((g, idx) => (
                                  <List.Item key={idx} className="tabular">
                                    {schedText(g)}{" "}
                                    <Text span size="xs" c="dimmed" translate="no">
                                      {g.code}
                                    </Text>
                                  </List.Item>
                                ))}
                              </List>
                              <Stack gap="xs" mt="sm">
                                <TextInput
                                  label={t("visit.overrideReason")}
                                  name={`apptOverrideReason-${a.id}`}
                                  autoComplete="off"
                                  required
                                  value={editReason}
                                  onChange={(e) => setEditReason(e.target.value)}
                                />
                                <div>
                                  <Button size="sm" color="yellow" onClick={() => void saveEdit(a.id, true)} loading={savingEdit} disabled={!editReason}>
                                    {t("visit.rdvOverride")}
                                  </Button>
                                </div>
                              </Stack>
                            </Alert>
                          )}
                        </Stack>
                      )}
                    </Stack>
                  ))}
                  {pastAppts.map((a) => (
                    <Group key={a.id} gap="sm" wrap="wrap" align="center">
                      <Text size="sm" c="dimmed" className="tabular">
                        {formatCivilDate(a.dueDate, lang)}{a.slot ? ` · ${a.slot}` : ""}
                      </Text>
                      <Badge size="sm" color={a.kept ? "teal" : "gray"} variant="light">
                        {a.kept ? t("visit.apptKept") : t("visit.apptMissed")}
                      </Badge>
                      <Group gap={6} wrap="wrap" style={{ flex: 1 }}>
                        {a.expectedProducts.map((p) => (
                          <Badge key={p} size="sm" variant="light" color="gray">
                            {productLabel(p)}
                          </Badge>
                        ))}
                      </Group>
                    </Group>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>
          <Card>
            <Stack gap="sm">
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
        {history.length === 0 && encounters.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("visit.noRecorded")}
          </Text>
        ) : (
          <Stack gap="xs">
            {orderedDates.map((date) => {
              const encs = encountersByDate.get(date)!;
              const encIds = new Set(encs.map((e) => e.id));
              const doses = history.filter((d) => d.encounterId && encIds.has(d.encounterId));
              const dosesByEnc = (id: string): Dose[] => history.filter((d) => d.encounterId === id);
              const flaggableEncs = encs.filter((e) => canFlag(e, dosesByEnc(e.id)));
              const voidableEncs = isAdmin ? encs.filter((e) => !e.voidedAt) : [];
              const reinstatableEncs = isAdmin ? encs.filter((e) => !!e.voidedAt) : [];
              const toInvalidate = isAdmin && !encs.every((e) => e.voidedAt) ? doses.filter((d) => d.overridden && !d.invalidatedAt && d.id) : [];
              const toRevalidate = isAdmin ? doses.filter((d) => d.invalidatedAt && d.id) : [];
              const hasMenu = flaggableEncs.length > 0 || voidableEncs.length > 0 || reinstatableEncs.length > 0 || toInvalidate.length > 0 || toRevalidate.length > 0;
              const allVoided = encs.every((e) => e.voidedAt);
              const anyFlagged = encs.some((e) => e.voidRequestedBy && !e.voidedAt);
              const anyVoided = encs.some((e) => e.voidedAt);
              const voidReason = encs.find((e) => e.voidedAt)?.voidReason ?? undefined;
              const flagReason = encs.find((e) => e.voidRequestedBy && !e.voidedAt)?.voidRequestReason ?? undefined;
              const voidedProducts = encs.filter((e) => e.voidedAt).flatMap((e) => e.products);
              return (
                <Group key={date} gap="sm" wrap="wrap" align="center">
                  <Stack gap={0} style={{ minWidth: 110 }}>
                    <Text size="sm" fw={600} className="tabular" td={allVoided ? "line-through" : undefined}>
                      {formatCivilDate(date, lang)}
                    </Text>
                    <Text size="xs" c="dimmed" className="tabular">
                      {ageWord(date)}
                    </Text>
                  </Stack>
                  <Group gap={6} wrap="wrap" style={{ flex: 1 }}>
                    {doses.map((d) => (
                      <Badge
                        key={d.id ?? `${d.productGroupId}|${d.administeredOn}`}
                        variant="light"
                        color={d.invalidatedAt ? "red" : originColor(d.origin)}
                        title={d.invalidatedAt ? (d.invalidatedReason ?? undefined) : undefined}
                      >
                        {productLabel(d.productGroupId)}
                        {d.overridden && !d.invalidatedAt ? ` · ${t("correction.statusOverridden")}` : ""}
                        {d.invalidatedAt ? ` · ${t("correction.statusInvalidated")}` : ""}
                      </Badge>
                    ))}
                    {anyVoided && (
                      <Text size="xs" c="dimmed" td="line-through">
                        {voidedProducts.map(productLabel).join(" · ")}
                      </Text>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {[...new Set(doses.map((d) => t(`origin.${d.origin}`)))].join(" · ")}
                  </Text>
                  {doses.some((d) => doseFlags.has(`${d.productGroupId}|${d.administeredOn}`)) && (
                    <IconAlertTriangle
                      size={14}
                      color="orange"
                      title={[...new Set(doses.flatMap((d) => doseFlags.get(`${d.productGroupId}|${d.administeredOn}`) ?? []))]
                        .map((w) => formatEngineWarning(w, lang))
                        .join("\n")}
                      aria-label={t("visit.notCounted")}
                    />
                  )}
                  {anyFlagged && (
                    <Badge size="sm" color="yellow" variant="light" title={flagReason}>
                      {t("correction.statusFlagged")}
                    </Badge>
                  )}
                  {anyVoided && (
                    <Badge size="sm" color="red" variant="light" title={voidReason}>
                      {t("correction.statusVoided")}
                    </Badge>
                  )}
                  {hasMenu && (
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label={t("correction.report")}>
                          <IconDots size={16} aria-hidden="true" />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {flaggableEncs.map((e) => (
                          <Menu.Item
                            key={`flag-${e.id}`}
                            onClick={() => {
                              setCorrectionReason("");
                              setCorrection({ action: "flag", encounterId: e.id });
                            }}
                          >
                            {t("correction.report")}
                          </Menu.Item>
                        ))}
                        {voidableEncs.map((e) => (
                          <Menu.Item
                            key={`void-${e.id}`}
                            color="red"
                            onClick={() => {
                              setCorrectionReason("");
                              setCorrection({ action: "void", encounterId: e.id, injected: "no" });
                            }}
                          >
                            {t("correction.void")}
                          </Menu.Item>
                        ))}
                        {reinstatableEncs.map((e) => (
                          <Menu.Item
                            key={`reinstate-${e.id}`}
                            onClick={() => {
                              setCorrectionReason("");
                              setCorrection({ action: "reinstate", encounterId: e.id });
                            }}
                          >
                            {t("correction.reinstate")}
                          </Menu.Item>
                        ))}
                        {toInvalidate.map((d) => (
                          <Menu.Item
                            key={d.id}
                            color="red"
                            onClick={() => {
                              setCorrectionReason("");
                              setCorrection({ action: "invalidate", doseId: d.id! });
                            }}
                          >
                            {t("correction.invalidate")} ({productLabel(d.productGroupId)})
                          </Menu.Item>
                        ))}
                        {toRevalidate.map((d) => (
                          <Menu.Item
                            key={d.id}
                            onClick={() => {
                              setCorrectionReason("");
                              setCorrection({ action: "revalidate", doseId: d.id! });
                            }}
                          >
                            {t("correction.revalidate")} ({productLabel(d.productGroupId)})
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              );
            })}
            {[...legacyByDate.entries()].map(([date, doses]) => (
              <Group key={`legacy-${date}`} gap="sm" wrap="wrap" align="center">
                <Stack gap={0} style={{ minWidth: 110 }}>
                  <Text size="sm" fw={600} className="tabular">
                    {formatCivilDate(date, lang)}
                  </Text>
                  <Text size="xs" c="dimmed" className="tabular">
                    {ageWord(date)}
                  </Text>
                </Stack>
                <Group gap={6} wrap="wrap" style={{ flex: 1 }}>
                  {doses.map((d, i) => (
                    <Badge key={i} variant="light" color={originColor(d.origin)}>
                      {productLabel(d.productGroupId)}
                    </Badge>
                  ))}
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      <Modal
        opened={correction !== null}
        onClose={() => setCorrection(null)}
        title={correctionTitle()}
      >
        <Stack gap="sm">
          {correction?.action === "void" && (
            <>
              <Text size="sm" fw={600}>
                {t("correction.injectedQ")}
              </Text>
              <Radio.Group
                value={correction.injected}
                onChange={(v) =>
                  setCorrection((c) => (c && "injected" in c ? { ...c, injected: v as "yes" | "no" } : c))
                }
              >
                <Stack gap="xs">
                  <Radio value="no" label={t("correction.injectedNo")} />
                  <Radio value="yes" label={t("correction.injectedYes")} />
                </Stack>
              </Radio.Group>
              {correction.injected === "no" ? (
                <Text size="sm" c="dimmed">{t("correction.voidNote")}</Text>
              ) : (
                <Alert color="yellow">{t("correction.invalidateNote")}</Alert>
              )}
            </>
          )}
          {correction?.action === "reinstate" && (
            <Text size="sm" c="dimmed">{t("correction.reinstateNote")}</Text>
          )}
          {(correction?.action === "invalidate" || correction?.action === "revalidate") && (
            <Text size="sm" c="dimmed">{t("correction.invalidateNote")}</Text>
          )}
          <TextInput
            label={t("correction.reason")}
            name="correctionReason"
            autoComplete="off"
            required
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
          />
          <Group justify="end">
            <Button
              color={correction?.action === "flag" || correction?.action === "reinstate" || correction?.action === "revalidate" ? undefined : "red"}
              onClick={submitCorrection}
              loading={correcting}
              disabled={
                !correctionReason.trim() ||
                (correction?.action === "void" && (correction.injected === "yes"))
              }
            >
              {correction?.action === "flag" ? t("correction.confirm") : correctionTitle()}
            </Button>
          </Group>
          {correction?.action === "void" && correction.injected === "yes" && (
            <Text size="xs" c="dimmed">{t("correction.queueHint")}</Text>
          )}
        </Stack>
      </Modal>

            </Stack>
          </Card>

          <Card>
            <GrowthPanel childId={child.id} sex={child.sex} refreshKey={history.length} />
          </Card>

          <Card>
            <Stack gap="sm">
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
        {liveReady && live && (
          <Group gap="xs" wrap="wrap" aria-live="polite">
            <Text size="xs" c="dimmed">
              {t("growth.today", { date: formatCivilDate(visitDate, lang) })}:
            </Text>
            {(["wfa", "lhfa", "bfa"] as Indicator[]).map((ind) => {
              const band = live[ind].band;
              const key = interpKey(ind, band);
              if (!key) return null;
              return (
                <Badge key={ind} size="sm" color={bandColor(band)} variant="light">
                  {t(key)}
                </Badge>
              );
            })}
          </Group>
        )}

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
        {doses.some((d) => d.origin === "CENTRE" && !d.lotId) && (
          <TextInput
            label={t("visit.transitionReason")}
            name="transitionReason"
            autoComplete="off"
            placeholder={t("visit.transitionReason")}
            value={transitionReason}
            onChange={(e) => setTransitionReason(e.target.value)}
          />
        )}

        {showRdvCard && (
          <Paper withBorder p="sm" radius="md" ref={rdvRef}>
            <Stack gap="md">
              <Title order={3} size="h5">
                {t("visit.rdvTitle")}
              </Title>
              {skipped.length > 0 && (
                <AppointmentForm
                  childId={child.id}
                  heading={
                    <Group gap={6} wrap="wrap" align="center">
                      <Text size="sm" fw={600}>
                        {t("visit.catchup")}
                      </Text>
                      {skipped.map((p) => (
                        <Badge key={p} size="sm" variant="light" color="yellow">
                          {productLabel(p)}
                        </Badge>
                      ))}
                    </Group>
                  }
                  products={skipped}
                  engineDate={visitDate}
                  suggestFrom={visitDate}
                  productLabel={productLabel}
                  combineTarget={rdv ? { date: rdv.date, products: rdv.products } : null}
                  onCombine={combineAppointments}
                  skipLabel={t("visit.skippedLater")}
                  onSkip={() => setSkipped([])}
                  onBooked={catchupBooked}
                />
              )}
              {rdv && (
                <AppointmentForm
                  childId={child.id}
                  heading={
                    <Text size="sm" className="tabular">
                      {t("visit.rdvRecommended", {
                        date: formatCivilDate(rdv.date, lang),
                        products: rdv.products.map(productLabel).join(", "),
                      })}
                    </Text>
                  }
                  products={rdv.products}
                  engineDate={rdv.date}
                  suggestFrom={rdv.date}
                  productLabel={productLabel}
                  skipLabel={t("visit.rdvSkip")}
                  onSkip={() => {
                    setRdv(null);
                    onFinished();
                  }}
                  onBooked={() => {
                    setRdv(null);
                    setMsg(t("visit.rdvRecorded"));
                    onFinished();
                  }}
                />
              )}
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
          {msg && !rdv && doses.length === 0 && gateIssues.length === 0 && (
            <div>
              <Button variant="light" onClick={onFinished}>
                {t("visit.nextChild")}
              </Button>
            </div>
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
