# Deadlyne desktop (macOS + Windows)

The cross-platform version of Deadlyne, built with [Tauri 2](https://tauri.app). **Rust** does everything that touches files and must be fast. The interface is **React + Tailwind + shadcn/ui**. It installs from GitHub Releases and **updates itself**.

The original native Mac app (Swift/AppKit) still lives at the repo root and keeps working while features move over.

## What works today

- **Home:** open a shoot (⌘O / Ctrl+O, or drop a folder on the window) and a recent shoots list.
- **Photos:**
  - An instant contact sheet for thousands of RAW+JPEG files, virtualized so only visible rows render.
  - RAW+JPEG pairing.
  - Capture-time sort.
  - Camera, lens and exposure in the status bar.
- **Culling:**
  - `T` tag; `0–5` rate; `6–9` red/yellow/green/blue label; arrows move; Space/Return opens the loupe; Esc goes back.
  - Mouse: the tag checkbox, stars, and double-click for the loupe.
  - Everything is saved to Adobe-compatible XMP sidecars, so Lightroom reads it, and the Mac app reads the same files.
- **Filters:** All / Tagged / Untagged, plus one Filter menu for minimum rating and label.
- **Thumbnail size:** the slider, ⌘/Ctrl +/−, or ⌘/Ctrl + scroll.
- **Updates:** checked at launch and from Home → Check for updates.

### Speed (Canon R3, 2,191-frame shoot, M-series Mac, release build)

| Step | Time |
|---|---|
| Scan + pair folder | 12 ms |
| EXIF for all 2,191 photos | 72 ms |
| Grid thumbnail (810×540) | ~0.7 ms each, in parallel |
| Full 24 MP embedded JPEG for the loupe | 0.5 ms |

## Not yet ported from the Mac app

Captions and IPTC, code replacements (Codes workspace), ingest from card, copy/move/trash, search, badges, the profile, and 100% zoom.

## Develop

Requires Node 20+, Rust (`rustup`), and on Windows the WebView2 runtime (preinstalled on Windows 11).

```bash
cd desktop
npm install
npm run tauri dev
```

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
    components/TitleBar.tsx workspace tabs + filters (sits in the macOS title bar)
    components/HomeView.tsx, PhotosView.tsx, Loupe.tsx
    components/ui/          shadcn/ui components (add more with `npx shadcn@latest add <name>`)
  src-tauri/                Rust
    src/raw.rs              embedded-JPEG extraction: CR3, RAF, TIFF-based RAWs (CR2/NEF/ARW/DNG…)
    src/exif.rs             minimal TIFF/EXIF reader (orientation, time, camera, lens, exposure)
    src/folder.rs           scan + pair folders, parallel metadata/sidecar load
    src/xmp.rs              XMP sidecar read/write (port of the Mac app's XMPSidecar.swift)
    src/images.rs           thumb:// and preview:// URL schemes + thumbnail cache
    tauri.conf.json         window, bundle, updater config
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
