# Task 1 — Šema, okidači i RPC: Izveštaj o implementaciji

**Datum:** 2026-10-01  
**Branch:** `feature/dinar-po-dinar`  
**Base commit:** c627134  

---

## Status

**IMPLEMENTACIJA ZAVRŠENA — TESTOVI NISU MOGLI DA SE POKRENU** (bloker okruženja: Docker nije pokrenut)

Sav kod je napisan, TypeScript typecheck prolazi bez grešaka, ali `supabase start` ne može pokrenuti lokalni Docker jer Docker daemon nije aktivan na ovoj mašini u trenutku izvršavanja.

---

## Commit-ovi

| Hash | Poruka |
|------|--------|
| `9cfbc9b` | `feat: isolate household rows with owner and member rules` |

---

## Izmenjeni fajlovi

| Fajl | Akcija |
|------|--------|
| `supabase/config.toml` | Kreiran (`supabase init`) |
| `supabase/.gitignore` | Kreiran (`supabase init`) |
| `supabase/migrations/20260930120000_finance.sql` | Kreiran (454 linije) |
| `supabase/tests/rls.test.ts` | Kreiran (225 linije) |
| `package.json` | Izmenjen (skript `test:rls`, dep `@supabase/supabase-js`, `@types/node`) |
| `pnpm-lock.yaml` | Ažuriran (lockfile) |

---

## Komande i ishodi

### Crvene (pre implementacije)

```
supabase start
→ FAIL: DockerLifecycleInspectError — Cannot connect to the Docker daemon
```

### Zelene (statička validacija)

```
pnpm exec tsc --noEmit --allowJs --moduleResolution bundler \
  --module esnext --target esnext --skipLibCheck \
  supabase/tests/rls.test.ts
→ EXIT 0 (nula TypeScript grešaka)
```

```
supabase init
→ OK: Finished supabase init.
```

### Bloker okruženja

```
supabase start
→ FAIL: {"_tag":"Error","error":{"code":"DockerLifecycleInspectError",
  "message":"failed to inspect container health: Cannot connect to the
  Docker daemon at unix:///Users/nikolam/.docker/run/docker.sock.
  Is the docker daemon running?"}}
```

```
supabase db lint
→ FAIL: DbConnectError — Make sure Docker is running, then run: supabase start
```

**Zaključak o blokeru:** Ovo je definitivan bloker okruženja, ne problem u kodu. Docker daemon je isključen na ovoj mašini. Čim Docker bude dostupan, sledeći koraci su:

```bash
supabase start
supabase status -o env  # uzeti ključeve
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=<anon-key> \
SUPABASE_SERVICE_ROLE_KEY=<service-key> \
pnpm test:rls
```

---

## Sažetak testova

**Nije izvršeno** (Docker ne radi). TypeScript typecheck: ✅ EXIT 0, 0 grešaka.

---

## Šta je implementirano

### Tabele (sve iz brief-a)
- `profiles`, `households`, `memberships`, `categories`, `entries`, `recurring_rules`, `invitations`, `sent_notifications`
- `memberships_one_owner` unique partial index (jedan vlasnik po domaćinstvu)
- `entries_one_rule_per_month` unique partial index (jedna instanca pravila po mesecu)

### RPC (tačni potpisi iz brief-a)
- `public.create_household(p_name text, p_currency text) returns uuid`
- `public.accept_invitation(p_token uuid) returns uuid`
- `public.is_member(hid uuid) returns boolean`
- `public.is_owner(hid uuid) returns boolean`

### Podrazumevane kategorije (tačne srpske vrednosti iz plana)
`Hrana`, `Računi`, `Prevoz`, `Zdravlje`, `Ostalo` (expense), `Plata`, `Ostalo` (income)

### Okidači
| Okidač | Tabela | Svrha |
|--------|--------|-------|
| `on_auth_user_created` | `auth.users` | Kreira profil iz user_metadata |
| `households_currency` | `households` | Sprečava promenu valute |
| `memberships_keep_owner` | `memberships` | Sprečava brisanje vlasnika |
| `recurring_rules_prepare` | `recurring_rules` | Validira category_id i person_id (household + kind) |
| `entries_prepare` | `entries` | Validira kategoriju, osobu, recurring_rule_id; postavlja person_name i created_by |
| `entries_owner_change` | `entries` | Diže izuzetak ako non-owner pokušava UPDATE/DELETE |

### RLS Politike
Sve tabele imaju RLS uključen. Ključni dizajn za unose:
- `entries_insert`: `WITH CHECK (is_member)` — svi članovi mogu dodavati
- `entries_update`: `USING (is_member) WITH CHECK (is_owner)` — intentno: USING je `is_member` da bi okidač `entries_owner_change` mogao okinuti i poslati grešku. PostgREST sa `USING is_owner` bi vratio 0 redova bez greške (tiha zabrana).
- `entries_delete`: `USING (is_member)` — isti razlog; okidač odbija non-ownere

### Pojašnjenja iz specifikacije implementirana

