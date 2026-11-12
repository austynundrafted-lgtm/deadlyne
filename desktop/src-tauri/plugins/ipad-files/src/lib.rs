//! Files on iPad. An iPad app can only read a folder the photographer picked in the Files
//! browser, so this plugin presents the system pickers, keeps security-scoped bookmarks so
//! picked shoots (and cards in a reader) stay readable after a relaunch, and stands in for
//! Finder: Quick Look for previews and the share sheet for "open in…". The work is in Swift
//! (`ios/Sources/IpadFilesPlugin.swift`); these commands forward to it.

use serde_json::Value;
use tauri::{
    ipc::Channel,
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

mod error;
pub use error::{Error, Result};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ipad_files);

struct Native<R: Runtime>(PluginHandle<R>);

async fn call<R: Runtime>(app: &AppHandle<R>, method: &str, args: Value) -> Result<Value> {
    Ok(app.state::<Native<R>>().0.run_mobile_plugin_async(method, args).await?)
}

// A Files picker may be open longer than WebKit's IPC fetch timeout. Return immediately,
// then deliver its result over a channel so Tauri never retries and opens a second picker.
fn pick<R: Runtime>(app: AppHandle<R>, method: &'static str, args: Value, on_result: Channel<Value>) {
    tauri::async_runtime::spawn(async move {
        let response = match call(&app, method, args).await {
            Ok(result) => serde_json::json!({ "result": result }),
            Err(error) => serde_json::json!({ "error": error.to_string() }),
        };
        let _ = on_result.send(response);
    });
}

/// Sends `{ path }` of the folder picked, or `null` when cancelled, over `on_result`.
#[tauri::command]
fn pick_folder<R: Runtime>(app: AppHandle<R>, on_result: Channel<Value>) {
    pick(app, "pickFolder", Value::Null, on_result);
}

/// `{ paths }` of the files picked (opened in place, never copied by the picker).
#[tauri::command]
fn pick_files<R: Runtime>(app: AppHandle<R>, multiple: bool, on_result: Channel<Value>) {
    pick(app, "pickFiles", serde_json::json!({ "multiple": multiple }), on_result);
}

/// Reopens every bookmarked folder and file. `{ restored: [{ saved, current }] }`; `current`
/// differs from `saved` when the item moved, and is `null` when it can't be found.
#[tauri::command]
async fn restore_access<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    call(&app, "restoreAccess", Value::Null).await
}

/// Quick Look, the iPad's equivalent of pressing Space in Finder.
#[tauri::command]
async fn preview<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Value> {
    call(&app, "preview", serde_json::json!({ "path": path })).await
}

/// The share sheet: open in another app, save to Files, AirDrop, Mail…
#[tauri::command]
async fn share<R: Runtime>(app: AppHandle<R>, paths: Vec<String>) -> Result<Value> {
    call(&app, "share", serde_json::json!({ "paths": paths })).await
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
