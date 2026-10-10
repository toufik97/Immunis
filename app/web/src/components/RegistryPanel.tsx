import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconSearch, IconUserPlus } from "@tabler/icons-react";
import { api, type Child, type DuplicateChild } from "../api";
import { formatCivilDate, todayCivilDate } from "../format";
import DateField from "./DateField";

/** Registry: find children, register newborns, hand off to Today for recording. */
export default function RegistryPanel({ onSelect }: { onSelect: (child: Child) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Child[]>([]);
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

  const familyRef = useRef<HTMLInputElement>(null);
  const givenRef = useRef<HTMLInputElement>(null);
  const birthRef = useRef<HTMLInputElement>(null);

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
        setResults([]);
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
      <div aria-live="polite">
        {err && (
          <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} title={err} />
        )}
      </div>
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
                  <Button size="xs" variant="light" onClick={() => onSelect(c)}>
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
            max={todayCivilDate()}
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
                      onSelect(c);
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
    </Stack>
  );
}
