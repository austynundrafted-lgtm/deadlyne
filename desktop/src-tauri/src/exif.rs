//! Capture metadata (orientation, time, camera, lens, exposure) read straight from file headers.
//! A small hand-rolled TIFF/EXIF reader: it only needs a dozen tags, and avoiding a general
//! parser keeps a 2,000-photo folder's metadata pass well under a second.

use crate::raw::{self, u16_at, u32_at, Reader};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    /// EXIF orientation 1–8.
    pub orientation: u32,
    /// Capture time as local "YYYY-MM-DDTHH:MM:SS.ss" (sortable), or the file's modified time.
    pub captured: Option<String>,
    pub camera: String,
    pub lens: String,
    pub exposure: Option<f64>,
    pub f_number: Option<f64>,
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,
    /// EXIF OffsetTimeOriginal ("-04:00"), for IPTC Time Created.
    #[serde(skip)]
    pub offset: Option<String>,
}

/// IPTC-IIM Date Created (CCYYMMDD) and Time Created (HHMMSS±HHMM) from the capture time.
pub fn iim_date_time(m: &Meta) -> Option<(String, String)> {
    let digits: String = m.captured.as_deref()?.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 14 {
        return None;
    }
    let mut time = digits[8..14].to_string();
    if let Some(o) = m.offset.as_deref().filter(|o| o.len() == 6 && (o.starts_with('+') || o.starts_with('-'))) {
        time.push_str(&o[..1]);
        time.extend(o[1..].chars().filter(char::is_ascii_digit));
    }
    Some((digits[..8].to_string(), time))
}

pub fn read(path: &Path) -> Meta {
    let mut m = Meta { orientation: 1, ..Default::default() };
    if let Some(r) = Reader::open(path) {
        if let Some(head) = r.read(0, 16) {
            if head.len() >= 12 {
                if head[0] == 0xFF && head[1] == 0xD8 {
                    if let Some(buf) = r.read(0, 256 << 10) {
                        if let Some(tiff) = jpeg_exif(&buf) {
                            parse_tiff(tiff, &mut m);
                        }
                    }
                } else if &head[4..8] == b"ftyp" {
                    cr3(&r, &mut m);
                } else if head.len() >= 8 && &head[0..8] == b"FUJIFILM" {
                    // RAF: the embedded JPEG carries the EXIF.
                    if let Some(h) = r.read_exact(84, 8) {
                        let off = u32_at(&h, 0, false) as u64;
                        if let Some(buf) = r.read(off, 256 << 10) {
                            if let Some(tiff) = jpeg_exif(&buf) {
                                parse_tiff(tiff, &mut m);
                            }
                        }
                    }
                } else if head[0] == head[1] && (head[0] == 0x49 || head[0] == 0x4D) {
                    if let Some(buf) = r.read(0, 2 << 20) {
                        parse_tiff(&buf, &mut m);
                    }
                }
            }
        }
    }
    if m.captured.is_none() {
        m.captured = modified_time(path);
    }
    if !(1..=8).contains(&m.orientation) {
        m.orientation = 1;
    }
    m
}

/// The TIFF block inside a JPEG's APP1 "Exif" segment.
pub fn jpeg_exif(b: &[u8]) -> Option<&[u8]> {
    let mut p = 2;
    while p + 4 <= b.len() {
        if b[p] != 0xFF {
            return None;
        }
        let marker = b[p + 1];
        if marker == 0xDA || marker == 0xD9 {
            return None;
        }
        let len = u16_at(b, p + 2, false) as usize;
        if marker == 0xE1 && p + 10 <= b.len() && &b[p + 4..p + 10] == b"Exif\0\0" {
            let end = (p + 2 + len).min(b.len());
            return b.get(p + 10..end);
        }
        p += 2 + len;
    }
    None
}

