//! Export: copies of the chosen files of each photo into a folder, under new names if asked, with
//! JPGs optionally resized to a long edge for the web or a wire desk. A resized JPG keeps every
//! metadata segment of the original (EXIF, XMP, legacy IPTC, ICC profile), so captions and credits
//! travel with it; only the image data is re-encoded, upright. Never overwrites: a name already in
//! the folder gets a number added. The originals are never touched.

use crate::{exif, images, jobs, jpeg_meta};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Deserialize)]
pub struct File {
    pub src: String,
    /// The file name to write, extension included (the interface handles renaming).
    pub name: String,
}

#[derive(Deserialize)]
pub struct Item {
    pub files: Vec<File>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub destination: String,
    /// A folder to create inside the destination, or None to export straight into it.
    pub subfolder: Option<String>,
    /// Long edge in pixels for JPGs; None copies them as they are.
    pub long_edge: Option<u32>,
    /// JPEG quality 1–100 for resized files.
    pub quality: u8,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub files_done: usize,
    pub files_total: usize,
    pub current_file: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Where the files went.
    pub folder: String,
    pub files: usize,
    pub resized: usize,
    pub bytes: u64,
    /// (wanted name, name used) for files that got a number added.
    pub renamed: Vec<(String, String)>,
    pub errors: Vec<String>,
    pub cancelled: bool,
}

static CANCEL: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn export_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn export_photos(app: AppHandle, items: Vec<Item>, options: Options) -> Result<Summary, String> {
    CANCEL.store(false, Ordering::Relaxed);
    jobs::blocking(move || run(&items, &options, |p| drop(app.emit("export-progress", p)))).await
}

fn clean_name(s: &str) -> String {
    s.replace([':', '/', '\\'], "-").trim().trim_matches('.').to_string()
}

/// Exports every file in `items`, reporting progress through `emit`. Separate from Tauri for tests.
pub fn run(items: &[Item], o: &Options, emit: impl Fn(Progress) + Sync) -> Result<Summary, String> {
    let mut folder = PathBuf::from(&o.destination);
    if let Some(sub) = o.subfolder.as_deref().map(clean_name).filter(|s| !s.is_empty()) {
        folder.push(sub);
    }
    std::fs::create_dir_all(&folder).map_err(|e| format!("Couldn’t create {}: {e}", folder.display()))?;

    let total: usize = items.iter().map(|i| i.files.len()).sum();
    let done = AtomicUsize::new(0);
    let claimed: Mutex<HashSet<PathBuf>> = Mutex::new(HashSet::new());
    let summary = Mutex::new(Summary { folder: folder.to_string_lossy().to_string(), ..Default::default() });
    let quality = o.quality.clamp(1, 100);

    // Resizing is the slow part, so files go out in parallel; the name check is serialized.
    items.par_iter().flat_map(|i| i.files.par_iter()).for_each(|f| {
        if CANCEL.load(Ordering::Relaxed) {
            return;
        }
        let src = Path::new(&f.src);
        let result = export_one(src, &folder, &f.name, o.long_edge, quality, &claimed);
        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
        let mut s = summary.lock().unwrap_or_else(|e| e.into_inner());
        match result {
            Ok(Some(d)) => {
                s.files += 1;
                s.bytes += d.bytes;
                if d.resized {
                    s.resized += 1;
                }
                if let Some(used) = d.renamed {
                    s.renamed.push((f.name.clone(), used));
                }
            }
            Ok(None) => {} // a sidecar that doesn't exist
            Err(e) => s.errors.push(format!("{}: {e}", f.name)),
        }
        drop(s);
        if n % 5 == 0 || n == total {
            emit(Progress { files_done: n, files_total: total, current_file: f.name.clone() });
        }
    });

    let mut s = summary.into_inner().unwrap_or_else(|e| e.into_inner());
    s.cancelled = CANCEL.load(Ordering::Relaxed);
    s.renamed.sort();
    s.errors.sort();
    Ok(s)
}

struct Done {
    bytes: u64,
    resized: bool,
    renamed: Option<String>,
}

fn is_jpeg(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
}

