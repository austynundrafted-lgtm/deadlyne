//! Captions inside JPEG files, so delivered JPGs carry them: an XMP packet (APP1) for modern
//! readers and legacy IPTC-IIM (APP13, Photoshop resource 0x0404) for wire and archive systems.
//!
//! Only the metadata segments are rewritten; every byte of compressed image data is copied
//! unchanged, and the result is verified before it replaces the original. Port of the Mac app's
//! `JPEGMetadata.swift` + `IPTCIIM.swift`, written without ImageIO so it works on Windows too.

use crate::iptc::{Captions, Field};
use crate::xmp;
use md5::{Digest, Md5};
use std::path::Path;

const XMP_HEADER: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const PHOTOSHOP_HEADER: &[u8] = b"Photoshop 3.0\0";
const UTF8_MARKER: &[u8] = &[0x1B, 0x25, 0x47]; // ESC % G

#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum JpegMode {
    /// Captions go only in the XMP sidecar.
    Off,
    Xmp,
    /// Like Photo Mechanic: XMP plus the legacy IIM block.
    XmpAndIim,
}

struct Segment {
    marker: u8,
    start: usize,
    end: usize,
}

/// The marker segments before the image data, and where the scan (SOS) starts.
fn layout(b: &[u8]) -> Result<(Vec<Segment>, usize), String> {
    if b.len() < 4 || b[0] != 0xFF || b[1] != 0xD8 {
        return Err("not a JPEG".into());
    }
    let mut segs = vec![];
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xFF {
            return Err("damaged JPEG marker".into());
        }
        let marker = b[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0xDA || marker == 0xD9 {
            return Ok((segs, i));
        }
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            i += 2;
            continue;
        }
        let len = (b[i + 2] as usize) << 8 | b[i + 3] as usize;
        if len < 2 || i + 2 + len > b.len() {
            return Err("damaged JPEG segment".into());
        }
        segs.push(Segment { marker, start: i, end: i + 2 + len });
        i += 2 + len;
    }
    Err("JPEG has no image data".into())
}

fn body<'a>(b: &'a [u8], s: &Segment) -> &'a [u8] {
    &b[s.start + 4..s.end]
}

fn is_xmp(b: &[u8], s: &Segment) -> bool {
    s.marker == 0xE1 && body(b, s).starts_with(XMP_HEADER)
}

fn is_photoshop(b: &[u8], s: &Segment) -> bool {
    s.marker == 0xED && body(b, s).starts_with(PHOTOSHOP_HEADER)
}

fn dimensions(b: &[u8], segs: &[Segment]) -> Option<(u32, u32)> {
    segs.iter().find(|s| matches!(s.marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF)).map(|s| {
        let d = body(b, s);
        ((d[3] as u32) << 8 | d[4] as u32, (d[1] as u32) << 8 | d[2] as u32)
    })
}

// MARK: - Reading

/// Captions embedded in a JPEG: its XMP, or the legacy IIM block when there is no XMP caption.
pub fn read_captions(path: &Path) -> Captions {
    let Ok(b) = read_head(path) else { return Captions::default() };
    let Ok((segs, _)) = layout(&b) else { return Captions::default() };
    if let Some(s) = segs.iter().find(|s| is_xmp(&b, s)) {
        let text = String::from_utf8_lossy(&body(&b, s)[XMP_HEADER.len()..]);
        let c = xmp::read_captions(&text);
        if !c.is_empty() {
            return c;
        }
    }
    iim_captions(&iim_datasets(&b, &segs))
}

/// Metadata always precedes the scan; a JPEG's first megabyte holds all of it.
fn read_head(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut buf = Vec::with_capacity(1 << 20);
    std::fs::File::open(path)?.take(1 << 20).read_to_end(&mut buf)?;
    Ok(buf)
}

