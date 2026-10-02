import { describe, expect, it } from "vitest";

import {
  buildEntryList,
  buildMonthNav,
  buildMonthView,
  buildUpcoming,
  formatDate,
  groupEntriesByDay,
  monthLabel,
} from "./month-view";
import type { CategoryRow, EntryDetail, RecurringSnapshot } from "./rows";

const HRANA: CategoryRow = {
  id: "food",
  name: "Hrana",
  kind: "expense",
  limitMinor: 1_000_000,
  archived: false,
};
const PREVOZ: CategoryRow = {
  id: "ride",
  name: "Prevoz",
  kind: "expense",
  limitMinor: 1_000_000,
  archived: false,
};
const PLATA: CategoryRow = {
  id: "pay",
  name: "Plata",
  kind: "income",
  limitMinor: null,
  archived: false,
};

function entry(overrides: Partial<EntryDetail> & { id: string }): EntryDetail {
  return {
    kind: "expense",
    amountMinor: 100_000,
    categoryId: "food",
    personId: "m",
    personName: "Marko",
    occurredOn: "2026-09-02",
    note: "",
    recurringRuleId: null,
    ...overrides,
  };
}

function rule(overrides: Partial<RecurringSnapshot> & { id: string }): RecurringSnapshot {
  return {
    kind: "expense",
    amountMinor: 500_000,
    categoryId: "food",
    personId: "m",
    note: "",
    dayOfMonth: 15,
    remindDays: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------- buildMonthView

it("sastavlja ostatak, traku i rečenicu iz domena", () => {
  const view = buildMonthView({
    currency: "RSD",
    month: "2026-09",
    categories: [{ id: "food", name: "Hrana", kind: "expense", limitMinor: 1_000_000 }],
    entries: [
      {
        id: "1",
        kind: "expense",
        amountMinor: 1_420_000,
        categoryId: "food",
        personId: "m",
        personName: "Marko",
        occurredOn: "2026-09-02",
      },
    ],
    previous: null,
  });
  expect(view.expense).toBe("14.200 RSD");
  expect(view.sentence).toBe("Hrana je 4.200 RSD preko limita. Najveći deo: Marko.");
  expect(view.alerts).toEqual(["Hrana je prešla 80% limita.", "Hrana je prešla 100% limita."]);
  expect(view.bars[0]?.width).toBe(100);
});

describe("buildMonthView — zbirovi", () => {
  it("sabira prihod, trošak i ostatak samo iz vidljivog meseca", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA, PLATA],
      entries: [
        entry({ id: "1", amountMinor: 300_000 }),
        entry({ id: "2", kind: "income", categoryId: "pay", amountMinor: 1_000_000 }),
        entry({ id: "3", amountMinor: 999_900, occurredOn: "2026-08-31" }),
      ],
      previous: null,
    });

    expect(view.income).toBe("10.000 RSD");
    expect(view.expense).toBe("3.000 RSD");
    expect(view.leftover).toBe("7.000 RSD");
    expect(view.leftoverMinor).toBe(700_000);
  });

  it("negativan ostatak nosi minus", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA],
      entries: [entry({ id: "1", amountMinor: 250_050 })],
      previous: null,
    });

    expect(view.leftover).toBe("-2.500,50 RSD");
    expect(view.leftoverMinor).toBe(-250_050);
  });
});

