# Deadlyne UI audit — November 4, 2026

Applied the ui-ux-pro-max skill to the active Tauri/React macOS app in `desktop/`. Kept the existing components, account and photo workflows, store logic, shortcuts and native file operations. The original Swift/AppKit reference app was outside this pass. The working tree already contained unrelated work; the file list below describes this audit's changes only.

## Changes

- Extended `src/index.css`, the existing shadcn/Tailwind theme, with readable brand text, button hover, control surfaces, canvas/overlay/hover surfaces, floating/resume shadows, compact typography, dialog gutters, corner radii and interaction timing tokens. Kept the native system font and existing spacing scale. No second theme or external fonts.
- Kept brand orange `#ff3d00`. Its primary foreground is now dark ink: **5.32:1**, up from **3.55:1** with white. Text on dark surfaces uses `primary-readable`; bright Photos/Codes tabs and tags use `workspace-foreground`. Input boundaries are **3.06:1** against the popover surface. Control surfaces have their own tokens so strengthening the boundary cannot wash out placeholder text.
- Added a full-strength 2px keyboard outline, including native editable roster cells. Hidden photo ratings become visible on focus. Added selector/progress labels, photo alt text, star pressed state, valid tree levels and workspace tab/panel relationships. Recent-shoot and roster selection targets are keyboard reachable without nesting other controls inside them.
- Set the existing dark class on the document. Deadlyne supports **dark UI only**; it was checked under both light and dark OS preferences. No light theme was introduced.
- Dialogs share tokenized viewport limits and scrolling. Codes toolbar wraps at narrow desktop widths; its existing side panels narrow below 1280px and its table uses fixed columns so every action and column remains reachable at the 960px minimum. Home actions stack below 640px. Existing layouts and controls remain.
- Reduced motion disables animated movement while retaining static state feedback. Existing `Button` press scaling and `static` controls are preserved in normal motion.
- Shared primitives now use the existing `lib/utils.ts` class-merging entry point. It recognizes the new font-size token names, preventing compact button sizing from dropping its foreground color.

## Verification

- `npm run build`: passed; the build still reports bundle-size and mixed static/dynamic import warnings.
- `npm test`: all 84 tests in 15 files passed.
- `npm run build:mac`: passed; produced `src-tauri/target/release/bundle/macos/Deadlyne.app`. The local bundle was not installed or launched; notarization was skipped by the existing local build configuration.
- Playwright Chromium and WebKit: **42 cases, no automated WCAG A/AA violations, page errors, root overflow or offscreen header/dialog controls** in the exercised states. Screenshots inspected for Home, Photos and Codes, including 960px layouts.
- Workspaces checked at 960, 1024 and 1440px, with 600px desktop height; sign-in checked at 375, 768 and 960px. Exercised Ingest, Export, Send, FTP servers, Settings and Shortcuts dialogs, including 375×400 dialog scrolling.
- Both engines passed actual keyboard checks for workspace arrow keys, two-step search Escape, focus visibility on unrated stars, dialog focus trapping and Escape close. Editable table Tab focus has a 2px solid focus outline. Reduced-motion transitions compute to 0.01ms.
- Tests ran in an ignored fixture that intercepts all Tauri commands and blocks external requests. No real shoots, credentials, FTP servers, account data, library records or review statistics were changed; no running Deadlyne app was quit or relaunched.
- This is UI verification with simulated data, not native photo decoding, file-operation or live-account verification. VoiceOver, an actual iPad and native increased-text-size settings were not manually exercised. Full workspace layouts below the Mac app's 960px minimum are not claimed.
- Evidence and the isolated harness are under ignored `.verification/ui-audit/`: `results.json`, `keyboard-results.json`, screenshots and build logs. No verification dependencies were added to the project.

## Remaining literals

