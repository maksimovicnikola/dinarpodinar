import { expect, it } from "vitest";
import { formatMoney, limitThresholds, occurrenceDate, suggest, summarizeMonth } from "../src/index";

it("izvozi pravila koja klijenti dele", () => {
  expect(formatMoney(100, "RSD")).toBe("1 RSD");
  expect(occurrenceDate(2026, 2, 31)).toBe("2026-02-28");
  expect(limitThresholds(80, 100)).toEqual([80]);
  expect(
    summarizeMonth({ month: "2026-09", categories: [], entries: [] }).leftoverMinor,
  ).toBe(0);
  expect(
    suggest({ currency: "RSD", categories: [], current: [], previous: null }).sentence,
  ).toBe("Ovaj mesec je unutar limita.");
});
