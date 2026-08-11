//! BAUD - the AIPass desktop fleet monitor.
//!
//! The monitoring half is read-only by construction: `fleet_snapshot` reads a
//! handful of well-known files under the AIPass root and reports what it saw.
//! It writes nothing, spawns nothing, and every fallible path degrades to a
//! default and records the failure in the payload instead of panicking.
//!
//! Milestone 2 adds exactly one interactive surface next to it: the `pty_*`
//! commands in [`pty`], which run the operator's own shell. That shell can do
//! anything the operator can - but only because the operator typed it. BAUD
//! never drives it on its own; the fleet view still only ever reads.
//!
//! Milestone 3 keeps that contract: a card's launch button writes one visible
//! command line into that same shell - and only ever on an operator click.
//! Clicking while another session is live replaces the shell (SIGHUP, exactly
//! what closing a terminal window does) - claude's on-disk transcript makes
//! the interrupted conversation resumable with `-c`, which is why a single
//! terminal can switch between agents instead of needing tabs.
//!
//! Milestone 4 adds the reading room: `list_dir` and `read_file_text`, the
//! file tree and viewer behind the cards. Both are read-only and FENCED -
//! every path the frontend sends is canonicalized and must sit inside the
//! resolved AIPass root, so the webview can only ever read what the fleet
//! view could already see. Writing stays impossible by construction; if an
//! editor ever lands, it arrives as its own explicit command with its own
//! doctrine paragraph, not as a quiet extension of these.
//!
//! Milestone 5 adds the changes badge: `git_changes` and `git_diff_text`,
//! which shell out to the operator's installed `git` binary with exactly one
//! verb - `diff` - scoped to the card's directory. Diff is a read: it looks
//! at the working files and reports, touching nothing. No write verb exists
//! in this codebase; committing stays where it belongs, in the terminal.
//!
//! Mail counts read the mailbox itself (`inbox.json`), not the dashboard's
//! `quick_status` copy: dashboards only move on service writes and mail
//! events never trigger one, so the cached counts drift - 12 of 17 cards
//! were wrong when checked (Patrick-caught 2026-08-09). Source over cache.
//!
//! Milestone 6 gives every agent a ROOM (Patrick ruling 2026-08-10): a
//! persistent tmux session named `baud-<branch>`, owned by the tmux server,
//! not by this window. BAUD's terminal becomes a window INTO the room -
//! opening a card attaches (creating on first visit), switching cards
//! detaches, closing BAUD detaches everything. Sessions, monitors, and
//! builds keep running; the fork-on-resume and cancel-on-switch failure
//! modes disappear because there is no respawn - only reattach. The only
//! tmux verbs in this codebase: `new-session -A`, `list-sessions`,
//! `kill-session` (the explicit "end room" click), `set-option mouse`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

mod pty;

/// Marker directory that identifies an AIPass root: `<root>/src/aipass`.
const FLEET_RELATIVE_DIR: [&str; 2] = ["src", "aipass"];

/// A branch is a citizen when it carries a passport.
const PASSPORT_RELATIVE_PATH: [&str; 2] = [".trinity", "passport.json"];

/// Presence of this lock file means the agent is dispatched and working now.
const DISPATCH_LOCK_RELATIVE_PATH: [&str; 2] = [".ai_mail.local", ".dispatch.lock"];

/// The mailbox itself - mail counts come from here, never the dashboard.
const INBOX_RELATIVE_PATH: [&str; 2] = [".ai_mail.local", "inbox.json"];

/// Every room BAUD creates carries this prefix, so `list-sessions` can tell
/// BAUD's rooms from the operator's own tmux sessions.
const ROOM_PREFIX: &str = "baud-";

/// A live claude process found on the process table.
///
/// `headless` is true for `claude -p`/`--print` runs - the shape every
/// dispatched wake takes - and false for a human-driven interactive session.
struct ClaudeSession {
    cwd: PathBuf,
    headless: bool,
}

/// The per-branch status file that services keep up to date.
const DASHBOARD_FILE: &str = "DASHBOARD.local.json";

