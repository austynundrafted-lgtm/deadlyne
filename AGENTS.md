# Deadlyne: guide for AI agents

Read this before changing anything. It covers what the app is, who it's for, the rules that must not be broken, and the conventions for the code. [desktop/README.md](desktop/README.md) has the feature list, the code layout, the commands and the release process; this file is the engineering view.

> **One codebase: `desktop/`.** Deadlyne for macOS **and Windows**, built with Tauri 2. Rust in `desktop/src-tauri` does files, RAW previews, EXIF, sidecars and thumbnails; the interface in `desktop/src` is React + Tailwind + **shadcn/ui only**, designed "less is more" (reusable components, fewest steps). It updates itself from GitHub Releases.
>
> The original Swift/AppKit Mac app was removed from the repo on 2026-10-20 (it's in git history before that). Its users' data still matters: the desktop app reads its lookup files from `~/Library/Application Support/Deadlyne/Code Replacements/` and imports its badge progress from `~/Library/Preferences/app.deadlyne.Deadlyne.plist` (`achievements.rs`). Keep both working.

---

## 1. What Deadlyne is

Deadlyne is a photo browser and culler for **sports photographers on deadline**, built to replace Photo Mechanic.

The owner shoots high-school sports on a **Canon EOS R3** in RAW+JPEG (`MCD_0001.CR3` + `MCD_0001.JPG`, around 2,000 frames and 78 GB per game). They edit in Lightroom and know Photo Mechanic's workflow well. After a game they:

1. **Ingest** the memory card into a dated or job-named folder.
2. **Cull**: flip through thousands of frames instantly, then tag, star-rate and color-label the keepers.
3. **Caption**: IPTC headline, caption, keywords and credits, typed quickly with **code replacements** (`=f10=` → "Jordan Sample (10)").
4. **Deliver**: export or send the tagged JPGs to the client or wire service by FTP, then open the RAWs in Lightroom, which reads Deadlyne's ratings from the XMP sidecars.

The whole product is **speed**. Every feature is judged by whether it gets a photographer from card to delivered captions faster.

### The speed trick
Deadlyne **never decodes RAW sensor data**. Every RAW file contains JPEGs the camera already rendered. `raw.rs` parses the container (CR3 as ISO-BMFF, TIFF-based RAWs as IFD chains, Fuji RAF), seeks straight to the embedded JPEG, and decodes only that. A CR3 holds a 160×120 thumbnail, a 1620×1080 preview and a full 6000×4000 JPEG.

---

## 2. Non-negotiable rules

1. **Speed first.** Keep heavy work in Rust on rayon or `spawn_blocking`, never on the interface thread. Visible thumbnails always load first, and culling feedback is instant.
2. **Never destroy the user's data.**
   - Never overwrite existing files during copy, move, ingest or export. Name collisions get `-1`, `-2`…; never add an overwrite option.
   - "Delete" always means the **Trash or Recycle Bin**, never permanent deletion.
   - XMP sidecars are **edited in place**. Only Deadlyne's own properties are touched, and Lightroom/Camera Raw develop settings (`crs:`) are never clobbered.
   - JPEG caption embedding rewrites **metadata segments only**, so the image data stays byte-identical.
3. **Stay compatible with Adobe and Photo Mechanic.** Ratings and labels go in `xmp:Rating` and `xmp:Label`. Captions use standard IPTC-in-XMP properties plus legacy IPTC-IIM in JPGs. Lookup files use Photo Mechanic's tab-delimited format. Old sidecars may contain `lensdesk:Tagged` and must still be read.
4. **The user's real shoots are read-only for testing.** Their shoot folders are real client work. Test on **copies** in a scratch folder.
5. **Don't pollute the user's stats.** Opening a folder adds it to Home's recent shoots and to the badge counts. After testing with a scratch folder, remove it from `recents` in `~/Library/Application Support/app.deadlyne.desktop/settings.json` and from `~/Library/Application Support/Deadlyne/achievements.json`. Back both up first.
6. **The user runs the app themselves.** Don't quit or relaunch a running Deadlyne without saying so.
7. **Wording and accounts.** Say "ingested" for cards and "sent" for FTP, never "uploaded".
   - Deadlyne is gated behind a Supabase sign-in (asked for by the user on 2026-09-15). Supabase stores only the account status and the photographer profile (name, credit, copyright). Photos, captions, rosters and FTP passwords never leave the computer. Don't add other cloud features unless asked.
   - Never put a Supabase service_role/secret key in the app or the repo. Only the publishable key ships, and row level security enforces access.
8. **Home should feel like a pro tool, not a SaaS dashboard.** The path from launch to images stays dominant.
9. **Badge ids are permanent** (`photos-100`, `shoots-1`…). Earned badges are stored by id. Never rename ids.
10. **Never commit `~/.tauri/deadlyne-updater.key`.**

---

## 3. Build, run, verify

- **Run:** `cd desktop && npm run tauri dev`. Without `.env.local`, development builds offer "Continue without signing in".
- **Checks:** `npx tsc --noEmit`, `npm test` (code replacement engine, shoot names) and `cd src-tauri && cargo test` (sidecars, JPG embedding, rosters, ingest naming, export).
- **Quick Mac .app:** `npx tauri build --debug --bundles app`.
- **Release:** see "Releasing an update" in [desktop/README.md](desktop/README.md). Bump with `npm run release -- <version>`. It doesn't touch `src-tauri/Cargo.lock`, so bump the `deadlyne` entry there too.
- **Signing:** the Mac build is ad-hoc signed (`"signingIdentity": "-"`). The user is enrolling in the paid Apple Developer Program; once they have a Developer ID certificate, add the `APPLE_*` secrets to the release workflow for signing and notarization.
- **Bundle ID:** `app.deadlyne.desktop`. The old Swift app was `app.deadlyne.Deadlyne` (and before that `app.lensdesk.LensDesk`).

---

## 4. Desktop specifics

- **Sign-in:** `src/lib/auth.ts` + `components/AuthGate.tsx`; backend SQL and setup in `desktop/supabase/`. Config comes from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local` locally, repository variables in CI). Keep offline use working: a confirmed sign-in lasts `OFFLINE_GRACE_DAYS` without network.
- **Export:** `src-tauri/src/export.rs` + `lib/export.ts` + `components/ExportDialog.tsx`. The interface decides names (`exportName`, tokens `{shoot} {seq} {original} {date} {time} {camera}`) and Rust copies or resizes. A resized JPG is re-encoded upright from the full-size decode, then the original's EXIF (orientation set to 1, pixel size patched), XMP, ICC and Photoshop/IIM segments are carried over, so captions never need re-embedding. Files go out in parallel on rayon, with name collisions resolved under one lock.
- **FTP:** `src-tauri/src/ftp.rs` + `lib/ftp.ts`. Passwords go only to the keychain (`keyring`). FTPS uses rustls so data connections resume the TLS session; don't switch back to native-tls. Never make "Replace" the default when a remote file exists.
- **New IPTC fields:** add them to `iptc.rs` (`Field`, `Captions`), `IIM_MAP` in `jpeg_meta.rs` if IIM has a dataset (plus its length in `IIM_LIMITS` in `lib/api.ts`), and `CAPTION_FIELDS` / `FIELD_LABELS` / `emptyCaptions` in `lib/api.ts`, then place the input in `CaptionPanel.tsx`.
- **Images:** never pass image bytes through JavaScript; use the `thumb://` / `preview://` schemes in `images.rs`.
- **Code replacements:** `lib/codes.ts` (engine) + `codes.rs` (files) + `components/CodesView.tsx`. `=code=` gives column #1 and `=code#2=` column #2; the delimiter is user-selectable and `#` is reserved. Codes are case-insensitive, and an unknown code stays as typed. When two active files share a code, the file whose name sorts first wins.
- **Keyboard shortcuts** live in `lib/hotkeys.ts`. Culling keys are bare letters and digits (`T`, `0–5`, `6–9`), so don't reuse those for other commands.

---

## 5. UI conventions

- **Add UI only from shadcn** (`npx shadcn@latest add …`).
- **Dark only.** Colors are the shadcn variables in `src/index.css`. Each workspace has its own color: Home orange (`--workspace-home`), Photos amber (`--workspace-photos`, also selection, stars and Tagged), Codes green (`--workspace-codes`). Label colors are `--label-*`.
- **Polish rules:**
  - For depth, use `shadow-edge` / `shadow-edge-hover` (defined in `index.css`), not borders.
  - Name the exact transition properties; never use `transition-all`.
  - `Button` shrinks to 0.96 when pressed. Pass `static` for controls hit over and over, like the grid's tag and stars.
  - Nested corners are concentric (outer radius = inner radius + padding).
  - Swap state icons with `IconSwap`.
  - Show the selected item with a fill (`bg-accent`, or the workspace color at /15), never a stroke on one side.
  - Tailwind's base style caps `<img>` at `max-width: 100%`; set `maxWidth: "none"` on anything drawn larger than its box (the loupe at 100%).
- **Copy style:** short, plain, and specific to the photographer's job. Tooltips explain *why*. Keyboard shortcuts appear in tooltips.

---

## 6. Roadmap ideas (from the user and past sessions)

- **Deferred:** caption templates ("stationery pad" per team or venue), a ⌘K launcher, ingest presets, a backup destination during ingest, metadata presets, account features.
- **Culling and ingest:** side-by-side compare, watched ingest from several cards at once, a disk thumbnail cache for network drives, rename in place with templates.
- **Code replacements:**
  - generate a lookup file from a pasted roster (`#`, name, position) with a team prefix
  - per-shoot sets of active files
  - an autocomplete popup while typing a code
  - `=code#0=` for the code itself
  - export a merged Photo Mechanic file
- **Delivery:** still open: SFTP, resizing JPGs on the way to FTP (reuse `export::resize_jpeg`), exporting JPGs from RAW-only shoots using the embedded preview plus the sidecar's captions, a "sent" badge on photos, and a setting to accept a self-signed FTPS certificate.

When you finish a feature: run the checks, verify it in the running app on scratch copies, clean up any test entries in stats, update [desktop/README.md](desktop/README.md) (user-facing) and this file (engineering), and tell the user plainly what you verified and what you didn't.
