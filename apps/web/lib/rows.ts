import { assertPositiveMinor, type CategorySnapshot, type EntrySnapshot } from "@finance/domain";

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
 *   "4.200"   → 420000  (tačka = separator hiljada)
 *   "12,50"   → 1250    (zarez = decimalni separator)
 *   "100"     → 10000
 *   "1.234.567" → 123456700
 *
 * Odbija: nulu, negativne, pogrešno grupisane hiljade, više od 2 decimale,
 *         nenumerički unos, nesigurne ili nencelobrojne rezultate.
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

  // Validacija celobrojnog dela s opcionalnim separatorima hiljada (tačka)
  const dotGroups = intPartRaw.split(".");
  if (dotGroups.length === 1) {
    // Bez separatora — sve cifre
    if (!/^\d+$/.test(intPartRaw)) {
      throw new Error("Iznos mora biti pozitivan ceo broj.");
    }
  } else {
    // Sa separatorima — prva grupa 1–3 cifre, svaka sledeća tačno 3 cifre
    if (!/^\d{1,3}$/.test(dotGroups[0] ?? "")) {
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
