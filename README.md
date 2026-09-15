# Deadlyne

A photo browser and culler in the spirit of Photo Mechanic, built for flipping through thousands of RAW frames with no render delay.

This repo holds two apps:

- **`desktop/`: Deadlyne for macOS and Windows** (Tauri: Rust + React + shadcn/ui), with auto-updates from GitHub Releases. This is where new work goes. See [desktop/README.md](desktop/README.md).
- **The repo root: the original native Mac app** (Swift/AppKit), described below. It stays usable until the desktop app has all its features.

## Why Photo Mechanic (and Deadlyne) are fast

Photo Mechanic doesn't use a secret RAW decoder. It **skips RAW decoding completely.**

Every RAW file already contains JPEGs that the camera rendered when you pressed the shutter. A Canon R3 `.CR3`, for example, contains:

| Embedded image | Size | Where it lives |
|---|---|---|
| Thumbnail | 160×120 | `THMB` box in the Canon `uuid` |
| Preview | 1620×1080 (~400 KB) | `PRVW` box in a second `uuid` |
| **Full-size JPEG** | **6000×4000 (~2 MB)** | first track of `mdat` |

Lightroom demosaics 24 MP of sensor data for each frame. A fast browser reads the file's index, seeks straight to the JPEG it needs, and hands it to the hardware JPEG decoder. Deadlyne does the same thing:

- **`PreviewExtractor`** parses CR3 (ISO-BMFF boxes), TIFF-based RAWs (CR2, NEF, ARW, DNG, ORF, RW2, PEF, SRW…: IFD chains, SubIFDs, EXIF IFD) and Fuji RAF headers. It reads only the header bytes plus the chosen JPEG using `pread`, and never maps the whole 30–60 MB file.
- Candidates are validated by their JPEG SOF marker. Lossless JPEG (SOF3), which CR2 and DNG use for raw sensor data, is rejected.
- **Thumbnails** decode the ~1600px embedded preview with DCT scaling. **Previews** decode the full JPEG with 1/2 subsampling. **100% zoom** decodes it at full resolution.
- The RAW's EXIF orientation is applied, because embedded previews are stored in sensor orientation.

Measured on this Mac (M-series, 18 cores) with a 2,192-frame Canon R3 football shoot (78 GB):

| Step | Time |
|---|---|
| Scan folder + pair RAW/JPEG | 33 ms |
| EXIF + sidecars for all 2,192 photos | ~0.9 s |
| Locate embedded JPEGs in a CR3 | 0.07 ms/file |
| Grid thumbnail | ~0.4 ms/photo (parallel) |
| Full-resolution 6000×4000 decode | ~39 ms |

## Features