- **26 lines of literal colors remain**, all in the decorative SVG illustrations in `FolderIcon.tsx` and `FolderView.tsx` (`DocIcon`). Their artwork gradients, highlights and shadows are intentionally preserved; document type accents already use semantic tokens. No hex/rgb/oklch literals remain elsewhere in React components or `App.tsx`.
- Layout calculations remain in `PhotosView.tsx` (virtualized grid geometry), `Sidebar.tsx` (widths/tree indentation), `CaptionPanel.tsx` and `FolderView.tsx` (340px inspector widths), `LibraryView.tsx`/`FolderView.tsx` (table columns and auto-fill minima), `Loupe.tsx` (image transforms/zoom), `IconSwap.tsx`/`HomeView.tsx` (animation geometry) and the currently unused `ViewProgress.tsx` (segment geometry). These are component/content geometry, not alternate color or typography themes. No review progress bars were added.
- Existing Tailwind spacing, font, opacity, icon-size and z-index utilities remain where they use the shared scale. Radix/shadcn still owns its positioning transforms, hit-area geometry and animation helpers. Those were not replaced with a separate style system.
- Native shell launch background colors in Tauri configuration and the Swift reference UI were not changed; the shell already matches the dark background.

## Changed files

Foundation: `index.html`, `src/lib/utils.ts`, `src/index.css`. The following existing UI files were updated (some shared primitives only change their class-merger import). Documentation: `UI_AUDIT.md`, `README.md`, the root `README.md` and `AGENTS.md`.

- `src/App.tsx`
- `src/components/AccountDeletionDialog.tsx`
- `src/components/AddFilesDialog.tsx`
- `src/components/AuthGate.tsx`
- `src/components/CaptionPanel.tsx`
- `src/components/CodesView.tsx`
- `src/components/ExportDialog.tsx`
- `src/components/FolderIcon.tsx`
- `src/components/FolderView.tsx`
- `src/components/FtpServersDialog.tsx`
- `src/components/HomeView.tsx`
- `src/components/IconSwap.tsx`
- `src/components/IngestDialog.tsx`
- `src/components/LibraryView.tsx`
- `src/components/Loupe.tsx`
- `src/components/PhotosView.tsx`
- `src/components/ProfileDialog.tsx`
- `src/components/SendDialog.tsx`
- `src/components/ShortcutsDialog.tsx`
- `src/components/Sidebar.tsx`
- `src/components/TitleBar.tsx`
- `src/components/ViewProgress.tsx`
- `src/components/ui/alert-dialog.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/context-menu.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/empty.tsx`
- `src/components/ui/field.tsx`
- `src/components/ui/input-otp.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/item.tsx`
- `src/components/ui/kbd.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/popover.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/scroll-area.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/slider.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/toggle-group.tsx`
- `src/components/ui/toggle.tsx`
- `src/components/ui/tooltip.tsx`

November 11, 2026: removed the badge dialog and its medal palette as part of removing gamification. Original artwork remains archived and unused.

---

# Usability pass — November 11, 2026

A second pass over the same Tauri/React app, against a general UI/UX standards checklist (hierarchy, consistency, accessibility, flows, feedback, responsive behavior). It is an improvement pass, not a redesign: brand, palette, typography, components and copy are unchanged except where a finding below required it. The November 4 results above still hold; contrast and focus rings were re-checked and needed no changes.

## What was wrong, and what changed

**High**

- **Return didn’t run the default action.** Export, Send and Ingest opened with focus on a secondary control (the account preset or a toggle), so “⇧⌘E, Return” opened a menu and “⇧⌘U, Return” did nothing. Export, Send and Add files now open on their enabled submit button (`focusDefaultAction` in `lib/utils.ts`); Ingest is a form that opens on the job name with its text selected, and Return starts it. “Scanning the card…” moved from under the dialog’s footer to beside the progress bar, in the dialog and on Home.
- **The library was unreachable in narrow windows.** Below 1100px (and on iPad in portrait or split view) the sidebar became a rail with no way to reach Collections or the folder tree; its first icon looked like a button but did nothing, and ⌥⌘S / View ▸ Show Sidebar had no visible effect. The rail’s first button and ⌥⌘S now open the full sidebar over the photos. Arrow keys work immediately; it closes when you pick something, on Escape or on a click elsewhere.
- **A missing shoot was a dead end.** Home listed it as “0 photos”; opening it anywhere showed a raw file-system error after switching workspaces. Home now says “Folder not found” with a Locate… button; opening a missing shoot from Home, the library or the sidebar stays where you are, explains the likely cause and offers Locate…, then opens the folder from its new place. A drive that has come back simply opens.
- **Title-bar controls were pushed off screen.** With an FTP send showing, the bar overflowed by up to 59px at the 960px minimum (and by up to 44px near 1120px), clipping Open. Filter and Open now drop their words below 1280px, as Export and Captions already did, and Export / ⋯ / Captions sit together as one group.

