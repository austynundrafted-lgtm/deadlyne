//! Native Mac sandbox access. Bookmarks persist, but active security scopes are reference-counted
//! leases: background jobs and image requests retain them until their IO finishes. Restoring a
//! large library does not consume a security scope for every remembered folder.
use std::{collections::{BTreeMap, HashMap}, path::{Path, PathBuf}, sync::{Arc, Mutex, OnceLock, Weak}};
use block2::RcBlock;
use objc2::{MainThreadMarker, rc::{autoreleasepool, Retained}, runtime::Bool};
use objc2_app_kit::{NSOpenPanel, NSWorkspace};
use objc2_foundation::{NSArray, NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions};
use tauri::{AppHandle, ipc::Channel};
use crate::store_bridge::{PickReply, Picked, Restored};

pub struct Scope { url: Retained<NSURL>, started: bool }
impl Drop for Scope {
    fn drop(&mut self) { if self.started { unsafe { self.url.stopAccessingSecurityScopedResource() } } }
}
#[derive(Default)]
struct Access {
    loaded: bool,
    bookmarks: BTreeMap<String, Vec<u8>>,
    urls: BTreeMap<String, Retained<NSURL>>,
    active: HashMap<String, Weak<Scope>>,
    moved: Vec<Restored>,
}
static ACCESS: OnceLock<Mutex<Access>> = OnceLock::new();
static PICKING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn access() -> &'static Mutex<Access> { ACCESS.get_or_init(|| Mutex::new(Access::default())) }
fn bookmark_path() -> PathBuf { crate::data::app_dir().join("file-access.json") }
fn url_path(url: &NSURL) -> Result<String, String> { url.path().map(|p| p.to_string()).ok_or_else(|| "The selected item has no local file path.".into()) }
fn bookmark(url: &NSURL) -> Result<Vec<u8>, String> {
    url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(NSURLBookmarkCreationOptions::WithSecurityScope, None, None)
        .map(|data| data.to_vec()).map_err(|e| format!("Couldn’t remember access to this folder: {e}"))
}
fn save(state: &Access) -> Result<(), String> {
    let bytes = serde_json::to_vec(&state.bookmarks).map_err(|e| e.to_string())?;
    crate::xmp::write_atomic(&bookmark_path(), &bytes).map_err(|e| e.to_string())
}

pub fn restore() -> Result<Vec<Restored>, String> {
    autoreleasepool(|_| {
        let mut state = access().lock().unwrap_or_else(|e| e.into_inner());
        if state.loaded { return Ok(state.moved.clone()); }
        state.bookmarks = match std::fs::read(bookmark_path()) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(saved) => saved,
                Err(_) => {
                    let backup = bookmark_path().with_file_name(format!("file-access-unreadable-{}-{}.json", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
                    std::fs::rename(bookmark_path(), backup).map_err(|e| e.to_string())?;
                    state.loaded = true;
                    return Err("Saved folder permissions couldn’t be read. They were backed up; choose your folders again to restore access.".into());
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.to_string()),
        };
        let mut refresh = false;
        for (saved, bytes) in state.bookmarks.clone() {
            let mut stale = Bool::NO;
            let resolved = unsafe {
                NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                    &NSData::with_bytes(&bytes),
                    NSURLBookmarkResolutionOptions::WithSecurityScope | NSURLBookmarkResolutionOptions::WithoutUI | NSURLBookmarkResolutionOptions::WithoutMounting,
                    None, &mut stale,
                )
            };
            match resolved {
                Ok(url) => {
                    let path = url_path(&url)?;
                    if stale.as_bool() || path != saved {
                        if let Ok(fresh) = bookmark(&url) {
                            state.bookmarks.remove(&saved);
                            state.bookmarks.insert(path.clone(), fresh);
                            refresh = true;
                        }
                    }
                    if path != saved { state.moved.push(Restored { saved, current: Some(path.clone()) }); }
                    state.urls.insert(path, url);
                }
                Err(_) => state.moved.push(Restored { saved, current: None }),
            }
        }
        if refresh { save(&state)?; }
        state.loaded = true;
        Ok(state.moved.clone())
    })
}

/// Only a live IO operation consumes a scope. NSURL resolution alone does not grant access.
pub fn lease(path: &Path) -> Result<Option<Arc<Scope>>, String> {
    if path.starts_with(crate::data::app_dir()) { return Ok(None); }
    let mut state = access().lock().unwrap_or_else(|e| e.into_inner());
    let root = state.urls.keys().filter(|root| path.starts_with(Path::new(root))).max_by_key(|p| p.len()).cloned();
    let Some(root) = root else { return Ok(None); }; // Implicit Finder/drop grants are still enforced by the OS.
    if let Some(scope) = state.active.get(&root).and_then(Weak::upgrade) { return Ok(Some(scope)); }
    let url = state.urls[&root].clone();
    let started = unsafe { url.startAccessingSecurityScopedResource() };
    let scope = Arc::new(Scope { url, started });
    state.active.insert(root, Arc::downgrade(&scope));
    Ok(Some(scope))
}

