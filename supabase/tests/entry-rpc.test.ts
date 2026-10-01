/**
 * Integracioni testovi za `create_entry_with_rule` — traže pokrenut lokalni Supabase.
 *
 *   supabase start && supabase db reset && pnpm test:entry-rpc
 *
 * Dve tvrdnje koje ovaj fajl brani:
 *   1. pravilo ponavljanja i prvi unos nastaju zajedno ili nikako;
 *   2. isti zahtev, koliko god puta stigao, pravi tačno jedan par.
 *
 * Zato ovde stoji i test koji pokazuje šta se dešava bez RPC-a — dva odvojena
 * poziva ostave siroče koje član ne može da skloni.
 *
 * Čišćenje briše isključivo redove koje je napravio baš ovaj ran (runStamp).
 */

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "lozinka-test-123";

/** Postgres kod za „nedovoljna privilegija“. */
const INSUFFICIENT_PRIVILEGE = "42501";

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
  return found.data!.id as string;
}

async function addMember(owner: TestUser, invited: TestUser, hid: string): Promise<void> {
  const invite = await client(owner.token)
    .from("invitations")
    .insert({ household_id: hid, email: invited.email })
    .select("token")
    .single();
  expect(invite.error).toBeNull();
  const accepted = await client(invited.token).rpc("accept_invitation", {
    p_token: invite.data!.token,
  });
  expect(accepted.error).toBeNull();
}

/** Broj pravila i unosa domaćinstva — merilo za „ništa nije ostalo iza pada“. */
async function counts(hid: string): Promise<{ rules: number; entries: number }> {
  const admin = adminClient();
  const rules = await admin
    .from("recurring_rules")
    .select("id", { count: "exact", head: true })
    .eq("household_id", hid);
  const entries = await admin
    .from("entries")
    .select("id", { count: "exact", head: true })
    .eq("household_id", hid);
  expect(rules.error).toBeNull();
  expect(entries.error).toBeNull();
  return { rules: rules.count ?? 0, entries: entries.count ?? 0 };
}

type RuleArgs = {
  p_household_id: string;
  p_kind: string;
  p_amount_minor: number;
  p_category_id: string;
  p_person_id: string;
  p_occurred_on: string | null;
  p_note: string;
  p_day_of_month: number;
  p_remind_days: number;
  p_request_id: string | null;
};

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let householdId = "";
let otherHouseholdId = "";
let food = "";
let salary = "";

beforeAll(async () => {
  owner = await signUp("rpc-vlasnik", "Vlasnik");
  member = await signUp("rpc-clan", "Marko");
  outsider = await signUp("rpc-spolja", "Spolja");

  householdId = await createHousehold(owner.token, "Naša kuća");
  otherHouseholdId = await createHousehold(outsider.token, "Tuđa kuća");
  await addMember(owner, member, householdId);

  food = await categoryId(owner.token, householdId, "Hrana", "expense");
  salary = await categoryId(owner.token, householdId, "Plata", "income");
});

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

