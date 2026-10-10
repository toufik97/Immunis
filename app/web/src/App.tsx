import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActionIcon,
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Container,
  Group,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
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
  IconSearch,
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
import { api, type Child, type DuplicateChild } from "./api";
import { formatCivilDate, formatCount } from "./format";
import VisitPanel from "./components/VisitPanel";
import DateField from "./components/DateField";
import { SessionPanel, NoShowPanel, StockPanel } from "./components/Panels";
import "./styles.css";

type Tab = "visit" | "session" | "noshows" | "stock";
const TABS: Tab[] = ["visit", "session", "noshows", "stock"];

interface PackInfo {
  packId: string;
  version: string;
  status: string;
  clinicalApproval: string;
  productGroups: { id: string; label_fr?: string }[];
  programs: { id: string; label_fr?: string }[];
}

function readTabFromUrl(): Tab {
  try {
    const v = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (v && (TABS as string[]).includes(v)) return v;
  } catch {
    /* ignore */
  }
  return "visit";
}

function packBadgeColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "approved") return "teal";
  if (s === "draft") return "yellow";
  return "orange";
}

function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
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
  const [tab, setTab] = useState<Tab>(() => readTabFromUrl());
  const [pack, setPack] = useState<PackInfo | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Child[]>([]);
  const [child, setChild] = useState<Child | null>(null);
  const [reg, setReg] = useState({
    familyName: "",
    givenName: "",
    birthDate: "",
    fatherName: "",
    motherName: "",
    address: "",
    centreId: "CS01",
    firstVisitYear: "2026",
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateChild[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  const [net, setNet] = useState<{ state: "checking" | "online" | "offline"; pending: number }>({
    state: "checking",
    pending: 0,
  });

  const familyRef = useRef<HTMLInputElement>(null);
  const givenRef = useRef<HTMLInputElement>(null);
  const birthRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    applyLocale(i18n.language as Locale);
    api.pack().then(setPack).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [i18n.language]);

  // Keep tab in the URL so sessions are deep-linkable; listen to back/forward.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }, [tab]);

  useEffect(() => {
    const onPop = () => setTab(readTabFromUrl());
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

  async function search(): Promise<void> {
    if (!query.trim() || searching) return;
    setErr("");
    setSearching(true);
    try {
      setResults(await api.searchChildren(query.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  const familyMissing = submitAttempted && reg.familyName.trim() === "";
  const givenMissing = submitAttempted && reg.givenName.trim() === "";
  const birthMissing = submitAttempted && reg.birthDate === "";
  const regValid =
    reg.familyName.trim() !== "" && reg.givenName.trim() !== "" && reg.birthDate !== "";

  async function register(force = false): Promise<void> {
    setErr("");
    setSubmitAttempted(true);
    if (!regValid) {
      const msg = t("register.required");
      setErr(msg);
      if (reg.familyName.trim() === "") familyRef.current?.focus();
      else if (reg.givenName.trim() === "") givenRef.current?.focus();
      else birthRef.current?.focus();
      return;
    }
    setRegistering(true);
    try {
      const r = await api.registerChildDetailed({ ...reg, ...(force ? { force: true } : {}) });
      if (r.status === "duplicate") {
        setDuplicates(r.duplicates);
      } else {
        setDuplicates(null);
        setSubmitAttempted(false);
        setChild(r.child);
        setResults([]);
        void refreshNet();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  async function openChildById(id: string): Promise<void> {
    setErr("");
    try {
      const c = await api.child(id);
      setChild(c);
      setTab("visit");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
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
            <Tabs value={tab} onChange={(v) => v && setTab(v as Tab)} aria-label="tabs">
              <ScrollArea type="auto" offsetScrollbars={false}>
                <Tabs.List style={{ flexWrap: "nowrap" }}>
                  <Tabs.Tab value="visit" leftSection={<IconStethoscope size={14} aria-hidden="true" />}>
                    {t("nav.visit")}
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

              <Tabs value={tab} onChange={(v) => v && setTab(v as Tab)}>
                <Tabs.Panel value="visit">
                  <Stack gap="md">
                    <Card>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void search();
                        }}
                      >
                        <Group align="end" wrap="wrap">
                          <TextInput
                            label={t("search.button")}
                            placeholder={t("search.placeholder")}
                            name="search"
                            autoComplete="off"
                            type="search"
                            spellCheck={false}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            style={{ flex: 1, minWidth: 200 }}
                          />
                          <Button
                            type="submit"
                            loading={searching}
                            disabled={!query.trim()}
                            leftSection={<IconSearch size={15} aria-hidden="true" />}
                          >
                            {t("search.button")}
                          </Button>
                        </Group>
                      </form>
                      {results.length === 0 && query && !searching && (
                        <Text size="sm" c="dimmed" mt="sm">
                          {t("search.noresults")}
                        </Text>
                      )}
                      {results.length > 0 && (
                        <Stack gap="xs" mt="sm">
                          {results.map((c) => (
                            <Card key={c.id} withBorder shadow="none" padding="sm" radius="md">
                              <Group justify="space-between" wrap="wrap" className="min-w-0">
                                <Text size="sm" className="break-words tabular" style={{ flex: 1, minWidth: 0 }}>
                                  {c.givenName} {c.familyName} ·{" "}
                                  {t("child.birthDate", { date: formatCivilDate(c.birthDate, lang) })}{" "}
                                  {(c.localIds ?? [])
                                    .map((l) => t("child.localId", { value: l.value }))
                                    .join(" ")}
                                </Text>
                                <Button size="xs" variant="light" onClick={() => setChild(c)}>
                                  {t("child.select")}
                                </Button>
                              </Group>
                            </Card>
                          ))}
                        </Stack>
                      )}
                    </Card>

                    <Card>
                      <Title order={2} size="h4" mb="sm">
                        {t("register.title")}
                      </Title>
                      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                        <TextInput
                          ref={familyRef}
                          label={t("register.familyName")}
                          name="familyName"
                          autoComplete="family-name"
                          required
                          value={reg.familyName}
                          onChange={(e) => setReg({ ...reg, familyName: e.target.value })}
                          error={familyMissing ? t("register.required") : undefined}
                        />
                        <TextInput
                          ref={givenRef}
                          label={t("register.givenName")}
                          name="givenName"
                          autoComplete="given-name"
                          required
                          value={reg.givenName}
                          onChange={(e) => setReg({ ...reg, givenName: e.target.value })}
                          error={givenMissing ? t("register.required") : undefined}
                        />
                        <DateField
                          inputRef={birthRef}
                          label={t("register.birthDate")}
                          name="birthDate"
                          required
                          max={today()}
                          value={reg.birthDate}
                          onChange={(v) => setReg({ ...reg, birthDate: v })}
                          error={birthMissing ? t("register.required") : undefined}
                        />
                        <TextInput
                          label={t("register.fatherName")}
                          name="fatherName"
                          autoComplete="off"
                          value={reg.fatherName}
                          onChange={(e) => setReg({ ...reg, fatherName: e.target.value })}
                        />
                        <TextInput
                          label={t("register.motherName")}
                          name="motherName"
                          autoComplete="off"
                          value={reg.motherName}
                          onChange={(e) => setReg({ ...reg, motherName: e.target.value })}
                        />
                        <TextInput
                          label={t("register.address")}
                          name="address"
                          autoComplete="street-address"
                          value={reg.address}
                          onChange={(e) => setReg({ ...reg, address: e.target.value })}
                        />
                        <TextInput
                          label={t("register.centre")}
                          name="centreId"
                          autoComplete="off"
                          value={reg.centreId}
                          onChange={(e) => setReg({ ...reg, centreId: e.target.value })}
                        />
                        <TextInput
                          label={t("register.firstVisitYear")}
                          name="firstVisitYear"
                          autoComplete="off"
                          inputMode="numeric"
                          pattern="\d{4}"
                          value={reg.firstVisitYear}
                          onChange={(e) => setReg({ ...reg, firstVisitYear: e.target.value })}
                        />
                      </SimpleGrid>
                      <Group mt="md">
                        <Button
                          onClick={() => register(false)}
                          loading={registering}
                          leftSection={<IconUserPlus size={15} aria-hidden="true" />}
                        >
                          {t("register.add")}
                        </Button>
                      </Group>
                      {submitAttempted && !regValid && (
                        <Text size="sm" c="red" mt="xs" role="alert">
                          {t("register.required")}
                        </Text>
                      )}
                      {duplicates && duplicates.length > 0 && (
                        <Alert color="red" mt="md" title={t("register.duplicate")}>
                          <Stack gap="xs" mt="xs">
                            {duplicates.map((c) => (
                              <Group key={c.id} justify="space-between" wrap="wrap">
                                <Text size="sm" className="tabular">
                                  {c.givenName} {c.familyName} ·{" "}
                                  {t("child.birthDate", { date: formatCivilDate(c.birthDate, lang) })}
                                </Text>
                                <Button
                                  size="xs"
                                  variant="light"
                                  onClick={() => {
                                    setChild(c);
                                    setDuplicates(null);
                                  }}
                                >
                                  {t("child.select")}
                                </Button>
                              </Group>
                            ))}
                            <Group>
                              <Button size="xs" color="red" onClick={() => register(true)} loading={registering}>
                                {t("register.force")}
                              </Button>
                              <Button size="xs" variant="default" onClick={() => setDuplicates(null)}>
                                {t("common.dismiss")}
                              </Button>
                            </Group>
                          </Stack>
                        </Alert>
                      )}
                    </Card>

                    {child && pack && (
                      <VisitPanel
                        key={child.id}
                        child={child}
                        products={pack.productGroups}
                        programs={pack.programs}
                        onDone={() => {
                          setChild({ ...child });
                          void refreshNet();
                        }}
                      />
                    )}
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="session">
                  <SessionPanel products={products} onOpen={(id) => void openChildById(id)} />
                </Tabs.Panel>
                <Tabs.Panel value="noshows">
                  <NoShowPanel products={products} onOpen={(id) => void openChildById(id)} />
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
