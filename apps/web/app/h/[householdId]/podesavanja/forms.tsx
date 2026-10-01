"use client";

/**
 * Forme podešavanja. Svaka nosi svoje stanje akcije, pa poruka stoji uz polje
 * koje je izazvalo, a ne na vrhu strane.
 *
 * Polja su kontrolisana (`value` + `onChange`) iz jednog razloga: React posle
 * server akcije resetuje nekontrolisanu formu, pa bi odbijen limit ili
 * predugačak naziv nestali baš kad treba da se poprave. Kontrolisana vrednost
 * živi u React stanju i preživi i grešku i osvežavanje strane.
 *
 * `SubmitButton` se zaključava dok akcija traje, pa drugi klik ne šalje isti
 * zahtev još jednom.
 */

import { useActionState, useEffect, useState, type ReactNode } from "react";

import { Field, Notice } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import {
  emptySettings,
  invitationLink,
  ruleFieldsKey,
  type RuleFieldValues,
  type SettingsState,
} from "@/lib/settings";

import {
  archiveCategoryAction,
  createCategoryAction,
  inviteMemberAction,
  removeMemberAction,
  renameCategoryAction,
  revokeInvitationAction,
  saveLimitAction,
  saveRuleAction,
} from "./actions";

/** Jedan pečat po formi: greška ili potvrda, nikad oba. */
function Outcome({ state }: { state: SettingsState }) {
  if (state.message === null) {
    return null;
  }

  return <Notice tone={state.ok ? "good" : "bad"}>{state.message}</Notice>;
}

function HouseholdField({ householdId }: { householdId: string }) {
  return <input type="hidden" name="dom" value={householdId} />;
}

/**
 * Poreklo iz pregledača. Na serveru ga nema, pa prvo iscrtavanje pokaže
 * putanju, a posle montiranja pun link — bez razlike koju bi hidracija
 * prijavila.
 */
function useOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  return origin;
}

// ----------------------------------------------------------------
// Kategorije
// ----------------------------------------------------------------

export function CreateCategoryForm({ householdId }: { householdId: string }) {
  const [state, action] = useActionState(createCategoryAction, emptySettings);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("expense");

  // Posle upisane kategorije polje se prazni da sledeća krene od praznog reda.
  // `stamp` je u zavisnostima jer dva uspeha mogu da nose isti tekst.
  useEffect(() => {
    if (state.ok) {
      setName("");
    }
  }, [state.ok, state.stamp]);

  return (
    <form className="stack" action={action}>
      <HouseholdField householdId={householdId} />

      <Field id="nova-kategorija" label="Naziv nove kategorije" hint="Na primer „Vrtić“ ili „Honorar“.">
        <input
          id="nova-kategorija"
          className="input"
          name="naziv"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          aria-describedby="nova-kategorija-hint"
          required
        />
      </Field>

      <Field
        id="nova-vrsta"
        label="Vrsta"
        hint="Vrsta se posle otvaranja ne menja, jer unosi i ponavljanja pokazuju na nju."
      >
        <select
          id="nova-vrsta"
          className="input input--narrow"
          name="vrsta"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          aria-describedby="nova-vrsta-hint"
        >
          <option value="expense">Trošak</option>
          <option value="income">Prihod</option>
        </select>
      </Field>

      <Outcome state={state} />

      <div className="row">
        <SubmitButton pendingLabel="Dodajem…">Dodaj kategoriju</SubmitButton>
      </div>
    </form>
  );
}

export function RenameCategoryForm({
  householdId,
  categoryId,
  name: initialName,
}: {
  householdId: string;
  categoryId: string;
  name: string;
}) {
  const [state, action] = useActionState(renameCategoryAction, emptySettings);
  const [name, setName] = useState(initialName);
  const fieldId = `naziv-${categoryId}`;

  return (
    <form className="stack stack--tight" action={action}>
      <HouseholdField householdId={householdId} />
      <input type="hidden" name="kategorija" value={categoryId} />

      <Field id={fieldId} label="Naziv">
        <input
          id={fieldId}
          className="input"
          name="naziv"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          required
        />
      </Field>

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Čuvam…">
          Sačuvaj naziv
        </SubmitButton>
      </div>
    </form>
  );
}

