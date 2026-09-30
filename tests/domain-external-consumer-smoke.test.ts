import { expect, it } from "vitest";
import { formatMoney, type Suggestion } from "@finance/domain";

it("root potrošač koristi runtime i type import iz @finance/domain", () => {
  const typed: Suggestion = { sentence: "Test" };
  expect(typed.sentence).toBe("Test");
  expect(formatMoney(123400, "RSD")).toBe("1.234 RSD");
});
