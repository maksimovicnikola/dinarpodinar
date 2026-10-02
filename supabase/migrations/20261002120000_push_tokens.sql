-- Token za Expo push. Podrazumevana prava na novim tabelama su opozvana,
-- pa authenticated mora da dobije izričit grant. Svako vidi samo svoj red.

create table public.push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null check (char_length(btrim(token)) > 0),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;