/** Svaki poziv je nov zahtev osim kad test izričito ponovi `p_request_id`. */
function args(overrides: Partial<RuleArgs> = {}): RuleArgs {
  return {
    p_household_id: householdId,
    p_kind: "expense",
    p_amount_minor: 125000,
    p_category_id: food,
    p_person_id: member.id,
    p_occurred_on: "2026-10-05",
    p_note: "struja",
    p_day_of_month: 5,
    p_remind_days: 3,
    p_request_id: randomUUID(),
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Uspešna upotreba: član, ne vlasnik
// ----------------------------------------------------------------

describe("član pravi ponavljanje", () => {
  it("jedan poziv daje i pravilo i prvi unos, povezane", async () => {
    const before = await counts(householdId);

    const created = await client(member.token).rpc("create_entry_with_rule", args());
    expect(created.error).toBeNull();
    expect(created.data).toBeTruthy();

    const after = await counts(householdId);
    expect(after.rules).toBe(before.rules + 1);
    expect(after.entries).toBe(before.entries + 1);

    const admin = adminClient();
    const entry = await admin
      .from("entries")
      .select(
        "id, household_id, kind, amount_minor, category_id, person_id, person_name, occurred_on, month_key, note, created_by, recurring_rule_id, request_id",
      )
      .eq("id", created.data as string)
      .single();
    expect(entry.error).toBeNull();

    expect(entry.data).toMatchObject({
      household_id: householdId,
      kind: "expense",
      amount_minor: 125000,
      category_id: food,
      person_id: member.id,
      occurred_on: "2026-10-05",
      month_key: "2026-10",
      note: "struja",
    });

    // Snimak imena i autora postavlja okidač `prepare_entry`, ne pozivalac.
    expect(entry.data!.person_name).toBe("Marko");
    expect(entry.data!.created_by).toBe(member.id);
    expect(entry.data!.request_id).toBeTruthy();

    const rule = await admin
      .from("recurring_rules")
      .select("id, household_id, kind, amount_minor, category_id, person_id, note, day_of_month, remind_days, active")
      .eq("id", entry.data!.recurring_rule_id as string)
      .single();
    expect(rule.error).toBeNull();
    expect(rule.data).toMatchObject({
      household_id: householdId,
      kind: "expense",
      amount_minor: 125000,
      category_id: food,
      person_id: member.id,
      note: "struja",
      day_of_month: 5,
      remind_days: 3,
      active: true,
    });
  });

  it("prihod prolazi isto, sa kategorijom prihoda", async () => {
    const created = await client(member.token).rpc(
      "create_entry_with_rule",
      args({
        p_kind: "income",
        p_category_id: salary,
        p_amount_minor: 9000000,
        p_occurred_on: "2026-11-01",
        p_day_of_month: 1,
        p_remind_days: 1,
        p_note: "",
      }),
    );
    expect(created.error).toBeNull();

    const entry = await adminClient()
      .from("entries")
      .select("kind, note, recurring_rule_id")
      .eq("id", created.data as string)
      .single();
    expect(entry.data?.kind).toBe("income");
    expect(entry.data?.note).toBe("");
    expect(entry.data?.recurring_rule_id).toBeTruthy();
  });

  it("član vidi svoj unos i pravilo kroz RLS, bez service-role-a", async () => {
    const created = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_occurred_on: "2026-12-07", p_day_of_month: 7, p_note: "internet" }),
    );
    expect(created.error).toBeNull();

    const seen = await client(member.token)
      .from("entries")
      .select("id, note, recurring_rule_id")
      .eq("id", created.data as string)
      .single();
    expect(seen.error).toBeNull();
    expect(seen.data?.note).toBe("internet");

    const rule = await client(member.token)
      .from("recurring_rules")
      .select("id")
      .eq("id", seen.data!.recurring_rule_id as string)
      .single();
    expect(rule.error).toBeNull();
  });
});

// ----------------------------------------------------------------
// Idempotencija
// ----------------------------------------------------------------