**Medium**

- Home’s recent-shoot rows had uneven heights: details wrapped under space reserved for hover-only buttons. Details are one line of secondary text and every row is the same height.
- In Export and Ingest, the “In a new folder” and “Rename files” inputs were squeezed to about 147px because their labels grew; they now get the rest of the row (about 270px).
- Accessible names: library and document grid cards were named by their file path; the workspace tabs, the tagged filter and the dialogs’ Photos / Files groups had no name; each FTP row’s Edit button now says which server it edits.
- Codes table cells cut long names mid-letter; they end in an ellipsis.
- Icon-only buttons whose meaning isn’t obvious gained the same tooltips the rest of the app uses: caption help, caption settings, hide captions (with ⌘I), sort shoots, expand sidebar (with ⌥⌘S).

**Low**

- Sidebar group arrows also appear on keyboard focus and on touch, not only under a mouse.
- Grid stars have a taller hit area (28px) and respond to hover; a truncated file name shows in full on hover.
- Add files: the copy/link choice follows the radio-group keyboard pattern (arrows move it, one tab stop).
- Looking in on a running ingest (Home ▸ Show) no longer opens with Stop in focus, so a stray Return can’t stop the copy.

## Verification

- `npx tsc --noEmit`, `npm run build`: passed (the same bundle-size and mixed-import warnings as before).
- `npm test`: 89 tests in 16 files passed, including 5 new ones in `src/lib/missing-shoot.test.ts`.
- A browser harness under ignored `.verification/ux-pass/` ran the real interface with every native command mocked, invented shoots and outside requests blocked. In Chromium at 960, 1024, 1100, 1120, 1279, 1280 and 1440px:
  - Title bar: no overflow and a 12px right margin in every send state (none, sending, sent, failed) with two filters on; before the change the same measurements overflowed.
  - Dialog focus: Export and Send open on their submit button, Ingest on the job name; Return in Ingest called the (mocked) ingest once with the expected options.
  - Flyout: opens from the rail and from ⌥⌘S, starts on the current row, survives expanding a group, closes on Escape, ⌥⌘S and navigation, and a culling key works straight afterwards. At 1280px the sidebar behaves as before.
  - Missing shoot: Home stays on Home and shows the Locate… message; rows measure the same height with nothing truncated.
  - Heuristic checks on Home, Photos, loupe, library and Codes: no text below 4.5:1, no unnamed controls, no duplicate ids, no horizontal overflow, and a visible focus indicator on every focusable control.
- The dev build in a real Mac window (WebKit and the real Rust backend), driven with scratch photos, a throwaway home folder and the development-only sign-in bypass, so no real shoot, roster, setting or account was read or written:
  - Home listed a missing shoot as “Folder not found” with Locate…. Opening it from Home and from All shoots stayed put and showed the message with Locate…; after the folder was put back on disk the same double-click opened it.
  - File ▸ Export… then Return exported the two tagged scratch photos. Ingest opened on the job name with its text selected (typing replaced it); no ingest was run.
  - At 1000×700 and at the 960×600 minimum (the window refuses to go smaller) the sidebar was the rail. View ▸ Show Sidebar opened the flyout on the current row, the arrow keys moved through it with a visible focus ring, the menu item changed to Hide Sidebar, and choosing a section or folder closed it. T tagged the focused photo straight afterwards.
  - Every title-bar control was on screen at 960, 1000, 1260 and 1280px. Codes cells ended in an ellipsis.
  - That run led to three small changes to the missing-folder message: it now reads “Can’t find “…”” on one line, asking twice shows one message instead of two, and it clears once the folder opens.
- Not verified: the packaged or notarized Mac app (`npm run build:mac` was not run), a send chip or the Send and Add files dialogs in the real window, a real ingest, a real iPad, Windows, VoiceOver, and a signed-in account.
- A caution for the next check: a window completely covered by another app pauses WebKit’s animations and `requestAnimationFrame`, so a covered test window shows stale colors and never moves dialog focus. Keep it uncovered.

