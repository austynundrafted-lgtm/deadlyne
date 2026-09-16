# Deadlyne accounts (Supabase)

Deadlyne desktop opens only for a signed-in account. Supabase handles sign-in; the `profiles` table decides who is allowed in and keeps each photographer's name, credit line and copyright.

## One-time setup

1. **Create a project** at [supabase.com](https://supabase.com).
2. **Create the table.** Open SQL Editor, paste [`migrations/20260915120000_profiles.sql`](migrations/20260915120000_profiles.sql) and run it. (Or, with the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Connect the app.** In Project Settings → API Keys, copy the Project URL and the **publishable** key (older projects call it `anon`).
   - Local development: copy `desktop/.env.example` to `desktop/.env.local` and fill both in.
   - Releases: add them as GitHub repository **variables** (Settings → Secrets and variables → Actions → Variables) named `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The release workflow refuses to build without them.
   - Never use the `service_role` / secret key in the app.
4. **Email codes.** Deadlyne is a desktop app, so it asks for the 6-digit code from the email instead of opening a link. In Authentication → Emails → Templates, add `{{ .Token }}` to:
   - **Confirm signup**, e.g. `Your Deadlyne code is {{ .Token }}`
   - **Reset password**, e.g. `Your code to reset your Deadlyne password is {{ .Token }}`
5. **Email sending.** Supabase's built-in email is rate limited and meant for testing. Before inviting other photographers, set up custom SMTP in Authentication → Emails → SMTP Settings.

## Who can get in

- **Open sign-up (default):** anyone can create an account and use the app.
- **Invite-only:** run `alter table public.profiles alter column status set default 'pending';`. New accounts see "waiting for approval" until you set their `status` to `active` in Table Editor → profiles. To stop new accounts entirely, turn off "Allow new users to sign up" in Authentication → Sign In / Providers and invite people from Authentication → Users.
- **Turn someone off:** set their `status` to `disabled`. They're locked out the next time Deadlyne checks in with the server.

## Offline

Photographers often work where there's no internet. After a successful check-in, Deadlyne keeps working on that computer for up to 30 days without reaching Supabase (`OFFLINE_GRACE_DAYS` in `src/lib/auth.ts`). A disabled account is locked out as soon as the app is back online.

## What's stored where

| What | Where |
|---|---|
| Session (tokens) | `auth.json` in the app's data folder, beside `settings.json` |
| Account status, photographer profile | `public.profiles` in Supabase |
| FTP passwords | the system keychain only, never Supabase |
| Photos, captions, ratings | only on your drives |