fn iim_captions(sets: &[Dataset]) -> Captions {
    let utf8 = sets.iter().any(|d| d.record == 1 && d.number == 90 && d.data == UTF8_MARKER);
    let text = |d: &Dataset| {
        if utf8 {
            String::from_utf8_lossy(&d.data).to_string()
        } else {
            String::from_utf8(d.data.clone()).unwrap_or_else(|_| d.data.iter().map(|&c| c as char).collect())
        }
    };
    let mut c = Captions::default();
    let mut creators = vec![];
    for d in sets.iter().filter(|d| d.record == 2) {
        let v = text(d);
        match d.number {
            25 => c.keywords.push(v),
            80 => creators.push(v),
            _ => {
                if let Some((f, _, _)) = IIM_MAP.iter().find(|(_, n, _)| *n == d.number) {
                    c.set(*f, &v);
                }
            }
        }
    }
    c.creator = creators.join("; ");
    c
}

// MARK: - Writing

/// Writes `fields` into the JPEG's XMP and, with `XmpAndIim`, the legacy IIM block from the full
/// `captions`. With `Xmp`, Deadlyne's datasets are removed from any IIM block so older readers
/// never see a stale caption.
pub fn embed(path: &Path, captions: &Captions, fields: &[Field], mode: JpegMode, date_created: Option<(String, String)>) -> Result<(), String> {
    let old = std::fs::read(path).map_err(|e| e.to_string())?;
    let (segs, scan) = layout(&old)?;

    // XMP
    let existing = segs.iter().find(|s| is_xmp(&old, s));
    let packet = match existing {
        Some(s) => String::from_utf8_lossy(&body(&old, s)[XMP_HEADER.len()..]).to_string(),
        None => xmp::jpeg_packet(),
    };
    let packet = xmp::apply_captions(captions, fields, &packet);
    let wants_xmp = existing.is_some() || fields.iter().any(|f| !captions.get(*f).is_empty());
    let mut app1 = vec![];
    if wants_xmp {
        let len = 2 + XMP_HEADER.len() + packet.len();
        if len > 0xFFFF {
            return Err("the caption is too long to embed in the JPEG (XMP is limited to 64 KB)".into());
        }
        app1.extend_from_slice(&[0xFF, 0xE1, (len >> 8) as u8, len as u8]);
        app1.extend_from_slice(XMP_HEADER);
        app1.extend_from_slice(packet.as_bytes());
    }

    // IIM
    let mut resources = photoshop_resources(&old, &segs);
    let stored = resources.iter().find(|r| r.id == 0x0404).map(|r| decode_iim(&r.data)).unwrap_or_default();
    resources.retain(|r| r.id != 0x0404 && r.id != 0x0425);
    let merged = merge_iim(&stored, (mode == JpegMode::XmpAndIim).then_some(captions), date_created);
    let iim = encode_iim(&merged);
    if !iim.is_empty() {
        let digest = Md5::digest(&iim).to_vec();
        resources.push(Resource { signature: *b"8BIM", id: 0x0404, name: vec![], data: iim });
        resources.push(Resource { signature: *b"8BIM", id: 0x0425, name: vec![], data: digest });
    }
    let mut app13 = vec![];
    if !resources.is_empty() {
        let mut payload = PHOTOSHOP_HEADER.to_vec();
        payload.extend(encode_resources(&resources));
        if payload.len() + 2 > 0xFFFF {
            return Err("the legacy IPTC block would exceed 64 KB".into());
        }
        let len = payload.len() + 2;
        app13.extend_from_slice(&[0xFF, 0xED, (len >> 8) as u8, len as u8]);
        app13.extend(payload);
    }

    // EXIF Artist / Copyright: cameras write them (often empty), and some readers prefer them.
    let exif_patch = segs.iter().position(|s| s.marker == 0xE1 && body(&old, s).starts_with(b"Exif\0\0")).and_then(|i| {
        let mut updates = vec![];
        if fields.contains(&Field::Creator) {
            updates.push((0x013B, captions.creator.clone()));
        }
        if fields.contains(&Field::Copyright) {
            updates.push((0x8298, captions.copyright.clone()));
        }
        patch_exif_strings(&old[segs[i].start..segs[i].end], &updates).map(|seg| (i, seg))
    });

    // Reassemble: new blocks where the old ones were, else after the leading APPn segments.
    let first_non_app = |upto: u8| segs.iter().position(|s| !(0xE0..=upto).contains(&s.marker)).unwrap_or(segs.len());
    let xmp_at = segs.iter().position(|s| is_xmp(&old, s)).unwrap_or_else(|| first_non_app(0xE1));
    let ps_at = segs.iter().position(|s| is_photoshop(&old, s)).unwrap_or_else(|| first_non_app(0xEC));
    let mut out = Vec::with_capacity(old.len() + app1.len() + app13.len());
    out.extend_from_slice(&[0xFF, 0xD8]);
    for (n, s) in segs.iter().enumerate() {
        if n == xmp_at {
            out.extend_from_slice(&app1);
        }
        if n == ps_at {
            out.extend_from_slice(&app13);
        }
        if let Some((_, seg)) = exif_patch.as_ref().filter(|(i, _)| *i == n) {
            out.extend_from_slice(seg);
        } else if !is_xmp(&old, s) && !is_photoshop(&old, s) {
            out.extend_from_slice(&old[s.start..s.end]);
        }
    }
    if xmp_at >= segs.len() {
        out.extend_from_slice(&app1);
    }
    if ps_at >= segs.len() {
        out.extend_from_slice(&app13);
    }
    let new_scan = out.len();
    out.extend_from_slice(&old[scan..]);

    // Verify before replacing: same size, same image bytes, and the captions read back.
    let (new_segs, check_scan) = layout(&out)?;
    if check_scan != new_scan || dimensions(&out, &new_segs) != dimensions(&old, &segs) || out[new_scan..] != old[scan..] {
        return Err("the rewritten file didn’t verify, so the original was kept".into());
    }
    xmp::write_atomic(path, &out).map_err(|e| e.to_string())
}

