import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Card, Group, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { api } from "../api";
import { formatCivilDate, formatDateTime } from "../format";
import Pager, { PAGE_SIZE } from "./Pager";

type OverrideRow = Awaited<ReturnType<typeof api.overrides>>[number];
type GrantRow = Awaited<ReturnType<typeof api.grantHistory>>[number];

/** Audit trail: waivers + paper-transition rows and the pass lifecycle. Admin and reader only. */
export default function AuditPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    void Promise.all([api.overrides(), api.grantHistory()])
      .then(([o, g]) => {
        setRows(o);
        setGrants(g);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const paged = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{t("audit.title")}</Title>
        {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        <Title order={3} size="h5">{t("audit.overrides")}</Title>
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed">{t("audit.empty")}</Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={720}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("audit.when")}</Table.Th>
                    <Table.Th>{t("table.name")}</Table.Th>
                    <Table.Th>{t("visit.date")}</Table.Th>
                    <Table.Th>{t("audit.author")}</Table.Th>
                    <Table.Th>{t("audit.what")}</Table.Th>
                    <Table.Th>{t("audit.reason")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="tabular">
                  {paged.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td>{formatDateTime(r.createdAt, lang)}</Table.Td>
                      <Table.Td className="break-words">{r.childName}</Table.Td>
                      <Table.Td>{r.encounterDate ? formatCivilDate(r.encounterDate, lang) : "—"}</Table.Td>
                      <Table.Td className="break-words">{r.author}</Table.Td>
                      <Table.Td className="break-words">{r.what}</Table.Td>
                      <Table.Td className="break-words">{r.reason}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Pager page={safePage} total={rows.length} onPage={setPage} />
          </>
        )}
        <Title order={3} size="h5">{t("users.grantTitle")}</Title>
        {grants.length === 0 ? (
          <Text size="sm" c="dimmed">{t("audit.empty")}</Text>
        ) : (
          <Stack gap="xs">
            {grants.map((g) => (
              <Group key={g.id} gap="xs" wrap="wrap">
                <Badge variant="light" color={g.revokedAt ? "red" : "teal"}>
                  {g.revokedAt ? t("audit.revoked") : t("audit.active")}
                </Badge>
                <Text size="sm" className="tabular break-words">
                  {g.username} · {t("users.grantExpires")} {g.expiresAt} · {t("audit.by")} {g.grantedByName}
                </Text>
                <Text size="xs" c="dimmed" className="break-words">{g.reason}</Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
