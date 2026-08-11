//! The camera button (m8): capture a screenshot and hand its PATH back to the
//! frontend, which types it into the operator's chat box - Claude Code reads
//! images by path, so the path IS the delivery.
//!
//! Platform honesty: on Wayland NO application may read screen pixels
//! directly - the compositor forbids it by design, for every app including
//! gnome-screenshot itself. The one sanctioned door is the XDG Desktop
//! Portal (`org.freedesktop.portal.Screenshot`), a cross-desktop standard
//! (GNOME/KDE/wlroots) that also works under X11. BAUD ships its own portal
//! CLIENT (`ashpd`, pure Rust over D-Bus) - no external binaries, nothing
//! shelled out - which is the self-contained doctrine expressed within what
//! the platform allows.
//!
//! The `interactive` request opens the compositor's own picker - region,
//! window, or full screen, the operator chooses - so region-select arrives
//! for free instead of us building an overlay. The portal saves the capture
//! to its own temp location; we copy it into the operator's Pictures/BAUD
//! and report OUR copy, because the portal may clean its temp file up later.
//!
//! Cross-platform seam: macOS/Windows have no portal; direct capture there
//! is legal (`xcap` is the candidate crate) and slots in behind the same
//! command when the cross-platform milestone lands. Until then non-Linux
//! answers with an honest error instead of a silent no-op.

use std::path::{Path, PathBuf};

/// Where captures land: `~/Pictures/BAUD/baud-<stamp>.png`. The operator's
/// own space - visible, reusable, never hidden in an app-data dir.
fn capture_destination(pictures_dir: &Path, stamp: &str) -> PathBuf {
    pictures_dir.join("BAUD").join(format!("baud-{stamp}.png"))
}

/// `file://` URI -> filesystem path. The portal answers with a URI; percent
/// escapes (spaces become %20) must be undone or the copy misses the file.
fn uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let raw = uri
        .strip_prefix("file://")
        .ok_or_else(|| format!("portal returned a non-file URI: {uri}"))?;
    Ok(PathBuf::from(percent_decode(raw)))
}

/// Minimal percent-decoding - enough for filesystem URIs. Invalid escapes
/// pass through untouched rather than corrupting the path.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(hex) = bytes.get(i + 1..i + 3) {
                if let Ok(value) = u8::from_str_radix(&String::from_utf8_lossy(hex), 16) {
                    out.push(value);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Take a screenshot via the operator's compositor and return the saved
/// path. Slow by design - the operator is inside the system picker choosing
/// region/window/screen - so the command is async and the frontend must not
/// block on it.
#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub async fn screenshot_capture(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let response = ashpd::desktop::screenshot::Screenshot::request()
        .interactive(true)
        .modal(false)
        .send()
        .await
        .map_err(|err| format!("screenshot portal request failed: {err}"))?
        .response()
        .map_err(|err| format!("screenshot cancelled or refused: {err}"))?;

    let source = uri_to_path(response.uri().as_str())?;

    let pictures = app
        .path()
        .picture_dir()
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Pictures"));
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let destination = capture_destination(&pictures, &stamp);

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("could not create {}: {err}", parent.display()))?;
    }
    std::fs::copy(&source, &destination)
        .map_err(|err| format!("could not copy capture into place: {err}"))?;
    // The portal's temp copy is its own to clean up - we never delete.

    Ok(destination.display().to_string())
}

/// The cross-platform seam, stated honestly: direct capture (xcap) belongs
/// here when the cross-platform milestone lands. Until then the button
/// reports why instead of pretending.
#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub async fn screenshot_capture(_app: tauri::AppHandle) -> Result<String, String> {
    Err("screenshot capture is Linux-only for now - the xcap seam lands with the cross-platform milestone".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_lands_in_pictures_baud() {
        let dest = capture_destination(Path::new("/home/op/Pictures"), "20260810-225900");
        assert_eq!(
            dest,
            PathBuf::from("/home/op/Pictures/BAUD/baud-20260810-225900.png")
        );
    }

    #[test]
    fn file_uri_round_trips_including_escaped_spaces() {
        // GNOME's portal answers with percent-escaped URIs.
        assert_eq!(
            uri_to_path("file:///tmp/Screenshot%20From%202026.png").unwrap(),
            PathBuf::from("/tmp/Screenshot From 2026.png")
        );
        assert_eq!(
            uri_to_path("file:///tmp/plain.png").unwrap(),
            PathBuf::from("/tmp/plain.png")
        );
    }

    #[test]
    fn non_file_uris_are_refused_not_mangled() {
        assert!(uri_to_path("clipboard://data").is_err());
    }

    #[test]
    fn invalid_percent_escapes_pass_through() {
        assert_eq!(percent_decode("100%25 done"), "100% done");
        assert_eq!(percent_decode("50%zz"), "50%zz");
        assert_eq!(percent_decode("trailing%"), "trailing%");
    }
}
