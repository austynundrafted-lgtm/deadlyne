//! Serves photos to the interface through two custom URL schemes, so `<img>` tags load them
//! directly with no base64 or IPC copies:
//!
//! - `thumb://localhost/<path>`: a small JPEG for the contact sheet. The embedded preview is
//!   decoded with libjpeg-style DCT scaling (1/2–1/8 size nearly for free), rotated upright,
//!   re-encoded and cached in memory.
//! - `preview://localhost/<path>`: the largest embedded JPEG, with EXIF orientation neutralized
//!   in the response only. Pixels are untouched; the loupe applies the photo's orientation once.
//!
//! On Windows the same URLs arrive as `http://thumb.localhost/<path>`; `convertFileSrc` in the
//! frontend builds the right form for each platform.

use crate::{exif, jpeg_meta, raw};
use percent_encoding::percent_decode_str;
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::http::{Request, Response};
use tauri::UriSchemeResponder;

#[derive(Clone, Copy)]
pub enum Kind {
    Thumb,
    Preview,
}

/// Long edge a thumbnail is decoded to (at least; DCT scaling picks the next size up).
const THUMB_EDGE: u32 = 600;
const THUMB_CACHE_BYTES: usize = 512 << 20;

pub fn serve(request: Request<Vec<u8>>, responder: UriSchemeResponder, kind: Kind) {
    let raw_path = request.uri().path().trim_start_matches('/').to_string();
    rayon::spawn(move || {
        let path = percent_decode_str(&raw_path).decode_utf8_lossy().to_string();
        let _access = crate::data::access(Path::new(&path)).ok();
        let body = match kind {
            Kind::Thumb => thumbnail(&path),
            Kind::Preview => preview(Path::new(&path)).map(Arc::new),
        };
        let response = match body {
            Some(bytes) => Response::builder()
                .header("Content-Type", "image/jpeg")
                .header("Cache-Control", "max-age=3600")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes.to_vec()),
            None => Response::builder().status(404).body(Vec::new()),
        };
        responder.respond(response.unwrap());
    });
}

fn preview(path: &Path) -> Option<Vec<u8>> {
    let mut jpeg = raw::extract(path, raw::PreviewKind::Full)?;
    neutralize_orientation(&mut jpeg);
    Some(jpeg)
}

/// Browsers may auto-rotate a cross-origin JPEG even with `image-orientation: none`, and its
/// natural dimensions can already be swapped by EXIF. Neutralize IFD0 orientation in the
/// response before decoding; CSS then owns the one rotation, including for RAW previews with
/// no EXIF. Never decode/re-encode pixels, remove metadata, or write to the original file.
fn neutralize_orientation(jpeg: &mut [u8]) {
    let Ok((segments, _)) = jpeg_meta::layout(jpeg) else { return };
    for segment in segments.iter().filter(|s| s.marker == 0xE1) {
        let data = &mut jpeg[segment.start + 4..segment.end];
        if !data.starts_with(b"Exif\0\0") { continue; }
        let tiff = &mut data[6..];
        if tiff.len() < 8 { continue; }
        let le = match &tiff[..4] {
            b"II\x2a\0" => true,
            b"MM\0\x2a" => false,
            _ => continue,
        };
        let ifd = raw::u32_at(tiff, 4, le) as usize;
        if ifd < 8 || ifd.saturating_add(2) > tiff.len() { continue; }
        let count = raw::u16_at(tiff, ifd, le) as usize;
        for i in 0..count {
            let entry = ifd + 2 + i * 12;
            if entry + 12 > tiff.len() { break; }
            if raw::u16_at(tiff, entry, le) != 0x0112 || raw::u32_at(tiff, entry + 4, le) != 1 { continue; }
            match raw::u16_at(tiff, entry + 2, le) {
                3 => tiff[entry + 8..entry + 10].copy_from_slice(&if le { 1u16.to_le_bytes() } else { 1u16.to_be_bytes() }),
                4 => tiff[entry + 8..entry + 12].copy_from_slice(&if le { 1u32.to_le_bytes() } else { 1u32.to_be_bytes() }),
                _ => {},
            }
        }
    }
}

fn thumbnail(path: &str) -> Option<Arc<Vec<u8>>> {
    if let Some(hit) = cache().lock().unwrap().get(path) {
        return Some(hit);
    }
    let p = Path::new(path);
    let jpeg = raw::extract(p, raw::PreviewKind::Thumbnail)?;
    let orientation = exif::read(p).orientation;
    let bytes = Arc::new(render(&jpeg, orientation)?);
    cache().lock().unwrap().insert(path.to_string(), bytes.clone());
    Some(bytes)
}