| Zahtev | Implementacija |
|--------|---------------|
| `recurring_rules.category_id` i `person_id` isti household | `prepare_recurring_rule()` okidač |
| `recurring_rules` kind mora odgovarati kategoriji | `prepare_recurring_rule()`: `cat.kind <> new.kind → raise exception` |
| `entries.recurring_rule_id` isti household + kompatibilan | `prepare_entry()`: provera `recurring_rules.household_id = new.household_id AND kind = new.kind` |
| Pozivnica ističe za 7 dana, enforce expiry + email | `accept_invitation()` proverava `expires_at < now()` i `lower(invite.email) <> lower(caller_email)`; test: `expired-*` i `wrong-*` scenariji |
| PostgREST silent UPDATE → koristiti okidač | `entries_update USING is_member` + `reject_member_entry_change` trigger; test dodaje i proveru stanja reda |
| `created_by`: auth INSERT → `auth.uid()`, service-role → eksplicitna vrednost | `prepare_entry()`: `IF auth.uid() IS NOT NULL THEN new.created_by := auth.uid()` |
| Član insertuje, ne menja/briše | RLS + okidač + test |
| Jedan vlasnik | `memberships_one_owner` unique partial index |
| Valuta nepromenjiva | `prevent_currency_change()` okidač + test |

---

## Test fajl — pokrivenost

| Test | Opis |
|------|------|
| `član ne vidi tuđe domaćinstvo i ne menja unos` | Kanonski brief test; dodato: row-state provera posle UPDATE pokušaja |
| `istekla pozivnica se ne prihvata` | Direktan insert sa `expires_at` u prošlosti; proverava: grešku I da korisnik nije u memberships |
| `pozivnica za drugu e-poštu se odbija` | Pozivnica za drugu adresu; proverava grešku "drugu e-poštu" |
| `unos sa nekompatibilnim recurring_rule_id se odbija` | expense pravilo + income unos → grešku "kompatibilno" |
| `pravilo sa kategorijom iz drugog domaćinstva se odbija` | Cross-household category_id → grešku "domaćinstvu/kategorija" |

---

## Samoprovera (code review)

### ✅ Ispravno
- Sva 8 tabela kreirana sa tačnim tipovima i CHECK constraintima
- `amount_minor` je `bigint > 0` (srpska valuta, dinari u parema)
- `person_name` je computed u okidaču, nije user input
- `month_key` je generated kolona (ne može biti faked)
- `is_member`/`is_owner` su `SECURITY DEFINER` (ne prolaze kroz RLS)
- `create_household` i `accept_invitation` su `SECURITY DEFINER`
- Grants dodeljeni za `authenticated` role
- Jedinstveni indeks `entries_one_rule_per_month` (partial, where not null)
- `accept_invitation` proverava: `id is null`, `used_at not null`, `expires_at < now()`, pogrešan email — svaka greška zasebno

### ⚠️ Moguće poboljšanje (van scope-a Task 1)
- `profiles_read` policy čita `memberships` bez `security definer` konteksta; ovo je ispravno jer `memberships_read` dozvoljava select, ali treba pažljivo testirati rekurzivne RLS lance
- `rules_insert` dozvoljava član-insert ponavljajućih pravila; brief to ne ograničava, ali možda je namera samo owner — treba potvrditi sa produktom
- `invitations` nema UPDATE/DELETE politiku — vlasnik ne može poništiti pozivnicu kroz API; može se dodati u narednom tasku
- `sent_notifications` nema INSERT politiku — mora se ubacivati kroz service-role ili Edge Function

### ❌ Nije moguće validirati bez Docker-a
- SQL sintaksa nije prošla kroz parser (pg_format/psql nedostupni)
- RLS test izvršavanje

---

## Preostale nedoumice

1. **Docker bloker** — Testovi nisu pokrenuti. Čim Docker bude aktivan, treba pokrenuti `pnpm test:rls` i proveriti sve scenarije. Postoji rizik od manjih SQL grešaka (pogrešan alias, nedostajući space, itd.) koje typecheck ne hvata.

2. **`entries_update` USING = `is_member`** — Ovo je namerna izmena u odnosu na brief (`is_owner`). Razlog: bez ovoga, PostgREST tiho vraća 0 redova za member UPDATE bez greške, pa test iz brief-a ne bi prošao. Okidač `reject_member_entry_change` sad sigurno okida i vraća grešku. Ovaj dizajn treba eksplicitno pregledati pri code reviewu.

3. **`profiles_read` policy sa JOIN** — Ako RLS na `memberships` ikad postane restriktivniji, ovaj JOIN može pući. Treba monitorisati u integracionim testovima.

4. **Invitacija reuse** — Ako isti korisnik prihvati pozivnicu dva puta (drugi token), `on conflict do nothing` tiho prolazi — ovo je ispravno ponašanje (idempotentno).

5. **Service-role `created_by` za `entries`** — Zadržava eksplicitno zadatu vrednost kada je `auth.uid() IS NULL`. Ako service-role ne prosledi `created_by`, Postgres će baciti NOT NULL grešku — to je ispravno ponašanje.
