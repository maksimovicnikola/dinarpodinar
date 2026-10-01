import { NextResponse, type NextRequest } from "next/server";

import { loginErrorPath, planCallback } from "@/lib/auth-callback";
import { createWritableServerSupabase, isImmutableCookieError } from "@/lib/supabase/server";

/** Odgovor sa kolačićima sesije ne sme da uđe u keš posrednika. */
function redirectTo(path: string, origin: string) {
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set("cache-control", "private, no-cache, no-store, must-revalidate, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // Grananje po adresi (uključujući proveru `next` od otvorenog preusmerenja)
  // stoji u `planCallback` i testirano je odvojeno.
  const plan = planCallback(url.searchParams);

  if (plan.kind === "fail") {
    return redirectTo(loginErrorPath(plan.code), url.origin);
  }

  const { supabase, cookieFailure } = await createWritableServerSupabase();

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(plan.code);

    if (error) {
      return redirectTo(loginErrorPath("razmena"), url.origin);
    }
  } catch (caught) {
    // Razmena može da padne i zbog upisa kolačića (npr. kad je ovo pozvano van
    // rute). Razdvajamo to od neuspele razmene da poruka članu bude tačna.
    if (cookieFailure() || isImmutableCookieError(caught)) {
      console.error("auth/callback: upis kolačića sesije nije uspeo", caught);
      return redirectTo(loginErrorPath("kolacici"), url.origin);
    }

    console.error("auth/callback: razmena koda nije uspela", caught);
    return redirectTo(loginErrorPath("razmena"), url.origin);
  }

  // Razmena je prošla, ali kolačić nije upisan: sesija ne postoji, pa
  // preusmerenje u aplikaciju samo vrti korisnika natrag na prijavu.
  const failure = cookieFailure();
  if (failure) {
    console.error("auth/callback: upis kolačića sesije nije uspeo", failure);
    return redirectTo(loginErrorPath("kolacici"), url.origin);
  }

  return redirectTo(plan.next, url.origin);
}
