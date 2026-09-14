fn main() {
    // tauri-build prepares the window's context. baud-cli has no window, so a
    // build without the gui feature never runs it - or compiles it.
    #[cfg(feature = "gui")]
    tauri_build::build();
}
