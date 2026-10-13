import { useTranslation } from "react-i18next";
import { Button, Group, Text } from "@mantine/core";

/** Small pager: 50 rows per page keeps big registries fluid. */
export const PAGE_SIZE = 50;

export default function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <Group justify="space-between" wrap="wrap">
      <Button size="compact-sm" variant="default" disabled={page === 0} onClick={() => onPage(page - 1)}>
        {t("table.prev")}
      </Button>
      <Text size="sm" c="dimmed" className="tabular">
        {t("table.page", { page: page + 1, pages })}
      </Text>
      <Button size="compact-sm" variant="default" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        {t("table.next")}
      </Button>
    </Group>
  );
}