/// One branch directory under `<root>/src/aipass/`.
#[derive(Debug, Clone, Serialize)]
pub struct BranchStatus {
    /// Directory name, e.g. "devpulse".
    pub name: String,
    /// Absolute branch directory - what the launch button cds into.
    pub path: String,
    /// `.trinity/passport.json` exists.
    pub is_citizen: bool,
    /// `.ai_mail.local/.dispatch.lock` exists - a dispatched agent is working
    /// the branch right now.
    pub dispatched: bool,
    /// A live interactive claude session (no `-p`) has its cwd in this branch -
    /// someone is at the wheel.
    pub interactive: bool,
    /// An INTERACTIVE claude transcript exists for this directory - there is a
    /// conversation plain `-c` will continue.
    pub has_history: bool,
    /// Newest transcript's session id when the only history is headless
    /// dispatch runs: `-c` refuses those, but `--resume <id>` opens them
    /// interactively. `None` when `has_history` is true (use `-c`) or when
    /// there are no transcripts at all (nothing to resume).
    pub resume_id: Option<String>,
    /// A `baud-<branch>` tmux session exists - the agent has a living room
    /// to attach to, whether or not anything is running inside it.
    pub has_room: bool,
    /// Messages with status "new" in `.ai_mail.local/inbox.json`, 0 when the
    /// mailbox is missing or unreadable.
    pub new_mail: u64,
    /// Messages with status "opened" in the same mailbox, 0 when missing.
    pub opened_mail: u64,
    /// `quick_status.active_plans`, 0 when missing or unreadable.
    pub active_plans: u64,
    /// `quick_status.todo_count`, 0 when missing or unreadable.
    pub todo_count: u64,
    /// `quick_status.summary`, empty when missing or unreadable.
    pub summary: String,
    /// Top-level `last_updated`, empty when missing or unreadable.
    pub last_updated: String,
}

impl BranchStatus {
    fn new(name: String, path: String) -> Self {
        Self {
            name,
            path,
            is_citizen: false,
            dispatched: false,
            interactive: false,
            has_history: false,
            resume_id: None,
            has_room: false,
            new_mail: 0,
            opened_mail: 0,
            active_plans: 0,
            todo_count: 0,
            summary: String::new(),
            last_updated: String::new(),
        }
    }
}

/// A full read of the fleet at one instant.
#[derive(Debug, Clone, Serialize)]
pub struct FleetSnapshot {
    /// Resolved AIPass root, for display. Empty when resolution failed.
    pub aipass_root: String,
    /// ISO-8601 UTC timestamp of this snapshot.
    pub generated_at: String,
    /// Human-readable reason the snapshot is empty or partial.
    pub error: Option<String>,
    /// One entry per directory under `<root>/src/aipass/`.
    pub branches: Vec<BranchStatus>,
}

impl FleetSnapshot {
    fn failed(error: String) -> Self {
        Self {
            aipass_root: String::new(),
            generated_at: now_iso8601(),
            error: Some(error),
            branches: Vec::new(),
        }
    }
}

fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn join_all(base: &Path, parts: &[&str]) -> PathBuf {
    let mut path = base.to_path_buf();
    for part in parts {
        path.push(part);
    }
    path
}

/// Locate the AIPass root without ever hardcoding a path.
///
/// 1. `AIPASS_ROOT`, when set and pointing at a tree that contains `src/aipass`.
/// 2. Otherwise walk up from the current working directory looking for the
///    first ancestor that contains `src/aipass`.
///
/// Returns a descriptive error rather than panicking or guessing.
fn resolve_aipass_root() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("AIPASS_ROOT") {
        let candidate = raw.trim();
        if !candidate.is_empty() {
            let root = PathBuf::from(candidate);
            if join_all(&root, &FLEET_RELATIVE_DIR).is_dir() {
                return Ok(root);
            }
            return Err(format!(
                "AIPASS_ROOT is set to '{candidate}' but no 'src/aipass' directory exists there"
            ));
        }
    }

    let cwd = std::env::current_dir()
        .map_err(|err| format!("could not read the current working directory: {err}"))?;

    let mut cursor: Option<&Path> = Some(cwd.as_path());
    while let Some(dir) = cursor {
        if join_all(dir, &FLEET_RELATIVE_DIR).is_dir() {
            return Ok(dir.to_path_buf());
        }
        cursor = dir.parent();
    }

    Err(format!(
        "could not locate the AIPass root: set AIPASS_ROOT, or launch BAUD from inside a tree \
         containing 'src/aipass' (searched upward from '{}')",
        cwd.display()
    ))
}

/// Classify a `/proc/<pid>/cmdline` buffer (NUL-separated argv).
///
/// Returns `Some(headless)` when argv[0] is a claude binary, `None` otherwise.
/// `headless` means `-p`/`--print` is present - the shape of every dispatched
/// wake (`claude -p ...` / `claude -c -p ...`); an interactive session never
/// carries it.
fn classify_claude_cmdline(cmdline: &[u8]) -> Option<bool> {
    let mut args = cmdline.split(|byte| *byte == 0).filter(|arg| !arg.is_empty());

    let argv0 = args.next()?;
    let argv0 = String::from_utf8_lossy(argv0);
    let binary = Path::new(argv0.as_ref()).file_name()?.to_string_lossy();
    if binary != "claude" {
        return None;
    }

    let headless = args.any(|arg| arg == b"-p" || arg == b"--print");
    Some(headless)
}

