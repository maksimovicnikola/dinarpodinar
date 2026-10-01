"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Otvorena strana domaćinstva prati `entries` uživo.
 *
 * Kanal je filtriran na ovo domaćinstvo — i zbog saobraćaja i zato što bi bez
 * filtera svaki događaj u tabeli budio osvežavanje. RLS i dalje odlučuje šta
 * se zaista isporuči; filter je sužavanje, ne zaštita.
 *
 * `event: "*"` pokriva unos, izmenu i brisanje: vlasnik koji obriše red mora
 * da nestane i sa tuđeg ekrana, ne samo nov unos da se pojavi.
 */
export function LiveEntries({ householdId }: { householdId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`entries-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entries",
          filter: `household_id=eq.${householdId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, router]);

  return null;
}
