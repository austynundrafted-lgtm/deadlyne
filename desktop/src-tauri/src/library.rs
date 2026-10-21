//! Organizing shoots: review progress, folder stats, documents beside the photos, and the few
//! folder operations the sidebar offers.
//!
//! **Review progress.** A photo counts as viewed once the interface says so (it sat on screen for
//! a second, or was opened in the loupe). Each folder keeps its own record in
//! `<data>/Deadlyne/Viewing/<md5 of the path>.json`: the viewed photos' keys and the last one
//! reviewed. The key is the lowercase file stem, the same thing that pairs a RAW with its JPG,
//! so sorting, filtering or re-reading the folder never loses it. Progress is always viewed ∩
//! photos on disk now, so deleted photos drop out and new ones count as unviewed. A parent's
//! progress adds up each folder below it once (every photo lives in exactly one folder).
//!
//! **Documents** are the shoot's other files (briefs, shot lists, rosters as PDF…). Copies are
//! written into the shoot folder itself, so they travel with it; nothing is ever overwritten.
//! Linked documents stay where they are and are only remembered by the interface.

use crate::folder::{IMAGE_EXTS, RAW_EXTS};
use crate::{fileops, jobs, xmp};
use md5::{Digest, Md5};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// Files shown in a folder's Documents. Photos, sidecars and app bundles never are.
pub const DOC_EXTS: [&str; 20] = [
    "pdf", "doc", "docx", "rtf", "txt", "md", "csv", "tsv", "tab", "xls", "xlsx", "numbers", "pages", "key", "ppt", "pptx",
    "odt", "ods", "odp", "rtfd",
];

/// How deep progress and photo counts look below a folder.
const MAX_DEPTH: usize = 4;

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn is_photo(p: &Path) -> bool {
    let ext = ext_of(p);
    RAW_EXTS.contains(&ext.as_str()) || IMAGE_EXTS.contains(&ext.as_str())
}

fn is_document(p: &Path) -> bool {
    DOC_EXTS.contains(&ext_of(p).as_str())
}

/// Folders worth listing: not hidden, not a package like `Photos Library.photoslibrary`.
fn is_listable_dir(name: &str, path: &Path) -> bool {
    !name.starts_with('.') && path.extension().is_none_or(|e| !matches!(e.to_str(), Some("app" | "photoslibrary" | "lrdata" | "fcpbundle" | "rtfd")))
}

/// The key a photo is remembered by: its file stem, lowercased (`MCD_0001.CR3` → `mcd_0001`).
fn photo_key(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn millis(t: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
}

fn normalize(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() { path.to_string() } else { trimmed.to_string() }
}

// MARK: - Viewing records

#[derive(Serialize, Deserialize, Default, Clone)]
struct Record {
    path: String,
    viewed: Vec<String>,
    last: Option<String>,
    updated: i64,
}

struct Entry {
    viewed: HashSet<String>,
    last: Option<String>,
}

static CACHE: Mutex<Option<HashMap<String, Entry>>> = Mutex::new(None);

fn viewing_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Deadlyne").join("Viewing")
}

