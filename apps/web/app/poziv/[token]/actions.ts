"use server";

import { redirect } from "next/navigation";

import { invitationErrorCode, invitationErrorMessage } from "@/lib/auth-messages";
import { invitationToken, loginPathWithNext } from "@/lib/next-path";
import { createWritableServerSupabase } from "@/lib/supabase/server";

import type { InvitationState } from "./state";

/**
 * Prihvatanje pozivnice je promena stanja, pa ide kroz akciju a ne kroz
 * otvaranje adrese: pozivnica je jednokratna i ne sme da se potroši time što
 * je neki pregledač ili skener prefetchovao link.
 *
 * Akcija je javna ulazna tačka, pa se token i prijava proveravaju ponovo —
 * ne verujemo onome što je strana već proverila.
 *
 * Modul sme da izvozi samo async funkcije; tip i početno stanje forme stoje u
 * `./state`. Čuvar je `lib/server-actions.test.ts`.
 */
export async function acceptInvitationAction(
  _previous: InvitationState,
  formData: FormData,
): Promise<InvitationState> {
  const token = invitationToken(formData.get("token")?.toString());

  if (!token) {
    return { error: invitationErrorMessage("token") };
  }

  const { supabase, cookieFailure } = await createWritableServerSupabase();
  const auth = await supabase.auth.getUser();

  if (!auth.data.user) {
    redirect(loginPathWithNext(`/poziv/${token}`));
  }

  const accepted = await supabase.rpc("accept_invitation", { p_token: token });

  if (accepted.error) {
    return { error: invitationErrorMessage(invitationErrorCode(accepted.error.message)) };
  }

  // Osvežen token je mogao da padne pri upisu. Prećutati to znači poslati člana
  // u domaćinstvo bez sesije, pa bi ga sledeći zahtev vratio na prijavu.
  const failure = cookieFailure();
  if (failure) {
    console.error("accept_invitation: upis kolačića sesije nije uspeo", failure);
    return { error: invitationErrorMessage("kolacici") };
  }

  if (!accepted.data) {
    return { error: invitationErrorMessage("nepoznato") };
  }

  redirect(`/h/${accepted.data}`);
}
