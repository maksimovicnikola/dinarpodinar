import { occurrenceDate } from "@finance/domain";

export { reminderOccurrences } from "@finance/domain";

export function occurrenceThisMonth(today: string, dayOfMonth: number): string {
  const [year, month] = today.split("-").map(Number);
  return occurrenceDate(year, month, dayOfMonth);
}
