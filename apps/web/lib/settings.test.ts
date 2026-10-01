import { describe, expect, it } from "vitest";

import { majorToMinor } from "./rows";
import {
  BAD_ADDRESS,
  CATEGORY_GONE,
  LIMIT_EXPENSE_ONLY,
  OWNER_ONLY,
  OWNER_STAYS,
  SESSION_GONE,
  buildMembers,
  daysLeft,
  emptySettings,
  expiryLabel,
  invitationLink,
  invitationPath,
  minorToInput,
  pendingInvitations,
  settingsDone,
  settingsErrorMessage,
  settingsFailure,
  sortByName,
  validateCategoryKind,
  validateCategoryName,
  validateLimit,
  validateRule,
} from "./settings";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function message(result: { ok: boolean; message?: string }): string {
  return "message" in result && result.message ? result.message : "";
}

// ----------------------------------------------------------------
// Naziv i vrsta kategorije
// ----------------------------------------------------------------

describe("validateCategoryName", () => {
  it("skida razmake oko naziva", () => {
    expect(validateCategoryName("  Vrtić  ")).toEqual({ ok: true, value: "Vrtić" });
  });

  it("odbija prazan naziv i naziv od samih razmaka", () => {
    // Baza traži `char_length(btrim(name)) > 0`; ovde se to kaže rečenicom.
    expect(validateCategoryName("")).toEqual({ ok: false, message: "Unesite naziv kategorije." });
    expect(validateCategoryName("   \t ")).toEqual({
      ok: false,
      message: "Unesite naziv kategorije.",
    });
  });

  it("pušta tačno 80 znakova, odbija 81", () => {
    expect(validateCategoryName("a".repeat(80)).ok).toBe(true);

    const tooLong = validateCategoryName("a".repeat(81));
    expect(tooLong.ok).toBe(false);
    expect(message(tooLong)).toContain("80");
  });

  it("meri dužinu posle skidanja razmaka", () => {
    expect(validateCategoryName(`   ${"a".repeat(80)}   `).ok).toBe(true);
  });
});

describe("validateCategoryKind", () => {
  it("prima tačno dve vrednosti koje baza poznaje", () => {
    expect(validateCategoryKind("expense")).toEqual({ ok: true, value: "expense" });
    expect(validateCategoryKind("income")).toEqual({ ok: true, value: "income" });
  });

  it("odbija prazno, drugačije pisanje i izmišljenu vrstu", () => {
    for (const raw of ["", "Expense", "EXPENSE", " expense", "oba", "trošak"]) {
      expect(validateCategoryKind(raw).ok, raw).toBe(false);
    }
  });
});

// ----------------------------------------------------------------
// Limit
// ----------------------------------------------------------------

describe("validateLimit", () => {
  it("prazno polje uklanja limit i daje null, nikad nulu", () => {
    for (const raw of ["", "   ", "\t\n"]) {
      const parsed = validateLimit(raw);
      expect(parsed.ok, raw).toBe(true);
      expect(parsed.ok && parsed.value, raw).toBeNull();
      // Ovo je cela poenta grane: `0` bi bio limit prekoračen prvim dinarom.
      expect(parsed.ok && parsed.value, raw).not.toBe(0);
    }
  });

  it("prima srpski zapis iznosa", () => {
    expect(validateLimit("25.000")).toEqual({ ok: true, value: 2500000 });
    expect(validateLimit("1.500,50")).toEqual({ ok: true, value: 150050 });
    expect(validateLimit(" 900 ")).toEqual({ ok: true, value: 90000 });
  });

  it("odbija nulu, negativan i nebrojčan unos", () => {
    for (const raw of ["0", "0,00", "-5", "abc", "12,345", "1.00"]) {
      const parsed = validateLimit(raw);
      expect(parsed.ok, raw).toBe(false);
      expect(message(parsed), raw).toContain("pozitivan");
    }
  });
});

// ----------------------------------------------------------------
// Ponavljanje
// ----------------------------------------------------------------

const goodRule = { amount: "4.500", day: "15", remind: "3", active: true };

