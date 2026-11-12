//! App-owned workflow files stay inside the store app's container. Direct-download builds keep
//! their existing shared locations. File-access leases keep security scopes alive during jobs.
use std::path::{Path, PathBuf};
#[cfg(feature = "mac-app-store")]
use std::sync::OnceLock;

#[cfg(feature = "mac-app-store")]
static APP_DATA: OnceLock<PathBuf> = OnceLock::new();

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    {
        use tauri::Manager;
        let path = app.path().app_data_dir()?;
        // A sandboxed launch supplies a container HOME to the process. Fail closed if a custom
        // launch environment would redirect local stores outside Foundation's sandbox home.
        let home = PathBuf::from(objc2_foundation::NSHomeDirectory().to_string());
        if !path.starts_with(&home) { return Err("The app data directory is outside its sandbox home. Launch the app from Finder.".into()); }
        std::fs::create_dir_all(&path)?;
        let _ = APP_DATA.set(path);
    }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    let _ = app;
    Ok(())
}

#[cfg(feature = "mac-app-store")]
pub fn app_dir() -> PathBuf {
    if let Some(path) = APP_DATA.get() { return path.clone(); }
    #[cfg(test)]
    return std::env::temp_dir().join(format!("deadlyne-store-tests-{}", std::process::id()));
    #[cfg(not(test))]
    panic!("app-owned storage must be initialized before file commands");
}

pub fn workflow_dir() -> PathBuf {
    #[cfg(feature = "mac-app-store")]
    { app_dir().join("Workflow") }
    #[cfg(not(feature = "mac-app-store"))]
    { dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Deadlyne") }
}

#[cfg(all(target_os = "macos", feature = "mac-app-store"))]
pub type Lease = Option<std::sync::Arc<crate::mac_store::Scope>>;
#[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
pub type Lease = ();

pub fn access(path: &Path) -> std::io::Result<Lease> {
    #[cfg(all(target_os = "macos", feature = "mac-app-store"))]
    { crate::mac_store::lease(path).map_err(std::io::Error::other) }
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    { let _ = path; Ok(()) }
}
