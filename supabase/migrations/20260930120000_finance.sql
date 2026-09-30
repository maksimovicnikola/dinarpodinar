-- ============================================================
-- Task 1: Šema, okidači i RPC — Dinar po dinar
-- Migration: 20260930120000_finance
-- ============================================================

-- ------------------------------------------------------------
-- SCHEMA USAGE (self-contained; Supabase may already grant these)
-- ------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

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
  archived boolean not null default false,
  -- Mesečni limit postoji samo za trošak (dizajn: „samo za trošak“).
  constraint categories_limit_expense_only check (limit_minor is null or kind = 'expense')
);

-- Naziv je jedinstven među aktivnim kategorijama istog domaćinstva i iste vrste.
-- Arhivirane ne zauzimaju naziv, pa vlasnik sme da otvori novu „Hranu“ posle arhive.
create unique index categories_active_name
  on public.categories (household_id, kind, name)
  where not archived;

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  amount_minor bigint not null check (amount_minor > 0),
  category_id uuid not null references public.categories (id),
  -- Pravilo je buduća automatika, ne istorija: brisanjem naloga ono nestaje,
  -- dok unosi ostaju sa snimljenim imenom osobe.
  person_id uuid not null references public.profiles (id) on delete cascade,
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
  -- Fix 1 (round 2): Genuino IMMUTABLE izraz bez zavisnosti od DateStyle/locale/sesije.
  -- date::text prati session DateStyle (npr. German/US menja format) → nije sigurno.
  -- extract(year|month from date) je IMMUTABLE u PostgreSQL katalogu i uvek vraća
  -- numeričku vrednost nezavisnu od sesije. lpad + || su takođe IMMUTABLE.
  -- Rezultat je uvek tačno 'YYYY-MM' (npr. '2026-09').
  month_key text generated always as (
    lpad(extract(year  from occurred_on)::int::text, 4, '0') || '-' ||
    lpad(extract(month from occurred_on)::int::text, 2, '0')
  ) stored,
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
  email text not null check (char_length(btrim(email)) > 0),
  token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  -- Sedam dana je gornja granica i za service-role. Istekle fixtures su i dalje
  -- dozvoljene: rok u prošlosti je manji od created_at + 7 dana.
  constraint invitations_max_ttl check (expires_at <= created_at + interval '7 days')
);

create table public.sent_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  dedupe_key text not null check (char_length(btrim(dedupe_key)) > 0),
  created_at timestamptz not null default now(),
  unique (household_id, dedupe_key)
);

-- ------------------------------------------------------------
-- INDEKSI
-- Pokrivaju RLS provere članstva, mesečni pregled i spoljne ključeve
-- (Postgres ne pravi indeks za FK sam od sebe).
-- ------------------------------------------------------------

create index memberships_user_idx        on public.memberships (user_id);
create index categories_household_idx    on public.categories (household_id);
create index entries_household_month_idx on public.entries (household_id, month_key);
create index entries_category_idx        on public.entries (category_id);
create index entries_person_idx          on public.entries (person_id);
create index entries_created_by_idx      on public.entries (created_by);
create index rules_household_idx         on public.recurring_rules (household_id);
create index rules_category_idx          on public.recurring_rules (category_id);
create index rules_person_idx            on public.recurring_rules (person_id);
-- Mesečni posao traži samo aktivna pravila za dati dan u mesecu.
create index rules_active_day_idx        on public.recurring_rules (day_of_month) where active;
create index invitations_household_idx   on public.invitations (household_id);

-- ------------------------------------------------------------
-- POMOĆNE RPC FUNKCIJE (security definer; revoke public later)
-- ------------------------------------------------------------

create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
as $$
begin
  -- Ime za prikaz je obavezno. Nalog bez imena i bez e-pošte (npr. telefon)
  -- ne sme da obori registraciju, pa postoji i poslednji, bezbedan rezervni naziv.
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'Član'
    )
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

-- Normalizuje naziv i valutu pri upisu, a valutu posle otvaranja zaključava.
create or replace function public.prepare_household()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.name := btrim(new.name);
  new.currency := upper(btrim(new.currency));
  if tg_op = 'UPDATE' and new.currency is distinct from old.currency then
    raise exception 'Valuta se posle otvaranja domaćinstva ne menja';
  end if;
  return new;
end;
$$;

create trigger households_prepare
  before insert or update on public.households
  for each row execute function public.prepare_household();

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
security definer
set search_path = public, pg_temp
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