/// One pass over the process table, collecting every live claude process and
/// where it runs. Pure `/proc` reads - no processes spawned, nothing written.
/// Any unreadable entry (raced exit, permissions) is simply skipped.
#[cfg(target_os = "linux")]
fn scan_claude_sessions() -> Vec<ClaudeSession> {
    let mut sessions = Vec::new();

    let entries = match fs::read_dir("/proc") {
        Ok(entries) => entries,
        Err(_) => return sessions,
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let is_pid = name.to_string_lossy().bytes().all(|byte| byte.is_ascii_digit());
        if !is_pid {
            continue;
        }

        let proc_dir = entry.path();
        let cmdline = match fs::read(proc_dir.join("cmdline")) {
            Ok(contents) => contents,
            Err(_) => continue,
        };
        let headless = match classify_claude_cmdline(&cmdline) {
            Some(headless) => headless,
            None => continue,
        };
        let cwd = match fs::read_link(proc_dir.join("cwd")) {
            Ok(cwd) => cwd,
            Err(_) => continue,
        };

        sessions.push(ClaudeSession { cwd, headless });
    }

    sessions
}

/// No process table to read here - branches simply never show interactive.
#[cfg(not(target_os = "linux"))]
fn scan_claude_sessions() -> Vec<ClaudeSession> {
    Vec::new()
}

/// Claude Code keeps each directory's conversation transcripts under
/// `~/.claude/projects/<munged>/`, where every non-alphanumeric character of
/// the absolute path becomes '-'. This reproduces that munge.
fn transcript_dir_name(branch_dir: &Path) -> String {
    branch_dir
        .display()
        .to_string()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The on-disk discriminator between session kinds. Interactive `claude -c`
/// refuses headless (`-p`) transcripts with "No conversation found to
/// continue" (verified live: a branch whose only history was a dispatch died
/// on resume). Interactive sessions write `file-history-snapshot` checkpoint
/// entries - headless runs never do - and the first one lands within the
/// first KB, so a bounded head-read is enough to classify a file.
const INTERACTIVE_MARKER: &str = "\"type\":\"file-history-snapshot\"";
const MARKER_SCAN_BYTES: u64 = 64 * 1024;

fn is_interactive_transcript(path: &Path) -> bool {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };

    let mut head = Vec::with_capacity(MARKER_SCAN_BYTES as usize);
    if file.take(MARKER_SCAN_BYTES).read_to_end(&mut head).is_err() {
        return false;
    }

    String::from_utf8_lossy(&head).contains(INTERACTIVE_MARKER)
}

/// How the resume button reaches this branch's conversation, if any:
///
/// - An INTERACTIVE `.jsonl` exists -> `(true, None)`: plain `-c` continues
///   it (claude itself picks the newest interactive session).
/// - Only headless dispatch `.jsonl`s exist -> `(false, Some(id))`: `-c`
///   refuses those, but `--resume <id>` opens the newest one interactively
///   (verified live on a dispatch-only branch).
/// - No transcripts -> `(false, None)`: nothing to resume, fresh only.
///
/// Any failure to look reads as "no history" - the launch button then simply
/// starts fresh, which is always safe.
fn claude_history(branch_dir: &Path) -> (bool, Option<String>) {
    let home = match std::env::var("HOME") {
        Ok(home) if !home.trim().is_empty() => PathBuf::from(home),
        _ => return (false, None),
    };

    let transcripts = home
        .join(".claude")
        .join("projects")
        .join(transcript_dir_name(branch_dir));

    claude_history_in(&transcripts)
}

fn claude_history_in(transcripts: &Path) -> (bool, Option<String>) {
    let entries = match fs::read_dir(transcripts) {
        Ok(entries) => entries,
        Err(_) => return (false, None),
    };

    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .map(|entry| {
            let modified = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            (modified, entry.path())
        })
        .collect();
    candidates.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    // Newest first, so the common case (a branch someone actually chats
    // with) answers on the first file.
    if candidates
        .iter()
        .any(|(_, path)| is_interactive_transcript(path))
    {
        return (true, None);
    }

    let newest = candidates.first().and_then(|(_, path)| {
        path.file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
    });
    (false, newest)
}

/// One entry in a directory listing, for the file tree.
#[derive(Debug, Clone, Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    /// Absolute path - handed back to `list_dir`/`read_file_text` verbatim.
    pub path: String,
    pub is_dir: bool,
}

/// A file's text for the read-only viewer.
#[derive(Debug, Clone, Serialize)]
pub struct FileText {
    pub path: String,
    pub content: String,
    /// True when the file was larger than the viewer cap and got cut.
    pub truncated: bool,
}

