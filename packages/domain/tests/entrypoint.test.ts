import { describe, expect, it } from "vitest";
import {
  assertPositiveMinor,
  formatMoney,
  type CategorySnapshot,
  type EntryKind,
  type EntrySnapshot,
} from "@finance/domain";

describe("@finance/domain entrypoint", () => {
  it("re-exports formatMoney, assertPositiveMinor and Task 1 types", () => {
    expect(formatMoney(420000, "RSD")).toBe("4.200 RSD");
    expect(() => assertPositiveMinor(1)).not.toThrow();

    const kind: EntryKind = "income";
    const entry: EntrySnapshot = {
      id: "e1",
      kind,
      amountMinor: 100,
      categoryId: "c1",
      personId: "p1",
      personName: "Test",
      occurredOn: "2026-09-30",
    };
    const category: CategorySnapshot = {
      id: "c1",
      name: "Test",
      kind: "expense",
      limitMinor: null,
    };

    expect(entry.kind).toBe("income");
    expect(category.limitMinor).toBeNull();
  });
});
