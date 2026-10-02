import { redirect } from "next/navigation";

import { Problem } from "@/components/problem";
import { defaultOccurredOn, type CategoryOption } from "@/lib/entry-form";
import { buildPeople } from "@/lib/month-query";
import { loginPathWithNext, uuidParam } from "@/lib/next-path";
import { createServerComponentSupabase } from "@/lib/supabase/server";

import { EntryForm } from "./form";

export default async function NewEntryPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  const route = await params;

  // `household_id` je `uuid` kolona: neispravan tekst bi vratio grešku tipa iz
  // Postgresa umesto prazan rezultat, pa se oblik proverava pre upita.
  const householdId = uuidParam(route.householdId);
  if (householdId === null) {
    return (
      <Problem title="Adresa nije ispravna" lead="Link ka domaćinstvu nije u očekivanom obliku.">
        Proverite adresu ili otvorite domaćinstvo sa početne strane.
      </Problem>
    );
  }

  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;
  if (!user) {
    redirect(loginPathWithNext(`/h/${householdId}/novi`));
  }

  // RLS je poslednja granica, ali svaki upit i dalje izričito sužava na ovo
  // domaćinstvo. Ponuda za nov unos uzima samo aktivne kategorije: arhivirana
  // ostaje u istoriji meseca, ali je `prepare_entry` odbija za nov unos.
  const [household, categories, members] = await Promise.all([
    supabase.from("households").select("name").eq("id", householdId).maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, kind")
      .eq("household_id", householdId)
      .eq("archived", false),
    supabase
      .from("memberships")
      .select("user_id, role, profiles(display_name)")
      .eq("household_id", householdId),
  ]);

  const failures = [
    ["households", household.error] as const,
    ["categories", categories.error] as const,
    ["memberships", members.error] as const,
  ].filter(([, error]) => error !== null);

  // Prećutana greška bi se videla kao domaćinstvo bez ijedne kategorije, pa bi
  // član tražio krivca u podešavanjima umesto da osveži stranu.
  if (failures.length > 0) {
    for (const [table, error] of failures) {
      console.error(`new entry query failed: ${table}`, error);
    }

    return (
      <Problem
        title="Nov unos se ne otvara"
        lead="Nismo pročitali kategorije i članove domaćinstva."
        backHref={`/h/${householdId}`}
        backLabel="Na mesečni pregled"
      >
        Osvežite stranu. Ako se ponavlja, odjavite se i prijavite novim linkom.
      </Problem>
    );
  }

  const membershipRows = members.data ?? [];
  const role = membershipRows.find((row) => row.user_id === user.id)?.role ?? "";

  // Nečlan ne dobija ni potvrdu da domaćinstvo postoji.
  if (!household.data || role === "") {
    return (
      <Problem title="Domaćinstvo nije dostupno" lead="Ovo domaćinstvo ne postoji ili niste njegov član.">
        Ako ste dobili pozivnicu, otvorite link iz e-pošte i prijavite se istom adresom.
      </Problem>
    );
  }

  const options: CategoryOption[] = (categories.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
  }));

  return (
    <EntryForm
      householdId={householdId}
      householdName={household.data.name}
      categories={options}
      people={buildPeople(membershipRows)}
      signedInPersonId={user.id}
      today={defaultOccurredOn(new Date())}
    />
  );
}
