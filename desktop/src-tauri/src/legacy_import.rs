//! User-selected migration into the sandbox. Only known device workflow files are read; login
//! tokens and account caches are excluded. Source files and existing roster files are untouched.
#[cfg(feature = "mac-app-store")]
use std::path::Path;
use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Serialize, Default)]
pub struct Imported {
    pub settings: Map<String, Value>,
    pub library: Map<String, Value>,
    pub copied: usize,
    pub kept: usize,
    pub errors: Vec<String>,
}
#[cfg(any(feature = "mac-app-store", test))]
const SETTINGS: &[&str] = &["recentShoots", "jpegCaptionMode", "ingest", "export", "ftpServers", "ftpLastServer", "ftpSendFiles", "codeListsDisabled", "codeDelimiter", "codeExpandWhileTyping", "codeColumnNames"];
#[cfg(any(feature = "mac-app-store", test))]
fn selected_keys(value: Value, allowed: &[&str]) -> Map<String, Value> {
    value.as_object().map(|map| map.iter().filter(|(k, _)| allowed.contains(&k.as_str())).map(|(k,v)| (k.clone(),v.clone())).collect()).unwrap_or_default()
}
#[cfg(feature = "mac-app-store")]
fn read(path: &Path) -> Result<Vec<u8>, String> {
    if std::fs::symlink_metadata(path).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("Linked files aren’t imported. Choose the original data folder.".into()); }
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 32 << 20 { return Err("This setup file is too large to import.".into()); }
    std::fs::read(path).map_err(|e| e.to_string())
}

#[cfg(feature = "mac-app-store")]
pub fn run(source: &Path) -> Result<Imported, String> {
    let _access = crate::data::access(source).map_err(|e| e.to_string())?;
    let mut out = Imported::default();
    if source.starts_with(crate::data::app_dir()) { return Err("Choose the previous app’s data folder, not this app’s container.".into()); }
    let recognized = source.join("settings.json").is_file() || source.join("library.json").is_file() || source.join("Code Replacements").is_dir() || source.join("Viewing").is_dir();
    if !recognized { return Err("Choose the old app.deadlyne.desktop or Deadlyne folder inside Library/Application Support.".into()); }
    for (name, allowed) in [("settings.json", SETTINGS), ("library.json", &["shoots", "collections", "links"][..])] {
        let path = source.join(name);
        if !path.exists() { continue; }
        match read(&path).and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string())) {
            Ok(value) => if name == "settings.json" { out.settings = selected_keys(value, allowed) } else { out.library = selected_keys(value, allowed) },
            Err(error) => out.errors.push(format!("{name}: {error}")),
        }
    }
    for sub in ["Code Replacements", "Viewing"] {
        let source_dir = source.join(sub);
        if !source_dir.is_dir() { continue; }
        for entry in std::fs::read_dir(&source_dir).map_err(|e| e.to_string())?.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_file()) { continue; }
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            let result = if sub == "Viewing" && ext == "json" {
                read(&path).and_then(|bytes| crate::library::import_viewing(&bytes))
            } else if sub == "Code Replacements" && ["txt", "csv", "tsv", "tab"].contains(&ext.as_str()) {
                copy_roster(&path)
            } else { continue; };
            match result {
                Ok(()) => out.copied += 1,
                Err(error) => out.errors.push(format!("{}: {error}", entry.file_name().to_string_lossy())),
            }
        }
    }
    Ok(out)
}

#[cfg(feature = "mac-app-store")]
fn copy_roster(source: &Path) -> Result<(), String> {
    let folder = crate::codes::dir();
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = source.file_name().ok_or("Roster has no name")?;
    let target = folder.join(name);
    let bytes = read(source)?;
    if std::fs::read(&target).ok().as_ref() == Some(&bytes) { return Ok(()); }
    for index in 0..1000 {
        let target = if index == 0 { target.clone() } else { folder.join(format!("{}-{index}.{}", source.file_stem().unwrap_or_default().to_string_lossy(), source.extension().unwrap_or_default().to_string_lossy())) };
        // An earlier import may already have made this suffixed copy.
        if std::fs::read(&target).ok().as_ref() == Some(&bytes) { return Ok(()); }
        match crate::fileops::write_new(&target, |f| { use std::io::Write; f.write_all(&bytes) }) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Too many rosters with this name.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_cannot_import_tokens_or_account_caches() {
        let source = serde_json::json!({"ingest":{"job":"Friday"},"recentShoots":[],"profile":{"name":"Previous account"},"deadlyne-auth":"private-token","accountPresets":["private"],"unrecognized":"ignored"});
        let selected = selected_keys(source, SETTINGS);
        assert!(selected.contains_key("ingest"));
        assert_eq!(selected.len(), 2);
        assert!(!selected.contains_key("profile"));
    }
}
