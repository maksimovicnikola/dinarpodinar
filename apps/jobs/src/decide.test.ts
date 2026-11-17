import { describe, expect, it } from "vitest";
import { occurrenceThisMonth, reminderOccurrences } from "./decide";

describe("reminderOccurrences", () => {
  it("dan 31 u februaru 2026 dospeva 28", () => {
    expect(occurrenceThisMonth("2026-02-01", 31)).toBe("2026-02-28");
  });

  it("podsetnik kreće pre dospeća i traje do kraja tog meseca", () => {
    expect(reminderOccurrences({ today: "2026-03-30", dayOfMonth: 31, remindDays: 1 })).toEqual([
      "2026-03-31",
    ]);
    expect(reminderOccurrences({ today: "2026-03-31", dayOfMonth: 31, remindDays: 1 })).toEqual([
      "2026-03-31",
    ]);
    expect(reminderOccurrences({ today: "2026-04-01", dayOfMonth: 31, remindDays: 1 })).toEqual([]);
  });

  it("neplaćeno dospeće ide ispred sledećeg podsetnika", () => {
    expect(reminderOccurrences({ today: "2026-03-30", dayOfMonth: 5, remindDays: 7 })).toEqual([
      "2026-03-05",
      "2026-04-05",
    ]);
  });

  it("godišnje pravilo se javlja samo oko svog meseca", () => {
    expect(
      reminderOccurrences({
        today: "2027-06-15",
        dayOfMonth: 15,
        remindDays: 1,
        cadence: "yearly",
        monthOfYear: 1,
      }),
    ).toEqual([]);
    expect(
      reminderOccurrences({
        today: "2026-12-30",
        dayOfMonth: 5,
        remindDays: 7,
        cadence: "yearly",
        monthOfYear: 1,
      }),
    ).toEqual(["2027-01-05"]);
    expect(
      reminderOccurrences({
        today: "2027-01-20",
        dayOfMonth: 15,
        remindDays: 1,
        cadence: "yearly",
        monthOfYear: 1,
      }),
    ).toEqual(["2027-01-15"]);
  });

  it("29. februar u neprestupnoj godini dospeva 28", () => {
    expect(
      reminderOccurrences({
        today: "2027-02-28",
        dayOfMonth: 29,
        remindDays: 1,
        cadence: "yearly",
        monthOfYear: 2,
      }),
    ).toEqual(["2027-02-28"]);
  });
});