fn record_path(folder: &str) -> PathBuf {
    let digest = Md5::digest(folder.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    viewing_dir().join(format!("{hex}.json"))
}

fn read_record(folder: &str) -> Entry {
    let rec: Record = std::fs::read(record_path(folder)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    Entry { viewed: rec.viewed.into_iter().collect(), last: rec.last }
}

fn write_record(folder: &str, e: &Entry) -> Result<(), String> {
    let p = record_path(folder);
    if e.viewed.is_empty() && e.last.is_none() {
        let _ = std::fs::remove_file(&p);
        return Ok(());
    }
    std::fs::create_dir_all(viewing_dir()).map_err(|e| e.to_string())?;
    let mut viewed: Vec<String> = e.viewed.iter().cloned().collect();
    viewed.sort_unstable();
    let rec = Record { path: folder.to_string(), viewed, last: e.last.clone(), updated: chrono::Local::now().timestamp_millis() };
    let bytes = serde_json::to_vec(&rec).map_err(|e| e.to_string())?;
    xmp::write_atomic(&p, &bytes).map_err(|e| e.to_string())
}

/// Runs `f` on the folder's cached record, loading it from disk the first time.
fn with_entry<T>(folder: &str, f: impl FnOnce(&mut Entry) -> T) -> T {
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    let entry = cache.entry(folder.to_string()).or_insert_with(|| read_record(folder));
    f(entry)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewingState {
    pub viewed: Vec<String>,
    pub last: Option<String>,
}

#[tauri::command]
pub async fn viewing_load(folder: String) -> ViewingState {
    let folder = normalize(&folder);
    jobs::blocking(move || with_entry(&folder, |e| ViewingState { viewed: e.viewed.iter().cloned().collect(), last: e.last.clone() })).await
}

/// Adds photos to the folder's viewed set and moves the review position to `last`.
#[tauri::command]
pub async fn viewing_mark(folder: String, keys: Vec<String>, last: Option<String>) -> Result<(), String> {
    let folder = normalize(&folder);
    jobs::blocking(move || {
        with_entry(&folder, |e| {
            let before = e.viewed.len();
            e.viewed.extend(keys.into_iter().map(|k| k.to_lowercase()));
            let moved = last.is_some() && e.last != last;
            if moved {
                e.last = last.map(|k| k.to_lowercase());
            }
            if e.viewed.len() != before || moved { write_record(&folder, e) } else { Ok(()) }
        })
    })
    .await
}

/// Forgets what was viewed in a folder (and, with `recursive`, every folder below it).
#[tauri::command]
pub async fn viewing_reset(folder: String, recursive: bool) -> Result<(), String> {
    let folder = normalize(&folder);
    jobs::blocking(move || {
        let mut targets = vec![folder.clone()];
        if recursive {
            targets.extend(recorded_under(&folder).into_iter().map(|(p, _)| p));
        }
        let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let cache = guard.get_or_insert_with(HashMap::new);
        for t in targets {
            cache.remove(&t);
            let _ = std::fs::remove_file(record_path(&t));
        }
        Ok(())
    })
    .await
}

/// Every saved record for a folder strictly below `root`, with its file.
fn recorded_under(root: &str) -> Vec<(String, PathBuf)> {
    let Ok(dir) = std::fs::read_dir(viewing_dir()) else { return vec![] };
    let prefix = Path::new(root);
    dir.flatten()
        .filter_map(|e| {
            let rec: Record = serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok()?;
            let p = Path::new(&rec.path);
            (p != prefix && p.starts_with(prefix)).then(|| (rec.path, e.path()))
        })
        .collect()
}

/// Photos moved to another folder keep their viewed status there.
#[tauri::command]
pub async fn viewing_transfer(from: String, to: String, keys: Vec<String>) -> Result<(), String> {
    let (from, to) = (normalize(&from), normalize(&to));
    jobs::blocking(move || {
        let keys: Vec<String> = keys.into_iter().map(|k| k.to_lowercase()).collect();
        let moving: Vec<String> = with_entry(&from, |e| keys.iter().filter(|k| e.viewed.contains(*k)).cloned().collect());
        if moving.is_empty() {
            return Ok(());
        }
        with_entry(&to, |e| {
            e.viewed.extend(moving.iter().cloned());
            write_record(&to, e)
        })?;
        with_entry(&from, |e| {
            for k in &moving {
                e.viewed.remove(k);
            }
            write_record(&from, e)
        })
    })
    .await
}

/// A folder was renamed or found somewhere else: its progress (and its subfolders') follows it.
pub fn relocate_records(from: &str, to: &str) {
    let (from, to) = (normalize(from), normalize(to));
    let mut moves = vec![(from.clone(), to.clone())];
    for (p, _) in recorded_under(&from) {
        if let Ok(rest) = Path::new(&p).strip_prefix(&from) {
            moves.push((p.clone(), Path::new(&to).join(rest).to_string_lossy().to_string()));
        }
    }
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    for (old, new) in moves {
        let entry = cache.remove(&old).unwrap_or_else(|| read_record(&old));
        if entry.viewed.is_empty() && entry.last.is_none() {
            continue;
        }
        // Keep anything already recorded at the new place too.
        let mut merged = cache.remove(&new).unwrap_or_else(|| read_record(&new));
        merged.viewed.extend(entry.viewed);
        if merged.last.is_none() {
            merged.last = entry.last;
        }
        if write_record(&new, &merged).is_ok() {
            let _ = std::fs::remove_file(record_path(&old));
        }
        cache.insert(new, merged);
    }
}

#[tauri::command]
pub async fn viewing_relocate(from: String, to: String) {
    jobs::blocking(move || relocate_records(&from, &to)).await
}

// MARK: - Folder stats

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    pub path: String,
    pub exists: bool,
    /// Why the folder couldn't be read (permissions, a drive that's gone…).
    pub error: Option<String>,
    /// Photos directly in this folder, and how many of them were viewed.
    pub photos: u64,
    pub viewed: u64,
    /// The same, counting every folder below too (each photo once).
    pub total_photos: u64,
    pub total_viewed: u64,
    pub subfolders: u64,
    pub documents: u64,
    pub modified: Option<i64>,
}

struct Tally {
    photos: u64,
    viewed: u64,
}

/// Counts one folder's photos and how many were viewed, then its subfolders down to MAX_DEPTH.
fn walk(dir: &Path, depth: usize, top: &mut FolderStats, total: &mut Tally) -> std::io::Result<()> {
    let mut stems = HashSet::new();
    let mut children = vec![];
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if is_listable_dir(&name, &path) {
                children.push(path);
            }
        } else if kind.is_file() && !name.starts_with('.') {
            if is_photo(&path) {
                stems.insert(photo_key(&path));
            } else if depth == 0 && is_document(&path) {
                top.documents += 1;
            }
        }
    }
    let folder = normalize(&dir.to_string_lossy());
    let viewed = if stems.is_empty() { 0 } else { with_entry(&folder, |e| stems.iter().filter(|k| e.viewed.contains(*k)).count() as u64) };
    if depth == 0 {
        top.photos = stems.len() as u64;
        top.viewed = viewed;
        top.subfolders = children.len() as u64;
    }
    total.photos += stems.len() as u64;
    total.viewed += viewed;
    if depth < MAX_DEPTH {
        for child in children {
            // An unreadable subfolder shouldn't hide the rest of the shoot.
            let _ = walk(&child, depth + 1, top, total);
        }
    }
    Ok(())
}

