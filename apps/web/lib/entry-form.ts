/**
 * Odluke forme „Novi unos“ — stanje, provere pre slanja, prevod grešaka.
 *
 * Sve što forma odlučuje stoji ovde, van JSX-a, da bi se dalo testirati bez
 * pregledača: koja kategorija ostaje posle promene vrste, da li dugme sme da
 * pošalje, koji je podrazumevani datum, šta se javlja kad poziv padne.
 *
 * Domenska aritmetika se ne ponavlja: iznos ide kroz `majorToMinor`, podsetnik
 * kroz `assertRemindDays`, dan u mesecu kroz `assertDayOfMonth`, dužina meseca
 * kroz `clampDayOfMonth`, a današnji dan kroz `todayInBelgrade`.
 */

import {
  assertDayOfMonth,
  assertRemindDays,
  clampDayOfMonth,
  type EntryKind,
  todayInBelgrade,
} from "@finance/domain";

import { majorToMinor } from "./rows";

export type CategoryOption = { id: string; name: string; kind: EntryKind };

export type PersonOption = { id: string; name: string };

export type EntryFormState = {
  kind: EntryKind;
  amount: string;
  categoryId: string;
  personId: string;
  occurredOn: string;
  note: string;
  repeat: boolean;
  remindDays: string;
};

/** Podrazumevani podsetnik iz specifikacije: dan ranije. */
export const DEFAULT_REMIND_DAYS = "1";

/**
 * Isti prozor godina kao u `month-query.ts`. Unos van njega bi se sačuvao, ali
 * se mesec u kom stoji ne bi mogao otvoriti — pa se odbija pre slanja.
 */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function collator(): Intl.Collator | null {
  if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") {
    return null;
  }

  return new Intl.Collator("sr");
}

/**
 * Kategorije jedne vrste, određenim redosledom (naziv na srpskom, pa `id`).
 * Bez trećeg ključa dve istoimene kategorije — arhiva ne zauzima naziv, pa se
 * istoimene dešavaju — menjale bi mesta između zahteva.
 */
export function categoriesOfKind(
  categories: readonly CategoryOption[],
  kind: EntryKind,
): CategoryOption[] {
  const compare = collator();

  return categories
    .filter((category) => category.kind === kind)
    .sort((a, b) => {
      const byName = compare ? compare.compare(a.name, b.name) : a.name.localeCompare(b.name);
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
}

/** Prva kategorija te vrste, ili prazna niska ako je domaćinstvo nema. */
export function firstCategoryId(categories: readonly CategoryOption[], kind: EntryKind): string {
  return categoriesOfKind(categories, kind)[0]?.id ?? "";
}

/**
 * Promena vrste uvek bira novu kategoriju.
 *
 * Kategorija pripada tačno jednoj vrsti, pa zadržana „Hrana“ na prihodu nije
 * samo pogrešan izbor — baza je odbija (`Vrsta kategorije ne odgovara vrsti
 * unosa`). Izbor se zato ne pamti po vrsti: posle povratka na trošak stoji opet
 * prva kategorija troška, što je vidljivo i nedvosmisleno.
 */
export function switchKind(
  state: EntryFormState,
  kind: EntryKind,
  categories: readonly CategoryOption[],
): EntryFormState {
  if (state.kind === kind) {
    return state;
  }

  return { ...state, kind, categoryId: firstCategoryId(categories, kind) };
}

/** Današnji dan u Beogradu. UTC bi posle 22h (zimi 23h) pisao sutrašnji datum. */
export function defaultOccurredOn(now: Date): string {
  return todayInBelgrade(now);
}

/**
 * Početno stanje forme. Osoba je prijavljeni član kad je on u spisku — unos se
 * najčešće pripisuje sebi — a inače prvi član.
 */
export function initialEntryState(input: {
  categories: readonly CategoryOption[];
  people: readonly PersonOption[];
  signedInPersonId?: string | null;
  today: string;
}): EntryFormState {
  const signedIn = input.people.find((person) => person.id === input.signedInPersonId);

  return {
    kind: "expense",
    amount: "",
    categoryId: firstCategoryId(input.categories, "expense"),
    personId: signedIn?.id ?? input.people[0]?.id ?? "",
    occurredOn: input.today,
    note: "",
    repeat: false,
    remindDays: DEFAULT_REMIND_DAYS,
  };
}

/**
 * Razlog zbog kog forma ne sme ni da pokuša da pošalje, ili `null`.
 *
 * Prazan `<select>` bez ovoga izgleda kao polje koje korisnik nije popunio.
 * Poruka kaže ko to rešava: kategorije vodi vlasnik u podešavanjima.
 */
export function entryBlocker(input: {
  categories: readonly CategoryOption[];
  people: readonly PersonOption[];
  kind: EntryKind;
}): string | null {
  if (input.people.length === 0) {
    return "Spisak članova nije učitan, pa unos nema kome da se pripiše. Osvežite stranu.";
  }

  if (input.categories.length === 0) {
    return "Domaćinstvo nema nijednu aktivnu kategoriju. Vlasnik ih dodaje u podešavanjima.";
  }

  if (categoriesOfKind(input.categories, input.kind).length === 0) {
    return input.kind === "expense"
      ? "Nema nijedne aktivne kategorije troška. Vlasnik je dodaje u podešavanjima."
      : "Nema nijedne aktivne kategorije prihoda. Vlasnik je dodaje u podešavanjima.";
  }

  return null;
}

/** Datum iz `<input type="date">` i iz ručnog upisa — oba stižu kao niska. */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return false;
  }

  // Dužina meseca se ne prepisuje ovde; `clampDayOfMonth(year, mesec, 31)`
  // vraća poslednji dan, pa prestupna godina ostaje posao domena.
  return Number(match[3]) <= clampDayOfMonth(year, Number(match[2]), 31);
}

