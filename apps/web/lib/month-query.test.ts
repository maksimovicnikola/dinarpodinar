import { monthKey, occurrenceDate } from "@finance/domain";
import { describe, expect, it } from "vitest";

import {
  buildPeople,
  isMonthKey,
  monthNeighbors,
  monthParam,
  monthParts,
  monthsAhead,
  nextMonthKey,
  previousMonthKey,
  selectCategory,
  selectPerson,
} from "./month-query";

const TODAY = "2026-09-17";

describe("isMonthKey", () => {
  it("prihvata tačno YYYY-MM sa stvarnim mesecom", () => {
    expect(isMonthKey("2026-01")).toBe(true);
    expect(isMonthKey("2026-09")).toBe(true);
    expect(isMonthKey("2026-12")).toBe(true);
  });

  it("odbija mesec van 01..12", () => {
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-99")).toBe(false);
  });

  it("odbija oblike koji bi dali NaN ili pogrešan datum", () => {
    for (const bad of [
      "2026-9",
      "202609",
      "2026/09",
      "2026-09-01",
      "26-09",
      "02026-09",
      " 2026-09",
      "2026-09 ",
      "2026-0a",
      "",
      "danas",
      "NaN-NaN",
      "-2026-09",
      "2026-+9",
    ]) {
      expect(isMonthKey(bad), bad).toBe(false);
    }
  });

  it("odbija godine koje `Date.UTC` preslikava u dvadeseti vek", () => {
    expect(isMonthKey("0012-02")).toBe(false);
    expect(isMonthKey("0099-02")).toBe(false);
    expect(isMonthKey("1900-01")).toBe(true);
    expect(isMonthKey("2999-12")).toBe(true);
  });

  it("odbija sve što nije niska", () => {
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isMonthKey(202609)).toBe(false);
    expect(isMonthKey(["2026-09"])).toBe(false);
  });
});

describe("monthParam", () => {
  it("prihvata ispravan mesec iz adrese", () => {
    expect(monthParam("2026-03", TODAY)).toBe("2026-03");
  });

  it("neispravan mesec pada na tekući, nikad na NaN", () => {
    for (const bad of ["2026-13", "2026-00", "2026-9", "", "x", "2026-09-01"]) {
      expect(monthParam(bad, TODAY), bad).toBe("2026-09");
    }
  });

  it("bez parametra uzima tekući mesec u Beogradu", () => {
    expect(monthParam(undefined, "2026-01-01")).toBe("2026-01");
    expect(monthParam(undefined, "2025-12-31")).toBe("2025-12");
  });

  it("ponovljen parametar uzima prvi", () => {
    expect(monthParam(["2026-03", "2026-04"], TODAY)).toBe("2026-03");
    expect(monthParam(["2026-77", "2026-04"], TODAY)).toBe("2026-09");
    expect(monthParam([], TODAY)).toBe("2026-09");
  });
});

describe("granice meseca", () => {
  it("prethodni mesec prelazi godinu unazad", () => {
    expect(previousMonthKey("2026-01")).toBe("2025-12");
    expect(previousMonthKey("2026-10")).toBe("2026-09");
    expect(previousMonthKey("2026-03")).toBe("2026-02");
  });

  it("sledeći mesec prelazi godinu unapred", () => {
    expect(nextMonthKey("2026-12")).toBe("2027-01");
    expect(nextMonthKey("2026-09")).toBe("2026-10");
  });

  it("rastavljanje meseca daje brojeve", () => {
    expect(monthParts("2026-09")).toEqual({ year: 2026, monthNumber: 9 });
  });

  it("neispravan mesec se odbija, ne pretvara u NaN", () => {
    expect(() => previousMonthKey("2026-13")).toThrow(/YYYY-MM/);
    expect(() => nextMonthKey("x")).toThrow(/YYYY-MM/);
    expect(() => monthParts("2026-9")).toThrow(/YYYY-MM/);
  });

  it("sused izvan prihvaćenog prozora je `null`, ne ključ koji validator odbija", () => {
    expect(previousMonthKey("1900-01")).toBeNull();
    expect(nextMonthKey("2999-12")).toBeNull();
  });

  it("susedi tačno unutar prozora i dalje postoje", () => {
    expect(nextMonthKey("1900-01")).toBe("1900-02");
    expect(previousMonthKey("1900-02")).toBe("1900-01");
    expect(previousMonthKey("2999-12")).toBe("2999-11");
    expect(nextMonthKey("2999-11")).toBe("2999-12");
  });

  it("oba suseda stižu u jednom pozivu", () => {
    expect(monthNeighbors("2026-09")).toEqual({ previous: "2026-08", next: "2026-10" });
    expect(monthNeighbors("1900-01")).toEqual({ previous: null, next: "1900-02" });
    expect(monthNeighbors("2999-12")).toEqual({ previous: "2999-11", next: null });
  });

  it("svaki vraćeni sused i sam prolazi validator", () => {
    for (const month of ["1900-01", "1900-02", "2026-01", "2026-12", "2999-11", "2999-12"]) {
      const { previous, next } = monthNeighbors(month);
      if (previous !== null) expect(isMonthKey(previous), `${month} ← ${previous}`).toBe(true);
      if (next !== null) expect(isMonthKey(next), `${month} → ${next}`).toBe(true);
    }
  });
});

