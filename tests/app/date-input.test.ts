import { describe, it, expect } from "vitest";
import { autoSlashDate, checkDateBounds, isoToDisplay, parseDateInput } from "../../app/web/src/components/dateInput";

describe("date input (MA day-first entry)", () => {
  it("parses DD/MM/YYYY day-first", () => {
    expect(parseDateInput("05/12/2026")).toEqual({ status: "valid", iso: "2026-12-05" });
    expect(parseDateInput("5/2/2026")).toEqual({ status: "valid", iso: "2026-02-05" });
  });

  it("accepts dashes, dots and ISO as well", () => {
    expect(parseDateInput("05-12-2026")).toEqual({ status: "valid", iso: "2026-12-05" });
    expect(parseDateInput("05.12.2026")).toEqual({ status: "valid", iso: "2026-12-05" });
    expect(parseDateInput("2026-12-05")).toEqual({ status: "valid", iso: "2026-12-05" });
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateInput("31/02/2026").status).toBe("invalid");
    expect(parseDateInput("32/01/2026").status).toBe("invalid");
    expect(parseDateInput("13/13/2026").status).toBe("invalid");
    expect(parseDateInput("not a date").status).toBe("invalid");
  });

  it("stays quiet while typing, flags empty", () => {
    expect(parseDateInput("").status).toBe("empty");
    expect(parseDateInput("12/").status).toBe("partial");
    expect(parseDateInput("12/05/202").status).toBe("partial");
  });

  it("accepts 2-digit years with pivot 00-49 → 2000s, 50-99 → 1900s", () => {
    expect(parseDateInput("12/05/26")).toEqual({ status: "valid", iso: "2026-05-12" });
    expect(parseDateInput("5/2/49")).toEqual({ status: "valid", iso: "2049-02-05" });
    expect(parseDateInput("5/2/50")).toEqual({ status: "valid", iso: "1950-02-05" });
    expect(parseDateInput("12-05-26")).toEqual({ status: "valid", iso: "2026-05-12" });
    expect(parseDateInput("120526")).toEqual({ status: "valid", iso: "2026-05-12" });
    expect(parseDateInput("31/02/26").status).toBe("invalid");
  });

  it("auto-adds slashes to digit runs", () => {
    expect(autoSlashDate("12052026")).toBe("12/05/2026");
    expect(autoSlashDate("1205")).toBe("12/05");
    expect(autoSlashDate("120526")).toBe("12/05/26");
    expect(autoSlashDate("12/05")).toBe("12/05");
    expect(autoSlashDate("12/")).toBe("12/");
    expect(autoSlashDate("12/052")).toBe("12/05/2");
    expect(autoSlashDate("12/05/2026")).toBe("12/05/2026");
    expect(autoSlashDate("12/05/")).toBe("12/05/");
    expect(autoSlashDate("05-12-2026")).toBe("05/12/2026");
  });

  it("displays ISO as DD/MM/YYYY", () => {
    expect(isoToDisplay("2026-12-05")).toBe("05/12/2026");
    expect(isoToDisplay("")).toBe("");
  });

  it("flags out-of-range ISO dates for min/max bounds", () => {
    expect(checkDateBounds("2026-10-10", "2026-10-10", "2026-10-15")).toBe(null);
    expect(checkDateBounds("2026-10-09", "2026-10-10")).toBe("tooEarly");
    expect(checkDateBounds("2026-10-16", undefined, "2026-10-15")).toBe("tooLate");
    expect(checkDateBounds("2026-10-10")).toBe(null);
  });
});
