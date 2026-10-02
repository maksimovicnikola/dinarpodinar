import { assertDayOfMonth, assertRemindDays } from "@finance/domain";

import { majorToMinor } from "./rows";
import { supabase } from "./supabase";

export type Outcome = { ok: true; message: string; token?: string } | { ok: false; message: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

export function explain(raw: string | null | undefined): string {
  const value = (raw ?? "").toLowerCase();
  if (
    value.includes("failed to fetch") ||
    value.includes("fetch failed") ||
    value.includes("network") ||
    value.includes("load failed")
  ) {
    return "Nema veze sa serverom. Proverite internet i pokušajte ponovo.";
  }
  if (value.includes("jwt") || value.includes("prijava je obavezna")) {
    return "Prijava je istekla. Prijavite se ponovo.";
  }
  if (value.includes("row-level security") || value.includes("row level security")) {
    return "Ovo menja samo vlasnik domaćinstva.";
  }
  if (value.includes("categories_active_name")) {
    return "Kategorija tog naziva i vrste već postoji. Izaberite drugi naziv.";
  }
  if (value.includes("categories_limit_expense_only") || value.includes("limit_minor")) {
    return "Limit prati samo trošak i mora biti pozitivan iznos. Ostavite prazno da ga uklonite.";
  }
  if (value.includes("vrsta kategorije se ne menja")) {
    return "Vrsta kategorije se ne menja. Otvorite novu kategoriju te vrste.";
  }
  if (value.includes("arhivirana kategorija")) {
    return "Kategorija je arhivirana, pa ponavljanje ne može da bude aktivno.";
  }
  if (value.includes("osoba nije član")) {
    return "Osoba iz ponavljanja više nije član, pa ponavljanje ne može da se uključi.";
  }
  if (value.includes("vlasnik se ne uklanja") || value.includes("memberships_one_owner")) {
    return "Vlasnik ostaje u domaćinstvu. Domaćinstvo ima tačno jednog.";
  }
  if (value.includes("ne postoji")) return "Pozivnica ne postoji. Možda je vlasnik povukao.";
  if (value.includes("iskorišćena") || value.includes("iskoriscena")) {
    return "Pozivnica je već iskorišćena.";
  }
  if (value.includes("istekla")) return "Pozivnica je istekla. Zamolite vlasnika da pošalje novu.";
  if (value.includes("drugu e-poštu") || value.includes("drugu e-postu")) {
    return "Pozivnica je poslata na drugu adresu. Prijavite se tom adresom.";
  }
  if (value.includes("currency")) return "Valuta se piše sa tri slova, na primer RSD.";
  if (value.includes("name")) return "Naziv ne sme biti prazan.";
  return "Izmena nije sačuvana. Proverite podatke i pokušajte ponovo.";
}

function fail(error: { message: string } | null): Outcome {
  return { ok: false, message: explain(error?.message) };
}

export function categoryName(raw: string): Outcome & { value?: string } {
  const value = raw.trim();
  if (!value) return { ok: false, message: "Unesite naziv kategorije." };
  if (value.length > 80) return { ok: false, message: "Naziv kategorije može imati najviše 80 znakova." };
  return { ok: true, message: "", value };
}

export function moneyOrEmpty(raw: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (raw.trim().length === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: majorToMinor(raw) };
  } catch {
    return { ok: false, message: "Iznos mora biti pozitivan, na primer 25.000 ili 12,50." };
  }
}

export function minorToInput(amountMinor: number | null): string {
  if (amountMinor === null) return "";
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = frac === 0 ? String(major) : `${major},${String(frac).padStart(2, "0")}`;
  return amountMinor < 0 ? `-${body}` : body;
}

export function invitationToken(raw: string): string | null {
  const match = raw.trim().toLowerCase().match(UUID);
  return match?.[0] ?? null;
}

export function invitationUrl(token: string): string {
  const origin = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, "");
  return origin ? `${origin}/poziv/${token}` : `/poziv/${token}`;
}

export async function createCategory(
  householdId: string,
  name: string,
  kind: "expense" | "income",
): Promise<Outcome> {
  const checked = categoryName(name);
  if (!checked.ok || !checked.value) return checked;
  const created = await supabase
    .from("categories")
    .insert({ household_id: householdId, name: checked.value, kind })
    .select("id")
    .single();
  if (created.error || !created.data) return fail(created.error);
  return {
    ok: true,
    message: kind === "expense" ? `Kategorija troška „${checked.value}“ je dodata.` : `Kategorija prihoda „${checked.value}“ je dodata.`,
  };
}

export async function renameCategory(householdId: string, categoryId: string, name: string): Promise<Outcome> {
  const checked = categoryName(name);
  if (!checked.ok || !checked.value) return checked;
  const renamed = await supabase
    .from("categories")
    .update({ name: checked.value })
    .eq("id", categoryId)
    .eq("household_id", householdId)
    .select("id");
  if (renamed.error) return fail(renamed.error);
  if ((renamed.data ?? []).length === 0) return { ok: false, message: "Kategorija više nije tu." };
  return { ok: true, message: `Naziv je sačuvan: „${checked.value}“.` };
}

