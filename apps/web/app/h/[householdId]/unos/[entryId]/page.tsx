import { formatMoney } from "@finance/domain";
import { redirect } from "next/navigation";

import { Passbook, PassbookHeader, Ruler } from "@/components/passbook";
import { Problem } from "@/components/problem";
import {
  categoryChoices,
  entryEditBlocker,
  entryMonthLabel,
  entryMonthPath,
  initialCategoryId,
  parseEntryKind,
  personChoices,
  type EditCategory,
} from "@/lib/entry-edit";
import { buildPeople, FALLBACK_PERSON_NAME } from "@/lib/month-query";
import { formatDate } from "@/lib/month-view";
import { loginPathWithNext, uuidParam } from "@/lib/next-path";
import { canManage } from "@/lib/rows";
import { minorToInput } from "@/lib/settings";
import { createServerComponentSupabase } from "@/lib/supabase/server";

import { DeleteEntryForm, EditEntryForm } from "./forms";

/**
 * Jedan unos: vlasnik ga menja ili briše, član ga samo vidi.
 *
 * Članu se ne iscrtava nijedna forma, ali to je prvi sloj, ne jedini:
 * `updateEntryAction` i `deleteEntryAction` same proveravaju prijavu i ulogu,
 * pa direktan poziv prolazi isto loše kao i klik koji ne postoji.
 *
 * Vrsta unosa se ovde ne menja. Kategorija pripada tačno jednoj vrsti, pa bi
 * promena vrste tražila i novu kategoriju — a to je nov unos, ne izmena ovog.
 */
