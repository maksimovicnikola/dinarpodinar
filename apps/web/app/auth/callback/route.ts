import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_NEXT_PATH, nextPathOrDefault } from "@/lib/next-path";
import { createServerSupabase } from "@/lib/supabase/server";

/** Odgovor sa kolačićima sesije ne sme da uđe u keš posrednika. */
function redirectTo(path: string, origin: string) {
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // `next` sastavlja korisnik, pa prolazi kroz proveru: samo relativna putanja
  // na istom poreklu. Bez toga je ovo otvoreno preusmerenje.
  const next = nextPathOrDefault(url.searchParams.get("next"), DEFAULT_NEXT_PATH);

  if (url.searchParams.get("error") ?? url.searchParams.get("error_description")) {
    return redirectTo("/login?greska=link", url.origin);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return redirectTo("/login?greska=bez-koda", url.origin);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectTo("/login?greska=razmena", url.origin);
  }

  return redirectTo(next, url.origin);
}