export async function saveLimit(householdId: string, categoryId: string, raw: string): Promise<Outcome> {
  const limit = moneyOrEmpty(raw);
  if (!limit.ok) return { ok: false, message: "Limit mora biti pozitivan iznos, na primer 25.000. Ostavite prazno da ga uklonite." };
  const saved = await supabase
    .from("categories")
    .update({ limit_minor: limit.value })
    .eq("id", categoryId)
    .eq("household_id", householdId)
    .select("id");
  if (saved.error) return fail(saved.error);
  if ((saved.data ?? []).length === 0) return { ok: false, message: "Kategorija više nije tu." };
  return { ok: true, message: limit.value === null ? "Limit je uklonjen." : "Limit je sačuvan." };
}

export async function archiveCategory(householdId: string, categoryId: string): Promise<Outcome> {
  const archived = await supabase
    .from("categories")
    .update({ archived: true })
    .eq("id", categoryId)
    .eq("household_id", householdId)
    .select("name");
  if (archived.error) return fail(archived.error);
  if ((archived.data ?? []).length === 0) return { ok: false, message: "Kategorija više nije tu." };
  return { ok: true, message: `„${archived.data?.[0]?.name ?? "Kategorija"}“ je arhivirana.` };
}

export async function inviteMember(householdId: string, email: string): Promise<Outcome> {
  const value = email.trim().toLowerCase();
  if (!value.includes("@") || value.length > 254) {
    return { ok: false, message: "Adresa e-pošte nije ispravna. Primer: ime@primer.rs" };
  }
  const created = await supabase.from("invitations").insert({ household_id: householdId, email: value }).select("token").single();
  if (created.error || !created.data) return fail(created.error);
  const token = invitationToken(String(created.data.token ?? ""));
  if (!token) return { ok: false, message: "Pozivnica je napravljena, ali link nije stigao. Osvežite spisak." };
  return { ok: true, message: `Pozivnica za ${value} vredi sedam dana.`, token };
}

export async function revokeInvitation(householdId: string, invitationId: string): Promise<Outcome> {
  const revoked = await supabase.from("invitations").delete().eq("id", invitationId).eq("household_id", householdId).select("id");
  if (revoked.error) return fail(revoked.error);
  if ((revoked.data ?? []).length === 0) return { ok: false, message: "Pozivnica više nije tu." };
  return { ok: true, message: "Pozivnica je povučena. Stari link više ne radi." };
}

export async function removeMember(householdId: string, userId: string): Promise<Outcome> {
  const removed = await supabase
    .from("memberships")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .eq("role", "member")
    .select("user_id");
  if (removed.error) return fail(removed.error);
  if ((removed.data ?? []).length === 0) return { ok: false, message: "Član više nije tu, ili je vlasnik." };
  return { ok: true, message: "Član je uklonjen. Njegovi unosi ostaju u istoriji." };
}

export async function saveRule(
  householdId: string,
  ruleId: string,
  input: { amount: string; day: number; remind: number; active: boolean },
): Promise<Outcome> {
  const amount = moneyOrEmpty(input.amount);
  if (!amount.ok || amount.value === null) {
    return { ok: false, message: "Iznos ponavljanja mora biti pozitivan, na primer 4.500." };
  }
  try {
    assertDayOfMonth(input.day);
    assertRemindDays(input.remind);
  } catch (caught) {
    return { ok: false, message: caught instanceof Error ? caught.message : "Dan ili podsetnik nije ispravan." };
  }
  const saved = await supabase
    .from("recurring_rules")
    .update({
      amount_minor: amount.value,
      day_of_month: input.day,
      remind_days: input.remind,
      active: input.active,
    })
    .eq("id", ruleId)
    .eq("household_id", householdId)
    .select("id");
  if (saved.error) return fail(saved.error);
  if ((saved.data ?? []).length === 0) return { ok: false, message: "Ponavljanje više nije tu." };
  return {
    ok: true,
    message: input.active ? `Ponavljanje je sačuvano i radi ${input.day}. u mesecu.` : "Ponavljanje je sačuvano i ugašeno.",
  };
}

export async function createHousehold(name: string, currency: string): Promise<Outcome & { id?: string }> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) return { ok: false, message: "Unesite naziv domaćinstva, najviše 80 znakova." };
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { ok: false, message: "Valuta se piše sa tri slova, na primer RSD." };
  const created = await supabase.rpc("create_household", { p_name: trimmed, p_currency: code });
  if (created.error || !created.data) return fail(created.error);
  return { ok: true, message: "Domaćinstvo je otvoreno.", id: String(created.data) };
}

export async function acceptInvitation(raw: string): Promise<Outcome> {
  const token = invitationToken(raw);
  if (!token) return { ok: false, message: "Link pozivnice nije ispravan. Nalepite ceo link ili kod." };
  const accepted = await supabase.rpc("accept_invitation", { p_token: token });
  if (accepted.error || !accepted.data) return fail(accepted.error);
  return { ok: true, message: "Pozivnica je prihvaćena." };
}
