//! Culling data (rating, color label, tag) in Adobe-compatible XMP sidecars (`BASENAME.xmp`).
//!
//! Lightroom, Camera Raw, Bridge, Capture One and Photo Mechanic read `xmp:Rating` and
//! `xmp:Label` from the same sidecar. Existing sidecars (with Camera Raw develop settings) are
//! edited in place: only our own properties are touched, never the rest of the file. This is a
//! port of the Mac app's `XMPSidecar.swift` and must stay byte-compatible with it.

use regex::{NoExpand, Regex};
use serde::{Deserialize, Serialize};
use std::path::Path;

const DEADLYNE_NS: &str = "http://ns.deadlyne.app/1.0/";
pub const LABELS: [&str; 5] = ["Red", "Yellow", "Green", "Blue", "Purple"];

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Culling {
    pub rating: u8,
    pub label: Option<String>,
    pub tagged: bool,
}

pub fn read(sidecar: &Path) -> Option<Culling> {
    let text = std::fs::read_to_string(sidecar).ok()?;
    Some(read_culling(&text))
}

pub fn read_culling(text: &str) -> Culling {
    let mut v = Culling::default();
    if let Some(n) = value("xmp:Rating", text).and_then(|r| r.trim().parse::<i32>().ok()) {
        v.rating = n.clamp(0, 5) as u8;
    }
    v.label = value("xmp:Label", text).filter(|l| LABELS.contains(&l.as_str()));
    // "lensdesk:Tagged" was written before the app was renamed to Deadlyne.
    if let Some(t) = value("deadlyne:Tagged", text)
        .or_else(|| value("lensdesk:Tagged", text))
        .or_else(|| value("photomechanic:Tagged", text))
    {
        v.tagged = t.eq_ignore_ascii_case("true");
    }
    v
}

