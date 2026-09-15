# Deadlyne redesign brief

> **Paste everything below into ChatGPT.**
>
> You're a senior product designer. Redesign the Mac app described here. Use **shadcn/ui components and patterns only**, as a strict design system: no custom one-off widgets. The approach is **"less is more"**: the fewest reusable components, the fewest steps to every action, and nothing on screen that isn't needed for the job in front of the user. Read the whole brief, then produce the deliverables listed in section 9.

---

## 1. The product in one paragraph

Deadlyne is a native macOS app for **sports photographers on deadline**, a faster, friendlier replacement for Photo Mechanic. After a game the photographer has 2,000+ RAW+JPEG frames (~78 GB) on a memory card and very little time. Deadlyne takes them from **card → culled → captioned → delivered** as fast as possible. It opens thousands of RAW files instantly by reading the camera's embedded JPEG previews instead of decoding RAW data.

## 2. The user

- A high-school and college sports photographer on a Canon EOS R3, shooting RAW+JPEG.
- Uses Adobe Lightroom for editing and knows Photo Mechanic's workflow.
- Works fast, mostly from the keyboard, often late at night right after a game. Dark UI, dense information, zero friction.
- Delivers JPGs with captions to clients, schools and wire services; the RAWs go to Lightroom.

### The job, in order
1. **Ingest:** copy the memory card into a named, dated folder.
2. **Cull:** flip through every frame, tag the keepers, star-rate and color-label them.
3. **Caption:** write the headline, caption, keywords and credits. **Code replacements** make it fast: the photographer types `=f10=` and it instantly becomes "Jordan Sample (10)".
4. **Deliver:** copy just the tagged JPGs to a folder for the client; open the RAWs in Lightroom.

## 3. Hard constraints (don't design against these)

- **It's a native macOS app (Swift/AppKit), not a website.** Use shadcn/ui as the **design language**: its component set, spacing, radii, states and patterns. The final design will be rebuilt natively, so keep to components that have clear desktop equivalents. Prefer Mac-native behavior: a title-bar toolbar, a menu bar, ⌘-shortcuts, right-click menus, drag and drop.
- **Speed is the product.** Never add a step, modal or confirmation to the culling loop. Photos must always get most of the screen.
- **Keyboard-first.** Every frequent action needs a shortcut, and shortcuts should be *discoverable* (shadcn `Kbd`, tooltips, `Command` palette).
- **Dark mode only.** Pro photo tools stay dark so photos read accurately.
- **Existing keyboard shortcuts stay.** Photographers build muscle memory (see section 7).
- **No accounts, no cloud, no sign-in.** The profile is optional and stays on the Mac.
- Say "ingested", never "uploaded".

## 4. Brand tokens (map these onto shadcn's theme variables)

| Token | Hex | Use today |
|---|---|---|
| Brand / primary | `#FF3D00` | brand orange, primary actions, Home tab |
| Primary light | `#FF6B2B` | links, hover |
| Primary dark | `#D62900` | pressed |
| Amber | `#FFBD4D` | warnings, Photos tab |
| Green | `#59E673` | "ready" states, Codes tab, valid codes |
| Red | `#FF7366` | errors, duplicates |
| Background | `#1B1B1B` | app background, grid |
| Panel | `#212121` | side panels |
| Bar | `#242424` | top bars, status bar |
| Card | `#262626` | cards |
| Border | `#3B3B3B` | borders |
| Text | `#F0F0F0` / `#ADADAD` / `#8A8A8A` | primary / secondary / tertiary |
| Color labels | Red, Yellow, Green, Blue, Purple | Lightroom-compatible photo labels |

Type is the macOS system font (SF Pro), with SF Mono for codes.

## 5. Current app: full inventory

### 5.1 Window shell
- **Title bar:** app icon, then a pill of **workspace tabs**: `Home` · `Photos` · `Codes` (⌘1/2/3). The active tab fills with its color: Home orange, Photos amber, Codes green.
- The **menu bar** holds every command (File, Edit, Caption, Cull, View, Window).
- Extra windows: **Ingest**, **Profile** (a sheet), **Achievements**. A **badge unlock banner** slides in at the top when a milestone is hit.

