# Deadlyne: guide for AI agents

Read this before changing anything. It covers what the app is, who it's for, how the code is organized, the rules that must not be broken, and step-by-step recipes for the most common kinds of additions. `README.md` is the user-facing feature list; this file is the engineering view.

> **Two codebases.**
> - **`desktop/` is the future:** Deadlyne for macOS **and Windows**, built with Tauri 2. Rust in `desktop/src-tauri` does files, RAW previews, EXIF, sidecars and thumbnails; the interface in `desktop/src` is React + Tailwind + **shadcn/ui only**, designed "less is more" (reusable components, fewest steps). It updates itself from GitHub Releases. Read [desktop/README.md](desktop/README.md) for its layout, commands and release process.
> - **The Swift/AppKit app at the repo root** (sections 3–6 below) is the reference implementation. Port features from it into `desktop/` in the order the photographer uses them: captions + code replacements, then ingest, copy/move, search, badges. Keep sidecar and file formats identical, so both apps (and Lightroom) read each other's work.
> - Rules in section 2 apply to both apps.
> - Desktop specifics:
>   - Sign-in: `src/lib/auth.ts` + `components/AuthGate.tsx`; backend SQL and setup in `desktop/supabase/`. Config comes from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local` locally, repository variables in CI). Keep offline use working: a confirmed sign-in lasts `OFFLINE_GRACE_DAYS` without network.
>   - FTP: `src-tauri/src/ftp.rs` + `lib/ftp.ts`. Passwords go only to the keychain (`keyring`). FTPS uses rustls so data connections resume the TLS session; don't switch back to native-tls. Never make "Replace" the default when a remote file exists.
>   - New IPTC fields: add them to `iptc.rs` (`Field`, `Captions`), `IIM_MAP` in `jpeg_meta.rs` if IIM has a dataset (plus its length in `IIM_LIMITS` in `lib/api.ts`), and `CAPTION_FIELDS` / `FIELD_LABELS` / `emptyCaptions` in `lib/api.ts`, then place the input in `CaptionPanel.tsx`.
>   - Never pass image bytes through JavaScript; use the `thumb://` / `preview://` schemes in `images.rs`.
>   - Keep heavy work in Rust on rayon or `spawn_blocking`.
>   - Add UI only from shadcn (`npx shadcn@latest add …`).
>   - UI polish rules:
>     - For depth, use `shadow-edge` / `shadow-edge-hover` (defined in `index.css`), not borders.
>     - Name the exact transition properties; never use `transition-all`.
>     - `Button` shrinks to 0.96 when pressed. Pass `static` for controls hit over and over, like the grid's tag and stars.
>     - Nested corners are concentric (outer radius = inner radius + padding).
>     - Swap state icons with `IconSwap`.
>     - Keep culling feedback instant.
    - Show the selected item with a fill (`bg-accent`, or the workspace color at /15), never a stroke on one side.
    - Tailwind's base style caps `<img>` at `max-width: 100%`; set `maxWidth: "none"` on anything drawn larger than its box (the loupe at 100%).
>   - Keep keyboard shortcuts the same as the Mac app.
>   - Never commit `~/.tauri/deadlyne-updater.key`.

---

## 1. What Deadlyne is

Deadlyne is a native macOS photo browser and culler for **sports photographers on deadline**, built to replace Photo Mechanic. The folder is still named `LensDesk`, the app's old name.

The owner shoots high-school sports on a **Canon EOS R3** in RAW+JPEG (`MCD_0001.CR3` + `MCD_0001.JPG`, around 2,000 frames and 78 GB per game). They edit in Lightroom and know Photo Mechanic's workflow well. After a game they:

1. **Ingest** the memory card into a dated or job-named folder.
2. **Cull**: flip through thousands of frames instantly, then tag, star-rate and color-label the keepers.
3. **Caption**: IPTC headline, caption, keywords and credits, typed quickly with **code replacements** (`=f10=` → "Jordan Sample (10)").
4. **Deliver**: copy the tagged JPGs to the client or wire service, then open the RAWs in Lightroom, which reads Deadlyne's ratings from the XMP sidecars.

