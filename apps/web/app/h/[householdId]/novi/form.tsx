"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { Field, Notice } from "@/components/form";
import { CategoryCombobox } from "@/components/category-combobox";
import { Passbook, PassbookHeader, Ruler } from "@/components/passbook";
import {
  canSend,
  categoriesOfKind,
  entryBlocker,
  entryErrorMessage,
  initialEntryState,
  isCalendarDate,
  phaseAfter,
  saveEntry,
  saveLabel,
  switchKind,
  ticketFor,
  validateEntry,
  type CategoryOption,
  type EntryGateway,
  type PersonOption,
  type RequestTicket,
  type SaveResult,
  type SubmitPhase,
} from "@/lib/entry-form";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Jedini deo forme koji zna za Supabase.
 *
 * Običan unos je direktan `insert` pod RLS-om. Unos sa ponavljanjem ide kroz
 * `create_entry_with_rule`, jer dva odvojena poziva iz pregledača nisu jedna
 * transakcija: pad drugog ostavio bi pravilo bez unosa, a član ga ne može ni
 * obrisati ni ugasiti.
 *
 * Fabrika se prosleđuje `saveEntry`-ju, ne poziva ovde: `createBrowserSupabase`
 * baca kad nedostaje `NEXT_PUBLIC_SUPABASE_*`, a ta greška mora da završi kao
 * poruka pod formom, ne kao dugme koje zauvek piše „Čuvam…“.
 */
function browserGateway(): EntryGateway {
  const supabase = createBrowserSupabase();

  return {
    async insertEntry(draft) {
      return supabase.from("entries").insert({
        household_id: draft.householdId,
        kind: draft.kind,
        amount_minor: draft.amountMinor,
        category_id: draft.categoryId,
        person_id: draft.personId,
        occurred_on: draft.occurredOn,
        note: draft.note,
      });
    },
    async createWithRule(draft, requestId) {
      return supabase.rpc("create_entry_with_rule", {
        p_household_id: draft.householdId,
        p_kind: draft.kind,
        p_amount_minor: draft.amountMinor,
        p_category_id: draft.categoryId,
        p_person_id: draft.personId,
        p_occurred_on: draft.occurredOn,
        p_note: draft.note,
        p_day_of_month: draft.repeat.dayOfMonth,
        p_remind_days: draft.repeat.remindDays,
        p_request_id: requestId,
      });
    },
  };
}

