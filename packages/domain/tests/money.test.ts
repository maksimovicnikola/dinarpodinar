import { describe, expect, it, vi } from "vitest";
import { assertPositiveMinor, formatMoney } from "../src/money";

describe("formatMoney", () => {
  it("piše cele dinare bez decimala", () => {
    expect(formatMoney(420000, "RSD")).toBe("4.200 RSD");
  });

  it("piše pare sa zarezom", () => {
    expect(formatMoney(420050, "RSD")).toBe("4.200,50 RSD");
  });

  it("piše negativan ostatak", () => {
    expect(formatMoney(-150, "RSD")).toBe("-1,50 RSD");
  });

  it("grupisanje hiljada je deterministično i bez locale zavisnosti", () => {
    const spy = vi.spyOn(Intl, "NumberFormat").mockImplementation(
      () =>
        ({
          format: () => "4,200",
        }) as unknown as Intl.NumberFormat,
    );
    try {
      expect(formatMoney(420000, "RSD")).toBe("4.200 RSD");
      expect(formatMoney(12345678900, "RSD")).toBe("123.456.789 RSD");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("assertPositiveMinor", () => {
  it("odbija nulu, minus i decimale", () => {
    expect(() => assertPositiveMinor(0)).toThrow(/pozitivan/);
    expect(() => assertPositiveMinor(-1)).toThrow(/pozitivan/);
    expect(() => assertPositiveMinor(1.5)).toThrow(/pozitivan/);
  });

  it("prima pozitivan ceo broj", () => {
    expect(() => assertPositiveMinor(1)).not.toThrow();
  });
});