/// Directories the tree never descends into - machine residue, not content.
const NOISE_DIRS: [&str; 6] = [
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".venv",
    "dist",
];

/// The viewer refuses to load more than this - it is a reading pane, not a
/// log streamer. Larger files come back truncated with a flag.
const VIEWER_MAX_BYTES: u64 = 512 * 1024;

/// Canonicalize a frontend-supplied path and refuse anything outside the
/// AIPass root. This is the fence under every file-access command: the
/// webview can name paths, but only ones the fleet view already lives in.
fn fenced_path(raw: &str) -> Result<PathBuf, String> {
    let root = resolve_aipass_root()?
        .canonicalize()
        .map_err(|err| format!("could not canonicalize the AIPass root: {err}"))?;
    let path = PathBuf::from(raw)
        .canonicalize()
        .map_err(|err| format!("could not resolve '{raw}': {err}"))?;
    if !path.starts_with(&root) {
        return Err(format!(
            "'{}' is outside the AIPass root - refusing to read it",
            path.display()
        ));
    }
    Ok(path)
}

/// Turn raw file bytes into viewer text: binary is refused (a text pane
/// rendering NULs helps nobody), oversized input is cut at the cap.
fn viewer_text(mut bytes: Vec<u8>, cap: usize) -> Result<(String, bool), String> {
    let truncated = bytes.len() > cap;
    if truncated {
        bytes.truncate(cap);
    }
    if bytes.contains(&0) {
        return Err("binary file - nothing to view".to_string());
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

/// List one directory level: dirs first, then files, both alphabetical.
/// Read-only and fenced; noise directories are filtered at the source.
#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let dir = fenced_path(&path)?;
    let entries = fs::read_dir(&dir)
        .map_err(|err| format!("could not read '{}': {err}", dir.display()))?;

    let mut listing: Vec<DirEntryInfo> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.path().is_dir();
        if is_dir && NOISE_DIRS.contains(&name.as_str()) {
            continue;
        }
        listing.push(DirEntryInfo {
            name,
            path: entry.path().display().to_string(),
            is_dir,
        });
    }

    listing.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(listing)
}

/// Read a file for the viewer. Read-only and fenced, capped, text-only.
#[tauri::command]
fn read_file_text(path: String) -> Result<FileText, String> {
    let file_path = fenced_path(&path)?;
    let file = fs::File::open(&file_path)
        .map_err(|err| format!("could not open '{}': {err}", file_path.display()))?;

    let mut bytes = Vec::new();
    // Read one byte past the cap so truncation is detectable without ever
    // pulling a multi-gigabyte log into memory.
    file.take(VIEWER_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("could not read '{}': {err}", file_path.display()))?;

    let (content, truncated) = viewer_text(bytes, VIEWER_MAX_BYTES as usize)?;
    Ok(FileText {
        path: file_path.display().to_string(),
        content,
        truncated,
    })
}

/// Resolve path candidates a terminal line mentioned into openable files.
/// Absolute candidates are tried as given; relative ones against `base` (the
/// seated room's branch dir), then the AIPass root. First attempt that
/// canonicalizes to a regular file inside the fence wins; everything else is
/// None - the terminal only underlines what will actually open.
#[tauri::command]
fn resolve_paths(base: Option<String>, candidates: Vec<String>) -> Vec<Option<String>> {
    candidates
        .iter()
        .map(|candidate| resolve_candidate(base.as_deref(), candidate))
        .collect()
}

fn resolve_candidate(base: Option<&str>, candidate: &str) -> Option<String> {
    let raw = Path::new(candidate);
    let attempts: Vec<PathBuf> = if raw.is_absolute() {
        vec![raw.to_path_buf()]
    } else {
        base.iter()
            .map(|dir| Path::new(dir).join(raw))
            .chain(resolve_aipass_root().ok().map(|root| root.join(raw)))
            .collect()
    };
    attempts.into_iter().find_map(|attempt| {
        let path = fenced_path(&attempt.display().to_string()).ok()?;
        path.is_file().then(|| path.display().to_string())
    })
}

/// Uncommitted edits in one branch's subtree, straight from local git.
#[derive(Debug, Clone, Serialize)]
pub struct GitChanges {
    pub files: Vec<String>,
    pub count: usize,
}

