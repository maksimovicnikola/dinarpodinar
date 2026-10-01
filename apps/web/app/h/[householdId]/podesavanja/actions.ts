"use server";

/**
 * Server akcije podešavanja. Svaka je javna ulazna tačka i ne veruje strani
 * koja ju je iscrtala.
 *
 * Tri pravila važe za sve:
 *
 *  1. Prvo se proverava prijava, pa uloga u **tom** domaćinstvu. Vlasništvo u
 *     nekom drugom domaćinstvu ne daje nikakvo pravo ovde.
 *  2. Svaka izmena je sužena i po `id` reda i po `household_id`. Vlasnik koji
 *     pogodi tuđi `id` menja nula redova, ne tuđ red.
 *  3. Nula izmenjenih redova nije uspeh. PostgREST na `update`/`delete` koji
 *     ništa nije pogodio ne vraća grešku, pa se broj redova traži kroz
 *     `.select(...)` i proverava.
 *
 * Modul nosi direktivu `"use server"`, pa sme da izvozi samo async funkcije.
 * Tipovi, konstante i provere stoje u `@/lib/settings`; čuvar je
 * `lib/server-actions.test.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { uuidParam } from "@/lib/next-path";
import { canManage } from "@/lib/rows";
import {
  BAD_ADDRESS,
  CATEGORY_GONE,
  INVITATION_GONE,
  LIMIT_EXPENSE_ONLY,
  MEMBER_GONE,
  OWNER_ONLY,
  OWNER_STAYS,
  RULE_GONE,
  SESSION_GONE,
  settingsDone,
  settingsErrorMessage,
  settingsFailure,
  validateCategoryKind,
  validateCategoryName,
  validateLimit,
  validateRule,
  type SettingsState,
} from "@/lib/settings";
import { createWritableServerSupabase } from "@/lib/supabase/server";
import { validateEmail } from "@/lib/validation";

/** Polje iz forme kao niska. `File` i nedostajuće polje daju prazan tekst. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Štiklirano polje. Neštiklirano se uopšte ne šalje. */
function checked(formData: FormData, name: string): boolean {
  return text(formData, name) === "da";
}

type OpenGate = { ok: true; supabase: SupabaseClient; householdId: string };

type Gate = OpenGate | { ok: false; message: string };

/**
 * Prijava i tačno uloga `owner` u domaćinstvu iz forme.
 *
 * `household_id` dolazi iz skrivenog polja, pa se ne uzima zdravo za gotovo:
 * prvo mora da bude `uuid` (neispravan tekst bi iz Postgresa vratio grešku
 * tipa), a onda se uloga čita baš za taj red — `.eq("user_id", …)` je obavezno
 * jer RLS pušta i redove ostalih članova istog domaćinstva.
 */
async function ownerGate(rawHouseholdId: string): Promise<Gate> {
  const householdId = uuidParam(rawHouseholdId);
  if (householdId === null) {
    return { ok: false, message: BAD_ADDRESS };
  }

  const { supabase } = await createWritableServerSupabase();
  const auth = await supabase.auth.getUser();

  if (auth.error || !auth.data.user) {
    return { ok: false, message: SESSION_GONE };
  }

  const membership = await supabase
    .from("memberships")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", auth.data.user.id)
    .maybeSingle();

  if (membership.error) {
    console.error("podešavanja: čitanje uloge nije uspelo", membership.error);
    return { ok: false, message: settingsErrorMessage(membership.error.message) };
  }

  // `canManage` je zatvoreno na tačno „owner“: nečlan i član padaju na istu
  // poruku, pa se iz odgovora ne vidi ni da li domaćinstvo postoji.
  if (!canManage(membership.data?.role ?? "")) {
    return { ok: false, message: OWNER_ONLY };
  }

  return { ok: true, supabase, householdId };
}

/**
 * Zajednički okvir: kapija, posao, osvežavanje keša samo posle stvarne izmene.
 *
 * Izuzetak se ne propušta formi. Neuspeh je vrednost, pa polja ostaju
 * popunjena i član vidi rečenicu umesto srušene strane.
 */
async function runAsOwner(
  rawHouseholdId: string,
  work: (gate: OpenGate) => Promise<SettingsState>,
): Promise<SettingsState> {
  let householdId: string | null = null;

  try {
    const gate = await ownerGate(rawHouseholdId);
    if (!gate.ok) {
      return settingsFailure(gate.message);
    }

    householdId = gate.householdId;
    const result = await work(gate);

    if (result.ok) {
      revalidatePath(`/h/${gate.householdId}/podesavanja`);
      revalidatePath(`/h/${gate.householdId}`);
    }

    return result;
  } catch (caught) {
    console.error(`podešavanja: akcija nije uspela (${householdId ?? "bez domaćinstva"})`, caught);
    return settingsFailure(
      settingsErrorMessage(caught instanceof Error ? caught.message : null),
    );
  }
}

