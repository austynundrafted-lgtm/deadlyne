//! Copy, move and trash for photos. Each item names the exact files to act on, so the interface
//! decides whether a RAW+JPEG pair travels together or only one half does. Never overwrites:
//! files already at the destination are skipped. "Delete" always means the Trash / Recycle Bin.

use crate::jobs;
use serde::{Deserialize, Serialize};
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

fn move_file(src: &Path, dest: &Path) -> std::io::Result<()> {
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    // Across drives a rename can't work: copy, check the size, then remove the original.
    let size = std::fs::metadata(src)?.len();
    std::fs::copy(src, dest)?;
    if std::fs::metadata(dest)?.len() != size {
        let _ = std::fs::remove_file(dest);
        return Err(std::io::Error::other("the copy didn’t match the original"));
    }
    std::fs::remove_file(src)
}

#[tauri::command]
pub async fn transfer_photos(app: AppHandle, items: Vec<Item>, destination: String, move_files: bool) -> Outcome {
    jobs::serial(move || {
        let dest = Path::new(&destination);
        let mut out = Outcome::default();
        let total = items.len();
        for (n, item) in items.iter().enumerate() {
            let mut ok = true;
            for f in &item.files {
                let src = Path::new(f);
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
                let result = if move_files { move_file(src, &target) } else { std::fs::copy(src, &target).map(|_| ()) };
                match result {
                    Ok(()) => out.files += 1,
                    Err(e) => {
                        out.errors.push(format!("{}: {e}", name(src)));
                        ok = false;
                    }
                }
            }
            if ok || !move_files {
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

/// Moves files to the Trash / Recycle Bin — never deletes permanently.
#[tauri::command]
pub async fn trash_photos(items: Vec<Item>) -> Outcome {
    jobs::serial(move || {
        let mut out = Outcome::default();
        for item in &items {
            let mut ok = true;
            for f in item.files.iter().map(Path::new) {
                if !f.exists() {
                    continue;
                }
                match trash::delete(f) {
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

/// Opens the system file manager with `path` selected.
#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg("-R").arg(p).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open").arg(p.parent().unwrap_or(p)).status();
    status.map(|_| ()).map_err(|e| e.to_string())
}
