import { addCalendarDays, monthKey, occurrenceDate } from "@finance/domain";

export function occurrenceThisMonth(today: string, dayOfMonth: number): string {
  const [year, month] = today.split("-").map(Number);
  return occurrenceDate(year, month, dayOfMonth);
}

export function dueActions(input: {
  today: string;
  dayOfMonth: number;
  remindDays: number;
  active: boolean;
  reminderSent: boolean;
  entryExists: boolean;
}): Array<"remind" | "insert"> {
  if (!input.active) return [];
  const occurrence = occurrenceThisMonth(input.today, input.dayOfMonth);
  const reminder = addCalendarDays(occurrence, -input.remindDays);
  const actions: Array<"remind" | "insert"> = [];
  if (!input.reminderSent && input.today >= reminder && input.today < occurrence) {
    actions.push("remind");
  }
  if (!input.entryExists && input.today >= occurrence && monthKey(input.today) === monthKey(occurrence)) {
    actions.push("insert");
  }
  return actions;
}