/// CR3 keeps EXIF as TIFF blocks in Canon's metadata uuid: CMT1 = IFD0, CMT2 = EXIF IFD.
fn cr3(r: &Reader, m: &mut Meta) {
    raw::cr3_top_boxes(r, |t, off, size, _| {
        if t != b"moov" {
            return;
        }
        let Some(moov) = r.read(off, size.min(8 << 20) as usize) else { return };
        let mut p = 8;
        while p + 8 <= moov.len() {
            let sz = u32_at(&moov, p, false) as usize;
            if sz < 8 || p + sz > moov.len() {
                break;
            }
            if &moov[p + 4..p + 8] == b"uuid" && moov.get(p + 8..p + 24) == Some(&raw::CANON_METADATA_UUID[..]) {
                let body = p + 24..p + sz;
                for name in [b"CMT1", b"CMT2"] {
                    if let Some(range) = raw::child_box(&moov, name, body.clone()) {
                        parse_tiff(&moov[range], m);
                    }
                }
            }
            p += sz;
        }
    });
}

/// Reads the tags we care about from IFD0 and the EXIF IFD of a TIFF block.
/// An EXIF-IFD-only block (CR3's CMT2) parses too: its IFD0 simply holds the EXIF tags.
pub fn parse_tiff(t: &[u8], m: &mut Meta) {
    if t.len() < 8 {
        return;
    }
    let le = t[0] == 0x49;
    let first = u32_at(t, 4, le) as usize;
    let mut subsec: Option<String> = None;
    let mut date: Option<String> = None;
    let mut queue = vec![first];
    let mut seen = 0;
    while let Some(ifd) = queue.pop() {
        seen += 1;
        if seen > 4 || ifd == 0 || ifd + 2 > t.len() {
            continue;
        }
        let n = u16_at(t, ifd, le) as usize;
        for i in 0..n.min(512) {
            let e = ifd + 2 + i * 12;
            if e + 12 > t.len() {
                break;
            }
            let tag = u16_at(t, e, le);
            let typ = u16_at(t, e + 2, le);
            let count = u32_at(t, e + 4, le) as usize;
            let unit = match typ {
                3 => 2,
                4 | 9 => 4,
                5 | 10 => 8,
                _ => 1,
            };
            let data = if count * unit <= 4 { e + 8 } else { u32_at(t, e + 8, le) as usize };
            let ascii = || -> String {
                t.get(data..data.saturating_add(count).min(t.len()))
                    .map(|s| String::from_utf8_lossy(s).trim_matches(char::from(0)).trim().to_string())
                    .unwrap_or_default()
            };
            let rational = || -> Option<f64> {
                let (num, den) = (u32_at(t, data, le), u32_at(t, data + 4, le));
                (den != 0 && data + 8 <= t.len()).then(|| num as f64 / den as f64)
            };
            let int = || -> u32 { if typ == 3 { u16_at(t, data, le) } else { u32_at(t, data, le) } };
            match tag {
                0x0112 => m.orientation = int(),
                0x0110 => m.camera = ascii(),
                0x8769 => queue.push(int() as usize),
                0x829A => m.exposure = rational(),
                0x829D => m.f_number = rational(),
                0x8827 => m.iso = m.iso.or(Some(int()).filter(|v| *v > 0)),
                0x8832 => m.iso = m.iso.or(Some(int()).filter(|v| *v > 0)),
                0x9003 => date = Some(ascii()),
                0x9291 => subsec = Some(ascii()),
                0x920A => m.focal_length = rational(),
                0x9011 => m.offset = Some(ascii()),
                0xA434 => m.lens = ascii(),
                _ => {}
            }
        }
    }
    if let Some(d) = date.and_then(|d| exif_date(&d, subsec.as_deref())) {
        m.captured = Some(d);
    }
}

/// "2026:08:22 09:45:27" + subsec "07" → "2026-08-22T09:45:27.07".
fn exif_date(s: &str, subsec: Option<&str>) -> Option<String> {
    let parts: Vec<&str> = s.split([':', ' ']).filter(|p| !p.is_empty()).collect();
    if parts.len() < 6 || parts.iter().take(6).any(|p| p.parse::<u32>().is_err()) || parts[0] == "0000" {
        return None;
    }
    let mut out = format!("{}-{}-{}T{}:{}:{}", parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
    if let Some(ss) = subsec.map(str::trim).filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())) {
        out.push('.');
        out.push_str(ss);
    }
    Some(out)
}

fn modified_time(path: &Path) -> Option<String> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    // UTC is fine for a fallback sort key.
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, mo, d) = civil_from_days(days);
    Some(format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}", rem / 3600, rem / 60 % 60, rem % 60))
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}
