import {
  assertPositiveMinor,
  type CategorySnapshot,
  type EntrySnapshot,
} from "@finance/domain";

export function toCategorySnapshot(row: {
  id: string;
  name: string;
  kind: "expense" | "income";
  limit_minor: number | null;
}): CategorySnapshot {
  return { id: row.id, name: row.name, kind: row.kind, limitMinor: row.limit_minor };
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

  if (!s || s.startsWith("-")) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }

  const commaParts = s.split(",");
  if (commaParts.length > 2) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }

  const intPartRaw = commaParts[0] ?? "";
  const fracPartRaw = commaParts[1];

  if (fracPartRaw !== undefined) {
    if (!/^\d{1,2}$/.test(fracPartRaw)) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
  }

  const dotGroups = intPartRaw.split(".");
  if (dotGroups.length === 1) {
    if (intPartRaw !== "0" && !/^[1-9]\d*$/.test(intPartRaw)) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
  } else {
    if (!/^[1-9]\d{0,2}$/.test(dotGroups[0] ?? "")) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
    for (let i = 1; i < dotGroups.length; i++) {
      if (!/^\d{3}$/.test(dotGroups[i] ?? "")) {
        throw new Error("Iznos mora biti pozitivan ceo broj.");
      }
    }
  }

  const intDigits = intPartRaw.replace(/\./g, "");
  const majorInt = BigInt(intDigits);
  let minorBig = majorInt * 100n;

  if (fracPartRaw !== undefined) {
    const fracPadded = fracPartRaw.padEnd(2, "0");
    minorBig += BigInt(fracPadded);
  }

  if (minorBig <= 0n || minorBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Iznos mora biti pozitivan ceo broj.");
  }

  const result = Number(minorBig);
  assertPositiveMinor(result);
  return result;
}
