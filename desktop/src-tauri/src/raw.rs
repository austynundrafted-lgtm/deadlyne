//! Pulls the camera-rendered JPEG previews out of RAW files without touching the sensor data.
//!
//! This is the whole trick behind "instant RAW" browsers like Photo Mechanic: every RAW file
//! already contains finished JPEGs the camera rendered at capture time. Instead of demosaicing
//! 24–60 MP of sensor data, we parse the container, seek straight to a JPEG and read only it.
//!
//! Supported containers: Canon CR3 (ISO base media), Fujifilm RAF, and TIFF-based RAWs
//! (CR2, NEF, ARW, DNG, ORF, RW2, PEF, SRW, 3FR, IIQ, ERF…). Plain JPEG files are passed through.

use std::fs::File;
use std::path::Path;

pub const MAX_JPEG_BYTES: usize = 80 << 20;

/// Positional reads straight from the file — no full-file mapping, so a 60 MB RAW costs only
/// the few kilobytes of headers plus the JPEG we actually want.
pub struct Reader {
    file: File,
    pub size: u64,
}

impl Reader {
    pub fn open(path: &Path) -> Option<Self> {
        let file = File::open(path).ok()?;
        let size = file.metadata().ok()?.len();
        Some(Self { file, size })
    }

    /// Up to `len` bytes at `offset` (fewer only at the end of the file).
    pub fn read(&self, offset: u64, len: usize) -> Option<Vec<u8>> {
        if len == 0 || offset >= self.size {
            return None;
        }
        let len = len.min((self.size - offset) as usize);
        let mut buf = vec![0u8; len];
        let mut done = 0;
        while done < len {
            let n = read_at(&self.file, &mut buf[done..], offset + done as u64).ok()?;
            if n == 0 {
                return None;
            }
            done += n;
        }
        Some(buf)
    }

    /// Exactly `len` bytes at `offset`, or nothing.
    pub fn read_exact(&self, offset: u64, len: usize) -> Option<Vec<u8>> {
        if offset + len as u64 > self.size {
            return None;
        }
        self.read(offset, len).filter(|b| b.len() == len)
    }
}

#[cfg(unix)]
fn read_at(f: &File, buf: &mut [u8], off: u64) -> std::io::Result<usize> {
    use std::os::unix::fs::FileExt;
    f.read_at(buf, off)
}

#[cfg(windows)]
fn read_at(f: &File, buf: &mut [u8], off: u64) -> std::io::Result<usize> {
    use std::os::windows::fs::FileExt;
    f.read_at(buf, off)
}

// MARK: - Byte helpers

pub fn u16_at(b: &[u8], i: usize, le: bool) -> u32 {
    if i + 2 > b.len() {
        return 0;
    }
    let (x, y) = (b[i] as u32, b[i + 1] as u32);
    if le { x | y << 8 } else { x << 8 | y }
}

pub fn u32_at(b: &[u8], i: usize, le: bool) -> u32 {
    if i + 4 > b.len() {
        return 0;
    }
    let (a, c, d, e) = (b[i] as u32, b[i + 1] as u32, b[i + 2] as u32, b[i + 3] as u32);
    if le { a | c << 8 | d << 16 | e << 24 } else { a << 24 | c << 16 | d << 8 | e }
}

pub fn u64_be(b: &[u8], i: usize) -> u64 {
    if i + 8 > b.len() {
        return 0;
    }
    b[i..i + 8].iter().fold(0u64, |acc, &x| acc << 8 | x as u64)
}

fn is_type(b: &[u8], i: usize, t: &[u8; 4]) -> bool {
    i + 4 <= b.len() && &b[i..i + 4] == t
}

/// Body range of the first ISO-BMFF child box of `t` within `range`.
pub fn child_box(b: &[u8], t: &[u8; 4], range: std::ops::Range<usize>) -> Option<std::ops::Range<usize>> {
    let mut off = range.start;
    while off + 8 <= range.end {
        let mut size = u32_at(b, off, false) as usize;
        let mut hdr = 8;
        if size == 1 {
            size = u64_be(b, off + 8) as usize;
            hdr = 16;
        }
        if size < hdr || off + size > range.end {
            return None;
        }
        if is_type(b, off + 4, t) {
            return Some(off + hdr..off + size);
        }
        off += size;
    }
    None
}

// MARK: - Candidates

#[derive(Clone, Copy, Debug)]
pub struct Candidate {
    pub offset: u64,
    pub length: usize,
    pub width: u32,
    pub height: u32,
}

