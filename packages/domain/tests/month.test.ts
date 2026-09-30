import { describe, expect, it } from "vitest";
import { summarizeMonth } from "../src/month";
import type { CategorySnapshot, EntrySnapshot } from "../src/types";

const food: CategorySnapshot = {
  id: "food",
  name: "Hrana",
  kind: "expense",
  limitMinor: 1_000_000,
};
const pay: CategorySnapshot = {
  id: "pay",
  name: "Plata",
  kind: "income",
  limitMinor: null,
};

function entry(partial: Partial<EntrySnapshot> & Pick<EntrySnapshot, "id" | "kind" | "amountMinor" | "categoryId">): EntrySnapshot {
  return {
    personId: "ana",
    personName: "Ana",
    occurredOn: "2026-09-02",
    ...partial,
  };
}

describe("summarizeMonth", () => {
  it("ostatak je prihod minus trošak samo za taj mesec", () => {
    const summary = summarizeMonth({
      month: "2026-09",
      categories: [food, pay],
      entries: [
        entry({ id: "1", kind: "income", amountMinor: 2_000_000, categoryId: "pay" }),
        entry({ id: "2", kind: "expense", amountMinor: 300_000, categoryId: "food" }),
        entry({ id: "3", kind: "expense", amountMinor: 990_000, categoryId: "food", occurredOn: "2026-08-31" }),
      ],
    });
    expect(summary.incomeMinor).toBe(2_000_000);
    expect(summary.expenseMinor).toBe(300_000);
    expect(summary.leftoverMinor).toBe(1_700_000);
    expect(summary.categories.find((c) => c.categoryId === "food")).toMatchObject({
      spentMinor: 300_000,
      entryCount: 1,
      limitMinor: 1_000_000,
    });
  });
});