fn remember(urls: Vec<Retained<NSURL>>) -> Result<Vec<String>, String> {
    restore()?;
    autoreleasepool(|_| {
        let mut state = access().lock().unwrap_or_else(|e| e.into_inner());
        let mut paths = Vec::new();
        for url in urls {
            let path = url_path(&url)?;
            let scope = Scope { started: unsafe { url.startAccessingSecurityScopedResource() }, url: url.clone() };
            let bytes = bookmark(&url)?;
            state.bookmarks.insert(path.clone(), bytes);
            state.urls.insert(path.clone(), url);
            paths.push(path);
            drop(scope);
        }
        save(&state)?;
        Ok(paths)
    })
}
fn reply(channel: &Channel<PickReply>, result: Result<Vec<String>, String>) {
    let _ = channel.send(match result {
        Ok(paths) => PickReply::Success { result: Picked { paths } },
        Err(error) => PickReply::Failure { error },
    });
}

/// Acknowledge the IPC call immediately; a modeless native panel sends its eventual result over
/// the channel. Browsing a card must never keep a WebKit fetch open for minutes.
pub fn pick(app: AppHandle, title: String, directory: bool, multiple: bool, requested: Option<String>, channel: Channel<PickReply>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if PICKING.swap(true, Ordering::SeqCst) { return Err("Another file chooser is already open.".into()); }
    let result = app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("native picker on main thread");
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setTitle(Some(&NSString::from_str(&title)));
        panel.setCanChooseDirectories(directory);
        panel.setCanChooseFiles(!directory);
        panel.setAllowsMultipleSelection(multiple);
        panel.setCanCreateDirectories(directory);
        if let Some(path) = &requested {
            panel.setDirectoryURL(Some(&NSURL::fileURLWithPath(&NSString::from_str(path))));
            panel.setMessage(Some(&NSString::from_str("Choose this folder, or a parent folder, to allow Deadlyne to read photos and save sidecars. Your files stay where they are.")));
        }
        let retained = panel.clone();
        let handler = RcBlock::new(move |response: isize| {
            PICKING.store(false, Ordering::SeqCst);
            if response != 1 { reply(&channel, Ok(Vec::new())); return; }
            let urls: Vec<_> = retained.URLs().iter().collect();
            let requested = requested.clone();
            let channel = channel.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let result = (|| {
                    if let Some(path) = &requested {
                        let selected = urls.first().ok_or("No folder was selected.")?;
                        if !Path::new(path).starts_with(url_path(selected)?) {
                            return Err("Choose the requested folder or one of its parent folders.".into());
                        }
                    }
                    let selected = remember(urls)?;
                    Ok(requested.map(|p| vec![p]).unwrap_or(selected))
                })();
                reply(&channel, result);
            });
        });
        panel.beginWithCompletionHandler(&handler);
    });
    if result.is_err() { PICKING.store(false, Ordering::SeqCst); }
    result.map_err(|e| e.to_string())
}

pub fn authorize(app: AppHandle, path: String, channel: Channel<PickReply>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = restore() { reply(&channel, Err(error)); return; }
        let requested = Path::new(&path);
        let known = requested.starts_with(crate::data::app_dir()) || access().lock().unwrap_or_else(|e| e.into_inner()).urls.keys().any(|root| requested.starts_with(root));
        if known {
            let _scope = crate::data::access(requested).ok();
            match std::fs::read_dir(requested) {
                Ok(_) => { reply(&channel, Ok(vec![path])); return; }
                // A disconnected or moved folder should use the existing Locate flow, not a
                // permission panel. A denied grant can be renewed through the native picker.
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => { reply(&channel, Ok(vec![path])); return; }
                Err(_) => {},
            }
        }
        let title = format!("Allow access to {}", requested.file_name().unwrap_or_default().to_string_lossy());
        if let Err(error) = pick(app, title, true, false, Some(path), channel.clone()) { reply(&channel, Err(error)); }
    });
    Ok(())
}

