//! Background work for commands. File writes go through one lock so a rating save and a caption
//! save to the same sidecar can never interleave and clobber each other.

use std::sync::Mutex;

static WRITES: Mutex<()> = Mutex::new(());

/// Runs `f` on a blocking thread, one write job at a time.
pub async fn serial<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = WRITES.lock().unwrap_or_else(|e| e.into_inner());
        f()
    })
    .await
    .expect("background job panicked")
}

/// Runs `f` on a blocking thread (reads, scans), without waiting for other jobs.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tauri::async_runtime::spawn_blocking(f).await.expect("background job panicked")
}
