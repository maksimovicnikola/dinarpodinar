import { expect, it } from "vitest";
import { majorToMinor } from "./rows";

it("pretvara iznos sa zarezom", () => {
  expect(majorToMinor("12,50")).toBe(1250);
  expect(() => majorToMinor("0")).toThrow(/pozitivan/);
});
