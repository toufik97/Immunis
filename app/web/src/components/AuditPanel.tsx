import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@mantine/hooks";
import { Alert, Badge, Button, Card, Group, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { api } from "../api";
import { formatCivilDate, formatDateTime } from "../format";
import { centreTime } from "../centreTime";
import DateField from "./DateField";
import Pager, { PAGE_SIZE } from "./Pager";

type ActionRow = Awaited<ReturnType<typeof api.auditLog>>["rows"][number];
type OverrideRow = Awaited<ReturnType<typeof api.overrides>>[number];
type GrantRow = Awaited<ReturnType<typeof api.grantHistory>>[number];
type Queue = Awaited<ReturnType<typeof api.reviewQueue>>;

type SortKey = "created_at" | "username" | "action";

/** Audit trail: every change (who did what), waivers, and pass history. Admin and reader only. */
export default function AuditPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [err, setErr] = useState("");
  const [opage, setOpage] = useState(0);

  // Server-side filtered/sorted/paged action log (the table grows forever).
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [action, setAction] = useState("all");
  const [username, setUsername] = useState("");
  const [debouncedUser] = useDebouncedValue(username, 200);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [asc, setAsc] = useState(false);
  const [actionNames, setActionNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Centre zone for audit timestamps: silent UTC once read as "still the 25th".
  const [zone, setZone] = useState("UTC");

  useEffect(() => {
    let cancelled = false;
    void centreTime().then((t) => {
      if (!cancelled) setZone(t.zone);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, action, debouncedUser, from, to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .auditLog({
        q: debouncedQuery.trim() || undefined,
        action: action === "all" ? undefined : action,
        username: debouncedUser.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        sort: sortKey,
        order: asc ? "asc" : "desc",
        page,
        limit: PAGE_SIZE,
      })
      .then((r) => {
        if (!cancelled) {
          setActions(r.rows);
          setTotal(r.total);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, action, debouncedUser, from, to, sortKey, asc, page]);

  useEffect(() => {
    let cancelled = false;
    const base = Promise.all([api.overrides(), api.grantHistory(), api.auditActions()]);
    const withQueue = isAdmin
      ? Promise.all([base, api.reviewQueue().catch(() => null)])
      : Promise.all([base, Promise.resolve(null)]);
    void withQueue
      .then(([[o, g, a], q]) => {
        if (!cancelled) {
          setRows(o);
          setGrants(g);
          setActionNames(a);
          setQueue(q);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const opages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safeOpage = Math.min(opage, opages - 1);
  const pagedRows = rows.slice(safeOpage * PAGE_SIZE, safeOpage * PAGE_SIZE + PAGE_SIZE);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);

  function header(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <Table.Th aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
        <Button
          variant="transparent"
          size="compact-xs"
          px={0}
          aria-label={label}
          onClick={() => (active ? setAsc(!asc) : (setSortKey(key), setAsc(key !== "created_at")))}
        >
          {label} {active ? (asc ? "▲" : "▼") : ""}
        </Button>
      </Table.Th>
    );
  }

  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{t("audit.title")}</Title>
        {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        <Title order={3} size="h5">{t("audit.actions")}</Title>
        <Group align="end" wrap="wrap">
          <TextInput
            label={t("table.search")}
            placeholder={t("audit.searchHint")}
            aria-label={t("table.search")}
            name="auditSearch"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <Select
            label={t("audit.what")}
            aria-label={t("audit.what")}
            name="auditAction"
            searchable
            value={action}
            onChange={(v) => v && setAction(v)}
            data={[{ value: "all", label: t("table.all") }, ...actionNames.map((a) => ({ value: a, label: a }))]}
            style={{ minWidth: 160 }}
          />
          <TextInput
            label={t("audit.who")}
            aria-label={t("audit.who")}
            name="auditUser"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ maxWidth: 150 }}
          />
          <DateField label={t("audit.from")} name="auditFrom" value={from} onChange={setFrom} />
          <DateField label={t("audit.to")} name="auditTo" value={to} onChange={setTo} />
        </Group>
        {total === 0 && !loading ? (
          <Text size="sm" c="dimmed">{t("audit.empty")}</Text>
        ) : (
          <>
            <Table.ScrollContainer minWidth={720}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    {header("created_at", t("audit.when"))}
                    {header("username", t("audit.who"))}
                    {header("action", t("audit.what"))}
                    <Table.Th>{t("audit.detail")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="tabular">
                  {actions.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td>{formatDateTime(a.createdAt, lang, zone)}</Table.Td>
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
            <Pager page={safePage} total={total} onPage={setPage} />
          </>
        )}
        {isAdmin && (
          <>
            <Title order={3} size="h5">{t("correction.reviewQueue")}</Title>
            {!queue || (queue.flagged.length === 0 && queue.invalidated.length === 0) ? (
              <Text size="sm" c="dimmed">{t("correction.queueEmpty")}</Text>
            ) : (
              <Stack gap="xs">
                {(queue.flagged as { id: string; child_name: string; date: string; void_requested_by: string; void_request_reason: string }[]).length > 0 && (
                  <>
                    <Text size="sm" fw={600}>{t("correction.flaggedVisits")}</Text>
                    {(queue.flagged as { id: string; child_name: string; date: string; void_requested_by: string; void_request_reason: string }[]).map((f) => (
                      <Group key={f.id} gap="xs" wrap="wrap">
                        <Badge variant="light" color="yellow">{t("correction.statusFlagged")}</Badge>
                        <Text size="sm" className="tabular break-words">
                          {f.child_name} · {formatCivilDate(String(f.date), lang)} · {t("correction.by", { who: String(f.void_requested_by) })}
                        </Text>
                        <Text size="xs" c="dimmed" className="break-words">{String(f.void_request_reason)}</Text>
                      </Group>
                    ))}
                  </>
                )}
                {(queue.invalidated as { id: string; child_name: string; product_group_id: string; administered_on: string; invalidated_by: string; invalidated_reason: string }[]).length > 0 && (
                  <>
                    <Text size="sm" fw={600}>{t("correction.invalidatedDoses")}</Text>
                    {(queue.invalidated as { id: string; child_name: string; product_group_id: string; administered_on: string; invalidated_by: string; invalidated_reason: string }[]).map((d) => (
                      <Group key={d.id} gap="xs" wrap="wrap">
                        <Badge variant="light" color="red">{t("correction.statusInvalidated")}</Badge>
                        <Text size="sm" className="tabular break-words">
                          {d.child_name} · {String(d.product_group_id)} · {formatCivilDate(String(d.administered_on), lang)} · {t("correction.by", { who: String(d.invalidated_by) })}
                        </Text>
                        <Text size="xs" c="dimmed" className="break-words">{String(d.invalidated_reason)}</Text>
                      </Group>
                    ))}
                  </>
                )}
                <Text size="xs" c="dimmed">{t("correction.queueHint")}</Text>
              </Stack>
            )}
          </>
        )}
        <Title order={3} size="h5">{t("audit.overrides")}</Title>        {rows.length === 0 ? (
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
                      <Table.Td>{formatDateTime(r.createdAt, lang, zone)}</Table.Td>
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
