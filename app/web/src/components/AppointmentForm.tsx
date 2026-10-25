import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  List,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import DateField from "./DateField";
import { api, type SchedulingIssue } from "../api";
import { formatCivilDate } from "../format";

export interface CombineTarget {
  date: string;
  products: string[];
}

interface Props {
  childId: string;
  /** Card title area (e.g. badges of the products being booked). */
  heading: ReactNode;
  /** Clinical reference line (e.g. engine recommendation). */
  referenceLine?: ReactNode;
  /** Fixed product list for this booking. */
  products: string[];
  /** Horizon anchor + suggestion start reference. */
  engineDate: string;
  /** Where the open-slot search starts (engine date for next visits, visit date for catch-ups). */
  suggestFrom: string;
  productLabel: (id: string) => string;
  /** Shown when the catch-up would land on the next visit's day: merge instead of two bookings. */
  combineTarget?: CombineTarget | null;
  onCombine?: () => void;
  skipLabel: string;
  onSkip: () => void;
  onBooked: () => void;
}

/** One bookable appointment: catch-up or next visit. Same gate, same audit, no duplication. */
export default function AppointmentForm({
  childId,
  heading,
  referenceLine,
  products,
  engineDate,
  suggestFrom,
  productLabel,
  combineTarget,
  onCombine,
  skipLabel,
  onSkip,
  onBooked,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState<"AM" | "PM">("AM");
  const [issues, setIssues] = useState<SchedulingIssue[]>([]);
  const [reason, setReason] = useState("");
  const [suggested, setSuggested] = useState<{ date: string; slot: "AM" | "PM" } | null>(null);
  const [fetched, setFetched] = useState<{ date: string; slot: "AM" | "PM" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const productsKey = [...products].sort().join(",");

  // Prefill the first open slot; nurse edits afterwards are never overwritten.
  useEffect(() => {
    let cancelled = false;
    setIssues([]);
    setReason("");
    void api
      .suggestSlot(suggestFrom, products, "AM")
      .then((s) => {
        if (cancelled) return;
        if (s) {
          setDate(s.date);
          setSlot(s.slot);
          setFetched(s);
          setSuggested(s.date !== engineDate || s.slot !== "AM" ? s : null);
        } else {
          setDate(engineDate);
          setSlot("AM");
          setFetched(null);
          setSuggested(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDate(engineDate);
          setSlot("AM");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsKey, suggestFrom]);

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

  async function confirm(override = false): Promise<void> {
    if (!date) return;
    setErr("");
    setSaving(true);
    try {
      await api.createAppointment({
        childId,
        dueDate: date,
        expectedProducts: products,
        slot,
        overrideReason: override ? reason || undefined : undefined,
        engineDate,
      });
      setIssues([]);
      setReason("");
      onBooked();
    } catch (e) {
      const iss = (e as Error & { issues?: SchedulingIssue[] }).issues;
      if (iss && iss.length > 0 && !override) setIssues(iss);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const canCombine =
    !!combineTarget && !!onCombine && !!fetched && fetched.date === combineTarget.date;

  return (
    <Stack gap="xs">
      <div>{heading}</div>
      {referenceLine}
      {suggested && (
        <Text size="xs" c="dimmed" className="tabular">
          {t("sched.suggestNote", { date: formatCivilDate(suggested.date, lang), slot: suggested.slot })}
        </Text>
      )}
      <Group gap={6} wrap="wrap" align="center">
        {products.map((p) => (
          <Badge key={p} size="sm" variant="light" color={p === products[0] ? "teal" : "gray"}>
            {productLabel(p)}
          </Badge>
        ))}
      </Group>
      <Group align="end" wrap="wrap">
        <DateField
          label={t("visit.nextRdv")}
          name={`rdvDate-${engineDate}`}
          value={date}
          min={suggestFrom}
          onChange={(v) => {
            setDate(v);
            setIssues([]);
            setSuggested(null);
          }}
        />
        <SegmentedControl
          size="xs"
          aria-label={t("visit.rdvSlot")}
          value={slot}
          onChange={(v) => {
            setSlot(v as "AM" | "PM");
            setIssues([]);
            setSuggested(null);
          }}
          data={[
            { label: "AM", value: "AM" },
            { label: "PM", value: "PM" },
          ]}
        />
        <Button onClick={() => void confirm()} loading={saving}>
          {t("visit.rdvConfirm")}
        </Button>
        {canCombine && (
          <Button variant="light" onClick={() => onCombine!()}>
            {t("visit.combine")}
          </Button>
        )}
        <Button variant="default" onClick={onSkip}>
          {skipLabel}
        </Button>
      </Group>
      {issues.length > 0 && (
        <Alert color="yellow" title={t("visit.gateTitle")}>
          <List size="sm" mt="xs">
            {issues.map((g, idx) => (
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
              name={`rdvOverrideReason-${engineDate}`}
              autoComplete="off"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div>
              <Button size="sm" color="yellow" onClick={() => void confirm(true)} loading={saving} disabled={!reason}>
                {t("visit.rdvOverride")}
              </Button>
            </div>
          </Stack>
        </Alert>
      )}
      {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
    </Stack>
  );
}
