//! Opening a shoot: list the folder and pair RAW+JPEG files into photos (instant, no file is
//! opened), then read capture metadata and sidecars for every photo in parallel.

use crate::{captions, exif, iptc::Captions, xmp};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const RAW_EXTS: [&str; 23] = [
    "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2", "pef", "srw", "3fr", "iiq",
    "erf", "kdc", "mos", "mrw", "x3f", "rwl", "gpr",
];
/// Image files the webview can show without help. (HEIC/TIFF need a decoder: not yet.)
pub const IMAGE_EXTS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

/// One photo in the contact sheet. A RAW+JPEG pair shot together is a single photo.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhotoEntry {
    /// The primary file's path (the RAW when there is one); unique within the folder.
    pub id: String,
    pub name: String,
    pub raw: Option<String>,
    pub jpeg: Option<String>,
    pub sidecar: String,
    /// "CR3+JPG", "CR3", "JPG".
    pub kind: String,
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

pub fn scan(folder: &Path) -> std::io::Result<Vec<PhotoEntry>> {
    struct Pair {
        base: String,
        raw: Option<PathBuf>,
        jpeg: Option<PathBuf>,
    }
    let mut by_base: HashMap<String, Pair> = HashMap::new();
    for entry in std::fs::read_dir(folder)?.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') || !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let ext = ext_of(&path);
        let is_raw = RAW_EXTS.contains(&ext.as_str());
        if !is_raw && !IMAGE_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let base = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let pair = by_base.entry(base.to_lowercase()).or_insert(Pair { base, raw: None, jpeg: None });
        if is_raw {
            pair.raw = Some(path);
        } else if pair.jpeg.is_none() || ext == "jpg" || ext == "jpeg" {
            pair.jpeg = Some(path);
        }
    }
    let mut photos: Vec<PhotoEntry> = by_base
        .into_values()
        .filter_map(|p| {
            let primary = p.raw.clone().or(p.jpeg.clone())?;
            let upper = |x: &PathBuf| ext_of(x).to_ascii_uppercase();
            let kind = match (&p.raw, &p.jpeg) {
                (Some(r), Some(_)) => format!("{}+JPG", upper(r)),
                _ => upper(&primary),
            };
            Some(PhotoEntry {
                id: primary.to_string_lossy().to_string(),
                name: primary.file_name()?.to_string_lossy().to_string(),
                sidecar: folder.join(format!("{}.xmp", p.base)).to_string_lossy().to_string(),
                raw: p.raw.map(|x| x.to_string_lossy().to_string()),
                jpeg: p.jpeg.map(|x| x.to_string_lossy().to_string()),
                kind,
            })
        })
        .collect();
    photos.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(photos)
}

/// "MCD_2" before "MCD_10", like the Finder.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek(), y.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().filter(|c| c.is_ascii_digit()) {
                        s.push(*c);
                        it.next();
                    }
                    s
                };
                let (m, n) = (take(&mut x), take(&mut y));
                let ord = m.trim_start_matches('0').len().cmp(&n.trim_start_matches('0').len()).then(m.cmp(&n));
                if ord.is_ne() {
                    return ord;
                }
            }
            (Some(c), Some(d)) => {
                let ord = c.to_ascii_lowercase().cmp(&d.to_ascii_lowercase());
                if ord.is_ne() {
                    return ord;
                }
                x.next();
                y.next();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub meta: exif::Meta,
    pub culling: xmp::Culling,
    pub captions: Captions,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailsRequest {
    pub id: String,
    pub sidecar: String,
    pub raw: Option<String>,
    pub jpeg: Option<String>,
}

#[derive(Serialize)]
pub struct Shoot {
    pub folder: String,
    pub photos: Vec<PhotoEntry>,
}

/// Opens a folder, or the folder holding a file that was dropped on the window.
#[tauri::command]
pub async fn scan_folder(path: String) -> Result<Shoot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut folder = PathBuf::from(&path);
        if folder.is_file() {
            folder.pop();
        }
        let photos = scan(&folder).map_err(|e| format!("Couldn’t open {}: {e}", folder.display()))?;
        Ok(Shoot { folder: folder.to_string_lossy().to_string(), photos })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A folder passed on the command line (`Deadlyne /path/to/shoot`), opened at launch.
#[tauri::command]
pub fn launch_folder() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with('-') && Path::new(a).exists())
}

/// Capture metadata and sidecar culling for every photo, index-aligned with the request.
#[tauri::command]
pub async fn load_details(photos: Vec<DetailsRequest>) -> Vec<Details> {
    crate::jobs::blocking(move || {
        photos
            .par_iter()
            .map(|p| {
                let (culling, sidecar_captions) = match xmp::read_all(Path::new(&p.sidecar)) {
                    Some((c, cap)) => (c, Some(cap)),
                    None => (Default::default(), None),
                };
                Details {
                    meta: exif::read(Path::new(&p.id)),
                    culling,
                    captions: captions::load(sidecar_captions, p.raw.is_some(), p.jpeg.as_deref()),
                }
            })
            .collect()
    })
    .await
}
