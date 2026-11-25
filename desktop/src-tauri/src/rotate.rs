//! Rotating photos without re-encoding them. A RAW's turn is written to its XMP sidecar as
//! `tiff:Orientation`, the way Lightroom and Camera Raw record it, so the RAW is never touched.
//! A JPG's EXIF orientation tag (and an embedded XMP `tiff:Orientation`, if it has one) is
//! patched: only those few bytes change, never the pixels or any other metadata.

use crate::{exif, folder, images, jpeg_meta, raw, xmp};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The EXIF orientation after turning the displayed photo a quarter turn. Mirrored
/// orientations stay mirrored: 2 → 7 → 4 → 5 clockwise, like 1 → 6 → 3 → 8.
pub fn turn(orientation: u32, clockwise: bool) -> u32 {
    const CW: [(u32, u32); 8] = [(1, 6), (6, 3), (3, 8), (8, 1), (2, 7), (7, 4), (4, 5), (5, 2)];
    let o = if (1..=8).contains(&orientation) { orientation } else { 1 };
    CW.iter()
        .find_map(|&(from, to)| if clockwise { (from == o).then_some(to) } else { (to == o).then_some(from) })
        .unwrap_or(1)
}

fn is_raw(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| folder::RAW_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Where `BASENAME.xmp` sits for a photo file.
pub fn sidecar_for(path: &Path) -> std::path::PathBuf {
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    path.with_file_name(format!("{stem}.xmp"))
}

/// The orientation a file is shown with: a RAW's sidecar wins over the camera's EXIF.
pub fn effective(path: &Path) -> u32 {
    if is_raw(path) {
        if let Some(o) = xmp::sidecar_orientation(&sidecar_for(path)) {
            return o;
        }
    }
    exif::read(path).orientation
}

/// Byte positions of the orientation values in a JPEG's metadata: the EXIF IFD0 tag (with its
/// byte order and size) and the digit of an XMP `tiff:Orientation`, when there is one.
struct Spots {
    exif: Option<(usize, bool, u16)>,
    xmp: Option<usize>,
}

fn find_spots(jpeg: &[u8]) -> Spots {
    let mut spots = Spots { exif: None, xmp: None };
    let Ok((segments, _)) = jpeg_meta::layout(jpeg) else { return spots };
    for s in segments.iter().filter(|s| s.marker == 0xE1) {
        let data_start = s.start + 4;
        let data = &jpeg[data_start..s.end];
        if spots.exif.is_none() && data.starts_with(b"Exif\0\0") {
            let tiff = &data[6..];
            let le = match tiff.get(..4) {
                Some(b"II\x2a\0") => true,
                Some(b"MM\0\x2a") => false,
                _ => continue,
            };
            let ifd = raw::u32_at(tiff, 4, le) as usize;
            if ifd < 8 || ifd.saturating_add(2) > tiff.len() {
                continue;
            }
            for i in 0..raw::u16_at(tiff, ifd, le) as usize {
                let entry = ifd + 2 + i * 12;
                if entry + 12 > tiff.len() {
                    break;
                }
                if raw::u16_at(tiff, entry, le) == 0x0112 && raw::u32_at(tiff, entry + 4, le) == 1 {
                    let kind = raw::u16_at(tiff, entry + 2, le) as u16;
                    if kind == 3 || kind == 4 {
                        spots.exif = Some((data_start + 6 + entry + 8, le, kind));
                    }
                    break;
                }
            }
        } else if spots.xmp.is_none() && data.starts_with(b"http://ns.adobe.com/xap/1.0/\0") {
            let text = String::from_utf8_lossy(data);
            for pattern in ["tiff:Orientation=\"", "<tiff:Orientation>"] {
                if let Some(i) = text.find(pattern) {
                    let digit = i + pattern.len();
                    if text.as_bytes().get(digit).is_some_and(|d| (b'1'..=b'8').contains(d))
                        && !text.as_bytes().get(digit + 1).is_some_and(u8::is_ascii_digit)
                    {
                        spots.xmp = Some(data_start + digit);
                    }
                    break;
                }
            }
        }
    }
    spots
}

/// The patches that set a JPEG's orientation: (file offset, bytes). Errors when the JPEG has
/// no EXIF orientation tag to change.
fn patches(jpeg: &[u8], orientation: u32) -> Result<Vec<(usize, Vec<u8>)>, String> {
    let spots = find_spots(jpeg);
    let Some((at, le, kind)) = spots.exif else { return Err("this JPG has no orientation tag to change".into()) };
    let value = match (kind, le) {
        (3, true) => (orientation as u16).to_le_bytes().to_vec(),
        (3, false) => (orientation as u16).to_be_bytes().to_vec(),
        (_, true) => orientation.to_le_bytes().to_vec(),
        (_, false) => orientation.to_be_bytes().to_vec(),
    };
    let mut out = vec![(at, value)];
    if let Some(digit) = spots.xmp {
        out.push((digit, vec![b'0' + orientation as u8]));
    }
    Ok(out)
}

/// Writes a JPG's new orientation into its existing metadata bytes. Every other byte is the
/// same; the file is swapped in whole (like caption embedding), so a crash never leaves half.
pub fn set_jpeg_orientation(path: &Path, orientation: u32) -> Result<(), String> {
    let _access = crate::data::access(path).map_err(|e| e.to_string())?;
    let mut bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    for (at, value) in patches(&bytes, orientation)? {
        bytes[at..at + value.len()].copy_from_slice(&value);
    }
    xmp::write_atomic(path, &bytes).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => "it’s locked in the Finder, so it can’t be changed".to_string(),
        _ => e.to_string(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateItem {
    pub id: String,
    pub raw: Option<String>,
    pub jpeg: Option<String>,
    pub sidecar: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rotated {
    pub id: String,
    /// The photo's new orientation (its primary file's).
    pub orientation: u32,
    /// The JPG's own new orientation, when it has one.
    pub jpeg_orientation: Option<u32>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RotateOutcome {
    pub rotated: Vec<Rotated>,
    pub errors: Vec<String>,
}

/// Turns photos a quarter turn. A RAW + JPG pair turns together.
#[tauri::command]
pub async fn rotate_photos(items: Vec<RotateItem>, clockwise: bool) -> RotateOutcome {
    crate::jobs::serial(move || {
        let mut out = RotateOutcome::default();
        for item in &items {
            let mut primary = None;
            let mut jpeg_orientation = None;
            let mut failed = None;
            let mut undo_raw = None;
            if let Some(r) = item.raw.as_deref().map(Path::new) {
                let before = effective(r);
                let next = turn(before, clockwise);
                let ext = r.extension().map(|e| e.to_string_lossy().to_ascii_uppercase()).unwrap_or_default();
                match xmp::set_orientation(Path::new(&item.sidecar), &ext, next) {
                    Ok(()) => {
                        images::forget(&r.to_string_lossy());
                        primary = Some(next);
                        undo_raw = Some((r, ext, before));
                    }
                    Err(e) => failed = Some(format!("{}: {e}", r.file_name().unwrap_or_default().to_string_lossy())),
                }
            }
            if let (None, Some(j)) = (&failed, item.jpeg.as_deref().map(Path::new)) {
                let next = turn(exif::read(j).orientation, clockwise);
                match set_jpeg_orientation(j, next) {
                    Ok(()) => {
                        images::forget(&j.to_string_lossy());
                        jpeg_orientation = Some(next);
                        primary.get_or_insert(next);
                    }
                    Err(e) => {
                        // Keep the pair together: the RAW goes back the way it was.
                        if let Some((r, ext, before)) = undo_raw {
                            let _ = xmp::set_orientation(Path::new(&item.sidecar), &ext, before);
                            images::forget(&r.to_string_lossy());
                        }
                        failed = Some(format!("{}: {e}", j.file_name().unwrap_or_default().to_string_lossy()));
                    }
                }
            }
            match (failed, primary) {
                (Some(e), _) => out.errors.push(e),
                (None, Some(orientation)) => out.rotated.push(Rotated { id: item.id.clone(), orientation, jpeg_orientation }),
                (None, None) => {}
            }
        }
        out
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarter_turns_cycle_and_undo() {
        for o in 1..=8 {
            assert_eq!(turn(turn(o, true), false), o);
            let mut x = o;
            for _ in 0..4 {
                x = turn(x, true);
            }
            assert_eq!(x, o, "four turns come back to {o}");
        }
        assert_eq!(turn(1, true), 6);
        assert_eq!(turn(1, false), 8);
        assert_eq!(turn(6, true), 3);
        assert_eq!(turn(2, true), 7);
        assert_eq!(turn(0, true), 6);
    }

    /// A tiny JPEG with an EXIF orientation tag and an XMP packet that also records it.
    fn jpeg(orientation: u16, le: bool) -> Vec<u8> {
        let w16 = |v: u16| if le { v.to_le_bytes() } else { v.to_be_bytes() };
        let w32 = |v: u32| if le { v.to_le_bytes() } else { v.to_be_bytes() };
        let mut tiff = if le { b"II\x2a\0".to_vec() } else { b"MM\0\x2a".to_vec() };
        tiff.extend(w32(8));
        tiff.extend(w16(1));
        tiff.extend(w16(0x0112));
        tiff.extend(w16(3));
        tiff.extend(w32(1));
        tiff.extend(w16(orientation));
        tiff.extend([0, 0]);
        tiff.extend(w32(0));
        let mut exif = b"Exif\0\0".to_vec();
        exif.extend(tiff);
        let xmp = format!("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description tiff:Orientation=\"{orientation}\"/></x:xmpmeta>").into_bytes();
        let mut out = vec![0xFF, 0xD8];
        for seg in [exif, xmp] {
            out.extend([0xFF, 0xE1]);
            out.extend(((seg.len() + 2) as u16).to_be_bytes());
            out.extend(seg);
        }
        out.extend([0xFF, 0xDA, 0, 2, 0x11, 0x22, 0xFF, 0xD9]);
        out
    }

    #[test]
    fn jpeg_orientation_is_patched_in_place() {
        for le in [true, false] {
            let dir = std::env::temp_dir().join(format!("deadlyne-rotate-{}-{le}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("A.JPG");
            let before = jpeg(1, le);
            std::fs::write(&path, &before).unwrap();
            set_jpeg_orientation(&path, 6).unwrap();
            let after = std::fs::read(&path).unwrap();
            assert_eq!(after.len(), before.len());
            let changed: Vec<usize> = (0..after.len()).filter(|&i| after[i] != before[i]).collect();
            assert_eq!(changed.len(), 2, "only the EXIF value byte and the XMP digit change: {changed:?}");
            assert_eq!(exif::read(&path).orientation, 6);
            assert!(String::from_utf8_lossy(&after).contains("tiff:Orientation=\"6\""));
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn raw_turns_live_in_the_sidecar() {
        let dir = std::env::temp_dir().join(format!("deadlyne-rotate-raw-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let raw = dir.join("A.CR3");
        std::fs::write(&raw, b"not really a raw").unwrap();
        assert_eq!(effective(&raw), 1);
        xmp::set_orientation(&sidecar_for(&raw), "CR3", turn(effective(&raw), false)).unwrap();
        assert_eq!(effective(&raw), 8);
        assert_eq!(std::fs::read(&raw).unwrap(), b"not really a raw");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_jpeg_without_an_orientation_tag_is_refused() {
        assert!(patches(&[0xFF, 0xD8, 0xFF, 0xDA, 0, 2, 0xFF, 0xD9], 6).is_err());
    }
}