describe("isti zahtev pravi tačno jedan par", () => {
  it("identifikator zahteva je obavezan", async () => {
    const before = await counts(householdId);
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: null }),
    );
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Zahtev nema identifikator/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("retry posle izgubljenog odgovora vraća isti unos i ne pravi drugo pravilo", async () => {
    const request = randomUUID();
    const before = await counts(householdId);

    const first = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_occurred_on: "2027-03-09", p_day_of_month: 9 }),
    );
    expect(first.error).toBeNull();

    const afterFirst = await counts(householdId);
    expect(afterFirst.rules).toBe(before.rules + 1);
    expect(afterFirst.entries).toBe(before.entries + 1);

    // Tri retrija istog slanja — isto kao tri klika posle tri izgubljena odgovora.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retry = await client(member.token).rpc(
        "create_entry_with_rule",
        args({ p_request_id: request, p_occurred_on: "2027-03-09", p_day_of_month: 9 }),
      );
      expect(retry.error, `retry ${attempt}`).toBeNull();
      expect(retry.data, `retry ${attempt}`).toBe(first.data);
    }

    expect(await counts(householdId)).toEqual(afterFirst);
  });

  it("retry vraća isti unos i kad se ostali parametri razlikuju — ključ je zahtev", async () => {
    const request = randomUUID();
    const first = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_occurred_on: "2027-04-02", p_day_of_month: 2, p_amount_minor: 1000 }),
    );
    expect(first.error).toBeNull();

    const before = await counts(householdId);
    const confused = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_occurred_on: "2027-04-02", p_day_of_month: 2, p_amount_minor: 2000 }),
    );
    expect(confused.error).toBeNull();
    expect(confused.data).toBe(first.data);
    expect(await counts(householdId)).toEqual(before);
  });

  it("istovremeni pozivi istog zahteva daju jedan par i isti id", async () => {
    const request = randomUUID();
    const before = await counts(householdId);

    const racers = Array.from({ length: 5 }, () =>
      client(member.token).rpc(
        "create_entry_with_rule",
        args({ p_request_id: request, p_occurred_on: "2027-05-11", p_day_of_month: 11 }),
      ),
    );
    const results = await Promise.all(racers);

    for (const [index, result] of results.entries()) {
      expect(result.error, `poziv ${index}: ${result.error?.message ?? ""}`).toBeNull();
    }

    const ids = new Set(results.map((result) => result.data as string));
    expect(ids.size).toBe(1);

    const after = await counts(householdId);
    expect(after.rules).toBe(before.rules + 1);
    expect(after.entries).toBe(before.entries + 1);

    // Gubitnikovo pravilo je poništeno zajedno sa njegovim unosom.
    const entry = await adminClient()
      .from("entries")
      .select("recurring_rule_id")
      .eq("id", [...ids][0] as string)
      .single();
    const rules = await adminClient()
      .from("recurring_rules")
      .select("id", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("day_of_month", 11);
    expect(rules.count).toBe(1);
    expect(entry.data?.recurring_rule_id).toBeTruthy();
  });

  it("nov identifikator pravi nov par, pa dve iste pretplate ostaju moguće", async () => {
    const before = await counts(householdId);
    const shared = {
      p_occurred_on: "2027-06-15",
      p_day_of_month: 15,
      p_amount_minor: 120000,
      p_note: "telefon",
    };

    const first = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ ...shared, p_request_id: randomUUID() }),
    );
    const second = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ ...shared, p_request_id: randomUUID() }),
    );

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).not.toBe(first.data);

    const after = await counts(householdId);
    expect(after.rules).toBe(before.rules + 2);
    expect(after.entries).toBe(before.entries + 2);
  });

  it("isti identifikator dva različita člana ne sudara — opseg je autor", async () => {
    const shared = randomUUID();
    const before = await counts(householdId);

    const byMember = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: shared, p_occurred_on: "2027-07-03", p_day_of_month: 3 }),
    );
    const byOwner = await client(owner.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: shared, p_occurred_on: "2027-07-03", p_day_of_month: 3, p_person_id: owner.id }),
    );

    expect(byMember.error).toBeNull();
    expect(byOwner.error).toBeNull();
    expect(byOwner.data).not.toBe(byMember.data);

    const after = await counts(householdId);
    expect(after.rules).toBe(before.rules + 2);
    expect(after.entries).toBe(before.entries + 2);

    const rows = await adminClient()
      .from("entries")
      .select("created_by")
      .eq("request_id", shared);
    expect(new Set((rows.data ?? []).map((row) => row.created_by)).size).toBe(2);
  });

  it("identifikator zahteva se posle upisa ne menja", async () => {
    const request = randomUUID();
    const created = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_occurred_on: "2027-08-08", p_day_of_month: 8 }),
    );
    expect(created.error).toBeNull();

    // Vlasnik sme da menja unos, ali ne i ključ idempotencije.
    const changed = await client(owner.token)
      .from("entries")
      .update({ request_id: randomUUID(), note: "ispravljeno" })
      .eq("id", created.data as string)
      .select("request_id, note")
      .single();
    expect(changed.error).toBeNull();
    expect(changed.data?.note).toBe("ispravljeno");
    expect(changed.data?.request_id).toBe(request);

    // Ključ i dalje vraća isti unos.
    const retry = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_occurred_on: "2027-08-08", p_day_of_month: 8 }),
    );
    expect(retry.data).toBe(created.data);
  });
});

// ----------------------------------------------------------------
// Rollback: pad druge polovine ne sme da ostavi pravilo
// ----------------------------------------------------------------

