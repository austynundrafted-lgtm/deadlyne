# Account deletion: implementation, retention and verification

Implemented October 26, 2026 for the Tauri macOS and iPadOS applications. This is the account-deletion review record, not a certification that the entire application is ready for App Store submission.

## Architecture audited

Both shipping platform targets use the same React/shadcn interface, Zustand state and Supabase email/password client in `src/lib/auth.ts`. The original root Swift/AppKit reference application has no account system and requires no deletion flow.

The live Supabase project has four pre-existing email accounts. `public.profiles` is the only application data table before this feature; its primary key references `auth.users` with `ON DELETE CASCADE`. It contains email, approval status, name, credit and copyright. Profile reads/updates are restricted to the signed-in user. No app object-storage buckets or objects, photo synchronization, subscriptions, StoreKit, external billing or third-party sign-in were found. Email signup, password login and email-code recovery are implemented. The live project currently returns a session immediately on signup; code confirmation remains supported if enabled later.

A legacy live-only `delete_own_account` SECURITY DEFINER RPC could delete the current Auth user without fresh password verification. The new migration revokes client execution rather than leaving a second, weaker deletion path.

## User flow

1. macOS: Deadlyne → Settings… (⌘,) → Account → Delete Account. iPad: Home account menu → Account settings… → Delete Account. Both use the existing settings dialog and shared rules. Pending/disabled users also have Delete Account on the approval screen.
2. The confirmation explains permanent removal, retained local work and the need for an account to reopen Deadlyne. Cancel receives initial focus. The final destructive action requires the current password. iPad deletion controls have a minimum 44-point target; the dialog scrolls when space is constrained. Account dialogs use [WebKit's Dynamic Type body font](https://webkit.org/blog/3709/using-the-system-font-in-web-content/), relative text sizes, wrapping buttons, increased-contrast styling and reduced-motion-aware progress indicators.
3. The client persists a random 256-bit receipt before sending anything destructive. It suppresses duplicate submissions and profile synchronization during the operation. Passwords are held only in memory and sent over HTTPS to the configured account function; they are never persisted or logged.
4. The function validates the bearer token against Supabase Auth, derives the identity/email from that response and verifies the current password in an isolated session. Client-supplied target user IDs are ignored. Email is the only supported provider; adding Apple/OAuth requires provider reauthentication/revocation before enabling that method.
5. The function writes the hashed receipt, then calls the server-only Auth hard-delete API. A BEFORE DELETE trigger clears the receipt's user link and records completion in the same transaction as Auth deletion and profile cascade. Failed transactions cannot leave a completed receipt.
6. Success is returned only after reading the committed completion receipt. Auth-dependent identities, sessions and refresh tokens are deleted by their existing cascades. The temporary verification session is disposed on failure too.
7. The client durably records confirmation, signs out locally, clears account tokens/offline authorization, the cached photographer profile and transient caption clipboard, then removes the recovery marker. The signed-out screen announces completion. A disk failure preserves confirmed proof so cleanup can resume after restarting, including offline.

Deletion is synchronous. “Unconfirmed” means a response or dependency failed; it does not promise that a background deletion has been scheduled. Status checks are read-only. Retrying uses the same receipt and is safe after completion. A lost response can be confirmed without a surviving account session. Missing receipts, timeouts, sign-out and a missing profile never count as proof of deletion. Returning to sign-in from recovery signs out locally and explicitly does not cancel an already sent request.

## What is deleted and retained

| Data | Behavior |
|---|---|
| Supabase Auth account, login email, password verifier, identities, sessions and refresh tokens | Hard-deleted; old password and refresh tokens cannot restore the account. |
| Synced photographer name, credit, copyright, email and approval status | Profile row cascades with Auth deletion. |
| This device's saved account credentials, offline authorization and personal profile | Removed after confirmed deletion; other devices remove their caches when they next validate online. Ordinary sign-out also removes the profile cache. |
| Original RAW/JPEG, Photos originals, external drives, memory cards, exports and deliverables | Untouched. Deletion invokes no media/file operations. |
| Sidecars, embedded IPTC, captions and independently saved metadata | Untouched, including photographer credits already written into photos. |
| Local rosters/code-replacement dictionaries and their activation/column settings | Retained. These are device-owned files/settings, not cloud account records. |
| Library/collections, favorites, review progress, recent shoots, ingest/export preferences and FTP server settings/keychain secrets | Retained. These belong to the device's photography workflow. |
| iPad documents/app-managed shoot folders and imported copies | Retained in the app container. Deleting an account does not uninstall the app. |
| Account ingest/export presets | Implemented November 4, 2026 in `workflow_presets`; owner FK to `auth.users` cascades on hard deletion. This device drains pending cache writes and clears `account-presets.json` on sign-out/deletion. Other devices clear it when their sign-in is invalidated. Portable preset names/options are cloud account data; currently applied device options remain in the local workflow preferences. |
| Caption templates/account-specific cloud projects | None implemented. Existing caption clipboard is cleared; saved metadata and device workflow preferences remain. An account is required to use the gated application again. |
| Receipt | Client keeps raw proof only until cleanup/explicit return to sign-in. Server stores only its hash, an account FK while unconfirmed, and timestamps. Completion removes the FK. Completed hashes are eligible after 30 days and removed on the next function invocation; this is opportunistic cleanup, not a scheduled deadline. |
| Billing/subscription/tax records | None implemented or discovered; deletion does not claim to cancel an Apple subscription. Add billing disclosures/management if subscriptions are introduced. |
| Provider infrastructure logs and backups | The feature does not selectively purge Supabase's operational logs/backups. Their configured provider retention still applies. Publish the applicable retention in the privacy policy; do not promise immediate erasure from all backups. |

Previously issued JWTs can exist until expiration. The app validates the user against Auth, and the deleted profile is unavailable through RLS. Online foreground devices validate on launch, focus, visibility/reconnect and every 60 seconds while visible. Offline devices may retain their previously confirmed authorization for the remainder of the existing 30-day grace; no remote wipe is possible while disconnected. Background profile sync uses update-only requests and discards stale responses; it cannot recreate deleted Auth/profile rows.

## Server security and deployment

Files: `functions/delete-account/index.ts` (Supabase adapter), `handler.ts` (HTTP policy), `migrations/20261027011400_account_deletion_receipts.sql` (receipt transaction/security), and `config.toml`.

Apply migrations first, then deploy `delete-account`. The function uses Supabase-provided `SUPABASE_SERVICE_ROLE_KEY` only in the server runtime. Platform `verify_jwt=false` is intentional: delete requests explicitly validate Auth and password, while status checks disclose only completed/unconfirmed/not-found to possession of a cryptographically random receipt. RLS and revoked grants deny client access to the receipt table; having no public policies is intentional. The trigger function cannot be called by clients. The legacy RPC's execute grants are revoked.

The function returns sanitized errors, uses no-store responses, accepts POST/OPTIONS only and bounds request/password sizes. Supabase password verification applies provider authentication throttling. Do not add request-body logging. If cloud storage, new tables, billing, OAuth or Apple sign-in are added, extend deletion and tests before shipping them.

## Verification record

November 4, 2026 preset extension: PostgreSQL migration/RLS tests cover two-owner isolation, restricted columns, portable settings, revision conflicts and cascade deletion with receipt proof. The expanded live fixture harness verifies cross-session preset reads, rejected forged owners/paths, stale edits/deletions and preset removal for active/pending account deletions; all four original accounts are preserved. Preset sync tests cover offline access, stale responses and cache-write/cleanup races. The confirmation UI now explicitly includes account presets in the permanent deletion and local cache disclosures.

- `npm test`: 38 tests pass across five files. Includes 13 backend policy tests, eleven deletion-coordinator tests, seven auth/cache tests and seven existing application tests.
- Backend tests cover unauthenticated/expired sessions, wrong passwords, forged target IDs, reauthenticated identity mismatch, future OAuth rejection, transaction/preparation failures, confirmation-read failures, concurrent requests and receipt recovery.
- Client tests cover offline rejection, durable proof before dispatch, lost responses, repeated submissions, expired-session reauthentication, restart recovery, confirmed cleanup failures, stale profile responses, other-device invalidation and bounded offline grace. They verify workflow settings/FTP records are preserved and account cache writes cannot race cleanup.
- Live disposable-account tests exercise real signup/login, separate sessions, password rejection, private receipts, revoked legacy RPC, concurrent hard deletion, receipt-only recovery, repeat safety, forged-target isolation, password and refresh-token rejection, and pending-account deletion. SQL verifies actual Auth/profile/session removal and removal of receipt user links. Test accounts and only their receipts are cleaned afterward; existing accounts are preserved.
- macOS standalone release bundle and iPad arm64 Simulator release build succeed. The Mac app was opened and verified through ⌘, → Account → Delete Account; accessibility inspection confirms Cancel initially focused, the password field labeled, and the destructive button disabled without a password. Escape safely returns to Home. Screenshot: `.verification/account-deletion-mac-confirmation.png`.
- The updated iPad app was installed, launched and observed on Home with the existing account and stats. Interactive host verification was interrupted by the Mac locking. The simulator stream is visible in Codex; final iPad dialog/touch checks and full destructive UI testing remain manual follow-ups. Server lifecycle and shared client state-machine coverage above are separate from that manual UI coverage.
- No real shoot is opened for deletion testing. The deletion module has no media/file APIs; preservation is checked through storage-boundary tests rather than touching client shoots. Live SQL confirms zero remaining Auth/profile/session rows for both disposable accounts, four existing accounts retained, and anonymized completion receipts. Only those test receipts were removed afterward.

Repeatable live harness: from `desktop/`, after a Supabase CLI management login, run `DEADLYNE_ACCOUNT_DELETION_LIVE=1 node scripts/test-account-deletion-live.mjs`. It creates and deletes only users marked as fixtures from that run, verifies the pre-existing account set and removes only its own receipt hashes. It holds management keys in process memory and never writes them to the app. The implementation session also tested through public signup plus SQL inspection when the CLI login was unavailable.

## App Store account-deletion checklist

Based on Apple's [account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion).

- [x] Deletion can be initiated inside both platform apps, including pending/disabled accounts.
- [x] Permanent account removal, with clear confirmation and reasonable password reauthentication.
- [x] No requirement to call support, visit an unrelated site or disable the account first.
- [x] Actual server Auth/profile cleanup and dependent session/token removal.
- [x] Local photography assets and independently saved work retained and described accurately.
- [x] Honest offline/error/unconfirmed states; completion requires server proof.
- [x] Other-device validation and protection against cached profile recreation.
- [x] No current third-party sign-in or subscriptions requiring additional revocation/billing flows.
- [ ] Publish/verify the public privacy policy, contact/support details and actual Supabase operational retention; align App Store Connect privacy answers with account/profile collection.
- [ ] Add reviewer navigation notes and an expendable review account. Reviewers must be able to create/delete an account; keep invite/approval behavior clear.
- [ ] Complete real-device iPad, VoiceOver, large-text/high-contrast and full manual destructive UI testing on disposable accounts before submission. Shared code tests and simulator/macOS UI checks do not replace this accessibility/device pass.
- [ ] Complete the separate release requirements: paid Apple Developer membership, distribution signing/provisioning, device archives/TestFlight, Mac App Store sandbox/entitlements review, screenshots/listing/privacy metadata and broader photography workflow QA.

Supabase's security advisor still reports the pre-existing [leaked-password protection setting is disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Enabling it is a separate authentication-hardening decision. The receipt table's “RLS enabled, no policies” informational notice is expected because clients must have no access.
