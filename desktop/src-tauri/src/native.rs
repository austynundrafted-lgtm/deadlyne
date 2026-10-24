//! What makes Deadlyne behave like a desktop app rather than a page in a window: the macOS menu
//! bar, opening shoots from Finder and the Dock, a job's progress on the Dock icon, and a
//! notification when a long job finishes while the photographer is in another app.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Queues anything passed on the command line and, on macOS, installs the menu bar.
pub fn setup(app: &AppHandle) {
    queue_opened(app, std::env::args().skip(1).filter(|a| !a.starts_with('-')));
    #[cfg(target_os = "macos")]
    if let Err(e) = menu::install(app) {
        // Not eprintln!: that panics when stderr is a closed pipe, and this runs inside AppKit.
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), "Deadlyne: couldn't build the menu bar: {e}");
    }
}

// MARK: - Opening from outside

/// Folders and photos that Finder, the Dock or the command line asked Deadlyne to open, waiting for
/// the interface to take them. It may not be loaded yet when the app is launched by opening a file.
#[derive(Default)]
pub struct Opened(Mutex<Vec<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedPath {
    pub path: String,
    pub is_dir: bool,
}

pub fn queue_opened(app: &AppHandle, paths: impl IntoIterator<Item = String>) {
    let paths: Vec<String> = paths.into_iter().filter(|p| Path::new(p).exists()).collect();
    if paths.is_empty() {
        return;
    }
    app.state::<Opened>().0.lock().unwrap_or_else(|e| e.into_inner()).extend(paths);
    let _ = app.emit("opened-paths", ());
}

/// The interface drains the queue at launch and whenever `opened-paths` fires.
#[tauri::command]
pub fn take_opened_paths(app: AppHandle) -> Vec<OpenedPath> {
    let paths = std::mem::take(&mut *app.state::<Opened>().0.lock().unwrap_or_else(|e| e.into_inner()));
    paths.into_iter().map(|path| OpenedPath { is_dir: Path::new(&path).is_dir(), path }).collect()
}

// MARK: - Dock progress and notifications

/// The last Dock update: when, and what percent it showed.
static PROGRESS: Mutex<Option<(Instant, u64)>> = Mutex::new(None);

/// Shows a job's progress on the Dock icon (the taskbar button on Windows). Cheap to call often.
pub fn progress(app: &AppHandle, done: u64, total: u64) {
    if total == 0 {
        return;
    }
    let percent = (done.saturating_mul(100) / total).min(100);
    {
        let mut last = PROGRESS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, shown)) = *last {
            if shown == percent || (at.elapsed() < Duration::from_millis(100) && percent < 100) {
                return;
            }
        }
        *last = Some((Instant::now(), percent));
    }
    set_progress(app, Some(percent));
}

pub fn progress_done(app: &AppHandle) {
    *PROGRESS.lock().unwrap_or_else(|e| e.into_inner()) = None;
    set_progress(app, None);
}

fn set_progress(app: &AppHandle, percent: Option<u64>) {
    #[cfg(desktop)]
    {
        use tauri::window::{ProgressBarState, ProgressBarStatus};
        if let Some(window) = app.get_webview_window("main") {
            let state = match percent {
                Some(p) => ProgressBarState { status: Some(ProgressBarStatus::Normal), progress: Some(p) },
                None => ProgressBarState { status: Some(ProgressBarStatus::None), progress: None },
            };
            let _ = window.set_progress_bar(state);
        }
    }
    #[cfg(not(desktop))]
    let _ = (app, percent);
}

/// A long job finished. If the photographer is in another app, say so there and bounce the Dock
/// icon; if Deadlyne is in front, the interface's own message is enough.
pub fn finished(app: &AppHandle, title: &str, body: &str) {
    progress_done(app);
    #[cfg(desktop)]
    {
        use tauri_plugin_notification::NotificationExt;
        let Some(window) = app.get_webview_window("main") else { return };
        if window.is_focused().unwrap_or(true) {
            return;
        }
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        let _ = app.notification().builder().title(title).body(body).show();
    }
    #[cfg(not(desktop))]
    let _ = (title, body);
}

/// "1,234 photos", "1 photo".
pub fn count(n: usize, word: &str) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{out} {word}{}", if n == 1 { "" } else { "s" })
}

/// Opens a web page in the default browser.
pub fn open_url(url: &str) {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = Command::new("xdg-open").arg(url).spawn();
    let _ = result;
}

// MARK: - Menu bar