The whole product is **speed**. Every feature is judged by whether it gets a photographer from card to delivered captions faster.

### The speed trick
Deadlyne **never decodes RAW sensor data**. Every RAW file contains JPEGs the camera already rendered. `PreviewExtractor` parses the container (CR3 as ISO-BMFF, TIFF-based RAWs as IFD chains, Fuji RAF), seeks straight to the embedded JPEG with `pread`, and decodes only that. A CR3 holds a 160×120 thumbnail, a 1620×1080 preview and a full 6000×4000 JPEG.

---

## 2. Non-negotiable rules

1. **Speed first.** No work on the main thread that scales with the photo count. Do scanning, metadata reads, decoding and saving on background queues. Visible thumbnails always load first.
2. **Never destroy the user's data.**
   - Never overwrite existing files during copy, move or ingest.
   - "Delete" always means **Move to Trash** (`FileManager.trashItem`), never permanent deletion.
   - XMP sidecars are **edited in place**. Only Deadlyne's own properties are touched, and Lightroom/Camera Raw develop settings (`crs:`) are never clobbered.
   - JPEG caption embedding rewrites **metadata segments only**, so the image data stays byte-identical.
3. **Stay compatible with Adobe and Photo Mechanic.** Ratings and labels go in `xmp:Rating` and `xmp:Label`. Captions use standard IPTC-in-XMP properties plus legacy IPTC-IIM in JPGs. Lookup files use Photo Mechanic's tab-delimited format. Old sidecars may contain `lensdesk:Tagged` and must still be read.
4. **The user's real shoots are read-only for testing.** Their shoot folders are real client work. Test on **copies** in a scratch folder.
5. **Don't pollute the user's stats.** Opening a folder in Deadlyne adds it to Home's recent shoots and to the badge counts. After testing with a scratch folder, remove it from UserDefaults: the `recentShoots` entry, plus `achievements` → `folders`, `photos`, `shoots` and `months`. Also reset `lastFolder`. Back up first with `defaults export app.deadlyne.Deadlyne backup.plist`.
6. **The user runs the app themselves.** Don't quit or relaunch a running Deadlyne without saying so.
7. **Wording and accounts.** Say "ingested" for cards and "sent" for FTP, never "uploaded".
   - The **Swift app** has no accounts: the profile is optional and stays on the Mac.
   - **Desktop** is gated behind a Supabase sign-in (asked for by the user on 2026-09-15). Supabase stores only the account status and the photographer profile (name, credit, copyright). Photos, captions, rosters and FTP passwords never leave the computer. Don't add other cloud features unless asked.
   - Never put a Supabase service_role/secret key in the app or the repo. Only the publishable key ships, and row level security enforces access.
8. **Home should feel like a pro tool, not a SaaS dashboard.** The path from launch to images stays dominant.
9. **Badge ids are permanent** (`photos-100`, `shoots-1`…). Earned badges are stored by id, and the user draws the art as `Resources/Badges/<id>.png`. Never replace their art or rename ids.

---

## 3. Build, run, verify

- **Stack:** Swift 6 toolchain in Swift 5 language mode, AppKit (no SwiftUI), SwiftPM, macOS 14+. The dev Mac runs macOS 26 (Tahoe).
- **Build:** `./scripts/build.sh` compiles in release, assembles `build/Deadlyne.app`, writes `Info.plist`, copies the icon and badge art, and code-signs.
- **Run:** `open build/Deadlyne.app`, or `open build/Deadlyne.app --args /path/to/folder` to skip Home and open a folder.
- **Quick compile check:** `swift build -c release`.
- **Bundle ID:** `app.deadlyne.Deadlyne`. It was `app.lensdesk.LensDesk`; `LegacyMigration` copies the old settings once.
- **Signing:** `build.sh` picks `$DEADLYNE_SIGN_IDENTITY`, then Developer ID, then Apple Development, then ad-hoc. The user has a free Personal Team (an "Apple Development" certificate) and is not in the paid program, so there's no notarization yet.
- **No git repo, no unit tests.** Verify by building and driving the real app. Pure logic, like the `CodeList` parsers, can be checked by compiling the Core file together with a small `main.swift` in a scratch folder using `swiftc`.
- **Debug logging:** `NSLog` output isn't easy to find in the unified log. Run the binary directly and redirect stderr: `.build/release/Deadlyne > run.log 2>&1 &`.
- **UI automation gotcha:** when Deadlyne isn't frontmost, its menu items report as disabled to accessibility tools. That's expected. Use the title-bar tabs or buttons instead.