export default async function EntryPage({
  params,
}: {
  params: Promise<{ householdId: string; entryId: string }>;
}) {
  const route = await params;

  // `household_id` i `id` su `uuid` kolone: neispravan tekst bi vratio grešku
  // tipa iz Postgresa umesto prazan rezultat, pa se oblik proverava pre upita.
  const householdId = uuidParam(route.householdId);
  const entryId = uuidParam(route.entryId);

  if (householdId === null || entryId === null) {
    return (
      <Problem title="Adresa nije ispravna" lead="Link ka unosu nije u očekivanom obliku.">
        Otvorite unos sa mesečnog pregleda.
      </Problem>
    );
  }

  const supabase = await createServerComponentSupabase();
  const auth = await supabase.auth.getUser();
  const user = auth.data.user;

  if (!user) {
    if (auth.error) {
      console.error("unos: provera prijave nije uspela", auth.error);
    }
    redirect(loginPathWithNext(`/h/${householdId}/unos/${entryId}`));
  }

  // RLS je poslednja granica, ali svaki upit i dalje izričito sužava na ovo
  // domaćinstvo — i sam unos, da pogođen tuđ `id` izgleda isto kao nepostojeći.
  // Kategorije idu bez `archived = false`: ona u kojoj unos stoji mora da
  // ostane u ponudi, inače izmena beleške traži i prekategorizaciju.
  const [household, members, entry, categories] = await Promise.all([
    supabase.from("households").select("name, currency").eq("id", householdId).maybeSingle(),
    supabase
      .from("memberships")
      .select("user_id, role, profiles(display_name)")
      .eq("household_id", householdId),
    supabase
      .from("entries")
      .select("id, kind, amount_minor, category_id, person_id, person_name, occurred_on, note")
      .eq("id", entryId)
      .eq("household_id", householdId)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id, name, kind, archived")
      .eq("household_id", householdId),
  ]);

  const failures = [
    ["households", household.error] as const,
    ["memberships", members.error] as const,
    ["entries", entry.error] as const,
    ["categories", categories.error] as const,
  ].filter(([, error]) => error !== null);

  // Prećutana greška izgledala bi kao obrisan unos, pa bi vlasnik tražio
  // krivca umesto da osveži stranu.
  if (failures.length > 0) {
    for (const [table, error] of failures) {
      console.error(`entry page query failed: ${table}`, error);
    }

    return (
      <Problem
        title="Unos se ne otvara"
        lead="Nismo pročitali unos i spisak članova domaćinstva."
        backHref={`/h/${householdId}`}
        backLabel="Na mesečni pregled"
      >
        Osvežite stranu. Ako se ponavlja, odjavite se i prijavite novim linkom.
      </Problem>
    );
  }

  const membershipRows = members.data ?? [];
  const role = membershipRows.find((row) => row.user_id === user.id)?.role ?? "";

  // Nečlan ne dobija ni potvrdu da domaćinstvo postoji — pa ni da unos postoji.
  if (!household.data || role === "") {
    return (
      <Problem title="Domaćinstvo nije dostupno" lead="Ovo domaćinstvo ne postoji ili niste njegov član.">
        Ako ste dobili pozivnicu, otvorite link iz e-pošte i prijavite se istom adresom.
      </Problem>
    );
  }

  const householdName = household.data.name;
  const kind = entry.data ? parseEntryKind(entry.data.kind) : null;

  // Red je obrisan, tuđ, ili ne nosi prepoznatu vrstu. Sve troje za člana ovog
  // domaćinstva znači isto: nema šta da se otvori.
  if (!entry.data || kind === null) {
    return (
      <Problem
        title="Unos nije nađen"
        lead="Ovaj unos više ne postoji u ovom domaćinstvu."
        backHref={`/h/${householdId}`}
        backLabel="Na mesečni pregled"
      >
        Možda je obrisan u međuvremenu. Otvorite mesečni pregled i izaberite unos iz liste.
      </Problem>
    );
  }

  const personName = (entry.data.person_name ?? "").trim() || FALLBACK_PERSON_NAME;
  const occurredOn: string = entry.data.occurred_on;
  const monthHref = entryMonthPath(householdId, occurredOn);

  // Član vidi ko unos menja i na koga je upisan. Nijedna forma, nijedno polje:
  // kontrola koja ne može da uspe ne treba ni da postoji.
  if (!canManage(role)) {
    return (
      <Passbook>
        <PassbookHeader eyebrow="Unos" title={householdName} lead="Unos menja vlasnik." />
        <div className="stack stack--loose">
          <p>
            Unos je zapisan na {personName}. Iznos, kategoriju, osobu, datum i belešku menja
            vlasnik domaćinstva; vi vidite iste mesečne brojeve i dodajete nove unose.
          </p>
          <div className="row">
            <a className="button" href={monthHref}>
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

  const categoryRows: EditCategory[] = (categories.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    archived: row.archived === true,
  }));

  const choices = categoryChoices(categoryRows, { kind, categoryId: entry.data.category_id });
  const people = personChoices(buildPeople(membershipRows), {
    id: entry.data.person_id,
    name: personName,
  });

  const amount = formatMoney(entry.data.amount_minor, household.data.currency);
  const date = formatDate(occurredOn);

  // Datum van prozora koji aplikacija otvara (1900–2999) ne može da nastane
  // kroz formu, ali može kroz direktan upis u bazu. Takav red ostaje bez
  // natpisa meseca umesto da obori stranu na kojoj se datum i popravlja.
  const month = entryMonthLabel(occurredOn);

  return (
    <>
      <Passbook>
        <PassbookHeader
          eyebrow="Izmena unosa"
          title={householdName}
          lead={month === null ? date : `${month} — ${date}`}
        />

        <p className="fine">
          <span className="tag tag--quiet">{kind === "expense" ? "trošak" : "prihod"}</span>
          Vrsta se ne menja. Zapisano na {personName}.
        </p>

        <Ruler />

        <EditEntryForm
          householdId={householdId}
          entryId={entryId}
          monthHref={monthHref}
          categories={choices}
          people={people}
          amount={minorToInput(entry.data.amount_minor)}
          categoryId={initialCategoryId(choices, entry.data.category_id)}
          personId={entry.data.person_id}
          occurredOn={occurredOn}
          note={entry.data.note ?? ""}
          blocker={entryEditBlocker({ choices, people, kind })}
        />
      </Passbook>

      <Passbook>
        <h2>Brisanje</h2>
        <p className="fine">
          Obrisan unos nestaje iz mesečnog zbira, trake kategorije i liste. Ako je nastao iz
          ponavljanja, pravilo ostaje i sledećeg meseca ponovo dospeva.
        </p>

        <Ruler />

        <DeleteEntryForm
          householdId={householdId}
          entryId={entryId}
          summary={`Briše se unos od ${date}, ${amount}, zapisan na ${personName}.`}
        />
      </Passbook>
    </>
  );
}
