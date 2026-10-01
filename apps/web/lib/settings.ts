/**
 * Odluke strane „Podešavanja“ — provere polja, stanje akcija, prevod grešaka i
 * redosled spiskova.
 *
 * Sve stoji ovde, van JSX-a i van `"use server"` modula, iz dva razloga: može
 * da se proveri bez pregledača i bez baze, a `actions.ts` sme da izvozi
 * isključivo async funkcije — Next svaki izvoz takvog modula tretira kao server
 * akciju i obori stranu greškom E352 na običnoj vrednosti. Čuvar te granice je
 * `lib/server-actions.test.ts`.
 */

import { assertDayOfMonth, assertRemindDays, type EntryKind } from "@finance/domain";

import { FALLBACK_PERSON_NAME } from "./month-query";
import { invitationToken } from "./next-path";
import { canManage, majorToMinor } from "./rows";

/** Ista granica kao u `validation.ts`; baza traži samo neprazan naziv posle `btrim`. */
const MAX_CATEGORY_NAME = 80;

const DAY_IN_MS = 86_400_000;

// ----------------------------------------------------------------
// Poruke koje akcije vraćaju bez obraćanja bazi
// ----------------------------------------------------------------

/**
 * Jedina poruka koju član dobija ako akciju pozove direktno. Strana mu forme
 * ni ne iscrtava, ali zabrana ne sme da zavisi od toga šta je iscrtano.
 */
export const OWNER_ONLY = "Samo vlasnik menja podešavanja.";

export const SESSION_GONE = "Prijava je istekla. Prijavite se ponovo pa sačuvajte izmenu.";

export const BAD_ADDRESS =
  "Adresa domaćinstva nije ispravna. Otvorite podešavanja sa mesečnog pregleda.";

/**
 * Nula izmenjenih redova nije uspeh. Red je ili tuđ, ili ga više nema — oba
 * slučaja spolja izgledaju isto, pa i poruka mora da bude ista.
 */
export const CATEGORY_GONE = "Kategorija nije nađena u ovom domaćinstvu. Osvežite stranu.";

export const MEMBER_GONE = "Član nije nađen u ovom domaćinstvu. Osvežite stranu.";

export const INVITATION_GONE = "Pozivnica nije nađena u ovom domaćinstvu. Osvežite stranu.";

export const RULE_GONE = "Ponavljanje nije nađeno u ovom domaćinstvu. Osvežite stranu.";

/** Limit prati samo trošak; baza isto tvrdi kroz `categories_limit_expense_only`. */
export const LIMIT_EXPENSE_ONLY = "Limit postoji samo za kategorije troška.";

export const OWNER_STAYS = "Vlasnik ostaje u domaćinstvu. Uklanjaju se samo članovi.";

// ----------------------------------------------------------------
// Stanje akcije
// ----------------------------------------------------------------

/**
 * Ishod jedne akcije, onakav kakav `useActionState` vraća formi.
 *
 * Poruka je jedna jer forma prikazuje jedan pečat: greška ili potvrda. `stamp`
 * se menja pri svakom odgovoru, pa forma prepozna nov ishod i kad je tekst isti
 * kao prošli put — bez toga se polje posle druge iste potvrde ne bi očistilo.
 */
export type SettingsState = {
  /** `true` samo kad je izmena stvarno upisana. */
  ok: boolean;
  /** Rečenica na srpskom; `null` pre prvog slanja. */
  message: string | null;
  /** Token sveže napravljene pozivnice, inače `null`. */
  token: string | null;
  stamp: string;
};

export const emptySettings: SettingsState = {
  ok: false,
  message: null,
  token: null,
  stamp: "",
};

let stamps = 0;

/** Rastući pečat odgovora. Ne mora da bude slučajan, mora da bude različit. */
function nextStamp(): string {
  stamps += 1;
  return `${Date.now().toString(36)}-${stamps.toString(36)}`;
}