---

## 4. Architecture

```
Sources/Deadlyne/
  App/
    main.swift              runs LegacyMigration, then NSApplication
    AppDelegate.swift       window, per-display frame memory, title-bar toolbar, ENTIRE menu bar
    LegacyMigration.swift   one-time LensDesk → Deadlyne settings carry-over
  Core/  (no UI; mostly enums with static funcs, a few singletons)
    PreviewExtractor.swift  finds embedded JPEGs in RAW containers (the speed)
    ImagePipeline.swift     decodes and caches thumbnails, previews, 100% zoom (NSCache + OperationQueues)
    Photo.swift             Photo model (RAW+JPEG pair), FileTypes, ColorLabel, FileScope, EXIF read
    FolderLoader.swift      scan folder → [Photo]; parallel metadata/sidecar/caption load
    XMPSidecar.swift        read/update Adobe XMP sidecars by string surgery (preserves everything else)
    IPTC.swift              IPTCField (the caption fields + XMP mapping), IPTCInfo
    JPEGMetadata.swift      embed captions in JPGs (XMP via ImageIO copy-source), JPEGCaptionMode
    IPTCIIM.swift           legacy IPTC-IIM APP13 read/write (byte-level)
    CaptionExpander.swift   CaptionVariables: {date} {camera} {iso}…, expandAll = codes then variables
    CodeReplacements.swift  CodeList (roster file), CodeReplacements (singleton), LiveCodeExpansion
    FileOps.swift           copy/move (never overwrite), trash
    IngestEngine.swift      card detection, template naming, copy with verify; IngestSettings/Activity
    RecentShoots.swift      Home's recent-shoots list (UserDefaults)
    ShootName.swift         "Boys_Varsity-Fairborn-vs-Tecumseh_082126" → readable title
    Profile.swift           optional local profile + avatar; credit/copyright fill
    Achievements.swift      badge ladders and photo/shoot counting
  UI/
    RootViewController      hosts the 3 workspaces; toolbar delegate; menu routing for Home
    WorkspaceTabBar         Affinity-style title-bar tabs (Workspace enum: home, photos, codes)
    HomeViewController      landing screen; HomeComponents = HomeStyle palette + reusable views
    BrowserViewController   Photos workspace: top filter bar, grid, loupe, caption panel, status bar (largest file)
    GridView / ThumbnailCell contact sheet (NSCollectionView, layer-drawn cells)
    PreviewView             loupe + 100% zoom + HUD
    CaptionPanel            IPTC fields panel (right side of Photos); live code expansion hook
    CodesViewController     Codes workspace: lookup file list, roster table/text editor, inspector
    IngestWindowController  ingest window
    ProfileWindowController, AchievementsWindowController, BadgeViews
scripts/build.sh, scripts/make_icon.swift
Resources/AppIcon-source.png (1024² artwork → icns), Resources/Badges/*.png + README.md
```

### Window and workspaces
- `AppDelegate` creates one `NSWindow`. `RootViewController.view` sits inside a plain autoresizing container; it is **not** the window's `contentViewController`. `root.nextResponder` is wired to the window by hand so menu actions still reach the view controllers.
- The title bar is an `NSToolbar` (`.unified`, title hidden) with one item: `WorkspaceTabBar`, showing the app icon and the Home / Photos / Codes tabs.
- `RootViewController.show(_ workspace:)` is **the** way to switch. It calls the leaving workspace's `prepareToLeave()` (commits edits, closes the loupe, saves), shows and hides the child views, updates `tabBar.selection`, then `focusCurrentScreen()`. All three child view controllers stay loaded, so switching back is instant.
- Each workspace has its own active color (`Workspace.tint`): Home is brand orange (`HomeStyle.accent`), Photos amber (`HomeStyle.warning`), Codes green (`HomeStyle.ready`).
- **Menus** are all built in `AppDelegate.buildMenu()`. Actions use `#selector` with a `nil` target and travel the responder chain. Browser actions live on `BrowserViewController`; app-level ones on `RootViewController`, which also forwards a few so they work from Home. Enabled state comes from `validateMenuItem`.

