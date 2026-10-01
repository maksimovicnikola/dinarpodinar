/**
 * Model mesečnog pregleda.
 *
 * Ovde se ne računa nijedno finansijsko pravilo: zbir, rečenica, pragovi i
 * dan dospeća u kratkom mesecu dolaze iz `@finance/domain`, da bi telefon i
 * web za isti mesec dali isti rezultat. Ovaj sloj samo bira šta se vidi,
 * kojim redom i pod kojim natpisom.
 */

import {
  addCalendarDays,
  formatMoney,
  limitThresholds,
  occurrenceDate,
  suggest,
  summarizeMonth,
  type CategorySnapshot,
  type EntrySnapshot,
} from "@finance/domain";

import {
  monthNeighbors,
  monthParts,
  FALLBACK_PERSON_NAME,
  type Person,
} from "./month-query";
import type { CategoryRow, EntryDetail, RecurringSnapshot } from "./rows";

const MONTH_NAMES = [
  "januar",
  "februar",
  "mart",
  "april",
  "maj",
  "jun",
  "jul",
  "avgust",
  "septembar",
  "oktobar",
  "novembar",
  "decembar",
] as const;

/** „2026-09“ → „septembar 2026.“ */
export function monthLabel(month: string): string {
  const { year, monthNumber } = monthParts(month);
  return `${MONTH_NAMES[monthNumber - 1]} ${year}.`;
}

/** „2026-09-02“ → „2.9.2026.“ — srpski zapis, bez vodećih nula. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Datum mora biti YYYY-MM-DD.");
  }

  return `${Number(day)}.${Number(month)}.${Number(year)}.`;
}

export type MonthStep = { month: string; label: string };

export type MonthNav = {
  previous: MonthStep | null;
  current: MonthStep;
  next: MonthStep | null;
};

/**
 * Natpisi i odredišta za prebacivač meseca, sastavljeni na jednom mestu.
 *
 * Sused se natpisuje tek pošto se potvrdi da je i sam prihvaćen mesec, pa
 * `1900-01` i `2999-12` nemaju šta da sruše: tamo jednostavno nema linka.
 */
export function buildMonthNav(month: string): MonthNav {
  const neighbors = monthNeighbors(month);
  const step = (value: string | null): MonthStep | null =>
    value === null ? null : { month: value, label: monthLabel(value) };

  return {
    previous: step(neighbors.previous),
    current: { month, label: monthLabel(month) },
    next: step(neighbors.next),
  };
}

function compareNames(a: string, b: string): number {
  if (typeof Intl !== "undefined" && typeof Intl.Collator === "function") {
    return new Intl.Collator("sr").compare(a, b);
  }

  return a.localeCompare(b);
}

/**
 * Osoba je upotrebljiva samo sa nepraznim imenom: domenska unija traži
 * `personId` i `personName` zajedno, a rečenica bez imena ne bi imala smisla.
 * Nepotpun filter zato pada na ceo prikaz umesto da tiho prođe dalje.
 */
function usablePerson(personId?: string, personName?: string): Person | null {
  const id = personId?.trim();
  const name = personName?.trim();

  return id && name ? { id, name } : null;
}

export type MonthBar = {
  /** Jedini stabilan ključ: arhivirana i aktivna kategorija smeju deliti naziv. */
  categoryId: string;
  name: string;
  archived: boolean;
  width: number;
  label: string;
  /** Kategorija ima postavljen limit. Bez njega puna traka ne znači „na limitu“. */
  limited: boolean;
  /** Potrošeno je dostiglo ili prešlo limit. */
  over: boolean;
};

export type MonthAlert = {
  categoryId: string;
  name: string;
  archived: boolean;
  threshold: 80 | 100;
  message: string;
};

export type MonthView = {
  income: string;
  expense: string;
  leftover: string;
  leftoverMinor: number;
  sentence: string;
  bars: MonthBar[];
  /** Ugovor iz briefa: gole rečenice, istim redosledom kao `alertRows`. */
  alerts: string[];
  alertRows: MonthAlert[];
};