export type RepeatRule = { dayOfMonth: number; remindDays: number };

export type EntryDraft = {
  householdId: string;
  kind: EntryKind;
  amountMinor: number;
  categoryId: string;
  personId: string;
  occurredOn: string;
  note: string;
  repeat: RepeatRule | null;
};

export type RepeatingDraft = EntryDraft & { repeat: RepeatRule };

export type EntryChecked = { ok: true; draft: EntryDraft } | { ok: false; message: string };

/** Poruka iz domena ako je bacio `Error`, inače rezervna. */
function thrownMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * Sve provere pre slanja. Baza ima ista pravila i ostaje poslednja granica;
 * ovde se traži samo da član dobije rečenicu umesto greške ograničenja.
 */
export function validateEntry(
  state: EntryFormState,
  context: {
    householdId: string;
    categories: readonly CategoryOption[];
    people: readonly PersonOption[];
  },
): EntryChecked {
  let amountMinor: number;
  try {
    amountMinor = majorToMinor(state.amount);
  } catch (caught) {
    return {
      ok: false,
      message: thrownMessage(caught, "Iznos mora biti pozitivan ceo broj."),
    };
  }

  const category = context.categories.find((item) => item.id === state.categoryId);
  if (!category) {
    return { ok: false, message: "Izaberite kategoriju." };
  }

  // Ne može da se desi kroz ponuđeni spisak, ali promena vrste i izbor
  // kategorije su dva koraka — ovo je tvrdnja da se nisu razišli.
  if (category.kind !== state.kind) {
    return {
      ok: false,
      message: "Kategorija nije iste vrste kao unos. Izaberite kategoriju te vrste.",
    };
  }

  if (!context.people.some((person) => person.id === state.personId)) {
    return { ok: false, message: "Izaberite osobu kojoj unos pripada." };
  }

  if (!isCalendarDate(state.occurredOn)) {
    return { ok: false, message: "Unesite datum u obliku 31.12.2026." };
  }

  const note = state.note.trim();

  if (!state.repeat) {
    return {
      ok: true,
      draft: {
        householdId: context.householdId,
        kind: state.kind,
        amountMinor,
        categoryId: category.id,
        personId: state.personId,
        occurredOn: state.occurredOn,
        note,
        repeat: null,
      },
    };
  }

  const remindText = state.remindDays.trim();
  if (!/^\d+$/.test(remindText)) {
    return { ok: false, message: "Podsetnik je od 1 do 7 dana." };
  }

  const remindDays = Number(remindText);
  const dayOfMonth = Number(state.occurredOn.slice(8, 10));
  try {
    assertRemindDays(remindDays);
    assertDayOfMonth(dayOfMonth);
  } catch (caught) {
    return { ok: false, message: thrownMessage(caught, "Podsetnik je od 1 do 7 dana.") };
  }

  return {
    ok: true,
    draft: {
      householdId: context.householdId,
      kind: state.kind,
      amountMinor,
      categoryId: category.id,
      personId: state.personId,
      occurredOn: state.occurredOn,
      note,
      repeat: { dayOfMonth, remindDays },
    },
  };
}

