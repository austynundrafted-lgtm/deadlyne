# Deadlyne accounts (Supabase)

Deadlyne's Tauri Mac and iPad apps open only for a signed-in account. Supabase handles sign-in; the `profiles` table decides who is allowed in and keeps each photographer's name, credit line and copyright.

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
6. **Deploy account deletion.** Apply the receipt migration before deploying the function: `npx supabase functions deploy delete-account --project-ref YOUR_PROJECT_REF`. Run from `desktop/`, using `supabase/config.toml`. The function authenticates delete requests itself with server-side `getUser` plus current-password verification; platform JWT verification is disabled so opaque receipt status remains available after the account is gone. Supabase supplies the function's privileged environment variables; never copy them into a Vite environment file. See [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md).

## Who can get in

Two independent switches decide this, and both matter:

| | Where | Effect |
|---|---|---|
| Can they create an account? | Authentication → Sign In / Providers → Email → "Allow new users to sign up" | Off means nobody new, full stop. Invite people from Authentication → Users. |
| Does a new account open the app? | `profiles.status` default (this repo's migrations) | `pending` means they wait for you; `active` means straight in. |

**Currently: anyone may sign up, and every new account lands in `active`**, so it opens Deadlyne straight away (open sign-up since November 9, 2026). Back to invite-only with `alter table public.profiles alter column status set default 'pending';`. New accounts then see "waiting for approval" until you set their `status` to `active` in Table Editor → profiles.

**Turn someone off:** set their `status` to `disabled`. They're locked out the next time Deadlyne reaches the server — within `OFFLINE_GRACE_DAYS` if they're offline, immediately if they're not.

**Email confirmation** is a third, separate switch (Authentication → Sign In / Providers → Email → "Confirm email"). With it **off**, sign-up needs no email at all and the app opens as soon as the account is approved. With it **on**, the Confirm signup template must carry `{{ .Token }}` or new users hit a dead link.

## Offline

Photographers often work where there's no internet. After a successful check-in, Deadlyne keeps working on that computer for up to 30 days without reaching Supabase (`OFFLINE_GRACE_DAYS` in `src/lib/auth.ts`). A disabled account is locked out as soon as the app is back online. A deleted account loses server access immediately; another device clears its cached login/profile after validating Auth on launch, reconnect, foreground or the next visible one-minute check. A device that stays offline retains only its existing grace, which is never extended offline.

## What's stored where

| What | Where |
|---|---|
| Session (tokens) | `auth.json` in the app's data folder, beside `settings.json` |
| Account status, photographer profile | `public.profiles` in Supabase |
| Named ingest/export presets | `public.workflow_presets`, private to the owner through RLS; portable options only, with an account-scoped offline copy in `account-presets.json` |
| Interrupted deletion proof | Opaque random receipt in `auth.json`; SHA-256 hash in server-only `account_deletion_requests` |
| FTP passwords | the system keychain only, never Supabase |
| Photos, captions, ratings | only on your drives |

Deletion removes Auth, its dependent identities/sessions/tokens, the profile and account workflow presets. The receipt loses its user link in the same database transaction. Completed hashes become eligible for cleanup after 30 days and are purged on the next function request. Ordinary sign-out clears the cached personal profile and account preset list. Currently applied device workflow options remain. No local photography files, library records, code replacements or FTP credentials are removed. [Full retention and verification details](ACCOUNT_DELETION.md).

The `20261104184930_account_workflow_presets.sql` migration adds the preset table, explicit authenticated column grants, ownership policies, portable-settings constraints and a server-owned revision trigger. Edits/deletions compare the prior revision, so an older device cannot silently replace a newer edit. Presets sync when the app returns to the foreground, reconnects, or a preset dialog opens; selecting a preset is explicit and never starts an ingest/export. Saving changes requires a connection. Source/destination paths, job names, sequence counters, media, captions, rosters and FTP configuration are excluded from preset payloads. Database/RLS tests run with the normal `npm test` suite through a test-only in-memory PostgreSQL dependency. The live disposable-account harness also verifies the server policies and preset deletion cascades.
