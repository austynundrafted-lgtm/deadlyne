//! Deadlyne desktop (macOS + Windows). The Rust side does everything that touches files and
//! must be fast: RAW preview extraction, EXIF, sidecars and thumbnails. The React interface
//! (`../src`) talks to it through the commands registered below and the `thumb://` and
//! `preview://` image schemes.

mod exif;
mod folder;
mod images;
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
        .invoke_handler(tauri::generate_handler![folder::scan_folder, folder::load_details, folder::launch_folder, xmp::save_culling])
        .run(tauri::generate_context!())
        .expect("error while running Deadlyne");
}
