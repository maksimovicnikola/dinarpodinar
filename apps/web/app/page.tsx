import { redirect } from "next/navigation";

import { Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { createServerComponentSupabase } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();

  if (!auth.data.user) {
    redirect("/login");
  }

  // `user_id` se traži izričito. RLS na `memberships` propušta i redove
  // sadomaćinskih članova, pa bi upit bez ovog filtera mogao da vrati tuđe
  // članstvo i odvede korisnika u pogrešno domaćinstvo.
  const membership = await supabase
    .from("memberships")
    .select("household_id")
    .eq("user_id", auth.data.user.id)
    .order("household_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Greška baze nije isto što i „još nema domaćinstva“. Da je tretiramo kao
  // prazan nalog, član bi posle svakog prekida veze bio vučen na otvaranje
  // novog domaćinstva, pored onog koje već ima.
  if (membership.error) {
    console.error("memberships lookup failed", membership.error);

    return (
      <Passbook>
        <PassbookHeader
          eyebrow="Zastoj"
          title="Knjižica se ne otvara"
          lead="Nismo mogli da pročitamo vaša domaćinstva. Podaci su na mestu — samo nam veza nije odgovorila."
        />
        <div className="stack stack--loose">
          <Notice tone="bad">
            Proverite internet i pokušajte ponovo. Ako se ponavlja, odjavite se i prijavite novim
            linkom.
          </Notice>
          <div className="row">
            <a className="button" href="/">
              Pokušaj ponovo
            </a>
            <a className="button button--quiet" href="/login">
              Prijavi se ponovo
            </a>
          </div>
        </div>
      </Passbook>
    );
  }

  if (!membership.data) {
    redirect("/novo");
  }

  redirect(`/h/${membership.data.household_id}`);
}
