"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field, Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { createHouseholdErrorMessage } from "@/lib/auth-messages";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { validateCurrency, validateHouseholdName } from "@/lib/validation";

export default function NewHouseholdPage() {
  const router = useRouter();
  const [name, setName] = useState("Naša kuća");
  const [currency, setCurrency] = useState("RSD");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Baza odbija prazan naziv i valutu van `^[A-Z]{3}$`. Proveravamo pre poziva
    // da član dobije jasnu poruku, a ne grešku ograničenja.
    const checkedName = validateHouseholdName(name);
    if (!checkedName.ok) {
      setError(checkedName.message);
      return;
    }

    const checkedCurrency = validateCurrency(currency);
    if (!checkedCurrency.ok) {
      setError(checkedCurrency.message);
      return;
    }

    setPending(true);

    try {
      const supabase = createBrowserSupabase();
      const created = await supabase.rpc("create_household", {
        p_name: checkedName.value,
        p_currency: checkedCurrency.value,
      });

      if (created.error || !created.data) {
        setError(createHouseholdErrorMessage(created.error?.message));
        return;
      }

      router.push(`/h/${created.data}`);
    } catch (caught) {
      setError(createHouseholdErrorMessage(caught instanceof Error ? caught.message : null));
    } finally {
      setPending(false);
    }
  }

  return (
    <Passbook>
      <PassbookHeader
        eyebrow="Novo domaćinstvo"
        title="Otvorite prvu stranu"
        lead="Dajte domaćinstvu naziv koji svi prepoznaju i izaberite valutu u kojoj vodite račun."
      />

      <form className="stack stack--loose" onSubmit={onSubmit} noValidate>
        <Field id="naziv" label="Naziv" hint="Na primer „Naša kuća“ ili „Stan na Zvezdari“.">
          <input
            id="naziv"
            className="input"
            name="naziv"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            aria-describedby="naziv-hint"
            required
          />
        </Field>

        <Field id="valuta" label="Valuta" hint="Tri slova. Dinar je RSD.">
          <input
            id="valuta"
            className="input input--mono input--short"
            name="valuta"
            type="text"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            maxLength={3}
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="valuta-hint"
            required
          />
        </Field>

        {error ? <Notice tone="bad">{error}</Notice> : null}

        <div className="row">
          <button type="submit" className="button" disabled={pending}>
            {pending ? "Otvaram…" : "Otvori domaćinstvo"}
          </button>
          <p className="fine">Vi ostajete vlasnik i jedini menjate podešavanja.</p>
        </div>
      </form>
    </Passbook>
  );
}
