import { describe, expect, it } from "vitest";

import {
  buildPeople,
  isMonthKey,
  monthParam,
  monthParts,
  nextMonthKey,
  previousMonthKey,
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
