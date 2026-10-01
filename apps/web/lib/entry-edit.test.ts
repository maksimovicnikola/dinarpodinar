import { describe, expect, it } from "vitest";

import { CATEGORY_GONE, type Parsed } from "./settings";
import {
  ENTRY_CATEGORY_ARCHIVED,
  ENTRY_DATE,
  ENTRY_GONE,
  ENTRY_KIND_MISMATCH,
  ENTRY_NOTE_TOO_LONG,
  ENTRY_OWNER_ONLY,
  ENTRY_PERSON_GONE,
  MAX_NOTE,
  categoryChoices,
  checkCategoryChoice,
  checkPersonChoice,
  confirmedDelete,
  entryEditBlocker,
  entryEditErrorMessage,
  entryMonthPath,
  entryUpdatePayload,
  initialCategoryId,
  parseEntryKind,
  personChoices,
  validateEntryFields,
  type EditCategory,
} from "./entry-edit";

const DOM = "11111111-1111-4111-8111-111111111111";
const HRANA = "22222222-2222-4222-8222-222222222222";
const RACUNI = "33333333-3333-4333-8333-333333333333";
const PLATA = "44444444-4444-4444-8444-444444444444";
const ARHIVA = "55555555-5555-4555-8555-555555555555";
const ANA = "66666666-6666-4666-8666-666666666666";
const MARKO = "77777777-7777-4777-8777-777777777777";
const BIVSI = "88888888-8888-4888-8888-888888888888";

function message<T>(result: Parsed<T>): string {
  return result.ok ? "" : result.message;
}

function category(overrides: Partial<EditCategory> & { id: string }): EditCategory {
  return { name: "Kategorija", kind: "expense", archived: false, ...overrides };
}

const EXPENSES: EditCategory[] = [
  category({ id: RACUNI, name: "Računi" }),
  category({ id: HRANA, name: "Hrana" }),
  category({ id: PLATA, name: "Plata", kind: "income" }),
  category({ id: ARHIVA, name: "Arhivirana", archived: true }),
];

// ----------------------------------------------------------------
// Vrsta
// ----------------------------------------------------------------