export function settingsFailure(message: string): SettingsState {
  return { ok: false, message, token: null, stamp: nextStamp() };
}

export function settingsDone(message: string, token: string | null = null): SettingsState {
  return { ok: true, message, token, stamp: nextStamp() };
}

// ----------------------------------------------------------------
// Provere polja
// ----------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export function validateCategoryName(raw: string): Parsed<string> {
  const value = raw.trim();

  if (value.length === 0) {
    return { ok: false, message: "Unesite naziv kategorije." };
  }

  if (value.length > MAX_CATEGORY_NAME) {
    return {
      ok: false,
      message: `Naziv kategorije može imati najviše ${MAX_CATEGORY_NAME} znakova.`,
    };
  }

  return { ok: true, value };
}

/**
 * Vrsta se bira samo pri otvaranju kategorije. Posle toga je nepromenljiva:
 * unosi i pravila već pokazuju na nju, a okidač `prepare_category` izmenu
 * odbija.
 */
export function validateCategoryKind(raw: string): Parsed<EntryKind> {
  if (raw === "expense" || raw === "income") {
    return { ok: true, value: raw };
  }

  return { ok: false, message: "Izaberite vrstu kategorije: trošak ili prihod." };
}

/**
 * Limit kategorije troška. Prazno polje znači „bez limita“ (`null`), nikad
 * nula: nula bi bila limit prekoračen prvim dinarom, a baza je i odbija
 * (`limit_minor > 0`).
 */
export function validateLimit(raw: string): Parsed<number | null> {
  if (raw.trim().length === 0) {
    return { ok: true, value: null };
  }

  try {
    return { ok: true, value: majorToMinor(raw) };
  } catch {
    return {
      ok: false,
      message: "Limit mora biti pozitivan iznos, na primer 25.000. Ostavite prazno da ga uklonite.",
    };
  }
}

export type RuleInput = {
  amountMinor: number;
  dayOfMonth: number;
  remindDays: number;
  active: boolean;
};

/**
 * Izmena ponavljanja. Iznos, dan i podsetnik idu kroz isti domenski račun koji
 * koristi forma novog unosa, pa se granice ne prepisuju na dva mesta.
 */
export function validateRule(input: {
  amount: string;
  day: string;
  remind: string;
  active: boolean;
}): Parsed<RuleInput> {
  let amountMinor: number;
  try {
    amountMinor = majorToMinor(input.amount);
  } catch {
    return { ok: false, message: "Iznos ponavljanja mora biti pozitivan, na primer 4.500." };
  }

  const dayText = input.day.trim();
  if (!/^\d{1,2}$/.test(dayText)) {
    return { ok: false, message: "Dan u mesecu mora biti ceo broj od 1 do 31." };
  }

  const remindText = input.remind.trim();
  if (!/^\d$/.test(remindText)) {
    return { ok: false, message: "Podsetnik je od 1 do 7 dana." };
  }

  const dayOfMonth = Number(dayText);
  const remindDays = Number(remindText);

  try {
    assertDayOfMonth(dayOfMonth);
    assertRemindDays(remindDays);
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error && caught.message
          ? caught.message
          : "Dan u mesecu mora biti ceo broj od 1 do 31.",
    };
  }

  return { ok: true, value: { amountMinor, dayOfMonth, remindDays, active: input.active } };
}

// ----------------------------------------------------------------
// Iznos u polje i natrag
// ----------------------------------------------------------------

/**
 * Pare u tekst koji `majorToMinor` prima natrag bez izmene.
 *
 * Namerno bez separatora hiljada: grupisanje je u polju za upis lako pokvariti
 * (`25.00` nije ni hiljada ni decimala), a `majorToMinor` pogrešno grupisan
 * broj odbija. Prazan tekst znači „bez limita“.
 */
export function minorToInput(amountMinor: number | null): string {
  if (amountMinor === null) {
    return "";
  }

  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = frac === 0 ? String(major) : `${major},${String(frac).padStart(2, "0")}`;

  return negative ? `-${body}` : body;
}

