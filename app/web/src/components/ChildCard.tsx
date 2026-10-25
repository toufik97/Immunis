import { useTranslation } from "react-i18next";
import { ActionIcon, Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { Child } from "../api";
import { ageParts, formatCivilDate, todayCivilDate } from "../format";

/** Identity at a glance: who this record belongs to. No actions here. */
export default function ChildCard({ child, onClose }: { child: Child; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { y, m, d } = ageParts(child.birthDate, todayCivilDate());

  return (
    <Card>
      <Stack gap="xs">
        <Group justify="space-between" wrap="wrap">
          <Title order={2} size="h4" className="break-words">
            {child.givenName} {child.familyName}
          </Title>
          <Group gap="xs">
            {child.sex && (
              <Badge variant="light" color={child.sex === "F" ? "pink" : "blue"}>
                {t(`child.sex.${child.sex}`)}
              </Badge>
            )}
            <Badge variant="light" color="gray" className="tabular">
              {(child.localIds ?? []).map((l) => t("child.localId", { value: l.value })).join(" · ") || child.id}
            </Badge>
            <ActionIcon variant="subtle" aria-label={t("child.change")} onClick={onClose}>
              <IconX size={16} aria-hidden="true" />
            </ActionIcon>
          </Group>
        </Group>
        <Text size="sm" c="dimmed" className="tabular">
          {t("child.birthDate", { date: formatCivilDate(child.birthDate, lang) })} ·{" "}
          {y > 0 ? t("child.ageYMD", { y, m, d }) : m > 0 ? t("child.ageMD", { m, d }) : t("child.ageD", { d })}
        </Text>
        {([child.fatherName, child.motherName].filter(Boolean).length > 0 || child.address) && (
          <Text size="sm" c="dimmed">
            {[child.fatherName, child.motherName].filter(Boolean).join(" · ")}
            {child.address ? ` · ${child.address}` : ""}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
