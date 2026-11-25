//! Ingest: copies photos from a memory card (or any folder, recursively) into template-named
//! folders. RAW+JPEG pairs share one sequence number and numbering follows capture time.
//! Never overwrites, verifies each copy's size, and can eject the card when done.
//! Port of `IngestEngine.swift`.

use crate::{exif, fileops, folder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

static CANCEL: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

fn is_photo(p: &Path) -> Option<bool> {
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    if folder::RAW_EXTS.contains(&ext.as_str()) {
        Some(true)
    } else {
        folder::IMAGE_EXTS.contains(&ext.as_str()).then_some(false)
    }
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        match e.file_type() {
            Ok(t) if t.is_dir() => walk(&p, out),
            Ok(t) if t.is_file() && is_photo(&p).is_some() => out.push(p),
            _ => {}
        }
    }
}

// MARK: - Cards

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub path: String,
    pub name: String,
}

/// Mounted volumes that look like camera cards (they contain a DCIM folder).
#[tauri::command]
pub fn memory_cards() -> Vec<Card> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    {
        return crate::mac_store::granted_roots().into_iter().filter_map(|path| {
            let root = Path::new(&path);
            let _access = crate::data::access(root).ok()?;
            root.join("DCIM").is_dir().then(|| Card { name: root.file_name().unwrap_or_default().to_string_lossy().into_owned(), path: path.clone() })
        }).collect();
    }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    {
    // iPad has no mounted volumes to scan: cards come in through the Files folder picker.
    #[cfg_attr(target_os = "ios", allow(unused_mut))]
    let mut roots: Vec<PathBuf> = vec![];
    #[cfg(all(target_os = "macos", not(feature = "mac-app-store")))]
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        roots.extend(entries.flatten().map(|e| e.path()));
    }
    #[cfg(target_os = "windows")]
    roots.extend((b'D'..=b'Z').map(|l| PathBuf::from(format!("{}:\\", l as char))));
    #[cfg(target_os = "linux")]
    for base in ["/media", "/run/media"] {
        if let Ok(users) = std::fs::read_dir(base) {
            for u in users.flatten() {
                if let Ok(vols) = std::fs::read_dir(u.path()) {
                    roots.extend(vols.flatten().map(|e| e.path()));
                }
            }
        }
    }
    roots
        .into_iter()
        .filter(|r| r.join("DCIM").is_dir())
        .map(|r| {
            let name = r.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| r.to_string_lossy().trim_end_matches('\\').to_string());
            Card { path: r.to_string_lossy().to_string(), name }
        })
        .collect()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInfo {
    pub camera: String,
    /// A RAW+JPG pair counts once.
    pub photos: usize,
    pub bytes: u64,
    /// Photos protected on the camera (a pair counts once).
    pub locked: usize,
    /// Their size, for the free-space check when only they are ingested.
    pub locked_bytes: u64,
}

/// A photo's files on the card: pairs share a folder and a stem.
fn group_key(f: &Path) -> (PathBuf, String) {
    (f.parent().map(Path::to_path_buf).unwrap_or_default(), f.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default())
}

#[tauri::command]
pub async fn inspect_source(path: String) -> CardInfo {
    crate::jobs::blocking(move || {
        let root = Path::new(&path);
        let _access = crate::data::access(root).ok();
        let dcim = root.join("DCIM");
        let mut files = vec![];
        walk(if dcim.is_dir() { &dcim } else { root }, &mut files);
        let mut groups: HashMap<(PathBuf, String), (bool, u64)> = HashMap::new();
        let mut bytes = 0;
        for f in &files {
            let size = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
            bytes += size;
            let g = groups.entry(group_key(f)).or_default();
            g.0 |= fileops::is_locked(f);
            g.1 += size;
        }
        let locked = groups.values().filter(|g| g.0);
        let sample = files.iter().find(|f| is_photo(f) == Some(true)).or(files.first());
        CardInfo {
            camera: sample.map(|s| exif::read(s).camera).unwrap_or_default(),
            photos: groups.len(),
            bytes,
            locked: locked.clone().count(),
            locked_bytes: locked.map(|g| g.1).sum(),
        }
    })
    .await
}

/// Free space on the drive holding `path`, in bytes.
#[tauri::command]
pub fn free_space(path: String) -> Option<u64> {
    let _access = crate::data::access(Path::new(&path)).ok()?;
    fs2::available_space(Path::new(&path)).ok()
}