describe("buildMonthView — filter po osobi", () => {
  const categories = [HRANA, PREVOZ];
  const entries = [
    entry({ id: "1", amountMinor: 400_000, personId: "m", personName: "Marko" }),
    entry({ id: "2", amountMinor: 700_000, personId: "a", personName: "Ana" }),
    entry({ id: "3", amountMinor: 200_000, categoryId: "ride", personId: "a", personName: "Ana" }),
  ];

  it("sužava zbirove i trake na izabranu osobu", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries,
      previous: null,
      personId: "a",
      personName: "Ana",
    });

    expect(view.expense).toBe("9.000 RSD");
    expect(view.bars.map((bar) => bar.name)).toEqual(["Hrana", "Prevoz"]);
    expect(view.bars[0]?.label).toBe("7.000 RSD / 10.000 RSD");
  });

  it("rečenica filtera imenuje osobu i njenu najveću kategoriju", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries,
      previous: null,
      personId: "a",
      personName: "Ana",
    });

    expect(view.sentence).toBe("Ana ima najviše u kategoriji Hrana: 7.000 RSD.");
  });

  it("osoba bez troška dobija svoju rečenicu", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries,
      previous: null,
      personId: "z",
      personName: "Zoran",
    });

    expect(view.sentence).toBe("Zoran nema troškove u ovom mesecu.");
    expect(view.expense).toBe("0 RSD");
  });

  it("pragovi ostaju na nivou domaćinstva i kad je filter na jednoj osobi", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries,
      previous: null,
      personId: "m",
      personName: "Marko",
    });

    // Marko sam je na 40% limita za Hranu; domaćinstvo je na 110%.
    expect(view.bars[0]).toEqual({
      categoryId: "food",
      name: "Hrana",
      archived: false,
      width: 40,
      label: "4.000 RSD / 10.000 RSD",
      limited: true,
      over: false,
      state: "ok",
      percent: 40,
    });
    expect(view.alerts).toEqual(["Hrana je prešla 80% limita.", "Hrana je prešla 100% limita."]);
  });

  it("prazno ime osobe pada na ceo prikaz umesto da ide u domen", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries,
      previous: null,
      personId: "a",
      personName: "   ",
    });

    expect(view.expense).toBe("13.000 RSD");
    expect(view.sentence).toBe("Hrana je 1.000 RSD preko limita. Najveći deo: Ana.");
  });

  it("personId bez imena pada na ceo prikaz", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries,
      previous: null,
      personId: "a",
    });

    expect(view.expense).toBe("13.000 RSD");
  });
});

describe("buildMonthView — stanje trake", () => {
  function barFor(amountMinor: number, limitMinor: number | null) {
    return buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [{ ...HRANA, limitMinor }],
      entries: [entry({ id: "1", amountMinor })],
      previous: null,
    }).bars[0];
  }

  it("boja trake prati iste pragove kao upozorenja", () => {
    expect(barFor(790_000, 1_000_000)).toMatchObject({ state: "ok", percent: 79 });
    expect(barFor(850_000, 1_000_000)).toMatchObject({ state: "near", percent: 85 });
    expect(barFor(1_000_000, 1_000_000)).toMatchObject({ state: "over", percent: 100 });
    expect(barFor(1_420_000, 1_000_000)).toMatchObject({ state: "over", percent: 142 });
  });

  it("kategorija bez limita nema procenat", () => {
    expect(barFor(123_456, null)).toMatchObject({ state: "free", percent: null });
  });
});

describe("groupEntriesByDay", () => {
  it("grupiše unose po danu i čuva redosled liste", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA, PREVOZ],
      entries: [
        entry({ id: "a", occurredOn: "2026-09-02" }),
        entry({ id: "b", occurredOn: "2026-09-05", amountMinor: 300_000 }),
        entry({ id: "c", occurredOn: "2026-09-05", categoryId: "ride" }),
        entry({ id: "d", occurredOn: "2026-09-02", amountMinor: 50_000 }),
      ],
    });

    expect(
      groupEntriesByDay(rows).map((day) => [day.occurredOn, day.date, day.rows.map((row) => row.id)]),
    ).toEqual([
      ["2026-09-05", "5.9.2026.", ["b", "c"]],
      ["2026-09-02", "2.9.2026.", ["a", "d"]],
    ]);
  });

  it("prazna lista nema dane", () => {
    expect(groupEntriesByDay([])).toEqual([]);
  });
});