describe("monthsAhead", () => {
  it("nula koraka vraća isti mesec", () => {
    expect(monthsAhead("2026-09", 0)).toBe("2026-09");
  });

  it("korak unutar iste godine", () => {
    expect(monthsAhead("2026-01", 1)).toBe("2026-02");
    expect(monthsAhead("2026-01", 5)).toBe("2026-06");
    expect(monthsAhead("2026-07", 5)).toBe("2026-12");
  });

  it("prelazak godine ne daje trinaesti mesec", () => {
    expect(monthsAhead("2026-08", 5)).toBe("2027-01");
    expect(monthsAhead("2026-12", 1)).toBe("2027-01");
    expect(monthsAhead("2026-12", 5)).toBe("2027-05");
    expect(monthsAhead("2026-11", 14)).toBe("2028-01");
  });

  it("više od godine dana unapred prelazi tačan broj godina", () => {
    expect(monthsAhead("2026-09", 12)).toBe("2027-09");
    expect(monthsAhead("2026-09", 24)).toBe("2028-09");
    expect(monthsAhead("2026-09", 27)).toBe("2028-12");
  });

  it("izlazak iz prozora je `null`, ne ključ koji validator odbija", () => {
    expect(monthsAhead("2999-12", 1)).toBeNull();
    expect(monthsAhead("2999-08", 5)).toBeNull();
    expect(monthsAhead("2999-07", 5)).toBe("2999-12");
  });

  it("neispravan mesec se odbija i kad nema nijednog koraka", () => {
    expect(() => monthsAhead("2026-13", 3)).toThrow(/YYYY-MM/);
    expect(() => monthsAhead("2026-9", 0)).toThrow(/YYYY-MM/);
    expect(() => monthsAhead("danas", 0)).toThrow(/YYYY-MM/);
  });

  it("broj koraka mora biti ceo broj koji nije negativan", () => {
    expect(() => monthsAhead("2026-09", -1)).toThrow(/ceo broj/);
    expect(() => monthsAhead("2026-09", 1.5)).toThrow(/ceo broj/);
    expect(() => monthsAhead("2026-09", Number.NaN)).toThrow(/ceo broj/);
  });

  it("rezultat je uvek prihvaćen mesec, kroz ceo prozor", () => {
    for (const month of ["1900-01", "2026-01", "2026-08", "2026-12", "2998-12", "2999-07"]) {
      for (const count of [0, 1, 5, 12, 17]) {
        const ahead = monthsAhead(month, count);
        if (ahead !== null) {
          expect(isMonthKey(ahead), `${month} +${count} → ${ahead}`).toBe(true);
        }
      }
    }
  });

  it("pomeranje je isto kao ponovljeni `nextMonthKey`", () => {
    for (const month of ["2026-01", "2026-08", "2026-12", "2027-11"]) {
      let stepwise: string | null = month;
      for (let count = 0; count <= 15; count += 1) {
        expect(monthsAhead(month, count), `${month} +${count}`).toBe(stepwise);
        stepwise = stepwise === null ? null : nextMonthKey(stepwise);
      }
    }
  });

  it("svaki mesec u godini pomeren za pet koraka ostaje stvaran mesec", () => {
    // Test šava bira ciljni mesec ovako; nijedan polazni mesec ne sme da ga obori.
    for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
      const start = `2026-${String(monthNumber).padStart(2, "0")}`;
      const ahead = monthsAhead(start, 5);
      expect(ahead, start).not.toBeNull();
      expect(ahead).not.toBe(start);
      expect(monthParts(ahead!).monthNumber).toBe(((monthNumber + 4) % 12) + 1);
    }
  });

  it("izvedeni ciljni mesec ne zastareva kao upisan", () => {
    // Test šava je nekada imao upisano `2027-02-17`. Čim taj mesec stigne,
    // tvrdnja „ciljni mesec nije tekući" pada sama od sebe. Izvedeni mesec
    // tog istog dana beži napred, pa tvrdnja i dalje stoji.
    const expiringDay = "2027-02-17";

    expect(monthKey(expiringDay)).toBe("2027-02");
    expect(monthsAhead(monthKey(expiringDay), 5)).toBe("2027-07");
    expect(monthsAhead(monthKey(expiringDay), 5)).not.toBe(monthKey(expiringDay));
  });

  it("sastav koji test šava koristi daje stvaran datum iz drugog meseca", () => {
    // `monthKey → monthsAhead → monthParts → occurrenceDate`, tačno kao u
    // `tests/novi-seam.test.ts`. Polazni dani su ivice: kraj kratkog meseca,
    // kraj dugog, prelazak godine, prestupni dan.
    const days = [
      "2026-01-31",
      "2026-02-28",
      "2026-07-31",
      "2026-08-31",
      "2026-10-01",
      "2026-11-30",
      "2026-12-01",
      "2026-12-31",
      "2027-12-31",
      "2028-02-29",
      "1900-01-01",
    ];

    for (const day of days) {
      const month = monthsAhead(monthKey(day), 5);
      expect(month, day).not.toBeNull();

      const { year, monthNumber } = monthParts(month!);
      const target = occurrenceDate(year, monthNumber, 17);

      expect(isMonthKey(month!), day).toBe(true);
      expect(monthKey(target), day).toBe(month);
      expect(monthKey(target), day).not.toBe(monthKey(day));
      expect(target, day).toMatch(/^\d{4}-(0[1-9]|1[0-2])-17$/);
    }
  });
});