/**
 * Greška iz mreže ili baze u rečenicu koja kaže šta sledeće.
 *
 * Tekst baze se ne prikazuje: poruke okidača su na srpskom, ali su pisane za
 * programera („Vrsta kategorije ne odgovara vrsti unosa“), a greške drajvera
 * nisu ni na srpskom.
 */
export function entryErrorMessage(raw: string | null | undefined): string {
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
    return "Prijava je istekla. Prijavite se ponovo pa sačuvajte unos.";
  }

  if (value.includes("niste član") || value.includes("row-level security")) {
    return "Nemate pristup ovom domaćinstvu. Otvorite ga sa početne strane.";
  }

  if (value.includes("arhivirana kategorija")) {
    return "Kategorija je u međuvremenu arhivirana. Izaberite drugu i sačuvajte ponovo.";
  }

  if (value.includes("vrsta kategorije")) {
    return "Kategorija nije iste vrste kao unos. Izaberite kategoriju te vrste.";
  }

  if (value.includes("kategorija ne pripada")) {
    return "Kategorija više ne postoji u ovom domaćinstvu. Osvežite stranu pa izaberite ponovo.";
  }

  if (value.includes("osoba nije član")) {
    return "Izabrana osoba više nije član domaćinstva. Izaberite drugu.";
  }

  if (value.includes("entries_one_rule_per_month") || value.includes("duplicate key")) {
    return "Ovaj mesec već ima unos iz tog ponavljanja.";
  }

  if (value.includes("remind_days")) {
    return "Podsetnik je od 1 do 7 dana.";
  }

  if (value.includes("day_of_month")) {
    return "Dan u mesecu mora biti od 1 do 31.";
  }

  if (value.includes("amount_minor")) {
    return "Iznos mora biti pozitivan ceo broj.";
  }

  return "Pokušajte ponovo. Ako se ponavlja, osvežite stranu i proverite kategoriju i osobu.";
}

export type GatewayError = { message?: string | null } | null;

export type GatewayResult = { error: GatewayError };

/**
 * Dva puta do baze. Običan unos ide direktnim `insert`-om pod RLS-om; unos sa
 * ponavljanjem ide kroz `create_entry_with_rule`, jer pravilo i prvi unos
 * moraju da nastanu zajedno ili nikako.
 */
export type EntryGateway = {
  insertEntry(draft: EntryDraft): Promise<GatewayResult>;
  createWithRule(draft: RepeatingDraft): Promise<GatewayResult>;
};

export type SaveResult = { ok: true } | { ok: false; message: string };

/**
 * Šalje nacrt i vraća ishod. Ne dira ulaz i ne baca: neuspeh je vrednost, pa
 * pozivalac nema razloga da bilo šta očisti — polja ostaju kakva su bila.
 */
export async function saveEntry(draft: EntryDraft, gateway: EntryGateway): Promise<SaveResult> {
  try {
    const repeat = draft.repeat;
    const result =
      repeat === null
        ? await gateway.insertEntry(draft)
        : await gateway.createWithRule({ ...draft, repeat });

    if (result.error) {
      return { ok: false, message: entryErrorMessage(result.error.message) };
    }

    return { ok: true };
  } catch (caught) {
    return { ok: false, message: entryErrorMessage(thrownMessage(caught, "")) };
  }
}

/**
 * Brava protiv dvostrukog slanja.
 *
 * `sent` je namerno ćorsokak: posle uspeha ide `router.push`, ali on ne ruši
 * komponentu odmah, pa bi otključavanje pustilo drugi klik da upiše isti trošak
 * još jednom. Otključava samo neuspeh.
 */
export type SubmitPhase = "idle" | "sending" | "sent";

export function canSend(phase: SubmitPhase): boolean {
  return phase === "idle";
}

export function phaseAfter(phase: SubmitPhase, result: SaveResult): SubmitPhase {
  if (phase !== "sending") {
    return phase;
  }

  return result.ok ? "sent" : "idle";
}

export function saveLabel(phase: SubmitPhase): string {
  return phase === "idle" ? "Sačuvaj" : "Čuvam…";
}
