import { formatMoney } from "./money";
import type { CategorySnapshot, EntrySnapshot } from "./types";

export type Suggestion = { sentence: string };
type SuggestInputBase = {
  currency: string;
  categories: CategorySnapshot[];
  current: EntrySnapshot[];
  previous: EntrySnapshot[] | null;
};
type SuggestInput =
  | (SuggestInputBase & {
      personId: string;
      personName: string;
    })
  | (SuggestInputBase & {
      personId?: undefined;
      personName?: undefined;
    });

export function growthFloorMinor(currency: string): number {
  return currency === "RSD" ? 100_000 : 1_000;
}

export function limitThresholds(
  spentMinor: number,
  limitMinor: number | null,
): Array<80 | 100> {
  if (limitMinor == null || limitMinor <= 0) return [];
  const hit: Array<80 | 100> = [];
  if (spentMinor * 10 >= limitMinor * 8) hit.push(80);
  if (spentMinor >= limitMinor) hit.push(100);
  return hit;
}

export type LimitState = "free" | "ok" | "near" | "over";

export function limitState(spentMinor: number, limitMinor: number | null): LimitState {
  if (limitMinor == null || limitMinor <= 0) return "free";
  const hit = limitThresholds(spentMinor, limitMinor);
  if (hit.includes(100)) return "over";
  if (hit.includes(80)) return "near";
  return "ok";
}

type PersonRollup = { id: string; name: string; amountMinor: number; entryCount: number };

type Rollup = {
  category: CategorySnapshot;
  spentMinor: number;
  previousMinor: number;
  people: PersonRollup[];
};

function compareSr(a: string, b: string): number {
  if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
    throw new Error("Okruženje mora podržavati srpsko sortiranje (Intl.Collator, locale sr).");
  }
  if (typeof Intl.Collator.supportedLocalesOf !== "function") {
    throw new Error("Okruženje mora podržavati srpsko sortiranje (Intl.Collator.supportedLocalesOf).");
  }
  if (Intl.Collator.supportedLocalesOf("sr").length === 0) {
    throw new Error("Okruženje mora podržavati srpsko sortiranje (locale sr).");
  }
  const collator = new Intl.Collator("sr");
  if (!collator.resolvedOptions().locale.toLowerCase().startsWith("sr")) {
    throw new Error("Okruženje mora imati srpsko sortiranje kao aktivan locale (sr).");
  }
  return collator.compare(a, b);
}

function expenseEntries(entries: EntrySnapshot[], categoryId: string): EntrySnapshot[] {
  return entries.filter((entry) => entry.kind === "expense" && entry.categoryId === categoryId);
}

function rollupPeople(entries: EntrySnapshot[]): PersonRollup[] {
  const map = new Map<string, PersonRollup>();
  for (const entry of entries) {
    const current = map.get(entry.personId) ?? {
      id: entry.personId,
      name: entry.personName,
      amountMinor: 0,
      entryCount: 0,
    };
    current.amountMinor += entry.amountMinor;
    current.entryCount += 1;
    map.set(entry.personId, current);
  }
  return [...map.values()];
}

