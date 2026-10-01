-- ============================================================
-- Task 4: Atomičan unos sa mesečnim ponavljanjem
-- Migration: 20261001090000_entry_with_rule
--
-- Dopuna, ne izmena. Nijedan postojeći potpis, okidač ni politika se ne dira.
--
-- Zašto postoji
-- -------------
-- Forma „Novi unos" sa uključenim ponavljanjem pravi dva reda: pravilo i prvi
-- unos. Dva odvojena poziva iz pregledača nisu jedna transakcija. Ako drugi
-- padne — mreža, arhivirana kategorija, ograničenje, izgubljena sesija —
-- pravilo ostaje kao siroče. Član ga ne može obrisati (`rules_delete` traži
-- vlasnika) ni ugasiti (`rules_update` traži vlasnika), a mesečni posao bi od
-- sledećeg dospeća pravio unose koje niko nije tražio.
--
-- Ova funkcija radi oba upisa u jednoj transakciji: izuzetak u drugom upisu
-- poništava i prvi, pa siroče ne može da nastane.
-- ============================================================

-- Najmanje pravo koje posao traži:
--   * `security definer` zaobilazi RLS, pa se ista granica koju postavljaju
--     politike `rules_insert` i `entries_insert` (`is_member`) proverava ovde
--     eksplicitno. Funkcija ne daje nijedno pravo koje član i inače nema —
--     isti član bi oba reda mogao da upiše i direktno, samo ne atomično.
--   * Validaciju domaćinstva, kategorije, vrste i osobe NE ponavlja: to već
--     rade okidači `prepare_recurring_rule` i `prepare_entry` i ograničenja
--     tabela. Druga kopija pravila bi se vremenom razišla od prve.
--   * `person_name` i `created_by` postavlja `prepare_entry`; prosleđene
--     vrednosti su samo zadovoljenje `not null`-a i okidač ih prepisuje.
create or replace function public.create_entry_with_rule(
  p_household_id uuid,
  p_kind text,
  p_amount_minor bigint,
  p_category_id uuid,
  p_person_id uuid,
  p_occurred_on date,
  p_note text,
  p_day_of_month integer,
  p_remind_days integer
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

  if not public.is_member(p_household_id) then
    raise exception 'Niste član domaćinstva';
  end if;

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
    recurring_rule_id
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
    rule_id
  )
  returning id into entry_id;

  return entry_id;
end;
$$;

-- ------------------------------------------------------------
-- FUNCTION GRANTS
-- `alter default privileges ... revoke execute on functions from public, anon`
-- iz prve migracije već važi za nove funkcije; revoke ispod je eksplicitan da
-- pravo ne zavisi od redosleda migracija.
--
-- service_role namerno NE dobija eksplicitan grant: funkcija prvim redom traži
-- `auth.uid()`, pa bi za posao bez sesije uvek pala. Mesečni posao i fixtures
-- upisuju direktno u tabele, gde već imaju pun grant. (Supabase svojim
-- podrazumevanim privilegijama i dalje daje execute ulozi service_role, isto
-- kao za `create_household` i `accept_invitation`; poziv tada pada na proveri
-- sesije, ne na pravu.)
-- ------------------------------------------------------------

revoke execute on function public.create_entry_with_rule(uuid, text, bigint, uuid, uuid, date, text, integer, integer)
  from public, anon;
grant  execute on function public.create_entry_with_rule(uuid, text, bigint, uuid, uuid, date, text, integer, integer)
  to authenticated;
