import { monthKey, todayInBelgrade } from "@finance/domain";
import { redirect } from "next/navigation";

import { Problem } from "@/components/problem";
import {
  buildEntryList,
  buildMonthNav,
  buildMonthView,
  buildUpcoming,
  groupEntriesByDay,
} from "@/lib/month-view";
import { buildPeople, monthParam, selectCategory, selectPerson } from "@/lib/month-query";
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
        lead="Ovo domaćinstvo ne postoji ili niste njegov član."
      >
        Ako ste dobili pozivnicu, otvorite link iz e-pošte i prijavite se istom adresom.
      </Problem>
    );
  }

  const currency = household.data.currency;
  const people = buildPeople(membershipRows);
  const person = selectPerson(query.person, people);
  const categoryRows = (categories.data ?? []).map(toCategoryRow);
  const category = selectCategory(query.category, categoryRows);
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
    entries: category ? current.filter((entry) => entry.categoryId === category.id) : current,
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
  const href = (
    nextMonth: string,
    filters: { personId?: string | null; categoryId?: string | null } = {},
  ) => {
    const search = new URLSearchParams({ month: nextMonth });
    const selectedPerson = "personId" in filters ? filters.personId : person?.id;
    const selectedCategory = "categoryId" in filters ? filters.categoryId : category?.id;
    if (selectedPerson) search.set("person", selectedPerson);
    if (selectedCategory) search.set("category", selectedCategory);
    return `/h/${householdId}?${search.toString()}`;
  };
  const days = groupEntriesByDay(ledger);
  const scope = person ? person.name : "Celo domaćinstvo";

  return (
    <>
      <LiveEntries householdId={householdId} />

      <header className="pagehead">
        <div className="pagehead__title">
          <p className="eyebrow">{scope}</p>
          <h1>{household.data.name}</h1>
        </div>
        <div className="row">
          <a className="button button--quiet" href={`/h/${householdId}/izvoz`}>
            Izvezi u Excel
          </a>
          {owner ? (
            <a className="button button--quiet" href={`/h/${householdId}/podesavanja`}>
              Podešavanja
            </a>
          ) : null}
          <a className="button" href={`/h/${householdId}/novi`}>
            Novi unos
          </a>
        </div>
      </header>

      <div className="filters">
        <nav className="stepper" aria-label="Izbor meseca">
          {nav.previous ? (
            <a className="stepper__go" href={href(nav.previous.month)} rel="prev">
              <span aria-hidden="true">‹</span>
              <span className="sr-only">{nav.previous.label}</span>
            </a>
          ) : (
            <span className="stepper__go" aria-disabled="true" />
          )}
          <span className="stepper__label" aria-current="page">
            {displayMonth(nav.current.label)}
          </span>
          {nav.next ? (
            <a className="stepper__go" href={href(nav.next.month)} rel="next">
              <span aria-hidden="true">›</span>
              <span className="sr-only">{nav.next.label}</span>
            </a>
          ) : (
            <span className="stepper__go" aria-disabled="true" />
          )}
        </nav>

        <nav className="switch" aria-label="Filter po osobi">
          <a
            className={`switch__item${person ? "" : " switch__item--on"}`}
            href={href(month, { personId: null })}
            aria-current={person ? undefined : "page"}
          >
            Svi
          </a>
          {people.map((candidate) => (
            <a
              key={candidate.id}
              className={`switch__item${person?.id === candidate.id ? " switch__item--on" : ""}`}
              href={href(month, { personId: candidate.id })}
              aria-current={person?.id === candidate.id ? "page" : undefined}
            >
              {candidate.name}
            </a>
          ))}
        </nav>
      </div>

      <section className="card summary" aria-label="Zbir meseca">
        <div className="summary__top">
          <dl className="figure figure--lead">
            <dt>Trenutno stanje</dt>
            <dd
              className={`amount${
                view.leftoverMinor > 0 ? " amount--plus" : view.leftoverMinor < 0 ? " amount--short" : ""
              }`}
            >
              {view.leftoverMinor > 0 ? "+" : ""}
              {view.leftover}
            </dd>
          </dl>
          <div className="figures">
            <dl className="figure">
              <dt>Prihod</dt>
              <dd className="amount amount--plus">{view.income}</dd>
            </dl>
            <dl className="figure">
              <dt>Trošak</dt>
              <dd className="amount amount--short">{view.expense}</dd>
            </dl>
          </div>
        </div>
        <p className="verdict">{view.sentence}</p>
        {view.alertRows.length > 0 ? (
          <ul className="alerts" aria-label="Pragovi limita">
            {view.alertRows.map((alert) => (
              <li
                key={`${alert.categoryId}:${alert.threshold}`}
                className={`tag tag--${alert.threshold === 100 ? "over" : "near"}`}
              >
                {alert.message}
                {alert.archived ? " (arhivirana)" : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="columns">
        <div className="columns__side">
          <section className="card" aria-labelledby="kategorije">
            <div className="card__head">
              <h2 id="kategorije">Kategorije</h2>
              {person ? <p className="fine">Limit važi za celo domaćinstvo</p> : null}
            </div>

            {view.bars.length === 0 ? (
              <p className="empty">Nema troškova u ovom mesecu.</p>
            ) : (
              <ul className="bars">
                {view.bars.map((bar) => (
                  <li className="bar" key={bar.categoryId}>
                    <span className="bar__name">
                      <a
                        className="bar__category-link"
                        href={href(month, { categoryId: bar.categoryId })}
                        aria-current={category?.id === bar.categoryId ? "page" : undefined}
                      >
                        {bar.name}
                      </a>
                      {bar.archived ? <span className="tag">arhivirana</span> : null}
                      {bar.state === "near" || bar.state === "over" ? (
                        <span className={`tag tag--${bar.state}`}>{bar.percent}%</span>
                      ) : null}
                    </span>
                    <span className="bar__amount amount">
                      <BarAmount label={bar.label} />
                    </span>
                    <span className="meter" data-state={bar.state} aria-hidden="true">
                      <span className="meter__fill" style={{ inlineSize: `${bar.width}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="dospeca">
            <div className="card__head">
              <h2 id="dospeca">Uskoro dospeva</h2>
            </div>

            {upcoming.length === 0 ? (
              <p className="empty">Nema mesečnih ponavljanja.</p>
            ) : (
              <ul className="ledger">
                {upcoming.map((row) => (
                  <li className="ledger__row" key={row.id}>
                    <span className="ledger__date amount">{row.dueDate}</span>
                    <span className="ledger__body">
                      <span className="ledger__title">
                        {row.categoryName}
                        <span className={`tag${row.state === "uneto" ? " tag--good" : ""}`}>
                          {row.label}
                        </span>
                      </span>
                      <span className="fine">
                        {row.personName} · podsetnik {row.remindDate}
                      </span>
                    </span>
                    <span className="ledger__amount amount">{row.amount}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card" aria-labelledby="unosi">
          <div className="card__head">
            <h2 id="unosi">{category ? `Unosi kategorije „${category.name}“` : "Unosi"}</h2>
            <p className="fine">{ledger.length === 0 ? "" : `${ledger.length} u mesecu`}</p>
          </div>

          {category ? (
            <p className="fine category-filter">
              <a href={href(month, { categoryId: null })}>Ukloni filter kategorije</a>
            </p>
          ) : null}

          {days.length === 0 ? (
            <div className="empty stack">
              <p>
                {category
                  ? `Ovog meseca nema unosa kategorije „${category.name}“.`
                  : "Ovaj mesec još nema unosa."}
              </p>
              {category ? null : (
                <p>
                  <a className="button" href={`/h/${householdId}/novi`}>
                    Dodaj prvi unos
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div className="days">
              {days.map((day) => (
                <section key={day.occurredOn} aria-label={day.date}>
                  <h3 className="day__head">
                    <span>{day.date}</span>
                  </h3>
                  <ul className="entries">
                    {day.rows.map((row) => {
                      const body = (
                        <>
                          <span className="entry__body">
                            <span className="entry__title">
                              {row.categoryName}
                              {row.categoryArchived ? <span className="tag">arhivirana</span> : null}
                              {row.automatic ? <span className="tag">ponavljanje</span> : null}
                            </span>
                            <span className="entry__meta">
                              {row.personName}
                              {row.note ? ` · ${row.note}` : ""}
                            </span>
                          </span>
                          <span className="entry__amount amount">
                            {row.kind === "income" ? "+" : "−"}
                            {row.amount}
                          </span>
                        </>
                      );
                      return (
                        <li key={row.id}>
                          {owner ? (
                            <a className="entry" href={`/h/${householdId}/unos/${row.id}`}>
                              {body}
                              <span className="sr-only">
                                Izmeni unos od {row.date}, {row.amount}
                              </span>
                            </a>
                          ) : (
                            <div className="entry">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/** „septembar 2026.“ → „Septembar 2026“ */
function displayMonth(label: string): string {
  const trimmed = label.replace(/\.$/, "");
  return trimmed.charAt(0).toLocaleUpperCase("sr") + trimmed.slice(1);
}

/** „34.400 RSD / 40.000 RSD“: potrošeno je istaknuto, limit je prateći. */
function BarAmount({ label }: { label: string }) {
  const [spent, limit] = label.split(" / ");
  return (
    <>
      <strong>{spent}</strong>
      {limit ? ` / ${limit}` : null}
    </>
  );
}