// ----------------------------------------------------------------
// Spiskovi
// ----------------------------------------------------------------

function collator(): Intl.Collator | null {
  if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
    return null;
  }

  return new Intl.Collator("sr");
}

/**
 * Srpska azbuka, pa `id` kao drugi ključ. Bez drugog ključa dve istoimene
 * kategorije — arhiva ne zauzima naziv, pa se istoimene dešavaju — menjaju
 * mesta između zahteva, a s njima i forme koje nose njihove vrednosti.
 */
export function sortByName<T extends { id: string; name: string }>(rows: readonly T[]): T[] {
  const compare = collator();

  return [...rows].sort((a, b) => {
    const byName = compare ? compare.compare(a.name, b.name) : a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

export type MembershipRow = {
  user_id: string;
  role: string;
  profiles: { display_name: string | null } | Array<{ display_name: string | null }> | null;
};

export type MemberView = { id: string; name: string; owner: boolean };

/**
 * Članovi domaćinstva za spisak u podešavanjima. Vlasnik je prvi i bez kontrole
 * za uklanjanje: `memberships_keep_owner` ga ne pušta, pa dugme koje ne može da
 * uspe ne treba ni da postoji.
 */
export function buildMembers(rows: readonly MembershipRow[]): MemberView[] {
  const named = rows.map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

    return {
      id: row.user_id,
      name: (profile?.display_name ?? "").trim() || FALLBACK_PERSON_NAME,
      owner: canManage(row.role),
    };
  });

  return [
    ...sortByName(named.filter((member) => member.owner)),
    ...sortByName(named.filter((member) => !member.owner)),
  ];
}

// ----------------------------------------------------------------
// Pozivnice
// ----------------------------------------------------------------

export type InvitationRow = {
  id: string;
  email: string;
  token: string;
  expires_at: string;
  used_at: string | null;
};

export type PendingInvitation = {
  id: string;
  email: string;
  token: string;
  expiresAt: string;
};

/**
 * Samo pozivnice koje još vrede. Iskorišćen i istekao token ne sme da se vidi
 * kao link: izgledao bi kao poziv koji radi, a `accept_invitation` ga odbija.
 * Upit na strani već sužava na njih; ovaj filter je drugi sloj i ne zavisi od
 * toga da li je upit ostao tačan.
 */
export function pendingInvitations(
  rows: readonly InvitationRow[],
  nowMs: number,
): PendingInvitation[] {
  return rows
    .filter((row) => row.used_at === null)
    .filter((row) => {
      const end = Date.parse(row.expires_at);
      return Number.isFinite(end) && end > nowMs;
    })
    .map((row) => ({
      id: row.id,
      email: row.email,
      token: row.token,
      expiresAt: row.expires_at,
    }))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || a.id.localeCompare(b.id));
}

/** Koliko celih dana pozivnica još vredi. Nikad manje od nule. */
export function daysLeft(expiresAt: string, nowMs: number): number {
  const end = Date.parse(expiresAt);

  if (!Number.isFinite(end)) {
    return 0;
  }

  return Math.max(0, Math.ceil((end - nowMs) / DAY_IN_MS));
}

