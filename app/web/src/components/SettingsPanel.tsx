import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Group,
  List,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconDownload, IconTrash } from "@tabler/icons-react";
import { api, type AuthUser } from "../api";
import { setLocale, type Locale } from "../i18n";
import { todayCivilDate, weekdayNames } from "../format";

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

/** Vaccination-workflow parameters: weekly caps, horizon, closure days. */
function WorkflowPanel({ products }: { products: { id: string; label?: string }[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [scope, setScope] = useState("global");
  const [cells, setCells] = useState<Record<string, string>>({});
  const [horizon, setHorizon] = useState("");
  const [year, setYear] = useState(todayCivilDate().slice(0, 4));
  const [closures, setClosures] = useState<{ date: string; label: string; source: string }[]>([]);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);

  const days = weekdayNames(lang);
  // Matrix rows Monday-first; rule weekday is 0=Sunday..6=Saturday.
  const rows = [1, 2, 3, 4, 5, 6, 0];

  async function load(): Promise<void> {
    setErr("");
    try {
      const s = await api.scheduling();
      const map: Record<string, string> = {};
      for (const r of s.rules) map[`${r.scope}|${r.weekday}|${r.slot}`] = String(r.cap);
      setCells(map);
      setHorizon(s.horizonDays === null ? "" : String(s.horizonDays));
      setClosures(await api.closures(year));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadClosures(): Promise<void> {
    try {
      setClosures(await api.closures(year));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(next?: Record<string, string>): Promise<void> {
    setErr("");
    setMsg("");
    setSaving(true);
    try {
      const rules: { scope: string; weekday: number; slot: "AM" | "PM"; cap: number }[] = [];
      for (const [key, v] of Object.entries(next ?? cells)) {
        if (v.trim() === "") continue;
        const [sc, wd, sl] = key.split("|");
        const cap = Number(v);
        if (!Number.isInteger(cap) || cap < 0) throw new Error(`Bad cap: ${v}`);
        rules.push({ scope: sc, weekday: Number(wd), slot: sl as "AM" | "PM", cap });
      }
      const h = horizon.trim() === "" ? null : Number(horizon);
      if (h !== null && (!Number.isInteger(h) || h <= 0)) throw new Error(`Bad horizon: ${horizon}`);
      await api.saveScheduling({ rules, horizonDays: h });
      setMsg(t("settings.saved"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  /** Delete every rule of the viewed scope, effective immediately. */
  async function clearScope(): Promise<void> {
    const kept = Object.fromEntries(Object.entries(cells).filter(([k]) => !k.startsWith(`${scope}|`)));
    setCells(kept);
    await save(kept);
  }

  // Read-only overview of everything stored, all scopes: proves what saved.
  const scopeLabel = (s: string): string =>
    s === "global" ? t("settings.scopeAll") : products.find((p) => p.id === s)?.label ?? s;
  const summary = (["global", ...products.map((p) => p.id)] as string[])
    .map((s) => {
      const parts: string[] = [];
      rows.forEach((w, i) => {
        const am = cells[`${s}|${w}|AM`]?.trim() ?? "";
        const pm = cells[`${s}|${w}|PM`]?.trim() ?? "";
        if (am === "" && pm === "") return;
        parts.push(`${days[i]}: ${am === "" ? "—" : `AM ${am}`}${pm === "" ? "" : `, PM ${pm}`}`);
      });
      return parts.length > 0 ? { scope: s, label: scopeLabel(s), text: parts.join(" · ") } : null;
    })
    .filter((s) => s !== null);

  async function add(): Promise<void> {
    if (!newDate || !newLabel.trim()) return;
    setErr("");
    try {
      await api.addClosure({ date: newDate, label: newLabel.trim() });
      setNewDate("");
      setNewLabel("");
      await reloadClosures();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function pull(): Promise<void> {
    setErr("");
    setMsg("");
    setPulling(true);
    try {
      const r = await api.pullClosures(Number(year));
      setMsg(t("settings.pulled", { n: r.added }));
      await reloadClosures();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(false);
    }
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        {t("settings.matrix")}
      </Text>
      <Text size="xs" c="dimmed">
        {t("settings.matrixHint")}
      </Text>
      <Select
        label={t("settings.scope")}
        aria-label={t("settings.scope")}
        value={scope}
        onChange={(v) => v && setScope(v)}
        data={[
          { value: "global", label: t("settings.scopeAll") },
          ...products.map((p) => ({ value: p.id, label: p.label ?? p.id })),
        ]}
      />
      <Table.ScrollContainer minWidth={300}>
        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th aria-label="day" />
              <Table.Th>AM</Table.Th>
              <Table.Th>PM</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="tabular">
            {rows.map((w, i) => (
              <Table.Tr key={w}>
                <Table.Td>{days[i]}</Table.Td>
                {(["AM", "PM"] as const).map((slot) => (
                  <Table.Td key={slot}>
                    <TextInput
                      aria-label={`${days[i]} ${slot}`}
                      type="number"
                      min={0}
                      autoComplete="off"
                      value={cells[`${scope}|${w}|${slot}`] ?? ""}
                      onChange={(e) =>
                        setCells((c) => ({ ...c, [`${scope}|${w}|${slot}`]: e.target.value }))
                      }
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <TextInput
        label={t("settings.horizon")}
        name="horizon"
        type="number"
        min={1}
        autoComplete="off"
        value={horizon}
        onChange={(e) => setHorizon(e.target.value)}
      />
      <div>
        <Group gap="xs" wrap="wrap">
          <Button onClick={() => void save()} loading={saving}>
            {t("settings.save")}
          </Button>
          <Button variant="subtle" color="red" onClick={() => void clearScope()} loading={saving}>
            {t("settings.clearScope")}
          </Button>
        </Group>
      </div>
      {summary.length > 0 && (
        <>
          <Text size="sm" fw={600}>
            {t("settings.rules")}
          </Text>
          <List size="sm" spacing={2}>
            {summary.map((s) => (
              <List.Item key={s!.scope} className="tabular">
                {s!.label}: {s!.text}
              </List.Item>
            ))}
          </List>
        </>
      )}
      {msg && <Alert color="teal" icon={<IconCheck size={16} aria-hidden="true" />} title={msg} />}
      {err && <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />}

      <Text size="sm" fw={600} mt="sm">
        {t("settings.closures", { year })}
      </Text>
      <Group align="end" wrap="wrap">
        <TextInput
          label={t("settings.year")}
          name="closure-year"
          autoComplete="off"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{ maxWidth: 110 }}
        />
        <Button variant="light" onClick={() => void reloadClosures()}>
          {t("settings.show")}
        </Button>
        <Button
          variant="light"
          leftSection={<IconDownload size={15} aria-hidden="true" />}
          onClick={() => void pull()}
          loading={pulling}
        >
          {t("settings.pull")}
        </Button>
      </Group>
      {closures.length === 0 ? (
        <Text size="sm" c="dimmed">
          —
        </Text>
      ) : (
        <List size="sm" spacing={4}>
          {closures.map((c) => (
            <List.Item key={c.date} className="tabular">
              {c.date} · {c.label}{" "}
              <Text span size="xs" c="dimmed" translate="no">
                {c.source}
              </Text>{" "}
              <ActionIcon
                size="xs"
                color="red"
                variant="subtle"
                aria-label={`${t("common.remove")} — ${c.date}`}
                onClick={() =>
                  void api
                    .deleteClosure(c.date)
                    .then(() => reloadClosures())
                    .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                }
              >
                <IconTrash size={14} aria-hidden="true" />
              </ActionIcon>
            </List.Item>
          ))}
        </List>
      )}
      <Group align="end" wrap="wrap">
        <TextInput
          label={t("visit.date")}
          name="closure-date"
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />
        <TextInput
          label={t("settings.closureLabel")}
          name="closure-label"
          autoComplete="off"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <Button variant="light" onClick={() => void add()} disabled={!newDate || !newLabel.trim()}>
          {t("settings.add")}
        </Button>
      </Group>
    </Stack>
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
  const [products, setProducts] = useState<{ id: string; label?: string }[]>([]);

  useEffect(() => {
    if (active !== "workflow" || products.length > 0) return;
    void api
      .pack()
      .then((p) => setProducts(p.productGroups.map((g) => ({ id: g.id, label: g.label_fr ?? undefined }))))
      .catch(() => setProducts([]));
  }, [active, products.length]);

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
          {active === "workflow" && <WorkflowPanel products={products} />}
          {active === "administration" && <AdminPanel pack={pack} />}
        </Stack>
      </Card>
    </Stack>
  );
}
