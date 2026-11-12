-- Private, unguessable completion receipts let a client recover a lost HTTP response.
-- No email, password, access token or raw receipt is stored here. The user link is removed
-- atomically with auth.users deletion; a receipt alone grants no deletion permission.
create table public.account_deletion_requests (
  request_hash text primary key check (request_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((user_id is not null and completed_at is null)
      or (user_id is null and completed_at is not null))
);

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select, insert, delete on public.account_deletion_requests to service_role;
create index account_deletion_requests_user_id on public.account_deletion_requests(user_id);

create function public.complete_account_deletion_receipts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_deletion_requests
     set user_id = null, completed_at = now()
   where user_id = old.id;
  return old;
end;
$$;

revoke all on function public.complete_account_deletion_receipts() from public, anon, authenticated;
-- BEFORE runs before the FK's SET NULL. It participates in the Auth deletion transaction:
-- a failed deletion rolls the completion update back, along with the profile cascade.
create trigger complete_deadlyne_account_deletion
  before delete on auth.users
  for each row execute function public.complete_account_deletion_receipts();

-- An older live-only RPC was not wired into either app and bypasses reauthentication.
-- Preserve it for migration safety, but make the new authenticated Edge Function the path.
do $$
begin
  if to_regprocedure('public.delete_own_account()') is not null then
    revoke execute on function public.delete_own_account() from public, anon, authenticated;
  end if;
end;
$$;
