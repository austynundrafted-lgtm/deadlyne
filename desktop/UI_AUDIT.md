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