describe("buildMonthView — trake", () => {
  it("kategorija bez limita ima punu traku i natpis bez limita", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [{ ...HRANA, limitMinor: null }],
      entries: [entry({ id: "1", amountMinor: 123_456 })],
      previous: null,
    });

    expect(view.bars).toEqual([
      {
        categoryId: "food",
        name: "Hrana",
        archived: false,
        width: 100,
        label: "1.234,56 RSD",
        limited: false,
        over: false,
        state: "free",
        percent: null,
      },
    ]);
    expect(view.alerts).toEqual([]);
  });

  it("puna traka razlikuje prekoračen limit od kategorije bez limita", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA, { ...PREVOZ, limitMinor: null }],
      entries: [
        entry({ id: "1", amountMinor: 1_200_000 }),
        entry({ id: "2", categoryId: "ride", amountMinor: 1_300_000 }),
      ],
      previous: null,
    });

    expect(view.bars.map((bar) => [bar.name, bar.width, bar.limited, bar.over])).toEqual([
      ["Prevoz", 100, false, false],
      ["Hrana", 100, true, true],
    ]);
  });

  it("tačno na limitu traka je označena kao prekoračena", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA],
      entries: [entry({ id: "1", amountMinor: 1_000_000 })],
      previous: null,
    });

    expect(view.bars[0]?.over).toBe(true);
  });

  it("trake idu od najveće potrošnje nadole", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA, PREVOZ],
      entries: [
        entry({ id: "1", amountMinor: 100_000 }),
        entry({ id: "2", categoryId: "ride", amountMinor: 900_000 }),
      ],
      previous: null,
    });

    expect(view.bars.map((bar) => bar.name)).toEqual(["Prevoz", "Hrana"]);
  });

  it("kategorija bez potrošnje nema traku, a prihod nikad nema traku", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA, PREVOZ, PLATA],
      entries: [entry({ id: "1", kind: "income", categoryId: "pay", amountMinor: 900_000 })],
      previous: null,
    });

    expect(view.bars).toEqual([]);
  });

  it("arhivirana kategorija ostaje u trakama i u rečenici", () => {
    const arhivirana: CategoryRow = { ...HRANA, archived: true };
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [arhivirana],
      entries: [entry({ id: "1", amountMinor: 1_500_000 })],
      previous: null,
    });

    expect(view.bars).toEqual([
      {
        categoryId: "food",
        name: "Hrana",
        archived: true,
        width: 100,
        label: "15.000 RSD / 10.000 RSD",
        limited: true,
        over: true,
        state: "over",
        percent: 150,
      },
    ]);
    expect(view.sentence).toBe("Hrana je 5.000 RSD preko limita. Najveći deo: Marko.");
  });
});

describe("buildMonthView — pragovi i rečenice iz domena", () => {
  it("tačno 80% pali prag, 79,99% ne", () => {
    const at = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA],
      entries: [entry({ id: "1", amountMinor: 800_000 })],
      previous: null,
    });
    const below = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA],
      entries: [entry({ id: "1", amountMinor: 799_999 })],
      previous: null,
    });

    expect(at.alerts).toEqual(["Hrana je prešla 80% limita."]);
    expect(at.sentence).toBe("Hrana je na 80% limita. Najveći deo: Marko.");
    expect(below.alerts).toEqual([]);
    expect(below.sentence).toBe("Ovaj mesec je unutar limita.");
  });

  it("tačno 100% pali oba praga", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [HRANA],
      entries: [entry({ id: "1", amountMinor: 1_000_000 })],
      previous: null,
    });

    expect(view.alerts).toEqual(["Hrana je prešla 80% limita.", "Hrana je prešla 100% limita."]);
    // Na tačno 100% nema prekoračenja, pa važi rečenica praga.
    expect(view.sentence).toBe("Hrana je na 100% limita. Najveći deo: Marko.");
  });

  it("rečenica rasta koristi prethodni mesec i prag za RSD", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [{ ...HRANA, limitMinor: null }],
      entries: [entry({ id: "1", amountMinor: 500_000 })],
      previous: [entry({ id: "0", amountMinor: 200_000, occurredOn: "2026-08-02" })],
    });

    expect(view.sentence).toBe(
      "Potrošnja u kategoriji Hrana je veća za 3.000 RSD nego prošlog meseca. Najveći deo: Marko.",
    );
  });

  it("prvi mesec nema prethodni, pa nema rečenicu rasta", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [{ ...HRANA, limitMinor: null }],
      entries: [entry({ id: "1", amountMinor: 500_000 })],
      previous: null,
    });

    expect(view.sentence).toBe("Ovaj mesec je unutar limita.");
  });

  it("upozorenja idu azbučnim redom kategorija", () => {
    const view = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [PREVOZ, HRANA],
      entries: [
        entry({ id: "1", categoryId: "ride", amountMinor: 900_000 }),
        entry({ id: "2", categoryId: "food", amountMinor: 900_000 }),
      ],
      previous: null,
    });

    expect(view.alerts).toEqual(["Hrana je prešla 80% limita.", "Prevoz je prešla 80% limita."]);
  });
});