### The Photos workspace (`BrowserViewController`)
- `openFolder(url)`: `FolderLoader.scan` runs in the background (pairing only, no file reads), the grid shows immediately, then `loadMetadata` reads EXIF, sidecars and captions in parallel and applies them on main. `loadGeneration` discards results from a folder that is no longer open.
- **Culling** (`handleCullingKey`): T tags, 0–5 rate, 6–9 set color labels. `mutate(...)` changes the `Photo` objects on main, then writes sidecars on the serial `saveQueue`.
- **Captions:** `CaptionPanel` commits a field when you leave it → `captionPanel(commit:)` expands codes and variables per photo (`CaptionVariables.expandAll`) → `saveCaptions`, which writes the XMP sidecar for RAWs (or when JPG embedding is off) and embeds into JPGs according to `JPEGCaptionMode` (XMP+IIM by default).
- **Targets:** actions apply to the photo in the loupe if it's open, otherwise to the grid selection (`targetPhotos`).
- **FileScope** (RAW+JPG / RAW only / JPG only) decides which files copy, move, drag, open and trash act on (`Photo.files(for:)`).
- Home hand-off: `recordShootStats()` saves counts and the culling position into `RecentShoots`.

### Code replacements (`CodeReplacements.swift` + `CodesViewController`)
- **Lookup files** live in `~/Library/Application Support/Deadlyne/Code Replacements/*.txt` (`.csv`, `.tsv` and `.tab` also load). Each line is `code⇥col1⇥col2⇥…`; `code=text` is accepted on lines without tabs, and `#` starts a comment.
- **Syntax:** `=code=` gives column #1 and `=code#2=` column #2. The delimiter is user-selectable: `=` (default), `\`, `;`, `~`, backtick, `|` or `^`. `#` is reserved. Codes are case-insensitive. A code with no text after it, or an unknown code, stays as typed.
- **Several files can be on at once.** When two active files share a code, the file whose name sorts first wins, and the shadowed copy is flagged in the editor.
- `CodeReplacements.shared` holds the lists and a lowercase lookup `table`, and posts `CodeReplacements.didChange` whenever anything changes. `notify()` stays silent during `init`, because an observer reading `shared` inside its own initializer would deadlock.
- `LiveCodeExpansion.apply(to: NSTextView)` is called from `textDidChange` / `controlTextDidChange` (field editors included). It expands everything before the caret as one undoable edit, which also handles pastes.
- Column names ("Name", "Team") are stored in UserDefaults (`codeColumnNames`), not in the file, so files stay Photo Mechanic-compatible.
- In the editor, every table edit saves immediately (`saveSelected`). Text mode saves 0.6 s after typing stops (`scheduleTextSave` / `flushTextEdits`). `savingOwnChange` stops the view's own saves from reloading the table mid-edit.

### Storage map
| What | Where |
|---|---|
| Ratings, labels, tag, RAW captions | `BASENAME.xmp` sidecar next to the photo |
| JPG captions | embedded in the JPG (XMP + optional IPTC-IIM) |
| Lookup files | `~/Library/Application Support/Deadlyne/Code Replacements/` |
| Avatar | `~/Library/Application Support/Deadlyne/Avatar.png` |
| Badge art override (no rebuild) | `~/Library/Application Support/Deadlyne/Badges/<id>.png` |
| Settings | UserDefaults `app.deadlyne.Deadlyne`, keys below |

