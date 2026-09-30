-- ============================================================
-- Task 1: Šema, okidači i RPC — Dinar po dinar
-- Migration: 20260930120000_finance
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA USAGE (self-contained; Supabase may already grant these)
-- ------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- ------------------------------------------------------------
-- TABELE
-- ------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) > 0)
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

create table public.memberships (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  primary key (household_id, user_id)
);

-- Jedan vlasnik po domaćinstvu
create unique index memberships_one_owner on public.memberships (household_id) where role = 'owner';

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  kind text not null check (kind in ('expense', 'income')),
  limit_minor bigint check (limit_minor is null or limit_minor > 0),
  archived boolean not null default false
);

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  amount_minor bigint not null check (amount_minor > 0),
  category_id uuid not null references public.categories (id),
  person_id uuid not null references public.profiles (id),
  note text not null default '',
  day_of_month integer not null check (day_of_month between 1 and 31),
  remind_days integer not null default 1 check (remind_days between 1 and 7),
  active boolean not null default true
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  amount_minor bigint not null check (amount_minor > 0),
  category_id uuid not null references public.categories (id),
  person_id uuid not null references public.profiles (id),
  person_name text not null,
  occurred_on date not null,
  -- Fix 1: substring(date::text, 1, 7) je IMMUTABLE (date::text → 'YYYY-MM-DD' ISO format).
  -- to_char(date, text) je STABLE (locale-dependent), pa PostgreSQL odbija generated column.
  month_key text generated always as (substring(occurred_on::text, 1, 7)) stored,
  note text not null default '',
  created_by uuid not null references public.profiles (id),
  recurring_rule_id uuid
);

-- Fix 2: ON DELETE SET NULL umesto NO ACTION.
-- Household cascade briše i recurring_rules i entries, ali ako se pravilo obriše
-- direktno, istorijski unosi ostaju sa recurring_rule_id = NULL.
alter table public.entries
  add constraint entries_rule_fk
  foreign key (recurring_rule_id) references public.recurring_rules (id)
  on delete set null;

-- Jedan unos po pravilu po mesecu (partial — ne uključuje NULL)
create unique index entries_one_rule_per_month
  on public.entries (recurring_rule_id, month_key)
  where recurring_rule_id is not null;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz
);

create table public.sent_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  dedupe_key text not null,
  unique (household_id, dedupe_key)
);

-- ------------------------------------------------------------
-- POMOĆNE RPC FUNKCIJE (security definer; revoke public later)
-- ------------------------------------------------------------

create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- ------------------------------------------------------------
-- OKIDAČI — PROFILI
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- OKIDAČI — DOMAĆINSTVO
-- ------------------------------------------------------------

create or replace function public.prevent_currency_change()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from old.currency then
    raise exception 'Valuta se posle otvaranja domaćinstva ne menja';
  end if;
  return new;
end;
$$;

create trigger households_currency
  before update on public.households
  for each row execute function public.prevent_currency_change();

-- ------------------------------------------------------------
-- OKIDAČI — ČLANSTVA
-- Fix 2: Dozvoli CASCADE DELETE kad domaćinstvo se briše (household
-- red neće biti vidljiv u istoj transakciji u trenutku cascade-a).
-- Ovo sprečava blokiranje legitimnog household ON DELETE CASCADE.
-- Invarianta: postojeće domaćinstvo ne može ostati bez vlasnika.
-- ------------------------------------------------------------

create or replace function public.prevent_owner_removal()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'owner' then
    -- Ako domaćinstvo više ne postoji (CASCADE DELETE od household),
    -- brisanje vlasničkog članstva je legitimno.
    if not exists (select 1 from public.households where id = old.household_id) then
      return old;
    end if;
    raise exception 'Vlasnik se ne uklanja';
  end if;
  return old;
end;
$$;

create trigger memberships_keep_owner
  before delete on public.memberships
  for each row execute function public.prevent_owner_removal();

-- ------------------------------------------------------------
-- OKIDAČI — PONAVLJAJUĆA PRAVILA
-- Validira: category_id i person_id pripadaju istom domaćinstvu,
-- vrsta kategorije se slaže s vrstom pravila.
-- ------------------------------------------------------------

create or replace function public.prepare_recurring_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat public.categories%rowtype;
begin
  select * into cat from public.categories where id = new.category_id;
  if cat.id is null or cat.household_id <> new.household_id then
    raise exception 'Kategorija ne pripada ovom domaćinstvu';
  end if;
  if cat.kind <> new.kind then
    raise exception 'Vrsta kategorije ne odgovara vrsti pravila';
  end if;
  if not exists (
    select 1 from public.memberships
    where household_id = new.household_id and user_id = new.person_id
  ) then
    raise exception 'Osoba nije član domaćinstva';
  end if;
  return new;
end;
$$;

create trigger recurring_rules_prepare
  before insert or update on public.recurring_rules
  for each row execute function public.prepare_recurring_rule();

