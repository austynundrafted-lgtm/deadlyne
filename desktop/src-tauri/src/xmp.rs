//! Culling data (rating, color label, tag) and IPTC captions in Adobe-compatible XMP sidecars
//! (`BASENAME.xmp`), plus the same text surgery for XMP packets embedded in JPEGs.
//!
//! Lightroom, Camera Raw, Bridge, Capture One and Photo Mechanic read `xmp:Rating`, `xmp:Label`
//! and the IPTC properties from the same sidecar. Existing sidecars (with Camera Raw develop
//! settings) are edited in place: only our own properties are touched, never the rest of the
//! file. This is a port of the Mac app's `XMPSidecar.swift` and must stay compatible with it.

use crate::iptc::{Captions, Field, Kind};
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

/// Culling and captions from one read of a sidecar.
pub fn read_all(sidecar: &Path) -> Option<(Culling, Captions)> {
    let text = std::fs::read_to_string(sidecar).ok()?;
    Some((read_culling(&text), read_captions(&text)))
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

pub fn read_captions(text: &str) -> Captions {
    let mut c = Captions::default();
    for f in Field::ALL {
        let path = f.xmp_path();
        match f.kind() {
            Kind::Simple => {
                if let Some(v) = value(&path, text) {
                    c.set(f, &unescape(&v));
                }
            }
            Kind::LangAlt | Kind::Bag | Kind::Seq => {
                let items = list_items(&path, text);
                if f == Field::Keywords {
                    c.keywords = items;
                } else if !items.is_empty() {
                    let joined = if f.kind() == Kind::Seq { items.join("; ") } else { items[0].clone() };
                    c.set(f, &joined);
                } else if let Some(v) = value(&path, text) {
                    c.set(f, &unescape(&v));
                }
            }
        }
    }
    c
}

/// Updates culling and/or caption fields in a sidecar, leaving everything else untouched.
/// A new sidecar is created only when there's something worth writing.
pub fn update(sidecar: &Path, ext: &str, culling: Option<&Culling>, captions: Option<(&Captions, &[Field])>) -> std::io::Result<()> {
    let mut text = match std::fs::read_to_string(sidecar) {
        Ok(t) => t,
        Err(_) => {
            let culling_empty = culling.is_none_or(|v| v.rating == 0 && v.label.is_none() && !v.tagged);
            let captions_empty = captions.is_none_or(|(c, fields)| fields.iter().all(|f| c.get(*f).is_empty()));
            if culling_empty && captions_empty {
                return Ok(());
            }
            template(ext)
        }
    };
    if let Some(v) = culling {
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
    }
    if let Some((c, fields)) = captions {
        text = apply_captions(c, fields, &text);
    }
    write_atomic(sidecar, text.as_bytes())
}

/// Writes beside the original, then swaps, so a crash never leaves half a file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.deadlyne-tmp"));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

fn template(ext: &str) -> String {
    format!(
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Deadlyne\">\n <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n  <rdf:Description rdf:about=\"\"\n    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n    xmlns:photoshop=\"http://ns.adobe.com/photoshop/1.0/\"\n   photoshop:SidecarForExtension=\"{ext}\">\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n"
    )
}

/// A fresh XMP packet for a JPEG that has none.
pub fn jpeg_packet() -> String {
    "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Deadlyne\">\n <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n  <rdf:Description rdf:about=\"\">\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>".to_string()
}

// MARK: - IPTC writing

pub fn apply_captions(c: &Captions, fields: &[Field], original: &str) -> String {
    let mut text = original.to_string();
    for f in Field::ALL.into_iter().filter(|f| fields.contains(f)) {
        let path = f.xmp_path();
        text = remove_element(&path, &text);
        text = set(&path, None, &text);
        let value = c.get(f);
        if value.is_empty() {
            continue;
        }
        if !text.contains(&format!("xmlns:{}=", f.prefix())) {
            text = insert_attribute(&format!("xmlns:{}=\"{}\"", f.prefix(), f.namespace()), &text);
        }
        text = match f.kind() {
            Kind::Simple => set(&path, Some(&value.replace('\n', " ")), &text),
            Kind::LangAlt => insert_element(&structure(&path, "rdf:Alt", &[value], true), &text),
            Kind::Bag => insert_element(&structure(&path, "rdf:Bag", &c.keywords, false), &text),
            Kind::Seq => {
                let items: Vec<String> = value.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                insert_element(&structure(&path, "rdf:Seq", &items, false), &text)
            }
        };
    }
    text
}

fn structure(name: &str, container: &str, items: &[String], lang: bool) -> String {
    let mut lines = vec![format!("   <{name}>"), format!("    <{container}>")];
    for it in items {
        let attr = if lang { " xml:lang=\"x-default\"" } else { "" };
        lines.push(format!("     <rdf:li{attr}>{}</rdf:li>", escape(it)));
    }
    lines.push(format!("    </{container}>"));
    lines.push(format!("   </{name}>"));
    lines.join("\n")
}

/// Inserts a child element just before the first `</rdf:Description>`, converting a
/// self-closing description into an open/close pair if needed.
fn insert_element(element: &str, original: &str) -> String {
    let mut text = original.to_string();
    if !text.contains("</rdf:Description>") {
        if let Some((_, end)) = description_start_tag_end(&text) {
            if text.as_bytes()[end - 1] == b'/' {
                text.replace_range(end - 1..=end, ">\n  </rdf:Description>");
            }
        }
    }
    let Some(close) = text.find("</rdf:Description>") else { return text };
    // Keep the closing tag's own indentation intact.
    let mut line_start = close;
    while line_start > 0 && text.as_bytes()[line_start - 1] == b' ' {
        line_start -= 1;
    }
    text.insert_str(line_start, &format!("{element}\n"));
    text
}

fn remove_element(name: &str, text: &str) -> String {
    let n = regex::escape(name);
    let re = Regex::new(&format!(r"\n?[ \t]*<{n}(\s*/>|>[\s\S]*?</{n}>)")).unwrap();
    re.replace_all(text, "").into_owned()
}

fn list_items(name: &str, text: &str) -> Vec<String> {
    let n = regex::escape(name);
    let block = Regex::new(&format!(r"<{n}>([\s\S]*?)</{n}>")).unwrap();
    let Some(inner) = block.captures(text).map(|c| c[1].to_string()) else { return vec![] };
    let li = Regex::new(r"<rdf:li[^>]*>([\s\S]*?)</rdf:li>").unwrap();
    li.captures_iter(&inner).map(|c| unescape(&c[1])).filter(|s| !s.is_empty()).collect()
}

// MARK: - Helpers

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#xA;", "\n")
        .replace("&#10;", "\n")
        .replace("&amp;", "&")
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

/// Byte indexes of `<rdf:Description` and the `>` closing that start tag.
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
    crate::jobs::serial(move || {
        items
            .iter()
            .filter_map(|it| {
                update(Path::new(&it.sidecar), &it.ext, Some(&it.values), None).err().map(|e| format!("{}: {e}", it.sidecar))
            })
            .collect()
    })
    .await
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

    #[test]
    fn captions_round_trip_and_clear() {
        let mut c = Captions::default();
        c.headline = "Fairborn wins".into();
        c.caption = "Jordan Sample (10) scores & celebrates <big>".into();
        c.keywords = vec!["Fairborn".into(), "football".into()];
        c.creator = "Austyn McFadden; Second Shooter".into();
        c.city = "Tipp City".into();
        let text = apply_captions(&c, &Field::ALL, &template("CR3"));
        assert_eq!(read_captions(&text), c);
        // Editing one field again replaces it rather than duplicating.
        let mut c2 = c.clone();
        c2.caption = "Updated".into();
        let text2 = apply_captions(&c2, &[Field::Caption], &text);
        assert_eq!(text2.matches("dc:description>").count(), 2);
        assert_eq!(read_captions(&text2).caption, "Updated");
        let cleared = apply_captions(&Captions::default(), &Field::ALL, &text2);
        assert!(read_captions(&cleared).is_empty());
    }
}