// MARK: - Naming

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub source: String,
    pub destination: String,
    pub job: String,
    pub folder_pattern: String,
    /// `None` keeps the camera's file names.
    pub rename_pattern: Option<String>,
    pub first_seq: u32,
    pub skip_existing: bool,
    pub eject: bool,
    /// Only the photos protected on the camera.
    #[serde(default)]
    pub locked_only: bool,
}

/// Expands `{job} {date} {year} {month} {day} {time} {seq} {original} {camera}`.
pub fn names(o: &Options, original: &str, captured: &str, camera: &str, seq: u32) -> (String, String) {
    let d: Vec<&str> = captured.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).collect();
    let part = |i: usize, fallback: &str| d.get(i).copied().unwrap_or(fallback).to_string();
    let job = o.job.trim().replace(['/', '\\'], "-");
    let tokens = [
        ("{job}", if job.is_empty() { "Untitled".to_string() } else { job.clone() }),
        ("{date}", format!("{}-{}-{}", part(0, "0000"), part(1, "00"), part(2, "00"))),
        ("{year}", part(0, "0000")),
        ("{month}", part(1, "00")),
        ("{day}", part(2, "00")),
        ("{time}", format!("{}{}{}", part(3, "00"), part(4, "00"), part(5, "00"))),
        ("{seq}", format!("{seq:04}")),
        ("{original}", original.to_string()),
        ("{camera}", camera.replace(' ', "")),
    ];
    let expand = |pattern: &str| {
        let mut s = pattern.to_string();
        for (k, v) in &tokens {
            s = s.replace(k, v);
        }
        s.replace([':', '/', '\\'], "-").trim().to_string()
    };
    let mut folder = expand(&o.folder_pattern);
    // A template like "{date}_{job}" shouldn't leave a dangling "_Untitled" when there's no job.
    if job.is_empty() {
        folder = folder.replace("_Untitled", "").replace("-Untitled", "");
    }
    let base = o.rename_pattern.as_deref().map(expand).filter(|s| !s.is_empty()).unwrap_or_else(|| original.to_string());
    (if folder.is_empty() { "Ingest".into() } else { folder }, base)
}

// MARK: - Running

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current_file: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub copied: usize,
    pub skipped: usize,
    pub bytes: u64,
    pub errors: Vec<String>,
    pub first_folder: Option<String>,
    pub cancelled: bool,
    pub ejected: bool,
}

#[tauri::command]
pub fn cancel_ingest() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Starts an ingest in the background. Progress arrives as `ingest-progress` events and the
/// result as `ingest-done`.
#[tauri::command]
pub fn start_ingest(app: AppHandle, options: Options) -> Result<(), String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("An ingest is already running.".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let summary = run(&options, |p| {
            crate::native::progress(&app, p.bytes_done, p.bytes_total);
            let _ = app.emit("ingest-progress", p.clone());
        });
        RUNNING.store(false, Ordering::SeqCst);
        let note = (!summary.cancelled).then(|| ingest_note(&summary));
        let _ = app.emit("ingest-done", summary);
        match note {
            Some(note) => crate::native::finished(&app, "Ingest finished", &note),
            None => crate::native::progress_done(&app),
        }
    });
    Ok(())
}

/// "Ingested 1,234 photos, 12 already there, 1 error", for the notification.
fn ingest_note(s: &Summary) -> String {
    let mut parts = vec![format!("Ingested {}", crate::native::count(s.copied, "photo"))];
    if s.skipped > 0 {
        parts.push(format!("{} already there", s.skipped));
    }
    if !s.errors.is_empty() {
        parts.push(crate::native::count(s.errors.len(), "error"));
    }
    parts.join(", ")
}

