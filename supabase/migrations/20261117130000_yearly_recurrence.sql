-- ============================================================
-- Godišnje ponavljanje
-- Migration: 20261117130000_yearly_recurrence
--
-- Pravilo je do sada znalo samo dan u mesecu, pa je dnevni posao pravio unos
-- svakog meseca. Godišnje pravilo čuva i mesec (15. januar ostaje 15. januar).
-- Postojeća pravila ostaju mesečna: cadence dobija podrazumevano 'monthly',
-- a month_of_year ostaje prazan.
--
-- Učestalost i mesec se biraju samo pri otvaranju ponavljanja. Izmena u
-- podešavanjima i dalje dira iznos, dan i podsetnik, ali ne i ova dva polja.
-- ============================================================

alter table public.recurring_rules
  add column cadence text not null default 'monthly',
  add column month_of_year integer;

alter table public.recurring_rules
  add constraint recurring_rules_cadence_check
    check (cadence in ('monthly', 'yearly')),
  add constraint recurring_rules_month_of_year_check
    check (month_of_year is null or month_of_year between 1 and 12),
  add constraint recurring_rules_cadence_month_check
    check (
      (cadence = 'monthly' and month_of_year is null)
      or (cadence = 'yearly' and month_of_year is not null)
    );

-- ------------------------------------------------------------
-- Učestalost se ne menja posle upisa. Dan, iznos i podsetnik i dalje mogu.
-- ------------------------------------------------------------

create or replace function public.keep_recurrence_cadence()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.cadence is distinct from old.cadence
     or new.month_of_year is distinct from old.month_of_year then
    raise exception 'Učestalost ponavljanja se ne menja';
  end if;
  return new;
end;
$$;

create trigger recurring_rules_keep_cadence
  before update on public.recurring_rules
  for each row execute function public.keep_recurrence_cadence();

revoke execute on function public.keep_recurrence_cadence() from public, anon, authenticated;

-- ------------------------------------------------------------
-- RPC
-- Novi argumenti stoje na kraju i imaju podrazumevane vrednosti, pa poziv koji
-- ih ne pošalje i dalje pravi mesečno pravilo. Stari potpis se briše: dve
-- verzije bi PostgREST ostavio da bira, a to ne sme.
-- ------------------------------------------------------------

drop function if exists public.create_entry_with_rule(
  uuid, text, bigint, uuid, uuid, date, text, integer, integer, uuid
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
  p_request_id uuid,
  p_cadence text default 'monthly',
  p_month_of_year integer default null
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

  if not public.is_member(p_household_id) then
    raise exception 'Niste član domaćinstva';
  end if;

  if p_cadence is distinct from 'monthly' and p_cadence is distinct from 'yearly' then
    raise exception 'Ponavljanje je mesečno ili godišnje';
  end if;

  if p_cadence = 'monthly' and p_month_of_year is not null then
    raise exception 'Mesečno ponavljanje nema mesec u godini';
  end if;

  if p_cadence = 'yearly' and (p_month_of_year is null or p_month_of_year < 1 or p_month_of_year > 12) then
    raise exception 'Godišnje ponavljanje traži mesec od 1 do 12';
  end if;

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
      remind_days,
      cadence,
      month_of_year
    )
    values (
      p_household_id,
      p_kind,
      p_amount_minor,
      p_category_id,
      p_person_id,
      coalesce(p_note, ''),
      p_day_of_month,
      coalesce(p_remind_days, 1),
      p_cadence,
      p_month_of_year
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
      select id into entry_id
      from public.entries
      where created_by = auth.uid()
        and request_id = p_request_id;

      if entry_id is null then
        raise;
      end if;
  end;

  return entry_id;
end;
$$;

revoke execute on function public.create_entry_with_rule(uuid, text, bigint, uuid, uuid, date, text, integer, integer, uuid, text, integer)
  from public, anon, service_role;
grant  execute on function public.create_entry_with_rule(uuid, text, bigint, uuid, uuid, date, text, integer, integer, uuid, text, integer)
  to authenticated;
