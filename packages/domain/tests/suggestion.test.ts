import { describe, expect, it } from "vitest";
import { growthFloorMinor, limitThresholds, suggest } from "../src/suggestion";
import type { CategorySnapshot, EntrySnapshot } from "../src/types";

const food: CategorySnapshot = {
  id: "food",
  name: "Hrana",
  kind: "expense",
  limitMinor: 1_000_000,
};
const transport: CategorySnapshot = {
  id: "tr",
  name: "Prevoz",
  kind: "expense",
  limitMinor: 200_000,
};
const bills: CategorySnapshot = {
  id: "bills",
  name: "Računi",
  kind: "expense",
  limitMinor: null,
};
const pay: CategorySnapshot = {
  id: "pay",
  name: "Plata",
  kind: "income",
  limitMinor: null,
};

function expense(
  partial: Partial<EntrySnapshot> & Pick<EntrySnapshot, "id" | "amountMinor" | "categoryId">,
): EntrySnapshot {
  return {
    kind: "expense",
    personId: "marko",
    personName: "Marko",
    occurredOn: "2026-09-01",
    ...partial,
  };
}

describe("limitThresholds", () => {
  it("tačno 80% šalje samo 80", () => {
    expect(limitThresholds(800_000, 1_000_000)).toEqual([80]);
  });

  it("ispod 80% ne šalje ništa", () => {
    expect(limitThresholds(799_999, 1_000_000)).toEqual([]);
  });

  it("tačno 100% šalje 80 i 100", () => {
    expect(limitThresholds(1_000_000, 1_000_000)).toEqual([80, 100]);
  });

  it("kategorija bez limita ne šalje obaveštenje", () => {
    expect(limitThresholds(5_000_000, null)).toEqual([]);
  });
});

describe("growthFloorMinor", () => {
  it("RSD je 1000 dinara, ostale valute 10 jedinica", () => {
    expect(growthFloorMinor("RSD")).toBe(100_000);
    expect(growthFloorMinor("EUR")).toBe(1_000);
  });
});

