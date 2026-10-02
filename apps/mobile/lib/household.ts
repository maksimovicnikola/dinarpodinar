import type { CategorySnapshot } from "@finance/domain";

import { supabase } from "./supabase";

export type CategoryRow = CategorySnapshot & { archived: boolean };
export type Person = { id: string; name: string };

export type Household = {
  userId: string;
  householdId: string;
  name: string;
  currency: string;
  categories: CategoryRow[];
  people: Person[];
};

export type HouseholdResult =
  | { status: "signed-out" }
  | { status: "none" }
  | { status: "error" }
  | { status: "ok"; household: Household };

/** Prvo članstvo prijavljenog korisnika, sa kategorijama i članovima. */
export async function loadHousehold(): Promise<HouseholdResult> {
  const auth = await supabase.auth.getUser();
  const userId = auth.data.user?.id;
  if (!userId) return { status: "signed-out" };

  const membership = await supabase
    .from("memberships")
    .select("household_id")
    .eq("user_id", userId)
    .order("household_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membership.error) return { status: "error" };
  if (!membership.data) return { status: "none" };

  const householdId: string = membership.data.household_id;
  const [household, categories, members] = await Promise.all([
    supabase.from("households").select("name, currency").eq("id", householdId).maybeSingle(),
    supabase.from("categories").select("id, name, kind, limit_minor, archived").eq("household_id", householdId),
    supabase.from("memberships").select("user_id, profiles(display_name)").eq("household_id", householdId),
  ]);
  if (household.error || categories.error || members.error || !household.data) return { status: "error" };

  return {
    status: "ok",
    household: {
      userId,
      householdId,
      name: household.data.name,
      currency: household.data.currency,
      categories: (categories.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        limitMinor: row.limit_minor,
        archived: row.archived,
      })),
      people: (members.data ?? [])
        .map((row) => {
          const profile = row.profiles as
            | { display_name: string | null }
            | Array<{ display_name: string | null }>
            | null;
          const name = Array.isArray(profile) ? profile[0]?.display_name : profile?.display_name;
          return { id: row.user_id as string, name: name?.trim() || "Član" };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "sr")),
    },
  };
}
