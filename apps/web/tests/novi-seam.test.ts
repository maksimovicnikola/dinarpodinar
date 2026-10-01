/**
 * Šav strane „Novi unos“: učitavanje → forma → RPC → mesečni pregled.
 *
 * Ovo NIJE jedinični test i namerno nije u `pnpm --filter web test`. Traži
 * pokrenut lokalni Supabase i izgrađenu aplikaciju, pa ide zasebnim skriptom:
 *
 *   supabase start && supabase db reset
 *   pnpm --filter web build
 *   pnpm test:seam
 *
 * Šta pokriva, i zašto jedinični testovi to ne mogu:
 *   - neprijavljen posetilac se preusmerava i pamti odakle je došao;
 *   - članu se strana iscrtava sa stvarnim kategorijama i članovima;
 *   - arhivirana kategorija ne ulazi ni u ponudu ni u teret strane;
 *   - podrazumevani datum je beogradski dan, izračunat na serveru;
 *   - prijavljeni član je izabran u spisku osoba;
 *   - stvarno slanje forme sa ponavljanjem (isti poziv koji šalje `browserGateway`)
 *     završi u mesecu **unosa**, ne u tekućem mesecu;
 *   - retry istog zahteva ne pravi drugi par.
 *
 * Priprema i čišćenje su određeni: svi redovi nose `runStamp` ovog rana i
 * brišu se u `afterAll`, pa ponovljeno pokretanje daje isti rezultat.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = "lozinka-test-123";

const runStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: string[] = [];
const createdHouseholdIds: string[] = [];

type TestUser = { id: string; email: string; token: string; cookie: string; displayName: string };

let server: ChildProcess | null = null;
let base = "";
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let householdId = "";
let foodId = "";
let today = "";

/** Mesec u koji unos pripada, namerno **različit** od tekućeg. */
const TARGET_DATE = "2027-02-17";
const TARGET_MONTH = TARGET_DATE.slice(0, 7);

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
  const jar = new Map<string, string>();
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

  return { id, email, cookie, token: signed.data.session.access_token, displayName };
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

function belgradeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

  owner = await signUp("seam-vlasnik", "Ana");
  member = await signUp("seam-clan", "Marko");
  outsider = await signUp("seam-spolja", "Spolja");

  const created = await api(owner.token).rpc("create_household", {
    p_name: `Naša kuća ${runStamp}`,
    p_currency: "RSD",
  });
  if (created.error) throw created.error;
  householdId = created.data as string;
  createdHouseholdIds.push(householdId);

  const invite = await api(owner.token)
    .from("invitations")
    .insert({ household_id: householdId, email: member.email })
    .select("token")
    .single();
  if (invite.error) throw invite.error;
  const accepted = await api(member.token).rpc("accept_invitation", { p_token: invite.data!.token });
  if (accepted.error) throw accepted.error;

  const archived = await adminClient()
    .from("categories")
    .insert({ household_id: householdId, name: "Arhivirana", kind: "expense", archived: true })
    .select("id")
    .single();
  if (archived.error) throw archived.error;

  const food = await api(member.token)
    .from("categories")
    .select("id")
    .eq("household_id", householdId)
    .eq("name", "Hrana")
    .eq("kind", "expense")
    .single();
  if (food.error) throw food.error;
  foodId = food.data!.id as string;

  today = belgradeToday();
}, 120_000);

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
// Učitavanje strane
// ----------------------------------------------------------------

