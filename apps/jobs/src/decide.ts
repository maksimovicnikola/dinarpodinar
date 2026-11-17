import {
  addCalendarDays,
  monthKey,
  occurrenceDate,
  recurrenceInMonth,
  type RecurrenceCadence,
} from "@finance/domain";

export function occurrenceThisMonth(today: string, dayOfMonth: number): string {
  const [year, month] = today.split("-").map(Number);
  return occurrenceDate(year, month, dayOfMonth);
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Dospeća čiji je prozor podsetnika otvoren danas.
 *
 * Prozor traje od dana podsetnika do kraja meseca dospeća. Dospeo, a neunet
 * unos ide ispred onog koji tek stiže. Pozivalac šalje najviše jedan podsetnik
 * po pravilu i preskače ono što je već uneto ili već javljeno.
 */
export function reminderOccurrences(input: {
  today: string;
  dayOfMonth: number;
  remindDays: number;
  cadence?: RecurrenceCadence;
  monthOfYear?: number | null;
}): string[] {
  const cadence = input.cadence ?? "monthly";
  const [year, month] = input.today.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return [];

  const found: string[] = [];
  for (const delta of [-1, 0, 1]) {
    const when = shiftMonth(year, month, delta);
    if (!recurrenceInMonth(cadence, input.monthOfYear ?? null, when.month)) continue;
    const occurrence = occurrenceDate(when.year, when.month, input.dayOfMonth);
    const reminder = addCalendarDays(occurrence, -input.remindDays);
    const open =
      input.today >= reminder &&
      (monthKey(input.today) === monthKey(occurrence) || input.today < occurrence);
    if (open) found.push(occurrence);
  }

  return found.sort((a, b) => {
    const aOver = a <= input.today ? 0 : 1;
    const bOver = b <= input.today ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
