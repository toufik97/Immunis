import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconUserPlus } from "@tabler/icons-react";
import { api, type Child, type DuplicateChild } from "../api";
import { formatCivilDate, todayCivilDate } from "../format";
import DateField from "./DateField";
import Pager, { PAGE_SIZE } from "./Pager";

type SortKey = "name" | "birthDate";

/** Registry: browse every child (search/sort), register newborns via popup. */
export default function RegistryPanel({ onSelect }: { onSelect: (child: Child) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState(false);
  const [reg, setReg] = useState({
    familyName: "",
    givenName: "",
    birthDate: "",
    sex: "",
    fatherName: "",
    motherName: "",
    address: "",
    centreId: "CS01",
    firstVisitYear: "2026",
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateChild[] | null>(null);
  const [registering, setRegistering] = useState(false);
  const [err, setErr] = useState("");

  const familyRef = useRef<HTMLInputElement>(null);
  const givenRef = useRef<HTMLInputElement>(null);
  const birthRef = useRef<HTMLInputElement>(null);

  async function load(): Promise<void> {
    setErr("");
    setLoading(true);
    try {
      setChildren(await api.allChildren());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = debouncedQuery.trim().toLowerCase();
  const shown = children
    .filter(
      (c) =>
        !q ||
        `${c.givenName} ${c.familyName}`.toLowerCase().includes(q) ||
        (c.localIds ?? []).some((l) => l.value.toLowerCase().includes(q)) ||
        (c.address ?? "").toLowerCase().includes(q)
    )
    .sort((a, b) => {
      const av = sortKey === "name" ? `${a.familyName} ${a.givenName}` : a.birthDate;
      const bv = sortKey === "name" ? `${b.familyName} ${b.givenName}` : b.birthDate;
      const cmp = av.localeCompare(bv);
      return asc ? cmp : -cmp;
    });

  // New filter or sort: back to the first page.
  useEffect(() => {
    setPage(0);
  }, [q, sortKey, asc, children.length]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const paged = shown.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function header(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <Table.Th aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
        <Button
          variant="transparent"
          size="compact-xs"
          px={0}
          aria-label={label}
          onClick={() => (active ? setAsc(!asc) : (setSortKey(key), setAsc(true)))}
        >
          {label} {active ? (asc ? "▲" : "▼") : ""}
        </Button>
      </Table.Th>
    );
  }

  const familyMissing = submitAttempted && reg.familyName.trim() === "";
  const givenMissing = submitAttempted && reg.givenName.trim() === "";
  const birthMissing = submitAttempted && reg.birthDate === "";
  const sexMissing = submitAttempted && reg.sex === "";
  const regValid =
    reg.familyName.trim() !== "" && reg.givenName.trim() !== "" && reg.birthDate !== "" && reg.sex !== "";

  function openModal(): void {
    setSubmitAttempted(false);
    setDuplicates(null);
    setErr("");
    setModal(true);
  }

  async function register(force = false): Promise<void> {
    setErr("");
    setSubmitAttempted(true);
    if (!regValid) {
      setErr(t("register.required"));
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
        setModal(false);
        await load();
        onSelect(r.child);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  }

  return (
    <Stack gap="md">
      <Card>
        <Group justify="space-between" wrap="wrap">
          <TextInput
            label={t("table.search")}
            placeholder={t("table.search")}
            aria-label={t("table.search")}
            name="registrySearch"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button onClick={openModal} leftSection={<IconUserPlus size={15} aria-hidden="true" />}>
            {t("register.add")}
          </Button>
        </Group>
        <div aria-live="polite">
          {err && !modal && (
            <Alert
              color="red"
              mt="sm"
              icon={<IconAlertCircle size={16} aria-hidden="true" />}
              title={err}
            />
          )}
        </div>
        {shown.length === 0 && !loading ? (
          <Text size="sm" c="dimmed" mt="sm">
            {t("search.noresults")}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560} mt="sm">
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  {header("name", t("table.name"))}
                  <Table.Th>{t("table.localId")}</Table.Th>
                  {header("birthDate", t("register.birthDate"))}
                  <Table.Th>{t("child.sex")}</Table.Th>
                  <Table.Th>{t("table.address")}</Table.Th>
                  <Table.Th aria-label="actions" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="tabular">
                {paged.map((c) => (
                  <Table.Tr key={c.id}>
                    <Table.Td className="break-words">
                      {c.givenName} {c.familyName}
                    </Table.Td>
                    <Table.Td className="break-words">
                      {(c.localIds ?? []).map((l) => l.value).join(" ") || "—"}
                    </Table.Td>
                    <Table.Td>{formatCivilDate(c.birthDate, lang)}</Table.Td>
                    <Table.Td>
                      {c.sex ? (
                        <Badge variant="light" size="sm" color={c.sex === "F" ? "pink" : "blue"}>
                          {t(`child.sex.${c.sex}`)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </Table.Td>
                    <Table.Td className="break-words">{c.address || "—"}</Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="light" onClick={() => onSelect(c)}>
                        {t("child.select")}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        <Pager page={safePage} total={shown.length} onPage={setPage} />
      </Card>

      <Modal opened={modal} onClose={() => setModal(false)} title={t("register.title")} size="lg">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
            max={todayCivilDate()}
            value={reg.birthDate}
            onChange={(v) => setReg({ ...reg, birthDate: v })}
            error={birthMissing ? t("register.required") : undefined}
          />
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {t("child.sex")} <span aria-hidden="true">*</span>
            </Text>
            <SegmentedControl
              name="sex"
              aria-label={t("child.sex")}
              value={reg.sex}
              onChange={(v) => setReg({ ...reg, sex: v })}
              data={[
                { label: t("child.sex.M"), value: "M" },
                { label: t("child.sex.F"), value: "F" },
              ]}
            />
            {sexMissing && (
              <Text size="xs" c="red" role="alert">
                {t("register.required")}
              </Text>
            )}
          </Stack>
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
        <div aria-live="polite">
          {err && (
            <Alert
              color="red"
              mt="sm"
              icon={<IconAlertCircle size={16} aria-hidden="true" />}
              title={err}
            />
          )}
        </div>
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
                      onSelect(c);
                      setDuplicates(null);
                      setModal(false);
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
      </Modal>
    </Stack>
  );
}
