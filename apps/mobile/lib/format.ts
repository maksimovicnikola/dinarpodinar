const MONTHS = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar",
] as const;

/** „2026-09“ → „Septembar 2026“ */
export function monthTitle(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${MONTHS[monthNumber - 1]} ${year}`;
}

/** Susedni mesec u prozoru 1900-01 … 2999-12, kao na vebu. */
export function shiftMonth(month: string, delta: number): string | null {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + delta;
  const nextYear = Math.floor(index / 12);
  if (nextYear < 1900 || nextYear > 2999) return null;
  return `${nextYear}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** „2026-09-05“ → „5.9.2026.“ */
export function dayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day}.${month}.${year}.`;
}