/// Decodes at a reduced size, rotates upright and re-encodes.
fn render(jpeg: &[u8], orientation: u32) -> Option<Vec<u8>> {
    let mut decoder = jpeg_decoder::Decoder::new(std::io::Cursor::new(jpeg));
    decoder.read_info().ok()?;
    let info = decoder.info()?;
    // Both requested dimensions must be proportional: the decoder picks the smallest DCT scale
    // that satisfies either one.
    let long = info.width.max(info.height) as u32;
    let fit = |edge: u16| ((edge as u32 * THUMB_EDGE.min(long)) / long).max(1) as u16;
    let (w, h) = decoder.scale(fit(info.width), fit(info.height)).ok()?;
    let pixels = decoder.decode().ok()?;
    let rgb = to_rgb(decoder.info()?.pixel_format, pixels);
    let img = upright(image::RgbImage::from_raw(w as u32, h as u32, rgb)?, orientation);
    let mut out = Vec::with_capacity(96 << 10);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82).encode_image(&img).ok()?;
    Some(out)
}

/// Decoded JPEG samples as packed RGB, whatever the file's color model.
pub(crate) fn to_rgb(format: jpeg_decoder::PixelFormat, pixels: Vec<u8>) -> Vec<u8> {
    match format {
        jpeg_decoder::PixelFormat::RGB24 => pixels,
        jpeg_decoder::PixelFormat::L8 => pixels.iter().flat_map(|&v| [v, v, v]).collect(),
        jpeg_decoder::PixelFormat::L16 => pixels.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0]]).collect(),
        jpeg_decoder::PixelFormat::CMYK32 => pixels
            .chunks_exact(4)
            .flat_map(|c| {
                let k = 255 - c[3] as u32;
                [c[0], c[1], c[2]].map(|v| ((255 - v as u32) * k / 255) as u8)
            })
            .collect(),
    }
}

/// Turns sensor-oriented pixels upright for EXIF orientation 1–8.
pub(crate) fn upright(img: image::RgbImage, orientation: u32) -> image::RgbImage {
    match orientation {
        2 => image::imageops::flip_horizontal(&img),
        3 => image::imageops::rotate180(&img),
        4 => image::imageops::flip_vertical(&img),
        5 => image::imageops::flip_horizontal(&image::imageops::rotate90(&img)),
        6 => image::imageops::rotate90(&img),
        7 => image::imageops::flip_horizontal(&image::imageops::rotate270(&img)),
        8 => image::imageops::rotate270(&img),
        _ => img,
    }
}

// MARK: - Cache

struct ByteCache {
    map: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
    bytes: usize,
}

impl ByteCache {
    fn get(&self, key: &str) -> Option<Arc<Vec<u8>>> {
        self.map.get(key).cloned()
    }

    fn insert(&mut self, key: String, value: Arc<Vec<u8>>) {
        self.bytes += value.len();
        if let Some(old) = self.map.insert(key.clone(), value) {
            self.bytes -= old.len();
        } else {
            self.order.push_back(key);
        }
        while self.bytes > THUMB_CACHE_BYTES {
            let Some(oldest) = self.order.pop_front() else { break };
            if let Some(v) = self.map.remove(&oldest) {
                self.bytes -= v.len();
            }
        }
    }
}

