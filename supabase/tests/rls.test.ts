import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function client(accessToken?: string): SupabaseClient {
  return createClient(url, anon, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signUp(email: string, displayName: string): Promise<string> {
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const created = await admin.auth.admin.createUser({
    email,
    password: "lozinka-test-123",
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created.error) throw created.error;
  const signed = await client().auth.signInWithPassword({
    email,
    password: "lozinka-test-123",
  });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("nema sesije");
  return signed.data.session.access_token;
}

let ownerToken = "";
let memberToken = "";
let outsiderToken = "";
let householdId = "";

beforeAll(async () => {
  const stamp = Date.now();
  ownerToken = await signUp(`vlasnik-${stamp}@example.com`, "Vlasnik");
  memberToken = await signUp(`clan-${stamp}@example.com`, "Član");
  outsiderToken = await signUp(`spolja-${stamp}@example.com`, "Spolja");
});

afterAll(async () => {
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const listed = await admin.auth.admin.listUsers();
  for (const user of listed.data.users) {
    if (user.email?.endsWith("@example.com")) await admin.auth.admin.deleteUser(user.id);
  }
});

// ----------------------------------------------------------------
// Test iz brief-a (nepromenjen potpis)
// ----------------------------------------------------------------
it("član ne vidi tuđe domaćinstvo i ne menja unos", async () => {
  const owner = client(ownerToken);
  const created = await owner.rpc("create_household", { p_name: "Naša kuća", p_currency: "RSD" });
  expect(created.error).toBeNull();
  householdId = created.data as string;

  const categories = await owner.from("categories").select("id, name, kind").eq("household_id", householdId);
  expect(categories.data?.map((row) => row.name).sort()).toEqual(
    ["Hrana", "Ostalo", "Ostalo", "Plata", "Prevoz", "Računi", "Zdravlje"].sort(),
  );
  const food = categories.data?.find((row) => row.name === "Hrana" && row.kind === "expense");
  expect(food).toBeTruthy();

  const memberEmail = (await client(memberToken).auth.getUser()).data.user?.email ?? "";
  const invite = await owner.from("invitations").insert({ household_id: householdId, email: memberEmail }).select("token").single();
  expect(invite.error).toBeNull();
  const accepted = await client(memberToken).rpc("accept_invitation", { p_token: invite.data?.token });
  expect(accepted.error).toBeNull();

  const member = client(memberToken);
  const people = await member.from("profiles").select("id, display_name");
  const ownerProfile = people.data?.find((row) => row.display_name === "Vlasnik");
  const inserted = await member.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 125000,
    category_id: food?.id,
    person_id: ownerProfile?.id,
    occurred_on: "2026-09-30",
    note: "pijaca",
  }).select("person_name, created_by").single();
  expect(inserted.error).toBeNull();
  expect(inserted.data?.person_name).toBe("Vlasnik");

  // Član pokušava UPDATE — okidač reject_member_entry_change diže izuzetak
  // (entries_update USING = is_member, pa okidač okinuti i vrati grešku)
  const patched = await member.from("entries").update({ note: "ne sme" }).eq("household_id", householdId);
  expect(patched.error).not.toBeNull();

  // Dodatna provera stanja reda — ne oslanjamo se samo na grešku
  const afterPatch = await owner.from("entries").select("note").eq("household_id", householdId).single();
  expect(afterPatch.data?.note).toBe("pijaca");

  const outsider = client(outsiderToken);
  const hidden = await outsider.from("entries").select("id").eq("household_id", householdId);
  expect(hidden.data ?? []).toEqual([]);

  const currency = await owner.from("households").update({ currency: "EUR" }).eq("id", householdId);
  expect(currency.error).not.toBeNull();
});

// ----------------------------------------------------------------
// Pozivnica: istek i pogrešna e-pošta
// ----------------------------------------------------------------
it("istekla pozivnica se ne prihvata", async () => {
  const owner = client(ownerToken);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Kreiramo pozivnicu direktno kroz service-role i postavljamo expires_at u prošlost
  const stamp = Date.now();
  const expiredEmail = `expired-${stamp}@example.com`;
  const expiredToken = await signUp(expiredEmail, "Istekli");

  const hid: string = (await owner.rpc("create_household", { p_name: "Kuća za test isteka", p_currency: "RSD" })).data;

  // Ubacujemo pozivnicu direktno uz service-role (zaobiđe RLS) sa expires_at u prošlosti
  const { data: invData, error: invErr } = await admin
    .from("invitations")
    .insert({ household_id: hid, email: expiredEmail, expires_at: new Date(Date.now() - 1000).toISOString() })
    .select("token")
    .single();
  expect(invErr).toBeNull();

  const result = await client(expiredToken).rpc("accept_invitation", { p_token: invData!.token });
  expect(result.error).not.toBeNull();
  expect(result.error?.message).toMatch(/istekla|ne važi/i);

  // Provera: korisnik nije dodat u domaćinstvo
  const { data: membership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("household_id", hid);
  const expiredUser = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === expiredEmail);
  expect(membership?.some((m) => m.user_id === expiredUser?.id)).toBe(false);
});

it("pozivnica za drugu e-poštu se odbija", async () => {
  const owner = client(ownerToken);
  const stamp = Date.now();
  const wrongEmail = `wrong-${stamp}@example.com`;
  const wrongToken = await signUp(wrongEmail, "Pogrešan");

  const hid: string = (await owner.rpc("create_household", { p_name: "Kuća za e-poštu", p_currency: "RSD" })).data;

  // Pozivnica za neku drugu adresu
  const { data: invData, error: invErr } = await owner
    .from("invitations")
    .insert({ household_id: hid, email: `nekodrugi-${stamp}@example.com` })
    .select("token")
    .single();
  expect(invErr).toBeNull();

  const result = await client(wrongToken).rpc("accept_invitation", { p_token: invData!.token });
  expect(result.error).not.toBeNull();
  expect(result.error?.message).toMatch(/drugu e-poštu/i);
});

// ----------------------------------------------------------------
// Unosi: recurring_rule_id validacija
// ----------------------------------------------------------------
it("unos sa nekompatibilnim recurring_rule_id se odbija", async () => {
  const owner = client(ownerToken);

  const hid: string = (await owner.rpc("create_household", { p_name: "Kuća za pravila", p_currency: "RSD" })).data;
  expect(hid).toBeTruthy();

  const { data: cats } = await owner.from("categories").select("id, name, kind").eq("household_id", hid);
  const expenseCat = cats?.find((c) => c.kind === "expense");
  const incomeCat  = cats?.find((c) => c.kind === "income");
  expect(expenseCat).toBeTruthy();
  expect(incomeCat).toBeTruthy();

  const ownerProfile = (await owner.auth.getUser()).data.user!;

  // Kreiramo pravilo (expense)
  const { data: rule, error: ruleErr } = await owner.from("recurring_rules").insert({
    household_id: hid,
    kind: "expense",
    amount_minor: 50000,
    category_id: expenseCat!.id,
    person_id: ownerProfile.id,
    day_of_month: 1,
  }).select("id").single();
  expect(ruleErr).toBeNull();

  // Pokušaj unosa sa income kind + expense rule → mora odbiti
  const { error: mismatch } = await owner.from("entries").insert({
    household_id: hid,
    kind: "income",
    amount_minor: 50000,
    category_id: incomeCat!.id,
    person_id: ownerProfile.id,
    occurred_on: "2026-09-30",
    recurring_rule_id: rule!.id,
    created_by: ownerProfile.id,
  });
  expect(mismatch).not.toBeNull();
  expect(mismatch!.message).toMatch(/kompatibilno/i);
});

// ----------------------------------------------------------------
// Ponavljajuća pravila: category_id/person_id validacija
// ----------------------------------------------------------------
it("pravilo sa kategorijom iz drugog domaćinstva se odbija", async () => {
  const owner = client(ownerToken);

  const hid1: string = (await owner.rpc("create_household", { p_name: "Domaćinstvo A", p_currency: "RSD" })).data;
  const hid2: string = (await owner.rpc("create_household", { p_name: "Domaćinstvo B", p_currency: "RSD" })).data;

  const { data: cats1 } = await owner.from("categories").select("id, kind").eq("household_id", hid1);
  const cat1 = cats1?.find((c) => c.kind === "expense");

  const ownerProfile = (await owner.auth.getUser()).data.user!;

  // Pravilo za hid2 sa kategorijom iz hid1 → mora odbiti
  const { error } = await owner.from("recurring_rules").insert({
    household_id: hid2,
    kind: "expense",
    amount_minor: 10000,
    category_id: cat1!.id, // tuđa kategorija
    person_id: ownerProfile.id,
    day_of_month: 5,
  });
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/domaćinstvu|kategorija/i);
});
