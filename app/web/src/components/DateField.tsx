import { useEffect, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "@mantine/core";
import { autoSlashDate, isoToDisplay, parseDateInput } from "./dateInput";
import { formatCivilDate } from "../format";

interface DateFieldProps {
  label: string;
  name: string;
  /** ISO YYYY-MM-DD (or ""). */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Keyboard-first civil-date field for MA practice (JJ/MM/AAAA).
 * Native `type="date"` renders MM/DD/YYYY or DD/MM/YYYY depending on the
 * browser/OS locale and types poorly — this always shows DD/MM/YYYY,
 * auto-adds slashes while typing, and also accepts ISO YYYY-MM-DD.
 */
export default function DateField({
  label,
  name,
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  error,
  inputRef,
}: DateFieldProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [text, setText] = useState(() => isoToDisplay(value));
  const [localError, setLocalError] = useState("");
  const lastValue = useRef(value);

  // Sync when the ISO value changes from outside (suggestions, navigation).
  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      setText(isoToDisplay(value));
      setLocalError("");
    }
  }, [value]);

  function commit(raw: string): void {
    const parsed = parseDateInput(raw);
    if (parsed.status === "empty") {
      lastValue.current = "";
      setLocalError("");
      if (value !== "") onChange("");
      return;
    }
    if (parsed.status === "partial") {
      setLocalError("");
      return;
    }
    if (parsed.status === "invalid") {
      setLocalError(t("date.invalid"));
      return;
    }
    if (min && parsed.iso < min) {
      setLocalError(t("date.tooEarly", { date: formatCivilDate(min, lang) }));
      return;
    }
    if (max && parsed.iso > max) {
      setLocalError(t("date.tooLate", { date: formatCivilDate(max, lang) }));
      return;
    }
    setLocalError("");
    if (parsed.iso !== lastValue.current) {
      lastValue.current = parsed.iso;
      onChange(parsed.iso);
    }
  }

  return (
    <TextInput
      ref={inputRef}
      label={label}
      name={name}
      autoComplete="off"
      inputMode="numeric"
      required={required}
      disabled={disabled}
      placeholder={t("date.placeholder")}
      styles={{ input: { direction: "ltr" } }}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const next = raw.length < text.length ? raw : autoSlashDate(raw);
        setText(next);
        commit(next);
      }}
      onBlur={() => {
        const parsed = parseDateInput(text);
        if (parsed.status === "partial" || parsed.status === "invalid") {
          // Revert half-typed text so the display never disagrees with storage.
          setText(isoToDisplay(lastValue.current));
          setLocalError("");
        } else {
          commit(text);
        }
      }}
      error={error ? error : localError || undefined}
    />
  );
}
