/**
 * Odluke strane „Izmena unosa“ — šta se nudi, šta se prihvata, gde se vlasnik
 * vraća posle izmene ili brisanja.
 *
 * Stoji van JSX-a i van `"use server"` modula iz dva razloga: proverava se bez
 * pregledača i bez baze, a `actions.ts` sme da izvozi isključivo async
 * funkcije — Next svaki izvoz takvog modula tretira kao server akciju i obori
 * stranu greškom E352 na običnoj vrednosti. Čuvar te granice je
 * `lib/server-actions.test.ts`.
 *
 * Vrsta unosa ovde nije polje i nijedna funkcija je ne menja. Kategorija
 * pripada tačno jednoj vrsti, pa bi promena vrste zahtevala i novu kategoriju
 * — a tada to nije izmena istog unosa nego nov unos. Zato vrsta ostaje
 * nepromenljiva, a ponuda kategorija je zatvorena na vrstu unosa.
 */

import { monthKey, type EntryKind } from "@finance/domain";

import { categoriesOfKind, entryErrorMessage, isCalendarDate } from "./entry-form";
import { FALLBACK_PERSON_NAME, isMonthKey, type Person } from "./month-query";
import { uuidParam } from "./next-path";
import { majorToMinor } from "./rows";
import { CATEGORY_GONE, type Parsed } from "./settings";

/** Ista granica kao u formi novog unosa (`maxLength` polja beleške). */
export const MAX_NOTE = 120;

// ----------------------------------------------------------------
// Poruke
// ----------------------------------------------------------------

/**
 * Jedina rečenica koju član dobija — i na strani, i ako akciju pozove direktno.
 * Strana mu formu ni ne iscrtava, ali zabrana ne sme da zavisi od toga šta je
 * iscrtano.
 */
export const ENTRY_OWNER_ONLY = "Unos menja vlasnik.";

/**
 * Nula pogođenih redova nije uspeh. Unos je ili tuđ, ili ga više nema — oba
 * slučaja spolja izgledaju isto, pa i poruka mora da bude ista.
 */
export const ENTRY_GONE = "Unos nije nađen u ovom domaćinstvu. Osvežite stranu.";

export const ENTRY_KIND_MISMATCH =
  "Kategorija nije iste vrste kao unos. Izaberite kategoriju te vrste.";

/**
 * Arhiva ne prima unose, ali ne zaključava ni iznos ni belešku na starom
 * unosu: `prepare_entry` odbija samo *premeštanje* u arhiviranu kategoriju.
 * Ista granica važi i ovde, pa vlasnik može da popravi belešku unosa koji
 * stoji u kategoriji arhiviranoj u međuvremenu.
 */
export const ENTRY_CATEGORY_ARCHIVED =
  "Ta kategorija je arhivirana i ne prima unose. Ostavite postojeću ili izaberite aktivnu.";

/**
 * Osoba se menja samo na aktuelnog člana. Osoba koja je upisana u unos ostaje
 * dozvoljena i kad je izašla iz domaćinstva — inače bi izmena beleške tražila
 * i prepisivanje unosa na nekog drugog.
 */
export const ENTRY_PERSON_GONE =
  "Izabrana osoba nije član ovog domaćinstva. Izaberite člana ili ostavite osobu koja je upisana.";

export const ENTRY_DATE = "Unesite datum u obliku 31.12.2026.";

export const ENTRY_NOTE_TOO_LONG = `Beleška može imati najviše ${MAX_NOTE} znakova.`;

/** Brisanje je nepovratno, pa traži izričitu potvrdu, ne samo drugi klik. */
export const ENTRY_DELETE_UNCONFIRMED = "Potvrdite brisanje: unos se briše zauvek.";

// ----------------------------------------------------------------
// Vrsta i ponuda
// ----------------------------------------------------------------

/**
 * Vrsta iz baze u domenski tip. Kolona je `text` sa ograničenjem, ali do
 * klijenta stiže kao niska — `null` znači red koji ne odgovara nijednoj vrsti
 * i nikad se ne tumači kao trošak „po podrazumevanom“.
 */
export function parseEntryKind(raw: unknown): EntryKind | null {
  return raw === "expense" || raw === "income" ? raw : null;
}

export type EditCategory = { id: string; name: string; kind: EntryKind; archived: boolean };

/**
 * Kategorije koje vlasnik sme da izabere za ovaj unos.
 *
 * Dva pravila: nikad druga vrsta (baza bi je odbila sa „Vrsta kategorije ne
 * odgovara vrsti unosa“), i nikad arhivirana — osim one u kojoj unos već
 * stoji. Bez tog izuzetka izmena iznosa ili beleške starog unosa tražila bi i
 * prekategorizaciju, što menja istoriju meseca bez ičije namere.
 */
