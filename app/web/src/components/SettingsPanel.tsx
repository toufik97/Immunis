import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconDownload } from "@tabler/icons-react";
import { api, type AuthUser } from "../api";
import { setLocale, type Locale } from "../i18n";
import { todayCivilDate } from "../format";

type Section = "preferences" | "user" | "workflow" | "administration";
type Role = AuthUser["role"];
type Pack = { packId: string; version: string; status: string } | null;

/** Settings subsections. New section = one entry here + one panel below. */
const SECTIONS: { id: Section; roles: Role[] }[] = [
  { id: "preferences", roles: ["nurse", "admin", "reader"] },
  { id: "user", roles: ["nurse", "admin", "reader"] },
  { id: "workflow", roles: ["nurse", "admin"] },
  { id: "administration", roles: ["admin"] },
];

/** Per-device display prefs: language + theme. Avatar/theme-packs land here later. */
function PreferencesPanel() {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("settings.language")}
      </Text>
      <div>
        <SegmentedControl
          aria-label={t("settings.language")}
          value={i18n.language}
          onChange={(l) => setLocale(l as Locale)}
          data={[
            { label: "EN", value: "en" },
            { label: "FR", value: "fr" },
            { label: "AR", value: "ar" },
          ]}
        />
      </div>
      <Text size="sm" c="dimmed">
        {t("settings.theme")}
      </Text>
      <div>
        <SegmentedControl
          aria-label={t("settings.theme")}
          value={colorScheme}
          onChange={(v) => setColorScheme(v as "light" | "dark")}
          data={[
            { label: "☀", value: "light" },
            { label: "☾", value: "dark" },
          ]}
        />
      </div>
    </Stack>
  );
}

/** Per-identity security: password now, avatar later (needs users migration + storage). */
function UserPanel() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function change(): Promise<void> {
    setErr("");
    setMsg("");
    setSaving(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setMsg(t("auth.changed"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm">
      <Title order={3} size="h5">
        {t("settings.account")}
      </Title>
      <PasswordInput
        label={t("auth.currentPassword")}
        name="current-password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <PasswordInput
        label={t("auth.newPassword")}
        name="new-password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <div>
        <Button onClick={() => void change()} loading={saving} disabled={!current || next.length < 8}>
          {t("settings.save")}
        </Button>
      </div>
      {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
      {msg && <Alert color="teal" icon={<IconCheck size={16} aria-hidden="true" />} title={msg} />}
    </Stack>
  );
}

/** Vaccination-workflow parameters. Appointment rules (weekdays × slots, closures, horizon) land here next. */
function WorkflowPanel() {
  const { t } = useTranslation();
  return (
    <Text size="sm" c="dimmed">
      {t("settings.workflowEmpty")}
    </Text>
  );
}

/** Centre administration: backup download + pack reference. */
function AdminPanel({ pack }: { pack: Pack }) {
  const { t } = useTranslation();
  const [err, setErr] = useState("");
  const [downloading, setDownloading] = useState(false);

  async function download(): Promise<void> {
    setErr("");
    setDownloading(true);
    try {
      const blob = await api.backup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `immunis-backup-${todayCivilDate()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Stack gap="sm">
      <Title order={3} size="h5">
        {t("settings.backup")}
      </Title>
      {pack && (
        <Text size="sm" c="dimmed" className="tabular">
          <span translate="no">
            {pack.packId} v{pack.version}
          </span>{" "}
          · {pack.status}
        </Text>
      )}
      <Text size="sm" c="dimmed">
        {t("settings.backupHint")}
      </Text>
      <div>
        <Button
          variant="light"
          leftSection={<IconDownload size={15} aria-hidden="true" />}
          onClick={() => void download()}
          loading={downloading}
        >
          {t("settings.download")}
        </Button>
      </div>
      {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}
    </Stack>
  );
}

/** Settings tab: Preferences / User / Workflow / Administration. Readers see prefs + account only. */
export default function SettingsPanel({ role, pack }: { role: Role; pack: Pack }) {
  const { t } = useTranslation();
  const visible = SECTIONS.filter((s) => s.roles.includes(role));
  const [section, setSection] = useState<Section>("preferences");
  const active = visible.some((s) => s.id === section) ? section : visible[0].id;

  return (
    <Stack gap="md">
      <div>
        <SegmentedControl
          size="xs"
          aria-label={t("settings.title")}
          value={active}
          onChange={(v) => setSection(v as Section)}
          data={visible.map((s) => ({ label: t(`settings.section.${s.id}`), value: s.id }))}
        />
      </div>
      <Card>
        <Stack gap="sm">
          <Title order={2} size="h4">
            {t("settings.title")} · {t(`settings.section.${active}`)}
          </Title>
          {active === "preferences" && <PreferencesPanel />}
          {active === "user" && <UserPanel />}
          {active === "workflow" && <WorkflowPanel />}
          {active === "administration" && <AdminPanel pack={pack} />}
        </Stack>
      </Card>
    </Stack>
  );
}