export function buildMonthView(input: {
  currency: string;
  month: string;
  /**
   * `archived` je neobavezan: `CategorySnapshot[]` iz briefa i dalje prolazi,
   * a strana koja zna za arhivu dobija oznaku u traci i upozorenju.
   */
  categories: Array<CategorySnapshot & { archived?: boolean }>;
  entries: EntrySnapshot[];
  previous: EntrySnapshot[] | null;
  personId?: string;
  personName?: string;
}): MonthView {
  const archivedById = new Map(
    input.categories.map((category) => [category.id, category.archived === true]),
  );
  const person = usablePerson(input.personId, input.personName);
  const visible = person
    ? input.entries.filter((entry) => entry.personId === person.id)
    : input.entries;

  const summary = summarizeMonth({
    month: input.month,
    categories: input.categories,
    entries: visible,
  });

  // Pragovi su činjenica domaćinstva, ne osobe: limit važi za celu kategoriju
  // troška. Da se računaju iz suženog prikaza, filter po osobi bi sakrio
  // prekoračenje koje svi članovi treba da vide.
  const household = person
    ? summarizeMonth({ month: input.month, categories: input.categories, entries: input.entries })
    : summary;

  const sentence = person
    ? suggest({
        currency: input.currency,
        categories: input.categories,
        current: input.entries,
        previous: input.previous,
        personId: person.id,
        personName: person.name,
      }).sentence
    : suggest({
        currency: input.currency,
        categories: input.categories,
        current: input.entries,
        previous: input.previous,
      }).sentence;

  const bars = summary.categories
    .filter((category) => category.kind === "expense" && category.spentMinor > 0)
    .sort((a, b) => {
      if (a.spentMinor !== b.spentMinor) return b.spentMinor - a.spentMinor;
      const byName = compareNames(a.name, b.name);
      return byName !== 0 ? byName : a.categoryId.localeCompare(b.categoryId);
    })
    .map((category) => {
      const limitMinor = category.limitMinor;
      const ratio = limitMinor
        ? Math.min(100, Math.round((category.spentMinor * 100) / limitMinor))
        : 100;
      const limitLabel = limitMinor ? ` / ${formatMoney(limitMinor, input.currency)}` : "";
      return {
        categoryId: category.categoryId,
        name: category.name,
        archived: archivedById.get(category.categoryId) === true,
        width: ratio,
        label: `${formatMoney(category.spentMinor, input.currency)}${limitLabel}`,
        limited: Boolean(limitMinor),
        over: Boolean(limitMinor) && category.spentMinor >= (limitMinor ?? 0),
      };
    });

  const alertRows = [...household.categories]
    .sort((a, b) => {
      const byName = compareNames(a.name, b.name);
      return byName !== 0 ? byName : a.categoryId.localeCompare(b.categoryId);
    })
    .flatMap((category) =>
      limitThresholds(category.spentMinor, category.limitMinor).map((threshold) => ({
        categoryId: category.categoryId,
        name: category.name,
        archived: archivedById.get(category.categoryId) === true,
        threshold,
        message: `${category.name} je prešla ${threshold}% limita.`,
      })),
    );

  return {
    income: formatMoney(summary.incomeMinor, input.currency),
    expense: formatMoney(summary.expenseMinor, input.currency),
    leftover: formatMoney(summary.leftoverMinor, input.currency),
    leftoverMinor: summary.leftoverMinor,
    sentence,
    bars,
    alerts: alertRows.map((row) => row.message),
    alertRows,
  };
}

const KIND_LABELS = { expense: "Trošak", income: "Prihod" } as const;

export type EntryRow = {
  id: string;
  kind: EntrySnapshot["kind"];
  kindLabel: string;
  amount: string;
  categoryName: string;
  categoryArchived: boolean;
  personName: string;
  occurredOn: string;
  date: string;
  note: string;
  automatic: boolean;
};

/**
 * Lista unosa vidljivog meseca. Arhivirana kategorija ostaje u istoriji —
 * samo je označena, da se vidi zašto se više ne nudi pri unosu.
 */