export function LimitForm({
  householdId,
  categoryId,
  limit: initialLimit,
}: {
  householdId: string;
  categoryId: string;
  limit: string;
}) {
  const [state, action] = useActionState(saveLimitAction, emptySettings);
  const [limit, setLimit] = useState(initialLimit);
  const fieldId = `limit-${categoryId}`;

  return (
    <form className="stack stack--tight" action={action}>
      <HouseholdField householdId={householdId} />
      <input type="hidden" name="kategorija" value={categoryId} />

      <Field
        id={fieldId}
        label="Mesečni limit"
        hint="Prazno polje znači bez limita. Zarez je decimala: 25.000 ili 1.500,50."
      >
        <input
          id={fieldId}
          className="input input--mono input--narrow"
          name="limit"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={limit}
          onChange={(event) => setLimit(event.target.value)}
          maxLength={16}
          aria-describedby={`${fieldId}-hint`}
        />
      </Field>

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Čuvam…">
          Sačuvaj limit
        </SubmitButton>
      </div>
    </form>
  );
}

export function ArchiveCategoryForm({
  householdId,
  categoryId,
}: {
  householdId: string;
  categoryId: string;
}) {
  const [state, action] = useActionState(archiveCategoryAction, emptySettings);

  return (
    <form className="stack stack--tight" action={action}>
      <HouseholdField householdId={householdId} />
      <input type="hidden" name="kategorija" value={categoryId} />

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Arhiviram…">
          Arhiviraj
        </SubmitButton>
        <p className="fine">Ostaje u istoriji, ne prima nove unose, gasi svoja ponavljanja.</p>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------
// Pozivnice
// ----------------------------------------------------------------

/**
 * Link koji vlasnik prosleđuje sam. Dok ne postoji servis za slanje pošte, to
 * je jedini put do pozvanog, pa strana to i piše umesto da ostavi utisak da je
 * poruka otišla.
 */
export function InvitationLinkField({ token, label }: { token: string; label: string }) {
  const origin = useOrigin();
  const [copied, setCopied] = useState<boolean | null>(null);
  const link = invitationLink(origin, token);
  const fieldId = `link-${token}`;

  if (link === null) {
    return null;
  }

  async function copy() {
    const field = document.getElementById(fieldId);
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }

    try {
      await navigator.clipboard.writeText(link ?? "");
      setCopied(true);
    } catch {
      // Pregledač bez dozvole za ostavu: tekst je već označen, pa ostaje ručno
      // kopiranje. Tiho „kopirano“ bi ovde bilo laž.
      setCopied(false);
    }
  }

  return (
    <div className="stack stack--tight">
      <Field id={fieldId} label={label} hint="Prekopirajte link i pošaljite ga sami — pozivnica ne ide e-poštom.">
        <input
          id={fieldId}
          className="input input--mono"
          type="text"
          value={link}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          aria-describedby={`${fieldId}-hint`}
        />
      </Field>

      <div className="row">
        <button type="button" className="button button--quiet" onClick={copy}>
          Kopiraj link
        </button>
        <p className="fine" role="status">
          {copied === true ? "Link je kopiran." : null}
          {copied === false ? "Kopiranje nije uspelo. Link je označen — kopirajte ga ručno." : null}
        </p>
      </div>
    </div>
  );
}

export function InviteForm({ householdId }: { householdId: string }) {
  const [state, action] = useActionState(inviteMemberAction, emptySettings);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (state.ok) {
      setEmail("");
    }
  }, [state.ok, state.stamp]);

  return (
    <form className="stack" action={action}>
      <HouseholdField householdId={householdId} />

      <Field
        id="poziv-posta"
        label="E-pošta pozvanog"
        hint="Pozivnica vredi samo za tu adresu i samo jednom, sedam dana."
      >
        <input
          id="poziv-posta"
          className="input"
          name="posta"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          aria-describedby="poziv-posta-hint"
          required
        />
      </Field>

      <Outcome state={state} />

      {state.ok && state.token ? (
        <InvitationLinkField token={state.token} label="Nov link pozivnice" />
      ) : null}

      <div className="row">
        <SubmitButton pendingLabel="Pravim…">Napravi pozivnicu</SubmitButton>
      </div>
    </form>
  );
}