describe("suggest", () => {
  it("prekoračenje pobeđuje blizinu i rast", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food, transport],
      current: [
        expense({ id: "1", categoryId: "food", amountMinor: 1_420_000 }),
        expense({
          id: "2",
          categoryId: "tr",
          amountMinor: 180_000,
          personId: "ana",
          personName: "Ana",
        }),
      ],
      previous: [expense({ id: "p", categoryId: "tr", amountMinor: 10_000 })],
    }).sentence;
    expect(sentence).toBe("Hrana je 4.200 RSD preko limita. Najveći deo: Marko.");
  });

  it("na 85% bira blizinu kad niko nije prešao limit", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [transport],
      current: [
        expense({
          id: "1",
          categoryId: "tr",
          amountMinor: 170_000,
          personId: "ana",
          personName: "Ana",
        }),
      ],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Prevoz je na 85% limita. Najveći deo: Ana.");
  });

  it("tačno 80% je blizina", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food],
      current: [expense({ id: "1", categoryId: "food", amountMinor: 800_000 })],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Hrana je na 80% limita. Najveći deo: Marko.");
  });

  it("tačno 100% je i dalje blizina", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food],
      current: [expense({ id: "1", categoryId: "food", amountMinor: 1_000_000 })],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Hrana je na 100% limita. Najveći deo: Marko.");
  });

  it("rast ulazi samo preko oba praga", () => {
    const grown = suggest({
      currency: "RSD",
      categories: [bills],
      current: [
        expense({
          id: "1",
          categoryId: "bills",
          amountMinor: 1_300_000,
          personId: "ana",
          personName: "Ana",
        }),
      ],
      previous: [expense({ id: "p", categoryId: "bills", amountMinor: 1_000_000 })],
    }).sentence;
    expect(grown).toBe(
      "Potrošnja u kategoriji Računi je veća za 3.000 RSD nego prošlog meseca. Najveći deo: Ana.",
    );

    const tooSmall = suggest({
      currency: "RSD",
      categories: [bills],
      current: [expense({ id: "1", categoryId: "bills", amountMinor: 560_000 })],
      previous: [expense({ id: "p", categoryId: "bills", amountMinor: 500_000 })],
    }).sentence;
    expect(tooSmall).toBe("Ovaj mesec je unutar limita.");
  });

  it("rast ispod 10% ostaje miran", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [bills],
      current: [expense({ id: "1", categoryId: "bills", amountMinor: 1_099_999 })],
      previous: [expense({ id: "p", categoryId: "bills", amountMinor: 1_000_000 })],
    }).sentence;
    expect(sentence).toBe("Ovaj mesec je unutar limita.");
  });

  it("rast na tačno 10% i tačnom apsolutnom pragu prolazi", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [bills],
      current: [expense({ id: "1", categoryId: "bills", amountMinor: 1_100_000 })],
      previous: [expense({ id: "p", categoryId: "bills", amountMinor: 1_000_000 })],
    }).sentence;
    expect(sentence).toBe(
      "Potrošnja u kategoriji Računi je veća za 1.000 RSD nego prošlog meseca. Najveći deo: Marko.",
    );
  });

  it("EUR prag je 10 evra", () => {
    const sentence = suggest({
      currency: "EUR",
      categories: [bills],
      current: [expense({ id: "1", categoryId: "bills", amountMinor: 5_600 })],
      previous: [expense({ id: "p", categoryId: "bills", amountMinor: 5_000 })],
    }).sentence;
    expect(sentence).toBe("Ovaj mesec je unutar limita.");
  });

  it("prvi mesec ne poredi rast", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [bills],
      current: [expense({ id: "1", categoryId: "bills", amountMinor: 5_000_000 })],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Ovaj mesec je unutar limita.");
  });

  it("nerešeno prekoračenje bira veći trošak, pa ime", () => {
    const alpha: CategorySnapshot = {
      id: "a",
      name: "Hrana",
      kind: "expense",
      limitMinor: 100_000,
    };
    const beta: CategorySnapshot = {
      id: "b",
      name: "Prevoz",
      kind: "expense",
      limitMinor: 100_000,
    };
    const sentence = suggest({
      currency: "RSD",
      categories: [beta, alpha],
      current: [
        expense({ id: "1", categoryId: "a", amountMinor: 150_000 }),
        expense({ id: "2", categoryId: "b", amountMinor: 150_000 }),
      ],
      previous: null,
    }).sentence;
    expect(sentence.startsWith("Hrana je 500 RSD preko limita.")).toBe(true);
  });

  it("nerešene osobe bira onu sa više unosa", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food],
      current: [
        expense({
          id: "1",
          categoryId: "food",
          amountMinor: 900_000,
          personId: "ana",
          personName: "Ana",
        }),
        expense({
          id: "2",
          categoryId: "food",
          amountMinor: 450_000,
          personId: "marko",
          personName: "Marko",
        }),
        expense({
          id: "3",
          categoryId: "food",
          amountMinor: 450_000,
          personId: "marko",
          personName: "Marko",
        }),
      ],
      previous: null,
    }).sentence;
    expect(sentence.endsWith("Najveći deo: Marko.")).toBe(true);
  });

  it("prihod se ignoriše", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [pay, food],
      current: [expense({ id: "1", kind: "income", categoryId: "pay", amountMinor: 9_000_000 })],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Ovaj mesec je unutar limita.");
  });

  it("filter osobe imenuje njenu najveću kategoriju", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food, transport],
      personId: "marko",
      current: [
        expense({ id: "1", categoryId: "food", amountMinor: 1_240_000 }),
        expense({
          id: "2",
          categoryId: "tr",
          amountMinor: 10_000,
          personId: "ana",
          personName: "Ana",
        }),
      ],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Marko ima najviše u kategoriji Hrana: 12.400 RSD.");
  });

  it("osoba bez troška dobija praznu rečenicu", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food],
      personId: "ana",
      personName: "Ana",
      current: [expense({ id: "1", categoryId: "food", amountMinor: 100_000 })],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Ana nema troškove u ovom mesecu.");
  });

  it("filter osobe ignoriše trošak bez poznate expense kategorije", () => {
    const sentence = suggest({
      currency: "RSD",
      categories: [food],
      personId: "ana",
      personName: "Ana",
      current: [
        expense({
          id: "1",
          categoryId: "unknown",
          amountMinor: 200_000,
          personId: "ana",
          personName: "Ana",
        }),
      ],
      previous: null,
    }).sentence;
    expect(sentence).toBe("Ana nema troškove u ovom mesecu.");
  });
});