/// Run the installed `git` binary read-only inside `dir` and return stdout.
/// `None` covers every normal quiet case at once: not a repo, an empty repo
/// with no HEAD yet, or no git on the machine - all of which just mean
/// "nothing to report", not a fault worth surfacing on a card.
fn git_read(dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git").current_dir(dir).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The uncommitted-changes list for a directory: tracked files under it that
/// differ from HEAD (staged or not). `--relative` keeps names local to the
/// branch dir instead of repo-root-relative - every src/aipass branch shares
/// one repo, and a card should only ever speak about its own subtree.
fn git_changes_in(dir: &Path) -> GitChanges {
    let files: Vec<String> = git_read(dir, &["diff", "HEAD", "--relative", "--name-only", "--", "."])
        .map(|out| out.lines().map(str::to_owned).collect())
        .unwrap_or_default();
    let count = files.len();
    GitChanges { files, count }
}

/// The full uncommitted diff for a directory, as one patch text.
fn git_diff_in(dir: &Path) -> Result<FileText, String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["diff", "HEAD", "--relative", "--", "."])
        .output()
        .map_err(|err| format!("could not run git: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr.trim()));
    }
    let (content, truncated) = viewer_text(output.stdout, VIEWER_MAX_BYTES as usize)?;
    Ok(FileText {
        path: dir.display().to_string(),
        content,
        truncated,
    })
}

/// Count a branch's uncommitted files for the card badge. Fenced, read-only.
#[tauri::command]
fn git_changes(path: String) -> Result<GitChanges, String> {
    Ok(git_changes_in(&fenced_path(&path)?))
}

/// The diff behind the badge, for the changes tab. Fenced, read-only.
#[tauri::command]
fn git_diff_text(path: String) -> Result<FileText, String> {
    git_diff_in(&fenced_path(&path)?)
}

/// Read a `quick_status` count that may be a number or a list of items.
fn count_field(quick_status: &Value, key: &str) -> u64 {
    match quick_status.get(key) {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0),
        Some(Value::Array(items)) => items.len() as u64,
        Some(Value::String(text)) => text.trim().parse::<u64>().unwrap_or(0),
        _ => 0,
    }
}

/// The tmux session name for a branch's room.
///
/// tmux target syntax gives `.` and `:` meanings of their own, so anything
/// outside `[A-Za-z0-9_-]` becomes `-`. Exact-match lookups use the `=`
/// target prefix everywhere, so a sanitized name can never glob another.
pub fn room_name(branch_name: &str) -> String {
    let safe: String = branch_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    format!("{ROOM_PREFIX}{safe}")
}

/// Every live tmux session name. No server (or no tmux) reads as no rooms -
/// same quiet doctrine as the mailbox and the git figure.
fn list_rooms() -> std::collections::HashSet<String> {
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output();

    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect(),
        _ => std::collections::HashSet::new(),
    }
}

/// End a branch's room for real - the ONE way a room dies (Patrick ruling
/// 2026-08-10: detach everywhere else). Killing a room that is already gone
/// is the goal state, not an error.
#[tauri::command]
fn room_kill(branch_name: String) -> Result<(), String> {
    let room = room_name(&branch_name);
    let output = Command::new("tmux")
        .args(["kill-session", "-t", &format!("={room}")])
        .output()
        .map_err(|err| format!("could not run tmux: {err}"))?;

    // "session not found" exits non-zero; that is idempotent success. Any
    // other failure is reported honestly.
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("can't find session") || stderr.contains("no server") {
        return Ok(());
    }
    Err(format!("could not end room '{room}': {}", stderr.trim()))
}

/// Count mailbox messages by status straight from `inbox.json`.
///
/// Closed mail is archived out of the file, so the inbox only ever holds
/// "new" and "opened" messages. A missing or malformed file reads as an
/// empty mailbox - same quiet-zero doctrine as the git figure.
fn mail_counts_in(branch_dir: &Path) -> (u64, u64) {
    let raw = match fs::read_to_string(join_all(branch_dir, &INBOX_RELATIVE_PATH)) {
        Ok(contents) => contents,
        Err(_) => return (0, 0),
    };
    let document: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return (0, 0),
    };

    let (mut new_mail, mut opened_mail) = (0, 0);
    if let Some(messages) = document.get("messages").and_then(Value::as_array) {
        for message in messages {
            match message.get("status").and_then(Value::as_str) {
                Some("new") => new_mail += 1,
                Some("opened") => opened_mail += 1,
                _ => {}
            }
        }
    }
    (new_mail, opened_mail)
}

/// Overlay whatever `DASHBOARD.local.json` has to say onto a branch status.
///
/// Mail counts are NOT taken from here - see [`mail_counts_in`].
///
/// A missing, unreadable, or malformed file leaves the defaults in place - one
/// bad JSON file must never take down the whole snapshot.
fn apply_dashboard(branch_dir: &Path, status: &mut BranchStatus) {
    let dashboard_path = branch_dir.join(DASHBOARD_FILE);

    let raw = match fs::read_to_string(&dashboard_path) {
        Ok(contents) => contents,
        Err(_) => return,
    };

    let document: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return,
    };

    if let Some(last_updated) = document.get("last_updated").and_then(Value::as_str) {
        status.last_updated = last_updated.to_string();
    }

    let quick_status = match document.get("quick_status") {
        Some(value) if value.is_object() => value,
        _ => return,
    };

    status.active_plans = count_field(quick_status, "active_plans");
    status.todo_count = count_field(quick_status, "todo_count");
    status.summary = quick_status
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
}

