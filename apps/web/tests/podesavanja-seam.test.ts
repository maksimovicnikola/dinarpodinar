/**
 * Šav podešavanja vlasnika: strana → server akcija → RLS → baza.
 *
 * Ovo NIJE jedinični test i namerno nije u `pnpm --filter web test`. Traži
 * pokrenut lokalni Supabase i izgrađenu aplikaciju, pa ide zasebnim skriptom:
 *
 *   supabase start && supabase db reset
 *   pnpm --filter web build
 *   pnpm test:seam
 *
 * Šta pokriva, i zašto jedinični testovi to ne mogu:
 *   - članu se strana iscrtava bez ijedne forme, a nečlan ne dobija ni potvrdu
 *     da domaćinstvo postoji;
 *   - svaka akcija pozvana direktno (bez ijednog dugmeta) odbija člana i
 *     nečlana, i ništa ne menja u bazi;
 *   - vlasnik napravi, preimenuje, ograniči, arhivira, pozove, povuče, ukloni
 *     i izmeni ponavljanje — i svaka od tih izmena pogodi tačno jedan red
 *     tačno jednog domaćinstva;
 *   - vlasnik **drugog** domaćinstva ne može da pogodi tuđi red ni kad zna
 *     njegov `id`;
 *   - prazan limit upisuje `null`, ne nulu.
 *
 * Akcije se uvoze direktno i pozivaju sa kolačićima pravog korisnika: `cookies()`
 * je zamenjen tegljom ovog testa, pa `createWritableServerSupabase` dobije baš
 * onu sesiju koju bi dobio iz pregledača. Zahtev tako prolazi kroz isti kod i
 * iste RLS politike kao u aplikaciji.
 *
 * Priprema i čišćenje su određeni: svi redovi nose `runStamp` ovog rana i brišu
 * se u `afterAll`, pa ponovljeno pokretanje daje isti rezultat.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CATEGORY_GONE,
  INVITATION_GONE,
  LIMIT_EXPENSE_ONLY,
  MEMBER_GONE,
  OWNER_ONLY,
  OWNER_STAYS,
  RULE_GONE,
  type SettingsState,
} from "@/lib/settings";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "lozinka-test-123";

// Akcije čitaju okolinu tek pri pozivu, ali se postavlja odmah: `next start`
// je čita iz `.env.local`, a ovaj proces iz `supabase status`.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= anon;

type Jar = Map<string, string>;

/** Korisnik u čije ime se akcija izvršava. Postavlja ga `asUser`. */
let acting: Jar = new Map();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...acting.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      acting.set(name, value);
    },
  }),
}));

