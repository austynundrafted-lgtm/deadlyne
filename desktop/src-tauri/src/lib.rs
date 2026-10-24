//! Deadlyne desktop (macOS + Windows). The Rust side does everything that touches files and
//! must be fast: RAW preview extraction, EXIF, sidecars and thumbnails. The React interface
//! (`../src`) talks to it through the commands registered below and the `thumb://` and
//! `preview://` image schemes. `native.rs` is the menu bar, Finder and Dock integration.

mod achievements;
mod captions;
mod codes;
mod exif;
mod export;
mod fileops;
mod folder;
mod ftp;
mod images;
mod ingest;
mod iptc;
mod jobs;
mod jpeg_meta;
mod library;
mod native;
mod raw;
mod xmp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(native::Opened::default());

    #[cfg(desktop)]
    let builder = {
        use tauri_plugin_window_state::StateFlags;
        builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_notification::init())
            // The window comes back where it was left, on the display it was left on.
            .plugin(
                tauri_plugin_window_state::Builder::new()
                    .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN)
                    .build(),
            )
    };
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_ipad_files::init());

    let app = builder
        .setup(|app| {
            native::setup(app.handle());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("thumb", |_ctx, request, responder| {
            images::serve(request, responder, images::Kind::Thumb)
        })
        .register_asynchronous_uri_scheme_protocol("preview", |_ctx, request, responder| {
            images::serve(request, responder, images::Kind::Preview)
        })
        .invoke_handler(tauri::generate_handler![folder::scan_folder, folder::load_details, xmp::save_culling, captions::save_captions,
            codes::code_lists, codes::save_code_list, codes::create_code_list, codes::import_code_lists,
            codes::rename_code_list, codes::trash_code_list, codes::code_lists_folder,
            fileops::transfer_photos, fileops::trash_photos, fileops::reveal, fileops::open_files,
            export::export_photos, export::export_cancel,
            ingest::memory_cards, ingest::inspect_source, ingest::free_space, ingest::start_ingest, ingest::cancel_ingest,
            ftp::ftp_set_password, ftp::ftp_has_password, ftp::ftp_test, ftp::ftp_send, ftp::ftp_cancel,
            achievements::achievements, achievements::record_folder_opened,
            library::viewing_load, library::viewing_mark, library::viewing_reset, library::viewing_transfer, library::viewing_relocate,
            library::folder_stats, library::folder_contents, library::docs_info, library::add_documents, library::move_documents,
            library::create_folder, library::rename_path, library::trash_path, library::quick_look,
            native::take_opened_paths, native::menu_state, native::menu_recents])
        .build(tauri::generate_context!())
        .expect("error while building Deadlyne");

    app.run(|app, event| {
        // Finder's "Open With", a folder dropped on the Dock icon, or `open -a Deadlyne <folder>`.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            native::queue_opened(app, urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()));
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
