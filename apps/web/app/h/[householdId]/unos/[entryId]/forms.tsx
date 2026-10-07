"use client";

/**
 * Forme izmene unosa. Dve, odvojene, sa svojim stanjem akcije.
 *
 * Odvojene su zato što su različite radnje: čuvanje popravlja red, brisanje ga
 * uklanja zauvek. Jedna forma sa dva dugmeta (`formAction`) radi isto, ali
 * ostavlja pogrešan klik na jedan piksel razdaljine i deli poruku, pa bi
 * odbijeno čuvanje izgledalo kao odbijeno brisanje.
 *
 * Polja su kontrolisana (`value` + `onChange`): React posle server akcije
 * resetuje nekontrolisanu formu, pa bi odbijen iznos ili datum nestao baš kad
 * treba da se popravi. `SubmitButton` se zaključava dok akcija traje, pa drugi
 * klik ne šalje isti zahtev još jednom.
 */

import { useActionState, useState } from "react";

import { CategoryCombobox } from "@/components/category-combobox";
import { Field, Notice } from "@/components/form";
import { Ruler } from "@/components/passbook";
import { SubmitButton } from "@/components/submit-button";
import { MAX_NOTE, type EditCategory, type EditPerson } from "@/lib/entry-edit";
import { emptySettings, type SettingsState } from "@/lib/settings";

import { deleteEntryAction, updateEntryAction } from "../../podesavanja/actions";

/** Jedan pečat po formi: greška ili potvrda, nikad oba. */
function Outcome({ state }: { state: SettingsState }) {
  if (state.message === null) {
    return null;
  }

  return <Notice tone={state.ok ? "good" : "bad"}>{state.message}</Notice>;
}

/** Adresa reda koji se menja. Obe forme je nose, i obe je šalju serveru. */
function EntryAddress({ householdId, entryId }: { householdId: string; entryId: string }) {
  return (
    <>
      <input type="hidden" name="dom" value={householdId} />
      <input type="hidden" name="unos" value={entryId} />
    </>
  );
}

export function EditEntryForm({
  householdId,
  entryId,
  monthHref,
  categories,
  people,
  amount: initialAmount,
  categoryId: initialCategoryId,
  personId: initialPersonId,
  occurredOn: initialOccurredOn,
  note: initialNote,
  blocker,
}: {
  householdId: string;
  entryId: string;
  monthHref: string;
  categories: EditCategory[];
  people: EditPerson[];
  amount: string;
  categoryId: string;
  personId: string;
  occurredOn: string;
  note: string;
  blocker: string | null;
}) {
  const [state, action] = useActionState(updateEntryAction, emptySettings);
  const [amount, setAmount] = useState(initialAmount);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [personId, setPersonId] = useState(initialPersonId);
  const [occurredOn, setOccurredOn] = useState(initialOccurredOn);
  const [note, setNote] = useState(initialNote);

  return (
    <form className="stack stack--loose" action={action}>
      <EntryAddress householdId={householdId} entryId={entryId} />

      <Field id="iznos" label="Iznos" hint="Zarez je decimala: 12,50. Tačka razdvaja hiljade: 1.200.">
        <input
          id="iznos"
          className="input input--mono input--narrow"
          name="iznos"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          maxLength={16}
          aria-describedby="iznos-hint"
          required
        />
      </Field>

      <Field
        id="kategorija"
        label="Kategorija"
        hint="Vrsta unosa se ne menja, pa su u ponudi samo kategorije te vrste."
      >
        <CategoryCombobox
          categories={categories.map((category) => ({
            id: category.id,
            name: category.name,
            label: category.archived ? `${category.name} (arhivirana)` : category.name,
          }))}
          value={categoryId}
          onChange={setCategoryId}
          hintId="kategorija-hint"
        />
      </Field>

      <Field
        id="osoba"
        label="Osoba"
        hint="Ime je zapisano uz unos. Na drugu osobu ide samo aktuelni član domaćinstva."
      >
        <select
          id="osoba"
          className="input"
          name="osoba"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
          disabled={people.length === 0}
          aria-describedby="osoba-hint"
        >
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.former ? `${person.name} (više nije član)` : person.name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="datum" label="Datum" hint="Unos se posle čuvanja vidi u mesecu ovog datuma.">
        <input
          id="datum"
          className="input input--mono input--narrow"
          name="datum"
          type="date"
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
          aria-describedby="datum-hint"
          required
        />
      </Field>

      <Field id="beleska" label="Beleška" hint="Neobavezno. Na primer „pijaca“ ili „struja za avgust“.">
        <input
          id="beleska"
          className="input"
          name="beleska"
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={MAX_NOTE}
          aria-describedby="beleska-hint"
        />
      </Field>

      {blocker ? <Notice tone="bad">{blocker}</Notice> : null}
      <Outcome state={state} />

      <Ruler />

      <div className="row">
        <SubmitButton pendingLabel="Čuvam…" disabled={blocker !== null}>
          Sačuvaj izmenu
        </SubmitButton>
        <a className="button button--quiet" href={monthHref}>
          Odustani
        </a>
      </div>
    </form>
  );
}

/**
 * Brisanje. Potvrda je štiklirano polje, pa radnja traži nameru, a ne samo
 * tačan klik. Polje se proverava i na serveru: zabrana ne sme da zavisi od
 * toga šta je pregledač iscrtao.
 */
export function DeleteEntryForm({
  householdId,
  entryId,
  summary,
}: {
  householdId: string;
  entryId: string;
  summary: string;
}) {
  const [state, action] = useActionState(deleteEntryAction, emptySettings);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form className="stack" action={action}>
      <EntryAddress householdId={householdId} entryId={entryId} />

      <div className="check">
        <input
          id="potvrda"
          className="check__box"
          name="potvrda"
          type="checkbox"
          value="da"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-describedby="potvrda-hint"
        />
        <span className="check__text">
          <label className="check__label" htmlFor="potvrda">
            Razumem da se unos briše zauvek
          </label>
          <span className="field__hint" id="potvrda-hint">
            {summary} Brisanje se ne može poništiti; mesečni zbir se menja odmah.
          </span>
        </span>
      </div>

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Brišem…" disabled={!confirmed}>
          Obriši unos
        </SubmitButton>
      </div>
    </form>
  );
}