describe("parseEntryKind", () => {
  it("prepoznaje tačno dve vrste", () => {
    expect(parseEntryKind("expense")).toBe("expense");
    expect(parseEntryKind("income")).toBe("income");
  });

  it("sve drugo je `null`, nikad trošak po podrazumevanom", () => {
    for (const raw of ["", "Expense", "EXPENSE", " expense", "trošak", null, undefined, 1, {}]) {
      expect(parseEntryKind(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

// ----------------------------------------------------------------
// Ponuda kategorija
// ----------------------------------------------------------------

describe("categoryChoices", () => {
  it("nudi samo kategorije vrste unosa, po srpskoj azbuci", () => {
    const choices = categoryChoices(EXPENSES, { kind: "expense", categoryId: HRANA });

    expect(choices.map((item) => item.name)).toEqual(["Hrana", "Računi"]);
  });

  it("nikad ne nudi suprotnu vrstu, ni kad je ona jedina aktivna", () => {
    const choices = categoryChoices([category({ id: PLATA, name: "Plata", kind: "income" })], {
      kind: "expense",
      categoryId: HRANA,
    });

    expect(choices).toEqual([]);
  });

  it("ne nudi tuđu arhiviranu kategoriju", () => {
    const choices = categoryChoices(EXPENSES, { kind: "expense", categoryId: HRANA });

    expect(choices.map((item) => item.id)).not.toContain(ARHIVA);
  });

  it("zadržava arhiviranu kategoriju u kojoj unos već stoji", () => {
    // Bez ovoga izmena beleške starog unosa traži i prekategorizaciju.
    const choices = categoryChoices(EXPENSES, { kind: "expense", categoryId: ARHIVA });

    expect(choices.map((item) => item.name)).toEqual(["Arhivirana", "Hrana", "Računi"]);
    expect(choices.find((item) => item.id === ARHIVA)?.archived).toBe(true);
  });

  it("ne nudi zatečenu kategoriju ako je druge vrste od unosa", () => {
    // Takav red baza ne pravi (`prepare_entry`), ali ako postoji, ponuda ne
    // sme da bude put kojim se vrsta unosa tiho menja.
    const choices = categoryChoices(EXPENSES, { kind: "expense", categoryId: PLATA });

    expect(choices.map((item) => item.id)).not.toContain(PLATA);
  });

  it("prihod dobija samo kategorije prihoda", () => {
    const choices = categoryChoices(EXPENSES, { kind: "income", categoryId: PLATA });

    expect(choices.map((item) => item.name)).toEqual(["Plata"]);
  });
});

describe("initialCategoryId", () => {
  it("kreće od zatečene kategorije unosa", () => {
    const choices = categoryChoices(EXPENSES, { kind: "expense", categoryId: ARHIVA });

    expect(initialCategoryId(choices, ARHIVA)).toBe(ARHIVA);
  });

  it("pada na prvu iz ponude kad zatečene nema", () => {
    const choices = categoryChoices(EXPENSES, { kind: "expense", categoryId: HRANA });

    expect(initialCategoryId(choices, PLATA)).toBe(HRANA);
  });

  it("prazna ponuda daje prazan izbor, ne izmišljen `id`", () => {
    expect(initialCategoryId([], HRANA)).toBe("");
  });
});

// ----------------------------------------------------------------
// Ponuda osoba
// ----------------------------------------------------------------

describe("personChoices", () => {
  const members = [
    { id: ANA, name: "Ana" },
    { id: MARKO, name: "Marko" },
  ];

  it("vraća aktuelne članove kad je osoba unosa među njima", () => {
    expect(personChoices(members, { id: MARKO, name: "Marko" })).toEqual([
      { id: ANA, name: "Ana", former: false },
      { id: MARKO, name: "Marko", former: false },
    ]);
  });

  it("zadržava bivšeg člana kao izbor, prvog i označenog", () => {
    // Snimljeno ime i `person_id` su jedino što od bivšeg člana ostaje.
    const choices = personChoices(members, { id: BIVSI, name: "Bivši" });

    expect(choices[0]).toEqual({ id: BIVSI, name: "Bivši", former: true });
    expect(choices.map((person) => person.id)).toEqual([BIVSI, ANA, MARKO]);
  });

  it("prazno snimljeno ime dobija rezervni naziv, ne prazan natpis", () => {
    expect(personChoices(members, { id: BIVSI, name: "   " })[0]).toEqual({
      id: BIVSI,
      name: "Član",
      former: true,
    });
  });

  it("ne pravi opciju bez identifikatora", () => {
    expect(personChoices(members, { id: "", name: "Niko" })).toHaveLength(2);
  });
});

// ----------------------------------------------------------------
// Zastoj forme
// ----------------------------------------------------------------

describe("entryEditBlocker", () => {
  const people = [{ id: ANA, name: "Ana", former: false }];

  it("nema zastoja kad ima i kategorije i osobe", () => {
    expect(
      entryEditBlocker({
        choices: [category({ id: HRANA })],
        people,
        kind: "expense",
      }),
    ).toBeNull();
  });

  it("prazna ponuda kategorija kaže ko ih vodi", () => {
    const expense = entryEditBlocker({ choices: [], people, kind: "expense" });
    const income = entryEditBlocker({ choices: [], people, kind: "income" });

    expect(expense).toContain("troška");
    expect(income).toContain("prihoda");
  });

  it("prazan spisak članova se javlja pre kategorija", () => {
    expect(entryEditBlocker({ choices: [], people: [], kind: "expense" })).toContain("članova");
  });
});

// ----------------------------------------------------------------
// Provere polja
// ----------------------------------------------------------------

describe("validateEntryFields", () => {
  const valid = {
    amount: "1.250,50",
    categoryId: HRANA,
    personId: ANA,
    occurredOn: "2026-09-02",
    note: "  pijaca  ",
  };

  it("prima srpski zapis iznosa i skida razmake oko beleške", () => {
    expect(validateEntryFields(valid)).toEqual({
      ok: true,
      value: {
        amountMinor: 125050,
        categoryId: HRANA,
        personId: ANA,
        occurredOn: "2026-09-02",
        note: "pijaca",
      },
    });
  });

  it("normalizuje identifikatore na mala slova", () => {
    const result = validateEntryFields({ ...valid, categoryId: HRANA.toUpperCase() });

    expect(result.ok && result.value.categoryId).toBe(HRANA);
  });

  it("odbija nulu, negativan i nebrojčan iznos", () => {
    for (const amount of ["0", "-1", "abc", "", "1.2.3", "12,345"]) {
      expect(validateEntryFields({ ...valid, amount }).ok, amount).toBe(false);
    }
  });

  it("odbija datum koji nije kalendarski dan", () => {
    for (const occurredOn of ["", "2026-02-30", "2026-13-01", "2.9.2026", "1899-12-31"]) {
      const result = validateEntryFields({ ...valid, occurredOn });
      expect(result.ok, occurredOn).toBe(false);
      expect(message(result)).toBe(ENTRY_DATE);
    }
  });

  it("prima 29. februar prestupne godine", () => {
    expect(validateEntryFields({ ...valid, occurredOn: "2028-02-29" }).ok).toBe(true);
  });

  it("pušta belešku od tačno 120 znakova, odbija 121", () => {
    expect(validateEntryFields({ ...valid, note: "a".repeat(MAX_NOTE) }).ok).toBe(true);

    const tooLong = validateEntryFields({ ...valid, note: "a".repeat(MAX_NOTE + 1) });
    expect(tooLong.ok).toBe(false);
    expect(message(tooLong)).toBe(ENTRY_NOTE_TOO_LONG);
  });

  it("odbija identifikatore koji nisu `uuid` pre ijednog upita", () => {
    expect(message(validateEntryFields({ ...valid, categoryId: "nije-uuid" }))).toBe(CATEGORY_GONE);
    expect(message(validateEntryFields({ ...valid, personId: "nije-uuid" }))).toBe(
      ENTRY_PERSON_GONE,
    );
  });
});

describe("checkCategoryChoice", () => {
  const entry = { kind: "expense" as const, categoryId: HRANA };

  it("prima aktivnu kategoriju iste vrste", () => {
    expect(
      checkCategoryChoice({
        chosen: { id: RACUNI, kind: "expense", archived: false },
        entry,
      }),
    ).toEqual({ ok: true, value: RACUNI });
  });

  it("kategorija koje nema u domaćinstvu izgleda isto kao obrisana", () => {
    expect(message(checkCategoryChoice({ chosen: null, entry }))).toBe(CATEGORY_GONE);
  });

  it("red bez prepoznate vrste se tretira kao da ga nema", () => {
    expect(
      message(checkCategoryChoice({ chosen: { id: RACUNI, kind: null, archived: false }, entry })),
    ).toBe(CATEGORY_GONE);
  });

  it("odbija kategoriju suprotne vrste rečenicom, ne greškom okidača", () => {
    expect(
      message(checkCategoryChoice({ chosen: { id: PLATA, kind: "income", archived: false }, entry })),
    ).toBe(ENTRY_KIND_MISMATCH);
  });

  it("odbija premeštanje u arhiviranu kategoriju", () => {
    expect(
      message(checkCategoryChoice({ chosen: { id: ARHIVA, kind: "expense", archived: true }, entry })),
    ).toBe(ENTRY_CATEGORY_ARCHIVED);
  });

  it("pušta zatečenu kategoriju i kad je arhivirana", () => {
    // Isto pravilo kao `prepare_entry`: arhiva odbija premeštanje, ne izmenu
    // iznosa ili beleške na unosu koji je već u njoj.
    expect(
      checkCategoryChoice({
        chosen: { id: ARHIVA, kind: "expense", archived: true },
        entry: { kind: "expense", categoryId: ARHIVA },
      }),
    ).toEqual({ ok: true, value: ARHIVA });
  });
});

describe("checkPersonChoice", () => {
  it("pušta zatečenu osobu bez provere članstva", () => {
    expect(
      checkPersonChoice({ chosenId: BIVSI, entryPersonId: BIVSI, isMember: false }),
    ).toEqual({ ok: true, value: BIVSI });
  });

  it("promena na aktuelnog člana prolazi", () => {
    expect(checkPersonChoice({ chosenId: MARKO, entryPersonId: ANA, isMember: true })).toEqual({
      ok: true,
      value: MARKO,
    });
  });

  it("promena na nekog ko nije član se odbija", () => {
    expect(
      message(checkPersonChoice({ chosenId: BIVSI, entryPersonId: ANA, isMember: false })),
    ).toBe(ENTRY_PERSON_GONE);
  });
});

describe("confirmedDelete", () => {
  it("prima tačno štiklirano polje", () => {
    expect(confirmedDelete("da")).toBe(true);
  });

  it("odbija prazno, izostavljeno i svako drugo polje", () => {
    for (const raw of ["", "ne", "DA", "true", "on", "1"]) {
      expect(confirmedDelete(raw), raw).toBe(false);
    }
  });
});

// ----------------------------------------------------------------
// Šta se šalje bazi
// ----------------------------------------------------------------

describe("entryUpdatePayload", () => {
  const fields = {
    amountMinor: 125050,
    categoryId: HRANA,
    personId: ANA,
    occurredOn: "2026-09-02",
    note: "pijaca",
  };

  it("šalje tačno pet kolona", () => {
    expect(entryUpdatePayload(fields)).toEqual({
      amount_minor: 125050,
      category_id: HRANA,
      person_id: ANA,
      occurred_on: "2026-09-02",
      note: "pijaca",
    });
  });

  it("ne dodiruje ni jedno zaštićeno polje", () => {
    // Snimci, ključ zahteva, veza sa pravilom i domaćinstvo ostaju bazi.
    const keys = Object.keys(entryUpdatePayload(fields));

    for (const protectedColumn of [
      "id",
      "household_id",
      "kind",
      "person_name",
      "created_by",
      "request_id",
      "recurring_rule_id",
      "month_key",
    ]) {
      expect(keys, protectedColumn).not.toContain(protectedColumn);
    }
  });
});

// ----------------------------------------------------------------
// Kuda posle izmene
// ----------------------------------------------------------------

describe("entryMonthPath", () => {
  it("vodi u mesec datuma unosa", () => {
    expect(entryMonthPath(DOM, "2026-09-02")).toBe(`/h/${DOM}?month=2026-09`);
  });

  it("datum van prozora koji se otvara pada na tekući mesec domaćinstva", () => {
    for (const occurredOn of ["1899-12-31", "3000-01-01", "nije-datum", "", null, undefined]) {
      expect(entryMonthPath(DOM, occurredOn), String(occurredOn)).toBe(`/h/${DOM}`);
    }
  });

  it("ivice prozora su i dalje meseci", () => {
    expect(entryMonthPath(DOM, "1900-01-01")).toBe(`/h/${DOM}?month=1900-01`);
    expect(entryMonthPath(DOM, "2999-12-31")).toBe(`/h/${DOM}?month=2999-12`);
  });
});

// ----------------------------------------------------------------
// Prevod grešaka
// ----------------------------------------------------------------

describe("entryEditErrorMessage", () => {
  it("okidač koji brani članu izmenu daje istu rečenicu kao strana", () => {
    expect(entryEditErrorMessage("Samo vlasnik menja unos")).toBe(ENTRY_OWNER_ONLY);
    expect(entryEditErrorMessage('new row violates ... "Samo vlasnik menja unos"')).toBe(
      ENTRY_OWNER_ONLY,
    );
  });

  it("ostale greške prevodi isto kao upis novog unosa", () => {
    expect(entryEditErrorMessage("Arhivirana kategorija ne prima nove unose")).toContain(
      "arhivirana",
    );
    expect(entryEditErrorMessage("Osoba nije član domaćinstva")).toContain("nije član");
    expect(entryEditErrorMessage("Failed to fetch")).toContain("Nema veze sa serverom");
  });

  it("nepoznata greška ne pokazuje tekst baze", () => {
    const message = entryEditErrorMessage('ERROR: 23514 violates check constraint "x"');

    expect(message).not.toContain("23514");
    expect(message).toContain("Pokušajte ponovo");
  });
});

// ----------------------------------------------------------------
// Poruke
// ----------------------------------------------------------------

describe("poruke", () => {
  it("članu kaže ko menja unos, bez detalja o redu", () => {
    expect(ENTRY_OWNER_ONLY).toBe("Unos menja vlasnik.");
  });

  it("promašen i obrisan unos imaju istu rečenicu", () => {
    // Iz poruke se ne sme videti da tuđi unos postoji.
    expect(ENTRY_GONE).toContain("nije nađen");
  });
});
