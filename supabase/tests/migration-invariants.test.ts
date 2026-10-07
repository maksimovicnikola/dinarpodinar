/**
 * Statičke invarijante migracije — pokreće se bez Dockera i bez Supabase veze.
 *
 * Ovo NIJE zamena za `supabase/tests/rls.test.ts`. Integracioni RLS test dokazuje
 * ponašanje na živoj bazi; ovde se proverava samo struktura SQL fajla, tj. da nijedna
 * tabela ne ostane bez RLS-a, da nijedna funkcija ne ostane bez `search_path` i da
 * privilegije nisu samo aditivne povrh Supabase podrazumevanih grantova.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Sve migracije, redom primene. Nova migracija je pokrivena bez dopune testa —
 * inače bi dodatna RPC funkcija mogla da prođe bez `search_path` i bez revoke-a.
 */
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

/** SQL bez komentara — da `--` linije ne lažu regex proveram ispod. */
const sql = migrationFiles
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n")
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function createdTables(): string[] {
  return [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
}

/** Zaglavlje funkcije: sve između imena i tela (`as $$`). */
function functionHeaders(): { name: string; header: string }[] {
  return [...sql.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(([\s\S]*?)\)([\s\S]*?)as \$\$/g)].map(
    (m) => ({ name: m[1], header: m[3] }),
  );
}

describe("tabele", () => {
  it("svaka javna tabela ima uključen RLS", () => {
    const missing = createdTables().filter(
      (table) => !new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(sql),
    );
    expect(missing).toEqual([]);
  });

  it("svaka javna tabela eksplicitno oduzima privilegije od anon i authenticated", () => {
    const missing = createdTables().filter(
      (table) =>
        !new RegExp(`revoke all[\\s\\S]{0,80}?on public\\.${table}\\b[\\s\\S]{0,80}?from[^;]*\\banon\\b`).test(sql) ||
        !new RegExp(
          `revoke all[\\s\\S]{0,80}?on public\\.${table}\\b[\\s\\S]{0,80}?from[^;]*\\bauthenticated\\b`,
        ).test(sql),
    );
    expect(missing).toEqual([]);
  });

  it("svaka javna tabela ima eksplicitan service_role grant za jobove i testove", () => {
    const missing = createdTables().filter(
      (table) => !new RegExp(`grant[^;]*on public\\.${table}\\b[^;]*to[^;]*\\bservice_role\\b`).test(sql),
    );
    expect(missing).toEqual([]);
  });

  it("nijedna tabela ne dobija privilegije nazad za anon", () => {
    const granted = [...sql.matchAll(/grant[^;]*on\s+(?:table\s+)?public\.(\w+)[^;]*to[^;]*;/g)].filter((m) =>
      /\banon\b/.test(m[0]),
    );
    expect(granted.map((m) => m[1])).toEqual([]);
  });
});