fn export_one(src: &Path, folder: &Path, name: &str, long_edge: Option<u32>, quality: u8, claimed: &Mutex<HashSet<PathBuf>>) -> Result<Option<Done>, String> {
    if !src.exists() {
        // Sidecars are listed whether or not they exist; a missing one isn't an error.
        if src.extension().is_some_and(|e| e.eq_ignore_ascii_case("xmp")) {
            return Ok(None);
        }
        return Err("file not found".into());
    }
    let resized = match long_edge {
        Some(edge) if is_jpeg(src) => {
            let bytes = std::fs::read(src).map_err(|e| e.to_string())?;
            resize_jpeg(&bytes, edge, quality)?
        }
        _ => None,
    };

    let (target, renamed) = claim(folder, name, claimed)?;
    if target == src {
        return Err("it’s already in this folder".into());
    }
    // create_new refuses to replace a file that appeared in the meantime.
    let mut out = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
    let written = match &resized {
        Some(bytes) => {
            out.write_all(bytes).map_err(|e| e.to_string())?;
            bytes.len() as u64
        }
        None => {
            let mut from = std::fs::File::open(src).map_err(|e| e.to_string())?;
            std::io::copy(&mut from, &mut out).map_err(|e| e.to_string())?
        }
    };
    drop(out);
    if resized.is_none() && std::fs::metadata(src).map(|m| m.len()).unwrap_or(written) != written {
        let _ = std::fs::remove_file(&target);
        return Err("the copy didn’t match the original".into());
    }
    Ok(Some(Done { bytes: written, resized: resized.is_some(), renamed }))
}

/// Picks the path to write `name` to: the name itself, or `stem-1.ext`, `stem-2.ext`… when a file
/// with that name is already there or another thread is about to write it.
fn claim(folder: &Path, name: &str, claimed: &Mutex<HashSet<PathBuf>>) -> Result<(PathBuf, Option<String>), String> {
    let mut taken = claimed.lock().unwrap_or_else(|e| e.into_inner());
    let free = |p: &PathBuf, taken: &HashSet<PathBuf>| !p.exists() && !taken.contains(p);
    let first = folder.join(name);
    if free(&first, &taken) {
        taken.insert(first.clone());
        return Ok((first, None));
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..1000 {
        let candidate = format!("{stem}-{n}{ext}");
        let p = folder.join(&candidate);
        if free(&p, &taken) {
            taken.insert(p.clone());
            return Ok((p, Some(candidate)));
        }
    }
    Err("too many files with this name in the folder".into())
}

// MARK: - Resizing

/// A copy of `src` scaled so its long edge is `long_edge` pixels, upright, with the original's
/// metadata segments carried over. None when the image is already that small (copy it as is).
pub fn resize_jpeg(src: &[u8], long_edge: u32, quality: u8) -> Result<Option<Vec<u8>>, String> {
    let (segs, _) = jpeg_meta::layout(src)?;
    let mut decoder = jpeg_decoder::Decoder::new(std::io::Cursor::new(src));
    decoder.read_info().map_err(|e| e.to_string())?;
    let info = decoder.info().ok_or("unreadable JPEG")?;
    let (w, h) = (info.width as u32, info.height as u32);
    let long = w.max(h);
    if long <= long_edge.max(1) {
        return Ok(None);
    }
    let scale = |edge: u32| ((edge as u64 * long_edge as u64 + long as u64 / 2) / long as u64).max(1) as u32;
    let (tw, th) = (scale(w), scale(h));

    // DCT scaling gets within 2× nearly for free; Lanczos does the rest.
    let (sw, sh) = decoder.scale(tw.min(0xFFFF) as u16, th.min(0xFFFF) as u16).map_err(|e| e.to_string())?;
    let pixels = decoder.decode().map_err(|e| e.to_string())?;
    let rgb = images::to_rgb(decoder.info().ok_or("unreadable JPEG")?.pixel_format, pixels);
    let img = image::RgbImage::from_raw(sw as u32, sh as u32, rgb).ok_or("unreadable JPEG")?;
    let img = if (sw as u32, sh as u32) != (tw, th) { image::imageops::resize(&img, tw, th, image::imageops::FilterType::Lanczos3) } else { img };

    let orientation = exif::jpeg_exif(src)
        .map(|t| {
            let mut m = exif::Meta { orientation: 1, ..Default::default() };
            exif::parse_tiff(t, &mut m);
            m.orientation
        })
        .filter(|o| (1..=8).contains(o))
        .unwrap_or(1);
    let img = images::upright(img, orientation);
    let (out_w, out_h) = (img.width(), img.height());

    let mut encoded = Vec::with_capacity((tw * th / 4) as usize);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, quality).encode_image(&img).map_err(|e| e.to_string())?;
    let (new_segs, new_scan) = jpeg_meta::layout(&encoded)?;

    // SOI, JFIF (the encoder's), then the original's EXIF / XMP / ICC / Photoshop segments, then
    // the new tables and image data. Orientation is now 1 and the EXIF pixel size matches.
    let mut out = Vec::with_capacity(encoded.len() + src.len() / 8);
    out.extend_from_slice(&[0xFF, 0xD8]);
    for s in new_segs.iter().filter(|s| s.marker == 0xE0) {
        out.extend_from_slice(&encoded[s.start..s.end]);
    }
    for s in &segs {
        let b = jpeg_meta::body(src, s);
        match s.marker {
            0xE1 if b.starts_with(b"Exif\0\0") => out.extend(patch_exif(&src[s.start..s.end], out_w, out_h)),
            0xE1 if jpeg_meta::is_xmp(src, s) => out.extend(patch_xmp(&src[s.start..s.end])),
            0xE2 if b.starts_with(b"ICC_PROFILE\0") => out.extend_from_slice(&src[s.start..s.end]),
            0xED => out.extend_from_slice(&src[s.start..s.end]),
            _ => {}
        }
    }
    for s in new_segs.iter().filter(|s| s.marker != 0xE0) {
        out.extend_from_slice(&encoded[s.start..s.end]);
    }
    out.extend_from_slice(&encoded[new_scan..]);
    Ok(Some(out))
}

