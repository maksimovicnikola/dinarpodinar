/**
 * Šav izmene unosa: strana → server akcija → okidači i RLS → baza.
 *
 * Ovo NIJE jedinični test i namerno nije u `pnpm --filter web test`. Traži
 * pokrenut lokalni Supabase i izgrađenu aplikaciju, pa ide zasebnim skriptom:
 *
 *   supabase start && supabase db reset
 *   pnpm --filter web build
 *   pnpm test:seam
 *
 * Šta pokriva, i zašto jedinični testovi to ne mogu:
 *   - vlasnik menja iznos, kategoriju, osobu, datum i belešku, i briše red;
 *   - član i nečlan ne menjaju ništa ni direktnim pozivom akcije, bez ijednog
 *     dugmeta — i baza posle toga stoji netaknuta;
 *   - vlasnik **drugog** domaćinstva ne pogađa tuđi unos ni kad zna njegov
 *     `id`; `is_owner` gleda red koji se menja, pa je jedina zaštita sužavanje
 *     po `household_id` iz forme;
 *   - arhivirana kategorija u kojoj unos stoji ostaje u ponudi, a premeštanje
 *     u arhiviranu se odbija;
 *   - unos bivšeg člana se ne pripisuje nikom drugom kad se menja samo beleška;
 *   - kategorija suprotne vrste se odbija rečenicom, ne greškom okidača;
 *   - posle čuvanja se ide u mesec **novog** datuma, posle brisanja u mesec iz
 *     kog je unos nestao;
 *   - snimci (`person_name`, `created_by`), ključ zahteva (`request_id`), vrsta
 *     i veza sa ponavljanjem prežive izmenu.
 *
 * Akcije se uvoze direktno i pozivaju sa kolačićima pravog korisnika: `cookies()`
 * je zamenjen tegljom ovog testa, pa `createWritableServerSupabase` dobije baš
 * onu sesiju koju bi dobio iz pregledača.
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
  ENTRY_CATEGORY_ARCHIVED,
  ENTRY_DELETE_UNCONFIRMED,
  ENTRY_GONE,
  ENTRY_KIND_MISMATCH,
  ENTRY_OWNER_ONLY,
  ENTRY_PERSON_GONE,
} from "@/lib/entry-edit";
import { CATEGORY_GONE, SESSION_GONE, type SettingsState } from "@/lib/settings";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "lozinka-test-123";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= url;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= anon;

type Jar = Map<string, string>;

/** Korisnik u čije ime se akcija izvršava. Postavlja ga `asUser`. */
let acting: Jar = new Map();

/** Kad je tačno, upis kolačića puca — isto kao pregledač koji ih odbija. */
let cookieWritesFail = false;

/** Broj pokušaja upisa; test njime dokazuje da je upis uopšte bio pokušan. */
let cookieWriteAttempts = 0;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...acting.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      cookieWriteAttempts += 1;
      if (cookieWritesFail) {
        throw new Error("Cookie write refused by the test");
      }
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

const { deleteEntryAction, updateEntryAction } = await import(
  "@/app/h/[householdId]/podesavanja/actions"
);

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
/** Član koji izlazi iz domaćinstva; njegovi unosi ostaju sa snimljenim imenom. */
let odlazeci: TestUser;
let dvostruki: TestUser;

let domA = "";
let domB = "";
let domC = "";
let domD = "";

let hranaA = "";
let racuniA = "";
let plataA = "";
let hranaB = "";
let hranaD = "";

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

/**
 * Učini da sačuvana sesija izgleda istekla, pa `getUser` mora da je osveži i
 * da pri tom upiše nove kolačiće.
 */
function expireSession(jar: Jar): void {
  let patched = 0;

  for (const [name, value] of [...jar.entries()]) {
    if (!value.startsWith("base64-")) {
      continue;
    }

    const session = JSON.parse(
      Buffer.from(value.slice("base64-".length), "base64url").toString("utf8"),
    ) as { expires_at?: number; expires_in?: number };

    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    session.expires_in = 0;

    jar.set(name, `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`);
    patched += 1;
  }

  if (patched === 0) {
    throw new Error("Sesija nije nađena u kolačićima; test ne bi dokazao ništa.");
  }
}

