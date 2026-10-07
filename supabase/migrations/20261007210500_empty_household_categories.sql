-- Novo domaćinstvo počinje bez kategorija. Vlasnik ih dodaje prema svojim potrebama.
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

  insert into public.households (name, currency)
  values (p_name, p_currency)
  returning id into hid;

  insert into public.memberships (household_id, user_id, role)
  values (hid, auth.uid(), 'owner');

  return hid;
end;
$$;