/** Broj redova koje je PostgREST stvarno izmenio, iz `.select(...)` odgovora. */
function touched(data: unknown[] | null): number {
  return (data ?? []).length;
}

// ----------------------------------------------------------------
// Kategorije
// ----------------------------------------------------------------

/**
 * Nova kategorija. Vrsta se bira samo ovde — posle otvaranja je nepromenljiva,
 * jer unosi i pravila već pokazuju na nju.
 */
export async function createCategoryAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const name = validateCategoryName(text(formData, "naziv"));
    if (!name.ok) {
      return settingsFailure(name.message);
    }

    const kind = validateCategoryKind(text(formData, "vrsta"));
    if (!kind.ok) {
      return settingsFailure(kind.message);
    }

    const created = await supabase
      .from("categories")
      .insert({ household_id: householdId, name: name.value, kind: kind.value })
      .select("id")
      .single();

    if (created.error) {
      return settingsFailure(settingsErrorMessage(created.error.message));
    }

    return settingsDone(
      kind.value === "expense"
        ? `Kategorija troška „${name.value}“ je dodata.`
        : `Kategorija prihoda „${name.value}“ je dodata.`,
    );
  });
}

/**
 * Preimenovanje. Šalje se samo `name`: vrsta i domaćinstvo se ne dodiruju, pa
 * ih ni okidač `prepare_category` nema šta da odbije.
 */
export async function renameCategoryAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const categoryId = uuidParam(text(formData, "kategorija"));
    if (categoryId === null) {
      return settingsFailure(CATEGORY_GONE);
    }

    const name = validateCategoryName(text(formData, "naziv"));
    if (!name.ok) {
      return settingsFailure(name.message);
    }

    const renamed = await supabase
      .from("categories")
      .update({ name: name.value })
      .eq("id", categoryId)
      .eq("household_id", householdId)
      .select("id");

    if (renamed.error) {
      return settingsFailure(settingsErrorMessage(renamed.error.message));
    }

    if (touched(renamed.data) === 0) {
      return settingsFailure(CATEGORY_GONE);
    }

    return settingsDone(`Naziv je sačuvan: „${name.value}“.`);
  });
}

/**
 * Mesečni limit. Prazno polje uklanja limit (`null`), nikad ga ne postavlja na
 * nulu. Vrsta se prvo pročita u okviru domaćinstva, da prihod dobije rečenicu
 * umesto greške ograničenja.
 */
export async function saveLimitAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const categoryId = uuidParam(text(formData, "kategorija"));
    if (categoryId === null) {
      return settingsFailure(CATEGORY_GONE);
    }

    const limit = validateLimit(text(formData, "limit"));
    if (!limit.ok) {
      return settingsFailure(limit.message);
    }

    const category = await supabase
      .from("categories")
      .select("id, name, kind")
      .eq("id", categoryId)
      .eq("household_id", householdId)
      .maybeSingle();

    if (category.error) {
      return settingsFailure(settingsErrorMessage(category.error.message));
    }

    if (!category.data) {
      return settingsFailure(CATEGORY_GONE);
    }

    if (category.data.kind !== "expense") {
      return settingsFailure(LIMIT_EXPENSE_ONLY);
    }

    const saved = await supabase
      .from("categories")
      .update({ limit_minor: limit.value })
      .eq("id", categoryId)
      .eq("household_id", householdId)
      .select("id");

    if (saved.error) {
      return settingsFailure(settingsErrorMessage(saved.error.message));
    }

    if (touched(saved.data) === 0) {
      return settingsFailure(CATEGORY_GONE);
    }

    return settingsDone(
      limit.value === null
        ? `„${category.data.name}“ više nema limit.`
        : `Limit za „${category.data.name}“ je sačuvan.`,
    );
  });
}

/**
 * Arhiva. Kategorija ostaje u istoriji meseca, ali ne prima nove unose, a
 * okidač `categories_archive_rules` gasi njena ponavljanja.
 */
export async function archiveCategoryAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const categoryId = uuidParam(text(formData, "kategorija"));
    if (categoryId === null) {
      return settingsFailure(CATEGORY_GONE);
    }

    const archived = await supabase
      .from("categories")
      .update({ archived: true })
      .eq("id", categoryId)
      .eq("household_id", householdId)
      .select("id, name");

    if (archived.error) {
      return settingsFailure(settingsErrorMessage(archived.error.message));
    }

    if (touched(archived.data) === 0) {
      return settingsFailure(CATEGORY_GONE);
    }

    return settingsDone(`„${archived.data?.[0]?.name ?? "Kategorija"}“ je arhivirana.`);
  });
}

// ----------------------------------------------------------------
// Članovi i pozivnice
// ----------------------------------------------------------------