pub fn open_files(paths: &[String]) -> Result<(), String> {
    autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        for path in paths {
            let _scope = crate::data::access(Path::new(path)).map_err(|e| e.to_string())?;
            if !workspace.openURL(&NSURL::fileURLWithPath(&NSString::from_str(path))) { return Err("The file couldn’t be opened in its default app.".into()); }
        }
        Ok(())
    })
}
pub fn reveal(path: &str) -> Result<(), String> {
    let _scope = crate::data::access(Path::new(path)).map_err(|e| e.to_string())?;
    NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&[NSURL::fileURLWithPath(&NSString::from_str(path))]));
    Ok(())
}
pub fn open_url(url: &str) {
    if let Some(url) = NSURL::URLWithString(&NSString::from_str(url)) { let _ = NSWorkspace::sharedWorkspace().openURL(&url); }
}
pub fn eject(path: &Path) -> bool {
    NSWorkspace::sharedWorkspace().unmountAndEjectDeviceAtURL_error(&NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))).is_ok()
}
pub fn granted_roots() -> Vec<String> { access().lock().unwrap_or_else(|e| e.into_inner()).urls.keys().cloned().collect() }

/// The custom photo-selection menu must yield to native text editing in an open file chooser.
pub fn select_all_in_picker(app: &AppHandle) -> bool {
    if !PICKING.load(std::sync::atomic::Ordering::SeqCst) { return false; }
    let _ = app.run_on_main_thread(|| {
        let mtm = MainThreadMarker::new().expect("native text selection on main thread");
        unsafe { objc2_app_kit::NSApplication::sharedApplication(mtm).sendAction_to_from(objc2::sel!(selectAll:), None, None); }
    });
    true
}

/// Store builds use the public UserNotifications framework. The legacy notification plugin
/// includes private NSUserNotification KVC selectors and is deliberately not linked here.
pub fn notify(title: &str, body: &str) {
    use objc2_foundation::NSError;
    use objc2_user_notifications::{UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest, UNUserNotificationCenter};
    let title = title.to_string();
    let body = body.to_string();
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let handler = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
        if !granted.as_bool() { return; }
        autoreleasepool(|_| {
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&title));
            content.setBody(&NSString::from_str(&body));
            let id = format!("deadlyne-job-{}", chrono::Utc::now().timestamp_millis());
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&id), &content, None);
            UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
        });
    });
    center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert, &handler);
}

// QLPreviewView keeps the same native document preview without launching qlmanage, which
// cannot inherit the app's sandbox grants. Its scope remains live until the preview closes.
mod preview {
    use super::*;
    use std::cell::RefCell;
    use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly, runtime::ProtocolObject};
    use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowDelegate, NSWindowStyleMask};
    use objc2_foundation::{NSNotification, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize};
    use objc2_quick_look_ui::{QLPreviewView, QLPreviewViewStyle};

    pub struct PreviewState { scope: RefCell<crate::data::Lease> }
    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = PreviewState]
        struct PreviewDelegate;
        unsafe impl NSObjectProtocol for PreviewDelegate {}
        unsafe impl NSWindowDelegate for PreviewDelegate {
            #[unsafe(method(windowWillClose:))]
            fn closing(&self, _notification: &NSNotification) { self.ivars().scope.borrow_mut().take(); }
        }
    );
    thread_local! { static PREVIEW: RefCell<Option<(Retained<NSWindow>, Retained<PreviewDelegate>)>> = const { RefCell::new(None) }; }

    pub fn show(app: AppHandle, path: String) -> Result<(), String> {
        let scope = crate::data::access(Path::new(&path)).map_err(|e| e.to_string())?;
        app.run_on_main_thread(move || {
            let mtm = MainThreadMarker::new().expect("Quick Look on main thread");
            PREVIEW.with(|slot| { if let Some((window, _)) = slot.borrow_mut().take() { window.close(); } });
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(900.0, 640.0));
            let style = NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::Resizable;
            let window = unsafe { NSWindow::initWithContentRect_styleMask_backing_defer(NSWindow::alloc(mtm), frame, style, NSBackingStoreType::Buffered, false) };
            unsafe { window.setReleasedWhenClosed(false) };
            let Some(view) = (unsafe { QLPreviewView::initWithFrame_style(QLPreviewView::alloc(mtm), frame, QLPreviewViewStyle::Normal) }) else { return; };
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            unsafe { view.setPreviewItem(Some(ProtocolObject::from_ref(&*url))) };
            let allocated = PreviewDelegate::alloc(mtm).set_ivars(PreviewState { scope: RefCell::new(scope) });
            let delegate: Retained<PreviewDelegate> = unsafe { msg_send![super(allocated), init] };
            window.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            window.setTitle(&NSString::from_str(Path::new(&path).file_name().unwrap_or_default().to_string_lossy().as_ref()));
            window.setContentView(Some(&view));
            window.center();
            window.makeKeyAndOrderFront(None);
            PREVIEW.with(|slot| *slot.borrow_mut() = Some((window, delegate)));
        }).map_err(|e| e.to_string())
    }
}
pub fn quick_look(app: AppHandle, path: String) -> Result<(), String> { preview::show(app, path) }
