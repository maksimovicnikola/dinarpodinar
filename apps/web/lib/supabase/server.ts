import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { supabaseEnv } from "./env";

/**
 * Dva konteksta, dva klijenta.
 *
 * Server komponenta ne sme da piše kolačiće — Next tamo baca grešku na `set`.
 * Ruta i server akcija smeju, i tamo upis MORA da uspe: ako padne, sesija se ne
 * sačuva i član ispadne pri sledećem zahtevu. Jedan klijent koji u svim
 * slučajevima prećuti grešku pretvara tu tihu štetu u pravilo, zato su
 * razdvojeni.
 */

/** Tekst greške koju Next baca kad se kolačić menja van akcije ili rute. */
const IMMUTABLE_COOKIES = "Cookies can only be modified in a Server Action or Route Handler";

/**
 * Tačno ona greška koju server komponenta sme da preskoči. Sve ostalo
 * (nestao `cookies()` kontekst, nevažeće ime, prekoračena veličina) je prava
 * greška i mora da izađe na površinu.
 */
export function isImmutableCookieError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes(IMMUTABLE_COOKIES);
}

/**
 * Klijent za server komponente. Čita sesiju; upis je najbolji napor, jer
 * osvežavanje tokena za te zahteve radi `proxy.ts`.
 */
export async function createServerComponentSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch (caught) {
          if (!isImmutableCookieError(caught)) {
            throw caught;
          }
          // Poznat i očekivan slučaj: proxy je već osvežio sesiju.
        }
      },
    },
  });
}

export type WritableServerSupabase = {
  supabase: SupabaseClient;
  /** Prva greška pri upisu kolačića, ili `null`. */
  cookieFailure: () => unknown;
};

/**
 * Klijent za rute i server akcije, gde upis kolačića mora da uspe.
 *
 * Greška se pamti i prijavljuje u log, ali se ne baca dalje. Ovaj `setAll`
 * `@supabase/ssr` zove i iz obaveštenja o osveženom tokenu, a taj poziv niko
 * ne čeka: bačena greška tamo ne stiže do pozivaoca nego postaje
 * `unhandledRejection` u procesu. Zato je zapamćena greška jedini signal, a
 * svaki pozivalac posle rada pita `cookieFailure()` i tek onda prijavi uspeh.
 */
export async function createWritableServerSupabase(): Promise<WritableServerSupabase> {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();
  let failure: unknown = null;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch (caught) {
          failure ??= caught;
          console.error("Upis kolačića sesije nije uspeo", caught);
        }
      },
    },
  });

  return { supabase, cookieFailure: () => failure };
}
