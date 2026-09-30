import { monthKey } from "./calendar";
import type { CategorySnapshot, EntryKind, EntrySnapshot } from "./types";

export type CategoryMonth = {
  categoryId: string;
  name: string;
  kind: EntryKind;
  spentMinor: number;
  limitMinor: number | null;
  entryCount: number;
};

export type MonthSummary = {
  incomeMinor: number;
  expenseMinor: number;
  leftoverMinor: number;
  categories: CategoryMonth[];
};

export function summarizeMonth(input: {
  month: string;
  categories: CategorySnapshot[];
  entries: EntrySnapshot[];
}): MonthSummary {
  const inMonth = input.entries.filter((entry) => monthKey(entry.occurredOn) === input.month);
  const categories = input.categories.map((category) => {
    const rows = inMonth.filter((entry) => entry.categoryId === category.id);
    return {
      categoryId: category.id,
      name: category.name,
      kind: category.kind,
      spentMinor: rows.reduce((sum, entry) => sum + entry.amountMinor, 0),
      limitMinor: category.limitMinor,
      entryCount: rows.length,
    };
  });
  const incomeMinor = inMonth
    .filter((entry) => entry.kind === "income")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const expenseMinor = inMonth
    .filter((entry) => entry.kind === "expense")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  return {
    incomeMinor,
    expenseMinor,
    leftoverMinor: incomeMinor - expenseMinor,
    categories,
  };
}
