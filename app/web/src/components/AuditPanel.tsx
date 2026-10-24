import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Card, Group, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { api } from "../api";
import { formatCivilDate, formatDateTime } from "../format";
import Pager, { PAGE_SIZE } from "./Pager";

type ActionRow = Awaited<ReturnType<typeof api.auditLog>>[number];
type OverrideRow = Awaited<ReturnType<typeof api.overrides>>[number];
type GrantRow = Awaited<ReturnType<typeof api.grantHistory>>[number];

/** Audit trail: every change (who did what), waivers, and pass history. Admin and reader only. */
export default function AuditPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    void Promise.all([api.auditLog(), api.overrides(), api.grantHistory()])
      .then(([a, o, g]) => {
        setActions(a);
        setRows(o);
        setGrants(g);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const pages = Math.max(1, Math.ceil(actions.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pagedActions = actions.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const opages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const [opage, setOpage] = useState(0);
  const safeOpage = Math.min(opage, opages - 1);
  const pagedRows = rows.slice(safeOpage * PAGE_SIZE, safeOpage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{t("audit.title")}</Title>
        {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        <Title order={3} size="h5">{t("audit.actions")}</Title>
        {actions.length === 0 ? (
          <Text size="sm" c="dimmed">{t("audit.empty")}</Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={720}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("audit.when")}</Table.Th>
                    <Table.Th>{t("audit.who")}</Table.Th>
                    <Table.Th>{t("audit.what")}</Table.Th>
                    <Table.Th>{t("audit.detail")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="tabular">
                  {pagedActions.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td>{formatDateTime(a.createdAt, lang)}</Table.Td>
                      <Table.Td className="break-words">{a.username}</Table.Td>
                      <Table.Td className="break-words">
                        {t(`audit.action.${a.action}`, { defaultValue: a.action })}
                        {a.childName ? ` · ${a.childName}` : ""}
                      </Table.Td>
                      <Table.Td className="break-words">{a.details ?? "—"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Pager page={safePage} total={actions.length} onPage={setPage} />
          </>
        )}
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
                  {pagedRows.map((r) => (
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
            <Pager page={safeOpage} total={rows.length} onPage={setOpage} />
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
