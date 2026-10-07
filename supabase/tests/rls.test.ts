/**
 * Integracioni RLS testovi — zahtevaju pokrenut lokalni Supabase.
 *
 *   supabase start && supabase db reset && pnpm test:rls
 *
 * Čišćenje briše isključivo redove koje je napravio baš ovaj ran (runStamp).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "lozinka-test-123";

/** Jedinstven marker rana — čišćenje dira samo ono što je ovde napravljeno. */
const runStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: string[] = [];
const createdHouseholdIds: string[] = [];

type TestUser = { id: string; email: string; token: string; displayName: string };

function client(accessToken?: string): SupabaseClient {
  return createClient(url, anon, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function adminClient(): SupabaseClient {
  return createClient(url, service, { auth: { persistSession: false } });
}

async function signUp(prefix: string, displayName: string): Promise<TestUser> {
  const email = `${prefix}-${runStamp}@example.com`;
  const admin = adminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id;
  createdUserIds.push(id);

  const signed = await client().auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("nema sesije");
  return { id, email, token: signed.data.session.access_token, displayName };
}

async function createHousehold(token: string, name: string): Promise<string> {
  const created = await client(token).rpc("create_household", { p_name: name, p_currency: "RSD" });
  expect(created.error).toBeNull();
  expect(created.data).toBeTruthy();
  const id = created.data as string;
  createdHouseholdIds.push(id);
  return id;
}

async function categoryId(token: string, hid: string, name: string, kind = "expense"): Promise<string> {
  const found = await client(token)
    .from("categories")
    .select("id")
    .eq("household_id", hid)
    .eq("name", name)
    .eq("kind", kind)
    .single();
  expect(found.error).toBeNull();
  expect(found.data?.id).toBeTruthy();
  return found.data!.id as string;
}

async function addMember(owner: TestUser, member: TestUser, hid: string): Promise<void> {
  const invite = await client(owner.token)
    .from("invitations")
    .insert({ household_id: hid, email: member.email })
    .select("token")
    .single();
  expect(invite.error).toBeNull();
  expect(invite.data?.token).toBeTruthy();
  const accepted = await client(member.token).rpc("accept_invitation", { p_token: invite.data!.token });
  expect(accepted.error).toBeNull();
}

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let householdId = "";

beforeAll(async () => {
  owner = await signUp("vlasnik", "Vlasnik");
  member = await signUp("clan", "Član");
  outsider = await signUp("spolja", "Spolja");
});

// Domaćinstva prvo (CASCADE briše kategorije, unose, članstva, pozivnice),
// pa tek onda nalozi. Diramo samo id-jeve iz ovog rana.
afterAll(async () => {
  const admin = adminClient();

  for (const hid of createdHouseholdIds) {
    const { error } = await admin.from("households").delete().eq("id", hid);
    if (error) console.error(`cleanup: domaćinstvo ${hid}`, error.message);
  }
  for (const userId of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`cleanup: korisnik ${userId}`, error.message);
  }
});

// ----------------------------------------------------------------
// Kanonski test iz brief-a
// ----------------------------------------------------------------
it("član ne vidi tuđe domaćinstvo i ne menja unos", async () => {
  const ownerApi = client(owner.token);
  householdId = await createHousehold(owner.token, "Naša kuća");

  const categories = await ownerApi.from("categories").select("id, name, kind").eq("household_id", householdId);
  expect(categories.error).toBeNull();
  expect(categories.data).toEqual([]);

  const addedCategories = await ownerApi
    .from("categories")
    .insert([
      { household_id: householdId, name: "Hrana", kind: "expense" },
      { household_id: householdId, name: "Plata", kind: "income" },
    ])
    .select("id, name, kind");
  expect(addedCategories.error).toBeNull();
  expect(addedCategories.data?.map(({ name, kind }) => ({ name, kind }))).toEqual([
    { name: "Hrana", kind: "expense" },
    { name: "Plata", kind: "income" },
  ]);
  const food = addedCategories.data?.find((row) => row.kind === "expense");
  expect(food).toBeTruthy();

  await addMember(owner, member, householdId);

  const memberApi = client(member.token);
  const people = await memberApi.from("profiles").select("id, display_name");
  expect(people.error).toBeNull();
  const ownerProfile = people.data?.find((row) => row.id === owner.id);
  expect(ownerProfile?.display_name).toBe("Vlasnik");

  const inserted = await memberApi
    .from("entries")
    .insert({
      household_id: householdId,
      kind: "expense",
      amount_minor: 125000,
      category_id: food!.id,
      person_id: owner.id,
      occurred_on: "2026-09-30",
      note: "pijaca",
    })
    .select("person_name, created_by, month_key")
    .single();
  expect(inserted.error).toBeNull();
  expect(inserted.data?.person_name).toBe("Vlasnik");
  // Baza upisuje pisca unosa: tačno onaj koji je pozvao, ne prosleđena vrednost.
  expect(inserted.data?.created_by).toBe(member.id);
  // month_key generated column — pravi DDL, ne TypeScript replika.
  expect(inserted.data?.month_key).toBe("2026-09");

  // Član pokušava UPDATE — reject_member_entry_change diže izuzetak
  const patched = await memberApi.from("entries").update({ note: "ne sme" }).eq("household_id", householdId);
  expect(patched.error).not.toBeNull();

  const afterPatch = await ownerApi.from("entries").select("note").eq("household_id", householdId).single();
  expect(afterPatch.data?.note).toBe("pijaca");

  const hidden = await client(outsider.token).from("entries").select("id").eq("household_id", householdId);
  expect(hidden.data ?? []).toEqual([]);

  const currency = await ownerApi.from("households").update({ currency: "EUR" }).eq("id", householdId);
  expect(currency.error).not.toBeNull();
});

// ----------------------------------------------------------------
// Vlasnik menja i briše unos (suprotna strana kanonskog testa)
// ----------------------------------------------------------------
it("vlasnik menja i briše unos", async () => {
  const hid = await createHousehold(owner.token, "Kuća za izmene");
  const api = client(owner.token);
  const food = await categoryId(owner.token, hid, "Hrana");

  const inserted = await api
    .from("entries")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 1000,
      category_id: food,
      person_id: owner.id,
      occurred_on: "2026-03-10",
      note: "prvo",
    })
    .select("id")
    .single();
  expect(inserted.error).toBeNull();

  const updated = await api
    .from("entries")
    .update({ note: "drugo", amount_minor: 2000 })
    .eq("id", inserted.data!.id)
    .select("note, amount_minor")
    .single();
  expect(updated.error).toBeNull();
  expect(updated.data?.note).toBe("drugo");
  expect(updated.data?.amount_minor).toBe(2000);

  const removed = await api.from("entries").delete().eq("id", inserted.data!.id);
  expect(removed.error).toBeNull();
  const left = await api.from("entries").select("id").eq("id", inserted.data!.id);
  expect(left.data ?? []).toEqual([]);
});