/// Sets Orientation to 1 and the EXIF pixel dimensions to the new size, in place. Values are
/// overwritten where they already are, so no offset moves. Anything unexpected leaves the
/// segment unchanged.
fn patch_exif(seg: &[u8], w: u32, h: u32) -> Vec<u8> {
    const HEADER: usize = 10; // FF E1 len(2) "Exif\0\0"
    let mut seg = seg.to_vec();
    let Some(tiff) = seg.get_mut(HEADER..) else { return seg };
    if tiff.len() < 8 {
        return seg;
    }
    let le = tiff[0] == 0x49;
    let rd16 = |b: &[u8], o: usize| if le { u16::from_le_bytes([b[o], b[o + 1]]) } else { u16::from_be_bytes([b[o], b[o + 1]]) };
    let rd32 = |b: &[u8], o: usize| if le { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) } else { u32::from_be_bytes(b[o..o + 4].try_into().unwrap()) };
    let set = |b: &mut [u8], e: usize, value: u32| {
        // SHORT or LONG, count 1: the value sits inline.
        match rd16(b, e + 2) {
            3 => {
                let v = if le { (value as u16).to_le_bytes() } else { (value as u16).to_be_bytes() };
                b[e + 8..e + 10].copy_from_slice(&v);
                b[e + 10..e + 12].fill(0);
            }
            4 => b[e + 8..e + 12].copy_from_slice(&if le { value.to_le_bytes() } else { value.to_be_bytes() }),
            _ => {}
        }
    };
    let ifd0 = rd32(tiff, 4) as usize;
    let mut exif_ifd = None;
    let walk = |b: &mut [u8], ifd: usize, f: &mut dyn FnMut(&mut [u8], u16, usize)| {
        if ifd + 2 > b.len() {
            return;
        }
        let count = rd16(b, ifd) as usize;
        for k in 0..count {
            let e = ifd + 2 + k * 12;
            if e + 12 > b.len() {
                break;
            }
            let tag = rd16(b, e);
            f(b, tag, e);
        }
    };
    walk(tiff, ifd0, &mut |b, tag, e| match tag {
        0x0112 => set(b, e, 1),
        0x8769 => exif_ifd = Some(rd32(b, e + 8) as usize),
        _ => {}
    });
    if let Some(ifd) = exif_ifd {
        walk(tiff, ifd, &mut |b, tag, e| match tag {
            0xA002 => set(b, e, w),
            0xA003 => set(b, e, h),
            _ => {}
        });
    }
    seg
}