function firstOrThrow<T>(values: T[], message: string): T {
  const value = values[0];
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function topPerson(people: PersonRollup[]): PersonRollup {
  return firstOrThrow(
    [...people].sort((a, b) => {
      if (a.amountMinor !== b.amountMinor) return b.amountMinor - a.amountMinor;
      if (a.entryCount !== b.entryCount) return b.entryCount - a.entryCount;
      return compareSr(a.name, b.name);
    }),
    "Nije moguće odrediti osobu sa najvećim troškom.",
  );
}

function pick(rows: Rollup[], score: (row: Rollup) => number): Rollup {
  return firstOrThrow(
    [...rows].sort((a, b) => {
      const delta = score(b) - score(a);
      if (delta !== 0) return delta;
      if (a.spentMinor !== b.spentMinor) return b.spentMinor - a.spentMinor;
      return compareSr(a.category.name, b.category.name);
    }),
    "Nije moguće odrediti vodeću kategoriju.",
  );
}

function positiveLimit(limitMinor: number | null): number | null {
  if (limitMinor == null || limitMinor <= 0) return null;
  return limitMinor;
}

export function suggest(input: SuggestInput): Suggestion {
  if (input.personId !== undefined) {
    const knownExpenseCategoryIds = new Set(
      input.categories
        .filter((category) => category.kind === "expense")
        .map((category) => category.id),
    );
    const ownExpenses = input.current.filter(
      (entry) => entry.kind === "expense" && entry.personId === input.personId,
    );
    const own = ownExpenses.filter((entry) => knownExpenseCategoryIds.has(entry.categoryId));
    const name = input.personName;
    if (own.length === 0) {
      return { sentence: `${name} nema troškove u ovom mesecu.` };
    }

    const byCategory = input.categories
      .filter((category) => category.kind === "expense")
      .map((category) => ({
        category,
        entries: own.filter((entry) => entry.categoryId === category.id),
      }))
      .filter((row) => row.entries.length > 0);

    const winner = firstOrThrow(
      [...byCategory].sort((a, b) => {
        const aSum = a.entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
        const bSum = b.entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
        if (aSum !== bSum) return bSum - aSum;
        if (a.entries.length !== b.entries.length) return b.entries.length - a.entries.length;
        return compareSr(a.category.name, b.category.name);
      }),
      "Nije moguće odrediti kategoriju za izabranu osobu.",
    );

    const sum = winner.entries.reduce((total, entry) => total + entry.amountMinor, 0);
    return {
      sentence: `${name} ima najviše u kategoriji ${winner.category.name}: ${formatMoney(sum, input.currency)}.`,
    };
  }

  const rows: Rollup[] = input.categories
    .filter((category) => category.kind === "expense")
    .map((category) => {
      const current = expenseEntries(input.current, category.id);
      const previous = input.previous ? expenseEntries(input.previous, category.id) : [];
      return {
        category,
        spentMinor: current.reduce((sum, entry) => sum + entry.amountMinor, 0),
        previousMinor: previous.reduce((sum, entry) => sum + entry.amountMinor, 0),
        people: rollupPeople(current),
      };
    })
    .filter((row) => row.spentMinor > 0);

  const over = rows.filter((row) => {
    const limitMinor = positiveLimit(row.category.limitMinor);
    return limitMinor != null && row.spentMinor > limitMinor;
  });
  if (over.length > 0) {
    const winner = pick(over, (row) => row.spentMinor - (positiveLimit(row.category.limitMinor) ?? 0));
    const person = topPerson(winner.people);
    const limitMinor = positiveLimit(winner.category.limitMinor) ?? 0;
    const overMinor = winner.spentMinor - limitMinor;
    return {
      sentence: `${winner.category.name} je ${formatMoney(overMinor, input.currency)} preko limita. Najveći deo: ${person.name}.`,
    };
  }

  const near = rows.filter((row) => {
    const limitMinor = positiveLimit(row.category.limitMinor);
    return limitMinor != null && limitThresholds(row.spentMinor, limitMinor).includes(80);
  });
  if (near.length > 0) {
    const winner = pick(near, (row) => row.spentMinor / (positiveLimit(row.category.limitMinor) ?? 1));
    const person = topPerson(winner.people);
    const limitMinor = positiveLimit(winner.category.limitMinor) ?? 1;
    const percent = Math.floor((winner.spentMinor * 100) / limitMinor);
    return {
      sentence: `${winner.category.name} je na ${percent}% limita. Najveći deo: ${person.name}.`,
    };
  }

  if (input.previous) {
    const floor = growthFloorMinor(input.currency);
    const grown = rows.filter((row) => {
      if (row.previousMinor <= 0) return false;
      const increase = row.spentMinor - row.previousMinor;
      return increase * 10 >= row.previousMinor && increase >= floor;
    });
    if (grown.length > 0) {
      const winner = pick(grown, (row) => row.spentMinor - row.previousMinor);
      const person = topPerson(winner.people);
      const increase = winner.spentMinor - winner.previousMinor;
      return {
        sentence: `Potrošnja u kategoriji ${winner.category.name} je veća za ${formatMoney(increase, input.currency)} nego prošlog meseca. Najveći deo: ${person.name}.`,
      };
    }
  }

  return { sentence: "Ovaj mesec je unutar limita." };
}
