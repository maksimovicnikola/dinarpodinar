import { expect, it } from "vitest";
import {
  addCalendarDays,
  assertDayOfMonth,
  assertRemindDays,
  clampDayOfMonth,
  formatMoney,
  growthFloorMinor,
  limitThresholds,
  monthKey,
  occurrenceDate,
  suggest,
  summarizeMonth,
  todayInBelgrade,
  type CategoryMonth,
  type CategorySnapshot,
  type EntryKind,
  type EntrySnapshot,
  type MonthSummary,
  type Suggestion,
} from "@finance/domain";

it("izvozi pravila koja klijenti dele preko @finance/domain", () => {
  expect(formatMoney(100, "RSD")).toBe("1 RSD");

  expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
  expect(occurrenceDate(2026, 2, 31)).toBe("2026-02-28");
  expect(addCalendarDays("2026-03-31", -1)).toBe("2026-03-30");
  expect(monthKey("2026-09-30")).toBe("2026-09");
  expect(todayInBelgrade(new Date("2026-03-31T22:30:00.000Z"))).toBe("2026-04-01");
  expect(() => assertDayOfMonth(31)).not.toThrow();
  expect(() => assertRemindDays(1)).not.toThrow();

  expect(growthFloorMinor("RSD")).toBe(100_000);
  expect(limitThresholds(80, 100)).toEqual([80]);

  const kind: EntryKind = "expense";
  const category: CategorySnapshot = {
    id: "c1",
    name: "Test",
    kind,
    limitMinor: null,
  };
  const entry: EntrySnapshot = {
    id: "e1",
    kind: "income",
    amountMinor: 100,
    categoryId: "c1",
    personId: "p1",
    personName: "Test",
    occurredOn: "2026-09-30",
  };

  const summary: MonthSummary = summarizeMonth({
    month: "2026-09",
    categories: [category],
    entries: [entry],
  });
  expect(summary.leftoverMinor).toBe(100);

  const categoryMonth: CategoryMonth | undefined = summary.categories.find((c) => c.categoryId === "c1");
  expect(categoryMonth?.entryCount).toBe(1);

  const suggestion: Suggestion = suggest({
    currency: "RSD",
    categories: [],
    current: [],
    previous: null,
  });
  expect(suggestion.sentence).toBe("Ovaj mesec je unutar limita.");
});
