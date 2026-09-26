//! Deadlyne desktop (macOS + Windows). The Rust side does everything that touches files and
//! must be fast: RAW preview extraction, EXIF, sidecars and thumbnails. The React interface
//! (`../src`) talks to it through the commands registered below and the `thumb://` and
//! `preview://` image schemes.

mod achievements;
mod captions;
mod codes;
mod exif;
mod fileops;
mod folder;
mod ftp;
mod images;
mod ingest;
mod iptc;
mod jobs;
mod jpeg_meta;
mod raw;
mod xmp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .register_asynchronous_uri_scheme_protocol("thumb", |_ctx, request, responder| {
            images::serve(request, responder, images::Kind::Thumb)
        })
        .register_asynchronous_uri_scheme_protocol("preview", |_ctx, request, responder| {
            images::serve(request, responder, images::Kind::Preview)
        })
        .invoke_handler(tauri::generate_handler![folder::scan_folder, folder::load_details, folder::launch_folder, xmp::save_culling, captions::save_captions,
            codes::code_lists, codes::save_code_list, codes::create_code_list, codes::import_code_lists,
            codes::rename_code_list, codes::trash_code_list, codes::code_lists_folder,
            fileops::transfer_photos, fileops::trash_photos, fileops::reveal, fileops::open_files,
            ingest::memory_cards, ingest::inspect_source, ingest::free_space, ingest::start_ingest, ingest::cancel_ingest,
            ftp::ftp_set_password, ftp::ftp_has_password, ftp::ftp_test, ftp::ftp_send, ftp::ftp_cancel,
            achievements::achievements, achievements::record_folder_opened])
        .run(tauri::generate_context!())
        .expect("error while running Deadlyne");
}