/// Inspect a single branch directory. Never fails - worst case it reports a
/// bare directory with all-default fields.
fn read_branch(
    branch_dir: &Path,
    name: String,
    sessions: &[ClaudeSession],
    rooms: &std::collections::HashSet<String>,
) -> BranchStatus {
    let mut status = BranchStatus::new(name, branch_dir.display().to_string());
    status.is_citizen = join_all(branch_dir, &PASSPORT_RELATIVE_PATH).is_file();
    status.dispatched = join_all(branch_dir, &DISPATCH_LOCK_RELATIVE_PATH).exists();

    // /proc reports kernel-canonical cwds; canonicalize the branch dir so a
    // symlinked AIPASS_ROOT still matches. starts_with is component-wise, so
    // "devpulse" never claims a session sitting in "devpulse2".
    let canonical = branch_dir
        .canonicalize()
        .unwrap_or_else(|_| branch_dir.to_path_buf());
    status.interactive = sessions
        .iter()
        .any(|session| !session.headless && session.cwd.starts_with(&canonical));
    let (has_history, resume_id) = claude_history(&canonical);
    status.has_history = has_history;
    status.resume_id = resume_id;

    status.has_room = rooms.contains(&room_name(&status.name));

    apply_dashboard(branch_dir, &mut status);
    let (new_mail, opened_mail) = mail_counts_in(branch_dir);
    status.new_mail = new_mail;
    status.opened_mail = opened_mail;
    status
}

/// Scan `<root>/src/aipass/*/` - visible directories only.
fn scan_fleet(root: &Path) -> Result<Vec<BranchStatus>, String> {
    let fleet_dir = join_all(root, &FLEET_RELATIVE_DIR);

    let entries = fs::read_dir(&fleet_dir)
        .map_err(|err| format!("could not read '{}': {err}", fleet_dir.display()))?;

    // One process-table pass shared by every branch in this snapshot.
    let sessions = scan_claude_sessions();
    // One tmux round-trip shared by every card in this snapshot.
    let rooms = list_rooms();

    let mut branches: Vec<BranchStatus> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            // A single unreadable directory entry should not sink the scan.
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        // Skip dotfiles and tooling dirs like __pycache__ — machine residue, not branches.
        if name.starts_with('.') || name.starts_with("__") {
            continue;
        }

        let is_dir = match entry.file_type() {
            Ok(file_type) => file_type.is_dir() || entry.path().is_dir(),
            Err(_) => entry.path().is_dir(),
        };
        if !is_dir {
            continue;
        }

        branches.push(read_branch(&entry.path(), name, &sessions, &rooms));
    }

    branches.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(branches)
}

