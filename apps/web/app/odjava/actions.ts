"use server";

import { redirect } from "next/navigation";

import { createWritableServerSupabase } from "@/lib/supabase/server";

/** Briše sesiju i vraća na prijavu. Kolačić mora da se obriše, inače sledeći zahtev ostaje ulogovan. */
export async function signOutAction(): Promise<void> {
  const { supabase, cookieFailure } = await createWritableServerSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("odjava nije uspela", error);
  }
  const cookies = cookieFailure();
  if (cookies) {
    console.error("odjava: kolačići sesije nisu obrisani", cookies);
  }
  redirect("/login");
}
