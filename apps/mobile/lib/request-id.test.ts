import { afterEach, describe, expect, it } from "vitest";

import { isRequestId, newRequestId } from "./request-id";

describe("newRequestId", () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  });

  it("daje ispravan v4 UUID", () => {
    expect(isRequestId(newRequestId())).toBe(true);
  });

  it("radi i kad randomUUID ne postoji, kao na telefonu", () => {
    const fallback = {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => original.getRandomValues(array),
    } as unknown as Crypto;
    Object.defineProperty(globalThis, "crypto", { value: fallback, configurable: true });
    expect(isRequestId(newRequestId())).toBe(true);
  });

  it("radi i kad crypto uopšte ne postoji", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    expect(isRequestId(newRequestId())).toBe(true);
  });
});
