import {
  assertPositiveMinor,
  type CategorySnapshot,
  type EntryKind,
  type EntrySnapshot,
} from "@finance/domain";

/** Kategorija sa zastavicom arhive: istorija je i dalje prikazuje, nov unos ne. */
export type CategoryRow = CategorySnapshot & { archived: boolean };

/** Unos sa poljima koja domenu ne trebaju, ali se vide u listi meseca. */
export type EntryDetail = EntrySnapshot & { note: string; recurringRuleId: string | null };

/** Ponavljajuće pravilo bez imena — naziv kategorije i osobe se traže u pregledu. */
export type RecurringSnapshot = {
  id: string;
  kind: EntryKind;
  amountMinor: number;
  categoryId: string;
  personId: string;
  note: string;
  dayOfMonth: number;
  remindDays: number;
};

export function toCategorySnapshot(row: {
  id: string;
  name: string;
  kind: "expense" | "income";
  limit_minor: number | null;
}): CategorySnapshot {
  return { id: row.id, name: row.name, kind: row.kind, limitMinor: row.limit_minor };
}

export function toCategoryRow(row: {
  id: string;
  name: string;
  kind: "expense" | "income";
  limit_minor: number | null;
  archived: boolean;
}): CategoryRow {
  return { ...toCategorySnapshot(row), archived: row.archived };
}

export function toEntrySnapshot(row: {
  id: string;
  kind: "expense" | "income";
  amount_minor: number;
  category_id: string;
  person_id: string;
  person_name: string;
  occurred_on: string;
}): EntrySnapshot {
  return {
    id: row.id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    categoryId: row.category_id,
    personId: row.person_id,
    personName: row.person_name,
    occurredOn: row.occurred_on,
  };
}

export function toEntryDetail(row: {
  id: string;
  kind: "expense" | "income";
  amount_minor: number;
  category_id: string;
  person_id: string;
  person_name: string;
  occurred_on: string;
  note: string | null;
  recurring_rule_id: string | null;
}): EntryDetail {
  return {
    ...toEntrySnapshot(row),
    note: row.note ?? "",
    recurringRuleId: row.recurring_rule_id,
  };
}

export function toRecurringSnapshot(row: {
  id: string;
  kind: "expense" | "income";
  amount_minor: number;
  category_id: string;
  person_id: string;
  note: string | null;
  day_of_month: number;
  remind_days: number;
}): RecurringSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    amountMinor: row.amount_minor,
    categoryId: row.category_id,
    personId: row.person_id,
    note: row.note ?? "",
    dayOfMonth: row.day_of_month,
    remindDays: row.remind_days,
  };
}

/**
 * Konvertuje srpski zapis iznosa u pare (minor jedinice) bez grešaka zaokruživanja.
 *
 * Podržani formati:
 *   "4.200"     → 420000   (tačka = separator hiljada)
 *   "12,50"     → 1250     (zarez = decimalni separator)
 *   "1.000,50"  → 100050   (kombinovani format)
 *   "0,50"      → 50       (sub-dinarni iznos; jedini validni oblik s vodećom nulom)
 *   "100"       → 10000
 *
 * Odbija: nulu, negativne, vodeće nule (osim "0" ispred zareza), pogrešno
 *         grupisane hiljade, više od 2 decimale, nenumerički unos,
 *         nesigurne ili nencelobrojne rezultate.
 */
export function majorToMinor(raw: string): number {
  const s = raw.trim();

  // Odbij prazne i negativne vrednosti odmah
  if (!s || s.startsWith("-")) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }

  // Razdvoji na celobrojni i decimalni deo (zarez = decimalni separator)
  const commaParts = s.split(",");
  if (commaParts.length > 2) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }

  const intPartRaw = commaParts[0] ?? "";
  const fracPartRaw = commaParts[1]; // undefined ako nema zareza

  // Validacija decimalnog dela: 1–2 cifre
  if (fracPartRaw !== undefined) {
    if (!/^\d{1,2}$/.test(fracPartRaw)) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
  }

  // Validacija celobrojnog dela s opcionalnim separatorima hiljada (tačka).
  // Vodeće nule su zabranjene osim tačno "0" (npr. "0,50" = 50 para je validno).
  const dotGroups = intPartRaw.split(".");
  if (dotGroups.length === 1) {
    // Bez separatora — "0" ili broj koji počinje nenultom cifrom
    if (intPartRaw !== "0" && !/^[1-9]\d*$/.test(intPartRaw)) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
  } else {
    // Sa separatorima — prva grupa 1–3 cifre bez vodećih nula, svaka sledeća tačno 3 cifre
    if (!/^[1-9]\d{0,2}$/.test(dotGroups[0] ?? "")) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
    for (let i = 1; i < dotGroups.length; i++) {
      if (!/^\d{3}$/.test(dotGroups[i] ?? "")) {
        throw new Error("Iznos mora biti pozitivan ceo broj.");
      }
    }
  }

  // Celobrojno množenje — bez floating-point grešaka
  const intDigits = intPartRaw.replace(/\./g, "");
  const majorInt = BigInt(intDigits);
  let minorBig = majorInt * 100n;

  if (fracPartRaw !== undefined) {
    // Pad na 2 cifre: "5" → "50" (50 para), "50" → "50"
    const fracPadded = fracPartRaw.padEnd(2, "0");
    minorBig += BigInt(fracPadded);
  }

  // Mora biti pozitivan i siguran ceo broj
  if (minorBig <= 0n || minorBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }

  const result = Number(minorBig);
  // assertPositiveMinor kao poslednji bezbednosni sloj
  assertPositiveMinor(result);
  return result;
}

export function canManage(role: string): boolean {
  return role === "owner";
}