### 5.2 Home (landing screen, always shown at launch)
Top to bottom:
1. Header: app logo and name on the left; a profile chip (avatar and name) on the right.
2. Greeting ("Good evening, Austyn.") plus the date and a status line.
3. **Three big action cards:**
   - **Ingest Photos** (orange, ⇧⌘I)
   - **Open Folder** (⌘O)
   - **Continue culling** (the last shoot's cover photo, "1,408 of 2,191 reviewed · 143 selects")
4. **Live area**, only when active: a connected memory card (camera, photo count, size, destination, a free-space warning, a "Start ingest" button), or ingest progress (files copied, GB left, time estimate, Stop and Show buttons).
5. **Recent shoots:** one row per shoot with a thumbnail, readable name ("Fairborn vs. Tecumseh · Boys Varsity · Aug 21, 2026"), culling progress bar, selects count, last opened, and "Start culling →". Rows can be pinned, revealed in Finder or removed via right-click. A ··· menu offers "show all" and "clear"; unavailable drives are dimmed ("Not available — is the drive connected?").
6. **Ingest setup:** four cells (Destination with free space, Job folder template, File names, After copying), plus an "Open Ingest…" link.
7. **Stats strip:** "This month 3,268 photos ingested · 2 new shoots", plus the next badge and "View achievements →".
8. **Keyboard shortcuts:** six key chips, with "View all shortcuts" to expand.
9. A one-line footer explaining the speed trick.
10. A profile prompt card, if no profile exists and it hasn't been dismissed.

### 5.3 Photos (the culling workspace, where users spend 90% of their time)
- **Top bar, one row of 13 controls:**
  1. Home button (redundant with the tabs)
  2. Open
  3. Ingest
  4. Folder path (truncates badly)
  5. All / Tagged / Untagged segmented control
  6. Rating filter (Any Rating, ★1+…★5)
  7. Label filter (Any Label, Red…Purple)
  8. Files (RAW + JPG / RAW Only / JPG Only)
  9. Sort (Capture Time / Filename)
  10. Thumbnail size slider
  11. Search field ("Search captions, keywords")
  12. Caption panel toggle
- **Contact sheet grid:** thumbnails with a tag checkbox, file name, file-type badge (RAW+JPG / JPG), star rating and a caption indicator. A color label tints the cell. The selection is outlined.
- **Loupe preview** (Space/Return): full-window image; ←/→ to flip; Z or click for 100% zoom and drag to pan. A HUD overlay shows file name, "12 / 2,191", ✓ TAGGED, stars, label, and camera/lens/exposure.
- **Caption panel** (right side, 330pt, ⌘I):
  - Header shows the file name, or "12 photos — edits apply to all".
  - **11 fields always visible:** Headline, Caption (multi-line), Keywords (tokens), Event, Venue, City, State, Country, Photographer, Credit, Copyright.
  - "Captions in JPG files" dropdown: XMP + legacy IPTC / XMP only / Don't write into JPGs.
  - A long help paragraph about codes and variables (`{date} {weekday} {time} {camera} {lens} {focal} {shutter} {aperture} {iso} {filename}`).
  - Buttons: **Codes…** and **Fill from Profile**.
  - A code status line: "● 6 codes ready · Sample Roster".
  - Fields show "Multiple values" when the selection differs. Edits save when you leave a field.
- **Status bar:** the selected photo's name, camera, lens, exposure and date on the left; "2,191 photos · 143 tagged" and saving progress on the right.
- **Empty state:** "Open a folder of photos", with Open Folder and Ingest from Card buttons, plus "or drag a folder onto this window".
- **Right-click on photos:** Preview, Edit Caption, Tag/Untag, Rating ›, Color Label ›, Copy/Paste Caption Info, and file actions.

### 5.4 Codes (code replacements workspace)
Three panes:
- **Left, "Lookup files":** a list of roster files, each with an on/off checkbox, name and code count. Below it: New, Import…, and a ··· menu (Rename, Add Prefix to Every Code, Sort by Code, Show in Finder, Open Lookup Files Folder, Move to Trash). A hint reads "Drop .txt or .csv rosters anywhere".
- **Center, editor:**
  - Header: file name, "6 codes · 3 columns", search, a Table/Text toggle, "+ Column", "+ Code".
  - A **spreadsheet-style table** with columns: Code | #1 Name · default | #2 Team | #3 Position. Tab and Return move between cells; ⌘V pastes rows from Excel.
  - A footer shows warnings (duplicates, codes shadowed by another file) or "Saved automatically · path".
- **Right, inspector:**
  - **Delimiter** dropdown (`=` default)
  - **Expand codes as you type** checkbox
  - **How it works:** live examples built from real codes, e.g. `=f10=` → Jordan Sample (10), `=f10#2=` → Fairborn Skyhawks
  - **Try it:** a text box that expands codes live, with a result line
  - **Active while captioning:** a list of the files that are on

How codes work: a lookup file is tab-delimited, e.g. `f10⇥Jordan Sample (10)⇥Fairborn Skyhawks⇥quarterback`. `=code=` inserts column 1 and `=code#2=` inserts column 2. Several files can be on at once (home roster, away roster, venues).

### 5.5 Ingest window
- Source (card) dropdown
- Destination and a Choose… button
- Job name ("e.g. Fairborn-vs-Tecumseh")
- Folder template (tokens `{job} {date} {year} {month} {day} {time} {seq} {original} {camera}`)
- Rename checkbox, template and "start at" number
- Skip already-ingested checkbox
- Eject when done checkbox
- A live example of the resulting path
- Start and Cancel buttons, plus a progress bar

### 5.6 Profile (sheet)
Photo (Choose/Remove), Name (required), Credit line, Copyright (with `{year}`/`{name}` tokens), Email, Website, a preview of what "Fill Credits" will write, and Save / Cancel / Delete Profile.

### 5.7 Achievements window
Two badge ladders: photos ingested (100 → 1,000,000: Warm-Up, Kickoff, First Thousand, Game Day, Starter, Varsity…) and shoots (1 → 250). Each shows the art, name, threshold, and earned date or progress. The user designs the badge art themselves.

## 6. Key flows: current step counts and friction

| Flow | Today | Friction |
|---|---|---|
| Resume last shoot | Launch → click Continue (1 click) | Good; keep it |
| Ingest a card | Home → Ingest card → window → check source, destination, job name, template, rename, skip, eject → Start (~5–8 interactions) | Separate window; settings duplicated on Home; template tokens are jargon; job name is re-typed every game |
| Cull | Space opens the loupe, T tags, 1–5 rate, arrows move | Good; keep it keyboard-pure |
| Caption one photo | Select → ⌘I (if the panel is hidden) → ⌘↩ → type → Esc (3–4 steps) | 11 fields always shown; the most-used (Caption) isn't first; long help text |
| Caption with codes | Codes tab → Import roster → back to Photos → type `=f10=` (≈4 steps) | Codes live in another workspace, so there's context switching during setup |
| Deliver tagged JPGs | Files → JPG Only → File → Copy Tagged To… → pick folder (3–4 steps) | Relies on knowing the file-scope trick; not discoverable |
| Fill credits | ⌥⌘P or a button (1 step) | Hidden until you have a profile |
| Find a photo by caption | ⌘F → type | Search sits among many controls |

**Other observations:**
- The Photos top bar is crowded: 13 controls, a redundant Home button, and a folder path that truncates to "/…st".
- There are three ways into the same things (Home cards, top bar buttons, menus) with inconsistent styling.
- Filters (tag, rating, label, files, sort) are five separate controls but could be one filter popover with active-filter badges.
- The caption panel mixes rarely changed settings (JPG caption format) with per-photo fields.
- Help text is long, and it's shown permanently instead of on demand.
- The Codes workspace's three panes are powerful but heavy for a "load tonight's rosters" task.

## 7. Keyboard shortcuts (must keep)

| Key | Action |
|---|---|
| `T` | Tag |
| `1–5` / `0` | Rate / clear |
| `6 7 8 9` | Red/Yellow/Green/Blue label |
| `Space` / `Return` | Loupe |
| `← →` | Previous / next |
| `Z` | 100% zoom |
| `I` | Info overlay |
| `Esc` | Back |
| `⌘1 / ⌘2 / ⌘3` | Home / Photos / Codes |
| `⌘O` | Open folder |
| `⇧⌘I` | Ingest |
| `⌘I` | Caption panel |
| `⌘↩` | Jump to caption |
| `⌥⌘C / ⌥⌘V` | Copy/paste caption |
| `⌥⌘P` | Fill credits |
| `⌘F` | Search |
| `⇧⌘T` | Select tagged |
| `⇧⌘C / ⇧⌘M` | Copy / move tagged to… |
| `⌥⌘1–3` | All / tagged / untagged |
| `⌥⌘4–6` | RAW+JPG / RAW / JPG |
| `⌘= / ⌘-` | Thumbnail size |
| `⇧⌘A` | Auto-advance |
| `⌘⌫` | Trash |
| `⌘,` | Profile |
| `⇧⌘H` | Home ↔ photos |

## 8. Redesign goals

1. **Less is more.** Aim for a small, closed set of reusable components (target: ~15 shadcn components for the whole app). The same component solves the same problem everywhere, e.g. one filter pattern, one list-row pattern and one settings pattern.
2. **Fewest steps.** For each flow in section 6, show the new step count. Target:
   - ingest ≤ 2 clicks when the card and destination are known
   - deliver tagged JPGs ≤ 2 steps
   - load rosters ≤ 2 steps without leaving Photos
3. **Photos get the screen.** Chrome collapses to one slim bar; panels are on demand.
4. **Progressive disclosure.** Show the common 20% by default and put the rest one click away (popover, collapsible, dialog).
5. **Discoverable speed.** A `Command` palette (⌘K) reaches every action, shows its shortcut, and makes menu hunting unnecessary.
6. **Never lose work, never block.** Autosave everywhere. Use toasts (`Sonner`) instead of alerts; confirm only destructive actions.

### shadcn vocabulary to draw from (use the fewest)
`Tabs`, `Button`, `ButtonGroup`/`ToggleGroup`, `DropdownMenu`, `ContextMenu`, `Command` (⌘K palette), `Popover`, `Dialog`, `Sheet`, `Select`, `Input`, `Textarea`, `Field`, `Switch`/`Checkbox`, `Slider`, `Badge`, `Kbd`, `Tooltip`, `Card`, `Item` (list rows), `Table`, `Progress`, `Sonner` (toast), `Empty` (empty states), `Resizable`, `ScrollArea`, `Separator`, `Collapsible`, `Sidebar`.

## 9. Deliverables I want from you

1. **Component inventory:** the final, minimal list of shadcn components used, and for each, every place it appears. Flag anything you'd merge or remove from today's UI.
2. **Information architecture:** the workspaces and panels, and what moved where compared with section 5 (a before → after table).
3. **Screen-by-screen layouts** for Home, Photos (grid, loupe, caption editing, multi-select), Codes (or wherever roster management ends up), Ingest, and the Profile/settings surface. Describe each layout region by region, with the exact shadcn components and their variants.
4. **Flows with step counts,** before → after, for every flow in section 6.
5. **Empty, loading, error and multi-select states** for each screen.
6. **Copy:** button labels, empty-state text and tooltips, short and in the photographer's language.
7. **A working prototype** in React + Tailwind + shadcn/ui (one page with the three workspaces, mock data: a 2,000-photo shoot and a 30-player roster) so I can click through it. Keep it faithful to a desktop Mac window (~1600×1000).
8. **A token sheet** mapping the brand colors in section 4 onto shadcn theme variables (`--background`, `--primary`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`, plus chart/label colors).

Keep everything implementable natively on macOS: no web-only patterns like infinite marketing scroll, hover-only critical actions, or page navigation.
