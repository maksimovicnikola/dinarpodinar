/**
 * Odluka povratne rute, izvučena iz same rute da bi mogla da se testira bez
 * Next zahteva i bez Supabase-a.
 *
 * Ruta posle ovoga radi samo dve stvari: razmeni kod i upiše kolačiće. Sve
 * grananje po adresi je ovde.
 */

import type { LoginErrorCode } from "./auth-messages";
import { DEFAULT_NEXT_PATH, nextPathOrDefault } from "./next-path";

export type CallbackPlan =
  | { kind: "fail"; code: LoginErrorCode }
  | { kind: "exchange"; code: string; next: string };

/** Putanja na koju se vraća neuspeh. Kod, ne poruka — tekst baze nije za adresu. */
export function loginErrorPath(code: LoginErrorCode): string {
  return `/login?greska=${code}`;
}

function nonEmpty(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

export function planCallback(params: URLSearchParams): CallbackPlan {
  // Supabase prijavljuje odbijen link kroz `error` ili `error_description`.
  // Prazna vrednost se ne računa, zato se gleda sadržaj a ne samo prisustvo.
  if (nonEmpty(params.get("error")) || nonEmpty(params.get("error_description"))) {
    return { kind: "fail", code: "link" };
  }

  const code = params.get("code");
  if (!nonEmpty(code)) {
    return { kind: "fail", code: "bez-koda" };
  }

  return {
    kind: "exchange",
    // Kod ide nepromenjen; `nonEmpty` je samo provera da nije prazan.
    code: code as string,
    next: nextPathOrDefault(params.get("next"), DEFAULT_NEXT_PATH),
  };
}