describe("buildPeople", () => {
  it("prima ugnježdeni profil i kao objekat i kao niz", () => {
    expect(
      buildPeople([
        { user_id: "a", profiles: { display_name: "Ana" } },
        { user_id: "m", profiles: [{ display_name: "Marko" }] },
      ]),
    ).toEqual([
      { id: "a", name: "Ana" },
      { id: "m", name: "Marko" },
    ]);
  });

  it("nedostupan profil dobija rezervno ime, ne prazan natpis", () => {
    expect(
      buildPeople([
        { user_id: "a", profiles: null },
        { user_id: "b", profiles: { display_name: null } },
        { user_id: "c", profiles: { display_name: "   " } },
        { user_id: "d", profiles: [] },
      ]).map((person) => person.name),
    ).toEqual(["Član", "Član", "Član", "Član"]);
  });

  it("ređa po imenu, pa po identifikatoru", () => {
    expect(
      buildPeople([
        { user_id: "z", profiles: { display_name: "Marko" } },
        { user_id: "a", profiles: { display_name: "Marko" } },
        { user_id: "b", profiles: { display_name: "Ana" } },
      ]).map((person) => person.id),
    ).toEqual(["b", "a", "z"]);
  });
});

describe("selectPerson", () => {
  const people = [
    { id: "a", name: "Ana" },
    { id: "m", name: "Marko" },
  ];

  it("bira stvarnog člana domaćinstva", () => {
    expect(selectPerson("m", people)).toEqual({ id: "m", name: "Marko" });
  });

  describe("selectCategory", () => {
    const categories = [
      { id: "food", name: "Hrana" },
      { id: "medicine", name: "Apoteka" },
    ];

    it("bira kategoriju iz domaćinstva", () => {
      expect(selectCategory("medicine", categories)).toEqual({ id: "medicine", name: "Apoteka" });
    });

    it("uzima prvi parametar i ignoriše nepoznatu kategoriju", () => {
      expect(selectCategory(["food", "medicine"], categories)).toEqual({ id: "food", name: "Hrana" });
      expect(selectCategory("nepoznata", categories)).toBeNull();
      expect(selectCategory(undefined, categories)).toBeNull();
    });
  });

  it("nepoznata osoba pada na sve, bez odjeka identifikatora", () => {
    expect(selectPerson("ko-god", people)).toBeNull();
    expect(selectPerson("00000000-0000-0000-0000-000000000000", people)).toBeNull();
    expect(selectPerson("<script>", people)).toBeNull();
  });

  it("prazan ili nedostajući parametar pada na sve", () => {
    expect(selectPerson(undefined, people)).toBeNull();
    expect(selectPerson("", people)).toBeNull();
    expect(selectPerson("   ", people)).toBeNull();
    expect(selectPerson([], people)).toBeNull();
  });

  it("ponovljen parametar uzima prvi", () => {
    expect(selectPerson(["a", "m"], people)).toEqual({ id: "a", name: "Ana" });
  });

  it("član bez imena dobija neprazno rezervno ime", () => {
    expect(selectPerson("x", [{ id: "x", name: "  " }])).toEqual({ id: "x", name: "Član" });
  });

  it("prazan spisak članova nikad ne vraća osobu", () => {
    expect(selectPerson("a", [])).toBeNull();
  });
});
