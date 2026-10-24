import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Group, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
import { api } from "../api";
import { formatCivilDate, formatCount } from "../format";

type Indicator = "wfa" | "lhfa" | "bfa";
type Point = Awaited<ReturnType<typeof api.childGrowth>>["points"][number];
type Refs = Awaited<ReturnType<typeof api.childGrowth>>["refs"];

function bandOf(z: number | null): "low3" | "low2" | "ok" | "high2" | "high3" | null {
  if (z === null || !Number.isFinite(z)) return null;
  if (z < -3) return "low3";
  if (z < -2) return "low2";
  if (z <= 2) return "ok";
  if (z <= 3) return "high2";
  return "high3";
}

function interpKey(ind: Indicator, band: ReturnType<typeof bandOf>): string | null {
  if (!band) return null;
  if (band === "low3" || band === "low2" || band === "ok") return `growth.${ind}.${band}`;
  if (ind === "bfa") return `growth.bfa.${band}`;
  return `growth.${ind}.high`;
}

function bandColor(band: ReturnType<typeof bandOf>): string {
  if (band === "low3" || band === "high3") return "red";
  if (band === "low2") return "orange";
  if (band === "ok") return "teal";
  return "yellow";
}

const VALUE_OF: Record<Indicator, (p: Point) => number | null> = {
  wfa: (p) => p.weightKg,
  lhfa: (p) => p.heightCm,
  bfa: (p) => p.bmi,
};
const UNIT_OF: Record<Indicator, string> = { wfa: "kg", lhfa: "cm", bfa: "" };