fn cache() -> &'static Mutex<ByteCache> {
    static CACHE: OnceLock<Mutex<ByteCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ByteCache { map: HashMap::new(), order: VecDeque::new(), bytes: 0 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg() -> Vec<u8> {
        let img = image::RgbImage::from_fn(96, 64, |x, y| image::Rgb([(x * 2) as u8, (y * 3) as u8, 80]));
        let mut jpeg = vec![];
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90).encode_image(&img).unwrap();
        jpeg
    }

    fn oriented_jpeg(orientation: u32, le: bool, long: bool) -> Vec<u8> {
        let mut tiff = if le { b"II\x2a\0".to_vec() } else { b"MM\0\x2a".to_vec() };
        let short = |v: u16| if le { v.to_le_bytes() } else { v.to_be_bytes() };
        let int = |v: u32| if le { v.to_le_bytes() } else { v.to_be_bytes() };
        tiff.extend(int(8));
        tiff.extend(short(2));
        tiff.extend(short(0x0112));
        tiff.extend(short(if long { 4 } else { 3 }));
        tiff.extend(int(1));
        if long { tiff.extend(int(orientation)); } else {
            tiff.extend(short(orientation as u16));
            tiff.extend([0, 0]);
        }
        // Unrelated metadata stays exactly as it was, including offsets and padding.
        tiff.extend(short(0x0131));
        tiff.extend(short(2));
        tiff.extend(int(4));
        tiff.extend(b"TEST");
        tiff.extend(int(0));
        let mut out = vec![0xff, 0xd8, 0xff, 0xe1];
        out.extend(((tiff.len() + 8) as u16).to_be_bytes());
        out.extend(b"Exif\0\0");
        out.extend(tiff);
        out.extend(&jpeg()[2..]);
        out
    }

    #[test]
    fn preview_neutralizes_all_exif_orientations_without_changing_pixels_or_other_metadata() {
        for le in [true, false] {
            for long in [false, true] {
                for orientation in 1..=8 {
                    let original = oriented_jpeg(orientation, le, long);
                    let mut response = original.clone();
                    neutralize_orientation(&mut response);
                    // The only allowed difference is the orientation value in this response.
                    assert_eq!(response, oriented_jpeg(1, le, long));
                    let mut meta = exif::Meta::default();
                    exif::parse_tiff(exif::jpeg_exif(&response).unwrap(), &mut meta);
                    assert_eq!(meta.orientation, 1);
                    let (_, scan) = jpeg_meta::layout(&original).unwrap();
                    assert_eq!(&response[scan..], &original[scan..]);
                    let mut decoder = jpeg_decoder::Decoder::new(std::io::Cursor::new(&response));
                    decoder.read_info().unwrap();
                    let info = decoder.info().unwrap();
                    assert_eq!((info.width, info.height), (96, 64), "encoded dimensions must stay sensor-oriented");
                }
            }
        }
    }

    #[test]
    fn preview_leaves_original_orientation_on_disk() {
        let path = std::env::temp_dir().join(format!("deadlyne-preview-orientation-{}.JPG", std::process::id()));
        let original = oriented_jpeg(6, true, false);
        std::fs::write(&path, &original).unwrap();
        let response = preview(&path).unwrap();
        assert_eq!(response, oriented_jpeg(1, true, false));
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert_eq!(exif::read(&path).orientation, 6);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn untagged_and_malformed_previews_are_safe() {
        let plain = jpeg();
        let mut response = plain.clone();
        neutralize_orientation(&mut response);
        assert_eq!(response, plain, "RAW previews with no EXIF still use the parent photo's orientation");
        let original = oriented_jpeg(8, false, false);
        for end in 0..original.len() {
            let mut truncated = original[..end].to_vec();
            neutralize_orientation(&mut truncated);
        }
        let mut invalid = original;
        invalid[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        let unchanged = invalid.clone();
        neutralize_orientation(&mut invalid);
        assert_eq!(invalid, unchanged);
    }

    /// Read-only benchmark on a real shoot: `DEADLYNE_SAMPLE=/path/to/folder cargo test --release bench -- --nocapture`
    #[test]
    fn bench_real_folder() {
        let Ok(dir) = std::env::var("DEADLYNE_SAMPLE") else { return };
        let t = std::time::Instant::now();
        let photos = crate::folder::scan(std::path::Path::new(&dir)).unwrap();
        println!("scan: {} photos in {:?}", photos.len(), t.elapsed());
        use rayon::prelude::*;
        let t = std::time::Instant::now();
        let metas: Vec<_> = photos.par_iter().map(|p| crate::exif::read(std::path::Path::new(&p.id))).collect();
        println!("metadata: {:?}  first: {:?}", t.elapsed(), metas.first());
        let t = std::time::Instant::now();
        let sample = &photos[..photos.len().min(200)];
        let sizes: Vec<usize> = sample.par_iter().map(|p| super::thumbnail(&p.id).map(|b| b.len()).unwrap_or(0)).collect();
        println!("thumbnails: {} in {:?} (parallel), failures {}, avg {} KB", sample.len(), t.elapsed(),
                 sizes.iter().filter(|s| **s == 0).count(), sizes.iter().sum::<usize>() / sizes.len().max(1) / 1024);
        let t = std::time::Instant::now();
        let full = crate::raw::extract(std::path::Path::new(&photos[0].id), crate::raw::PreviewKind::Full).unwrap();
        println!("full preview: {} KB in {:?}", full.len() / 1024, t.elapsed());
    }
}
