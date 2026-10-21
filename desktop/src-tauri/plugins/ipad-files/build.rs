const COMMANDS: &[&str] = &["pick_folder", "pick_files", "restore_access", "preview", "share"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
