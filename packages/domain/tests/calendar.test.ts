import { describe, expect, it, vi } from "vitest";
import {
  addCalendarDays,
  assertDayOfMonth,
  assertRemindDays,
  clampDayOfMonth,
  monthKey,
  occurrenceDate,
  occurrenceInMonth,
  recurrenceInMonth,
  recurrenceSummary,
  reminderOccurrences,
  repeatSchedule,
  todayInBelgrade,
  unpaidReminders,
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

  it("mesečno pravilo važi u svakom mesecu, godišnje samo u svom", () => {
    expect(recurrenceInMonth("monthly", null, 6)).toBe(true);
    expect(recurrenceInMonth("yearly", 1, 1)).toBe(true);
    expect(recurrenceInMonth("yearly", 1, 6)).toBe(false);
    expect(recurrenceInMonth("yearly", null, 1)).toBe(false);
  });

  it("dospeće u posmatranom mesecu postoji samo kad pravilo tu važi", () => {
    expect(occurrenceInMonth("2026-06", 15, "monthly", null)).toBe("2026-06-15");
    expect(occurrenceInMonth("2027-01", 15, "yearly", 1)).toBe("2027-01-15");
    expect(occurrenceInMonth("2027-06", 15, "yearly", 1)).toBeNull();
    expect(occurrenceInMonth("2027-02", 29, "yearly", 2)).toBe("2027-02-28");
    expect(occurrenceInMonth("2026-6", 15, "monthly", null)).toBeNull();
  });

  it("raspored godišnjeg pravila uzima mesec i dan, a 29. februar kaže 28", () => {
    expect(repeatSchedule("2026-01-15", "monthly")).toBe(
      "Ponavljaće se 15. u mesecu; u kraćem mesecu poslednjeg dana.",
    );
    expect(repeatSchedule("2026-01-15", "yearly")).toBe("Ponavljaće se 15. januara svake godine.");
    expect(repeatSchedule("2024-02-29", "yearly")).toBe(
      "Ponavljaće se 29. februara svake godine. U neprestupnoj godini to je 28. februar.",
    );
    expect(repeatSchedule("nije-datum", "yearly")).toBeNull();
  });

  it("natpis u podešavanjima ne nudi promenu učestalosti", () => {
    expect(recurrenceSummary({ cadence: "monthly", dayOfMonth: 15, monthOfYear: null })).toBe(
      "Svakog meseca, 15. Učestalost se ne menja.",
    );
    expect(recurrenceSummary({ cadence: "yearly", dayOfMonth: 15, monthOfYear: 1 })).toBe(
      "Svake godine, 15. januara. Učestalost se ne menja.",
    );
  });

  it("occurrenceDate odbija nevažeći mesec", () => {
    expect(() => occurrenceDate(2026, 0, 15)).toThrow(/Mesec/);
    expect(() => occurrenceDate(2026, 13, 15)).toThrow(/Mesec/);
  });

  it("neplaćeno dospeće ostaje u prozoru, uneto nestaje", () => {
    expect(reminderOccurrences({ today: "2026-03-17", dayOfMonth: 17, remindDays: 1 })).toEqual(["2026-03-17"]);
    expect(
      unpaidReminders(
        "2026-03-17",
        [{ id: "kirija", dayOfMonth: 17, remindDays: 1 }],
        new Set(["kirija:2026-03"]),
      ),
    ).toEqual([]);
    expect(
      unpaidReminders(
        "2026-03-17",
        [{ id: "kirija", dayOfMonth: 17, remindDays: 1 }],
        new Set(),
      ),
    ).toEqual([{ ruleId: "kirija", occurrence: "2026-03-17", month: "2026-03" }]);
  });

  it("podsetnik prima 1 do 7", () => {
    expect(() => assertRemindDays(0)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(1.5)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(8)).toThrow(/1 do 7/);
    expect(() => assertRemindDays(1)).not.toThrow();
    expect(() => assertRemindDays(7)).not.toThrow();
  });
});
