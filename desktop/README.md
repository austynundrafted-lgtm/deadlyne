# Deadlyne desktop (macOS + Windows)

The cross-platform version of Deadlyne, built with [Tauri 2](https://tauri.app). **Rust** does everything that touches files and must be fast. The interface is **React + Tailwind + shadcn/ui**. It installs from GitHub Releases and **updates itself**.

The original native Mac app (Swift/AppKit) still lives at the repo root and keeps working while features move over.

## What works today

- **Sign-in:** Deadlyne opens only for a signed-in account (Supabase). Create an account, confirm it with the 6-digit code from the email, or reset a password the same way. After signing in, it keeps working offline on that computer for up to 30 days. Invite-only is one setting on the server. Setup: [supabase/README.md](supabase/README.md).
- **Home:**
  - Ingest a card (⇧⌘I) or open a shoot (⌘O, or drop a folder on the window).
  - Recent shoots with readable names, a live ingest progress bar, this month's photos and the next badge.
- **Library and folders:**
  - A collapsible sidebar beside Photos (⌥⌘S, or the icon rail in narrow windows): All shoots, Recent, Favorites, Pinned, Collections, the shoot folders with their real subfolders, and the Archive. Arrow keys move through it; right-click for everything else.
  - Collections, pins, favorites and the archive are virtual: they never move or rename files. Drag a shoot onto a collection, Favorites or Archive. Renaming a folder on disk, making a new folder (⇧⌘N) and Move to Trash are separate, explicit actions.
  - Shoots show as folders in a grid or a list with photo and document counts. A folder that was moved or unplugged shows as missing, with Locate… to point at its new place.
  - **Documents:** add shot lists, briefs, rosters and other files to a shoot with Add files or by dropping them on the window. Choose to copy them into the shoot folder (nothing is replaced; a taken name gets `-1`) or link them where they are. They live under Documents, apart from the photos, with Quick Look (Space), open in the default app, rename, move and remove, and a details panel in the caption panel's place.
  - **Review progress:** a photo counts as viewed once its thumbnail has been at least half on screen for a second while Deadlyne is active, or when it's opened in the loupe; scrolling past doesn't count. Each folder remembers its viewed photos by file name, so sorting and filters never lose them; deleted photos drop out and new ones start unviewed. A parent folder adds up the folders inside it. Progress shows on folder cards, list rows, the sidebar, the folder bar and Home's recent shoots, and is separate from tags, ratings and captions.
  - **Continue reviewing (⌥⌘R)** goes back to the photo you were last reviewing (or the first unviewed one if it's gone) and marks it briefly. **Show unviewed only** (⌥⌘U) is in the Filter menu and the progress popover; Reset viewing progress… asks first.
- **Photos:**
  - An instant contact sheet for thousands of RAW+JPEG files, with pairing and capture-time order.
  - Search (⌘F) across file names, captions and keywords.
  - A slim filter bar (All / Tagged / Untagged, plus one Filter menu for rating, label and file type) and one actions menu.
  - Right-click menus on photos: show in Finder/Explorer (⇧⌘R) or open in the default app (⌘E).
  - When a filter hides photos, the status bar says "X of Y" with a Show all button.
- **Culling:** `T` tags, `0–5` rates, `6–9` sets red/yellow/green/blue labels. Arrows move, Space opens the loupe, Esc closes it. ⌘D deselects. Everything saves to Adobe-compatible XMP sidecars.
  - **Loupe:** `Z` or a click zooms to 100% at that point to check focus; drag or scroll pans, and a click or Esc fits it again.
  - **Auto-advance (⇧⌘A):** in the loupe, the next photo comes up after tagging, rating or labeling. Tagging a photo while showing Untagged also moves on instead of leaving the loupe empty.
- **Keyboard shortcuts:** press `?` (or Home → Shortcuts) for the full list.
- **Captions (⌘I):**
  - Headline, Caption and Keywords are always visible. Event & location, Credits and Wire & desk fold open.
  - Wire fields: Object Name, Photographer title (By-line Title), Source, Usage terms, Job ID (Transmission Reference), Caption writer, Special instructions and Country code. All but Usage terms are also written as legacy IPTC for wire systems.
  - Edits apply to every selected photo and save when you leave a field. Keywords merge across photos.
  - RAW photos keep captions in the sidecar. JPGs get XMP + legacy IPTC embedded without touching the image data; the camera's EXIF Artist/Copyright are filled too.
  - Variables like `{date}` and `{camera}` fill in per photo.
  - A field longer than legacy IPTC allows (Credit and Venue are only 32 characters) gets a warning, since older wire systems will see it cut off. XMP keeps the full text.
  - Copy/paste caption info with ⌥⌘C / ⌥⌘V.
  - Fill credits from your profile with ⌥⌘P.
- **Codes (⌘3):**
  - Photo Mechanic–style code replacements: `=f10=` becomes "Jordan Sample (10)", and `=f10#2=` gives column 2. Codes expand as you type or paste.
  - Several lookup files can be on at once. Right-click a file for "Use only this file", e.g. just tonight's two rosters. Import `.txt`/`.csv` rosters (or drop them on the window), then edit them as a table or as text.
  - Name columns, add a prefix to every code, and try codes out in the Try It box.
  - On macOS the rosters are shared with the original Swift app.
- **Ingest:**
  - Picks the card automatically and remembers your destination and naming.
  - `{date}_{job}` folders with optional renaming (`{job}_{seq}`). RAW+JPG pairs share a number.
  - Skips photos already ingested, verifies sizes, warns when the destination is short on space, and can eject the card.
  - Opens the new folder when it's done.
- **Export (⇧⌘E):** copies of the tagged photos or the selection for the client or the desk, from the title-bar button, the actions menu or a right-click. JPGs by default (RAW + JPG or RAW too), into a new folder named after the shoot inside the place you exported to last time. Resize JPGs to a long edge (1200 / 2048 / 3000 / 4000 px) with a quality choice: they come out upright and keep their EXIF, XMP captions, legacy IPTC and color profile. Rename with `{shoot}_{seq}` and the other tokens; pairs share a name. Nothing is overwritten (a name already there gets a number added), the originals stay put, and the folder opens when it's done.
- **Copy / move / Trash:** copy or move the tagged photos (⇧⌘C / ⇧⌘M) or the selection. The Files filter sets whether RAW, JPG or both travel. Files are never overwritten, and "delete" always means the Trash or Recycle Bin.
- **FTP delivery (⇧⌘U):**
  - Send the tagged photos, or the selection, to a saved server: JPGs by default, or RAW + JPG, or RAW (with sidecars).
  - FTP, FTPS with explicit TLS and FTPS with implicit TLS. Certificates are checked by the operating system, and TLS sessions are resumed on data connections, which vsftpd and FileZilla Server require.
  - Passwords live in the macOS Keychain or Windows Credential Manager, never in the settings file. Test connection before saving.
  - Sends queue and run one at a time, with progress and Stop in the title bar. Dropped connections reconnect and retry each file up to three times.
  - When the server already has a file with that name, Deadlyne sends it with a number added by default, because camera counters repeat from game to game. Replace (to refile a corrected caption) or Skip can be set per server.
- **Badges:** photos and shoots milestones with the same ids as the Mac app. On a Mac, progress is imported from the Swift app the first time.
- **Profile:** name, credit line and copyright (`{year}` becomes each photo's capture year), kept on this computer.
- **Updates:** checked at launch and from Home → Check for updates.

Tests: `npm test` covers the code replacement engine and shoot names. `cd src-tauri && cargo test` covers sidecars, Lightroom-sidecar safety, JPG embedding, roster parsing, ingest naming and export resizing. Ignored tests exercise real files (see the comments in `jpeg_meta.rs`, `xmp.rs`, `ingest.rs` and `export.rs`) and real servers: `ftp_sends_renames_and_skips` against a local test server, `ftps_connects` against any FTPS server (see the comments in `ftp.rs`).

## Develop

Requires Node 20+, Rust (`rustup`), and on Windows the WebView2 runtime (preinstalled on Windows 11).

```bash
cd desktop
npm install
cp .env.example .env.local   # then add your Supabase URL and publishable key
npm run tauri dev
```

Without `.env.local`, development builds offer "Continue without signing in". Release builds never do, and the release workflow refuses to build without the `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` repository variables.

To see your edits live, run `npm run app`. It opens **Deadlyne Dev**, a separate app (its own settings, recents and library, so it never disturbs the installed Deadlyne) that reloads the interface as soon as you save a file in `src/` and rebuilds when Rust in `src-tauri/` changes. The installed Deadlyne only changes when a new release is published and it updates itself.

### iPad

The same app runs on iPad (iPadOS 16+). `npm run ipad` starts the live dev server and opens the iPad project in Xcode: pick an iPad simulator (or your iPad) next to the Run button and press ⌘R. From then on, saving a file in `src/` reloads the app in the Simulator; after changing Rust or Swift, press ⌘R again. One-time setup:
- Xcode with an iPadOS simulator, `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`, and CocoaPods.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): the script looks in `~/.local/xcodegen-dl/xcodegen/bin`, or anywhere on your PATH. The project lives in `src-tauri/gen/apple`; after editing `project.yml`, run `xcodegen generate` there.
- Running on a real iPad needs a signing team: choose yours in Xcode under Signing & Capabilities.

`tauri ios dev` can't launch the simulators by itself yet, because it expects a simulator runtime matching Xcode's SDK (iOS 27.1); that's why the script opens Xcode. Installing the iOS 27.1 simulator in Xcode → Settings → Components would let `npx tauri ios dev "iPad Air 13-inch (M4)"` launch it directly. Pick a simulator name that no connected iPad shares, or Tauri chooses the real device.

What's different on iPad:
- Shoots, cards and documents are picked in the Files browser (the local `src-tauri/plugins/ipad-files` plugin). Deadlyne keeps a security-scoped bookmark for each, so they're still readable after a relaunch; a shoot that moved is followed. Shoots copied into **Files › On My iPad › Deadlyne** work too.
- Show in Finder and Open in default app become the share sheet; Quick Look is the system preview. Move to Trash goes to Files' Recently Deleted.
- Touch: tap a photo to select it and tap it again to open it; in the loupe swipe to flip, tap to zoom to 100%, drag to pan. Long-press anything for its menu. Folder cards open with one tap. A hardware keyboard gets every shortcut.
- No memory card list (cards are picked in Files), no Eject (do it in Files), and no self-updating (the App Store or TestFlight handles that). Dropping files from Files onto the window isn't supported yet.

Other useful commands:
- `npm run tauri build`: a release build and installers for the current OS.
- `npx tauri build --debug --bundles app`: a quick Mac .app for testing.
- `open src-tauri/target/debug/bundle/macos/Deadlyne.app --args /path/to/shoot`: opens straight into a folder.
- `cd src-tauri && cargo test`: Rust tests (XMP sidecar compatibility).
- `DEADLYNE_SAMPLE=/path/to/shoot cargo test --release bench -- --nocapture`: a **read-only** speed benchmark on a real folder.

## Layout

```
desktop/
  src/                      React interface
    App.tsx                 window shell, drag-and-drop, launch folder, update check
    store.ts                all app state + actions (zustand)
    lib/api.ts              typed calls into Rust + thumb/preview image URLs
    lib/hotkeys.ts          keyboard shortcuts (same keys as the Mac app)
    lib/recents.ts          recent shoots (Tauri store plugin)
    lib/updates.ts          self-update flow
    lib/codes.ts            code replacement engine + lookup file state
    lib/variables.ts        {date} {camera}… caption variables
    lib/actions.ts          copy/move/trash and open actions shared by menus and keys
    lib/export.ts           export options, naming tokens and the export call
    lib/auth.ts             Supabase sign-in, offline grace, account status, profile sync
    lib/ftp.ts              FTP servers, the send queue and its events
    components/AuthGate.tsx sign in, create account, email codes, waiting for approval
    components/SendDialog.tsx, FtpServersDialog.tsx   FTP send dialog + title-bar queue, server editor
    components/ExportDialog.tsx   export to a folder (files, size, rename)
    components/CaptionPanel.tsx, CodesView.tsx, IngestDialog.tsx, BadgesDialog.tsx, ProfileDialog.tsx
    components/TitleBar.tsx workspace tabs + filters (sits in the macOS title bar)
    components/HomeView.tsx, PhotosView.tsx, Loupe.tsx
    lib/library.ts          the library: shoots, collections, pins, archive, linked documents (library.json)
    lib/viewing.ts          review progress: the dwell tracker, batching, Continue reviewing
    lib/folders.ts          folder, collection and document actions shared by menus and buttons
    lib/dnd.ts              pointer drag and drop inside the library
    components/Sidebar.tsx, LibraryView.tsx, FolderView.tsx, LibraryMenus.tsx
    components/FolderIcon.tsx, ViewProgress.tsx, AddFilesDialog.tsx, Prompts.tsx
    components/ui/          shadcn/ui components (add more with `npx shadcn@latest add <name>`)
  src-tauri/                Rust
    src/raw.rs              embedded-JPEG extraction: CR3, RAF, TIFF-based RAWs (CR2/NEF/ARW/DNG…)
    src/exif.rs             minimal TIFF/EXIF reader (orientation, time, camera, lens, exposure)
    src/folder.rs           scan + pair folders, parallel metadata/sidecar load
    src/xmp.rs              XMP sidecars: culling + IPTC captions (port of XMPSidecar.swift)
    src/iptc.rs             caption fields and their XMP properties
    src/jpeg_meta.rs        captions inside JPGs: XMP, legacy IPTC-IIM, EXIF Artist/Copyright
    src/captions.rs         save_captions command (sidecar vs. JPG)
    src/codes.rs            lookup files (rosters): list, import, save, rename, trash
    src/ingest.rs           memory cards, naming templates, copy + verify, eject
    src/fileops.rs          copy / move / trash / reveal
    src/export.rs           export: copy, rename, resize JPGs keeping their metadata
    src/ftp.rs              FTP/FTPS sending with retries; passwords in the system keychain
    src/achievements.rs     badges and photo/shoot counting
    src/library.rs          review progress records, folder stats, documents, new/rename/trash folder
    src/jobs.rs             background threads; one lock for all file writes
    src/images.rs           thumb:// and preview:// URL schemes + thumbnail cache
    tauri.conf.json         window, bundle, updater config
  supabase/                 accounts backend: migrations (profiles table + row level security) and setup guide
```

Images never pass through JavaScript. `<img src="thumb://localhost/…">` goes straight to Rust, which serves a cached, upright, downscaled JPEG. `preview://` serves the untouched embedded full-size JPEG, and the interface rotates it using EXIF orientation. On Windows the same URLs are `http://thumb.localhost/…`; `convertFileSrc` handles that.

## Releasing an update

1. `npm run release -- 0.2.0` (sets the version in package.json, tauri.conf.json and Cargo.toml).
2. `git commit -am "Deadlyne 0.2.0"`
3. `git tag desktop-v0.2.0 && git push origin main desktop-v0.2.0`

The **Desktop release** GitHub Action (`.github/workflows/desktop-release.yml`) builds a universal Mac `.dmg` and a Windows `-setup.exe`. It signs the update bundles and creates a **draft** release with `latest.json`. Publish the draft, and installed copies offer "Update" on their next launch.

One-time setup:
- **Signing key.** Add the updater signing key as a repository secret named `TAURI_SIGNING_PRIVATE_KEY`, containing the file `~/.tauri/deadlyne-updater.key`. The key has no password, so leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset. **Never commit that key or lose it.** Without it, existing installs can't verify future updates.
- **Public update feed.** The updater downloads `latest.json` from this repo's releases, so **the repo must be public**. The alternative is to point `plugins.updater.endpoints` in `tauri.conf.json` at a separate public releases repo.
- **Code signing, for installs without warnings.**
  - macOS: a Developer ID certificate and notarization (Apple Developer Program). Add the `APPLE_*` secrets that tauri-action documents. Until then, builds are ad-hoc signed, and the first launch needs right-click → Open.
  - Windows: Azure Trusted Signing or an OV/EV certificate. Until then, SmartScreen shows "More info → Run anyway".
