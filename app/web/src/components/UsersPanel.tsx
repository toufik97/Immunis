import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { api, type AuthUser } from "../api";
import DateField from "./DateField";
import { todayCivilDate } from "../format";

/** Admin only: users + paper-transition passes. Nurses never see this tab. */
export default function UsersPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [grants, setGrants] = useState<{ id: string; userId: string; expiresAt: string }[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ username: "", fullName: "", role: "nurse", password: "" });
  const [resetPw, setResetPw] = useState<Record<string, string>>({});
  const [grantForm, setGrantForm] = useState({ userId: "", reason: "", expiresAt: "" });

  async function load(): Promise<void> {
    setErr("");
    try {
      setUsers(await api.users());
      setGrants(await api.transitionGrants());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const roleColor = (r: string): string => (r === "admin" ? "red" : r === "reader" ? "gray" : "teal");

  async function create(): Promise<void> {
    setErr("");
    setMsg("");
    try {
      await api.createUser(form);
      setForm({ username: "", fullName: "", role: "nurse", password: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{t("users.title")}</Title>
        {users.length === 0 ? (
          <Text size="sm" c="dimmed">—</Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("auth.username")}</Table.Th>
                  <Table.Th>{t("auth.fullName")}</Table.Th>
                  <Table.Th>{t("users.role")}</Table.Th>
                  <Table.Th>{t("users.active")}</Table.Th>
                  <Table.Th aria-label="actions" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="tabular">
                {users.map((u) => (
                  <Table.Tr key={u.id}>
                    <Table.Td className="break-words">{u.username}</Table.Td>
                    <Table.Td className="break-words">{u.fullName}</Table.Td>
                    <Table.Td>
                      <Badge color={roleColor(u.role)} variant="light">{t(`role.${u.role}`)}</Badge>
                    </Table.Td>
                    <Table.Td>{u.active ? t("users.active") : t("users.inactive")}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="wrap">
                        <Button
                          size="compact-xs"
                          variant="light"
                          onClick={() => void api.updateUser(u.id, { active: !u.active }).then(load).catch((e) => setErr(e instanceof Error ? e.message : String(e)))}
                        >
                          {u.active ? t("users.disable") : t("users.enable")}
                        </Button>
                      </Group>
                      <Group gap="xs" wrap="wrap" mt={4}>
                        <PasswordInput
                          aria-label={t("users.resetPassword")}
                          placeholder={t("users.resetPassword")}
                          name={`reset-${u.id}`}
                          autoComplete="new-password"
                          value={resetPw[u.id] ?? ""}
                          onChange={(e) => setResetPw((m) => ({ ...m, [u.id]: e.target.value }))}
                          style={{ maxWidth: 180 }}
                        />
                        <Button
                          size="compact-xs"
                          variant="default"
                          disabled={!(resetPw[u.id] ?? "").trim()}
                          onClick={() =>
                            void api
                              .updateUser(u.id, { password: (resetPw[u.id] ?? "").trim() })
                              .then(() => {
                                setResetPw((m) => ({ ...m, [u.id]: "" }));
                                setMsg(t("auth.changed"));
                                void load();
                              })
                              .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                          }
                        >
                          {t("users.apply")}
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Title order={3} size="h5">{t("users.create")}</Title>
        <Group align="end" wrap="wrap">
          <TextInput label={t("auth.username")} name="nu-username" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextInput label={t("auth.fullName")} name="nu-fullname" autoComplete="off" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Select
            label={t("users.role")}
            name="nu-role"
            value={form.role}
            onChange={(v) => v && setForm({ ...form, role: v })}
            data={["nurse", "admin", "reader"].map((r) => ({ value: r, label: t(`role.${r}`) }))}
          />
          <PasswordInput label={t("auth.password")} name="nu-password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Button onClick={() => void create()}>{t("users.create")}</Button>
        </Group>
        <Title order={3} size="h5">{t("users.grantTitle")}</Title>
        {grants.length > 0 && (
          <Stack gap="xs">
            {grants.map((g) => (
              <Group key={g.id} justify="space-between" wrap="wrap">
                <Text size="sm" className="tabular">
                  {users.find((u) => u.id === g.userId)?.username ?? g.userId} · {g.expiresAt}
                </Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  color="red"
                  onClick={() => void api.revokeGrant(g.id).then(load).catch((e) => setErr(e instanceof Error ? e.message : String(e)))}
                >
                  {t("users.revoke")}
                </Button>
              </Group>
            ))}
          </Stack>
        )}
        <Group align="end" wrap="wrap">
          <Select
            label={t("auth.username")}
            name="grant-user"
            searchable
            value={grantForm.userId}
            onChange={(v) => v && setGrantForm({ ...grantForm, userId: v })}
            data={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.username }))}
            style={{ minWidth: 160 }}
          />
          <TextInput label={t("users.grantReason")} name="grant-reason" autoComplete="off" value={grantForm.reason} onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
          <DateField label={t("users.grantExpires")} name="grant-expires" value={grantForm.expiresAt} min={todayCivilDate()} onChange={(v) => setGrantForm({ ...grantForm, expiresAt: v })} />
          <Button
            disabled={!grantForm.userId || !grantForm.reason.trim() || !grantForm.expiresAt}
            onClick={() =>
              void api
                .grantTransition(grantForm)
                .then(() => {
                  setGrantForm({ userId: "", reason: "", expiresAt: "" });
                  void load();
                })
                .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
            }
          >
            {t("users.grant")}
          </Button>
        </Group>
        <div aria-live="polite">
          {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
          {msg && <Alert color="teal" icon={<IconCheck size={16} aria-hidden="true" />} title={msg} />}
        </div>
      </Stack>
    </Card>
  );
}