function CurveChart({
  months,
  curves,
  points,
  unit,
}: {
  months: number[];
  curves: { neg2: number[]; med: number[]; pos2: number[] };
  points: { x: number; y: number; scored: boolean }[];
  unit: string;
}) {
  const W = 360;
  const H = 230;
  const padL = 42;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const xs = points.map((p) => p.x);
  const xMax = Math.max(12, Math.ceil(Math.max(0, ...xs, 0) / 6) * 6);
  const allY = [...curves.neg2, ...curves.pos2, ...points.map((p) => p.y)].filter(Number.isFinite);
  const lo = Math.min(...allY);
  const hi = Math.max(...allY);
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const X = (m: number): number => padL + (m / xMax) * (W - padL - padR);
  const Y = (v: number): number => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const line = (vals: number[]): string =>
    vals.map((v, m) => `${m === 0 ? "M" : "L"}${X(months[m]).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const band = `${line(curves.neg2)} ${curves.pos2
    .map((v, m) => `L${X(months[60 - m]).toFixed(1)},${Y(curves.pos2[60 - m]).toFixed(1)}`)
    .join(" ")} Z`;
  const ticks = Array.from({ length: Math.floor(xMax / 6) + 1 }, (_, i) => i * 6);
  const yTicks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * (i + 0.5)) / 4);

  return (
    <div dir="ltr" style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
        <path d={band} fill="var(--mantine-color-teal-0)" stroke="none" />
        <path d={line(curves.med)} fill="none" stroke="currentColor" strokeOpacity={0.4} strokeDasharray="4 3" strokeWidth={1} />
        {[curves.neg2, curves.pos2].map((vals, i) => (
          <path key={i} d={line(vals)} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />
        ))}
        {ticks.map((m) => (
          <g key={m}>
            <line x1={X(m)} y1={padT} x2={X(m)} y2={H - padB} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
            <text x={X(m)} y={H - 8} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.65}>
              {m}
            </text>
          </g>
        ))}
        {yTicks.map((v, i) => (
          <text key={i} x={padL - 4} y={Y(v) + 3} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.65}>
            {Math.round(v * 10) / 10}
            {i === yTicks.length - 1 ? ` ${unit}` : ""}
          </text>
        ))}
        {points.length > 0 && (
          <polyline
            points={points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}
            fill="none"
            stroke="var(--mantine-color-teal-6)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={X(p.x)}
            cy={Y(p.y)}
            r={4}
            fill={p.scored ? "var(--mantine-color-teal-6)" : "none"}
            stroke="var(--mantine-color-teal-6)"
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
}

/** Growth block: latest WHO words, carnet curve per measure, past measures. */
export default function GrowthPanel({
  childId,
  sex,
  refreshKey,
}: {
  childId: string;
  sex: string | null | undefined;
  refreshKey: unknown;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [points, setPoints] = useState<Point[]>([]);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [tab, setTab] = useState<Indicator>("wfa");

  useEffect(() => {
    let cancelled = false;
    void api
      .childGrowth(childId)
      .then((r) => {
        if (!cancelled) {
          setPoints(r.points);
          setRefs(r.refs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPoints([]);
          setRefs(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, refreshKey]);

  if (!sex) return null;
  const scored = points.filter((p) => p.z.wfa !== null || p.z.lhfa !== null || p.z.bfa !== null);
  const latest = [...points].reverse().find((p) => p.weightKg !== null || p.heightCm !== null) ?? null;
  const outOfRange = points.length > scored.length;

  const months = Array.from({ length: 61 }, (_, m) => m);
  const rows = [...points].reverse();
  const chartPoints = points
    .map((p) => ({ x: p.ageMonths, y: VALUE_OF[tab](p), scored: p.z[tab] !== null }))
    .filter((p) => p.y !== null) as { x: number; y: number; scored: boolean }[];

  return (
    <Stack gap="sm" mt="md">
      <Title order={3} size="h5">
        {t("growth.title")}
      </Title>
      {points.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("growth.nodata")}
        </Text>
      ) : (
        <>
          {latest && (
            <Group gap="xs" wrap="wrap">
              {(["wfa", "lhfa", "bfa"] as const).map((ind) => {
                const z = latest.z[ind];
                const band = bandOf(z);
                const key = interpKey(ind, band);
                const v = VALUE_OF[ind](latest);
                if (v === null) return null;
                return (
                  <Group key={ind} gap={6} wrap="nowrap">
                    <Text size="sm" className="tabular">
                      {t(`growth.${ind === "lhfa" ? "height" : ind === "bfa" ? "bmi" : "weight"}`)} {v}
                      {UNIT_OF[ind] ? ` ${UNIT_OF[ind]}` : ""}
                    </Text>
                    {key && (
                      <Badge size="sm" color={bandColor(band)} variant="light">
                        {t(key)}
                      </Badge>
                    )}
                  </Group>
                );
              })}
            </Group>
          )}
          {outOfRange && (
            <Text size="xs" c="dimmed">
              {t("growth.outOfRange")}
            </Text>
          )}
          <SegmentedControl
            size="xs"
            value={tab}
            onChange={(v) => setTab(v as Indicator)}
            data={[
              { label: t("growth.weight"), value: "wfa" },
              { label: t("growth.height"), value: "lhfa" },
              { label: t("growth.bmi"), value: "bfa" },
            ]}
          />
          {refs && chartPoints.length > 0 && (
            <CurveChart months={months} curves={refs[tab]} points={chartPoints} unit={UNIT_OF[tab]} />
          )}
          <Text size="xs" c="dimmed">
            {t("growth.bandHint")}
          </Text>
          <Table.ScrollContainer minWidth={420}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("visit.date")}</Table.Th>
                  <Table.Th>{t("growth.age")} (m)</Table.Th>
                  <Table.Th>{t("growth.value")}</Table.Th>
                  <Table.Th>z</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="tabular">
                {rows.map((p, i) => {
                  const v = VALUE_OF[tab](p);
                  const z = p.z[tab];
                  return (
                    <Table.Tr key={i}>
                      <Table.Td>{formatCivilDate(p.date, lang)}</Table.Td>
                      <Table.Td>{formatCount(Math.round(p.ageMonths * 10) / 10, lang)}</Table.Td>
                      <Table.Td>{v === null ? "—" : `${v}${UNIT_OF[tab] ? ` ${UNIT_OF[tab]}` : ""}`}</Table.Td>
                      <Table.Td>{z === null ? "—" : `${z > 0 ? "+" : ""}${(Math.round(z * 10) / 10).toFixed(1)}`}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </Stack>
  );
}