// ----------------------------------------------------------------
// Ime osobe i pisac unosa su snimci
// ----------------------------------------------------------------
it("ime osobe i pisac unosa ostaju snimak posle nevezanih izmena", async () => {
  const hid = await createHousehold(owner.token, "Kuća za snimke");
  const snapshotMember = await signUp("snimak", "Snimak Prvi");
  await addMember(owner, snapshotMember, hid);

  const food = await categoryId(owner.token, hid, "Hrana");
  const inserted = await client(snapshotMember.token)
    .from("entries")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 5000,
      category_id: food,
      person_id: snapshotMember.id,
      occurred_on: "2026-04-01",
      note: "pre",
    })
    .select("id, person_name, created_by")
    .single();
  expect(inserted.error).toBeNull();
  expect(inserted.data?.person_name).toBe("Snimak Prvi");
  expect(inserted.data?.created_by).toBe(snapshotMember.id);

  // Nevezana izmena vlasnika ne sme da prepiše ni ime ni pisca.
  const patched = await client(owner.token)
    .from("entries")
    .update({ note: "posle", person_name: "Podmetnuto", created_by: owner.id })
    .eq("id", inserted.data!.id)
    .select("note, person_name, created_by")
    .single();
  expect(patched.error).toBeNull();
  expect(patched.data?.note).toBe("posle");
  expect(patched.data?.person_name).toBe("Snimak Prvi");
  expect(patched.data?.created_by).toBe(snapshotMember.id);

  // Promena imena profila ne dira stare unose.
  const renamed = await client(snapshotMember.token)
    .from("profiles")
    .update({ display_name: "Snimak Drugi" })
    .eq("id", snapshotMember.id);
  expect(renamed.error).toBeNull();
  const afterRename = await client(owner.token)
    .from("entries")
    .select("person_name")
    .eq("id", inserted.data!.id)
    .single();
  expect(afterRename.data?.person_name).toBe("Snimak Prvi");

  // Vlasnik menja osobu na unosu → upisuje se novo ime.
  const moved = await client(owner.token)
    .from("entries")
    .update({ person_id: owner.id })
    .eq("id", inserted.data!.id)
    .select("person_name")
    .single();
  expect(moved.error).toBeNull();
  expect(moved.data?.person_name).toBe("Vlasnik");
});