-- Kad član izađe, njegova ponavljanja se gase. Bez ovoga mesečni posao bi i dalje
-- pravio unose za osobu koja više nije član, a pravilo se ne bi moglo ugasiti jer
-- validacija članstva pada. Gašenje ide kroz prepare_recurring_rule bez provera
-- (menja se samo `active` na false).
create or replace function public.deactivate_rules_of_removed_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Kod brisanja celog domaćinstva red je već nestao; pravila odlaze kaskadno.
  if not exists (select 1 from public.households where id = old.household_id) then
    return old;
  end if;
  update public.recurring_rules
     set active = false
   where household_id = old.household_id
     and person_id = old.user_id
     and active;
  return old;
end;
$$;

create trigger memberships_deactivate_rules
  after delete on public.memberships
  for each row execute function public.deactivate_rules_of_removed_member();

-- ------------------------------------------------------------
-- OKIDAČI — PROFILI, BRISANJE NALOGA
-- Nalog vlasnika se briše tako što prvo nestanu njegova domaćinstva.
-- Kaskada auth.users → profiles bi inače udarila u „Vlasnik se ne uklanja“,
-- pa brisanje naloga ne bi bilo moguće. Redosled je određen: domaćinstva prvo,
-- profil posle, i nijedno domaćinstvo ne ostaje bez vlasnika.
-- ------------------------------------------------------------

create or replace function public.delete_owned_households()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.households h
   where exists (
     select 1 from public.memberships m
     where m.household_id = h.id
       and m.user_id = old.id
       and m.role = 'owner'
   );
  return old;
end;
$$;

create trigger profiles_delete_owned_households
  before delete on public.profiles
  for each row execute function public.delete_owned_households();

-- ------------------------------------------------------------
-- OKIDAČI — KATEGORIJE
-- Domaćinstvo i vrsta su nepromenljivi: unosi i pravila već pokazuju na njih,
-- pa bi promena tiho prebacila istoriju u drugo domaćinstvo ili drugu vrstu.
-- ------------------------------------------------------------

create or replace function public.prepare_category()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id then
      raise exception 'Domaćinstvo kategorije se ne menja';
    end if;
    if new.kind is distinct from old.kind then
      raise exception 'Vrsta kategorije se ne menja';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_prepare
  before insert or update on public.categories
  for each row execute function public.prepare_category();

-- Arhivirana kategorija ne sme da nosi aktivno ponavljanje: mesečni posao bi
-- pravio unose koje bi prepare_entry odbio. Gašenje menja samo `active`,
-- pa prolazi kroz prepare_recurring_rule bez ijedne dodatne provere.
create or replace function public.deactivate_rules_of_archived_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.archived and not old.archived then
    update public.recurring_rules
       set active = false
     where category_id = new.id
       and active;
  end if;
  return null;
end;
$$;

create trigger categories_archive_rules
  after update of archived on public.categories
  for each row execute function public.deactivate_rules_of_archived_category();

-- ------------------------------------------------------------
-- OKIDAČI — PONAVLJAJUĆA PRAVILA
-- Validira: category_id i person_id pripadaju istom domaćinstvu,
-- vrsta kategorije se slaže s vrstom pravila.
-- ------------------------------------------------------------

create or replace function public.prepare_recurring_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cat public.categories%rowtype;
  category_changed boolean;
  person_changed boolean;
  activating boolean;
begin
  if tg_op = 'INSERT' then
    category_changed := true;
    person_changed := true;
    activating := new.active;
  else
    category_changed := new.category_id is distinct from old.category_id
      or new.household_id is distinct from old.household_id
      or new.kind is distinct from old.kind;
    person_changed := new.person_id is distinct from old.person_id
      or new.household_id is distinct from old.household_id;
    -- Gašenje pravila (active → false) ne pali nijednu proveru ispod.
    -- Bez toga se pravilo bivšeg člana ili arhivirane kategorije ne bi moglo ugasiti.
    activating := new.active and not old.active;
  end if;

  if category_changed or activating then
    select * into cat from public.categories where id = new.category_id;
    if cat.id is null or cat.household_id <> new.household_id then
      raise exception 'Kategorija ne pripada ovom domaćinstvu';
    end if;
    if cat.kind <> new.kind then
      raise exception 'Vrsta kategorije ne odgovara vrsti pravila';
    end if;
    if new.active and cat.archived then
      raise exception 'Arhivirana kategorija ne prima aktivno ponavljanje';
    end if;
  end if;

  if person_changed or activating then
    if not exists (
      select 1 from public.memberships
      where household_id = new.household_id and user_id = new.person_id
    ) then
      raise exception 'Osoba nije član domaćinstva';
    end if;
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
-- Postavlja: person_name i created_by.
-- person_name i created_by su snimci iz trenutka čuvanja:
--   - INSERT ili promena osobe → upisuje se aktuelno ime te osobe
--   - svaka druga izmena → stara vrednost ostaje, šta god klijent poslao
-- Članstvo se proverava samo pri INSERT-u i pri promeni osobe, da bi vlasnik
-- mogao da dorađuje stare unose članova koji su u međuvremenu izašli.
-- created_by pravila:
--   - Autentifikovani INSERT → uvek auth.uid()
--   - Service-role INSERT (auth.uid() = null) → čuva eksplicitno zadati created_by
-- ------------------------------------------------------------

