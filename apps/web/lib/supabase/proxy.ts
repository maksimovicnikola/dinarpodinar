import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { loginPathWithNext } from "../next-path";
import { supabaseEnv } from "./env";

/** Strane koje se otvaraju bez prijave. Sve ostalo vodi na `/login`. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

/** Zaglavlja koja Supabase traži da se prenesu kad se upišu kolačići sesije. */
const NO_CACHE_HEADERS = ["cache-control", "expires", "pragma"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Osvežava kolačiće sesije na svakom zahtevu i vraća neprijavljenog korisnika
 * na prijavu, uz pamćenje gde je išao.
 *
 * Server komponente ne mogu da upišu osvežen token, pa bez ovoga sesija tiho
 * istekne i korisnik ispadne iz aplikacije.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
        }

        response = NextResponse.next({ request });

        for (const cookie of cookiesToSet) {
          response.cookies.set(cookie.name, cookie.value, cookie.options);
        }

        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && Boolean(data?.claims);

  if (signedIn || isPublicPath(request.nextUrl.pathname)) {
    return response;
  }

  const target = new URL(
    loginPathWithNext(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    request.nextUrl.origin,
  );
  const redirect = NextResponse.redirect(target);

  // Preusmerenje mora da ponese sve što je klijent upisao, inače se osvežen
  // token izgubi i sledeći zahtev ponovo pada na prijavu.
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }

  for (const header of NO_CACHE_HEADERS) {
    const value = response.headers.get(header);
    if (value) {
      redirect.headers.set(header, value);
    }
  }

  return redirect;
}
