//! BAUD's own Chrome: a detached tmux room running Chrome with remote
//! debugging on loopback, its open pages read over the DevTools HTTP list.
//! Reference: docs/desktop/browser.md
//!
//! Chrome 136+ refuses remote debugging on the default user-data-dir, so the
//! profile lives at `<BAUD config dir>/chrome`: fresh, or a one-time copy of
//! `~/.config/google-chrome` made by `browser_adopt`. Linux only.

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct BrowserTarget {
    pub id: String,
    pub title: String,
    pub url: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct BrowserStatus {
    /// `running`, `down`, `foreign` or `stale`.
    pub state: &'static str,
    pub port: u16,
    pub profile: String,
    pub room_alive: bool,
    pub targets: Vec<BrowserTarget>,
    /// `linked`, `present` or `absent`.
    pub native_hosts: &'static str,
    pub detail: String,
}

#[cfg(target_os = "linux")]
fn profile_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("chrome"))
        .map_err(|err| format!("no config dir for BAUD: {err}"))
}

#[cfg(target_os = "linux")]
fn user_chrome_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/google-chrome")
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn browser_status(app: tauri::AppHandle) -> Result<BrowserStatus, String> {
    Ok(linux::status(&profile_dir(&app)?))
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn browser_launch(app: tauri::AppHandle) -> Result<BrowserStatus, String> {
    linux::launch(&profile_dir(&app)?, &user_chrome_dir().join("NativeMessagingHosts"))
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn browser_adopt(app: tauri::AppHandle) -> Result<BrowserStatus, String> {
    linux::adopt(&profile_dir(&app)?, &user_chrome_dir())
}

#[cfg(not(target_os = "linux"))]
const NOT_LINUX: &str = "BAUD's Chrome is Linux-only for now - the room, the profile path and the binary are Linux's";

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn browser_status() -> Result<BrowserStatus, String> {
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn browser_launch() -> Result<BrowserStatus, String> {
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn browser_adopt() -> Result<BrowserStatus, String> {
    Err(NOT_LINUX.into())
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{BrowserStatus, BrowserTarget};
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, SocketAddr, TcpStream};
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    pub(super) const ROOM: &str = "baud-chrome";
    pub(super) const PORT: u16 = 9333;
    const MANIFEST: &str = "com.anthropic.claude_code_browser_extension.json";
    const FOREIGN: &str = "port 9333 is held by a Chrome BAUD did not launch; close it or change nothing, BAUD will not adopt it";
    const READY_WINDOW: Duration = Duration::from_secs(10);
    const READY_STEP: Duration = Duration::from_millis(200);
    /// Skipped by name at any depth: the locks belong to the running Chrome, the caches rebuild, and the
    /// native-hosts dir is linked after the copy rather than copied, so a reinstalled manifest is still seen.
    const SKIPPED: [&str; 7] =
        ["SingletonLock", "SingletonSocket", "SingletonCookie", "Cache", "Code Cache", "GPUCache", "NativeMessagingHosts"];

    static LAUNCHING: Mutex<()> = Mutex::new(());

    pub(super) fn judge(room_alive: bool, port_answers: bool) -> &'static str {
        match (room_alive, port_answers) {
            (true, true) => "running",
            (false, false) => "down",
            (false, true) => "foreign",
            (true, false) => "stale",
        }
    }

    /// One tmux invocation, argv only: `remain-on-exit` keeps a crashed Chrome's last words readable as `stale`.
    pub(super) fn launch_argv(chrome: &str, profile: &Path) -> Vec<String> {
        let exact = format!("={ROOM}:");
        [
            "new-session", "-d", "-s", ROOM, "--", chrome,
            &format!("--user-data-dir={}", profile.display()),
            &format!("--remote-debugging-port={PORT}"),
            "--no-first-run", "--no-default-browser-check",
            ";", "set-option", "-t", &exact, "remain-on-exit", "on",
        ]
        .iter()
        .map(|arg| arg.to_string())
        .collect()
    }

    pub(super) fn skipped(name: &std::ffi::OsStr) -> bool {
        SKIPPED.iter().any(|skip| name == *skip)
    }

    fn tmux(args: &[&str]) -> Option<String> {
        let out = Command::new("tmux").args(args).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn room_alive() -> bool {
        tmux(&["has-session", "-t", &format!("={ROOM}")]).is_some()
    }

    fn pane_tail() -> String {
        let text = tmux(&["capture-pane", "-p", "-t", &format!("={ROOM}:")]).unwrap_or_default();
        let lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
        lines[lines.len().saturating_sub(12)..].join("\n")
    }

    fn pane_dead() -> bool {
        tmux(&["display-message", "-p", "-t", &format!("={ROOM}:"), "#{pane_dead}"]).is_some_and(|out| out.trim() == "1")
    }

    /// Loopback only, by construction: the address is a literal, never a name or a setting.
    fn devtools_get(path: &str) -> Option<String> {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, PORT));
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(300)).ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
        write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n").ok()?;
        // Chrome holds the socket open past the body, so the read stops at Content-Length, not at EOF.
        let mut raw = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let read = stream.read(&mut chunk).ok()?;
            raw.extend_from_slice(&chunk[..read]);
            if let Some(body) = complete_body(&raw) {
                return body;
            }
            if read == 0 {
                return None;
            }
        }
    }

    /// `None` while more bytes are due; `Some(None)` for a non-200 answer.
    pub(super) fn complete_body(raw: &[u8]) -> Option<Option<String>> {
        let split = raw.windows(4).position(|window| window == b"\r\n\r\n")?;
        let head = String::from_utf8_lossy(&raw[..split]);
        let body = &raw[split + 4..];
        if !head.starts_with("HTTP/1.1 200") {
            return Some(None);
        }
        let length: usize = head
            .lines()
            .find_map(|line| line.split_once(':').filter(|(name, _)| name.eq_ignore_ascii_case("content-length")))
            .and_then(|(_, value)| value.trim().parse().ok())?;
        (body.len() >= length).then(|| Some(String::from_utf8_lossy(&body[..length]).into_owned()))
    }

    pub(super) fn page_targets(list: &str) -> Vec<BrowserTarget> {
        let Ok(serde_json::Value::Array(items)) = serde_json::from_str(list) else { return Vec::new() };
        let field = |item: &serde_json::Value, key: &str| item[key].as_str().unwrap_or_default().to_string();
        items
            .iter()
            .filter(|item| item["type"] == "page")
            .map(|item| BrowserTarget { id: field(item, "id"), title: field(item, "title"), url: field(item, "url") })
            .collect()
    }

    pub(super) fn native_hosts(profile: &Path) -> &'static str {
        let dir = profile.join("NativeMessagingHosts");
        if !dir.join(MANIFEST).exists() {
            "absent"
        } else if dir.is_symlink() {
            "linked"
        } else {
            "present"
        }
    }

    pub(super) fn status(profile: &Path) -> BrowserStatus {
        let alive = room_alive();
        let answers = devtools_get("/json/version").is_some();
        let state = judge(alive, answers);
        let targets = if state == "running" {
            devtools_get("/json/list").map(|list| page_targets(&list)).unwrap_or_default()
        } else {
            Vec::new()
        };
        let detail = match state {
            "foreign" => FOREIGN.to_string(),
            "stale" => pane_tail(),
            _ => String::new(),
        };
        BrowserStatus {
            state,
            port: PORT,
            profile: profile.display().to_string(),
            room_alive: alive,
            targets,
            native_hosts: native_hosts(profile),
            detail,
        }
    }

    fn chrome_binary() -> Option<PathBuf> {
        let path = std::env::var_os("PATH")?;
        ["google-chrome", "google-chrome-stable"]
            .iter()
            .find_map(|name| std::env::split_paths(&path).map(|dir| dir.join(name)).find(|bin| bin.is_file()))
    }

    /// Chrome reads native-messaging manifests from its user-data-dir, so without this the extension cannot reach Claude Code.
    pub(super) fn link_native_hosts(profile: &Path, source: &Path) -> Result<(), String> {
        let link = profile.join("NativeMessagingHosts");
        if !source.is_dir() || link.symlink_metadata().is_ok() {
            return Ok(());
        }
        std::os::unix::fs::symlink(source, &link).map_err(|err| format!("could not link {}: {err}", link.display()))
    }

    pub(super) fn launch(profile: &Path, hosts_source: &Path) -> Result<BrowserStatus, String> {
        let _held = LAUNCHING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let before = status(profile);
        match before.state {
            "running" | "foreign" => return Ok(before),
            "stale" if !pane_dead() => return Ok(before),
            // A dead pane is a Chrome that exited; the room it leaves is cleared so this press can start one.
            "stale" => {
                tmux(&["kill-session", "-t", &format!("={ROOM}")]);
            }
            _ => {}
        }

        std::fs::create_dir_all(profile).map_err(|err| format!("could not create {}: {err}", profile.display()))?;
        link_native_hosts(profile, hosts_source)?;
        let chrome = chrome_binary().ok_or("neither google-chrome nor google-chrome-stable is on PATH")?;
        let out = Command::new("tmux")
            .args(launch_argv(&chrome.display().to_string(), profile))
            .output()
            .map_err(|err| format!("could not run tmux: {err}"))?;
        if !out.status.success() {
            return Err(format!("tmux refused the room: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }

        let started = Instant::now();
        while started.elapsed() < READY_WINDOW {
            if devtools_get("/json/version").is_some() {
                return Ok(status(profile));
            }
            std::thread::sleep(READY_STEP);
        }
        let mut late = status(profile);
        if late.state == "down" {
            late.detail = "Chrome exited before its port answered, and its room went with it".into();
        }
        Ok(late)
    }

    fn chrome_running() -> bool {
        let Ok(entries) = std::fs::read_dir("/proc") else { return false };
        entries.flatten().any(|entry| {
            std::fs::read_to_string(entry.path().join("comm")).is_ok_and(|comm| comm.trim() == "chrome")
        })
    }

    /// Never follows a link and never overwrites: the destination only ever gains entries.
    pub(super) fn copy_tree(from: &Path, to: &Path, bytes: &mut u64) -> std::io::Result<()> {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            if skipped(&entry.file_name()) {
                continue;
            }
            let dest = to.join(entry.file_name());
            if dest.symlink_metadata().is_ok() {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                copy_tree(&entry.path(), &dest, bytes)?;
            } else if kind.is_symlink() {
                std::os::unix::fs::symlink(std::fs::read_link(entry.path())?, &dest)?;
            } else if kind.is_file() {
                *bytes += std::fs::copy(entry.path(), &dest)?;
            }
        }
        Ok(())
    }

    pub(super) fn adopt_refusal(room_alive: bool, chrome_running: bool) -> Option<&'static str> {
        if room_alive {
            Some("BAUD's Chrome room is open; close it first, so the profile is not in use")
        } else if chrome_running {
            Some("Chrome is running; close every Chrome window first, so the copy is consistent")
        } else {
            None
        }
    }

    /// A rename, never a delete; the copy then lands in a fresh dir, so no old link can lead it into the source.
    pub(super) fn set_aside(profile: &Path, stamp: &str) -> Result<Option<PathBuf>, String> {
        if profile.symlink_metadata().is_err() {
            return Ok(None);
        }
        let aside = PathBuf::from(format!("{}.before-adopt-{stamp}", profile.display()));
        std::fs::rename(profile, &aside).map_err(|err| format!("could not move {} aside: {err}", profile.display()))?;
        Ok(Some(aside))
    }

    pub(super) fn adopt(profile: &Path, source: &Path) -> Result<BrowserStatus, String> {
        if let Some(refusal) = adopt_refusal(room_alive(), chrome_running()) {
            return Err(refusal.into());
        }
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let aside = set_aside(profile, &stamp)?;
        let started = Instant::now();
        let mut bytes = 0;
        copy_tree(source, profile, &mut bytes).map_err(|err| format!("the copy stopped: {err}"))?;
        let seconds = started.elapsed().as_secs_f64();
        let mut answer = launch(profile, &source.join("NativeMessagingHosts"))?;
        let mut said = format!("copied {bytes} bytes in {seconds:.1} s");
        if let Some(aside) = aside {
            said = format!("{said}; the previous profile is at {}", aside.display());
        }
        answer.detail = if answer.detail.is_empty() { said } else { format!("{said}; {}", answer.detail) };
        Ok(answer)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::ffi::OsStr;

        fn scratch(tag: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!("baud-browser-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            dir
        }

        #[test]
        fn argv_carries_every_flag_as_its_own_word() {
            let argv = launch_argv("/usr/bin/google-chrome", Path::new("/home/op/.config/x y/chrome"));
            assert_eq!(&argv[..6], ["new-session", "-d", "-s", "baud-chrome", "--", "/usr/bin/google-chrome"]);
            assert!(argv.contains(&"--user-data-dir=/home/op/.config/x y/chrome".to_string()));
            assert!(argv.contains(&"--remote-debugging-port=9333".to_string()));
            assert!(argv.contains(&"--no-first-run".to_string()));
            assert!(argv.contains(&"--no-default-browser-check".to_string()));
            assert!(argv.ends_with(&["set-option", "-t", "=baud-chrome:", "remain-on-exit", "on"].map(String::from)));
            assert!(!argv.iter().any(|arg| arg.contains("sh -c") || arg.contains('\'')));
        }

        #[test]
        fn four_states_from_room_and_port() {
            assert_eq!(judge(true, true), "running");
            assert_eq!(judge(false, false), "down");
            assert_eq!(judge(false, true), "foreign");
            assert_eq!(judge(true, false), "stale");
        }

        #[test]
        fn skip_list_is_locks_and_caches_only() {
            for name in SKIPPED {
                assert!(skipped(OsStr::new(name)));
            }
            for name in ["Default", "Local State", "Cookies", "Cache Storage"] {
                assert!(!skipped(OsStr::new(name)));
            }
        }

        #[test]
        fn copy_skips_caches_and_locks_and_counts_bytes() {
            let root = scratch("copy");
            let from = root.join("from");
            std::fs::create_dir_all(from.join("Default/Cache")).unwrap();
            std::fs::create_dir_all(from.join("Default/Code Cache")).unwrap();
            std::fs::write(from.join("Default/Cache/blob"), b"x").unwrap();
            std::fs::write(from.join("Default/Cookies"), b"abcd").unwrap();
            std::fs::write(from.join("Local State"), b"{}").unwrap();
            std::os::unix::fs::symlink("host-123", from.join("SingletonLock")).unwrap();
            let to = root.join("to");
            let mut bytes = 0;
            copy_tree(&from, &to, &mut bytes).unwrap();
            assert_eq!(bytes, 6);
            assert!(to.join("Default/Cookies").is_file());
            assert!(!to.join("Default/Cache").exists());
            assert!(!to.join("Default/Code Cache").exists());
            assert!(to.join("SingletonLock").symlink_metadata().is_err());
            std::fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn adopt_refuses_only_while_the_room_or_any_chrome_runs() {
            assert!(adopt_refusal(true, false).unwrap().contains("room"));
            assert!(adopt_refusal(false, true).unwrap().contains("Chrome is running"));
            assert!(adopt_refusal(true, true).is_some());
            assert_eq!(adopt_refusal(false, false), None);
        }

        #[test]
        fn an_existing_profile_is_renamed_aside_intact() {
            let root = scratch("aside");
            let profile = root.join("chrome");
            std::fs::create_dir_all(profile.join("Default")).unwrap();
            std::fs::write(profile.join("Default/Cookies"), b"kept").unwrap();
            let source = root.join("hosts");
            std::fs::create_dir_all(&source).unwrap();
            std::os::unix::fs::symlink(&source, profile.join("NativeMessagingHosts")).unwrap();

            let aside = set_aside(&profile, "20261027T232000Z").unwrap().unwrap();
            assert_eq!(aside, root.join("chrome.before-adopt-20261027T232000Z"));
            assert!(profile.symlink_metadata().is_err());
            assert_eq!(std::fs::read(aside.join("Default/Cookies")).unwrap(), b"kept");
            assert!(aside.join("NativeMessagingHosts").is_symlink());
            assert!(source.is_dir());
            assert_eq!(set_aside(&profile, "x").unwrap(), None);
            std::fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn native_hosts_are_linked_once_and_read_back() {
            let root = scratch("hosts");
            let source = root.join("NativeMessagingHosts");
            std::fs::create_dir_all(&source).unwrap();
            std::fs::write(source.join(MANIFEST), b"{}").unwrap();
            let profile = root.join("chrome");
            std::fs::create_dir_all(&profile).unwrap();
            assert_eq!(native_hosts(&profile), "absent");
            link_native_hosts(&profile, &source).unwrap();
            assert_eq!(native_hosts(&profile), "linked");
            link_native_hosts(&profile, &source).unwrap();
            assert_eq!(native_hosts(&root), "present");
            assert_eq!(native_hosts(&root.join("nowhere")), "absent");
            std::fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn pages_are_normalized_and_workers_dropped() {
            let list = r#"[{"id":"A","type":"page","title":"T","url":"https://a/","webSocketDebuggerUrl":"ws://x"},
                           {"id":"B","type":"service_worker","title":"W","url":"chrome-extension://w"}]"#;
            assert_eq!(page_targets(list), vec![BrowserTarget { id: "A".into(), title: "T".into(), url: "https://a/".into() }]);
            assert!(page_targets("not json").is_empty());
        }

        #[test]
        fn a_body_is_complete_at_its_content_length() {
            assert_eq!(complete_body(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n{}"), None);
            assert_eq!(complete_body(b"HTTP/1.1 200 OK\r\ncontent-length:2\r\n\r\n{}"), Some(Some("{}".into())));
            assert_eq!(complete_body(b"HTTP/1.1 500 Internal\r\nContent-Length: 0\r\n\r\n"), Some(None));
            assert_eq!(complete_body(b"HTTP/1.1 200 OK\r\nContent-"), None);
        }

        /// Live: launches a real Chrome in the `baud-chrome` room on port 9333 with a profile from
        /// `BAUD_BROWSER_PROOF_PROFILE`. Run alone with `cargo test -- --ignored live_launch_lists_pages`.
        #[test]
        #[ignore]
        fn live_launch_lists_pages() {
            let profile = PathBuf::from(std::env::var("BAUD_BROWSER_PROOF_PROFILE").expect("a throwaway profile dir"));
            let answer = launch(&profile, &profile.join("no-hosts")).unwrap();
            println!("{answer:#?}");
            assert_eq!(answer.state, "running", "{}", answer.detail);
        }
    }
}