export function buildEntryList(input: {
  currency: string;
  month: string;
  categories: readonly CategoryRow[];
  entries: readonly EntryDetail[];
  personId?: string;
}): EntryRow[] {
  const byId = new Map(input.categories.map((category) => [category.id, category]));
  const personId = input.personId?.trim();

  return input.entries
    .filter((entry) => entry.occurredOn.slice(0, 7) === input.month)
    .filter((entry) => !personId || entry.personId === personId)
    .sort((a, b) => {
      if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
      if (a.amountMinor !== b.amountMinor) return b.amountMinor - a.amountMinor;
      return a.id.localeCompare(b.id);
    })
    .map((entry) => {
      const category = byId.get(entry.categoryId);
      return {
        id: entry.id,
        kind: entry.kind,
        kindLabel: KIND_LABELS[entry.kind],
        amount: formatMoney(entry.amountMinor, input.currency),
        categoryName: category?.name ?? "Bez kategorije",
        categoryArchived: category?.archived ?? false,
        personName: entry.personName.trim() || FALLBACK_PERSON_NAME,
        occurredOn: entry.occurredOn,
        date: formatDate(entry.occurredOn),
        note: entry.note.trim(),
        automatic: entry.recurringRuleId !== null,
      };
    });
}

export type UpcomingState = "uneto" | "prošlo" | "danas" | "predstoji";

export type UpcomingRow = {
  id: string;
  kind: EntrySnapshot["kind"];
  kindLabel: string;
  amount: string;
  categoryName: string;
  personName: string;
  dueOn: string;
  dueDate: string;
  remindOn: string;
  remindDate: string;
  state: UpcomingState;
  label: string;
};

const STATE_LABELS: Record<UpcomingState, string> = {
  uneto: "Uneto",
  prošlo: "Dospelo",
  danas: "Danas",
  predstoji: "Predstoji",
};

/**
 * Dospeća aktivnih pravila u vidljivom mesecu, sa danom podsetnika.
 *
 * Dan 31 u mesecu koji ga nema postaje poslednji dan tog meseca — to radi
 * `occurrenceDate`, ista funkcija koju koristi i mesečni posao, pa pregled i
 * posao ne mogu da se raziđu. Podsetnik sme da padne u prethodni mesec.
 */
export function buildUpcoming(input: {
  currency: string;
  month: string;
  today: string;
  categories: readonly CategoryRow[];
  people: readonly Person[];
  rules: readonly RecurringSnapshot[];
  entries: readonly EntryDetail[];
  personId?: string;
}): UpcomingRow[] {
  const { year, monthNumber } = monthParts(input.month);
  const categoryById = new Map(input.categories.map((category) => [category.id, category.name]));
  const personById = new Map(input.people.map((person) => [person.id, person.name]));
  const settled = new Set(
    input.entries
      .filter((entry) => entry.recurringRuleId !== null && entry.occurredOn.slice(0, 7) === input.month)
      .map((entry) => entry.recurringRuleId as string),
  );
  const personId = input.personId?.trim();

  return input.rules
    .filter((rule) => !personId || rule.personId === personId)
    .map((rule) => {
      const dueOn = occurrenceDate(year, monthNumber, rule.dayOfMonth);
      const remindOn = addCalendarDays(dueOn, -rule.remindDays);
      const state: UpcomingState = settled.has(rule.id)
        ? "uneto"
        : dueOn === input.today
          ? "danas"
          : dueOn < input.today
            ? "prošlo"
            : "predstoji";

      return {
        id: rule.id,
        kind: rule.kind,
        kindLabel: KIND_LABELS[rule.kind],
        amount: formatMoney(rule.amountMinor, input.currency),
        categoryName: categoryById.get(rule.categoryId) ?? "Bez kategorije",
        personName: personById.get(rule.personId) ?? FALLBACK_PERSON_NAME,
        dueOn,
        dueDate: formatDate(dueOn),
        remindOn,
        remindDate: formatDate(remindOn),
        state,
        label: STATE_LABELS[state],
      };
    })
    .sort((a, b) => {
      if (a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
      const byCategory = compareNames(a.categoryName, b.categoryName);
      return byCategory !== 0 ? byCategory : a.id.localeCompare(b.id);
    });
}