export function EntryForm({
  householdId,
  householdName,
  categories,
  people,
  signedInPersonId,
  today,
}: {
  householdId: string;
  householdName: string;
  categories: CategoryOption[];
  people: PersonOption[];
  signedInPersonId: string;
  today: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(() =>
    initialEntryState({ categories, people, signedInPersonId, today }),
  );
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Karta pokušaja preživi pad, da retry istog nacrta nosi isti identifikator
  // i da ga baza prepozna umesto da napravi drugo pravilo. Ref, ne state:
  // menja se u obradi događaja i ne traži ponovno iscrtavanje.
  const ticket = useRef<RequestTicket | null>(null);

  const visibleCategories = useMemo(
    () => categoriesOfKind(categories, state.kind),
    [categories, state.kind],
  );
  const blocker = entryBlocker({ categories, people, kind: state.kind });
  const repeatDay = isCalendarDate(state.occurredOn) ? Number(state.occurredOn.slice(8, 10)) : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSend(phase) || blocker !== null) {
      return;
    }

    setError(null);

    const checked = validateEntry(state, { householdId, categories, people });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }

    setPhase("sending");

    // Ništa između brave i njenog otpuštanja ne sme da izađe kao izuzetak:
    // nepostojeći `crypto`, nedostajuća okolina, pukla fabrika klijenta — sve
    // mora da završi kao poruka i vraćeno dugme, ne kao večno „Čuvam…“.
    let result: SaveResult;
    try {
      const attempt = ticketFor(checked.draft, ticket.current);
      ticket.current = attempt;
      result = await saveEntry(checked.draft, browserGateway, attempt.requestId);
    } catch (caught) {
      result = {
        ok: false,
        message: entryErrorMessage(caught instanceof Error ? caught.message : null),
      };
    }

    // Nijedno polje se ne dira ni pri uspehu ni pri padu. Pad mreže zato
    // ostavlja iznos, kategoriju, datum i belešku tačno onakve kakvi su bili.
    setPhase(phaseAfter("sending", result));

    if (!result.ok) {
      setError(result.message);
      return;
    }

    // Karta je potrošena: sledeće slanje je nov unos, pa i dve iste pretplate
    // mogu da se upišu jedna za drugom.
    ticket.current = null;

    // Mesec unosa, ne tekući mesec. Unos sa datumom iz prošlog ili sledećeg
    // meseca inače nestane sa ekrana čim se sačuva.
    router.push(`/h/${householdId}?month=${checked.draft.occurredOn.slice(0, 7)}`);
    router.refresh();
  }

  return (
    <Passbook>
      <PassbookHeader
        eyebrow="Novi unos"
        title={householdName}
        lead="Upišite trošak ili prihod. Ako se ponavlja svakog meseca, uključite ponavljanje i podsetnik."
      />

      <form className="stack stack--loose" onSubmit={onSubmit} noValidate>
        <Field id="vrsta" label="Vrsta">
          <select
            id="vrsta"
            className="input input--narrow"
            name="vrsta"
            value={state.kind}
            onChange={(event) =>
              setState((current) =>
                switchKind(current, event.target.value === "income" ? "income" : "expense", categories),
              )
            }
          >
            <option value="expense">Trošak</option>
            <option value="income">Prihod</option>
          </select>
        </Field>

        <Field id="iznos" label="Iznos" hint="Zarez je decimala: 12,50. Tačka razdvaja hiljade: 1.200.">
          <input
            id="iznos"
            className="input input--mono input--narrow"
            name="iznos"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={state.amount}
            onChange={(event) => setState((current) => ({ ...current, amount: event.target.value }))}
            maxLength={16}
            aria-describedby="iznos-hint"
            required
          />
        </Field>

        <Field
          id="kategorija"
          label="Kategorija"
          hint={
            state.kind === "expense"
              ? "Limit se prati po kategoriji troška."
              : "Prihodi nemaju limit."
          }
        >
          <CategoryCombobox
            categories={visibleCategories}
            value={state.categoryId}
            onChange={(categoryId) => setState((current) => ({ ...current, categoryId }))}
            hintId="kategorija-hint"
          />
        </Field>

        <Field id="beleska" label="Beleška" hint="Neobavezno. Na primer „pijaca“ ili „struja za avgust“.">
          <input
            id="beleska"
            className="input"
            name="beleska"
            type="text"
            value={state.note}
            onChange={(event) => setState((current) => ({ ...current, note: event.target.value }))}
            maxLength={120}
            aria-describedby="beleska-hint"
          />
        </Field>

        <Field id="datum" label="Datum" hint="Podrazumevano je današnji dan u Beogradu.">
          <input
            id="datum"
            className="input input--mono input--narrow"
            name="datum"
            type="date"
            value={state.occurredOn}
            onChange={(event) =>
              setState((current) => ({ ...current, occurredOn: event.target.value }))
            }
            aria-describedby="datum-hint"
            required
          />
        </Field>

        {people.length > 1 ? (
          <Field id="osoba" label="Osoba" hint="Ime se pamti uz unos i ostaje i ako osoba kasnije izađe.">
            <select
              id="osoba"
              className="input"
              name="osoba"
              value={state.personId}
              onChange={(event) =>
                setState((current) => ({ ...current, personId: event.target.value }))
              }
              aria-describedby="osoba-hint"
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <input type="hidden" name="osoba" value={state.personId} />
        )}

        <div className="check">
          <input
            id="ponavljanje"
            className="check__box"
            name="ponavljanje"
            type="checkbox"
            checked={state.repeat}
            onChange={(event) =>
              setState((current) => ({ ...current, repeat: event.target.checked }))
            }
            aria-describedby="ponavljanje-hint"
          />
          <span className="check__text">
            <label className="check__label" htmlFor="ponavljanje">
              Mesečno ponavljanje
            </label>
            <span className="field__hint" id="ponavljanje-hint">
              {repeatDay === null
                ? "Pravilo uzima dan iz datuma iznad."
                : `Ponavljaće se ${repeatDay}. u mesecu; u kraćem mesecu poslednjeg dana.`}
            </span>
          </span>
        </div>

        {state.repeat ? (
          <fieldset className="group">
            <legend className="group__legend">Podsetnik</legend>
            <Field id="podsetnik" label="Dana ranije" hint="Ceo broj od 1 do 7.">
              <input
                id="podsetnik"
                className="input input--mono input--short"
                name="podsetnik"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={state.remindDays}
                onChange={(event) =>
                  setState((current) => ({ ...current, remindDays: event.target.value }))
                }
                maxLength={1}
                aria-describedby="podsetnik-hint"
              />
            </Field>
          </fieldset>
        ) : null}

        {blocker ? <Notice tone="bad">{blocker}</Notice> : null}
        {error ? <Notice tone="bad">Unos nije sačuvan. {error}</Notice> : null}

        <Ruler />

        <div className="row">
          <button type="submit" className="button" disabled={phase !== "idle" || blocker !== null}>
            {saveLabel(phase)}
          </button>
          <a className="button button--quiet" href={`/h/${householdId}`}>
            Odustani
          </a>
        </div>
      </form>
    </Passbook>
  );
}