// ----------------------------------------------------------------
// Član ne vodi kategorije, limite ni pozivnice
// ----------------------------------------------------------------
it("član ne vodi kategorije, limite ni pozivnice", async () => {
  const hid = await createHousehold(owner.token, "Kuća za dozvole");
  const restricted = await signUp("ogranicen", "Ograničen");
  await addMember(owner, restricted, hid);

  const memberApi = client(restricted.token);
  const ownerApi = client(owner.token);
  const food = await categoryId(owner.token, hid, "Hrana");

  const newCategory = await memberApi.from("categories").insert({ household_id: hid, name: "Kafa", kind: "expense" });
  expect(newCategory.error).not.toBeNull();

  const limit = await memberApi.from("categories").update({ limit_minor: 999 }).eq("id", food).select("id");
  expect(limit.data ?? []).toEqual([]);
  const limitState = await ownerApi.from("categories").select("limit_minor").eq("id", food).single();
  expect(limitState.data?.limit_minor).toBeNull();

  const archive = await memberApi.from("categories").update({ archived: true }).eq("id", food).select("id");
  expect(archive.data ?? []).toEqual([]);
  const archiveState = await ownerApi.from("categories").select("archived").eq("id", food).single();
  expect(archiveState.data?.archived).toBe(false);

  const dropped = await memberApi.from("categories").delete().eq("id", food).select("id");
  expect(dropped.data ?? []).toEqual([]);
  const stillThere = await ownerApi.from("categories").select("id").eq("id", food);
  expect(stillThere.data?.length).toBe(1);

  const invite = await memberApi.from("invitations").insert({ household_id: hid, email: `neko-${runStamp}@example.com` });
  expect(invite.error).not.toBeNull();

  const seen = await memberApi.from("invitations").select("id").eq("household_id", hid);
  expect(seen.data ?? []).toEqual([]);
});

// ----------------------------------------------------------------
// Pozivnica: istek
// ----------------------------------------------------------------
it("istekla pozivnica se ne prihvata", async () => {
  const admin = adminClient();
  const expiredUser = await signUp("istekli", "Istekli");
  const hid = await createHousehold(owner.token, "Kuća za test isteka");

  // Service-role sme da napravi isteklu pozivnicu (fixture za testove).
  const { data: invData, error: invErr } = await admin
    .from("invitations")
    .insert({
      household_id: hid,
      email: expiredUser.email,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    .select("token")
    .single();
  expect(invErr).toBeNull();

  const result = await client(expiredUser.token).rpc("accept_invitation", { p_token: invData!.token });
  expect(result.error).not.toBeNull();
  expect(result.error?.message).toMatch(/istekla|ne važi/i);

  const { data: membership } = await admin.from("memberships").select("user_id").eq("household_id", hid);
  expect(membership?.some((m) => m.user_id === expiredUser.id)).toBe(false);
});

// ----------------------------------------------------------------
// Pozivnica: pogrešna e-pošta (NULL-safe IS DISTINCT FROM)
// ----------------------------------------------------------------
it("pozivnica za drugu e-poštu se odbija", async () => {
  const wrongUser = await signUp("pogresan", "Pogrešan");
  const hid = await createHousehold(owner.token, "Kuća za e-poštu");

  const { data: invData, error: invErr } = await client(owner.token)
    .from("invitations")
    .insert({ household_id: hid, email: `nekodrugi-${runStamp}@example.com` })
    .select("token")
    .single();
  expect(invErr).toBeNull();

  const result = await client(wrongUser.token).rpc("accept_invitation", { p_token: invData!.token });
  expect(result.error).not.toBeNull();
  expect(result.error?.message).toMatch(/drugu e-poštu/i);
});

// ----------------------------------------------------------------
// Pozivnica: vlasnik ne bira token, rok ni iskorišćenost; sme da povuče
// ----------------------------------------------------------------
it("baza određuje token i sedmodnevni rok pozivnice", async () => {
  const hid = await createHousehold(owner.token, "Kuća za pozivnice");
  const invitee = await signUp("pozvan", "Pozvan");
  const podmetnutToken = "00000000-0000-4000-8000-000000000001";
  const zaGodinu = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  const created = await client(owner.token)
    .from("invitations")
    .insert({
      household_id: hid,
      email: invitee.email,
      token: podmetnutToken,
      expires_at: zaGodinu,
      used_at: new Date().toISOString(),
    })
    .select("id, token, created_at, expires_at, used_at")
    .single();
  expect(created.error).toBeNull();
  expect(created.data?.token).not.toBe(podmetnutToken);
  expect(created.data?.used_at).toBeNull();
  const ttlMs = new Date(created.data!.expires_at).getTime() - new Date(created.data!.created_at).getTime();
  expect(ttlMs).toBeGreaterThan(0);
  expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);

  // Vlasnik povlači pozivnicu; posle toga se ne prihvata.
  const revoked = await client(owner.token).from("invitations").delete().eq("id", created.data!.id).select("id");
  expect(revoked.error).toBeNull();
  expect(revoked.data?.length).toBe(1);

  const accepted = await client(invitee.token).rpc("accept_invitation", { p_token: created.data!.token });
  expect(accepted.error).not.toBeNull();
});

// ----------------------------------------------------------------
// Unosi: recurring_rule_id mora biti kompatibilan (isti household, ista vrsta)
// ----------------------------------------------------------------
it("unos sa nekompatibilnim recurring_rule_id se odbija", async () => {
  const ownerApi = client(owner.token);
  const hid = await createHousehold(owner.token, "Kuća za pravila");

  const expenseCat = await categoryId(owner.token, hid, "Hrana", "expense");
  const incomeCat = await categoryId(owner.token, hid, "Plata", "income");

  const rule = await ownerApi
    .from("recurring_rules")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 50000,
      category_id: expenseCat,
      person_id: owner.id,
      day_of_month: 1,
    })
    .select("id")
    .single();
  expect(rule.error).toBeNull();

  const { error: mismatch } = await ownerApi.from("entries").insert({
    household_id: hid,
    kind: "income",
    amount_minor: 50000,
    category_id: incomeCat,
    person_id: owner.id,
    occurred_on: "2026-09-30",
    recurring_rule_id: rule.data!.id,
  });
  expect(mismatch).not.toBeNull();
  expect(mismatch!.message).toMatch(/kompatibilno/i);
});

