use serde::Serialize;
use tauri::{ipc::Channel, AppHandle};

#[derive(Serialize)]
pub struct Picked { pub paths: Vec<String> }
#[derive(Serialize)]
#[serde(untagged)]
#[cfg_attr(not(feature = "mac-app-store"), allow(dead_code))]
pub enum PickReply { Success { result: Picked }, Failure { error: String } }
#[derive(Serialize, Clone)]
pub struct Restored { pub saved: String, pub current: Option<String> }

#[tauri::command]
pub fn store_pick(app: AppHandle, title: String, directory: bool, multiple: bool, on_result: Channel<PickReply>) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::mac_store::pick(app, title, directory, multiple, None, on_result); }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    { let _ = (app, title, directory, multiple, on_result); Err("Store file permissions are only used by the Mac App Store build.".into()) }
}

#[tauri::command]
pub async fn store_restore_access() -> Result<Vec<Restored>, String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::jobs::blocking(crate::mac_store::restore).await; }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    { Ok(Vec::new()) }
}

#[tauri::command]
pub fn store_authorize(app: AppHandle, path: String, on_result: Channel<PickReply>) -> Result<(), String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::mac_store::authorize(app, path, on_result); }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    { let _ = (app, path, on_result); Err("Store file permissions are only used by the Mac App Store build.".into()) }
}

#[tauri::command]
pub async fn store_import_data(path: String) -> Result<crate::legacy_import::Imported, String> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { return crate::jobs::blocking(move || crate::legacy_import::run(std::path::Path::new(&path))).await; }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    { let _ = path; Err("Import is used when moving to the sandboxed Mac app.".into()) }
}