/// Rewrites existing ASCII tags in IFD0 of an EXIF APP1 segment (`FF E1 len "Exif\0\0" TIFF…`).
/// New strings are appended after the TIFF data, so no other offset moves. Tags the camera
/// didn't write are left alone. Returns the new segment, or None when nothing changed.
fn patch_exif_strings(seg: &[u8], updates: &[(u16, String)]) -> Option<Vec<u8>> {
    const HEADER: usize = 10; // FF E1 len(2) "Exif\0\0"
    let mut tiff = seg.get(HEADER..)?.to_vec();
    if tiff.len() < 8 || updates.is_empty() {
        return None;
    }
    let le = tiff[0] == 0x49;
    let rd16 = |b: &[u8], o: usize| if le { u16::from_le_bytes([b[o], b[o + 1]]) } else { u16::from_be_bytes([b[o], b[o + 1]]) };
    let rd32 = |b: &[u8], o: usize| if le { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) } else { u32::from_be_bytes(b[o..o + 4].try_into().unwrap()) };
    let wr32 = |v: u32| if le { v.to_le_bytes() } else { v.to_be_bytes() };
    let ifd = rd32(&tiff, 4) as usize;
    if ifd + 2 > tiff.len() {
        return None;
    }
    let count = rd16(&tiff, ifd) as usize;
    let mut changed = false;
    for k in 0..count {
        let e = ifd + 2 + k * 12;
        if e + 12 > tiff.len() {
            break;
        }
        let tag = rd16(&tiff, e);
        let Some((_, value)) = updates.iter().find(|(t, _)| *t == tag) else { continue };
        if rd16(&tiff, e + 2) != 2 {
            continue; // not ASCII
        }
        let mut bytes = value.as_bytes().to_vec();
        bytes.push(0);
        // Same value already? Leave it.
        let old_count = rd32(&tiff, e + 4) as usize;
        let old_off = if old_count <= 4 { e + 8 } else { rd32(&tiff, e + 8) as usize };
        if tiff.get(old_off..old_off + old_count) == Some(&bytes[..]) {
            continue;
        }
        tiff[e + 4..e + 8].copy_from_slice(&wr32(bytes.len() as u32));
        if bytes.len() <= 4 {
            let mut inline = [0u8; 4];
            inline[..bytes.len()].copy_from_slice(&bytes);
            tiff[e + 8..e + 12].copy_from_slice(&inline);
        } else {
            if tiff.len() % 2 == 1 {
                tiff.push(0);
            }
            let at = tiff.len() as u32;
            tiff.extend_from_slice(&bytes);
            tiff[e + 8..e + 12].copy_from_slice(&wr32(at));
        }
        changed = true;
    }
    let len = 2 + 6 + tiff.len();
    if !changed || len > 0xFFFF {
        return None;
    }
    let mut out = vec![0xFF, 0xE1, (len >> 8) as u8, len as u8];
    out.extend_from_slice(b"Exif\0\0");
    out.extend(tiff);
    Some(out)
}

