import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
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

  it("danas u Beogradu posle ponoći UTC i dalje je prethodni datum kad treba", () => {
    expect(todayInBelgrade(new Date("2026-03-31T22:30:00.000Z"))).toBe("2026-04-01");
  });

  it("podsetnik prima 1 do 7", () => {
    expect(() => assertRemindDays(0)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(8)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(1)).not.toThrow();
  });
});
