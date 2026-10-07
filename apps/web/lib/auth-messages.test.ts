import { describe, expect, it } from "vitest";

import {
  createHouseholdErrorMessage,
  invitationErrorCode,
  invitationErrorMessage,
  loginErrorMessage,
  otpErrorMessage,
} from "./auth-messages";

describe("loginErrorMessage", () => {
  it("nema poruke kad nema koda", () => {
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
  });

  it("prevodi poznate kodove", () => {
    expect(loginErrorMessage("bez-koda")).toMatch(/nije potpun/);
    expect(loginErrorMessage("razmena")).toMatch(/istekao/);
    expect(loginErrorMessage("link")).toMatch(/nije uspela/);
    expect(loginErrorMessage("kolacici")).toMatch(/kolačiće/);
  });

  it("nepoznat kod ne pada, nego traži novi link", () => {
    expect(loginErrorMessage("<script>")).toMatch(/novi link/);
  });
});

describe("otpErrorMessage", () => {
  it("prepoznaje ograničenje broja zahteva", () => {
    expect(otpErrorMessage("Email rate limit exceeded")).toMatch(/Sačekajte minut/);
    expect(otpErrorMessage("For security purposes, you can only request this after 48 seconds")).toMatch(
      /Sačekajte minut/,
    );
  });

  it("prepoznaje neispravnu adresu", () => {
    expect(otpErrorMessage("Unable to validate email address: invalid format")).toMatch(
      /ime@primer\.rs/,
    );
  });

  it("prepoznaje isključeno otvaranje naloga", () => {
    expect(otpErrorMessage("Signups not allowed for otp")).toMatch(/pozivnicu/);
  });

  it("prepoznaje prekid veze", () => {
    expect(otpErrorMessage("TypeError: Failed to fetch")).toMatch(/Nema veze sa serverom/);
  });

  it("za nepoznatu grešku daje poruku koja predlaže sledeći korak", () => {
    expect(otpErrorMessage("boom")).toMatch(/pokušajte ponovo/);
    expect(otpErrorMessage(null)).toMatch(/pokušajte ponovo/);
  });
});

describe("invitationErrorCode", () => {
  // Tekstovi su prepisani iz `accept_invitation` u migraciji.
  it("svodi poruke baze na kodove", () => {
    expect(invitationErrorCode("Pozivnica ne postoji")).toBe("nepostojeca");
    expect(invitationErrorCode("Pozivnica je već iskorišćena")).toBe("iskoriscena");
    expect(invitationErrorCode("Pozivnica je istekla")).toBe("istekla");
    expect(invitationErrorCode("Pozivnica je za drugu e-poštu")).toBe("druga-posta");
    expect(invitationErrorCode("Korisnik nema e-poštu registrovanu na nalogu")).toBe("bez-poste");
    expect(invitationErrorCode("Prijava je obavezna")).toBe("prijava");
  });

  it("radi i bez srpskih dijakritika", () => {
    expect(invitationErrorCode("Pozivnica je vec iskoriscena")).toBe("iskoriscena");
    expect(invitationErrorCode("Pozivnica je za drugu e-postu")).toBe("druga-posta");
    expect(invitationErrorCode("Korisnik nema e-postu registrovanu na nalogu")).toBe("bez-poste");
  });

  it("nepoznato ostaje nepoznato", () => {
    expect(invitationErrorCode("permission denied for table memberships")).toBe("nepoznato");
    expect(invitationErrorCode(null)).toBe("nepoznato");
    expect(invitationErrorCode("")).toBe("nepoznato");
  });

  it("svaki kod ima poruku", () => {
    const codes = [
      "token",
      "nepostojeca",
      "iskoriscena",
      "istekla",
      "druga-posta",
      "bez-poste",
      "prijava",
      "kolacici-pre",
      "kolacici",
      "nepoznato",
    ] as const;

    for (const code of codes) {
      expect(invitationErrorMessage(code), code).toBeTruthy();
    }
  });

  it("razdvaja pad kolačića pre i posle prihvatanja", () => {
    // Pozivnica je jednokratna, pa poruka mora da kaže da li je potrošena.
    expect(invitationErrorMessage("kolacici-pre")).toMatch(/nije iskorišćena/);
    expect(invitationErrorMessage("kolacici")).toMatch(/prihvaćena/);
    expect(invitationErrorMessage("kolacici-pre")).not.toBe(invitationErrorMessage("kolacici"));
  });

  it("bez koda nema poruke", () => {
    expect(invitationErrorMessage(null)).toBeNull();
    expect(invitationErrorMessage("")).toBeNull();
  });
});

describe("createHouseholdErrorMessage", () => {
  it("prepoznaje istekla prijavu", () => {
    expect(createHouseholdErrorMessage("Prijava je obavezna")).toMatch(/Prijavite se ponovo/);
    expect(createHouseholdErrorMessage("JWT expired")).toMatch(/Prijavite se ponovo/);
  });

  it("prepoznaje prekršena ograničenja naziva i valute", () => {
    expect(
      createHouseholdErrorMessage('new row violates check constraint "households_currency_check"'),
    ).toMatch(/tri slova/);
    expect(
      createHouseholdErrorMessage('new row violates check constraint "households_name_check"'),
    ).toMatch(/prazan/);
  });

  it("za nepoznatu grešku ne tvrdi da je domaćinstvo otvoreno", () => {
    expect(createHouseholdErrorMessage("boom")).toMatch(/nije otvoreno/);
    expect(createHouseholdErrorMessage(undefined)).toMatch(/nije otvoreno/);
  });
});
