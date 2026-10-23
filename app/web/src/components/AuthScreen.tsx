import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Container, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { api, type AuthUser } from "../api";

/** Gate: login, first-admin bootstrap, forced password change. Nothing else renders before this passes. */
export default function AuthScreen({ onDone }: { onDone: (user: AuthUser) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"checking" | "login" | "bootstrap" | "change">("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .authStatus()
      .then((s) => setMode(s.needsBootstrap ? "bootstrap" : "login"))
      .catch(() => setMode("login"));
  }, []);

  async function doLogin(): Promise<void> {
    setErr("");
    setBusy(true);
    try {
      const r = await api.login(username.trim(), password);
      if (r.user.mustChangePassword) {
        setMode("change");
      } else {
        onDone(r.user);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setErr(/423|locked/.test(m) ? t("auth.locked") : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function doBootstrap(): Promise<void> {
    setErr("");
    setBusy(true);
    try {
      await api.bootstrap({ username: username.trim(), fullName: fullName.trim(), password });
      const r = await api.login(username.trim(), password);
      if (r.user.mustChangePassword) setMode("change");
      else onDone(r.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doChange(): Promise<void> {
    setErr("");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      const me = await api.me();
      onDone(me.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container size={420} py="xl">
      <Card>
        <Stack gap="sm">
          <Title order={2} size="h4">
            {t("auth.welcome")}
          </Title>
          {mode === "checking" && <Text size="sm" c="dimmed">{t("common.loading")}</Text>}
          {mode === "bootstrap" && (
            <>
              <Text size="sm" c="dimmed">{t("auth.first")}</Text>
              <TextInput label={t("auth.username")} name="su-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              <TextInput label={t("auth.fullName")} name="su-fullname" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <PasswordInput label={t("auth.password")} name="su-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button onClick={() => void doBootstrap()} loading={busy}>{t("auth.createAdmin")}</Button>
            </>
          )}
          {mode === "login" && (
            <>
              <TextInput label={t("auth.username")} name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void doLogin(); }} />
              <PasswordInput label={t("auth.password")} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void doLogin(); }} />
              <Button onClick={() => void doLogin()} loading={busy}>{t("auth.login")}</Button>
            </>
          )}
          {mode === "change" && (
            <>
              <Text size="sm" c="dimmed">{t("auth.changeRequired")}</Text>
              <PasswordInput label={t("auth.currentPassword")} name="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <PasswordInput label={t("auth.newPassword")} name="new-password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              <Button onClick={() => void doChange()} loading={busy}>{t("auth.login")}</Button>
            </>
          )}
          {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
        </Stack>
      </Card>
    </Container>
  );
}
