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
