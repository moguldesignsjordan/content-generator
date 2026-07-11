-- Migration 013: user_profiles — role per authenticated user (admin / user).
--
-- First cut of access control ahead of full multi-tenancy (see
-- multi-tenancy-roadmap.md, which layers brand_members roles on top of this
-- later). For now this only gates the Logs screen: 'admin' sees it, 'user'
-- doesn't. Deliberately one flat role column, not brand-scoped yet.
--
-- The trigger defaults every *newly created* auth user to 'user' — so when
-- future businesses/teammates get invited via the Supabase dashboard, they
-- land as a normal user and have to be promoted explicitly, never the
-- reverse. The one-time backfill below instead makes every auth user that
-- already exists at migration time an 'admin' (today that's just Jordan,
-- the sole existing account) so nobody gets locked out of Logs by this
-- migration.
--
-- Additive and idempotent, matching migrations 001-012.

create table if not exists user_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- Backfill: existing accounts become admin (see note above).
insert into user_profiles (id, role)
select id, 'admin' from auth.users
on conflict (id) do nothing;

-- New signups/invites default to 'user'.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();