pub fn stats(path: &str) -> FolderStats {
    let path = normalize(path);
    let dir = Path::new(&path);
    let mut s = FolderStats { path: path.clone(), ..Default::default() };
    match std::fs::metadata(dir) {
        Ok(m) if m.is_dir() => {
            s.exists = true;
            s.modified = millis(m.modified());
        }
        Ok(_) => {
            s.error = Some("This is a file, not a folder.".into());
            return s;
        }
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                s.exists = true;
                s.error = Some(e.to_string());
            }
            return s;
        }
    }
    let mut total = Tally { photos: 0, viewed: 0 };
    if let Err(e) = walk(dir, 0, &mut s, &mut total) {
        s.error = Some(if e.kind() == std::io::ErrorKind::PermissionDenied {
            "Deadlyne isn’t allowed to read this folder.".into()
        } else {
            e.to_string()
        });
    }
    s.total_photos = total.photos;
    s.total_viewed = total.viewed;
    s
}

/// Photo counts and review progress for each folder, read in parallel.
#[tauri::command]
pub async fn folder_stats(paths: Vec<String>) -> Vec<FolderStats> {
    jobs::blocking(move || paths.par_iter().map(|p| stats(p)).collect()).await
}

// MARK: - Folder contents

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocEntry {
    pub path: String,
    pub name: String,
    /// Lowercase extension, "pdf".
    pub ext: String,
    pub size: u64,
    pub modified: Option<i64>,
    pub exists: bool,
}

