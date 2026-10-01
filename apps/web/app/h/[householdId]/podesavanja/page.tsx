import { redirect } from "next/navigation";

import { Passbook, PassbookHeader, Ruler } from "@/components/passbook";
import { Problem } from "@/components/problem";
import { loginPathWithNext, uuidParam } from "@/lib/next-path";
import { canManage } from "@/lib/rows";
import {
  buildMembers,
  daysLeft,
  expiryLabel,
  minorToInput,
  pendingInvitations,
  sortByName,
} from "@/lib/settings";
import { createServerComponentSupabase } from "@/lib/supabase/server";

import {
  ArchiveCategoryForm,
  CreateCategoryForm,
  InvitationLinkField,
  InviteForm,
  LimitForm,
  RemoveMemberForm,
  RenameCategoryForm,
  RevokeInvitationForm,
  RuleForm,
} from "./forms";

/**
 * Podešavanja domaćinstva.
 *
 * Član ovde ne dobija nijednu formu, samo rečenicu ko ih vodi. To je prvi sloj,
 * ne jedini: svaka akcija u `actions.ts` sama proverava prijavu i ulogu, pa
 * direktan poziv prolazi isto loše kao i klik koji ne postoji.
 */
export default async function SettingsPage({
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

  if (!auth.data.user) {
    if (auth.error) {
      console.error("settings: provera prijave nije uspela", auth.error);
    }
    redirect(loginPathWithNext(`/h/${householdId}/podesavanja`));
  }

  const userId = auth.data.user.id;

  // RLS je poslednja granica, ali svaki upit i dalje izričito sužava na ovo
  // domaćinstvo. Uloga se traži iz spiska članova koji se ionako prikazuje.
  const [household, members] = await Promise.all([
    supabase.from("households").select("name").eq("id", householdId).maybeSingle(),
    supabase
      .from("memberships")
      .select("user_id, role, profiles(display_name)")
      .eq("household_id", householdId),
  ]);

  const baseFailures = [
    ["households", household.error] as const,
    ["memberships", members.error] as const,
  ].filter(([, error]) => error !== null);

  // Prećutana greška izgleda kao domaćinstvo bez kategorija i bez članova, pa
  // bi vlasnik mislio da je nešto obrisano umesto da osveži stranu.
  if (baseFailures.length > 0) {
    for (const [table, error] of baseFailures) {
      console.error(`settings query failed: ${table}`, error);
    }

    return (
      <Problem
        title="Podešavanja se ne otvaraju"
        lead="Nismo pročitali domaćinstvo i spisak članova."
        backHref={`/h/${householdId}`}
        backLabel="Na mesečni pregled"
      >
        Osvežite stranu. Ako se ponavlja, odjavite se i prijavite novim linkom.
      </Problem>
    );
  }

  const membershipRows = members.data ?? [];
  const role = membershipRows.find((row) => row.user_id === userId)?.role ?? "";

  // Nečlan ne dobija ni potvrdu da domaćinstvo postoji.
  if (!household.data || role === "") {
    return (
      <Problem title="Domaćinstvo nije dostupno" lead="Ova knjižica ne postoji ili niste njen član.">
        Ako ste dobili pozivnicu, otvorite link iz e-pošte i prijavite se istom adresom.
      </Problem>
    );
  }

  const householdName = household.data.name;

  if (!canManage(role)) {
    return (
      <Passbook>
        <PassbookHeader
          eyebrow="Podešavanja"
          title={householdName}
          lead="Podešavanja vodi vlasnik domaćinstva."
        />
        <div className="stack stack--loose">
          <p>
            Kategorije, limite, članove, pozivnice i ponavljanja menja samo vlasnik. Vi vidite iste
            mesečne brojeve i dodajete unose.
          </p>
          <div className="row">
            <a className="button" href={`/h/${householdId}`}>
              Na mesečni pregled
            </a>
            <a className="button button--quiet" href={`/h/${householdId}/novi`}>
              Novi unos
            </a>
          </div>
        </div>
      </Passbook>
    );
  }

  const nowMs = Date.now();

  // Pozivnice se sužavaju već u upitu: iskorišćen i istekao token ne sme ni da
  // stigne do strane, jer bi se video kao link koji radi.
  const [categories, rules, invitations] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, kind, limit_minor, archived")
      .eq("household_id", householdId),
    supabase
      .from("recurring_rules")
      .select("id, kind, amount_minor, category_id, person_id, note, day_of_month, remind_days, active")
      .eq("household_id", householdId),
    supabase
      .from("invitations")
      .select("id, email, token, expires_at, used_at")
      .eq("household_id", householdId)
      .is("used_at", null)
      .gt("expires_at", new Date(nowMs).toISOString()),
  ]);

  const ownerFailures = [
    ["categories", categories.error] as const,
    ["recurring_rules", rules.error] as const,
    ["invitations", invitations.error] as const,
  ].filter(([, error]) => error !== null);

  if (ownerFailures.length > 0) {
    for (const [table, error] of ownerFailures) {
      console.error(`settings query failed: ${table}`, error);
    }

    return (
      <Problem
        title="Podešavanja se ne otvaraju"
        lead="Nismo pročitali kategorije, pozivnice i ponavljanja."
        backHref={`/h/${householdId}`}
        backLabel="Na mesečni pregled"
      >
        Osvežite stranu. Ako se ponavlja, odjavite se i prijavite novim linkom.
      </Problem>
    );
  }

  const categoryRows = sortByName(categories.data ?? []);
  const active = categoryRows.filter((category) => !category.archived);
  const archived = categoryRows.filter((category) => category.archived);
  const people = buildMembers(membershipRows);
  const waiting = pendingInvitations(invitations.data ?? [], nowMs);

  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const ruleRows = rules.data ?? [];

  return (
    <>
      <Passbook>
        <PassbookHeader
          eyebrow="Podešavanja"
          title={householdName}
          lead="Kategorije, limiti, članovi, pozivnice i ponavljanja. Sve ovo vidi i menja samo vlasnik."
        />
        <div className="row">
          <a className="button button--quiet" href={`/h/${householdId}`}>
            Na mesečni pregled
          </a>
        </div>
      </Passbook>

      <Passbook>
        <h2>Kategorije</h2>
        <p className="fine">
          Vrsta i domaćinstvo se posle otvaranja ne menjaju. Limit prati samo trošak.
        </p>

        <Ruler />

        <div className="stack stack--loose">
          <CreateCategoryForm householdId={householdId} />

          <div className="stack">
            <h3>Aktivne</h3>
            {active.length === 0 ? (
              <p className="fine">
                Nijedna aktivna kategorija. Dok je nema, nov unos nema šta da izabere.
              </p>
            ) : (
              <ul className="list stack stack--loose">
                {active.map((category) => (
                  <li className="group stack" key={category.id}>
                    <p className="ledger__title">
                      {category.name}
                      <span className="tag tag--quiet">
                        {category.kind === "expense" ? "trošak" : "prihod"}
                      </span>
                    </p>

                    <RenameCategoryForm
                      householdId={householdId}
                      categoryId={category.id}
                      name={category.name}
                    />

                    {category.kind === "expense" ? (
                      <LimitForm
                        householdId={householdId}
                        categoryId={category.id}
                        limit={minorToInput(category.limit_minor)}
                      />
                    ) : (
                      <p className="fine">Prihod nema limit.</p>
                    )}

                    <ArchiveCategoryForm householdId={householdId} categoryId={category.id} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="stack">
            <h3>Arhivirane</h3>
            {archived.length === 0 ? (
              <p className="fine">Nijedna arhivirana kategorija.</p>
            ) : (
              <>
                <p className="fine">
                  Ostaju u istoriji meseca, ne primaju nove unose i nemaju aktivna ponavljanja.
                  Limit se i ovde može ukloniti, da prag prestane da se javlja.
                </p>
                <ul className="list stack stack--loose">
                  {archived.map((category) => (
                    <li className="group stack" key={category.id}>
                      <p className="ledger__title">
                        {category.name}
                        <span className="tag tag--quiet">
                          {category.kind === "expense" ? "trošak" : "prihod"}
                        </span>
                        <span className="tag tag--quiet">arhivirana</span>
                      </p>

                      {category.kind === "expense" ? (
                        <LimitForm
                          householdId={householdId}
                          categoryId={category.id}
                          limit={minorToInput(category.limit_minor)}
                        />
                      ) : (
                        <p className="fine">Prihod nema limit.</p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </Passbook>

      <Passbook>
        <h2>Članovi</h2>
        <p className="fine">Vlasnik ostaje u domaćinstvu; uklanjaju se samo članovi.</p>

        <Ruler />

        <ul className="list stack stack--loose">
          {people.map((person) => (
            <li className="group stack" key={person.id}>
              <p className="ledger__title">
                {person.name}
                <span className="tag tag--quiet">{person.owner ? "vlasnik" : "član"}</span>
                {person.id === userId ? <span className="tag tag--quiet">vi</span> : null}
              </p>

              {person.owner ? (
                <p className="fine">Vlasnik se ne uklanja. Domaćinstvo ima tačno jednog.</p>
              ) : (
                <RemoveMemberForm
                  householdId={householdId}
                  userId={person.id}
                  name={person.name}
                />
              )}
            </li>
          ))}
        </ul>
      </Passbook>

      <Passbook>
        <h2>Pozivnice</h2>
        <p className="fine">
          Pozivnica vredi sedam dana, jednom, i samo za adresu na koju je napisana. Slanja e-pošte
          još nema, pa link prosleđujete sami.
        </p>

        <Ruler />

        <div className="stack stack--loose">
          <InviteForm householdId={householdId} />

          <div className="stack">
            <h3>Pozivnice koje čekaju</h3>
            {waiting.length === 0 ? (
              <p className="fine">Nijedna pozivnica ne čeka. Iskorišćene i istekle se ne prikazuju.</p>
            ) : (
              <ul className="list stack stack--loose">
                {waiting.map((invitation) => (
                  <li className="group stack" key={invitation.id}>
                    <p className="ledger__title">
                      {invitation.email}
                      <span className="tag tag--quiet">
                        još {daysLeft(invitation.expiresAt, nowMs)} d
                      </span>
                    </p>
                    <p className="fine">Ističe {expiryLabel(invitation.expiresAt)}.</p>

                    <InvitationLinkField
                      token={invitation.token}
                      label={`Link za ${invitation.email}`}
                    />

                    <RevokeInvitationForm
                      householdId={householdId}
                      invitationId={invitation.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Passbook>

      <Passbook>
        <h2>Ponavljanja</h2>
        <p className="fine">
          Iznos, dan i podsetnik se menjaju ovde. Kategorija i osoba se biraju pri otvaranju
          ponavljanja, kroz nov unos.
        </p>

        <Ruler />

        {ruleRows.length === 0 ? (
          <p className="fine">Nijedno ponavljanje. Pravi se uz nov unos, čekiranjem mesečnog ponavljanja.</p>
        ) : (
          <ul className="list stack stack--loose">
            {ruleRows.map((rule) => {
              const category = categoryById.get(rule.category_id);
              const person = personById.get(rule.person_id);

              return (
                <li className="group stack" key={rule.id}>
                  <p className="ledger__title">
                    {category?.name ?? "Nepoznata kategorija"}
                    <span className="tag tag--quiet">
                      {rule.kind === "expense" ? "trošak" : "prihod"}
                    </span>
                    {category?.archived ? <span className="tag tag--quiet">arhivirana</span> : null}
                    {rule.active ? null : <span className="tag tag--quiet">ugašeno</span>}
                  </p>

                  <RuleForm
                    householdId={householdId}
                    ruleId={rule.id}
                    amount={minorToInput(rule.amount_minor)}
                    day={String(rule.day_of_month)}
                    remind={String(rule.remind_days)}
                    active={rule.active}
                    description={
                      <>
                        {person?.name ?? "Bivši član"}
                        {rule.note ? ` · ${rule.note}` : ""}
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Passbook>
    </>
  );
}
