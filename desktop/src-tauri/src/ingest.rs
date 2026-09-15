//! Ingest: copies photos from a memory card (or any folder, recursively) into template-named
//! folders. RAW+JPEG pairs share one sequence number and numbering follows capture time.
//! Never overwrites, verifies each copy's size, and can eject the card when done.
//! Port of `IngestEngine.swift`.

use crate::{achievements, exif, folder};
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
    let mut roots: Vec<PathBuf> = vec![];
    #[cfg(target_os = "macos")]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInfo {
    pub camera: String,
    /// A RAW+JPG pair counts once.
    pub photos: usize,
    pub bytes: u64,
}

#[tauri::command]
pub async fn inspect_source(path: String) -> CardInfo {
    crate::jobs::blocking(move || {
        let root = Path::new(&path);
        let dcim = root.join("DCIM");
        let mut files = vec![];
        walk(if dcim.is_dir() { &dcim } else { root }, &mut files);
        let mut bases = std::collections::HashSet::new();
        let mut bytes = 0;
        for f in &files {
            bases.insert((f.parent().map(Path::to_path_buf), f.file_stem().map(|s| s.to_string_lossy().to_lowercase())));
            bytes += std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        }
        let sample = files.iter().find(|f| is_photo(f) == Some(true)).or(files.first());
        CardInfo { camera: sample.map(|s| exif::read(s).camera).unwrap_or_default(), photos: bases.len(), bytes }
    })
    .await
}

/// Free space on the drive holding `path`, in bytes.
#[tauri::command]
pub fn free_space(path: String) -> Option<u64> {
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
    pub unlocked: Vec<achievements::Badge>,
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
        let summary = run(&app, &options);
        RUNNING.store(false, Ordering::SeqCst);
        let _ = app.emit("ingest-done", summary);
    });
    Ok(())
}

fn run(app: &AppHandle, o: &Options) -> Summary {
    use rayon::prelude::*;
    let mut s = Summary::default();
    let source = Path::new(&o.source);
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
    }
    let mut groups: HashMap<(PathBuf, String), Group> = HashMap::new();
    for f in files {
        let base = f.file_stem().map(|b| b.to_string_lossy().to_string()).unwrap_or_default();
        let key = (f.parent().map(Path::to_path_buf).unwrap_or_default(), base.to_lowercase());
        let is_raw = is_photo(&f) == Some(true);
        let g = groups.entry(key).or_insert_with(|| Group { base, files: vec![], primary: f.clone() });
        if is_raw {
            g.primary = f.clone();
        }
        g.files.push(f);
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
    let _ = app.emit("ingest-progress", progress.clone());
    let mut last_emit = std::time::Instant::now();
    let mut copied_photos: HashMap<String, u64> = HashMap::new();
    let mut counted = std::collections::HashSet::new();

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
            std::fs::copy(src, &target).map_err(|e| e.to_string())?;
            if std::fs::metadata(&target).map(|m| m.len()).ok() != Some(*size) {
                return Err("size mismatch after copy".into());
            }
            s.copied += 1;
            s.bytes += size;
            if counted.insert(*group_index) {
                *copied_photos.entry(folder.to_string_lossy().to_string()).or_default() += 1;
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
            let _ = app.emit("ingest-progress", progress.clone());
        }
    }

    s.unlocked = achievements::record_ingest(&copied_photos);
    if o.eject && !s.cancelled && s.errors.is_empty() {
        s.ejected = eject(source);
    }
    s
}

/// Ejects a card, if `path` is the root of a removable volume.
fn eject(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
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
        };
        assert_eq!(
            names(&o, "MCD_0001", "2026-08-22T09:45:27.07", "Canon EOS R3", 7),
            ("2026-08-22_Fairborn-vs-Tecumseh".to_string(), "Fairborn-vs-Tecumseh_0007".to_string())
        );
        let no_job = Options { job: String::new(), rename_pattern: None, ..o };
        assert_eq!(names(&no_job, "MCD_0001", "2026-08-22T09:45:27", "", 1), ("2026-08-22".to_string(), "MCD_0001".to_string()));
    }
}
