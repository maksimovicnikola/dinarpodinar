import { describe, expect, it } from "vitest";

import { loginErrorPath, planCallback } from "./auth-callback";

function plan(query: string) {
  return planCallback(new URL(`http://dinar.primer.rs/auth/callback${query}`).searchParams);
}

describe("planCallback", () => {
  it("razmenjuje kod i vodi na početnu kad nema `next`", () => {
    expect(plan("?code=abc123")).toEqual({ kind: "exchange", code: "abc123", next: "/" });
  });

  it("pamti sigurno odredište", () => {
    expect(plan("?code=abc123&next=%2Fpoziv%2F0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22")).toEqual({
      kind: "exchange",
      code: "abc123",
      next: "/poziv/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    });
  });

  it("odbacuje zlonamerno odredište i pada na početnu, ali kod ipak razmenjuje", () => {
    for (const hostile of [
      "https%3A%2F%2Fzlonamerni.rs",
      "%2F%2Fzlonamerni.rs",
      "%2F%5Czlonamerni.rs",
      "%2Flogin",
      "%2Fauth%2Fcallback",
      "%2F..%2Fadmin",
    ]) {
      expect(plan(`?code=abc123&next=${hostile}`), hostile).toEqual({
        kind: "exchange",
        code: "abc123",
        next: "/",
      });
    }
  });

  it("prijavljuje grešku provajdera kroz `error`", () => {
    expect(plan("?error=access_denied")).toEqual({ kind: "fail", code: "link" });
  });

  it("prijavljuje grešku provajdera i kad dođe samo kao `error_description`", () => {
    expect(plan("?error_description=Email+link+is+invalid+or+has+expired")).toEqual({
      kind: "fail",
      code: "link",
    });
  });

  it("greška provajdera ima prednost nad kodom", () => {
    expect(plan("?code=abc123&error=access_denied")).toEqual({ kind: "fail", code: "link" });
  });

  it("prazna `error` vrednost se ne računa kao greška", () => {
    expect(plan("?error=&code=abc123")).toEqual({ kind: "exchange", code: "abc123", next: "/" });
    expect(plan("?error=&error_description=&code=abc123")).toEqual({
      kind: "exchange",
      code: "abc123",
      next: "/",
    });
  });

  it("traži kod", () => {
    expect(plan("")).toEqual({ kind: "fail", code: "bez-koda" });
    expect(plan("?next=%2Fnovo")).toEqual({ kind: "fail", code: "bez-koda" });
  });

  it("prazan i beli kod nisu kod", () => {
    expect(plan("?code=")).toEqual({ kind: "fail", code: "bez-koda" });
    expect(plan("?code=%20%20")).toEqual({ kind: "fail", code: "bez-koda" });
  });

  it("kod ide nepromenjen, bez skidanja razmaka", () => {
    const decision = plan("?code=abc%2F123%2B456%3D");
    expect(decision).toEqual({ kind: "exchange", code: "abc/123+456=", next: "/" });
  });
});

describe("loginErrorPath", () => {
  it("nosi samo kod, nikad tekst greške", () => {
    expect(loginErrorPath("bez-koda")).toBe("/login?greska=bez-koda");
    expect(loginErrorPath("razmena")).toBe("/login?greska=razmena");
    expect(loginErrorPath("link")).toBe("/login?greska=link");
    expect(loginErrorPath("kolacici")).toBe("/login?greska=kolacici");
  });

  it("putanja je relativna, pa preusmerenje ostaje na istom poreklu", () => {
    const origin = "https://dinar.primer.rs";
    expect(new URL(loginErrorPath("razmena"), origin).origin).toBe(origin);
  });
});
