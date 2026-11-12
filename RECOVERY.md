# Deadlyne macOS recovery — October 25, 2026

Recovered the original repository and Git history from the archived Desktop copy at `63bf02d` into this workspace. The archive remains untouched. Development continues in `desktop/`, with macOS first and the existing iPad project/plugin sources preserved.

## Delivered

- Rebuilt the standalone Apple silicon macOS app from source and installed it at `/Applications/Deadlyne.app`.
- Kept the segmented review bar in the folder toolbar and removed its duplicate inside the popover. The exact count, last photo and all review actions remain available.
- Truncated long last-reviewed filenames, with the full filename in the hover title.
- Added `npm run build:mac`, a locked local build that does not require an updater signing key.
- Expanded ignore rules for reproducible dependencies, build output, private environment files, signing material and verification files. Retained both dependency lockfiles and iPad project inputs.
- Applied compatible npm dependency security fixes in the lockfile and removed the Vite config's deprecated `__dirname` usage.

## Verification

- `npm test`: 7 passed.
- `npm run build:mac`: clean optimized macOS app build passed.
- `cargo test --release --locked`: 12 passed; 6 existing real-file/server integration tests skipped.
- `npm audit --audit-level=moderate`: zero reported vulnerabilities.
- `codesign --verify --deep --strict`: installed bundle passed.
- `git diff --check`: passed.
- Native app: sign-in session restored, 60 disposable images opened, progress counted, unviewed filter worked, Continue reviewing moved focus, Reset asked for confirmation and reset progress.
- Visually verified the simplified popover and long-filename truncation in the installed app.
- Restored pre-test library/settings, achievements and viewing records. Final installed Home screen shows the original 25 of 35 viewed (71%) and original recent shoot; scratch entries are absent.

## UI polish review

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| Low | `desktop/src/components/FolderView.tsx` | Progress repeated immediately inside its own popover | One toolbar bar; text count and actions inside | Less redundant information |
| Medium | `desktop/src/components/FolderView.tsx` | Long last-photo names overflowed the panel | Ellipsis with full-name hover title | Stable panel width and readable controls |

Approve for the inspected changes. Hover/focus styling and reduced-motion declarations were inspected in source; a full keyboard/VoiceOver and animation-speed audit was not performed.

## Local files and limits

The app remains version 0.3.6 for this local rebuild. This is an ad-hoc-signed local build, not a notarized public release. No release was published or remote branch pushed. Vite still reports a large frontend bundle warning; it does not fail the build.

The previous installed app is retained at `.verification/Deadlyne-before-recovery.app` for rollback. Pre-test local settings are in `.verification/settings-before-test/`; the extra sign-in-session copy was removed. Both are ignored by Git. Dependencies and compilation caches still occupy disk space: ignoring them prevents accidental commits, not file creation. See `desktop/README.md` for rebuild and cleanup instructions.

iPad, Windows, live FTP, real-card ingest and end-to-end production export were not exercised in this recovery pass. Their existing implementations remain in source.
