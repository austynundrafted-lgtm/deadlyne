fn main() {
    println!("cargo:rerun-if-env-changed=VITE_APP_CHANNEL");
    if std::env::var_os("CARGO_FEATURE_MAC_APP_STORE").is_some() {
        assert_eq!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("macos"), "The Mac App Store feature requires a macOS target");
        assert!(std::env::var_os("CARGO_FEATURE_SELF_UPDATE").is_none(), "Store builds must use --no-default-features; the self-updater cannot ship in the store");
        assert!(std::env::var_os("CARGO_FEATURE_DESKTOP_NOTIFICATIONS").is_none(), "Store builds use the public UserNotifications API instead of the legacy desktop notification backend");
        // Unit tests do not build a frontend. A packaged store build additionally checks the
        // frontend channel in scripts/build-mac-store.mjs and verifies the finished bundle.
    }
    let attributes = if std::env::var_os("CARGO_FEATURE_MAC_APP_STORE").is_some() {
        println!("cargo:rerun-if-changed=capabilities/mac-app-store.json");
        tauri_build::Attributes::new().capabilities_path_pattern("capabilities/mac-app-store.json")
    } else {
        tauri_build::Attributes::new()
    };
    tauri_build::try_build(attributes).expect("Tauri build configuration");
}