export function categoryChoices(
  categories: readonly EditCategory[],
  entry: { kind: EntryKind; categoryId: string },
): EditCategory[] {
  return categoriesOfKind(categories, entry.kind).filter(
    (category) => !category.archived || category.id === entry.categoryId,
  );
}

/**
 * Kategorija na kojoj polje kreće. Zatečena kategorija unosa, a prva iz ponude
 * samo ako zatečene nema — kontrolisan `<select>` sa vrednošću van ponude
 * ostao bi prazan i izgledao kao nepopunjeno polje.
 */
export function initialCategoryId(
  choices: readonly EditCategory[],
  currentCategoryId: string,
): string {
  return choices.some((category) => category.id === currentCategoryId)
    ? currentCategoryId
    : (choices[0]?.id ?? "");
}

export type EditPerson = Person & { former: boolean };

/**
 * Osobe u ponudi: svi aktuelni članovi, plus osoba upisana u unos ako je u
 * međuvremenu izašla.
 *
 * Snimak (`person_name`) je jedino što od bivšeg člana ostaje, pa ta opcija
 * nosi njegovo ime i njegov `person_id`. Bez nje bi `<select>` pao na prvog
 * člana po azbuci i izmena beleške bi tuđi trošak tiho pripisala nekom drugom.
 */
export function personChoices(
  members: readonly Person[],
  current: { id: string; name: string },
): EditPerson[] {
  const known: EditPerson[] = members.map((member) => ({
    id: member.id,
    name: member.name.trim() || FALLBACK_PERSON_NAME,
    former: false,
  }));

  if (current.id === "" || known.some((person) => person.id === current.id)) {
    return known;
  }

  // Bivši član je prvi jer je izabran; aktuelni članovi ostaju u svom redosledu.
  return [
    { id: current.id, name: current.name.trim() || FALLBACK_PERSON_NAME, former: true },
    ...known,
  ];
}

/**
 * Razlog zbog kog forma ne sme ni da pokuša da pošalje, ili `null`. Prazan
 * `<select>` bez ovoga izgleda kao polje koje vlasnik nije popunio.
 */
export function entryEditBlocker(input: {
  choices: readonly EditCategory[];
  people: readonly EditPerson[];
  kind: EntryKind;
}): string | null {
  if (input.people.length === 0) {
    return "Spisak članova nije učitan, pa unos nema kome da se pripiše. Osvežite stranu.";
  }

  if (input.choices.length === 0) {
    return input.kind === "expense"
      ? "Nema nijedne kategorije troška koja prima ovaj unos. Vlasnik ih vodi u podešavanjima."
      : "Nema nijedne kategorije prihoda koja prima ovaj unos. Vlasnik ih vodi u podešavanjima.";
  }

  return null;
}

// ----------------------------------------------------------------
// Provere polja
// ----------------------------------------------------------------

export type EntryEditInput = {
  amount: string;
  categoryId: string;
  personId: string;
  occurredOn: string;
  note: string;
};

export type EntryEditFields = {
  amountMinor: number;
  categoryId: string;
  personId: string;
  occurredOn: string;
  note: string;
};

/**
 * Sve što se proverava bez baze: iznos, datum, dužina beleške i oblik dva
 * identifikatora. Redosled ide od polja koje vlasnik stvarno kuca ka onima
 * koja dolaze iz `<select>`-a, pa prva poruka opisuje ono što je najverovatnije
 * i pogrešio.
 *
 * Identifikatori se proveravaju i kad ih je strana sama ponudila: oblik koji
 * nije `uuid` iz Postgresa vraća grešku tipa (22P02) umesto prazan rezultat.
 */
export function validateEntryFields(input: EntryEditInput): Parsed<EntryEditFields> {
  let amountMinor: number;
  try {
    amountMinor = majorToMinor(input.amount);
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error && caught.message
          ? caught.message
          : "Iznos mora biti pozitivan ceo broj.",
    };
  }

  if (!isCalendarDate(input.occurredOn)) {
    return { ok: false, message: ENTRY_DATE };
  }

  const note = input.note.trim();
  if (note.length > MAX_NOTE) {
    return { ok: false, message: ENTRY_NOTE_TOO_LONG };
  }

  const categoryId = uuidParam(input.categoryId);
  if (categoryId === null) {
    return { ok: false, message: CATEGORY_GONE };
  }

  const personId = uuidParam(input.personId);
  if (personId === null) {
    return { ok: false, message: ENTRY_PERSON_GONE };
  }

  return {
    ok: true,
    value: { amountMinor, categoryId, personId, occurredOn: input.occurredOn, note },
  };
}