fn doc_entry(path: &Path) -> DocEntry {
    let meta = std::fs::metadata(path);
    DocEntry {
        path: path.to_string_lossy().to_string(),
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        ext: ext_of(path),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        modified: meta.as_ref().ok().and_then(|m| millis(m.modified())),
        exists: meta.is_ok(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubFolder {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderContents {
    pub subfolders: Vec<SubFolder>,
    pub documents: Vec<DocEntry>,
}

pub fn contents(folder: &Path) -> std::io::Result<FolderContents> {
    let mut out = FolderContents::default();
    for entry in std::fs::read_dir(folder)?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && is_listable_dir(&name, &path) {
            out.subfolders.push(SubFolder { path: path.to_string_lossy().to_string(), name });
        } else if (kind.is_file() || (kind.is_dir() && ext_of(&path) == "rtfd")) && !name.starts_with('.') && is_document(&path) {
            out.documents.push(doc_entry(&path));
        }
    }
    out.subfolders.sort_by_key(|f| f.name.to_lowercase());
    out.documents.sort_by_key(|d| d.name.to_lowercase());
    Ok(out)
}

/// The subfolders and documents directly inside a folder.
#[tauri::command]
pub async fn folder_contents(path: String) -> Result<FolderContents, String> {
    jobs::blocking(move || contents(Path::new(&path)).map_err(|e| e.to_string())).await
}

/// Size, date and whether each file is still there (for documents linked from elsewhere).
#[tauri::command]
pub async fn docs_info(paths: Vec<String>) -> Vec<DocEntry> {
    jobs::blocking(move || paths.iter().map(|p| doc_entry(Path::new(p))).collect()).await
}

// MARK: - Documents and folders

/// `name`, or `name-1`, `name-2`… when something already has that name.
fn free_path(folder: &Path, name: &str) -> Option<PathBuf> {
    let first = folder.join(name);
    if !first.exists() {
        return Some(first);
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..1000).map(|n| folder.join(format!("{stem}-{n}{ext}"))).find(|p| !p.exists())
}

/// Copies `src` to a new file at `dest` (never replacing one) and checks the size.
fn copy_new(src: &Path, dest: &Path) -> std::io::Result<()> {
    let size = std::fs::metadata(src)?.len();
    let mut input = std::fs::File::open(src)?;
    let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(dest)?;
    let copied = std::io::copy(&mut input, &mut output).and_then(|n| output.flush().map(|_| n));
    match copied {
        Ok(n) if n == size => Ok(()),
        other => {
            let _ = std::fs::remove_file(dest);
            Err(other.err().unwrap_or_else(|| std::io::Error::other("the copy didn’t match the original")))
        }
    }
}

fn friendly(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => "permission denied".into(),
        std::io::ErrorKind::NotFound => "not found".into(),
        _ => e.to_string(),
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddOutcome {
    pub added: Vec<DocEntry>,
    pub errors: Vec<String>,
}

/// Copies files into a shoot folder. A name already there gets `-1`, `-2`…; originals stay put.
#[tauri::command]
pub async fn add_documents(folder: String, paths: Vec<String>) -> AddOutcome {
    jobs::serial(move || {
        let dir = Path::new(&folder);
        let mut out = AddOutcome::default();
        for src in paths.iter().map(Path::new) {
            let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if src.is_dir() {
                out.errors.push(format!("{name}: folders can’t be added as documents"));
                continue;
            }
            if src.parent() == Some(dir) {
                out.added.push(doc_entry(src)); // already in this folder
                continue;
            }
            let Some(dest) = free_path(dir, &name) else {
                out.errors.push(format!("{name}: too many files with this name"));
                continue;
            };
            match copy_new(src, &dest) {
                Ok(()) => out.added.push(doc_entry(&dest)),
                Err(e) => out.errors.push(format!("{name}: {}", friendly(&e))),
            }
        }
        out
    })
    .await
}

/// Moves documents to another folder (same rules: nothing is replaced).
#[tauri::command]
pub async fn move_documents(paths: Vec<String>, destination: String) -> AddOutcome {
    jobs::serial(move || {
        let dir = Path::new(&destination);
        let mut out = AddOutcome::default();
        for src in paths.iter().map(Path::new) {
            let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let Some(dest) = free_path(dir, &name) else {
                out.errors.push(format!("{name}: too many files with this name"));
                continue;
            };
            let moved = std::fs::rename(src, &dest).or_else(|_| copy_new(src, &dest).and_then(|_| std::fs::remove_file(src)));
            match moved {
                Ok(()) => out.added.push(doc_entry(&dest)),
                Err(e) => out.errors.push(format!("{name}: {}", friendly(&e))),
            }
        }
        out
    })
    .await
}

fn check_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', ':']) {
        return Err("Names can’t be empty or contain / \\ or :".into());
    }
    Ok(name)
}

/// Makes a new folder inside `parent` ("Untitled folder 2" if the name is taken). Returns its path.
#[tauri::command]
pub async fn create_folder(parent: String, name: String) -> Result<String, String> {
    jobs::serial(move || {
        let name = check_name(&name)?;
        let dir = Path::new(&parent);
        let path = std::iter::once(dir.join(name))
            .chain((2..1000).map(|n| dir.join(format!("{name} {n}"))))
            .find(|p| !p.exists())
            .ok_or("too many folders with this name")?;
        std::fs::create_dir(&path).map_err(|e| friendly(&e))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
}

/// Renames a file or folder in place. Refuses to replace anything; a folder's progress follows it.
#[tauri::command]
pub async fn rename_path(path: String, new_name: String) -> Result<String, String> {
    jobs::serial(move || {
        let name = check_name(&new_name)?;
        let src = Path::new(&path);
        let dest = src.parent().ok_or("can’t rename this")?.join(name);
        if dest == src {
            return Ok(path);
        }
        // On a case-insensitive disk "game" → "Game" is the same file: that's fine.
        let case_only = dest.to_string_lossy().to_lowercase() == src.to_string_lossy().to_lowercase();
        if dest.exists() && !case_only {
            return Err(format!("“{name}” already exists here."));
        }
        std::fs::rename(src, &dest).map_err(|e| friendly(&e))?;
        let new_path = dest.to_string_lossy().to_string();
        if dest.is_dir() {
            relocate_records(&path, &new_path);
        }
        Ok(new_path)
    })
    .await
}

/// Moves a document or folder to the Trash / Recycle Bin (recoverable, never deleted outright).
#[tauri::command]
pub async fn trash_path(path: String) -> Result<(), String> {
    jobs::serial(move || fileops::move_to_trash(Path::new(&path)).map_err(|e| e.to_string())).await
}

/// Quick Look on macOS (like pressing Space in Finder); the default app elsewhere.
#[tauri::command]
pub fn quick_look(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("qlmanage")
            .args(["-p", &path])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        fileops::open_files(vec![path])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deadlyne-library-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stats_count_pairs_once_and_add_up_subfolders() {
        let root = scratch("stats");
        for f in ["A_1.CR3", "A_1.JPG", "A_2.CR3", "A_2.xmp", "brief.pdf", ".hidden.jpg"] {
            std::fs::write(root.join(f), b"x").unwrap();
        }
        let sub = root.join("Game 2");
        std::fs::create_dir(&sub).unwrap();
        for f in ["B_1.JPG", "B_2.JPG", "B_3.JPG"] {
            std::fs::write(sub.join(f), b"x").unwrap();
        }
        std::fs::create_dir(root.join(".cache")).unwrap();

        let root_s = root.to_string_lossy().to_string();
        let sub_s = sub.to_string_lossy().to_string();
        with_entry(&root_s, |e| e.viewed.extend(["a_1".to_string(), "gone_99".to_string()]));
        with_entry(&sub_s, |e| e.viewed.insert("b_2".to_string()));

        let s = stats(&root_s);
        assert!(s.exists);
        assert_eq!((s.photos, s.viewed), (2, 1), "a deleted photo's key never counts");
        assert_eq!((s.total_photos, s.total_viewed), (5, 2));
        assert_eq!((s.subfolders, s.documents), (1, 1));

        let c = contents(&root).unwrap();
        assert_eq!(c.subfolders.len(), 1);
        assert_eq!(c.documents.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), ["brief.pdf"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_folder_is_reported_not_counted() {
        let s = stats("/definitely/not/here/deadlyne");
        assert!(!s.exists);
        assert_eq!(s.total_photos, 0);
    }

    #[test]
    fn copies_never_overwrite() {
        let root = scratch("copy");
        let src_dir = root.join("src");
        std::fs::create_dir(&src_dir).unwrap();
        std::fs::write(src_dir.join("Brief.pdf"), b"new").unwrap();
        std::fs::write(root.join("Brief.pdf"), b"old").unwrap();
        let dest = free_path(&root, "Brief.pdf").unwrap();
        assert_eq!(dest.file_name().unwrap(), "Brief-1.pdf");
        copy_new(&src_dir.join("Brief.pdf"), &dest).unwrap();
        assert_eq!(std::fs::read(root.join("Brief.pdf")).unwrap(), b"old");
        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        assert!(copy_new(&src_dir.join("Brief.pdf"), &dest).is_err(), "create_new refuses an existing file");
        let _ = std::fs::remove_dir_all(&root);
    }
}