-- ------------------------------------------------------------
-- OKIDAČI — UNOSI
-- Validira: kategorija, osoba, recurring_rule_id.
-- Postavlja: person_name (uvek), created_by (samo auth INSERT).
-- created_by pravila:
--   - Autentifikovani INSERT → uvek auth.uid()
--   - Service-role INSERT (auth.uid() = null) → čuva eksplicitno zadati created_by
-- ------------------------------------------------------------

create or replace function public.prepare_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category public.categories%rowtype;
begin
  -- Validacija kategorije
  select * into category from public.categories where id = new.category_id;
  if category.id is null or category.household_id <> new.household_id then
    raise exception 'Kategorija ne pripada ovom domaćinstvu';
  end if;
  if category.kind <> new.kind then
    raise exception 'Vrsta kategorije ne odgovara vrsti unosa';
  end if;
  if tg_op = 'INSERT' and category.archived then
    raise exception 'Arhivirana kategorija ne prima nove unose';
  end if;

  -- Validacija osobe
  if not exists (
    select 1 from public.memberships
    where household_id = new.household_id and user_id = new.person_id
  ) then
    raise exception 'Osoba nije član domaćinstva';
  end if;

  -- Validacija ponavljajućeg pravila (household + kind kompatibilnost)
  if new.recurring_rule_id is not null then
    if not exists (
      select 1 from public.recurring_rules
      where id = new.recurring_rule_id
        and household_id = new.household_id
        and kind = new.kind
    ) then
      raise exception 'Ponavljajuće pravilo nije kompatibilno s unosom';
    end if;
  end if;

  -- Postavljanje person_name
  select display_name into new.person_name from public.profiles where id = new.person_id;

  -- Postavljanje created_by samo za auth INSERT (ne briše service-role vrednost)
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

create trigger entries_prepare
  before insert or update on public.entries
  for each row execute function public.prepare_entry();

-- Okidač koji sprečava člana da menja ili briše unos.
-- Fix 5: Preskače proveru za service-role (auth.uid() IS NULL) —
-- jobovi/maintenance smeju menjati unose direktno.
-- USING klauzula entries_update/entries_delete je is_member (ne is_owner)
-- kako bi okidač sigurno okinuo i vratio grešku za authenticated korisnike.
create or replace function public.reject_member_entry_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role (auth.uid() IS NULL): dozvoli bez provere
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not public.is_owner(old.household_id) then
    raise exception 'Samo vlasnik menja unos';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger entries_owner_change
  before update or delete on public.entries
  for each row execute function public.reject_member_entry_change();

-- ------------------------------------------------------------
-- JAVNE RPC FUNKCIJE
-- ------------------------------------------------------------

