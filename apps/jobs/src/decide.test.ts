import { describe, expect, it } from "vitest";
import { dueActions, occurrenceThisMonth } from "./decide";

describe("dueActions", () => {
  it("dan 31 u februaru 2026 dospeva 28", () => {
    expect(occurrenceThisMonth("2026-02-01", 31)).toBe("2026-02-28");
  });

  it("šalje podsetnik na dan podsetnika i unos na dan dospeća", () => {
    expect(dueActions({
      today: "2026-03-30",
      dayOfMonth: 31,
      remindDays: 1,
      active: true,
      reminderSent: false,
      entryExists: false,
    })).toEqual(["remind"]);
    expect(dueActions({
      today: "2026-03-31",
      dayOfMonth: 31,
      remindDays: 1,
      active: true,
      reminderSent: true,
      entryExists: false,
    })).toEqual(["insert"]);
  });

  it("ponovljeni posao ne šalje drugi podsetnik i ne pravi drugi unos", () => {
    expect(dueActions({
      today: "2026-03-31",
      dayOfMonth: 31,
      remindDays: 1,
      active: true,
      reminderSent: true,
      entryExists: true,
    })).toEqual([]);
  });

  it("ugašeno pravilo ne radi ništa", () => {
    expect(dueActions({
      today: "2026-03-31",
      dayOfMonth: 31,
      remindDays: 1,
      active: false,
      reminderSent: false,
      entryExists: false,
    })).toEqual([]);
  });

  it("godišnje pravilo dospeva samo u svom mesecu", () => {
    expect(dueActions({
      today: "2027-06-15",
      dayOfMonth: 15,
      remindDays: 1,
      active: true,
      reminderSent: false,
      entryExists: false,
      cadence: "yearly",
      monthOfYear: 1,
    })).toEqual([]);
    expect(dueActions({
      today: "2027-01-14",
      dayOfMonth: 15,
      remindDays: 1,
      active: true,
      reminderSent: false,
      entryExists: false,
      cadence: "yearly",
      monthOfYear: 1,
    })).toEqual(["remind"]);
    expect(dueActions({
      today: "2027-01-15",
      dayOfMonth: 15,
      remindDays: 1,
      active: true,
      reminderSent: true,
      entryExists: false,
      cadence: "yearly",
      monthOfYear: 1,
    })).toEqual(["insert"]);
  });

  it("29. februar u neprestupnoj godini dospeva 28", () => {
    expect(dueActions({
      today: "2027-02-27",
      dayOfMonth: 29,
      remindDays: 1,
      active: true,
      reminderSent: false,
      entryExists: false,
      cadence: "yearly",
      monthOfYear: 2,
    })).toEqual(["remind"]);
    expect(dueActions({
      today: "2027-02-28",
      dayOfMonth: 29,
      remindDays: 1,
      active: true,
      reminderSent: true,
      entryExists: false,
      cadence: "yearly",
      monthOfYear: 2,
    })).toEqual(["insert"]);
    expect(dueActions({
      today: "2024-02-29",
      dayOfMonth: 29,
      remindDays: 1,
      active: true,
      reminderSent: true,
      entryExists: false,
      cadence: "yearly",
      monthOfYear: 2,
    })).toEqual(["insert"]);
  });

  it("kasni unos u istom mesecu i dalje ubaci jednom", () => {
    expect(dueActions({
      today: "2026-03-31",
      dayOfMonth: 30,
      remindDays: 1,
      active: true,
      reminderSent: true,
      entryExists: false,
    })).toEqual(["insert"]);
  });
});
