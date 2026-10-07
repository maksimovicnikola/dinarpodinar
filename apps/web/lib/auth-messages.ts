/**
 * Prevod grešaka iz Supabase Auth-a i baze u poruke koje članu domaćinstva
 * kažu šta sledeće da uradi.
 *
 * Kodovi putuju kroz URL (`?greska=...`) jer se posle neuspeha radi
 * preusmerenje, pa sama poruka ne sme da bude u adresi: korisnik bi je menjao,
 * a tekst baze nije za prikaz.
 */

export type LoginErrorCode = "bez-koda" | "razmena" | "link" | "kolacici" | "nepoznato";

export function loginErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
    case "":
      return null;
    case "bez-koda":
      return "Link za prijavu nije potpun ili je istekao. Pošaljite novi link.";
    case "razmena":
      return "Link za prijavu je istekao ili je već iskorišćen. Pošaljite novi.";
    case "link":
      return "Prijava preko linka nije uspela. Pošaljite novi link.";
    case "kolacici":
      return "Prijava nije sačuvana jer pregledač nije primio kolačiće. Dozvolite kolačiće za ovu stranu pa pošaljite novi link.";
    default:
      return "Prijava nije uspela. Pošaljite novi link.";
  }
}

/** Poruka za neuspelo slanje linka za prijavu. */
export function otpErrorMessage(raw: string | null | undefined): string {
  const value = (raw ?? "").toLowerCase();

  if (value.includes("rate limit") || value.includes("for security purposes") || value.includes("too many")) {
    return "Previše zahteva u kratkom roku. Sačekajte minut i pokušajte ponovo.";
  }

  if (value.includes("validate email") || value.includes("invalid email") || value.includes("email address")) {
    return "Adresa e-pošte nije ispravna. Primer: ime@primer.rs";
  }

  if (value.includes("signups not allowed") || value.includes("signup is disabled")) {
    return "Otvaranje novih naloga je trenutno isključeno. Zamolite vlasnika domaćinstva za pozivnicu.";
  }

  if (value.includes("failed to fetch") || value.includes("fetch failed") || value.includes("networkerror")) {
    return "Nema veze sa serverom. Proverite internet i pokušajte ponovo.";
  }

  return "Link za prijavu nije poslat. Proverite adresu e-pošte i pokušajte ponovo.";
}

export type InvitationErrorCode =
  | "token"
  | "nepostojeca"
  | "iskoriscena"
  | "istekla"
  | "druga-posta"
  | "bez-poste"
  | "prijava"
  // Dva koda za kolačiće, jer poruka zavisi od toga da li je pozivnica već
  // potrošena: `kolacici-pre` je pad pre prihvatanja, `kolacici` posle.
  | "kolacici-pre"
  | "kolacici"
  | "nepoznato";

/** Svodi tekst greške iz `accept_invitation` na stabilan kod. */
export function invitationErrorCode(raw: string | null | undefined): InvitationErrorCode {
  const value = (raw ?? "").toLowerCase();

  if (value.includes("ne postoji")) {
    return "nepostojeca";
  }

  if (value.includes("iskorišćena") || value.includes("iskoriscena")) {
    return "iskoriscena";
  }

  if (value.includes("istekla")) {
    return "istekla";
  }

  if (value.includes("drugu e-poštu") || value.includes("drugu e-postu")) {
    return "druga-posta";
  }

  if (value.includes("nema e-poštu") || value.includes("nema e-postu")) {
    return "bez-poste";
  }

  if (value.includes("prijava je obavezna")) {
    return "prijava";
  }

  return "nepoznato";
}

export function invitationErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case null:
    case undefined:
    case "":
      return null;
    case "token":
      return "Link pozivnice nije ispravan. Zamolite vlasnika da pošalje novu pozivnicu.";
    case "nepostojeca":
      return "Pozivnica ne postoji. Možda je vlasnik povukao.";
    case "iskoriscena":
      return "Pozivnica je već iskorišćena. Ako ste već član, otvorite početnu stranu.";
    case "istekla":
      return "Pozivnica je istekla. Zamolite vlasnika da pošalje novu.";
    case "druga-posta":
      return "Pozivnica je poslata na drugu adresu e-pošte. Prijavite se adresom na koju je pozivnica došla.";
    case "bez-poste":
      return "Nalog nema adresu e-pošte, pa pozivnica ne može da se prihvati.";
    case "prijava":
      return "Prijava je istekla. Prijavite se ponovo pa otvorite pozivnicu.";
    case "kolacici-pre":
      return "Sesija nije sačuvana jer pregledač nije primio kolačiće. Pozivnica nije iskorišćena — dozvolite kolačiće za ovu stranu pa ponovo otvorite link.";
    case "kolacici":
      return "Pozivnica je prihvaćena, ali sesija nije sačuvana. Prijavite se ponovo pa otvorite početnu stranu.";
    default:
      return "Pozivnica nije prihvaćena. Pokušajte ponovo ili zamolite vlasnika za novu.";
  }
}

/** Poruka za neuspelo otvaranje domaćinstva kroz `create_household`. */
export function createHouseholdErrorMessage(raw: string | null | undefined): string {
  const value = (raw ?? "").toLowerCase();

  if (value.includes("prijava je obavezna") || value.includes("jwt")) {
    return "Prijava je istekla. Prijavite se ponovo pa otvorite domaćinstvo.";
  }

  if (value.includes("currency")) {
    return "Valuta se piše sa tri slova, na primer RSD ili EUR.";
  }

  if (value.includes("name")) {
    return "Naziv domaćinstva ne sme biti prazan.";
  }

  if (value.includes("failed to fetch") || value.includes("fetch failed") || value.includes("networkerror")) {
    return "Nema veze sa serverom. Proverite internet i pokušajte ponovo.";
  }

  return "Domaćinstvo nije otvoreno. Pokušajte ponovo.";
}
