import { monthKey, todayInBelgrade } from "@finance/domain";
import { redirect } from "next/navigation";

import { Notice } from "@/components/form";
import { Passbook, PassbookHeader, Ruler } from "@/components/passbook";
import { Problem } from "@/components/problem";
import {
  buildEntryList,
  buildMonthNav,
  buildMonthView,
  buildUpcoming,
} from "@/lib/month-view";
import { buildPeople, monthParam, selectPerson } from "@/lib/month-query";
import { loginPathWithNext, uuidParam } from "@/lib/next-path";
import {
  canManage,
  toCategoryRow,
  toEntryDetail,
  toRecurringSnapshot,
} from "@/lib/rows";
import { createServerComponentSupabase } from "@/lib/supabase/server";

import { LiveEntries } from "./live";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const route = await params;
  const query = await searchParams;

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
    redirect(loginPathWithNext(`/h/${householdId}`));
  }

  const today = todayInBelgrade(new Date());
  const month = monthParam(query.month, today);
  // Susedi se računaju jednom. Na ivicama prihvaćenog prozora (`1900-01`,
  // `2999-12`) sused ne postoji, pa se ni ne natpisuje ni ne linkuje.
  const nav = buildMonthNav(month);
  const previousMonth = nav.previous?.month ?? null;

  // RLS je granica, ali svaki upit i dalje izričito sužava na ovo domaćinstvo
  // i na dva meseca koja se zaista prikazuju.
  const [household, categories, entries, members, rules] = await Promise.all([
    supabase.from("households").select("name, currency").eq("id", householdId).maybeSingle(),
    // Bez `archived = false`: arhivirana kategorija nestaje iz ponude za nov
    // unos, ali njena istorija ostaje u zbiru, traci i listi ovog meseca.
    supabase
      .from("categories")
      .select("id, name, kind, limit_minor, archived")
      .eq("household_id", householdId),
    supabase
      .from("entries")
      .select(
        "id, kind, amount_minor, category_id, person_id, person_name, occurred_on, note, recurring_rule_id",
      )
      .eq("household_id", householdId)
      .in("month_key", previousMonth === null ? [month] : [month, previousMonth]),
    supabase
      .from("memberships")
      .select("user_id, role, profiles(display_name)")
      .eq("household_id", householdId),
    supabase
      .from("recurring_rules")
      .select("id, kind, amount_minor, category_id, person_id, note, day_of_month, remind_days")
      .eq("household_id", householdId)
      .eq("active", true),
  ]);

  // Prazan mesec i mesec koji nije stigao izgledaju isto ako se greška prećuti.
  // Zato se svaki upit proverava: bolje vidljiv zastoj nego lažna nula.
  const failures = [
    ["households", household.error] as const,
    ["categories", categories.error] as const,
    ["entries", entries.error] as const,
    ["memberships", members.error] as const,
    ["recurring_rules", rules.error] as const,
  ].filter(([, error]) => error !== null);

  if (failures.length > 0) {
    for (const [table, error] of failures) {
      console.error(`month view query failed: ${table}`, error);
    }

    return (
      <Problem
        title="Mesec se ne otvara"
        lead="Nismo pročitali podatke domaćinstva. Unosi su na mestu — veza nije odgovorila."
      >
        Osvežite stranu. Ako se ponavlja, odjavite se i prijavite novim linkom.
      </Problem>
    );
  }

  const membershipRows = members.data ?? [];
  const role = membershipRows.find((row) => row.user_id === auth.data.user?.id)?.role ?? "";

  // Nečlan ne dobija ni potvrdu da domaćinstvo postoji.
  if (!household.data || role === "") {
    return (
      <Problem
        title="Domaćinstvo nije dostupno"
        lead="Ova knjižica ne postoji ili niste njen član."
      >
        Ako ste dobili pozivnicu, otvorite link iz e-pošte i prijavite se istom adresom.
      </Problem>
    );
  }

  const currency = household.data.currency;
  const people = buildPeople(membershipRows);
  const person = selectPerson(query.person, people);
  const categoryRows = (categories.data ?? []).map(toCategoryRow);
  const entryRows = (entries.data ?? []).map(toEntryDetail);
  const current = entryRows.filter((entry) => monthKey(entry.occurredOn) === month);
  // Prvi mesec prozora nema prethodni, pa pravilo rasta ne važi.
  const previous =
    previousMonth === null
      ? null
      : entryRows.filter((entry) => monthKey(entry.occurredOn) === previousMonth);

  const view = buildMonthView({
    currency,
    month,
    categories: categoryRows,
    entries: current,
    previous,
    ...(person ? { personId: person.id, personName: person.name } : {}),
  });

  const ledger = buildEntryList({
    currency,
    month,
    categories: categoryRows,
    entries: current,
    ...(person ? { personId: person.id } : {}),
  });

  const upcoming = buildUpcoming({
    currency,
    month,
    today,
    categories: categoryRows,
    people,
    rules: (rules.data ?? []).map(toRecurringSnapshot),
    entries: current,
    ...(person ? { personId: person.id } : {}),
  });

  const owner = canManage(role);
  const href = (nextMonth: string, personId?: string) =>
    `/h/${householdId}?month=${nextMonth}${personId ? `&person=${personId}` : ""}`;
  const scope = person ? person.name : "celo domaćinstvo";

  return (
    <>
      <LiveEntries householdId={householdId} />

      <Passbook>
        <PassbookHeader
          eyebrow="Mesečni pregled"
          title={household.data.name}
          lead={`${nav.current.label} — ${scope}`}
        />

        <div className="stack stack--loose">
          <nav className="switch" aria-label="Izbor meseca">
            {nav.previous ? (
              <a className="switch__item" href={href(nav.previous.month, person?.id)} rel="prev">
                {nav.previous.label}
              </a>
            ) : null}
            <span className="switch__item switch__item--on" aria-current="page">
              {nav.current.label}
            </span>
            {nav.next ? (
              <a className="switch__item" href={href(nav.next.month, person?.id)} rel="next">
                {nav.next.label}
              </a>
            ) : null}
          </nav>

          <nav className="switch" aria-label="Filter po osobi">
            <a
              className={`switch__item${person ? "" : " switch__item--on"}`}
              href={href(month)}
              aria-current={person ? undefined : "page"}
            >
              Svi
            </a>
            {people.map((candidate) => (
              <a
                key={candidate.id}
                className={`switch__item${person?.id === candidate.id ? " switch__item--on" : ""}`}
                href={href(month, candidate.id)}
                aria-current={person?.id === candidate.id ? "page" : undefined}
              >
                {candidate.name}
              </a>
            ))}
          </nav>

          <dl className="totals">
            <div className="totals__cell">
              <dt>Prihod</dt>
              <dd className="amount">{view.income}</dd>
            </div>
            <div className="totals__cell">
              <dt>Trošak</dt>
              <dd className="amount">{view.expense}</dd>
            </div>
            <div className="totals__cell totals__cell--sum">
              <dt>Ostatak</dt>
              <dd className={`amount${view.leftoverMinor < 0 ? " amount--short" : ""}`}>
                {view.leftover}
              </dd>
            </div>
          </dl>

          <Ruler />

          <p className="verdict">{view.sentence}</p>

          {view.alertRows.length > 0 ? (
            <ul className="alerts stack stack--tight" aria-label="Pragovi limita">
              {view.alertRows.map((alert) => (
                <li key={`${alert.categoryId}:${alert.threshold}`}>
                  <Notice tone="bad">
                    {alert.message}
                    {alert.archived ? <span className="tag tag--quiet">arhivirana</span> : null}
                  </Notice>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Passbook>

      <Passbook>
        <h2>Kategorije naspram limita</h2>
        <p className="fine">
          {person
            ? `Trake prikazuju samo unose osobe ${person.name}. Limit važi za celu kategoriju domaćinstva.`
            : "Limit važi za celu kategoriju troška, ne po osobi."}
        </p>

        {view.bars.length === 0 ? (
          <p className="fine">Nema troškova u ovom mesecu.</p>
        ) : (
          <ul className="bars">
            {view.bars.map((bar) => (
              <li className="bar" key={bar.categoryId}>
                <span className="bar__name">
                  {bar.name}
                  {bar.archived ? <span className="tag tag--quiet">arhivirana</span> : null}
                  {bar.limited ? null : <span className="tag tag--quiet">bez limita</span>}
                </span>
                <span className="bar__amount amount">{bar.label}</span>
                <span
                  className={`bar__track${bar.over ? " bar__track--over" : ""}${bar.limited ? "" : " bar__track--free"}`}
                  aria-hidden="true"
                >
                  <span className="bar__fill" style={{ inlineSize: `${bar.width}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Passbook>

      <Passbook>
        <h2>Dospeća i podsetnici</h2>
        <p className="fine">Mesečna ponavljanja koja dospevaju u {nav.current.label}</p>

        {upcoming.length === 0 ? (
          <p className="fine">Nema aktivnih ponavljanja za ovaj mesec.</p>
        ) : (
          <ul className="ledger">
            {upcoming.map((row) => (
              <li className="ledger__row" key={row.id}>
                <span className="ledger__date amount">{row.dueDate}</span>
                <span className="ledger__body">
                  <span className="ledger__title">
                    {row.categoryName}
                    <span className={`tag tag--${row.state === "uneto" ? "good" : "quiet"}`}>
                      {row.label}
                    </span>
                  </span>
                  <span className="fine">
                    {row.kindLabel} · {row.personName} · podsetnik {row.remindDate}
                  </span>
                </span>
                <span className="ledger__amount amount">{row.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </Passbook>

      <Passbook>
        <h2>Unosi</h2>
        <p className="fine">
          {person
            ? `Unosi osobe ${person.name} u ${nav.current.label}`
            : `Svi unosi u ${nav.current.label}`}
        </p>

        {ledger.length === 0 ? (
          <p className="fine">Ovaj mesec još nema unosa.</p>
        ) : (
          <ul className="ledger">
            {ledger.map((row) => (
              <li className="ledger__row" key={row.id}>
                <span className="ledger__date amount">{row.date}</span>
                <span className="ledger__body">
                  <span className="ledger__title">
                    {row.categoryName}
                    {row.categoryArchived ? <span className="tag tag--quiet">arhivirana</span> : null}
                    {row.automatic ? <span className="tag tag--quiet">ponavljanje</span> : null}
                  </span>
                  <span className="fine">
                    {row.kindLabel} · {row.personName}
                    {row.note ? ` · ${row.note}` : ""}
                  </span>
                </span>
                <span
                  className={`ledger__amount amount${row.kind === "income" ? " amount--in" : ""}`}
                >
                  {row.amount}
                </span>
                {owner ? (
                  <a className="ledger__edit" href={`/h/${householdId}/unos/${row.id}`}>
                    Izmeni<span className="sr-only"> unos od {row.date}, {row.amount}</span>
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Ruler />

        <div className="row">
          <a className="button" href={`/h/${householdId}/novi`}>
            Novi unos
          </a>
          <a className="button button--quiet" href={`/h/${householdId}/podesavanja`}>
            Podešavanja
          </a>
        </div>
      </Passbook>
    </>
  );
}
