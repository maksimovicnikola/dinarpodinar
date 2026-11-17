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

export function dueActions(input: {
  today: string;
  dayOfMonth: number;
  remindDays: number;
  active: boolean;
  reminderSent: boolean;
  entryExists: boolean;
  cadence?: RecurrenceCadence;
  monthOfYear?: number | null;
}): Array<"remind" | "insert"> {
  if (!input.active) return [];
  const [year, month] = input.today.split("-").map(Number);
  const cadence = input.cadence ?? "monthly";
  if (!recurrenceInMonth(cadence, input.monthOfYear ?? null, month)) return [];
  const occurrence = occurrenceDate(year, month, input.dayOfMonth);
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
