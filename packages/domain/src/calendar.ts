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