describe("pad unosa poništava i pravilo", () => {
  it("unos bez datuma pada, a pravilo ne ostaje", async () => {
    const before = await counts(householdId);

    // `recurring_rules` nema `occurred_on`, pa prvi upis prolazi; drugi pada na
    // `not null`. Tačno oblik koji bi, bez transakcije, ostavio siroče.
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_occurred_on: null }),
    );
    expect(failed.error).not.toBeNull();

    const after = await counts(householdId);
    expect(after).toEqual(before);
  });

  it("pravilo ne može dobiti drugi unos u istom mesecu", async () => {
    const created = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_occurred_on: "2027-01-10", p_day_of_month: 10 }),
    );
    expect(created.error).toBeNull();

    const first = await adminClient()
      .from("entries")
      .select("recurring_rule_id")
      .eq("id", created.data as string)
      .single();

    const duplicate = await client(member.token)
      .from("entries")
      .insert({
        household_id: householdId,
        kind: "expense",
        amount_minor: 1000,
        category_id: food,
        person_id: member.id,
        occurred_on: "2027-01-20",
        recurring_rule_id: first.data!.recurring_rule_id,
      });
    expect(duplicate.error).not.toBeNull();
    expect(duplicate.error?.message).toMatch(/entries_one_rule_per_month/);
  });

  it("arhivirana kategorija odbija poziv i ne ostavlja pravilo", async () => {
    const admin = adminClient();
    const archived = await admin
      .from("categories")
      .insert({ household_id: householdId, name: `Staro-${runStamp}`, kind: "expense", archived: true })
      .select("id")
      .single();
    expect(archived.error).toBeNull();

    const before = await counts(householdId);
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_category_id: archived.data!.id }),
    );
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Arhivirana kategorija/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("kategorija pogrešne vrste odbija poziv i ne ostavlja pravilo", async () => {
    const before = await counts(householdId);
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_kind: "expense", p_category_id: salary }),
    );
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Vrsta kategorije/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("kategorija iz drugog domaćinstva odbija poziv i ne ostavlja pravilo", async () => {
    const foreign = await categoryId(outsider.token, otherHouseholdId, "Hrana", "expense");
    const before = await counts(householdId);
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_category_id: foreign }),
    );
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Kategorija ne pripada/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("osoba koja nije član odbija poziv i ne ostavlja pravilo", async () => {
    const before = await counts(householdId);
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_person_id: outsider.id }),
    );
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Osoba nije član/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("podsetnik van 1–7 i dan van 1–31 padaju na ograničenjima, bez ostatka", async () => {
    const before = await counts(householdId);

    for (const bad of [args({ p_remind_days: 0 }), args({ p_remind_days: 8 }), args({ p_day_of_month: 0 }), args({ p_day_of_month: 32 })]) {
      const failed = await client(member.token).rpc("create_entry_with_rule", bad);
      expect(failed.error).not.toBeNull();
    }

    expect(await counts(householdId)).toEqual(before);
  });

  it("nepozitivan iznos pada, bez ostatka", async () => {
    const before = await counts(householdId);
    const failed = await client(member.token).rpc("create_entry_with_rule", args({ p_amount_minor: 0 }));
    expect(failed.error).not.toBeNull();
    expect(await counts(householdId)).toEqual(before);
  });

  it("pad ne troši identifikator — isti zahtev posle ispravke prolazi", async () => {
    const request = randomUUID();
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_remind_days: 9 }),
    );
    expect(failed.error).not.toBeNull();

    const fixed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_request_id: request, p_remind_days: 2, p_occurred_on: "2027-09-04", p_day_of_month: 4 }),
    );
    expect(fixed.error).toBeNull();
    expect(fixed.data).toBeTruthy();
  });
});

// ----------------------------------------------------------------
// Zašto RPC uopšte postoji
// ----------------------------------------------------------------