// ----------------------------------------------------------------
// Ponavljajuća pravila: category_id mora biti iz istog domaćinstva
// ----------------------------------------------------------------
it("pravilo sa kategorijom iz drugog domaćinstva se odbija", async () => {
  const ownerApi = client(owner.token);
  const hid1 = await createHousehold(owner.token, "Domaćinstvo A");
  const hid2 = await createHousehold(owner.token, "Domaćinstvo B");
  const cat1 = await categoryId(owner.token, hid1, "Hrana");

  const { error } = await ownerApi.from("recurring_rules").insert({
    household_id: hid2,
    kind: "expense",
    amount_minor: 10000,
    category_id: cat1,
    person_id: owner.id,
    day_of_month: 5,
  });
  expect(error).not.toBeNull();
  expect(error!.message).toMatch(/domaćinstvu|kategorija/i);
});

// ----------------------------------------------------------------
// Arhiva i jedan unos po pravilu (Task 2)
// ----------------------------------------------------------------
it("arhiva odbija novi unos, a isto pravilo u istom mesecu ostaje jedno", async () => {
  expect(householdId).toBeTruthy();

  const ownerApi = client(owner.token);
  const memberApi = client(member.token);
  const food = await categoryId(owner.token, householdId, "Hrana");

  const archived = await ownerApi.from("categories").update({ archived: true }).eq("id", food);
  expect(archived.error).toBeNull();

  const rejected = await memberApi.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 100,
    category_id: food,
    person_id: member.id,
    occurred_on: "2026-09-30",
  });
  expect(rejected.error).not.toBeNull();
  // Razlog mora biti arhiva, a ne neka druga zabrana.
  expect(rejected.error!.message).toMatch(/arhivirana kategorija/i);

  const unarchived = await ownerApi.from("categories").update({ archived: false }).eq("id", food);
  expect(unarchived.error).toBeNull();

  const rule = await memberApi
    .from("recurring_rules")
    .insert({
      household_id: householdId,
      kind: "expense",
      amount_minor: 50000,
      category_id: food,
      person_id: member.id,
      day_of_month: 31,
      remind_days: 1,
    })
    .select("id")
    .single();
  expect(rule.error).toBeNull();

  const first = await memberApi.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 50000,
    category_id: food,
    person_id: member.id,
    occurred_on: "2026-02-28",
    recurring_rule_id: rule.data!.id,
  });
  const second = await memberApi.from("entries").insert({
    household_id: householdId,
    kind: "expense",
    amount_minor: 50000,
    category_id: food,
    person_id: member.id,
    occurred_on: "2026-02-28",
    recurring_rule_id: rule.data!.id,
  });
  expect(first.error).toBeNull();
  expect(second.error).not.toBeNull();
  // Razlog mora biti jedinstveni indeks pravilo+mesec.
  expect(second.error!.code).toBe("23505");
  expect(second.error!.message).toMatch(/entries_one_rule_per_month/);
});

