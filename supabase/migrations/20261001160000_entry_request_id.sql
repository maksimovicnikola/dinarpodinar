-- ============================================================
-- Task 4, krug 1: idempotentan unos sa ponavljanjem
-- Migration: 20261001160000_entry_request_id
--
-- Zašto postoji
-- -------------
-- Transakcija iz prethodne migracije sprečava *pola* posla, ali ne sprečava
-- posao *dvaput*. Odgovor koji se izgubi na putu natrag (mobilna mreža,
-- uspavan telefon, osvežena kartica) izgleda isto kao pad: forma javi da unos
-- nije sačuvan, član klikne ponovo, a u bazi stoje dva pravila i dva unosa.
-- Brava u pregledaču tu ne pomaže — drugi pokušaj je nov zahtev, često iz
-- druge kartice.
--
-- Zašto NE jedinstvenost po poslovnim poljima
-- -------------------------------------------
-- Pravilo „jedno pravilo po (domaćinstvo, kategorija, osoba, iznos, dan)“ bi
-- rešilo ponavljanje, ali bi zabranilo i nešto što je sasvim legitimno: dve
-- stvarne pretplate istog iznosa, istog dana, u istoj kategoriji (dva telefona
-- po 1.200 dinara 15. u mesecu). Idempotencija je svojstvo *zahteva*, ne
-- svojstvo podatka, pa i ključ mora da opisuje zahtev.
--
-- Klijent zato uz poziv šalje identifikator pokušaja (`p_request_id`) koji
-- zadržava kroz sve retrije istog slanja, a menja ga za nov nacrt. Isti
-- identifikator istog autora daje isti unos; nov identifikator daje nov unos,
-- pa dve identične pretplate ostaju moguće.
-- ============================================================

-- ------------------------------------------------------------
-- KOLONA I JEDINSTVENOST
-- Opseg je (created_by, request_id): `created_by` postavlja `prepare_entry` na
-- `auth.uid()`, pa dva različita člana ne mogu da se sudare ni slučajno ni
-- namerno — pogođen identifikator tuđeg zahteva pada u tuđi opseg.
-- Parcijalan indeks: stari unosi i običan (neponavljajući) unos nose NULL i
-- ostaju van pravila.
-- ------------------------------------------------------------

alter table public.entries add column request_id uuid;

create unique index entries_request
  on public.entries (created_by, request_id)
  where request_id is not null;

-- Ključ opisuje zahtev koji je unos napravio, pa posle upisa nema šta da se
-- menja. Bez ovoga bi vlasnik izmenom starog unosa mogao da pomeri ključ i
-- natera budući retry da vrati pogrešan unos.
create or replace function public.keep_entry_request_id()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.request_id := old.request_id;
  return new;
end;
$$;

create trigger entries_keep_request_id
  before update on public.entries
  for each row execute function public.keep_entry_request_id();

revoke execute on function public.keep_entry_request_id() from public, anon, authenticated;

-- ------------------------------------------------------------
-- RPC
-- Potpis se menja (dodat je obavezan `p_request_id`), pa stara verzija odlazi.
-- Dve verzije bi ostale kao preklopljene funkcije i PostgREST bi birao po
-- poslatim ključevima — put bez identifikatora ne sme da postoji.
-- ------------------------------------------------------------

drop function if exists public.create_entry_with_rule(
  uuid, text, bigint, uuid, uuid, date, text, integer, integer
);

create or replace function public.create_entry_with_rule(
  p_household_id uuid,
  p_kind text,
  p_amount_minor bigint,
  p_category_id uuid,
  p_person_id uuid,
  p_occurred_on date,
  p_note text,
  p_day_of_month integer,
  p_remind_days integer,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_id uuid;
  entry_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Prijava je obavezna';
  end if;

  if p_request_id is null then
    raise exception 'Zahtev nema identifikator';
  end if;

  -- `security definer` zaobilazi RLS, pa se ista granica koju postavljaju
  -- politike `rules_insert` i `entries_insert` proverava ovde eksplicitno.
  if not public.is_member(p_household_id) then
    raise exception 'Niste član domaćinstva';
  end if;

  -- Retry posle izgubljenog odgovora: posao je već obavljen, vrati isti unos.
  select id into entry_id
  from public.entries
  where created_by = auth.uid()
    and request_id = p_request_id;

  if entry_id is not null then
    return entry_id;
  end if;

  begin
    insert into public.recurring_rules (
      household_id,
      kind,
      amount_minor,
      category_id,
      person_id,
      note,
      day_of_month,
      remind_days
    )
    values (
      p_household_id,
      p_kind,
      p_amount_minor,
      p_category_id,
      p_person_id,
      coalesce(p_note, ''),
      p_day_of_month,
      coalesce(p_remind_days, 1)
    )
    returning id into rule_id;

    insert into public.entries (
      household_id,
      kind,
      amount_minor,
      category_id,
      person_id,
      person_name,
      occurred_on,
      note,
      created_by,
      recurring_rule_id,
      request_id
    )
    values (
      p_household_id,
      p_kind,
      p_amount_minor,
      p_category_id,
      p_person_id,
      '',
      p_occurred_on,
      coalesce(p_note, ''),
      auth.uid(),
      rule_id,
      p_request_id
    )
    returning id into entry_id;
  exception
    when unique_violation then
      -- Trka dva istovremena poziva istog zahteva. Oba upisa iz ovog bloka su
      -- poništena (pravilo gubitnika ne ostaje), pa se vraća pobednikov unos.
      -- Novo čitanje vidi pobednika: `entries_request` je blokirao upis do
      -- njegovog commit-a, a READ COMMITTED svakom naredbom uzima nov snimak.
      select id into entry_id
      from public.entries
      where created_by = auth.uid()
        and request_id = p_request_id;

      -- Sudar koji nije naš ključ (npr. `entries_one_rule_per_month`) je prava
      -- greška i ide dalje nepromenjen.
      if entry_id is null then
        raise;
      end if;
  end;

  return entry_id;
end;
$$;

-- ------------------------------------------------------------
-- FUNCTION GRANTS
-- Funkciju zove isključivo prijavljen član iz aplikacije. `anon` je nema jer
-- nema sesiju; `service_role` je nema jer posao bez sesije ni ne može da je
-- iskoristi (prvi `if` bi pao), a jobovi i fixtures pišu direktno u tabele gde
-- već imaju pun grant. Supabase svojim podrazumevanim privilegijama daje
-- execute ulozi service_role, pa revoke mora da bude izričit.
-- ------------------------------------------------------------

revoke execute on function public.create_entry_with_rule(uuid, text, bigint, uuid, uuid, date, text, integer, integer, uuid)
  from public, anon, service_role;
grant  execute on function public.create_entry_with_rule(uuid, text, bigint, uuid, uuid, date, text, integer, integer, uuid)
  to authenticated;