// MARK: - IPTC-IIM

/// IIM dataset numbers (record 2) and their standard maximum lengths in bytes.
/// Usage Terms has no IIM dataset; it lives only in XMP.
const IIM_MAP: [(Field, u8, usize); 17] = [
    (Field::Title, 5, 64),
    (Field::Instructions, 40, 256),
    (Field::BylineTitle, 85, 32),
    (Field::CountryCode, 100, 3),
    (Field::JobId, 103, 32),
    (Field::Source, 115, 32),
    (Field::CaptionWriter, 122, 32),
    (Field::Keywords, 25, 64),
    (Field::Creator, 80, 32),
    (Field::City, 90, 32),
    (Field::Location, 92, 32),
    (Field::State, 95, 32),
    (Field::Country, 101, 64),
    (Field::Headline, 105, 256),
    (Field::Credit, 110, 32),
    (Field::Copyright, 116, 128),
    (Field::Caption, 120, 2000),
];

#[derive(Clone, PartialEq, Debug)]
struct Dataset {
    record: u8,
    number: u8,
    data: Vec<u8>,
}

fn iim_datasets(b: &[u8], segs: &[Segment]) -> Vec<Dataset> {
    photoshop_resources(b, segs).into_iter().find(|r| r.id == 0x0404).map(|r| decode_iim(&r.data)).unwrap_or_default()
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn datasets_for(c: &Captions) -> Vec<Dataset> {
    let mut out = vec![];
    for (field, number, max) in IIM_MAP {
        let values: Vec<String> = match field {
            Field::Keywords => c.keywords.clone(),
            Field::Creator => c.creator.split(';').map(|s| s.trim().to_string()).collect(),
            _ => vec![c.get(field)],
        };
        for v in values.iter().filter(|v| !v.is_empty()) {
            out.push(Dataset { record: 2, number, data: truncate(v, max).as_bytes().to_vec() });
        }
    }
    out
}

fn encode_iim(sets: &[Dataset]) -> Vec<u8> {
    let mut d = vec![];
    for s in sets {
        let len = s.data.len().min(0x7FFF);
        d.extend_from_slice(&[0x1C, s.record, s.number, (len >> 8) as u8, len as u8]);
        d.extend_from_slice(&s.data[..len]);
    }
    d
}

fn decode_iim(b: &[u8]) -> Vec<Dataset> {
    let mut out = vec![];
    let mut i = 0;
    while i + 5 <= b.len() && b[i] == 0x1C {
        let mut len = (b[i + 3] as usize) << 8 | b[i + 4] as usize;
        let mut start = i + 5;
        if len & 0x8000 != 0 {
            let n = len & 0x7FFF;
            if n > 4 || start + n > b.len() {
                break;
            }
            len = b[start..start + n].iter().fold(0usize, |a, &x| a << 8 | x as usize);
            start += n;
        }
        if start + len > b.len() {
            break;
        }
        out.push(Dataset { record: b[i + 1], number: b[i + 2], data: b[start..start + len].to_vec() });
        i = start + len;
    }
    out
}

/// Our datasets (if `captions`) plus whatever else the old block held, declared as UTF-8.
fn merge_iim(existing: &[Dataset], captions: Option<&Captions>, date_created: Option<(String, String)>) -> Vec<Dataset> {
    let managed: Vec<u8> = IIM_MAP.iter().map(|m| m.1).collect();
    let old_utf8 = existing.iter().any(|d| d.record == 1 && d.number == 90 && d.data == UTF8_MARKER);
    let preserved: Vec<Dataset> = existing
        .iter()
        .filter(|d| !(d.record == 1 && d.number == 90) && !(d.record == 2 && (d.number == 0 || managed.contains(&d.number))))
        .map(|d| {
            // Re-encode charset-less (Latin-1 / CP1252) text, since we always declare UTF-8.
            if !old_utf8 && d.record == 2 && std::str::from_utf8(&d.data).is_err() {
                Dataset { data: d.data.iter().map(|&c| c as char).collect::<String>().into_bytes(), ..d.clone() }
            } else {
                d.clone()
            }
        })
        .collect();
    let mut ours = captions.map(datasets_for).unwrap_or_default();
    if let (Some(_), Some((date, time))) = (captions, date_created) {
        if !preserved.iter().any(|d| d.record == 2 && d.number == 55) {
            ours.push(Dataset { record: 2, number: 55, data: date.into_bytes() });
        }
        if !preserved.iter().any(|d| d.record == 2 && d.number == 60) {
            ours.push(Dataset { record: 2, number: 60, data: time.into_bytes() });
        }
    }
    let mut record2: Vec<Dataset> = preserved.iter().filter(|d| d.record == 2).cloned().chain(ours).collect();
    if record2.is_empty() {
        return vec![];
    }
    record2.sort_by_key(|d| d.number); // stable: repeated keywords keep their order
    let mut out = vec![Dataset { record: 1, number: 90, data: UTF8_MARKER.to_vec() }];
    out.extend(preserved.iter().filter(|d| d.record == 1).cloned());
    out.push(Dataset { record: 2, number: 0, data: vec![0x00, 0x04] });
    out.extend(record2);
    out
}

// MARK: - Photoshop image resources

struct Resource {
    signature: [u8; 4],
    id: u16,
    name: Vec<u8>,
    data: Vec<u8>,
}

fn photoshop_resources(b: &[u8], segs: &[Segment]) -> Vec<Resource> {
    let mut ps = vec![];
    for s in segs.iter().filter(|s| is_photoshop(b, s)) {
        ps.extend_from_slice(&body(b, s)[PHOTOSHOP_HEADER.len()..]);
    }
    let mut out = vec![];
    let mut i = 0;
    while i + 12 <= ps.len() {
        let sig: [u8; 4] = ps[i..i + 4].try_into().unwrap();
        if &sig != b"8BIM" && &sig != b"MeSa" && &sig != b"PHUT" {
            break;
        }
        let id = (ps[i + 4] as u16) << 8 | ps[i + 5] as u16;
        let name_len = ps[i + 6] as usize;
        let mut p = i + 7 + name_len;
        if (1 + name_len) % 2 == 1 {
            p += 1;
        }
        if p + 4 > ps.len() {
            break;
        }
        let size = u32::from_be_bytes(ps[p..p + 4].try_into().unwrap()) as usize;
        p += 4;
        if p + size > ps.len() {
            break;
        }
        out.push(Resource { signature: sig, id, name: ps[i + 7..i + 7 + name_len].to_vec(), data: ps[p..p + size].to_vec() });
        i = p + size + size % 2;
    }
    out
}

fn encode_resources(rs: &[Resource]) -> Vec<u8> {
    let mut d = vec![];
    for r in rs {
        d.extend_from_slice(&r.signature);
        d.extend_from_slice(&r.id.to_be_bytes());
        d.push(r.name.len() as u8);
        d.extend_from_slice(&r.name);
        if (1 + r.name.len()) % 2 == 1 {
            d.push(0);
        }
        d.extend_from_slice(&(r.data.len() as u32).to_be_bytes());
        d.extend_from_slice(&r.data);
        if r.data.len() % 2 == 1 {
            d.push(0);
        }
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny but valid JPEG: SOI, APP0, SOF0 (2×3), SOS + fake scan, EOI.
    fn sample() -> Vec<u8> {
        let mut b = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        b.extend_from_slice(b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
        b.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00]);
        b.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 1, 2, 3, 4, 5, 0xFF, 0xD9]);
        b
    }

    #[test]
    fn embeds_xmp_and_iim_losslessly() {
        let dir = std::env::temp_dir().join(format!("deadlyne-jpeg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.jpg");
        std::fs::write(&path, sample()).unwrap();

        let mut c = Captions::default();
        c.headline = "Fairborn wins".into();
        c.caption = "Jordan Dončić (10) scores".into();
        c.keywords = vec!["Fairborn".into(), "Football".into()];
        c.title = "FBO-Fairborn-Tecumseh".into();
        c.byline_title = "Staff Photographer".into();
        c.source = "Deadlyne Sports".into();
        c.instructions = "Embargoed until 9 p.m.".into();
        c.job_id = "A-2026-0822".into();
        c.caption_writer = "AM".into();
        c.country_code = "USA".into();
        c.usage_terms = "Editorial use only".into();
        embed(&path, &c, &Field::ALL, JpegMode::XmpAndIim, Some(("20260822".into(), "094527-0400".into()))).unwrap();

        let b = std::fs::read(&path).unwrap();
        let (segs, scan) = layout(&b).unwrap();
        assert_eq!(&b[scan..], &sample()[sample().len() - 17..]);
        assert_eq!(read_captions(&path), c);
        let iim = iim_captions(&iim_datasets(&b, &segs));
        assert_eq!(iim.caption, c.caption);
        assert_eq!(iim.keywords, c.keywords);
        assert_eq!((iim.title.as_str(), iim.job_id.as_str(), iim.instructions.as_str()), ("FBO-Fairborn-Tecumseh", "A-2026-0822", "Embargoed until 9 p.m."));
        assert_eq!((iim.byline_title.as_str(), iim.source.as_str(), iim.caption_writer.as_str(), iim.country_code.as_str()), ("Staff Photographer", "Deadlyne Sports", "AM", "USA"));
        assert!(iim.usage_terms.is_empty(), "Usage Terms has no IIM dataset");

        // XMP only: the legacy caption is removed, the XMP one stays.
        embed(&path, &c, &Field::ALL, JpegMode::Xmp, None).unwrap();
        let b = std::fs::read(&path).unwrap();
        let (segs, _) = layout(&b).unwrap();
        assert!(iim_captions(&iim_datasets(&b, &segs)).is_empty());
        assert_eq!(read_captions(&path).headline, "Fairborn wins");
        std::fs::remove_dir_all(dir).ok();
    }

    /// On a copy of a real camera JPEG: `DEADLYNE_JPEG=/path/copy.jpg cargo test real_jpeg -- --ignored`
    #[test]
    #[ignore]
    fn real_jpeg() {
        let Ok(p) = std::env::var("DEADLYNE_JPEG") else { return };
        let path = Path::new(&p);
        let before = std::fs::read(path).unwrap();
        let (bsegs, bscan) = layout(&before).unwrap();
        let mut c = Captions::default();
        c.headline = "Fairborn vs. Tecumseh".into();
        c.caption = "Jordan Sample (10) scores for the Fairborn Skyhawks — Dončić-style".into();
        c.keywords = vec!["Fairborn".into(), "Football".into(), "Ohio".into()];
        c.creator = "Austyn McFadden".into();
        c.credit = "Deadlyne Test".into();
        c.copyright = "© 2026 Austyn McFadden".into();
        c.city = "Tipp City".into();
        let m = crate::exif::read(path);
        embed(path, &c, &Field::ALL, JpegMode::XmpAndIim, crate::exif::iim_date_time(&m)).unwrap();
        let after = std::fs::read(path).unwrap();
        let (asegs, ascan) = layout(&after).unwrap();
        assert_eq!(&after[ascan..], &before[bscan..], "image data must be byte-identical");
        assert_eq!(dimensions(&after, &asegs), dimensions(&before, &bsegs));
        assert_eq!(read_captions(path), c);
        println!("ok: {} → {} bytes, iim date {:?}", before.len(), after.len(), crate::exif::iim_date_time(&m));
    }
}