// ----------------------------------------------------------------
// Arhiviranje kategorije gasi njena pravila i ne dozvoljava nova
// ----------------------------------------------------------------
it("arhiviranje kategorije gasi pravila i odbija nova i oživljavanje", async () => {
  const hid = await createHousehold(owner.token, "Kuća za arhivu pravila");
  const api = client(owner.token);
  const food = await categoryId(owner.token, hid, "Hrana");

  const rule = await api
    .from("recurring_rules")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 30000,
      category_id: food,
      person_id: owner.id,
      day_of_month: 10,
    })
    .select("id, active")
    .single();
  expect(rule.error).toBeNull();
  expect(rule.data?.active).toBe(true);

  const archived = await api.from("categories").update({ archived: true }).eq("id", food);
  expect(archived.error).toBeNull();

  const afterArchive = await api.from("recurring_rules").select("active").eq("id", rule.data!.id).single();
  expect(afterArchive.error).toBeNull();
  expect(afterArchive.data?.active).toBe(false);

  const revived = await api.from("recurring_rules").update({ active: true }).eq("id", rule.data!.id);
  expect(revived.error).not.toBeNull();
  expect(revived.error!.message).toMatch(/arhivirana/i);

  const fresh = await api.from("recurring_rules").insert({
    household_id: hid,
    kind: "expense",
    amount_minor: 1000,
    category_id: food,
    person_id: owner.id,
    day_of_month: 3,
  });
  expect(fresh.error).not.toBeNull();
  expect(fresh.error!.message).toMatch(/arhivirana/i);

  const unarchived = await api.from("categories").update({ archived: false }).eq("id", food);
  expect(unarchived.error).toBeNull();
  const revivedAgain = await api
    .from("recurring_rules")
    .update({ active: true })
    .eq("id", rule.data!.id)
    .select("active")
    .single();
  expect(revivedAgain.error).toBeNull();
  expect(revivedAgain.data?.active).toBe(true);
});

// ----------------------------------------------------------------
// Uklanjanje člana gasi njegova pravila
// ----------------------------------------------------------------
it("uklanjanje člana gasi njegova pravila i oduzima pristup", async () => {
  const hid = await createHousehold(owner.token, "Kuća za odlazak");
  const leaving = await signUp("odlazi", "Odlazi");
  await addMember(owner, leaving, hid);

  const api = client(owner.token);
  const food = await categoryId(owner.token, hid, "Hrana");

  const rule = await client(leaving.token)
    .from("recurring_rules")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 20000,
      category_id: food,
      person_id: leaving.id,
      day_of_month: 15,
    })
    .select("id")
    .single();
  expect(rule.error).toBeNull();

  const entry = await client(leaving.token)
    .from("entries")
    .insert({
      household_id: hid,
      kind: "expense",
      amount_minor: 700,
      category_id: food,
      person_id: leaving.id,
      occurred_on: "2026-05-05",
      note: "pre odlaska",
    })
    .select("id, person_name")
    .single();
  expect(entry.error).toBeNull();
  expect(entry.data?.person_name).toBe("Odlazi");

  const removed = await api.from("memberships").delete().eq("household_id", hid).eq("user_id", leaving.id).select("user_id");
  expect(removed.error).toBeNull();
  expect(removed.data?.length).toBe(1);

  const afterRemoval = await api.from("recurring_rules").select("active").eq("id", rule.data!.id).single();
  expect(afterRemoval.error).toBeNull();
  expect(afterRemoval.data?.active).toBe(false);

  // Istorija ostaje, uz ime snimljeno u trenutku čuvanja.
  const history = await api.from("entries").select("person_name, note").eq("id", entry.data!.id).single();
  expect(history.data?.person_name).toBe("Odlazi");

  // Vlasnik i dalje sme da doradi stari unos bivšeg člana.
  const edited = await api
    .from("entries")
    .update({ note: "posle odlaska" })
    .eq("id", entry.data!.id)
    .select("note, person_name")
    .single();
  expect(edited.error).toBeNull();
  expect(edited.data?.person_name).toBe("Odlazi");

  const noAccess = await client(leaving.token).from("entries").select("id").eq("household_id", hid);
  expect(noAccess.data ?? []).toEqual([]);
});