## Left for a decision or for testing with photographers

- **Page zoom is disabled** (`index.html`: `maximum-scale=1, user-scalable=no`). It keeps the window behaving like an app and leaves pinch free for resizing thumbnails, but it is the one place this pass knowingly departs from WCAG’s resize guidance. Dynamic Type covers only the account dialogs on iPad. A text-size setting would be the fix.
- **Touch sizes on iPad.** Title-bar buttons, sidebar rows (28px) and grid stars (16px wide) are below the 44px comfort size. Stars rely on the alternatives (keys 0–5, the right-click menu, the loupe’s larger controls). This needs a pass on a real iPad.
- **Grid semantics.** Library and document cards are buttons with `role="listitem"`. A listbox with options and a single tab stop would match how they behave, but should be tried with VoiceOver first.
- **Account preset at the top of Ingest and Export** takes three controls and a help line before the task’s own fields. It is in a logical place (a preset changes what follows); whether it earns that weight is a product call.
- **Two “New collection” buttons** in the sidebar (the header’s + and the Collections row’s +); the header one could be read as “add to library”.
- **Long export file names** truncate from the end in the grid, hiding the frame number; middle truncation would keep it.
- The Windows build shares these changes but was not run.

# Tactile visual system — November 12, 2026

A visual refinement of the same Tauri/React app: dark graphite surfaces, raised controls with a lit upper edge, recessed fields and tracks, and one restrained focus treatment. It is not a redesign. Layout, control sizes, colors, typography, copy, shortcuts and behavior are unchanged; the change lives in `src/index.css` and the shared shadcn components, with small class changes on the screens that styled something by hand.

## What changed

- **Focus (the reason for the pass).** Every field stacked a 3px ring on top of a 2px outline set 2px out, so clicking into a caption field drew a thick orange band. Fields now show a 1px hairline in the existing ring color on their own edge, with a faint inner line; nothing grows or glows, and their size does not change. Buttons, tabs, switches, rows and cards keep one 2px ring, for the keyboard only. The per-component `focus-visible:ring-*` classes are gone; rows and cards in scrolling lists keep their ring inside themselves (`focus-inset`).
- **Surface hierarchy.** `index.css` names five levels (canvas, structure, controls, floating, chosen) and one shadow token per elevation: `edge`, `plate`, `raised`, `cap`, `pressed`, `well`, `field`, `floating`. Lighting is an overlay (`sheen-*`), so every color keeps its token value.
- **Workspace tabs.** One recessed track; the current workspace is a raised cap in its own color (Home orange, Photos amber, Codes green) with a lit upper edge and a darker rim. The track is 32px and the tabs 28px, as before.
- **Buttons.** Primary buttons are caps in the brand orange; secondary and outline buttons are raised neutral; ghost buttons stay quiet and tint under the pointer. Pressing sinks a button (darker toward the top, shaded inside) instead of shrinking it to 96%, and a button stays sunk while its menu or popover is open.
- **Segmented controls.** All/Tagged/Untagged, Photos/Folders/Documents, Table/Text, the grid/list switch, the Settings sections and the dialogs' Photos and Files rows are the same control: a recessed track with the chosen segment raised. Photos and Codes segments are tinted and lettered in their workspace color; the rest are neutral. Each track is exactly as tall as the buttons it replaced, and a segment can still be hit across that full height.
- **Fields.** Inputs, textareas and one-time-code slots are wells: a darker fill, shaded under the upper edge, with the `--input` color as a lower lip. Select triggers are raised menu buttons that sink while open.
- **Switches, checkboxes, sliders, progress.** Recessed tracks and a lit thumb; checked boxes and switches are brand-orange caps.
- **Dialogs, menus, popovers, tooltips, toasts.** One floating elevation. Dialog footers are set into the surface under an etched line. Tooltips are dark like the menus (they were light). A toast's action is a raised button at the toast library's own size, so messages wrap as before.
- **Separators.** `--border` is now a cut line, darker than the surfaces it divides, for bars, panels, table rules and menu separators. The scrollbar thumb and outline badges, which need to be seen, no longer use it.
- **Photos.** The grid is unchanged apart from a brighter outline under the pointer, a hairline above the filename bar, and the tagged check and the loupe's Tagged badge becoming small amber caps. Selection is still the 2px amber ring (3px on the focused photo).
- **Codes.** The table stays flat: thin rules, a faint band under the pointer, and a 1px accent hairline on the cell being edited.
- **Motion.** Durations are 120, 160 and 240ms (were 150, 200 and 300). Reduced motion still switches all of it off.

