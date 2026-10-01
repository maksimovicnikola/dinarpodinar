import { describe, expect, it } from "vitest";

import { isImmutableCookieError } from "./server";

describe("isImmutableCookieError", () => {
  // Tekst je prepisan iz `ReadonlyRequestCookiesError` u Next-u.
  const nextMessage =
    "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options";

  it("prepoznaje grešku koju Next baca u server komponenti", () => {
    expect(isImmutableCookieError(new Error(nextMessage))).toBe(true);
  });

  it("prepoznaje je i kad je omotana podklasom", () => {
    class ReadonlyRequestCookiesError extends Error {}
    expect(isImmutableCookieError(new ReadonlyRequestCookiesError(nextMessage))).toBe(true);
  });

  it("ne prepoznaje druge greške pri upisu kolačića", () => {
    expect(isImmutableCookieError(new Error("Cookie value exceeds 4096 bytes"))).toBe(false);
    expect(
      isImmutableCookieError(new Error("`cookies` was called outside a request scope")),
    ).toBe(false);
    expect(isImmutableCookieError(new TypeError("cookieStore.set is not a function"))).toBe(false);
  });

  it("ne prepoznaje vrednosti koje nisu greška", () => {
    expect(isImmutableCookieError(nextMessage)).toBe(false);
    expect(isImmutableCookieError(null)).toBe(false);
    expect(isImmutableCookieError(undefined)).toBe(false);
    expect(isImmutableCookieError({ message: nextMessage })).toBe(false);
  });
});