async function withBrokenCookieWrites<T>(run: () => Promise<T>): Promise<T> {
  cookieWritesFail = true;
  try {
    return await run();
  } finally {
    cookieWritesFail = false;
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

/**
 * Ishod akcije nad unosom.
 *
 * Uspeh se završava preusmerenjem, koje Next propušta kao izuzetak sa
 * `digest`-om. Neuspeh je obična vrednost. Oba oblika se vraćaju zajedno, pa
 * test može da tvrdi i gde je vlasnik otišao i šta je pisalo kad nije otišao.
 */
type Outcome = { state: SettingsState | null; digest: string | null };

async function act(user: TestUser, run: () => Promise<SettingsState>): Promise<Outcome> {
  return asUser(user, async () => {
    try {
      return { state: await run(), digest: null };
    } catch (caught) {
      const digest = String((caught as { digest?: unknown }).digest ?? "");
      if (!digest.startsWith("NEXT_REDIRECT")) {
        throw caught;
      }
      return { state: null, digest };
    }
  });
}

function denial(outcome: Outcome): { ok: boolean; message: string | null } {
  if (outcome.state === null) {
    throw new Error(`Akcija je preusmerila (${outcome.digest}) tamo gde se čekalo odbijanje.`);
  }
  return { ok: outcome.state.ok, message: outcome.state.message };
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

type EntryRow = {
  id: string;
  household_id: string;
  kind: string;
  amount_minor: number;
  category_id: string;
  person_id: string;
  person_name: string;
  occurred_on: string;
  month_key: string;
  note: string;
  created_by: string;
  recurring_rule_id: string | null;
  request_id: string | null;
};

const ENTRY_COLUMNS =
  "id, household_id, kind, amount_minor, category_id, person_id, person_name, occurred_on, month_key, note, created_by, recurring_rule_id, request_id";

async function seedEntry(input: {
  householdId: string;
  categoryId: string;
  personId: string;
  createdBy: string;
  occurredOn: string;
  note: string;
  amountMinor?: number;
  kind?: "expense" | "income";
}): Promise<string> {
  const created = await adminClient()
    .from("entries")
    .insert({
      household_id: input.householdId,
      kind: input.kind ?? "expense",
      amount_minor: input.amountMinor ?? 100000,
      category_id: input.categoryId,
      person_id: input.personId,
      // `prepare_entry` upisuje stvarno ime pri INSERT-u; prazno je samo da
      // NOT NULL kolona prođe.
      person_name: "",
      occurred_on: input.occurredOn,
      note: input.note,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data!.id as string;
}

async function readEntry(id: string): Promise<EntryRow | null> {
  const found = await adminClient().from("entries").select(ENTRY_COLUMNS).eq("id", id).maybeSingle();
  if (found.error) throw found.error;
  return (found.data as EntryRow | null) ?? null;
}

async function requireEntry(id: string): Promise<EntryRow> {
  const row = await readEntry(id);
  if (row === null) {
    throw new Error(`Unos ${id} ne postoji, a test računa na njega.`);
  }
  return row;
}

async function categoryId(householdId: string, name: string, kind: "expense" | "income") {
  const found = await adminClient()
    .from("categories")
    .select("id")
    .eq("household_id", householdId)
    .eq("name", name)
    .eq("kind", kind)
    .single();
  if (found.error) throw found.error;
  return found.data!.id as string;
}

async function seedCategory(
  householdId: string,
  name: string,
  kind: "expense" | "income" = "expense",
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await adminClient()
    .from("categories")
    .insert({ household_id: householdId, name, kind, ...extra })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data!.id as string;
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

async function createHousehold(user: TestUser, label: string): Promise<string> {
  const created = await api(user.token).rpc("create_household", {
    p_name: `${label} ${runStamp}`,
    p_currency: "RSD",
  });
  if (created.error) throw created.error;
  const id = created.data as string;
  createdHouseholdIds.push(id);
  return id;
}

/** Datum u mesecu koji nije tekući, da se preusmerenje stvarno vidi. */
function dayIn(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

const MONTH_ONE = "2026-03";
const MONTH_TWO = "2026-04";

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

  ana = await signUp("unos-vlasnik", "Ana");
  marko = await signUp("unos-clan", "Marko");
  spolja = await signUp("unos-spolja", "Spolja");
  boban = await signUp("unos-vlasnik-b", "Boban");
  odlazeci = await signUp("unos-odlazeci", "Odlazeći");
  dvostruki = await signUp("unos-dva-doma", "Dvostruki");

  domA = await createHousehold(ana, "Naša kuća");
  domB = await createHousehold(boban, "Tuđa kuća");
  domC = await createHousehold(dvostruki, "Kuća C");
  domD = await createHousehold(dvostruki, "Kuća D");

  await joinHousehold(ana, marko, domA);
  await joinHousehold(ana, odlazeci, domA);

  hranaA = await categoryId(domA, "Hrana", "expense");
  racuniA = await categoryId(domA, "Računi", "expense");
  plataA = await categoryId(domA, "Plata", "income");
  hranaB = await categoryId(domB, "Hrana", "expense");
  hranaD = await categoryId(domD, "Hrana", "expense");
}, 240_000);

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

describe("strana unosa", () => {
  let entry = "";

  beforeAll(async () => {
    entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: marko.id,
      createdBy: marko.id,
      occurredOn: dayIn(MONTH_ONE, 12),
      note: `strana-${runStamp}`,
      amountMinor: 125050,
    });
  }, 60_000);

  it("neprijavljen posetilac ide na prijavu i strana pamti odakle je došao", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`);

    expect([302, 307]).toContain(page.status);
    expect(page.location).toContain("/login");
    expect(page.location).toContain(encodeURIComponent(`/h/${domA}/unos/${entry}`));
  });

  it("vlasnik dobija formu sa zatečenim vrednostima i oba dugmeta", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.status).toBe(200);
    expect(page.markup).toContain("Izmena unosa");
    expect(page.markup).toContain('value="1250,50"');
    expect(page.markup).toContain(`value="${dayIn(MONTH_ONE, 12)}"`);
    expect(page.markup).toContain(`value="strana-${runStamp}"`);
    expect(page.markup).toContain(">Sačuvaj izmenu</button>");
    expect(page.markup).toContain(">Obriši unos</button>");
    expect(page.markup).toContain("Razumem da se unos briše zauvek");
  });

  it("vrsta se vidi kao tekst, a ne kao polje koje se menja", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.markup).toContain("Vrsta se ne menja.");
    expect(page.markup).not.toContain('name="vrsta"');
  });

  it("nudi aktivne kategorije troška, i nijednu kategoriju prihoda", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.markup).toContain(">Hrana</option>");
    expect(page.markup).toContain(">Računi</option>");
    // „Plata“ je prihod: ni u markup-u, ni u RSC teretu strane.
    expect(page.body).not.toContain(">Plata</option>");
  });

  it("član vidi samo ko menja unos i na koga je zapisan", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, marko.cookie);

    expect(page.status).toBe(200);
    expect(page.markup).toContain("Unos menja vlasnik.");
    expect(page.markup).toContain("Marko");
    expect(page.markup).not.toContain("<form");
    expect(page.markup).not.toContain("<input");
    expect(page.markup).not.toContain("Obriši unos");
    expect(page.markup).not.toContain("Sačuvaj izmenu");
  });

  it("nečlan ne dobija ni potvrdu da domaćinstvo postoji", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, spolja.cookie);

    expect(page.markup).toContain("Domaćinstvo nije dostupno");
    expect(page.body).not.toContain(`strana-${runStamp}`);
  });

  it("vlasnik tuđeg domaćinstva ovde nije vlasnik", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, boban.cookie);

    expect(page.markup).toContain("Domaćinstvo nije dostupno");
    expect(page.body).not.toContain(`strana-${runStamp}`);
  });

  it("unos iz drugog domaćinstva izgleda isto kao nepostojeći", async () => {
    const theirs = await seedEntry({
      householdId: domB,
      categoryId: hranaB,
      personId: boban.id,
      createdBy: boban.id,
      occurredOn: dayIn(MONTH_ONE, 3),
      note: `tudji-${runStamp}`,
    });

    const page = await get(`/h/${domA}/unos/${theirs}`, ana.cookie);

    expect(page.markup).toContain("Unos nije nađen");
    expect(page.body).not.toContain(`tudji-${runStamp}`);
  });

  it("nepostojeći `uuid` unosa daje istu stranu", async () => {
    const page = await get(`/h/${domA}/unos/00000000-0000-0000-0000-000000000000`, ana.cookie);
    expect(page.markup).toContain("Unos nije nađen");
  });

  it("neispravan uuid se zaustavlja pre baze", async () => {
    const bad = await get(`/h/${domA}/unos/nije-uuid`, ana.cookie);
    const badHousehold = await get(`/h/nije-uuid/unos/${entry}`, ana.cookie);

    expect(bad.status).toBe(200);
    expect(bad.markup).toContain("Adresa nije ispravna");
    expect(badHousehold.markup).toContain("Adresa nije ispravna");
  });

  it("strana se iscrtala bez ijednog zastoja", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.markup).not.toContain("Zastoj");
    expect(page.markup).not.toContain("Unos se ne otvara");
  });

  it("mesečni pregled vodi vlasnika na ovu stranu, a članu je ne nudi", async () => {
    const owner = await get(`/h/${domA}?month=${MONTH_ONE}`, ana.cookie);
    const member = await get(`/h/${domA}?month=${MONTH_ONE}`, marko.cookie);

    expect(owner.markup).toContain(`/h/${domA}/unos/${entry}`);
    expect(member.markup).not.toContain(`/h/${domA}/unos/${entry}`);
  });
});

// ----------------------------------------------------------------
// Vlasnik menja
// ----------------------------------------------------------------

describe("vlasnik menja unos", () => {
  it("menja iznos, kategoriju, osobu, datum i belešku, i ide u mesec novog datuma", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 5),
      note: `pre-${runStamp}`,
    });

    revalidated.length = 0;

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "4.500,50",
          kategorija: racuniA,
          osoba: marko.id,
          datum: dayIn(MONTH_TWO, 20),
          beleska: `posle-${runStamp}`,
        }),
      ),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`/h/${domA}?month=${MONTH_TWO}`);

    expect(await requireEntry(entry)).toMatchObject({
      amount_minor: 450050,
      category_id: racuniA,
      person_id: marko.id,
      occurred_on: dayIn(MONTH_TWO, 20),
      month_key: MONTH_TWO,
      note: `posle-${runStamp}`,
      // Osoba je promenjena, pa je `prepare_entry` upisao njen aktuelni snimak.
      person_name: "Marko",
      // Autor unosa nije autor izmene.
      created_by: ana.id,
      kind: "expense",
    });

    expect(revalidated).toContain(`/h/${domA}`);
    expect(revalidated).toContain(`/h/${domA}/unos/${entry}`);
  });

  it("izmena se vidi u mesečnom pregledu novog meseca, a iz starog je nema", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 7),
      note: `seli-${runStamp}`,
    });

    await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: hranaA,
          osoba: ana.id,
          datum: dayIn(MONTH_TWO, 7),
          beleska: `seli-${runStamp}`,
        }),
      ),
    );

    const after = await get(`/h/${domA}?month=${MONTH_TWO}`, ana.cookie);
    const before = await get(`/h/${domA}?month=${MONTH_ONE}`, ana.cookie);

    expect(after.markup).toContain(`seli-${runStamp}`);
    expect(after.markup).toContain("1.000 RSD");
    expect(before.markup).not.toContain(`seli-${runStamp}`);
  });

  it("menja samo belešku, a iznos, kategorija, osoba i datum ostaju", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 9),
      note: "staro",
      amountMinor: 33300,
    });

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "333",
          kategorija: hranaA,
          osoba: ana.id,
          datum: dayIn(MONTH_ONE, 9),
          beleska: `  novo-${runStamp}  `,
        }),
      ),
    );

    expect(outcome.digest).toContain(`month=${MONTH_ONE}`);
    expect(await requireEntry(entry)).toMatchObject({
      amount_minor: 33300,
      category_id: hranaA,
      person_id: ana.id,
      occurred_on: dayIn(MONTH_ONE, 9),
      // Razmaci oko beleške se skidaju pre upisa.
      note: `novo-${runStamp}`,
    });
  });

  it("odbija neispravan iznos i neispravan datum, i ostavlja red netaknut", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 11),
      note: `provere-${runStamp}`,
    });

    const cases = [
      { iznos: "0", datum: dayIn(MONTH_ONE, 11) },
      { iznos: "-5", datum: dayIn(MONTH_ONE, 11) },
      { iznos: "abc", datum: dayIn(MONTH_ONE, 11) },
      { iznos: "1.000", datum: "2026-02-30" },
      { iznos: "1.000", datum: "" },
    ];

    for (const bad of cases) {
      const outcome = await act(ana, () =>
        updateEntryAction(
          EMPTY,
          form({
            dom: domA,
            unos: entry,
            kategorija: hranaA,
            osoba: ana.id,
            beleska: `provere-${runStamp}`,
            ...bad,
          }),
        ),
      );

      expect(denial(outcome).ok, JSON.stringify(bad)).toBe(false);
    }

    expect(await requireEntry(entry)).toMatchObject({
      amount_minor: 100000,
      occurred_on: dayIn(MONTH_ONE, 11),
      note: `provere-${runStamp}`,
    });
  });

  it("odbija kategoriju suprotne vrste rečenicom, ne greškom okidača", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 13),
      note: `vrsta-${runStamp}`,
    });

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: plataA,
          osoba: ana.id,
          datum: dayIn(MONTH_ONE, 13),
          beleska: `vrsta-${runStamp}`,
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_KIND_MISMATCH });
    expect(await requireEntry(entry)).toMatchObject({ category_id: hranaA, kind: "expense" });
  });

  it("odbija kategoriju iz drugog domaćinstva", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 15),
      note: `tudja-kat-${runStamp}`,
    });

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: hranaB,
          osoba: ana.id,
          datum: dayIn(MONTH_ONE, 15),
          beleska: `tudja-kat-${runStamp}`,
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: CATEGORY_GONE });
    expect((await requireEntry(entry)).category_id).toBe(hranaA);
  });
});

// ----------------------------------------------------------------
// Arhivirana kategorija
// ----------------------------------------------------------------

describe("arhivirana kategorija", () => {
  let archived = "";
  let entry = "";

  beforeAll(async () => {
    archived = await seedCategory(domA, `Arhiva unosa ${runStamp}`);
    entry = await seedEntry({
      householdId: domA,
      categoryId: archived,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 17),
      note: `arhiva-${runStamp}`,
    });
    const update = await adminClient()
      .from("categories")
      .update({ archived: true })
      .eq("id", archived);
    if (update.error) throw update.error;
  }, 60_000);

  it("zatečena arhivirana kategorija ostaje u ponudi, označena", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.markup).toContain(`Arhiva unosa ${runStamp} (arhivirana)`);
  });

  it("vlasnik menja belešku bez prekategorizacije", async () => {
    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: archived,
          osoba: ana.id,
          datum: dayIn(MONTH_ONE, 17),
          beleska: `arhiva-popravka-${runStamp}`,
        }),
      ),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`month=${MONTH_ONE}`);
    expect(await requireEntry(entry)).toMatchObject({
      category_id: archived,
      note: `arhiva-popravka-${runStamp}`,
    });
  });

  it("premeštanje u drugu arhiviranu kategoriju se odbija", async () => {
    const other = await seedCategory(domA, `Druga arhiva ${runStamp}`, "expense", {
      archived: true,
    });

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: other,
          osoba: ana.id,
          datum: dayIn(MONTH_ONE, 17),
          beleska: `arhiva-${runStamp}`,
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_CATEGORY_ARCHIVED });
    expect((await requireEntry(entry)).category_id).toBe(archived);
  });

  it("druga arhivirana kategorija nije ni u ponudi strane", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.body).not.toContain(`Druga arhiva ${runStamp}`);
  });
});

// ----------------------------------------------------------------
// Bivši član
// ----------------------------------------------------------------

describe("unos bivšeg člana", () => {
  let entry = "";

  beforeAll(async () => {
    entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: odlazeci.id,
      createdBy: odlazeci.id,
      occurredOn: dayIn(MONTH_ONE, 19),
      note: `bivsi-${runStamp}`,
    });

    const removed = await adminClient()
      .from("memberships")
      .delete()
      .eq("household_id", domA)
      .eq("user_id", odlazeci.id);
    if (removed.error) throw removed.error;
  }, 60_000);

  it("osoba iz unosa ostaje izbor, sa snimljenim imenom i oznakom", async () => {
    const page = await get(`/h/${domA}/unos/${entry}`, ana.cookie);

    expect(page.markup).toContain("Odlazeći (više nije član)");
    expect(page.markup).toContain(`value="${odlazeci.id}"`);
  });

  it("izmena samo beleške ne pripisuje unos nikom drugom", async () => {
    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: hranaA,
          osoba: odlazeci.id,
          datum: dayIn(MONTH_ONE, 19),
          beleska: `bivsi-popravka-${runStamp}`,
        }),
      ),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`month=${MONTH_ONE}`);
    expect(await requireEntry(entry)).toMatchObject({
      person_id: odlazeci.id,
      person_name: "Odlazeći",
      note: `bivsi-popravka-${runStamp}`,
    });
  });

  it("prebacivanje na nekog ko nije član se odbija", async () => {
    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: hranaA,
          osoba: spolja.id,
          datum: dayIn(MONTH_ONE, 19),
          beleska: `bivsi-${runStamp}`,
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_PERSON_GONE });
    expect((await requireEntry(entry)).person_id).toBe(odlazeci.id);
  });

  it("prebacivanje na aktuelnog člana prolazi i nosi njegov snimak", async () => {
    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "1.000",
          kategorija: hranaA,
          osoba: marko.id,
          datum: dayIn(MONTH_ONE, 19),
          beleska: `bivsi-premesten-${runStamp}`,
        }),
      ),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`month=${MONTH_ONE}`);
    expect(await requireEntry(entry)).toMatchObject({
      person_id: marko.id,
      person_name: "Marko",
    });
  });
});

// ----------------------------------------------------------------
// Snimci i zaštićena polja
// ----------------------------------------------------------------

describe("izmena ne dira snimke ni ključ zahteva", () => {
  it("unos iz ponavljanja zadrži vezu, ključ zahteva, vrstu i autora", async () => {
    const requestId = crypto.randomUUID();
    const created = await api(ana.token).rpc("create_entry_with_rule", {
      p_household_id: domA,
      p_kind: "expense",
      p_amount_minor: 120000,
      p_category_id: hranaA,
      p_person_id: marko.id,
      p_occurred_on: dayIn(MONTH_ONE, 21),
      p_note: `pretplata-${runStamp}`,
      p_day_of_month: 21,
      p_remind_days: 2,
      p_request_id: requestId,
    });
    if (created.error) throw created.error;

    const entryId = created.data as string;
    const before = await requireEntry(entryId);
    expect(before.recurring_rule_id).not.toBeNull();
    expect(before.request_id).toBe(requestId);

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entryId,
          iznos: "1.300",
          kategorija: hranaA,
          osoba: marko.id,
          datum: dayIn(MONTH_ONE, 21),
          beleska: `pretplata-popravka-${runStamp}`,
        }),
      ),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`month=${MONTH_ONE}`);

    const after = await requireEntry(entryId);
    expect(after).toMatchObject({
      amount_minor: 130000,
      note: `pretplata-popravka-${runStamp}`,
      // Sve ostalo je isto kao pre izmene.
      kind: before.kind,
      household_id: before.household_id,
      person_id: before.person_id,
      person_name: before.person_name,
      created_by: before.created_by,
      recurring_rule_id: before.recurring_rule_id,
      request_id: before.request_id,
    });

    // Pravilo i dalje postoji: izmena unosa ne gasi ponavljanje.
    const rule = await adminClient()
      .from("recurring_rules")
      .select("id, active")
      .eq("id", before.recurring_rule_id as string)
      .single();
    expect(rule.error).toBeNull();
    expect(rule.data).toMatchObject({ active: true });
  });

  it("premeštanje u mesec koji već ima unos istog ponavljanja daje rečenicu", async () => {
    // `entries_one_rule_per_month` je jedinstvenost koju akcija ne proverava
    // sama; greška baze zato mora da izađe kao rečenica, ne kao srušena forma.
    const created = await api(ana.token).rpc("create_entry_with_rule", {
      p_household_id: domA,
      p_kind: "expense",
      p_amount_minor: 70000,
      p_category_id: racuniA,
      p_person_id: ana.id,
      p_occurred_on: dayIn(MONTH_ONE, 28),
      p_note: `sudar-${runStamp}`,
      p_day_of_month: 28,
      p_remind_days: 1,
      p_request_id: crypto.randomUUID(),
    });
    if (created.error) throw created.error;

    const first = await requireEntry(created.data as string);
    const ruleId = first.recurring_rule_id as string;

    // Isti red koji bi mesečni posao napravio za sledeći mesec.
    const next = await adminClient()
      .from("entries")
      .insert({
        household_id: domA,
        kind: "expense",
        amount_minor: 70000,
        category_id: racuniA,
        person_id: ana.id,
        person_name: "",
        occurred_on: dayIn(MONTH_TWO, 28),
        note: `sudar-sledeci-${runStamp}`,
        created_by: ana.id,
        recurring_rule_id: ruleId,
      })
      .select("id")
      .single();
    if (next.error) throw next.error;

    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: first.id,
          iznos: "700",
          kategorija: racuniA,
          osoba: ana.id,
          datum: dayIn(MONTH_TWO, 28),
          beleska: `sudar-${runStamp}`,
        }),
      ),
    );

    const refused = denial(outcome);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("ponavljanja");
    expect(refused.message).not.toContain("duplicate key");
    expect((await requireEntry(first.id)).occurred_on).toBe(dayIn(MONTH_ONE, 28));
  });
});

// ----------------------------------------------------------------
// Brisanje
// ----------------------------------------------------------------

describe("vlasnik briše unos", () => {
  it("bez potvrde ne briše ništa", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 23),
      note: `bez-potvrde-${runStamp}`,
    });

    revalidated.length = 0;

    const outcome = await act(ana, () => deleteEntryAction(EMPTY, form({ dom: domA, unos: entry })));

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_DELETE_UNCONFIRMED });
    expect(await readEntry(entry)).not.toBeNull();
    expect(revalidated).toEqual([]);
  });

  it("sa potvrdom briše red i vraća u mesec iz kog je unos nestao", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 25),
      note: `za-brisanje-${runStamp}`,
    });

    revalidated.length = 0;

    const outcome = await act(ana, () =>
      deleteEntryAction(EMPTY, form({ dom: domA, unos: entry, potvrda: "da" })),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`/h/${domA}?month=${MONTH_ONE}`);
    expect(await readEntry(entry)).toBeNull();
    expect(revalidated).toContain(`/h/${domA}`);

    const month = await get(`/h/${domA}?month=${MONTH_ONE}`, ana.cookie);
    expect(month.markup).not.toContain(`za-brisanje-${runStamp}`);
  });

  it("drugi put ista forma kaže da unosa nema, i to nije uspeh", async () => {
    const entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: ana.id,
      createdBy: ana.id,
      occurredOn: dayIn(MONTH_ONE, 26),
      note: `dvaput-${runStamp}`,
    });

    const first = await act(ana, () =>
      deleteEntryAction(EMPTY, form({ dom: domA, unos: entry, potvrda: "da" })),
    );
    expect(first.digest).toContain(`/h/${domA}`);

    const second = await act(ana, () =>
      deleteEntryAction(EMPTY, form({ dom: domA, unos: entry, potvrda: "da" })),
    );
    expect(denial(second)).toMatchObject({ ok: false, message: ENTRY_GONE });
  });

  it("brisanje unosa iz ponavljanja ostavlja pravilo na mestu", async () => {
    const requestId = crypto.randomUUID();
    const created = await api(ana.token).rpc("create_entry_with_rule", {
      p_household_id: domA,
      p_kind: "expense",
      p_amount_minor: 90000,
      p_category_id: racuniA,
      p_person_id: ana.id,
      p_occurred_on: dayIn(MONTH_TWO, 9),
      p_note: `pretplata-brisanje-${runStamp}`,
      p_day_of_month: 9,
      p_remind_days: 1,
      p_request_id: requestId,
    });
    if (created.error) throw created.error;

    const entryId = created.data as string;
    const ruleId = (await requireEntry(entryId)).recurring_rule_id as string;

    const outcome = await act(ana, () =>
      deleteEntryAction(EMPTY, form({ dom: domA, unos: entryId, potvrda: "da" })),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`month=${MONTH_TWO}`);
    expect(await readEntry(entryId)).toBeNull();

    const rule = await adminClient()
      .from("recurring_rules")
      .select("id, active")
      .eq("id", ruleId)
      .maybeSingle();
    expect(rule.error).toBeNull();
    expect(rule.data).toMatchObject({ id: ruleId, active: true });
  });
});

// ----------------------------------------------------------------
// Član i nečlan: direktan poziv ne menja ništa
// ----------------------------------------------------------------

describe("član ne menja unos ni direktnim pozivom", () => {
  let entry = "";

  beforeAll(async () => {
    entry = await seedEntry({
      householdId: domA,
      categoryId: hranaA,
      personId: marko.id,
      createdBy: marko.id,
      occurredOn: dayIn(MONTH_ONE, 27),
      note: `zabrana-${runStamp}`,
    });
  }, 60_000);

  it("ne menja svoj unos", async () => {
    const outcome = await act(marko, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: entry,
          iznos: "9.999",
          kategorija: racuniA,
          osoba: marko.id,
          datum: dayIn(MONTH_TWO, 1),
          beleska: "preoteto",
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_OWNER_ONLY });
    expect(await requireEntry(entry)).toMatchObject({
      amount_minor: 100000,
      category_id: hranaA,
      occurred_on: dayIn(MONTH_ONE, 27),
      note: `zabrana-${runStamp}`,
    });
  });

  it("ne briše svoj unos", async () => {
    const outcome = await act(marko, () =>
      deleteEntryAction(EMPTY, form({ dom: domA, unos: entry, potvrda: "da" })),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_OWNER_ONLY });
    expect(await readEntry(entry)).not.toBeNull();
  });

  it("nečlan dobija istu poruku kao član — iz nje se ne vidi da unos postoji", async () => {
    const asOutsider = await act(spolja, () =>
      deleteEntryAction(EMPTY, form({ dom: domA, unos: entry, potvrda: "da" })),
    );
    const asGhost = await act(spolja, () =>
      deleteEntryAction(
        EMPTY,
        form({ dom: "00000000-0000-0000-0000-000000000000", unos: entry, potvrda: "da" }),
      ),
    );

    expect(denial(asOutsider).message).toBe(ENTRY_OWNER_ONLY);
    expect(denial(asGhost).message).toBe(ENTRY_OWNER_ONLY);
    expect(await readEntry(entry)).not.toBeNull();
  });

  it("neispravna adresa domaćinstva ne stiže ni do baze", async () => {
    const outcome = await act(ana, () =>
      deleteEntryAction(EMPTY, form({ dom: "nije-uuid", unos: entry, potvrda: "da" })),
    );

    expect(denial(outcome).ok).toBe(false);
    expect(denial(outcome).message).toContain("Adresa");
    expect(await readEntry(entry)).not.toBeNull();
  });

  it("neispravan `id` unosa dobija istu poruku kao obrisan unos", async () => {
    const outcome = await act(ana, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domA,
          unos: "nije-uuid",
          iznos: "1.000",
          kategorija: hranaA,
          osoba: ana.id,
          datum: dayIn(MONTH_ONE, 27),
          beleska: "",
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_GONE });
  });
});

// ----------------------------------------------------------------
// Dva domaćinstva, jedan vlasnik
//
// Ovo je jedini slučaj u kom RLS ne pomaže. `is_owner(household_id)` gleda red
// koji se menja, pa vlasniku oba domaćinstva propušta i izmenu reda iz onog
// drugog. Jedina zaštita je što akcija sužava i po `household_id` iz forme.
// ----------------------------------------------------------------

describe("vlasnik dva domaćinstva ne prenosi prava iz jednog u drugo", () => {
  let entryD = "";
  let hranaC = "";

  beforeAll(async () => {
    hranaC = await categoryId(domC, "Hrana", "expense");
    entryD = await seedEntry({
      householdId: domD,
      categoryId: hranaD,
      personId: dvostruki.id,
      createdBy: dvostruki.id,
      occurredOn: dayIn(MONTH_ONE, 4),
      note: `samo-u-d-${runStamp}`,
    });
  }, 60_000);

  it("stvarno je vlasnik oba domaćinstva — inače test ništa ne dokazuje", async () => {
    const roles = await adminClient()
      .from("memberships")
      .select("household_id, role")
      .eq("user_id", dvostruki.id)
      .in("household_id", [domC, domD]);

    expect(roles.error).toBeNull();
    expect((roles.data ?? []).map((row) => row.role)).toEqual(["owner", "owner"]);
  });

  it("sa svojim domaćinstvom C i `id`-em unosa iz D menja nula redova", async () => {
    const outcome = await act(dvostruki, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domC,
          unos: entryD,
          iznos: "9.999",
          kategorija: hranaC,
          osoba: dvostruki.id,
          datum: dayIn(MONTH_TWO, 4),
          beleska: "preseljeno",
        }),
      ),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_GONE });
    expect(await requireEntry(entryD)).toMatchObject({
      amount_minor: 100000,
      occurred_on: dayIn(MONTH_ONE, 4),
      note: `samo-u-d-${runStamp}`,
    });
  });

  it("ne briše unos drugog svog domaćinstva", async () => {
    const outcome = await act(dvostruki, () =>
      deleteEntryAction(EMPTY, form({ dom: domC, unos: entryD, potvrda: "da" })),
    );

    expect(denial(outcome)).toMatchObject({ ok: false, message: ENTRY_GONE });
    expect(await readEntry(entryD)).not.toBeNull();
  });

  it("u svom domaćinstvu D isti vlasnik menja isti red", async () => {
    // Kontrola: bez nje testovi iznad mogu da prolaze iz pogrešnog razloga.
    const outcome = await act(dvostruki, () =>
      updateEntryAction(
        EMPTY,
        form({
          dom: domD,
          unos: entryD,
          iznos: "2.000",
          kategorija: hranaD,
          osoba: dvostruki.id,
          datum: dayIn(MONTH_ONE, 4),
          beleska: `samo-u-d-${runStamp}`,
        }),
      ),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`/h/${domD}`);
    expect((await requireEntry(entryD)).amount_minor).toBe(200000);
  });
});

// ----------------------------------------------------------------
// Kapija: osvežena sesija mora i da se sačuva
// ----------------------------------------------------------------

describe("izmena ne prolazi ako osvežena sesija nije upisana u kolačiće", () => {
  let vlasnik: TestUser;
  let domE = "";
  let hranaE = "";
  let entry = "";

  beforeAll(async () => {
    vlasnik = await signUp("unos-kolacici", "Kolačić");
    domE = await createHousehold(vlasnik, "Kuća E");
    hranaE = await categoryId(domE, "Hrana", "expense");
    entry = await seedEntry({
      householdId: domE,
      categoryId: hranaE,
      personId: vlasnik.id,
      createdBy: vlasnik.id,
      occurredOn: dayIn(MONTH_ONE, 6),
      note: `kolacici-${runStamp}`,
    });
  }, 180_000);

  function fields(note: string): Record<string, string> {
    return {
      dom: domE,
      unos: entry,
      iznos: "1.000",
      kategorija: hranaE,
      osoba: vlasnik.id,
      datum: dayIn(MONTH_ONE, 6),
      beleska: note,
    };
  }

  it("kontrola: istekla sesija se osveži i izmena prolazi kad upis radi", async () => {
    // Bez ove kontrole sledeći test ne dokazuje ništa: pad bi mogao da dođe od
    // istekle sesije, a ne od neuspelog upisa.
    expireSession(vlasnik.jar);

    const outcome = await act(vlasnik, () =>
      updateEntryAction(EMPTY, form(fields(`kolacici-ok-${runStamp}`))),
    );

    expect(outcome.digest, outcome.state?.message ?? "").toContain(`/h/${domE}`);
    expect((await requireEntry(entry)).note).toBe(`kolacici-ok-${runStamp}`);
  });

  it("kad upis padne, izmena se ne upisuje i ne prijavljuje kao uspeh", async () => {
    const notePre = (await requireEntry(entry)).note;
    expireSession(vlasnik.jar);
    revalidated.length = 0;
    cookieWriteAttempts = 0;

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let outcome: Outcome;
    let diagnostics: string[] = [];
    try {
      outcome = await withBrokenCookieWrites(() =>
        act(vlasnik, () => updateEntryAction(EMPTY, form(fields(`kolacici-ne-sme-${runStamp}`)))),
      );
      diagnostics = logged.mock.calls.map((call) => String(call[0]));
    } finally {
      logged.mockRestore();
    }

    // Upis je zaista bio pokušan; inače test meri istekle sesije, ne kolačiće.
    expect(cookieWriteAttempts).toBeGreaterThan(0);
    expect(denial(outcome)).toMatchObject({ ok: false, message: SESSION_GONE });

    // Izmena nije stigla do baze, keš se ne dira, razlog je u logu.
    expect((await requireEntry(entry)).note).toBe(notePre);
    expect(revalidated).toEqual([]);
    expect(diagnostics.some((line) => line.includes("nije upisana u kolačiće"))).toBe(true);
    expect(denial(outcome).message).not.toContain("kolačić");
  });
});
