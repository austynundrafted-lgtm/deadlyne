//! Saving captions. RAW photos keep captions in their XMP sidecar; JPGs get them embedded in the
//! file itself (and in a sidecar only when embedding is off or there's no RAW beside them).

use crate::iptc::{Captions, Field};
use crate::jpeg_meta::{self, JpegMode};
use crate::{exif, jobs, xmp};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionWrite {
    pub sidecar: String,
    /// Extension of the primary file ("CR3"), for a new sidecar.
    pub ext: String,
    pub has_raw: bool,
    pub jpeg: Option<String>,
    pub captions: Captions,
}

/// Writes `fields` for every photo. Returns a message for each photo that failed.
#[tauri::command]
pub async fn save_captions(items: Vec<CaptionWrite>, fields: Vec<Field>, jpeg_mode: JpegMode) -> Vec<String> {
    jobs::serial(move || {
        let mut errors = vec![];
        for it in &items {
            let embed = jpeg_mode != JpegMode::Off;
            if it.has_raw || !embed || it.jpeg.is_none() {
                if let Err(e) = xmp::update(Path::new(&it.sidecar), &it.ext, None, Some((&it.captions, &fields))) {
                    errors.push(format!("{}: {e}", file_name(&it.sidecar)));
                }
            }
            if let (true, Some(jpeg)) = (embed, &it.jpeg) {
                let path = Path::new(jpeg);
                let created = exif::iim_date_time(&exif::read(path));
                if let Err(e) = jpeg_meta::embed(path, &it.captions, &fields, jpeg_mode, created) {
                    errors.push(format!("{}: {e}", file_name(jpeg)));
                }
            }
        }
        errors
    })
    .await
}

/// Captions for a photo: its sidecar, or for a JPG on its own, the JPG's embedded captions.
pub fn load(sidecar_captions: Option<Captions>, has_raw: bool, jpeg: Option<&str>) -> Captions {
    match (sidecar_captions, has_raw, jpeg) {
        (Some(c), _, _) if !c.is_empty() => c,
        (_, false, Some(j)) => jpeg_meta::read_captions(Path::new(j)),
        (c, _, _) => c.unwrap_or_default(),
    }
}

fn file_name(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string())
}