/// Writes culling values, creating the sidecar only when there's something worth writing.
pub fn write(sidecar: &Path, ext: &str, v: &Culling) -> std::io::Result<()> {
    let mut text = match std::fs::read_to_string(sidecar) {
        Ok(t) => t,
        Err(_) => {
            if v.rating == 0 && v.label.is_none() && !v.tagged {
                return Ok(());
            }
            template(ext)
        }
    };
    let rating = if v.rating == 0 && !text.contains("xmp:Rating") { None } else { Some(v.rating.to_string()) };
    text = set("xmp:Rating", rating.as_deref(), &text);
    text = set("xmp:Label", v.label.as_deref(), &text);
    text = set("deadlyne:Tagged", v.tagged.then_some("True"), &text);
    if text.contains("deadlyne:Tagged") && !text.contains("xmlns:deadlyne") {
        text = insert_attribute(&format!("xmlns:deadlyne=\"{DEADLYNE_NS}\""), &text);
    }
    // Migrate the pre-rename tag so it can't resurface after the photo is untagged.
    text = set("lensdesk:Tagged", None, &text);
    text = set("xmlns:lensdesk", None, &text);

    // Write beside the original, then swap, so a crash never leaves half a sidecar.
    let tmp = sidecar.with_extension("xmp.deadlyne-tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, sidecar)
}

fn template(ext: &str) -> String {
    format!(
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Deadlyne\">\n <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n  <rdf:Description rdf:about=\"\"\n    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n    xmlns:photoshop=\"http://ns.adobe.com/photoshop/1.0/\"\n   photoshop:SidecarForExtension=\"{ext}\">\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n"
    )
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Attribute form (`xmp:Rating="3"`) or element form (`<xmp:Rating>3</xmp:Rating>`).
fn value(name: &str, text: &str) -> Option<String> {
    let n = regex::escape(name);
    for pattern in [format!(r#"\s{n}="([^"]*)""#), format!("<{n}>([^<]*)</{n}>")] {
        if let Some(c) = Regex::new(&pattern).ok()?.captures(text) {
            return Some(c[1].to_string());
        }
    }
    None
}

/// Sets (or with `None`, removes) a simple property, preserving everything else.
fn set(name: &str, val: Option<&str>, text: &str) -> String {
    let n = regex::escape(name);
    let attr = Regex::new(&format!(r#"\s*{n}="[^"]*""#)).unwrap();
    let elem = Regex::new(&format!(r"\s*<{n}>[^<]*</{n}>")).unwrap();
    let escaped = escape(val.unwrap_or(""));
    if attr.is_match(text) {
        let rep = val.map(|_| format!("\n   {name}=\"{escaped}\"")).unwrap_or_default();
        return attr.replace_all(text, NoExpand(&rep)).into_owned();
    }
    if elem.is_match(text) {
        let rep = val.map(|_| format!("\n   <{name}>{escaped}</{name}>")).unwrap_or_default();
        return elem.replace_all(text, NoExpand(&rep)).into_owned();
    }
    if val.is_none() {
        return text.to_string();
    }
    let mut out = insert_attribute(&format!("{name}=\"{escaped}\""), text);
    if name.starts_with("xmp:") && !out.contains("xmlns:xmp=") {
        out = insert_attribute("xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"", &out);
    }
    out
}

/// Byte index of the `>` closing the first `<rdf:Description …>` start tag.
fn description_start_tag_end(text: &str) -> Option<(usize, usize)> {
    let start = text.find("<rdf:Description")?;
    let mut quote: Option<u8> = None;
    for (i, &c) in text.as_bytes().iter().enumerate().skip(start + "<rdf:Description".len()) {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b'>' => return Some((start, i)),
            None => {}
        }
    }
    None
}

/// Inserts an attribute into the first `<rdf:Description …>` start tag.
fn insert_attribute(attribute: &str, text: &str) -> String {
    let Some((start, end)) = description_start_tag_end(text) else { return text.to_string() };
    let self_closing = end > start + 16 && text.as_bytes()[end - 1] == b'/';
    let at = if self_closing { end - 1 } else { end };
    let mut out = String::with_capacity(text.len() + attribute.len() + 4);
    out.push_str(&text[..at]);
    out.push_str("\n   ");
    out.push_str(attribute);
    out.push_str(&text[at..]);
    out
}

// MARK: - Commands

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CullingWrite {
    pub sidecar: String,
    /// Extension of the file the sidecar describes ("CR3").
    pub ext: String,
    #[serde(flatten)]
    pub values: Culling,
}

/// Saves culling for many photos off the main thread. Returns the files that failed.
#[tauri::command]
pub async fn save_culling(items: Vec<CullingWrite>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        items
            .iter()
            .filter_map(|it| {
                write(Path::new(&it.sidecar), &it.ext, &it.values).err().map(|e| format!("{}: {e}", it.sidecar))
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_lightroom_sidecar_in_place() {
        let lr = "<x:xmpmeta><rdf:RDF><rdf:Description rdf:about=\"\"\n xmlns:crs=\"http://ns.adobe.com/camera-raw-settings/1.0/\"\n crs:Exposure2012=\"+0.50\"\n xmp:Rating=\"2\">\n</rdf:Description></rdf:RDF></x:xmpmeta>";
        let mut text = set("xmp:Rating", Some("4"), lr);
        text = set("xmp:Label", Some("Red"), &text);
        text = set("deadlyne:Tagged", Some("True"), &text);
        assert!(text.contains("crs:Exposure2012=\"+0.50\""));
        let v = read_culling(&text);
        assert_eq!(v, Culling { rating: 4, label: Some("Red".into()), tagged: true });
        let cleared = read_culling(&set("deadlyne:Tagged", None, &set("xmp:Label", None, &text)));
        assert_eq!(cleared, Culling { rating: 4, label: None, tagged: false });
    }

    #[test]
    fn reads_legacy_lensdesk_tag() {
        assert!(read_culling("<rdf:Description lensdesk:Tagged=\"True\">").tagged);
    }
}