create or replace function public.create_household(p_name text, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Prijava je obavezna';
  end if;
  insert into public.households (name, currency) values (p_name, p_currency) returning id into hid;
  insert into public.memberships (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  -- Podrazumevane kategorije na srpskom (tačni stringovi iz specifikacije)
  insert into public.categories (household_id, name, kind) values
    (hid, 'Hrana',    'expense'),
    (hid, 'Računi',   'expense'),
    (hid, 'Prevoz',   'expense'),
    (hid, 'Zdravlje', 'expense'),
    (hid, 'Ostalo',   'expense'),
    (hid, 'Plata',    'income'),
    (hid, 'Ostalo',   'income');
  return hid;
end;
$$;

-- Fix 3 + Fix 4: NULL-safe email check + FOR UPDATE row lock (atomic claim).
-- FOR UPDATE serializes concurrent acceptances: drugi pozivalac čeka na commit
-- prvog, pa vidi used_at != NULL i dobija grešku.
-- Fix 3: Ako korisnik nema e-poštu (NULL), SQL NULL <> X evaluira u NULL (ne TRUE),
-- što bi zaobišlo proveru. Eksplicitno odbijamo NULL e-poštu.
create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.invitations%rowtype;
  caller_email text;
begin
  if auth.uid() is null then
    raise exception 'Prijava je obavezna';
  end if;

  select email into caller_email from auth.users where id = auth.uid();

  -- Fix 3: Eksplicitno odbaci NULL e-poštu (korisnik bez e-pošte ne sme prihvatiti)
  if caller_email is null then
    raise exception 'Korisnik nema e-poštu registrovanu na nalogu';
  end if;

  -- Fix 4: FOR UPDATE zaključava red pre provere → serializuje konkurentne pozive
  select * into invite
  from public.invitations
  where token = p_token
  for update;

  if invite.id is null then
    raise exception 'Pozivnica ne postoji';
  end if;
  if invite.used_at is not null then
    raise exception 'Pozivnica je već iskorišćena';
  end if;
  if invite.expires_at < now() then
    raise exception 'Pozivnica je istekla';
  end if;
  -- Fix 3: IS DISTINCT FROM je NULL-safe (NULL IS DISTINCT FROM 'x' → TRUE)
  if lower(invite.email) is distinct from lower(caller_email) then
    raise exception 'Pozivnica je za drugu e-poštu';
  end if;

  insert into public.memberships (household_id, user_id, role)
  values (invite.household_id, auth.uid(), 'member')
  on conflict do nothing;

  update public.invitations set used_at = now() where id = invite.id;

  return invite.household_id;
end;
$$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.categories enable row level security;
alter table public.entries enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.invitations enable row level security;
alter table public.sent_notifications enable row level security;

-- Profili: vidljivi sebi i sadomaćinskim članovima
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid());

-- Domaćinstva
create policy households_read   on public.households for select to authenticated using (public.is_member(id));
create policy households_update on public.households for update to authenticated using (public.is_owner(id));

-- Članstva
create policy memberships_read   on public.memberships for select to authenticated using (public.is_member(household_id));
create policy memberships_delete on public.memberships for delete to authenticated using (
  public.is_owner(household_id) and role = 'member'
);

-- Kategorije
create policy categories_read  on public.categories for select to authenticated using (public.is_member(household_id));
create policy categories_write on public.categories for all    to authenticated
  using     (public.is_owner(household_id))
  with check (public.is_owner(household_id));

-- Unosi:
-- INSERT: svi članovi mogu dodavati
-- UPDATE USING = is_member: okidač reject_member_entry_change mora okinuti i
--   dati grešku (PostgREST sa is_owner USING vraća 0 redova bez greške — tiha zabrana)
-- WITH CHECK = is_owner: odbija commit čak i ako okidač ne baci izuzetak (defense-in-depth)
create policy entries_read   on public.entries for select to authenticated using (public.is_member(household_id));
create policy entries_insert on public.entries for insert to authenticated with check (public.is_member(household_id));
create policy entries_update on public.entries for update to authenticated
  using     (public.is_member(household_id))
  with check (public.is_owner(household_id));
create policy entries_delete on public.entries for delete to authenticated using (public.is_member(household_id));

-- Ponavljajuća pravila
create policy rules_read   on public.recurring_rules for select to authenticated using (public.is_member(household_id));
create policy rules_insert on public.recurring_rules for insert to authenticated with check (public.is_member(household_id));
create policy rules_update on public.recurring_rules for update to authenticated
  using     (public.is_owner(household_id))
  with check (public.is_owner(household_id));
create policy rules_delete on public.recurring_rules for delete to authenticated using (public.is_owner(household_id));

-- Pozivnice (samo vlasnik vidi i kreira)
create policy invitations_read   on public.invitations for select to authenticated using (public.is_owner(household_id));
create policy invitations_insert on public.invitations for insert to authenticated with check (public.is_owner(household_id));

-- Notifikacije (samo čitanje za članove; INSERT samo service-role)
create policy notifications_read on public.sent_notifications for select to authenticated using (public.is_member(household_id));

-- ------------------------------------------------------------
-- TABLE-LEVEL GRANTS
-- RLS kontroliše pristup redovima; table grant kontroliše pristup tabeli.
-- ------------------------------------------------------------

grant select, insert, update, delete on public.profiles           to authenticated;
grant select, insert, update, delete on public.households         to authenticated;
grant select, insert, update, delete on public.memberships        to authenticated;
grant select, insert, update, delete on public.categories         to authenticated;
grant select, insert, update, delete on public.entries            to authenticated;
grant select, insert, update, delete on public.recurring_rules    to authenticated;
grant select, insert, update, delete on public.invitations        to authenticated;
grant select                         on public.sent_notifications to authenticated;
-- sent_notifications INSERT/UPDATE/DELETE samo service_role (Edge Functions/jobs)

-- ------------------------------------------------------------
-- FUNCTION GRANTS — REVOKE PUBLIC, GRANT PO ULOZI
-- Sve security definer funkcije su podrazumevano dostupne PUBLIC-u;
-- eksplicitno revokujemo i dajemo samo potrebnim ulogama.
-- ------------------------------------------------------------

-- Trigger funkcije (pozivaju ih trigeri, ne korisnici direktno)
revoke execute on function public.handle_new_user()               from public;
revoke execute on function public.prevent_currency_change()       from public;
revoke execute on function public.prevent_owner_removal()         from public;
revoke execute on function public.prepare_entry()                 from public;
revoke execute on function public.prepare_recurring_rule()        from public;
revoke execute on function public.reject_member_entry_change()    from public;

-- Helperi koji se koriste u RLS politikama — authenticated mora moći zvati
revoke execute on function public.is_member(uuid)                 from public;
revoke execute on function public.is_owner(uuid)                  from public;
grant  execute on function public.is_member(uuid)                 to authenticated;
grant  execute on function public.is_owner(uuid)                  to authenticated;

-- Javne RPC funkcije
revoke execute on function public.create_household(text, text)    from public;
revoke execute on function public.accept_invitation(uuid)         from public;
grant  execute on function public.create_household(text, text)    to authenticated;
grant  execute on function public.accept_invitation(uuid)         to authenticated;
