import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Card,
  Container,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCalendarCheck,
  IconMoon,
  IconPackages,
  IconShieldCheck,
  IconStethoscope,
  IconSun,
  IconUserExclamation,
  IconUserPlus,
  IconWifi,
  IconWifiOff,
} from "@tabler/icons-react";
import "./i18n";
import { applyLocale, type Locale } from "./i18n";
import { api, type Child } from "./api";
import { formatCount, todayCivilDate } from "./format";
import { isTab, resolveInitialTab, type Tab } from "./tabs";
import VisitPanel from "./components/VisitPanel";
import ChildSearch from "./components/ChildSearch";
import RegistryPanel from "./components/RegistryPanel";
import { SessionPanel, NoShowPanel, StockPanel } from "./components/Panels";
import "./styles.css";

type PackInfo = Awaited<ReturnType<typeof api.pack>>;

function readTabFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("tab");
  } catch {
    return null;
  }
}

function readStoredTab(): { tab: string | null; date: string | null } {
  try {
    const raw = localStorage.getItem("immunis-tab");
    if (!raw) return { tab: null, date: null };
    const v = JSON.parse(raw) as { tab?: unknown; date?: unknown };
    return {
      tab: typeof v.tab === "string" ? v.tab : null,
      date: typeof v.date === "string" ? v.date : null,
    };
  } catch {
    return { tab: null, date: null };
  }
}

function packBadgeColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "approved") return "teal";
  if (s === "draft") return "yellow";
  return "orange";
}

