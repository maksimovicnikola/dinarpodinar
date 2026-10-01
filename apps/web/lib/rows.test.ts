import { describe, expect, it } from "vitest";
import { canManage, majorToMinor, toCategorySnapshot, toEntrySnapshot } from "./rows";

describe("rows", () => {
  it("preslikava kategoriju i unos u domenske tipove", () => {
    expect(
      toCategorySnapshot({ id: "c1", name: "Hrana", kind: "expense", limit_minor: 100000 }),
    ).toEqual({ id: "c1", name: "Hrana", kind: "expense", limitMinor: 100000 });
    expect(
      toEntrySnapshot({
        id: "e1",
        kind: "expense",
        amount_minor: 125000,
        category_id: "c1",
        person_id: "p1",
        person_name: "Ana",
        occurred_on: "2026-09-30",
      }),
    ).toEqual({
      id: "e1",
      kind: "expense",
      amountMinor: 125000,
      categoryId: "c1",
      personId: "p1",
      personName: "Ana",
      occurredOn: "2026-09-30",
    });
  });

  it("pretvara dinare sa zarezom u pare i odbija nulu", () => {
    expect(majorToMinor("12,50")).toBe(1250);
    expect(majorToMinor("4.200")).toBe(420000);
    expect(() => majorToMinor("0")).toThrow(/pozitivan/);
    expect(() => majorToMinor("-3")).toThrow(/pozitivan/);
  });

  it("samo vlasnik podešava", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("member")).toBe(false);
  });

  // -- Dodatni testovi: malformed i razlomljeni unosi --

  it("prihvata ceo broj bez decimala", () => {
    expect(majorToMinor("100")).toBe(10000);
    expect(majorToMinor("1")).toBe(100);
    expect(majorToMinor("1.000.000")).toBe(100000000);
  });

  it("prihvata jednu decimalnu cifru", () => {
    expect(majorToMinor("12,5")).toBe(1250);
    expect(majorToMinor("1,1")).toBe(110);
  });

  it("odbija više od dve decimalne cifre", () => {
    expect(() => majorToMinor("12,500")).toThrow(/pozitivan/);
    expect(() => majorToMinor("1,123")).toThrow(/pozitivan/);
  });

  it("odbija pogrešno grupisane hiljade", () => {
    expect(() => majorToMinor("4.20")).toThrow(/pozitivan/);    // 2 cifre u grupi
    expect(() => majorToMinor("1.2.345")).toThrow(/pozitivan/); // srednja grupa nije 3 cifre
    expect(() => majorToMinor("12.3456")).toThrow(/pozitivan/); // 4 cifre u grupi
  });

  it("odbija nenumerički unos", () => {
    expect(() => majorToMinor("abc")).toThrow(/pozitivan/);
    expect(() => majorToMinor("")).toThrow(/pozitivan/);
    expect(() => majorToMinor("12.50,00")).toThrow(/pozitivan/); // tačka posle zareza nije validna
  });

  it("odbija nulu i negativne vrednosti", () => {
    expect(() => majorToMinor("0")).toThrow(/pozitivan/);
    expect(() => majorToMinor("0,00")).toThrow(/pozitivan/);
    expect(() => majorToMinor("-3")).toThrow(/pozitivan/);
    expect(() => majorToMinor("-100,50")).toThrow(/pozitivan/);
  });

  it("odbija unos sa zarezom bez celobrojnog dela", () => {
    expect(() => majorToMinor(",50")).toThrow(/pozitivan/);
  });

  it("odbija unos sa zarezom bez decimalne vrednosti", () => {
    expect(() => majorToMinor("100,")).toThrow(/pozitivan/);
  });

  it("odbija višestruke zareze", () => {
    expect(() => majorToMinor("1,23,45")).toThrow(/pozitivan/);
  });

  it("canManage je zatvoreno – samo tačno 'owner' vraća true", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("member")).toBe(false);
    expect(canManage("admin")).toBe(false);
    expect(canManage("Owner")).toBe(false);
    expect(canManage("OWNER")).toBe(false);
    expect(canManage("")).toBe(false);
  });
});
