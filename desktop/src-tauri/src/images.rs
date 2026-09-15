//! Serves photos to the interface through two custom URL schemes, so `<img>` tags load them
//! directly with no base64 or IPC copies:
//!
//! - `thumb://localhost/<path>`: a small JPEG for the contact sheet. The embedded preview is
//!   decoded with libjpeg-style DCT scaling (1/2–1/8 size nearly for free), rotated upright,
//!   re-encoded and cached in memory.
//! - `preview://localhost/<path>`: the largest embedded JPEG, passed through untouched for the
//!   loupe. The interface applies the orientation (see `orientationStyle` in the frontend).
//!
//! On Windows the same URLs arrive as `http://thumb.localhost/<path>`; `convertFileSrc` in the
//! frontend builds the right form for each platform.

use crate::{exif, raw};
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
        let body = match kind {
            Kind::Thumb => thumbnail(&path),
            Kind::Preview => raw::extract(Path::new(&path), raw::PreviewKind::Full).map(Arc::new),
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
    let rgb: Vec<u8> = match decoder.info()?.pixel_format {
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
    };
    let img = image::RgbImage::from_raw(w as u32, h as u32, rgb)?;
    let img = match orientation {
        2 => image::imageops::flip_horizontal(&img),
        3 => image::imageops::rotate180(&img),
        4 => image::imageops::flip_vertical(&img),
        5 => image::imageops::flip_horizontal(&image::imageops::rotate90(&img)),
        6 => image::imageops::rotate90(&img),
        7 => image::imageops::flip_horizontal(&image::imageops::rotate270(&img)),
        8 => image::imageops::rotate270(&img),
        _ => img,
    };
    let mut out = Vec::with_capacity(96 << 10);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82).encode_image(&img).ok()?;
    Some(out)
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
