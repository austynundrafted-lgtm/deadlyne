-- Deadlyne accounts: one profile row per user. It gates who can open the app (status) and keeps
-- the photographer profile (name, credit line, copyright) so it follows the user between computers.
--
-- Invite-only instead of open sign-up? Run this after the migration, then approve people by setting
-- their status to 'active' in Table Editor → profiles:
--   alter table public.profiles alter column status set default 'pending';

create type public.account_status as enum ('active', 'pending', 'disabled');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  status public.account_status not null default 'active',
  name text not null default '',
  credit text not null default '',
  copyright text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Users may edit their photographer details but never their own status or email.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (name, credit, copyright) on public.profiles to authenticated;

-- A profile is created with every new account.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Accounts that already existed before this migration.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
