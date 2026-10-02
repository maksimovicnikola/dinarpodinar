import { describe, expect, it } from "vitest";

import { loginNamePath, needsDisplayName } from "./display-name";

describe("needsDisplayName", () => {
  it("pita ime kad metapodaci nemaju ime", () => {
    expect(needsDisplayName(null)).toBe(true);
    expect(needsDisplayName({})).toBe(true);
    expect(needsDisplayName({ display_name: "  " })).toBe(true);
    expect(needsDisplayName({ display_name: "A" })).toBe(true);
  });

  it("ne pita ime kad je već sačuvano", () => {
    expect(needsDisplayName({ display_name: "Nikola" })).toBe(false);
    expect(needsDisplayName({ display_name: "  Jelena  " })).toBe(false);
  });
});

describe("loginNamePath", () => {
  it("pamti kuda ide nalog posle imena", () => {
    expect(loginNamePath("/h/abc")).toBe("/login?ime=1&next=%2Fh%2Fabc");
  });
});
