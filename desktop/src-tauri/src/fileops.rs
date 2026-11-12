//! Copy, move and trash for photos. Each item names the exact files to act on, so the interface
//! decides whether a RAW+JPEG pair travels together or only one half does. Never overwrites:
//! files already at the destination are skipped. "Delete" always means the Trash / Recycle Bin.

use crate::jobs;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Deserialize)]
pub struct Item {
    /// The photo's id, reported back when all its files were handled.
    pub id: String,
    pub files: Vec<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// Photos whose files were all handled.
    pub completed: Vec<String>,
    pub files: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

fn name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// Sidecars are listed whether or not they exist; a missing one isn't an error.
fn optional(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("xmp"))
}

/// Creates only a new destination. A failed write closes and removes our partial file so a
/// retry (especially ingest's same-size skip) can never mistake it for a completed copy.
pub(crate) fn write_new<T>(dest: &Path, write: impl FnOnce(&mut std::fs::File) -> io::Result<T>) -> io::Result<T> {
    let _access = crate::data::access(dest)?;
    let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(dest)?;
    let result = write(&mut output).and_then(|value| output.flush().map(|_| value));
    drop(output); // Windows cannot remove an open file.
    if result.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    result
}

/// Copy without a check-then-overwrite race, verifying length before accepting the new file.
pub(crate) fn copy_new(src: &Path, dest: &Path) -> io::Result<u64> {
    let _access = crate::data::access(src)?;
    let mut input = std::fs::File::open(src)?;
    let metadata = input.metadata()?;
    write_new(dest, |output| {
        let copied = io::copy(&mut input, output)?;
        if copied != metadata.len() || input.metadata()?.len() != metadata.len() {
            return Err(io::Error::other("the copy didn’t match the original"));
        }
        output.set_permissions(metadata.permissions())?;
        Ok(copied)
    })
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn move_same_drive(src: &Path, dest: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let src = CString::new(src.as_os_str().as_bytes())?;
    let dest = CString::new(dest.as_os_str().as_bytes())?;
    // Atomic exclusive rename preserves files, document packages and their metadata without
    // copying bytes. Both paths are valid C strings that remain alive through this call.
    let result = unsafe { libc::renameatx_np(libc::AT_FDCWD, src.as_ptr(), libc::AT_FDCWD, dest.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn move_same_drive(src: &Path, dest: &Path) -> io::Result<()> {
    // MoveFileEx on Windows cannot replace an existing directory, even an empty one.
    #[cfg(target_os = "windows")]
    if src.is_dir() { return std::fs::rename(src, dest); }
    // Hard links refuse an existing destination and keep same-drive file moves constant-time.
    std::fs::hard_link(src, dest)?;
    std::fs::remove_file(src)
}

pub(crate) fn move_file(src: &Path, dest: &Path) -> io::Result<()> {
    let _source_access = crate::data::access(src)?;
    let _destination_access = crate::data::access(dest)?;
    if src == dest {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, "it’s already in this folder"));
    }
    // Unsupported filesystems and cross-drive moves use a verified, exclusive copy.
    match move_same_drive(src, dest) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(e),
        Err(_) => { copy_new(src, dest)?; },
    }
    std::fs::remove_file(src)
}

#[tauri::command]
pub async fn transfer_photos(app: AppHandle, items: Vec<Item>, destination: String, move_files: bool) -> Outcome {
    jobs::serial(move || {
        let dest = Path::new(&destination);
        let _destination_access = crate::data::access(dest).ok();
        let mut out = Outcome::default();
        let total = items.len();
        for (n, item) in items.iter().enumerate() {
            let mut ok = true;
            for f in &item.files {
                let src = Path::new(f);
                let _source_access = crate::data::access(src).ok();
                if !src.exists() {
                    if !optional(src) {
                        out.errors.push(format!("{}: file not found", name(src)));
                        ok = false;
                    }
                    continue;
                }
                let target = dest.join(name(src));
                if target.exists() {
                    out.skipped += 1;
                    ok = false;
                    continue;
                }
                let result = if move_files { move_file(src, &target) } else { copy_new(src, &target).map(|_| ()) };
                match result {
                    Ok(()) => out.files += 1,
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                        out.skipped += 1;
                        ok = false;
                    }
                    Err(e) => {
                        out.errors.push(format!("{}: {e}", name(src)));
                        ok = false;
                    }
                }
            }
            if ok {
                out.completed.push(item.id.clone());
            }
            if n % 10 == 9 || n + 1 == total {
                let _ = app.emit("transfer-progress", (n + 1, total));
            }
        }
        out
    })
    .await
}

/// Moves one file or folder to the Trash / Recycle Bin (recoverable).
#[cfg(not(target_os = "ios"))]
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    let _access = crate::data::access(path).map_err(|e| e.to_string())?;
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    // Finder's AppleScript route needs an automation permission and fails silently without it.
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| e.to_string())
}

/// On iPad: Files' Recently Deleted, through the same Foundation call Finder uses. Never deletes outright.
#[cfg(target_os = "ios")]
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

