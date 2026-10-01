import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEXT_PATH,
  firstParam,
  invitationToken,
  isPublicPath,
  loginPathWithNext,
  nextPathOrDefault,
  safeNextPath,
} from "./next-path";

/** Unosi koji pokušavaju da izvedu korisnika sa našeg porekla. */
const HOSTILE = [
  "//zlonamerni.rs",
  "///zlonamerni.rs",
  "https://zlonamerni.rs",
  "http://zlonamerni.rs/novo",
  "//zlonamerni.rs/novo",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "\\\\zlonamerni.rs",
  "/\\zlonamerni.rs",
  "/\\/zlonamerni.rs",
  "novo",
  "../novo",
  "/../../etc/passwd",
  "/novo\nSet-Cookie: a=b",
  "/novo\r\nLocation: https://zlonamerni.rs",
  "/novo ?x=1",
  "",
  "   ",
];

describe("safeNextPath", () => {
  it("prihvata relativne putanje aplikacije", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/novo")).toBe("/novo");
    expect(safeNextPath("/h/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22")).toBe(
      "/h/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    );
    expect(safeNextPath("/poziv/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22")).toBe(
      "/poziv/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    );
    expect(safeNextPath("/novo?valuta=RSD#dno")).toBe("/novo?valuta=RSD#dno");
  });

  it("skida okolne razmake", () => {
    expect(safeNextPath("  /novo  ")).toBe("/novo");
  });

  it("odbija apsolutne, protokol-relativne i obrnuto-kose putanje", () => {
    for (const candidate of HOSTILE) {
      expect(safeNextPath(candidate), candidate).toBeNull();
    }
  });

  it("odbija nedostajuću vrednost", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it("odbija prijavu i povratnu rutu kao odredište", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=%2Fnovo")).toBeNull();
    expect(safeNextPath("/auth")).toBeNull();
    expect(safeNextPath("/auth/callback?code=x")).toBeNull();
  });

  it("ne odbija putanju samo zato što počinje sličnim imenom", () => {
    expect(safeNextPath("/loginovi")).toBe("/loginovi");
    expect(safeNextPath("/authori")).toBe("/authori");
  });

  it("odbija predugačku vrednost", () => {
    expect(safeNextPath(`/${"a".repeat(512)}`)).toBeNull();
  });

  it("svaka prihvaćena putanja razrešava se na isto poreklo", () => {
    const origin = "https://dinar.primer.rs";
    const candidates = [
      ...HOSTILE,
      "/",
      "/novo",
      "/%2F%2Fzlonamerni.rs",
      "/%5Czlonamerni.rs",
      "/@zlonamerni.rs",
      "/poziv/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    ];

    for (const candidate of candidates) {
      const safe = safeNextPath(candidate);
      if (safe !== null) {
        expect(new URL(safe, origin).origin, candidate).toBe(origin);
      }
    }
  });
});

describe("nextPathOrDefault", () => {
  it("vraća putanju kad je sigurna", () => {
    expect(nextPathOrDefault("/novo")).toBe("/novo");
  });

  it("vraća početnu kad nije", () => {
    expect(nextPathOrDefault("//zlonamerni.rs")).toBe(DEFAULT_NEXT_PATH);
    expect(nextPathOrDefault(null)).toBe("/");
  });

  it("poštuje zadatu rezervu", () => {
    expect(nextPathOrDefault("https://zlonamerni.rs", "/novo")).toBe("/novo");
  });
});

describe("loginPathWithNext", () => {
  it("pamti odredište", () => {
    expect(loginPathWithNext("/poziv/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22")).toBe(
      "/login?next=%2Fpoziv%2F0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    );
    expect(loginPathWithNext("/novo?valuta=RSD")).toBe("/login?next=%2Fnovo%3Fvaluta%3DRSD");
  });

  it("ne dodaje parametar za početnu ni za nesigurnu putanju", () => {
    expect(loginPathWithNext("/")).toBe("/login");
    expect(loginPathWithNext("//zlonamerni.rs")).toBe("/login");
    expect(loginPathWithNext(null)).toBe("/login");
  });
});

describe("invitationToken", () => {
  it("prihvata uuid i svodi ga na mala slova", () => {
    expect(invitationToken("0F9F6F2A-2C5D-4F6F-9B1A-3B7D8E5C1A22")).toBe(
      "0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    );
    expect(invitationToken("  0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22 ")).toBe(
      "0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22",
    );
  });

  it("odbija sve što nije uuid", () => {
    expect(invitationToken("0f9f6f2a2c5d4f6f9b1a3b7d8e5c1a22")).toBeNull();
    expect(invitationToken("0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a2")).toBeNull();
    expect(invitationToken("0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22x")).toBeNull();
    expect(invitationToken("../../etc/passwd")).toBeNull();
    expect(invitationToken("")).toBeNull();
    expect(invitationToken(null)).toBeNull();
    expect(invitationToken(undefined)).toBeNull();
  });
});

describe("isPublicPath", () => {
  it("propušta tačno javne strane", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth")).toBe(true);
  });

  it("propušta podstrane javnih prefiksa", () => {
    expect(isPublicPath("/login/")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/auth/callback/dalje")).toBe(true);
  });

  it("ne propušta imena koja samo počinju istim slovima", () => {
    expect(isPublicPath("/loginovi")).toBe(false);
    expect(isPublicPath("/login-stranica")).toBe(false);
    expect(isPublicPath("/authori")).toBe(false);
    expect(isPublicPath("/authentication")).toBe(false);
  });

  it("ne propušta zaštićene strane", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/novo")).toBe(false);
    expect(isPublicPath("/poziv/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22")).toBe(false);
    expect(isPublicPath("/h/0f9f6f2a-2c5d-4f6f-9b1a-3b7d8e5c1a22")).toBe(false);
  });

  it("ne propušta ugnježdeni javni prefiks ispod zaštićene strane", () => {
    expect(isPublicPath("/h/login")).toBe(false);
    expect(isPublicPath("/novo/auth")).toBe(false);
  });

  it("javna strana nikad nije i dozvoljeno odredište posle prijave", () => {
    for (const path of ["/login", "/login/", "/auth", "/auth/callback"]) {
      expect(isPublicPath(path), path).toBe(true);
      expect(safeNextPath(path), path).toBeNull();
    }
  });
});

describe("firstParam", () => {
  it("uzima prvu vrednost iz niza", () => {
    expect(firstParam(["/novo", "/drugo"])).toBe("/novo");
    expect(firstParam([])).toBeNull();
  });

  it("propušta skalar i prazno", () => {
    expect(firstParam("/novo")).toBe("/novo");
    expect(firstParam(undefined)).toBeNull();
  });
});