describe("bez RPC-a nastaje siroče", () => {
  it("dva odvojena poziva ostavljaju pravilo koje član ne može da skloni", async () => {
    const memberApi = client(member.token);

    // Korak 1 iz uzorka: pravilo.
    const rule = await memberApi
      .from("recurring_rules")
      .insert({
        household_id: householdId,
        kind: "expense",
        amount_minor: 4200,
        category_id: food,
        person_id: member.id,
        note: `siroče-${runStamp}`,
        day_of_month: 12,
        remind_days: 2,
      })
      .select("id")
      .single();
    expect(rule.error).toBeNull();

    // Korak 2 iz uzorka pada — ovde zbog nedostajućeg datuma, u životu zbog mreže.
    const entry = await memberApi.from("entries").insert({
      household_id: householdId,
      kind: "expense",
      amount_minor: 4200,
      category_id: food,
      person_id: member.id,
      occurred_on: null,
      recurring_rule_id: rule.data!.id,
    });
    expect(entry.error).not.toBeNull();

    // Pravilo je ostalo i aktivno je: mesečni posao bi od 12. pravio unose.
    const orphan = await memberApi
      .from("recurring_rules")
      .select("id, active")
      .eq("id", rule.data!.id)
      .single();
    expect(orphan.error).toBeNull();
    expect(orphan.data?.active).toBe(true);

    // Član ga ne može ni obrisati (politika traži vlasnika)…
    const deleted = await memberApi.from("recurring_rules").delete().eq("id", rule.data!.id);
    expect(deleted.error).toBeNull();
    const stillThere = await memberApi
      .from("recurring_rules")
      .select("id")
      .eq("id", rule.data!.id)
      .maybeSingle();
    expect(stillThere.data?.id).toBe(rule.data!.id);

    // …ni ugasiti.
    const turnedOff = await memberApi
      .from("recurring_rules")
      .update({ active: false })
      .eq("id", rule.data!.id)
      .select("id");
    expect(turnedOff.data ?? []).toEqual([]);
    const stillActive = await memberApi
      .from("recurring_rules")
      .select("active")
      .eq("id", rule.data!.id)
      .single();
    expect(stillActive.data?.active).toBe(true);
  });
});

// ----------------------------------------------------------------
// Granica poziva
// ----------------------------------------------------------------

describe("ko sme da zove", () => {
  it("nečlan ne može u tuđe domaćinstvo", async () => {
    const before = await counts(householdId);
    const failed = await client(outsider.token).rpc("create_entry_with_rule", args());
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Niste član domaćinstva/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("član ne može da upiše u domaćinstvo čiji nije član", async () => {
    const before = await counts(otherHouseholdId);
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_household_id: otherHouseholdId }),
    );
    expect(failed.error).not.toBeNull();
    expect(failed.error?.message).toMatch(/Niste član domaćinstva/);
    expect(await counts(otherHouseholdId)).toEqual(before);
  });

  it("nepostojeće domaćinstvo se ne razlikuje od tuđeg", async () => {
    const failed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_household_id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(failed.error?.message).toMatch(/Niste član domaćinstva/);
  });
});

// ----------------------------------------------------------------
// Privilegije: execute ima samo authenticated
// ----------------------------------------------------------------

describe("privilegije funkcije", () => {
  it("anon dobija 42501, pre ijedne provere u telu", async () => {
    const before = await counts(householdId);
    const denied = await client().rpc("create_entry_with_rule", args());

    expect(denied.error).not.toBeNull();
    expect(denied.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(denied.error?.message).toMatch(/permission denied for function create_entry_with_rule/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("service_role dobija 42501 — funkcija je samo za aplikaciju", async () => {
    const before = await counts(householdId);
    const denied = await adminClient().rpc("create_entry_with_rule", args());

    expect(denied.error).not.toBeNull();
    expect(denied.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(denied.error?.message).toMatch(/permission denied for function create_entry_with_rule/);
    expect(await counts(householdId)).toEqual(before);
  });

  it("prijavljen član prolazi, pa odbijanje iznad nije posledica slomljene funkcije", async () => {
    const before = await counts(householdId);
    const allowed = await client(member.token).rpc(
      "create_entry_with_rule",
      args({ p_occurred_on: "2027-10-21", p_day_of_month: 21 }),
    );

    expect(allowed.error).toBeNull();
    expect(allowed.data).toBeTruthy();

    const after = await counts(householdId);
    expect(after.rules).toBe(before.rules + 1);
    expect(after.entries).toBe(before.entries + 1);
  });

  it("stari potpis bez identifikatora zahteva više ne postoji", async () => {
    const { p_request_id: _ignored, ...withoutRequestId } = args();
    const missing = await client(member.token).rpc(
      "create_entry_with_rule",
      withoutRequestId as unknown as RuleArgs,
    );

    expect(missing.error).not.toBeNull();
    expect(missing.error?.message).toMatch(/function|schema cache/i);
  });
});