describe("buildMonthView — arhivirana i aktivna kategorija istog naziva", () => {
  // Baza to dozvoljava: jedinstvenost naziva važi samo među neARHIVIRANIM
  // kategorijama (`categories_active_name … where not archived`).
  const staraHrana: CategoryRow = {
    id: "food-old",
    name: "Hrana",
    kind: "expense",
    limitMinor: 500_000,
    archived: true,
  };
  const novaHrana: CategoryRow = {
    id: "food",
    name: "Hrana",
    kind: "expense",
    limitMinor: 1_000_000,
    archived: false,
  };
  const categories = [staraHrana, novaHrana];
  const entries = [
    entry({ id: "1", categoryId: "food-old", amountMinor: 600_000 }),
    entry({ id: "2", categoryId: "food", amountMinor: 850_000 }),
  ];

  function view() {
    return buildMonthView({ currency: "RSD", month: "2026-09", categories, entries, previous: null });
  }

  it("obe kategorije dobijaju svoju traku sa jedinstvenim ključem", () => {
    const bars = view().bars;

    expect(bars).toHaveLength(2);
    expect(new Set(bars.map((bar) => bar.categoryId)).size).toBe(2);
    expect(bars.map((bar) => bar.categoryId)).toEqual(["food", "food-old"]);
  });

  it("iznosi i procenti se ne mešaju između istoimenih kategorija", () => {
    const [active, archived] = view().bars;

    expect(active).toMatchObject({
      categoryId: "food",
      archived: false,
      width: 85,
      label: "8.500 RSD / 10.000 RSD",
      over: false,
    });
    expect(archived).toMatchObject({
      categoryId: "food-old",
      archived: true,
      width: 100,
      label: "6.000 RSD / 5.000 RSD",
      over: true,
    });
  });

  it("arhivirana traka je obeležena, aktivna nije", () => {
    expect(view().bars.map((bar) => bar.archived)).toEqual([false, true]);
  });

  it("pragovi se računaju po kategoriji, ne po nazivu", () => {
    const rows = view().alertRows;

    expect(rows.map((row) => [row.categoryId, row.threshold])).toEqual([
      ["food", 80],
      ["food-old", 80],
      ["food-old", 100],
    ]);
  });

  it("svako upozorenje ima jedinstven ključ iako je rečenica ista", () => {
    const rows = view().alertRows;
    const keys = rows.map((row) => `${row.categoryId}:${row.threshold}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(rows.map((row) => row.message)).size).toBe(2);
  });

  it("upozorenje nosi zastavicu arhive", () => {
    expect(view().alertRows.map((row) => row.archived)).toEqual([false, true, true]);
  });

  it("`alerts` ostaje niz niski, istim redosledom kao `alertRows`", () => {
    const result = view();

    expect(result.alerts).toEqual([
      "Hrana je prešla 80% limita.",
      "Hrana je prešla 80% limita.",
      "Hrana je prešla 100% limita.",
    ]);
    expect(result.alerts).toEqual(result.alertRows.map((row) => row.message));
  });

  it("isti naziv i isti iznos razdvaja identifikator, pa je redosled određen", () => {
    const tie = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries: [
        entry({ id: "1", categoryId: "food-old", amountMinor: 400_000 }),
        entry({ id: "2", categoryId: "food", amountMinor: 400_000 }),
      ],
      previous: null,
    });

    expect(tie.bars.map((bar) => bar.categoryId)).toEqual(["food", "food-old"]);
  });

  it("kategorije bez `archived` polja i dalje prolaze ugovor iz briefa", () => {
    const plain = buildMonthView({
      currency: "RSD",
      month: "2026-09",
      categories: [{ id: "food", name: "Hrana", kind: "expense", limitMinor: 1_000_000 }],
      entries: [entry({ id: "1", amountMinor: 1_200_000 })],
      previous: null,
    });

    expect(plain.bars[0]?.archived).toBe(false);
    expect(plain.alertRows.every((row) => row.archived === false)).toBe(true);
  });
});

// ---------------------------------------------------------------- buildMonthNav

describe("buildMonthNav", () => {
  it("usred prozora nudi oba suseda sa natpisima", () => {
    expect(buildMonthNav("2026-09")).toEqual({
      previous: { month: "2026-08", label: "avgust 2026." },
      current: { month: "2026-09", label: "septembar 2026." },
      next: { month: "2026-10", label: "oktobar 2026." },
    });
  });

  it("prelazak godine unazad i unapred nosi tačnu godinu", () => {
    expect(buildMonthNav("2026-01").previous).toEqual({
      month: "2025-12",
      label: "decembar 2025.",
    });
    expect(buildMonthNav("2026-12").next).toEqual({ month: "2027-01", label: "januar 2027." });
  });

  it("donja ivica prozora se iscrtava bez prethodnog meseca", () => {
    expect(buildMonthNav("1900-01")).toEqual({
      previous: null,
      current: { month: "1900-01", label: "januar 1900." },
      next: { month: "1900-02", label: "februar 1900." },
    });
  });

  it("gornja ivica prozora se iscrtava bez sledećeg meseca", () => {
    expect(buildMonthNav("2999-12")).toEqual({
      previous: { month: "2999-11", label: "novembar 2999." },
      current: { month: "2999-12", label: "decembar 2999." },
      next: null,
    });
  });

  it("nijedan prihvaćen mesec ne obara sastavljanje prebacivača", () => {
    for (const month of [
      "1900-01",
      "1900-02",
      "1900-12",
      "2026-01",
      "2026-06",
      "2026-12",
      "2999-01",
      "2999-11",
      "2999-12",
    ]) {
      expect(() => buildMonthNav(month), month).not.toThrow();
      const nav = buildMonthNav(month);
      expect(nav.current.label, month).toMatch(/^[a-zčćšžđ]+ \d{4}\.$/);
      for (const step of [nav.previous, nav.next]) {
        if (step !== null) expect(step.label, `${month} → ${step.month}`).toMatch(/\d{4}\.$/);
      }
    }
  });

  it("ivica ima tačno jednog suseda, sredina oba", () => {
    expect([buildMonthNav("1900-01").previous, buildMonthNav("1900-01").next].filter(Boolean))
      .toHaveLength(1);
    expect([buildMonthNav("2999-12").previous, buildMonthNav("2999-12").next].filter(Boolean))
      .toHaveLength(1);
    expect([buildMonthNav("2026-05").previous, buildMonthNav("2026-05").next].filter(Boolean))
      .toHaveLength(2);
  });

  it("neispravan mesec se odbija pre sastavljanja", () => {
    expect(() => buildMonthNav("2026-13")).toThrow(/YYYY-MM/);
    expect(() => buildMonthNav("1899-12")).toThrow(/YYYY-MM/);
    expect(() => buildMonthNav("3000-01")).toThrow(/YYYY-MM/);
  });
});

// ---------------------------------------------------------------- buildEntryList

describe("buildEntryList", () => {
  const categories = [HRANA, PREVOZ, { ...PLATA, archived: true }];

  it("ređa unose od najnovijeg, pa po iznosu, pa po identifikatoru", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries: [
        entry({ id: "b", occurredOn: "2026-09-10", amountMinor: 100 }),
        entry({ id: "a", occurredOn: "2026-09-10", amountMinor: 100 }),
        entry({ id: "c", occurredOn: "2026-09-10", amountMinor: 900 }),
        entry({ id: "d", occurredOn: "2026-09-20", amountMinor: 1 }),
        entry({ id: "e", occurredOn: "2026-09-01", amountMinor: 9_999 }),
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["d", "c", "a", "b", "e"]);
  });

  it("drži samo vidljivi mesec", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries: [
        entry({ id: "u", occurredOn: "2026-09-30" }),
        entry({ id: "pre", occurredOn: "2026-08-31" }),
        entry({ id: "posle", occurredOn: "2026-10-01" }),
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["u"]);
  });

  it("sužava listu na izabranu osobu", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries: [
        entry({ id: "m", personId: "m", personName: "Marko" }),
        entry({ id: "a", personId: "a", personName: "Ana" }),
      ],
      personId: "a",
    });

    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("arhivirana kategorija ostaje u istoriji i nosi oznaku", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries: [entry({ id: "1", kind: "income", categoryId: "pay", amountMinor: 1_000_000 })],
    });

    expect(rows[0]).toMatchObject({
      categoryName: "Plata",
      categoryArchived: true,
      amount: "10.000 RSD",
      kind: "income",
    });
  });

  it("obeležava automatski unos i čisti belešku i ime", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories,
      entries: [
        entry({ id: "1", recurringRuleId: "r1", note: "  kirija  ", personName: "   " }),
      ],
    });

    expect(rows[0]).toMatchObject({
      automatic: true,
      note: "kirija",
      personName: "Član",
      date: "2.9.2026.",
    });
  });

  it("unos čija kategorija nije učitana ne ruši listu", () => {
    const rows = buildEntryList({
      currency: "RSD",
      month: "2026-09",
      categories: [],
      entries: [entry({ id: "1" })],
    });

    expect(rows[0]?.categoryName).toBe("Bez kategorije");
  });
});

// ---------------------------------------------------------------- buildUpcoming

describe("buildUpcoming", () => {
  const people = [
    { id: "m", name: "Marko" },
    { id: "a", name: "Ana" },
  ];
  const base = {
    currency: "RSD",
    today: "2026-02-10",
    categories: [HRANA, PREVOZ],
    people,
    entries: [] as EntryDetail[],
  };

  it("dan 31 u februaru postaje poslednji dan meseca", () => {
    const [row] = buildUpcoming({
      ...base,
      month: "2026-02",
      rules: [rule({ id: "r1", dayOfMonth: 31 })],
    });

    expect(row?.dueOn).toBe("2026-02-28");
    expect(row?.dueDate).toBe("28.2.2026.");
  });

  it("dan 31 u prestupnom februaru postaje 29.", () => {
    const [row] = buildUpcoming({
      ...base,
      today: "2028-02-10",
      month: "2028-02",
      rules: [rule({ id: "r1", dayOfMonth: 31 })],
    });

    expect(row?.dueOn).toBe("2028-02-29");
  });

  it("dan 31 u aprilu postaje 30., a u martu ostaje 31.", () => {
    const [april] = buildUpcoming({
      ...base,
      today: "2026-04-01",
      month: "2026-04",
      rules: [rule({ id: "r1", dayOfMonth: 31 })],
    });
    const [mart] = buildUpcoming({
      ...base,
      today: "2026-03-01",
      month: "2026-03",
      rules: [rule({ id: "r1", dayOfMonth: 31 })],
    });

    expect(april?.dueOn).toBe("2026-04-30");
    expect(mart?.dueOn).toBe("2026-03-31");
  });

  it("podsetnik sme da padne u prethodni mesec", () => {
    const [row] = buildUpcoming({
      ...base,
      today: "2026-03-01",
      month: "2026-03",
      rules: [rule({ id: "r1", dayOfMonth: 1, remindDays: 3 })],
    });

    expect(row?.dueOn).toBe("2026-03-01");
    expect(row?.remindOn).toBe("2026-02-26");
    expect(row?.remindDate).toBe("26.2.2026.");
  });

  it("podsetnik od 7 dana pred 1. mart kreće iz februara", () => {
    const [row] = buildUpcoming({
      ...base,
      today: "2026-03-01",
      month: "2026-03",
      rules: [rule({ id: "r1", dayOfMonth: 1, remindDays: 7 })],
    });

    expect(row?.remindOn).toBe("2026-02-22");
  });

  it("stanje prati današnji dan u Beogradu", () => {
    const rows = buildUpcoming({
      ...base,
      month: "2026-02",
      today: "2026-02-10",
      rules: [
        rule({ id: "pre", dayOfMonth: 5 }),
        rule({ id: "danas", dayOfMonth: 10 }),
        rule({ id: "posle", dayOfMonth: 20 }),
      ],
    });

    expect(rows.map((row) => [row.id, row.state, row.label])).toEqual([
      ["pre", "prošlo", "Dospelo"],
      ["danas", "danas", "Danas"],
      ["posle", "predstoji", "Predstoji"],
    ]);
  });

  it("pravilo koje je već dalo unos u ovom mesecu je uneto", () => {
    const rows = buildUpcoming({
      ...base,
      month: "2026-02",
      rules: [rule({ id: "r1", dayOfMonth: 5 })],
      entries: [entry({ id: "e1", occurredOn: "2026-02-05", recurringRuleId: "r1" })],
    });

    expect(rows[0]?.state).toBe("uneto");
  });

  it("unos istog pravila iz drugog meseca ne gasi dospeće", () => {
    const rows = buildUpcoming({
      ...base,
      month: "2026-02",
      rules: [rule({ id: "r1", dayOfMonth: 5 })],
      entries: [entry({ id: "e1", occurredOn: "2026-01-05", recurringRuleId: "r1" })],
    });

    expect(rows[0]?.state).toBe("prošlo");
  });

  it("filter po osobi sužava i dospeća", () => {
    const rows = buildUpcoming({
      ...base,
      month: "2026-02",
      rules: [rule({ id: "r1", personId: "m" }), rule({ id: "r2", personId: "a" })],
      personId: "a",
    });

    expect(rows.map((row) => row.id)).toEqual(["r2"]);
    expect(rows[0]?.personName).toBe("Ana");
  });

  it("ređa po datumu dospeća, pa po nazivu kategorije", () => {
    const rows = buildUpcoming({
      ...base,
      month: "2026-02",
      rules: [
        rule({ id: "r1", dayOfMonth: 20, categoryId: "ride" }),
        rule({ id: "r2", dayOfMonth: 5, categoryId: "ride" }),
        rule({ id: "r3", dayOfMonth: 5, categoryId: "food" }),
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("nepoznata osoba i kategorija ne ruše pregled", () => {
    const [row] = buildUpcoming({
      ...base,
      month: "2026-02",
      categories: [],
      people: [],
      rules: [rule({ id: "r1" })],
    });

    expect(row?.categoryName).toBe("Bez kategorije");
    expect(row?.personName).toBe("Član");
  });

  it("iznos dospeća ide kroz formatMoney", () => {
    const [row] = buildUpcoming({
      ...base,
      month: "2026-02",
      rules: [rule({ id: "r1", amountMinor: 1_234_567 })],
    });

    expect(row?.amount).toBe("12.345,67 RSD");
  });
});

// ---------------------------------------------------------------- natpisi

describe("natpisi datuma", () => {
  it("naziv meseca je na srpskom", () => {
    expect(monthLabel("2026-01")).toBe("januar 2026.");
    expect(monthLabel("2026-09")).toBe("septembar 2026.");
    expect(monthLabel("2026-12")).toBe("decembar 2026.");
  });

  it("naziv meseca odbija neispravan ključ", () => {
    expect(() => monthLabel("2026-13")).toThrow(/YYYY-MM/);
    expect(() => monthLabel("2026-9")).toThrow(/YYYY-MM/);
  });

  it("datum je u srpskom zapisu bez vodećih nula", () => {
    expect(formatDate("2026-09-02")).toBe("2.9.2026.");
    expect(formatDate("2026-12-31")).toBe("31.12.2026.");
  });

  it("datum odbija nepotpun oblik", () => {
    expect(() => formatDate("2026-09")).toThrow(/YYYY-MM-DD/);
  });
});