pub fn run(o: &Options, mut emit: impl FnMut(&Progress)) -> Summary {
    use rayon::prelude::*;
    let mut s = Summary::default();
    let source = Path::new(&o.source);
    let source_access = crate::data::access(source).ok();
    let _destination_access = crate::data::access(Path::new(&o.destination)).ok();
    let mut files = vec![];
    walk(source, &mut files);
    if files.is_empty() {
        s.errors.push(format!("No photos found in {}", source.display()));
        return s;
    }

    // Group RAW+JPEG pairs, then order by capture time.
    struct Group {
        base: String,
        files: Vec<PathBuf>,
        primary: PathBuf,
        locked: bool,
    }
    let mut groups: HashMap<(PathBuf, String), Group> = HashMap::new();
    for f in files {
        let base = f.file_stem().map(|b| b.to_string_lossy().to_string()).unwrap_or_default();
        let is_raw = is_photo(&f) == Some(true);
        let locked = fileops::is_locked(&f);
        let g = groups.entry(group_key(&f)).or_insert_with(|| Group { base, files: vec![], primary: f.clone(), locked: false });
        if is_raw {
            g.primary = f.clone();
        }
        g.locked |= locked;
        g.files.push(f);
    }
    if o.locked_only {
        groups.retain(|_, g| g.locked);
        if groups.is_empty() {
            s.errors.push(format!("No photos are locked on the camera in {}", source.display()));
            return s;
        }
    }
    let mut groups: Vec<(Group, exif::Meta)> = groups.into_values().par_bridge().map(|g| {
        let m = exif::read(&g.primary);
        (g, m)
    }).collect();
    groups.sort_by(|a, b| (a.1.captured.as_deref(), &a.0.base).cmp(&(b.1.captured.as_deref(), &b.0.base)));

    let plan: Vec<(PathBuf, usize, u64)> = groups
        .iter()
        .enumerate()
        .flat_map(|(i, (g, _))| g.files.iter().map(move |f| (f.clone(), i, std::fs::metadata(f).map(|m| m.len()).unwrap_or(0))))
        .collect();
    let bytes_total: u64 = plan.iter().map(|p| p.2).sum();
    let mut progress = Progress { files_done: 0, files_total: plan.len(), bytes_done: 0, bytes_total, current_file: String::new() };
    emit(&progress);
    let mut last_emit = std::time::Instant::now();
    // Photos locked on the camera arrive tagged: their new sidecars, with the RAW's extension.
    let mut tag: HashMap<PathBuf, String> = HashMap::new();

    for (k, (src, group_index, size)) in plan.iter().enumerate() {
        if CANCEL.load(Ordering::SeqCst) {
            s.cancelled = true;
            break;
        }
        let (g, meta) = &groups[*group_index];
        let captured = meta.captured.clone().unwrap_or_default();
        let (folder_name, base) = names(o, &g.base, &captured, &meta.camera, o.first_seq + *group_index as u32);
        let folder = Path::new(&o.destination).join(&folder_name);
        let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        let target = folder.join(format!("{base}.{ext}"));
        let file_name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        s.first_folder.get_or_insert_with(|| folder.to_string_lossy().to_string());

        let result: Result<(), String> = (|| {
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            if target.exists() {
                let existing = std::fs::metadata(&target).map(|m| m.len()).ok();
                if o.skip_existing && existing == Some(*size) {
                    s.skipped += 1;
                    return Ok(());
                }
                return Err(format!("{} already exists at the destination", target.file_name().unwrap().to_string_lossy()));
            }
            let copied = fileops::copy_new(src, &target).map_err(|e| e.to_string())?;
            s.copied += 1;
            s.bytes += copied;
            if g.locked {
                let ext = g.primary.extension().map(|e| e.to_string_lossy().to_ascii_uppercase()).unwrap_or_default();
                tag.insert(folder.join(format!("{base}.xmp")), ext);
            }
            Ok(())
        })();
        if let Err(e) = result {
            s.errors.push(format!("{file_name}: {e}"));
        }

        progress.files_done = k + 1;
        progress.bytes_done += size;
        progress.current_file = file_name;
        if last_emit.elapsed().as_millis() > 100 || k + 1 == plan.len() {
            last_emit = std::time::Instant::now();
            emit(&progress);
        }
    }

    let tagged = crate::xmp::Culling { tagged: true, locked: true, ..Default::default() };
    for (sidecar, ext) in &tag {
        if let Err(e) = crate::xmp::update(sidecar, ext, Some(&tagged), None) {
            s.errors.push(format!("{}: couldn’t tag it ({e})", sidecar.file_name().unwrap_or_default().to_string_lossy()));
        }
    }

    #[allow(dropping_copy_types)] // Non-store leases are a no-op; store leases must end before eject.
    drop(source_access);
    if o.eject && !s.cancelled && s.errors.is_empty() {
        s.ejected = eject(source);
    }
    s
}