- **Home screen.** Deadlyne always opens here. It's laid out in the order of the job:
  - **Ingest / Open Folder / Continue culling.** Continue shows exactly where you stopped ("1,408 of 2,191 reviewed · 143 selects") and reopens the shoot on the last photo you were on.
  - **Live area.** Appears only when something is happening. A connected card shows its camera, photo count and size, where it will copy to, and a warning if the destination doesn't have room. While an ingest runs, you see files copied, GB remaining and a time estimate, with Stop and Show buttons.
  - **Recent shoots.** One row per shoot, with a readable name (`Boys_Varsity-Fairborn-vs-Tecumseh_082126` shows as "Fairborn vs. Tecumseh · Boys Varsity · Aug 21, 2026"), culling progress, selects, five-star count and when you last opened it. Right-click a row to pin it to the top, reveal it or remove it. The ··· menu shows all shoots or clears the list (pinned shoots stay).
  - **Ingest setup.** Destination (with free space), job folder, file names and after-copy behavior. Click Destination to change it right there.
  - A one-line **stats strip** (this month's photos and shoots, next badge) and the essential **keyboard shortcuts**, with View all.
  ⇧⌘H (or the house button) switches between Home and the photos without reloading the folder.
- **Optional profile (⌘,).** Add your name, credit line, copyright notice and a photo. The profile is stored only on this Mac, with no account. **Caption → Fill Credits from Profile** (⌥⌘P), or the button in the caption panel, writes Photographer, Credit and Copyright into the selected photos. In the copyright notice, `{year}` becomes each photo's capture year. You never need a profile to use Deadlyne.
- **Badges and progress.** Deadlyne counts every photo you ingest from a card, plus every photo in a folder the first time you open it. A RAW+JPG pair is one photo, and reopening a shoot or re-ingesting a card never counts twice. You earn milestone badges on two tracks: photos ingested (100 up to 1,000,000) and shoots (1 up to 250). Home shows this month's count and the next badge in one line. Clicking it opens the full **Achievements** window (also in the Deadlyne menu). A banner pops up when you unlock a badge. Badge artwork goes in `Resources/Badges/`; see the README there for the spec and ids. Badges without artwork use placeholder medallions.
- **Contact sheet.** Thousands of thumbnails, warmed in the background in display order. Visible cells always load first.
- **RAW+JPEG pairing.** `MCD_0001.CR3` and `MCD_0001.JPG` show as one photo and are copied, moved and trashed together.
- **Loupe preview.** Space or Return opens it; ←/→ flip through photos. Neighbours are pre-decoded so the next frame is instant. Click or press `Z` for a 100% focus check, then drag to pan.
- **Culling.** Tag, 0–5 star ratings and color labels, applied to every selected photo at once. **Auto-advance** (⇧⌘A) moves to the next frame after each rating.
- **Adobe-compatible XMP sidecars.** `xmp:Rating` and `xmp:Label` are written to `BASENAME.xmp`, so Lightroom, Camera Raw, Bridge and Capture One pick them up. Existing sidecars are edited in place: Camera Raw develop settings are never touched.
- **Filter and sort.** Show All, Tagged or Untagged; filter by minimum rating and by color label; sort by capture time (sub-second) or filename.
- **Captions and keywords (⌘I).** An IPTC panel with Headline, Caption, Keywords, Event, Venue, City, State, Country, Photographer, Credit and Copyright. Edits apply to every selected photo (or the photo in the preview) and are saved when you leave a field.
  - RAW files get Adobe-standard IPTC in the `.xmp` sidecar, next to Lightroom's data and without touching it.
  - JPG files get the same fields **embedded in the file** with a lossless metadata rewrite, so the pixels stay byte-identical. Choose the format under **Captions in JPG files**:
    - **XMP + legacy IPTC** (default, like Photo Mechanic). Writes both XMP and the older IPTC-IIM block that many wire services and archive systems still read. The IIM block is UTF-8 flagged, carries Photoshop's IPTC digest, and adds Date/Time Created from EXIF (with the time zone). Values are trimmed to IIM's length limits on character boundaries; the XMP keeps the full text. Existing IIM datasets Deadlyne doesn't edit (special instructions, category…) are kept, and old charset-less text is re-encoded correctly.
    - **XMP only.** Also removes Deadlyne's fields from any existing IIM block, so older systems never read a stale caption.
    - **Don't write into JPGs.** Captions go only in the `.xmp` sidecar.
  - Keywords **merge** across a multi-selection: adding "Tecumseh" to 40 photos keeps each photo's other keywords.
  - **Code replacements.** Type a code wrapped in the delimiter, like `=f10=`, and it turns into the full text the moment you type the closing `=`: "Jordan Sample (10)". Add a column number to pull other data from the same line: `=f10#2=` gives the team and `=f10#3=` the position. Codes aren't case-sensitive. Unknown codes stay as typed, and pasted text full of codes expands too.
  - **Variables** fill in per photo from capture metadata: `{date} {weekday} {shortdate} {time} {camera} {lens} {focal} {shutter} {aperture} {iso} {filename}`.
  - **Copy/Paste Caption Info** (⌥⌘C / ⌥⌘V) stamps one photo's caption onto others.
- **Workspace tabs.** The title bar switches between **Home**, **Photos** and **Codes** (⌘1 / ⌘2 / ⌘3), Affinity-style. The active tab lights up in its own color: orange, amber or green.
- **Codes workspace (Photo Mechanic–style lookup files).**
  - **Lookup files** are rosters. Each line is a code, a Tab, then as many columns as you like (`f10⇥Jordan Sample (10)⇥Fairborn Skyhawks⇥quarterback`). Photo Mechanic tab-delimited files work as-is.
  - **Import** `.txt` or `.csv` rosters with the Import button, or drag them onto the window. Spreadsheet header rows ("Code, Name, Team…") become column names. UTF-8, UTF-16 and Windows encodings are handled.
  - **Several files can be on at once**, for example the home roster, the away roster and venues. Tick a file to use it while captioning. If two active files share a code, the file whose name sorts first wins, and the other file's copy is flagged.
  - **Edit as a table**: Tab, Shift-Tab and Return move between cells like a spreadsheet. ⌘V pastes rows copied from a spreadsheet, ⌘C copies rows, Delete removes them. Right-click a column header to name it ("Team"). Switch to **Text** to edit the raw file. Every edit saves immediately.
  - **Add Prefix to Every Code…** (the ··· menu) turns a numbers-only roster into `f10`, `f22`… so both teams' #10s can coexist. **Sort by Code**, **Show in Finder** and **Move to Trash** are there too.
  - **Delimiter**: `=` by default, or `\` `;` `~` `` ` `` `|` `^`. You can also turn off expanding as you type, so codes expand only when you leave the field. **Try it** checks a code and shows which file and column it came from.
  - Files live in `~/Library/Application Support/Deadlyne/Code Replacements/`. Edits made in a text editor are picked up when you switch back to Deadlyne.
- **Search** (⌘F) filters by filename, caption, headline, keywords or any other caption field.
- **Files: RAW + JPG / RAW Only / JPG Only** (⌥⌘4/5/6). Shows pairs, or only photos that have that file type. Copy, move, drag, open and trash then act **only on that file type**. For example, JPG Only followed by Copy Tagged sends a client just the JPGs.
- **Copy/Move tagged.** Sends RAW, JPEG and sidecar together (or just the chosen file type) and never overwrites.
- **Move to Trash** is always recoverable.
- **Ingest.** Detects memory cards (any volume with `DCIM`) and copies into dated or job-named folders with template renaming. It verifies file sizes, skips photos already ingested and can eject the card when done.
- **Drag out.** Drag thumbnails straight into Photoshop, Lightroom, email and so on.
- Reveal in Finder, Open in Default App, Open Recent, and drag a folder onto the window to open it.

## Keyboard

| Key | Action |
|---|---|
| `T` | Toggle tag |
| `1`–`5` / `0` | Star rating / clear |
| `6` `7` `8` `9` | Red / Yellow / Green / Blue label (press again to clear) |
| Space / Return | Open / close preview |
| ← → ↑ ↓ | Move selection (grid) · previous/next photo (preview) |
| `Z` | Zoom to 100% at the pointer / back to fit |
| `I` | Toggle the info overlay in the preview |
| Esc | Back to the grid |
| ⌘⌫ | Move to Trash |
| ⇧⌘C / ⇧⌘M | Copy / Move tagged photos to… |
| ⇧⌘T | Select tagged |
| ⌥⌘1 / 2 / 3 | Show all / tagged / untagged |
| ⌘= / ⌘- | Bigger / smaller thumbnails |
| ⇧⌘I | Ingest from card |
| ⇧⌘A | Auto-advance after rating |
| ⌘I | Show / hide the caption panel |
| ⌘↩ | Jump into the caption field · save and return to the photos |
| Esc (in a caption field) | Save and return to the photos |
| ⌥⌘C / ⌥⌘V | Copy / paste caption info |
| ⌘F | Search captions and keywords |
| ⌥⌘4 / 5 / 6 | Files: RAW + JPG / RAW only / JPG only |
| ⌘1 / ⌘2 / ⌘3 | Home / Photos / Codes workspace |
| ⇧⌘H | Home / back to photos |
| ⌥⌘P | Fill credits from profile |
| ⌘, | Profile |

## Build

Requires Xcode 16+ (Swift 6 toolchain), macOS 14+.

```bash
./scripts/build.sh          # → build/Deadlyne.app
open build/Deadlyne.app
```

You can also pass a folder: `open build/Deadlyne.app --args /path/to/shoot`, which skips Home and opens the folder directly. Otherwise the app opens on Home.

### Signing

`build.sh` signs with the best certificate it finds, in this order: `$DEADLYNE_SIGN_IDENTITY`, then **Developer ID Application** (for distribution), then **Apple Development**, then ad-hoc. It also enables the hardened runtime. A stable certificate lets macOS remember Deadlyne's folder permissions across rebuilds.

To create the Apple Development certificate:
1. In Xcode, open Settings → Accounts, select your team, click Manage Certificates, then **+** → Apple Development.
2. If `security find-identity -v -p codesigning` still shows 0 valid identities, install Apple's **Worldwide Developer Relations – G3** intermediate from <https://www.apple.com/certificateauthority/>. Older Macs only have the G1 intermediate, which expired in 2023.

To share the app with other people, you need the paid Apple Developer Program. It provides a Developer ID Application certificate, which `build.sh` picks up automatically, and lets you notarize the app with Apple before distributing it.

## Using with Lightroom

Deadlyne writes ratings and labels to XMP sidecars. For photos that are already in a Lightroom catalog, select them and choose **Metadata → Read Metadata from Files**. When you import new photos, Lightroom reads the sidecars automatically.

## Project layout

```
Sources/Deadlyne/
  App/    main.swift, AppDelegate (window + menus)
  Core/   PreviewExtractor (the speed), ImagePipeline (decode + caches),
          Photo, FolderLoader, XMPSidecar, FileOps, RecentShoots, Profile,
          CodeReplacements (lookup files + live expansion), CaptionExpander (variables)
  UI/     RootViewController (switches Home ↔ browser), HomeViewController,
          HomeComponents, ProfileWindowController, BrowserViewController,
          WorkspaceTabBar (title-bar tabs), CodesViewController (lookup files),
          GridView, ThumbnailCell, PreviewView, IngestWindowController
scripts/  build.sh, make_icon.swift (masks the artwork into the macOS icon shape)
Resources/AppIcon-source.png   the 1024×1024 icon artwork — replace it and rebuild to change the icon
```

## Roadmap ideas

- Saved caption templates (a "stationery pad" per team or venue)
- Side-by-side compare
- Watched ingest (several cards at once, secondary backup destination)
- Persistent on-disk thumbnail cache for network drives
- Rename in place with templates