describe("funkcije", () => {
  it("svaka funkcija ima eksplicitan search_path", () => {
    const missing = functionHeaders()
      .filter(({ header }) => !/set search_path\s*=/.test(header))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it("svaka funkcija oduzima execute od public", () => {
    const missing = functionHeaders()
      .map(({ name }) => name)
      .filter((name) => !new RegExp(`revoke execute on function public\\.${name}\\b[^;]*from[^;]*public`).test(sql));
    expect(missing).toEqual([]);
  });
});

describe("pozivnice", () => {
  it("imaju created_at i ograničen maksimalni rok važenja", () => {
    expect(sql).toMatch(/create table public\.invitations[\s\S]*?created_at timestamptz not null default now\(\)/);
    expect(sql).toMatch(/expires_at <= created_at \+ interval '7 days'/);
  });
});

describe("kategorije", () => {
  it("limit postoji samo za trošak", () => {
    expect(sql).toMatch(/limit_minor is null or kind = 'expense'/);
  });
});

describe("skup migracija", () => {
  it("pretraga nalazi migracije (inače test ništa ne bi proveravao)", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
    expect(createdTables().length).toBeGreaterThan(0);
    expect(functionHeaders().length).toBeGreaterThan(0);
  });
});

/** Potpis koji aplikacija zaista zove — sa identifikatorom zahteva na kraju. */
const RPC_SIGNATURE = String.raw`public\.create_entry_with_rule\(uuid, text, bigint, uuid, uuid, date, text, integer, integer, uuid\)`;

/** Poslednja (važeća) definicija funkcije, ne ona koju je kasnija migracija zamenila. */
function lastRpcBody(): string {
  const bodies = [
    ...sql.matchAll(/create or replace function public\.create_entry_with_rule[\s\S]*?\$\$;/g),
  ];
  return bodies.at(-1)?.[0] ?? "";
}

function lastCreateHouseholdBody(): string {
  const bodies = [...sql.matchAll(/create or replace function public\.create_household[\s\S]*?\$\$;/g)];
  return bodies.at(-1)?.[0] ?? "";
}

describe("otvaranje domaćinstva", () => {
  it("pravi vlasnika, ali ne i početne kategorije", () => {
    const body = lastCreateHouseholdBody();
    expect(body).toMatch(/insert into public\.memberships/);
    expect(body).not.toMatch(/insert into public\.categories/);
  });
});

describe("atomičan unos sa ponavljanjem", () => {
  it("funkcija postoji i radi oba upisa", () => {
    expect(lastRpcBody()).toMatch(
      /insert into public\.recurring_rules[\s\S]*?insert into public\.entries/,
    );
  });

  it("proverava sesiju, identifikator zahteva i članstvo, jer security definer zaobilazi RLS", () => {
    const body = lastRpcBody();
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/auth\.uid\(\) is null/);
    expect(body).toMatch(/p_request_id is null/);
    expect(body).toMatch(/not public\.is_member\(p_household_id\)/);
  });

  it("vraća postojeći unos istog zahteva umesto drugog pravila", () => {
    const body = lastRpcBody();
    expect(body).toMatch(/where created_by = auth\.uid\(\)\s*and request_id = p_request_id/);
    expect(body).toMatch(/when unique_violation then/);
  });

  it("execute ima samo authenticated; public, anon i service_role su izričito oduzeti", () => {
    expect(sql).toMatch(new RegExp(String.raw`revoke execute on function ${RPC_SIGNATURE}\s*from public, anon, service_role;`));
    expect(sql).toMatch(new RegExp(String.raw`grant\s+execute on function ${RPC_SIGNATURE}\s*to authenticated;`));
    expect(sql).not.toMatch(
      /grant[^;]*execute on function public\.create_entry_with_rule[^;]*service_role/,
    );
  });

  it("stari potpis bez identifikatora zahteva je uklonjen", () => {
    expect(sql).toMatch(
      /drop function if exists public\.create_entry_with_rule\(\s*uuid, text, bigint, uuid, uuid, date, text, integer, integer\s*\)/,
    );
  });

  it("ne menja nijedan postojeći javni potpis", () => {
    for (const signature of [
      "public.create_household(text, text)",
      "public.accept_invitation(uuid)",
      "public.is_member(uuid)",
      "public.is_owner(uuid)",
    ]) {
      const escaped = signature.replace(/[.()]/g, "\\$&");
      expect(new RegExp(`grant\\s+execute on function ${escaped}`).test(sql), signature).toBe(true);
    }
  });
});

describe("ključ idempotencije", () => {
  it("unos nosi nullable request_id", () => {
    expect(sql).toMatch(/alter table public\.entries add column request_id uuid;/);
    expect(sql).not.toMatch(/add column request_id uuid not null/);
  });

  it("jedinstvenost je po autoru, pa dva člana ne mogu da se sudare", () => {
    expect(sql).toMatch(
      /create unique index entries_request\s*on public\.entries \(created_by, request_id\)\s*where request_id is not null;/,
    );
  });

  it("jedinstvenost NIJE po poslovnim poljima — dve iste pretplate su legitimne", () => {
    const forbidden = /create unique index[^;]*on public\.(entries|recurring_rules)[^;]*amount_minor[^;]*;/;
    expect(sql).not.toMatch(forbidden);
  });

  it("ključ se posle upisa ne menja", () => {
    expect(sql).toMatch(/create trigger entries_keep_request_id\s*before update on public\.entries/);
    expect(sql).toMatch(
      /function public\.keep_entry_request_id\(\)[\s\S]*?new\.request_id := old\.request_id;/,
    );
  });
});
