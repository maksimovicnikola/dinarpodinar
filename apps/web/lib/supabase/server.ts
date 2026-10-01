import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseEnv } from "./env";

/**
 * Klijent za server komponente, rute i server akcije. Pravi se iznova za svaki
 * zahtev — deljenje između zahteva pomešalo bi sesije.
 *
 * Server komponente ne smeju da pišu kolačiće; tamo `set` baca grešku i mi je
 * prećutno ignorišemo. Osvežavanje tokena za te zahteve radi `proxy.ts`.
 */
export async function createServerSupabase() {
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
        } catch {
          // Server komponenta: upis nije dozvoljen, proxy je već osvežio sesiju.
        }
      },
    },
  });
}
