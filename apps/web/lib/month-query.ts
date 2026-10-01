/**
 * Čitanje `?month=` i `?person=` iz adrese mesečnog pregleda.
 *
 * Oba parametra sastavlja korisnik, pa nijedan ne sme da stigne do baze ni do
 * `new Date(...)` neproveren. Mesec koji nije tačno `YYYY-MM` sa stvarnim
 * mesecom pada na tekući; osoba koja nije član domaćinstva pada na „svi“, i
 * nepoznat identifikator se nigde ne ispisuje.
 */

import { monthKey } from "@finance/domain";

import { firstParam } from "./next-path";

/** Rezervno ime kad profil nije dostupan. Isto kao rezerva u `handle_new_user`. */
export const FALLBACK_PERSON_NAME = "Član";

export type Person = { id: string; name: string };

/**
 * Tačno četiri cifre godine i mesec 01..12. Bez ovoga `"2026-13"` prođe do
 * `occurrenceDate` i daje datum iz sledeće godine, a `"2026-9"` do `Number`
 * i daje `NaN`.
 */
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * `Date.UTC` preslikava godine 0–99 u 1900–1999, pa bi `"0012-02"` računao
 * dužinu februara 1912. Opseg je zato eksplicitan.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

export function isMonthKey(raw: unknown): raw is string {
  if (typeof raw !== "string") {
    return false;
  }

  const match = MONTH_KEY.exec(raw);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/** Mesec iz adrese, ili tekući mesec ako adresa nosi nešto drugo. */
export function monthParam(raw: string | string[] | undefined, today: string): string {
  const value = firstParam(raw);
  return isMonthKey(value) ? value : monthKey(today);
}

function splitMonth(month: string): { year: number; monthNumber: number } {
  if (!isMonthKey(month)) {
    throw new Error("Mesec mora biti u obliku YYYY-MM.");
  }

  return { year: Number(month.slice(0, 4)), monthNumber: Number(month.slice(5, 7)) };
}

export function monthParts(month: string): { year: number; monthNumber: number } {
  return splitMonth(month);
}

/** Mesec koji je izvan prihvaćenog prozora ne postoji za ovu aplikaciju. */
function withinWindow(month: string): string | null {
  return isMonthKey(month) ? month : null;
}

/**
 * Prethodni mesec, ili `null` na donjoj ivici prozora.
 *
 * `1900-01` je prihvaćen mesec, ali `1899-12` nije. Da se ovde vrati niska,
 * svaki sledeći korak (natpis, link, upit) radio bi sa ključem koji sopstveni
 * validator odbija, pa bi `monthLabel` bacio usred iscrtavanja strane.
 */
export function previousMonthKey(month: string): string | null {
  const { year, monthNumber } = splitMonth(month);

  return withinWindow(
    monthNumber === 1
      ? `${String(year - 1).padStart(4, "0")}-12`
      : `${String(year).padStart(4, "0")}-${String(monthNumber - 1).padStart(2, "0")}`,
  );
}

/** Sledeći mesec, ili `null` na gornjoj ivici prozora (`2999-12`). */
export function nextMonthKey(month: string): string | null {
  const { year, monthNumber } = splitMonth(month);

  return withinWindow(
    monthNumber === 12
      ? `${String(year + 1).padStart(4, "0")}-01`
      : `${String(year).padStart(4, "0")}-${String(monthNumber + 1).padStart(2, "0")}`,
  );
}

export type MonthNeighbors = { previous: string | null; next: string | null };

/** Oba suseda u jednom prolazu — strana ih računa jednom i deli svim mestima. */
export function monthNeighbors(month: string): MonthNeighbors {
  return { previous: previousMonthKey(month), next: nextMonthKey(month) };
}

/**
 * Mesec `count` koraka unapred, ili `null` ako izlazi iz prihvaćenog prozora.
 *
 * Korak po korak kroz `nextMonthKey`, pa se ni prelazak godine ni gornja ivica
 * prozora ne prepisuju ovde. Bez ovoga svako ko traži „nekoliko meseci unapred“
 * piše svoju aritmetiku nad `Number(month.slice(5, 7)) + n`, koja na decembru
 * daje trinaesti mesec.
 */
export function monthsAhead(month: string, count: number): string | null {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Broj meseci mora biti ceo broj koji nije negativan.");
  }

  // Ulaz se potvrđuje i kad nema nijednog koraka, da `monthsAhead(x, 0)` ne
  // bude jedini put kojim neispravan mesec prođe dalje.
  monthParts(month);

  let current = month;
  for (let step = 0; step < count; step += 1) {
    const next = nextMonthKey(current);
    if (next === null) {
      return null;
    }
    current = next;
  }

  return current;
}

type MembershipRow = {
  user_id: string;
  profiles: { display_name: string | null } | Array<{ display_name: string | null }> | null;
};

function collator(): Intl.Collator | null {
  if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
    return null;
  }

  return new Intl.Collator("sr");
}

/**
 * Članovi domaćinstva kao spisak za filter. PostgREST ugnježdeni `profiles`
 * stiže kao objekat ili kao niz, zavisno od toga kako razreši relaciju, pa se
 * oba oblika primaju. Ime je uvek neprazno: domen traži neprazno ime uz
 * `personId`, a prazan natpis u navigaciji ne bi bio kliktljiv.
 */
export function buildPeople(rows: readonly MembershipRow[]): Person[] {
  const compare = collator();

  return rows
    .map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.user_id,
        name: (profile?.display_name ?? "").trim() || FALLBACK_PERSON_NAME,
      };
    })
    .sort((a, b) => {
      const byName = compare ? compare.compare(a.name, b.name) : a.name.localeCompare(b.name);
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
}

/**
 * Izabrana osoba, samo ako je stvarni član ovog domaćinstva. Nepoznat
 * identifikator vraća `null` — prikaz pada na „svi“ i sam identifikator se ne
 * vraća nazad u stranu.
 */
export function selectPerson(
  raw: string | string[] | undefined,
  people: readonly Person[],
): Person | null {
  const id = firstParam(raw)?.trim();
  if (!id) {
    return null;
  }

  const match = people.find((person) => person.id === id);
  if (!match) {
    return null;
  }

  return { id: match.id, name: match.name.trim() || FALLBACK_PERSON_NAME };
}