/**
 * Izabrana kategorija naspram unosa koji se menja.
 *
 * `kind === null` je red koji ne nosi ni jednu od dve vrste; takav se tretira
 * kao da ga nema, jer se iz njega ne može zaključiti ništa o vrsti.
 */
export function checkCategoryChoice(input: {
  chosen: { id: string; kind: EntryKind | null; archived: boolean } | null;
  entry: { kind: EntryKind; categoryId: string };
}): Parsed<string> {
  const { chosen } = input;

  if (chosen === null || chosen.kind === null) {
    return { ok: false, message: CATEGORY_GONE };
  }

  if (chosen.kind !== input.entry.kind) {
    return { ok: false, message: ENTRY_KIND_MISMATCH };
  }

  if (chosen.archived && chosen.id !== input.entry.categoryId) {
    return { ok: false, message: ENTRY_CATEGORY_ARCHIVED };
  }

  return { ok: true, value: chosen.id };
}

/**
 * Izabrana osoba naspram osobe upisane u unos.
 *
 * Zatečena osoba prolazi bez provere članstva — baš zato postoji snimak
 * imena. Svaka **promena** traži aktuelnog člana, isto kao `prepare_entry`,
 * koji članstvo proverava samo kad se `person_id` menja.
 */
export function checkPersonChoice(input: {
  chosenId: string;
  entryPersonId: string;
  isMember: boolean;
}): Parsed<string> {
  if (input.chosenId === input.entryPersonId) {
    return { ok: true, value: input.entryPersonId };
  }

  if (!input.isMember) {
    return { ok: false, message: ENTRY_PERSON_GONE };
  }

  return { ok: true, value: input.chosenId };
}

/** Potvrda brisanja. Neštiklirano polje se uopšte ne šalje. */
export function confirmedDelete(raw: string): boolean {
  return raw === "da";
}

// ----------------------------------------------------------------
// Šta se šalje bazi
// ----------------------------------------------------------------

/**
 * Jedine kolone koje izmena unosa dodiruje.
 *
 * Sve ostalo je ili snimak (`person_name`, `created_by`), ili opis zahteva koji
 * je unos napravio (`request_id`), ili veza koju vlasnik ne bira
 * (`recurring_rule_id`, `household_id`, `kind`). Baza ih čuva okidačima
 * (`prepare_entry`, `keep_entry_request_id`), ali se ne šalju ni kao iste
 * vrednosti: poslato polje je polje koje neki budući okidač može da odbije.
 */
export function entryUpdatePayload(fields: EntryEditFields): {
  amount_minor: number;
  category_id: string;
  person_id: string;
  occurred_on: string;
  note: string;
} {
  return {
    amount_minor: fields.amountMinor,
    category_id: fields.categoryId,
    person_id: fields.personId,
    occurred_on: fields.occurredOn,
    note: fields.note,
  };
}

// ----------------------------------------------------------------
// Kuda posle izmene
// ----------------------------------------------------------------

/**
 * Mesečni pregled u kom se taj unos vidi.
 *
 * Posle izmene to je mesec **novog** datuma, posle brisanja mesec iz kog je
 * unos nestao. Datum koji nije u prozoru koji aplikacija ume da otvori pada na
 * adresu bez `?month=`, pa se otvara tekući mesec umesto meseca koji bi
 * `monthLabel` odbio.
 */
export function entryMonthPath(householdId: string, occurredOn: string | null | undefined): string {
  const base = `/h/${householdId}`;

  if (typeof occurredOn !== "string") {
    return base;
  }

  const month = monthKey(occurredOn);
  return isMonthKey(month) ? `${base}?month=${month}` : base;
}

// ----------------------------------------------------------------
// Prevod grešaka
// ----------------------------------------------------------------

/**
 * Greška iz baze u rečenicu koja kaže šta sledeće.
 *
 * Okidač `reject_member_entry_change` je jedini slučaj koji forma novog unosa
 * ne poznaje — na nov unos član ima pravo, na izmenu ne. Sve ostalo (arhiva,
 * vrsta, članstvo, mreža) ima isti prevod kao pri upisu, pa se ne prepisuje.
 */
export function entryEditErrorMessage(raw: string | null | undefined): string {
  if ((raw ?? "").toLowerCase().includes("samo vlasnik menja unos")) {
    return ENTRY_OWNER_ONLY;
  }

  return entryErrorMessage(raw);
}