describe("validateRule", () => {
  it("prolazi ispravnu izmenu i nosi `active` dalje", () => {
    expect(validateRule(goodRule)).toEqual({
      ok: true,
      value: { amountMinor: 450000, dayOfMonth: 15, remindDays: 3, active: true },
    });

    const off = validateRule({ ...goodRule, active: false });
    expect(off.ok && off.value.active).toBe(false);
  });

  it("prima obe ivice dana i podsetnika", () => {
    expect(validateRule({ ...goodRule, day: "1" }).ok).toBe(true);
    expect(validateRule({ ...goodRule, day: "31" }).ok).toBe(true);
    expect(validateRule({ ...goodRule, remind: "1" }).ok).toBe(true);
    expect(validateRule({ ...goodRule, remind: "7" }).ok).toBe(true);
  });

  it("odbija dan van 1..31", () => {
    for (const day of ["0", "32", "99", "", " ", "-1", "1,5", "01x"]) {
      const parsed = validateRule({ ...goodRule, day });
      expect(parsed.ok, day).toBe(false);
      expect(message(parsed), day).toContain("1 do 31");
    }
  });

  it("odbija podsetnik van 1..7", () => {
    for (const remind of ["0", "8", "9", "", "12", "-1"]) {
      const parsed = validateRule({ ...goodRule, remind });
      expect(parsed.ok, remind).toBe(false);
      expect(message(parsed), remind).toContain("1 do 7");
    }
  });

  it("odbija iznos koji nije pozitivan", () => {
    for (const amount of ["0", "-10", "", "x"]) {
      const parsed = validateRule({ ...goodRule, amount });
      expect(parsed.ok, amount).toBe(false);
      expect(message(parsed), amount).toContain("pozitivan");
    }
  });
});

// ----------------------------------------------------------------
// Iznos u polje i natrag
// ----------------------------------------------------------------

describe("minorToInput", () => {
  it("prazan tekst znači bez limita", () => {
    expect(minorToInput(null)).toBe("");
  });

  it("piše pare samo kad postoje", () => {
    expect(minorToInput(10000)).toBe("100");
    expect(minorToInput(150050)).toBe("1500,50");
    expect(minorToInput(50)).toBe("0,50");
    expect(minorToInput(1250)).toBe("12,50");
  });

  it("vraćeni tekst `majorToMinor` prima nazad bez izmene", () => {
    for (const minor of [50, 1250, 10000, 150050, 2500000, 100000000]) {
      expect(majorToMinor(minorToInput(minor)), String(minor)).toBe(minor);
    }
  });
});

// ----------------------------------------------------------------
// Spiskovi
// ----------------------------------------------------------------

