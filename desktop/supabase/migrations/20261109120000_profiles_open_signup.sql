-- Open sign-up: a new account opens the app straight away instead of waiting for approval.
-- Also lets in everyone already waiting. Accounts set to 'disabled' stay locked out.
-- Back to invite-only: alter table public.profiles alter column status set default 'pending';
alter table public.profiles alter column status set default 'active';
update public.profiles set status = 'active' where status = 'pending';