/** Rok u beogradskom vremenu, jer ga vlasnik čita i prepričava pozvanom. */
export function expiryLabel(expiresAt: string): string {
  const at = new Date(expiresAt);

  if (Number.isNaN(at.getTime())) {
    return "nepoznato";
  }

  return new Intl.DateTimeFormat("sr-RS", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** Putanja prihvatanja. Token je `uuid` u bazi; sve drugo nije link. */
export function invitationPath(token: string): string | null {
  const value = invitationToken(token);
  return value === null ? null : `/poziv/${value}`;
}

/**
 * Pun link koji vlasnik prekopira i pošalje.
 *
 * Poreklo dolazi iz pregledača (`window.location.origin`), ne iz zaglavlja
 * `Host`: zaglavlje sastavlja pozivalac, pa bi link mogao da vodi na tuđi
 * domen. Dok porekla nema (prvo iscrtavanje na serveru), vraća se putanja —
 * relativan link je kraći, ali ne vodi nigde pogrešno.
 */
export function invitationLink(origin: string | null | undefined, token: string): string | null {
  const path = invitationPath(token);

  if (path === null) {
    return null;
  }

  if (!origin) {
    return path;
  }

  return `${origin.replace(/\/+$/, "")}${path}`;
}

// ----------------------------------------------------------------
// Prevod grešaka
// ----------------------------------------------------------------

/**
 * Greška iz baze ili mreže u rečenicu koja kaže šta sledeće.
 *
 * Tekst baze se ne prikazuje: poruke okidača su na srpskom, ali pisane za
 * programera („Vrsta kategorije se ne menja“), a imena ograničenja i greške
 * drajvera nisu ni na srpskom.
 */
export function settingsErrorMessage(raw: string | null | undefined): string {
  const value = (raw ?? "").toLowerCase();

  if (
    value.includes("failed to fetch") ||
    value.includes("fetch failed") ||
    value.includes("networkerror") ||
    value.includes("network request failed") ||
    value.includes("load failed") ||
    value.includes("err_internet_disconnected")
  ) {
    return "Nema veze sa serverom. Polja su ostala popunjena — proverite internet i pokušajte ponovo.";
  }

  if (value.includes("prijava je obavezna") || value.includes("jwt")) {
    return SESSION_GONE;
  }

  if (value.includes("row-level security") || value.includes("row level security")) {
    return OWNER_ONLY;
  }

  if (value.includes("categories_active_name")) {
    return "Kategorija tog naziva i vrste već postoji. Izaberite drugi naziv.";
  }

  if (value.includes("categories_limit_expense_only")) {
    return LIMIT_EXPENSE_ONLY;
  }

  if (value.includes("vrsta kategorije se ne menja")) {
    return "Vrsta kategorije se ne menja. Otvorite novu kategoriju te vrste.";
  }

  if (value.includes("domaćinstvo kategorije se ne menja")) {
    return "Kategorija ostaje u svom domaćinstvu.";
  }

  if (value.includes("arhivirana kategorija ne prima aktivno ponavljanje")) {
    return "Kategorija je arhivirana, pa ponavljanje ne može da bude aktivno. Izaberite drugu kategoriju ili ostavite ponavljanje ugašeno.";
  }

  if (value.includes("osoba nije član")) {
    return "Osoba iz ponavljanja više nije član domaćinstva, pa ponavljanje ne može da se uključi.";
  }

  if (value.includes("vlasnik se ne uklanja")) {
    return OWNER_STAYS;
  }

  if (value.includes("memberships_one_owner")) {
    return "Domaćinstvo ima tačno jednog vlasnika.";
  }

  if (value.includes("pozivnica se ne menja")) {
    return "Pozivnica se ne menja. Povucite je i napravite novu.";
  }

  if (value.includes("invitations_max_ttl")) {
    return "Pozivnica vredi najduže sedam dana.";
  }

  if (value.includes("limit_minor")) {
    return "Limit mora biti pozitivan iznos. Ostavite prazno da ga uklonite.";
  }

  if (value.includes("day_of_month")) {
    return "Dan u mesecu mora biti ceo broj od 1 do 31.";
  }

  if (value.includes("remind_days")) {
    return "Podsetnik je od 1 do 7 dana.";
  }

  if (value.includes("amount_minor")) {
    return "Iznos ponavljanja mora biti pozitivan.";
  }

  if (value.includes("duplicate key")) {
    return "Taj red već postoji. Osvežite stranu i pokušajte ponovo.";
  }

  if (value.includes("char_length") || value.includes("btrim")) {
    return "Polje ne sme da ostane prazno.";
  }

  return "Izmena nije sačuvana. Osvežite stranu pa pokušajte ponovo.";
}