/// Ejects a card, if `path` is the root of a removable volume.
fn eject(path: &Path) -> bool {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::mac_store::eject(path); }
    #[cfg(all(target_os = "macos", not(feature = "mac-app-store")))]
    {
        if path.parent() != Some(Path::new("/Volumes")) {
            return false;
        }
        return std::process::Command::new("diskutil").arg("eject").arg(path).status().is_ok_and(|s| s.success());
    }
    #[cfg(target_os = "windows")]
    {
        let root = path.to_string_lossy();
        if root.len() > 3 {
            return false;
        }
        let drive = root.trim_end_matches('\\');
        let script = format!("(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{drive}').InvokeVerb('Eject')");
        return std::process::Command::new("powershell").args(["-NoProfile", "-Command", &script]).status().is_ok_and(|s| s.success());
    }
    #[allow(unreachable_code)]
    {
        let _ = path;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_templates() {
        let o = Options {
            source: String::new(),
            destination: String::new(),
            job: "Fairborn-vs-Tecumseh".into(),
            folder_pattern: "{date}_{job}".into(),
            rename_pattern: Some("{job}_{seq}".into()),
            first_seq: 1,
            skip_existing: true,
            eject: false,
            locked_only: false,
        };
        assert_eq!(
            names(&o, "MCD_0001", "2026-08-22T09:45:27.07", "Canon EOS R3", 7),
            ("2026-08-22_Fairborn-vs-Tecumseh".to_string(), "Fairborn-vs-Tecumseh_0007".to_string())
        );
        let no_job = Options { job: String::new(), rename_pattern: None, ..o };
        assert_eq!(names(&no_job, "MCD_0001", "2026-08-22T09:45:27", "", 1), ("2026-08-22".to_string(), "MCD_0001".to_string()));
    }

    #[test]
    fn locked_photos_arrive_tagged_and_can_be_ingested_alone() {
        let root = std::env::temp_dir().join(format!("deadlyne-ingest-locked-{}", std::process::id()));
        let (card, dest) = (root.join("card/DCIM/100CANON"), root.join("dest"));
        std::fs::create_dir_all(&card).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        for f in ["A.CR3", "A.JPG", "B.JPG"] {
            std::fs::write(card.join(f), f).unwrap();
        }
        // The camera locked A (both halves of the pair).
        for f in ["A.CR3", "A.JPG"] {
            let mut p = std::fs::metadata(card.join(f)).unwrap().permissions();
            p.set_readonly(true);
            std::fs::set_permissions(card.join(f), p).unwrap();
        }
        let o = Options {
            source: root.join("card").to_string_lossy().into(),
            destination: dest.to_string_lossy().into(),
            job: "Locked".into(),
            folder_pattern: "{job}".into(),
            rename_pattern: None,
            first_seq: 1,
            skip_existing: true,
            eject: false,
            locked_only: true,
        };
        let s = run(&o, |_| {});
        assert!(s.errors.is_empty(), "{:?}", s.errors);
        assert_eq!(s.copied, 2);
        let out = dest.join("Locked");
        assert!(out.join("A.CR3").exists() && out.join("A.JPG").exists() && !out.join("B.JPG").exists());
        let sidecar = std::fs::read_to_string(out.join("A.xmp")).unwrap();
        assert_eq!(crate::xmp::explicit_tag(&sidecar), Some(true));
        assert!(sidecar.contains("photoshop:SidecarForExtension=\"CR3\""));
        // Everything else comes along untagged when the whole card is ingested.
        let all = run(&Options { locked_only: false, ..o }, |_| {});
        assert_eq!((all.copied, all.skipped), (1, 2));
        assert!(!out.join("B.xmp").exists());
        for dir in [&card, &out] {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let mut p = e.metadata().unwrap().permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                p.set_readonly(false);
                let _ = std::fs::set_permissions(e.path(), p);
            }
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A full ingest from a fake card: `DEADLYNE_CARD=/card DEADLYNE_DEST=/dest cargo test --release real_ingest -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_ingest() {
        let (Ok(card), Ok(dest)) = (std::env::var("DEADLYNE_CARD"), std::env::var("DEADLYNE_DEST")) else { return };
        let o = Options {
            source: card,
            destination: dest,
            job: "Fairborn-vs-Tecumseh".into(),
            folder_pattern: "{date}_{job}".into(),
            rename_pattern: Some("{job}_{seq}".into()),
            first_seq: 1,
            skip_existing: true,
            eject: false,
            locked_only: false,
        };
        let mut events = 0;
        let s = run(&o, |_| events += 1);
        println!("first pass: copied {} skipped {} bytes {} errors {:?} folder {:?} events {events}", s.copied, s.skipped, s.bytes, s.errors, s.first_folder);
        let again = run(&o, |_| {});
        println!("second pass: copied {} skipped {} errors {:?}", again.copied, again.skipped, again.errors);
        assert_eq!(again.copied, 0);
        assert_eq!(again.skipped, s.copied);
    }
}
