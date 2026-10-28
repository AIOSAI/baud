//! BAUD's own Chrome: a detached tmux room running Chrome with remote
//! debugging on loopback, its open pages read over the DevTools HTTP list.
//! Reference: docs/desktop/browser.md
//!
//! Chrome 136+ refuses remote debugging on the default user-data-dir, so the
//! profile lives at `<BAUD config dir>/chrome`: fresh, or a one-time copy of
//! `~/.config/google-chrome` made by `browser_adopt`. Linux only.
//!
//! A view is one page's screencast: Rust owns the page's DevTools socket, because the
//! DevTools server refuses any socket that carries an Origin, and the webview's always does.

use serde::{Deserialize, Serialize};

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

/// One view's stream to the webview.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BrowserEvent {
    /// `data` is the JPEG as base64; the sizes are CSS pixels, the space input coordinates live in.
    Frame { data: String, device_width: f64, device_height: f64, page_scale: f64, scroll_x: f64, scroll_y: f64 },
    Visibility { visible: bool },
    Closed { reason: String },
}

/// Only these two Input methods cross; the params are CDP's own, built by the webview.
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", content = "params", rename_all = "lowercase")]
pub enum BrowserInput {
    Mouse(serde_json::Value),
    Key(serde_json::Value),
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

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn browser_view_open(target_id: String, on_event: tauri::ipc::Channel<BrowserEvent>) -> Result<String, String> {
    linux::view_open(linux::PORT, &target_id, move |event| on_event.send(event).is_ok())
}

/// Ends BAUD's stream only; the page stays open in Chrome.
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn browser_view_close(view_id: String) {
    linux::view_close(&view_id);
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn browser_input(view_id: String, event: BrowserInput) -> Result<(), String> {
    let (method, params) = match event {
        BrowserInput::Mouse(params) => ("Input.dispatchMouseEvent", params),
        BrowserInput::Key(params) => ("Input.dispatchKeyEvent", params),
    };
    linux::view_send(&view_id, method, params)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn browser_navigate(view_id: String, url: String) -> Result<(), String> {
    linux::view_send(&view_id, "Page.navigate", serde_json::json!({ "url": url }))
}

#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn browser_new_tab() -> Result<BrowserTarget, String> {
    linux::new_tab(linux::PORT)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn browser_history(view_id: String, step: i32) -> Result<(), String> {
    let expression = linux::history_expression(step).ok_or("a history step of 0 goes nowhere")?;
    // Only this fixed `history.go(-1|1)` ever goes through Runtime, never user text: the IPC surface stays the typed verb.
    linux::view_send(&view_id, "Runtime.evaluate", serde_json::json!({ "expression": expression }))
}

/// Closes the page in Chrome; a view on it ends through `Inspector.detached`.
#[cfg(target_os = "linux")]
#[tauri::command(async)]
pub fn browser_close_tab(target_id: String) -> Result<(), String> {
    linux::close_tab(linux::PORT, &target_id)
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

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn browser_view_open(target_id: String, on_event: tauri::ipc::Channel<BrowserEvent>) -> Result<String, String> {
    let _ = (target_id, on_event);
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn browser_view_close(view_id: String) {
    let _ = view_id;
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn browser_input(view_id: String, event: BrowserInput) -> Result<(), String> {
    let _ = (view_id, event);
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn browser_navigate(view_id: String, url: String) -> Result<(), String> {
    let _ = (view_id, url);
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn browser_new_tab() -> Result<BrowserTarget, String> {
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn browser_history(view_id: String, step: i32) -> Result<(), String> {
    let _ = (view_id, step);
    Err(NOT_LINUX.into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command(async)]
pub fn browser_close_tab(target_id: String) -> Result<(), String> {
    let _ = target_id;
    Err(NOT_LINUX.into())
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{BrowserEvent, BrowserStatus, BrowserTarget};
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, SocketAddr, TcpStream};
    use std::path::{Path, PathBuf};
    use serde_json::{json, Value};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{mpsc, Mutex};
    use tungstenite::{Message, WebSocket};
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
    /// A headed window behind BAUD paints nothing, so the screencast freezes; headless paints always but the Claude
    /// extension never pairs headless. With `xvfb` (its `xvfb-run` path) Chrome is headed on a display nothing covers.
    /// `agent` is `None` when Chrome's version could not be read: the launch goes on with Chrome's own.
    pub(super) fn launch_argv(chrome: &str, profile: &Path, agent: Option<&str>, xvfb: Option<&str>) -> Vec<String> {
        let exact = format!("={ROOM}:");
        let agent = agent.map(|agent| format!("--user-agent={agent}"));
        let (data, port) = (format!("--user-data-dir={}", profile.display()), format!("--remote-debugging-port={PORT}"));
        let mut argv = vec!["new-session", "-d", "-s", ROOM, "--"];
        match xvfb {
            // Wayland is in the room's environment, so x11 must be named or Chrome ignores the virtual display.
            Some(xvfb) => argv.extend([xvfb, "-a", "-s", "-screen 0 1280x800x24", chrome, &data, &port, "--ozone-platform=x11"]),
            None => argv.extend([chrome, &data, &port, "--headless=new"]),
        }
        argv.extend(["--window-size=1280,800", "--no-first-run", "--no-default-browser-check"]);
        argv.extend(agent.as_deref());
        argv.extend([";", "set-option", "-t", &exact, "remain-on-exit", "on"]);
        argv.iter().map(|arg| arg.to_string()).collect()
    }

    /// The major from `google-chrome --version`, e.g. `Google Chrome 156.0.8078.47`.
    pub(super) fn chrome_major(version: &str) -> Option<u32> {
        version.split_whitespace().find_map(|word| word.split_once('.')?.0.parse().ok())
    }

    /// A headed Chrome's own string: Chrome reduces its UA to `<major>.0.0.0` itself; headless says `HeadlessChrome`.
    pub(super) fn user_agent(major: u32) -> String {
        format!("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36")
    }

    fn chrome_version(chrome: &Path) -> String {
        Command::new(chrome).arg("--version").output().map(|out| String::from_utf8_lossy(&out.stdout).into_owned()).unwrap_or_default()
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

    fn devtools_get(path: &str) -> Option<String> {
        devtools_at(PORT, "GET", path)
    }

    /// Loopback only, by construction: the address is a literal, never a name or a setting.
    fn loopback(port: u16) -> std::io::Result<TcpStream> {
        TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), Duration::from_millis(300))
    }

    /// The port is an argument so a proof can run on its own Chrome; the commands always pass `PORT`.
    fn devtools_at(port: u16, method: &str, path: &str) -> Option<String> {
        let mut stream = loopback(port).ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").ok()?;
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

    fn target_of(item: &Value) -> BrowserTarget {
        let field = |key: &str| item[key].as_str().unwrap_or_default().to_string();
        BrowserTarget { id: field("id"), title: field("title"), url: field("url") }
    }

    pub(super) fn page_targets(list: &str) -> Vec<BrowserTarget> {
        let Ok(Value::Array(items)) = serde_json::from_str(list) else { return Vec::new() };
        items.iter().filter(|item| item["type"] == "page").map(target_of).collect()
    }

    /// The path of the page's own socket; the host is dropped, the connection always goes to loopback.
    pub(super) fn socket_path(list: &str, target_id: &str) -> Option<String> {
        let Ok(Value::Array(items)) = serde_json::from_str::<Value>(list) else { return None };
        let url = items.iter().find(|item| item["id"] == target_id)?["webSocketDebuggerUrl"].as_str()?;
        let rest = url.strip_prefix("ws://")?;
        Some(rest[rest.find('/')?..].to_string())
    }

    pub(super) fn cdp(id: u64, method: &str, params: Value) -> String {
        json!({ "id": id, "method": method, "params": params }).to_string()
    }

    /// What one message from the page means: an event for the webview, and the frame to ack.
    pub(super) fn react(text: &str) -> (Option<BrowserEvent>, Option<Value>) {
        let Ok(message) = serde_json::from_str::<Value>(text) else { return (None, None) };
        let params = &message["params"];
        let number = |value: &Value| value.as_f64().unwrap_or_default();
        match message["method"].as_str().unwrap_or_default() {
            "Page.screencastFrame" => {
                let meta = &params["metadata"];
                let frame = BrowserEvent::Frame {
                    data: params["data"].as_str().unwrap_or_default().to_string(),
                    device_width: number(&meta["deviceWidth"]),
                    device_height: number(&meta["deviceHeight"]),
                    page_scale: number(&meta["pageScaleFactor"]),
                    scroll_x: number(&meta["scrollOffsetX"]),
                    scroll_y: number(&meta["scrollOffsetY"]),
                };
                (Some(frame), Some(params["sessionId"].clone()))
            }
            "Page.screencastVisibilityChanged" => {
                (Some(BrowserEvent::Visibility { visible: params["visible"].as_bool().unwrap_or(true) }), None)
            }
            "Inspector.detached" => {
                let reason = params["reason"].as_str().unwrap_or("detached").to_string();
                (Some(BrowserEvent::Closed { reason: format!("the page let go: {reason}") }), None)
            }
            "Inspector.targetCrashed" => (Some(BrowserEvent::Closed { reason: "the page crashed".into() }), None),
            _ => (None, None),
        }
    }

    type Queued = (&'static str, Value);
    /// A view is its command queue; dropping the sender is what ends the view's thread.
    static VIEWS: Mutex<Vec<(String, mpsc::Sender<Queued>)>> = Mutex::new(Vec::new());
    static NEXT_VIEW: AtomicU64 = AtomicU64::new(1);
    /// How long a read waits before the queued input gets its turn on the socket.
    const INPUT_TURN: Duration = Duration::from_millis(10);

    fn views() -> std::sync::MutexGuard<'static, Vec<(String, mpsc::Sender<Queued>)>> {
        VIEWS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(super) fn view_open(
        port: u16,
        target_id: &str,
        mut emit: impl FnMut(BrowserEvent) -> bool + Send + 'static,
    ) -> Result<String, String> {
        let list = devtools_at(port, "GET", "/json/list").ok_or("BAUD's Chrome did not answer its page list")?;
        let path = socket_path(&list, target_id).ok_or_else(|| format!("BAUD's Chrome has no page {target_id}"))?;
        let stream = loopback(port).map_err(|err| format!("could not reach BAUD's Chrome: {err}"))?;
        stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|err| err.to_string())?;
        let (mut socket, _) = tungstenite::client(format!("ws://127.0.0.1:{port}{path}"), stream)
            .map_err(|err| format!("the page's socket refused BAUD: {err}"))?;
        socket.get_ref().set_read_timeout(Some(INPUT_TURN)).map_err(|err| err.to_string())?;
        // A background tab paints nothing, so the shown page is brought to the front first.
        let start = json!({ "format": "jpeg", "quality": 60, "maxWidth": 1280, "maxHeight": 1280, "everyNthFrame": 1 });
        for (id, method, params) in [(1, "Page.bringToFront", json!({})), (2, "Page.startScreencast", start)] {
            socket.send(Message::text(cdp(id, method, params))).map_err(|err| format!("the page's socket broke: {err}"))?;
        }

        let view_id = format!("view-{}", NEXT_VIEW.fetch_add(1, Ordering::Relaxed));
        let (sender, commands) = mpsc::channel();
        views().push((view_id.clone(), sender));
        let mine = view_id.clone();
        std::thread::spawn(move || {
            if let Some(reason) = pump(&mut socket, &commands, &mut emit) {
                emit(BrowserEvent::Closed { reason });
            }
            let _ = socket.close(None);
            let _ = socket.flush();
            views().retain(|(id, _)| *id != mine);
        });
        Ok(view_id)
    }

    /// `None` when BAUD ended the view (closed, or the webview went); `Some(reason)` when the page did.
    fn pump(
        socket: &mut WebSocket<TcpStream>,
        commands: &mpsc::Receiver<Queued>,
        emit: &mut impl FnMut(BrowserEvent) -> bool,
    ) -> Option<String> {
        let mut next_id = 3;
        let mut send = |socket: &mut WebSocket<TcpStream>, method: &str, params: Value| {
            next_id += 1;
            socket.send(Message::text(cdp(next_id, method, params))).map_err(|err| err.to_string())
        };
        loop {
            loop {
                match commands.try_recv() {
                    Ok((method, params)) => {
                        if let Err(err) = send(socket, method, params) {
                            return Some(err);
                        }
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        let _ = send(socket, "Page.stopScreencast", json!({}));
                        return None;
                    }
                }
            }
            match socket.read() {
                Ok(Message::Text(text)) => {
                    let (event, ack) = react(&text);
                    // Unacked, Chrome stops after a few frames.
                    if let Some(session) = ack {
                        if let Err(err) = send(socket, "Page.screencastFrameAck", json!({ "sessionId": session })) {
                            return Some(err);
                        }
                    }
                    if let Some(event) = event {
                        if let BrowserEvent::Closed { reason } = event {
                            return Some(reason);
                        }
                        if !emit(event) {
                            let _ = send(socket, "Page.stopScreencast", json!({}));
                            return None;
                        }
                    }
                }
                Ok(Message::Close(_)) => return Some("the page's socket closed".into()),
                Ok(_) => {}
                Err(tungstenite::Error::Io(err))
                    if matches!(err.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                Err(err) => return Some(format!("the page's socket broke: {err}")),
            }
        }
    }

    pub(super) fn view_close(view_id: &str) {
        views().retain(|(id, _)| id != view_id);
    }

    pub(super) fn view_send(view_id: &str, method: &'static str, params: Value) -> Result<(), String> {
        let views = views();
        let (_, sender) = views.iter().find(|(id, _)| id == view_id).ok_or("this view has closed")?;
        sender.send((method, params)).map_err(|_| "this view has closed".to_string())
    }

    /// Chrome answers `/json/new` only to PUT.
    pub(super) fn new_tab(port: u16) -> Result<BrowserTarget, String> {
        let body = devtools_at(port, "PUT", "/json/new?about:blank").ok_or("BAUD's Chrome did not open a tab")?;
        serde_json::from_str::<Value>(&body).map(|item| target_of(&item)).map_err(|err| err.to_string())
    }

    /// Steps clamp to their sign; 0 is refused rather than sent as a reload.
    pub(super) fn history_expression(step: i32) -> Option<String> {
        (step != 0).then(|| format!("history.go({})", step.signum()))
    }

    /// The id becomes part of a request line, so only Chrome's own id alphabet passes.
    pub(super) fn close_tab(port: u16, target_id: &str) -> Result<(), String> {
        if target_id.is_empty() || !target_id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(format!("{target_id:?} is not a page id"));
        }
        devtools_at(port, "GET", &format!("/json/close/{target_id}"))
            .map(|_| ())
            .ok_or_else(|| format!("BAUD's Chrome did not close page {target_id}"))
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

    fn on_path(names: &[&str]) -> Option<PathBuf> {
        let path = std::env::var_os("PATH")?;
        names.iter().find_map(|name| std::env::split_paths(&path).map(|dir| dir.join(name)).find(|bin| bin.is_file()))
    }

    fn chrome_binary() -> Option<PathBuf> {
        on_path(&["google-chrome", "google-chrome-stable"])
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
        let agent = chrome_major(&chrome_version(&chrome)).map(user_agent);
        let xvfb = on_path(&["xvfb-run"]).map(|bin| bin.display().to_string());
        let out = Command::new("tmux")
            .args(launch_argv(&chrome.display().to_string(), profile, agent.as_deref(), xvfb.as_deref()))
            .output()
            .map_err(|err| format!("could not run tmux: {err}"))?;
        if !out.status.success() {
            return Err(format!("tmux refused the room: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }

        let started = Instant::now();
        while started.elapsed() < READY_WINDOW {
            if devtools_get("/json/version").is_some() {
                let mut up = status(profile);
                if agent.is_none() {
                    up.detail = "Chrome's version could not be read, so it runs with headless Chrome's own user agent".into();
                }
                return Ok(up);
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
            let argv = launch_argv("/usr/bin/google-chrome", Path::new("/home/op/.config/x y/chrome"), Some("A B/1"), None);
            assert_eq!(&argv[..6], ["new-session", "-d", "-s", "baud-chrome", "--", "/usr/bin/google-chrome"]);
            assert!(argv.contains(&"--user-data-dir=/home/op/.config/x y/chrome".to_string()));
            assert!(argv.contains(&"--remote-debugging-port=9333".to_string()));
            assert!(argv.contains(&"--headless=new".to_string()));
            assert!(argv.contains(&"--window-size=1280,800".to_string()));
            assert!(argv.contains(&"--no-first-run".to_string()));
            assert!(argv.contains(&"--no-default-browser-check".to_string()));
            assert!(argv.contains(&"--user-agent=A B/1".to_string()));
            assert!(argv.ends_with(&["set-option", "-t", "=baud-chrome:", "remain-on-exit", "on"].map(String::from)));
            assert!(!argv.iter().any(|arg| arg.contains("sh -c") || arg.contains('\'')));
        }

        #[test]
        fn with_xvfb_chrome_is_headed_on_x11_inside_xvfb_run() {
            let argv = launch_argv("/usr/bin/google-chrome", Path::new("/p"), None, Some("/usr/bin/xvfb-run"));
            assert_eq!(
                &argv[4..12],
                ["--", "/usr/bin/xvfb-run", "-a", "-s", "-screen 0 1280x800x24", "/usr/bin/google-chrome", "--user-data-dir=/p", "--remote-debugging-port=9333"]
            );
            assert!(argv.contains(&"--ozone-platform=x11".to_string()));
            assert!(argv.contains(&"--window-size=1280,800".to_string()));
            assert!(!argv.iter().any(|arg| arg.starts_with("--headless")));
        }

        #[test]
        fn an_unread_version_launches_without_a_user_agent() {
            let argv = launch_argv("/usr/bin/google-chrome", Path::new("/p"), None, None);
            assert!(!argv.iter().any(|arg| arg.starts_with("--user-agent")));
            assert!(argv.ends_with(&["set-option", "-t", "=baud-chrome:", "remain-on-exit", "on"].map(String::from)));
        }

        #[test]
        fn the_user_agent_is_a_headed_chromes_for_the_installed_major() {
            assert_eq!(chrome_major("Google Chrome 156.0.8078.47\n"), Some(156));
            assert_eq!(chrome_major("Chromium 120.0.6099.71 snap"), Some(120));
            assert_eq!(chrome_major(""), None);
            assert_eq!(chrome_major("Google Chrome"), None);
            assert_eq!(
                user_agent(156),
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
            );
        }

        #[test]
        fn history_steps_clamp_to_one_and_zero_is_refused() {
            assert_eq!(history_expression(-1).as_deref(), Some("history.go(-1)"));
            assert_eq!(history_expression(-7).as_deref(), Some("history.go(-1)"));
            assert_eq!(history_expression(1).as_deref(), Some("history.go(1)"));
            assert_eq!(history_expression(i32::MAX).as_deref(), Some("history.go(1)"));
            assert_eq!(history_expression(i32::MIN).as_deref(), Some("history.go(-1)"));
            assert_eq!(history_expression(0), None);
        }

        #[test]
        fn a_close_refuses_an_id_that_is_not_chromes_before_any_request() {
            for bad in ["", "A B", "A/../version", "A\r\nHost: x", "A?x"] {
                assert!(close_tab(1, bad).unwrap_err().contains("is not a page id"), "{bad:?}");
            }
            assert!(close_tab(1, "ABC123").unwrap_err().contains("did not close"));
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

        #[test]
        fn the_socket_path_is_the_named_pages_own() {
            let list = r#"[{"id":"A","type":"page","webSocketDebuggerUrl":"ws://127.0.0.1:9333/devtools/page/A"},
                           {"id":"B","type":"page"}]"#;
            assert_eq!(socket_path(list, "A").as_deref(), Some("/devtools/page/A"));
            assert_eq!(socket_path(list, "B"), None);
            assert_eq!(socket_path(list, "C"), None);
            assert_eq!(socket_path("[]", "A"), None);
        }

        #[test]
        fn a_frame_is_forwarded_with_its_metadata_and_acked_by_session() {
            let text = r#"{"method":"Page.screencastFrame","params":{"data":"/9j/","sessionId":7,
                "metadata":{"deviceWidth":1280,"deviceHeight":720.5,"pageScaleFactor":1,"scrollOffsetX":0,"scrollOffsetY":40,"offsetTop":0}}}"#;
            let (event, ack) = react(text);
            assert_eq!(
                event,
                Some(BrowserEvent::Frame {
                    data: "/9j/".into(),
                    device_width: 1280.0,
                    device_height: 720.5,
                    page_scale: 1.0,
                    scroll_x: 0.0,
                    scroll_y: 40.0
                })
            );
            assert_eq!(cdp(9, "Page.screencastFrameAck", json!({ "sessionId": ack.unwrap() })),
                r#"{"id":9,"method":"Page.screencastFrameAck","params":{"sessionId":7}}"#);
        }

        #[test]
        fn visibility_detach_and_noise_read_as_meant() {
            let hidden = r#"{"method":"Page.screencastVisibilityChanged","params":{"visible":false}}"#;
            assert_eq!(react(hidden), (Some(BrowserEvent::Visibility { visible: false }), None));
            let gone = r#"{"method":"Inspector.detached","params":{"reason":"target_closed"}}"#;
            assert!(matches!(react(gone).0, Some(BrowserEvent::Closed { reason }) if reason.contains("target_closed")));
            assert_eq!(react(r#"{"id":2,"result":{}}"#), (None, None));
            assert_eq!(react("not json"), (None, None));
        }

        #[test]
        fn events_and_input_wear_the_webviews_shapes() {
            let frame = serde_json::to_value(BrowserEvent::Visibility { visible: true }).unwrap();
            assert_eq!(frame, json!({ "kind": "visibility", "visible": true }));
            let input: super::super::BrowserInput =
                serde_json::from_value(json!({ "kind": "key", "params": { "type": "char", "text": "a" } })).unwrap();
            assert_eq!(input, super::super::BrowserInput::Key(json!({ "type": "char", "text": "a" })));
            assert!(serde_json::from_value::<super::super::BrowserInput>(json!({ "kind": "eval", "params": {} })).is_err());
        }

        #[test]
        fn a_closed_view_refuses_input() {
            assert_eq!(view_send("view-none", "Page.navigate", json!({})), Err("this view has closed".into()));
            view_close("view-none");
        }

        /// Live: views a Chrome the caller started on `BAUD_BROWSER_PROOF_PORT` (never 9333), scrolls a long
        /// page, minimises the window, and writes the last frame's base64 to `BAUD_BROWSER_PROOF_OUT`.
        /// Run alone with `cargo test -- --ignored live_view_streams_frames --nocapture`.
        #[test]
        #[ignore]
        fn live_view_streams_frames() {
            use std::sync::Arc;
            let port: u16 = std::env::var("BAUD_BROWSER_PROOF_PORT").expect("a test port").parse().unwrap();
            assert_ne!(port, PORT, "the proof never touches BAUD's own Chrome");
            let target = page_targets(&devtools_at(port, "GET", "/json/list").unwrap()).remove(0);
            let seen: Arc<Mutex<Vec<(Instant, BrowserEvent)>>> = Arc::default();
            let sink = seen.clone();
            let view = view_open(port, &target.id, move |event| {
                sink.lock().unwrap().push((Instant::now(), event));
                true
            })
            .unwrap();
            let frames_in = |seconds: f64| {
                let from = Instant::now();
                std::thread::sleep(Duration::from_secs_f64(seconds));
                let seen = seen.lock().unwrap();
                let frames: Vec<&BrowserEvent> =
                    seen.iter().filter(|(at, event)| *at >= from && matches!(event, BrowserEvent::Frame { .. })).map(|(_, e)| e).collect();
                let others: Vec<&BrowserEvent> =
                    seen.iter().filter(|(at, event)| *at >= from && !matches!(event, BrowserEvent::Frame { .. })).map(|(_, e)| e).collect();
                (frames.len(), others.into_iter().cloned().collect::<Vec<_>>())
            };
            println!("first 2 s: {:?}", frames_in(2.0));
            let page = format!("data:text/html,<body style='margin:0'>{}</body>", "<p style='height:200px;border-top:4px solid red'>row</p>".repeat(100));
            view_send(&view, "Page.navigate", json!({ "url": page })).unwrap();
            std::thread::sleep(Duration::from_millis(1500));
            let wheel = std::thread::spawn({
                let view = view.clone();
                move || {
                    for _ in 0..180 {
                        let _ = view_send(&view, "Input.dispatchMouseEvent", json!({ "type": "mouseWheel", "x": 200, "y": 200, "deltaX": 0, "deltaY": 40 }));
                        std::thread::sleep(Duration::from_millis(16));
                    }
                }
            });
            let (scrolled, _) = frames_in(3.0);
            wheel.join().unwrap();
            println!("scrolling 3 s: {scrolled} frames, {:.1} fps", scrolled as f64 / 3.0);
            println!("idle 2 s after scroll: {:?}", frames_in(2.0).0);

            let version: Value = serde_json::from_str(&devtools_at(port, "GET", "/json/version").unwrap()).unwrap();
            let url = version["webSocketDebuggerUrl"].as_str().unwrap().to_string();
            let path = &url[url.find("/devtools").unwrap()..];
            let (mut browser, _) = tungstenite::client(format!("ws://127.0.0.1:{port}{path}"), loopback(port).unwrap()).unwrap();
            let mut call = |id: u64, method: &str, params: Value| -> Value {
                browser.send(Message::text(cdp(id, method, params))).unwrap();
                loop {
                    if let Message::Text(text) = browser.read().unwrap() {
                        let answer: Value = serde_json::from_str(&text).unwrap();
                        if answer["id"] == id {
                            return answer;
                        }
                    }
                }
            };
            let window = call(1, "Browser.getWindowForTarget", json!({ "targetId": target.id }))["result"]["windowId"].clone();
            println!("minimise: {}", call(2, "Browser.setWindowBounds", json!({ "windowId": window, "bounds": { "windowState": "minimized" } })));
            println!("minimised 4 s: {:?}", frames_in(4.0));
            view_send(&view, "Input.dispatchMouseEvent", json!({ "type": "mouseWheel", "x": 200, "y": 200, "deltaX": 0, "deltaY": -400 })).unwrap();
            println!("minimised, scrolled once, 2 s: {:?}", frames_in(2.0));
            println!("state: {}", call(3, "Browser.getWindowBounds", json!({ "windowId": window })));
            call(4, "Browser.setWindowBounds", json!({ "windowId": window, "bounds": { "windowState": "normal" } }));
            println!("restored 2 s: {:?}", frames_in(2.0));

            let last = seen.lock().unwrap().iter().rev().find_map(|(_, event)| match event {
                BrowserEvent::Frame { data, device_width, device_height, .. } => Some((data.clone(), *device_width, *device_height)),
                _ => None,
            });
            let (data, width, height) = last.expect("at least one frame");
            println!("last frame: css {width}x{height}, {} base64 bytes", data.len());
            std::fs::write(std::env::var("BAUD_BROWSER_PROOF_OUT").unwrap(), data).unwrap();
            view_close(&view);
            std::thread::sleep(Duration::from_millis(300));
            assert!(views().iter().all(|(id, _)| *id != view), "a closed view's thread lets go of its slot");
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
