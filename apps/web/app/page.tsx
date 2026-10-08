import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { createServerComponentSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  keywords: [
    "porodične finansije",
    "praćenje troškova",
    "evidencija prihoda i rashoda",
    "budžet domaćinstva",
    "mesečni limit troškova",
  ],
};

export default async function HomePage() {
  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();

  if (!auth.data.user) {
    return (
      <div className="landing">
        <section className="landing__hero" aria-labelledby="landing-title">
          <p className="eyebrow">Porodične finansije, jasnije</p>
          <h1 id="landing-title">Znajte gde odlazi svaki dinar.</h1>
          <p className="landing__lead">
            Dinar po dinar pomaže domaćinstvu da na jednom mestu vodi prihode i troškove,
            postavi limite po kategorijama i prati mesečni budžet zajedno.
          </p>
          <div className="landing__actions">
            <a className="button" href="/login">
              Prijava ili otvaranje naloga
            </a>
            <a className="button button--quiet" href="#kako-radi">
              Saznaj više
            </a>
          </div>
        </section>

        <section className="landing__section" aria-labelledby="kako-radi">
          <div className="landing__section-head">
            <p className="eyebrow">Jednostavan pregled</p>
            <h2 id="kako-radi">Porodični budžet bez nagađanja</h2>
            <p className="lead">
              Evidencija je organizovana oko domaćinstva, tako da članovi mogu da prate zajedničku
              sliku i razumeju mesečne navike potrošnje.
            </p>
          </div>
          <div className="landing__features">
            <article className="landing__feature">
              <h3>Prihodi i troškovi</h3>
              <p>
                Beležite iznose, datum, kategoriju, osobu i belešku. Pregled meseca sabira prihode,
                rashode i preostali iznos.
              </p>
            </article>
            <article className="landing__feature">
              <h3>Kategorije i limiti</h3>
              <p>
                Organizujte troškove i prihode po svojim kategorijama i postavite mesečni limit za
                kategorije troškova.
              </p>
            </article>
            <article className="landing__feature">
              <h3>Zajednički pregled</h3>
              <p>
                Pozovite članove domaćinstva, pregledajte unose po osobi i izvezite evidenciju u
                Excel kada vam zatreba.
              </p>
            </article>
          </div>
        </section>

        <section className="landing__closing" aria-labelledby="landing-closing-title">
          <div>
            <h2 id="landing-closing-title">Počnite od svog domaćinstva</h2>
            <p className="lead">
              Prijavite se bez lozinke — link za prijavu stiže na vašu e-poštu.
            </p>
          </div>
          <a className="button" href="/login">
            Nastavi na prijavu
          </a>
        </section>

        <footer className="landing__footer">
          <span>Dinar po dinar</span>
          <a href="/login">Prijava</a>
        </footer>
      </div>
    );
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
          title="Domaćinstvo se ne otvara"
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

  if (membership.data) {
    redirect(`/h/${membership.data.household_id}`);
  }

  const email = auth.data.user.email?.trim().toLowerCase();
  if (email) {
    const invite = await supabase
      .from("invitations")
      .select("token")
      .eq("email", email)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(1);

    if (invite.error) {
      console.error("pending invitation lookup failed", invite.error);
    }

    const pendingToken = invite.data?.[0]?.token;
    if (pendingToken) {
      redirect(`/poziv/${pendingToken}`);
    }
  }

  redirect("/novo");
}
