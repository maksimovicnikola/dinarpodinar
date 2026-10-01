"use server";

import { redirect } from "next/navigation";

import { invitationErrorCode, invitationErrorMessage } from "@/lib/auth-messages";
import { invitationToken, loginPathWithNext } from "@/lib/next-path";
import { createServerSupabase } from "@/lib/supabase/server";

export type InvitationState = { error: string | null };

export const emptyInvitationState: InvitationState = { error: null };

/**
 * Prihvatanje pozivnice je promena stanja, pa ide kroz akciju a ne kroz
 * otvaranje adrese: pozivnica je jednokratna i ne sme da se potroši time što
 * je neki pregledač ili skener prefetchovao link.
 *
 * Akcija je javna ulazna tačka, pa se token i prijava proveravaju ponovo —
 * ne verujemo onome što je strana već proverila.
 */
export async function acceptInvitationAction(
  _previous: InvitationState,
  formData: FormData,
): Promise<InvitationState> {
  const token = invitationToken(formData.get("token")?.toString());

  if (!token) {
    return { error: invitationErrorMessage("token") };
  }

  const supabase = await createServerSupabase();
  const auth = await supabase.auth.getUser();

  if (!auth.data.user) {
    redirect(loginPathWithNext(`/poziv/${token}`));
  }

  const accepted = await supabase.rpc("accept_invitation", { p_token: token });

  if (accepted.error) {
    return { error: invitationErrorMessage(invitationErrorCode(accepted.error.message)) };
  }

  if (!accepted.data) {
    return { error: invitationErrorMessage("nepoznato") };
  }

  redirect(`/h/${accepted.data}`);
}