/// What the interface is showing, so the menu bar enables and checks the right items.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    pub workspace: String,
    /// A shoot folder is open in Photos (not a library list).
    pub in_folder: bool,
    /// Its contact sheet is showing, where culling keys act.
    pub photos: bool,
    pub has_photos: bool,
    /// Something to act on: the photo in the loupe, or a selection.
    pub has_targets: bool,
    pub loupe: bool,
    pub zoom: bool,
    pub caption_panel: bool,
    pub auto_advance: bool,
    pub unviewed_only: bool,
    pub tag_filter: String,
    pub file_scope: String,
    /// The library sidebar is expanded (not the rail).
    pub sidebar: bool,
}

#[derive(Deserialize)]
pub struct RecentItem {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub fn menu_state(app: AppHandle, state: MenuState) {
    #[cfg(target_os = "macos")]
    if let Some(menus) = app.try_state::<menu::Menus>() {
        menus.apply(&state);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, state);
}

#[tauri::command]
pub fn menu_recents(app: AppHandle, items: Vec<RecentItem>) {
    #[cfg(target_os = "macos")]
    if let Some(menus) = app.try_state::<menu::Menus>() {
        menus.set_recents(&app, items);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, items);
}

/// The menu bar, mirroring the original Mac app's menus. Every item is a command id the interface
/// runs (`src/lib/commands.ts`); keys are shown next to the items, and the interface still handles
/// them itself so Windows and the bare culling keys work the same way.
#[cfg(target_os = "macos")]
mod menu {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use serde::Serialize;
    use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::{AppHandle, Emitter, Manager, Wry};

    use super::{open_url, MenuState, RecentItem};

    const REPO: &str = "https://github.com/austynundrafted-lgtm/deadlyne";

    enum Handle {
        Item(MenuItem<Wry>),
        Check(CheckMenuItem<Wry>),
    }

    impl Handle {
        fn enable(&self, on: bool) {
            let _ = match self {
                Handle::Item(i) => i.set_enabled(on),
                Handle::Check(c) => c.set_enabled(on),
            };
        }
        fn check(&self, on: bool) {
            if let Handle::Check(c) = self {
                let _ = c.set_checked(on);
            }
        }
        fn text(&self, text: &str) {
            let _ = match self {
                Handle::Item(i) => i.set_text(text),
                Handle::Check(c) => c.set_text(text),
            };
        }
    }

    pub struct Menus {
        items: HashMap<&'static str, Handle>,
        recent: Submenu<Wry>,
        recent_paths: Mutex<Vec<String>>,
    }

    /// What the interface receives for a picked item.
    #[derive(Serialize, Clone)]
    struct Event {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    }

    struct Build<'a> {
        app: &'a AppHandle,
        items: HashMap<&'static str, Handle>,
    }

