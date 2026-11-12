# Mac App Store readiness

Updated November 4, 2026. Shipping code is in `desktop/`, public version 0.3.6. Build 4 (0.3.6) includes the UI audit fixes and is available to the existing Internal Testing group (one tester), with matching debug symbols. App Store Connect compliance is cleared; the owner selected current US internal testing only, without France. Builds 1–3 remain in TestFlight. The initial release is free; the owner is enrolled in the Apple Developer Program.

## Store build

A separate Mac App Store channel builds a sandboxed universal app for Apple Silicon and Intel. Xcode automatic signing registered `app.deadlyne.desktop` under team `9DBN5W48YV`, created its matching managed provisioning profiles, and exported an installer using Apple Distribution and Mac Installer Distribution signatures. Cloud-managed signing keeps private distribution keys with Apple. TestFlight distribution is separate from App Store review.

Use the latest `.verification/mac-app-store/signed/build-report.json` to locate the final verified package, its SHA-256, archive, and extracted distribution-signed application. Generated artifacts, profiles and signing material stay out of Git.

```sh
npm ci
npm run build:store:check -- --build-number 1
npm run build:store -- --automatic --team 9DBN5W48YV --build-number 1
```

Automatic signing requires an authenticated Xcode developer account with the team's signing privileges, Xcode command-line tools, and XcodeGen. Set `XCODEGEN` if it is outside PATH. The script also recognizes the existing local XcodeGen installation on this Mac. Install both Rust desktop targets for a universal build. Each new submission needs an increased build number.

The check build is `Deadlyne Store Check`, identifier `app.deadlyne.store-check`, with a separate sandbox container and app-owned workflow records. It is ad-hoc signed and cannot be submitted. It does not replace `/Applications/Deadlyne.app`.

For manually managed certificates, omit `--automatic` and provide `DEADLYNE_STORE_PROFILE`, `DEADLYNE_STORE_APP_IDENTITY` and `DEADLYNE_STORE_INSTALLER_IDENTITY`. The script rejects profiles for other apps, development/device profiles, expired profiles and identities without installed private keys. Keep these inputs private.

The build script verifies the exported installer signature, embedded profile, team and app IDs, sandbox entitlements, absence of debugger access, version/build number, and both architectures. It compares Mach-O UUIDs to ensure Xcode exported the actual Tauri executable. Updater and legacy notification dependencies are forbidden in the store graph; final binaries are checked for known updater/private notification markers. These are local checks, not Apple's server validation.

Store builds preserve line-level Rust debug information in per-architecture dSYMs at compilation, merge them into the Xcode archive, and verify both UUIDs and source locations. Enable symbol upload when distributing the archive; the older build 1 did not include these symbols. Build numbers must increase for every upload.

## Engineering completed

- `tauri.appstore.conf.json`, Cargo features and the store capability file provide a compile-time store channel. GitHub updater, restart API, updater controls and legacy notification backend are excluded. Direct-download releases retain their existing update channel.
- Store builds use a CSP restricted to bundled scripts/styles, native image schemes, IPC and the configured Deadlyne account endpoint.
- Native `NSOpenPanel` pickers save app-scoped security bookmarks and return through a Tauri channel, without keeping a WebKit IPC request open while browsing Files. IO leases balance security scopes around scans, metadata, previews, captions, copies/moves, ingest, export, documents and FTP.
- Bookmarks restore before library and workflow destinations load. Renamed folders update local paths. Unrecognized/denied folder access uses a native authorization picker. A photo grant does not silently grant its containing folder.
- App-owned workflow data lives in the sandbox container. Settings → Local data explicitly imports old library/preferences and roster/viewing folders. Imports merge current records, copy exclusively and exclude sign-ins, profile/account caches and passwords. Shoot files remain on the photographer's drives.
- `NSWorkspace`, `QLPreviewView` and public `UserNotifications` APIs replace command-line opening, reveal, Quick Look, ejection and the old notification implementation in the store channel. Active FTP has the required incoming-network entitlement; passive delivery uses outbound access.
- Account-owned ingest/export presets are deployed to the correct Deadlyne Supabase project (`iegbzschruonupznrgda`). Only portable options sync. Folder paths, job names, sequence counters, photographs, captions, rosters and FTP credentials stay local. Ownership RLS, revision checks, offline cache and account-deletion cascade are implemented.