export function RevokeInvitationForm({
  householdId,
  invitationId,
}: {
  householdId: string;
  invitationId: string;
}) {
  const [state, action] = useActionState(revokeInvitationAction, emptySettings);

  return (
    <form className="stack stack--tight" action={action}>
      <HouseholdField householdId={householdId} />
      <input type="hidden" name="pozivnica" value={invitationId} />

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Povlačim…">
          Povuci pozivnicu
        </SubmitButton>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------
// Članovi
// ----------------------------------------------------------------

export function RemoveMemberForm({
  householdId,
  userId,
  name,
}: {
  householdId: string;
  userId: string;
  name: string;
}) {
  const [state, action] = useActionState(removeMemberAction, emptySettings);

  return (
    <form className="stack stack--tight" action={action}>
      <HouseholdField householdId={householdId} />
      <input type="hidden" name="clan" value={userId} />

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Uklanjam…">
          Ukloni
        </SubmitButton>
        <p className="fine">
          <span className="sr-only">{name}. </span>
          Unosi ostaju u istoriji; njegova ponavljanja se gase.
        </p>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------
// Ponavljanja
// ----------------------------------------------------------------

/**
 * Polja ponavljanja, odvojena od forme.
 *
 * Odvojena su zbog ključa. Pravilo se gasi i bez ijednog klika ovde:
 * arhiviranje kategorije i uklanjanje člana to rade kroz okidače u bazi. Posle
 * takvog osvežavanja server pošalje `active: false`, ali kontrolisano stanje
 * prekidača živi u React-u i ostalo bi na „uključeno“ — sledeće čuvanje bi
 * pokušalo da oživi pravilo koje baza više ne prima. Ključ iz `ruleFieldsKey`
 * nosi sve serverske vrednosti, pa React na svaku promenu odbaci staro stanje
 * i polja krenu od onoga što baza kaže.
 *
 * Ključ stoji ovde, a ne na celoj formi, da `useActionState` iznad preživi:
 * posle uspešnog čuvanja vrednosti se sinhronizuju, a potvrda ostaje na ekranu.
 */
function RuleFields(server: RuleFieldValues) {
  const { ruleId } = server;
  const [amount, setAmount] = useState(server.amount);
  const [day, setDay] = useState(server.day);
  const [remind, setRemind] = useState(server.remind);
  const [active, setActive] = useState(server.active);

  return (
    <>
      <Field id={`iznos-${ruleId}`} label="Iznos">
        <input
          id={`iznos-${ruleId}`}
          className="input input--mono input--narrow"
          name="iznos"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          maxLength={16}
          required
        />
      </Field>

      <Field id={`dan-${ruleId}`} label="Dan u mesecu" hint="Ceo broj od 1 do 31; u kraćem mesecu poslednjeg dana.">
        <input
          id={`dan-${ruleId}`}
          className="input input--mono input--short"
          name="dan"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={day}
          onChange={(event) => setDay(event.target.value)}
          maxLength={2}
          aria-describedby={`dan-${ruleId}-hint`}
          required
        />
      </Field>

      <Field id={`podsetnik-${ruleId}`} label="Podsetnik" hint="Dana ranije, ceo broj od 1 do 7.">
        <input
          id={`podsetnik-${ruleId}`}
          className="input input--mono input--short"
          name="podsetnik"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={remind}
          onChange={(event) => setRemind(event.target.value)}
          maxLength={1}
          aria-describedby={`podsetnik-${ruleId}-hint`}
          required
        />
      </Field>

      <div className="check">
        <input
          id={`aktivno-${ruleId}`}
          className="check__box"
          name="aktivno"
          type="checkbox"
          value="da"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
          aria-describedby={`aktivno-${ruleId}-hint`}
        />
        <span className="check__text">
          <label className="check__label" htmlFor={`aktivno-${ruleId}`}>
            Uključeno
          </label>
          <span className="field__hint" id={`aktivno-${ruleId}-hint`}>
            Ugašeno ponavljanje ostaje zapisano, ali mesečni posao ga preskače.
          </span>
        </span>
      </div>
    </>
  );
}

export function RuleForm({
  householdId,
  description,
  ...server
}: RuleFieldValues & {
  householdId: string;
  description: ReactNode;
}) {
  const [state, action] = useActionState(saveRuleAction, emptySettings);

  return (
    <form className="stack stack--tight" action={action}>
      <HouseholdField householdId={householdId} />
      <input type="hidden" name="pravilo" value={server.ruleId} />

      <p className="fine">{description}</p>

      <RuleFields key={ruleFieldsKey(server)} {...server} />

      <Outcome state={state} />

      <div className="row">
        <SubmitButton quiet pendingLabel="Čuvam…">
          Sačuvaj ponavljanje
        </SubmitButton>
      </div>
    </form>
  );
}