/// Moves files to the Trash / Recycle Bin — never deletes permanently.
#[tauri::command]
pub async fn trash_photos(items: Vec<Item>) -> Outcome {
    jobs::serial(move || {
        let mut out = Outcome::default();
        for item in &items {
            let mut ok = true;
            for f in item.files.iter().map(Path::new) {
                let _access = crate::data::access(f).ok();
                if !f.exists() {
                    continue;
                }
                match move_to_trash(f) {
                    Ok(()) => out.files += 1,
                    Err(e) => {
                        out.errors.push(format!("{}: {e}", name(f)));
                        ok = false;
                    }
                }
            }
            if ok {
                out.completed.push(item.id.clone());
            }
        }
        out
    })
    .await
}

/// Opens files in the app the system uses for them (Preview, Photoshop, Photos…), like
/// double-clicking them in Finder or Explorer.
#[tauri::command]
pub fn open_files(paths: Vec<String>) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::mac_store::open_files(&paths); }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    {
    if paths.is_empty() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").args(&paths).status().map(|_| ());
    #[cfg(target_os = "windows")]
    let result = paths
        .iter()
        .try_for_each(|p| std::process::Command::new("explorer").arg(p).status().map(|_| ()));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = paths
        .iter()
        .try_for_each(|p| std::process::Command::new("xdg-open").arg(p).status().map(|_| ()));
    result.map_err(|e| e.to_string())
    }
}

/// Opens the system file manager with `path` selected.
#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::mac_store::reveal(&path); }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    {
    let p = Path::new(&path);
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg("-R").arg(p).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open").arg(p.parent().unwrap_or(p)).status();
    status.map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!("deadlyne-fileops-{}-{label}", std::process::id()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copies_and_moves_refuse_existing_destinations() {
        let dir = Scratch::new("existing");
        let src = dir.0.join("source.JPG");
        let dest = dir.0.join("destination.JPG");
        std::fs::write(&src, b"new photo").unwrap();
        std::fs::write(&dest, b"client photo").unwrap();

        assert!(copy_new(&src, &dest).is_err());
        assert!(move_file(&src, &dest).is_err());
        assert!(move_file(&src, &src).is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"client photo");
        assert_eq!(std::fs::read(&src).unwrap(), b"new photo");

        let copied = dir.0.join("copy.JPG");
        assert_eq!(copy_new(&src, &copied).unwrap(), 9);
        assert_eq!(std::fs::read(&copied).unwrap(), b"new photo");
        let moved = dir.0.join("moved.JPG");
        move_file(&src, &moved).unwrap();
        assert!(!src.exists());
        assert_eq!(std::fs::read(&moved).unwrap(), b"new photo");
    }

    #[test]
    fn failed_writes_remove_only_the_new_partial_file() {
        let dir = Scratch::new("partial");
        let dest = dir.0.join("partial.JPG");
        let result: io::Result<()> = write_new(&dest, |out| {
            out.write_all(b"unfinished photo")?;
            Err(io::Error::other("simulated disconnected drive"))
        });
        assert!(result.is_err());
        assert!(!dest.exists());
        assert!(copy_new(&dir.0.join("missing.JPG"), &dest).is_err());
        assert!(!dest.exists());

        std::fs::write(&dest, b"existing photo").unwrap();
        let result: io::Result<()> = write_new(&dest, |_| panic!("must not open an existing file"));
        assert!(result.is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"existing photo");
    }

    #[test]
    fn competing_copies_never_replace_the_winner() {
        let dir = Scratch::new("race");
        let dest = dir.0.join("destination.JPG");
        let barrier = Arc::new(Barrier::new(2));
        let copies: Vec<_> = [b"first photo".as_slice(), b"second photo".as_slice()].into_iter().enumerate().map(|(i, bytes)| {
            let src = dir.0.join(format!("{i}.JPG"));
            std::fs::write(&src, bytes).unwrap();
            let dest = dest.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                (copy_new(&src, &dest).is_ok(), bytes)
            })
        }).collect();
        let results: Vec<_> = copies.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|r| r.0).count(), 1);
        assert_eq!(std::fs::read(dest).unwrap(), results.iter().find(|r| r.0).unwrap().1);
    }

    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "windows"))]
    #[test]
    fn document_packages_move_without_replacing_existing_directories() {
        let dir = Scratch::new("package");
        let src = dir.0.join("Brief.rtfd");
        let dest = dir.0.join("Moved.rtfd");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("TXT.rtf"), b"shot list").unwrap();
        std::fs::create_dir(&dest).unwrap();
        assert!(move_file(&src, &dest).is_err(), "even an empty destination must be kept");
        assert_eq!(std::fs::read(src.join("TXT.rtf")).unwrap(), b"shot list");
        std::fs::remove_dir(&dest).unwrap();
        move_file(&src, &dest).unwrap();
        assert!(!src.exists());
        assert_eq!(std::fs::read(dest.join("TXT.rtf")).unwrap(), b"shot list");
    }

    #[cfg(unix)]
    #[test]
    fn dangling_destination_links_are_never_followed_or_replaced() {
        let dir = Scratch::new("symlink");
        let src = dir.0.join("source.JPG");
        let dest = dir.0.join("destination.JPG");
        let missing = dir.0.join("missing.JPG");
        std::fs::write(&src, b"new photo").unwrap();
        std::os::unix::fs::symlink(&missing, &dest).unwrap();
        assert!(copy_new(&src, &dest).is_err());
        assert!(move_file(&src, &dest).is_err());
        assert_eq!(std::fs::read_link(&dest).unwrap(), missing);
        assert!(!missing.exists());
        assert_eq!(std::fs::read(src).unwrap(), b"new photo");
    }
}