    impl Build<'_> {
        fn item(&mut self, id: &'static str, text: &str, accel: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
            let item = MenuItem::with_id(self.app, id, text, true, accel)?;
            self.items.insert(id, Handle::Item(item.clone()));
            Ok(item)
        }
        fn check(&mut self, id: &'static str, text: &str, accel: Option<&str>) -> tauri::Result<CheckMenuItem<Wry>> {
            let item = CheckMenuItem::with_id(self.app, id, text, true, false, accel)?;
            self.items.insert(id, Handle::Check(item.clone()));
            Ok(item)
        }
        fn sep(&self) -> tauri::Result<PredefinedMenuItem<Wry>> {
            PredefinedMenuItem::separator(self.app)
        }
    }

    pub fn install(app: &AppHandle) -> tauri::Result<()> {
        let mut b = Build { app, items: HashMap::new() };

        let about = PredefinedMenuItem::about(
            app,
            Some("About Deadlyne"),
            Some(AboutMetadata {
                name: Some("Deadlyne".into()),
                version: Some(app.package_info().version.to_string()),
                copyright: Some("© 2026 Austyn McFadden".into()),
                ..Default::default()
            }),
        )?;
        let app_menu = Submenu::with_items(
            app,
            "Deadlyne",
            true,
            &[
                &about,
                &b.sep()?,
                &b.item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
                &b.item("check-updates", "Check for Updates…", None)?,
                &b.sep()?,
                &PredefinedMenuItem::services(app, None)?,
                &b.sep()?,
                &PredefinedMenuItem::hide(app, Some("Hide Deadlyne"))?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &b.sep()?,
                &PredefinedMenuItem::quit(app, Some("Quit Deadlyne"))?,
            ],
        )?;

        let recent = Submenu::with_id(app, "recent", "Open Recent", false)?;
        let file = Submenu::with_items(
            app,
            "File",
            true,
            &[
                &b.item("open", "Open Shoot…", Some("CmdOrCtrl+O"))?,
                &recent,
                &b.item("ingest", "Ingest from Card…", Some("Shift+CmdOrCtrl+I"))?,
                &b.sep()?,
                &b.item("new-folder", "New Folder", Some("Shift+CmdOrCtrl+N"))?,
                &b.sep()?,
                &b.item("export", "Export…", Some("Shift+CmdOrCtrl+E"))?,
                &b.item("send", "Send via FTP…", Some("Shift+CmdOrCtrl+U"))?,
                &b.item("copy-tagged", "Copy Tagged Photos To…", Some("Shift+CmdOrCtrl+C"))?,
                &b.item("move-tagged", "Move Tagged Photos To…", Some("Shift+CmdOrCtrl+M"))?,
                &b.sep()?,
                &b.item("reveal", "Show in Finder", Some("Shift+CmdOrCtrl+R"))?,
                &b.item("open-default", "Open in Default App", Some("CmdOrCtrl+E"))?,
                &b.sep()?,
                &b.item("trash", "Move to Trash", Some("CmdOrCtrl+Backspace"))?,
                &b.sep()?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;

        let edit = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &b.sep()?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &b.item("select-all", "Select All", Some("CmdOrCtrl+A"))?,
                &b.item("deselect", "Deselect All", Some("CmdOrCtrl+D"))?,
                &b.item("select-tagged", "Select Tagged", Some("Shift+CmdOrCtrl+T"))?,
                &b.sep()?,
                &b.item("find", "Find", Some("CmdOrCtrl+F"))?,
            ],
        )?;

        let caption = Submenu::with_items(
            app,
            "Caption",
            true,
            &[
                &b.check("caption-panel", "Caption Panel", Some("CmdOrCtrl+I"))?,
                &b.item("edit-caption", "Edit Caption", Some("CmdOrCtrl+Enter"))?,
                &b.sep()?,
                &b.item("copy-caption", "Copy Caption Info", Some("Alt+CmdOrCtrl+C"))?,
                &b.item("paste-caption", "Paste Caption Info", Some("Alt+CmdOrCtrl+V"))?,
                &b.item("fill-credits", "Fill Credits from Profile", Some("Alt+CmdOrCtrl+P"))?,
                &b.sep()?,
                &b.item("codes", "Code Replacements", None)?,
            ],
        )?;

        // Culling keys are bare letters and digits. They stay with the interface, which knows when
        // the photographer is typing a caption, so these items carry no key of their own.
        let cull = Submenu::with_items(
            app,
            "Cull",
            true,
            &[
                &b.item("tag", "Tag or Untag", None)?,
                &b.sep()?,
                &b.item("rate:0", "No Rating", None)?,
                &b.item("rate:1", "★", None)?,
                &b.item("rate:2", "★★", None)?,
                &b.item("rate:3", "★★★", None)?,
                &b.item("rate:4", "★★★★", None)?,
                &b.item("rate:5", "★★★★★", None)?,
                &b.sep()?,
                &b.item("label:0", "Red Label", None)?,
                &b.item("label:1", "Yellow Label", None)?,
                &b.item("label:2", "Green Label", None)?,
                &b.item("label:3", "Blue Label", None)?,
                &b.item("label:none", "No Label", None)?,
                &b.sep()?,
                &b.check("auto-advance", "Auto-Advance After Rating", Some("Shift+CmdOrCtrl+A"))?,
                &b.sep()?,
                &b.item("continue", "Continue Reviewing", Some("Alt+CmdOrCtrl+R"))?,
                &b.check("unviewed", "Show Unviewed Only", Some("Alt+CmdOrCtrl+U"))?,
            ],
        )?;

        let files = Submenu::with_items(
            app,
            "Files",
            true,
            &[
                &b.check("scope:both", "RAW + JPG", Some("Alt+CmdOrCtrl+4"))?,
                &b.check("scope:raw", "RAW Only", Some("Alt+CmdOrCtrl+5"))?,
                &b.check("scope:jpeg", "JPG Only", Some("Alt+CmdOrCtrl+6"))?,
            ],
        )?;
        let view = Submenu::with_items(
            app,
            "View",
            true,
            &[
                &b.check("workspace:home", "Home", Some("CmdOrCtrl+1"))?,
                &b.check("workspace:photos", "Photos", Some("CmdOrCtrl+2"))?,
                &b.check("workspace:codes", "Codes", Some("CmdOrCtrl+3"))?,
                &b.sep()?,
                &b.check("loupe", "Loupe", None)?,
                &b.check("zoom", "Zoom to 100%", None)?,
                &b.sep()?,
                &files,
                &b.sep()?,
                &b.check("filter:all", "Show All Photos", Some("Alt+CmdOrCtrl+1"))?,
                &b.check("filter:tagged", "Show Tagged", Some("Alt+CmdOrCtrl+2"))?,
                &b.check("filter:untagged", "Show Untagged", Some("Alt+CmdOrCtrl+3"))?,
                &b.sep()?,
                &b.item("thumbs-bigger", "Larger Thumbnails", Some("CmdOrCtrl+="))?,
                &b.item("thumbs-smaller", "Smaller Thumbnails", Some("CmdOrCtrl+-"))?,
                &b.sep()?,
                &b.item("sidebar", "Hide Sidebar", Some("Alt+CmdOrCtrl+S"))?,
                &b.sep()?,
                &PredefinedMenuItem::fullscreen(app, Some("Enter Full Screen"))?,
            ],
        )?;

        let window = Submenu::with_items(
            app,
            "Window",
            true,
            &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, Some("Zoom"))?, &b.sep()?],
        )?;
        window.set_as_windows_menu_for_nsapp()?;

        let help = Submenu::with_items(
            app,
            "Help",
            true,
            &[
                &b.item("shortcuts", "Keyboard Shortcuts", None)?,
                &b.sep()?,
                &b.item("github", "Deadlyne on GitHub", None)?,
                &b.item("issue", "Report a Problem…", None)?,
            ],
        )?;
        help.set_as_help_menu_for_nsapp()?;

        let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &caption, &cull, &view, &window, &help])?;
        app.set_menu(menu)?;
        app.manage(Menus { items: b.items, recent, recent_paths: Mutex::new(Vec::new()) });

        app.on_menu_event(|app, event| {
            let id: &str = event.id().as_ref();
            match id {
                "github" => open_url(REPO),
                "issue" => open_url(&format!("{REPO}/issues/new")),
                _ if id.starts_with("recent:") => {
                    let path = id[7..].parse::<usize>().ok().and_then(|i| {
                        app.state::<Menus>().recent_paths.lock().unwrap_or_else(|e| e.into_inner()).get(i).cloned()
                    });
                    if let Some(path) = path {
                        let _ = app.emit("menu", Event { id: "open-recent".into(), path: Some(path) });
                    }
                }
                _ => {
                    let _ = app.emit("menu", Event { id: id.to_string(), path: None });
                }
            }
        });
        Ok(())
    }

    impl Menus {
        pub fn apply(&self, s: &MenuState) {
            let on = |id: &str, v: bool| {
                if let Some(h) = self.items.get(id) {
                    h.enable(v);
                }
            };
            let checked = |id: &str, v: bool| {
                if let Some(h) = self.items.get(id) {
                    h.check(v);
                }
            };
            let targets = s.photos && s.has_targets;
            on("new-folder", s.in_folder);
            on("caption-panel", s.in_folder);
            for id in ["export", "send", "copy-tagged", "move-tagged", "select-tagged"] {
                on(id, s.has_photos);
            }
            for id in [
                "reveal", "open-default", "trash", "edit-caption", "copy-caption", "paste-caption", "fill-credits", "tag", "rate:0",
                "rate:1", "rate:2", "rate:3", "rate:4", "rate:5", "label:0", "label:1", "label:2", "label:3", "label:none", "loupe", "zoom",
            ] {
                on(id, targets);
            }
            for id in [
                "deselect", "filter:all", "filter:tagged", "filter:untagged", "scope:both", "scope:raw", "scope:jpeg", "thumbs-bigger",
                "thumbs-smaller", "continue", "unviewed", "auto-advance",
            ] {
                on(id, s.photos);
            }
            on("sidebar", s.workspace == "photos");
            for w in ["home", "photos", "codes"] {
                checked(&format!("workspace:{w}"), s.workspace == w);
            }
            for f in ["all", "tagged", "untagged"] {
                checked(&format!("filter:{f}"), s.tag_filter == f);
            }
            for f in ["both", "raw", "jpeg"] {
                checked(&format!("scope:{f}"), s.file_scope == f);
            }
            checked("caption-panel", s.caption_panel);
            checked("auto-advance", s.auto_advance);
            checked("unviewed", s.unviewed_only);
            checked("loupe", s.loupe);
            checked("zoom", s.zoom);
            if let Some(h) = self.items.get("sidebar") {
                h.text(if s.sidebar { "Hide Sidebar" } else { "Show Sidebar" });
            }
        }

        pub fn set_recents(&self, app: &AppHandle, items: Vec<RecentItem>) {
            for old in self.recent.items().unwrap_or_default() {
                let _ = self.recent.remove(&old);
            }
            let mut paths = Vec::with_capacity(items.len());
            for (i, r) in items.iter().enumerate() {
                if let Ok(item) = MenuItem::with_id(app, format!("recent:{i}"), &r.name, true, None::<&str>) {
                    let _ = self.recent.append(&item);
                }
                paths.push(r.path.clone());
            }
            let _ = self.recent.set_enabled(!paths.is_empty());
            *self.recent_paths.lock().unwrap_or_else(|e| e.into_inner()) = paths;
        }
    }
}
