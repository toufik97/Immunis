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

  it("auto-adds slashes to digit runs", () => {
    expect(autoSlashDate("12052026")).toBe("12/05/2026");
    expect(autoSlashDate("1205")).toBe("12/05");
    expect(autoSlashDate("05-12-2026")).toBe("05-12-2026");
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
