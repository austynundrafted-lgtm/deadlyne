# Deadlyne

A photo browser and culler in the spirit of Photo Mechanic, built for sports photographers on deadline: flip through thousands of RAW frames with no render delay, tag and caption the keepers, and send them before the deadline.

Deadlyne runs on **macOS and Windows** (Tauri: Rust + React + shadcn/ui) and updates itself from GitHub Releases. The app lives in [`desktop/`](desktop/); its README covers the features, how to develop it and how to release an update.

## Why Photo Mechanic (and Deadlyne) are fast

Photo Mechanic doesn't use a secret RAW decoder. It **skips RAW decoding completely.**

Every RAW file already contains JPEGs that the camera rendered when you pressed the shutter. A Canon R3 `.CR3`, for example, contains:

| Embedded image | Size | Where it lives |
|---|---|---|
| Thumbnail | 160×120 | `THMB` box in the Canon `uuid` |
| Preview | 1620×1080 (~400 KB) | `PRVW` box in a second `uuid` |
| **Full-size JPEG** | **6000×4000 (~2 MB)** | first track of `mdat` |

Lightroom demosaics 24 MP of sensor data for each frame. A fast browser reads the file's index, seeks straight to the JPEG it needs, and decodes only that. Deadlyne does the same in `desktop/src-tauri/src/raw.rs`:

- It parses CR3 (ISO-BMFF boxes), TIFF-based RAWs (CR2, NEF, ARW, DNG, ORF, RW2, PEF, SRW…: IFD chains, SubIFDs, EXIF IFD) and Fuji RAF headers, reading only the header bytes plus the chosen JPEG.
- Candidates are validated by their JPEG SOF marker. Lossless JPEG (SOF3), which CR2 and DNG use for raw sensor data, is rejected.
- The RAW's EXIF orientation is applied, because embedded previews are stored in sensor orientation.

## History

Deadlyne started as a native Swift/AppKit Mac app at the root of this repo. The cross-platform app in `desktop/` replaced it, and the Swift app was removed on 2026-10-20; it's still in git history. The desktop app keeps reading the old app's lookup files and imports its badge progress on a Mac.