UserDefaults keys: `recentShoots`, `achievements`, `profile`, `profilePromptDismissed`, `lastFolder`, `fileScope`, `sortByName`, `autoAdvance`, `captionPanel`, `thumbSize`, `jpegCaptionMode`, `ingestDestination`, `ingestFolder`, `ingestJob`, `ingestRename`, `ingestRenameOn`, `ingestSkip`, `ingestEject`, `homeShowAllShortcuts`, `codeDelimiter`, `codeExpandWhileTyping`, `codeListsDisabled`, `codeListsSeeded`, `codeColumnNames`, `codesEditorMode`, `codesSelectedList`, `windowFrame.<w>x<h>`, `windowLastScreen`, `migratedFromLensDesk`.

---

## 5. UI conventions

- **Dark only** (`NSApp.appearance = .darkAqua`). Colors are explicit grays, not system semantic colors:
  - backgrounds: `BrowserViewController.background` (white 0.105)
  - panels: white 0.13
  - top bars: white 0.14
  - dividers: white 0.2
- **Palette:** `HomeStyle` in `HomeComponents.swift` has `accent` (brand orange #FF3D00), `accentLight`, `warning` (amber), `ready` (green), `danger`, plus the title/secondary/tertiary text grays. Reuse these rather than inventing colors.
- **Patterns to reuse:**
  - `HoverControl`: a view that acts as a button, with hover and pressed states, a pointing-hand cursor and accessibility. Override `stateChanged()`.
  - `FlippedView`: a document view for top-down scroll stacks.
  - `sectionLabel`-style labels: 9.5pt semibold, uppercase, gray 0.55.
  - Top bars are 46pt tall and status bars 28pt; small controls use `controlSize = .small`.
  - SF Symbols for icons.
- **Layout is Auto Layout in code** (no XIBs or storyboards), mostly `NSStackView` plus explicit constraints.
- **Window sizing rules.** These were learned the hard way; see `HomeViewController.applyMetrics`.
  - Never tie a scroll view's document width to its clip view with a required constraint. Content width then propagates to the window, and AppKit **resizes the window itself**.
  - Call `HomeViewController.letLabelsCompress(root)` on new screens so labels truncate instead of setting a minimum window width.
  - Give wrapping labels a `preferredMaxLayoutWidth`.
  - The practical minimum window width is ~1618pt, set by the browser top bar plus the caption panel.
  - Window frames are saved per display.
- **AppKit gotchas already hit:**
  - Swift `didSet` does **not** run for assignments made in the class's own `init`. Call the apply function explicitly.
  - Views hosted in the toolbar: set layer colors in `updateLayer()` (`wantsUpdateLayer = true`), not once.
  - In `NSTextView`, Esc arrives as `complete:`, not `cancelOperation:`. The browser also has a local key monitor for Esc.
- **Copy style:** short, plain, and specific to the photographer's job. Tooltips explain *why*. Keyboard shortcuts appear in tooltips.

---

## 6. How to add things (recipes)

### Add a caption (IPTC) field
1. `Core/IPTC.swift`: add a case to `IPTCField` and fill in `label`, `prefix`, `name` and `kind`, using the standard IPTC Core/Extension XMP property.
2. If a legacy IIM dataset exists for it, add it to `IPTCIIM.mapping` with its max byte length.
3. That's all. `CaptionPanel`, `XMPSidecar`, `JPEGMetadata` and search all iterate `IPTCField.allCases`. Check that the panel still fits and scrolls.

### Add a workspace tab
1. `UI/WorkspaceTabBar.swift`: add a case to `Workspace` with `title`, `symbol`, `help`, `tint` (from `HomeStyle`) and `onTint`.
2. Create `UI/<Name>ViewController.swift` with `didBecomeVisible()` and `prepareToLeave()`.
3. `UI/RootViewController.swift`: add it as a child in `loadView`, and handle it in `show(_:)` (leaving plus visibility) and `focusCurrentScreen()`.
4. The View menu picks it up automatically from `Workspace.allCases`. Its shortcut is ⌘ plus its position in the list, so check for clashes in `AppDelegate.buildMenu()`.

### Add a menu command / keyboard shortcut
1. Implement `@objc func doThing(_ sender: Any?)` on the view controller that owns the behavior (usually `BrowserViewController`).
2. Add `item("Do Thing", #selector(B.doThing(_:)), "k", [.command])` in `AppDelegate.buildMenu()`. Search the file for the key first to avoid duplicates. Culling keys are bare letters and digits handled in `handleCullingKey`, so don't reuse those as bare-key menu shortcuts.
3. If it must work from Home, forward it from `RootViewController`.
4. Add it to the shortcuts list in `HomeViewController.shortcuts` and to the Keyboard table in `README.md`.

### Support a new RAW format
1. Add the extension to `FileTypes.raw` in `Photo.swift`.
2. If ImageIO's fallback is too slow, add a candidate finder in `PreviewExtractor` (see `tiffCandidates`, `rafCandidates`, and the CR3 box walk). Validate candidates with `probe`, which rejects lossless SOF3 JPEGs.
3. Measure: thumbnail time per photo should stay under ~1 ms.

### Add something to Code Replacements
- **Parsing or lookup rules:** `Core/CodeReplacements.swift`.
  - `CodeList.parse` / `parseCSV` read files.
  - `CodeReplacements.resolve` interprets a code token, including `#n`.
  - `expand` handles whole strings; `candidate(endingAt:)` finds the code that was just typed.
  - Keep files Photo Mechanic-compatible.
- **Live typing in a new text field:** call `LiveCodeExpansion.apply(to:)` from its delegate's text-change callback. Commit-time expansion happens in `CaptionVariables.expandAll`.
- **Editor UI:** `UI/CodesViewController.swift`.
  - The sidebar is `listTable` / `ListCell`, and the editor is `entryTable` (`EntryTableView`, `EntryCell`) plus `textView`.
  - The inspector is `buildInspector` / `updateInspector`.
  - Save through `saveSelected(list)` so the editor doesn't reload itself mid-edit.
- **New settings:** add a key and property on `CodeReplacements` whose setter calls `notify()`, then react in `codesChanged`. `CaptionPanel.codesChanged` keeps its help line current.

### Add a caption variable
Add the token to `CaptionVariables.all` and its value in `expand(_:for:)` (`Core/CaptionExpander.swift`). It then appears automatically in the caption panel's help text.

### Add a Home section
In `HomeViewController.loadView`, build the view and `add(view, after: spacing)` it in the right place in the job order. Refresh it in `refresh()`. Use `HomeStyle` and `HomeComponents` pieces. Respect `applyBreakpoints` for narrow windows.

### Add a badge
Append to the ladders in `Badges` (`Core/Achievements.swift`) with a **new, permanent** id. Add a row to `Resources/Badges/README.md`. The art is optional because placeholders draw automatically.

### Add a setting
Store it in UserDefaults with a clear camelCase key, and add the key to the list in §4. If the old LensDesk app could have had it, `LegacyMigration` already copies all old keys.

---

## 7. Roadmap ideas (from the user and past sessions)

- **Deferred:** caption templates ("stationery pad" per team or venue), a ⌘K launcher, ingest presets, a backup destination during ingest, metadata presets, account features.
- **Culling and ingest:** side-by-side compare, watched ingest from several cards at once, a disk thumbnail cache for network drives, rename in place with templates.
- **Code replacements:**
  - generate a lookup file from a pasted roster (`#`, name, position) with a team prefix
  - per-shoot sets of active files
  - an autocomplete popup while typing a code
  - `=code#0=` for the code itself
  - export a merged Photo Mechanic file
- **Delivery:** FTP/FTPS sending shipped in desktop. Still open: SFTP, resizing JPGs before sending (long edge for wire), a "sent" badge on photos, a setting to accept a self-signed FTPS certificate, and porting the new IPTC wire fields to the Swift app.

When you finish a feature: build with `./scripts/build.sh`, verify it in the running app on scratch copies, clean up any test entries in stats, update `README.md` (user-facing) and this file (engineering), and tell the user plainly what you verified and what you didn't.
