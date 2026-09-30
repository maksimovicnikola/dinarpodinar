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

// Fix 2: Redosled brisanja — domaćinstva pre korisnika.
// prevent_owner_removal okidač blokira CASCADE brisanje vlasničkog profila
// dok domaćinstvo postoji. Brišemo domaćinstva eksplicitno (CASCADE briše
// kategorije, unose, članstva, pozivnice), pa tek onda korisnike.
afterAll(async () => {
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // 1. Nađi sve test korisnike (@example.com iz ovog rana)
  const { data: listData } = await admin.auth.admin.listUsers();
  const testUsers = (listData?.users ?? []).filter((u) => u.email?.endsWith("@example.com"));
  const testUserIds = testUsers.map((u) => u.id);

  if (testUserIds.length > 0) {
    // 2. Nađi sva domaćinstva kojima su test korisnici vlasnici
    const { data: memberships, error: mErr } = await admin
      .from("memberships")
      .select("household_id")
      .in("user_id", testUserIds)
      .eq("role", "owner");
    if (mErr) console.error("cleanup: grška pri traženju domaćinstava", mErr.message);

    const hhIds = [...new Set((memberships ?? []).map((m) => m.household_id as string))];

    // 3. Briši domaćinstva (CASCADE briše kategorije, unose, članstva, pozivnice)
    for (const hhId of hhIds) {
      const { error: delErr } = await admin.from("households").delete().eq("id", hhId);
      if (delErr) console.error(`cleanup: greška pri brisanju domaćinstva ${hhId}`, delErr.message);
    }
  }

  // 4. Briši auth korisnike (profili kaskadno; vlasničkih članstava više nema)
  for (const user of testUsers) {
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) console.error(`cleanup: greška pri brisanju korisnika ${user.email}`, delErr.message);
  }
});

// ----------------------------------------------------------------
// Kanonski test iz brief-a
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
  const invite = await owner
    .from("invitations")
    .insert({ household_id: householdId, email: memberEmail })
    .select("token")
    .single();
  expect(invite.error).toBeNull();
  const accepted = await client(memberToken).rpc("accept_invitation", { p_token: invite.data?.token });
  expect(accepted.error).toBeNull();

  const member = client(memberToken);
  const people = await member.from("profiles").select("id, display_name");
  const ownerProfile = people.data?.find((row) => row.display_name === "Vlasnik");
  const inserted = await member
    .from("entries")
    .insert({
      household_id: householdId,
      kind: "expense",
      amount_minor: 125000,
      category_id: food?.id,
      person_id: ownerProfile?.id,
      occurred_on: "2026-09-30",
      note: "pijaca",
    })
    .select("person_name, created_by")
    .single();
  expect(inserted.error).toBeNull();
  expect(inserted.data?.person_name).toBe("Vlasnik");

  // Član pokušava UPDATE — reject_member_entry_change diže izuzetak
  // (entries_update USING = is_member → okidač okine, vrati grešku)
  const patched = await member.from("entries").update({ note: "ne sme" }).eq("household_id", householdId);
  expect(patched.error).not.toBeNull();

  // Belt-and-suspenders: provera stanja reda (ne oslanjamo se samo na grešku)
  const afterPatch = await owner.from("entries").select("note").eq("household_id", householdId).single();
  expect(afterPatch.data?.note).toBe("pijaca");

  const outsider = client(outsiderToken);
  const hidden = await outsider.from("entries").select("id").eq("household_id", householdId);
  expect(hidden.data ?? []).toEqual([]);

  const currency = await owner.from("households").update({ currency: "EUR" }).eq("id", householdId);
  expect(currency.error).not.toBeNull();
});