/// Sets `tiff:Orientation` to 1 in an XMP APP1 segment, if it's there, keeping the segment's size.
fn patch_xmp(seg: &[u8]) -> Vec<u8> {
    let Ok(text) = std::str::from_utf8(&seg[4..]) else { return seg.to_vec() };
    let mut s = text.to_string();
    for (from, to) in [("tiff:Orientation=\"", "\""), ("<tiff:Orientation>", "</tiff:Orientation>")] {
        if let Some(i) = s.find(from) {
            let start = i + from.len();
            if let Some(len) = s[start..].find(to) {
                if s[start..start + len].chars().all(|c| c.is_ascii_digit()) {
                    // Same byte count, so the segment length stays right.
                    s.replace_range(start..start + len, &format!("{:>width$}", 1, width = len));
                }
            }
        }
    }
    let mut out = seg[..4].to_vec();
    out.extend_from_slice(s.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
        let mut out = vec![];
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&img).unwrap();
        out
    }

    #[test]
    fn resizes_to_long_edge_and_keeps_metadata() {
        let dir = std::env::temp_dir().join(format!("deadlyne-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("MCD_0001.JPG");
        std::fs::write(&src, sample(600, 400)).unwrap();
        // Give it a caption first, so there's XMP and IIM to carry over.
        let mut captions = crate::iptc::Captions::default();
        captions.headline = "Fairborn wins".into();
        captions.credit = "Deadlyne".into();
        jpeg_meta::embed(&src, &captions, &[crate::iptc::Field::Headline, crate::iptc::Field::Credit], jpeg_meta::JpegMode::XmpAndIim, None).unwrap();

        let bytes = std::fs::read(&src).unwrap();
        let small = resize_jpeg(&bytes, 300, 85).unwrap().expect("should resize");
        let mut d = jpeg_decoder::Decoder::new(std::io::Cursor::new(&small));
        d.read_info().unwrap();
        let info = d.info().unwrap();
        assert_eq!((info.width, info.height), (300, 200));
        let out = dir.join("small.JPG");
        std::fs::write(&out, &small).unwrap();
        let read = jpeg_meta::read_captions(&out);
        assert_eq!(read.headline, "Fairborn wins");
        assert_eq!(read.credit, "Deadlyne");
        // Already small enough: copied as is.
        assert!(resize_jpeg(&bytes, 600, 85).unwrap().is_none());

        // The whole run: a RAW+JPG pair with a missing sidecar, a name clash, and a subfolder.
        let raw = dir.join("MCD_0001.CR3");
        std::fs::write(&raw, b"not really raw").unwrap();
        let items = vec![Item {
            files: vec![
                File { src: raw.to_string_lossy().into(), name: "Game_0001.CR3".into() },
                File { src: src.to_string_lossy().into(), name: "Game_0001.JPG".into() },
                File { src: dir.join("MCD_0001.xmp").to_string_lossy().into(), name: "Game_0001.xmp".into() },
            ],
        }];
        let o = Options { destination: dir.to_string_lossy().into(), subfolder: Some("Out".into()), long_edge: Some(300), quality: 85 };
        let s = run(&items, &o, |_| {}).unwrap();
        assert_eq!(s.files, 2, "{:?}", s.errors);
        assert_eq!(s.resized, 1);
        assert!(s.errors.is_empty());
        assert!(dir.join("Out/Game_0001.CR3").exists() && dir.join("Out/Game_0001.JPG").exists());
        let again = run(&items, &o, |_| {}).unwrap();
        assert_eq!(again.renamed, vec![("Game_0001.CR3".to_string(), "Game_0001-1.CR3".to_string()), ("Game_0001.JPG".to_string(), "Game_0001-1.JPG".to_string())]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// On real files, read-only on the source: `DEADLYNE_EXPORT_SAMPLE=/path/to/shoot cargo test real_export -- --ignored --nocapture`
    /// exports every pair into `<shoot>/../Export_Dest/<shoot name>` at 3000 px and checks the results.
    #[test]
    #[ignore]
    fn real_export() {
        let Ok(dir) = std::env::var("DEADLYNE_EXPORT_SAMPLE") else { return };
        let shoot = Path::new(&dir);
        let photos = crate::folder::scan(shoot).unwrap();
        let items: Vec<Item> = photos
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let base = format!("Test_{:04}", i + 1);
                let mut files = vec![];
                if let Some(raw) = &p.raw {
                    files.push(File { src: raw.clone(), name: format!("{base}.CR3") });
                    files.push(File { src: p.sidecar.clone(), name: format!("{base}.xmp") });
                }
                if let Some(j) = &p.jpeg {
                    files.push(File { src: j.clone(), name: format!("{base}.JPG") });
                }
                Item { files }
            })
            .collect();
        let dest = shoot.parent().unwrap().join("Export_Dest");
        let o = Options {
            destination: dest.to_string_lossy().into(),
            subfolder: Some(shoot.file_name().unwrap().to_string_lossy().into()),
            long_edge: Some(3000),
            quality: 88,
        };
        let t = std::time::Instant::now();
        let s = run(&items, &o, |p| println!("{}/{} {}", p.files_done, p.files_total, p.current_file)).unwrap();
        println!("exported {} files ({} resized, {} KB) in {:?} to {}; errors {:?}", s.files, s.resized, s.bytes / 1024, t.elapsed(), s.folder, s.errors);
        assert!(s.errors.is_empty());
        for (i, p) in photos.iter().enumerate() {
            let Some(j) = &p.jpeg else { continue };
            let out = Path::new(&s.folder).join(format!("Test_{:04}.JPG", i + 1));
            let bytes = std::fs::read(&out).unwrap();
            let mut d = jpeg_decoder::Decoder::new(std::io::Cursor::new(&bytes));
            d.read_info().unwrap();
            let info = d.info().unwrap();
            let before = jpeg_meta::read_captions(Path::new(j));
            let after = jpeg_meta::read_captions(&out);
            let meta = exif::read(&out);
            println!("{}: {}x{} orientation {} camera {:?} captured {:?} headline {:?}", out.display(), info.width, info.height, meta.orientation, meta.camera, meta.captured, after.headline);
            assert_eq!(info.width.max(info.height), 3000);
            assert_eq!(meta.orientation, 1);
            assert_eq!(before, after, "captions must survive resizing");
            assert!(!meta.camera.is_empty(), "EXIF must survive resizing");
        }
    }
}