describe("sortByName", () => {
  it("ređa srpskom azbukom i ne dira ulaz", () => {
    const rows = [
      { id: "3", name: "Čačak" },
      { id: "1", name: "Avala" },
      { id: "2", name: "Beograd" },
    ];

    expect(sortByName(rows).map((row) => row.name)).toEqual(["Avala", "Beograd", "Čačak"]);
    expect(rows[0]?.name).toBe("Čačak");
  });

  it("istoimene redove razdvaja po `id`, pa redosled ne skače", () => {
    const rows = [
      { id: "b", name: "Hrana" },
      { id: "a", name: "Hrana" },
    ];

    expect(sortByName(rows).map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("buildMembers", () => {
  const rows = [
    { user_id: "m2", role: "member", profiles: { display_name: "Marko" } },
    { user_id: "o1", role: "owner", profiles: [{ display_name: "Ana" }] },
    { user_id: "m1", role: "member", profiles: { display_name: "Bojana" } },
  ];

  it("vlasnik je prvi, članovi idu azbukom", () => {
    expect(buildMembers(rows).map((member) => member.name)).toEqual(["Ana", "Bojana", "Marko"]);
  });

  it("samo tačno `owner` nosi vlasničku oznaku", () => {
    const built = buildMembers([
      ...rows,
      { user_id: "x", role: "Owner", profiles: { display_name: "Lažni" } },
    ]);

    expect(built.filter((member) => member.owner).map((member) => member.id)).toEqual(["o1"]);
  });

  it("prazno ili nedostajuće ime dobija istu rezervu kao u bazi", () => {
    const built = buildMembers([
      { user_id: "a", role: "member", profiles: { display_name: "   " } },
      { user_id: "b", role: "member", profiles: null },
      { user_id: "c", role: "member", profiles: [] },
    ]);

    expect(built.map((member) => member.name)).toEqual(["Član", "Član", "Član"]);
  });
});

// ----------------------------------------------------------------
// Pozivnice
// ----------------------------------------------------------------

const TOKEN = "11111111-2222-4333-8444-555555555555";

describe("pendingInvitations", () => {
  const now = Date.parse("2026-10-01T10:00:00.000Z");

  const rows = [
    { id: "a", email: "a@primer.rs", token: TOKEN, expires_at: "2026-10-05T10:00:00.000Z", used_at: null },
    { id: "b", email: "b@primer.rs", token: TOKEN, expires_at: "2026-10-02T10:00:00.000Z", used_at: null },
    {
      id: "iskorišćena",
      email: "c@primer.rs",
      token: TOKEN,
      expires_at: "2026-10-06T10:00:00.000Z",
      used_at: "2026-10-01T09:00:00.000Z",
    },
    { id: "istekla", email: "d@primer.rs", token: TOKEN, expires_at: "2026-09-30T10:00:00.000Z", used_at: null },
  ];

  it("izbacuje iskorišćene i istekle pozivnice", () => {
    expect(pendingInvitations(rows, now).map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("pozivnica koja ističe baš sada više ne vredi", () => {
    const edge = [{ ...rows[0]!, expires_at: new Date(now).toISOString() }];
    expect(pendingInvitations(edge, now)).toEqual([]);
  });

  it("neupotrebljiv rok se ne prikazuje kao aktivan link", () => {
    const broken = [{ ...rows[0]!, expires_at: "nije datum" }];
    expect(pendingInvitations(broken, now)).toEqual([]);
  });
});

describe("daysLeft", () => {
  const now = Date.parse("2026-10-01T10:00:00.000Z");

  it("zaokružuje naviše, pa poslednji dan još piše 1", () => {
    expect(daysLeft("2026-10-08T10:00:00.000Z", now)).toBe(7);
    expect(daysLeft(new Date(now + HOUR).toISOString(), now)).toBe(1);
  });

  it("nikad ne ide ispod nule", () => {
    expect(daysLeft("2026-09-01T10:00:00.000Z", now)).toBe(0);
    expect(daysLeft("nije datum", now)).toBe(0);
  });
});

describe("expiryLabel", () => {
  it("piše rok u beogradskom vremenu", () => {
    // 2026-10-01 je letnje vreme: UTC+2, pa 10:00Z postaje 12:00.
    const label = expiryLabel("2026-10-01T10:00:00.000Z");
    expect(label).toContain("2026");
    expect(label).toContain("12:00");
  });

  it("neupotrebljiv datum ne obori stranu", () => {
    expect(expiryLabel("nije datum")).toBe("nepoznato");
  });
});

describe("invitationPath i invitationLink", () => {
  it("pravi putanju koju prihvata već napisan tok prihvatanja", () => {
    expect(invitationPath(TOKEN)).toBe(`/poziv/${TOKEN}`);
    expect(invitationPath(TOKEN.toUpperCase())).toBe(`/poziv/${TOKEN}`);
  });

  it("odbija sve što nije uuid token", () => {
    for (const raw of ["", "nije-token", `${TOKEN}x`, "../tajna"]) {
      expect(invitationPath(raw), raw).toBeNull();
      expect(invitationLink("https://dinar.rs", raw), raw).toBeNull();
    }
  });

  it("lepi poreklo bez duple kose crte", () => {
    expect(invitationLink("https://dinar.rs", TOKEN)).toBe(`https://dinar.rs/poziv/${TOKEN}`);
    expect(invitationLink("https://dinar.rs///", TOKEN)).toBe(`https://dinar.rs/poziv/${TOKEN}`);
  });

  it("bez porekla vraća putanju, ne pogrešan domen", () => {
    expect(invitationLink(null, TOKEN)).toBe(`/poziv/${TOKEN}`);
    expect(invitationLink("", TOKEN)).toBe(`/poziv/${TOKEN}`);
  });
});

// ----------------------------------------------------------------
// Stanje akcije
// ----------------------------------------------------------------

describe("stanje akcije", () => {
  it("početno stanje nema ni poruku ni token", () => {
    expect(emptySettings).toEqual({ ok: false, message: null, token: null, stamp: "" });
  });

  it("neuspeh nosi poruku i nikad token", () => {
    const state = settingsFailure(OWNER_ONLY);
    expect(state.ok).toBe(false);
    expect(state.message).toBe(OWNER_ONLY);
    expect(state.token).toBeNull();
  });

  it("uspeh nosi potvrdu, a token samo kad ga akcija da", () => {
    expect(settingsDone("Sačuvano.")).toMatchObject({ ok: true, message: "Sačuvano.", token: null });
    expect(settingsDone("Pozivnica.", TOKEN)).toMatchObject({ ok: true, token: TOKEN });
  });

  it("dva ista ishoda imaju različit pečat, pa forma zna da je stigao nov odgovor", () => {
    const first = settingsDone("Sačuvano.");
    const second = settingsDone("Sačuvano.");

    expect(first.message).toBe(second.message);
    expect(first.stamp).not.toBe(second.stamp);
    expect(first.stamp).not.toBe(emptySettings.stamp);
  });
});

// ----------------------------------------------------------------
// Prevod grešaka
// ----------------------------------------------------------------

describe("settingsErrorMessage", () => {
  it("prepoznaje zabranu iz RLS-a kao zabranu vlasništva", () => {
    expect(
      settingsErrorMessage('new row violates row-level security policy for table "categories"'),
    ).toBe(OWNER_ONLY);
  });

  it("prepoznaje isteklu prijavu", () => {
    expect(settingsErrorMessage("JWT expired")).toBe(SESSION_GONE);
    expect(settingsErrorMessage("Prijava je obavezna")).toBe(SESSION_GONE);
  });

  it("zauzet naziv i limit na prihodu dobijaju svoje rečenice", () => {
    expect(
      settingsErrorMessage('duplicate key value violates unique constraint "categories_active_name"'),
    ).toContain("već postoji");
    expect(
      settingsErrorMessage('new row violates check constraint "categories_limit_expense_only"'),
    ).toBe(LIMIT_EXPENSE_ONLY);
  });

  it("poruke okidača prevodi u uputstvo", () => {
    expect(settingsErrorMessage("Vrsta kategorije se ne menja")).toContain("ne menja");
    expect(settingsErrorMessage("Vlasnik se ne uklanja")).toBe(OWNER_STAYS);
    expect(settingsErrorMessage("Arhivirana kategorija ne prima aktivno ponavljanje")).toContain(
      "arhivirana",
    );
    expect(settingsErrorMessage("Osoba nije član domaćinstva")).toContain("nije član");
  });

  it("granice kolona dobijaju iste brojeve koje forma traži", () => {
    expect(settingsErrorMessage('violates check constraint "recurring_rules_day_of_month_check"'))
      .toContain("1 do 31");
    expect(settingsErrorMessage('violates check constraint "recurring_rules_remind_days_check"'))
      .toContain("1 do 7");
    expect(settingsErrorMessage('violates check constraint "categories_limit_minor_check"'))
      .toContain("pozitivan");
  });

  it("pad mreže kaže da polja nisu izgubljena", () => {
    expect(settingsErrorMessage("TypeError: fetch failed")).toContain("internet");
  });

  it("nepoznata greška ne prikazuje tekst baze", () => {
    const raw = "ERROR: something went terribly wrong in the backend";
    const translated = settingsErrorMessage(raw);

    expect(translated).not.toContain("backend");
    expect(translated).toBe("Izmena nije sačuvana. Osvežite stranu pa pokušajte ponovo.");
    expect(settingsErrorMessage(null)).toBe(translated);
  });
});

describe("poruke koje akcija vraća bez obraćanja bazi", () => {
  it("svaka je cela rečenica na srpskom", () => {
    for (const text of [
      OWNER_ONLY,
      SESSION_GONE,
      BAD_ADDRESS,
      CATEGORY_GONE,
      LIMIT_EXPENSE_ONLY,
      OWNER_STAYS,
    ]) {
      expect(text.length, text).toBeGreaterThan(10);
      expect(text.endsWith("."), text).toBe(true);
    }
  });
});
