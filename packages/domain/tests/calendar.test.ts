import { describe, expect, it, vi } from "vitest";
import {
  addCalendarDays,
  assertDayOfMonth,
  assertRemindDays,
  clampDayOfMonth,
  monthKey,
  occurrenceDate,
  todayInBelgrade,
} from "../src/calendar";

describe("calendar", () => {
  it("dan 31 u februaru 2026 postaje 28", () => {
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
    expect(occurrenceDate(2026, 2, 31)).toBe("2026-02-28");
  });

  it("dan 31 u prestupnom februaru postaje 29", () => {
    expect(occurrenceDate(2024, 2, 31)).toBe("2024-02-29");
  });

  it("podsetnik je dan pre dospeća", () => {
    expect(addCalendarDays("2026-03-31", -1)).toBe("2026-03-30");
  });

  it("mesec je YYYY-MM", () => {
    expect(monthKey("2026-09-30")).toBe("2026-09");
  });

  it("pre ponoći UTC u Beogradu je već sledeći dan", () => {
    expect(todayInBelgrade(new Date("2026-03-31T22:30:00.000Z"))).toBe("2026-04-01");
  });

  it("zimi važi UTC+1", () => {
    expect(todayInBelgrade(new Date("2026-01-15T23:30:00.000Z"))).toBe("2026-01-16");
  });

  it("todayInBelgrade sklapa YYYY-MM-DD iz formatToParts", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          format: () => "01.04.2026",
          formatToParts: () => [
            { type: "day", value: "01" },
            { type: "literal", value: "." },
            { type: "month", value: "04" },
            { type: "literal", value: "." },
            { type: "year", value: "2026" },
          ],
        }) as unknown as Intl.DateTimeFormat,
    );
    try {
      expect(todayInBelgrade(new Date("2026-03-31T22:30:00.000Z"))).toBe("2026-04-01");
    } finally {
      spy.mockRestore();
    }
  });

  it("dan u mesecu mora biti ceo broj od 1 do 31", () => {
    expect(() => assertDayOfMonth(0)).toThrow(/1 do 31/);
    expect(() => assertDayOfMonth(32)).toThrow(/1 do 31/);
    expect(() => assertDayOfMonth(1.5)).toThrow(/1 do 31/);
    expect(() => assertDayOfMonth(31)).not.toThrow();
  });

  it("occurrenceDate odbija nevažeći mesec", () => {
    expect(() => occurrenceDate(2026, 0, 15)).toThrow(/Mesec/);
    expect(() => occurrenceDate(2026, 13, 15)).toThrow(/Mesec/);
  });

  it("podsetnik prima 1 do 7", () => {
    expect(() => assertRemindDays(0)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(1.5)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(8)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(1)).not.toThrow();
    expect(() => assertRemindDays(7)).not.toThrow();
  });
});
