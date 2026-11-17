export function todayInBelgrade(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  let year: string | null = null;
  let month: string | null = null;
  let day: string | null = null;
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  if (year == null || month == null || day == null) {
    throw new Error("Okruženje mora podržavati kompletan Europe/Belgrade datum.");
  }
  return `${year}-${month}-${day}`;
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function clampDayOfMonth(year: number, month: number, day: number): number {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, last);
}

export function assertDayOfMonth(dayOfMonth: number): void {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error("Dan u mesecu mora biti ceo broj od 1 do 31.");
  }
}

function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Mesec mora biti ceo broj od 1 do 12.");
  }
}

export function occurrenceDate(year: number, month: number, dayOfMonth: number): string {
  assertMonth(month);
  assertDayOfMonth(dayOfMonth);
  const day = clampDayOfMonth(year, month, dayOfMonth);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [yearText, monthText, dayText] = isoDate.split("-");
  if (yearText == null || monthText == null || dayText == null) {
    throw new Error("Datum mora biti YYYY-MM-DD.");
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function assertRemindDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error("Podsetnik je od 1 do 7 dana.");
  }
}

export type RecurrenceCadence = "monthly" | "yearly";

export const MONTH_GENITIVE = [
  "januara",
  "februara",
  "marta",
  "aprila",
  "maja",
  "juna",
  "jula",
  "avgusta",
  "septembra",
  "oktobra",
  "novembra",
  "decembra",
] as const;

/**
 * Datum dospeća u posmatranom mesecu (`YYYY-MM`), ili `null` ako pravilo
 * tog meseca nema dospeće. Dan 31 i 29. februar skraćuje `occurrenceDate`.
 */
export function occurrenceInMonth(
  month: string,
  dayOfMonth: number,
  cadence: RecurrenceCadence,
  monthOfYear: number | null,
): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (match == null) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!recurrenceInMonth(cadence, monthOfYear, monthNumber)) return null;
  return occurrenceDate(year, monthNumber, dayOfMonth);
}

/** Mesečno pravilo važi svakog meseca. Godišnje samo u svom mesecu (1–12). */
export function recurrenceInMonth(
  cadence: RecurrenceCadence,
  monthOfYear: number | null,
  month: number,
): boolean {
  if (cadence === "yearly") return monthOfYear === month;
  return true;
}

/**
 * Rečenica ispod prekidača ponavljanja. `null` kad datum nije YYYY-MM-DD.
 * 29. februar u neprestupnoj godini pada na 28, isto kao kraći mesec kod mesečnog.
 */
export function repeatSchedule(isoDate: string, cadence: RecurrenceCadence): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(isoDate);
  if (match == null) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (cadence === "yearly") {
    const leap = month === 2 && day === 29 ? " U neprestupnoj godini to je 28. februar." : "";
    return `Ponavljaće se ${day}. ${MONTH_GENITIVE[month - 1]} svake godine.${leap}`;
  }
  return `Ponavljaće se ${day}. u mesecu; u kraćem mesecu poslednjeg dana.`;
}

/** Natpis učestalosti u podešavanjima. Učestalost i mesec se tu ne menjaju. */
export function recurrenceSummary(input: {
  cadence: RecurrenceCadence;
  dayOfMonth: number;
  monthOfYear: number | null;
}): string {
  if (input.cadence === "yearly" && input.monthOfYear != null) {
    const name = MONTH_GENITIVE[input.monthOfYear - 1] ?? "meseca";
    return `Svake godine, ${input.dayOfMonth}. ${name}. Učestalost se ne menja.`;
  }
  return `Svakog meseca, ${input.dayOfMonth}. Učestalost se ne menja.`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Dospeća čiji je prozor podsetnika otvoren danas.
 *
 * Prozor traje od dana podsetnika do kraja meseca dospeća. Dospeo, a neunet
 * unos ide ispred onog koji tek stiže.
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

/** Otvorena dospeća za koja još nema unosa. Ključ u `settled` je `pravilo:YYYY-MM`. */
export function unpaidReminders(
  today: string,
  rules: readonly {
    id: string;
    dayOfMonth: number;
    remindDays: number;
    cadence?: RecurrenceCadence;
    monthOfYear?: number | null;
  }[],
  settled: ReadonlySet<string>,
): { ruleId: string; occurrence: string; month: string }[] {
  const rows: { ruleId: string; occurrence: string; month: string }[] = [];
  for (const rule of rules) {
    for (const occurrence of reminderOccurrences({
      today,
      dayOfMonth: rule.dayOfMonth,
      remindDays: rule.remindDays,
      cadence: rule.cadence,
      monthOfYear: rule.monthOfYear,
    })) {
      const month = monthKey(occurrence);
      if (settled.has(`${rule.id}:${month}`)) continue;
      rows.push({ ruleId: rule.id, occurrence, month });
    }
  }
  return rows.sort((a, b) => {
    const aOver = a.occurrence <= today ? 0 : 1;
    const bOver = b.occurrence <= today ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (a.occurrence !== b.occurrence) return a.occurrence < b.occurrence ? -1 : 1;
    return a.ruleId.localeCompare(b.ruleId);
  });
}
