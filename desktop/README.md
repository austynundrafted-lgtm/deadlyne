# Deadlyne desktop (macOS first, with Windows and iPad support)

The cross-platform version of Deadlyne, built with [Tauri 2](https://tauri.app). **Rust** does everything that touches files and must be fast. The interface is **React + Tailwind + shadcn/ui**. It installs from GitHub Releases and **updates itself**.

The original native Mac app (Swift/AppKit) still lives at the repo root and keeps working while features move over.

Gamification has been removed: no badges, achievements, milestone counters or unlock notifications. Folder opening and ingest do not track achievement totals, and Local data import skips old achievement files. Existing achievement data and artwork remain unused on disk. Photo ratings, tags, review navigation and progress for file operations are unchanged.

## What works today

- **Interface accessibility:** shared dark-theme tokens, readable action colors, visible keyboard focus, labeled selectors and rating controls, scrolling dialogs and a wrapping Codes toolbar for smaller Mac windows. The interface stays dark under either macOS appearance setting. A usability pass on November 11, 2026 made Return run each task dialog’s default action, kept the whole library reachable in narrow windows and added recovery for missing folders. See [UI audit and remaining styles](UI_AUDIT.md).
- **Account presets:** save named ingest/export presets in either dialog and use them on your other Mac or iPad. Ingest presets keep folder/file naming, skip-existing and eject choices; export presets keep RAW/JPG selection, size/quality, renaming and folder options. Source cards, destination paths, job names and sequence counters stay on each device. Saved presets work offline; saving, updating, renaming and deleting require a connection. A revision check prevents an older device from silently replacing a newer edit. Sign-out clears this account's cached preset list, and account deletion removes its server presets too. Current device workflow settings remain. [App Store readiness and remaining work](MAC_APP_STORE_READINESS.md).
- **Sign-in:** Deadlyne opens only for a signed-in account (Supabase). Create an account, confirm it with the 6-digit code from the email, or reset a password the same way. After signing in, it keeps working offline on that computer for up to 30 days. Invite-only is one setting on the server. Setup: [supabase/README.md](supabase/README.md).
- **Account deletion (Mac and iPad):** Settings → Account → Delete Account, also reachable from Home’s account menu. Confirm with the current password to permanently remove the login, synced profile and account presets. Pending and disabled accounts can delete from the approval screen. Photography files, sidecars, captions, exports, code replacements, library organization, FTP settings and device preferences remain; sign-in tokens, the cached personal profile and the account preset cache are cleared. A connection is required. A saved recovery receipt lets an interrupted request confirm completion before reporting success. [Implementation, retention and review checklist](supabase/ACCOUNT_DELETION.md).
- **Home:**
  - Ingest a card (⇧⌘I) or open a shoot (⌘O, or drop a folder on the window).
  - Recent shoots with readable names and a live ingest progress bar.
- **Library and folders:**
  - A collapsible sidebar beside Photos (⌥⌘S): All shoots, Recent, Favorites, Pinned, Collections, the shoot folders with their real subfolders, and the Archive. Arrow keys move through it; right-click for everything else. In a narrow window (and on iPad in portrait) it stays an icon rail, and ⌥⌘S or the rail’s first button opens the full sidebar over the photos; it closes again once you pick something.
  - Collections, pins, favorites and the archive are virtual: they never move or rename files. Drag a shoot onto a collection, Favorites or Archive. Renaming a folder on disk, making a new folder (⇧⌘N) and Move to Trash are separate, explicit actions.
  - Folder menus can save include/exclude catalog rules and Settings → Catalog lists them. The nearest explicit folder rule takes precedence. Catalog indexing is not yet available, so these rules do not scan or remove photos.
  - Shoots show as folders in a grid or a list with photo and document counts. A folder that was moved or unplugged shows as missing (“Folder not found” on Home, in the library and the sidebar). Opening one explains why and offers Locate…, then opens it from its new place; Home’s row has its own Locate… button. Plug the drive back in and it simply opens.
  - **Documents:** add shot lists, briefs, rosters and other files to a shoot with Add files or by dropping them on the window. Choose to copy them into the shoot folder (nothing is replaced; a taken name gets `-1`) or link them where they are. They live under Documents, apart from the photos, with Quick Look (Space), open in the default app, rename, move and remove, and a details panel in the caption panel's place.
  - **Review progress:** a photo counts as viewed once its thumbnail has been at least half on screen for a second while Deadlyne is active, or when it's opened in the loupe; scrolling past doesn't count. Each folder remembers its viewed photos by file name, so sorting and filters never lose them; deleted photos drop out and new ones start unviewed. A parent folder adds up the folders inside it. Progress drives Continue reviewing and the Least reviewed first sort; there's no progress bar on folder cards, list rows, the sidebar, the folder bar or Home. It's separate from tags, ratings and captions.
  - The folder toolbar shows Continue reviewing while a review is partway; its tooltip gives the viewed count.
  - **Continue reviewing (⌥⌘R)** goes back to the photo you were last reviewing (or the first unviewed one if it's gone) and marks it briefly. **Show unviewed only** (⌥⌘U) is in the Filter menu; Reset viewing progress… in the folder menu asks first.
- **Photos:**
  - An instant contact sheet for thousands of RAW+JPEG files, with pairing and capture-time order.
  - Search (⌘F) across file names, captions and keywords. Use the clear button or Esc to clear the search; Esc again leaves the field.
  - A slim filter bar (All / Tagged / Untagged, plus one Filter menu for rating, label and file type) and one actions menu.
  - Right-click menus on photos: show in Finder/Explorer (⇧⌘R) or open in the default app (⌘E).
  - When a filter hides photos, the status bar says "X of Y" with a Show all button. Show all clears search, rating, label, viewing and RAW/JPG filters together, including from the empty grid.
  - Filter, Export, Captions and Open have text labels in wider windows; compact windows retain the same actions with icons and tooltips, so nothing is pushed off the title bar while an FTP send is showing.
- **Culling:** `T` tags, `0–5` rates, `6–9` sets red/yellow/green/blue labels. Arrows move, Space opens the loupe, Esc closes it. ⌘D deselects. Everything saves to Adobe-compatible XMP sidecars.
  - **Loupe:** `Z` or a click zooms to 100% at that point to check focus; drag or scroll pans, and a click or Esc fits it again.
  - Portrait and mirrored photos keep their orientation as the thumbnail gives way to the full preview, including when flipping left/right. Rotation is applied once; originals are unchanged.
  - Nearby full-size previews are decoded ahead and retained in a small three-photo cache, so advancing reuses a ready image. The current photo loads first, distant work is canceled during fast navigation, and closing the loupe releases the cache.
  - Loupe controls and shortcut keys stay on one line. Filenames stay under thumbnails in the grid; the loupe controls and status bar omit them so long export filenames do not repeat across the bottom. Narrow photo panes hide the shortcut reminder instead of wrapping numbers or labels.
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
  - The dialog opens on the job name, ready to be typed over; Return starts the ingest.
- **Export (⇧⌘E):** copies of the tagged photos or the selection for the client or the desk, from the title-bar button, the actions menu or a right-click. JPGs by default (RAW + JPG or RAW too), into a new folder named after the shoot inside the place you exported to last time. Resize JPGs to a long edge (1200 / 2048 / 3000 / 4000 px) with a quality choice: they come out upright and keep their EXIF, XMP captions, legacy IPTC and color profile. Rename with `{shoot}_{seq}` and the other tokens; pairs share a name. Nothing is overwritten (a name already there gets a number added), the originals stay put, and the folder opens when it's done. ⇧⌘E then Return exports with the choices from last time.
- **Copy / move / Trash:** copy or move the tagged photos (⇧⌘C / ⇧⌘M) or the selection. The Files filter sets whether RAW, JPG or both travel. Copies and ingests refuse existing files at the moment of writing, and failed writes remove their partial output. Files are never overwritten, and "delete" always means the Trash or Recycle Bin.
- **Confirm before removing:** deleting photos (including ⌘⌫), folders, documents, rosters and empty code rows, or removing collections, shoot entries, document links, saved FTP servers, finished-send history or the photographer profile always asks first. Cancel is selected initially. Photo confirmations name the files, show the count and RAW/JPG scope, and keep that selection fixed until you decide. Files moved to Trash can be restored there; removing a library entry or link leaves its files on disk.
- **FTP delivery (⇧⌘U):**
  - Send the tagged photos, or the selection, to a saved server: JPGs by default, or RAW + JPG, or RAW (with sidecars). ⇧⌘U then Return sends to the last server.
  - FTP, FTPS with explicit TLS and FTPS with implicit TLS. Certificates are checked by the operating system, and TLS sessions are resumed on data connections, which vsftpd and FileZilla Server require.
  - Passwords live in the macOS Keychain or Windows Credential Manager, never in the settings file. Test connection before saving.
  - Sends queue and run one at a time, with progress and Stop in the title bar. Dropped connections reconnect and retry each file up to three times.
  - When the server already has a file with that name, Deadlyne sends it with a number added by default, because camera counters repeat from game to game. Replace (to refile a corrected caption) or Skip can be set per server.
- **Profile:** name, credit line and copyright (`{year}` becomes each photo's capture year), kept on this computer.
- **Updates:** checked at launch and from Home → Check for updates.
- **On a Mac, it behaves like a Mac app:**
  - A real menu bar: File, Edit, Caption, Cull, View, Window and Help, with every command and its key, enabled only when it applies. Settings… is ⌘, and Check for Updates… is in the Deadlyne menu; Open Recent lists the recent shoots.
  - Finder's Open With and the Dock icon open shoots: drop a folder (or a photo) on the icon, or right-click one in Finder. A photo opens its folder with that photo in focus.
  - The window comes back where it was left.
  - An ingest, export or send shows its progress on the Dock icon. If you're in another app when it finishes, a notification says so and the Dock icon bounces.

Tests: `npm test` covers code replacements, shoot names, account recovery, export naming, filter recovery and opening a shoot whose folder has gone missing. `cd src-tauri && cargo test --locked` covers sidecars, Lightroom-sidecar safety, JPG embedding, roster parsing, ingest naming, exclusive file operations and export resizing/pair collisions. The release workflow runs both suites on Mac and Windows before packaging. Ignored tests exercise real files (see the comments in `jpeg_meta.rs`, `xmp.rs`, `ingest.rs` and `export.rs`) and real servers: `ftp_sends_renames_and_skips` against a local test server, `ftps_connects` against any FTPS server (see the comments in `ftp.rs`).

## Develop

Requires Node 22.12+ (Node 26 was used for the recovery build), Rust (`rustup`), Xcode Command Line Tools on macOS, and on Windows the WebView2 runtime (preinstalled on Windows 11).

```bash
cd desktop
npm ci
cp .env.example .env.local   # then add your Supabase URL and publishable key
npm run tauri dev
```

Without `.env.local`, development builds offer "Continue without signing in". Release builds never do, and the release workflow refuses to build without the `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` repository variables.

To see your edits live, run `npm run app`. It opens **Deadlyne Dev**, with its own Tauri settings, recents and library, and reloads the interface as soon as you save a file in `src/`. Rust edits rebuild the app. The Rust viewing records and code-replacement files are still shared with the installed app: use scratch photo copies for testing and remove only the scratch records afterward. The installed application bundle changes only when you replace it or install an update.

### Local macOS rebuild and disk space

Run `npm run build:mac` to build `src-tauri/target/release/bundle/macos/Deadlyne.app` from the lockfiles. This creates a standalone, ad-hoc-signed local app without updater distribution artifacts. It retains the production app identifier and sign-in behavior, so it uses the installed app's settings. Quit the installed app before running this copy. Public releases still use the normal release workflow and updater signing key.

Keep `.env.local` private. Preserve the source folders, artwork, `package-lock.json`, `Cargo.lock`, and the iPad `gen/apple/project.yml` and plugin sources. The root and nested `.gitignore` files exclude dependencies, compiled output, private environment files, signing material and local verification files.

Builds necessarily create caches. When no build or dev server is running, `cargo clean --manifest-path src-tauri/Cargo.toml` reclaims Rust build output (including locally built apps). `node_modules/` and `dist/` are also reproducible: remove them when no longer needed, then restore with `npm ci` and rebuild. Avoid broad cleanup commands such as `git clean -fdx`, which would also delete private ignored configuration. Commit source changes regularly and push reviewed commits to retain an off-machine copy.

### Mac App Store

`npm run build:store:check` builds a separate sandboxed **Deadlyne Store Check** app. It has its own identifier, container and workflow records. Use only scratch media when verifying it.

`npm run build:store -- --automatic --team 9DBN5W48YV --build-number 1` builds the universal store channel, then lets Xcode register/provision, archive and export a distribution-signed installer. Sign into the enrolled team in Xcode first; XcodeGen and both Mac Rust targets are required. Increase the build number for each submission. This command exports locally and does not upload or submit the app. The final package, signature checks and checksum are recorded in `.verification/mac-app-store/signed/build-report.json`.

The store channel removes the self-updater, uses persistent security bookmarks for selected folders/files, and keeps its local workflow data in the sandbox container. Settings → Local data can merge setup from the previous app. See [store readiness](MAC_APP_STORE_READINESS.md) for signing inputs, verification evidence and the remaining listing/privacy/review work.

### iPad

`npm run build:ipad:sim` creates a standalone Apple Silicon Simulator app at `src-tauri/gen/apple/build/simulator/Build/Products/release-iphonesimulator/Deadlyne.app`. It bundles the interface, so the app runs without Vite. The build script keeps Tauri's native build service alive while Xcode builds for the simulator SDK, then shuts it down. This avoids Tauri's direct runtime-selection limitation when Xcode's SDK and the installed simulator runtime differ. Install the resulting app on an iPad simulator; it is not a signed build for a physical iPad.

The lockfile pins an upstream Tao scene-lifecycle fix for optimized iPad launches; keep the Cargo patch until the Tauri runtime includes a fixed release. Development builds alone do not expose that launch crash.

The same app runs on iPad (iPadOS 16+). `npm run ipad` restores the generated Xcode project when needed, starts the live dev server and opens the iPad project in Xcode: pick an iPad simulator (or your iPad) next to the Run button and press ⌘R. Keep that terminal running while using Xcode; the Rust build phase connects to the Tauri process it starts. From then on, saving a file in `src/` reloads the app in the Simulator; after changing Rust or Swift, press ⌘R again. One-time setup:
- Xcode with an iPadOS simulator, `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`, `rustup component add llvm-tools` (needed for Swift bridge symbols in release builds with Xcode 27), and CocoaPods.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): the script looks in `~/.local/xcodegen-dl/xcodegen/bin`, or anywhere on your PATH. The project lives in `src-tauri/gen/apple`; `npm run ipad:prepare` creates the required generated folders and regenerates the project after changes to `project.yml`. The generated project, assets and compiled libraries stay out of Git.
- Running on a real iPad needs a signing team: choose yours in Xcode under Signing & Capabilities.

If Tauri's direct simulator selection expects a runtime matching Xcode's SDK, use the Xcode workflow above with an installed simulator; another runtime download isn't required. The recovered build was verified on the iPad Pro 13-inch (M5), iPadOS 27.0, using Xcode's 27.1 SDK. XcodeBuildMCP can also build and launch the `deadlyne_iOS` scheme for an explicit simulator UDID while `npm run ipad` stays running. Pick a simulator name that no connected iPad shares when using Tauri's direct device selection, or Tauri may choose the real device.

What's different on iPad:
- Shoots, cards and documents are picked in the Files browser (the local `src-tauri/plugins/ipad-files` plugin). Deadlyne keeps a security-scoped bookmark for each, so they're still readable after a relaunch; a shoot that moved is followed. Shoots copied into **Files › On My iPad › Deadlyne** work too.
- Files pickers can stay open while you browse: their selection comes back through a channel, avoiding WebKit request timeouts and duplicate pickers.
- Show in Finder and Open in default app become the share sheet; Quick Look is the system preview. Move to Trash goes to Files' Recently Deleted.
- Touch: tap a photo to select it and tap it again to open it; in the loupe swipe to flip, tap to zoom to 100%, drag to pan. Long-press anything for its menu. Folder cards open with one tap. A hardware keyboard gets every shortcut.
- No memory card list (cards are picked in Files), no Eject (do it in Files), and no self-updating (the App Store or TestFlight handles that). Dropping files from Files onto the window isn't supported yet.

Other useful commands:
- `npm run tauri build`: a release build and installers for the current OS.
- `npx tauri build --debug --bundles app`: a quick Mac .app for testing.
- `open src-tauri/target/debug/bundle/macos/Deadlyne.app --args /path/to/shoot` (or `open -a <that .app> /path/to/shoot`, the way Finder does it): opens straight into a folder.
- `cd src-tauri && cargo test`: Rust tests (XMP sidecar compatibility).
- `DEADLYNE_SAMPLE=/path/to/shoot cargo test --release bench -- --nocapture`: a **read-only** speed benchmark on a real folder.

## Layout

```
desktop/
  src/                      React interface
    App.tsx                 window shell, drag-and-drop, update check
    store.ts                all app state + actions (zustand)
    lib/api.ts              typed calls into Rust + thumb/preview image URLs
    lib/commands.ts         every command by id: what the menu bar, the keys and the toolbar run
    lib/hotkeys.ts          keyboard shortcuts (same keys as the Mac app)
    lib/menu.ts             the macOS menu bar: enabled/checked state, Open Recent, running what it picks
    lib/opening.ts          shoots opened from Finder, the Dock or the command line
    lib/recents.ts          recent shoots (Tauri store plugin)
    lib/updates.ts          self-update flow
    lib/codes.ts            code replacement engine + lookup file state
    lib/variables.ts        {date} {camera}… caption variables
    lib/actions.ts          copy/move/trash and open actions shared by menus and keys
    lib/export.ts           export options, naming tokens and the export call
    lib/auth.ts             Supabase sign-in, offline grace, account status, profile sync, account-cache cleanup
    lib/account-deletion.ts durable deletion receipt, reauthentication, status recovery
    lib/ftp.ts              FTP servers, the send queue and its events
    components/AuthGate.tsx sign in, create account, email codes, waiting for approval
    components/SendDialog.tsx, FtpServersDialog.tsx   FTP send dialog + title-bar queue, server editor
    components/ExportDialog.tsx   export to a folder (files, size, rename)
    components/CaptionPanel.tsx, CodesView.tsx, IngestDialog.tsx, ProfileDialog.tsx
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
    src/library.rs          review progress records, folder stats, documents, new/rename/trash folder
    src/jobs.rs             background threads; one lock for all file writes
    src/images.rs           thumb:// and preview:// URL schemes + thumbnail cache
    src/native.rs           macOS menu bar, Finder/Dock opening, Dock progress, notifications
    tauri.conf.json         window, bundle, updater config
    Info.plist              merged into the Mac bundle: folder and photo document types, memory-card text
  supabase/                 profiles/RLS and deletion-receipt migrations, delete-account Edge Function, setup/retention guides
```

Images never pass through JavaScript. `<img src="thumb://localhost/…">` goes straight to Rust, which serves a cached, upright, downscaled JPEG. `preview://` serves the embedded full-size JPEG pixels with its EXIF orientation neutralized in the response only; the interface applies the original photo's orientation once. This prevents browser auto-rotation from turning the full preview a second time. The source file and compressed image data remain unchanged. On Windows the same URLs are `http://thumb.localhost/…`; `convertFileSrc` handles that.

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