function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setColorScheme(dark ? "light" : "dark")}
    >
      {dark ? <IconSun size={16} aria-hidden="true" /> : <IconMoon size={16} aria-hidden="true" />}
    </ActionIcon>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>(() => {
    const stored = readStoredTab();
    return resolveInitialTab(readTabFromUrl(), stored.tab, stored.date, todayCivilDate());
  });
  const [pack, setPack] = useState<PackInfo | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  // Expected products of the appointment the child was opened from (auto-fill).
  const [pendingExpected, setPendingExpected] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [net, setNet] = useState<{ state: "checking" | "online" | "offline"; pending: number }>({
    state: "checking",
    pending: 0,
  });
  // Centre token for LAN/tailnet use (IMMUNIS_TOKEN server-side); kept in this browser only.
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem("immunis-token") ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    applyLocale(i18n.language as Locale);
    api.pack().then(setPack).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [i18n.language]);

  // Keep tab in the URL so sessions are deep-linkable; listen to back/forward.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
    try {
      localStorage.setItem("immunis-tab", JSON.stringify({ tab, date: todayCivilDate() }));
    } catch {
      /* private mode: tab memory lasts this session */
    }
  }, [tab]);

  useEffect(() => {
    const onPop = () => {
      const t = readTabFromUrl();
      if (isTab(t)) setTab(t);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function refreshNet(): Promise<void> {
    try {
      await api.health();
      const pending = await api.outbox();
      setNet({ state: "online", pending: pending.length });
    } catch {
      setNet({ state: "offline", pending: 0 });
    }
  }

  useEffect(() => {
    void refreshNet();
  }, [tab]);

  async function openChildById(id: string, expectedProducts: string[] = []): Promise<void> {
    setErr("");
    try {
      const c = await api.child(id);
      setChild(c);
      setPendingExpected(expectedProducts);
      setTab("today");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function handoffToToday(c: Child): void {
    setChild(c);
    setPendingExpected([]);
    setTab("today");
    void refreshNet();
  }

  const products = pack?.productGroups ?? [];
  const lang = i18n.language;

  return (
    <AppShell header={{ height: { base: 196, sm: 140 } }} padding="md">
      <a className="skip-link" href="#main">
        {lang === "fr" ? "Aller au contenu" : lang === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}
      </a>
      <AppShell.Header className="app-shell-header">
        <Container size={1100} h="100%" py="sm">
          <Stack gap={8}>
            <Group justify="space-between" align="center" wrap="wrap">
              <Group gap="sm" className="min-w-0">
                <IconShieldCheck size={26} aria-hidden="true" color="#0f766e" />
                <Title order={1} size="h3" className="break-words">
                  <span translate="no">Immunis</span>
                </Title>
                {pack && (
                  <Badge
                    color={packBadgeColor(pack.status)}
                    variant="light"
                    aria-label={t("app.pack", {
                      packId: pack.packId,
                      version: pack.version,
                      status: pack.status,
                      approval: pack.clinicalApproval,
                    })}
                  >
                    <span translate="no">
                      {pack.packId} v{pack.version}
                    </span>{" "}
                    · {pack.status} · {pack.clinicalApproval}
                  </Badge>
                )}
                {net.state === "checking" ? (
                  <Badge color="gray" variant="outline">{t("common.loading")}</Badge>
                ) : net.state === "online" ? (
                  <Badge color="teal" variant="light" leftSection={<IconWifi size={12} aria-hidden="true" />}>
                    {t("net.online")}
                    {net.pending > 0 ? ` · ${t("net.pending", { n: formatCount(net.pending, lang) })}` : ""}
                  </Badge>
                ) : (
                  <Badge color="red" variant="light" leftSection={<IconWifiOff size={12} aria-hidden="true" />}>
                    {t("net.offline")}
                  </Badge>
                )}
              </Group>
              <Group gap="xs" wrap="nowrap">
                <TextInput
                  aria-label={t("common.token")}
                  name="apiToken"
                  type="password"
                  autoComplete="off"
                  placeholder={t("common.token")}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    try {
                      localStorage.setItem("immunis-token", e.target.value);
                    } catch {
                      /* private mode: token lasts this session */
                    }
                  }}
                  style={{ maxWidth: 130 }}
                />
                <ColorSchemeToggle />
                <SegmentedControl
                  size="xs"
                  aria-label="Language"
                  value={lang}
                  onChange={(l) => {
                    void i18n.changeLanguage(l);
                    applyLocale(l as Locale);
                  }}
                  data={[
                    { label: "EN", value: "en" },
                    { label: "FR", value: "fr" },
                    { label: "AR", value: "ar" },
                  ]}
                />
              </Group>
            </Group>
            <Tabs value={tab} onChange={(v) => v && isTab(v) && setTab(v)} aria-label="tabs">
              <ScrollArea type="auto" offsetScrollbars={false}>
                <Tabs.List style={{ flexWrap: "nowrap" }}>
                  <Tabs.Tab value="today" leftSection={<IconStethoscope size={14} aria-hidden="true" />}>
                    {t("nav.today")}
                  </Tabs.Tab>
                  <Tabs.Tab value="registry" leftSection={<IconUserPlus size={14} aria-hidden="true" />}>
                    {t("nav.registry")}
                  </Tabs.Tab>
                  <Tabs.Tab value="session" leftSection={<IconCalendarCheck size={14} aria-hidden="true" />}>
                    {t("nav.session")}
                  </Tabs.Tab>
                  <Tabs.Tab value="noshows" leftSection={<IconUserExclamation size={14} aria-hidden="true" />}>
                    {t("nav.noshows")}
                  </Tabs.Tab>
                  <Tabs.Tab value="stock" leftSection={<IconPackages size={14} aria-hidden="true" />}>
                    {t("nav.stock")}
                  </Tabs.Tab>
                </Tabs.List>
              </ScrollArea>
            </Tabs>
          </Stack>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <main id="main">
          <Container size={1100}>
            <Stack gap="md">
              <div aria-live="polite">
                {err && (
                  <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />
                )}
              </div>

              <Tabs value={tab} onChange={(v) => v && isTab(v) && setTab(v)}>
                <Tabs.Panel value="today">
                  {child && pack ? (
                    <VisitPanel
                      key={`${child.id}|${pendingExpected.join(",")}`}
                      child={child}
                      products={pack.productGroups}
                      programs={pack.programs}
                      expectedProducts={pendingExpected}
                      onDone={() => {
                        setChild({ ...child });
                        void refreshNet();
                      }}
                      onFinished={() => {
                        setChild(null);
                        setPendingExpected([]);
                        void refreshNet();
                      }}
                      onClose={() => {
                        setChild(null);
                        setPendingExpected([]);
                      }}
                    />
                  ) : (
                    <Card>
                      <Stack gap="sm">
                        <Text size="sm" c="dimmed">
                          {t("today.empty")}
                        </Text>
                        <ChildSearch onPick={handoffToToday} />
                      </Stack>
                    </Card>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="registry">
                  <RegistryPanel onSelect={handoffToToday} />
                </Tabs.Panel>
                <Tabs.Panel value="session">
                  <SessionPanel
                    products={products}
                    onOpen={(id, expected) => void openChildById(id, expected)}
                  />
                </Tabs.Panel>
                <Tabs.Panel value="noshows">
                  <NoShowPanel
                    products={products}
                    onOpen={(id, expected) => void openChildById(id, expected)}
                  />
                </Tabs.Panel>
                <Tabs.Panel value="stock">
                  <StockPanel products={products} />
                </Tabs.Panel>
              </Tabs>
            </Stack>
          </Container>
        </main>
      </AppShell.Main>
    </AppShell>
  );
}