create or replace function public.prepare_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  category public.categories%rowtype;
  category_changed boolean;
  person_changed boolean;
begin
  if tg_op = 'INSERT' then
    category_changed := true;
    person_changed := true;
  else
    -- Domaćinstvo se briše: ovo je RI akcija (npr. recurring_rule_id → NULL)
    -- nad redom koji i sam nestaje. Validacija ovde samo blokira brisanje.
    if not exists (select 1 from public.households where id = new.household_id) then
      new.person_name := old.person_name;
      new.created_by := old.created_by;
      return new;
    end if;
    category_changed := new.category_id is distinct from old.category_id
      or new.household_id is distinct from old.household_id
      or new.kind is distinct from old.kind;
    person_changed := new.person_id is distinct from old.person_id
      or new.household_id is distinct from old.household_id;
  end if;

  -- Validacija kategorije (uvek: kategorija mora pripadati domaćinstvu i vrsti)
  select * into category from public.categories where id = new.category_id;
  if category.id is null or category.household_id <> new.household_id then
    raise exception 'Kategorija ne pripada ovom domaćinstvu';
  end if;
  if category.kind <> new.kind then
    raise exception 'Vrsta kategorije ne odgovara vrsti unosa';
  end if;
  -- Arhiva odbija nov unos i premeštanje unosa u arhiviranu kategoriju,
  -- ali ne blokira izmenu beleške ili iznosa na starom unosu.
  if category_changed and category.archived then
    raise exception 'Arhivirana kategorija ne prima nove unose';
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

  if person_changed then
    if not exists (
      select 1 from public.memberships
      where household_id = new.household_id and user_id = new.person_id
    ) then
      raise exception 'Osoba nije član domaćinstva';
    end if;
    select display_name into new.person_name from public.profiles where id = new.person_id;
  else
    new.person_name := old.person_name;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
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
set search_path = public, pg_temp
as $$
begin
  -- Service-role (auth.uid() IS NULL): dozvoli bez provere
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Domaćinstvo više ne postoji: red odlazi kaskadno, nema šta da se štiti.
  if not exists (select 1 from public.households where id = old.household_id) then
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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
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
-- OKIDAČI — POZIVNICE
-- Rok od sedam dana je pravilo baze, ne klijenta. Prijavljeni vlasnik ne bira
-- ni token, ni rok, ni iskorišćenost — baza ih postavlja. Service-role (jobovi
-- i testovi) sme da napravi isteklu pozivnicu, ali ni on ne sme preko sedam dana
-- (ograničenje invitations_max_ttl).
-- ------------------------------------------------------------

create or replace function public.prepare_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.email := lower(btrim(new.email));

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.token := gen_random_uuid();
      new.created_at := now();
      new.expires_at := now() + interval '7 days';
      new.used_at := null;
    end if;
    return new;
  end if;

  -- Jedina izmena dozvoljena prijavljenom pozivaocu je označavanje iskorišćenosti
  -- (radi je accept_invitation).
  if auth.uid() is not null then
    if new.id is distinct from old.id
      or new.household_id is distinct from old.household_id
      or new.email is distinct from old.email
      or new.token is distinct from old.token
      or new.created_at is distinct from old.created_at
      or new.expires_at is distinct from old.expires_at
    then
      raise exception 'Pozivnica se ne menja; povuci je i pošalji novu';
    end if;
  end if;

  return new;
end;
$$;

create trigger invitations_prepare
  before insert or update on public.invitations
  for each row execute function public.prepare_invitation();

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

-- Pozivnice (samo vlasnik vidi, kreira i povlači)
create policy invitations_read   on public.invitations for select to authenticated using (public.is_owner(household_id));
create policy invitations_insert on public.invitations for insert to authenticated with check (public.is_owner(household_id));
create policy invitations_delete on public.invitations for delete to authenticated using (public.is_owner(household_id));

-- Notifikacije (samo čitanje za članove; INSERT samo service-role)
create policy notifications_read on public.sent_notifications for select to authenticated using (public.is_member(household_id));