// `revalidatePath` traži Next-ov kontekst zahteva; ovde se samo broji da je
// pozvan, jer ono što se proverava je stanje baze.
const revalidated: string[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const {
  archiveCategoryAction,
  createCategoryAction,
  inviteMemberAction,
  removeMemberAction,
  renameCategoryAction,
  revokeInvitationAction,
  saveLimitAction,
  saveRuleAction,
} = await import("@/app/h/[householdId]/podesavanja/actions");

const runStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: string[] = [];
const createdHouseholdIds: string[] = [];

type TestUser = { id: string; email: string; token: string; cookie: string; jar: Jar };

let server: ChildProcess | null = null;
let base = "";
let ana: TestUser;
let marko: TestUser;
let spolja: TestUser;
let boban: TestUser;
/** Član koji postoji samo da bi bio uklonjen; Marko mora da ostane za stranu. */
let privremeni: TestUser;

let domA = "";
let domB = "";

function adminClient(): SupabaseClient {
  return createClient(url, service, { auth: { persistSession: false } });
}

function api(token?: string): SupabaseClient {
  return createClient(url, anon, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Slobodan port — dva paralelna rana se ne sudaraju. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("port se ne čita")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(target: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`next start je izašao sa kodom ${server.exitCode} pre nego što je odgovorio`);
    }
    try {
      const response = await fetch(`${target}/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // još se diže
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`next start nije odgovorio na ${target} u ${timeoutMs}ms`);
}

async function signUp(prefix: string, displayName: string): Promise<TestUser> {
  const email = `${prefix}-${runStamp}@example.com`;
  const created = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id;
  createdUserIds.push(id);

  // Kolačiće pravi sam `@supabase/ssr`, da format bude tačno onaj koji
  // aplikacija čita — ručno sastavljen kolačić bi testirao pogrešnu stvar.
  const jar: Jar = new Map();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((cookie) => jar.set(cookie.name, cookie.value)),
    },
  });
  const signed = await supabase.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("nema sesije");

  const cookie = [...jar.entries()]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");

  return { id, email, cookie, jar, token: signed.data.session.access_token };
}

/** Pozovi akciju u ime datog korisnika, tačno kao da je kliknuo dugme. */
async function asUser<T>(user: TestUser, run: () => Promise<T>): Promise<T> {
  const previous = acting;
  acting = user.jar;
  try {
    return await run();
  } finally {
    acting = previous;
  }
}

const EMPTY: SettingsState = { ok: false, message: null, token: null, stamp: "" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const body = await response.text();
  return {
    status: response.status,
    location: response.headers.get("location"),
    body,
    // Next ponovi isti tekst u RSC teretu (`self.__next_f`); provere nad
    // vidljivim sadržajem zato gledaju markup bez `<script>` blokova.
    markup: body.replace(/<script[\s\S]*?<\/script>/g, ""),
  };
}

// ----------------------------------------------------------------
// Pomoćnici nad bazom (service-role: priprema i provera, ne put aplikacije)
// ----------------------------------------------------------------

type CategoryRow = {
  id: string;
  name: string;
  kind: string;
  limit_minor: number | null;
  archived: boolean;
};

async function seedCategory(
  householdId: string,
  name: string,
  kind: "expense" | "income" = "expense",
  extra: Partial<CategoryRow> = {},
): Promise<string> {
  const created = await adminClient()
    .from("categories")
    .insert({ household_id: householdId, name, kind, ...extra })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data!.id as string;
}

async function readCategory(id: string): Promise<CategoryRow> {
  const found = await adminClient()
    .from("categories")
    .select("id, name, kind, limit_minor, archived")
    .eq("id", id)
    .single();
  if (found.error) throw found.error;
  return found.data as CategoryRow;
}

type RuleRow = {
  id: string;
  amount_minor: number;
  day_of_month: number;
  remind_days: number;
  active: boolean;
};

async function seedRule(
  householdId: string,
  categoryId: string,
  personId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const created = await adminClient()
    .from("recurring_rules")
    .insert({
      household_id: householdId,
      kind: "expense",
      amount_minor: 100000,
      category_id: categoryId,
      person_id: personId,
      note: `pravilo-${runStamp}`,
      day_of_month: 5,
      remind_days: 1,
      active: true,
      ...overrides,
    })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data!.id as string;
}

async function readRule(id: string): Promise<RuleRow> {
  const found = await adminClient()
    .from("recurring_rules")
    .select("id, amount_minor, day_of_month, remind_days, active")
    .eq("id", id)
    .single();
  if (found.error) throw found.error;
  return found.data as RuleRow;
}

async function countCategories(householdId: string, name: string): Promise<number> {
  const found = await adminClient()
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("name", name);
  if (found.error) throw found.error;
  return found.count ?? 0;
}

async function invitationsOf(householdId: string) {
  const found = await adminClient()
    .from("invitations")
    .select("id, email, token, expires_at, used_at")
    .eq("household_id", householdId);
  if (found.error) throw found.error;
  return found.data ?? [];
}

async function isMember(householdId: string, userId: string): Promise<boolean> {
  const found = await adminClient()
    .from("memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("user_id", userId);
  if (found.error) throw found.error;
  return (found.count ?? 0) > 0;
}

async function joinHousehold(owner: TestUser, guest: TestUser, householdId: string): Promise<void> {
  const invite = await api(owner.token)
    .from("invitations")
    .insert({ household_id: householdId, email: guest.email })
    .select("token")
    .single();
  if (invite.error) throw invite.error;

  const accepted = await api(guest.token).rpc("accept_invitation", { p_token: invite.data!.token });
  if (accepted.error) throw accepted.error;
}

beforeAll(async () => {
  if (!anon || !service) {
    throw new Error(
      "Nedostaju SUPABASE_ANON_KEY i SUPABASE_SERVICE_ROLE_KEY. Pokreni kroz `pnpm test:seam` sa `supabase status -o env`.",
    );
  }

  const build = join(APP_ROOT, ".next", "BUILD_ID");
  if (!existsSync(build)) {
    throw new Error("Nema .next izgradnje. Pokreni `pnpm --filter web build` pre `pnpm test:seam`.");
  }

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
    cwd: APP_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.trim()) console.error(`[next] ${text.trimEnd()}`);
  });
  await waitForServer(base);

  ana = await signUp("pod-vlasnik", "Ana");
  marko = await signUp("pod-clan", "Marko");
  spolja = await signUp("pod-spolja", "Spolja");
  boban = await signUp("pod-vlasnik-b", "Boban");
  privremeni = await signUp("pod-privremeni", "Privremeni");

  const a = await api(ana.token).rpc("create_household", {
    p_name: `Naša kuća ${runStamp}`,
    p_currency: "RSD",
  });
  if (a.error) throw a.error;
  domA = a.data as string;
  createdHouseholdIds.push(domA);

  const b = await api(boban.token).rpc("create_household", {
    p_name: `Tuđa kuća ${runStamp}`,
    p_currency: "RSD",
  });
  if (b.error) throw b.error;
  domB = b.data as string;
  createdHouseholdIds.push(domB);

  await joinHousehold(ana, marko, domA);
  await joinHousehold(ana, privremeni, domA);
}, 180_000);

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

  server?.kill("SIGTERM");
}, 60_000);

// ----------------------------------------------------------------
// Strana: ko šta vidi
// ----------------------------------------------------------------

describe("strana podešavanja", () => {
  it("neprijavljen posetilac ide na prijavu i strana pamti odakle je došao", async () => {
    const page = await get(`/h/${domA}/podesavanja`);

    expect([302, 307]).toContain(page.status);
    expect(page.location).toContain("/login");
    expect(page.location).toContain(encodeURIComponent(`/h/${domA}/podesavanja`));
  });

  it("vlasnik dobija sve forme", async () => {
    const page = await get(`/h/${domA}/podesavanja`, ana.cookie);

    expect(page.status).toBe(200);
    expect(page.markup).toContain(`Naša kuća ${runStamp}`);
    for (const label of [
      "Dodaj kategoriju",
      "Sačuvaj naziv",
      "Sačuvaj limit",
      "Arhiviraj",
      "Napravi pozivnicu",
      "Ukloni",
    ]) {
      expect(page.markup, label).toContain(label);
    }
  });

  it("član ne vidi nijednu formu, samo ko vodi podešavanja", async () => {
    const page = await get(`/h/${domA}/podesavanja`, marko.cookie);

    expect(page.status).toBe(200);
    expect(page.markup).toContain("Podešavanja vodi vlasnik domaćinstva.");
    expect(page.markup).not.toContain("<form");
    expect(page.markup).not.toContain("<input");
    for (const label of [
      "Dodaj kategoriju",
      "Sačuvaj naziv",
      "Sačuvaj limit",
      "Arhiviraj",
      "Napravi pozivnicu",
    ]) {
      expect(page.markup, label).not.toContain(label);
    }
  });

  it("član ne vidi nijednu pozivnicu ni token", async () => {
    const invites = await invitationsOf(domA);
    expect(invites.length).toBeGreaterThan(0);

    const page = await get(`/h/${domA}/podesavanja`, marko.cookie);
    for (const invite of invites) {
      expect(page.body, invite.token).not.toContain(invite.token as string);
    }
  });

  it("nečlan ne dobija ni potvrdu da domaćinstvo postoji", async () => {
    const page = await get(`/h/${domA}/podesavanja`, spolja.cookie);

    expect(page.markup).toContain("Domaćinstvo nije dostupno");
    expect(page.markup).not.toContain("Dodaj kategoriju");
  });

  it("vlasnik tuđeg domaćinstva ovde nije vlasnik", async () => {
    const page = await get(`/h/${domA}/podesavanja`, boban.cookie);

    expect(page.markup).toContain("Domaćinstvo nije dostupno");
    expect(page.markup).not.toContain("Dodaj kategoriju");
  });

  it("neispravan uuid se zaustavlja pre baze", async () => {
    const page = await get("/h/nije-uuid/podesavanja", ana.cookie);
    expect(page.markup).toContain("Adresa nije ispravna");
  });

  it("strana se iscrtala bez ijednog zastoja", async () => {
    const page = await get(`/h/${domA}/podesavanja`, ana.cookie);

    expect(page.markup).not.toContain("Zastoj");
    expect(page.markup).not.toContain("Podešavanja se ne otvaraju");
  });
});

// ----------------------------------------------------------------
// Član i nečlan: svaka akcija odbijena, baza netaknuta
// ----------------------------------------------------------------

describe("član ne menja podešavanja ni direktnim pozivom", () => {
  let hrana = "";
  let pravilo = "";
  let pozivnica = "";

  beforeAll(async () => {
    hrana = await seedCategory(domA, `Zabrana ${runStamp}`, "expense", { limit_minor: 500000 });
    pravilo = await seedRule(domA, hrana, ana.id);

    const invite = await api(ana.token)
      .from("invitations")
      .insert({ household_id: domA, email: `zabrana-${runStamp}@example.com` })
      .select("id")
      .single();
    if (invite.error) throw invite.error;
    pozivnica = invite.data!.id as string;
  }, 60_000);

  it("ne pravi kategoriju", async () => {
    const name = `Člansko ${runStamp}`;
    const state = await asUser(marko, () =>
      createCategoryAction(EMPTY, form({ dom: domA, naziv: name, vrsta: "expense" })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect(await countCategories(domA, name)).toBe(0);
  });

  it("ne preimenuje kategoriju", async () => {
    const state = await asUser(marko, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: hrana, naziv: "Preoteto" })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect((await readCategory(hrana)).name).toBe(`Zabrana ${runStamp}`);
  });

  it("ne menja limit", async () => {
    const state = await asUser(marko, () =>
      saveLimitAction(EMPTY, form({ dom: domA, kategorija: hrana, limit: "1" })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect((await readCategory(hrana)).limit_minor).toBe(500000);
  });

  it("ne arhivira kategoriju", async () => {
    const state = await asUser(marko, () =>
      archiveCategoryAction(EMPTY, form({ dom: domA, kategorija: hrana })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect((await readCategory(hrana)).archived).toBe(false);
  });

  it("ne pravi pozivnicu", async () => {
    const before = (await invitationsOf(domA)).length;
    const state = await asUser(marko, () =>
      inviteMemberAction(EMPTY, form({ dom: domA, posta: `clan-${runStamp}@example.com` })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY, token: null });
    expect((await invitationsOf(domA)).length).toBe(before);
  });

  it("ne povlači tuđu pozivnicu", async () => {
    const state = await asUser(marko, () =>
      revokeInvitationAction(EMPTY, form({ dom: domA, pozivnica })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect((await invitationsOf(domA)).some((row) => row.id === pozivnica)).toBe(true);
  });

  it("ne uklanja člana", async () => {
    const state = await asUser(marko, () =>
      removeMemberAction(EMPTY, form({ dom: domA, clan: privremeni.id })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect(await isMember(domA, privremeni.id)).toBe(true);
  });

  it("ne menja ponavljanje", async () => {
    const state = await asUser(marko, () =>
      saveRuleAction(
        EMPTY,
        form({ dom: domA, pravilo, iznos: "9.999", dan: "28", podsetnik: "7", aktivno: "da" }),
      ),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect(await readRule(pravilo)).toMatchObject({ amount_minor: 100000, day_of_month: 5 });
  });

  it("nečlan dobija istu poruku kao član — iz nje se ne vidi da domaćinstvo postoji", async () => {
    const asOutsider = await asUser(spolja, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: hrana, naziv: "Spolja" })),
    );
    const asGhost = await asUser(spolja, () =>
      renameCategoryAction(
        EMPTY,
        form({
          dom: "00000000-0000-0000-0000-000000000000",
          kategorija: hrana,
          naziv: "Spolja",
        }),
      ),
    );

    expect(asOutsider.message).toBe(OWNER_ONLY);
    expect(asGhost.message).toBe(OWNER_ONLY);
    expect((await readCategory(hrana)).name).toBe(`Zabrana ${runStamp}`);
  });
});

// ----------------------------------------------------------------
// Vlasnik: svaki put radi i pogađa tačno jedan red
// ----------------------------------------------------------------

describe("vlasnik vodi kategorije", () => {
  it("pravi kategoriju troška i kategoriju prihoda, i to samo u svom domaćinstvu", async () => {
    const trosak = `Vrtić ${runStamp}`;
    const prihod = `Honorar ${runStamp}`;

    const first = await asUser(ana, () =>
      createCategoryAction(EMPTY, form({ dom: domA, naziv: trosak, vrsta: "expense" })),
    );
    const second = await asUser(ana, () =>
      createCategoryAction(EMPTY, form({ dom: domA, naziv: prihod, vrsta: "income" })),
    );

    expect(first.ok, first.message ?? "").toBe(true);
    expect(second.ok, second.message ?? "").toBe(true);
    expect(await countCategories(domA, trosak)).toBe(1);
    expect(await countCategories(domA, prihod)).toBe(1);
    expect(await countCategories(domB, trosak)).toBe(0);
    expect(await countCategories(domB, prihod)).toBe(0);
  });

  it("odbija prazan naziv i izmišljenu vrstu pre nego što pita bazu", async () => {
    const prazno = await asUser(ana, () =>
      createCategoryAction(EMPTY, form({ dom: domA, naziv: "   ", vrsta: "expense" })),
    );
    const izmisljeno = await asUser(ana, () =>
      createCategoryAction(EMPTY, form({ dom: domA, naziv: `X ${runStamp}`, vrsta: "oboje" })),
    );

    expect(prazno).toMatchObject({ ok: false });
    expect(prazno.message).toContain("naziv");
    expect(izmisljeno).toMatchObject({ ok: false });
    expect(await countCategories(domA, `X ${runStamp}`)).toBe(0);
  });

  it("preimenuje svoju kategoriju, a istoimena u drugom domaćinstvu ostaje", async () => {
    const ime = `Deljeno ime ${runStamp}`;
    const mine = await seedCategory(domA, ime);
    const theirs = await seedCategory(domB, ime);

    const state = await asUser(ana, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: mine, naziv: `Novo ${runStamp}` })),
    );

    expect(state.ok, state.message ?? "").toBe(true);
    expect((await readCategory(mine)).name).toBe(`Novo ${runStamp}`);
    expect((await readCategory(theirs)).name).toBe(ime);
  });

  it("odbija zauzet naziv rečenicom, ne greškom ograničenja", async () => {
    const zauzet = `Zauzeto ${runStamp}`;
    await seedCategory(domA, zauzet);
    const drugi = await seedCategory(domA, `Drugi ${runStamp}`);

    const state = await asUser(ana, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: drugi, naziv: zauzet })),
    );

    expect(state.ok).toBe(false);
    expect(state.message).toContain("već postoji");
    expect((await readCategory(drugi)).name).toBe(`Drugi ${runStamp}`);
  });

  it("postavlja limit, pa ga praznim poljem uklanja u `null`, nikad u nulu", async () => {
    const category = await seedCategory(domA, `Limit ${runStamp}`);

    const set = await asUser(ana, () =>
      saveLimitAction(EMPTY, form({ dom: domA, kategorija: category, limit: "25.000" })),
    );
    expect(set.ok, set.message ?? "").toBe(true);
    expect((await readCategory(category)).limit_minor).toBe(2500000);

    const cleared = await asUser(ana, () =>
      saveLimitAction(EMPTY, form({ dom: domA, kategorija: category, limit: "   " })),
    );
    expect(cleared.ok, cleared.message ?? "").toBe(true);

    const after = await readCategory(category);
    expect(after.limit_minor).toBeNull();
    expect(after.limit_minor).not.toBe(0);
  });

  it("odbija nulu i negativan limit, i ostavlja stari", async () => {
    const category = await seedCategory(domA, `Nula ${runStamp}`, "expense", {
      limit_minor: 100000,
    });

    for (const raw of ["0", "-1", "abc"]) {
      const state = await asUser(ana, () =>
        saveLimitAction(EMPTY, form({ dom: domA, kategorija: category, limit: raw })),
      );
      expect(state.ok, raw).toBe(false);
    }

    expect((await readCategory(category)).limit_minor).toBe(100000);
  });

  it("limit na prihodu dobija rečenicu, ne grešku ograničenja", async () => {
    const category = await seedCategory(domA, `Prihod ${runStamp}`, "income");

    const state = await asUser(ana, () =>
      saveLimitAction(EMPTY, form({ dom: domA, kategorija: category, limit: "10.000" })),
    );

    expect(state).toMatchObject({ ok: false, message: LIMIT_EXPENSE_ONLY });
    expect((await readCategory(category)).limit_minor).toBeNull();
  });

  it("arhivira kategoriju i time gasi njena ponavljanja", async () => {
    const category = await seedCategory(domA, `Za arhivu ${runStamp}`);
    const rule = await seedRule(domA, category, ana.id);

    const state = await asUser(ana, () =>
      archiveCategoryAction(EMPTY, form({ dom: domA, kategorija: category })),
    );

    expect(state.ok, state.message ?? "").toBe(true);
    expect((await readCategory(category)).archived).toBe(true);
    expect((await readRule(rule)).active).toBe(false);
  });
});

describe("vlasnik vodi pozivnice", () => {
  it("pravi pozivnicu i dobija upotrebljiv token za link", async () => {
    const email = `pozvan-${runStamp}@example.com`;

    const state = await asUser(ana, () => inviteMemberAction(EMPTY, form({ dom: domA, posta: email })));

    expect(state.ok, state.message ?? "").toBe(true);
    expect(state.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const rows = await invitationsOf(domA);
    const saved = rows.find((row) => row.token === state.token);
    expect(saved?.email).toBe(email);
    expect(saved?.used_at).toBeNull();

    // Rok postavlja baza: sedam dana, ni dan više.
    const left = Date.parse(saved!.expires_at as string) - Date.now();
    expect(left).toBeGreaterThan(6 * 86_400_000);
    expect(left).toBeLessThanOrEqual(7 * 86_400_000);

    // Pozivnica ne sme da završi u drugom domaćinstvu.
    expect((await invitationsOf(domB)).some((row) => row.email === email)).toBe(false);
  });

  it("link iz tokena otvara već napisan tok prihvatanja", async () => {
    const state = await asUser(ana, () =>
      inviteMemberAction(EMPTY, form({ dom: domA, posta: `link-${runStamp}@example.com` })),
    );
    expect(state.token).not.toBeNull();

    // Isti link koji vlasnik prekopira; prijavljeni gost dobija dugme za prihvatanje.
    const page = await get(`/poziv/${state.token}`, spolja.cookie);

    expect(page.status).toBe(200);
    expect(page.markup).toContain("Prihvati pozivnicu");
  });

  it("odbija adresu koja nije e-pošta", async () => {
    const before = (await invitationsOf(domA)).length;

    const state = await asUser(ana, () =>
      inviteMemberAction(EMPTY, form({ dom: domA, posta: "nije-posta" })),
    );

    expect(state.ok).toBe(false);
    expect(state.token).toBeNull();
    expect((await invitationsOf(domA)).length).toBe(before);
  });

  it("povlači svoju pozivnicu", async () => {
    const created = await asUser(ana, () =>
      inviteMemberAction(EMPTY, form({ dom: domA, posta: `povuci-${runStamp}@example.com` })),
    );
    const row = (await invitationsOf(domA)).find((item) => item.token === created.token);
    expect(row).toBeTruthy();

    const state = await asUser(ana, () =>
      revokeInvitationAction(EMPTY, form({ dom: domA, pozivnica: row!.id as string })),
    );

    expect(state.ok, state.message ?? "").toBe(true);
    expect((await invitationsOf(domA)).some((item) => item.id === row!.id)).toBe(false);
  });
});

describe("vlasnik vodi članove", () => {
  it("ne uklanja samog sebe", async () => {
    const state = await asUser(ana, () => removeMemberAction(EMPTY, form({ dom: domA, clan: ana.id })));

    expect(state).toMatchObject({ ok: false, message: OWNER_STAYS });
    expect(await isMember(domA, ana.id)).toBe(true);
  });

  it("ne uklanja osobu koja nije član", async () => {
    const state = await asUser(ana, () =>
      removeMemberAction(EMPTY, form({ dom: domA, clan: spolja.id })),
    );

    expect(state).toMatchObject({ ok: false, message: MEMBER_GONE });
  });

  it("uklanja člana i gasi njegova ponavljanja, a tuđe domaćinstvo ne dira", async () => {
    const category = await seedCategory(domA, `Pravilo privremenog ${runStamp}`);
    const rule = await seedRule(domA, category, privremeni.id);

    const state = await asUser(ana, () =>
      removeMemberAction(EMPTY, form({ dom: domA, clan: privremeni.id })),
    );

    expect(state.ok, state.message ?? "").toBe(true);
    expect(await isMember(domA, privremeni.id)).toBe(false);
    expect((await readRule(rule)).active).toBe(false);
    expect(await isMember(domA, marko.id)).toBe(true);
    expect(await isMember(domB, boban.id)).toBe(true);
  });
});

describe("vlasnik vodi ponavljanja", () => {
  it("menja iznos, dan, podsetnik i gasi pravilo", async () => {
    const category = await seedCategory(domA, `Pravilo ${runStamp}`);
    const rule = await seedRule(domA, category, ana.id);

    const saved = await asUser(ana, () =>
      saveRuleAction(
        EMPTY,
        form({ dom: domA, pravilo: rule, iznos: "4.500,50", dan: "28", podsetnik: "6", aktivno: "da" }),
      ),
    );

    expect(saved.ok, saved.message ?? "").toBe(true);
    expect(await readRule(rule)).toMatchObject({
      amount_minor: 450050,
      day_of_month: 28,
      remind_days: 6,
      active: true,
    });

    // Neštiklirano polje se ne šalje — to je gašenje.
    const off = await asUser(ana, () =>
      saveRuleAction(EMPTY, form({ dom: domA, pravilo: rule, iznos: "4.500,50", dan: "28", podsetnik: "6" })),
    );

    expect(off.ok, off.message ?? "").toBe(true);
    expect((await readRule(rule)).active).toBe(false);
  });

  it("odbija dan i podsetnik van granica, i ostavlja staro stanje", async () => {
    const category = await seedCategory(domA, `Granice ${runStamp}`);
    const rule = await seedRule(domA, category, ana.id);

    const cases = [
      { dan: "0", podsetnik: "1" },
      { dan: "32", podsetnik: "1" },
      { dan: "5", podsetnik: "0" },
      { dan: "5", podsetnik: "8" },
    ];

    for (const bad of cases) {
      const state = await asUser(ana, () =>
        saveRuleAction(
          EMPTY,
          form({ dom: domA, pravilo: rule, iznos: "1.000", aktivno: "da", ...bad }),
        ),
      );
      expect(state.ok, JSON.stringify(bad)).toBe(false);
    }

    expect(await readRule(rule)).toMatchObject({
      amount_minor: 100000,
      day_of_month: 5,
      remind_days: 1,
    });
  });

  it("ne uključuje ponavljanje arhivirane kategorije", async () => {
    const category = await seedCategory(domA, `Arhiva pravila ${runStamp}`);
    const rule = await seedRule(domA, category, ana.id, { active: false });
    await adminClient().from("categories").update({ archived: true }).eq("id", category);

    const state = await asUser(ana, () =>
      saveRuleAction(
        EMPTY,
        form({ dom: domA, pravilo: rule, iznos: "1.000", dan: "5", podsetnik: "1", aktivno: "da" }),
      ),
    );

    expect(state.ok).toBe(false);
    expect(state.message).toContain("arhivirana");
    expect((await readRule(rule)).active).toBe(false);
  });
});

// ----------------------------------------------------------------
// Tuđe domaćinstvo: vlasništvo drugde ne daje nikakvo pravo ovde
// ----------------------------------------------------------------

describe("vlasnik drugog domaćinstva ne pogađa tuđi red", () => {
  let kategorijaA = "";
  let praviloA = "";
  let pozivnicaA = "";

  beforeAll(async () => {
    kategorijaA = await seedCategory(domA, `Tuđe ${runStamp}`, "expense", { limit_minor: 700000 });
    praviloA = await seedRule(domA, kategorijaA, ana.id);

    const invite = await api(ana.token)
      .from("invitations")
      .insert({ household_id: domA, email: `tudje-${runStamp}@example.com` })
      .select("id")
      .single();
    if (invite.error) throw invite.error;
    pozivnicaA = invite.data!.id as string;
  }, 60_000);

  it("sa svojim domaćinstvom i tuđim `id`-em menja nula redova", async () => {
    const rename = await asUser(boban, () =>
      renameCategoryAction(EMPTY, form({ dom: domB, kategorija: kategorijaA, naziv: "Preoteto" })),
    );
    const limit = await asUser(boban, () =>
      saveLimitAction(EMPTY, form({ dom: domB, kategorija: kategorijaA, limit: "1" })),
    );
    const archive = await asUser(boban, () =>
      archiveCategoryAction(EMPTY, form({ dom: domB, kategorija: kategorijaA })),
    );

    expect(rename).toMatchObject({ ok: false, message: CATEGORY_GONE });
    expect(limit).toMatchObject({ ok: false, message: CATEGORY_GONE });
    expect(archive).toMatchObject({ ok: false, message: CATEGORY_GONE });

    expect(await readCategory(kategorijaA)).toMatchObject({
      name: `Tuđe ${runStamp}`,
      limit_minor: 700000,
      archived: false,
    });
  });

  it("ne povlači tuđu pozivnicu i ne uklanja tuđeg člana", async () => {
    const revoke = await asUser(boban, () =>
      revokeInvitationAction(EMPTY, form({ dom: domB, pozivnica: pozivnicaA })),
    );
    const remove = await asUser(boban, () =>
      removeMemberAction(EMPTY, form({ dom: domB, clan: marko.id })),
    );

    expect(revoke).toMatchObject({ ok: false, message: INVITATION_GONE });
    expect(remove).toMatchObject({ ok: false, message: MEMBER_GONE });
    expect((await invitationsOf(domA)).some((row) => row.id === pozivnicaA)).toBe(true);
    expect(await isMember(domA, marko.id)).toBe(true);
  });

  it("ne menja tuđe ponavljanje", async () => {
    const state = await asUser(boban, () =>
      saveRuleAction(
        EMPTY,
        form({ dom: domB, pravilo: praviloA, iznos: "1", dan: "1", podsetnik: "1", aktivno: "da" }),
      ),
    );

    expect(state).toMatchObject({ ok: false, message: RULE_GONE });
    expect(await readRule(praviloA)).toMatchObject({ amount_minor: 100000, day_of_month: 5 });
  });

  it("sa tuđim domaćinstvom u polju pada već na ulozi", async () => {
    const state = await asUser(boban, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: kategorijaA, naziv: "Preoteto" })),
    );

    expect(state).toMatchObject({ ok: false, message: OWNER_ONLY });
    expect((await readCategory(kategorijaA)).name).toBe(`Tuđe ${runStamp}`);
  });

  it("neispravna adresa domaćinstva ne stiže ni do baze", async () => {
    const state = await asUser(ana, () =>
      renameCategoryAction(EMPTY, form({ dom: "nije-uuid", kategorija: kategorijaA, naziv: "X" })),
    );

    expect(state.ok).toBe(false);
    expect(state.message).toContain("Adresa");
    expect((await readCategory(kategorijaA)).name).toBe(`Tuđe ${runStamp}`);
  });
});

// ----------------------------------------------------------------
// Dva domaćinstva, jedan vlasnik
//
// Ovo je jedini slučaj u kom RLS ne pomaže. `is_owner(household_id)` gleda
// red koji se menja, pa vlasniku oba domaćinstva propušta i izmenu reda iz
// onog drugog. Jedina zaštita je što akcija sužava i po `household_id` iz
// forme. Bez te klauzule svaki test ispod pada.
// ----------------------------------------------------------------

describe("vlasnik dva domaćinstva ne prenosi prava iz jednog u drugo", () => {
  let dvostruki: TestUser;
  let gost: TestUser;
  let domC = "";
  let domD = "";
  let kategorijaD = "";
  let praviloD = "";
  let pozivnicaD = "";

  beforeAll(async () => {
    dvostruki = await signUp("pod-dva-doma", "Dvostruki");
    gost = await signUp("pod-gost-d", "Gost");

    for (const label of ["C", "D"] as const) {
      const created = await api(dvostruki.token).rpc("create_household", {
        p_name: `Kuća ${label} ${runStamp}`,
        p_currency: "RSD",
      });
      if (created.error) throw created.error;
      const id = created.data as string;
      createdHouseholdIds.push(id);
      if (label === "C") domC = id;
      else domD = id;
    }

    await joinHousehold(dvostruki, gost, domD);

    kategorijaD = await seedCategory(domD, `Samo u D ${runStamp}`, "expense", {
      limit_minor: 300000,
    });
    praviloD = await seedRule(domD, kategorijaD, dvostruki.id);

    const invite = await api(dvostruki.token)
      .from("invitations")
      .insert({ household_id: domD, email: `samo-u-d-${runStamp}@example.com` })
      .select("id")
      .single();
    if (invite.error) throw invite.error;
    pozivnicaD = invite.data!.id as string;
  }, 120_000);

  it("stvarno je vlasnik oba domaćinstva — inače test ništa ne dokazuje", async () => {
    const roles = await adminClient()
      .from("memberships")
      .select("household_id, role")
      .eq("user_id", dvostruki.id)
      .in("household_id", [domC, domD]);

    expect(roles.error).toBeNull();
    expect((roles.data ?? []).map((row) => row.role)).toEqual(["owner", "owner"]);
  });

  it("ne preimenuje kategoriju drugog svog domaćinstva", async () => {
    const state = await asUser(dvostruki, () =>
      renameCategoryAction(EMPTY, form({ dom: domC, kategorija: kategorijaD, naziv: "Preseljeno" })),
    );

    expect(state).toMatchObject({ ok: false, message: CATEGORY_GONE });
    expect((await readCategory(kategorijaD)).name).toBe(`Samo u D ${runStamp}`);
  });

  it("ne menja limit kategorije drugog svog domaćinstva", async () => {
    const state = await asUser(dvostruki, () =>
      saveLimitAction(EMPTY, form({ dom: domC, kategorija: kategorijaD, limit: "1" })),
    );

    expect(state).toMatchObject({ ok: false, message: CATEGORY_GONE });
    expect((await readCategory(kategorijaD)).limit_minor).toBe(300000);
  });

  it("ne arhivira kategoriju drugog svog domaćinstva", async () => {
    const state = await asUser(dvostruki, () =>
      archiveCategoryAction(EMPTY, form({ dom: domC, kategorija: kategorijaD })),
    );

    expect(state).toMatchObject({ ok: false, message: CATEGORY_GONE });
    expect((await readCategory(kategorijaD)).archived).toBe(false);
  });

  it("ne povlači pozivnicu drugog svog domaćinstva", async () => {
    const state = await asUser(dvostruki, () =>
      revokeInvitationAction(EMPTY, form({ dom: domC, pozivnica: pozivnicaD })),
    );

    expect(state).toMatchObject({ ok: false, message: INVITATION_GONE });
    expect((await invitationsOf(domD)).some((row) => row.id === pozivnicaD)).toBe(true);
  });

  it("ne uklanja člana drugog svog domaćinstva", async () => {
    const state = await asUser(dvostruki, () =>
      removeMemberAction(EMPTY, form({ dom: domC, clan: gost.id })),
    );

    expect(state).toMatchObject({ ok: false, message: MEMBER_GONE });
    expect(await isMember(domD, gost.id)).toBe(true);
  });

  it("ne menja ponavljanje drugog svog domaćinstva", async () => {
    const state = await asUser(dvostruki, () =>
      saveRuleAction(
        EMPTY,
        form({ dom: domC, pravilo: praviloD, iznos: "1", dan: "1", podsetnik: "1", aktivno: "da" }),
      ),
    );

    expect(state).toMatchObject({ ok: false, message: RULE_GONE });
    expect(await readRule(praviloD)).toMatchObject({ amount_minor: 100000, day_of_month: 5 });
  });

  it("nova kategorija ide u domaćinstvo iz forme, ne u ono drugo", async () => {
    const name = `Novo u C ${runStamp}`;

    const state = await asUser(dvostruki, () =>
      createCategoryAction(EMPTY, form({ dom: domC, naziv: name, vrsta: "expense" })),
    );

    expect(state.ok, state.message ?? "").toBe(true);
    expect(await countCategories(domC, name)).toBe(1);
    expect(await countCategories(domD, name)).toBe(0);
  });

  it("pozivnica ide u domaćinstvo iz forme, ne u ono drugo", async () => {
    const email = `novi-u-c-${runStamp}@example.com`;

    const state = await asUser(dvostruki, () =>
      inviteMemberAction(EMPTY, form({ dom: domC, posta: email })),
    );

    expect(state.ok, state.message ?? "").toBe(true);
    expect((await invitationsOf(domC)).some((row) => row.email === email)).toBe(true);
    expect((await invitationsOf(domD)).some((row) => row.email === email)).toBe(false);
  });
});

// ----------------------------------------------------------------
// Keš
// ----------------------------------------------------------------

describe("osvežavanje strane", () => {
  it("uspešna izmena osveži i podešavanja i mesečni pregled", async () => {
    revalidated.length = 0;

    const category = await seedCategory(domA, `Keš ${runStamp}`);
    await asUser(ana, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: category, naziv: `Keš 2 ${runStamp}` })),
    );

    expect(revalidated).toContain(`/h/${domA}/podesavanja`);
    expect(revalidated).toContain(`/h/${domA}`);
  });

  it("odbijena izmena ne osvežava ništa", async () => {
    revalidated.length = 0;

    await asUser(marko, () =>
      renameCategoryAction(EMPTY, form({ dom: domA, kategorija: "nije-uuid", naziv: "X" })),
    );

    expect(revalidated).toEqual([]);
  });
});