// ----------------------------------------------------------------
// Kategorija: domaćinstvo i vrsta su nepromenljivi; limit samo za trošak
// ----------------------------------------------------------------
it("kategorija ne menja domaćinstvo ni vrstu, a limit ima samo trošak", async () => {
  const hid1 = await createHousehold(owner.token, "Kuća limita A");
  const hid2 = await createHousehold(owner.token, "Kuća limita B");
  const api = client(owner.token);
  const food = await categoryId(owner.token, hid1, "Hrana", "expense");
  const salary = await categoryId(owner.token, hid1, "Plata", "income");

  const moved = await api.from("categories").update({ household_id: hid2 }).eq("id", food);
  expect(moved.error).not.toBeNull();

  const retyped = await api.from("categories").update({ kind: "income" }).eq("id", food);
  expect(retyped.error).not.toBeNull();

  const incomeLimit = await api.from("categories").update({ limit_minor: 1000 }).eq("id", salary);
  expect(incomeLimit.error).not.toBeNull();

  const expenseLimit = await api
    .from("categories")
    .update({ limit_minor: 1000 })
    .eq("id", food)
    .select("limit_minor")
    .single();
  expect(expenseLimit.error).toBeNull();
  expect(expenseLimit.data?.limit_minor).toBe(1000);

  const duplicate = await api.from("categories").insert({ household_id: hid1, name: "Hrana", kind: "expense" });
  expect(duplicate.error).not.toBeNull();
  expect(duplicate.error!.code).toBe("23505");
});

// ----------------------------------------------------------------
// Brisanje naloga vlasnika ne ostavlja domaćinstvo bez vlasnika
// ----------------------------------------------------------------
it("brisanje naloga vlasnika briše njegova domaćinstva", async () => {
  const admin = adminClient();
  const leavingOwner = await signUp("vlasnik-odlazi", "Vlasnik Odlazi");
  const hid = await createHousehold(leavingOwner.token, "Kuća koja nestaje");

  const food = await categoryId(leavingOwner.token, hid, "Hrana");
  const entry = await client(leavingOwner.token).from("entries").insert({
    household_id: hid,
    kind: "expense",
    amount_minor: 4200,
    category_id: food,
    person_id: leavingOwner.id,
    occurred_on: "2026-06-06",
  });
  expect(entry.error).toBeNull();

  const deleted = await admin.auth.admin.deleteUser(leavingOwner.id);
  expect(deleted.error).toBeNull();
  createdUserIds.splice(createdUserIds.indexOf(leavingOwner.id), 1);

  const household = await admin.from("households").select("id").eq("id", hid);
  expect(household.data ?? []).toEqual([]);
  const memberships = await admin.from("memberships").select("user_id").eq("household_id", hid);
  expect(memberships.data ?? []).toEqual([]);

  // Nijedno preostalo domaćinstvo ne sme ostati bez vlasnika.
  const allHouseholds = await admin.from("households").select("id");
  expect(allHouseholds.error).toBeNull();
  const owners = await admin.from("memberships").select("household_id").eq("role", "owner");
  expect(owners.error).toBeNull();
  const withOwner = new Set((owners.data ?? []).map((row) => row.household_id as string));
  const ownerless = (allHouseholds.data ?? []).map((row) => row.id as string).filter((id) => !withOwner.has(id));
  expect(ownerless).toEqual([]);
});

// ----------------------------------------------------------------
// Anonimni klijent ne dobija ništa
// ----------------------------------------------------------------
it("anonimni klijent nema pristup tabelama", async () => {
  const anonApi = client();
  for (const table of ["households", "memberships", "categories", "entries", "recurring_rules", "invitations", "profiles", "sent_notifications"]) {
    const read = await anonApi.from(table).select("*").limit(1);
    expect(read.error, `anon sme da čita ${table}`).not.toBeNull();
  }
});

// month_key logika dodatno pokrivena u supabase/tests/month-key.test.ts
// (TypeScript replika izraza; pravi DDL se proverava u kanonskom testu iznad).