// ----------------------------------------------------------------
// Pozivnica: istek
// ----------------------------------------------------------------
it("istekla pozivnica se ne prihvata", async () => {
  const owner = client(ownerToken);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const stamp = Date.now();
  const expiredEmail = `expired-${stamp}@example.com`;
  const expiredToken = await signUp(expiredEmail, "Istekli");

  const hid: string = (
    await owner.rpc("create_household", { p_name: "Kuća za test isteka", p_currency: "RSD" })
  ).data;

  // Service-role ubacuje pozivnicu sa expires_at u prošlosti (zaobilazi RLS)
  const { data: invData, error: invErr } = await admin
    .from("invitations")
    .insert({
      household_id: hid,
      email: expiredEmail,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    .select("token")
    .single();
  expect(invErr).toBeNull();

  const result = await client(expiredToken).rpc("accept_invitation", { p_token: invData!.token });
  expect(result.error).not.toBeNull();
  expect(result.error?.message).toMatch(/istekla|ne važi/i);

  // Provera stanja: korisnik nije dodat u domaćinstvo
  const { data: membership } = await admin.from("memberships").select("user_id").eq("household_id", hid);
  const expiredUser = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === expiredEmail);
  expect(membership?.some((m) => m.user_id === expiredUser?.id)).toBe(false);
});

// ----------------------------------------------------------------
// Pozivnica: pogrešna e-pošta (NULL-safe IS DISTINCT FROM)
// ----------------------------------------------------------------
it("pozivnica za drugu e-poštu se odbija", async () => {
  const owner = client(ownerToken);
  const stamp = Date.now();
  const wrongEmail = `wrong-${stamp}@example.com`;
  const wrongToken = await signUp(wrongEmail, "Pogrešan");

  const hid: string = (
    await owner.rpc("create_household", { p_name: "Kuća za e-poštu", p_currency: "RSD" })
  ).data;

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
// Unosi: recurring_rule_id mora biti kompatibilan (isti household, ista vrsta)
// ----------------------------------------------------------------
it("unos sa nekompatibilnim recurring_rule_id se odbija", async () => {
  const owner = client(ownerToken);

  const hid: string = (
    await owner.rpc("create_household", { p_name: "Kuća za pravila", p_currency: "RSD" })
  ).data;
  expect(hid).toBeTruthy();

  const { data: cats } = await owner.from("categories").select("id, name, kind").eq("household_id", hid);
  const expenseCat = cats?.find((c) => c.kind === "expense");
  const incomeCat = cats?.find((c) => c.kind === "income");
  expect(expenseCat).toBeTruthy();
  expect(incomeCat).toBeTruthy();

  const ownerProfile = (await owner.auth.getUser()).data.user!;

  const { data: rule, error: ruleErr } = await owner
    .from("recurring_rules")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 50000,
      category_id: expenseCat!.id,
      person_id: ownerProfile.id,
      day_of_month: 1,
    })
    .select("id")
    .single();
  expect(ruleErr).toBeNull();

  // income unos + expense rule → mora odbiti
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
// Ponavljajuća pravila: category_id mora biti iz istog domaćinstva
// ----------------------------------------------------------------
it("pravilo sa kategorijom iz drugog domaćinstva se odbija", async () => {
  const owner = client(ownerToken);

  const hid1: string = (
    await owner.rpc("create_household", { p_name: "Domaćinstvo A", p_currency: "RSD" })
  ).data;
  const hid2: string = (
    await owner.rpc("create_household", { p_name: "Domaćinstvo B", p_currency: "RSD" })
  ).data;

  const { data: cats1 } = await owner.from("categories").select("id, kind").eq("household_id", hid1);
  const cat1 = cats1?.find((c) => c.kind === "expense");

  const ownerProfile = (await owner.auth.getUser()).data.user!;

  // Pravilo za hid2 sa kategorijom iz hid1 → mora odbiti
  const { error } = await owner.from("recurring_rules").insert({
    household_id: hid2,
    kind: "expense",
    amount_minor: 10000,
    category_id: cat1!.id,
    person_id: ownerProfile.id,
    day_of_month: 5,
  });
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/domaćinstvu|kategorija/i);
});

// ----------------------------------------------------------------
// Arhiva i jedan unos po pravilu (Task 2)
// ----------------------------------------------------------------
it("arhiva odbija novi unos, a isto pravilo u istom mesecu ostaje jedno", async () => {
  // Guard 1: shared state — householdId mora biti popunjen od prvog testa
  expect(householdId).toBeTruthy();

  const owner = client(ownerToken);
  const food = await owner.from("categories").select("id").eq("household_id", householdId).eq("name", "Hrana").single();
  // Guard 2: lookup kategorije mora uspeti pre testiranja arhive
  expect(food.error).toBeNull();
  expect(food.data).not.toBeNull();
  expect(food.data!.id).toBeTruthy();

  const archived = await owner.from("categories").update({ archived: true }).eq("id", food.data!.id);
  expect(archived.error).toBeNull();

  const member = client(memberToken);
  const me = await member.auth.getUser();
  // Guard 3: auth mora uspeti i korisnik mora imati id
  expect(me.error).toBeNull();
  expect(me.data.user).not.toBeNull();
  expect(me.data.user!.id).toBeTruthy();

  const rejected = await member.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 100,
    category_id: food.data!.id,
    person_id: me.data.user!.id,
    occurred_on: "2026-09-30",
  });
  expect(rejected.error).not.toBeNull();

  // Guard 4: razarhiviranje mora uspeti pre nego što kreiramo pravilo
  const unarchived = await owner.from("categories").update({ archived: false }).eq("id", food.data!.id);
  expect(unarchived.error).toBeNull();

  const rule = await member.from("recurring_rules").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 50000,
    category_id: food.data!.id,
    person_id: me.data.user!.id,
    day_of_month: 31,
    remind_days: 1,
  }).select("id").single();
  expect(rule.error).toBeNull();
  expect(rule.data).not.toBeNull();
  expect(rule.data!.id).toBeTruthy();

  const first = await member.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 50000,
    category_id: food.data!.id,
    person_id: me.data.user!.id,
    occurred_on: "2026-02-28",
    recurring_rule_id: rule.data!.id,
  });
  const second = await member.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 50000,
    category_id: food.data!.id,
    person_id: me.data.user!.id,
    occurred_on: "2026-02-28",
    recurring_rule_id: rule.data!.id,
  });
  expect(first.error).toBeNull();
  expect(second.error).not.toBeNull();
});

// month_key logika testirana u: supabase/tests/month-key.test.ts
// (odvojen fajl — ne zavisi od Supabase veze, uvek se može pokrenuti)