impl Candidate {
    fn new(offset: u64, length: usize) -> Self {
        Self { offset, length, width: 0, height: 0 }
    }
    fn area(&self) -> u64 {
        self.width as u64 * self.height as u64
    }
    fn long_edge(&self) -> u32 {
        self.width.max(self.height)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PreviewKind {
    /// Smallest embedded JPEG that is still ≥ 1000 px on the long edge (grid thumbnails).
    Thumbnail,
    /// Largest embedded JPEG — usually full sensor resolution (loupe and 100% zoom).
    Full,
}

/// The bytes of the best JPEG for `kind`: embedded in a RAW, or the file itself for a JPEG.
pub fn extract(path: &Path, kind: PreviewKind) -> Option<Vec<u8>> {
    let r = Reader::open(path)?;
    let best = choose(&find_candidates(&r), kind)?;
    r.read_exact(best.offset, best.length)
}

pub fn find_candidates(r: &Reader) -> Vec<Candidate> {
    let Some(head) = r.read(0, 16) else { return vec![] };
    if head.len() < 16 {
        return vec![];
    }
    let raw = if head[0] == 0xFF && head[1] == 0xD8 {
        vec![Candidate::new(0, r.size as usize)] // a plain JPEG file
    } else if is_type(&head, 4, b"ftyp") {
        cr3_candidates(r)
    } else if &head[0..8] == b"FUJIFILM" {
        raf_candidates(r)
    } else if (head[0] == 0x49 && head[1] == 0x49) || (head[0] == 0x4D && head[1] == 0x4D) {
        tiff_candidates(r)
    } else {
        vec![]
    };
    raw.into_iter().filter_map(|c| probe(r, c)).collect()
}

pub fn choose(candidates: &[Candidate], kind: PreviewKind) -> Option<Candidate> {
    let largest = candidates.iter().copied().max_by_key(|c| (c.area(), c.length))?;
    match kind {
        PreviewKind::Full => Some(largest),
        PreviewKind::Thumbnail => candidates
            .iter()
            .copied()
            .filter(|c| c.long_edge() >= 1000)
            .min_by_key(|c| c.area())
            .or(Some(largest)),
    }
}

// MARK: Canon CR3

const CANON_PREVIEW_UUID: [u8; 16] = [
    0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88, 0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16,
];
pub const CANON_METADATA_UUID: [u8; 16] = [
    0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48,
];

/// Walks the top-level boxes of a CR3, calling `f` with each box's type, file offset and size.
/// Stops at `mdat`: every index box comes before the media data.
pub fn cr3_top_boxes(r: &Reader, mut f: impl FnMut(&[u8; 4], u64, u64, &[u8])) {
    let mut off = 0u64;
    while off + 8 <= r.size {
        let Some(h) = r.read(off, 40) else { break };
        if h.len() < 8 {
            break;
        }
        let mut size = u32_at(&h, 0, false) as u64;
        let mut hdr = 8;
        if size == 1 && h.len() >= 16 {
            size = u64_be(&h, 8);
            hdr = 16;
        } else if size == 0 {
            size = r.size - off;
        }
        if size < hdr {
            break;
        }
        let t: [u8; 4] = h[4..8].try_into().unwrap();
        if &t == b"mdat" {
            break;
        }
        f(&t, off, size, &h);
        off += size;
    }
}

fn cr3_candidates(r: &Reader) -> Vec<Candidate> {
    let mut out = vec![];
    cr3_top_boxes(r, |t, off, size, h| {
        if t == b"moov" {
            if let Some(moov) = r.read(off, size.min(8 << 20) as usize) {
                if let Some(full) = cr3_first_track_sample(&moov) {
                    out.push(full);
                }
            }
        } else if t == b"uuid" && h.len() >= 24 && h[8..24] == CANON_PREVIEW_UUID {
            // uuid header(8) + uuid(16) + 8 bytes, then the PRVW box:
            // PRVW hdr(8) | 4 unk | 2 unk | 2 width | 2 height | 2 unk | 4 length | JPEG…
            let prvw = off + 32;
            if let Some(b) = r.read_exact(prvw, 24) {
                if is_type(&b, 4, b"PRVW") {
                    let mut c = Candidate::new(prvw + 24, u32_at(&b, 20, false) as usize);
                    c.width = u16_at(&b, 14, false);
                    c.height = u16_at(&b, 16, false);
                    out.push(c);
                }
            }
        }
    });
    out
}

/// The first trak in a CR3 holds exactly one sample: the full-resolution JPEG.
fn cr3_first_track_sample(m: &[u8]) -> Option<Candidate> {
    let trak = child_box(m, b"trak", 8..m.len())?;
    let mdia = child_box(m, b"mdia", trak)?;
    let minf = child_box(m, b"minf", mdia)?;
    let stbl = child_box(m, b"stbl", minf)?;
    let stsz = child_box(m, b"stsz", stbl.clone())?;
    // stsz: version/flags(4) sample_size(4) count(4) [entries]
    let mut length = u32_at(m, stsz.start + 4, false) as usize;
    if length == 0 {
        length = u32_at(m, stsz.start + 12, false) as usize;
    }
    let offset = if let Some(co64) = child_box(m, b"co64", stbl.clone()) {
        u64_be(m, co64.start + 8)
    } else if let Some(stco) = child_box(m, b"stco", stbl) {
        u32_at(m, stco.start + 8, false) as u64
    } else {
        return None;
    };
    (length > 0).then(|| Candidate::new(offset, length))
}

// MARK: Fujifilm RAF

fn raf_candidates(r: &Reader) -> Vec<Candidate> {
    let Some(h) = r.read_exact(84, 8) else { return vec![] };
    let (off, len) = (u32_at(&h, 0, false) as u64, u32_at(&h, 4, false) as usize);
    if len > 0 { vec![Candidate::new(off, len)] } else { vec![] }
}

// MARK: TIFF-based RAW

fn tiff_candidates(r: &Reader) -> Vec<Candidate> {
    let Some(h) = r.read_exact(0, 8) else { return vec![] };
    let le = h[0] == 0x49;
    let mut queue = vec![u32_at(&h, 4, le) as u64];
    let mut visited = std::collections::HashSet::new();
    let mut out = vec![];

    while let Some(ifd) = queue.pop() {
        if visited.len() >= 48 || ifd == 0 || ifd >= r.size || !visited.insert(ifd) {
            continue;
        }
        let Some(cb) = r.read_exact(ifd, 2) else { continue };
        let n = u16_at(&cb, 0, le) as usize;
        if n == 0 || n >= 1000 {
            continue;
        }
        let Some(e) = r.read(ifd + 2, n * 12 + 4) else { continue };

        let (mut compression, mut strip_off, mut strip_len, mut strip_count, mut jpg_off, mut jpg_len) = (0, 0, 0, 0, 0, 0);
        for i in 0..n {
            let p = i * 12;
            if p + 12 > e.len() {
                break;
            }
            let tag = u16_at(&e, p, le);
            let typ = u16_at(&e, p + 2, le);
            let count = u32_at(&e, p + 4, le);
            let scalar = if typ == 3 { u16_at(&e, p + 8, le) } else { u32_at(&e, p + 8, le) };
            match tag {
                0x0103 => compression = scalar,
                0x0111 => {
                    strip_off = scalar;
                    strip_count = count;
                }
                0x0117 => strip_len = scalar,
                0x0201 => jpg_off = scalar,
                0x0202 => jpg_len = scalar,
                0x002E if typ == 7 => out.push(Candidate::new(scalar as u64, count as usize)), // Panasonic RW2
                0x8769 => queue.push(scalar as u64), // EXIF IFD
                0x014A => {
                    // SubIFDs
                    if count == 1 {
                        queue.push(scalar as u64);
                    } else if count < 64 {
                        if let Some(arr) = r.read_exact(scalar as u64, count as usize * 4) {
                            for k in 0..count as usize {
                                queue.push(u32_at(&arr, k * 4, le) as u64);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        if jpg_off > 0 && jpg_len > 0 {
            out.push(Candidate::new(jpg_off as u64, jpg_len as usize));
        }
        if [6, 7, 34892].contains(&compression) && strip_count == 1 && strip_off > 0 && strip_len > 0 {
            out.push(Candidate::new(strip_off as u64, strip_len as usize));
        }
        let next = u32_at(&e, n * 12, le) as u64;
        if next > 0 {
            queue.insert(0, next);
        }
    }
    out
}

// MARK: JPEG validation

/// Confirms a candidate is a displayable (baseline/progressive) JPEG and reads its size.
/// Lossless JPEG (SOF3) is how CR2/DNG store raw sensor data, so it is rejected.
fn probe(r: &Reader, c: Candidate) -> Option<Candidate> {
    if c.length <= 512 || c.length > MAX_JPEG_BYTES || c.offset + c.length as u64 > r.size {
        return None;
    }
    if r.read_exact(c.offset, 2)? != [0xFF, 0xD8] {
        return None;
    }
    let mut p = c.offset + 2;
    let end = c.offset + c.length as u64;
    for _ in 0..96 {
        if p + 4 > end {
            return None;
        }
        let m = r.read(p, 10)?;
        if m.len() < 4 || m[0] != 0xFF {
            return None;
        }
        match m[1] {
            0xFF => p += 1,
            0xC0 | 0xC1 | 0xC2 => {
                if m.len() < 9 {
                    return None;
                }
                let mut out = c;
                out.height = u16_at(&m, 5, false);
                out.width = u16_at(&m, 7, false);
                return (out.area() > 0).then_some(out);
            }
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF | 0xDA | 0xD9 => return None,
            _ => p += 2 + u16_at(&m, 2, false) as u64,
        }
    }
    None
}
