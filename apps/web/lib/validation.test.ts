import { describe, expect, it } from "vitest";

import {
  isEmailLike,
  normalizeEmail,
  validateCurrency,
  validateDisplayName,
  validateEmail,
  validateHouseholdName,
} from "./validation";

describe("e-pošta", () => {
  it("svodi na mala slova i skida razmake", () => {
    expect(normalizeEmail("  Ana.Petrovic@Primer.RS  ")).toBe("ana.petrovic@primer.rs");
  });

  it("prihvata uobičajene adrese", () => {
    expect(isEmailLike("ana@primer.rs")).toBe(true);
    expect(isEmailLike("ana.petrovic+kuca@mail.primer.co.rs")).toBe(true);
    expect(isEmailLike("a@b.io")).toBe(true);
  });

  it("odbija adrese bez domena, bez nastavka i sa razmakom", () => {
    expect(isEmailLike("ana")).toBe(false);
    expect(isEmailLike("ana@")).toBe(false);
    expect(isEmailLike("ana@primer")).toBe(false);
    expect(isEmailLike("@primer.rs")).toBe(false);
    expect(isEmailLike("ana petrovic@primer.rs")).toBe(false);
    expect(isEmailLike("ana@@primer.rs")).toBe(false);
    expect(isEmailLike("ana..petrovic@primer.rs")).toBe(false);
    expect(isEmailLike("ana@primer..rs")).toBe(false);
    expect(isEmailLike("ana@-primer.rs")).toBe(false);
  });

  it("odbija predugačku adresu", () => {
    expect(isEmailLike(`${"a".repeat(250)}@primer.rs`)).toBe(false);
  });

  it("vraća očišćenu vrednost ili poruku", () => {
    expect(validateEmail("  Ana@Primer.RS ")).toEqual({ ok: true, value: "ana@primer.rs" });
    expect(validateEmail("   ")).toEqual({
      ok: false,
      message: "Unesite adresu e-pošte na koju šaljemo link za prijavu.",
    });
    expect(validateEmail("ana@primer")).toMatchObject({ ok: false });
  });
});

describe("ime za prikaz", () => {
  it("prihvata ime sa srpskim slovima i skida razmake", () => {
    expect(validateDisplayName("  Đorđe Šimić  ")).toEqual({ ok: true, value: "Đorđe Šimić" });
  });

  it("odbija prazno ime i ime od samih razmaka", () => {
    expect(validateDisplayName("")).toMatchObject({ ok: false });
    expect(validateDisplayName("   \t\n ")).toMatchObject({ ok: false });
  });

  it("odbija predugačko ime", () => {
    expect(validateDisplayName("a".repeat(81))).toMatchObject({ ok: false });
    expect(validateDisplayName("a".repeat(80))).toMatchObject({ ok: true });
  });
});

describe("naziv domaćinstva", () => {
  it("skida razmake i odbija prazan naziv", () => {
    expect(validateHouseholdName("  Naša kuća ")).toEqual({ ok: true, value: "Naša kuća" });
    expect(validateHouseholdName("    ")).toMatchObject({ ok: false });
  });

  it("odbija predugačak naziv", () => {
    expect(validateHouseholdName("k".repeat(81))).toMatchObject({ ok: false });
  });
});

describe("valuta", () => {
  it("svodi na velika slova", () => {
    expect(validateCurrency(" rsd ")).toEqual({ ok: true, value: "RSD" });
    expect(validateCurrency("eur")).toEqual({ ok: true, value: "EUR" });
  });

  it("odbija sve što ne prolazi bazinu proveru tri velika slova", () => {
    expect(validateCurrency("")).toMatchObject({ ok: false });
    expect(validateCurrency("RS")).toMatchObject({ ok: false });
    expect(validateCurrency("RSDD")).toMatchObject({ ok: false });
    expect(validateCurrency("R1D")).toMatchObject({ ok: false });
    expect(validateCurrency("din")).toMatchObject({ ok: true, value: "DIN" });
    expect(validateCurrency("Р С Д")).toMatchObject({ ok: false });
  });

  it("očišćena vrednost prolazi istu proveru kao u bazi", () => {
    const checked = validateCurrency("  rsd ");
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(/^[A-Z]{3}$/.test(checked.value)).toBe(true);
    }
  });
});
