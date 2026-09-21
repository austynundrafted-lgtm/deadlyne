-- Invite-only: a new account waits for approval instead of opening the app straight away.
-- Approve someone by setting their status to 'active' in Table Editor → profiles.
-- To go back to open sign-up: alter table public.profiles alter column status set default 'active';
alter table public.profiles alter column status set default 'pending';
