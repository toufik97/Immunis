import { useTranslation } from "react-i18next";
import {
  Accordion,
  Badge,
  Card,
  Group,
  Stack,
  Text,
  Timeline,
  Title,
} from "@mantine/core";
import type { EvaluateResult } from "../api";
import { formatCivilDate } from "../format";
import { formatEngineWarning } from "../engineWarnings";

interface Props {
  result: EvaluateResult;
  products: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
}

/** Engine bigger picture: plan first, needs folded below. Content unchanged. */
export default function EvalRail({ result, products, programs }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const productLabel = (id: string) => products.find((p) => p.id === id)?.label_fr ?? id;
  const programLabel = (id: string) => programs.find((p) => p.id === id)?.label_fr ?? id;
  const needColor = (s: string): string =>
    s === "COMPLETE" ? "teal" : s === "NOT_NEEDED" ? "gray" : s === "UNDETERMINED" ? "red" : "yellow";
  const visitColor = (s: string): string => (s === "DUE_NOW" ? "red" : s === "DUE_FUTURE" ? "teal" : "gray");

  const needs = result.antigenNeeds;
  const doneCount = needs.filter((n) => n.status === "COMPLETE").length;
  const dueCount = needs.filter((n) => n.status === "NEEDS_PRIMARY" || n.status === "NEEDS_BOOSTER").length;
  const visits = result.visitPlan.visits;
  const nextVisit = visits[0];
  const activeVisit = visits.findIndex((v) => v.status !== "DUE_NOW");
  const notes = [...result.visitPlan.warnings, ...(result.assumptions ?? []), ...(result.inputWarnings ?? [])];

  return (
    <Card>
      <Stack gap="sm">
        <Text size="sm" fw={600} className="tabular">
          {nextVisit
            ? t("visit.summary", { done: doneCount, due: dueCount, date: formatCivilDate(nextVisit.date, lang) })
            : t("visit.summaryNoNext", { done: doneCount, due: dueCount })}
        </Text>

        <Title order={3} size="h5">
          {t("visit.plan")}
        </Title>
        {visits.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("visit.node")}
          </Text>
        ) : (
          <Timeline active={activeVisit === -1 ? visits.length : activeVisit} bulletSize={22} lineWidth={2}>
            {visits.map((v, i) => (
              <Timeline.Item
                key={i}
                color={visitColor(v.status)}
                title={<span className="tabular">{formatCivilDate(v.date, lang)}</span>}
              >
                <Group gap={6} wrap="wrap" mt={4}>
                  {v.products.map((p) => (
                    <Badge key={p} size="sm" variant="light" color={visitColor(v.status)}>
                      {productLabel(p)}
                    </Badge>
                  ))}
                </Group>
                {(v.doses ?? []).length > 0 && (
                  <Text size="xs" c="dimmed" mt={4}>
                    {(v.doses ?? [])
                      .map(
                        (d) =>
                          `${programLabel(d.programId)} #${d.doseNumber}${d.amount ? ` · ${d.amount.value} ${d.amount.unit}` : ""}`
                      )
                      .join(" · ")}
                  </Text>
                )}
                <Text size="xs" c="dimmed" mt={2}>
                  {t(`planstatus.${v.status}`)}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}

        <Title order={3} size="h5">
          {t("visit.needs")}
        </Title>
        <Accordion variant="separated" radius="md">
          {needs.map((n) => {
            const total = n.validDosesReceived + n.dosesNeeded;
            const fraction =
              n.status === "NEEDS_PRIMARY" || n.status === "NEEDS_BOOSTER" || n.status === "COMPLETE"
                ? t("visit.doses", { received: n.validDosesReceived, total })
                : null;
            return (
              <Accordion.Item key={n.programId} value={n.programId}>
                <Accordion.Control>
                  <Group gap="xs" wrap="wrap">
                    <Badge color={needColor(n.status)}>{t(`need.${n.status}`)}</Badge>
                    <Text size="sm" fw={500}>
                      {programLabel(n.programId)}
                    </Text>
                    {fraction && (
                      <Text size="sm" c="dimmed" className="tabular">
                        {fraction}
                      </Text>
                    )}
                    {n.targetProduct && (
                      <Text size="xs" c="dimmed">
                        {t("visit.target", { product: productLabel(n.targetProduct) })}
                      </Text>
                    )}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={4}>
                    {n.matchedRuleId && (
                      <Text size="xs" c="dimmed">
                        {t("visit.rule", { rule: n.matchedRuleId })}
                      </Text>
                    )}
                    {n.warnings.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    ) : (
                      n.warnings.map((w, i) => (
                        <Text key={i} size="sm">
                          {formatEngineWarning(w, lang)}
                        </Text>
                      ))
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>

        {notes.length > 0 && (
          <Stack gap={2}>
            <Text size="xs" fw={600} c="dimmed">
              {t("visit.notes")}
            </Text>
            {notes.map((w, i) => (
              <Text key={i} size="xs" c="dimmed">
                {formatEngineWarning(w, lang)}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
