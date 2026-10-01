/**
 * Bezbedno rukovanje `next` parametrom i tokenom pozivnice.
 *
 * `next` dolazi iz URL-a koji korisnik (ili napadač) sastavlja, pa mora da
 * prođe kroz `safeNextPath` pre svakog preusmerenja. Dozvoljene su samo
 * relativne putanje na istom poreklu — nikad apsolutni URL, nikad
 * protokol-relativni `//domen`, nikad obrnuta kosa crta koju pregledači
 * tumače kao kosu crtu.
 */

const MAX_NEXT_LENGTH = 512;

/** Dozvoljeni znaci u putanji, upitu i fragmentu. Namerno bez `\`, razmaka i kontrolnih znakova. */
const ALLOWED_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%?#[\]]*$/;

/** Putanje koje nikad nisu odredište posle prijave — inače se pravi petlja. */
const BLOCKED_PREFIXES = ["/login", "/auth"];

/**
 * Strane koje se otvaraju bez prijave. Spisak je namerno odvojen od
 * `BLOCKED_PREFIXES`: danas su iste, ali „javno" i „nije odredište posle
 * prijave" nisu isto pravilo i ne smeju da se menjaju zajedno.
 */
const PUBLIC_PREFIXES = ["/login", "/auth"];

export const DEFAULT_NEXT_PATH = "/";

/**
 * Poređenje po segmentu, ne po golom prefiksu: `/login` i `/login/x` se
 * poklapaju, a `/loginovi` ne.
 */
function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Da li strana sme da se otvori bez prijave. Koristi ga `proxy.ts`. */
export function isPublicPath(pathname: string): boolean {
  return matchesPrefix(pathname, PUBLIC_PREFIXES);
}

/**
 * Vraća putanju ako je sigurna za preusmerenje unutar iste aplikacije,
 * inače `null`.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.trim();

  if (value.length === 0 || value.length > MAX_NEXT_LENGTH) {
    return null;
  }

  // Jedna kosa crta na početku: relativna putanja. Dve: `//domen` je apsolutni URL.
  if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  if (!ALLOWED_PATH.test(value)) {
    return null;
  }

  // `..` bi izveo iz očekivanog dela aplikacije i zbunio podudaranje prefiksa.
  if (value.split(/[/?#]/).includes("..")) {
    return null;
  }

  const pathOnly = value.split(/[?#]/)[0] ?? "";
  if (matchesPrefix(pathOnly, BLOCKED_PREFIXES)) {
    return null;
  }

  return value;
}

/** Kao `safeNextPath`, ali uvek vraća upotrebljivu putanju. */
export function nextPathOrDefault(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  return safeNextPath(raw) ?? fallback;
}

/** Putanja ka prijavi koja pamti gde je korisnik hteo da ode. */
export function loginPathWithNext(raw: string | null | undefined): string {
  const next = safeNextPath(raw);

  if (next === null || next === DEFAULT_NEXT_PATH) {
    return "/login";
  }

  return `/login?next=${encodeURIComponent(next)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Token pozivnice je `uuid` u bazi; normalizuje se na mala slova ili se odbija. */
export function invitationToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const value = raw.trim().toLowerCase();
  return UUID.test(value) ? value : null;
}

/** Prvi skalar iz `searchParams`, koji u Next-u može biti i niz. */
export function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
