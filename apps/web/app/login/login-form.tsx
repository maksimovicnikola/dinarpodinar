"use client";

import { useState, type FormEvent } from "react";

import { Field, Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { otpErrorMessage } from "@/lib/auth-messages";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { validateDisplayName, validateEmail } from "@/lib/validation";

export function LoginForm({ nextPath, notice }: { nextPath: string; notice: string | null }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(notice);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSentTo(null);

    // Ime stiže u `raw_user_meta_data` i okidač ga upisuje u profil, pa prazno
    // ime ne sme ni da krene — nalog bi dobio rezervni naziv.
    const checkedName = validateDisplayName(name);
    if (!checkedName.ok) {
      setError(checkedName.message);
      return;
    }

    const checkedEmail = validateEmail(email);
    if (!checkedEmail.ok) {
      setError(checkedEmail.message);
      return;
    }

    setPending(true);

    try {
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", nextPath);

      const supabase = createBrowserSupabase();
      const result = await supabase.auth.signInWithOtp({
        email: checkedEmail.value,
        options: {
          emailRedirectTo: redirectTo.toString(),
          data: { display_name: checkedName.value },
        },
      });

      if (result.error) {
        setError(otpErrorMessage(result.error.message));
        return;
      }

      setSentTo(checkedEmail.value);
    } catch (caught) {
      setError(otpErrorMessage(caught instanceof Error ? caught.message : null));
    } finally {
      setPending(false);
    }
  }

  return (
    <Passbook>
      <PassbookHeader
        eyebrow="Prijava"
        title="Otvorite svoju knjižicu"
        lead="Nema šifre. Upišite ime i adresu e-pošte, a mi šaljemo link za jednu prijavu."
      />

      <form className="stack stack--loose" onSubmit={onSubmit} noValidate>
        <Field id="ime" label="Ime" hint="Ovako vas vide ostali u domaćinstvu.">
          <input
            id="ime"
            className="input"
            name="ime"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            aria-describedby="ime-hint"
            required
          />
        </Field>

        <Field id="posta" label="E-pošta" hint="Na ovu adresu stiže link za prijavu.">
          <input
            id="posta"
            className="input"
            name="posta"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            aria-describedby="posta-hint"
            required
          />
        </Field>

        {error ? <Notice tone="bad">{error}</Notice> : null}

        {sentTo ? (
          <Notice tone="good">
            Link je poslat na <span className="amount">{sentTo}</span>. Otvorite ga na ovom uređaju —
            link vredi jednom.
          </Notice>
        ) : null}

        <div className="row">
          <button type="submit" className="button" disabled={pending}>
            {pending ? "Šaljem…" : sentTo ? "Pošalji novi link" : "Pošalji link"}
          </button>
          <p className="fine">Link važi kratko. Ako ne stigne, proverite neželjenu poštu.</p>
        </div>
      </form>
    </Passbook>
  );
}