-- ------------------------------------------------------------
-- TABLE-LEVEL GRANTS
-- RLS kontroliše pristup redovima; table grant kontroliše pristup tabeli.
--
-- Supabase podrazumevano daje `all` nad novim tabelama ulogama anon,
-- authenticated i service_role. Samo dodavanje grantova zato ništa ne sužava:
-- prvo se sve oduzima, pa se vraća tačno ono što politike iznad traže.
-- ------------------------------------------------------------

revoke all on public.profiles           from anon, authenticated;
revoke all on public.households         from anon, authenticated;
revoke all on public.memberships        from anon, authenticated;
revoke all on public.categories         from anon, authenticated;
revoke all on public.entries            from anon, authenticated;
revoke all on public.recurring_rules    from anon, authenticated;
revoke all on public.invitations        from anon, authenticated;
revoke all on public.sent_notifications from anon, authenticated;

-- Nove tabele u ovoj šemi više ne kreću od Supabase podrazumevanih grantova.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- anon ostaje bez ijedne privilegije nad tabelama: prijava ide kroz Auth,
-- a svaka politika iznad traži authenticated.

-- profiles: ime menja samo vlasnik naloga; red pravi okidač handle_new_user
grant select, update                 on public.profiles           to authenticated;
-- households: red pravi create_household; vlasnik menja naziv
grant select, update                 on public.households         to authenticated;
-- memberships: red pravi accept_invitation; vlasnik uklanja člana
grant select, delete                 on public.memberships        to authenticated;
grant select, insert, update, delete on public.categories         to authenticated;
grant select, insert, update, delete on public.entries            to authenticated;
grant select, insert, update, delete on public.recurring_rules    to authenticated;
-- invitations: vlasnik kreira i povlači; used_at upisuje accept_invitation
grant select, insert, delete         on public.invitations        to authenticated;
grant select                         on public.sent_notifications to authenticated;

-- service_role: mesečni posao, podsetnici, fixtures i čišćenje u testovima.
grant select, insert, update, delete on public.profiles           to service_role;
grant select, insert, update, delete on public.households         to service_role;
grant select, insert, update, delete on public.memberships        to service_role;
grant select, insert, update, delete on public.categories         to service_role;
grant select, insert, update, delete on public.entries            to service_role;
grant select, insert, update, delete on public.recurring_rules    to service_role;
grant select, insert, update, delete on public.invitations        to service_role;
grant select, insert, update, delete on public.sent_notifications to service_role;

-- ------------------------------------------------------------
-- FUNCTION GRANTS — REVOKE PUBLIC, GRANT PO ULOZI
-- Sve security definer funkcije su podrazumevano dostupne PUBLIC-u;
-- eksplicitno revokujemo i dajemo samo potrebnim ulogama.
-- ------------------------------------------------------------

-- Trigger funkcije (pozivaju ih trigeri, ne korisnici direktno)
revoke execute on function public.handle_new_user()                          from public, anon, authenticated;
revoke execute on function public.prepare_household()                        from public, anon, authenticated;
revoke execute on function public.prevent_owner_removal()                    from public, anon, authenticated;
revoke execute on function public.deactivate_rules_of_removed_member()       from public, anon, authenticated;
revoke execute on function public.delete_owned_households()                  from public, anon, authenticated;
revoke execute on function public.prepare_category()                         from public, anon, authenticated;
revoke execute on function public.deactivate_rules_of_archived_category()    from public, anon, authenticated;
revoke execute on function public.prepare_entry()                            from public, anon, authenticated;
revoke execute on function public.prepare_recurring_rule()                   from public, anon, authenticated;
revoke execute on function public.reject_member_entry_change()               from public, anon, authenticated;
revoke execute on function public.prepare_invitation()                       from public, anon, authenticated;

-- Helperi koji se koriste u RLS politikama — authenticated mora moći zvati
revoke execute on function public.is_member(uuid)                 from public, anon;
revoke execute on function public.is_owner(uuid)                  from public, anon;
grant  execute on function public.is_member(uuid)                 to authenticated;
grant  execute on function public.is_owner(uuid)                  to authenticated;

-- Javne RPC funkcije
revoke execute on function public.create_household(text, text)    from public, anon;
revoke execute on function public.accept_invitation(uuid)         from public, anon;
grant  execute on function public.create_household(text, text)    to authenticated;
grant  execute on function public.accept_invitation(uuid)         to authenticated;

-- Nove funkcije u ovoj šemi ne kreću od PUBLIC execute prava.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ------------------------------------------------------------
-- REALTIME
-- Otvoren ekran domaćinstva dobija nove unose čim su sačuvani.
-- Realtime poštuje RLS politike iznad, pa član vidi samo svoje domaćinstvo.
-- ------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.entries;
  end if;
end;
$$;