## Verification evidence

- 82 JavaScript/PostgreSQL tests pass. Default desktop Rust and store-feature Rust suites each pass 24 tests; six opt-in integration tests are ignored by default.
- Production frontend, ad-hoc sandbox app, universal Rust executable, Xcode archive and distribution export succeed.
- The actual sandboxed check app signed into a disposable active account, selected a scratch folder, displayed grid/loupe images, wrote tags/ratings/XMP and embedded JPG captions, ingested a JPG, and exported captioned files.
- A 2000-pixel scratch JPG exported at 1200 pixels with its caption. Repeating an export preserved the earlier file and added a collision suffix.
- Relaunch restored folder and destination permissions; an externally renamed scratch folder followed its bookmark and reopened without another grant. Native Quick Look displayed a scratch text document.
- Actual sandbox passive and active FTP sends to a loopback-only disposable server both matched the source JPGs byte for byte. Legacy setup imported a roster and allowed device options while preserving the current profile and excluding credentials. The disposable account and its isolated local stores were removed; all four pre-existing accounts remain.
- Earlier live account/preset deletion harness: 30 checks pass, including second-session sync, cross-account isolation, forbidden private paths, stale revisions and deletion cascades. The four pre-existing accounts were preserved.
- Verification uses disposable account data and artwork-derived scratch JPGs. Real client shoots and the installed app's settings are not test fixtures. Automated tests and local UI checks do not establish complete hardware, accessibility or supported-OS compatibility.

## Before uploading or requesting App Review

The signed build is one part of submission. These release tasks remain:

1. The macOS App Store Connect record for `app.deadlyne.desktop` exists (Apple ID `6830865299`), and build 4 passed Apple upload processing and is assigned to Internal Testing. Use TestFlight for a clean installation/update check on another Mac; test Intel if advertising Intel support. The configured minimum is macOS 12.0, while this machine runs macOS 26.
2. Publish support/contact and privacy-policy URLs, and link the policy in the app before signup. Disclose email/account identity, synced profile and presets, Supabase hosting/log/backup retention, offline caches and explicit FTP delivery. Finish App Privacy and inspect SDK privacy-manifest requirements accurately for macOS.
3. Make public account approval deliberate: new profiles default to active (open sign-up since November 9, 2026). Supply an active reviewer login, sample media/roster and steps for presets/account deletion. Mandatory login remains an App Review consideration even with useful account sync; do not add unrequested cloud photo storage.
4. Finish name/subtitle/description/keywords, Photography category, screenshots with display permission, copyright, age rating, content rights, encryption/export compliance, free pricing, territories and applicable trader declarations. Legal declarations require the owner's accurate information.
5. Complete external/removable-drive and failure tests (disconnect/full disk/revoked access), notifications, Finder/Dock/drop entry points, FTP/FTPS server compatibility, keyboard/VoiceOver and supported-OS checks. Review the existing recovered/uncommitted work before selecting and committing a release baseline.

The account backend has email/password signup, recovery, bounded 30-day offline grace and in-app deletion with server receipts. Apple sign-in is disabled; email confirmation is currently automatic. Keep `supabase/ACCOUNT_DELETION.md` and its live fixture harness aligned with any future account changes.

References: [Tauri store packaging](https://v2.tauri.app/distribute/app-store/), [Apple cloud-managed signing](https://developer.apple.com/help/account/certificates/cloud-managed-certificates), [sandbox file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox), [App Review guidelines](https://developer.apple.com/app-store/review/guidelines/), [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).