/// The fleet view's one command. Read-only by construction: it takes no
/// arguments, so the frontend cannot even steer where it reads.
#[tauri::command]
fn fleet_snapshot() -> FleetSnapshot {
    let root = match resolve_aipass_root() {
        Ok(root) => root,
        Err(error) => return FleetSnapshot::failed(error),
    };

    let root_display = root.display().to_string();

    match scan_fleet(&root) {
        Ok(branches) => FleetSnapshot {
            aipass_root: root_display,
            generated_at: now_iso8601(),
            error: None,
            branches,
        },
        Err(error) => FleetSnapshot {
            aipass_root: root_display,
            generated_at: now_iso8601(),
            error: Some(error),
            branches: Vec::new(),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyRegistry::default())
        // The opener plugin exists for exactly one gesture: ctrl+clicked URLs
        // in the terminal open in the default browser. Its capability grant
        // is url-only - no reveal-in-dir, no open-path.
        .plugin(tauri_plugin_opener::init())
        // The main window IS the app - it never browses. Refusing every
        // navigation off the app's own origin means no stray link, script,
        // or window.open can turn the fleet view into a file:// directory
        // listing or an arbitrary web page. (Links the operator ctrl+clicks
        // go through the reading room or the system browser instead.)
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-fence")
                .on_navigation(|_webview, url| {
                    let host = url.host_str().unwrap_or("");
                    url.scheme() == "tauri"
                        || host == "localhost"
                        || host == "127.0.0.1"
                        || host == "tauri.localhost"
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            fleet_snapshot,
            list_dir,
            read_file_text,
            resolve_paths,
            git_changes,
            git_diff_text,
            room_kill,
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        // Closing the window takes the pty processes with it: a plain shell
        // dies, a room's tmux client dies - which is a DETACH, the session
        // lives on (m6). Both hooks fire in the normal quit path; whichever
        // runs first does the work, and `shutdown` on an empty registry is
        // free.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                pty::shutdown(&window.state::<pty::PtyRegistry>());
            }
        })
        .build(tauri::generate_context!())
        .expect("BAUD failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                pty::shutdown(&app.state::<pty::PtyRegistry>());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> Vec<u8> {
        let mut buffer = Vec::new();
        for arg in args {
            buffer.extend_from_slice(arg.as_bytes());
            buffer.push(0);
        }
        buffer
    }

    #[test]
    fn interactive_session_is_claude_and_not_headless() {
        let cmdline = argv(&[
            "/home/op/.local/bin/claude",
            "--name",
            "devpulse",
            "--permission-mode",
            "bypassPermissions",
        ]);
        assert_eq!(classify_claude_cmdline(&cmdline), Some(false));
    }

    #[test]
    fn bare_and_continue_sessions_are_interactive() {
        assert_eq!(classify_claude_cmdline(&argv(&["claude"])), Some(false));
        assert_eq!(classify_claude_cmdline(&argv(&["claude", "-c"])), Some(false));
    }

    #[test]
    fn dispatched_wake_shapes_are_headless() {
        // The two exact shapes ai_mail's wake spawns: `-p` fresh, `-c -p` continue.
        let fresh = argv(&["claude", "-p", "do the work", "--output-format", "json"]);
        let cont = argv(&["claude", "-c", "-p", "do the work", "--output-format", "json"]);
        assert_eq!(classify_claude_cmdline(&fresh), Some(true));
        assert_eq!(classify_claude_cmdline(&cont), Some(true));
        assert_eq!(
            classify_claude_cmdline(&argv(&["claude", "--print", "one-shot"])),
            Some(true)
        );
    }

    #[test]
    fn interactive_marker_separates_session_kinds() {
        // Real line shapes from both populations: interactive sessions carry
        // checkpoint entries, headless dispatch transcripts never do.
        let interactive = r#"{"type":"file-history-snapshot","snapshot":{}}"#;
        let headless = r#"{"type":"queue-operation","operation":"dequeue","sessionId":"x"}"#;
        assert!(interactive.contains(INTERACTIVE_MARKER));
        assert!(!headless.contains(INTERACTIVE_MARKER));
    }

    #[test]
    fn transcript_dir_name_munges_like_claude() {
        // Both '/' and '_' become '-': verified against real transcript dirs
        // (ai_mail lives under "-...-src-aipass-ai-mail").
        assert_eq!(
            transcript_dir_name(Path::new("/home/op/Projects/AIPass/src/aipass/ai_mail")),
            "-home-op-Projects-AIPass-src-aipass-ai-mail"
        );
    }

    #[test]
    fn viewer_text_refuses_binary_and_flags_truncation() {
        assert!(viewer_text(b"\x7fELF\x00\x01".to_vec(), 1024).is_err());
        assert_eq!(
            viewer_text(b"plain text".to_vec(), 1024).unwrap(),
            ("plain text".to_string(), false)
        );
        let (cut, truncated) = viewer_text(b"0123456789".to_vec(), 4).unwrap();
        assert_eq!((cut.as_str(), truncated), ("0123", true));
    }

    #[test]
    fn git_changes_and_diff_see_uncommitted_edits() {
        // A real throwaway repo: the machine has git (BAUD's doctrine leans
        // on the installed binary), so exercise the actual verbs end to end.
        let repo = std::env::temp_dir().join(format!("baud-git-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&repo);
        fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| {
            let status = Command::new("git")
                .current_dir(&repo)
                .args(args)
                .output()
                .unwrap()
                .status;
            assert!(status.success(), "git {args:?} failed");
        };
        git(&["init", "-q"]);

        // Empty repo: no HEAD yet - the badge must stay quiet, not error.
        assert_eq!(git_changes_in(&repo).count, 0);

        fs::write(repo.join("note.txt"), "old line\n").unwrap();
        git(&["add", "."]);
        git(&[
            "-c",
            "user.email=baud@test",
            "-c",
            "user.name=baud",
            "commit",
            "-q",
            "-m",
            "seed",
        ]);
        assert_eq!(git_changes_in(&repo).count, 0);

        fs::write(repo.join("note.txt"), "new line\n").unwrap();
        let changes = git_changes_in(&repo);
        assert_eq!(changes.files, vec!["note.txt".to_string()]);

        let diff = git_diff_in(&repo).unwrap();
        assert!(diff.content.contains("-old line"));
        assert!(diff.content.contains("+new line"));
        assert!(!diff.truncated);

        // Not a repo at all: quiet zero again.
        let _ = fs::remove_dir_all(repo.join(".git"));
        assert_eq!(git_changes_in(&repo).count, 0);
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn mail_counts_come_from_the_mailbox_not_the_dashboard() {
        let dir = std::env::temp_dir().join(format!("baud-mail-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mailbox = dir.join(".ai_mail.local");
        fs::create_dir_all(&mailbox).unwrap();

        // No inbox file at all: quiet zeros.
        assert_eq!(mail_counts_in(&dir), (0, 0));

        // Real shape: counts follow message status, unknown statuses ignored.
        fs::write(
            mailbox.join("inbox.json"),
            r#"{"unread_count": 9, "messages": [
                {"status": "new"}, {"status": "new"},
                {"status": "opened"}, {"status": "weird"}]}"#,
        )
        .unwrap();
        assert_eq!(mail_counts_in(&dir), (2, 1));

        // Malformed JSON: quiet zeros, never an error.
        fs::write(mailbox.join("inbox.json"), "not json").unwrap();
        assert_eq!(mail_counts_in(&dir), (0, 0));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn room_names_are_tmux_safe() {
        assert_eq!(room_name("devpulse"), "baud-devpulse");
        assert_eq!(room_name("ai_mail"), "baud-ai_mail");
        // '.' and ':' carry tmux target syntax; anything odd flattens to '-'.
        assert_eq!(room_name("AIPASS.admin"), "baud-AIPASS-admin");
        assert_eq!(room_name("a:b c"), "baud-a-b-c");
    }

    #[test]
    fn rooms_are_listed_while_alive_and_killable() {
        // A real throwaway tmux session - the machine runs on tmux (the whole
        // rooms doctrine leans on it), so exercise the actual verbs.
        let branch = format!("roomtest-{}", std::process::id());
        let room = room_name(&branch);
        let spawned = Command::new("tmux")
            .args(["new-session", "-d", "-s", &room])
            .output()
            .expect("tmux must be runnable for the rooms test");
        assert!(spawned.status.success(), "could not create test room");

        assert!(list_rooms().contains(&room), "live room missing from list");

        room_kill(branch.clone()).expect("ending a live room must succeed");
        assert!(!list_rooms().contains(&room), "room survived room_kill");

        // Ending a room that is already gone is idempotent success.
        room_kill(branch).expect("ending a dead room must be a no-op");
    }

    #[test]
    fn non_claude_processes_are_ignored() {
        assert_eq!(classify_claude_cmdline(&argv(&["tmux", "new-session"])), None);
        assert_eq!(classify_claude_cmdline(&argv(&["/usr/bin/claudette"])), None);
        assert_eq!(classify_claude_cmdline(&argv(&[])), None);
        assert_eq!(classify_claude_cmdline(b""), None);
    }

    #[test]
    fn resolve_paths_only_links_real_fenced_files() {
        // The suite runs inside the AIPass tree, so the fence and the root
        // fallback are exercised against the real thing.
        let root = resolve_aipass_root()
            .expect("tests run inside an AIPass tree")
            .canonicalize()
            .expect("root canonicalizes");
        let readme = root.join("README.md");
        assert!(readme.is_file(), "test expects the AIPass root README");

        let hits = resolve_paths(
            None,
            vec![
                readme.display().to_string(),   // absolute, real
                "README.md".to_string(),        // relative -> root fallback
                "/etc/passwd".to_string(),      // real file OUTSIDE the fence
                "no/such/file.xyz".to_string(), // nonexistent
                "projects".to_string(),         // a directory, not a file
            ],
        );

        assert_eq!(hits[0].as_deref(), Some(readme.display().to_string().as_str()));
        assert_eq!(hits[1].as_deref(), Some(readme.display().to_string().as_str()));
        assert_eq!(hits[2], None, "the fence must hold");
        assert_eq!(hits[3], None);
        assert_eq!(hits[4], None, "directories do not open in the viewer");
    }

    #[test]
    fn resolve_paths_prefers_the_seated_branch_dir() {
        // `README.md` is ambiguous: the seated room's copy must win over the
        // AIPass root's.
        let root = resolve_aipass_root().unwrap().canonicalize().unwrap();
        let base = root.join("projects").join("baud");
        assert!(base.join("README.md").is_file(), "test expects baud's README");

        let hits = resolve_paths(Some(base.display().to_string()), vec!["README.md".to_string()]);
        let hit = hits[0].as_deref().expect("baud README resolves");
        assert!(
            hit.ends_with("projects/baud/README.md"),
            "expected the seated dir's file, got {hit}"
        );
    }
}