/**
 * Pozivnica vezana za adresu e-pošte.
 *
 * Ovde se ne šalje nikakva pošta i ne pokreće se tuđa prijava: `signInWithOtp`
 * u vlasnikovom pregledaču otvorio bi sesiju na pogrešnoj adresi. Token, rok i
 * iskorišćenost postavlja baza (`prepare_invitation`), a vlasnik dobije link
 * koji prosleđuje sam.
 */
export async function inviteMemberAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const email = validateEmail(text(formData, "posta"));
    if (!email.ok) {
      return settingsFailure(email.message);
    }

    const created = await supabase
      .from("invitations")
      .insert({ household_id: householdId, email: email.value })
      .select("token")
      .single();

    if (created.error) {
      return settingsFailure(settingsErrorMessage(created.error.message));
    }

    const token = uuidParam(created.data?.token ?? null);
    if (token === null) {
      console.error("podešavanja: pozivnica je upisana bez upotrebljivog tokena");
      return settingsFailure(
        "Pozivnica je napravljena, ali link nije stigao nazad. Osvežite stranu i pogledajte spisak.",
      );
    }

    return settingsDone(`Pozivnica za ${email.value} vredi sedam dana.`, token);
  });
}

/** Povlačenje pozivnice. Isti put kao `invitations_delete` politika vlasnika. */
export async function revokeInvitationAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const invitationId = uuidParam(text(formData, "pozivnica"));
    if (invitationId === null) {
      return settingsFailure(INVITATION_GONE);
    }

    const revoked = await supabase
      .from("invitations")
      .delete()
      .eq("id", invitationId)
      .eq("household_id", householdId)
      .select("id");

    if (revoked.error) {
      return settingsFailure(settingsErrorMessage(revoked.error.message));
    }

    if (touched(revoked.data) === 0) {
      return settingsFailure(INVITATION_GONE);
    }

    return settingsDone("Pozivnica je povučena. Stari link više ne radi.");
  });
}

/**
 * Uklanjanje člana.
 *
 * `role = 'member'` je deo upita, ne samo politika: vlasnik ne sme da ispadne
 * ni greškom, a 0 redova je ovde jasna poruka umesto izuzetka iz okidača
 * `memberships_keep_owner`.
 */
export async function removeMemberAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const userId = uuidParam(text(formData, "clan"));
    if (userId === null) {
      return settingsFailure(MEMBER_GONE);
    }

    const target = await supabase
      .from("memberships")
      .select("role")
      .eq("household_id", householdId)
      .eq("user_id", userId)
      .maybeSingle();

    if (target.error) {
      return settingsFailure(settingsErrorMessage(target.error.message));
    }

    if (!target.data) {
      return settingsFailure(MEMBER_GONE);
    }

    if (canManage(target.data.role)) {
      return settingsFailure(OWNER_STAYS);
    }

    const removed = await supabase
      .from("memberships")
      .delete()
      .eq("household_id", householdId)
      .eq("user_id", userId)
      .eq("role", "member")
      .select("user_id");

    if (removed.error) {
      return settingsFailure(settingsErrorMessage(removed.error.message));
    }

    if (touched(removed.data) === 0) {
      return settingsFailure(MEMBER_GONE);
    }

    return settingsDone("Član je uklonjen. Njegovi unosi ostaju u istoriji.");
  });
}

// ----------------------------------------------------------------
// Ponavljanja
// ----------------------------------------------------------------

/**
 * Izmena ponavljanja: iznos, dan, podsetnik i da li je uključeno.
 *
 * Kategorija i osoba se ne diraju — za njih postoji nov unos sa ponavljanjem.
 * Uključivanje pravila čije je kategorije u međuvremenu arhivirana ili čija
 * osoba više nije član baza odbija, pa ta greška ima svoju rečenicu.
 */
export async function saveRuleAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  return runAsOwner(text(formData, "dom"), async ({ supabase, householdId }) => {
    const ruleId = uuidParam(text(formData, "pravilo"));
    if (ruleId === null) {
      return settingsFailure(RULE_GONE);
    }

    const rule = validateRule({
      amount: text(formData, "iznos"),
      day: text(formData, "dan"),
      remind: text(formData, "podsetnik"),
      active: checked(formData, "aktivno"),
    });

    if (!rule.ok) {
      return settingsFailure(rule.message);
    }

    const saved = await supabase
      .from("recurring_rules")
      .update({
        amount_minor: rule.value.amountMinor,
        day_of_month: rule.value.dayOfMonth,
        remind_days: rule.value.remindDays,
        active: rule.value.active,
      })
      .eq("id", ruleId)
      .eq("household_id", householdId)
      .select("id");

    if (saved.error) {
      return settingsFailure(settingsErrorMessage(saved.error.message));
    }

    if (touched(saved.data) === 0) {
      return settingsFailure(RULE_GONE);
    }

    return settingsDone(
      rule.value.active
        ? `Ponavljanje je sačuvano i radi ${rule.value.dayOfMonth}. u mesecu.`
        : "Ponavljanje je sačuvano i ugašeno.",
    );
  });
}