## Decisions worth knowing

- **The brand orange is still `#ff3d00`.** The brief names `#F64426`; the token in `index.css` (and the Swift app's accent) is `#ff3d00`, and the brief also says the codebase's tokens are the source of truth, so nothing was changed. If `#F64426` is the intended value it is a small token change (`--primary`, `--workspace-home`, `--sidebar-primary`, `--chart-1`), with the 4.5:1 check on its dark ink repeated.
- **Fields keep a 3:1 boundary.** A low-contrast border all round would have matched the brief's wording but dropped the input boundary below 3:1, undoing the November 4 change. The lower lip keeps the `--input` color, 3:1 or better on every surface a field sits on (3.3:1 on panels); the other three sides are the dark cut line. That a 3:1 lower edge satisfies WCAG 1.4.11 for a text field is this pass's reading of the criterion's text-input examples, not a tested result.
- **Text rendering was left alone.** Switching to grayscale antialiasing would thin every label in the app; that is a typography change, not a refinement.

## Verification

- `npx tsc --noEmit`, `npm run build`: passed (the same bundle-size and mixed-import warnings as before). `npm test`: 89 tests in 16 files passed.
- The mocked browser harness (`.verification/ux-pass/`, Chromium, every native command mocked, invented shoots), looked at in magnified captures:
  - Home, Photos (toolbar, grid, caption panel, status bar, loupe, documents, library), Codes (sidebar, table, a cell being edited, inspector), the Settings, Export, Ingest, Send, FTP servers, Add files and Shortcuts dialogs, the Filter menu, a photo's context menu, the Delimiter list, a toast, the sign-in screen and the narrow-window library flyout.
  - Focus, read from computed styles and seen in captures: a clicked Headline field has a 1px solid outline in `#ff6b2b` at −1px and is 32px tall focused or not; a Codes cell the same outline; Open a shoot and the Photos tab, reached with Tab, have one 2px ring at 2px; a sidebar row reached with the arrow keys has it inside the row.
  - The title bar has no overflow, a 12px right margin and a 48px height at 960, 1024, 1100, 1120, 1279, 1280 and 1440px, in every send state, with two filters on.
  - Heuristic checks on Home, Photos, Codes and the Export, Settings, Ingest and Shortcuts dialogs: no text below 4.5:1 and no horizontal overflow.
- The dev build in a real Mac window (WebKit and the real Rust backend), with twelve scratch JPEGs, a throwaway home folder and the development-only sign-in bypass, so no real shoot, roster, setting or account was read or written: Home, Photos, Codes, the Ingest dialog (with its disabled Save preset… and Ingest buttons) and the title bar at the 960×600 minimum matched the harness. The real app's data folders had no file changed during the run.
- Limits of that real-window check:
  - The test window stayed behind other windows. A covered window pauses WebKit transitions, so they were switched off for the check and restored afterwards. A background window also shows no focus, hover or pressed styling and cannot open menus or popovers, so those states were seen in Chromium only.
  - At 960×600 the sidebar stayed expanded in the covered window instead of becoming its rail. The rail logic was not touched in this pass and switches in the harness; it was not re-checked in an uncovered window.
  - Three small adjustments made after that run (slightly softer lighting on colored caps, the tab track's 2px inset, segment hit areas) and the toast styling were seen in the harness only.
- Not verified: the packaged or notarized Mac app, the Mac App Store build, a real iPad, Windows, VoiceOver, and a signed-in account.

## Left for a decision

- **Touch sizes on iPad** are as they were (see the November 11 list).
- **Selected rows** in the sidebar, the lookup-file list and the library keep a flat fill. They are lists, not controls.
- The Swift reference app was not restyled.
