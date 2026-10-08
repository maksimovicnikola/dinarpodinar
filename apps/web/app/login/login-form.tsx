"use client";

import { useState, type FormEvent } from "react";

import { Field, Notice } from "@/components/form";
import { Passbook, PassbookHeader } from "@/components/passbook";
import { otpErrorMessage } from "@/lib/auth-messages";
import { needsDisplayName } from "@/lib/display-name";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { validateDisplayName, validateEmail } from "@/lib/validation";

type Step = "email" | "code" | "name";

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
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [pending, setPending] = useState(false);

  async function sendLoginCode() {
    setError(null);
    const checkedEmail = validateEmail(email);
    if (!checkedEmail.ok) {
      setError(checkedEmail.message);
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      const result = await supabase.auth.signInWithOtp({ email: checkedEmail.value });
      if (result.error) {
        setError(otpErrorMessage(result.error.message));
        return;
      }
      setEmail(checkedEmail.value);
      setCode("");
      setStep("code");
    } catch (caught) {
      setError(otpErrorMessage(caught instanceof Error ? caught.message : null));
    } finally {
      setPending(false);
    }
  }

  async function verifyEmailCode() {
    setError(null);
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Kod ima šest cifara.");
      return;
    }

    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      const result = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (result.error || !result.data.session) {
        setError("Kod nije ispravan ili je istekao. Zatražite novi.");
        return;
      }

      if (needsDisplayName(result.data.user?.user_metadata)) {
        setStep("name");
        return;
      }

      window.location.assign(nextPath);
    } catch {
      setError("Prijava nije uspela. Proverite vezu i pokušajte ponovo.");
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
        setError("Prijava je istekla. Pošaljite novi kod.");
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
    if (step === "email") void sendLoginCode();
    else if (step === "code") void verifyEmailCode();
    else void saveName();
  }

  const title = step === "code" ? "Proverite e-poštu" : step === "name" ? "Vaše ime" : "Prijava";
  const lead =
    step === "code"
      ? `Poslali smo šestocifreni kod na ${email}. Unesite ga ispod da biste nastavili.`
      : step === "name"
        ? "Ovako vas vide ostali u domaćinstvu. Pitamo samo jednom, za nov nalog."
        : "Bez lozinke. Upišite e-poštu, a mi šaljemo šestocifreni kod za prijavu.";
  const submitLabel = pending
    ? step === "name"
      ? "Čuvam…"
      : step === "code"
        ? "Proveravam…"
        : "Šaljem kod…"
    : step === "name"
      ? "Sačuvaj ime"
      : step === "code"
        ? "Potvrdi kod"
        : "Pošalji kod";

  return (
    <Passbook>
      <PassbookHeader eyebrow="Dinar po dinar" title={title} lead={lead} />

      <form className="stack stack--loose" onSubmit={onSubmit} noValidate>
        {step === "email" ? (
          <Field id="posta" label="E-pošta" hint="Na ovu adresu stiže kod za prijavu.">
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

        {step === "code" ? (
          <>
            <Field id="kod" label="Šestocifreni kod" hint="Kod važi jednom.">
              <input
                id="kod"
                className="input"
                name="kod"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-describedby="kod-hint"
                required
              />
            </Field>
            <p className="fine">Ako poruka ne stigne, proverite neželjenu poštu ili pošaljite novi kod.</p>
          </>
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
            {submitLabel}
          </button>
          {step === "code" ? (
            <>
              <button
                type="button"
                className="button button--quiet"
                disabled={pending}
                onClick={() => void sendLoginCode()}
              >
                Pošalji novi kod
              </button>
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
            </>
          ) : null}
        </div>
      </form>
    </Passbook>
  );
}
