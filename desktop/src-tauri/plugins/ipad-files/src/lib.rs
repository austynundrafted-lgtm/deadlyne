//! Files on iPad. An iPad app can only read a folder the photographer picked in the Files
//! browser, so this plugin presents the system pickers, keeps security-scoped bookmarks so
//! picked shoots (and cards in a reader) stay readable after a relaunch, and stands in for
//! Finder: Quick Look for previews and the share sheet for "open in…". The work is in Swift
//! (`ios/Sources/IpadFilesPlugin.swift`); these commands forward to it.

use serde_json::Value;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

mod error;
pub use error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ipad_files);

struct Native<R: Runtime>(PluginHandle<R>);

fn call<R: Runtime>(app: &AppHandle<R>, method: &str, args: Value) -> Result<Value> {
    Ok(app.state::<Native<R>>().0.run_mobile_plugin(method, args)?)
}

/// `{ path }` of the folder picked, or `null` when cancelled.
#[tauri::command]
async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    call(&app, "pickFolder", Value::Null)
}

/// `{ paths }` of the files picked (opened in place, never copied by the picker).
#[tauri::command]
async fn pick_files<R: Runtime>(app: AppHandle<R>, multiple: bool) -> Result<Value> {
    call(&app, "pickFiles", serde_json::json!({ "multiple": multiple }))
}

/// Reopens every bookmarked folder and file. `{ restored: [{ saved, current }] }`; `current`
/// differs from `saved` when the item moved, and is `null` when it can't be found.
#[tauri::command]
async fn restore_access<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    call(&app, "restoreAccess", Value::Null)
}

/// Quick Look, the iPad's equivalent of pressing Space in Finder.
#[tauri::command]
async fn preview<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Value> {
    call(&app, "preview", serde_json::json!({ "path": path }))
}

/// The share sheet: open in another app, save to Files, AirDrop, Mail…
#[tauri::command]
async fn share<R: Runtime>(app: AppHandle<R>, paths: Vec<String>) -> Result<Value> {
    call(&app, "share", serde_json::json!({ "paths": paths }))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ipad-files")
        .invoke_handler(tauri::generate_handler![pick_folder, pick_files, restore_access, preview, share])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let handle = api.register_ios_plugin(init_plugin_ipad_files)?;
            #[cfg(not(target_os = "ios"))]
            let handle: PluginHandle<R> = {
                let _ = api;
                return Err("the ipad-files plugin only runs on iPad".into());
            };
            app.manage(Native(handle));
            Ok(())
        })
        .build()
}
