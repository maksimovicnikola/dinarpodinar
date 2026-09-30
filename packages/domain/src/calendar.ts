export function todayInBelgrade(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function clampDayOfMonth(year: number, month: number, day: number): number {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, last);
}

export function occurrenceDate(year: number, month: number, dayOfMonth: number): string {
  const day = clampDayOfMonth(year, month, dayOfMonth);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function assertRemindDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error("Podsetnik je od 1 do 7 dana.");
  }
}
