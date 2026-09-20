# Deadlyne accounts (Supabase)

Deadlyne desktop opens only for a signed-in account. Supabase handles sign-in; the `profiles` table decides who is allowed in and keeps each photographer's name, credit line and copyright.

## One-time setup

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Create the table.** Run the files in [`migrations/`](migrations) in order, oldest first — paste each into the SQL Editor, or use the Supabase CLI (`supabase link` then `supabase db push`). Paste the file's *contents*, not its path.
3. **Connect the app.** In Project Settings → API Keys, copy the Project URL and the **publishable** key (older projects call it `anon`).
   - Local development: copy `desktop/.env.example` to `desktop/.env.local` and fill both in.
   - Releases: add them as GitHub repository **variables** (Settings → Secrets and variables → Actions → Variables) named `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The release workflow refuses to build without them.
   - Never use the `service_role` / secret key in the app.
4. **Email codes.** Deadlyne is a desktop app, so it asks for the 6-digit code from the email instead of opening a link. The stock templates send a link to a `localhost` address that nothing is listening on, so in Authentication → Emails → Templates replace the body with `{{ .Token }}`:
   - **Confirm signup**, e.g. `Your Deadlyne code is {{ .Token }}` — only needed while email confirmation is on (see below).
   - **Reset password**, e.g. `Your code to reset your Deadlyne password is {{ .Token }}` — needed either way, or "Forgot password?" dead-ends.
5. **Email sending.** Supabase's built-in email is rate limited and meant for testing. Before inviting other photographers, set up custom SMTP in Authentication → Emails → SMTP Settings.

## Who can get in

Two independent switches decide this, and both matter:

| | Where | Effect |
|---|---|---|
| Can they create an account? | Authentication → Sign In / Providers → Email → "Allow new users to sign up" | Off means nobody new, full stop. Invite people from Authentication → Users. |
| Does a new account open the app? | `profiles.status` default (this repo's migrations) | `pending` means they wait for you; `active` means straight in. |

**Currently: anyone may sign up, and every new account lands in `pending`** — they see "waiting for approval" until you set their `status` to `active` in Table Editor → profiles. Back to open sign-up with `alter table public.profiles alter column status set default 'active';`.

**Turn someone off:** set their `status` to `disabled`. They're locked out the next time Deadlyne reaches the server — within `OFFLINE_GRACE_DAYS` if they're offline, immediately if they're not.

**Email confirmation** is a third, separate switch (Authentication → Sign In / Providers → Email → "Confirm email"). With it **off**, sign-up needs no email at all and the app opens as soon as the account is approved. With it **on**, the Confirm signup template must carry `{{ .Token }}` or new users hit a dead link.

## Offline

Photographers often work where there's no internet. After a successful check-in, Deadlyne keeps working on that computer for up to 30 days without reaching Supabase (`OFFLINE_GRACE_DAYS` in `src/lib/auth.ts`). A disabled account is locked out as soon as the app is back online.

## What's stored where

| What | Where |
|---|---|
| Session (tokens) | `auth.json` in the app's data folder, beside `settings.json` |
| Account status, photographer profile | `public.profiles` in Supabase |
| FTP passwords | the system keychain only, never Supabase |
| Photos, captions, ratings | only on your drives |
