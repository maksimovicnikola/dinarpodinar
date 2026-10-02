import { describe, expect, it } from "vitest";

import { dayLabel, monthTitle, shiftMonth } from "./format";

describe("monthTitle", () => {
  it("piše mesec velikim početnim slovom, bez tačke", () => {
    expect(monthTitle("2026-09")).toBe("Septembar 2026");
    expect(monthTitle("2027-01")).toBe("Januar 2027");
  });
});

describe("shiftMonth", () => {
  it("prelazi granicu godine", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
  });

  it("van prozora 1900–2999 nema suseda", () => {
    expect(shiftMonth("1900-01", -1)).toBeNull();
    expect(shiftMonth("2999-12", 1)).toBeNull();
  });
});

describe("dayLabel", () => {
  it("srpski zapis datuma bez vodećih nula", () => {
    expect(dayLabel("2026-09-05")).toBe("5.9.2026.");
  });
});
