/**
 * Provere polja za prijavu i otvaranje domaćinstva.
 *
 * Svaka vraća ili očišćenu vrednost koja sme da ide u Supabase, ili poruku na
 * srpskom koja kaže šta konkretno da se ispravi. Granice su iste kao u bazi:
 * ime profila i naziv domaćinstva ne smeju biti prazni posle `btrim`, a valuta
 * mora da prođe `^[A-Z]{3}$`.
 */

export type Checked = { ok: true; value: string } | { ok: false; message: string };

const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;

const EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmailLike(raw: string): boolean {
  const value = normalizeEmail(raw);
  return value.length <= MAX_EMAIL_LENGTH && EMAIL.test(value);
}

export function validateEmail(raw: string): Checked {
  const value = normalizeEmail(raw);

  if (value.length === 0) {
    return { ok: false, message: "Unesite adresu e-pošte na koju šaljemo link za prijavu." };
  }

  if (value.length > MAX_EMAIL_LENGTH) {
    return { ok: false, message: "Adresa e-pošte je predugačka." };
  }

  if (!EMAIL.test(value)) {
    return { ok: false, message: "Adresa e-pošte nije ispravna. Primer: ime@primer.rs" };
  }

  return { ok: true, value };
}

export function validateDisplayName(raw: string): Checked {
  const value = raw.trim();

  if (value.length < 2) {
    return { ok: false, message: "Ime mora imati bar dva znaka." };
  }

  if (value.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Ime može imati najviše ${MAX_NAME_LENGTH} znakova.` };
  }

  return { ok: true, value };
}

export function validateHouseholdName(raw: string): Checked {
  const value = raw.trim();

  if (value.length === 0) {
    return { ok: false, message: "Unesite naziv domaćinstva." };
  }

  if (value.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Naziv može imati najviše ${MAX_NAME_LENGTH} znakova.` };
  }

  return { ok: true, value };
}

export function validateCurrency(raw: string): Checked {
  const value = raw.trim().toUpperCase();

  if (value.length === 0) {
    return { ok: false, message: "Unesite valutu, na primer RSD." };
  }

  if (!/^[A-Z]{3}$/.test(value)) {
    return { ok: false, message: "Valuta se piše sa tri slova, na primer RSD ili EUR." };
  }

  return { ok: true, value };
}
