import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@mantine/hooks";
import { Badge, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { api, type Child } from "../api";
import { formatCivilDate } from "../format";

/** Quick child picker: same client-side filter as the registry, top hits only. */
export default function ChildSearch({ onPick }: { onPick: (child: Child) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [children, setChildren] = useState<Child[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);

  useEffect(() => {
    void api.allChildren().then(setChildren).catch(() => setChildren([]));
  }, []);

  const q = debouncedQuery.trim().toLowerCase();
  const hits = children
    .filter(
      (c) =>
        q &&
        (`${c.givenName} ${c.familyName}`.toLowerCase().includes(q) ||
          (c.localIds ?? []).some((l) => l.value.toLowerCase().includes(q)) ||
          (c.address ?? "").toLowerCase().includes(q))
    )
    .slice(0, 8);

  return (
    <Stack gap="sm">
      <TextInput
        label={t("today.search")}
        placeholder={t("table.search")}
        aria-label={t("today.search")}
        name="todaySearch"
        type="search"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits.length > 0) {
            e.preventDefault();
            onPick(hits[0]);
          }
        }}
      />
      {q !== "" &&
        (hits.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("search.noresults")}
          </Text>
        ) : (
          <Stack gap="xs">
            {hits.map((c) => (
              <Group key={c.id} justify="space-between" wrap="wrap">
                <Text size="sm" className="break-words">
                  {c.givenName} {c.familyName} · {formatCivilDate(c.birthDate, lang)} ·{" "}
                  {(c.localIds ?? []).map((l) => l.value).join(" ") || "—"}
                </Text>
                <Group gap="xs">
                  {c.sex && (
                    <Badge variant="light" color={c.sex === "F" ? "pink" : "blue"}>
                      {t(`child.sex.${c.sex}`)}
                    </Badge>
                  )}
                  <Button size="compact-xs" variant="light" onClick={() => onPick(c)}>
                    {t("child.select")}
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        ))}
    </Stack>
  );
}