describe("učitavanje strane", () => {
  it("neprijavljen posetilac ide na prijavu i strana pamti odakle je došao", async () => {
    const page = await get(`/h/${householdId}/novi`);

    expect([302, 307]).toContain(page.status);
    expect(page.location).toContain("/login");
    expect(page.location).toContain(encodeURIComponent(`/h/${householdId}/novi`));
  });

  it("članu se forma iscrtava sa nazivom domaćinstva", async () => {
    const page = await get(`/h/${householdId}/novi`, member.cookie);

    expect(page.status).toBe(200);
    expect(page.markup).toContain(`Naša kuća ${runStamp}`);
    expect(page.markup).toContain("Novi unos");
    expect(page.markup).toContain(">Sačuvaj</button>");
  });

  it("nudi aktivne kategorije troška, i nijednu arhiviranu", async () => {
    const page = await get(`/h/${householdId}/novi`, member.cookie);

    for (const name of ["Hrana", "Računi", "Prevoz", "Zdravlje", "Ostalo"]) {
      expect(page.markup, name).toContain(`>${name}</option>`);
    }

    expect(page.markup).not.toContain(">Arhivirana</option>");
    // Ni u RSC teret ne ulazi: strana je ne prosleđuje formi.
    expect(page.body).not.toContain("Arhivirana");
  });

  it("kategorije prihoda nisu u početnoj ponudi, ali jesu prosleđene formi", async () => {
    const page = await get(`/h/${householdId}/novi`, member.cookie);

    // Forma kreće od troška; „Plata“ se pojavi tek posle promene vrste.
    expect(page.markup).not.toContain(">Plata</option>");
    expect(page.body).toContain("Plata");
  });

  it("podrazumevani datum je današnji dan u Beogradu", async () => {
    const page = await get(`/h/${householdId}/novi`, member.cookie);

    expect(page.markup).toContain(`value="${today}"`);
    expect(page.markup).toContain('type="date"');
  });

  it("prijavljeni član je izabrana osoba, a ne prvi po azbuci", async () => {
    // Spisak je sortiran srpski: „Ana“ (vlasnik) je prva, „Marko“ (prijavljen) druga.
    const page = await get(`/h/${householdId}/novi`, member.cookie);

    expect(page.markup).toContain(">Ana</option>");
    expect(page.markup).toContain(">Marko</option>");

    const selected = /<option[^>]*selected[^>]*value="([^"]+)"|<option[^>]*value="([^"]+)"[^>]*selected/g;
    const selectedValues = [...page.markup.matchAll(selected)].map((match) => match[1] ?? match[2]);
    expect(selectedValues).toContain(member.id);
    expect(selectedValues).not.toContain(owner.id);
  });

  it("nečlan ne dobija formu ni potvrdu da domaćinstvo postoji", async () => {
    const page = await get(`/h/${householdId}/novi`, outsider.cookie);

    expect(page.markup).toContain("Domaćinstvo nije dostupno");
    expect(page.markup).not.toContain(">Sačuvaj</button>");
  });

  it("nepostojeće domaćinstvo izgleda isto kao tuđe", async () => {
    const page = await get("/h/00000000-0000-0000-0000-000000000000/novi", member.cookie);
    expect(page.markup).toContain("Domaćinstvo nije dostupno");
  });

  it("neispravan uuid se zaustavlja pre baze", async () => {
    const page = await get("/h/nije-uuid/novi", member.cookie);
    expect(page.markup).toContain("Adresa nije ispravna");
  });
});

// ----------------------------------------------------------------
// Šav forma → RPC → mesečni pregled
// ----------------------------------------------------------------

describe("slanje forme sa ponavljanjem", () => {
  /** Tačno onaj poziv koji šalje `browserGateway` u `form.tsx`. */
  function submit(requestId: string) {
    return api(member.token).rpc("create_entry_with_rule", {
      p_household_id: householdId,
      p_kind: "expense",
      p_amount_minor: 1250,
      p_category_id: foodId,
      p_person_id: member.id,
      p_occurred_on: TARGET_DATE,
      p_note: `pijaca-${runStamp}`,
      p_day_of_month: Number(TARGET_DATE.slice(8, 10)),
      p_remind_days: 2,
      p_request_id: requestId,
    });
  }

  it("unos i pravilo nastaju, i unos se vidi u mesecu unosa", async () => {
    const requestId = crypto.randomUUID();
    const saved = await submit(requestId);

    expect(saved.error?.message ?? null).toBeNull();
    expect(saved.data).toBeTruthy();

    // Ovo je adresa na koju forma preusmerava posle uspeha.
    const month = await get(`/h/${householdId}?month=${TARGET_MONTH}`, member.cookie);
    expect(month.status).toBe(200);
    expect(month.markup).toContain("12,50 RSD");
    expect(month.markup).toContain(`pijaca-${runStamp}`);
    expect(month.markup).toContain("ponavljanje");
  });

  it("tekući mesec ga ne pokazuje — zato se posle čuvanja ide u mesec unosa", async () => {
    const current = await get(`/h/${householdId}`, member.cookie);

    expect(current.status).toBe(200);
    expect(current.markup).not.toContain(`pijaca-${runStamp}`);
    expect(today.slice(0, 7)).not.toBe(TARGET_MONTH);
  });

  it("retry istog zahteva vraća isti unos i ne pravi drugo pravilo", async () => {
    const requestId = crypto.randomUUID();
    const first = await submit(requestId);
    expect(first.error).toBeNull();

    const retry = await submit(requestId);
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(first.data);

    const admin = adminClient();
    const entries = await admin
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("request_id", requestId);
    expect(entries.count).toBe(1);
  });

  it("strana se iscrtala bez ijedne greške servera", async () => {
    // Zastoj bi se video kao „Zastoj“ naslov iz komponente Problem.
    const page = await get(`/h/${householdId}/novi`, member.cookie);
    expect(page.markup).not.toContain("Zastoj");
    expect(page.markup).not.toContain("Nov unos se ne otvara");
  });
});
