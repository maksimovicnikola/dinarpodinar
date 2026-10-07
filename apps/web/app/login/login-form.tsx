"use client";

import { useState, type FormEvent } from "react";

import { Field, Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { otpErrorMessage } from "@/lib/auth-messages";
import { needsDisplayName } from "@/lib/display-name";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { validateDisplayName, validateEmail } from "@/lib/validation";

type Step = "email" | "sent" | "name";

export function LoginForm({
  nextPath,
  notice,
  askName,
}: {
  nextPath: string;
  notice: string | null;
  askName: boolean;
}) {
  const [step, setStep] = useState<Step>(askName ? "name" : "email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [pending, setPending] = useState(false);

  async function sendLoginLink() {
    setError(null);
    const checkedEmail = validateEmail(email);
    if (!checkedEmail.ok) {
      setError(checkedEmail.message);
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      const result = await supabase.auth.signInWithOtp({
        email: checkedEmail.value,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (result.error) {
        setError(otpErrorMessage(result.error.message));
        return;
      }
      setEmail(checkedEmail.value);
      setStep("sent");
    } catch (caught) {
      setError(otpErrorMessage(caught instanceof Error ? caught.message : null));
    } finally {
      setPending(false);
    }
  }

  async function saveName() {
    setError(null);
    const checkedName = validateDisplayName(name);
    if (!checkedName.ok) {
      setError(checkedName.message);
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      const auth = await supabase.auth.getUser();
      const userId = auth.data.user?.id;
      if (!userId) {
        setError("Prijava je istekla. Pošaljite novi link.");
        setStep("email");
        return;
      }

      const profile = await supabase.from("profiles").update({ display_name: checkedName.value }).eq("id", userId);
      if (profile.error) {
        setError("Ime nije sačuvano. Pokušajte ponovo.");
        return;
      }

      const marked = await supabase.auth.updateUser({ data: { display_name: checkedName.value } });
      if (marked.error) {
        setError("Ime nije sačuvano. Pokušajte ponovo.");
        return;
      }

      window.location.assign(nextPath);
    } catch {
      setError("Ime nije sačuvano. Proverite vezu i pokušajte ponovo.");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "email" || step === "sent") void sendLoginLink();
    else void saveName();
  }

  const title = step === "sent" ? "Proverite e-poštu" : step === "name" ? "Vaše ime" : "Prijava";
  const lead =
    step === "sent"
      ? `Poslali smo link za prijavu na ${email}. Otvorite ga u ovom pregledaču da biste nastavili.`
      : step === "name"
        ? "Ovako vas vide ostali u domaćinstvu. Pitamo samo jednom, za nov nalog."
        : "Bez lozinke. Upišite e-poštu, a mi šaljemo link za prijavu.";

  return (
    <Passbook>
      <PassbookHeader eyebrow="Dinar po dinar" title={title} lead={lead} />

      <form className="stack stack--loose" onSubmit={onSubmit} noValidate>
        {step === "email" ? (
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
        ) : null}

        {step === "sent" ? (
          <p className="fine">Ako poruka ne stigne, proverite neželjenu poštu ili pošaljite novi link.</p>
        ) : null}

        {step === "name" ? (
          <Field id="ime" label="Ime" hint="Najmanje dva znaka.">
            <input
              id="ime"
              className="input"
              name="ime"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              aria-describedby="ime-hint"
              autoFocus
              required
            />
          </Field>
        ) : null}

        {error ? <Notice tone="bad">{error}</Notice> : null}

        <div className="row">
          <button type="submit" className="button" disabled={pending}>
            {pending
              ? step === "name"
                ? "Čuvam…"
                : "Šaljem…"
              : step === "name"
                ? "Sačuvaj ime"
                : step === "sent"
                  ? "Pošalji novi link"
                  : "Pošalji link"}
          </button>
          {step === "sent" ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={pending}
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              Promeni adresu e-pošte
            </button>
          ) : null}
        </div>
      </form>
    </Passbook>
  );
}
